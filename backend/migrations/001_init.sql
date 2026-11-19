-- Vértika · Esquema inicial PostgreSQL (multi-copropiedad, ledger partida doble)
-- Basado en el blueprint del producto. Ejecutar con psql o sqlx migrate.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Copropiedades
CREATE TABLE IF NOT EXISTS copropiedades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nit VARCHAR(20) UNIQUE NOT NULL,
    razon_social VARCHAR(200) NOT NULL,
    nombre_corto VARCHAR(120),
    grupo_niif SMALLINT NOT NULL CHECK (grupo_niif IN (2, 3)),
    porcentaje_fondo_imprevistos NUMERIC(5,2) DEFAULT 1.00,
    tasa_mora_mensual NUMERIC(6,4) NOT NULL DEFAULT 0.0150,
    dia_corte_pronto_pago SMALLINT DEFAULT 10,
    descuento_pronto_pago_pct NUMERIC(5,2) DEFAULT 0,
    llave_bre_b VARCHAR(100),
    periodo_actual CHAR(7) NOT NULL, -- YYYY-MM
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Unidades inmobiliarias
CREATE TABLE IF NOT EXISTS unidades_inmobiliarias (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    copropiedad_id UUID NOT NULL REFERENCES copropiedades(id) ON DELETE CASCADE,
    grupo_torre VARCHAR(20) NOT NULL,
    numero_unidad VARCHAR(20) NOT NULL,
    tipo VARCHAR(30),
    area NUMERIC(10,2),
    matricula_inmobiliaria VARCHAR(50),
    coeficiente NUMERIC(9,6) NOT NULL CHECK (coeficiente > 0),
    esta_arrendado BOOLEAN NOT NULL DEFAULT FALSE,
    cartera_congelada BOOLEAN NOT NULL DEFAULT FALSE,
    fecha_congelacion DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (copropiedad_id, grupo_torre, numero_unidad)
);

-- 3. Terceros
CREATE TABLE IF NOT EXISTS terceros (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    copropiedad_id UUID REFERENCES copropiedades(id) ON DELETE CASCADE, -- NULL = proveedor global
    nombre VARCHAR(200) NOT NULL,
    tipo VARCHAR(30) NOT NULL, -- PROVEEDOR|PROPIETARIO|ARRENDATARIO|EMPLEADO|BANCO
    documento VARCHAR(30) NOT NULL,
    dv VARCHAR(2),
    email VARCHAR(200),
    telefono VARCHAR(40),
    ciudad VARCHAR(120),
    retefuente_pct NUMERIC(6,3) NOT NULL DEFAULT 0,
    reteica_pct NUMERIC(6,3) NOT NULL DEFAULT 0,
    reteiva_pct NUMERIC(6,3) NOT NULL DEFAULT 0,
    regimen_especial BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Vínculos unidad-tercero
CREATE TABLE IF NOT EXISTS vinculos_unidad_tercero (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unidad_id UUID NOT NULL REFERENCES unidades_inmobiliarias(id) ON DELETE CASCADE,
    tercero_id UUID NOT NULL REFERENCES terceros(id) ON DELETE RESTRICT,
    rol_en_unidad VARCHAR(20) NOT NULL CHECK (rol_en_unidad IN ('PROPIETARIO', 'ARRENDATARIO')),
    recibe_cobro_ordinario BOOLEAN NOT NULL DEFAULT TRUE,
    recibe_cobro_extraordinario BOOLEAN NOT NULL DEFAULT FALSE,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (unidad_id, tercero_id, rol_en_unidad)
);

-- 5. Tags NFC
CREATE TABLE IF NOT EXISTS tags_nfc (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unidad_id UUID NOT NULL REFERENCES unidades_inmobiliarias(id) ON DELETE CASCADE,
    uid_fisico_chip VARCHAR(64) UNIQUE NOT NULL,
    tipo_tag VARCHAR(20) NOT NULL CHECK (tipo_tag IN ('STICKER_PAGO', 'LLAVERO_ACCESO')),
    token_url_firmado VARCHAR(255) UNIQUE NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Catálogo PUC ESAL por copropiedad
CREATE TABLE IF NOT EXISTS puc_esal_cuentas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    copropiedad_id UUID NOT NULL REFERENCES copropiedades(id) ON DELETE CASCADE,
    codigo_cuenta VARCHAR(20) NOT NULL,
    nombre_cuenta VARCHAR(150) NOT NULL,
    tipo_cuenta VARCHAR(20) NOT NULL CHECK (tipo_cuenta IN ('ACTIVO','PASIVO','PATRIMONIO','INGRESO','GASTO')),
    naturaleza CHAR(1) NOT NULL CHECK (naturaleza IN ('D','C')),
    rubro_presupuesto_key VARCHAR(20),
    requiere_tercero BOOLEAN NOT NULL DEFAULT FALSE,
    requiere_unidad BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (copropiedad_id, codigo_cuenta)
);

-- 7. Rubros presupuestales
CREATE TABLE IF NOT EXISTS rubros_presupuestales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    copropiedad_id UUID NOT NULL REFERENCES copropiedades(id) ON DELETE CASCADE,
    clave VARCHAR(20) NOT NULL,
    nombre VARCHAR(150) NOT NULL,
    cuenta_codigo VARCHAR(20) NOT NULL,
    centro_costo VARCHAR(120),
    presupuesto_anual NUMERIC(18,2) NOT NULL DEFAULT 0,
    UNIQUE (copropiedad_id, clave)
);

-- 8. Comprobantes contables (cabecera)
CREATE TABLE IF NOT EXISTS comprobantes_contables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    copropiedad_id UUID NOT NULL REFERENCES copropiedades(id) ON DELETE RESTRICT,
    tipo_documento VARCHAR(10) NOT NULL, -- CC|RC|CE|NC|DS
    consecutivo BIGINT NOT NULL,
    periodo CHAR(7) NOT NULL,
    fecha_contable DATE NOT NULL,
    origen_creacion VARCHAR(40) NOT NULL,
    estado VARCHAR(20) NOT NULL DEFAULT 'ASENTADO' CHECK (estado IN ('BORRADOR_IA','ASENTADO','ANULADO')),
    descripcion TEXT NOT NULL,
    referencia VARCHAR(120),
    total_debito NUMERIC(18,2) NOT NULL DEFAULT 0,
    total_credito NUMERIC(18,2) NOT NULL DEFAULT 0,
    hash_contenido VARCHAR(64),
    url_soporte TEXT,
    creado_por VARCHAR(120),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (copropiedad_id, tipo_documento, consecutivo),
    CONSTRAINT comprobante_cuadra CHECK (total_debito = total_credito)
);

-- 9. Movimientos del ledger (partida doble)
CREATE TABLE IF NOT EXISTS movimientos_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    comprobante_id UUID NOT NULL REFERENCES comprobantes_contables(id) ON DELETE CASCADE,
    cuenta_codigo VARCHAR(20) NOT NULL,
    unidad_id UUID REFERENCES unidades_inmobiliarias(id),
    tercero_id UUID REFERENCES terceros(id),
    rubro_id UUID REFERENCES rubros_presupuestales(id),
    debito NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (debito >= 0),
    credito NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (credito >= 0),
    descripcion VARCHAR(250) NOT NULL,
    CONSTRAINT movimiento_un_lado CHECK (NOT (debito > 0 AND credito > 0)),
    CONSTRAINT movimiento_monto CHECK (debito > 0 OR credito > 0)
);

CREATE INDEX IF NOT EXISTS idx_mov_comprobante ON movimientos_ledger(comprobante_id);
CREATE INDEX IF NOT EXISTS idx_mov_cuenta ON movimientos_ledger(cuenta_codigo);
CREATE INDEX IF NOT EXISTS idx_comp_empresa_periodo ON comprobantes_contables(copropiedad_id, periodo);

-- 10. Pre-asientos propuestos por agentes/ingesta
CREATE TABLE IF NOT EXISTS pre_asientos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    copropiedad_id UUID NOT NULL REFERENCES copropiedades(id) ON DELETE CASCADE,
    periodo CHAR(7) NOT NULL,
    tipo_documento VARCHAR(10) NOT NULL,
    fecha DATE NOT NULL,
    agente VARCHAR(60) NOT NULL,
    confianza NUMERIC(5,2),
    tercero_id UUID REFERENCES terceros(id),
    rubro_id UUID REFERENCES rubros_presupuestales(id),
    descripcion TEXT NOT NULL,
    documento_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    lineas_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE','APROBADO','RECHAZADO')),
    notas JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. Auditoría
CREATE TABLE IF NOT EXISTS auditoria_eventos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    copropiedad_id UUID REFERENCES copropiedades(id) ON DELETE SET NULL,
    actor VARCHAR(120) NOT NULL,
    accion VARCHAR(120) NOT NULL,
    detalle TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. Periodos cerrados por copropiedad
CREATE TABLE IF NOT EXISTS periodos_cerrados (
    copropiedad_id UUID NOT NULL REFERENCES copropiedades(id) ON DELETE CASCADE,
    periodo CHAR(7) NOT NULL,
    cerrado_por VARCHAR(120),
    comprobante_cierre_id UUID REFERENCES comprobantes_contables(id),
    cerrado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (copropiedad_id, periodo)
);

-- Nota: en producción agregar Row-Level Security (RLS) por copropiedad_id,
-- políticas por rol (contador/administrador/revisor) y triggers para validar
-- SUM(debito)=SUM(credito) a nivel transaccional por comprobante.
