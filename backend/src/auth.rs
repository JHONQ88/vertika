use crate::error::ApiError;
use axum::http::{header, HeaderMap};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::Utc;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt::Write;

type HmacSha256 = Hmac<Sha256>;

const DEFAULT_AUTH_SECRET: &str = "vertika-dev-secret-change-in-prod";
const HASH_ITERATIONS: usize = 2_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Role {
    #[serde(rename = "SUPER_ADMIN")]
    SuperAdmin,
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
            Role::SuperAdmin => "SUPER_ADMIN",
            Role::Contador => "CONTADOR",
            Role::Administrador => "ADMINISTRADOR",
            Role::RevisorFiscal => "REVISOR_FISCAL",
            Role::Consejo => "CONSEJO",
        }
    }

    pub fn from_str_code(s: &str) -> Option<Self> {
        match s.trim().to_uppercase().as_str() {
            "SUPER_ADMIN" => Some(Role::SuperAdmin),
            "CONTADOR" => Some(Role::Contador),
            "ADMINISTRADOR" => Some(Role::Administrador),
            "REVISOR_FISCAL" => Some(Role::RevisorFiscal),
            "CONSEJO" => Some(Role::Consejo),
            _ => None,
        }
    }
}

fn default_max_copropiedades() -> i32 {
    1
}

fn default_plan_nombre() -> String {
    "PRUEBA".into()
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
    #[serde(default, rename = "isSuperAdmin", alias = "is_super_admin")]
    pub is_super_admin: bool,
    #[serde(
        default = "default_max_copropiedades",
        rename = "maxCopropiedades",
        alias = "max_copropiedades"
    )]
    pub max_copropiedades: i32,
    #[serde(
        default = "default_plan_nombre",
        rename = "planNombre",
        alias = "plan_nombre"
    )]
    pub plan_nombre: String,
    #[serde(default, rename = "expiresAt", alias = "expires_at")]
    pub expires_at: Option<String>,
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
#[serde(rename_all = "camelCase")]
pub struct ChangePasswordRequest {
    #[serde(alias = "current_password")]
    pub current_password: String,
    #[serde(alias = "new_password")]
    pub new_password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateUserRequest {
    pub email: String,
    pub nombre: String,
    pub password: String,
    pub rol: Role,
    #[serde(default, alias = "company_ids")]
    pub company_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateContadorRequest {
    pub email: String,
    pub nombre: String,
    pub password: String,
    #[serde(default, alias = "plan_nombre")]
    pub plan_nombre: Option<String>,
    #[serde(default, alias = "max_copropiedades")]
    pub max_copropiedades: Option<i32>,
    #[serde(default, alias = "dias_prueba")]
    pub dias_prueba: Option<i32>,
    #[serde(default, alias = "company_ids")]
    pub company_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAdminUserRequest {
    #[serde(default)]
    pub activo: Option<bool>,
    #[serde(default, alias = "max_copropiedades")]
    pub max_copropiedades: Option<i32>,
    #[serde(default, alias = "plan_nombre")]
    pub plan_nombre: Option<String>,
    /// Explicit ISO-8601 timestamp or empty string to clear expiration (permanent).
    #[serde(default, alias = "expires_at")]
    pub expires_at: Option<String>,
    /// Convenience shortcut: extend current expiration (or now) by N days.
    #[serde(default, alias = "extend_days")]
    pub extend_days: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminCompanyBrief {
    pub id: String,
    pub nit: String,
    pub nombre_corto: String,
    pub razon_social: String,
    pub periodo_actual: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminContadorItem {
    pub id: String,
    pub email: String,
    pub nombre: String,
    pub activo: bool,
    pub plan_nombre: String,
    pub max_copropiedades: i32,
    pub copropiedades_usadas: usize,
    pub usuarios_creados: usize,
    pub expires_at: Option<String>,
    pub vencido: bool,
    pub created_at: String,
    pub copropiedades: Vec<AdminCompanyBrief>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminOverviewResponse {
    pub total_contadores: usize,
    pub contadores_activos: usize,
    pub total_copropiedades: usize,
    pub pruebas_activas: usize,
    pub cuentas_suspendidas_o_vencidas: usize,
    pub contadores: Vec<AdminContadorItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct JwtClaims {
    sub: String,
    email: String,
    nombre: String,
    rol: Role,
    roles: Vec<CompanyRole>,
    #[serde(default)]
    is_super_admin: bool,
    #[serde(default = "default_max_copropiedades")]
    max_copropiedades: i32,
    #[serde(default = "default_plan_nombre")]
    plan_nombre: String,
    #[serde(default)]
    expires_at: Option<String>,
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
                is_super_admin: false,
                max_copropiedades: 5,
                plan_nombre: "DEMO".into(),
                expires_at: None,
            },
        }
    }

    pub fn is_super_admin(&self) -> bool {
        self.user.is_super_admin || self.user.rol == Role::SuperAdmin
    }

    pub fn require_super_admin(&self) -> Result<(), ApiError> {
        if self.is_super_admin() {
            Ok(())
        } else {
            Err(ApiError::Forbidden(
                "Esta operación es exclusiva del propietario de la plataforma (SUPER_ADMIN).".into(),
            ))
        }
    }

    pub fn actor_label(&self) -> String {
        format!("{} ({})", self.user.nombre, self.user.rol.as_str())
    }

    pub fn require_any_role(&self, allowed: &[Role]) -> Result<(), ApiError> {
        if self.is_super_admin() {
            return Ok(());
        }
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
        if self.is_super_admin() {
            return Ok(());
        }
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

    pub fn require_company_access(&self, company_id: &str) -> Result<(), ApiError> {
        if self.is_super_admin() {
            return Ok(());
        }
        self.require_company_roles(
            company_id,
            &[
                Role::Contador,
                Role::Administrador,
                Role::RevisorFiscal,
                Role::Consejo,
            ],
        )
    }

    pub fn allowed_company_ids(&self) -> Vec<String> {
        self.user.roles.iter().map(|r| r.company_id.clone()).collect()
    }

    pub fn managed_company_ids(&self, allowed: &[Role]) -> Vec<String> {
        self.user
            .roles
            .iter()
            .filter(|r| allowed.contains(&r.role))
            .map(|r| r.company_id.clone())
            .collect()
    }
}

const LOGIN_RATE_WINDOW_SECS: i64 = 60;
const LOGIN_RATE_MAX_FAILS: usize = 5;
const LOGIN_RATE_MAX_TRACKED_KEYS: usize = 4_096;

pub struct LoginRateLimiter {
    attempts: std::sync::Mutex<std::collections::HashMap<String, Vec<i64>>>,
}

impl LoginRateLimiter {
    pub fn new() -> Self {
        Self {
            attempts: std::sync::Mutex::new(std::collections::HashMap::new()),
        }
    }

    fn prune_expired(map: &mut std::collections::HashMap<String, Vec<i64>>, cutoff: i64) {
        map.retain(|_, timestamps| {
            timestamps.retain(|&ts| ts > cutoff);
            !timestamps.is_empty()
        });
    }

    fn check_key(
        map: &mut std::collections::HashMap<String, Vec<i64>>,
        key: &str,
        cutoff: i64,
    ) -> Result<(), ApiError> {
        let recent_count = if let Some(timestamps) = map.get_mut(key) {
            timestamps.retain(|&ts| ts > cutoff);
            let len = timestamps.len();
            if len == 0 {
                map.remove(key);
            }
            len
        } else {
            0
        };
        if recent_count >= LOGIN_RATE_MAX_FAILS {
            return Err(ApiError::TooManyRequests(
                "Demasiados intentos fallidos de inicio de sesión. Intenta de nuevo en 1 minuto."
                    .into(),
            ));
        }
        Ok(())
    }

    fn record_key(
        map: &mut std::collections::HashMap<String, Vec<i64>>,
        key: &str,
        now: i64,
        cutoff: i64,
    ) {
        if map.len() >= LOGIN_RATE_MAX_TRACKED_KEYS && !map.contains_key(key) {
            Self::prune_expired(map, cutoff);
            if map.len() >= LOGIN_RATE_MAX_TRACKED_KEYS {
                map.clear();
            }
        }
        let entry = map.entry(key.to_string()).or_default();
        entry.retain(|&ts| ts > cutoff);
        entry.push(now);
    }

    pub fn check(&self, ip_key: &str, email_key: &str) -> Result<(), ApiError> {
        let now = Utc::now().timestamp();
        let cutoff = now - LOGIN_RATE_WINDOW_SECS;
        let mut map = self.attempts.lock().expect("rate limiter lock");
        Self::check_key(&mut map, ip_key, cutoff)?;
        Self::check_key(&mut map, email_key, cutoff)?;
        Ok(())
    }

    pub fn record_failure(&self, ip_key: &str, email_key: &str) {
        let now = Utc::now().timestamp();
        let cutoff = now - LOGIN_RATE_WINDOW_SECS;
        let mut map = self.attempts.lock().expect("rate limiter lock");
        Self::record_key(&mut map, ip_key, now, cutoff);
        Self::record_key(&mut map, email_key, now, cutoff);
    }

    pub fn clear(&self, ip_key: &str, email_key: &str) {
        let mut map = self.attempts.lock().expect("rate limiter lock");
        map.remove(ip_key);
        map.remove(email_key);
    }
}

fn client_ip_from_headers(headers: &HeaderMap) -> &str {
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .or_else(|| {
            headers
                .get("x-real-ip")
                .and_then(|v| v.to_str().ok())
                .map(str::trim)
                .filter(|s| !s.is_empty())
        })
        .unwrap_or("local")
}

pub fn login_rate_keys(headers: &HeaderMap, email: &str) -> (String, String) {
    let ip = client_ip_from_headers(headers);
    let normalized_email = email.trim().to_ascii_lowercase();
    (
        format!("ip:{ip}|{normalized_email}"),
        format!("email:{normalized_email}"),
    )
}

pub fn portal_rate_keys(headers: &HeaderMap, company_slug: &str, doc_digits: &str) -> (String, String) {
    let ip = client_ip_from_headers(headers);
    let slug = company_slug.trim().to_ascii_lowercase();
    (
        format!("portal-ip:{ip}|{slug}"),
        format!("portal-doc:{slug}|{}", doc_digits.trim()),
    )
}

pub fn validate_production_secret(
    auth_required: bool,
    seed_demo: bool,
    secret_env: Option<&str>,
) -> Result<(), String> {
    if !(auth_required && !seed_demo) {
        return Ok(());
    }
    let trimmed = secret_env.map(str::trim).unwrap_or("");
    if trimmed.is_empty() {
        return Err(
            "AUTH_SECRET es obligatorio cuando AUTH_REQUIRED=true y SEED_DEMO=false.".into(),
        );
    }
    if trimmed == DEFAULT_AUTH_SECRET {
        return Err(
            "AUTH_SECRET no puede usar el secreto de desarrollo por defecto en producción.".into(),
        );
    }
    if trimmed.len() < 32 {
        return Err(
            "AUTH_SECRET debe tener al menos 32 caracteres aleatorios en producción.".into(),
        );
    }
    Ok(())
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

pub fn is_expired_iso(expires_at: Option<&str>) -> bool {
    let Some(raw) = expires_at.map(str::trim).filter(|s| !s.is_empty()) else {
        return false;
    };
    chrono::DateTime::parse_from_rfc3339(raw)
        .map(|dt| dt.with_timezone(&Utc) < Utc::now())
        .unwrap_or(false)
}

pub fn issue_token(user: &AuthUser) -> Result<String, ApiError> {
    let header_b64 = URL_SAFE_NO_PAD.encode(br#"{"alg":"HS256","typ":"JWT"}"#);
    let claims = JwtClaims {
        sub: user.id.clone(),
        email: user.email.clone(),
        nombre: user.nombre.clone(),
        rol: user.rol,
        roles: user.roles.clone(),
        is_super_admin: user.is_super_admin || user.rol == Role::SuperAdmin,
        max_copropiedades: user.max_copropiedades,
        plan_nombre: user.plan_nombre.clone(),
        expires_at: user.expires_at.clone(),
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
    if is_expired_iso(claims.expires_at.as_deref()) {
        return Err(ApiError::Forbidden(
            "Tu periodo de prueba finalizó. Contacta a Vértika para activar tu plan.".into(),
        ));
    }

    Ok(AuthUser {
        id: claims.sub,
        email: claims.email,
        nombre: claims.nombre,
        rol: claims.rol,
        roles: claims.roles,
        is_super_admin: claims.is_super_admin || claims.rol == Role::SuperAdmin,
        max_copropiedades: claims.max_copropiedades,
        plan_nombre: claims.plan_nombre,
        expires_at: claims.expires_at,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortalTokenPayload {
    pub company_id: String,
    pub unit_id: String,
}

pub fn sha256_hex(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    to_hex(&hasher.finalize())
}

pub fn issue_portal_token(company_id: &str, unit_id: &str) -> Result<String, ApiError> {
    let payload = PortalTokenPayload {
        company_id: company_id.trim().to_string(),
        unit_id: unit_id.trim().to_string(),
    };
    let payload_json = serde_json::to_vec(&payload)
        .map_err(|e| ApiError::Internal(format!("No se pudo serializar token portal: {e}")))?;
    let payload_b64 = URL_SAFE_NO_PAD.encode(payload_json);
    let signing_input = format!("ptk1.{payload_b64}");

    let mut mac = <HmacSha256 as Mac>::new_from_slice(auth_secret().as_bytes())
        .map_err(|_| ApiError::Internal("Secreto JWT inválido".into()))?;
    mac.update(signing_input.as_bytes());
    let sig_b64 = URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes());

    Ok(format!("{payload_b64}.{sig_b64}"))
}

pub fn verify_portal_token(token: &str) -> Result<PortalTokenPayload, ApiError> {
    let parts: Vec<&str> = token.trim().split('.').collect();
    if parts.len() != 2 {
        return Err(ApiError::Unauthorized("Enlace de pago inválido o malformado.".into()));
    }
    let signing_input = format!("ptk1.{}", parts[0]);
    let sig_bytes = URL_SAFE_NO_PAD
        .decode(parts[1])
        .map_err(|_| ApiError::Unauthorized("Firma del enlace de pago inválida.".into()))?;

    let mut mac = <HmacSha256 as Mac>::new_from_slice(auth_secret().as_bytes())
        .map_err(|_| ApiError::Internal("Secreto JWT inválido".into()))?;
    mac.update(signing_input.as_bytes());
    mac.verify_slice(&sig_bytes)
        .map_err(|_| ApiError::Unauthorized("Enlace de pago adulterado o inválido.".into()))?;

    let payload_bytes = URL_SAFE_NO_PAD
        .decode(parts[0])
        .map_err(|_| ApiError::Unauthorized("Payload del enlace de pago inválido.".into()))?;
    serde_json::from_slice(&payload_bytes)
        .map_err(|_| ApiError::Unauthorized("Datos del enlace de pago inválidos.".into()))
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

pub const DEMO_SUPER_ADMIN: DemoSeedUser = DemoSeedUser {
    id: "usr-superadmin",
    email: "superadmin@vertika.co",
    nombre: "Propietario Vértika",
    rol: Role::SuperAdmin,
    salt: "salt-superadmin-v1",
};

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
