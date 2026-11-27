ALTER TABLE copropiedades
  ADD COLUMN IF NOT EXISTS portal_logo_url TEXT NOT NULL DEFAULT '';

ALTER TABLE copropiedades
  ADD COLUMN IF NOT EXISTS portal_cover_url TEXT NOT NULL DEFAULT '';

ALTER TABLE copropiedades
  ADD COLUMN IF NOT EXISTS portal_color_primario TEXT NOT NULL DEFAULT '#0F766E';

ALTER TABLE copropiedades
  ADD COLUMN IF NOT EXISTS portal_mensaje_bienvenida TEXT NOT NULL DEFAULT '';

ALTER TABLE copropiedades
  ADD COLUMN IF NOT EXISTS portal_whatsapp_soporte TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS envios_cobro (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  copropiedad_id UUID NOT NULL REFERENCES copropiedades(id) ON DELETE CASCADE,
  unidad_id UUID REFERENCES unidades_inmobiliarias(id) ON DELETE SET NULL,
  periodo VARCHAR(7) NOT NULL,
  email_destino TEXT NOT NULL,
  canal VARCHAR(24) NOT NULL DEFAULT 'EMAIL',
  estado VARCHAR(24) NOT NULL,
  proveedor_id TEXT,
  detalle_error TEXT,
  creado_por TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_envios_cobro_comp_periodo
  ON envios_cobro (copropiedad_id, periodo, created_at DESC);
