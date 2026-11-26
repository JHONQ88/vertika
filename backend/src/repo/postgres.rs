use crate::auth::{
    self, AdminCompanyBrief, AdminContadorItem, AdminOverviewResponse, AuthUser, CompanyRole,
    CreateContadorRequest, CreateUserRequest, Role, UpdateAdminUserRequest, DEMO_PASSWORD,
    DEMO_USERS,
};
use crate::db::Db;
use crate::domain::{
    demo_puc, ledger, ApproveResult, BillPeriodRequest, BillPeriodResult, BootstrapDatos,
    ClosePeriodRequest, ClosePeriodResult, CopyThirdPartiesRequest, CopyThirdPartiesResult,
    CreateCompanyRequest, CreateCompanyResult,
    CreateEntryRequest, CreatePreEntryRequest, CreatePreEntryResult, CreatePucAccountRequest,
    FrontendAuditoria, FrontendComprobante, FrontendCopropiedad, FrontendEstadoApp, FrontendLinea,
    FrontendPreAsiento, FrontendRubro, FrontendTercero, FrontendUnidad, LedgerAccount,
    OpenNextPeriodResult, PortalCheckoutRequest, PortalCheckoutResponse, PortalIntencionPagoItem,
    PortalLookupRequest, PortalLookupResponse, PortalUnitLinkItem, PortalUnitStatement,
    PostEntryResult, ThirdParty, UpdateCompanySettingsRequest, UpsertThirdPartyRequest,
    UpsertUnitRequest, VoidEntryResult,
};
use crate::error::ApiError;
use crate::repo::{
    build_billing_lines, build_portal_rc_lines, build_pre_entry_document, build_reversal_lines,
    build_wompi_checkout_url, closing_audit_detail, compute_unit_overdue_balances,
    compute_unit_portal_figures, default_rubros_for_company, derive_sigla, extract_digits,
    last_day_of_period, next_period_ym, normalize_frontend_lines, normalize_requested_companies,
    normalize_unit_lookup, origin_from_agent, parse_seed_bundle, slugify_company_name,
    validate_and_hash_frontend_lines, validate_create_pre_entry_input, verify_wompi_event_checksum,
};
use chrono::{DateTime, Duration, NaiveDate, Utc};
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
    pub async fn init(db: Db, seed: Value, seed_demo: bool) -> Result<Self, ApiError> {
        let repo = Self { db, seed };
        if seed_demo {
            repo.seed_relational_if_empty().await?;
        }
        repo.ensure_super_admin_from_env().await?;
        Ok(repo)
    }

    async fn ensure_super_admin_from_env(&self) -> Result<(), ApiError> {
        let email = std::env::var("SUPER_ADMIN_EMAIL")
            .ok()
            .map(|s| s.trim().to_lowercase())
            .filter(|s| s.contains('@'));
        let password = std::env::var("SUPER_ADMIN_PASSWORD")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| s.len() >= 8);
        let (Some(email), Some(password)) = (email, password) else {
            return Ok(());
        };
        let nombre = std::env::var("SUPER_ADMIN_NAME")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "Propietario Vértika".into());

        let existing: Option<Uuid> =
            sqlx::query_scalar("SELECT id FROM usuarios WHERE LOWER(email) = LOWER($1)")
                .bind(&email)
                .fetch_optional(&self.db.pool)
                .await?;

        if let Some(uid) = existing {
            sqlx::query(
                "UPDATE usuarios
                    SET is_super_admin = TRUE,
                        activo = TRUE,
                        max_copropiedades = GREATEST(max_copropiedades, 999),
                        plan_nombre = 'OWNER',
                        expires_at = NULL
                  WHERE id = $1",
            )
            .bind(uid)
            .execute(&self.db.pool)
            .await?;
        } else {
            let uid = Uuid::new_v4();
            let salt = format!("salt-{}", Uuid::new_v4().simple());
            let pwd_hash = auth::hash_password(&password, &salt);
            sqlx::query(
                "INSERT INTO usuarios (
                    id, email, nombre, password_hash, activo,
                    is_super_admin, max_copropiedades, plan_nombre, expires_at
                ) VALUES ($1, $2, $3, $4, TRUE, TRUE, 999, 'OWNER', NULL)",
            )
            .bind(uid)
            .bind(&email)
            .bind(&nombre)
            .bind(pwd_hash)
            .execute(&self.db.pool)
            .await?;
        }
        tracing::info!("SUPER_ADMIN verificado desde entorno: {email}");
        Ok(())
    }

    async fn seed_relational_if_empty(&self) -> Result<(), ApiError> {
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM copropiedades")
            .fetch_one(&self.db.pool)
            .await?;
        let mut tx = self.db.pool.begin().await?;
        if count == 0 {
            Self::seed_relational_in_tx(&mut tx, &self.seed).await?;
        } else {
            Self::seed_demo_users_in_tx(&mut tx).await?;
        }
        tx.commit().await?;
        Ok(())
    }

    async fn seed_demo_users_in_tx(
        tx: &mut Transaction<'_, Postgres>,
    ) -> Result<(), ApiError> {
        let user_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM usuarios")
            .fetch_one(&mut **tx)
            .await?;
        if user_count > 0 {
            return Ok(());
        }
        let company_uuids: Vec<Uuid> = sqlx::query_scalar("SELECT id FROM copropiedades")
            .fetch_all(&mut **tx)
            .await?;
        for u in DEMO_USERS {
            let uid = Uuid::new_v4();
            let pwd_hash = auth::hash_password(DEMO_PASSWORD, u.salt);
            sqlx::query(
                "INSERT INTO usuarios (id, email, nombre, password_hash, activo)
                 VALUES ($1, $2, $3, $4, TRUE)
                 ON CONFLICT (email) DO NOTHING",
            )
            .bind(uid)
            .bind(u.email)
            .bind(u.nombre)
            .bind(pwd_hash)
            .execute(&mut **tx)
            .await?;

            for &cid in &company_uuids {
                sqlx::query(
                    "INSERT INTO usuario_copropiedad_roles (usuario_id, copropiedad_id, rol)
                     VALUES ($1, $2, $3)
                     ON CONFLICT DO NOTHING",
                )
                .bind(uid)
                .bind(cid)
                .bind(u.rol.as_str())
                .execute(&mut **tx)
                .await?;
            }
        }
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

        Self::seed_demo_users_in_tx(tx).await?;

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

        let uuid: Uuid = row.try_get("id")?;
        sqlx::query("SELECT set_config('app.current_copropiedad_id', $1, true)")
            .bind(uuid.to_string())
            .execute(&mut **tx)
            .await?;

        Ok(CompanyRow {
            uuid,
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
        // Lock por copropiedad + tipo de documento para evitar colisión de consecutivos concurrentes
        sqlx::query("SELECT pg_advisory_xact_lock(hashtext($1))")
            .bind(format!("{}:{tipo}", company.uuid))
            .execute(&mut **tx)
            .await?;

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
                    tasa_mora_mensual, COALESCE(dia_corte_pronto_pago, 10::smallint) AS dia_corte,
                    COALESCE(descuento_pronto_pago_pct, 0) AS desc_pct,
                    COALESCE(llave_bre_b, '') AS llave_bre_b, presupuesto_anual,
                    periodo_actual, saldos_iniciales, escala, color,
                    COALESCE(wompi_public_key, '') AS wompi_public_key,
                    COALESCE(wompi_sandbox, TRUE) AS wompi_sandbox,
                    (COALESCE(wompi_public_key, '') <> '' AND COALESCE(wompi_integrity_secret, '') <> '') AS wompi_configurado
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
                wompi_public_key: r.try_get("wompi_public_key")?,
                wompi_sandbox: r.try_get("wompi_sandbox")?,
                wompi_configurado: r.try_get("wompi_configurado")?,
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
            "SELECT u.id, COALESCE(u.clave_externa, u.id::text) AS ext_id, u.copropiedad_id,
                    u.grupo_torre, u.numero_unidad, COALESCE(u.tipo, 'APARTAMENTO') AS tipo,
                    COALESCE(u.area, 0) AS area, u.coeficiente,
                    COALESCE(u.matricula_inmobiliaria, '') AS matricula, u.cartera_congelada
               FROM unidades_inmobiliarias u
               JOIN copropiedades co ON co.id = u.copropiedad_id
              ORDER BY COALESCE(co.slug, co.id::text), u.grupo_torre, u.numero_unidad",
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
            "SELECT COALESCE(r.clave_externa, r.id::text) AS ext_id, r.copropiedad_id,
                    r.clave, r.nombre, COALESCE(r.centro_costo, '') AS centro, r.presupuesto_anual, r.cuenta_codigo
               FROM rubros_presupuestales r
               JOIN copropiedades co ON co.id = r.copropiedad_id
              ORDER BY COALESCE(co.slug, co.id::text), r.clave",
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
            "TRUNCATE usuario_copropiedad_roles, usuarios, auditoria_eventos, periodos_cerrados,
                      pre_asientos, movimientos_ledger, comprobantes_contables,
                      rubros_presupuestales, vinculos_unidad_tercero, tags_nfc, unidades_inmobiliarias,
                      puc_esal_cuentas, terceros, copropiedades, app_estado CASCADE",
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

    pub async fn create_pre_entry(
        &self,
        req: CreatePreEntryRequest,
        actor: &str,
    ) -> Result<CreatePreEntryResult, ApiError> {
        let (entry_type, description, agent) = validate_create_pre_entry_input(&req)?;
        let fecha = parse_date(req.date.trim())?;
        let mut tx = self.db.pool.begin().await?;
        let company = Self::resolve_company_tx(&mut tx, &req.company_id).await?;
        Self::ensure_period_open_tx(&mut tx, &company, &req.period).await?;

        let tp_row = sqlx::query(
            "SELECT id, COALESCE(clave_externa, id::text) AS ext_id, nombre, documento, dv
               FROM terceros
              WHERE (clave_externa = $1 OR id::text = $1)
                AND (copropiedad_id IS NULL OR copropiedad_id = $2)
              LIMIT 1",
        )
        .bind(req.tercero_id.trim())
        .bind(company.uuid)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| {
            ApiError::BadRequest(format!("Tercero '{}' no encontrado.", req.tercero_id))
        })?;
        let tp_uuid: Uuid = tp_row.try_get("id")?;
        let tp_ext: String = tp_row.try_get("ext_id")?;
        let tp_name: String = tp_row.try_get("nombre")?;
        let tp_doc: String = tp_row.try_get("documento")?;
        let tp_dv: Option<String> = tp_row.try_get("dv")?;
        let tp_nit = match tp_dv.filter(|s| !s.is_empty()) {
            Some(dv) => format!("{tp_doc}-{dv}"),
            None => tp_doc,
        };

        let (unit_uuid, unit_ext) =
            match req.unidad_id.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                Some(uid) => {
                    let ur = sqlx::query(
                        "SELECT id, COALESCE(clave_externa, id::text) AS ext_id
                           FROM unidades_inmobiliarias
                          WHERE copropiedad_id = $1 AND (clave_externa = $2 OR id::text = $2)
                          LIMIT 1",
                    )
                    .bind(company.uuid)
                    .bind(uid)
                    .fetch_optional(&mut *tx)
                    .await?
                    .ok_or_else(|| {
                        ApiError::BadRequest(format!(
                            "Unidad '{uid}' no encontrada en {}.",
                            company.nombre_corto
                        ))
                    })?;
                    (Some(ur.try_get::<Uuid, _>("id")?), Some(ur.try_get::<String, _>("ext_id")?))
                }
                None => (None, None),
            };

        let (rubro_uuid, rubro_ext) =
            match req.rubro_id.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                Some(rid) => {
                    let rr = sqlx::query(
                        "SELECT id, COALESCE(clave_externa, id::text) AS ext_id
                           FROM rubros_presupuestales
                          WHERE copropiedad_id = $1 AND (clave_externa = $2 OR id::text = $2)
                          LIMIT 1",
                    )
                    .bind(company.uuid)
                    .bind(rid)
                    .fetch_optional(&mut *tx)
                    .await?
                    .ok_or_else(|| {
                        ApiError::BadRequest(format!(
                            "Rubro '{rid}' no encontrado en {}.",
                            company.nombre_corto
                        ))
                    })?;
                    (Some(rr.try_get::<Uuid, _>("id")?), Some(rr.try_get::<String, _>("ext_id")?))
                }
                None => (None, None),
            };

        let puc = Self::fetch_company_puc_tx(&mut tx, company.uuid).await?;
        let normalized_lines = normalize_frontend_lines(req.lines.clone(), "l");
        let (total_debit, _, _) = validate_and_hash_frontend_lines(
            &company.slug,
            &req.period,
            &entry_type,
            req.date.trim(),
            &description,
            &normalized_lines,
            &puc,
        )?;

        let pid = Uuid::new_v4();
        let simple = pid.simple().to_string();
        let ext_id = format!("pre-{}-{}", company.slug, &simple[..12]);
        let doc_ref = format!("IA-{}", simple[..6].to_uppercase());
        let doc_json = build_pre_entry_document(&req, total_debit, &tp_name, &tp_nit, &doc_ref);
        let lineas_json = serde_json::to_value(&normalized_lines).unwrap_or_else(|_| json!([]));
        let notas_json = serde_json::to_value(&req.notes).unwrap_or_else(|_| json!([]));

        sqlx::query(
            "INSERT INTO pre_asientos (
                id, clave_externa, copropiedad_id, periodo, tipo_documento, fecha,
                agente, confianza, tercero_id, unidad_id, rubro_id, descripcion,
                documento_json, lineas_json, estado, notas
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'PENDIENTE',$15)",
        )
        .bind(pid)
        .bind(&ext_id)
        .bind(company.uuid)
        .bind(&req.period)
        .bind(&entry_type)
        .bind(fecha)
        .bind(&agent)
        .bind(req.confianza)
        .bind(tp_uuid)
        .bind(unit_uuid)
        .bind(rubro_uuid)
        .bind(&description)
        .bind(&doc_json)
        .bind(&lineas_json)
        .bind(&notas_json)
        .execute(&mut *tx)
        .await?;

        let ev = Self::insert_audit_tx(
            &mut tx,
            &company,
            actor,
            "Radicó pre-asiento IA",
            &format!("{agent} · {description}"),
        )
        .await?;
        tx.commit().await?;

        Ok(CreatePreEntryResult {
            pre_asiento: FrontendPreAsiento {
                id: ext_id,
                empresa_id: company.slug,
                periodo: req.period,
                tipo: entry_type,
                fecha: fecha.format("%Y-%m-%d").to_string(),
                agente: agent,
                confianza: req.confianza,
                tercero_id: tp_ext,
                unidad_id: unit_ext,
                rubro_id: rubro_ext,
                descripcion: description,
                documento: doc_json,
                lineas: normalized_lines,
                estado: "PENDIENTE".into(),
                notas: req.notes,
            },
            auditoria: ev,
        })
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
        let comp_rows = sqlx::query(
            "SELECT c.id, COALESCE(c.clave_externa, c.id::text) AS ext_id,
                    COALESCE(co.slug, co.id::text) AS company_slug,
                    c.periodo, c.tipo_documento, c.consecutivo, c.fecha_contable,
                    c.estado, c.origen_creacion, c.descripcion, c.referencia,
                    c.total_debito, c.total_credito, COALESCE(c.hash_contenido, '') AS hash_contenido,
                    COALESCE(c.creado_por, 'Sistema') AS creado_por, c.created_at
               FROM comprobantes_contables c
               JOIN copropiedades co ON co.id = c.copropiedad_id
              WHERE c.copropiedad_id = $1
                AND ($2::text IS NULL OR $2 = 'todos' OR c.periodo = $2)
              ORDER BY c.fecha_contable, c.consecutivo, c.created_at",
        )
        .bind(company.uuid)
        .bind(period)
        .fetch_all(&mut *tx)
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
              WHERE c.copropiedad_id = $1
                AND ($2::text IS NULL OR $2 = 'todos' OR c.periodo = $2)
              ORDER BY m.comprobante_id, m.linea_orden, m.id",
        )
        .bind(company.uuid)
        .bind(period)
        .fetch_all(&mut *tx)
        .await?;
        tx.commit().await?;

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

    pub async fn trial_balance(
        &self,
        company_id: &str,
        period: &str,
    ) -> Result<Value, ApiError> {
        let mut tx = self.db.pool.begin().await?;
        let company = Self::resolve_company_tx(&mut tx, company_id).await?;
        let puc = Self::fetch_company_puc_tx(&mut tx, company.uuid).await?;

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
        .fetch_all(&mut *tx)
        .await?;
        tx.commit().await?;

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

        let rows = sqlx::query(
            "SELECT id, actor, accion, COALESCE(detalle, '') AS detalle, metadata, created_at
               FROM auditoria_eventos
              WHERE copropiedad_id = $1
              ORDER BY created_at DESC
              LIMIT 200",
        )
        .bind(company.uuid)
        .fetch_all(&mut *tx)
        .await?;
        tx.commit().await?;

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

    pub async fn authenticate(&self, email: &str, password: &str) -> Result<AuthUser, ApiError> {
        let user_row = sqlx::query(
            "SELECT id, email, nombre, password_hash, activo,
                    is_super_admin, max_copropiedades, plan_nombre, expires_at
               FROM usuarios
              WHERE LOWER(email) = LOWER($1)",
        )
        .bind(email.trim())
        .fetch_optional(&self.db.pool)
        .await?
        .ok_or_else(|| ApiError::Unauthorized("Credenciales inválidas.".into()))?;

        let stored_hash: String = user_row.try_get("password_hash")?;
        if !auth::verify_password(password, &stored_hash) {
            return Err(ApiError::Unauthorized("Credenciales inválidas.".into()));
        }

        let activo: bool = user_row.try_get("activo")?;
        if !activo {
            return Err(ApiError::Forbidden(
                "Cuenta suspendida. Contacta a Vértika.".into(),
            ));
        }

        let expires_at_dt: Option<DateTime<Utc>> = user_row.try_get("expires_at")?;
        if let Some(exp) = expires_at_dt {
            if exp < Utc::now() {
                return Err(ApiError::Forbidden(
                    "Tu periodo de prueba finalizó. Contacta a Vértika para activar tu plan."
                        .into(),
                ));
            }
        }

        let uid: Uuid = user_row.try_get("id")?;
        let is_super_admin: bool = user_row.try_get("is_super_admin")?;
        let max_copropiedades: i32 = user_row.try_get("max_copropiedades")?;
        let plan_nombre: String = user_row.try_get("plan_nombre")?;

        let roles = if is_super_admin {
            let comp_rows = sqlx::query(
                "SELECT COALESCE(slug, id::text) AS slug
                   FROM copropiedades
                  ORDER BY created_at, slug",
            )
            .fetch_all(&self.db.pool)
            .await?;
            comp_rows
                .into_iter()
                .filter_map(|r| r.try_get::<String, _>("slug").ok())
                .map(|slug| CompanyRole {
                    company_id: slug,
                    role: Role::SuperAdmin,
                })
                .collect()
        } else {
            let role_rows = sqlx::query(
                "SELECT COALESCE(co.slug, co.id::text) AS slug, r.rol
                   FROM usuario_copropiedad_roles r
                   JOIN copropiedades co ON co.id = r.copropiedad_id
                  WHERE r.usuario_id = $1
                  ORDER BY slug",
            )
            .bind(uid)
            .fetch_all(&self.db.pool)
            .await?;

            let mut out = Vec::with_capacity(role_rows.len());
            for rr in role_rows {
                let slug: String = rr.try_get("slug")?;
                let rol_str: String = rr.try_get("rol")?;
                if let Some(role) = Role::from_str_code(&rol_str) {
                    out.push(CompanyRole {
                        company_id: slug,
                        role,
                    });
                }
            }
            out
        };

        let primary_role = if is_super_admin {
            Role::SuperAdmin
        } else if roles.is_empty() && max_copropiedades >= 1 {
            // Contador recién creado sin copropiedades aún (autoservicio)
            Role::Contador
        } else {
            roles.first().map(|r| r.role).unwrap_or(Role::Consejo)
        };

        Ok(AuthUser {
            id: uid.to_string(),
            email: user_row.try_get("email")?,
            nombre: user_row.try_get("nombre")?,
            rol: primary_role,
            roles,
            is_super_admin,
            max_copropiedades,
            plan_nombre,
            expires_at: expires_at_dt.map(|dt| dt.to_rfc3339()),
        })
    }

    pub async fn change_password(
        &self,
        user_id: &str,
        current_password: &str,
        new_password: &str,
    ) -> Result<(), ApiError> {
        let next = new_password.trim();
        if next.len() < 8 {
            return Err(ApiError::unprocessable(
                "La nueva contraseña debe tener al menos 8 caracteres.",
            ));
        }

        let row = sqlx::query(
            "SELECT id, password_hash
               FROM usuarios
              WHERE id::text = $1 OR LOWER(email) = LOWER($1)",
        )
        .bind(user_id.trim())
        .fetch_optional(&self.db.pool)
        .await?
        .ok_or_else(|| ApiError::NotFound("Usuario no encontrado.".into()))?;

        let uid: Uuid = row.try_get("id")?;
        let stored_hash: String = row.try_get("password_hash")?;
        if !auth::verify_password(current_password, &stored_hash) {
            return Err(ApiError::Unauthorized("La contraseña actual no coincide.".into()));
        }

        let salt = format!("salt-{}", Uuid::new_v4().simple());
        let next_hash = auth::hash_password(next, &salt);
        sqlx::query("UPDATE usuarios SET password_hash = $2 WHERE id = $1")
            .bind(uid)
            .bind(next_hash)
            .execute(&self.db.pool)
            .await?;
        Ok(())
    }

    pub async fn create_user(
        &self,
        req: CreateUserRequest,
        created_by: Option<&str>,
    ) -> Result<AuthUser, ApiError> {
        let email = req.email.trim().to_lowercase();
        let nombre = req.nombre.trim().to_string();
        let password = req.password.trim();
        if !email.contains('@') {
            return Err(ApiError::unprocessable("Ingresa un correo electrónico válido."));
        }
        if nombre.is_empty() {
            return Err(ApiError::unprocessable("El nombre del usuario es obligatorio."));
        }
        if password.len() < 8 {
            return Err(ApiError::unprocessable(
                "La contraseña debe tener al menos 8 caracteres.",
            ));
        }

        let mut tx = self.db.pool.begin().await?;
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM usuarios WHERE LOWER(email) = LOWER($1))",
        )
        .bind(&email)
        .fetch_one(&mut *tx)
        .await?;
        if exists {
            return Err(ApiError::Conflict(
                "Ya existe un usuario con ese correo.".into(),
            ));
        }

        let uid = Uuid::new_v4();
        let salt = format!("salt-{}", Uuid::new_v4().simple());
        let pwd_hash = auth::hash_password(password, &salt);
        let creator_uuid = created_by.and_then(|s| Uuid::parse_str(s).ok());
        sqlx::query(
            "INSERT INTO usuarios (
                id, email, nombre, password_hash, activo,
                is_super_admin, max_copropiedades, plan_nombre, created_by
            ) VALUES ($1, $2, $3, $4, TRUE, FALSE, 1, 'USUARIO', $5)",
        )
        .bind(uid)
        .bind(&email)
        .bind(&nombre)
        .bind(pwd_hash)
        .bind(creator_uuid)
        .execute(&mut *tx)
        .await?;

        let comp_rows = sqlx::query(
            "SELECT id, COALESCE(slug, id::text) AS slug
               FROM copropiedades
              ORDER BY created_at, slug",
        )
        .fetch_all(&mut *tx)
        .await?;

        let requested = normalize_requested_companies(req.company_ids.as_deref());
        let mut roles = Vec::with_capacity(comp_rows.len());
        for cr in comp_rows {
            let cid: Uuid = cr.try_get("id")?;
            let slug: String = cr.try_get("slug")?;
            if let Some(scope) = &requested {
                let cid_str = cid.to_string();
                if !scope.iter().any(|s| s == &slug || s == &cid_str) {
                    continue;
                }
            }
            sqlx::query(
                "INSERT INTO usuario_copropiedad_roles (usuario_id, copropiedad_id, rol)
                 VALUES ($1, $2, $3)",
            )
            .bind(uid)
            .bind(cid)
            .bind(req.rol.as_str())
            .execute(&mut *tx)
            .await?;
            roles.push(CompanyRole {
                company_id: slug,
                role: req.rol,
            });
        }
        if roles.is_empty() {
            return Err(ApiError::BadRequest(
                "Ninguna copropiedad válida seleccionada.".into(),
            ));
        }
        tx.commit().await?;

        Ok(AuthUser {
            id: uid.to_string(),
            email,
            nombre,
            rol: req.rol,
            roles,
            is_super_admin: false,
            max_copropiedades: 1,
            plan_nombre: "USUARIO".into(),
            expires_at: None,
        })
    }

    pub async fn create_contador(
        &self,
        req: CreateContadorRequest,
        created_by: &str,
    ) -> Result<AuthUser, ApiError> {
        let email = req.email.trim().to_lowercase();
        let nombre = req.nombre.trim().to_string();
        let password = req.password.trim();
        if !email.contains('@') {
            return Err(ApiError::unprocessable("Ingresa un correo electrónico válido."));
        }
        if nombre.is_empty() {
            return Err(ApiError::unprocessable("El nombre del contador es obligatorio."));
        }
        if password.len() < 8 {
            return Err(ApiError::unprocessable(
                "La contraseña debe tener al menos 8 caracteres.",
            ));
        }
        let max_copropiedades = req.max_copropiedades.unwrap_or(1).clamp(1, 500);
        let plan_nombre = req
            .plan_nombre
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("PRUEBA")
            .to_uppercase();
        let expires_at = req
            .dias_prueba
            .filter(|&d| d > 0)
            .map(|d| Utc::now() + Duration::days(i64::from(d)));

        let mut tx = self.db.pool.begin().await?;
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM usuarios WHERE LOWER(email) = LOWER($1))",
        )
        .bind(&email)
        .fetch_one(&mut *tx)
        .await?;
        if exists {
            return Err(ApiError::Conflict(
                "Ya existe un usuario con ese correo.".into(),
            ));
        }

        let uid = Uuid::new_v4();
        let salt = format!("salt-{}", Uuid::new_v4().simple());
        let pwd_hash = auth::hash_password(password, &salt);
        let creator_uuid = Uuid::parse_str(created_by).ok();

        sqlx::query(
            "INSERT INTO usuarios (
                id, email, nombre, password_hash, activo,
                is_super_admin, max_copropiedades, plan_nombre, expires_at, created_by
            ) VALUES ($1, $2, $3, $4, TRUE, FALSE, $5, $6, $7, $8)",
        )
        .bind(uid)
        .bind(&email)
        .bind(&nombre)
        .bind(pwd_hash)
        .bind(max_copropiedades)
        .bind(&plan_nombre)
        .bind(expires_at)
        .bind(creator_uuid)
        .execute(&mut *tx)
        .await?;

        let mut roles = Vec::new();
        if let Some(scope) = normalize_requested_companies(req.company_ids.as_deref()) {
            let comp_rows = sqlx::query(
                "SELECT id, COALESCE(slug, id::text) AS slug FROM copropiedades ORDER BY created_at, slug",
            )
            .fetch_all(&mut *tx)
            .await?;
            for cr in comp_rows {
                let cid: Uuid = cr.try_get("id")?;
                let slug: String = cr.try_get("slug")?;
                let cid_str = cid.to_string();
                if !scope.iter().any(|s| s == &slug || s == &cid_str) {
                    continue;
                }
                sqlx::query(
                    "INSERT INTO usuario_copropiedad_roles (usuario_id, copropiedad_id, rol)
                     VALUES ($1, $2, 'CONTADOR') ON CONFLICT DO NOTHING",
                )
                .bind(uid)
                .bind(cid)
                .execute(&mut *tx)
                .await?;
                roles.push(CompanyRole {
                    company_id: slug,
                    role: Role::Contador,
                });
            }
        }
        tx.commit().await?;

        Ok(AuthUser {
            id: uid.to_string(),
            email,
            nombre,
            rol: Role::Contador,
            roles,
            is_super_admin: false,
            max_copropiedades,
            plan_nombre,
            expires_at: expires_at.map(|dt| dt.to_rfc3339()),
        })
    }

    async fn fetch_admin_contador_item(&self, uid: Uuid) -> Result<AdminContadorItem, ApiError> {
        let row = sqlx::query(
            "SELECT id, email, nombre, activo, plan_nombre, max_copropiedades, expires_at, created_at
               FROM usuarios
              WHERE id = $1",
        )
        .bind(uid)
        .fetch_optional(&self.db.pool)
        .await?
        .ok_or_else(|| ApiError::NotFound("Usuario no encontrado.".into()))?;

        let comp_rows = sqlx::query(
            "SELECT DISTINCT COALESCE(co.slug, co.id::text) AS slug,
                             co.nit, co.nombre_corto, co.razon_social, co.periodo_actual
               FROM copropiedades co
               LEFT JOIN usuario_copropiedad_roles r
                 ON r.copropiedad_id = co.id AND r.usuario_id = $1 AND r.rol = 'CONTADOR'
              WHERE co.owner_user_id = $1 OR r.usuario_id IS NOT NULL
              ORDER BY slug",
        )
        .bind(uid)
        .fetch_all(&self.db.pool)
        .await?;

        let mut copropiedades = Vec::with_capacity(comp_rows.len());
        for cr in comp_rows {
            copropiedades.push(AdminCompanyBrief {
                id: cr.try_get("slug")?,
                nit: cr.try_get("nit")?,
                nombre_corto: cr.try_get("nombre_corto")?,
                razon_social: cr.try_get("razon_social")?,
                periodo_actual: cr.try_get("periodo_actual")?,
            });
        }

        let usuarios_creados: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM usuarios WHERE created_by = $1")
                .bind(uid)
                .fetch_one(&self.db.pool)
                .await?;

        let expires_at_dt: Option<DateTime<Utc>> = row.try_get("expires_at")?;
        let created_at_dt: DateTime<Utc> = row.try_get("created_at")?;
        let vencido = expires_at_dt.is_some_and(|dt| dt < Utc::now());

        Ok(AdminContadorItem {
            id: uid.to_string(),
            email: row.try_get("email")?,
            nombre: row.try_get("nombre")?,
            activo: row.try_get("activo")?,
            plan_nombre: row.try_get("plan_nombre")?,
            max_copropiedades: row.try_get("max_copropiedades")?,
            copropiedades_usadas: copropiedades.len(),
            usuarios_creados: usuarios_creados.max(0) as usize,
            expires_at: expires_at_dt.map(|dt| dt.to_rfc3339()),
            vencido,
            created_at: created_at_dt.to_rfc3339(),
            copropiedades,
        })
    }

    pub async fn admin_overview(&self) -> Result<AdminOverviewResponse, ApiError> {
        let user_ids: Vec<Uuid> = sqlx::query_scalar(
            "SELECT DISTINCT u.id
               FROM usuarios u
              WHERE u.is_super_admin = FALSE
                AND (
                    EXISTS (
                        SELECT 1
                          FROM usuario_copropiedad_roles r
                         WHERE r.usuario_id = u.id AND r.rol = 'CONTADOR'
                    )
                    OR (
                        u.plan_nombre <> 'USUARIO'
                        AND NOT EXISTS (
                            SELECT 1
                              FROM usuario_copropiedad_roles r2
                             WHERE r2.usuario_id = u.id
                        )
                    )
                )
              ORDER BY u.id",
        )
        .fetch_all(&self.db.pool)
        .await?;

        let mut contadores = Vec::with_capacity(user_ids.len());
        for uid in user_ids {
            contadores.push(self.fetch_admin_contador_item(uid).await?);
        }
        contadores.sort_by(|a, b| b.created_at.cmp(&a.created_at));

        let total_copropiedades: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM copropiedades")
                .fetch_one(&self.db.pool)
                .await?;

        let total_contadores = contadores.len();
        let contadores_activos = contadores.iter().filter(|c| c.activo && !c.vencido).count();
        let pruebas_activas = contadores
            .iter()
            .filter(|c| c.activo && !c.vencido && c.expires_at.is_some())
            .count();
        let cuentas_suspendidas_o_vencidas = contadores
            .iter()
            .filter(|c| !c.activo || c.vencido)
            .count();

        Ok(AdminOverviewResponse {
            total_contadores,
            contadores_activos,
            total_copropiedades: total_copropiedades.max(0) as usize,
            pruebas_activas,
            cuentas_suspendidas_o_vencidas,
            contadores,
        })
    }

    pub async fn admin_update_user(
        &self,
        target_user_id: &str,
        req: UpdateAdminUserRequest,
    ) -> Result<AdminContadorItem, ApiError> {
        let row = sqlx::query(
            "SELECT id, is_super_admin, activo, max_copropiedades, plan_nombre, expires_at
               FROM usuarios
              WHERE id::text = $1 OR LOWER(email) = LOWER($1)",
        )
        .bind(target_user_id.trim())
        .fetch_optional(&self.db.pool)
        .await?
        .ok_or_else(|| ApiError::NotFound("Usuario no encontrado.".into()))?;

        let uid: Uuid = row.try_get("id")?;
        let is_sa: bool = row.try_get("is_super_admin")?;
        if is_sa {
            return Err(ApiError::Forbidden(
                "No se puede modificar una cuenta SUPER_ADMIN desde este endpoint.".into(),
            ));
        }

        let next_activo: bool = req.activo.unwrap_or(row.try_get("activo")?);
        let next_max: i32 = req
            .max_copropiedades
            .unwrap_or(row.try_get("max_copropiedades")?)
            .clamp(1, 500);
        let cur_plan: String = row.try_get("plan_nombre")?;
        let next_plan = req
            .plan_nombre
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_uppercase)
            .unwrap_or(cur_plan);

        let cur_exp: Option<DateTime<Utc>> = row.try_get("expires_at")?;
        let next_exp = if let Some(days) = req.extend_days {
            if days > 0 {
                let base = cur_exp
                    .filter(|dt| *dt > Utc::now())
                    .unwrap_or_else(Utc::now);
                Some(base + Duration::days(i64::from(days)))
            } else {
                cur_exp
            }
        } else if let Some(exp_raw) = req.expires_at {
            let trimmed = exp_raw.trim();
            if trimmed.is_empty() {
                None
            } else {
                let parsed = DateTime::parse_from_rfc3339(trimmed).map_err(|_| {
                    ApiError::unprocessable("Fecha expiresAt inválida (usa formato ISO-8601).")
                })?;
                Some(parsed.with_timezone(&Utc))
            }
        } else {
            cur_exp
        };

        sqlx::query(
            "UPDATE usuarios
                SET activo = $2,
                    max_copropiedades = $3,
                    plan_nombre = $4,
                    expires_at = $5
              WHERE id = $1",
        )
        .bind(uid)
        .bind(next_activo)
        .bind(next_max)
        .bind(&next_plan)
        .bind(next_exp)
        .execute(&self.db.pool)
        .await?;

        self.fetch_admin_contador_item(uid).await
    }

    pub async fn create_company(
        &self,
        owner_user_id: &str,
        is_super_admin: bool,
        req: CreateCompanyRequest,
        actor: &str,
    ) -> Result<CreateCompanyResult, ApiError> {
        let nit = req.nit.trim().to_string();
        let razon_social = req.razon_social.trim().to_string();
        let nombre_corto = req.nombre_corto.trim().to_string();
        if nit.len() < 5 {
            return Err(ApiError::unprocessable("Ingresa un NIT válido para la copropiedad."));
        }
        if razon_social.is_empty() || nombre_corto.is_empty() {
            return Err(ApiError::unprocessable(
                "La razón social y el nombre corto son obligatorios.",
            ));
        }

        let owner_uuid = Uuid::parse_str(owner_user_id.trim())
            .map_err(|_| ApiError::Unauthorized("Identificador de usuario inválido.".into()))?;

        let mut tx = self.db.pool.begin().await?;
        sqlx::query("SELECT pg_advisory_xact_lock(hashtext($1))")
            .bind(format!("company-quota:{owner_uuid}"))
            .execute(&mut *tx)
            .await?;

        let user_row = sqlx::query(
            "SELECT id, email, nombre, activo, is_super_admin, max_copropiedades, plan_nombre, expires_at
               FROM usuarios
              WHERE id = $1",
        )
        .bind(owner_uuid)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| ApiError::NotFound("Usuario autenticado no encontrado.".into()))?;

        let activo: bool = user_row.try_get("activo")?;
        if !activo {
            return Err(ApiError::Forbidden("Cuenta suspendida.".into()));
        }
        let max_copropiedades: i32 = user_row.try_get("max_copropiedades")?;
        let plan_nombre: String = user_row.try_get("plan_nombre")?;
        let expires_at_dt: Option<DateTime<Utc>> = user_row.try_get("expires_at")?;

        if !is_super_admin {
            let owned_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM copropiedades WHERE owner_user_id = $1",
            )
            .bind(owner_uuid)
            .fetch_one(&mut *tx)
            .await?;
            if owned_count >= i64::from(max_copropiedades.max(1)) {
                return Err(ApiError::Forbidden(format!(
                    "Alcanzaste el límite de tu plan ({owned_count}/{} copropiedades). Contacta a Vértika para ampliar tu cupo.",
                    max_copropiedades.max(1)
                )));
            }
        }

        let nit_exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM copropiedades WHERE nit = $1)")
                .bind(&nit)
                .fetch_one(&mut *tx)
                .await?;
        if nit_exists {
            return Err(ApiError::Conflict(
                "Ya existe una copropiedad registrada con ese NIT.".into(),
            ));
        }

        let base_slug = slugify_company_name(&nombre_corto);
        let mut slug = base_slug.clone();
        let mut suffix = 2usize;
        loop {
            let exists: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM copropiedades WHERE slug = $1)",
            )
            .bind(&slug)
            .fetch_one(&mut *tx)
            .await?;
            if !exists {
                break;
            }
            slug = format!("{base_slug}-{suffix}");
            suffix += 1;
        }

        let periodo = req
            .periodo_actual
            .as_deref()
            .map(str::trim)
            .filter(|s| s.len() == 7 && s.as_bytes()[4] == b'-')
            .map(str::to_string)
            .unwrap_or_else(|| Utc::now().format("%Y-%m").to_string());
        let presupuesto = req
            .presupuesto_anual
            .filter(|p| *p > Decimal::ZERO)
            .unwrap_or_else(|| Decimal::from(120_000_000));
        let fondo_pct = req
            .fondo_imprevistos_pct
            .filter(|v| *v >= Decimal::ONE)
            .unwrap_or(Decimal::ONE);
        let mora_pct = req
            .tasa_mora_mensual
            .filter(|v| *v >= Decimal::ZERO)
            .unwrap_or_else(|| Decimal::new(15, 1));
        let grupo_niif = req.grupo_niif.unwrap_or(3).clamp(2, 3);
        let ciudad = req
            .ciudad
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("Bogotá D.C.")
            .to_string();
        let direccion = req
            .direccion
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("Por definir")
            .to_string();
        let sigla = derive_sigla(&nombre_corto);

        let cid = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO copropiedades (
                id, slug, nit, razon_social, nombre_corto, sigla, ciudad, direccion,
                grupo_niif, porcentaje_fondo_imprevistos, tasa_mora_mensual,
                dia_corte_pronto_pago, descuento_pronto_pago_pct, llave_bre_b,
                presupuesto_anual, periodo_actual, saldos_iniciales, escala, color, owner_user_id
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,10,0,'',$12,$13,'{}'::jsonb,1,'#0F766E',$14)",
        )
        .bind(cid)
        .bind(&slug)
        .bind(&nit)
        .bind(&razon_social)
        .bind(&nombre_corto)
        .bind(&sigla)
        .bind(&ciudad)
        .bind(&direccion)
        .bind(grupo_niif)
        .bind(fondo_pct)
        .bind(mora_pct)
        .bind(presupuesto)
        .bind(&periodo)
        .bind(owner_uuid)
        .execute(&mut *tx)
        .await?;

        for acc in demo_puc() {
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
            .execute(&mut *tx)
            .await?;
        }

        for r in default_rubros_for_company(&slug, presupuesto) {
            sqlx::query(
                "INSERT INTO rubros_presupuestales (
                    id, clave_externa, copropiedad_id, clave, nombre, cuenta_codigo, centro_costo, presupuesto_anual
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
            )
            .bind(Uuid::new_v4())
            .bind(&r.id)
            .bind(cid)
            .bind(&r.key)
            .bind(&r.nombre)
            .bind(&r.cuenta)
            .bind(&r.centro)
            .bind(r.presupuesto_anual)
            .execute(&mut *tx)
            .await?;
        }

        if !is_super_admin {
            sqlx::query(
                "INSERT INTO usuario_copropiedad_roles (usuario_id, copropiedad_id, rol)
                 VALUES ($1, $2, 'CONTADOR') ON CONFLICT DO NOTHING",
            )
            .bind(owner_uuid)
            .bind(cid)
            .execute(&mut *tx)
            .await?;
        }

        let aud_uuid = Uuid::new_v4();
        let aud_id = aud_uuid.to_string();
        let aud_detalle = format!("Creó la copropiedad {razon_social} (NIT {nit})");
        let now = Utc::now();
        sqlx::query(
            "INSERT INTO auditoria_eventos (id, copropiedad_id, actor, accion, detalle, metadata, created_at)
             VALUES ($1, $2, $3, 'CREAR_COPROPIEDAD', $4, '{}'::jsonb, $5)",
        )
        .bind(aud_uuid)
        .bind(cid)
        .bind(actor)
        .bind(&aud_detalle)
        .bind(now)
        .execute(&mut *tx)
        .await?;

        let roles = if is_super_admin {
            let rows = sqlx::query("SELECT COALESCE(slug, id::text) AS slug FROM copropiedades ORDER BY created_at, slug")
                .fetch_all(&mut *tx)
                .await?;
            rows.into_iter()
                .filter_map(|r| r.try_get::<String, _>("slug").ok())
                .map(|s| CompanyRole { company_id: s, role: Role::SuperAdmin })
                .collect()
        } else {
            let rows = sqlx::query(
                "SELECT COALESCE(co.slug, co.id::text) AS slug, r.rol
                   FROM usuario_copropiedad_roles r
                   JOIN copropiedades co ON co.id = r.copropiedad_id
                  WHERE r.usuario_id = $1
                  ORDER BY slug",
            )
            .bind(owner_uuid)
            .fetch_all(&mut *tx)
            .await?;
            rows.into_iter()
                .filter_map(|r| {
                    let s = r.try_get::<String, _>("slug").ok()?;
                    let role = Role::from_str_code(&r.try_get::<String, _>("rol").ok()?)?;
                    Some(CompanyRole { company_id: s, role })
                })
                .collect()
        };

        tx.commit().await?;

        let updated_user = AuthUser {
            id: owner_uuid.to_string(),
            email: user_row.try_get("email")?,
            nombre: user_row.try_get("nombre")?,
            rol: if is_super_admin { Role::SuperAdmin } else { Role::Contador },
            roles,
            is_super_admin,
            max_copropiedades,
            plan_nombre,
            expires_at: expires_at_dt.map(|dt| dt.to_rfc3339()),
        };
        let token = auth::issue_token(&updated_user)?;

        let copropiedad = FrontendCopropiedad {
            id: slug.clone(),
            nit,
            razon_social,
            nombre_corto,
            sigla,
            ciudad,
            direccion,
            grupo_niif,
            fondo_imprevistos_pct: fondo_pct,
            tasa_mora_mensual: mora_pct,
            dia_corte_pronto_pago: 10,
            descuento_pronto_pago_pct: Decimal::ZERO,
            llave_bre_b: String::new(),
            presupuesto_anual: presupuesto,
            periodo_actual: periodo,
            saldos_iniciales: HashMap::new(),
            escala: Decimal::ONE,
            color: "#0F766E".into(),
            wompi_public_key: String::new(),
            wompi_sandbox: true,
            wompi_configurado: false,
        };

        Ok(CreateCompanyResult {
            copropiedad,
            auditoria: FrontendAuditoria {
                id: aud_id,
                ts: now.to_rfc3339(),
                actor: actor.into(),
                accion: "CREAR_COPROPIEDAD".into(),
                detalle: aud_detalle,
                empresa_id: slug,
            },
            user: updated_user,
            token,
        })
    }

    pub async fn bill_period(
        &self,
        company_id: &str,
        period: &str,
        req: BillPeriodRequest,
        actor: &str,
    ) -> Result<BillPeriodResult, ApiError> {
        let mut tx = self.db.pool.begin().await?;
        let company_row = Self::resolve_company_tx(&mut tx, company_id).await?;
        Self::ensure_period_open_tx(&mut tx, &company_row, period).await?;

        let already_billed: bool = sqlx::query_scalar(
            "SELECT EXISTS(
                SELECT 1
                  FROM comprobantes_contables
                 WHERE copropiedad_id = $1
                   AND periodo = $2
                   AND estado <> 'ANULADO'
                   AND tipo_documento = 'CC'
                   AND (origen_creacion = 'AGENTE_IA_LIQUIDADOR' OR descripcion LIKE 'Liquidación masiva de expensas%')
             )",
        )
        .bind(company_row.uuid)
        .bind(period)
        .fetch_one(&mut *tx)
        .await?;
        if already_billed {
            return Err(ApiError::Conflict(format!(
                "El periodo {period} ya tiene causación masiva de expensas."
            )));
        }

        let comp_meta = sqlx::query(
            "SELECT presupuesto_anual, COALESCE(porcentaje_fondo_imprevistos, 1.0) AS fondo_pct,
                    tasa_mora_mensual, nit, razon_social, COALESCE(nombre_corto, razon_social) AS nombre_corto,
                    sigla, ciudad, direccion, grupo_niif, COALESCE(dia_corte_pronto_pago, 10::smallint) AS dia_corte,
                    COALESCE(descuento_pronto_pago_pct, 0) AS desc_pct, COALESCE(llave_bre_b, '') AS llave_bre_b,
                    color, COALESCE(wompi_public_key, '') AS wompi_public_key,
                    COALESCE(wompi_sandbox, TRUE) AS wompi_sandbox,
                    (COALESCE(wompi_public_key, '') <> '' AND COALESCE(wompi_integrity_secret, '') <> '') AS wompi_configurado
               FROM copropiedades
              WHERE id = $1",
        )
        .bind(company_row.uuid)
        .fetch_one(&mut *tx)
        .await?;
        let saldos_map: HashMap<String, Decimal> =
            serde_json::from_value(company_row.saldos_iniciales.clone()).unwrap_or_default();
        let company_dto = FrontendCopropiedad {
            id: company_row.slug.clone(),
            nit: comp_meta.try_get("nit")?,
            razon_social: comp_meta.try_get("razon_social")?,
            nombre_corto: comp_meta.try_get("nombre_corto")?,
            sigla: comp_meta.try_get("sigla")?,
            ciudad: comp_meta.try_get("ciudad")?,
            direccion: comp_meta.try_get("direccion")?,
            grupo_niif: comp_meta.try_get("grupo_niif")?,
            fondo_imprevistos_pct: comp_meta.try_get("fondo_pct")?,
            tasa_mora_mensual: comp_meta.try_get("tasa_mora_mensual")?,
            dia_corte_pronto_pago: comp_meta.try_get("dia_corte")?,
            descuento_pronto_pago_pct: comp_meta.try_get("desc_pct")?,
            llave_bre_b: comp_meta.try_get("llave_bre_b")?,
            presupuesto_anual: comp_meta.try_get("presupuesto_anual")?,
            periodo_actual: company_row.periodo_actual.clone(),
            saldos_iniciales: saldos_map,
            escala: company_row.escala,
            color: comp_meta.try_get("color")?,
            wompi_public_key: comp_meta.try_get("wompi_public_key")?,
            wompi_sandbox: comp_meta.try_get("wompi_sandbox")?,
            wompi_configurado: comp_meta.try_get("wompi_configurado")?,
        };

        let unit_rows = sqlx::query(
            "SELECT u.id, COALESCE(u.clave_externa, u.id::text) AS ext_id,
                    u.grupo_torre, u.numero_unidad, COALESCE(u.tipo, 'APARTAMENTO') AS tipo,
                    COALESCE(u.area, 0) AS area, u.coeficiente,
                    COALESCE(u.matricula_inmobiliaria, '') AS matricula, u.cartera_congelada,
                    COALESCE((
                        SELECT COALESCE(t.clave_externa, t.id::text)
                          FROM vinculos_unidad_tercero v
                          JOIN terceros t ON t.id = v.tercero_id
                         WHERE v.unidad_id = u.id AND v.rol_en_unidad = 'PROPIETARIO' AND v.activo = TRUE
                         LIMIT 1
                    ), '') AS prop_ext,
                    (
                        SELECT COALESCE(t.clave_externa, t.id::text)
                          FROM vinculos_unidad_tercero v
                          JOIN terceros t ON t.id = v.tercero_id
                         WHERE v.unidad_id = u.id AND v.rol_en_unidad = 'ARRENDATARIO' AND v.activo = TRUE
                         LIMIT 1
                    ) AS arr_ext
               FROM unidades_inmobiliarias u
              WHERE u.copropiedad_id = $1
              ORDER BY u.grupo_torre, u.numero_unidad",
        )
        .bind(company_row.uuid)
        .fetch_all(&mut *tx)
        .await?;

        let mut units = Vec::with_capacity(unit_rows.len());
        for ur in unit_rows {
            units.push(FrontendUnidad {
                id: ur.try_get("ext_id")?,
                empresa_id: company_row.slug.clone(),
                torre: ur.try_get("grupo_torre")?,
                numero: ur.try_get("numero_unidad")?,
                tipo: ur.try_get("tipo")?,
                area: ur.try_get("area")?,
                coeficiente: ur.try_get("coeficiente")?,
                matricula: ur.try_get("matricula")?,
                propietario_id: ur.try_get("prop_ext")?,
                arrendatario_id: ur.try_get("arr_ext")?,
                cartera_congelada: ur.try_get("cartera_congelada")?,
            });
        }

        let overdue = if req.incluir_mora {
            let prior_entries = self.load_entries_query(Some(company_row.uuid), None).await?;
            compute_unit_overdue_balances(&prior_entries, &company_row.slug, period)
        } else {
            HashMap::new()
        };

        let (raw_lines, billed_units) =
            build_billing_lines(&company_dto, &units, &overdue, req.incluir_mora)?;

        let puc = Self::fetch_company_puc_tx(&mut tx, company_row.uuid).await?;
        let fecha = format!("{period}-01");
        let descripcion = req
            .descripcion
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(ToString::to_string)
            .unwrap_or_else(|| format!("Liquidación masiva de expensas {period}"));
        let referencia = format!("EXP-{period}");

        let comp = Self::insert_voucher_tx(
            &mut tx,
            &company_row,
            "CC",
            period,
            &fecha,
            "AGENTE_IA_LIQUIDADOR",
            &descripcion,
            Some(&referencia),
            actor,
            raw_lines,
            &puc,
        )
        .await?;

        let ev = Self::insert_audit_tx(
            &mut tx,
            &company_row,
            actor,
            "Causó expensas del periodo",
            &format!(
                "{}-{} · {billed_units} unidades ({period})",
                comp.tipo, comp.consecutivo
            ),
        )
        .await?;
        tx.commit().await?;

        Ok(BillPeriodResult {
            comprobante: comp,
            auditoria: ev,
            unidades_facturadas: billed_units,
        })
    }

    pub async fn open_next_period(
        &self,
        company_id: &str,
        actor: &str,
    ) -> Result<OpenNextPeriodResult, ApiError> {
        let mut tx = self.db.pool.begin().await?;
        let company = Self::resolve_company_tx(&mut tx, company_id).await?;
        let current = company.periodo_actual.clone();

        let is_closed: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM periodos_cerrados WHERE copropiedad_id = $1 AND periodo = $2)",
        )
        .bind(company.uuid)
        .bind(&current)
        .fetch_one(&mut *tx)
        .await?;
        if !is_closed {
            return Err(ApiError::Conflict(format!(
                "Debes ejecutar el cierre del periodo {current} antes de abrir el siguiente."
            )));
        }

        let next = next_period_ym(&current)?;
        sqlx::query("UPDATE copropiedades SET periodo_actual = $2 WHERE id = $1")
            .bind(company.uuid)
            .bind(&next)
            .execute(&mut *tx)
            .await?;

        let ev = Self::insert_audit_tx(
            &mut tx,
            &company,
            actor,
            "Abrió nuevo periodo",
            &format!("{current} → {next}"),
        )
        .await?;
        tx.commit().await?;

        Ok(OpenNextPeriodResult {
            empresa_id: company.slug,
            periodo_anterior: current,
            periodo_nuevo: next,
            auditoria: ev,
        })
    }

    pub async fn create_unit(
        &self,
        company_id: &str,
        req: UpsertUnitRequest,
        actor: &str,
    ) -> Result<FrontendUnidad, ApiError> {
        if req.coeficiente <= Decimal::ZERO {
            return Err(ApiError::unprocessable("El coeficiente debe ser mayor a cero."));
        }
        let mut tx = self.db.pool.begin().await?;
        let company = Self::resolve_company_tx(&mut tx, company_id).await?;
        let prop_uuid = Self::resolve_optional_fk(&mut tx, "terceros", Some(&req.propietario_id))
            .await?
            .ok_or_else(|| ApiError::BadRequest("El propietario indicado no existe.".into()))?;
        let arr_uuid = match req.arrendatario_id.as_deref().filter(|s| !s.trim().is_empty()) {
            Some(arr) => Some(
                Self::resolve_optional_fk(&mut tx, "terceros", Some(arr))
                    .await?
                    .ok_or_else(|| ApiError::BadRequest("El arrendatario indicado no existe.".into()))?,
            ),
            None => None,
        };

        let uid = Uuid::new_v4();
        let ext_id = format!("u-{}", uid.simple());
        sqlx::query(
            "INSERT INTO unidades_inmobiliarias (
                id, clave_externa, copropiedad_id, grupo_torre, numero_unidad, tipo,
                area, matricula_inmobiliaria, coeficiente, esta_arrendado, cartera_congelada
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        )
        .bind(uid)
        .bind(&ext_id)
        .bind(company.uuid)
        .bind(req.torre.trim())
        .bind(req.numero.trim())
        .bind(&req.tipo)
        .bind(req.area)
        .bind(req.matricula.trim())
        .bind(req.coeficiente)
        .bind(arr_uuid.is_some())
        .bind(req.cartera_congelada)
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            "INSERT INTO vinculos_unidad_tercero (unidad_id, tercero_id, rol_en_unidad)
             VALUES ($1, $2, 'PROPIETARIO')",
        )
        .bind(uid)
        .bind(prop_uuid)
        .execute(&mut *tx)
        .await?;

        if let Some(arr_id) = arr_uuid {
            sqlx::query(
                "INSERT INTO vinculos_unidad_tercero (unidad_id, tercero_id, rol_en_unidad)
                 VALUES ($1, $2, 'ARRENDATARIO')",
            )
            .bind(uid)
            .bind(arr_id)
            .execute(&mut *tx)
            .await?;
        }

        let _ = Self::insert_audit_tx(
            &mut tx,
            &company,
            actor,
            "Creó unidad",
            &format!("{} {}", req.torre.trim(), req.numero.trim()),
        )
        .await?;
        tx.commit().await?;

        Ok(FrontendUnidad {
            id: ext_id,
            empresa_id: company.slug,
            torre: req.torre.trim().into(),
            numero: req.numero.trim().into(),
            tipo: req.tipo,
            area: req.area,
            coeficiente: req.coeficiente,
            matricula: req.matricula.trim().into(),
            propietario_id: req.propietario_id,
            arrendatario_id: req.arrendatario_id.filter(|s| !s.trim().is_empty()),
            cartera_congelada: req.cartera_congelada,
        })
    }

    pub async fn update_unit(
        &self,
        company_id: &str,
        unit_id: &str,
        req: UpsertUnitRequest,
        actor: &str,
    ) -> Result<FrontendUnidad, ApiError> {
        if req.coeficiente <= Decimal::ZERO {
            return Err(ApiError::unprocessable("El coeficiente debe ser mayor a cero."));
        }
        let mut tx = self.db.pool.begin().await?;
        let company = Self::resolve_company_tx(&mut tx, company_id).await?;
        let unit_row = sqlx::query(
            "SELECT id, COALESCE(clave_externa, id::text) AS ext_id
               FROM unidades_inmobiliarias
              WHERE copropiedad_id = $1 AND (clave_externa = $2 OR id::text = $2)",
        )
        .bind(company.uuid)
        .bind(unit_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("Unidad '{unit_id}' no encontrada.")))?;
        let uid: Uuid = unit_row.try_get("id")?;
        let ext_id: String = unit_row.try_get("ext_id")?;

        let prop_uuid = Self::resolve_optional_fk(&mut tx, "terceros", Some(&req.propietario_id))
            .await?
            .ok_or_else(|| ApiError::BadRequest("El propietario indicado no existe.".into()))?;
        let arr_uuid = match req.arrendatario_id.as_deref().filter(|s| !s.trim().is_empty()) {
            Some(arr) => Some(
                Self::resolve_optional_fk(&mut tx, "terceros", Some(arr))
                    .await?
                    .ok_or_else(|| ApiError::BadRequest("El arrendatario indicado no existe.".into()))?,
            ),
            None => None,
        };

        sqlx::query(
            "UPDATE unidades_inmobiliarias
                SET grupo_torre = $2, numero_unidad = $3, tipo = $4, area = $5,
                    matricula_inmobiliaria = $6, coeficiente = $7, esta_arrendado = $8,
                    cartera_congelada = $9
              WHERE id = $1",
        )
        .bind(uid)
        .bind(req.torre.trim())
        .bind(req.numero.trim())
        .bind(&req.tipo)
        .bind(req.area)
        .bind(req.matricula.trim())
        .bind(req.coeficiente)
        .bind(arr_uuid.is_some())
        .bind(req.cartera_congelada)
        .execute(&mut *tx)
        .await?;

        sqlx::query("DELETE FROM vinculos_unidad_tercero WHERE unidad_id = $1")
            .bind(uid)
            .execute(&mut *tx)
            .await?;
        sqlx::query(
            "INSERT INTO vinculos_unidad_tercero (unidad_id, tercero_id, rol_en_unidad)
             VALUES ($1, $2, 'PROPIETARIO')",
        )
        .bind(uid)
        .bind(prop_uuid)
        .execute(&mut *tx)
        .await?;
        if let Some(arr_id) = arr_uuid {
            sqlx::query(
                "INSERT INTO vinculos_unidad_tercero (unidad_id, tercero_id, rol_en_unidad)
                 VALUES ($1, $2, 'ARRENDATARIO')",
            )
            .bind(uid)
            .bind(arr_id)
            .execute(&mut *tx)
            .await?;
        }

        let _ = Self::insert_audit_tx(
            &mut tx,
            &company,
            actor,
            "Actualizó unidad",
            &format!("{} {}", req.torre.trim(), req.numero.trim()),
        )
        .await?;
        tx.commit().await?;

        Ok(FrontendUnidad {
            id: ext_id,
            empresa_id: company.slug,
            torre: req.torre.trim().into(),
            numero: req.numero.trim().into(),
            tipo: req.tipo,
            area: req.area,
            coeficiente: req.coeficiente,
            matricula: req.matricula.trim().into(),
            propietario_id: req.propietario_id,
            arrendatario_id: req.arrendatario_id.filter(|s| !s.trim().is_empty()),
            cartera_congelada: req.cartera_congelada,
        })
    }

    pub async fn create_third_party(
        &self,
        company_id: &str,
        req: UpsertThirdPartyRequest,
        actor: &str,
    ) -> Result<FrontendTercero, ApiError> {
        if req.nombre.trim().is_empty() || req.documento.trim().is_empty() {
            return Err(ApiError::unprocessable("Nombre y documento del tercero son obligatorios."));
        }
        let mut tx = self.db.pool.begin().await?;
        let company = Self::resolve_company_tx(&mut tx, company_id).await?;
        let tid = Uuid::new_v4();
        let ext_id = format!("tp-{}", tid.simple());
        let dv = req.dv.filter(|s| !s.trim().is_empty());

        sqlx::query(
            "INSERT INTO terceros (
                id, clave_externa, copropiedad_id, nombre, tipo, documento, dv,
                email, telefono, ciudad, retefuente_pct, reteica_pct, reteiva_pct,
                regimen_especial, no_obligado
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
        )
        .bind(tid)
        .bind(&ext_id)
        .bind(company.uuid)
        .bind(req.nombre.trim())
        .bind(&req.tipo)
        .bind(req.documento.trim())
        .bind(&dv)
        .bind(req.email.trim())
        .bind(req.telefono.trim())
        .bind(req.ciudad.trim())
        .bind(req.retefuente_pct)
        .bind(req.reteica_pct)
        .bind(req.reteiva_pct)
        .bind(req.regimen_especial.unwrap_or(false))
        .bind(req.no_obligado)
        .execute(&mut *tx)
        .await?;

        let _ = Self::insert_audit_tx(&mut tx, &company, actor, "Creó tercero", req.nombre.trim())
            .await?;
        tx.commit().await?;

        Ok(FrontendTercero {
            id: ext_id,
            empresa_id: Some(company.slug),
            nombre: req.nombre.trim().into(),
            tipo: req.tipo,
            documento: req.documento.trim().into(),
            dv,
            email: req.email.trim().into(),
            telefono: req.telefono.trim().into(),
            ciudad: req.ciudad.trim().into(),
            retefuente_pct: req.retefuente_pct,
            reteica_pct: req.reteica_pct,
            reteiva_pct: req.reteiva_pct,
            no_obligado: req.no_obligado,
            regimen_especial: req.regimen_especial,
        })
    }

    pub async fn update_third_party(
        &self,
        company_id: &str,
        tp_id: &str,
        req: UpsertThirdPartyRequest,
        actor: &str,
    ) -> Result<FrontendTercero, ApiError> {
        let mut tx = self.db.pool.begin().await?;
        let company = Self::resolve_company_tx(&mut tx, company_id).await?;
        let tp_row = sqlx::query(
            "SELECT id, COALESCE(clave_externa, id::text) AS ext_id, copropiedad_id
               FROM terceros
              WHERE (clave_externa = $1 OR id::text = $1)
                AND (copropiedad_id IS NULL OR copropiedad_id = $2)",
        )
        .bind(tp_id)
        .bind(company.uuid)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("Tercero '{tp_id}' no encontrado.")))?;

        let tid: Uuid = tp_row.try_get("id")?;
        let ext_id: String = tp_row.try_get("ext_id")?;
        let cid: Option<Uuid> = tp_row.try_get("copropiedad_id")?;
        if cid.is_none() {
            return Err(ApiError::Forbidden(
                "Los proveedores globales compartidos no pueden modificarse desde una copropiedad individual.".into(),
            ));
        }
        let dv = req.dv.filter(|s| !s.trim().is_empty());

        sqlx::query(
            "UPDATE terceros
                SET nombre = $2, tipo = $3, documento = $4, dv = $5, email = $6,
                    telefono = $7, ciudad = $8, retefuente_pct = $9, reteica_pct = $10,
                    reteiva_pct = $11, regimen_especial = $12, no_obligado = $13
              WHERE id = $1",
        )
        .bind(tid)
        .bind(req.nombre.trim())
        .bind(&req.tipo)
        .bind(req.documento.trim())
        .bind(&dv)
        .bind(req.email.trim())
        .bind(req.telefono.trim())
        .bind(req.ciudad.trim())
        .bind(req.retefuente_pct)
        .bind(req.reteica_pct)
        .bind(req.reteiva_pct)
        .bind(req.regimen_especial.unwrap_or(false))
        .bind(req.no_obligado)
        .execute(&mut *tx)
        .await?;

        let _ = Self::insert_audit_tx(
            &mut tx,
            &company,
            actor,
            "Actualizó tercero",
            req.nombre.trim(),
        )
        .await?;
        tx.commit().await?;

        Ok(FrontendTercero {
            id: ext_id,
            empresa_id: cid.map(|_| company.slug),
            nombre: req.nombre.trim().into(),
            tipo: req.tipo,
            documento: req.documento.trim().into(),
            dv,
            email: req.email.trim().into(),
            telefono: req.telefono.trim().into(),
            ciudad: req.ciudad.trim().into(),
            retefuente_pct: req.retefuente_pct,
            reteica_pct: req.reteica_pct,
            reteiva_pct: req.reteiva_pct,
            no_obligado: req.no_obligado,
            regimen_especial: req.regimen_especial,
        })
    }

    pub async fn copy_third_parties(
        &self,
        target_company_id: &str,
        req: CopyThirdPartiesRequest,
        actor: &str,
    ) -> Result<CopyThirdPartiesResult, ApiError> {
        let source_id = req.source_company_id.trim();
        if source_id.is_empty() || source_id == target_company_id {
            return Err(ApiError::unprocessable(
                "Selecciona una copropiedad origen distinta a la actual.",
            ));
        }

        let mut tx = self.db.pool.begin().await?;
        let target_company = Self::resolve_company_tx(&mut tx, target_company_id).await?;
        let source_company = Self::resolve_company_tx(&mut tx, source_id).await?;

        let existing_docs_vec: Vec<String> = sqlx::query_scalar(
            "SELECT LOWER(TRIM(documento)) FROM terceros WHERE copropiedad_id = $1",
        )
        .bind(target_company.uuid)
        .fetch_all(&mut *tx)
        .await?;
        let mut seen_docs: std::collections::HashSet<String> =
            existing_docs_vec.into_iter().collect();

        let source_rows = sqlx::query(
            "SELECT COALESCE(clave_externa, id::text) AS ext_id,
                    nombre, tipo, documento, dv, email, telefono, ciudad,
                    retefuente_pct, reteica_pct, reteiva_pct, no_obligado, regimen_especial
               FROM terceros
              WHERE copropiedad_id = $1
              ORDER BY nombre",
        )
        .bind(source_company.uuid)
        .fetch_all(&mut *tx)
        .await?;

        let filter_ids: Option<std::collections::HashSet<String>> = req.third_party_ids.map(|v| {
            v.into_iter()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        });

        let mut copiados_vec = Vec::new();
        let mut omitidos = 0usize;

        for row in source_rows {
            let ext_id: String = row.try_get("ext_id")?;
            if let Some(ids) = &filter_ids {
                if !ids.contains(&ext_id) {
                    continue;
                }
            }
            let documento: String = row.try_get("documento")?;
            let doc_key = documento.trim().to_lowercase();
            if seen_docs.contains(&doc_key) {
                omitidos += 1;
                continue;
            }
            seen_docs.insert(doc_key);

            let new_uuid = Uuid::new_v4();
            let new_ext = format!("ter-{}", new_uuid.simple());
            let nombre: String = row.try_get("nombre")?;
            let tipo: String = row.try_get("tipo")?;
            let dv: Option<String> = row.try_get("dv")?;
            let email: String = row.try_get::<Option<String>, _>("email")?.unwrap_or_default();
            let telefono: String = row.try_get::<Option<String>, _>("telefono")?.unwrap_or_default();
            let ciudad: String = row.try_get::<Option<String>, _>("ciudad")?.unwrap_or_default();
            let retefuente_pct: Decimal = row.try_get("retefuente_pct")?;
            let reteica_pct: Decimal = row.try_get("reteica_pct")?;
            let reteiva_pct: Decimal = row.try_get("reteiva_pct")?;
            let no_obligado: bool = row.try_get("no_obligado")?;
            let regimen_especial: bool = row.try_get("regimen_especial")?;

            sqlx::query(
                "INSERT INTO terceros (
                    id, clave_externa, copropiedad_id, nombre, tipo, documento, dv,
                    email, telefono, ciudad, retefuente_pct, reteica_pct, reteiva_pct,
                    regimen_especial, no_obligado
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
            )
            .bind(new_uuid)
            .bind(&new_ext)
            .bind(target_company.uuid)
            .bind(&nombre)
            .bind(&tipo)
            .bind(&documento)
            .bind(&dv)
            .bind(&email)
            .bind(&telefono)
            .bind(&ciudad)
            .bind(retefuente_pct)
            .bind(reteica_pct)
            .bind(reteiva_pct)
            .bind(regimen_especial)
            .bind(no_obligado)
            .execute(&mut *tx)
            .await?;

            copiados_vec.push(FrontendTercero {
                id: new_ext,
                empresa_id: Some(target_company.slug.clone()),
                nombre,
                tipo,
                documento,
                dv,
                email,
                telefono,
                ciudad,
                retefuente_pct,
                reteica_pct,
                reteiva_pct,
                no_obligado,
                regimen_especial: Some(regimen_especial),
            });
        }

        if !copiados_vec.is_empty() {
            Self::insert_audit_tx(
                &mut tx,
                &target_company,
                actor,
                "Copió terceros",
                &format!(
                    "Copió {} tercero(s) desde {} ({} omitido(s))",
                    copiados_vec.len(),
                    source_company.slug,
                    omitidos
                ),
            )
            .await?;
        }
        tx.commit().await?;

        Ok(CopyThirdPartiesResult {
            copiados: copiados_vec.len(),
            omitidos,
            terceros: copiados_vec,
        })
    }

    pub async fn create_puc_account(
        &self,
        company_id: &str,
        req: CreatePucAccountRequest,
        actor: &str,
    ) -> Result<LedgerAccount, ApiError> {
        let code = req.codigo.trim().to_string();
        if code.is_empty() || req.nombre.trim().is_empty() {
            return Err(ApiError::unprocessable("Código y nombre de cuenta son obligatorios."));
        }
        if !["ACTIVO", "PASIVO", "PATRIMONIO", "INGRESO", "GASTO"].contains(&req.tipo.as_str()) {
            return Err(ApiError::unprocessable("Tipo de cuenta PUC inválido."));
        }
        if !["D", "C"].contains(&req.naturaleza.as_str()) {
            return Err(ApiError::unprocessable("La naturaleza debe ser D o C."));
        }
        let mut tx = self.db.pool.begin().await?;
        let company = Self::resolve_company_tx(&mut tx, company_id).await?;
        let rubro_key = req.rubro_key.filter(|s| !s.trim().is_empty());
        let nota = req.nota.filter(|s| !s.trim().is_empty());
        let is_cash = code.starts_with("11");

        sqlx::query(
            "INSERT INTO puc_esal_cuentas (
                copropiedad_id, codigo_cuenta, nombre_cuenta, tipo_cuenta, naturaleza,
                rubro_presupuesto_key, requiere_tercero, requiere_unidad, es_efectivo, restringida, nota
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,FALSE,$10)",
        )
        .bind(company.uuid)
        .bind(&code)
        .bind(req.nombre.trim())
        .bind(&req.tipo)
        .bind(&req.naturaleza)
        .bind(&rubro_key)
        .bind(req.requiere_tercero)
        .bind(req.requiere_unidad)
        .bind(is_cash)
        .bind(&nota)
        .execute(&mut *tx)
        .await?;

        let _ = Self::insert_audit_tx(
            &mut tx,
            &company,
            actor,
            "Creó cuenta PUC",
            &format!("{code} · {}", req.nombre.trim()),
        )
        .await?;
        tx.commit().await?;

        Ok(LedgerAccount {
            code,
            name: req.nombre.trim().into(),
            account_type: req.tipo,
            nature: req.naturaleza,
            rubric_key: rubro_key,
            requires_third_party: req.requiere_tercero,
            requires_unit: req.requiere_unidad,
            is_cash,
            restricted: false,
            note: nota,
        })
    }

    pub async fn update_rubro_budget(
        &self,
        company_id: &str,
        rubro_id: &str,
        presupuesto_anual: Decimal,
        actor: &str,
    ) -> Result<FrontendRubro, ApiError> {
        if presupuesto_anual < Decimal::ZERO {
            return Err(ApiError::unprocessable("El presupuesto anual no puede ser negativo."));
        }
        let mut tx = self.db.pool.begin().await?;
        let company = Self::resolve_company_tx(&mut tx, company_id).await?;
        let row = sqlx::query(
            "UPDATE rubros_presupuestales
                SET presupuesto_anual = $3
              WHERE copropiedad_id = $1 AND (clave_externa = $2 OR id::text = $2)
             RETURNING COALESCE(clave_externa, id::text) AS ext_id, clave, nombre,
                       COALESCE(centro_costo, '') AS centro, presupuesto_anual, cuenta_codigo",
        )
        .bind(company.uuid)
        .bind(rubro_id)
        .bind(presupuesto_anual)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("Rubro '{rubro_id}' no encontrado.")))?;

        sqlx::query(
            "UPDATE copropiedades
                SET presupuesto_anual = (
                    SELECT COALESCE(SUM(presupuesto_anual), 0)
                      FROM rubros_presupuestales
                     WHERE copropiedad_id = $1
                )
              WHERE id = $1",
        )
        .bind(company.uuid)
        .execute(&mut *tx)
        .await?;

        let updated = FrontendRubro {
            id: row.try_get("ext_id")?,
            empresa_id: company.slug.clone(),
            key: row.try_get("clave")?,
            nombre: row.try_get("nombre")?,
            centro: row.try_get("centro")?,
            presupuesto_anual: row.try_get("presupuesto_anual")?,
            cuenta: row.try_get("cuenta_codigo")?,
        };
        let _ = Self::insert_audit_tx(
            &mut tx,
            &company,
            actor,
            "Actualizó presupuesto",
            &format!("{}: {}", updated.nombre, updated.presupuesto_anual),
        )
        .await?;
        tx.commit().await?;
        Ok(updated)
    }

    pub async fn update_company_settings(
        &self,
        company_id: &str,
        req: UpdateCompanySettingsRequest,
        actor: &str,
    ) -> Result<FrontendCopropiedad, ApiError> {
        let mut tx = self.db.pool.begin().await?;
        let company = Self::resolve_company_tx(&mut tx, company_id).await?;
        let pub_key_opt = req
            .wompi_public_key
            .map(|s| s.trim().to_string());
        let int_sec_opt = req
            .wompi_integrity_secret
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let ev_sec_opt = req
            .wompi_events_secret
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let r = sqlx::query(
            "UPDATE copropiedades
                SET razon_social = COALESCE(NULLIF(TRIM($2), ''), razon_social),
                    direccion = COALESCE(NULLIF(TRIM($3), ''), direccion),
                    porcentaje_fondo_imprevistos = COALESCE($4, porcentaje_fondo_imprevistos),
                    tasa_mora_mensual = COALESCE($5, tasa_mora_mensual),
                    dia_corte_pronto_pago = COALESCE($6, dia_corte_pronto_pago),
                    descuento_pronto_pago_pct = COALESCE($7, descuento_pronto_pago_pct),
                    llave_bre_b = COALESCE($8, llave_bre_b),
                    wompi_public_key = COALESCE($9, wompi_public_key),
                    wompi_integrity_secret = COALESCE($10, wompi_integrity_secret),
                    wompi_events_secret = COALESCE($11, wompi_events_secret),
                    wompi_sandbox = COALESCE($12, wompi_sandbox)
              WHERE id = $1
             RETURNING nit, razon_social, COALESCE(nombre_corto, razon_social) AS nombre_corto,
                       sigla, ciudad, direccion, grupo_niif,
                       COALESCE(porcentaje_fondo_imprevistos, 1.0) AS fondo_pct,
                       tasa_mora_mensual, COALESCE(dia_corte_pronto_pago, 10::smallint) AS dia_corte,
                       COALESCE(descuento_pronto_pago_pct, 0) AS desc_pct,
                       COALESCE(llave_bre_b, '') AS llave_bre_b,
                       presupuesto_anual, periodo_actual, saldos_iniciales, escala, color,
                       COALESCE(wompi_public_key, '') AS wompi_public_key,
                       COALESCE(wompi_sandbox, TRUE) AS wompi_sandbox,
                       (COALESCE(wompi_public_key, '') <> '' AND COALESCE(wompi_integrity_secret, '') <> '') AS wompi_configurado",
        )
        .bind(company.uuid)
        .bind(req.razon_social)
        .bind(req.direccion)
        .bind(req.fondo_imprevistos_pct)
        .bind(req.tasa_mora_mensual)
        .bind(req.dia_corte_pronto_pago)
        .bind(req.descuento_pronto_pago_pct)
        .bind(req.llave_bre_b)
        .bind(pub_key_opt)
        .bind(int_sec_opt)
        .bind(ev_sec_opt)
        .bind(req.wompi_sandbox)
        .fetch_one(&mut *tx)
        .await?;

        let razon: String = r.try_get("razon_social")?;
        let _ = Self::insert_audit_tx(&mut tx, &company, actor, "Actualizó parámetros", &razon)
            .await?;
        tx.commit().await?;

        let saldos: HashMap<String, Decimal> =
            serde_json::from_value(r.try_get("saldos_iniciales")?).unwrap_or_default();
        Ok(FrontendCopropiedad {
            id: company.slug,
            nit: r.try_get("nit")?,
            razon_social: razon,
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
            wompi_public_key: r.try_get("wompi_public_key")?,
            wompi_sandbox: r.try_get("wompi_sandbox")?,
            wompi_configurado: r.try_get("wompi_configurado")?,
        })
    }

    pub async fn list_portal_links(
        &self,
        company_id: &str,
    ) -> Result<Vec<PortalUnitLinkItem>, ApiError> {
        let mut tx = self.db.pool.begin().await?;
        let company = Self::resolve_company_tx(&mut tx, company_id).await?;
        let rows = sqlx::query(
            "SELECT COALESCE(u.clave_externa, u.id::text) AS ext_id,
                    u.grupo_torre, u.numero_unidad,
                    COALESCE(tp.nombre, '') AS prop_nombre,
                    COALESCE(tp.email, '') AS prop_email,
                    COALESCE(tp.telefono, '') AS prop_tel,
                    ta.nombre AS arr_nombre,
                    ta.email AS arr_email,
                    ta.telefono AS arr_tel
               FROM unidades_inmobiliarias u
               LEFT JOIN vinculos_unidad_tercero vp
                 ON vp.unidad_id = u.id AND vp.rol_en_unidad = 'PROPIETARIO' AND vp.activo = TRUE
               LEFT JOIN terceros tp ON tp.id = vp.tercero_id
               LEFT JOIN vinculos_unidad_tercero va
                 ON va.unidad_id = u.id AND va.rol_en_unidad = 'ARRENDATARIO' AND va.activo = TRUE
               LEFT JOIN terceros ta ON ta.id = va.tercero_id
              WHERE u.copropiedad_id = $1
              ORDER BY u.grupo_torre, u.numero_unidad",
        )
        .bind(company.uuid)
        .fetch_all(&mut *tx)
        .await?;
        tx.commit().await?;

        let mut out = Vec::with_capacity(rows.len());
        for r in rows {
            let ext_id: String = r.try_get("ext_id")?;
            let token = auth::issue_portal_token(&company.slug, &ext_id)?;
            out.push(PortalUnitLinkItem {
                unit_id: ext_id,
                torre: r.try_get("grupo_torre")?,
                numero: r.try_get("numero_unidad")?,
                propietario_nombre: r.try_get("prop_nombre")?,
                propietario_email: r.try_get("prop_email")?,
                propietario_telefono: r.try_get("prop_tel")?,
                arrendatario_nombre: r.try_get("arr_nombre")?,
                arrendatario_email: r.try_get("arr_email")?,
                arrendatario_telefono: r.try_get("arr_tel")?,
                token,
            });
        }
        Ok(out)
    }

    pub async fn portal_lookup(
        &self,
        req: PortalLookupRequest,
    ) -> Result<PortalLookupResponse, ApiError> {
        let slug = req.company_slug.trim();
        let unit_needle = normalize_unit_lookup(&req.unidad);
        let doc_needle = extract_digits(&req.documento);
        if unit_needle.is_empty() || doc_needle.len() < 5 {
            return Err(ApiError::unprocessable(
                "Ingresa la unidad y el documento de identidad del propietario o arrendatario.",
            ));
        }

        let mut tx = self.db.pool.begin().await?;
        let company = Self::resolve_company_tx(&mut tx, slug).await?;
        let rows = sqlx::query(
            "SELECT COALESCE(u.clave_externa, u.id::text) AS ext_id,
                    u.grupo_torre, u.numero_unidad,
                    COALESCE(u.matricula_inmobiliaria, '') AS matricula,
                    COALESCE(tp.documento, '') AS prop_doc,
                    COALESCE(ta.documento, '') AS arr_doc
               FROM unidades_inmobiliarias u
               LEFT JOIN vinculos_unidad_tercero vp
                 ON vp.unidad_id = u.id AND vp.rol_en_unidad = 'PROPIETARIO' AND vp.activo = TRUE
               LEFT JOIN terceros tp ON tp.id = vp.tercero_id
               LEFT JOIN vinculos_unidad_tercero va
                 ON va.unidad_id = u.id AND va.rol_en_unidad = 'ARRENDATARIO' AND va.activo = TRUE
               LEFT JOIN terceros ta ON ta.id = va.tercero_id
              WHERE u.copropiedad_id = $1",
        )
        .bind(company.uuid)
        .fetch_all(&mut *tx)
        .await?;
        tx.commit().await?;

        let mat_filter = req
            .matricula_ultimos4
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_ascii_uppercase());

        for r in rows {
            let ext_id: String = r.try_get("ext_id")?;
            let torre: String = r.try_get("grupo_torre")?;
            let numero: String = r.try_get("numero_unidad")?;
            let full = normalize_unit_lookup(&format!("{torre}{numero}"));
            let num_only = normalize_unit_lookup(&numero);
            if full != unit_needle && num_only != unit_needle {
                continue;
            }
            if let Some(m4) = &mat_filter {
                let mat: String = r.try_get("matricula")?;
                if !mat.trim().to_ascii_uppercase().ends_with(m4) {
                    continue;
                }
            }
            let prop_doc = extract_digits(&r.try_get::<String, _>("prop_doc")?);
            let arr_doc = extract_digits(&r.try_get::<String, _>("arr_doc")?);
            if prop_doc == doc_needle || (!arr_doc.is_empty() && arr_doc == doc_needle) {
                let token = auth::issue_portal_token(&company.slug, &ext_id)?;
                return Ok(PortalLookupResponse { token });
            }
        }

        Err(ApiError::Unauthorized(
            "No encontramos una unidad que coincida con esa torre/apto y documento.".into(),
        ))
    }

    async fn load_portal_company_and_unit(
        &self,
        company_id: &str,
        unit_id: &str,
    ) -> Result<(FrontendCopropiedad, Uuid, FrontendUnidad, String, String, String, Option<String>, String), ApiError> {
        let mut tx = self.db.pool.begin().await?;
        let company_row = Self::resolve_company_tx(&mut tx, company_id).await?;
        let comp_meta = sqlx::query(
            "SELECT nit, razon_social, COALESCE(nombre_corto, razon_social) AS nombre_corto,
                    sigla, ciudad, direccion, grupo_niif,
                    COALESCE(porcentaje_fondo_imprevistos, 1.0) AS fondo_pct,
                    tasa_mora_mensual, COALESCE(dia_corte_pronto_pago, 10::smallint) AS dia_corte,
                    COALESCE(descuento_pronto_pago_pct, 0) AS desc_pct,
                    COALESCE(llave_bre_b, '') AS llave_bre_b,
                    presupuesto_anual, color,
                    COALESCE(wompi_public_key, '') AS wompi_public_key,
                    COALESCE(wompi_integrity_secret, '') AS wompi_integrity_secret,
                    COALESCE(wompi_sandbox, TRUE) AS wompi_sandbox,
                    (COALESCE(wompi_public_key, '') <> '' AND COALESCE(wompi_integrity_secret, '') <> '') AS wompi_configurado
               FROM copropiedades
              WHERE id = $1",
        )
        .bind(company_row.uuid)
        .fetch_one(&mut *tx)
        .await?;

        let saldos_map: HashMap<String, Decimal> =
            serde_json::from_value(company_row.saldos_iniciales.clone()).unwrap_or_default();
        let integrity_secret: String = comp_meta.try_get("wompi_integrity_secret")?;
        let company_dto = FrontendCopropiedad {
            id: company_row.slug.clone(),
            nit: comp_meta.try_get("nit")?,
            razon_social: comp_meta.try_get("razon_social")?,
            nombre_corto: comp_meta.try_get("nombre_corto")?,
            sigla: comp_meta.try_get("sigla")?,
            ciudad: comp_meta.try_get("ciudad")?,
            direccion: comp_meta.try_get("direccion")?,
            grupo_niif: comp_meta.try_get("grupo_niif")?,
            fondo_imprevistos_pct: comp_meta.try_get("fondo_pct")?,
            tasa_mora_mensual: comp_meta.try_get("tasa_mora_mensual")?,
            dia_corte_pronto_pago: comp_meta.try_get("dia_corte")?,
            descuento_pronto_pago_pct: comp_meta.try_get("desc_pct")?,
            llave_bre_b: comp_meta.try_get("llave_bre_b")?,
            presupuesto_anual: comp_meta.try_get("presupuesto_anual")?,
            periodo_actual: company_row.periodo_actual.clone(),
            saldos_iniciales: saldos_map,
            escala: company_row.escala,
            color: comp_meta.try_get("color")?,
            wompi_public_key: comp_meta.try_get("wompi_public_key")?,
            wompi_sandbox: comp_meta.try_get("wompi_sandbox")?,
            wompi_configurado: comp_meta.try_get("wompi_configurado")?,
        };

        let unit_row = sqlx::query(
            "SELECT u.id, COALESCE(u.clave_externa, u.id::text) AS ext_id,
                    u.grupo_torre, u.numero_unidad, COALESCE(u.tipo, 'APARTAMENTO') AS tipo,
                    COALESCE(u.area, 0) AS area, u.coeficiente,
                    COALESCE(u.matricula_inmobiliaria, '') AS matricula, u.cartera_congelada,
                    COALESCE(COALESCE(tp.clave_externa, tp.id::text), '') AS prop_ext,
                    COALESCE(tp.nombre, '') AS prop_nombre,
                    COALESCE(tp.documento, '') AS prop_doc,
                    COALESCE(tp.email, '') AS prop_email,
                    COALESCE(ta.clave_externa, ta.id::text) AS arr_ext,
                    ta.nombre AS arr_nombre
               FROM unidades_inmobiliarias u
               LEFT JOIN vinculos_unidad_tercero vp
                 ON vp.unidad_id = u.id AND vp.rol_en_unidad = 'PROPIETARIO' AND vp.activo = TRUE
               LEFT JOIN terceros tp ON tp.id = vp.tercero_id
               LEFT JOIN vinculos_unidad_tercero va
                 ON va.unidad_id = u.id AND va.rol_en_unidad = 'ARRENDATARIO' AND va.activo = TRUE
               LEFT JOIN terceros ta ON ta.id = va.tercero_id
              WHERE u.copropiedad_id = $1 AND (u.clave_externa = $2 OR u.id::text = $2)
              LIMIT 1",
        )
        .bind(company_row.uuid)
        .bind(unit_id.trim())
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| ApiError::NotFound("Unidad no encontrada en esta copropiedad.".into()))?;

        let unit_dto = FrontendUnidad {
            id: unit_row.try_get("ext_id")?,
            empresa_id: company_row.slug.clone(),
            torre: unit_row.try_get("grupo_torre")?,
            numero: unit_row.try_get("numero_unidad")?,
            tipo: unit_row.try_get("tipo")?,
            area: unit_row.try_get("area")?,
            coeficiente: unit_row.try_get("coeficiente")?,
            matricula: unit_row.try_get("matricula")?,
            propietario_id: unit_row.try_get("prop_ext")?,
            arrendatario_id: unit_row.try_get("arr_ext")?,
            cartera_congelada: unit_row.try_get("cartera_congelada")?,
        };
        let prop_nombre: String = unit_row.try_get("prop_nombre")?;
        let prop_doc: String = unit_row.try_get("prop_doc")?;
        let prop_email: String = unit_row.try_get("prop_email")?;
        let arr_nombre: Option<String> = unit_row.try_get("arr_nombre")?;
        tx.commit().await?;

        Ok((
            company_dto,
            company_row.uuid,
            unit_dto,
            prop_nombre,
            prop_doc,
            prop_email,
            arr_nombre,
            integrity_secret,
        ))
    }

    pub async fn portal_statement(
        &self,
        company_id: &str,
        unit_id: &str,
    ) -> Result<PortalUnitStatement, ApiError> {
        let (company, company_uuid, unit, prop_nombre, prop_doc, prop_email, arr_nombre, _) =
            self.load_portal_company_and_unit(company_id, unit_id).await?;
        let entries = self.load_entries_query(Some(company_uuid), None).await?;
        let fig = compute_unit_portal_figures(&company, &unit, &entries);

        let intent_rows = sqlx::query(
            "SELECT i.id, i.referencia, i.periodo, i.monto_total, i.estado, i.pasarela,
                    i.pasarela_tx_id, i.created_at, i.paid_at
               FROM intenciones_pago i
               JOIN unidades_inmobiliarias u ON u.id = i.unidad_id
              WHERE i.copropiedad_id = $1 AND (u.clave_externa = $2 OR u.id::text = $2)
              ORDER BY i.created_at DESC
              LIMIT 8",
        )
        .bind(company_uuid)
        .bind(&unit.id)
        .fetch_all(&self.db.pool)
        .await?;

        let mut intenciones = Vec::with_capacity(intent_rows.len());
        for ir in intent_rows {
            let id: Uuid = ir.try_get("id")?;
            let created: DateTime<Utc> = ir.try_get("created_at")?;
            let paid: Option<DateTime<Utc>> = ir.try_get("paid_at")?;
            intenciones.push(PortalIntencionPagoItem {
                id: id.to_string(),
                referencia: ir.try_get("referencia")?,
                periodo: ir.try_get::<String, _>("periodo")?.trim().to_string(),
                monto_total: ir.try_get("monto_total")?,
                estado: ir.try_get("estado")?,
                pasarela: ir.try_get("pasarela")?,
                pasarela_tx_id: ir.try_get("pasarela_tx_id")?,
                created_at: created.to_rfc3339(),
                paid_at: paid.map(|dt| dt.to_rfc3339()),
            });
        }

        Ok(PortalUnitStatement {
            company_id: company.id,
            razon_social: company.razon_social,
            nombre_corto: company.nombre_corto,
            nit: company.nit,
            ciudad: company.ciudad,
            direccion: company.direccion,
            periodo_actual: company.periodo_actual,
            llave_bre_b: company.llave_bre_b,
            tasa_mora_mensual: company.tasa_mora_mensual,
            dia_corte_pronto_pago: company.dia_corte_pronto_pago,
            descuento_pronto_pago_pct: company.descuento_pronto_pago_pct,
            wompi_public_key: company.wompi_public_key,
            wompi_sandbox: company.wompi_sandbox,
            wompi_configurado: company.wompi_configurado,
            unit_id: unit.id,
            torre: unit.torre,
            numero: unit.numero,
            tipo_unidad: unit.tipo,
            coeficiente: unit.coeficiente,
            matricula: unit.matricula,
            cartera_congelada: unit.cartera_congelada,
            propietario_nombre: prop_nombre,
            propietario_documento: prop_doc,
            propietario_email: prop_email,
            arrendatario_nombre: arr_nombre,
            cuota_mensual: fig.cuota_mensual,
            cargado_total: fig.cargado_total,
            pagado_total: fig.pagado_total,
            saldo_actual: fig.saldo_actual,
            descuento_pronto_pago: fig.descuento_pronto_pago,
            total_con_descuento: fig.total_con_descuento,
            estado_cartera: fig.estado_cartera,
            movimientos: fig.movimientos,
            intenciones,
        })
    }

    pub async fn portal_create_checkout(
        &self,
        company_id: &str,
        unit_id: &str,
        req: PortalCheckoutRequest,
    ) -> Result<PortalCheckoutResponse, ApiError> {
        let (company, company_uuid, unit, _, _, _, _, integrity_secret) =
            self.load_portal_company_and_unit(company_id, unit_id).await?;
        let entries = self.load_entries_query(Some(company_uuid), None).await?;
        let fig = compute_unit_portal_figures(&company, &unit, &entries);
        if fig.saldo_actual <= Decimal::ZERO {
            return Err(ApiError::unprocessable("Esta unidad se encuentra al día ($ 0)."));
        }

        let aplicar_desc =
            req.aplicar_descuento.unwrap_or(true) && fig.descuento_pronto_pago > Decimal::ZERO;
        let max_payable = if aplicar_desc {
            fig.total_con_descuento
        } else {
            fig.saldo_actual
        };
        let requested = req.monto.map(ledger::round_cop).unwrap_or(max_payable);
        if requested <= Decimal::ZERO || requested > fig.saldo_actual {
            return Err(ApiError::unprocessable(
                "El monto a pagar debe ser mayor a $ 0 y no superar el saldo actual.",
            ));
        }
        let descuento_aplicado = if aplicar_desc && requested >= fig.total_con_descuento {
            fig.descuento_pronto_pago
        } else {
            Decimal::ZERO
        };

        let short_id = &Uuid::new_v4().simple().to_string()[..8].to_uppercase();
        let referencia = format!(
            "VTK-{}-{}-{}",
            company.id.to_uppercase(),
            normalize_unit_lookup(&unit.numero),
            short_id
        );
        let pagador_ext = unit
            .arrendatario_id
            .clone()
            .unwrap_or_else(|| unit.propietario_id.clone());

        let unit_uuid: Uuid = sqlx::query_scalar(
            "SELECT id FROM unidades_inmobiliarias
              WHERE copropiedad_id = $1 AND (clave_externa = $2 OR id::text = $2)
              LIMIT 1",
        )
        .bind(company_uuid)
        .bind(&unit.id)
        .fetch_one(&self.db.pool)
        .await?;

        let tercero_uuid: Option<Uuid> = if pagador_ext.is_empty() {
            None
        } else {
            sqlx::query_scalar(
                "SELECT id FROM terceros WHERE clave_externa = $1 OR id::text = $1 LIMIT 1",
            )
            .bind(&pagador_ext)
            .fetch_optional(&self.db.pool)
            .await?
        };

        sqlx::query(
            "INSERT INTO intenciones_pago (
                id, copropiedad_id, unidad_id, tercero_id, referencia, periodo,
                monto_capital, monto_mora, monto_descuento, monto_total, estado, pasarela
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8,$9,'PENDIENTE','WOMPI')",
        )
        .bind(Uuid::new_v4())
        .bind(company_uuid)
        .bind(unit_uuid)
        .bind(tercero_uuid)
        .bind(&referencia)
        .bind(&company.periodo_actual)
        .bind(requested + descuento_aplicado)
        .bind(descuento_aplicado)
        .bind(requested)
        .execute(&self.db.pool)
        .await?;

        let cents_str = (requested * Decimal::from(100)).round_dp(0).to_string();
        let amount_in_cents: i64 = cents_str.parse().unwrap_or(0);
        let signature_integrity = if !integrity_secret.trim().is_empty() {
            auth::sha256_hex(&format!(
                "{referencia}{amount_in_cents}COP{}",
                integrity_secret.trim()
            ))
        } else {
            String::new()
        };
        let sandbox_simulable = company.wompi_sandbox
            && (company.wompi_public_key.is_empty()
                || company.wompi_public_key.starts_with("pub_test_"));
        let checkout_url =
            if !company.wompi_public_key.is_empty() && !signature_integrity.is_empty() {
                build_wompi_checkout_url(
                    &company.wompi_public_key,
                    amount_in_cents,
                    &referencia,
                    &signature_integrity,
                    req.redirect_url.as_deref(),
                )
            } else {
                String::new()
            };

        Ok(PortalCheckoutResponse {
            referencia,
            monto_total: requested,
            monto_en_centavos: amount_in_cents,
            moneda: "COP".into(),
            wompi_public_key: company.wompi_public_key,
            wompi_sandbox: company.wompi_sandbox,
            signature_integrity,
            checkout_url,
            sandbox_simulable,
        })
    }

    pub async fn apply_approved_payment(
        &self,
        reference: &str,
        pasarela_tx_id: &str,
        amount_in_cents: i64,
        events_checksum: Option<(&[String], i64, &str, &Value)>,
        allow_sandbox_sim: bool,
    ) -> Result<Value, ApiError> {
        let ref_clean = reference.trim();
        let mut tx = self.db.pool.begin().await?;
        sqlx::query("SELECT pg_advisory_xact_lock(hashtext($1))")
            .bind(format!("wompi-pay:{ref_clean}"))
            .execute(&mut *tx)
            .await?;

        let row = sqlx::query(
            "SELECT i.id, i.copropiedad_id, i.unidad_id, i.tercero_id,
                    i.referencia, i.monto_descuento, i.monto_total, i.estado, i.comprobante_rc_id,
                    COALESCE(co.wompi_public_key, '') AS wompi_public_key,
                    COALESCE(co.wompi_events_secret, '') AS wompi_events_secret,
                    COALESCE(co.wompi_sandbox, TRUE) AS wompi_sandbox,
                    COALESCE(u.clave_externa, u.id::text) AS unit_ext,
                    u.grupo_torre, u.numero_unidad, u.tipo AS u_tipo, COALESCE(u.area, 0) AS area,
                    u.coeficiente, COALESCE(u.matricula_inmobiliaria, '') AS matricula,
                    u.cartera_congelada,
                    COALESCE(t.clave_externa, t.id::text, '') AS tp_ext
               FROM intenciones_pago i
               JOIN copropiedades co ON co.id = i.copropiedad_id
               JOIN unidades_inmobiliarias u ON u.id = i.unidad_id
               LEFT JOIN terceros t ON t.id = i.tercero_id
              WHERE i.referencia = $1
              FOR UPDATE OF i",
        )
        .bind(ref_clean)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| ApiError::NotFound("Intención de pago no encontrada.".into()))?;

        let pub_key: String = row.try_get("wompi_public_key")?;
        let ev_secret: String = row.try_get("wompi_events_secret")?;
        let is_sandbox: bool = row.try_get("wompi_sandbox")?;

        if let Some((props, ts, checksum, data_val)) = events_checksum {
            verify_wompi_event_checksum(props, ts, checksum, data_val, &ev_secret)?;
        } else if allow_sandbox_sim {
            let can_sim = is_sandbox && (pub_key.is_empty() || pub_key.starts_with("pub_test_"));
            if !can_sim {
                return Err(ApiError::Forbidden(
                    "La simulación está deshabilitada cuando la pasarela está en producción."
                        .into(),
                ));
            }
        } else {
            return Err(ApiError::Unauthorized("Evento sin firma autorizada.".into()));
        }

        let intent_id: Uuid = row.try_get("id")?;
        let estado: String = row.try_get("estado")?;
        let existing_rc: Option<Uuid> = row.try_get("comprobante_rc_id")?;
        if estado == "APROBADA" || existing_rc.is_some() {
            tx.commit().await?;
            return Ok(json!({
                "ok": true,
                "idempotent": true,
                "referencia": ref_clean,
                "comprobanteId": existing_rc.map(|u| u.to_string()),
            }));
        }

        let comp_uuid: Uuid = row.try_get("copropiedad_id")?;
        let company = Self::resolve_company_tx(&mut tx, &comp_uuid.to_string()).await?;
        let puc = Self::fetch_company_puc_tx(&mut tx, company.uuid).await?;

        let monto_total: Decimal = row.try_get("monto_total")?;
        let monto_descuento: Decimal = row.try_get("monto_descuento")?;
        let paid_amount = if amount_in_cents > 0 {
            ledger::round_cop(Decimal::from(amount_in_cents) / Decimal::from(100))
        } else {
            monto_total
        };

        let unit_dto = FrontendUnidad {
            id: row.try_get("unit_ext")?,
            empresa_id: company.slug.clone(),
            torre: row.try_get("grupo_torre")?,
            numero: row.try_get("numero_unidad")?,
            tipo: row.try_get("u_tipo")?,
            area: row.try_get("area")?,
            coeficiente: row.try_get("coeficiente")?,
            matricula: row.try_get("matricula")?,
            propietario_id: row.try_get("tp_ext")?,
            arrendatario_id: None,
            cartera_congelada: row.try_get("cartera_congelada")?,
        };
        let pagador_ext = unit_dto.propietario_id.clone();
        let rc_lines = build_portal_rc_lines(
            &unit_dto,
            &pagador_ext,
            ref_clean,
            paid_amount,
            monto_descuento,
        );
        let today = Utc::now().format("%Y-%m-%d").to_string();
        let desc = format!(
            "Recaudo en línea {} {} · {}",
            unit_dto.torre, unit_dto.numero, ref_clean
        );

        let comp = Self::insert_voucher_tx(
            &mut tx,
            &company,
            "RC",
            &company.periodo_actual,
            &today,
            "PORTAL_WOMPI",
            &desc,
            Some(ref_clean),
            "Portal Wompi",
            rc_lines,
            &puc,
        )
        .await?;

        let rc_uuid = sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM comprobantes_contables
              WHERE copropiedad_id = $1 AND (clave_externa = $2 OR id::text = $2)
              LIMIT 1",
        )
        .bind(company.uuid)
        .bind(&comp.id)
        .fetch_one(&mut *tx)
        .await?;

        sqlx::query(
            "UPDATE intenciones_pago
                SET estado = 'APROBADA',
                    pasarela_tx_id = $2,
                    comprobante_rc_id = $3,
                    paid_at = NOW()
              WHERE id = $1",
        )
        .bind(intent_id)
        .bind(pasarela_tx_id)
        .bind(rc_uuid)
        .execute(&mut *tx)
        .await?;

        let _ = Self::insert_audit_tx(
            &mut tx,
            &company,
            "Portal Wompi",
            "RECAUDO_PORTAL",
            &format!(
                "RC-{} · {} {} · Ref {} · ${}",
                comp.consecutivo, unit_dto.torre, unit_dto.numero, ref_clean, paid_amount
            ),
        )
        .await?;

        tx.commit().await?;
        Ok(json!({
            "ok": true,
            "idempotent": false,
            "referencia": ref_clean,
            "comprobante": comp,
        }))
    }

    pub async fn pre_entry_company_id(&self, pre_id: &str) -> Result<Option<String>, ApiError> {
        let slug: Option<String> = sqlx::query_scalar(
            "SELECT COALESCE(co.slug, co.id::text)
               FROM pre_asientos p
               JOIN copropiedades co ON co.id = p.copropiedad_id
              WHERE p.clave_externa = $1 OR p.id::text = $1
              LIMIT 1",
        )
        .bind(pre_id)
        .fetch_optional(&self.db.pool)
        .await?;
        Ok(slug)
    }

    pub async fn entry_company_id(&self, entry_id: &str) -> Result<Option<String>, ApiError> {
        let slug: Option<String> = sqlx::query_scalar(
            "SELECT COALESCE(co.slug, co.id::text)
               FROM comprobantes_contables c
               JOIN copropiedades co ON co.id = c.copropiedad_id
              WHERE c.clave_externa = $1 OR c.id::text = $1
              LIMIT 1",
        )
        .bind(entry_id)
        .fetch_optional(&self.db.pool)
        .await?;
        Ok(slug)
    }

    pub async fn all_company_ids(&self) -> Result<Vec<String>, ApiError> {
        let slugs: Vec<String> = sqlx::query_scalar(
            "SELECT COALESCE(slug, id::text) FROM copropiedades ORDER BY created_at, slug",
        )
        .fetch_all(&self.db.pool)
        .await?;
        Ok(slugs)
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
