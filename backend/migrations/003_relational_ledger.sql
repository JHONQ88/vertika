-- Vértika · Bloque B: normalización relacional, FKs, índices y triggers ACID del ledger

ALTER TABLE copropiedades
    ADD COLUMN IF NOT EXISTS slug VARCHAR(80) UNIQUE,
    ADD COLUMN IF NOT EXISTS sigla VARCHAR(16) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS ciudad VARCHAR(120) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS direccion VARCHAR(240) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS presupuesto_anual NUMERIC(18,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS saldos_iniciales JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS escala NUMERIC(8,4) NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS color VARCHAR(32) NOT NULL DEFAULT '#0E9F6E';

ALTER TABLE unidades_inmobiliarias
    ADD COLUMN IF NOT EXISTS clave_externa VARCHAR(120) UNIQUE;

ALTER TABLE terceros
    ADD COLUMN IF NOT EXISTS clave_externa VARCHAR(120) UNIQUE,
    ADD COLUMN IF NOT EXISTS no_obligado BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE rubros_presupuestales
    ADD COLUMN IF NOT EXISTS clave_externa VARCHAR(120) UNIQUE;

ALTER TABLE puc_esal_cuentas
    ADD COLUMN IF NOT EXISTS es_efectivo BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS restringida BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS nota TEXT;

ALTER TABLE comprobantes_contables
    ADD COLUMN IF NOT EXISTS clave_externa VARCHAR(120) UNIQUE,
    ADD COLUMN IF NOT EXISTS anulado_por_id UUID REFERENCES comprobantes_contables(id);

ALTER TABLE movimientos_ledger
    ADD COLUMN IF NOT EXISTS copropiedad_id UUID REFERENCES copropiedades(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS linea_orden INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS clave_externa VARCHAR(120);

ALTER TABLE pre_asientos
    ADD COLUMN IF NOT EXISTS clave_externa VARCHAR(120) UNIQUE,
    ADD COLUMN IF NOT EXISTS unidad_id UUID REFERENCES unidades_inmobiliarias(id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_mov_puc_cuenta'
    ) THEN
        ALTER TABLE movimientos_ledger
            ADD CONSTRAINT fk_mov_puc_cuenta
            FOREIGN KEY (copropiedad_id, cuenta_codigo)
            REFERENCES puc_esal_cuentas(copropiedad_id, codigo_cuenta)
            ON DELETE RESTRICT;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pre_asientos_emp_estado
    ON pre_asientos(copropiedad_id, estado);

CREATE INDEX IF NOT EXISTS idx_auditoria_emp_ts
    ON auditoria_eventos(copropiedad_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mov_copropiedad_cuenta
    ON movimientos_ledger(copropiedad_id, cuenta_codigo);

CREATE OR REPLACE FUNCTION fn_validar_cuadre_comprobante()
RETURNS TRIGGER AS $$
DECLARE
    cid UUID;
    v_total_d NUMERIC(18,2);
    v_total_c NUMERIC(18,2);
    v_cnt BIGINT;
    v_comp_d NUMERIC(18,2);
    v_comp_c NUMERIC(18,2);
BEGIN
    IF current_setting('vertika.allow_reset', true) = 'on' THEN
        RETURN NULL;
    END IF;

    cid := COALESCE(NEW.comprobante_id, OLD.comprobante_id);
    IF cid IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT total_debito, total_credito
      INTO v_comp_d, v_comp_c
      FROM comprobantes_contables
     WHERE id = cid;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    SELECT COUNT(*), COALESCE(SUM(debito), 0), COALESCE(SUM(credito), 0)
      INTO v_cnt, v_total_d, v_total_c
      FROM movimientos_ledger
     WHERE comprobante_id = cid;

    IF v_cnt < 2 THEN
        RAISE EXCEPTION 'El comprobante % debe tener al menos 2 movimientos en el ledger', cid
            USING ERRCODE = 'check_violation';
    END IF;

    IF v_total_d <> v_total_c OR v_total_d <> v_comp_d OR v_total_c <> v_comp_c THEN
        RAISE EXCEPTION 'El comprobante % está descuadrado en el ledger: D=% C=%', cid, v_total_d, v_total_c
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validar_cuadre_comprobante ON movimientos_ledger;
CREATE CONSTRAINT TRIGGER trg_validar_cuadre_comprobante
AFTER INSERT OR UPDATE OR DELETE ON movimientos_ledger
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION fn_validar_cuadre_comprobante();

CREATE OR REPLACE FUNCTION fn_bloquear_periodo_cerrado()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM periodos_cerrados
         WHERE copropiedad_id = NEW.copropiedad_id
           AND periodo = NEW.periodo
    ) THEN
        RAISE EXCEPTION 'El periodo % está cerrado para esta copropiedad', NEW.periodo
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bloquear_periodo_cerrado ON comprobantes_contables;
CREATE TRIGGER trg_bloquear_periodo_cerrado
BEFORE INSERT ON comprobantes_contables
FOR EACH ROW
EXECUTE FUNCTION fn_bloquear_periodo_cerrado();

CREATE OR REPLACE FUNCTION fn_inmutabilidad_comprobante()
RETURNS TRIGGER AS $$
BEGIN
    IF current_setting('vertika.allow_reset', true) = 'on' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Los comprobantes contables son inmutables y no pueden eliminarse'
            USING ERRCODE = 'P0001';
    END IF;

    IF OLD.estado = 'ANULADO' THEN
        RAISE EXCEPTION 'Un comprobante anulado es inmutable'
            USING ERRCODE = 'P0001';
    END IF;

    IF OLD.estado = 'ASENTADO' THEN
        IF NEW.estado <> 'ANULADO'
           OR NEW.copropiedad_id IS DISTINCT FROM OLD.copropiedad_id
           OR NEW.tipo_documento IS DISTINCT FROM OLD.tipo_documento
           OR NEW.consecutivo IS DISTINCT FROM OLD.consecutivo
           OR NEW.periodo IS DISTINCT FROM OLD.periodo
           OR NEW.fecha_contable IS DISTINCT FROM OLD.fecha_contable
           OR NEW.total_debito IS DISTINCT FROM OLD.total_debito
           OR NEW.total_credito IS DISTINCT FROM OLD.total_credito
           OR NEW.hash_contenido IS DISTINCT FROM OLD.hash_contenido
           OR NEW.descripcion IS DISTINCT FROM OLD.descripcion
        THEN
            RAISE EXCEPTION 'Los comprobantes asentados son inmutables; solo pueden anularse vía reversión'
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inmutabilidad_comprobante ON comprobantes_contables;
CREATE TRIGGER trg_inmutabilidad_comprobante
BEFORE UPDATE OR DELETE ON comprobantes_contables
FOR EACH ROW
EXECUTE FUNCTION fn_inmutabilidad_comprobante();

CREATE OR REPLACE FUNCTION fn_inmutabilidad_movimientos()
RETURNS TRIGGER AS $$
DECLARE
    v_estado VARCHAR(20);
BEGIN
    IF current_setting('vertika.allow_reset', true) = 'on' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    SELECT estado INTO v_estado
      FROM comprobantes_contables
     WHERE id = OLD.comprobante_id;

    IF v_estado IN ('ASENTADO', 'ANULADO') THEN
        RAISE EXCEPTION 'Los movimientos de un comprobante % son inmutables', v_estado
            USING ERRCODE = 'P0001';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inmutabilidad_movimientos ON movimientos_ledger;
CREATE TRIGGER trg_inmutabilidad_movimientos
BEFORE UPDATE OR DELETE ON movimientos_ledger
FOR EACH ROW
EXECUTE FUNCTION fn_inmutabilidad_movimientos();
