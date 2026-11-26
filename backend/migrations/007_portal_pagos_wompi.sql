-- Vértika · Portal de Propietarios/Inquilinos, Links de Pago y Conciliación Automática Wompi

ALTER TABLE copropiedades
    ADD COLUMN IF NOT EXISTS wompi_public_key VARCHAR(120) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS wompi_integrity_secret VARCHAR(160) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS wompi_events_secret VARCHAR(160) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS wompi_sandbox BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS intenciones_pago (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    copropiedad_id UUID NOT NULL REFERENCES copropiedades(id) ON DELETE CASCADE,
    unidad_id UUID NOT NULL REFERENCES unidades_inmobiliarias(id) ON DELETE CASCADE,
    tercero_id UUID REFERENCES terceros(id) ON DELETE SET NULL,
    referencia VARCHAR(120) UNIQUE NOT NULL,
    periodo CHAR(7) NOT NULL,
    monto_capital NUMERIC(18,2) NOT NULL DEFAULT 0,
    monto_mora NUMERIC(18,2) NOT NULL DEFAULT 0,
    monto_descuento NUMERIC(18,2) NOT NULL DEFAULT 0,
    monto_total NUMERIC(18,2) NOT NULL,
    estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE'
        CHECK (estado IN ('PENDIENTE', 'APROBADA', 'RECHAZADA', 'EXPIRADA')),
    pasarela VARCHAR(30) NOT NULL DEFAULT 'WOMPI',
    pasarela_tx_id VARCHAR(120),
    comprobante_rc_id UUID REFERENCES comprobantes_contables(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    paid_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_intenciones_pago_unidad
    ON intenciones_pago (copropiedad_id, unidad_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_intenciones_pago_ref
    ON intenciones_pago (referencia);
