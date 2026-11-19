use crate::domain::{LedgerAccount, ThirdParty, ValidationResult};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Line {
    pub account: String,
    pub description: String,
    pub debit: f64,
    pub credit: f64,
    #[serde(default)]
    pub third_party_id: Option<String>,
    #[serde(default)]
    pub unit_id: Option<String>,
    #[serde(default)]
    pub rubric_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntryDraft {
    pub company_id: String,
    pub period: String,
    pub entry_type: String, // CC|RC|CE|NC|DS
    pub date: String,
    pub description: String,
    pub lines: Vec<Line>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreEntryDraft {
    pub company_id: String,
    pub third_party_id: Option<String>,
    pub description: String,
    pub lines: Vec<Line>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CarryForwardResult {
    pub applied: bool,
    pub detail: String,
    pub lines: Vec<Line>,
    pub totals: Totals,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Totals {
    pub debit: f64,
    pub credit: f64,
    pub net_payable: f64,
}

fn round_cop(v: f64) -> f64 {
    (v / 100.0).round() * 100.0
}

pub fn validate_entry(draft: &EntryDraft, puc: &[LedgerAccount]) -> ValidationResult {
    let mut errors = Vec::new();
    let known: HashSet<&str> = puc.iter().map(|a| a.code.as_str()).collect();

    if draft.lines.len() < 2 {
        errors.push("El comprobante debe tener al menos 2 líneas.".into());
    }

    let mut total_debit = 0.0_f64;
    let mut total_credit = 0.0_f64;

    for (i, l) in draft.lines.iter().enumerate() {
        let n = i + 1;
        if !known.contains(l.account.as_str()) {
            errors.push(format!(
                "Línea {n}: la cuenta {} no existe en el PUC ESAL.",
                l.account
            ));
        }
        if l.debit < 0.0 || l.credit < 0.0 {
            errors.push(format!("Línea {n}: los montos no pueden ser negativos."));
        }
        if l.debit > 0.0 && l.credit > 0.0 {
            errors.push(format!(
                "Línea {n}: no puede tener débito y crédito simultáneos."
            ));
        }
        if l.debit == 0.0 && l.credit == 0.0 {
            errors.push(format!("Línea {n}: el monto debe ser mayor a cero."));
        }
        total_debit += l.debit;
        total_credit += l.credit;
    }

    total_debit = (total_debit * 100.0).round() / 100.0;
    total_credit = (total_credit * 100.0).round() / 100.0;
    let difference = (total_debit - total_credit * 1.0 * 100.0).round() / 100.0;
    if difference.abs() > 0.009 {
        errors.push(format!(
            "El comprobante está descuadrado: débitos {:.2} ≠ créditos {:.2}.",
            total_debit, total_credit
        ));
    }

    ValidationResult {
        ok: errors.is_empty(),
        total_debit,
        total_credit,
        difference,
        errors,
    }
}

/// Hash estable del contenido contable (tipo, periodo, fecha, líneas).
/// No es criptográfico; sirve para trazabilidad/auditoría básica en demo.
pub fn entry_hash(draft: &EntryDraft) -> String {
    let mut h: u32 = 0x811c9dc5;
    let mut feed = |s: &str| {
        for b in s.as_bytes() {
            h ^= *b as u32;
            h = h.wrapping_mul(0x01000193);
        }
    };
    feed(&draft.entry_type);
    feed("|");
    feed(&draft.period);
    feed("|");
    feed(&draft.date);
    for l in &draft.lines {
        feed("|");
        feed(&l.account);
        feed(":");
        feed(&format!("{:.2}", l.debit));
        feed(":");
        feed(&format!("{:.2}", l.credit));
    }
    format!("{:08x}", h)
}

/// Aplica reglas deterministas de retención según el tercero.
/// Replica el concepto de "acarreo IA" del frontend: calcula ReteFuente/ReteICA/ReteIVA
/// sobre base e IVA y recompone la línea de cuenta por pagar.
pub fn carry_forward(pre: &PreEntryDraft, third_parties: &[ThirdParty]) -> Option<CarryForwardResult> {
    let tp_id = pre.third_party_id.as_ref()?;
    let tp = third_parties.iter().find(|t| &t.id == tp_id)?;
    if tp.retefuente_pct == 0.0 && tp.reteica_pct == 0.0 && tp.reteiva_pct == 0.0 {
        return None;
    }

    let base: f64 = pre
        .lines
        .iter()
        .filter(|l| {
            l.debit > 0.0
                && l.account != "135515"
                && l.account != "111005"
                && l.account != "220505"
                && l.account != "236540"
                && l.account != "236801"
                && l.account != "236705"
        })
        .map(|l| l.debit)
        .sum();
    let iva: f64 = pre
        .lines
        .iter()
        .filter(|l| l.account == "135515")
        .map(|l| l.debit)
        .sum();
    if base <= 0.0 {
        return None;
    }

    let base = round_cop(base);
    let iva = round_cop(iva);
    let rf = round_cop(base * tp.retefuente_pct / 100.0);
    let ri = round_cop(base * tp.reteica_pct / 100.0);
    let riva = round_cop(iva * tp.reteiva_pct / 100.0);
    let neto = base + iva - rf - ri - riva;

    let mut out: Vec<Line> = Vec::new();
    // Gastos/costos base
    for l in pre.lines.iter().filter(|l| l.debit > 0.0 && l.account != "135515") {
        if ["220505", "236540", "236801", "236705", "111005", "417035"].contains(&l.account.as_str()) {
            continue;
        }
        out.push(l.clone());
    }
    // IVA
    if let Some(iva_line) = pre.lines.iter().find(|l| l.account == "135515") {
        out.push(iva_line.clone());
    } else if iva > 0.0 {
        out.push(Line {
            account: "135515".into(),
            description: "IVA descontable".into(),
            debit: iva,
            credit: 0.0,
            third_party_id: None,
            unit_id: None,
            rubric_id: None,
        });
    }
    // Neto por pagar
    out.push(Line {
        account: "220505".into(),
        description: "Cuenta por pagar".into(),
        debit: 0.0,
        credit: neto,
        third_party_id: Some(tp.id.clone()),
        unit_id: None,
        rubric_id: None,
    });
    // Retenciones
    if rf > 0.0 {
        out.push(Line {
            account: "236540".into(),
            description: "Retención en la fuente".into(),
            debit: 0.0,
            credit: rf,
            third_party_id: None,
            unit_id: None,
            rubric_id: None,
        });
    }
    if ri > 0.0 {
        out.push(Line {
            account: "236801".into(),
            description: "Retención de ICA".into(),
            debit: 0.0,
            credit: ri,
            third_party_id: None,
            unit_id: None,
            rubric_id: None,
        });
    }
    if riva > 0.0 {
        out.push(Line {
            account: "236705".into(),
            description: "Retención de IVA".into(),
            debit: 0.0,
            credit: riva,
            third_party_id: None,
            unit_id: None,
            rubric_id: None,
        });
    }

    let mut parts = Vec::new();
    if rf > 0.0 {
        parts.push(format!("ReteFuente {}% = {:.0}", tp.retefuente_pct, rf));
    }
    if ri > 0.0 {
        parts.push(format!("ReteICA {}% = {:.0}", tp.reteica_pct, ri));
    }
    if riva > 0.0 {
        parts.push(format!("ReteIVA {}% = {:.0}", tp.reteiva_pct, riva));
    }
    let detail = format!(
        "Acarreo: {}. Neto a pagar ${:.0}.",
        parts.join(" · "),
        neto
    );

    Some(CarryForwardResult {
        applied: true,
        detail,
        totals: Totals {
            debit: base + iva,
            credit: neto + rf + ri + riva,
            net_payable: neto,
        },
        lines: out,
    })
}

/// Vista previa simple de balance: suma movimientos y calcula saldo neto firmado.
/// Para producción esto debe leer del ledger persistido y aplicar naturalezas completas.
pub fn trial_balance_preview(
    req: &crate::domain::BalanceRequest,
    puc: &[LedgerAccount],
) -> serde_json::Value {
    let nature: HashMap<&str, &str> = puc.iter().map(|a| (a.code.as_str(), a.nature.as_str())).collect();
    let mut movement: HashMap<String, (f64, f64)> = HashMap::new();
    for e in &req.entries {
        if req.period != "todos" && e.period > req.period {
            continue;
        }
        for l in &e.lines {
            let m = movement.entry(l.account.clone()).or_insert((0.0, 0.0));
            m.0 += l.debit;
            m.1 += l.credit;
        }
    }
    let mut rows = Vec::new();
    let mut net_signed = 0.0_f64;
    for (acc, (d, c)) in movement {
        let n = nature.get(acc.as_str()).copied().unwrap_or("D");
        let opening = req.opening_balances.get(&acc).copied().unwrap_or(0.0);
        let balance = if n == "D" { opening + d - c } else { opening + c - d };
        net_signed += if n == "D" { balance } else { -balance };
        rows.push(serde_json::json!({
            "account": acc,
            "nature": n,
            "opening": opening,
            "debit": d,
            "credit": c,
            "balance": balance
        }));
    }
    rows.sort_by(|a, b| a["account"].as_str().cmp(&b["account"].as_str()));
    serde_json::json!({
        "company_id": req.company_id,
        "period": req.period,
        "balanced": net_signed.abs() < 0.01,
        "net_signed": net_signed,
        "rows": rows
    })
}
