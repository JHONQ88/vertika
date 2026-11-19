use crate::domain::{
    demo_puc, ledger, third_parties_from_seed, ApproveResult, BalanceRequest, BootstrapDatos,
    ClosePeriodRequest, ClosePeriodResult, CreateEntryRequest, FrontendAuditoria,
    FrontendComprobante, FrontendCopropiedad, FrontendEstadoApp, FrontendLinea, FrontendPreAsiento,
    LedgerAccount, PostEntryResult, ThirdParty, VoidEntryResult,
};
use crate::error::ApiError;
use crate::repo::{
    build_reversal_lines, closing_audit_detail, compute_cartera_total, compute_traslado_fondo,
    last_day_of_period, normalize_frontend_lines, origin_from_agent, parse_seed_bundle,
    validate_and_hash_frontend_lines,
};
use chrono::Utc;
use serde_json::{json, Value};
use std::collections::HashMap;
use tokio::sync::RwLock;
use uuid::Uuid;

struct MemoryData {
    datos: BootstrapDatos,
    estado: FrontendEstadoApp,
    pre_status: HashMap<String, String>,
    puc: Vec<LedgerAccount>,
    third_parties: Vec<ThirdParty>,
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
        Ok(MemoryData {
            datos,
            estado,
            pre_status,
            puc: demo_puc(),
            third_parties: third_parties_from_seed(seed),
            legacy_override: None,
        })
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
}
