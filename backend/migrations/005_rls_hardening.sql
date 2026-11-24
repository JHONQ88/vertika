-- Vértika · Hardening RLS en terceros, vínculos y tags NFC

ALTER TABLE terceros ENABLE ROW LEVEL SECURITY;
ALTER TABLE vinculos_unidad_tercero ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags_nfc ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'terceros' AND policyname = 'tenant_isolation_terceros'
    ) THEN
        CREATE POLICY tenant_isolation_terceros ON terceros
            USING (
                copropiedad_id IS NULL
                OR NULLIF(current_setting('app.current_copropiedad_id', true), '') IS NULL
                OR copropiedad_id = NULLIF(current_setting('app.current_copropiedad_id', true), '')::uuid
            )
            WITH CHECK (
                copropiedad_id IS NULL
                OR NULLIF(current_setting('app.current_copropiedad_id', true), '') IS NULL
                OR copropiedad_id = NULLIF(current_setting('app.current_copropiedad_id', true), '')::uuid
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'vinculos_unidad_tercero' AND policyname = 'tenant_isolation_vinculos_unidad_tercero'
    ) THEN
        CREATE POLICY tenant_isolation_vinculos_unidad_tercero ON vinculos_unidad_tercero
            USING (
                NULLIF(current_setting('app.current_copropiedad_id', true), '') IS NULL
                OR EXISTS (
                    SELECT 1 FROM unidades_inmobiliarias u
                     WHERE u.id = vinculos_unidad_tercero.unidad_id
                       AND u.copropiedad_id = NULLIF(current_setting('app.current_copropiedad_id', true), '')::uuid
                )
            )
            WITH CHECK (
                NULLIF(current_setting('app.current_copropiedad_id', true), '') IS NULL
                OR EXISTS (
                    SELECT 1 FROM unidades_inmobiliarias u
                     WHERE u.id = vinculos_unidad_tercero.unidad_id
                       AND u.copropiedad_id = NULLIF(current_setting('app.current_copropiedad_id', true), '')::uuid
                )
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'tags_nfc' AND policyname = 'tenant_isolation_tags_nfc'
    ) THEN
        CREATE POLICY tenant_isolation_tags_nfc ON tags_nfc
            USING (
                NULLIF(current_setting('app.current_copropiedad_id', true), '') IS NULL
                OR EXISTS (
                    SELECT 1 FROM unidades_inmobiliarias u
                     WHERE u.id = tags_nfc.unidad_id
                       AND u.copropiedad_id = NULLIF(current_setting('app.current_copropiedad_id', true), '')::uuid
                )
            )
            WITH CHECK (
                NULLIF(current_setting('app.current_copropiedad_id', true), '') IS NULL
                OR EXISTS (
                    SELECT 1 FROM unidades_inmobiliarias u
                     WHERE u.id = tags_nfc.unidad_id
                       AND u.copropiedad_id = NULLIF(current_setting('app.current_copropiedad_id', true), '')::uuid
                )
            );
    END IF;
END $$;
