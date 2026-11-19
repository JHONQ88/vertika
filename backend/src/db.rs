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
        sqlx::migrate!("./migrations").run(&pool).await?;
        Ok(Self { pool })
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
