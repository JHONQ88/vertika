use crate::error::ApiError;
use axum::http::{header, HeaderMap};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::Utc;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::fmt::Write;

type HmacSha256 = Hmac<Sha256>;

const DEFAULT_AUTH_SECRET: &str = "vertika-dev-secret-change-in-prod";
const HASH_ITERATIONS: usize = 2_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Role {
    #[serde(rename = "CONTADOR")]
    Contador,
    #[serde(rename = "ADMINISTRADOR")]
    Administrador,
    #[serde(rename = "REVISOR_FISCAL")]
    RevisorFiscal,
    #[serde(rename = "CONSEJO")]
    Consejo,
}

impl Role {
    pub fn as_str(self) -> &'static str {
        match self {
            Role::Contador => "CONTADOR",
            Role::Administrador => "ADMINISTRADOR",
            Role::RevisorFiscal => "REVISOR_FISCAL",
            Role::Consejo => "CONSEJO",
        }
    }

    pub fn from_str_code(s: &str) -> Option<Self> {
        match s.trim().to_uppercase().as_str() {
            "CONTADOR" => Some(Role::Contador),
            "ADMINISTRADOR" => Some(Role::Administrador),
            "REVISOR_FISCAL" => Some(Role::RevisorFiscal),
            "CONSEJO" => Some(Role::Consejo),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompanyRole {
    pub company_id: String,
    pub role: Role,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthUser {
    pub id: String,
    pub email: String,
    pub nombre: String,
    pub rol: Role,
    pub roles: Vec<CompanyRole>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginResponse {
    pub token: String,
    pub user: AuthUser,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct JwtClaims {
    sub: String,
    email: String,
    nombre: String,
    rol: Role,
    roles: Vec<CompanyRole>,
    exp: i64,
}

#[derive(Debug, Clone)]
pub struct AuthContext {
    pub user: AuthUser,
}

impl AuthContext {
    pub fn demo_default() -> Self {
        let companies = ["altavista", "colina", "plaza-norte"];
        Self {
            user: AuthUser {
                id: "usr-contador".into(),
                email: "contador@vertika.co".into(),
                nombre: "Lina Castro".into(),
                rol: Role::Contador,
                roles: companies
                    .into_iter()
                    .map(|c| CompanyRole {
                        company_id: c.into(),
                        role: Role::Contador,
                    })
                    .collect(),
            },
        }
    }

    pub fn actor_label(&self) -> String {
        format!("{} ({})", self.user.nombre, self.user.rol.as_str())
    }

    pub fn require_any_role(&self, allowed: &[Role]) -> Result<(), ApiError> {
        let has_global = allowed.contains(&self.user.rol);
        let has_company = self.user.roles.iter().any(|r| allowed.contains(&r.role));
        if has_global || has_company {
            Ok(())
        } else {
            Err(ApiError::Forbidden(format!(
                "El rol {} no tiene permiso para esta operación.",
                self.user.rol.as_str()
            )))
        }
    }

    pub fn require_company_roles(&self, company_id: &str, allowed: &[Role]) -> Result<(), ApiError> {
        let matched = self
            .user
            .roles
            .iter()
            .find(|r| r.company_id == company_id)
            .map(|r| r.role);

        match matched {
            Some(role) if allowed.contains(&role) => Ok(()),
            Some(role) => Err(ApiError::Forbidden(format!(
                "El rol {} no tiene permiso sobre la copropiedad '{company_id}'.",
                role.as_str()
            ))),
            None => Err(ApiError::Forbidden(format!(
                "Sin acceso asignado a la copropiedad '{company_id}'."
            ))),
        }
    }
}

fn auth_secret() -> String {
    std::env::var("AUTH_SECRET")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_AUTH_SECRET.into())
}

fn to_hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        let _ = write!(&mut out, "{b:02x}");
    }
    out
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (&x, &y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

pub fn hash_password(password: &str, salt: &str) -> String {
    let mut current = Vec::new();
    let mut mac = <HmacSha256 as Mac>::new_from_slice(salt.as_bytes()).expect("hmac key");
    mac.update(password.as_bytes());
    current.extend_from_slice(&mac.finalize().into_bytes());

    for _ in 1..HASH_ITERATIONS {
        let mut step = <HmacSha256 as Mac>::new_from_slice(salt.as_bytes()).expect("hmac key");
        step.update(&current);
        let bytes = step.finalize().into_bytes();
        current.clear();
        current.extend_from_slice(&bytes);
    }
    format!("hmac-sha256${HASH_ITERATIONS}${salt}${}", to_hex(&current))
}

pub fn verify_password(password: &str, stored_hash: &str) -> bool {
    let parts: Vec<&str> = stored_hash.split('$').collect();
    if parts.len() != 4 || parts[0] != "hmac-sha256" {
        return false;
    }
    let salt = parts[2];
    let expected = hash_password(password, salt);
    constant_time_eq(expected.as_bytes(), stored_hash.as_bytes())
}

pub fn issue_token(user: &AuthUser) -> Result<String, ApiError> {
    let header_b64 = URL_SAFE_NO_PAD.encode(br#"{"alg":"HS256","typ":"JWT"}"#);
    let claims = JwtClaims {
        sub: user.id.clone(),
        email: user.email.clone(),
        nombre: user.nombre.clone(),
        rol: user.rol,
        roles: user.roles.clone(),
        exp: Utc::now().timestamp() + 60 * 60 * 12,
    };
    let payload_json = serde_json::to_vec(&claims)
        .map_err(|e| ApiError::Internal(format!("No se pudo serializar JWT: {e}")))?;
    let payload_b64 = URL_SAFE_NO_PAD.encode(payload_json);
    let signing_input = format!("{header_b64}.{payload_b64}");

    let mut mac = <HmacSha256 as Mac>::new_from_slice(auth_secret().as_bytes())
        .map_err(|_| ApiError::Internal("Secreto JWT inválido".into()))?;
    mac.update(signing_input.as_bytes());
    let sig_b64 = URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes());

    Ok(format!("{signing_input}.{sig_b64}"))
}

pub fn verify_token(token: &str) -> Result<AuthUser, ApiError> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
        return Err(ApiError::Unauthorized("Token JWT malformado.".into()));
    }
    let signing_input = format!("{}.{}", parts[0], parts[1]);
    let sig_bytes = URL_SAFE_NO_PAD
        .decode(parts[2])
        .map_err(|_| ApiError::Unauthorized("Firma JWT inválida.".into()))?;

    let mut mac = <HmacSha256 as Mac>::new_from_slice(auth_secret().as_bytes())
        .map_err(|_| ApiError::Internal("Secreto JWT inválido".into()))?;
    mac.update(signing_input.as_bytes());
    mac.verify_slice(&sig_bytes)
        .map_err(|_| ApiError::Unauthorized("Firma JWT inválida.".into()))?;

    let payload_bytes = URL_SAFE_NO_PAD
        .decode(parts[1])
        .map_err(|_| ApiError::Unauthorized("Payload JWT inválido.".into()))?;
    let claims: JwtClaims = serde_json::from_slice(&payload_bytes)
        .map_err(|_| ApiError::Unauthorized("Claims JWT inválidos.".into()))?;

    if claims.exp < Utc::now().timestamp() {
        return Err(ApiError::Unauthorized("La sesión ha expirado.".into()));
    }

    Ok(AuthUser {
        id: claims.sub,
        email: claims.email,
        nombre: claims.nombre,
        rol: claims.rol,
        roles: claims.roles,
    })
}

pub fn extract_auth(headers: &HeaderMap, auth_required: bool) -> Result<AuthContext, ApiError> {
    let raw = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .map(str::trim);

    match raw {
        Some(h) if !h.is_empty() => {
            let token = h
                .strip_prefix("Bearer ")
                .or_else(|| h.strip_prefix("bearer "))
                .ok_or_else(|| ApiError::Unauthorized("Encabezado Authorization debe usar Bearer.".into()))?;
            let user = verify_token(token.trim())?;
            Ok(AuthContext { user })
        }
        _ if auth_required => Err(ApiError::Unauthorized(
            "Autenticación requerida. Inicia sesión para continuar.".into(),
        )),
        _ => Ok(AuthContext::demo_default()),
    }
}

pub struct DemoSeedUser {
    pub id: &'static str,
    pub email: &'static str,
    pub nombre: &'static str,
    pub rol: Role,
    pub salt: &'static str,
}

pub const DEMO_PASSWORD: &str = "vertika2026";

pub const DEMO_USERS: [DemoSeedUser; 4] = [
    DemoSeedUser {
        id: "usr-contador",
        email: "contador@vertika.co",
        nombre: "Lina Castro",
        rol: Role::Contador,
        salt: "salt-contador-v1",
    },
    DemoSeedUser {
        id: "usr-admin",
        email: "admin@vertika.co",
        nombre: "Carlos Mendoza",
        rol: Role::Administrador,
        salt: "salt-admin-v1",
    },
    DemoSeedUser {
        id: "usr-revisor",
        email: "revisor@vertika.co",
        nombre: "Marta Lucía Peña",
        rol: Role::RevisorFiscal,
        salt: "salt-revisor-v1",
    },
    DemoSeedUser {
        id: "usr-consejo",
        email: "consejo@vertika.co",
        nombre: "Andrea Gómez",
        rol: Role::Consejo,
        salt: "salt-consejo-v1",
    },
];
