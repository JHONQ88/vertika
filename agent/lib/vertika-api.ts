import { createHmac } from 'node:crypto';

const DEFAULT_AUTH_SECRET = 'vertika-dev-secret-change-in-prod';

export interface SessionAuthContextLike {
  readonly authenticator?: string;
  readonly principalId?: string;
  readonly attributes?: Readonly<Record<string, string | readonly string[]>>;
}

export interface SessionAuthLike {
  readonly current?: SessionAuthContextLike | null;
  readonly initiator?: SessionAuthContextLike | null;
}

export interface VertikaFetchOptions extends RequestInit {
  signal?: AbortSignal;
  allowStatuses?: number[];
  sessionAuth?: SessionAuthLike | null;
}

export function isProductionRuntime(): boolean {
  return process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
}

export function getVertikaAuthSecret(): string {
  const configured = process.env.AUTH_SECRET?.trim() ?? '';
  if (isProductionRuntime()) {
    if (!configured || configured === DEFAULT_AUTH_SECRET || configured.length < 32) {
      throw new Error(
        'AUTH_SECRET inválido o faltante en producción (debe tener al menos 32 caracteres aleatorios).',
      );
    }
    return configured;
  }
  return configured.length > 0 ? configured : DEFAULT_AUTH_SECRET;
}

function mintShortLivedUserJwt(sessionAuth: SessionAuthContextLike): string {
  const attrs = sessionAuth.attributes ?? {};
  const attrStr = (key: string, fallback = ''): string => {
    const val = attrs[key];
    return typeof val === 'string' ? val : fallback;
  };
  let roles: Array<{ company_id: string; role: string }> = [];
  const rawRoles = attrStr('rolesJson');
  if (rawRoles) {
    try {
      const parsed = JSON.parse(rawRoles);
      if (Array.isArray(parsed)) roles = parsed;
    } catch {
      roles = [];
    }
  }
  const headerB64 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payloadB64 = Buffer.from(
    JSON.stringify({
      sub: sessionAuth.principalId ?? '',
      email: attrStr('email'),
      nombre: attrStr('nombre'),
      rol: attrStr('rol', 'CONSEJO'),
      roles,
      exp: Math.floor(Date.now() / 1000) + 60,
    }),
  ).toString('base64url');
  const signingInput = `${headerB64}.${payloadB64}`;
  const sigB64 = createHmac('sha256', getVertikaAuthSecret())
    .update(signingInput)
    .digest('base64url');
  return `${signingInput}.${sigB64}`;
}

export function getVertikaApiBaseUrl(): string {
  const raw =
    process.env.VERTIKA_API_URL ||
    process.env.VITE_API_URL ||
    'http://localhost:8080';
  return raw.replace(/\/+$/, '');
}

export async function vertikaFetch<T = unknown>(
  path: string,
  options: VertikaFetchOptions = {},
): Promise<T> {
  const base = getVertikaApiBaseUrl();
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }

  if (!headers.has('Authorization')) {
    const caller = options.sessionAuth?.current ?? options.sessionAuth?.initiator;
    if (caller?.authenticator === 'vertika-jwt') {
      // Propagate the exact verified user identity and scoped company roles (never elevate privileges)
      headers.set('Authorization', `Bearer ${mintShortLivedUserJwt(caller)}`);
    } else if (!isProductionRuntime()) {
      const token = process.env.VERTIKA_API_TOKEN?.trim();
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
    }
  }

  const { allowStatuses, sessionAuth: _ignored, ...fetchInit } = options;

  let res: Response;
  try {
    res = await fetch(url, { ...fetchInit, headers });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `No se pudo conectar al backend de Vértika en ${url}. Verifica que el servidor Rust ('cargo run' en backend/) esté activo. Detalle: ${detail}`,
    );
  }

  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  const allowed = allowStatuses?.includes(res.status) ?? false;
  if (!res.ok && !allowed) {
    const errObj =
      parsed && typeof parsed === 'object'
        ? (parsed as { error?: string; message?: string })
        : null;
    const msg =
      errObj?.error ||
      errObj?.message ||
      (typeof parsed === 'string' && parsed) ||
      `HTTP ${res.status}`;
    throw new Error(`Vértika API (${res.status} en ${path}): ${msg}`);
  }

  return parsed as T;
}
