mod db;
mod domain;

use axum::{
    extract::State,
    http::{header, HeaderValue, Method, StatusCode},
    routing::{get, post},
    Json, Router,
};
use db::{db_error, Db};
use domain::{
    ledger::{self, EntryDraft, PreEntryDraft},
    BalanceRequest, Health, LedgerAccount, ValidationResult,
};
use serde_json::{json, Value};
use std::{net::SocketAddr, sync::Arc};
use tokio::sync::RwLock;
use tower_http::cors::{Any, CorsLayer};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

const STATE_KEY: &str = "default";

struct AppState {
    mode: String,
    puc: Vec<LedgerAccount>,
    third_parties: Vec<domain::ThirdParty>,
    db: Option<Db>,
    seed: Value,
    memory_state: RwLock<Value>,
}

impl AppState {
    async fn new() -> Self {
        let seed: Value = serde_json::from_str(include_str!("../seed_bootstrap.json"))
            .expect("seed_bootstrap.json válido");
        let domain = domain::AppState::demo();
        let third_parties = domain::third_parties_from_seed(&seed);
        let database_url = std::env::var("DATABASE_URL").ok();
        let (db, mode) = match database_url {
            Some(url) if !url.trim().is_empty() => match Db::connect(&url).await {
                Ok(db) => {
                    tracing::info!("Conectado a PostgreSQL, migraciones aplicadas");
                    (Some(db), "postgres".to_string())
                }
                Err(e) => {
                    tracing::error!(error = %e, "No se pudo conectar a PostgreSQL, usando modo memoria");
                    (None, "demo-memory".to_string())
                }
            },
            _ => (None, "demo-memory".to_string()),
        };
        let initial_estado = seed.get("estado").cloned().unwrap_or_else(|| json!({}));
        Self {
            mode,
            puc: domain.puc,
            third_parties,
            db,
            seed,
            memory_state: RwLock::new(initial_estado),
        }
    }

    #[cfg(test)]
    fn demo_for_tests() -> Self {
        let seed: Value = serde_json::from_str(include_str!("../seed_bootstrap.json"))
            .expect("seed_bootstrap.json válido");
        let domain = domain::AppState::demo();
        let third_parties = domain::third_parties_from_seed(&seed);
        let initial_estado = seed.get("estado").cloned().unwrap_or_else(|| json!({}));
        Self {
            mode: "demo-memory".to_string(),
            puc: domain.puc,
            third_parties,
            db: None,
            seed,
            memory_state: RwLock::new(initial_estado),
        }
    }

    fn seed_estado(&self) -> Value {
        self.seed
            .get("estado")
            .cloned()
            .unwrap_or_else(|| json!({}))
    }

    fn datos(&self) -> Value {
        self.seed.get("datos").cloned().unwrap_or_else(|| json!({}))
    }

    async fn current_estado(&self) -> Result<Value, (StatusCode, String)> {
        if let Some(db) = &self.db {
            if let Some(v) = db.get_state(STATE_KEY).await.map_err(db_error)? {
                return Ok(v);
            }
            let seed = self.seed_estado();
            db.set_state(STATE_KEY, &seed).await.map_err(db_error)?;
            return Ok(seed);
        }
        Ok(self.memory_state.read().await.clone())
    }

    async fn save_estado(&self, estado: &Value) -> Result<(), (StatusCode, String)> {
        if let Some(db) = &self.db {
            db.set_state(STATE_KEY, estado).await.map_err(db_error)?;
        } else {
            *self.memory_state.write().await = estado.clone();
        }
        Ok(())
    }
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
        .route("/api/v1/bootstrap", get(bootstrap))
        .route("/api/v1/state", get(get_state).put(put_state))
        .route("/api/v1/reset", post(reset_state))
        .route("/api/v1/puc", get(puc_catalog))
        .route("/api/v1/ledger/validate", post(validate_entry))
        .route("/api/v1/ledger/preview", post(preview_entry))
        .route("/api/v1/pre-entries/carry-forward", post(carry_forward))
        .route("/api/v1/balance", post(balance_preview))
        .with_state(state)
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

async fn health(State(state): State<Arc<AppState>>) -> Json<Health> {
    Json(Health {
        status: "ok".into(),
        service: "vertika-backend".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        mode: state.mode.clone(),
        postgres_enabled: state.db.is_some(),
    })
}

async fn bootstrap(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let estado = state.current_estado().await?;
    Ok(Json(json!({
        "datos": state.datos(),
        "estado": estado,
        "mode": state.mode,
    })))
}

async fn get_state(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Value>, (StatusCode, String)> {
    Ok(Json(state.current_estado().await?))
}

async fn put_state(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, (StatusCode, String)> {
    state.save_estado(&payload).await?;
    Ok(Json(payload))
}

async fn reset_state(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let seed = state.seed_estado();
    state.save_estado(&seed).await?;
    Ok(Json(json!({ "ok": true, "estado": seed })))
}

async fn puc_catalog(State(state): State<Arc<AppState>>) -> Json<Vec<LedgerAccount>> {
    Json(state.puc.clone())
}

async fn validate_entry(
    State(state): State<Arc<AppState>>,
    Json(draft): Json<EntryDraft>,
) -> (StatusCode, Json<ValidationResult>) {
    let result = ledger::validate_entry(&draft, &state.puc);
    let status = if result.ok {
        StatusCode::OK
    } else {
        StatusCode::UNPROCESSABLE_ENTITY
    };
    (status, Json(result))
}

async fn preview_entry(
    State(state): State<Arc<AppState>>,
    Json(draft): Json<EntryDraft>,
) -> (StatusCode, Json<Value>) {
    let result = ledger::validate_entry(&draft, &state.puc);
    let status = if result.ok {
        StatusCode::OK
    } else {
        StatusCode::UNPROCESSABLE_ENTITY
    };
    (
        status,
        Json(json!({
            "validation": result,
            "hash": if result.ok { Some(ledger::entry_hash(&draft)) } else { None },
            "can_post": result.ok
        })),
    )
}

async fn carry_forward(
    State(state): State<Arc<AppState>>,
    Json(pre): Json<PreEntryDraft>,
) -> (StatusCode, Json<Value>) {
    match ledger::carry_forward(&pre, &state.third_parties) {
        Some(out) => (StatusCode::OK, Json(serde_json::to_value(out).unwrap_or(json!({"applied": true})))),
        None => (
            StatusCode::OK,
            Json(json!({
                "applied": false,
                "detail": "Sin reglas de retención aplicables para este tercero/documento."
            })),
        ),
    }
}

async fn balance_preview(
    State(state): State<Arc<AppState>>,
    Json(req): Json<BalanceRequest>,
) -> Json<Value> {
    Json(ledger::trial_balance_preview(&req, &state.puc))
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
        assert_eq!(b_ok["difference"], 0.0);

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
        assert!(b_prev["hash"].as_str().is_some_and(|h| !h.is_empty()));

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
}
