mod db;
mod domain;

use axum::{
    extract::State,
    http::StatusCode,
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
use tower_http::cors::{Any, CorsLayer};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

const STATE_KEY: &str = "default";

#[derive(Clone)]
struct AppState {
    mode: String,
    puc: Vec<LedgerAccount>,
    third_parties: Vec<domain::ThirdParty>,
    db: Option<Db>,
    seed: Value,
}

impl AppState {
    async fn new() -> Self {
        let seed: Value = serde_json::from_str(include_str!("../seed_bootstrap.json"))
            .expect("seed_bootstrap.json válido");
        let domain = domain::AppState::demo();
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
        Self {
            mode,
            puc: domain.puc,
            third_parties: domain.third_parties,
            db,
            seed,
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
        Ok(self.seed_estado())
    }

    async fn save_estado(&self, estado: &Value) -> Result<(), (StatusCode, String)> {
        if let Some(db) = &self.db {
            db.set_state(STATE_KEY, estado).await.map_err(db_error)?;
        }
        Ok(())
    }
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

    let app = Router::new()
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
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        );

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
