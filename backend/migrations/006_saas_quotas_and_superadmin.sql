-- Vértika · SaaS Control: SUPER_ADMIN, cupos de copropiedades (quotas) y vigencia de pruebas

ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS max_copropiedades INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS plan_nombre VARCHAR(60) NOT NULL DEFAULT 'PRUEBA',
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS created_by UUID NULL REFERENCES usuarios(id) ON DELETE SET NULL;

ALTER TABLE copropiedades
    ADD COLUMN IF NOT EXISTS owner_user_id UUID NULL REFERENCES usuarios(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_copropiedades_owner_user_id
    ON copropiedades (owner_user_id);

CREATE INDEX IF NOT EXISTS idx_usuarios_super_admin
    ON usuarios (is_super_admin)
    WHERE is_super_admin = TRUE;
