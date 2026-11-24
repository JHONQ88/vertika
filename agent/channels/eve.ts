import { createHmac, timingSafeEqual } from 'node:crypto';
import { eveChannel } from 'eve/channels/eve';
import {
  extractBearerToken,
  localDev,
  UnauthenticatedError,
  vercelOidc,
  withAuthChallenges,
  type AuthFn,
} from 'eve/channels/auth';
import { getVertikaAuthSecret } from '../lib/vertika-api.ts';

interface VertikaJwtClaims {
  sub?: string;
  email?: string;
  nombre?: string;
  rol?: string;
  roles?: Array<{ company_id: string; role: string }>;
  exp?: number;
}

function verifyVertikaHs256Jwt(token: string): VertikaJwtClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signatureB64] = parts;
  if (!headerB64 || !payloadB64 || !signatureB64) return null;

  let header: { alg?: string };
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8')) as {
      alg?: string;
    };
  } catch {
    return null;
  }
  if (header.alg !== 'HS256') return null;

  const signingInput = `${headerB64}.${payloadB64}`;
  const expectedSig = createHmac('sha256', getVertikaAuthSecret())
    .update(signingInput)
    .digest();
  let providedSig: Buffer;
  try {
    providedSig = Buffer.from(signatureB64, 'base64url');
  } catch {
    return null;
  }
  if (
    providedSig.length !== expectedSig.length ||
    !timingSafeEqual(providedSig, expectedSig)
  ) {
    return null;
  }

  let claims: VertikaJwtClaims;
  try {
    claims = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8'),
    ) as VertikaJwtClaims;
  } catch {
    return null;
  }

  if (
    typeof claims.sub !== 'string' ||
    claims.sub.trim() === '' ||
    typeof claims.exp !== 'number' ||
    claims.exp < Math.floor(Date.now() / 1000)
  ) {
    return null;
  }
  return claims;
}

function vertikaJwtAuth(): AuthFn<Request> {
  return withAuthChallenges(
    (request) => {
      const token = extractBearerToken(request.headers.get('authorization'));
      if (!token) return null;

      let claims: VertikaJwtClaims | null;
      try {
        claims = verifyVertikaHs256Jwt(token);
      } catch {
        throw new UnauthenticatedError({
          message: 'Configuración de autenticación inválida en el servidor.',
        });
      }
      if (!claims) {
        throw new UnauthenticatedError({
          message: 'Token JWT de Vértika inválido o expirado.',
        });
      }

      return {
        authenticator: 'vertika-jwt',
        principalId: claims.sub!,
        principalType: 'user',
        attributes: {
          email: String(claims.email ?? ''),
          nombre: String(claims.nombre ?? ''),
          rol: String(claims.rol ?? 'CONSEJO'),
          rolesJson: JSON.stringify(Array.isArray(claims.roles) ? claims.roles : []),
        },
      };
    },
    [{ scheme: 'Bearer' }],
  );
}

export default eveChannel({
  auth: [
    // Allows Eve CLI / TUI and Vercel deployments to reach the agent.
    vercelOidc(),
    // Verifies HS256 JWT tokens issued by Vértika's Rust backend (/api/v1/auth/login).
    vertikaJwtAuth(),
    // Open on localhost for `eve dev`; ignored in production.
    localDev(),
  ],
});
