use axum::http::StatusCode;
use serde_json::Value;
use sqlx::{postgres::PgPoolOptions, PgPool};
use std::time::Duration;

#[derive(Clone)]
pub struct Db {
    pub pool: PgPool,
}

impl Db {
    pub async fn connect(database_url: &str) -> Result<Self, sqlx::Error> {
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .acquire_timeout(Duration::from_secs(5))
            .connect(database_url)
            .await?;
        // Migraciones simples en orden (001, 002)
        let m1 = include_str!("../migrations/001_init.sql");
        let m2 = include_str!("../migrations/002_estado_kv.sql");
        sqlx::raw_sql(m1).execute(&pool).await?;
        sqlx::raw_sql(m2).execute(&pool).await?;
        Ok(Self { pool })
    }

    pub async fn get_state(&self, id: &str) -> Result<Option<Value>, sqlx::Error> {
        let row: Option<(Value,)> =
            sqlx::query_as("SELECT payload FROM app_estado WHERE id = $1")
                .bind(id)
                .fetch_optional(&self.pool)
                .await?;
        Ok(row.map(|r| r.0))
    }

    pub async fn set_state(&self, id: &str, payload: &Value) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO app_estado (id, payload, updated_at) VALUES ($1, $2, NOW())
             ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()",
        )
        .bind(id)
        .bind(payload)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

pub fn db_error(e: sqlx::Error) -> (StatusCode, String) {
    tracing::error!(error = %e, "db error");
    (StatusCode::INTERNAL_SERVER_ERROR, "Error de base de datos".into())
}
