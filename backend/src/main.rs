mod auth;
mod db;
mod domain;
mod error;
mod repo;

use auth::{
    ChangePasswordRequest, CreateContadorRequest, CreateUserRequest, LoginRequest, LoginResponse,
    Role, UpdateAdminUserRequest,
};
use axum::{
    extract::{Path, Query, Request as AxumRequest, State},
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    middleware::{self, Next},
    response::Response,
    routing::{get, patch, post, put},
    Json, Router,
};
use db::Db;
use domain::{
    ledger::{self, EntryDraft, PreEntryDraft},
    BalanceRequest, BillPeriodRequest, ClosePeriodRequest, CopyThirdPartiesRequest,
    CreateCompanyRequest, CreateEntryRequest, CreatePreEntryRequest, CreatePucAccountRequest,
    Health, LedgerAccount, PortalCheckoutRequest, PortalLookupRequest,
    UpdateCompanySettingsRequest, UpdatePreEntryLinesRequest, UpdateRubroBudgetRequest,
    UpsertThirdPartyRequest, UpsertUnitRequest, ValidationResult, VoidEntryRequest,
};
use error::ApiError;
use repo::{memory::MemoryRepo, postgres::PostgresRepo, Store};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{net::SocketAddr, sync::Arc};
use tower_http::cors::{Any, CorsLayer};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

struct AppState {
    store: Store,
    auth_required: bool,
    seed_demo: bool,
    login_limiter: auth::LoginRateLimiter,
}

impl AppState {
    async fn new() -> Self {
        let seed: Value = serde_json::from_str(include_str!("../seed_bootstrap.json"))
            .expect("seed_bootstrap.json válido");
        let auth_required = std::env::var("AUTH_REQUIRED")
            .ok()
            .is_some_and(|v| matches!(v.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes"));
        let seed_demo = !std::env::var("SEED_DEMO")
            .ok()
            .is_some_and(|v| matches!(v.trim().to_ascii_lowercase().as_str(), "0" | "false" | "no"));
        auth::validate_production_secret(
            auth_required,
            seed_demo,
            std::env::var("AUTH_SECRET").ok().as_deref(),
        )
        .expect("Configuración AUTH_SECRET insegura para producción");

        let database_url = std::env::var("DATABASE_URL").ok();
        let store = match database_url {
            Some(url) if !url.trim().is_empty() => {
                let db = Db::connect(&url)
                    .await
                    .expect("No se pudo conectar a PostgreSQL con DATABASE_URL configurado");
                let pg = PostgresRepo::init(db, seed, seed_demo)
                    .await
                    .expect("Error inicializando repositorio PostgreSQL y migraciones");
                tracing::info!("Conectado a PostgreSQL, migraciones listas (seed_demo={seed_demo})");
                Store::Postgres(pg)
            }
            _ => Store::Memory(MemoryRepo::new(seed).expect("seed válido")),
        };
        Self {
            store,
            auth_required,
            seed_demo,
            login_limiter: auth::LoginRateLimiter::new(),
        }
    }

    #[cfg(test)]
    fn demo_for_tests() -> Self {
        Self::demo_for_tests_with_auth(false)
    }

    #[cfg(test)]
    fn demo_for_tests_with_auth(auth_required: bool) -> Self {
        Self::demo_for_tests_with_flags(auth_required, true)
    }

    #[cfg(test)]
    fn demo_for_tests_with_flags(auth_required: bool, seed_demo: bool) -> Self {
        let seed: Value = serde_json::from_str(include_str!("../seed_bootstrap.json"))
            .expect("seed_bootstrap.json válido");
        Self {
            store: Store::Memory(MemoryRepo::new(seed).expect("seed válido")),
            auth_required,
            seed_demo,
            login_limiter: auth::LoginRateLimiter::new(),
        }
    }
}

async fn security_headers_middleware(req: AxumRequest, next: Next) -> Response {
    let mut res = next.run(req).await;
    let headers = res.headers_mut();
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    headers.insert(
        header::HeaderName::from_static("referrer-policy"),
        HeaderValue::from_static("strict-origin-when-cross-origin"),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    res
}

fn build_cors_layer() -> CorsLayer {
    let origins: Vec<HeaderValue> = std::env::var("CORS_ORIGINS")
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .filter_map(|s| HeaderValue::from_str(s).ok())
        .collect();

    if origins.is_empty() {
        CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any)
    } else {
        CorsLayer::new()
            .allow_origin(origins)
            .allow_methods([
                Method::GET,
                Method::POST,
                Method::PUT,
                Method::PATCH,
                Method::DELETE,
                Method::OPTIONS,
            ])
            .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION, header::ACCEPT])
    }
}

fn build_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/api/v1/auth/login", post(auth_login))
        .route("/api/v1/auth/me", get(auth_me))
        .route("/api/v1/auth/change-password", post(auth_change_password))
        .route("/api/v1/auth/users", post(auth_create_user))
        .route("/api/v1/companies", post(create_company))
        .route("/api/v1/admin/overview", get(admin_overview))
        .route("/api/v1/admin/contadores", post(admin_create_contador))
        .route("/api/v1/admin/users/:id", patch(admin_update_user))
        .route("/api/v1/bootstrap", get(bootstrap))
        .route("/api/v1/state", get(get_state).put(put_state))
        .route("/api/v1/reset", post(reset_state))
        .route("/api/v1/puc", get(puc_catalog))
        .route("/api/v1/ledger/validate", post(validate_entry))
        .route("/api/v1/ledger/preview", post(preview_entry))
        .route("/api/v1/pre-entries/carry-forward", post(carry_forward))
        .route("/api/v1/balance", post(balance_preview))
        // Endpoints transaccionales Bloque B + ingesta pre-asientos
        .route("/api/v1/pre-entries", post(create_pre_entry))
        .route("/api/v1/pre-entries/:id/lines", put(update_pre_entry_lines))
        .route("/api/v1/pre-entries/:id/approve", post(approve_pre_entry))
        .route("/api/v1/pre-entries/:id/reject", post(reject_pre_entry))
        .route("/api/v1/entries", post(create_entry))
        .route("/api/v1/entries/:id/void", post(void_entry))
        .route("/api/v1/companies/:company_id/entries", get(list_company_entries))
        .route(
            "/api/v1/companies/:company_id/periods/:period/close",
            post(close_company_period),
        )
        .route(
            "/api/v1/companies/:company_id/reports/balance",
            get(company_trial_balance),
        )
        .route("/api/v1/companies/:company_id/audit", get(company_audit))
        // Endpoints Bloque C (causación masiva, apertura de periodo y CRUD maestros)
        .route(
            "/api/v1/companies/:company_id/periods/:period/bill",
            post(bill_company_period),
        )
        .route(
            "/api/v1/companies/:company_id/periods/open-next",
            post(open_next_company_period),
        )
        .route("/api/v1/companies/:company_id/units", post(create_unit))
        .route(
            "/api/v1/companies/:company_id/units/:unit_id",
            put(update_unit),
        )
        .route(
            "/api/v1/companies/:company_id/third-parties",
            post(create_third_party),
        )
        .route(
            "/api/v1/companies/:company_id/third-parties/copy-from",
            post(copy_third_parties),
        )
        .route(
            "/api/v1/companies/:company_id/third-parties/:tp_id",
            put(update_third_party),
        )
        .route("/api/v1/companies/:company_id/puc", post(create_puc_account))
        .route(
            "/api/v1/companies/:company_id/rubros/:rubro_id",
            put(update_rubro_budget),
        )
        .route(
            "/api/v1/companies/:company_id/settings",
            patch(update_company_settings),
        )
        .route(
            "/api/v1/companies/:company_id/portal-links",
            get(company_portal_links),
        )
        // Portal público de propietarios/inquilinos y Webhook Wompi
        .route("/api/v1/portal/company/:slug", get(portal_company_info))
        .route("/api/v1/portal/lookup", post(portal_lookup))
        .route("/api/v1/portal/unit/:token", get(portal_unit_statement))
        .route(
            "/api/v1/portal/unit/:token/checkout",
            post(portal_unit_checkout),
        )
        .route(
            "/api/v1/portal/unit/:token/simulate-payment",
            post(portal_simulate_payment),
        )
        .route("/api/v1/webhooks/wompi", post(wompi_webhook))
        .with_state(state)
        .layer(middleware::from_fn(security_headers_middleware))
        .layer(build_cors_layer())
}

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "vertika_backend=debug,tower_http=info,sqlx=warn".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let state = Arc::new(AppState::new().await);
    let app = build_router(state);

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8080);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("Vértika backend escuchando en http://{addr}");
    let listener = tokio::net::TcpListener::bind(addr).await.expect("bind");
    axum::serve(listener, app).await.expect("server");
}

#[derive(Debug, Deserialize, Default)]
struct CompanyQuery {
    company_id: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct PeriodQuery {
    period: Option<String>,
}

async fn health(State(state): State<Arc<AppState>>) -> Json<Health> {
    Json(Health {
        status: "ok".into(),
        service: "vertika-backend".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        mode: state.store.mode().into(),
        postgres_enabled: state.store.postgres_enabled(),
    })
}

fn filter_array_by_company(obj: &mut serde_json::Map<String, Value>, key: &str, field: &str, allowed: &[String], keep_global: bool) {
    if let Some(Value::Array(items)) = obj.get_mut(key) {
        items.retain(|item| match item.get(field).and_then(|v| v.as_str()) {
            Some(cid) => allowed.iter().any(|a| a == cid),
            None => keep_global,
        });
    }
}

fn filter_estado_by_companies(val: &mut Value, allowed: &[String]) {
    let Some(obj) = val.as_object_mut() else {
        return;
    };
    filter_array_by_company(obj, "preAsientos", "empresaId", allowed, false);
    filter_array_by_company(obj, "comprobantes", "empresaId", allowed, false);
    filter_array_by_company(obj, "auditoria", "empresaId", allowed, false);
    if let Some(Value::Object(closed)) = obj.get_mut("periodosCerrados") {
        closed.retain(|k, _| allowed.iter().any(|a| a == k));
    }
    if let Some(first) = allowed.first() {
        let active_allowed = obj
            .get("activeCompanyId")
            .and_then(|v| v.as_str())
            .is_some_and(|cid| allowed.iter().any(|a| a == cid));
        if !active_allowed {
            obj.insert("activeCompanyId".into(), Value::String(first.clone()));
        }
    } else {
        obj.insert("activeCompanyId".into(), Value::String(String::new()));
    }
}

fn filter_bootstrap_by_companies(val: &mut Value, allowed: &[String]) {
    let has_demo_company = allowed
        .iter()
        .any(|c| matches!(c.as_str(), "altavista" | "colina" | "plaza-norte"));
    if let Some(datos) = val.get_mut("datos").and_then(|v| v.as_object_mut()) {
        filter_array_by_company(datos, "companies", "id", allowed, false);
        filter_array_by_company(datos, "units", "empresaId", allowed, false);
        filter_array_by_company(datos, "terceros", "empresaId", allowed, has_demo_company);
        filter_array_by_company(datos, "rubros", "empresaId", allowed, false);
        filter_array_by_company(datos, "comprobantes", "empresaId", allowed, false);
        filter_array_by_company(datos, "preAsientos", "empresaId", allowed, false);
    }
    if let Some(estado) = val.get_mut("estado") {
        filter_estado_by_companies(estado, allowed);
    }
}

async fn auth_login(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<LoginRequest>,
) -> Result<Json<LoginResponse>, ApiError> {
    let (ip_key, email_key) = auth::login_rate_keys(&headers, &req.email);
    state.login_limiter.check(&ip_key, &email_key)?;
    let user = match state.store.authenticate(&req.email, &req.password).await {
        Ok(u) => {
            state.login_limiter.clear(&ip_key, &email_key);
            u
        }
        Err(e) => {
            state.login_limiter.record_failure(&ip_key, &email_key);
            return Err(e);
        }
    };
    let token = auth::issue_token(&user)?;
    Ok(Json(LoginResponse { token, user }))
}

async fn auth_me(headers: HeaderMap) -> Result<Json<Value>, ApiError> {
    let ctx = auth::extract_auth(&headers, true)?;
    Ok(Json(json!({ "user": ctx.user })))
}

async fn auth_change_password(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<ChangePasswordRequest>,
) -> Result<Json<Value>, ApiError> {
    let ctx = auth::extract_auth(&headers, true)?;
    state
        .store
        .change_password(&ctx.user.id, &req.current_password, &req.new_password)
        .await?;
    Ok(Json(json!({ "ok": true })))
}

async fn auth_create_user(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(mut req): Json<CreateUserRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let ctx = auth::extract_auth(&headers, state.auth_required)?;
    if req.rol == Role::SuperAdmin {
        return Err(ApiError::Forbidden(
            "No se pueden crear cuentas SUPER_ADMIN desde la API.".into(),
        ));
    }
    if req.rol == Role::Contador {
        ctx.require_super_admin()?;
    }

    let required_roles: &[Role] = &[Role::Contador, Role::Administrador];
    ctx.require_any_role(required_roles)?;

    let requested: Vec<String> = req
        .company_ids
        .as_deref()
        .unwrap_or(&[])
        .iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    let scoped_companies = if ctx.is_super_admin() {
        if requested.is_empty() {
            None
        } else {
            Some(requested)
        }
    } else if requested.is_empty() {
        let managed = ctx.managed_company_ids(required_roles);
        if managed.is_empty() {
            return Err(ApiError::Forbidden(
                "No tienes copropiedades autorizadas para crear este tipo de usuario.".into(),
            ));
        }
        Some(managed)
    } else {
        for cid in &requested {
            ctx.require_company_roles(cid, required_roles)?;
        }
        Some(requested)
    };
    req.company_ids = scoped_companies;

    let user = state.store.create_user(req, Some(&ctx.user.id)).await?;
    Ok((StatusCode::CREATED, Json(json!({ "user": user }))))
}

async fn create_company(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<CreateCompanyRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let ctx = auth::extract_auth(&headers, state.auth_required)?;
    ctx.require_any_role(&[Role::Contador])?;
    let res = state
        .store
        .create_company(&ctx.user.id, ctx.is_super_admin(), req, &ctx.actor_label())
        .await?;
    Ok((StatusCode::CREATED, Json(json!(res))))
}

async fn admin_overview(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let ctx = auth::extract_auth(&headers, true)?;
    ctx.require_super_admin()?;
    let overview = state.store.admin_overview().await?;
    Ok(Json(json!(overview)))
}

async fn admin_create_contador(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<CreateContadorRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let ctx = auth::extract_auth(&headers, true)?;
    ctx.require_super_admin()?;
    let user = state.store.create_contador(req, &ctx.user.id).await?;
    Ok((StatusCode::CREATED, Json(json!({ "user": user }))))
}

async fn admin_update_user(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(req): Json<UpdateAdminUserRequest>,
) -> Result<Json<Value>, ApiError> {
    let ctx = auth::extract_auth(&headers, true)?;
    ctx.require_super_admin()?;
    let updated = state.store.admin_update_user(&id, req).await?;
    Ok(Json(json!({ "contador": updated })))
}

async fn bootstrap(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let ctx = auth::extract_auth(&headers, state.auth_required)?;
    let mut bundle = state.store.bootstrap().await?;
    if !ctx.is_super_admin() {
        let allowed = ctx.allowed_company_ids();
        filter_bootstrap_by_companies(&mut bundle, &allowed);
    }
    Ok(Json(bundle))
}

async fn get_state(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let ctx = auth::extract_auth(&headers, state.auth_required)?;
    let mut payload = state.store.get_state().await?;
    if !ctx.is_super_admin() {
        let allowed = ctx.allowed_company_ids();
        filter_estado_by_companies(&mut payload, &allowed);
    }
    Ok(Json(payload))
}

async fn put_state(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    if !state.seed_demo {
        return Err(ApiError::Forbidden(
            "PUT /api/v1/state está deshabilitado en producción (SEED_DEMO=false).".into(),
        ));
    }
    let ctx = auth::extract_auth(&headers, state.auth_required)?;
    for cid in state.store.all_company_ids().await? {
        ctx.require_company_roles(&cid, &[Role::Contador])?;
    }
    Ok(Json(state.store.put_state(payload).await?))
}

async fn reset_state(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    if !state.seed_demo {
        return Err(ApiError::Forbidden(
            "El reinicio a datos demo está deshabilitado cuando SEED_DEMO=false.".into(),
        ));
    }
    let ctx = auth::extract_auth(&headers, state.auth_required)?;
    for cid in state.store.all_company_ids().await? {
        ctx.require_company_roles(&cid, &[Role::Contador])?;
    }
    Ok(Json(state.store.reset().await?))
}

async fn puc_catalog(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(q): Query<CompanyQuery>,
) -> Result<Json<Vec<LedgerAccount>>, ApiError> {
    let ctx = auth::extract_auth(&headers, state.auth_required)?;
    if let Some(cid) = q.company_id.as_deref().filter(|s| !s.trim().is_empty()) {
        ctx.require_company_access(cid)?;
    }
    Ok(Json(state.store.list_puc(q.company_id.as_deref()).await?))
}

async fn validate_entry(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(draft): Json<EntryDraft>,
) -> Result<(StatusCode, Json<ValidationResult>), ApiError> {
    let ctx = auth::extract_auth(&headers, state.auth_required)?;
    ctx.require_company_access(&draft.company_id)?;
    let puc = state.store.list_puc(Some(&draft.company_id)).await?;
    let result = ledger::validate_entry(&draft, &puc);
    let status = if result.ok {
        StatusCode::OK
    } else {
        StatusCode::UNPROCESSABLE_ENTITY
    };
    Ok((status, Json(result)))
}

async fn preview_entry(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(draft): Json<EntryDraft>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let ctx = auth::extract_auth(&headers, state.auth_required)?;
    ctx.require_company_access(&draft.company_id)?;
    let puc = state.store.list_puc(Some(&draft.company_id)).await?;
    let result = ledger::validate_entry(&draft, &puc);
    let status = if result.ok {
        StatusCode::OK
    } else {
        StatusCode::UNPROCESSABLE_ENTITY
    };
    Ok((
        status,
        Json(json!({
            "validation": result,
            "hash": if result.ok { Some(ledger::entry_hash(&draft)) } else { None },
            "can_post": result.ok
        })),
    ))
}

async fn carry_forward(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(pre): Json<PreEntryDraft>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let ctx = auth::extract_auth(&headers, state.auth_required)?;
    ctx.require_company_access(&pre.company_id)?;
    let tps = state
        .store
        .list_third_parties(Some(&pre.company_id))
        .await?;
    match ledger::carry_forward(&pre, &tps) {
        Some(out) => Ok((
            StatusCode::OK,
            Json(serde_json::to_value(out).unwrap_or(json!({"applied": true}))),
        )),
        None => Ok((
            StatusCode::OK,
            Json(json!({
                "applied": false,
                "detail": "Sin reglas de retención aplicables para este tercero/documento."
            })),
        )),
    }
}

async fn balance_preview(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<BalanceRequest>,
) -> Result<Json<Value>, ApiError> {
    let ctx = auth::extract_auth(&headers, state.auth_required)?;
    ctx.require_company_access(&req.company_id)?;
    let puc = state.store.list_puc(Some(&req.company_id)).await?;
    Ok(Json(ledger::trial_balance_preview(&req, &puc)))
}

async fn create_pre_entry(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<CreatePreEntryRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let ctx = auth::extract_auth(&headers, state.auth_required)?;
    ctx.require_company_roles(&req.company_id, &[Role::Contador, Role::Administrador])?;
    let out = state
        .store
        .create_pre_entry(req, &ctx.actor_label())
        .await?;
    Ok((
        StatusCode::CREATED,
        Json(serde_json::to_value(out).unwrap_or_else(|_| json!({}))),
    ))
}

async fn update_pre_entry_lines(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(req): Json<UpdatePreEntryLinesRequest>,
) -> Result<Json<Value>, ApiError> {
    let ctx = auth::extract_auth(&headers, state.auth_required)?;
    let company_id = state
        .store
        .pre_entry_company_id(&id)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("Pre-asiento '{id}' no encontrado.")))?;
    ctx.require_company_roles(&company_id, &[Role::Contador])?;
    let updated = state.store.update_pre_entry_lines(&id, req.lineas).await?;
    Ok(Json(serde_json::to_value(updated).unwrap_or_else(|_| json!({}))))
}

async fn approve_pre_entry(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let ctx = auth::extract_auth(&headers, state.auth_required)?;
    let company_id = state
        .store
        .pre_entry_company_id(&id)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("Pre-asiento '{id}' no encontrado.")))?;
    ctx.require_company_roles(&company_id, &[Role::Contador])?;
    let out = state
        .store
        .approve_pre_entry(&id, &ctx.actor_label())
        .await?;
    Ok(Json(serde_json::to_value(out).unwrap_or_else(|_| json!({}))))
}

async fn reject_pre_entry(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let ctx = auth::extract_auth(&headers, state.auth_required)?;
    let company_id = state
        .store
        .pre_entry_company_id(&id)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("Pre-asiento '{id}' no encontrado.")))?;
    ctx.require_company_roles(&company_id, &[Role::Contador])?;
    let ev = state
        .store
        .reject_pre_entry(&id, &ctx.actor_label())
        .await?;
    Ok(Json(json!({ "ok": true, "auditoria": ev })))
}

async fn create_entry(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<CreateEntryRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let ctx = auth::extract_auth(&headers, state.auth_required)?;
    ctx.require_company_roles(&req.company_id, &[Role::Contador])?;
    let out = state
        .store
        .create_entry(req, &ctx.actor_label())
        .await?;
    Ok((
        StatusCode::CREATED,
        Json(serde_json::to_value(out).unwrap_or_else(|_| json!({}))),
    ))
}

async fn void_entry(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: Option<Json<VoidEntryRequest>>,
) -> Result<Json<Value>, ApiError> {
    let ctx = auth::extract_auth(&headers, state.auth_required)?;
    let company_id = state
        .store
        .entry_company_id(&id)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("Comprobante '{id}' no encontrado.")))?;
    ctx.require_company_roles(&company_id, &[Role::Contador])?;
    let reason = body.and_then(|b| b.0.reason);
    let out = state
        .store
        .void_entry(&id, reason, &ctx.actor_label())
        .await?;
    Ok(Json(serde_json::to_value(out).unwrap_or_else(|_| json!({}))))
}

async fn list_company_entries(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(company_id): Path<String>,
    Query(q): Query<PeriodQuery>,
) -> Result<Json<Value>, ApiError> {
    let ctx = auth::extract_auth(&headers, state.auth_required)?;
    ctx.require_company_roles(
        &company_id,
        &[Role::Contador, Role::Administrador, Role::RevisorFiscal, Role::Consejo],
    )?;
    let entries = state
        .store
        .list_entries(&company_id, q.period.as_deref())
        .await?;
    Ok(Json(serde_json::to_value(entries).unwrap_or_else(|_| json!([]))))
}

async fn close_company_period(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((company_id, period)): Path<(String, String)>,
    body: Option<Json<ClosePeriodRequest>>,
) -> Result<Json<Value>, ApiError> {
    let ctx = auth::extract_auth(&headers, state.auth_required)?;
    ctx.require_company_roles(&company_id, &[Role::Contador])?;
    let req = body.map(|b| b.0).unwrap_or_default();
    let out = state
        .store
        .close_period(&company_id, &period, req, &ctx.actor_label())
        .await?;
    Ok(Json(serde_json::to_value(out).unwrap_or_else(|_| json!({}))))
}

async fn company_trial_balance(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(company_id): Path<String>,
    Query(q): Query<PeriodQuery>,
) -> Result<Json<Value>, ApiError> {
    let ctx = auth::extract_auth(&headers, state.auth_required)?;
    ctx.require_company_roles(
        &company_id,
        &[Role::Contador, Role::Administrador, Role::RevisorFiscal, Role::Consejo],
    )?;
    let period = q.period.unwrap_or_else(|| "todos".into());
    let report = state.store.trial_balance(&company_id, &period).await?;
    Ok(Json(report))
}

async fn company_audit(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(company_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let ctx = auth::extract_auth(&headers, state.auth_required)?;
    ctx.require_company_roles(
        &company_id,
        &[Role::Contador, Role::Administrador, Role::RevisorFiscal, Role::Consejo],
    )?;
    let events = state.store.list_audit(&company_id).await?;
    Ok(Json(serde_json::to_value(events).unwrap_or_else(|_| json!([]))))
}

async fn bill_company_period(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((company_id, period)): Path<(String, String)>,
    body: Option<Json<BillPeriodRequest>>,
) -> Result<Json<Value>, ApiError> {
    let ctx = auth::extract_auth(&headers, state.auth_required)?;
    ctx.require_company_roles(&company_id, &[Role::Contador, Role::Administrador])?;
    let req = body.map(|b| b.0).unwrap_or_default();
    let out = state
        .store
        .bill_period(&company_id, &period, req, &ctx.actor_label())
        .await?;
    Ok(Json(serde_json::to_value(out).unwrap_or_else(|_| json!({}))))
}

async fn open_next_company_period(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(company_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let ctx = auth::extract_auth(&headers, state.auth_required)?;
    ctx.require_company_roles(&company_id, &[Role::Contador])?;
    let out = state
        .store
        .open_next_period(&company_id, &ctx.actor_label())
        .await?;
    Ok(Json(serde_json::to_value(out).unwrap_or_else(|_| json!({}))))
}

async fn create_unit(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(company_id): Path<String>,
    Json(req): Json<UpsertUnitRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let ctx = auth::extract_auth(&headers, state.auth_required)?;
    ctx.require_company_roles(&company_id, &[Role::Contador, Role::Administrador])?;
    let unit = state
        .store
        .create_unit(&company_id, req, &ctx.actor_label())
        .await?;
    Ok((
        StatusCode::CREATED,
        Json(serde_json::to_value(unit).unwrap_or_else(|_| json!({}))),
    ))
}

async fn update_unit(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((company_id, unit_id)): Path<(String, String)>,
    Json(req): Json<UpsertUnitRequest>,
) -> Result<Json<Value>, ApiError> {
    let ctx = auth::extract_auth(&headers, state.auth_required)?;
    ctx.require_company_roles(&company_id, &[Role::Contador, Role::Administrador])?;
    let unit = state
        .store
        .update_unit(&company_id, &unit_id, req, &ctx.actor_label())
        .await?;
    Ok(Json(serde_json::to_value(unit).unwrap_or_else(|_| json!({}))))
}

async fn create_third_party(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(company_id): Path<String>,
    Json(req): Json<UpsertThirdPartyRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let ctx = auth::extract_auth(&headers, state.auth_required)?;
    ctx.require_company_roles(&company_id, &[Role::Contador, Role::Administrador])?;
    let tp = state
        .store
        .create_third_party(&company_id, req, &ctx.actor_label())
        .await?;
    Ok((
        StatusCode::CREATED,
        Json(serde_json::to_value(tp).unwrap_or_else(|_| json!({}))),
    ))
}

async fn update_third_party(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((company_id, tp_id)): Path<(String, String)>,
    Json(req): Json<UpsertThirdPartyRequest>,
) -> Result<Json<Value>, ApiError> {
    let ctx = auth::extract_auth(&headers, state.auth_required)?;
    ctx.require_company_roles(&company_id, &[Role::Contador, Role::Administrador])?;
    let tp = state
        .store
        .update_third_party(&company_id, &tp_id, req, &ctx.actor_label())
        .await?;
    Ok(Json(serde_json::to_value(tp).unwrap_or_else(|_| json!({}))))
}

async fn copy_third_parties(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(company_id): Path<String>,
    Json(req): Json<CopyThirdPartiesRequest>,
) -> Result<Json<Value>, ApiError> {
    let ctx = auth::extract_auth(&headers, state.auth_required)?;
    ctx.require_company_roles(&company_id, &[Role::Contador, Role::Administrador])?;
    ctx.require_company_access(&req.source_company_id)?;
    let res = state
        .store
        .copy_third_parties(&company_id, req, &ctx.actor_label())
        .await?;
    Ok(Json(serde_json::to_value(res).unwrap_or_else(|_| json!({}))))
}

async fn create_puc_account(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(company_id): Path<String>,
    Json(req): Json<CreatePucAccountRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let ctx = auth::extract_auth(&headers, state.auth_required)?;
    ctx.require_company_roles(&company_id, &[Role::Contador])?;
    let acc = state
        .store
        .create_puc_account(&company_id, req, &ctx.actor_label())
        .await?;
    Ok((
        StatusCode::CREATED,
        Json(serde_json::to_value(acc).unwrap_or_else(|_| json!({}))),
    ))
}

async fn update_rubro_budget(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((company_id, rubro_id)): Path<(String, String)>,
    Json(req): Json<UpdateRubroBudgetRequest>,
) -> Result<Json<Value>, ApiError> {
    let ctx = auth::extract_auth(&headers, state.auth_required)?;
    ctx.require_company_roles(&company_id, &[Role::Contador, Role::Administrador])?;
    let rubro = state
        .store
        .update_rubro_budget(&company_id, &rubro_id, req.presupuesto_anual, &ctx.actor_label())
        .await?;
    Ok(Json(serde_json::to_value(rubro).unwrap_or_else(|_| json!({}))))
}

async fn update_company_settings(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(company_id): Path<String>,
    Json(req): Json<UpdateCompanySettingsRequest>,
) -> Result<Json<Value>, ApiError> {
    let ctx = auth::extract_auth(&headers, state.auth_required)?;
    ctx.require_company_roles(&company_id, &[Role::Contador, Role::Administrador])?;
    let company = state
        .store
        .update_company_settings(&company_id, req, &ctx.actor_label())
        .await?;
    Ok(Json(serde_json::to_value(company).unwrap_or_else(|_| json!({}))))
}

async fn company_portal_links(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(company_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let ctx = auth::extract_auth(&headers, state.auth_required)?;
    ctx.require_company_roles(&company_id, &[Role::Contador, Role::Administrador])?;
    let links = state.store.list_portal_links(&company_id).await?;
    Ok(Json(json!({ "links": links })))
}

async fn portal_company_info(
    State(state): State<Arc<AppState>>,
    Path(slug): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let info = state.store.portal_company_info(&slug).await?;
    Ok(Json(serde_json::to_value(info).unwrap_or_else(|_| json!({}))))
}

async fn verify_turnstile_if_configured(token_opt: Option<&str>) -> Result<(), ApiError> {
    let secret = std::env::var("TURNSTILE_SECRET_KEY")
        .unwrap_or_default()
        .trim()
        .to_string();
    if secret.is_empty() {
        return Ok(());
    }
    let token = token_opt.map(str::trim).unwrap_or("");
    if token.is_empty() {
        return Err(ApiError::Unauthorized(
            "Completa la verificación de seguridad e intenta nuevamente.".into(),
        ));
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|_| ApiError::Internal("No fue posible inicializar el cliente HTTP.".into()))?;
    let res = client
        .post("https://challenges.cloudflare.com/turnstile/v0/siteverify")
        .form(&[("secret", secret.as_str()), ("response", token)])
        .send()
        .await
        .map_err(|_| ApiError::Unauthorized("No se pudo validar Turnstile; intenta nuevamente.".into()))?;
    let body: Value = res
        .json()
        .await
        .map_err(|_| ApiError::Unauthorized("Respuesta inválida al validar Turnstile.".into()))?;
    if body.get("success").and_then(|v| v.as_bool()) == Some(true) {
        return Ok(());
    }
    Err(ApiError::Unauthorized(
        "Completa la verificación de seguridad e intenta nuevamente.".into(),
    ))
}

async fn portal_lookup(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<PortalLookupRequest>,
) -> Result<Json<Value>, ApiError> {
    let doc_digits = repo::extract_digits(&req.documento);
    let (ip_key, doc_key) = auth::portal_rate_keys(&headers, &req.company_slug, &doc_digits);
    state.login_limiter.check(&ip_key, &doc_key)?;

    if let Err(e) = verify_turnstile_if_configured(req.turnstile_token.as_deref()).await {
        state.login_limiter.record_failure(&ip_key, &doc_key);
        return Err(e);
    }

    match state.store.portal_lookup(req).await {
        Ok(res) => {
            state.login_limiter.clear(&ip_key, &doc_key);
            Ok(Json(serde_json::to_value(res).unwrap_or_else(|_| json!({}))))
        }
        Err(e) => {
            state.login_limiter.record_failure(&ip_key, &doc_key);
            Err(e)
        }
    }
}

async fn portal_unit_statement(
    State(state): State<Arc<AppState>>,
    Path(token): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let stmt = state.store.portal_statement(&token).await?;
    Ok(Json(serde_json::to_value(stmt).unwrap_or_else(|_| json!({}))))
}

async fn portal_unit_checkout(
    State(state): State<Arc<AppState>>,
    Path(token): Path<String>,
    Json(req): Json<PortalCheckoutRequest>,
) -> Result<Json<Value>, ApiError> {
    let checkout = state.store.portal_create_checkout(&token, req).await?;
    Ok(Json(serde_json::to_value(checkout).unwrap_or_else(|_| json!({}))))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SimulatePaymentRequest {
    referencia: String,
    #[serde(default, alias = "monto_en_centavos")]
    monto_en_centavos: i64,
}

async fn portal_simulate_payment(
    State(state): State<Arc<AppState>>,
    Path(token): Path<String>,
    Json(req): Json<SimulatePaymentRequest>,
) -> Result<Json<Value>, ApiError> {
    let payload = auth::verify_portal_token(&token)?;
    let prefix = format!("VTK-{}-", payload.company_id.to_uppercase());
    if !req.referencia.trim().to_uppercase().starts_with(&prefix) {
        return Err(ApiError::Forbidden(
            "La referencia no pertenece a esta copropiedad.".into(),
        ));
    }
    let res = state
        .store
        .apply_approved_payment(
            &req.referencia,
            &format!("SIM-{}", uuid::Uuid::new_v4().simple()),
            req.monto_en_centavos,
            None,
            true,
        )
        .await?;
    Ok(Json(res))
}

async fn wompi_webhook(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let event = body
        .get("event")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if event != "transaction.updated" {
        return Ok(Json(json!({ "ok": true, "ignored": event })));
    }
    let data = body.get("data").cloned().unwrap_or(Value::Null);
    let (status, reference, tx_id, amount_in_cents) = {
        let tx_obj = data
            .get("transaction")
            .ok_or_else(|| ApiError::BadRequest("Payload Wompi sin data.transaction.".into()))?;
        (
            tx_obj
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            tx_obj
                .get("reference")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            tx_obj
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            tx_obj
                .get("amount_in_cents")
                .and_then(|v| v.as_i64())
                .unwrap_or(0),
        )
    };

    if status != "APPROVED" {
        return Ok(Json(json!({ "ok": true, "status": status, "referencia": reference })));
    }

    let props: Vec<String> = body
        .get("signature")
        .and_then(|s| s.get("properties"))
        .and_then(|p| p.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    let checksum = headers
        .get("x-event-checksum")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string)
        .or_else(|| {
            body.get("signature")
                .and_then(|s| s.get("checksum"))
                .and_then(|c| c.as_str())
                .map(str::to_string)
        })
        .unwrap_or_default();
    let timestamp = body
        .get("timestamp")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);

    let res = state
        .store
        .apply_approved_payment(
            &reference,
            &tx_id,
            amount_in_cents,
            Some((props, timestamp, checksum, data)),
            false,
        )
        .await?;
    Ok(Json(res))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    fn app() -> Router {
        build_router(Arc::new(AppState::demo_for_tests()))
    }

    async fn json_body(res: axum::response::Response) -> Value {
        let bytes = res.into_body().collect().await.expect("body").to_bytes();
        serde_json::from_slice(&bytes).expect("json")
    }

    async fn login_as(router: &Router, email: &str) -> String {
        let res = router
            .clone()
            .oneshot(
                Request::post("/api/v1/auth/login")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({ "email": email, "password": auth::DEMO_PASSWORD }).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let body = json_body(res).await;
        body["token"].as_str().unwrap().to_string()
    }

    async fn exercise_relational_http_lifecycle(router: Router) {
        // 1. Bootstrap check
        let boot_res = router
            .clone()
            .oneshot(Request::get("/api/v1/bootstrap").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(boot_res.status(), StatusCode::OK);
        let boot = json_body(boot_res).await;
        assert_eq!(boot["datos"]["companies"].as_array().unwrap().len(), 3);
        assert_eq!(boot["datos"]["units"].as_array().unwrap().len(), 54);
        assert_eq!(boot["estado"]["comprobantes"].as_array().unwrap().len(), 105);
        let pre_id = boot["estado"]["preAsientos"][0]["id"]
            .as_str()
            .unwrap()
            .to_string();

        // 2. Update pre-entry lines and approve
        let update_payload = json!({
            "lineas": [
                { "id": "u1", "cuenta": "513505", "descripcion": "Vigilancia editada", "debito": 1000000, "credito": 0 },
                { "id": "u2", "cuenta": "220505", "descripcion": "CxP editada", "debito": 0, "credito": 1000000 }
            ]
        });
        let put_res = router
            .clone()
            .oneshot(
                Request::put(format!("/api/v1/pre-entries/{pre_id}/lines"))
                    .header("content-type", "application/json")
                    .body(Body::from(update_payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(put_res.status(), StatusCode::OK);
        let updated_pre = json_body(put_res).await;
        assert_eq!(updated_pre["lineas"][0]["descripcion"], "Vigilancia editada");

        let app_res = router
            .clone()
            .oneshot(
                Request::post(format!("/api/v1/pre-entries/{pre_id}/approve"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(app_res.status(), StatusCode::OK);
        let approved = json_body(app_res).await;
        assert_eq!(approved["comprobante"]["estado"], "ASENTADO");
        assert_eq!(approved["comprobante"]["hash"].as_str().unwrap().len(), 64);

        let dup_res = router
            .clone()
            .oneshot(
                Request::post(format!("/api/v1/pre-entries/{pre_id}/approve"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(dup_res.status(), StatusCode::CONFLICT);

        // 3. Reject another pre-entry
        let pre_reject_id = boot["estado"]["preAsientos"][1]["id"]
            .as_str()
            .unwrap()
            .to_string();
        let rej_res = router
            .clone()
            .oneshot(
                Request::post(format!("/api/v1/pre-entries/{pre_reject_id}/reject"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(rej_res.status(), StatusCode::OK);

        // 3b. Submit a new draft pre-entry (201 PENDIENTE) and reject unbalanced (422)
        let draft_tp = boot["datos"]["terceros"]
            .as_array()
            .unwrap()
            .iter()
            .find(|t| t["empresaId"].is_null() || t["empresaId"] == "altavista")
            .expect("altavista or global third party in bootstrap")["id"]
            .as_str()
            .unwrap()
            .to_string();
        let draft_ok = json!({
            "companyId": "altavista",
            "period": "2026-11",
            "entryType": "CC",
            "date": "2026-11-18",
            "agent": "AGENTE_IA_EVE",
            "terceroId": draft_tp,
            "description": "Pre-asiento radicado por agente Eve",
            "lines": [
                { "cuenta": "519510", "descripcion": "Insumos", "debito": 120000, "credito": 0 },
                { "cuenta": "220505", "descripcion": "Por pagar", "debito": 0, "credito": 120000 }
            ],
            "notes": ["Borrador generado desde agente Eve"]
        });
        let draft_res = router
            .clone()
            .oneshot(
                Request::post("/api/v1/pre-entries")
                    .header("content-type", "application/json")
                    .body(Body::from(draft_ok.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(draft_res.status(), StatusCode::CREATED);
        let draft_body = json_body(draft_res).await;
        assert_eq!(draft_body["preAsiento"]["estado"], "PENDIENTE");

        let draft_bad = json!({
            "companyId": "altavista",
            "period": "2026-11",
            "entryType": "CC",
            "date": "2026-11-18",
            "terceroId": draft_tp,
            "description": "Pre-asiento descuadrado",
            "lines": [
                { "cuenta": "519510", "descripcion": "Insumos", "debito": 120000, "credito": 0 },
                { "cuenta": "220505", "descripcion": "Por pagar", "debito": 0, "credito": 80000 }
            ]
        });
        let draft_bad_res = router
            .clone()
            .oneshot(
                Request::post("/api/v1/pre-entries")
                    .header("content-type", "application/json")
                    .body(Body::from(draft_bad.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(draft_bad_res.status(), StatusCode::UNPROCESSABLE_ENTITY);

        // 4. Create manual entry (valid, unbalanced -> 422, closed period -> 409)
        let manual = json!({
            "companyId": "altavista",
            "period": "2026-11",
            "entryType": "CC",
            "date": "2026-11-18",
            "description": "Gasto manual de papelería",
            "lines": [
                { "cuenta": "519510", "descripcion": "Papelería", "debito": 250000, "credito": 0 },
                { "cuenta": "220505", "descripcion": "Proveedor", "debito": 0, "credito": 250000 }
            ]
        });
        let post_res = router
            .clone()
            .oneshot(
                Request::post("/api/v1/entries")
                    .header("content-type", "application/json")
                    .body(Body::from(manual.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(post_res.status(), StatusCode::CREATED);
        let created = json_body(post_res).await;
        let created_id = created["comprobante"]["id"].as_str().unwrap().to_string();
        assert_eq!(created["comprobante"]["hash"].as_str().unwrap().len(), 64);

        let closed_manual = json!({
            "companyId": "altavista",
            "period": "2026-10",
            "entryType": "CC",
            "date": "2026-10-18",
            "description": "En periodo cerrado",
            "lines": [
                { "cuenta": "519510", "descripcion": "Papelería", "debito": 100000, "credito": 0 },
                { "cuenta": "220505", "descripcion": "Proveedor", "debito": 0, "credito": 100000 }
            ]
        });
        let closed_res = router
            .clone()
            .oneshot(
                Request::post("/api/v1/entries")
                    .header("content-type", "application/json")
                    .body(Body::from(closed_manual.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(closed_res.status(), StatusCode::CONFLICT);

        let unbalanced_manual = json!({
            "companyId": "altavista",
            "period": "2026-11",
            "entryType": "CC",
            "date": "2026-11-18",
            "description": "Descuadrado",
            "lines": [
                { "cuenta": "519510", "descripcion": "Papelería", "debito": 100000, "credito": 0 },
                { "cuenta": "220505", "descripcion": "Proveedor", "debito": 0, "credito": 50000 }
            ]
        });
        let unbal_res = router
            .clone()
            .oneshot(
                Request::post("/api/v1/entries")
                    .header("content-type", "application/json")
                    .body(Body::from(unbalanced_manual.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(unbal_res.status(), StatusCode::UNPROCESSABLE_ENTITY);

        // 5. Void created entry -> original ANULADO + reversal NC + double void 409
        let void_res = router
            .clone()
            .oneshot(
                Request::post(format!("/api/v1/entries/{created_id}/void"))
                    .header("content-type", "application/json")
                    .body(Body::from(json!({ "reason": "Factura duplicada" }).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(void_res.status(), StatusCode::OK);
        let void_body = json_body(void_res).await;
        assert_eq!(void_body["anulado"]["estado"], "ANULADO");
        assert_eq!(void_body["reverso"]["tipo"], "NC");
        assert_eq!(void_body["reverso"]["estado"], "ASENTADO");

        let void_dup = router
            .clone()
            .oneshot(
                Request::post(format!("/api/v1/entries/{created_id}/void"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(void_dup.status(), StatusCode::CONFLICT);

        // 6. Trial balance report & audit list
        let bal_res = router
            .clone()
            .oneshot(
                Request::get("/api/v1/companies/altavista/reports/balance?period=2026-11")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(bal_res.status(), StatusCode::OK);
        let bal_body = json_body(bal_res).await;
        assert_eq!(bal_body["balanced"], true);

        let aud_res = router
            .clone()
            .oneshot(
                Request::get("/api/v1/companies/altavista/audit")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(aud_res.status(), StatusCode::OK);
        let aud_body = json_body(aud_res).await;
        assert!(!aud_body.as_array().unwrap().is_empty());

        // 7. open-next before closing 2026-11 returns 409; close 2026-11 then open 2026-12 and bill
        let open_early = router
            .clone()
            .oneshot(
                Request::post("/api/v1/companies/altavista/periods/open-next")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(open_early.status(), StatusCode::CONFLICT);

        let close_res = router
            .clone()
            .oneshot(
                Request::post("/api/v1/companies/altavista/periods/2026-11/close")
                    .header("content-type", "application/json")
                    .body(Body::from(json!({ "depreciacion": true, "provision": true, "traslado": true }).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(close_res.status(), StatusCode::OK);
        let close_body = json_body(close_res).await;
        assert_eq!(close_body["periodoCerrado"], "2026-11");
        assert_eq!(close_body["comprobante"]["tipo"], "NC");

        let post_after_close = router
            .clone()
            .oneshot(
                Request::post("/api/v1/entries")
                    .header("content-type", "application/json")
                    .body(Body::from(manual.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(post_after_close.status(), StatusCode::CONFLICT);

        let open_res = router
            .clone()
            .oneshot(
                Request::post("/api/v1/companies/altavista/periods/open-next")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(open_res.status(), StatusCode::OK);
        let open_body = json_body(open_res).await;
        assert_eq!(open_body["periodoAnterior"], "2026-11");
        assert_eq!(open_body["periodoNuevo"], "2026-12");

        // 8. Mass billing on 2026-12 + duplicate 409
        let bill_res = router
            .clone()
            .oneshot(
                Request::post("/api/v1/companies/altavista/periods/2026-12/bill")
                    .header("content-type", "application/json")
                    .body(Body::from(json!({ "incluirMora": true }).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(bill_res.status(), StatusCode::OK);
        let bill_body = json_body(bill_res).await;
        assert_eq!(bill_body["comprobante"]["tipo"], "CC");
        assert_eq!(bill_body["unidadesFacturadas"], 24);

        let bill_dup = router
            .clone()
            .oneshot(
                Request::post("/api/v1/companies/altavista/periods/2026-12/bill")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(bill_dup.status(), StatusCode::CONFLICT);

        // 9. CRUD: Unit, Third-party, PUC, Rubro budget, Company settings
        let alt_unit = boot["datos"]["units"]
            .as_array()
            .unwrap()
            .iter()
            .find(|u| u["empresaId"] == "altavista")
            .expect("altavista unit in bootstrap");
        let unit_id = alt_unit["id"].as_str().unwrap().to_string();
        let prop_id = alt_unit["propietarioId"].as_str().unwrap().to_string();
        let unit_torre = alt_unit["torre"].as_str().unwrap().to_string();
        let unit_numero = alt_unit["numero"].as_str().unwrap().to_string();

        let new_unit = json!({
            "torre": "Torre C",
            "numero": "901",
            "tipo": "APARTAMENTO",
            "area": 105,
            "coeficiente": 1.25,
            "matricula": "50N-999999",
            "propietarioId": prop_id,
            "carteraCongelada": false
        });
        let u_res = router
            .clone()
            .oneshot(
                Request::post("/api/v1/companies/altavista/units")
                    .header("content-type", "application/json")
                    .body(Body::from(new_unit.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(u_res.status(), StatusCode::CREATED);

        let upd_unit = json!({
            "torre": unit_torre,
            "numero": unit_numero,
            "tipo": "APARTAMENTO",
            "area": 99,
            "coeficiente": 3.526897,
            "matricula": "50N-100000",
            "propietarioId": prop_id,
            "carteraCongelada": true
        });
        let uu_res = router
            .clone()
            .oneshot(
                Request::put(format!("/api/v1/companies/altavista/units/{unit_id}"))
                    .header("content-type", "application/json")
                    .body(Body::from(upd_unit.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(uu_res.status(), StatusCode::OK);
        assert_eq!(json_body(uu_res).await["carteraCongelada"], true);

        let tp_res = router
            .clone()
            .oneshot(
                Request::post("/api/v1/companies/altavista/third-parties")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "nombre": "Plomería Exprés S.A.S.",
                            "tipo": "PROVEEDOR",
                            "documento": "901.777.888",
                            "dv": "1",
                            "email": "pagos@plomeria.co",
                            "telefono": "6015550000",
                            "ciudad": "Bogotá D.C.",
                            "retefuentePct": 4,
                            "reteicaPct": 0.966,
                            "reteivaPct": 0
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(tp_res.status(), StatusCode::CREATED);
        let tp_id = json_body(tp_res).await["id"].as_str().unwrap().to_string();

        let tp_upd = router
            .clone()
            .oneshot(
                Request::put(format!("/api/v1/companies/altavista/third-parties/{tp_id}"))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "nombre": "Plomería Exprés Ltda.",
                            "tipo": "PROVEEDOR",
                            "documento": "901.777.888",
                            "dv": "1",
                            "retefuentePct": 6,
                            "reteicaPct": 0.966,
                            "reteivaPct": 0
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(tp_upd.status(), StatusCode::OK);
        assert_eq!(json_body(tp_upd).await["retefuentePct"].as_f64(), Some(6.0));

        let puc_res = router
            .clone()
            .oneshot(
                Request::post("/api/v1/companies/altavista/puc")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "codigo": "519545",
                            "nombre": "Taxis y buses",
                            "tipo": "GASTO",
                            "naturaleza": "D",
                            "rubroKey": "ADM"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(puc_res.status(), StatusCode::CREATED);

        let puc_dup = router
            .clone()
            .oneshot(
                Request::post("/api/v1/companies/altavista/puc")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "codigo": "519545",
                            "nombre": "Duplicada",
                            "tipo": "GASTO",
                            "naturaleza": "D"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(puc_dup.status(), StatusCode::CONFLICT);

        let rubro_id = boot["datos"]["rubros"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["empresaId"] == "altavista")
            .expect("altavista rubro in bootstrap")["id"]
            .as_str()
            .unwrap()
            .to_string();
        let rub_res = router
            .clone()
            .oneshot(
                Request::put(format!("/api/v1/companies/altavista/rubros/{rubro_id}"))
                    .header("content-type", "application/json")
                    .body(Body::from(json!({ "presupuestoAnual": 160000000 }).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(rub_res.status(), StatusCode::OK);
        assert_eq!(
            json_body(rub_res).await["presupuestoAnual"].as_f64(),
            Some(160_000_000.0)
        );

        let set_res = router
            .clone()
            .oneshot(
                Request::patch("/api/v1/companies/altavista/settings")
                    .header("content-type", "application/json")
                    .body(Body::from(json!({ "tasaMoraMensual": 1.8 }).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(set_res.status(), StatusCode::OK);
        assert_eq!(json_body(set_res).await["tasaMoraMensual"].as_f64(), Some(1.8));

        // 10. Reset back to seed
        let reset_res = router
            .oneshot(Request::post("/api/v1/reset").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(reset_res.status(), StatusCode::OK);
    }

    async fn exercise_auth_and_rbac(router: &Router, auth_required: bool) {
        if auth_required {
            let unauth = router
                .clone()
                .oneshot(Request::get("/api/v1/bootstrap").body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(unauth.status(), StatusCode::UNAUTHORIZED);
        }

        let no_me = router
            .clone()
            .oneshot(Request::get("/api/v1/auth/me").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(no_me.status(), StatusCode::UNAUTHORIZED);

        let tok_contador = login_as(router, "contador@vertika.co").await;
        let tok_admin = login_as(router, "admin@vertika.co").await;
        let tok_revisor = login_as(router, "revisor@vertika.co").await;

        let me_res = router
            .clone()
            .oneshot(
                Request::get("/api/v1/auth/me")
                    .header("authorization", format!("Bearer {tok_contador}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(me_res.status(), StatusCode::OK);
        assert_eq!(json_body(me_res).await["user"]["rol"], "CONTADOR");

        // Revisor Fiscal is read-only -> 403 on entries and CRUD
        let rev_entry = router
            .clone()
            .oneshot(
                Request::post("/api/v1/entries")
                    .header("authorization", format!("Bearer {tok_revisor}"))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "companyId": "altavista",
                            "period": "2026-11",
                            "entryType": "CC",
                            "date": "2026-11-18",
                            "description": "Bloqueado",
                            "lines": [
                                { "cuenta": "519510", "descripcion": "A", "debito": 1000, "credito": 0 },
                                { "cuenta": "220505", "descripcion": "B", "debito": 0, "credito": 1000 }
                            ]
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(rev_entry.status(), StatusCode::FORBIDDEN);

        // Administrador cannot post accounting entries or close periods -> 403
        let adm_close = router
            .clone()
            .oneshot(
                Request::post("/api/v1/companies/altavista/periods/2026-11/close")
                    .header("authorization", format!("Bearer {tok_admin}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(adm_close.status(), StatusCode::FORBIDDEN);

        // Administrador CAN update company settings -> 200
        let adm_set = router
            .clone()
            .oneshot(
                Request::patch("/api/v1/companies/altavista/settings")
                    .header("authorization", format!("Bearer {tok_admin}"))
                    .header("content-type", "application/json")
                    .body(Body::from(json!({ "llaveBreB": "+57 300 000 9999" }).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(adm_set.status(), StatusCode::OK);

        // Reset as Contador
        let rst = router
            .clone()
            .oneshot(
                Request::post("/api/v1/reset")
                    .header("authorization", format!("Bearer {tok_contador}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(rst.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn health_returns_ok_and_demo_memory() {
        let res = app()
            .oneshot(Request::get("/health").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let body = json_body(res).await;
        assert_eq!(body["status"], "ok");
        assert_eq!(body["mode"], "demo-memory");
        assert_eq!(body["postgres_enabled"], false);
    }

    #[tokio::test]
    async fn puc_returns_all_59_accounts() {
        let res = app()
            .oneshot(Request::get("/api/v1/puc").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let body = json_body(res).await;
        assert_eq!(body.as_array().unwrap().len(), 59);
    }

    #[tokio::test]
    async fn validate_and_preview_ledger_entries() {
        let router = app();

        let balanced = json!({
            "company_id": "altavista",
            "period": "2026-11",
            "entry_type": "CC",
            "date": "2026-11-12",
            "description": "Vigilancia",
            "lines": [
                { "account": "513505", "description": "Gasto", "debit": 1000000, "credit": 0 },
                { "account": "220505", "description": "Proveedor", "debit": 0, "credit": 1000000 }
            ]
        });

        let res_ok = router
            .clone()
            .oneshot(
                Request::post("/api/v1/ledger/validate")
                    .header("content-type", "application/json")
                    .body(Body::from(balanced.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res_ok.status(), StatusCode::OK);
        let b_ok = json_body(res_ok).await;
        assert_eq!(b_ok["ok"], true);
        assert_eq!(b_ok["difference"].as_f64(), Some(0.0));

        let res_preview = router
            .clone()
            .oneshot(
                Request::post("/api/v1/ledger/preview")
                    .header("content-type", "application/json")
                    .body(Body::from(balanced.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res_preview.status(), StatusCode::OK);
        let b_prev = json_body(res_preview).await;
        assert_eq!(b_prev["can_post"], true);
        assert_eq!(b_prev["hash"].as_str().unwrap().len(), 64);

        let unbalanced = json!({
            "company_id": "altavista",
            "period": "2026-11",
            "entry_type": "CC",
            "date": "2026-11-12",
            "description": "Descuadrado",
            "lines": [
                { "account": "513505", "description": "Gasto", "debit": 1000000, "credit": 0 },
                { "account": "220505", "description": "Proveedor", "debit": 0, "credit": 900000 }
            ]
        });
        let res_bad = router
            .oneshot(
                Request::post("/api/v1/ledger/validate")
                    .header("content-type", "application/json")
                    .body(Body::from(unbalanced.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res_bad.status(), StatusCode::UNPROCESSABLE_ENTITY);
        let b_bad = json_body(res_bad).await;
        assert_eq!(b_bad["ok"], false);
    }

    #[tokio::test]
    async fn carry_forward_works_for_seed_provider() {
        let payload = json!({
            "company_id": "altavista",
            "third_party_id": "prov-contador",
            "description": "Honorarios contabilidad",
            "lines": [
                { "account": "511005", "description": "Honorarios", "debit": 2000000, "credit": 0 },
                { "account": "220505", "description": "Por pagar", "debit": 0, "credit": 2000000 }
            ]
        });
        let res = app()
            .oneshot(
                Request::post("/api/v1/pre-entries/carry-forward")
                    .header("content-type", "application/json")
                    .body(Body::from(payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let body = json_body(res).await;
        assert_eq!(body["applied"], true);
    }

    #[tokio::test]
    async fn state_persists_in_memory_and_resets() {
        let router = app();

        let custom_state = json!({ "version": 4, "activeCompanyId": "colina", "marker": "saved" });
        let put_res = router
            .clone()
            .oneshot(
                Request::put("/api/v1/state")
                    .header("content-type", "application/json")
                    .body(Body::from(custom_state.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(put_res.status(), StatusCode::OK);

        let get_res = router
            .clone()
            .oneshot(Request::get("/api/v1/state").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(get_res.status(), StatusCode::OK);
        let fetched = json_body(get_res).await;
        assert_eq!(fetched["marker"], "saved");
        assert_eq!(fetched["activeCompanyId"], "colina");

        let reset_res = router
            .clone()
            .oneshot(Request::post("/api/v1/reset").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(reset_res.status(), StatusCode::OK);

        let after_reset = router
            .oneshot(Request::get("/api/v1/state").body(Body::empty()).unwrap())
            .await
            .unwrap();
        let after_body = json_body(after_reset).await;
        assert!(after_body.get("marker").is_none());
        assert_eq!(after_body["activeCompanyId"], "altavista");
    }

    #[tokio::test]
    async fn balance_preview_handles_opening_only_accounts() {
        let payload = json!({
            "company_id": "altavista",
            "period": "2026-11",
            "opening_balances": {
                "111005": 3000000,
                "310505": 3000000
            },
            "entries": [
                {
                    "company_id": "altavista",
                    "period": "2026-11",
                    "entry_type": "CC",
                    "date": "2026-11-12",
                    "description": "Gasto aseo",
                    "lines": [
                        { "account": "513510", "description": "Aseo", "debit": 150000, "credit": 0 },
                        { "account": "220505", "description": "CxP", "debit": 0, "credit": 150000 }
                    ]
                }
            ]
        });
        let res = app()
            .oneshot(
                Request::post("/api/v1/balance")
                    .header("content-type", "application/json")
                    .body(Body::from(payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let body = json_body(res).await;
        assert_eq!(body["balanced"], true);
        let rows = body["rows"].as_array().unwrap();
        assert!(rows.iter().any(|r| r["account"] == "310505"));
    }

    #[tokio::test]
    async fn memory_relational_lifecycle_works() {
        exercise_relational_http_lifecycle(app()).await;
    }

    #[tokio::test]
    async fn auth_and_rbac_work_in_memory() {
        let router_strict = build_router(Arc::new(AppState::demo_for_tests_with_auth(true)));
        exercise_auth_and_rbac(&router_strict, true).await;
    }

    #[tokio::test]
    async fn user_management_and_seed_guard_work() {
        let router_prod = build_router(Arc::new(AppState::demo_for_tests_with_flags(true, false)));

        // SEED_DEMO=false blocks POST /api/v1/reset even before auth or as authenticated Contador
        let tok_contador = login_as(&router_prod, "contador@vertika.co").await;
        let blocked_reset = router_prod
            .clone()
            .oneshot(
                Request::post("/api/v1/reset")
                    .header("authorization", format!("Bearer {tok_contador}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(blocked_reset.status(), StatusCode::FORBIDDEN);

        // CONSEJO cannot create users -> 403
        let tok_consejo = login_as(&router_prod, "consejo@vertika.co").await;
        let denied_user = router_prod
            .clone()
            .oneshot(
                Request::post("/api/v1/auth/users")
                    .header("authorization", format!("Bearer {tok_consejo}"))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "email": "asistente@vertika.co",
                            "nombre": "Sofía",
                            "password": "claveSegura2026",
                            "rol": "ADMINISTRADOR"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(denied_user.status(), StatusCode::FORBIDDEN);

        // CONTADOR can create user -> 201
        let created = router_prod
            .clone()
            .oneshot(
                Request::post("/api/v1/auth/users")
                    .header("authorization", format!("Bearer {tok_contador}"))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "email": "asistente@vertika.co",
                            "nombre": "Sofía",
                            "password": "claveSegura2026",
                            "rol": "ADMINISTRADOR"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(created.status(), StatusCode::CREATED);

        // New user logs in with initial password, then changes it
        let login_res = router_prod
            .clone()
            .oneshot(
                Request::post("/api/v1/auth/login")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({ "email": "asistente@vertika.co", "password": "claveSegura2026" })
                            .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(login_res.status(), StatusCode::OK);
        let tok_new = json_body(login_res).await["token"].as_str().unwrap().to_string();

        let chg = router_prod
            .clone()
            .oneshot(
                Request::post("/api/v1/auth/change-password")
                    .header("authorization", format!("Bearer {tok_new}"))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "currentPassword": "claveSegura2026",
                            "newPassword": "nuevaClave2026!"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(chg.status(), StatusCode::OK);

        // Old password fails, new password succeeds
        let bad_login = router_prod
            .clone()
            .oneshot(
                Request::post("/api/v1/auth/login")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({ "email": "asistente@vertika.co", "password": "claveSegura2026" })
                            .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(bad_login.status(), StatusCode::UNAUTHORIZED);

        let good_login = router_prod
            .clone()
            .oneshot(
                Request::post("/api/v1/auth/login")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({ "email": "asistente@vertika.co", "password": "nuevaClave2026!" })
                            .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(good_login.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn security_headers_secret_guard_rate_limit_and_tenant_isolation_work() {
        // 1. validate_production_secret rules
        assert!(auth::validate_production_secret(false, true, None).is_ok());
        assert!(auth::validate_production_secret(true, true, None).is_ok());
        assert!(auth::validate_production_secret(true, false, None).is_err());
        assert!(auth::validate_production_secret(
            true,
            false,
            Some("vertika-dev-secret-change-in-prod")
        )
        .is_err());
        assert!(auth::validate_production_secret(true, false, Some("muy-corto")).is_err());
        assert!(auth::validate_production_secret(
            true,
            false,
            Some("una-llave-productiva-muy-larga-y-aleatoria-12345")
        )
        .is_ok());

        let router = build_router(Arc::new(AppState::demo_for_tests_with_auth(true)));

        // 2. Security headers on HTTP responses
        let h = router
            .clone()
            .oneshot(Request::get("/health").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(
            h.headers().get("x-content-type-options").and_then(|v| v.to_str().ok()),
            Some("nosniff")
        );
        assert_eq!(
            h.headers().get("x-frame-options").and_then(|v| v.to_str().ok()),
            Some("DENY")
        );

        // 3. Multi-tenant read isolation (IDOR prevention)
        let tok_superadmin = login_as(&router, "superadmin@vertika.co").await;
        let scoped_create = router
            .clone()
            .oneshot(
                Request::post("/api/v1/auth/users")
                    .header("authorization", format!("Bearer {tok_superadmin}"))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "email": "solo.altavista@vertika.co",
                            "nombre": "Contador Altavista",
                            "password": "claveSegura2026",
                            "rol": "CONTADOR",
                            "companyIds": ["altavista"]
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(scoped_create.status(), StatusCode::CREATED);

        let login_scoped = router
            .clone()
            .oneshot(
                Request::post("/api/v1/auth/login")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({ "email": "solo.altavista@vertika.co", "password": "claveSegura2026" })
                            .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(login_scoped.status(), StatusCode::OK);
        let tok_scoped = json_body(login_scoped).await["token"]
            .as_str()
            .unwrap()
            .to_string();

        // Scoped bootstrap contains only altavista
        let scoped_boot = router
            .clone()
            .oneshot(
                Request::get("/api/v1/bootstrap")
                    .header("authorization", format!("Bearer {tok_scoped}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(scoped_boot.status(), StatusCode::OK);
        let scoped_boot_json = json_body(scoped_boot).await;
        let companies = scoped_boot_json["datos"]["companies"].as_array().unwrap();
        assert_eq!(companies.len(), 1);
        assert_eq!(companies[0]["id"], "altavista");

        // Accessing Colina endpoints -> 403 Forbidden
        let colina_entries = router
            .clone()
            .oneshot(
                Request::get("/api/v1/companies/colina/entries")
                    .header("authorization", format!("Bearer {tok_scoped}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(colina_entries.status(), StatusCode::FORBIDDEN);

        let colina_bal = router
            .clone()
            .oneshot(
                Request::get("/api/v1/companies/colina/reports/balance")
                    .header("authorization", format!("Bearer {tok_scoped}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(colina_bal.status(), StatusCode::FORBIDDEN);

        let colina_puc = router
            .clone()
            .oneshot(
                Request::get("/api/v1/puc?company_id=colina")
                    .header("authorization", format!("Bearer {tok_scoped}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(colina_puc.status(), StatusCode::FORBIDDEN);

        // Accessing Altavista works -> 200 OK
        let alt_entries = router
            .clone()
            .oneshot(
                Request::get("/api/v1/companies/altavista/entries")
                    .header("authorization", format!("Bearer {tok_scoped}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(alt_entries.status(), StatusCode::OK);

        // 4. Login brute-force rate limit -> 429 on 6th attempt
        for _ in 0..5 {
            let fail = router
                .clone()
                .oneshot(
                    Request::post("/api/v1/auth/login")
                        .header("x-forwarded-for", "203.0.113.42")
                        .header("content-type", "application/json")
                        .body(Body::from(
                            json!({ "email": "ataque@vertika.co", "password": "wrong" }).to_string(),
                        ))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(fail.status(), StatusCode::UNAUTHORIZED);
        }
        let throttled = router
            .clone()
            .oneshot(
                Request::post("/api/v1/auth/login")
                    .header("x-forwarded-for", "203.0.113.42")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({ "email": "ataque@vertika.co", "password": "wrong" }).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(throttled.status(), StatusCode::TOO_MANY_REQUESTS);
    }

    #[tokio::test]
    async fn goldfish_security_fixes_work() {
        let router = build_router(Arc::new(AppState::demo_for_tests_with_auth(true)));
        let tok_global_contador = login_as(&router, "contador@vertika.co").await;
        let tok_admin = login_as(&router, "admin@vertika.co").await;

        // C2a: ADMINISTRADOR cannot create a CONTADOR user -> 403
        let esc_role = router
            .clone()
            .oneshot(
                Request::post("/api/v1/auth/users")
                    .header("authorization", format!("Bearer {tok_admin}"))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "email": "escalado@vertika.co",
                            "nombre": "Escalado",
                            "password": "claveSegura2026",
                            "rol": "CONTADOR",
                            "companyIds": ["altavista"]
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(esc_role.status(), StatusCode::FORBIDDEN);

        // Create a CONTADOR scoped strictly to ["altavista"] (only SUPER_ADMIN can create CONTADOR)
        let tok_sa = login_as(&router, "superadmin@vertika.co").await;
        let created_scoped = router
            .clone()
            .oneshot(
                Request::post("/api/v1/auth/users")
                    .header("authorization", format!("Bearer {tok_sa}"))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "email": "c.altavista@vertika.co",
                            "nombre": "Contador Solo Altavista",
                            "password": "claveSegura2026",
                            "rol": "CONTADOR",
                            "companyIds": ["altavista"]
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(created_scoped.status(), StatusCode::CREATED);

        let login_res = router
            .clone()
            .oneshot(
                Request::post("/api/v1/auth/login")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({ "email": "c.altavista@vertika.co", "password": "claveSegura2026" })
                            .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        let tok_scoped = json_body(login_res).await["token"].as_str().unwrap().to_string();

        // C2b: Scoped CONTADOR cannot create users for colina -> 403
        let esc_tenant = router
            .clone()
            .oneshot(
                Request::post("/api/v1/auth/users")
                    .header("authorization", format!("Bearer {tok_scoped}"))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "email": "otro.colina@vertika.co",
                            "nombre": "Otro Colina",
                            "password": "claveSegura2026",
                            "rol": "CONSEJO",
                            "companyIds": ["colina"]
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(esc_tenant.status(), StatusCode::FORBIDDEN);

        // C2c: Omitting companyIds defaults strictly to caller's managed companies (only altavista)
        let default_scope = router
            .clone()
            .oneshot(
                Request::post("/api/v1/auth/users")
                    .header("authorization", format!("Bearer {tok_scoped}"))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "email": "asist.altavista@vertika.co",
                            "nombre": "Asistente Altavista",
                            "password": "claveSegura2026",
                            "rol": "CONSEJO"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(default_scope.status(), StatusCode::CREATED);
        let ds_body = json_body(default_scope).await;
        let ds_roles = ds_body["user"]["roles"].as_array().unwrap();
        assert_eq!(ds_roles.len(), 1);
        assert_eq!(ds_roles[0]["company_id"], "altavista");

        // Discover a Colina pre-entry ID and Colina entry ID using global contador
        let boot_all = router
            .clone()
            .oneshot(
                Request::get("/api/v1/bootstrap")
                    .header("authorization", format!("Bearer {tok_global_contador}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let boot_json = json_body(boot_all).await;
        let colina_pre_id = boot_json["estado"]["preAsientos"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["empresaId"] == "colina")
            .expect("colina pre-entry")["id"]
            .as_str()
            .unwrap()
            .to_string();
        let colina_entry_id = boot_json["estado"]["comprobantes"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["empresaId"] == "colina" && c["periodo"] == "2026-11")
            .expect("colina entry")["id"]
            .as_str()
            .unwrap()
            .to_string();

        // C1: Scoped CONTADOR (altavista) gets 403 on Colina pre-entry approve/reject/lines and entry void
        let cross_approve = router
            .clone()
            .oneshot(
                Request::post(format!("/api/v1/pre-entries/{colina_pre_id}/approve"))
                    .header("authorization", format!("Bearer {tok_scoped}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(cross_approve.status(), StatusCode::FORBIDDEN);

        let cross_reject = router
            .clone()
            .oneshot(
                Request::post(format!("/api/v1/pre-entries/{colina_pre_id}/reject"))
                    .header("authorization", format!("Bearer {tok_scoped}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(cross_reject.status(), StatusCode::FORBIDDEN);

        let cross_void = router
            .clone()
            .oneshot(
                Request::post(format!("/api/v1/entries/{colina_entry_id}/void"))
                    .header("authorization", format!("Bearer {tok_scoped}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(cross_void.status(), StatusCode::FORBIDDEN);

        // C5: Scoped CONTADOR cannot wipe all tenants via reset or put_state -> 403
        let cross_reset = router
            .clone()
            .oneshot(
                Request::post("/api/v1/reset")
                    .header("authorization", format!("Bearer {tok_scoped}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(cross_reset.status(), StatusCode::FORBIDDEN);

        let cross_put = router
            .clone()
            .oneshot(
                Request::put("/api/v1/state")
                    .header("authorization", format!("Bearer {tok_scoped}"))
                    .header("content-type", "application/json")
                    .body(Body::from(json!({ "version": 4 }).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(cross_put.status(), StatusCode::FORBIDDEN);

        // H4: Updating a shared global third party (prov-atlas) from a tenant -> 403
        let mut_global_tp = router
            .clone()
            .oneshot(
                Request::put("/api/v1/companies/altavista/third-parties/prov-atlas")
                    .header("authorization", format!("Bearer {tok_scoped}"))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "nombre": "Atlas Hacked",
                            "tipo": "PROVEEDOR",
                            "documento": "900.412.887",
                            "retefuentePct": 0,
                            "reteicaPct": 0,
                            "reteivaPct": 0
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(mut_global_tp.status(), StatusCode::FORBIDDEN);

        // H3: Rotating X-Forwarded-For on every attempt STILL triggers 429 on 6th failure
        for i in 0..5 {
            let fail = router
                .clone()
                .oneshot(
                    Request::post("/api/v1/auth/login")
                        .header("x-forwarded-for", format!("198.51.100.{i}"))
                        .header("content-type", "application/json")
                        .body(Body::from(
                            json!({ "email": "rotado@vertika.co", "password": "wrong" }).to_string(),
                        ))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(fail.status(), StatusCode::UNAUTHORIZED);
        }
        let blocked_rotated = router
            .clone()
            .oneshot(
                Request::post("/api/v1/auth/login")
                    .header("x-forwarded-for", "198.51.100.99")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({ "email": "rotado@vertika.co", "password": "wrong" }).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(blocked_rotated.status(), StatusCode::TOO_MANY_REQUESTS);
    }

    #[tokio::test]
    async fn postgres_relational_lifecycle_if_configured() {
        let Ok(database_url) = std::env::var("DATABASE_URL") else {
            return;
        };
        if database_url.trim().is_empty() {
            return;
        }

        let seed: Value = serde_json::from_str(include_str!("../seed_bootstrap.json"))
            .expect("seed_bootstrap.json válido");
        let db = Db::connect(&database_url)
            .await
            .expect("connect to postgres");
        let pg = PostgresRepo::init(db.clone(), seed, true)
            .await
            .expect("init postgres repo");
        let _ = pg.reset().await.expect("reset postgres to seed");

        let comp_uuid: uuid::Uuid =
            sqlx::query_scalar("SELECT id FROM copropiedades WHERE slug = 'altavista'")
                .fetch_one(&db.pool)
                .await
                .unwrap();

        // 1) Bloqueo de periodo cerrado en SQL
        let closed_insert = sqlx::query(
            "INSERT INTO comprobantes_contables (
                copropiedad_id, tipo_documento, consecutivo, periodo, fecha_contable,
                origen_creacion, estado, descripcion, total_debito, total_credito
            ) VALUES ($1,'CC',99999,'2026-10','2026-10-15','CONTADOR_MANUAL','ASENTADO','Test',100,100)",
        )
        .bind(comp_uuid)
        .execute(&db.pool)
        .await;
        assert!(closed_insert.is_err(), "closed period insert must fail");

        // 2) Constraint trigger diferido de cuadre de movimientos
        let mut bad_tx = db.pool.begin().await.unwrap();
        let bad_cid = uuid::Uuid::new_v4();
        sqlx::query(
            "INSERT INTO comprobantes_contables (
                id, copropiedad_id, tipo_documento, consecutivo, periodo, fecha_contable,
                origen_creacion, estado, descripcion, total_debito, total_credito
            ) VALUES ($1,$2,'CC',99998,'2026-11','2026-11-15','CONTADOR_MANUAL','ASENTADO','Test',100,100)",
        )
        .bind(bad_cid)
        .bind(comp_uuid)
        .execute(&mut *bad_tx)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO movimientos_ledger (comprobante_id, copropiedad_id, cuenta_codigo, debito, credito, descripcion)
             VALUES ($1,$2,'513505',100,0,'Debito'), ($1,$2,'220505',0,50,'Credito descuadrado')",
        )
        .bind(bad_cid)
        .bind(comp_uuid)
        .execute(&mut *bad_tx)
        .await
        .unwrap();
        assert!(
            bad_tx.commit().await.is_err(),
            "unbalanced movimientos_ledger transaction must fail at commit"
        );

        // 3) Inmutabilidad de comprobante asentado (prohibido DELETE)
        let del_res = sqlx::query("DELETE FROM comprobantes_contables WHERE copropiedad_id = $1")
            .bind(comp_uuid)
            .execute(&db.pool)
            .await;
        assert!(del_res.is_err(), "DELETE on ASENTADO voucher must fail");

        // 4) Ciclo HTTP completo + Auth/RBAC sobre PostgreSQL real
        let router = build_router(Arc::new(AppState {
            store: Store::Postgres(pg),
            auth_required: false,
            seed_demo: true,
            login_limiter: auth::LoginRateLimiter::new(),
        }));
        let h = router
            .clone()
            .oneshot(Request::get("/health").body(Body::empty()).unwrap())
            .await
            .unwrap();
        let hb = json_body(h).await;
        assert_eq!(hb["mode"], "postgres");
        assert_eq!(hb["postgres_enabled"], true);

        exercise_auth_and_rbac(&router, false).await;
        exercise_relational_http_lifecycle(router).await;
    }

    #[tokio::test]
    async fn saas_superadmin_quotas_and_company_self_service_work() {
        let router = app();
        let tok_sa = login_as(&router, "superadmin@vertika.co").await;
        let tok_demo_contador = login_as(&router, "contador@vertika.co").await;

        // 1. CONTADOR cannot access /api/v1/admin/overview or create another CONTADOR
        let denied_overview = router
            .clone()
            .oneshot(
                Request::get("/api/v1/admin/overview")
                    .header("authorization", format!("Bearer {tok_demo_contador}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(denied_overview.status(), StatusCode::FORBIDDEN);

        let denied_contador = router
            .clone()
            .oneshot(
                Request::post("/api/v1/auth/users")
                    .header("authorization", format!("Bearer {tok_demo_contador}"))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "email": "clon.contador@vertika.co",
                            "nombre": "Contador Clon",
                            "password": "claveSegura2026",
                            "rol": "CONTADOR",
                            "companyIds": ["altavista"]
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(denied_contador.status(), StatusCode::FORBIDDEN);

        // 2. SUPER_ADMIN creates a trial CONTADOR with maxCopropiedades=1, diasPrueba=14
        let create_trial = router
            .clone()
            .oneshot(
                Request::post("/api/v1/admin/contadores")
                    .header("authorization", format!("Bearer {tok_sa}"))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "email": "firma.prueba@vertika.co",
                            "nombre": "Firma Prueba SAS",
                            "password": "claveSegura2026",
                            "planNombre": "PRUEBA",
                            "maxCopropiedades": 1,
                            "diasPrueba": 14
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(create_trial.status(), StatusCode::CREATED);
        let trial_user = json_body(create_trial).await["user"].clone();
        let trial_id = trial_user["id"].as_str().unwrap().to_string();
        assert_eq!(trial_user["maxCopropiedades"], 1);

        // 3. Trial CONTADOR logs in and creates company #1 (allowed within quota 1/1)
        let login_trial = router
            .clone()
            .oneshot(
                Request::post("/api/v1/auth/login")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({ "email": "firma.prueba@vertika.co", "password": "claveSegura2026" })
                            .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(login_trial.status(), StatusCode::OK);
        let tok_trial = json_body(login_trial).await["token"]
            .as_str()
            .unwrap()
            .to_string();

        let comp1 = router
            .clone()
            .oneshot(
                Request::post("/api/v1/companies")
                    .header("authorization", format!("Bearer {tok_trial}"))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "nit": "901.555.100-1",
                            "razonSocial": "Conjunto Residencial Los Pinos P.H.",
                            "nombreCorto": "Los Pinos",
                            "presupuestoAnual": 240000000
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(comp1.status(), StatusCode::CREATED);
        let comp1_body = json_body(comp1).await;
        let comp1_id = comp1_body["copropiedad"]["id"].as_str().unwrap().to_string();
        let tok_trial_refreshed = comp1_body["token"].as_str().unwrap().to_string();
        assert_eq!(comp1_id, "los-pinos");

        // 4. Trial CONTADOR tries to create company #2 -> blocked by quota (403)
        let comp2_blocked = router
            .clone()
            .oneshot(
                Request::post("/api/v1/companies")
                    .header("authorization", format!("Bearer {tok_trial_refreshed}"))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "nit": "901.555.200-2",
                            "razonSocial": "Edificio Cedros P.H.",
                            "nombreCorto": "Cedros"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(comp2_blocked.status(), StatusCode::FORBIDDEN);

        // 5. Trial CONTADOR creates an ADMINISTRADOR for their own company (allowed)
        let create_sub_admin = router
            .clone()
            .oneshot(
                Request::post("/api/v1/auth/users")
                    .header("authorization", format!("Bearer {tok_trial_refreshed}"))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "email": "admin.pinos@vertika.co",
                            "nombre": "Admin Los Pinos",
                            "password": "claveSegura2026",
                            "rol": "ADMINISTRADOR",
                            "companyIds": [comp1_id]
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(create_sub_admin.status(), StatusCode::CREATED);

        // 6. SUPER_ADMIN upgrades quota to 2 -> now company #2 succeeds
        let upgrade = router
            .clone()
            .oneshot(
                Request::patch(format!("/api/v1/admin/users/{trial_id}"))
                    .header("authorization", format!("Bearer {tok_sa}"))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({ "maxCopropiedades": 2, "planNombre": "FIRMA_2" }).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(upgrade.status(), StatusCode::OK);

        let comp2_ok = router
            .clone()
            .oneshot(
                Request::post("/api/v1/companies")
                    .header("authorization", format!("Bearer {tok_trial_refreshed}"))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "nit": "901.555.200-2",
                            "razonSocial": "Edificio Cedros P.H.",
                            "nombreCorto": "Cedros"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(comp2_ok.status(), StatusCode::CREATED);

        // 7. SUPER_ADMIN suspends the trial account -> login is rejected with 403
        let suspend = router
            .clone()
            .oneshot(
                Request::patch(format!("/api/v1/admin/users/{trial_id}"))
                    .header("authorization", format!("Bearer {tok_sa}"))
                    .header("content-type", "application/json")
                    .body(Body::from(json!({ "activo": false }).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(suspend.status(), StatusCode::OK);

        let login_suspended = router
            .clone()
            .oneshot(
                Request::post("/api/v1/auth/login")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({ "email": "firma.prueba@vertika.co", "password": "claveSegura2026" })
                            .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(login_suspended.status(), StatusCode::FORBIDDEN);

        // 8. SUPER_ADMIN overview reflects accurate counts
        let ov = router
            .clone()
            .oneshot(
                Request::get("/api/v1/admin/overview")
                    .header("authorization", format!("Bearer {tok_sa}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(ov.status(), StatusCode::OK);
        let ov_body = json_body(ov).await;
        assert!(ov_body["totalContadores"].as_u64().unwrap() >= 2);
        assert!(ov_body["cuentasSuspendidasOVencidas"].as_u64().unwrap() >= 1);
    }

    #[tokio::test]
    async fn portal_links_lookup_checkout_wompi_webhook_and_idempotency_work() {
        let router = app();
        let tok_contador = login_as(&router, "contador@vertika.co").await;

        // 1. Configure Wompi Sandbox keys on Altavista
        let cfg_res = router
            .clone()
            .oneshot(
                Request::patch("/api/v1/companies/altavista/settings")
                    .header("authorization", format!("Bearer {tok_contador}"))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "wompiPublicKey": "pub_test_vertika_demo",
                            "wompiIntegritySecret": "test_integrity_secret_123",
                            "wompiEventsSecret": "test_events_secret_456",
                            "wompiSandbox": true
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(cfg_res.status(), StatusCode::OK);
        let cfg_body = json_body(cfg_res).await;
        assert_eq!(cfg_body["wompiConfigurado"], true);

        // 2. Fetch signed portal links for Altavista
        let links_res = router
            .clone()
            .oneshot(
                Request::get("/api/v1/companies/altavista/portal-links")
                    .header("authorization", format!("Bearer {tok_contador}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(links_res.status(), StatusCode::OK);
        let links_body = json_body(links_res).await;
        let links = links_body["links"].as_array().unwrap();
        assert!(!links.is_empty());

        // Pick a unit that has saldoActual > 0
        let mut chosen_token = String::new();
        let mut chosen_torre = String::new();
        let mut chosen_num = String::new();
        let mut chosen_doc = String::new();
        let mut chosen_saldo = 0.0_f64;

        for item in links {
            let tok = item["token"].as_str().unwrap();
            let st_res = router
                .clone()
                .oneshot(
                    Request::get(format!("/api/v1/portal/unit/{tok}"))
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(st_res.status(), StatusCode::OK);
            let st_body = json_body(st_res).await;
            let saldo = st_body["saldoActual"].as_f64().unwrap_or(0.0);
            if saldo > 0.0 {
                chosen_token = tok.to_string();
                chosen_torre = st_body["torre"].as_str().unwrap().to_string();
                chosen_num = st_body["numero"].as_str().unwrap().to_string();
                chosen_doc = st_body["propietarioDocumento"].as_str().unwrap().to_string();
                chosen_saldo = saldo;
                break;
            }
        }
        assert!(chosen_saldo > 0.0, "Debe existir al menos una unidad con saldo en Altavista");

        // 3. Public lookup succeeds with valid unit + document and fails on wrong document
        let bad_lookup = router
            .clone()
            .oneshot(
                Request::post("/api/v1/portal/lookup")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "companySlug": "altavista",
                            "unidad": format!("{chosen_torre}{chosen_num}"),
                            "documento": "9999999999"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(bad_lookup.status(), StatusCode::UNAUTHORIZED);

        let good_lookup = router
            .clone()
            .oneshot(
                Request::post("/api/v1/portal/lookup")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "companySlug": "altavista",
                            "unidad": format!("{chosen_torre}-{chosen_num}"),
                            "documento": chosen_doc
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(good_lookup.status(), StatusCode::OK);
        let lookup_token = json_body(good_lookup).await["token"]
            .as_str()
            .unwrap()
            .to_string();
        assert_eq!(lookup_token, chosen_token);

        // 4. Create checkout intention (without pronto pago discount so full saldo reaches $0)
        let chk_res = router
            .clone()
            .oneshot(
                Request::post(format!("/api/v1/portal/unit/{chosen_token}/checkout"))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "aplicarDescuento": false,
                            "redirectUrl": "https://vertika-lac.vercel.app/pagar/ok"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(chk_res.status(), StatusCode::OK);
        let chk_body = json_body(chk_res).await;
        let referencia = chk_body["referencia"].as_str().unwrap().to_string();
        let cents = chk_body["montoEnCentavos"].as_i64().unwrap();
        assert!(cents > 0);
        assert!(chk_body["checkoutUrl"]
            .as_str()
            .unwrap()
            .starts_with("https://checkout.wompi.co/p/"));
        assert!(!chk_body["signatureIntegrity"].as_str().unwrap().is_empty());

        // 5. Wompi webhook with invalid checksum -> 401
        let ts = 1700000000_i64;
        let bad_wh = router
            .clone()
            .oneshot(
                Request::post("/api/v1/webhooks/wompi")
                    .header("content-type", "application/json")
                    .header("x-event-checksum", "deadbeef")
                    .body(Body::from(
                        json!({
                            "event": "transaction.updated",
                            "timestamp": ts,
                            "data": {
                                "transaction": {
                                    "id": "tx-wompi-001",
                                    "reference": referencia,
                                    "status": "APPROVED",
                                    "amount_in_cents": cents
                                }
                            },
                            "signature": {
                                "properties": ["transaction.id", "transaction.status", "transaction.amount_in_cents"],
                                "checksum": "deadbeef"
                            }
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(bad_wh.status(), StatusCode::UNAUTHORIZED);

        // 6. Wompi webhook with valid SHA-256 checksum -> 200 & auto RC
        let valid_checksum = auth::sha256_hex(&format!(
            "tx-wompi-001APPROVED{cents}{ts}test_events_secret_456"
        ));
        let wh_payload = json!({
            "event": "transaction.updated",
            "timestamp": ts,
            "data": {
                "transaction": {
                    "id": "tx-wompi-001",
                    "reference": referencia,
                    "status": "APPROVED",
                    "amount_in_cents": cents
                }
            },
            "signature": {
                "properties": ["transaction.id", "transaction.status", "transaction.amount_in_cents"],
                "checksum": valid_checksum
            }
        });
        let good_wh = router
            .clone()
            .oneshot(
                Request::post("/api/v1/webhooks/wompi")
                    .header("content-type", "application/json")
                    .header("x-event-checksum", &valid_checksum)
                    .body(Body::from(wh_payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(good_wh.status(), StatusCode::OK);
        let good_wh_body = json_body(good_wh).await;
        assert_eq!(good_wh_body["ok"], true);
        assert_eq!(good_wh_body["idempotent"], false);
        assert_eq!(good_wh_body["comprobante"]["tipo"], "RC");

        // 7. Statement now shows saldoActual == 0
        let after_res = router
            .clone()
            .oneshot(
                Request::get(format!("/api/v1/portal/unit/{chosen_token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(after_res.status(), StatusCode::OK);
        let after_body = json_body(after_res).await;
        assert_eq!(after_body["saldoActual"].as_f64().unwrap(), 0.0);

        // 8. Replay same webhook -> idempotent (no duplicate RC)
        let replay_wh = router
            .clone()
            .oneshot(
                Request::post("/api/v1/webhooks/wompi")
                    .header("content-type", "application/json")
                    .header("x-event-checksum", &valid_checksum)
                    .body(Body::from(wh_payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(replay_wh.status(), StatusCode::OK);
        let replay_body = json_body(replay_wh).await;
        assert_eq!(replay_body["idempotent"], true);
    }

    #[tokio::test]
    async fn portal_lookup_document_only_multi_unit_and_rate_limit_work() {
        let router = app();
        let tok_contador = login_as(&router, "contador@vertika.co").await;

        // 1. Fetch public company info
        let info_res = router
            .clone()
            .oneshot(
                Request::get("/api/v1/portal/company/altavista")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(info_res.status(), StatusCode::OK);
        let info_body = json_body(info_res).await;
        assert_eq!(info_body["companyId"], "altavista");
        assert!(!info_body["razonSocial"].as_str().unwrap_or("").is_empty());

        // 2. Find Torre A 101 owner via bootstrap and attach a second unit to that same owner
        let boot_res = router
            .clone()
            .oneshot(
                Request::get("/api/v1/bootstrap")
                    .header("authorization", format!("Bearer {tok_contador}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(boot_res.status(), StatusCode::OK);
        let boot_body = json_body(boot_res).await;
        let units = boot_body["datos"]["units"].as_array().unwrap();
        let terceros = boot_body["datos"]["terceros"].as_array().unwrap();
        let u101 = units
            .iter()
            .find(|u| u["empresaId"] == "altavista" && u["numero"] == "101")
            .unwrap();
        let prop_id = u101["propietarioId"].as_str().unwrap().to_string();
        let prop_doc = terceros
            .iter()
            .find(|t| t["id"].as_str() == Some(prop_id.as_str()))
            .unwrap()["documento"]
            .as_str()
            .unwrap()
            .to_string();

        let create_u2 = router
            .clone()
            .oneshot(
                Request::post("/api/v1/companies/altavista/units")
                    .header("authorization", format!("Bearer {tok_contador}"))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "torre": "Torre Z",
                            "numero": "909",
                            "tipo": "PARQUEADERO",
                            "area": 14,
                            "coeficiente": 0.5,
                            "matricula": "50N-999999",
                            "propietarioId": prop_id
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(create_u2.status(), StatusCode::CREATED);

        // 3. Lookup using ONLY documento (no unidad) -> returns both units with valid tokens
        let lookup_res = router
            .clone()
            .oneshot(
                Request::post("/api/v1/portal/lookup")
                    .header("content-type", "application/json")
                    .header("x-forwarded-for", "203.0.113.10")
                    .body(Body::from(
                        json!({
                            "companySlug": "altavista",
                            "documento": prop_doc
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(lookup_res.status(), StatusCode::OK);
        let lookup_body = json_body(lookup_res).await;
        let matched = lookup_body["units"].as_array().unwrap();
        assert!(matched.len() >= 2);
        for m in matched {
            let tok = m["token"].as_str().unwrap();
            let stmt_res = router
                .clone()
                .oneshot(
                    Request::get(format!("/api/v1/portal/unit/{tok}"))
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(stmt_res.status(), StatusCode::OK);
        }

        // 4. Rate limit by IP across different failed documents -> 429 after 5 failed attempts
        let mut last_status = StatusCode::OK;
        for idx in 0..7 {
            let fail_res = router
                .clone()
                .oneshot(
                    Request::post("/api/v1/portal/lookup")
                        .header("content-type", "application/json")
                        .header("x-forwarded-for", "203.0.113.55")
                        .body(Body::from(
                            json!({
                                "companySlug": "altavista",
                                "documento": format!("9999000{idx}")
                            })
                            .to_string(),
                        ))
                        .unwrap(),
                )
                .await
                .unwrap();
            last_status = fail_res.status();
            if idx < 5 {
                assert_eq!(last_status, StatusCode::UNAUTHORIZED);
            }
        }
        assert_eq!(last_status, StatusCode::TOO_MANY_REQUESTS);
    }
}
