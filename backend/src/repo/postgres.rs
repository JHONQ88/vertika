use crate::db::Db;
use crate::domain::{
    demo_puc, ledger, ApproveResult, BootstrapDatos, ClosePeriodRequest, ClosePeriodResult,
    CreateEntryRequest, FrontendAuditoria, FrontendComprobante, FrontendCopropiedad,
    FrontendEstadoApp, FrontendLinea, FrontendPreAsiento, FrontendRubro, FrontendTercero,
    FrontendUnidad, LedgerAccount, PostEntryResult, ThirdParty, VoidEntryResult,
};
use crate::error::ApiError;
use crate::repo::{
    build_reversal_lines, closing_audit_detail, last_day_of_period, normalize_frontend_lines,
    origin_from_agent, parse_seed_bundle, validate_and_hash_frontend_lines,
};
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde_json::{json, Value};
use sqlx::{Postgres, Row, Transaction};
use std::collections::HashMap;
use uuid::Uuid;

pub struct PostgresRepo {
    db: Db,
    seed: Value,
}

struct CompanyRow {
    uuid: Uuid,
    slug: String,
    nombre_corto: String,
    periodo_actual: String,
    escala: Decimal,
    saldos_iniciales: Value,
}

impl PostgresRepo {
    pub async fn init(db: Db, seed: Value) -> Result<Self, ApiError> {
        let repo = Self { db, seed };
        repo.seed_relational_if_empty().await?;
        Ok(repo)
    }

    async fn seed_relational_if_empty(&self) -> Result<(), ApiError> {
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM copropiedades")
            .fetch_one(&self.db.pool)
            .await?;
        if count > 0 {
            return Ok(());
        }
        let mut tx = self.db.pool.begin().await?;
        Self::seed_relational_in_tx(&mut tx, &self.seed).await?;
        tx.commit().await?;
        Ok(())
    }

    async fn seed_relational_in_tx(
        tx: &mut Transaction<'_, Postgres>,
        seed: &Value,
    ) -> Result<(), ApiError> {
        let (datos, estado) = parse_seed_bundle(seed)?;
        let puc = demo_puc();

        let mut company_uuids: HashMap<String, Uuid> = HashMap::new();
        for c in &datos.companies {
            let cid = Uuid::new_v4();
            let saldos_json = serde_json::to_value(&c.saldos_iniciales).unwrap_or_else(|_| json!({}));
            sqlx::query(
                "INSERT INTO copropiedades (
                    id, slug, nit, razon_social, nombre_corto, sigla, ciudad, direccion,
                    grupo_niif, porcentaje_fondo_imprevistos, tasa_mora_mensual,
                    dia_corte_pronto_pago, descuento_pronto_pago_pct, llave_bre_b,
                    presupuesto_anual, periodo_actual, saldos_iniciales, escala, color
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)",
            )
            .bind(cid)
            .bind(&c.id)
            .bind(&c.nit)
            .bind(&c.razon_social)
            .bind(&c.nombre_corto)
            .bind(&c.sigla)
            .bind(&c.ciudad)
            .bind(&c.direccion)
            .bind(c.grupo_niif)
            .bind(c.fondo_imprevistos_pct)
            .bind(c.tasa_mora_mensual)
            .bind(c.dia_corte_pronto_pago)
            .bind(c.descuento_pronto_pago_pct)
            .bind(&c.llave_bre_b)
            .bind(c.presupuesto_anual)
            .bind(&c.periodo_actual)
            .bind(&saldos_json)
            .bind(c.escala)
            .bind(&c.color)
            .execute(&mut **tx)
            .await?;

            for acc in &puc {
                sqlx::query(
                    "INSERT INTO puc_esal_cuentas (
                        copropiedad_id, codigo_cuenta, nombre_cuenta, tipo_cuenta, naturaleza,
                        rubro_presupuesto_key, requiere_tercero, requiere_unidad,
                        es_efectivo, restringida, nota
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
                )
                .bind(cid)
                .bind(&acc.code)
                .bind(&acc.name)
                .bind(&acc.account_type)
                .bind(&acc.nature)
                .bind(&acc.rubric_key)
                .bind(acc.requires_third_party)
                .bind(acc.requires_unit)
                .bind(acc.is_cash)
                .bind(acc.restricted)
                .bind(&acc.note)
                .execute(&mut **tx)
                .await?;
            }
            company_uuids.insert(c.id.clone(), cid);
        }

        let mut tercero_uuids: HashMap<String, Uuid> = HashMap::new();
        for t in &datos.terceros {
            let tid = Uuid::new_v4();
            let cid = t
                .empresa_id
                .as_ref()
                .and_then(|eid| company_uuids.get(eid).copied());
            sqlx::query(
                "INSERT INTO terceros (
                    id, clave_externa, copropiedad_id, nombre, tipo, documento, dv,
                    email, telefono, ciudad, retefuente_pct, reteica_pct, reteiva_pct,
                    regimen_especial, no_obligado
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
            )
            .bind(tid)
            .bind(&t.id)
            .bind(cid)
            .bind(&t.nombre)
            .bind(&t.tipo)
            .bind(&t.documento)
            .bind(&t.dv)
            .bind(&t.email)
            .bind(&t.telefono)
            .bind(&t.ciudad)
            .bind(t.retefuente_pct)
            .bind(t.reteica_pct)
            .bind(t.reteiva_pct)
            .bind(t.regimen_especial.unwrap_or(false))
            .bind(t.no_obligado)
            .execute(&mut **tx)
            .await?;
            tercero_uuids.insert(t.id.clone(), tid);
        }

        let mut unit_uuids: HashMap<String, Uuid> = HashMap::new();
        for u in &datos.units {
            let uid = Uuid::new_v4();
            let cid = *company_uuids
                .get(&u.empresa_id)
                .ok_or_else(|| ApiError::Internal(format!("Empresa desconocida en unidad {}", u.id)))?;
            sqlx::query(
                "INSERT INTO unidades_inmobiliarias (
                    id, clave_externa, copropiedad_id, grupo_torre, numero_unidad, tipo,
                    area, matricula_inmobiliaria, coeficiente, esta_arrendado, cartera_congelada
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
            )
            .bind(uid)
            .bind(&u.id)
            .bind(cid)
            .bind(&u.torre)
            .bind(&u.numero)
            .bind(&u.tipo)
            .bind(u.area)
            .bind(&u.matricula)
            .bind(u.coeficiente)
            .bind(u.arrendatario_id.is_some())
            .bind(u.cartera_congelada)
            .execute(&mut **tx)
            .await?;

            if let Some(prop_uuid) = tercero_uuids.get(&u.propietario_id) {
                sqlx::query(
                    "INSERT INTO vinculos_unidad_tercero (unidad_id, tercero_id, rol_en_unidad)
                     VALUES ($1, $2, 'PROPIETARIO')",
                )
                .bind(uid)
                .bind(*prop_uuid)
                .execute(&mut **tx)
                .await?;
            }
            if let Some(arr_id) = &u.arrendatario_id {
                if let Some(arr_uuid) = tercero_uuids.get(arr_id) {
                    sqlx::query(
                        "INSERT INTO vinculos_unidad_tercero (unidad_id, tercero_id, rol_en_unidad)
                         VALUES ($1, $2, 'ARRENDATARIO')",
                    )
                    .bind(uid)
                    .bind(*arr_uuid)
                    .execute(&mut **tx)
                    .await?;
                }
            }
            unit_uuids.insert(u.id.clone(), uid);
        }

        let mut rubro_uuids: HashMap<String, Uuid> = HashMap::new();
        for r in &datos.rubros {
            let rid = Uuid::new_v4();
            let cid = *company_uuids
                .get(&r.empresa_id)
                .ok_or_else(|| ApiError::Internal(format!("Empresa desconocida en rubro {}", r.id)))?;
            sqlx::query(
                "INSERT INTO rubros_presupuestales (
                    id, clave_externa, copropiedad_id, clave, nombre, cuenta_codigo, centro_costo, presupuesto_anual
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
            )
            .bind(rid)
            .bind(&r.id)
            .bind(cid)
            .bind(&r.key)
            .bind(&r.nombre)
            .bind(&r.cuenta)
            .bind(&r.centro)
            .bind(r.presupuesto_anual)
            .execute(&mut **tx)
            .await?;
            rubro_uuids.insert(r.id.clone(), rid);
        }

        // Insertar comprobantes y movimientos ANTES de periodos_cerrados para no activar trg_bloquear_periodo_cerrado
        for c in &estado.comprobantes {
            let comp_uuid = Uuid::new_v4();
            let cid = *company_uuids
                .get(&c.empresa_id)
                .ok_or_else(|| ApiError::Internal(format!("Empresa desconocida en comprobante {}", c.id)))?;
            let fecha = parse_date(&c.fecha)?;
            let created_at = parse_ts_or_now(&c.created_at);

            sqlx::query(
                "INSERT INTO comprobantes_contables (
                    id, clave_externa, copropiedad_id, tipo_documento, consecutivo, periodo,
                    fecha_contable, origen_creacion, estado, descripcion, referencia,
                    total_debito, total_credito, hash_contenido, creado_por, created_at
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)",
            )
            .bind(comp_uuid)
            .bind(&c.id)
            .bind(cid)
            .bind(&c.tipo)
            .bind(c.consecutivo)
            .bind(&c.periodo)
            .bind(fecha)
            .bind(&c.origen)
            .bind(&c.estado)
            .bind(&c.descripcion)
            .bind(&c.referencia)
            .bind(c.total_debito)
            .bind(c.total_credito)
            .bind(&c.hash)
            .bind(&c.creado_por)
            .bind(created_at)
            .execute(&mut **tx)
            .await?;

            for (idx, l) in c.lineas.iter().enumerate() {
                let unit_uuid = l.unidad_id.as_ref().and_then(|u| unit_uuids.get(u).copied());
                let tp_uuid = l.tercero_id.as_ref().and_then(|t| tercero_uuids.get(t).copied());
                let rub_uuid = l.rubro_id.as_ref().and_then(|r| rubro_uuids.get(r).copied());
                sqlx::query(
                    "INSERT INTO movimientos_ledger (
                        comprobante_id, copropiedad_id, cuenta_codigo, unidad_id, tercero_id,
                        rubro_id, debito, credito, descripcion, linea_orden, clave_externa
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
                )
                .bind(comp_uuid)
                .bind(cid)
                .bind(&l.cuenta)
                .bind(unit_uuid)
                .bind(tp_uuid)
                .bind(rub_uuid)
                .bind(l.debito)
                .bind(l.credito)
                .bind(&l.descripcion)
                .bind(idx as i32)
                .bind(&l.id)
                .execute(&mut **tx)
                .await?;
            }
        }

        for p in &estado.pre_asientos {
            let pid = Uuid::new_v4();
            let cid = *company_uuids
                .get(&p.empresa_id)
                .ok_or_else(|| ApiError::Internal(format!("Empresa desconocida en pre-asiento {}", p.id)))?;
            let fecha = parse_date(&p.fecha)?;
            let tp_uuid = tercero_uuids.get(&p.tercero_id).copied();
            let unit_uuid = p.unidad_id.as_ref().and_then(|u| unit_uuids.get(u).copied());
            let rub_uuid = p.rubro_id.as_ref().and_then(|r| rubro_uuids.get(r).copied());
            let lineas_json = serde_json::to_value(&p.lineas).unwrap_or_else(|_| json!([]));
            let notas_json = serde_json::to_value(&p.notas).unwrap_or_else(|_| json!([]));

            sqlx::query(
                "INSERT INTO pre_asientos (
                    id, clave_externa, copropiedad_id, periodo, tipo_documento, fecha,
                    agente, confianza, tercero_id, unidad_id, rubro_id, descripcion,
                    documento_json, lineas_json, estado, notas
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)",
            )
            .bind(pid)
            .bind(&p.id)
            .bind(cid)
            .bind(&p.periodo)
            .bind(&p.tipo)
            .bind(fecha)
            .bind(&p.agente)
            .bind(p.confianza)
            .bind(tp_uuid)
            .bind(unit_uuid)
            .bind(rub_uuid)
            .bind(&p.descripcion)
            .bind(&p.documento)
            .bind(&lineas_json)
            .bind(&p.estado)
            .bind(&notas_json)
            .execute(&mut **tx)
            .await?;
        }

        for (emp_slug, periodos) in &estado.periodos_cerrados {
            let Some(&cid) = company_uuids.get(emp_slug) else {
                continue;
            };
            for per in periodos {
                sqlx::query(
                    "INSERT INTO periodos_cerrados (copropiedad_id, periodo, cerrado_por)
                     VALUES ($1, $2, 'Sistema')
                     ON CONFLICT DO NOTHING",
                )
                .bind(cid)
                .bind(per)
                .execute(&mut **tx)
                .await?;
            }
        }

        for a in &estado.auditoria {
            let cid = company_uuids.get(&a.empresa_id).copied();
            let ts = parse_ts_or_now(&a.ts);
            let meta = json!({ "external_id": a.id });
            sqlx::query(
                "INSERT INTO auditoria_eventos (copropiedad_id, actor, accion, detalle, metadata, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6)",
            )
            .bind(cid)
            .bind(&a.actor)
            .bind(&a.accion)
            .bind(&a.detalle)
            .bind(&meta)
            .bind(ts)
            .execute(&mut **tx)
            .await?;
        }

        sqlx::query("DELETE FROM app_estado")
            .execute(&mut **tx)
            .await?;

        Ok(())
    }

    async fn resolve_company_tx(
        tx: &mut Transaction<'_, Postgres>,
        id_or_slug: &str,
    ) -> Result<CompanyRow, ApiError> {
        let row = sqlx::query(
            "SELECT id, COALESCE(slug, id::text) AS slug, COALESCE(nombre_corto, razon_social) AS nombre_corto,
                    periodo_actual, escala, saldos_iniciales
               FROM copropiedades
              WHERE slug = $1 OR id::text = $1",
        )
        .bind(id_or_slug)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("Copropiedad '{id_or_slug}' no encontrada.")))?;

        Ok(CompanyRow {
            uuid: row.try_get("id")?,
            slug: row.try_get("slug")?,
            nombre_corto: row.try_get::<String, _>("nombre_corto")?,
            periodo_actual: row.try_get::<String, _>("periodo_actual")?.trim().to_string(),
            escala: row.try_get("escala")?,
            saldos_iniciales: row.try_get("saldos_iniciales")?,
        })
    }

    async fn ensure_period_open_tx(
        tx: &mut Transaction<'_, Postgres>,
        company: &CompanyRow,
        period: &str,
    ) -> Result<(), ApiError> {
        let closed: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM periodos_cerrados WHERE copropiedad_id = $1 AND periodo = $2)",
        )
        .bind(company.uuid)
        .bind(period)
        .fetch_one(&mut **tx)
        .await?;

        if closed {
            return Err(ApiError::Conflict(format!(
                "El periodo {period} está cerrado para {}.",
                company.nombre_corto
            )));
        }
        if period > company.periodo_actual.as_str() {
            return Err(ApiError::Conflict(format!(
                "El periodo {period} aún no está abierto para {}.",
                company.nombre_corto
            )));
        }
        Ok(())
    }

    async fn fetch_company_puc_tx(
        tx: &mut Transaction<'_, Postgres>,
        company_uuid: Uuid,
    ) -> Result<Vec<LedgerAccount>, ApiError> {
        let rows = sqlx::query(
            "SELECT codigo_cuenta, nombre_cuenta, tipo_cuenta, naturaleza, rubro_presupuesto_key,
                    requiere_tercero, requiere_unidad, es_efectivo, restringida, nota
               FROM puc_esal_cuentas
              WHERE copropiedad_id = $1
              ORDER BY codigo_cuenta",
        )
        .bind(company_uuid)
        .fetch_all(&mut **tx)
        .await?;

        if rows.is_empty() {
            return Ok(demo_puc());
        }
        let mut out = Vec::with_capacity(rows.len());
        for r in rows {
            out.push(LedgerAccount {
                code: r.try_get("codigo_cuenta")?,
                name: r.try_get("nombre_cuenta")?,
                account_type: r.try_get("tipo_cuenta")?,
                nature: r.try_get::<String, _>("naturaleza")?.trim().to_string(),
                rubric_key: r.try_get("rubro_presupuesto_key")?,
                requires_third_party: r.try_get("requiere_tercero")?,
                requires_unit: r.try_get("requiere_unidad")?,
                is_cash: r.try_get("es_efectivo")?,
                restricted: r.try_get("restringida")?,
                note: r.try_get("nota")?,
            });
        }
        Ok(out)
    }

    async fn resolve_optional_fk(
        tx: &mut Transaction<'_, Postgres>,
        table: &str,
        external_id: Option<&str>,
    ) -> Result<Option<Uuid>, ApiError> {
        let Some(ext) = external_id.filter(|s| !s.trim().is_empty()) else {
            return Ok(None);
        };
        let query = format!("SELECT id FROM {table} WHERE clave_externa = $1 OR id::text = $1 LIMIT 1");
        let uuid: Option<Uuid> = sqlx::query_scalar(&query)
            .bind(ext)
            .fetch_optional(&mut **tx)
            .await?;
        Ok(uuid)
    }

    async fn insert_voucher_tx(
        tx: &mut Transaction<'_, Postgres>,
        company: &CompanyRow,
        tipo: &str,
        periodo: &str,
        fecha_str: &str,
        origen: &str,
        descripcion: &str,
        referencia: Option<&str>,
        actor: &str,
        lineas: Vec<FrontendLinea>,
        puc: &[LedgerAccount],
    ) -> Result<FrontendComprobante, ApiError> {
        let next_cons: i64 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(consecutivo), 0) + 1
               FROM comprobantes_contables
              WHERE copropiedad_id = $1 AND tipo_documento = $2",
        )
        .bind(company.uuid)
        .bind(tipo)
        .fetch_one(&mut **tx)
        .await?;

        let ext_id = format!("{}-{}-{}", company.slug, tipo, next_cons);
        let normalized = normalize_frontend_lines(lineas, &ext_id);
        let (total_debito, total_credito, hash) = validate_and_hash_frontend_lines(
            &company.slug,
            periodo,
            tipo,
            fecha_str,
            descripcion,
            &normalized,
            puc,
        )?;

        let comp_uuid = Uuid::new_v4();
        let fecha = parse_date(fecha_str)?;
        let now = Utc::now();

        sqlx::query(
            "INSERT INTO comprobantes_contables (
                id, clave_externa, copropiedad_id, tipo_documento, consecutivo, periodo,
                fecha_contable, origen_creacion, estado, descripcion, referencia,
                total_debito, total_credito, hash_contenido, creado_por, created_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ASENTADO',$9,$10,$11,$12,$13,$14,$15)",
        )
        .bind(comp_uuid)
        .bind(&ext_id)
        .bind(company.uuid)
        .bind(tipo)
        .bind(next_cons)
        .bind(periodo)
        .bind(fecha)
        .bind(origen)
        .bind(descripcion)
        .bind(referencia)
        .bind(total_debito)
        .bind(total_credito)
        .bind(&hash)
        .bind(actor)
        .bind(now)
        .execute(&mut **tx)
        .await?;

        for (idx, l) in normalized.iter().enumerate() {
            let unit_uuid =
                Self::resolve_optional_fk(tx, "unidades_inmobiliarias", l.unidad_id.as_deref())
                    .await?;
            let tp_uuid =
                Self::resolve_optional_fk(tx, "terceros", l.tercero_id.as_deref()).await?;
            let rub_uuid =
                Self::resolve_optional_fk(tx, "rubros_presupuestales", l.rubro_id.as_deref())
                    .await?;

            sqlx::query(
                "INSERT INTO movimientos_ledger (
                    comprobante_id, copropiedad_id, cuenta_codigo, unidad_id, tercero_id,
                    rubro_id, debito, credito, descripcion, linea_orden, clave_externa
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
            )
            .bind(comp_uuid)
            .bind(company.uuid)
            .bind(&l.cuenta)
            .bind(unit_uuid)
            .bind(tp_uuid)
            .bind(rub_uuid)
            .bind(l.debito)
            .bind(l.credito)
            .bind(&l.descripcion)
            .bind(idx as i32)
            .bind(&l.id)
            .execute(&mut **tx)
            .await?;
        }

        Ok(FrontendComprobante {
            id: ext_id,
            empresa_id: company.slug.clone(),
            periodo: periodo.to_string(),
            tipo: tipo.to_string(),
            consecutivo: next_cons,
            fecha: fecha_str.to_string(),
            estado: "ASENTADO".into(),
            origen: origen.to_string(),
            descripcion: descripcion.to_string(),
            lineas: normalized,
            total_debito,
            total_credito,
            referencia: referencia.map(ToString::to_string),
            hash,
            creado_por: actor.to_string(),
            created_at: now.to_rfc3339(),
        })
    }

    async fn insert_audit_tx(
        tx: &mut Transaction<'_, Postgres>,
        company: &CompanyRow,
        actor: &str,
        accion: &str,
        detalle: &str,
    ) -> Result<FrontendAuditoria, ApiError> {
        let id = Uuid::new_v4();
        let now = Utc::now();
        sqlx::query(
            "INSERT INTO auditoria_eventos (id, copropiedad_id, actor, accion, detalle, metadata, created_at)
             VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, $6)",
        )
        .bind(id)
        .bind(company.uuid)
        .bind(actor)
        .bind(accion)
        .bind(detalle)
        .bind(now)
        .execute(&mut **tx)
        .await?;

        Ok(FrontendAuditoria {
            id: id.to_string(),
            ts: now.to_rfc3339(),
            actor: actor.to_string(),
            accion: accion.to_string(),
            detalle: detalle.to_string(),
            empresa_id: company.slug.clone(),
        })
    }

    async fn load_entries_query(
        &self,
        company_uuid: Option<Uuid>,
        period: Option<&str>,
    ) -> Result<Vec<FrontendComprobante>, ApiError> {
        let comp_rows = sqlx::query(
            "SELECT c.id, COALESCE(c.clave_externa, c.id::text) AS ext_id,
                    COALESCE(co.slug, co.id::text) AS company_slug,
                    c.periodo, c.tipo_documento, c.consecutivo, c.fecha_contable,
                    c.estado, c.origen_creacion, c.descripcion, c.referencia,
                    c.total_debito, c.total_credito, COALESCE(c.hash_contenido, '') AS hash_contenido,
                    COALESCE(c.creado_por, 'Sistema') AS creado_por, c.created_at
               FROM comprobantes_contables c
               JOIN copropiedades co ON co.id = c.copropiedad_id
              WHERE ($1::uuid IS NULL OR c.copropiedad_id = $1)
                AND ($2::text IS NULL OR $2 = 'todos' OR c.periodo = $2)
              ORDER BY c.fecha_contable, c.consecutivo, c.created_at",
        )
        .bind(company_uuid)
        .bind(period)
        .fetch_all(&self.db.pool)
        .await?;

        let line_rows = sqlx::query(
            "SELECT m.comprobante_id, COALESCE(m.clave_externa, m.id::text) AS ext_id,
                    m.cuenta_codigo, m.descripcion, m.debito, m.credito,
                    COALESCE(t.clave_externa, t.id::text) AS tp_ext,
                    COALESCE(u.clave_externa, u.id::text) AS u_ext,
                    COALESCE(r.clave_externa, r.id::text) AS r_ext
               FROM movimientos_ledger m
               JOIN comprobantes_contables c ON c.id = m.comprobante_id
               LEFT JOIN terceros t ON t.id = m.tercero_id
               LEFT JOIN unidades_inmobiliarias u ON u.id = m.unidad_id
               LEFT JOIN rubros_presupuestales r ON r.id = m.rubro_id
              WHERE ($1::uuid IS NULL OR c.copropiedad_id = $1)
                AND ($2::text IS NULL OR $2 = 'todos' OR c.periodo = $2)
              ORDER BY m.comprobante_id, m.linea_orden, m.id",
        )
        .bind(company_uuid)
        .bind(period)
        .fetch_all(&self.db.pool)
        .await?;

        let mut lines_map: HashMap<Uuid, Vec<FrontendLinea>> = HashMap::new();
        for lr in line_rows {
            let cid: Uuid = lr.try_get("comprobante_id")?;
            lines_map.entry(cid).or_default().push(FrontendLinea {
                id: lr.try_get("ext_id")?,
                cuenta: lr.try_get("cuenta_codigo")?,
                descripcion: lr.try_get("descripcion")?,
                debito: lr.try_get("debito")?,
                credito: lr.try_get("credito")?,
                tercero_id: lr.try_get("tp_ext")?,
                unidad_id: lr.try_get("u_ext")?,
                rubro_id: lr.try_get("r_ext")?,
            });
        }

        let mut out = Vec::with_capacity(comp_rows.len());
        for cr in comp_rows {
            let cid: Uuid = cr.try_get("id")?;
            let fecha: NaiveDate = cr.try_get("fecha_contable")?;
            let created_at: DateTime<Utc> = cr.try_get("created_at")?;
            out.push(FrontendComprobante {
                id: cr.try_get("ext_id")?,
                empresa_id: cr.try_get("company_slug")?,
                periodo: cr.try_get::<String, _>("periodo")?.trim().to_string(),
                tipo: cr.try_get("tipo_documento")?,
                consecutivo: cr.try_get("consecutivo")?,
                fecha: fecha.format("%Y-%m-%d").to_string(),
                estado: cr.try_get("estado")?,
                origen: cr.try_get("origen_creacion")?,
                descripcion: cr.try_get("descripcion")?,
                lineas: lines_map.remove(&cid).unwrap_or_default(),
                total_debito: cr.try_get("total_debito")?,
                total_credito: cr.try_get("total_credito")?,
                referencia: cr.try_get("referencia")?,
                hash: cr.try_get("hash_contenido")?,
                creado_por: cr.try_get("creado_por")?,
                created_at: created_at.to_rfc3339(),
            });
        }
        Ok(out)
    }

    async fn load_bundle(&self) -> Result<(BootstrapDatos, FrontendEstadoApp), ApiError> {
        let comp_rows = sqlx::query(
            "SELECT id, COALESCE(slug, id::text) AS slug, nit, razon_social,
                    COALESCE(nombre_corto, razon_social) AS nombre_corto, sigla, ciudad, direccion,
                    grupo_niif, COALESCE(porcentaje_fondo_imprevistos, 1.0) AS fondo_pct,
                    tasa_mora_mensual, COALESCE(dia_corte_pronto_pago, 10) AS dia_corte,
                    COALESCE(descuento_pronto_pago_pct, 0) AS desc_pct,
                    COALESCE(llave_bre_b, '') AS llave_bre_b, presupuesto_anual,
                    periodo_actual, saldos_iniciales, escala, color
               FROM copropiedades
              ORDER BY created_at, slug",
        )
        .fetch_all(&self.db.pool)
        .await?;

        let mut companies = Vec::with_capacity(comp_rows.len());
        let mut slug_by_uuid: HashMap<Uuid, String> = HashMap::new();
        for r in comp_rows {
            let uuid: Uuid = r.try_get("id")?;
            let slug: String = r.try_get("slug")?;
            let saldos_val: Value = r.try_get("saldos_iniciales")?;
            let saldos: HashMap<String, Decimal> =
                serde_json::from_value(saldos_val).unwrap_or_default();
            slug_by_uuid.insert(uuid, slug.clone());
            companies.push(FrontendCopropiedad {
                id: slug,
                nit: r.try_get("nit")?,
                razon_social: r.try_get("razon_social")?,
                nombre_corto: r.try_get("nombre_corto")?,
                sigla: r.try_get("sigla")?,
                ciudad: r.try_get("ciudad")?,
                direccion: r.try_get("direccion")?,
                grupo_niif: r.try_get("grupo_niif")?,
                fondo_imprevistos_pct: r.try_get("fondo_pct")?,
                tasa_mora_mensual: r.try_get("tasa_mora_mensual")?,
                dia_corte_pronto_pago: r.try_get("dia_corte")?,
                descuento_pronto_pago_pct: r.try_get("desc_pct")?,
                llave_bre_b: r.try_get("llave_bre_b")?,
                presupuesto_anual: r.try_get("presupuesto_anual")?,
                periodo_actual: r.try_get::<String, _>("periodo_actual")?.trim().to_string(),
                saldos_iniciales: saldos,
                escala: r.try_get("escala")?,
                color: r.try_get("color")?,
            });
        }

        let link_rows = sqlx::query(
            "SELECT v.unidad_id, v.rol_en_unidad, COALESCE(t.clave_externa, t.id::text) AS t_ext
               FROM vinculos_unidad_tercero v
               JOIN terceros t ON t.id = v.tercero_id
              WHERE v.activo = TRUE",
        )
        .fetch_all(&self.db.pool)
        .await?;
        let mut prop_map: HashMap<Uuid, String> = HashMap::new();
        let mut arr_map: HashMap<Uuid, String> = HashMap::new();
        for lr in link_rows {
            let uid: Uuid = lr.try_get("unidad_id")?;
            let rol: String = lr.try_get("rol_en_unidad")?;
            let t_ext: String = lr.try_get("t_ext")?;
            if rol == "PROPIETARIO" {
                prop_map.insert(uid, t_ext);
            } else if rol == "ARRENDATARIO" {
                arr_map.insert(uid, t_ext);
            }
        }

        let unit_rows = sqlx::query(
            "SELECT id, COALESCE(clave_externa, id::text) AS ext_id, copropiedad_id,
                    grupo_torre, numero_unidad, COALESCE(tipo, 'APARTAMENTO') AS tipo,
                    COALESCE(area, 0) AS area, coeficiente,
                    COALESCE(matricula_inmobiliaria, '') AS matricula, cartera_congelada
               FROM unidades_inmobiliarias
              ORDER BY created_at, grupo_torre, numero_unidad",
        )
        .fetch_all(&self.db.pool)
        .await?;
        let mut units = Vec::with_capacity(unit_rows.len());
        for ur in unit_rows {
            let uid: Uuid = ur.try_get("id")?;
            let cid: Uuid = ur.try_get("copropiedad_id")?;
            units.push(FrontendUnidad {
                id: ur.try_get("ext_id")?,
                empresa_id: slug_by_uuid.get(&cid).cloned().unwrap_or_else(|| cid.to_string()),
                torre: ur.try_get("grupo_torre")?,
                numero: ur.try_get("numero_unidad")?,
                tipo: ur.try_get("tipo")?,
                area: ur.try_get("area")?,
                coeficiente: ur.try_get("coeficiente")?,
                matricula: ur.try_get("matricula")?,
                propietario_id: prop_map.remove(&uid).unwrap_or_default(),
                arrendatario_id: arr_map.remove(&uid),
                cartera_congelada: ur.try_get("cartera_congelada")?,
            });
        }

        let tp_rows = sqlx::query(
            "SELECT id, COALESCE(clave_externa, id::text) AS ext_id, copropiedad_id,
                    nombre, tipo, documento, dv, COALESCE(email, '') AS email,
                    COALESCE(telefono, '') AS telefono, COALESCE(ciudad, '') AS ciudad,
                    retefuente_pct, reteica_pct, reteiva_pct, no_obligado, regimen_especial
               FROM terceros
              ORDER BY created_at, ext_id",
        )
        .fetch_all(&self.db.pool)
        .await?;
        let mut terceros = Vec::with_capacity(tp_rows.len());
        for tr in tp_rows {
            let cid: Option<Uuid> = tr.try_get("copropiedad_id")?;
            let reg: bool = tr.try_get("regimen_especial")?;
            terceros.push(FrontendTercero {
                id: tr.try_get("ext_id")?,
                empresa_id: cid.and_then(|u| slug_by_uuid.get(&u).cloned()),
                nombre: tr.try_get("nombre")?,
                tipo: tr.try_get("tipo")?,
                documento: tr.try_get("documento")?,
                dv: tr.try_get("dv")?,
                email: tr.try_get("email")?,
                telefono: tr.try_get("telefono")?,
                ciudad: tr.try_get("ciudad")?,
                retefuente_pct: tr.try_get("retefuente_pct")?,
                reteica_pct: tr.try_get("reteica_pct")?,
                reteiva_pct: tr.try_get("reteiva_pct")?,
                no_obligado: tr.try_get("no_obligado")?,
                regimen_especial: if reg { Some(true) } else { None },
            });
        }

        let rub_rows = sqlx::query(
            "SELECT COALESCE(clave_externa, id::text) AS ext_id, copropiedad_id,
                    clave, nombre, COALESCE(centro_costo, '') AS centro, presupuesto_anual, cuenta_codigo
               FROM rubros_presupuestales
              ORDER BY copropiedad_id, clave",
        )
        .fetch_all(&self.db.pool)
        .await?;
        let mut rubros = Vec::with_capacity(rub_rows.len());
        for rr in rub_rows {
            let cid: Uuid = rr.try_get("copropiedad_id")?;
            rubros.push(FrontendRubro {
                id: rr.try_get("ext_id")?,
                empresa_id: slug_by_uuid.get(&cid).cloned().unwrap_or_else(|| cid.to_string()),
                key: rr.try_get("clave")?,
                nombre: rr.try_get("nombre")?,
                centro: rr.try_get("centro")?,
                presupuesto_anual: rr.try_get("presupuesto_anual")?,
                cuenta: rr.try_get("cuenta_codigo")?,
            });
        }

        let comprobantes = self.load_entries_query(None, None).await?;

        let pre_rows = sqlx::query(
            "SELECT COALESCE(p.clave_externa, p.id::text) AS ext_id, p.copropiedad_id,
                    p.periodo, p.tipo_documento, p.fecha, p.agente,
                    COALESCE(p.confianza, 95) AS confianza,
                    COALESCE(t.clave_externa, t.id::text, '') AS tp_ext,
                    COALESCE(u.clave_externa, u.id::text) AS u_ext,
                    COALESCE(r.clave_externa, r.id::text) AS r_ext,
                    p.descripcion, p.documento_json, p.lineas_json, p.estado, p.notas
               FROM pre_asientos p
               LEFT JOIN terceros t ON t.id = p.tercero_id
               LEFT JOIN unidades_inmobiliarias u ON u.id = p.unidad_id
               LEFT JOIN rubros_presupuestales r ON r.id = p.rubro_id
              WHERE p.estado = 'PENDIENTE'
              ORDER BY p.fecha, p.created_at",
        )
        .fetch_all(&self.db.pool)
        .await?;
        let mut pre_asientos = Vec::with_capacity(pre_rows.len());
        for pr in pre_rows {
            let cid: Uuid = pr.try_get("copropiedad_id")?;
            let fecha: NaiveDate = pr.try_get("fecha")?;
            let lineas_val: Value = pr.try_get("lineas_json")?;
            let notas_val: Value = pr.try_get("notas")?;
            pre_asientos.push(FrontendPreAsiento {
                id: pr.try_get("ext_id")?,
                empresa_id: slug_by_uuid.get(&cid).cloned().unwrap_or_else(|| cid.to_string()),
                periodo: pr.try_get::<String, _>("periodo")?.trim().to_string(),
                tipo: pr.try_get("tipo_documento")?,
                fecha: fecha.format("%Y-%m-%d").to_string(),
                agente: pr.try_get("agente")?,
                confianza: pr.try_get("confianza")?,
                tercero_id: pr.try_get("tp_ext")?,
                unidad_id: pr.try_get("u_ext")?,
                rubro_id: pr.try_get("r_ext")?,
                descripcion: pr.try_get("descripcion")?,
                documento: pr.try_get("documento_json")?,
                lineas: serde_json::from_value(lineas_val).unwrap_or_default(),
                estado: pr.try_get("estado")?,
                notas: serde_json::from_value(notas_val).unwrap_or_default(),
            });
        }

        let closed_rows = sqlx::query(
            "SELECT copropiedad_id, periodo FROM periodos_cerrados ORDER BY periodo",
        )
        .fetch_all(&self.db.pool)
        .await?;
        let mut periodos_cerrados: HashMap<String, Vec<String>> = HashMap::new();
        for c in &companies {
            periodos_cerrados.insert(c.id.clone(), Vec::new());
        }
        for cr in closed_rows {
            let cid: Uuid = cr.try_get("copropiedad_id")?;
            if let Some(slug) = slug_by_uuid.get(&cid) {
                periodos_cerrados
                    .entry(slug.clone())
                    .or_default()
                    .push(cr.try_get::<String, _>("periodo")?.trim().to_string());
            }
        }

        let aud_rows = sqlx::query(
            "SELECT id, copropiedad_id, actor, accion, COALESCE(detalle, '') AS detalle, metadata, created_at
               FROM auditoria_eventos
              ORDER BY created_at DESC
              LIMIT 200",
        )
        .fetch_all(&self.db.pool)
        .await?;
        let default_emp = companies.first().map(|c| c.id.clone()).unwrap_or_default();
        let mut auditoria = Vec::with_capacity(aud_rows.len());
        for ar in aud_rows {
            let id: Uuid = ar.try_get("id")?;
            let cid: Option<Uuid> = ar.try_get("copropiedad_id")?;
            let meta: Value = ar.try_get("metadata")?;
            let ext_id = meta
                .get("external_id")
                .and_then(|v| v.as_str())
                .map(ToString::to_string)
                .unwrap_or_else(|| id.to_string());
            let ts: DateTime<Utc> = ar.try_get("created_at")?;
            auditoria.push(FrontendAuditoria {
                id: ext_id,
                ts: ts.to_rfc3339(),
                actor: ar.try_get("actor")?,
                accion: ar.try_get("accion")?,
                detalle: ar.try_get("detalle")?,
                empresa_id: cid
                    .and_then(|u| slug_by_uuid.get(&u).cloned())
                    .unwrap_or_else(|| default_emp.clone()),
            });
        }

        let active_company_id = companies
            .first()
            .map(|c| c.id.clone())
            .unwrap_or_else(|| "altavista".into());
        let periodo = companies
            .first()
            .map(|c| c.periodo_actual.clone())
            .unwrap_or_else(|| "2026-11".into());

        let datos = BootstrapDatos {
            companies,
            units,
            terceros,
            rubros,
            comprobantes: comprobantes.clone(),
            pre_asientos: pre_asientos.clone(),
        };
        let estado = FrontendEstadoApp {
            version: 4,
            active_company_id,
            periodo,
            pre_asientos,
            comprobantes,
            periodos_cerrados,
            auditoria,
        };
        Ok((datos, estado))
    }

    pub async fn bootstrap(&self) -> Result<Value, ApiError> {
        let (datos, estado) = self.load_bundle().await?;
        Ok(json!({
            "datos": datos,
            "estado": estado,
            "mode": "postgres",
        }))
    }

    pub async fn get_state(&self) -> Result<Value, ApiError> {
        let (_, estado) = self.load_bundle().await?;
        Ok(serde_json::to_value(estado).unwrap_or_else(|_| json!({})))
    }

    pub async fn put_state(&self, payload: Value) -> Result<Value, ApiError> {
        self.db.set_state("default", &payload).await?;
        Ok(payload)
    }

    pub async fn reset(&self) -> Result<Value, ApiError> {
        let mut tx = self.db.pool.begin().await?;
        sqlx::query("SELECT set_config('vertika.allow_reset', 'on', true)")
            .execute(&mut *tx)
            .await?;
        sqlx::query(
            "TRUNCATE auditoria_eventos, periodos_cerrados, pre_asientos,
                      movimientos_ledger, comprobantes_contables, rubros_presupuestales,
                      vinculos_unidad_tercero, unidades_inmobiliarias, puc_esal_cuentas,
                      terceros, copropiedades, app_estado",
        )
        .execute(&mut *tx)
        .await?;
        Self::seed_relational_in_tx(&mut tx, &self.seed).await?;
        tx.commit().await?;

        let (datos, estado) = self.load_bundle().await?;
        Ok(json!({
            "ok": true,
            "datos": datos,
            "estado": estado,
        }))
    }

    pub async fn list_puc(&self, company_id: Option<&str>) -> Result<Vec<LedgerAccount>, ApiError> {
        let rows = if let Some(cid_or_slug) = company_id {
            sqlx::query(
                "SELECT p.codigo_cuenta, p.nombre_cuenta, p.tipo_cuenta, p.naturaleza,
                        p.rubro_presupuesto_key, p.requiere_tercero, p.requiere_unidad,
                        p.es_efectivo, p.restringida, p.nota
                   FROM puc_esal_cuentas p
                   JOIN copropiedades co ON co.id = p.copropiedad_id
                  WHERE co.slug = $1 OR co.id::text = $1
                  ORDER BY p.codigo_cuenta",
            )
            .bind(cid_or_slug)
            .fetch_all(&self.db.pool)
            .await?
        } else {
            sqlx::query(
                "SELECT DISTINCT ON (codigo_cuenta)
                        codigo_cuenta, nombre_cuenta, tipo_cuenta, naturaleza,
                        rubro_presupuesto_key, requiere_tercero, requiere_unidad,
                        es_efectivo, restringida, nota
                   FROM puc_esal_cuentas
                  ORDER BY codigo_cuenta",
            )
            .fetch_all(&self.db.pool)
            .await?
        };

        if rows.is_empty() {
            return Ok(demo_puc());
        }
        let mut out = Vec::with_capacity(rows.len());
        for r in rows {
            out.push(LedgerAccount {
                code: r.try_get("codigo_cuenta")?,
                name: r.try_get("nombre_cuenta")?,
                account_type: r.try_get("tipo_cuenta")?,
                nature: r.try_get::<String, _>("naturaleza")?.trim().to_string(),
                rubric_key: r.try_get("rubro_presupuesto_key")?,
                requires_third_party: r.try_get("requiere_tercero")?,
                requires_unit: r.try_get("requiere_unidad")?,
                is_cash: r.try_get("es_efectivo")?,
                restricted: r.try_get("restringida")?,
                note: r.try_get("nota")?,
            });
        }
        Ok(out)
    }

    pub async fn list_third_parties(
        &self,
        company_id: Option<&str>,
    ) -> Result<Vec<ThirdParty>, ApiError> {
        let rows = sqlx::query(
            "SELECT COALESCE(t.clave_externa, t.id::text) AS ext_id, t.nombre,
                    t.documento, t.dv, t.retefuente_pct, t.reteica_pct, t.reteiva_pct
               FROM terceros t
               LEFT JOIN copropiedades co ON co.id = t.copropiedad_id
              WHERE $1::text IS NULL OR t.copropiedad_id IS NULL OR co.slug = $1 OR co.id::text = $1
              ORDER BY ext_id",
        )
        .bind(company_id)
        .fetch_all(&self.db.pool)
        .await?;

        let mut out = Vec::with_capacity(rows.len());
        for r in rows {
            let doc: String = r.try_get("documento")?;
            let dv: Option<String> = r.try_get("dv")?;
            let nit = match dv.filter(|s| !s.is_empty()) {
                Some(d) => format!("{doc}-{d}"),
                None => doc,
            };
            out.push(ThirdParty {
                id: r.try_get("ext_id")?,
                name: r.try_get("nombre")?,
                nit,
                retefuente_pct: r.try_get("retefuente_pct")?,
                reteica_pct: r.try_get("reteica_pct")?,
                reteiva_pct: r.try_get("reteiva_pct")?,
            });
        }
        Ok(out)
    }

    pub async fn update_pre_entry_lines(
        &self,
        pre_id: &str,
        lineas: Vec<FrontendLinea>,
    ) -> Result<FrontendPreAsiento, ApiError> {
        let mut tx = self.db.pool.begin().await?;
        let row = sqlx::query(
            "SELECT p.id, COALESCE(p.clave_externa, p.id::text) AS ext_id,
                    COALESCE(co.slug, co.id::text) AS emp_slug,
                    p.periodo, p.tipo_documento, p.fecha, p.agente,
                    COALESCE(p.confianza, 95) AS confianza,
                    COALESCE(t.clave_externa, t.id::text, '') AS tp_ext,
                    COALESCE(u.clave_externa, u.id::text) AS u_ext,
                    COALESCE(r.clave_externa, r.id::text) AS r_ext,
                    p.descripcion, p.documento_json, p.estado, p.notas
               FROM pre_asientos p
               JOIN copropiedades co ON co.id = p.copropiedad_id
               LEFT JOIN terceros t ON t.id = p.tercero_id
               LEFT JOIN unidades_inmobiliarias u ON u.id = p.unidad_id
               LEFT JOIN rubros_presupuestales r ON r.id = p.rubro_id
              WHERE p.clave_externa = $1 OR p.id::text = $1
              FOR UPDATE OF p",
        )
        .bind(pre_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("Pre-asiento '{pre_id}' no encontrado.")))?;

        let status: String = row.try_get("estado")?;
        if status != "PENDIENTE" {
            return Err(ApiError::Conflict(format!(
                "El pre-asiento ya fue procesado ({status})."
            )));
        }

        let normalized = normalize_frontend_lines(lineas, "l");
        let lineas_json = serde_json::to_value(&normalized).unwrap_or_else(|_| json!([]));
        let uuid: Uuid = row.try_get("id")?;
        sqlx::query("UPDATE pre_asientos SET lineas_json = $2 WHERE id = $1")
            .bind(uuid)
            .bind(&lineas_json)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;

        let fecha: NaiveDate = row.try_get("fecha")?;
        let notas_val: Value = row.try_get("notas")?;
        Ok(FrontendPreAsiento {
            id: row.try_get("ext_id")?,
            empresa_id: row.try_get("emp_slug")?,
            periodo: row.try_get::<String, _>("periodo")?.trim().to_string(),
            tipo: row.try_get("tipo_documento")?,
            fecha: fecha.format("%Y-%m-%d").to_string(),
            agente: row.try_get("agente")?,
            confianza: row.try_get("confianza")?,
            tercero_id: row.try_get("tp_ext")?,
            unidad_id: row.try_get("u_ext")?,
            rubro_id: row.try_get("r_ext")?,
            descripcion: row.try_get("descripcion")?,
            documento: row.try_get("documento_json")?,
            lineas: normalized,
            estado: status,
            notas: serde_json::from_value(notas_val).unwrap_or_default(),
        })
    }

    pub async fn approve_pre_entry(
        &self,
        pre_id: &str,
        actor: &str,
    ) -> Result<ApproveResult, ApiError> {
        let mut tx = self.db.pool.begin().await?;
        let row = sqlx::query(
            "SELECT id, COALESCE(clave_externa, id::text) AS ext_id, copropiedad_id,
                    periodo, tipo_documento, fecha, agente, descripcion, documento_json,
                    lineas_json, estado
               FROM pre_asientos
              WHERE clave_externa = $1 OR id::text = $1
              FOR UPDATE",
        )
        .bind(pre_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("Pre-asiento '{pre_id}' no encontrado.")))?;

        let status: String = row.try_get("estado")?;
        if status != "PENDIENTE" {
            return Err(ApiError::Conflict(format!(
                "El pre-asiento ya fue procesado ({status})."
            )));
        }

        let pre_uuid: Uuid = row.try_get("id")?;
        let ext_id: String = row.try_get("ext_id")?;
        let comp_id_uuid: Uuid = row.try_get("copropiedad_id")?;
        let company = Self::resolve_company_tx(&mut tx, &comp_id_uuid.to_string()).await?;
        let periodo = row.try_get::<String, _>("periodo")?.trim().to_string();
        Self::ensure_period_open_tx(&mut tx, &company, &periodo).await?;

        let puc = Self::fetch_company_puc_tx(&mut tx, company.uuid).await?;
        let tipo: String = row.try_get("tipo_documento")?;
        let fecha: NaiveDate = row.try_get("fecha")?;
        let fecha_str = fecha.format("%Y-%m-%d").to_string();
        let agente: String = row.try_get("agente")?;
        let descripcion: String = row.try_get("descripcion")?;
        let doc: Value = row.try_get("documento_json")?;
        let referencia = doc
            .get("numero")
            .and_then(|v| v.as_str())
            .map(ToString::to_string);
        let lineas_val: Value = row.try_get("lineas_json")?;
        let lineas: Vec<FrontendLinea> = serde_json::from_value(lineas_val).unwrap_or_default();

        let comp = Self::insert_voucher_tx(
            &mut tx,
            &company,
            &tipo,
            &periodo,
            &fecha_str,
            &origin_from_agent(&agente),
            &descripcion,
            referencia.as_deref(),
            actor,
            lineas,
            &puc,
        )
        .await?;

        sqlx::query("UPDATE pre_asientos SET estado = 'APROBADO' WHERE id = $1")
            .bind(pre_uuid)
            .execute(&mut *tx)
            .await?;

        let ev = Self::insert_audit_tx(
            &mut tx,
            &company,
            actor,
            "Aprobó pre-asiento IA",
            &format!("{}-{} · {}", comp.tipo, comp.consecutivo, descripcion),
        )
        .await?;

        tx.commit().await?;
        Ok(ApproveResult {
            comprobante: comp,
            auditoria: ev,
            pre_asiento_id: ext_id,
        })
    }

    pub async fn reject_pre_entry(
        &self,
        pre_id: &str,
        actor: &str,
    ) -> Result<FrontendAuditoria, ApiError> {
        let mut tx = self.db.pool.begin().await?;
        let row = sqlx::query(
            "SELECT id, copropiedad_id, descripcion, estado
               FROM pre_asientos
              WHERE clave_externa = $1 OR id::text = $1
              FOR UPDATE",
        )
        .bind(pre_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("Pre-asiento '{pre_id}' no encontrado.")))?;

        let status: String = row.try_get("estado")?;
        if status != "PENDIENTE" {
            return Err(ApiError::Conflict(format!(
                "El pre-asiento ya fue procesado ({status})."
            )));
        }

        let pre_uuid: Uuid = row.try_get("id")?;
        let cid: Uuid = row.try_get("copropiedad_id")?;
        let descripcion: String = row.try_get("descripcion")?;
        let company = Self::resolve_company_tx(&mut tx, &cid.to_string()).await?;

        sqlx::query("UPDATE pre_asientos SET estado = 'RECHAZADO' WHERE id = $1")
            .bind(pre_uuid)
            .execute(&mut *tx)
            .await?;

        let ev = Self::insert_audit_tx(
            &mut tx,
            &company,
            actor,
            "Devolvió pre-asiento al agente",
            &descripcion,
        )
        .await?;
        tx.commit().await?;
        Ok(ev)
    }

    pub async fn create_entry(
        &self,
        req: CreateEntryRequest,
        actor: &str,
    ) -> Result<PostEntryResult, ApiError> {
        let mut tx = self.db.pool.begin().await?;
        let company = Self::resolve_company_tx(&mut tx, &req.company_id).await?;
        Self::ensure_period_open_tx(&mut tx, &company, &req.period).await?;
        let puc = Self::fetch_company_puc_tx(&mut tx, company.uuid).await?;

        let origen = req
            .origin
            .as_deref()
            .unwrap_or("CONTADOR_MANUAL")
            .to_string();
        let comp = Self::insert_voucher_tx(
            &mut tx,
            &company,
            &req.entry_type,
            &req.period,
            &req.date,
            &origen,
            &req.description,
            req.reference.as_deref(),
            actor,
            req.lines,
            &puc,
        )
        .await?;

        let ev = Self::insert_audit_tx(
            &mut tx,
            &company,
            actor,
            "Asentó comprobante",
            &format!("{}-{} · {}", comp.tipo, comp.consecutivo, req.description),
        )
        .await?;

        tx.commit().await?;
        Ok(PostEntryResult {
            comprobante: comp,
            auditoria: ev,
        })
    }

    pub async fn void_entry(
        &self,
        entry_id: &str,
        reason: Option<String>,
        actor: &str,
    ) -> Result<VoidEntryResult, ApiError> {
        let mut tx = self.db.pool.begin().await?;
        let comp_row = sqlx::query(
            "SELECT id, COALESCE(clave_externa, id::text) AS ext_id, copropiedad_id,
                    tipo_documento, consecutivo, periodo, fecha_contable, estado,
                    origen_creacion, descripcion, referencia, total_debito, total_credito,
                    COALESCE(hash_contenido, '') AS hash_contenido,
                    COALESCE(creado_por, 'Sistema') AS creado_por, created_at
               FROM comprobantes_contables
              WHERE clave_externa = $1 OR id::text = $1
              FOR UPDATE",
        )
        .bind(entry_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("Comprobante '{entry_id}' no encontrado.")))?;

        let estado: String = comp_row.try_get("estado")?;
        if estado == "ANULADO" {
            return Err(ApiError::Conflict("El comprobante ya fue anulado.".into()));
        }

        let orig_uuid: Uuid = comp_row.try_get("id")?;
        let comp_uuid: Uuid = comp_row.try_get("copropiedad_id")?;
        let company = Self::resolve_company_tx(&mut tx, &comp_uuid.to_string()).await?;
        let periodo = comp_row.try_get::<String, _>("periodo")?.trim().to_string();
        Self::ensure_period_open_tx(&mut tx, &company, &periodo).await?;

        let line_rows = sqlx::query(
            "SELECT COALESCE(m.clave_externa, m.id::text) AS ext_id, m.cuenta_codigo,
                    m.descripcion, m.debito, m.credito,
                    COALESCE(t.clave_externa, t.id::text) AS tp_ext,
                    COALESCE(u.clave_externa, u.id::text) AS u_ext,
                    COALESCE(r.clave_externa, r.id::text) AS r_ext
               FROM movimientos_ledger m
               LEFT JOIN terceros t ON t.id = m.tercero_id
               LEFT JOIN unidades_inmobiliarias u ON u.id = m.unidad_id
               LEFT JOIN rubros_presupuestales r ON r.id = m.rubro_id
              WHERE m.comprobante_id = $1
              ORDER BY m.linea_orden, m.id",
        )
        .bind(orig_uuid)
        .fetch_all(&mut *tx)
        .await?;

        let mut orig_lines = Vec::with_capacity(line_rows.len());
        for lr in line_rows {
            orig_lines.push(FrontendLinea {
                id: lr.try_get("ext_id")?,
                cuenta: lr.try_get("cuenta_codigo")?,
                descripcion: lr.try_get("descripcion")?,
                debito: lr.try_get("debito")?,
                credito: lr.try_get("credito")?,
                tercero_id: lr.try_get("tp_ext")?,
                unidad_id: lr.try_get("u_ext")?,
                rubro_id: lr.try_get("r_ext")?,
            });
        }

        let tipo_orig: String = comp_row.try_get("tipo_documento")?;
        let cons_orig: i64 = comp_row.try_get("consecutivo")?;
        let fecha: NaiveDate = comp_row.try_get("fecha_contable")?;
        let fecha_str = fecha.format("%Y-%m-%d").to_string();
        let motivo = reason
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("Anulación solicitada por el contador");
        let rev_desc = format!("Anulación {tipo_orig}-{cons_orig}: {motivo}");
        let ref_str = format!("{tipo_orig}-{cons_orig}");
        let rev_lines = build_reversal_lines(&orig_lines, "rev");
        let puc = Self::fetch_company_puc_tx(&mut tx, company.uuid).await?;

        let reverso = Self::insert_voucher_tx(
            &mut tx,
            &company,
            "NC",
            &periodo,
            &fecha_str,
            "CONTADOR_MANUAL",
            &rev_desc,
            Some(&ref_str),
            actor,
            rev_lines,
            &puc,
        )
        .await?;

        let rev_uuid: Uuid = sqlx::query_scalar(
            "SELECT id FROM comprobantes_contables WHERE clave_externa = $1 LIMIT 1",
        )
        .bind(&reverso.id)
        .fetch_one(&mut *tx)
        .await?;

        sqlx::query(
            "UPDATE comprobantes_contables SET estado = 'ANULADO', anulado_por_id = $2 WHERE id = $1",
        )
        .bind(orig_uuid)
        .bind(rev_uuid)
        .execute(&mut *tx)
        .await?;

        let ev = Self::insert_audit_tx(
            &mut tx,
            &company,
            actor,
            "Anuló comprobante",
            &format!(
                "{tipo_orig}-{cons_orig} anulado con reverso NC-{} ({motivo})",
                reverso.consecutivo
            ),
        )
        .await?;

        tx.commit().await?;

        let created_at: DateTime<Utc> = comp_row.try_get("created_at")?;
        let anulado = FrontendComprobante {
            id: comp_row.try_get("ext_id")?,
            empresa_id: company.slug,
            periodo,
            tipo: tipo_orig,
            consecutivo: cons_orig,
            fecha: fecha_str,
            estado: "ANULADO".into(),
            origen: comp_row.try_get("origen_creacion")?,
            descripcion: comp_row.try_get("descripcion")?,
            lineas: orig_lines,
            total_debito: comp_row.try_get("total_debito")?,
            total_credito: comp_row.try_get("total_credito")?,
            referencia: comp_row.try_get("referencia")?,
            hash: comp_row.try_get("hash_contenido")?,
            creado_por: comp_row.try_get("creado_por")?,
            created_at: created_at.to_rfc3339(),
        };

        Ok(VoidEntryResult {
            anulado,
            reverso,
            auditoria: ev,
        })
    }

    pub async fn close_period(
        &self,
        company_id: &str,
        period: &str,
        req: ClosePeriodRequest,
        actor: &str,
    ) -> Result<ClosePeriodResult, ApiError> {
        let mut tx = self.db.pool.begin().await?;
        let company = Self::resolve_company_tx(&mut tx, company_id).await?;
        Self::ensure_period_open_tx(&mut tx, &company, period).await?;

        let cartera_rows = sqlx::query(
            "SELECT m.unidad_id, COALESCE(SUM(m.debito - m.credito), 0) AS neto
               FROM movimientos_ledger m
               JOIN comprobantes_contables c ON c.id = m.comprobante_id
              WHERE c.copropiedad_id = $1
                AND c.estado <> 'ANULADO'
                AND c.periodo <= $2
                AND m.unidad_id IS NOT NULL
                AND m.cuenta_codigo IN ('130505','130510','130515','130520')
              GROUP BY m.unidad_id",
        )
        .bind(company.uuid)
        .bind(period)
        .fetch_all(&mut *tx)
        .await?;

        let mut cartera_total = Decimal::ZERO;
        for r in cartera_rows {
            let neto: Decimal = r.try_get("neto")?;
            cartera_total += ledger::round_cop(neto);
        }

        let traslado_raw: Decimal = sqlx::query_scalar(
            "SELECT COALESCE(SUM(m.credito), 0)
               FROM movimientos_ledger m
               JOIN comprobantes_contables c ON c.id = m.comprobante_id
              WHERE c.copropiedad_id = $1
                AND c.estado <> 'ANULADO'
                AND c.periodo = $2
                AND m.cuenta_codigo = '281510'
                AND m.credito > 0",
        )
        .bind(company.uuid)
        .bind(period)
        .fetch_one(&mut *tx)
        .await?;
        let traslado_fondo = ledger::round_cop(traslado_raw);

        let rub_rows = sqlx::query(
            "SELECT COALESCE(clave_externa, id::text) AS ext_id, clave, nombre,
                    COALESCE(centro_costo, '') AS centro, presupuesto_anual, cuenta_codigo
               FROM rubros_presupuestales
              WHERE copropiedad_id = $1",
        )
        .bind(company.uuid)
        .fetch_all(&mut *tx)
        .await?;
        let mut rubros = Vec::with_capacity(rub_rows.len());
        for rr in rub_rows {
            rubros.push(FrontendRubro {
                id: rr.try_get("ext_id")?,
                empresa_id: company.slug.clone(),
                key: rr.try_get("clave")?,
                nombre: rr.try_get("nombre")?,
                centro: rr.try_get("centro")?,
                presupuesto_anual: rr.try_get("presupuesto_anual")?,
                cuenta: rr.try_get("cuenta_codigo")?,
            });
        }

        let lines = ledger::build_closing_lines(
            period,
            company.escala,
            cartera_total,
            traslado_fondo,
            &req,
            &rubros,
        );
        if lines.len() < 2 {
            return Err(ApiError::unprocessable(
                "Debe ejecutar al menos una operación de cierre con valor mayor a cero.",
            ));
        }

        let fecha = last_day_of_period(period)?;
        let descripcion = format!("Cierre contable {period}");
        let puc = Self::fetch_company_puc_tx(&mut tx, company.uuid).await?;

        let comp = Self::insert_voucher_tx(
            &mut tx,
            &company,
            "NC",
            period,
            &fecha,
            "CIERRE_AUTOMATICO",
            &descripcion,
            None,
            actor,
            lines.clone(),
            &puc,
        )
        .await?;

        let comp_uuid: Uuid = sqlx::query_scalar(
            "SELECT id FROM comprobantes_contables WHERE clave_externa = $1 LIMIT 1",
        )
        .bind(&comp.id)
        .fetch_one(&mut *tx)
        .await?;

        sqlx::query(
            "INSERT INTO periodos_cerrados (copropiedad_id, periodo, cerrado_por, comprobante_cierre_id)
             VALUES ($1, $2, $3, $4)",
        )
        .bind(company.uuid)
        .bind(period)
        .bind(actor)
        .bind(comp_uuid)
        .execute(&mut *tx)
        .await?;

        let detail = closing_audit_detail(period, &lines);
        let ev = Self::insert_audit_tx(
            &mut tx,
            &company,
            actor,
            "Ejecutó cierre mensual",
            &detail,
        )
        .await?;

        tx.commit().await?;
        Ok(ClosePeriodResult {
            comprobante: comp,
            periodo_cerrado: period.to_string(),
            auditoria: ev,
        })
    }

    pub async fn list_entries(
        &self,
        company_id: &str,
        period: Option<&str>,
    ) -> Result<Vec<FrontendComprobante>, ApiError> {
        let mut tx = self.db.pool.begin().await?;
        let company = Self::resolve_company_tx(&mut tx, company_id).await?;
        tx.commit().await?;
        self.load_entries_query(Some(company.uuid), period).await
    }

    pub async fn trial_balance(
        &self,
        company_id: &str,
        period: &str,
    ) -> Result<Value, ApiError> {
        let mut tx = self.db.pool.begin().await?;
        let company = Self::resolve_company_tx(&mut tx, company_id).await?;
        let puc = Self::fetch_company_puc_tx(&mut tx, company.uuid).await?;
        tx.commit().await?;

        let opening_balances: HashMap<String, Decimal> =
            serde_json::from_value(company.saldos_iniciales).unwrap_or_default();

        let mov_rows = sqlx::query(
            "SELECT m.cuenta_codigo, COALESCE(SUM(m.debito), 0) AS deb, COALESCE(SUM(m.credito), 0) AS cred
               FROM movimientos_ledger m
               JOIN comprobantes_contables c ON c.id = m.comprobante_id
              WHERE c.copropiedad_id = $1
                AND c.estado <> 'ANULADO'
                AND ($2 = 'todos' OR c.periodo <= $2)
              GROUP BY m.cuenta_codigo",
        )
        .bind(company.uuid)
        .bind(period)
        .fetch_all(&self.db.pool)
        .await?;

        let mut movement = HashMap::with_capacity(mov_rows.len());
        for mr in mov_rows {
            let acc: String = mr.try_get("cuenta_codigo")?;
            let deb: Decimal = mr.try_get("deb")?;
            let cred: Decimal = mr.try_get("cred")?;
            movement.insert(acc, (deb, cred));
        }

        Ok(ledger::build_balance_report(
            &company.slug,
            period,
            &opening_balances,
            &movement,
            &puc,
        ))
    }

    pub async fn list_audit(&self, company_id: &str) -> Result<Vec<FrontendAuditoria>, ApiError> {
        let mut tx = self.db.pool.begin().await?;
        let company = Self::resolve_company_tx(&mut tx, company_id).await?;
        tx.commit().await?;

        let rows = sqlx::query(
            "SELECT id, actor, accion, COALESCE(detalle, '') AS detalle, metadata, created_at
               FROM auditoria_eventos
              WHERE copropiedad_id = $1
              ORDER BY created_at DESC
              LIMIT 200",
        )
        .bind(company.uuid)
        .fetch_all(&self.db.pool)
        .await?;

        let mut out = Vec::with_capacity(rows.len());
        for r in rows {
            let id: Uuid = r.try_get("id")?;
            let meta: Value = r.try_get("metadata")?;
            let ext_id = meta
                .get("external_id")
                .and_then(|v| v.as_str())
                .map(ToString::to_string)
                .unwrap_or_else(|| id.to_string());
            let ts: DateTime<Utc> = r.try_get("created_at")?;
            out.push(FrontendAuditoria {
                id: ext_id,
                ts: ts.to_rfc3339(),
                actor: r.try_get("actor")?,
                accion: r.try_get("accion")?,
                detalle: r.try_get("detalle")?,
                empresa_id: company.slug.clone(),
            });
        }
        Ok(out)
    }
}

fn parse_date(s: &str) -> Result<NaiveDate, ApiError> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d")
        .map_err(|_| ApiError::BadRequest(format!("Fecha inválida '{s}'; usa YYYY-MM-DD.")))
}

fn parse_ts_or_now(s: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(s)
        .map(|d| d.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now())
}
