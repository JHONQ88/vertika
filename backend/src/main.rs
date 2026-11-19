mod db;
mod domain;
mod error;
mod repo;

use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderValue, Method, StatusCode},
    routing::{get, post, put},
    Json, Router,
};
use db::Db;
use domain::{
    ledger::{self, EntryDraft, PreEntryDraft},
    BalanceRequest, ClosePeriodRequest, CreateEntryRequest, Health, LedgerAccount,
    UpdatePreEntryLinesRequest, ValidationResult, VoidEntryRequest,
};
use error::ApiError;
use repo::{memory::MemoryRepo, postgres::PostgresRepo, Store};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{net::SocketAddr, sync::Arc};
use tower_http::cors::{Any, CorsLayer};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

const DEMO_ACTOR: &str = "Contador demo";

struct AppState {
    store: Store,
}

impl AppState {
    async fn new() -> Self {
        let seed: Value = serde_json::from_str(include_str!("../seed_bootstrap.json"))
            .expect("seed_bootstrap.json válido");
        let database_url = std::env::var("DATABASE_URL").ok();
        let store = match database_url {
            Some(url) if !url.trim().is_empty() => match Db::connect(&url).await {
                Ok(db) => match PostgresRepo::init(db, seed.clone()).await {
                    Ok(pg) => {
                        tracing::info!("Conectado a PostgreSQL, migraciones y seed relacional listos");
                        Store::Postgres(pg)
                    }
                    Err(e) => {
                        tracing::error!(error = ?e, "Error inicializando repositorio PostgreSQL, usando memoria");
                        Store::Memory(MemoryRepo::new(seed).expect("seed válido"))
                    }
                },
                Err(e) => {
                    tracing::error!(error = %e, "No se pudo conectar a PostgreSQL, usando modo memoria");
                    Store::Memory(MemoryRepo::new(seed).expect("seed válido"))
                }
            },
            _ => Store::Memory(MemoryRepo::new(seed).expect("seed válido")),
        };
        Self { store }
    }

    #[cfg(test)]
    fn demo_for_tests() -> Self {
        let seed: Value = serde_json::from_str(include_str!("../seed_bootstrap.json"))
            .expect("seed_bootstrap.json válido");
        Self {
            store: Store::Memory(MemoryRepo::new(seed).expect("seed válido")),
        }
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
        // Endpoints transaccionales Bloque B
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

async fn bootstrap(State(state): State<Arc<AppState>>) -> Result<Json<Value>, ApiError> {
    Ok(Json(state.store.bootstrap().await?))
}

async fn get_state(State(state): State<Arc<AppState>>) -> Result<Json<Value>, ApiError> {
    Ok(Json(state.store.get_state().await?))
}

async fn put_state(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(state.store.put_state(payload).await?))
}

async fn reset_state(State(state): State<Arc<AppState>>) -> Result<Json<Value>, ApiError> {
    Ok(Json(state.store.reset().await?))
}

async fn puc_catalog(
    State(state): State<Arc<AppState>>,
    Query(q): Query<CompanyQuery>,
) -> Result<Json<Vec<LedgerAccount>>, ApiError> {
    Ok(Json(state.store.list_puc(q.company_id.as_deref()).await?))
}

async fn validate_entry(
    State(state): State<Arc<AppState>>,
    Json(draft): Json<EntryDraft>,
) -> Result<(StatusCode, Json<ValidationResult>), ApiError> {
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
    Json(draft): Json<EntryDraft>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
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
    Json(pre): Json<PreEntryDraft>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
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
    Json(req): Json<BalanceRequest>,
) -> Result<Json<Value>, ApiError> {
    let puc = state.store.list_puc(Some(&req.company_id)).await?;
    Ok(Json(ledger::trial_balance_preview(&req, &puc)))
}

async fn update_pre_entry_lines(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(req): Json<UpdatePreEntryLinesRequest>,
) -> Result<Json<Value>, ApiError> {
    let updated = state.store.update_pre_entry_lines(&id, req.lineas).await?;
    Ok(Json(serde_json::to_value(updated).unwrap_or_else(|_| json!({}))))
}

async fn approve_pre_entry(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let out = state.store.approve_pre_entry(&id, DEMO_ACTOR).await?;
    Ok(Json(serde_json::to_value(out).unwrap_or_else(|_| json!({}))))
}

async fn reject_pre_entry(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let ev = state.store.reject_pre_entry(&id, DEMO_ACTOR).await?;
    Ok(Json(json!({ "ok": true, "auditoria": ev })))
}

async fn create_entry(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateEntryRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let out = state.store.create_entry(req, DEMO_ACTOR).await?;
    Ok((
        StatusCode::CREATED,
        Json(serde_json::to_value(out).unwrap_or_else(|_| json!({}))),
    ))
}

async fn void_entry(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    body: Option<Json<VoidEntryRequest>>,
) -> Result<Json<Value>, ApiError> {
    let reason = body.and_then(|b| b.0.reason);
    let out = state.store.void_entry(&id, reason, DEMO_ACTOR).await?;
    Ok(Json(serde_json::to_value(out).unwrap_or_else(|_| json!({}))))
}

async fn list_company_entries(
    State(state): State<Arc<AppState>>,
    Path(company_id): Path<String>,
    Query(q): Query<PeriodQuery>,
) -> Result<Json<Value>, ApiError> {
    let entries = state
        .store
        .list_entries(&company_id, q.period.as_deref())
        .await?;
    Ok(Json(serde_json::to_value(entries).unwrap_or_else(|_| json!([]))))
}

async fn close_company_period(
    State(state): State<Arc<AppState>>,
    Path((company_id, period)): Path<(String, String)>,
    body: Option<Json<ClosePeriodRequest>>,
) -> Result<Json<Value>, ApiError> {
    let req = body.map(|b| b.0).unwrap_or_default();
    let out = state
        .store
        .close_period(&company_id, &period, req, DEMO_ACTOR)
        .await?;
    Ok(Json(serde_json::to_value(out).unwrap_or_else(|_| json!({}))))
}

async fn company_trial_balance(
    State(state): State<Arc<AppState>>,
    Path(company_id): Path<String>,
    Query(q): Query<PeriodQuery>,
) -> Result<Json<Value>, ApiError> {
    let period = q.period.unwrap_or_else(|| "todos".into());
    let report = state.store.trial_balance(&company_id, &period).await?;
    Ok(Json(report))
}

async fn company_audit(
    State(state): State<Arc<AppState>>,
    Path(company_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let events = state.store.list_audit(&company_id).await?;
    Ok(Json(serde_json::to_value(events).unwrap_or_else(|_| json!([]))))
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
        assert_eq!(
            approved["comprobante"]["hash"].as_str().unwrap().len(),
            64
        );

        // Double approve returns 409 Conflict
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
        assert!(aud_res.status() == StatusCode::OK);
        let aud_body = json_body(aud_res).await;
        assert!(!aud_body.as_array().unwrap().is_empty());

        // 7. Close period 2026-11 -> creates NC and blocks subsequent entry in 2026-11
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

        // 8. Reset back to seed
        let reset_res = router
            .oneshot(Request::post("/api/v1/reset").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(reset_res.status(), StatusCode::OK);
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
        let pg = PostgresRepo::init(db.clone(), seed)
            .await
            .expect("init postgres repo");
        let _ = pg.reset().await.expect("reset postgres to seed");

        // Verificar triggers SQL directamente
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

        // 4) Ciclo HTTP completo sobre PostgreSQL real
        let router = build_router(Arc::new(AppState {
            store: Store::Postgres(pg),
        }));
        let h = router
            .clone()
            .oneshot(Request::get("/health").body(Body::empty()).unwrap())
            .await
            .unwrap();
        let hb = json_body(h).await;
        assert_eq!(hb["mode"], "postgres");
        assert_eq!(hb["postgres_enabled"], true);

        exercise_relational_http_lifecycle(router).await;
    }
}
