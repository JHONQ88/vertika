use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};

#[derive(Debug)]
pub enum ApiError {
    BadRequest(String),
    Unauthorized(String),
    Forbidden(String),
    NotFound(String),
    Conflict(String),
    Unprocessable {
        message: String,
        details: Option<Value>,
    },
    Internal(String),
}

impl ApiError {
    pub fn unprocessable(message: impl Into<String>) -> Self {
        Self::Unprocessable {
            message: message.into(),
            details: None,
        }
    }

    pub fn unprocessable_with(message: impl Into<String>, details: Value) -> Self {
        Self::Unprocessable {
            message: message.into(),
            details: Some(details),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, code, message, details) = match self {
            ApiError::BadRequest(m) => (StatusCode::BAD_REQUEST, "BAD_REQUEST", m, None),
            ApiError::Unauthorized(m) => (StatusCode::UNAUTHORIZED, "UNAUTHORIZED", m, None),
            ApiError::Forbidden(m) => (StatusCode::FORBIDDEN, "FORBIDDEN", m, None),
            ApiError::NotFound(m) => (StatusCode::NOT_FOUND, "NOT_FOUND", m, None),
            ApiError::Conflict(m) => (StatusCode::CONFLICT, "CONFLICT", m, None),
            ApiError::Unprocessable { message, details } => {
                (StatusCode::UNPROCESSABLE_ENTITY, "VALIDATION_ERROR", message, details)
            }
            ApiError::Internal(m) => (StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", m, None),
        };
        (
            status,
            Json(json!({
                "error": message,
                "code": code,
                "details": details,
            })),
        )
            .into_response()
    }
}

fn internal_db_error(err: &sqlx::Error) -> ApiError {
    #[cfg(test)]
    {
        ApiError::Internal(format!("Error de base de datos: {err}"))
    }
    #[cfg(not(test))]
    {
        let _ = err;
        ApiError::Internal("Error de base de datos".into())
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(err: sqlx::Error) -> Self {
        if let sqlx::Error::Database(db_err) = &err {
            let code = db_err.code();
            let code_str = code.as_deref().unwrap_or("");
            let msg = db_err.message().to_string();
            return match code_str {
                "23505" => ApiError::Conflict(format!("Registro duplicado: {msg}")),
                "23514" | "23503" => ApiError::Unprocessable {
                    message: format!("Violación de integridad contable: {msg}"),
                    details: None,
                },
                "P0001" => ApiError::Conflict(msg),
                _ => {
                    tracing::error!(error = %err, code = code_str, "Database error");
                    internal_db_error(&err)
                }
            };
        }
        if matches!(err, sqlx::Error::RowNotFound) {
            return ApiError::NotFound("Recurso no encontrado".into());
        }
        tracing::error!(error = %err, "Database error");
        internal_db_error(&err)
    }
}
