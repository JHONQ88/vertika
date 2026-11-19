-- Estado de aplicación para integración rápida frontend-backend (MVP).
-- El esquema relacional (001) permanece como base para normalización progresiva.
CREATE TABLE IF NOT EXISTS app_estado (
    id TEXT PRIMARY KEY,
    payload JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
