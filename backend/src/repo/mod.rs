pub mod memory;
pub mod postgres;

use crate::auth::{AuthUser, CreateUserRequest};
use crate::domain::{
    ledger::{self, CARTERA_ACCOUNTS},
    ApproveResult, BillPeriodRequest, BillPeriodResult, BootstrapDatos, ClosePeriodRequest,
    ClosePeriodResult, CreateEntryRequest, CreatePreEntryRequest, CreatePreEntryResult,
    CreatePucAccountRequest, FrontendAuditoria, FrontendComprobante, FrontendCopropiedad,
    FrontendEstadoApp, FrontendLinea, FrontendPreAsiento, FrontendRubro, FrontendTercero,
    FrontendUnidad, LedgerAccount, OpenNextPeriodResult, PostEntryResult, ThirdParty,
    UpdateCompanySettingsRequest, UpsertThirdPartyRequest, UpsertUnitRequest, VoidEntryResult,
};
use crate::error::ApiError;
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde_json::{json, Value};
use std::collections::HashMap;

pub enum Store {
    Memory(memory::MemoryRepo),
    Postgres(postgres::PostgresRepo),
}

impl Store {
    pub fn mode(&self) -> &'static str {
        match self {
            Store::Memory(_) => "demo-memory",
            Store::Postgres(_) => "postgres",
        }
    }

    pub fn postgres_enabled(&self) -> bool {
        matches!(self, Store::Postgres(_))
    }

    pub async fn authenticate(&self, email: &str, password: &str) -> Result<AuthUser, ApiError> {
        match self {
            Store::Memory(r) => r.authenticate(email, password).await,
            Store::Postgres(r) => r.authenticate(email, password).await,
        }
    }

    pub async fn change_password(
        &self,
        user_id: &str,
        current_password: &str,
        new_password: &str,
    ) -> Result<(), ApiError> {
        match self {
            Store::Memory(r) => r.change_password(user_id, current_password, new_password).await,
            Store::Postgres(r) => r.change_password(user_id, current_password, new_password).await,
        }
    }

    pub async fn create_user(&self, req: CreateUserRequest) -> Result<AuthUser, ApiError> {
        match self {
            Store::Memory(r) => r.create_user(req).await,
            Store::Postgres(r) => r.create_user(req).await,
        }
    }

    pub async fn bootstrap(&self) -> Result<Value, ApiError> {
        match self {
            Store::Memory(r) => r.bootstrap().await,
            Store::Postgres(r) => r.bootstrap().await,
        }
    }

    pub async fn get_state(&self) -> Result<Value, ApiError> {
        match self {
            Store::Memory(r) => r.get_state().await,
            Store::Postgres(r) => r.get_state().await,
        }
    }

    pub async fn put_state(&self, payload: Value) -> Result<Value, ApiError> {
        match self {
            Store::Memory(r) => r.put_state(payload).await,
            Store::Postgres(r) => r.put_state(payload).await,
        }
    }

    pub async fn reset(&self) -> Result<Value, ApiError> {
        match self {
            Store::Memory(r) => r.reset().await,
            Store::Postgres(r) => r.reset().await,
        }
    }

    pub async fn list_puc(&self, company_id: Option<&str>) -> Result<Vec<LedgerAccount>, ApiError> {
        match self {
            Store::Memory(r) => r.list_puc(company_id).await,
            Store::Postgres(r) => r.list_puc(company_id).await,
        }
    }

    pub async fn list_third_parties(
        &self,
        company_id: Option<&str>,
    ) -> Result<Vec<ThirdParty>, ApiError> {
        match self {
            Store::Memory(r) => r.list_third_parties(company_id).await,
            Store::Postgres(r) => r.list_third_parties(company_id).await,
        }
    }

    pub async fn create_pre_entry(
        &self,
        req: CreatePreEntryRequest,
        actor: &str,
    ) -> Result<CreatePreEntryResult, ApiError> {
        match self {
            Store::Memory(r) => r.create_pre_entry(req, actor).await,
            Store::Postgres(r) => r.create_pre_entry(req, actor).await,
        }
    }

    pub async fn update_pre_entry_lines(
        &self,
        pre_id: &str,
        lineas: Vec<FrontendLinea>,
    ) -> Result<FrontendPreAsiento, ApiError> {
        match self {
            Store::Memory(r) => r.update_pre_entry_lines(pre_id, lineas).await,
            Store::Postgres(r) => r.update_pre_entry_lines(pre_id, lineas).await,
        }
    }

    pub async fn approve_pre_entry(
        &self,
        pre_id: &str,
        actor: &str,
    ) -> Result<ApproveResult, ApiError> {
        match self {
            Store::Memory(r) => r.approve_pre_entry(pre_id, actor).await,
            Store::Postgres(r) => r.approve_pre_entry(pre_id, actor).await,
        }
    }

    pub async fn reject_pre_entry(
        &self,
        pre_id: &str,
        actor: &str,
    ) -> Result<FrontendAuditoria, ApiError> {
        match self {
            Store::Memory(r) => r.reject_pre_entry(pre_id, actor).await,
            Store::Postgres(r) => r.reject_pre_entry(pre_id, actor).await,
        }
    }

    pub async fn create_entry(
        &self,
        req: CreateEntryRequest,
        actor: &str,
    ) -> Result<PostEntryResult, ApiError> {
        match self {
            Store::Memory(r) => r.create_entry(req, actor).await,
            Store::Postgres(r) => r.create_entry(req, actor).await,
        }
    }

    pub async fn void_entry(
        &self,
        entry_id: &str,
        reason: Option<String>,
        actor: &str,
    ) -> Result<VoidEntryResult, ApiError> {
        match self {
            Store::Memory(r) => r.void_entry(entry_id, reason, actor).await,
            Store::Postgres(r) => r.void_entry(entry_id, reason, actor).await,
        }
    }

    pub async fn close_period(
        &self,
        company_id: &str,
        period: &str,
        req: ClosePeriodRequest,
        actor: &str,
    ) -> Result<ClosePeriodResult, ApiError> {
        match self {
            Store::Memory(r) => r.close_period(company_id, period, req, actor).await,
            Store::Postgres(r) => r.close_period(company_id, period, req, actor).await,
        }
    }

    pub async fn bill_period(
        &self,
        company_id: &str,
        period: &str,
        req: BillPeriodRequest,
        actor: &str,
    ) -> Result<BillPeriodResult, ApiError> {
        match self {
            Store::Memory(r) => r.bill_period(company_id, period, req, actor).await,
            Store::Postgres(r) => r.bill_period(company_id, period, req, actor).await,
        }
    }

    pub async fn open_next_period(
        &self,
        company_id: &str,
        actor: &str,
    ) -> Result<OpenNextPeriodResult, ApiError> {
        match self {
            Store::Memory(r) => r.open_next_period(company_id, actor).await,
            Store::Postgres(r) => r.open_next_period(company_id, actor).await,
        }
    }

    pub async fn create_unit(
        &self,
        company_id: &str,
        req: UpsertUnitRequest,
        actor: &str,
    ) -> Result<FrontendUnidad, ApiError> {
        match self {
            Store::Memory(r) => r.create_unit(company_id, req, actor).await,
            Store::Postgres(r) => r.create_unit(company_id, req, actor).await,
        }
    }

    pub async fn update_unit(
        &self,
        company_id: &str,
        unit_id: &str,
        req: UpsertUnitRequest,
        actor: &str,
    ) -> Result<FrontendUnidad, ApiError> {
        match self {
            Store::Memory(r) => r.update_unit(company_id, unit_id, req, actor).await,
            Store::Postgres(r) => r.update_unit(company_id, unit_id, req, actor).await,
        }
    }

    pub async fn create_third_party(
        &self,
        company_id: &str,
        req: UpsertThirdPartyRequest,
        actor: &str,
    ) -> Result<FrontendTercero, ApiError> {
        match self {
            Store::Memory(r) => r.create_third_party(company_id, req, actor).await,
            Store::Postgres(r) => r.create_third_party(company_id, req, actor).await,
        }
    }

    pub async fn update_third_party(
        &self,
        company_id: &str,
        tp_id: &str,
        req: UpsertThirdPartyRequest,
        actor: &str,
    ) -> Result<FrontendTercero, ApiError> {
        match self {
            Store::Memory(r) => r.update_third_party(company_id, tp_id, req, actor).await,
            Store::Postgres(r) => r.update_third_party(company_id, tp_id, req, actor).await,
        }
    }

    pub async fn create_puc_account(
        &self,
        company_id: &str,
        req: CreatePucAccountRequest,
        actor: &str,
    ) -> Result<LedgerAccount, ApiError> {
        match self {
            Store::Memory(r) => r.create_puc_account(company_id, req, actor).await,
            Store::Postgres(r) => r.create_puc_account(company_id, req, actor).await,
        }
    }

    pub async fn update_rubro_budget(
        &self,
        company_id: &str,
        rubro_id: &str,
        presupuesto_anual: Decimal,
        actor: &str,
    ) -> Result<FrontendRubro, ApiError> {
        match self {
            Store::Memory(r) => {
                r.update_rubro_budget(company_id, rubro_id, presupuesto_anual, actor)
                    .await
            }
            Store::Postgres(r) => {
                r.update_rubro_budget(company_id, rubro_id, presupuesto_anual, actor)
                    .await
            }
        }
    }

    pub async fn update_company_settings(
        &self,
        company_id: &str,
        req: UpdateCompanySettingsRequest,
        actor: &str,
    ) -> Result<FrontendCopropiedad, ApiError> {
        match self {
            Store::Memory(r) => r.update_company_settings(company_id, req, actor).await,
            Store::Postgres(r) => r.update_company_settings(company_id, req, actor).await,
        }
    }

    pub async fn list_entries(
        &self,
        company_id: &str,
        period: Option<&str>,
    ) -> Result<Vec<FrontendComprobante>, ApiError> {
        match self {
            Store::Memory(r) => r.list_entries(company_id, period).await,
            Store::Postgres(r) => r.list_entries(company_id, period).await,
        }
    }

    pub async fn trial_balance(
        &self,
        company_id: &str,
        period: &str,
    ) -> Result<Value, ApiError> {
        match self {
            Store::Memory(r) => r.trial_balance(company_id, period).await,
            Store::Postgres(r) => r.trial_balance(company_id, period).await,
        }
    }

    pub async fn list_audit(&self, company_id: &str) -> Result<Vec<FrontendAuditoria>, ApiError> {
        match self {
            Store::Memory(r) => r.list_audit(company_id).await,
            Store::Postgres(r) => r.list_audit(company_id).await,
        }
    }
}

pub fn normalize_requested_companies(requested: Option<&[String]>) -> Option<Vec<String>> {
    let cleaned: Vec<String> = requested?
        .iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if cleaned.is_empty() {
        None
    } else {
        Some(cleaned)
    }
}

pub fn parse_seed_bundle(seed: &Value) -> Result<(BootstrapDatos, FrontendEstadoApp), ApiError> {
    let datos_val = seed
        .get("datos")
        .cloned()
        .ok_or_else(|| ApiError::Internal("Seed inválido: falta datos".into()))?;
    let estado_val = seed
        .get("estado")
        .cloned()
        .ok_or_else(|| ApiError::Internal("Seed inválido: falta estado".into()))?;
    let datos: BootstrapDatos = serde_json::from_value(datos_val)
        .map_err(|e| ApiError::Internal(format!("Seed datos inválido: {e}")))?;
    let estado: FrontendEstadoApp = serde_json::from_value(estado_val)
        .map_err(|e| ApiError::Internal(format!("Seed estado inválido: {e}")))?;
    Ok((datos, estado))
}

pub fn origin_from_agent(agente: &str) -> String {
    if agente.contains("OCR") {
        "AGENTE_IA_OCR".into()
    } else if agente.contains("DIAN") {
        "AGENTE_IA_DIAN".into()
    } else if agente.contains("CONCILIADOR") {
        "WEBHOOK_NFC".into()
    } else if agente.contains("CIERRE") {
        "CIERRE_AUTOMATICO".into()
    } else {
        "CONTADOR_MANUAL".into()
    }
}

pub fn last_day_of_period(period: &str) -> Result<String, ApiError> {
    let (year, month) = parse_year_month(period)?;
    let (next_y, next_m) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    let next_first = NaiveDate::from_ymd_opt(next_y, next_m, 1)
        .ok_or_else(|| ApiError::BadRequest(format!("Periodo inválido '{period}'")))?;
    let last = next_first
        .pred_opt()
        .ok_or_else(|| ApiError::BadRequest(format!("Periodo inválido '{period}'")))?;
    Ok(last.format("%Y-%m-%d").to_string())
}

pub fn next_period_ym(period: &str) -> Result<String, ApiError> {
    let (year, month) = parse_year_month(period)?;
    let (ny, nm) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    Ok(format!("{ny:04}-{nm:02}"))
}

fn parse_year_month(period: &str) -> Result<(i32, u32), ApiError> {
    let parts: Vec<&str> = period.split('-').collect();
    if parts.len() != 2 {
        return Err(ApiError::BadRequest(format!(
            "Periodo inválido '{period}'; usa formato YYYY-MM."
        )));
    }
    let year: i32 = parts[0]
        .parse()
        .map_err(|_| ApiError::BadRequest(format!("Año inválido en periodo '{period}'")))?;
    let month: u32 = parts[1]
        .parse()
        .map_err(|_| ApiError::BadRequest(format!("Mes inválido en periodo '{period}'")))?;
    if !(1..=12).contains(&month) {
        return Err(ApiError::BadRequest(format!("Mes inválido en periodo '{period}'")));
    }
    Ok((year, month))
}

pub fn validate_and_hash_frontend_lines(
    company_id: &str,
    period: &str,
    entry_type: &str,
    date: &str,
    description: &str,
    lineas: &[FrontendLinea],
    puc: &[LedgerAccount],
) -> Result<(Decimal, Decimal, String), ApiError> {
    let draft = ledger::EntryDraft {
        company_id: company_id.to_string(),
        period: period.to_string(),
        entry_type: entry_type.to_string(),
        date: date.to_string(),
        description: description.to_string(),
        lines: ledger::lines_from_frontend(lineas),
    };
    let val = ledger::validate_entry(&draft, puc);
    if !val.ok {
        return Err(ApiError::unprocessable_with(
            val.errors
                .first()
                .cloned()
                .unwrap_or_else(|| "El asiento contable no es válido.".into()),
            serde_json::to_value(&val).unwrap_or(Value::Null),
        ));
    }
    let hash = ledger::entry_hash(&draft);
    Ok((val.total_debit, val.total_credit, hash))
}

pub fn normalize_frontend_lines(lineas: Vec<FrontendLinea>, prefix: &str) -> Vec<FrontendLinea> {
    lineas
        .into_iter()
        .enumerate()
        .map(|(idx, mut l)| {
            if l.id.trim().is_empty() {
                l.id = format!("{prefix}-{}", idx + 1);
            }
            l
        })
        .collect()
}

pub fn build_reversal_lines(original: &[FrontendLinea], prefix: &str) -> Vec<FrontendLinea> {
    original
        .iter()
        .enumerate()
        .map(|(idx, l)| FrontendLinea {
            id: format!("{prefix}-{}", idx + 1),
            cuenta: l.cuenta.clone(),
            descripcion: format!("Reverso: {}", l.descripcion),
            debito: l.credito,
            credito: l.debito,
            tercero_id: l.tercero_id.clone(),
            unidad_id: l.unidad_id.clone(),
            rubro_id: l.rubro_id.clone(),
        })
        .collect()
}

pub fn compute_cartera_total(
    entries: &[FrontendComprobante],
    unit_ids: &[String],
    company_id: &str,
    period: &str,
) -> Decimal {
    let mut unit_net: HashMap<&str, Decimal> = HashMap::new();
    for c in entries {
        if c.estado == "ANULADO" || c.empresa_id != company_id || c.periodo.as_str() > period {
            continue;
        }
        for l in &c.lineas {
            let Some(uid) = l.unidad_id.as_deref() else {
                continue;
            };
            if !CARTERA_ACCOUNTS.contains(&l.cuenta.as_str()) {
                continue;
            }
            let acc = unit_net.entry(uid).or_insert(Decimal::ZERO);
            *acc += l.debito - l.credito;
        }
    }
    unit_ids
        .iter()
        .map(|uid| {
            let raw = unit_net.get(uid.as_str()).copied().unwrap_or(Decimal::ZERO);
            ledger::round_cop(raw)
        })
        .sum()
}

pub fn compute_unit_overdue_balances(
    entries: &[FrontendComprobante],
    company_id: &str,
    before_period: &str,
) -> HashMap<String, Decimal> {
    let mut unit_net: HashMap<String, Decimal> = HashMap::new();
    for c in entries {
        if c.estado == "ANULADO"
            || c.empresa_id != company_id
            || c.periodo.as_str() >= before_period
        {
            continue;
        }
        for l in &c.lineas {
            let Some(uid) = l.unidad_id.as_ref() else {
                continue;
            };
            if !CARTERA_ACCOUNTS.contains(&l.cuenta.as_str()) {
                continue;
            }
            let acc = unit_net.entry(uid.clone()).or_insert(Decimal::ZERO);
            *acc += l.debito - l.credito;
        }
    }
    unit_net
        .into_iter()
        .map(|(uid, raw)| (uid, ledger::round_cop(raw)))
        .filter(|(_, bal)| *bal > Decimal::ZERO)
        .collect()
}

pub fn build_billing_lines(
    company: &FrontendCopropiedad,
    units: &[FrontendUnidad],
    overdue_balances: &HashMap<String, Decimal>,
    incluir_mora: bool,
) -> Result<(Vec<FrontendLinea>, usize), ApiError> {
    if units.is_empty() {
        return Err(ApiError::unprocessable(
            "La copropiedad no tiene unidades inmobiliarias registradas.",
        ));
    }
    let hundred = Decimal::from(100);
    let twelve = Decimal::from(12);
    let cuota_global = company.presupuesto_anual / twelve;

    let mut lines = Vec::new();
    let mut total_expensas = Decimal::ZERO;
    let mut billed_units = 0usize;

    for u in units {
        let cuota = ledger::round_cop(cuota_global * u.coeficiente / hundred);
        if cuota <= Decimal::ZERO {
            continue;
        }
        let pagador_id = u
            .arrendatario_id
            .clone()
            .unwrap_or_else(|| u.propietario_id.clone());
        lines.push(FrontendLinea {
            id: String::new(),
            cuenta: "130505".into(),
            descripcion: format!("Expensa ordinaria {} {}", u.torre, u.numero),
            debito: cuota,
            credito: Decimal::ZERO,
            tercero_id: Some(pagador_id),
            unidad_id: Some(u.id.clone()),
            rubro_id: None,
        });
        total_expensas += cuota;
        billed_units += 1;
    }

    if total_expensas <= Decimal::ZERO {
        return Err(ApiError::unprocessable(
            "El valor calculado de expensas es cero; revisa el presupuesto anual y coeficientes.",
        ));
    }

    let fondo = ledger::round_cop(total_expensas * company.fondo_imprevistos_pct / hundred);
    let ingreso_ordinario = total_expensas - fondo;

    if ingreso_ordinario > Decimal::ZERO {
        lines.push(FrontendLinea {
            id: String::new(),
            cuenta: "417005".into(),
            descripcion: "Causación expensas ordinarias del mes".into(),
            debito: Decimal::ZERO,
            credito: ingreso_ordinario,
            tercero_id: None,
            unidad_id: None,
            rubro_id: None,
        });
    }
    if fondo > Decimal::ZERO {
        lines.push(FrontendLinea {
            id: String::new(),
            cuenta: "281510".into(),
            descripcion: "Apropiación fondo de imprevistos Ley 675".into(),
            debito: Decimal::ZERO,
            credito: fondo,
            tercero_id: None,
            unidad_id: None,
            rubro_id: None,
        });
    }

    if incluir_mora && company.tasa_mora_mensual > Decimal::ZERO {
        let mut total_mora = Decimal::ZERO;
        for u in units {
            if u.cartera_congelada {
                continue;
            }
            let Some(&saldo) = overdue_balances.get(&u.id) else {
                continue;
            };
            let mora = ledger::round_cop(saldo * company.tasa_mora_mensual / hundred);
            if mora <= Decimal::ZERO {
                continue;
            }
            let pagador_id = u
                .arrendatario_id
                .clone()
                .unwrap_or_else(|| u.propietario_id.clone());
            lines.push(FrontendLinea {
                id: String::new(),
                cuenta: "130515".into(),
                descripcion: format!("Interés de mora {} {}", u.torre, u.numero),
                debito: mora,
                credito: Decimal::ZERO,
                tercero_id: Some(pagador_id),
                unidad_id: Some(u.id.clone()),
                rubro_id: None,
            });
            total_mora += mora;
        }
        if total_mora > Decimal::ZERO {
            lines.push(FrontendLinea {
                id: String::new(),
                cuenta: "417030".into(),
                descripcion: "Intereses de mora sobre cartera vencida".into(),
                debito: Decimal::ZERO,
                credito: total_mora,
                tercero_id: None,
                unidad_id: None,
                rubro_id: None,
            });
        }
    }

    Ok((lines, billed_units))
}

pub fn compute_traslado_fondo(
    entries: &[FrontendComprobante],
    company_id: &str,
    period: &str,
) -> Decimal {
    let mut raw = Decimal::ZERO;
    for c in entries {
        if c.estado == "ANULADO" || c.empresa_id != company_id || c.periodo != period {
            continue;
        }
        for l in &c.lineas {
            if l.cuenta == "281510" && l.credito > Decimal::ZERO {
                raw += l.credito;
            }
        }
    }
    ledger::round_cop(raw)
}

pub fn closing_audit_detail(period: &str, lines: &[FrontendLinea]) -> String {
    let mut ops = Vec::new();
    if lines.iter().any(|l| l.cuenta == "516005") {
        ops.push("depreciación");
    }
    if lines.iter().any(|l| l.cuenta == "519905") {
        ops.push("provisión de cartera");
    }
    if lines.iter().any(|l| l.cuenta == "111010") {
        ops.push("traslado al fondo");
    }
    format!("{period}: {}.", ops.join(", "))
}

pub fn validate_create_pre_entry_input(req: &CreatePreEntryRequest) -> Result<(String, String, String), ApiError> {
    let entry_type = req.entry_type.trim().to_uppercase();
    if !["CC", "RC", "CE", "NC", "DS"].contains(&entry_type.as_str()) {
        return Err(ApiError::unprocessable(
            "El tipo de comprobante debe ser CC, RC, CE, NC o DS.",
        ));
    }
    let description = req.description.trim().to_string();
    if description.is_empty() {
        return Err(ApiError::unprocessable(
            "La descripción del pre-asiento es obligatoria.",
        ));
    }
    NaiveDate::parse_from_str(req.date.trim(), "%Y-%m-%d").map_err(|_| {
        ApiError::BadRequest(format!("Fecha inválida '{}'; usa YYYY-MM-DD.", req.date))
    })?;
    let agent_raw = req.agent.trim();
    let agent: String = if agent_raw.is_empty() {
        "AGENTE_IA_EVE".into()
    } else {
        agent_raw.chars().take(60).collect()
    };
    Ok((entry_type, description, agent))
}

pub fn build_pre_entry_document(
    req: &CreatePreEntryRequest,
    total_debit: Decimal,
    tp_name: &str,
    tp_nit: &str,
    doc_ref: &str,
) -> Value {
    if let Some(doc @ Value::Object(map)) = &req.document {
        if map.contains_key("clase") && map.contains_key("numero") {
            return doc.clone();
        }
    }
    let clase = match req.entry_type.trim().to_uppercase().as_str() {
        "RC" => "RECIBO",
        "DS" => "SOPORTE",
        _ => "FACTURA",
    };
    json!({
        "clase": clase,
        "numero": doc_ref,
        "emisor": tp_name,
        "nit": tp_nit,
        "fecha": req.date.trim(),
        "items": [
            {
                "descripcion": req.description.trim(),
                "cantidad": 1,
                "valorUnitario": total_debit,
            }
        ],
        "subtotal": total_debit,
        "iva": Decimal::ZERO,
        "total": total_debit,
        "retenciones": [],
    })
}
