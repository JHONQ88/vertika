-- Vértika · Bloque C: usuarios, RBAC por copropiedad y Row-Level Security (RLS)

CREATE TABLE IF NOT EXISTS usuarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(200) UNIQUE NOT NULL,
    nombre VARCHAR(160) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS usuario_copropiedad_roles (
    usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    copropiedad_id UUID NOT NULL REFERENCES copropiedades(id) ON DELETE CASCADE,
    rol VARCHAR(30) NOT NULL CHECK (rol IN ('CONTADOR', 'ADMINISTRADOR', 'REVISOR_FISCAL', 'CONSEJO')),
    PRIMARY KEY (usuario_id, copropiedad_id)
);

ALTER TABLE unidades_inmobiliarias ENABLE ROW LEVEL SECURITY;
ALTER TABLE rubros_presupuestales ENABLE ROW LEVEL SECURITY;
ALTER TABLE puc_esal_cuentas ENABLE ROW LEVEL SECURITY;
ALTER TABLE comprobantes_contables ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimientos_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE pre_asientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE periodos_cerrados ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria_eventos ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    tbl TEXT;
    pol TEXT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'unidades_inmobiliarias',
        'rubros_presupuestales',
        'puc_esal_cuentas',
        'comprobantes_contables',
        'movimientos_ledger',
        'pre_asientos',
        'periodos_cerrados',
        'auditoria_eventos'
    ]
    LOOP
        pol := 'tenant_isolation_' || tbl;
        IF NOT EXISTS (
            SELECT 1
              FROM pg_policies
             WHERE schemaname = 'public'
               AND tablename = tbl
               AND policyname = pol
        ) THEN
            EXECUTE format(
                'CREATE POLICY %I ON %I
                 USING (
                     NULLIF(current_setting(''app.current_copropiedad_id'', true), '''') IS NULL
                     OR copropiedad_id = NULLIF(current_setting(''app.current_copropiedad_id'', true), '''')::uuid
                 )
                 WITH CHECK (
                     NULLIF(current_setting(''app.current_copropiedad_id'', true), '''') IS NULL
                     OR copropiedad_id = NULLIF(current_setting(''app.current_copropiedad_id'', true), '''')::uuid
                 )',
                pol,
                tbl
            );
        END IF;
    END LOOP;
END $$;
