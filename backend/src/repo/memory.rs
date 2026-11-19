use crate::auth::{self, AuthUser, CompanyRole, CreateUserRequest, DEMO_PASSWORD, DEMO_USERS};
use crate::domain::{
    demo_puc, ledger, third_parties_from_seed, ApproveResult, BalanceRequest, BillPeriodRequest,
    BillPeriodResult, BootstrapDatos, ClosePeriodRequest, ClosePeriodResult, CreateEntryRequest,
    CreatePreEntryRequest, CreatePreEntryResult, CreatePucAccountRequest, FrontendAuditoria,
    FrontendComprobante, FrontendCopropiedad, FrontendEstadoApp, FrontendLinea, FrontendPreAsiento,
    FrontendRubro, FrontendTercero, FrontendUnidad, LedgerAccount, OpenNextPeriodResult,
    PostEntryResult, ThirdParty, UpdateCompanySettingsRequest, UpsertThirdPartyRequest,
    UpsertUnitRequest, VoidEntryResult,
};
use crate::error::ApiError;
use crate::repo::{
    build_billing_lines, build_pre_entry_document, build_reversal_lines, closing_audit_detail,
    compute_cartera_total, compute_traslado_fondo, compute_unit_overdue_balances,
    last_day_of_period, next_period_ym, normalize_frontend_lines, origin_from_agent,
    parse_seed_bundle, validate_and_hash_frontend_lines, validate_create_pre_entry_input,
};
use chrono::Utc;
use rust_decimal::Decimal;
use serde_json::{json, Value};
use std::collections::HashMap;
use tokio::sync::RwLock;
use uuid::Uuid;

struct StoredUser {
    user: AuthUser,
    password_hash: String,
}

struct MemoryData {
    datos: BootstrapDatos,
    estado: FrontendEstadoApp,
    pre_status: HashMap<String, String>,
    puc: Vec<LedgerAccount>,
    third_parties: Vec<ThirdParty>,
    users: Vec<StoredUser>,
    legacy_override: Option<Value>,
}

pub struct MemoryRepo {
    seed: Value,
    inner: RwLock<MemoryData>,
}

impl MemoryRepo {
    pub fn new(seed: Value) -> Result<Self, ApiError> {
        let data = Self::build_data(&seed)?;
        Ok(Self {
            seed,
            inner: RwLock::new(data),
        })
    }

    fn build_data(seed: &Value) -> Result<MemoryData, ApiError> {
        let (datos, estado) = parse_seed_bundle(seed)?;
        let pre_status = estado
            .pre_asientos
            .iter()
            .map(|p| (p.id.clone(), p.estado.clone()))
            .collect();
        let company_ids: Vec<String> = datos.companies.iter().map(|c| c.id.clone()).collect();
        let users = DEMO_USERS
            .iter()
            .map(|u| StoredUser {
                user: AuthUser {
                    id: u.id.into(),
                    email: u.email.into(),
                    nombre: u.nombre.into(),
                    rol: u.rol,
                    roles: company_ids
                        .iter()
                        .map(|cid| CompanyRole {
                            company_id: cid.clone(),
                            role: u.rol,
                        })
                        .collect(),
                },
                password_hash: auth::hash_password(DEMO_PASSWORD, u.salt),
            })
            .collect();

        Ok(MemoryData {
            datos,
            estado,
            pre_status,
            puc: demo_puc(),
            third_parties: third_parties_from_seed(seed),
            users,
            legacy_override: None,
        })
    }

    pub async fn authenticate(&self, email: &str, password: &str) -> Result<AuthUser, ApiError> {
        let g = self.inner.read().await;
        let needle = email.trim();
        let found = g
            .users
            .iter()
            .find(|u| u.user.email.eq_ignore_ascii_case(needle))
            .ok_or_else(|| ApiError::Unauthorized("Credenciales inválidas.".into()))?;
        if !auth::verify_password(password, &found.password_hash) {
            return Err(ApiError::Unauthorized("Credenciales inválidas.".into()));
        }
        Ok(found.user.clone())
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
        let mut g = self.inner.write().await;
        let found = g
            .users
            .iter_mut()
            .find(|u| u.user.id == user_id || u.user.email.eq_ignore_ascii_case(user_id))
            .ok_or_else(|| ApiError::NotFound("Usuario no encontrado.".into()))?;
        if !auth::verify_password(current_password, &found.password_hash) {
            return Err(ApiError::Unauthorized("La contraseña actual no coincide.".into()));
        }
        let salt = format!("salt-{}", Uuid::new_v4().simple());
        found.password_hash = auth::hash_password(next, &salt);
        Ok(())
    }

    pub async fn create_user(&self, req: CreateUserRequest) -> Result<AuthUser, ApiError> {
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

        let mut g = self.inner.write().await;
        if g.users
            .iter()
            .any(|u| u.user.email.eq_ignore_ascii_case(&email))
        {
            return Err(ApiError::Conflict(
                "Ya existe un usuario con ese correo.".into(),
            ));
        }

        let roles = g
            .datos
            .companies
            .iter()
            .map(|c| CompanyRole {
                company_id: c.id.clone(),
                role: req.rol,
            })
            .collect();
        let user = AuthUser {
            id: format!("usr-{}", Uuid::new_v4().simple()),
            email,
            nombre,
            rol: req.rol,
            roles,
        };
        let salt = format!("salt-{}", Uuid::new_v4().simple());
        g.users.push(StoredUser {
            user: user.clone(),
            password_hash: auth::hash_password(password, &salt),
        });
        Ok(user)
    }

    fn find_company<'a>(
        datos: &'a BootstrapDatos,
        company_id: &str,
    ) -> Result<&'a FrontendCopropiedad, ApiError> {
        datos
            .companies
            .iter()
            .find(|c| c.id == company_id)
            .ok_or_else(|| ApiError::NotFound(format!("Copropiedad '{company_id}' no encontrada.")))
    }

    fn ensure_period_open(
        estado: &FrontendEstadoApp,
        company: &FrontendCopropiedad,
        period: &str,
    ) -> Result<(), ApiError> {
        if estado
            .periodos_cerrados
            .get(&company.id)
            .is_some_and(|v| v.iter().any(|p| p == period))
        {
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

    fn next_consecutive(estado: &FrontendEstadoApp, company_id: &str, tipo: &str) -> i64 {
        estado
            .comprobantes
            .iter()
            .filter(|c| c.empresa_id == company_id && c.tipo == tipo)
            .map(|c| c.consecutivo)
            .max()
            .unwrap_or(0)
            + 1
    }

    fn make_audit(company_id: &str, actor: &str, accion: &str, detalle: String) -> FrontendAuditoria {
        FrontendAuditoria {
            id: format!("aud-{}", Uuid::new_v4().simple()),
            ts: Utc::now().to_rfc3339(),
            actor: actor.into(),
            accion: accion.into(),
            detalle,
            empresa_id: company_id.into(),
        }
    }

    pub async fn bootstrap(&self) -> Result<Value, ApiError> {
        let g = self.inner.read().await;
        Ok(json!({
            "datos": g.datos,
            "estado": g.estado,
            "mode": "demo-memory",
        }))
    }

    pub async fn get_state(&self) -> Result<Value, ApiError> {
        let g = self.inner.read().await;
        if let Some(over) = &g.legacy_override {
            return Ok(over.clone());
        }
        Ok(serde_json::to_value(&g.estado).unwrap_or_else(|_| json!({})))
    }

    pub async fn put_state(&self, payload: Value) -> Result<Value, ApiError> {
        let mut g = self.inner.write().await;
        if let Ok(parsed) = serde_json::from_value::<FrontendEstadoApp>(payload.clone()) {
            g.estado = parsed;
            g.pre_status = g
                .estado
                .pre_asientos
                .iter()
                .map(|p| (p.id.clone(), p.estado.clone()))
                .collect();
            g.legacy_override = None;
        } else {
            g.legacy_override = Some(payload.clone());
        }
        Ok(payload)
    }

    pub async fn reset(&self) -> Result<Value, ApiError> {
        let fresh = Self::build_data(&self.seed)?;
        let mut g = self.inner.write().await;
        *g = fresh;
        Ok(json!({
            "ok": true,
            "datos": g.datos,
            "estado": g.estado,
        }))
    }

    pub async fn list_puc(&self, _company_id: Option<&str>) -> Result<Vec<LedgerAccount>, ApiError> {
        let g = self.inner.read().await;
        Ok(g.puc.clone())
    }

    pub async fn list_third_parties(
        &self,
        _company_id: Option<&str>,
    ) -> Result<Vec<ThirdParty>, ApiError> {
        let g = self.inner.read().await;
        Ok(g.third_parties.clone())
    }

    pub async fn update_pre_entry_lines(
        &self,
        pre_id: &str,
        lineas: Vec<FrontendLinea>,
    ) -> Result<FrontendPreAsiento, ApiError> {
        let mut g = self.inner.write().await;
        if let Some(status) = g.pre_status.get(pre_id) {
            if status != "PENDIENTE" {
                return Err(ApiError::Conflict(format!(
                    "El pre-asiento ya fue procesado ({status})."
                )));
            }
        }
        let pre = g
            .estado
            .pre_asientos
            .iter_mut()
            .find(|p| p.id == pre_id)
            .ok_or_else(|| ApiError::NotFound(format!("Pre-asiento '{pre_id}' no encontrado.")))?;
        pre.lineas = normalize_frontend_lines(lineas, "l");
        Ok(pre.clone())
    }

    pub async fn approve_pre_entry(
        &self,
        pre_id: &str,
        actor: &str,
    ) -> Result<ApproveResult, ApiError> {
        let mut g = self.inner.write().await;
        if let Some(status) = g.pre_status.get(pre_id) {
            if status != "PENDIENTE" {
                return Err(ApiError::Conflict(format!(
                    "El pre-asiento ya fue procesado ({status})."
                )));
            }
        }
        let idx = g
            .estado
            .pre_asientos
            .iter()
            .position(|p| p.id == pre_id)
            .ok_or_else(|| ApiError::NotFound(format!("Pre-asiento '{pre_id}' no encontrado.")))?;
        let pre = g.estado.pre_asientos[idx].clone();
        let company = Self::find_company(&g.datos, &pre.empresa_id)?.clone();
        Self::ensure_period_open(&g.estado, &company, &pre.periodo)?;

        let normalized_lines = normalize_frontend_lines(pre.lineas.clone(), "l");
        let (total_debit, total_credit, hash) = validate_and_hash_frontend_lines(
            &pre.empresa_id,
            &pre.periodo,
            &pre.tipo,
            &pre.fecha,
            &pre.descripcion,
            &normalized_lines,
            &g.puc,
        )?;

        let consecutivo = Self::next_consecutive(&g.estado, &pre.empresa_id, &pre.tipo);
        let referencia = pre
            .documento
            .get("numero")
            .and_then(|v| v.as_str())
            .map(ToString::to_string);
        let comp = FrontendComprobante {
            id: format!("{}-{}-{}", pre.empresa_id, pre.tipo, consecutivo),
            empresa_id: pre.empresa_id.clone(),
            periodo: pre.periodo.clone(),
            tipo: pre.tipo.clone(),
            consecutivo,
            fecha: pre.fecha.clone(),
            estado: "ASENTADO".into(),
            origen: origin_from_agent(&pre.agente),
            descripcion: pre.descripcion.clone(),
            lineas: normalized_lines,
            total_debito: total_debit,
            total_credito: total_credit,
            referencia,
            hash,
            creado_por: actor.into(),
            created_at: Utc::now().to_rfc3339(),
        };
        let ev = Self::make_audit(
            &pre.empresa_id,
            actor,
            "Aprobó pre-asiento IA",
            format!("{}-{} · {}", comp.tipo, comp.consecutivo, pre.descripcion),
        );

        g.estado.pre_asientos.remove(idx);
        g.pre_status.insert(pre_id.to_string(), "APROBADO".into());
        g.estado.comprobantes.push(comp.clone());
        g.estado.auditoria.insert(0, ev.clone());
        g.estado.auditoria.truncate(200);

        Ok(ApproveResult {
            comprobante: comp,
            auditoria: ev,
            pre_asiento_id: pre_id.to_string(),
        })
    }

    pub async fn reject_pre_entry(
        &self,
        pre_id: &str,
        actor: &str,
    ) -> Result<FrontendAuditoria, ApiError> {
        let mut g = self.inner.write().await;
        if let Some(status) = g.pre_status.get(pre_id) {
            if status != "PENDIENTE" {
                return Err(ApiError::Conflict(format!(
                    "El pre-asiento ya fue procesado ({status})."
                )));
            }
        }
        let idx = g
            .estado
            .pre_asientos
            .iter()
            .position(|p| p.id == pre_id)
            .ok_or_else(|| ApiError::NotFound(format!("Pre-asiento '{pre_id}' no encontrado.")))?;
        let pre = g.estado.pre_asientos.remove(idx);
        g.pre_status.insert(pre_id.to_string(), "RECHAZADO".into());

        let ev = Self::make_audit(
            &pre.empresa_id,
            actor,
            "Devolvió pre-asiento al agente",
            pre.descripcion,
        );
        g.estado.auditoria.insert(0, ev.clone());
        g.estado.auditoria.truncate(200);
        Ok(ev)
    }

    pub async fn create_pre_entry(
        &self,
        req: CreatePreEntryRequest,
        actor: &str,
    ) -> Result<CreatePreEntryResult, ApiError> {
        let (entry_type, description, agent) = validate_create_pre_entry_input(&req)?;
        let mut g = self.inner.write().await;
        let company = Self::find_company(&g.datos, &req.company_id)?.clone();
        Self::ensure_period_open(&g.estado, &company, &req.period)?;

        let tp = g
            .datos
            .terceros
            .iter()
            .find(|t| {
                t.id == req.tercero_id
                    && t.empresa_id
                        .as_deref()
                        .is_none_or(|e| e == company.id)
            })
            .cloned()
            .ok_or_else(|| {
                ApiError::BadRequest(format!("Tercero '{}' no encontrado.", req.tercero_id))
            })?;

        let unidad_id = match req.unidad_id.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            Some(uid) => {
                if !g
                    .datos
                    .units
                    .iter()
                    .any(|u| u.id == uid && u.empresa_id == company.id)
                {
                    return Err(ApiError::BadRequest(format!(
                        "Unidad '{}' no encontrada en {}.",
                        uid, company.nombre_corto
                    )));
                }
                Some(uid.to_string())
            }
            None => None,
        };

        let rubro_id = match req.rubro_id.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            Some(rid) => {
                if !g
                    .datos
                    .rubros
                    .iter()
                    .any(|r| r.id == rid && r.empresa_id == company.id)
                {
                    return Err(ApiError::BadRequest(format!(
                        "Rubro '{}' no encontrado en {}.",
                        rid, company.nombre_corto
                    )));
                }
                Some(rid.to_string())
            }
            None => None,
        };

        let normalized_lines = normalize_frontend_lines(req.lines.clone(), "l");
        let (total_debit, _, _) = validate_and_hash_frontend_lines(
            &company.id,
            &req.period,
            &entry_type,
            req.date.trim(),
            &description,
            &normalized_lines,
            &g.puc,
        )?;

        let short = &Uuid::new_v4().simple().to_string()[..12];
        let ext_id = format!("pre-{}-{}", company.id, short);
        let doc_ref = format!("IA-{}", short[6..].to_uppercase());
        let tp_nit = match &tp.dv {
            Some(dv) if !dv.is_empty() => format!("{}-{dv}", tp.documento),
            _ => tp.documento.clone(),
        };
        let document = build_pre_entry_document(&req, total_debit, &tp.nombre, &tp_nit, &doc_ref);

        let pre = FrontendPreAsiento {
            id: ext_id.clone(),
            empresa_id: company.id.clone(),
            periodo: req.period.clone(),
            tipo: entry_type,
            fecha: req.date.trim().to_string(),
            agente: agent.clone(),
            confianza: req.confianza,
            tercero_id: tp.id,
            unidad_id,
            rubro_id,
            descripcion: description.clone(),
            documento: document,
            lineas: normalized_lines,
            estado: "PENDIENTE".into(),
            notas: req.notes,
        };
        let ev = Self::make_audit(
            &company.id,
            actor,
            "Radicó pre-asiento IA",
            format!("{agent} · {description}"),
        );

        g.pre_status.insert(ext_id, "PENDIENTE".into());
        g.estado.pre_asientos.push(pre.clone());
        g.estado.auditoria.insert(0, ev.clone());
        g.estado.auditoria.truncate(200);

        Ok(CreatePreEntryResult {
            pre_asiento: pre,
            auditoria: ev,
        })
    }

    pub async fn create_entry(
        &self,
        req: CreateEntryRequest,
        actor: &str,
    ) -> Result<PostEntryResult, ApiError> {
        let mut g = self.inner.write().await;
        let company = Self::find_company(&g.datos, &req.company_id)?.clone();
        Self::ensure_period_open(&g.estado, &company, &req.period)?;

        let consecutivo = Self::next_consecutive(&g.estado, &company.id, &req.entry_type);
        let id = format!("{}-{}-{}", company.id, req.entry_type, consecutivo);
        let normalized_lines = normalize_frontend_lines(req.lines, &id);
        let (total_debit, total_credit, hash) = validate_and_hash_frontend_lines(
            &company.id,
            &req.period,
            &req.entry_type,
            &req.date,
            &req.description,
            &normalized_lines,
            &g.puc,
        )?;

        let comp = FrontendComprobante {
            id,
            empresa_id: company.id.clone(),
            periodo: req.period,
            tipo: req.entry_type.clone(),
            consecutivo,
            fecha: req.date,
            estado: "ASENTADO".into(),
            origen: req.origin.unwrap_or_else(|| "CONTADOR_MANUAL".into()),
            descripcion: req.description.clone(),
            lineas: normalized_lines,
            total_debito: total_debit,
            total_credito: total_credit,
            referencia: req.reference,
            hash,
            creado_por: actor.into(),
            created_at: Utc::now().to_rfc3339(),
        };
        let ev = Self::make_audit(
            &company.id,
            actor,
            "Asentó comprobante",
            format!("{}-{} · {}", comp.tipo, comp.consecutivo, req.description),
        );

        g.estado.comprobantes.push(comp.clone());
        g.estado.auditoria.insert(0, ev.clone());
        g.estado.auditoria.truncate(200);

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
        let mut g = self.inner.write().await;
        let idx = g
            .estado
            .comprobantes
            .iter()
            .position(|c| c.id == entry_id)
            .ok_or_else(|| ApiError::NotFound(format!("Comprobante '{entry_id}' no encontrado.")))?;
        let orig = g.estado.comprobantes[idx].clone();
        if orig.estado == "ANULADO" {
            return Err(ApiError::Conflict("El comprobante ya fue anulado.".into()));
        }
        let company = Self::find_company(&g.datos, &orig.empresa_id)?.clone();
        Self::ensure_period_open(&g.estado, &company, &orig.periodo)?;

        let consecutivo = Self::next_consecutive(&g.estado, &orig.empresa_id, "NC");
        let rev_id = format!("{}-NC-{}", orig.empresa_id, consecutivo);
        let motivo = reason
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("Anulación solicitada por el contador");
        let rev_desc = format!("Anulación {}-{}: {}", orig.tipo, orig.consecutivo, motivo);
        let rev_lines = build_reversal_lines(&orig.lineas, &rev_id);
        let (total_debit, total_credit, hash) = validate_and_hash_frontend_lines(
            &orig.empresa_id,
            &orig.periodo,
            "NC",
            &orig.fecha,
            &rev_desc,
            &rev_lines,
            &g.puc,
        )?;

        let reverso = FrontendComprobante {
            id: rev_id,
            empresa_id: orig.empresa_id.clone(),
            periodo: orig.periodo.clone(),
            tipo: "NC".into(),
            consecutivo,
            fecha: orig.fecha.clone(),
            estado: "ASENTADO".into(),
            origen: "CONTADOR_MANUAL".into(),
            descripcion: rev_desc,
            lineas: rev_lines,
            total_debito: total_debit,
            total_credito: total_credit,
            referencia: Some(format!("{}-{}", orig.tipo, orig.consecutivo)),
            hash,
            creado_por: actor.into(),
            created_at: Utc::now().to_rfc3339(),
        };

        g.estado.comprobantes[idx].estado = "ANULADO".into();
        let anulado = g.estado.comprobantes[idx].clone();
        let ev = Self::make_audit(
            &orig.empresa_id,
            actor,
            "Anuló comprobante",
            format!(
                "{}-{} anulado con reverso NC-{} ({motivo})",
                orig.tipo, orig.consecutivo, consecutivo
            ),
        );

        g.estado.comprobantes.push(reverso.clone());
        g.estado.auditoria.insert(0, ev.clone());
        g.estado.auditoria.truncate(200);

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
        let mut g = self.inner.write().await;
        let company = Self::find_company(&g.datos, company_id)?.clone();
        Self::ensure_period_open(&g.estado, &company, period)?;

        let unit_ids: Vec<String> = g
            .datos
            .units
            .iter()
            .filter(|u| u.empresa_id == company.id)
            .map(|u| u.id.clone())
            .collect();
        let rubros: Vec<_> = g
            .datos
            .rubros
            .iter()
            .filter(|r| r.empresa_id == company.id)
            .cloned()
            .collect();

        let cartera_total =
            compute_cartera_total(&g.estado.comprobantes, &unit_ids, &company.id, period);
        let traslado_fondo =
            compute_traslado_fondo(&g.estado.comprobantes, &company.id, period);
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
        let (total_debit, total_credit, hash) = validate_and_hash_frontend_lines(
            &company.id,
            period,
            "NC",
            &fecha,
            &descripcion,
            &lines,
            &g.puc,
        )?;
        let consecutivo = Self::next_consecutive(&g.estado, &company.id, "NC");
        let comp = FrontendComprobante {
            id: format!("{}-NC-{}", company.id, consecutivo),
            empresa_id: company.id.clone(),
            periodo: period.into(),
            tipo: "NC".into(),
            consecutivo,
            fecha,
            estado: "ASENTADO".into(),
            origen: "CIERRE_AUTOMATICO".into(),
            descripcion,
            lineas: lines.clone(),
            total_debito: total_debit,
            total_credito: total_credit,
            referencia: None,
            hash,
            creado_por: actor.into(),
            created_at: Utc::now().to_rfc3339(),
        };

        let ev = Self::make_audit(
            &company.id,
            actor,
            "Ejecutó cierre mensual",
            closing_audit_detail(period, &lines),
        );

        g.estado.comprobantes.push(comp.clone());
        g.estado
            .periodos_cerrados
            .entry(company.id.clone())
            .or_default()
            .push(period.into());
        g.estado.auditoria.insert(0, ev.clone());
        g.estado.auditoria.truncate(200);

        Ok(ClosePeriodResult {
            comprobante: comp,
            periodo_cerrado: period.into(),
            auditoria: ev,
        })
    }

    pub async fn list_entries(
        &self,
        company_id: &str,
        period: Option<&str>,
    ) -> Result<Vec<FrontendComprobante>, ApiError> {
        let g = self.inner.read().await;
        Self::find_company(&g.datos, company_id)?;
        let entries = g
            .estado
            .comprobantes
            .iter()
            .filter(|c| {
                c.empresa_id == company_id
                    && period.is_none_or(|p| p == "todos" || c.periodo == p)
            })
            .cloned()
            .collect();
        Ok(entries)
    }

    pub async fn trial_balance(
        &self,
        company_id: &str,
        period: &str,
    ) -> Result<Value, ApiError> {
        let g = self.inner.read().await;
        let company = Self::find_company(&g.datos, company_id)?;
        let entries: Vec<ledger::EntryDraft> = g
            .estado
            .comprobantes
            .iter()
            .filter(|c| c.empresa_id == company.id && c.estado != "ANULADO")
            .map(|c| ledger::EntryDraft {
                company_id: c.empresa_id.clone(),
                period: c.periodo.clone(),
                entry_type: c.tipo.clone(),
                date: c.fecha.clone(),
                description: c.descripcion.clone(),
                lines: ledger::lines_from_frontend(&c.lineas),
            })
            .collect();
        let req = BalanceRequest {
            company_id: company.id.clone(),
            period: period.into(),
            opening_balances: company.saldos_iniciales.clone(),
            entries,
        };
        Ok(ledger::trial_balance_preview(&req, &g.puc))
    }

    pub async fn list_audit(&self, company_id: &str) -> Result<Vec<FrontendAuditoria>, ApiError> {
        let g = self.inner.read().await;
        Self::find_company(&g.datos, company_id)?;
        Ok(g.estado
            .auditoria
            .iter()
            .filter(|a| a.empresa_id == company_id)
            .cloned()
            .collect())
    }

    pub async fn bill_period(
        &self,
        company_id: &str,
        period: &str,
        req: BillPeriodRequest,
        actor: &str,
    ) -> Result<BillPeriodResult, ApiError> {
        let mut g = self.inner.write().await;
        let company = Self::find_company(&g.datos, company_id)?.clone();
        Self::ensure_period_open(&g.estado, &company, period)?;

        let already_billed = g.estado.comprobantes.iter().any(|c| {
            c.empresa_id == company.id
                && c.periodo == period
                && c.estado != "ANULADO"
                && c.tipo == "CC"
                && (c.origen == "AGENTE_IA_LIQUIDADOR"
                    || c.descripcion.starts_with("Liquidación masiva de expensas"))
        });
        if already_billed {
            return Err(ApiError::Conflict(format!(
                "El periodo {period} ya tiene causación masiva de expensas."
            )));
        }

        let units: Vec<FrontendUnidad> = g
            .datos
            .units
            .iter()
            .filter(|u| u.empresa_id == company.id)
            .cloned()
            .collect();
        let overdue = compute_unit_overdue_balances(&g.estado.comprobantes, &company.id, period);
        let (raw_lines, billed_units) =
            build_billing_lines(&company, &units, &overdue, req.incluir_mora)?;

        let consecutivo = Self::next_consecutive(&g.estado, &company.id, "CC");
        let comp_id = format!("{}-CC-{}", company.id, consecutivo);
        let lines = normalize_frontend_lines(raw_lines, &comp_id);
        let fecha = format!("{period}-01");
        let descripcion = req
            .descripcion
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(ToString::to_string)
            .unwrap_or_else(|| format!("Liquidación masiva de expensas {period}"));

        let (total_debit, total_credit, hash) = validate_and_hash_frontend_lines(
            &company.id,
            period,
            "CC",
            &fecha,
            &descripcion,
            &lines,
            &g.puc,
        )?;

        let comp = FrontendComprobante {
            id: comp_id,
            empresa_id: company.id.clone(),
            periodo: period.into(),
            tipo: "CC".into(),
            consecutivo,
            fecha,
            estado: "ASENTADO".into(),
            origen: "AGENTE_IA_LIQUIDADOR".into(),
            descripcion: descripcion.clone(),
            lineas: lines,
            total_debito: total_debit,
            total_credito: total_credit,
            referencia: Some(format!("EXP-{period}")),
            hash,
            creado_por: actor.into(),
            created_at: Utc::now().to_rfc3339(),
        };
        let ev = Self::make_audit(
            &company.id,
            actor,
            "Causó expensas del periodo",
            format!("{}-{} · {billed_units} unidades ({period})", comp.tipo, comp.consecutivo),
        );

        g.estado.comprobantes.push(comp.clone());
        g.estado.auditoria.insert(0, ev.clone());
        g.estado.auditoria.truncate(200);

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
        let mut g = self.inner.write().await;
        let idx = g
            .datos
            .companies
            .iter()
            .position(|c| c.id == company_id)
            .ok_or_else(|| ApiError::NotFound(format!("Copropiedad '{company_id}' no encontrada.")))?;
        let current = g.datos.companies[idx].periodo_actual.clone();
        let is_closed = g
            .estado
            .periodos_cerrados
            .get(company_id)
            .is_some_and(|v| v.iter().any(|p| p == &current));
        if !is_closed {
            return Err(ApiError::Conflict(format!(
                "Debes ejecutar el cierre del periodo {current} antes de abrir el siguiente."
            )));
        }
        let next = next_period_ym(&current)?;
        g.datos.companies[idx].periodo_actual = next.clone();
        if g.estado.active_company_id == company_id {
            g.estado.periodo = next.clone();
        }
        let ev = Self::make_audit(
            company_id,
            actor,
            "Abrió nuevo periodo",
            format!("{current} → {next}"),
        );
        g.estado.auditoria.insert(0, ev.clone());
        g.estado.auditoria.truncate(200);

        Ok(OpenNextPeriodResult {
            empresa_id: company_id.into(),
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
        let mut g = self.inner.write().await;
        Self::find_company(&g.datos, company_id)?;
        if req.coeficiente <= Decimal::ZERO {
            return Err(ApiError::unprocessable("El coeficiente debe ser mayor a cero."));
        }
        if !g.datos.terceros.iter().any(|t| t.id == req.propietario_id) {
            return Err(ApiError::BadRequest("El propietario indicado no existe.".into()));
        }
        if let Some(arr) = &req.arrendatario_id {
            if !arr.is_empty() && !g.datos.terceros.iter().any(|t| &t.id == arr) {
                return Err(ApiError::BadRequest("El arrendatario indicado no existe.".into()));
            }
        }
        let dup = g.datos.units.iter().any(|u| {
            u.empresa_id == company_id
                && u.torre.eq_ignore_ascii_case(req.torre.trim())
                && u.numero.eq_ignore_ascii_case(req.numero.trim())
        });
        if dup {
            return Err(ApiError::Conflict("Ya existe una unidad con esa torre y número.".into()));
        }

        let unit = FrontendUnidad {
            id: format!("u-{}", Uuid::new_v4().simple()),
            empresa_id: company_id.into(),
            torre: req.torre.trim().into(),
            numero: req.numero.trim().into(),
            tipo: req.tipo,
            area: req.area,
            coeficiente: req.coeficiente,
            matricula: req.matricula.trim().into(),
            propietario_id: req.propietario_id,
            arrendatario_id: req.arrendatario_id.filter(|s| !s.trim().is_empty()),
            cartera_congelada: req.cartera_congelada,
        };
        let ev = Self::make_audit(
            company_id,
            actor,
            "Creó unidad",
            format!("{} {}", unit.torre, unit.numero),
        );
        g.datos.units.push(unit.clone());
        g.estado.auditoria.insert(0, ev);
        g.estado.auditoria.truncate(200);
        Ok(unit)
    }

    pub async fn update_unit(
        &self,
        company_id: &str,
        unit_id: &str,
        req: UpsertUnitRequest,
        actor: &str,
    ) -> Result<FrontendUnidad, ApiError> {
        let mut g = self.inner.write().await;
        Self::find_company(&g.datos, company_id)?;
        if req.coeficiente <= Decimal::ZERO {
            return Err(ApiError::unprocessable("El coeficiente debe ser mayor a cero."));
        }
        if !g.datos.terceros.iter().any(|t| t.id == req.propietario_id) {
            return Err(ApiError::BadRequest("El propietario indicado no existe.".into()));
        }
        let idx = g
            .datos
            .units
            .iter()
            .position(|u| u.empresa_id == company_id && u.id == unit_id)
            .ok_or_else(|| ApiError::NotFound(format!("Unidad '{unit_id}' no encontrada.")))?;

        g.datos.units[idx].torre = req.torre.trim().into();
        g.datos.units[idx].numero = req.numero.trim().into();
        g.datos.units[idx].tipo = req.tipo;
        g.datos.units[idx].area = req.area;
        g.datos.units[idx].coeficiente = req.coeficiente;
        g.datos.units[idx].matricula = req.matricula.trim().into();
        g.datos.units[idx].propietario_id = req.propietario_id;
        g.datos.units[idx].arrendatario_id = req.arrendatario_id.filter(|s| !s.trim().is_empty());
        g.datos.units[idx].cartera_congelada = req.cartera_congelada;
        let updated = g.datos.units[idx].clone();

        let ev = Self::make_audit(
            company_id,
            actor,
            "Actualizó unidad",
            format!("{} {}", updated.torre, updated.numero),
        );
        g.estado.auditoria.insert(0, ev);
        g.estado.auditoria.truncate(200);
        Ok(updated)
    }

    pub async fn create_third_party(
        &self,
        company_id: &str,
        req: UpsertThirdPartyRequest,
        actor: &str,
    ) -> Result<FrontendTercero, ApiError> {
        let mut g = self.inner.write().await;
        Self::find_company(&g.datos, company_id)?;
        if req.nombre.trim().is_empty() || req.documento.trim().is_empty() {
            return Err(ApiError::unprocessable("Nombre y documento del tercero son obligatorios."));
        }
        let id = format!("tp-{}", Uuid::new_v4().simple());
        let tp = FrontendTercero {
            id: id.clone(),
            empresa_id: Some(company_id.into()),
            nombre: req.nombre.trim().into(),
            tipo: req.tipo,
            documento: req.documento.trim().into(),
            dv: req.dv.filter(|s| !s.trim().is_empty()),
            email: req.email.trim().into(),
            telefono: req.telefono.trim().into(),
            ciudad: req.ciudad.trim().into(),
            retefuente_pct: req.retefuente_pct,
            reteica_pct: req.reteica_pct,
            reteiva_pct: req.reteiva_pct,
            no_obligado: req.no_obligado,
            regimen_especial: req.regimen_especial,
        };
        let nit = match &tp.dv {
            Some(d) => format!("{}-{d}", tp.documento),
            None => tp.documento.clone(),
        };
        g.third_parties.push(ThirdParty {
            id,
            name: tp.nombre.clone(),
            nit,
            retefuente_pct: tp.retefuente_pct,
            reteica_pct: tp.reteica_pct,
            reteiva_pct: tp.reteiva_pct,
        });
        g.datos.terceros.push(tp.clone());
        let ev = Self::make_audit(company_id, actor, "Creó tercero", tp.nombre.clone());
        g.estado.auditoria.insert(0, ev);
        g.estado.auditoria.truncate(200);
        Ok(tp)
    }

    pub async fn update_third_party(
        &self,
        company_id: &str,
        tp_id: &str,
        req: UpsertThirdPartyRequest,
        actor: &str,
    ) -> Result<FrontendTercero, ApiError> {
        let mut g = self.inner.write().await;
        Self::find_company(&g.datos, company_id)?;
        let idx = g
            .datos
            .terceros
            .iter()
            .position(|t| t.id == tp_id && (t.empresa_id.is_none() || t.empresa_id.as_deref() == Some(company_id)))
            .ok_or_else(|| ApiError::NotFound(format!("Tercero '{tp_id}' no encontrado.")))?;

        g.datos.terceros[idx].nombre = req.nombre.trim().into();
        g.datos.terceros[idx].tipo = req.tipo;
        g.datos.terceros[idx].documento = req.documento.trim().into();
        g.datos.terceros[idx].dv = req.dv.filter(|s| !s.trim().is_empty());
        g.datos.terceros[idx].email = req.email.trim().into();
        g.datos.terceros[idx].telefono = req.telefono.trim().into();
        g.datos.terceros[idx].ciudad = req.ciudad.trim().into();
        g.datos.terceros[idx].retefuente_pct = req.retefuente_pct;
        g.datos.terceros[idx].reteica_pct = req.reteica_pct;
        g.datos.terceros[idx].reteiva_pct = req.reteiva_pct;
        g.datos.terceros[idx].no_obligado = req.no_obligado;
        g.datos.terceros[idx].regimen_especial = req.regimen_especial;
        let updated = g.datos.terceros[idx].clone();

        if let Some(tp_short) = g.third_parties.iter_mut().find(|t| t.id == tp_id) {
            tp_short.name = updated.nombre.clone();
            tp_short.nit = match &updated.dv {
                Some(d) => format!("{}-{d}", updated.documento),
                None => updated.documento.clone(),
            };
            tp_short.retefuente_pct = updated.retefuente_pct;
            tp_short.reteica_pct = updated.reteica_pct;
            tp_short.reteiva_pct = updated.reteiva_pct;
        }
        let ev = Self::make_audit(company_id, actor, "Actualizó tercero", updated.nombre.clone());
        g.estado.auditoria.insert(0, ev);
        g.estado.auditoria.truncate(200);
        Ok(updated)
    }

    pub async fn create_puc_account(
        &self,
        company_id: &str,
        req: CreatePucAccountRequest,
        actor: &str,
    ) -> Result<LedgerAccount, ApiError> {
        let mut g = self.inner.write().await;
        Self::find_company(&g.datos, company_id)?;
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
        if g.puc.iter().any(|a| a.code == code) {
            return Err(ApiError::Conflict(format!("La cuenta {code} ya existe en el PUC.")));
        }

        let acc = LedgerAccount {
            code: code.clone(),
            name: req.nombre.trim().into(),
            account_type: req.tipo,
            nature: req.naturaleza,
            rubric_key: req.rubro_key.filter(|s| !s.trim().is_empty()),
            requires_third_party: req.requiere_tercero,
            requires_unit: req.requiere_unidad,
            is_cash: code.starts_with("11"),
            restricted: false,
            note: req.nota.filter(|s| !s.trim().is_empty()),
        };
        g.puc.push(acc.clone());
        let ev = Self::make_audit(
            company_id,
            actor,
            "Creó cuenta PUC",
            format!("{} · {}", acc.code, acc.name),
        );
        g.estado.auditoria.insert(0, ev);
        g.estado.auditoria.truncate(200);
        Ok(acc)
    }

    pub async fn update_rubro_budget(
        &self,
        company_id: &str,
        rubro_id: &str,
        presupuesto_anual: Decimal,
        actor: &str,
    ) -> Result<FrontendRubro, ApiError> {
        let mut g = self.inner.write().await;
        Self::find_company(&g.datos, company_id)?;
        if presupuesto_anual < Decimal::ZERO {
            return Err(ApiError::unprocessable("El presupuesto anual no puede ser negativo."));
        }
        let idx = g
            .datos
            .rubros
            .iter()
            .position(|r| r.empresa_id == company_id && r.id == rubro_id)
            .ok_or_else(|| ApiError::NotFound(format!("Rubro '{rubro_id}' no encontrado.")))?;
        g.datos.rubros[idx].presupuesto_anual = presupuesto_anual;
        let updated = g.datos.rubros[idx].clone();

        let total: Decimal = g
            .datos
            .rubros
            .iter()
            .filter(|r| r.empresa_id == company_id)
            .map(|r| r.presupuesto_anual)
            .sum();
        if let Some(c) = g.datos.companies.iter_mut().find(|c| c.id == company_id) {
            c.presupuesto_anual = total;
        }
        let ev = Self::make_audit(
            company_id,
            actor,
            "Actualizó presupuesto",
            format!("{}: {}", updated.nombre, updated.presupuesto_anual),
        );
        g.estado.auditoria.insert(0, ev);
        g.estado.auditoria.truncate(200);
        Ok(updated)
    }

    pub async fn update_company_settings(
        &self,
        company_id: &str,
        req: UpdateCompanySettingsRequest,
        actor: &str,
    ) -> Result<FrontendCopropiedad, ApiError> {
        let mut g = self.inner.write().await;
        let idx = g
            .datos
            .companies
            .iter()
            .position(|c| c.id == company_id)
            .ok_or_else(|| ApiError::NotFound(format!("Copropiedad '{company_id}' no encontrada.")))?;
        let c = &mut g.datos.companies[idx];
        if let Some(v) = req.razon_social.filter(|s| !s.trim().is_empty()) {
            c.razon_social = v;
        }
        if let Some(v) = req.direccion.filter(|s| !s.trim().is_empty()) {
            c.direccion = v;
        }
        if let Some(v) = req.fondo_imprevistos_pct {
            c.fondo_imprevistos_pct = v;
        }
        if let Some(v) = req.tasa_mora_mensual {
            c.tasa_mora_mensual = v;
        }
        if let Some(v) = req.dia_corte_pronto_pago {
            c.dia_corte_pronto_pago = v;
        }
        if let Some(v) = req.descuento_pronto_pago_pct {
            c.descuento_pronto_pago_pct = v;
        }
        if let Some(v) = req.llave_bre_b {
            c.llave_bre_b = v;
        }
        let updated = c.clone();
        let ev = Self::make_audit(
            company_id,
            actor,
            "Actualizó parámetros",
            updated.razon_social.clone(),
        );
        g.estado.auditoria.insert(0, ev);
        g.estado.auditoria.truncate(200);
        Ok(updated)
    }
}
