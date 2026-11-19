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
        if !l.debit.is_finite() || !l.credit.is_finite() {
            errors.push(format!("Línea {n}: los montos deben ser números válidos."));
            continue;
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
    let difference = ((total_debit - total_credit) * 100.0).round() / 100.0;
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

    let base_lines: Vec<Line> = pre
        .lines
        .iter()
        .filter(|l| {
            l.debit.is_finite()
                && l.debit > 0.0
                && ![
                    "135515", "111005", "220505", "236540", "236801", "236705", "417035",
                ]
                .contains(&l.account.as_str())
        })
        .cloned()
        .collect();
    let iva_lines: Vec<Line> = pre
        .lines
        .iter()
        .filter(|l| l.debit.is_finite() && l.debit > 0.0 && l.account == "135515")
        .cloned()
        .collect();

    let base_raw: f64 = base_lines.iter().map(|l| l.debit).sum();
    let iva_raw: f64 = iva_lines.iter().map(|l| l.debit).sum();
    if base_raw <= 0.0 {
        return None;
    }

    let rf = round_cop(base_raw * tp.retefuente_pct / 100.0);
    let ri = round_cop(base_raw * tp.reteica_pct / 100.0);
    let riva = round_cop(iva_raw * tp.reteiva_pct / 100.0);
    let neto = ((base_raw + iva_raw - rf - ri - riva) * 100.0).round() / 100.0;
    if neto < 0.0 {
        return None;
    }

    let mut out: Vec<Line> = Vec::with_capacity(base_lines.len() + iva_lines.len() + 4);
    out.extend(base_lines);
    out.extend(iva_lines);

    if neto > 0.0 {
        out.push(Line {
            account: "220505".into(),
            description: "Cuenta por pagar".into(),
            debit: 0.0,
            credit: neto,
            third_party_id: Some(tp.id.clone()),
            unit_id: None,
            rubric_id: None,
        });
    }
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
            debit: ((base_raw + iva_raw) * 100.0).round() / 100.0,
            credit: ((neto + rf + ri + riva) * 100.0).round() / 100.0,
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
    let mut accounts: HashSet<String> = req.opening_balances.keys().cloned().collect();
    accounts.extend(movement.keys().cloned());

    let mut rows = Vec::new();
    let mut net_signed = 0.0_f64;
    for acc in accounts {
        let (d, c) = movement.get(&acc).copied().unwrap_or((0.0, 0.0));
        let opening = req.opening_balances.get(&acc).copied().unwrap_or(0.0);
        if opening.abs() < 1e-9 && d == 0.0 && c == 0.0 {
            continue;
        }
        let n = nature.get(acc.as_str()).copied().unwrap_or("D");
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{AppState, BalanceRequest};

    fn line(account: &str, debit: f64, credit: f64) -> Line {
        Line {
            account: account.into(),
            description: format!("Mov {account}"),
            debit,
            credit,
            third_party_id: None,
            unit_id: None,
            rubric_id: None,
        }
    }

    fn draft(lines: Vec<Line>) -> EntryDraft {
        EntryDraft {
            company_id: "altavista".into(),
            period: "2026-11".into(),
            entry_type: "CC".into(),
            date: "2026-11-12".into(),
            description: "Prueba".into(),
            lines,
        }
    }

    #[test]
    fn validate_entry_balanced_ok() {
        let app = AppState::demo();
        let d = draft(vec![
            line("513505", 1_000_000.0, 0.0),
            line("220505", 0.0, 1_000_000.0),
        ]);
        let res = validate_entry(&d, &app.puc);
        assert!(res.ok, "errors: {:?}", res.errors);
        assert_eq!(res.difference, 0.0);
        assert_eq!(res.total_debit, 1_000_000.0);
        assert_eq!(res.total_credit, 1_000_000.0);
    }

    #[test]
    fn validate_entry_rejects_unbalanced_negative_zero_both_sides_unknown_and_single_line() {
        let app = AppState::demo();

        let single = validate_entry(&draft(vec![line("513505", 100.0, 0.0)]), &app.puc);
        assert!(!single.ok);

        let unbalanced = validate_entry(
            &draft(vec![
                line("513505", 1_000.0, 0.0),
                line("220505", 0.0, 900.0),
            ]),
            &app.puc,
        );
        assert!(!unbalanced.ok);

        let negative = validate_entry(
            &draft(vec![
                line("513505", -100.0, 0.0),
                line("220505", 0.0, -100.0),
            ]),
            &app.puc,
        );
        assert!(!negative.ok);

        let both_sides = validate_entry(
            &draft(vec![
                line("513505", 500.0, 500.0),
                line("220505", 0.0, 0.0),
            ]),
            &app.puc,
        );
        assert!(!both_sides.ok);

        let unknown = validate_entry(
            &draft(vec![
                line("999999", 500.0, 0.0),
                line("220505", 0.0, 500.0),
            ]),
            &app.puc,
        );
        assert!(!unknown.ok);
    }

    #[test]
    fn carry_forward_balances_on_round_and_non_round_100_invoices() {
        let app = AppState::demo();

        let round_pre = PreEntryDraft {
            company_id: "altavista".into(),
            third_party_id: Some("prov-atlas".into()),
            description: "Vigilancia".into(),
            lines: vec![
                line("513505", 10_000_000.0, 0.0),
                line("135515", 1_900_000.0, 0.0),
                line("220505", 0.0, 11_900_000.0),
            ],
        };
        let res1 = carry_forward(&round_pre, &app.third_parties).expect("round carry_forward");
        let v1 = validate_entry(&draft(res1.lines), &app.puc);
        assert!(v1.ok, "errors: {:?}", v1.errors);

        let non_round_pre = PreEntryDraft {
            company_id: "altavista".into(),
            third_party_id: Some("prov-atlas".into()),
            description: "Factura no múltiplo de 100".into(),
            lines: vec![
                line("513505", 1_250_350.0, 0.0),
                line("135515", 237_566.5, 0.0),
                line("220505", 0.0, 1_487_916.5),
            ],
        };
        let res2 = carry_forward(&non_round_pre, &app.third_parties).expect("non-round carry_forward");
        let v2 = validate_entry(&draft(res2.lines), &app.puc);
        assert!(v2.ok, "errors: {:?}", v2.errors);
        assert!((res2.totals.debit - res2.totals.credit).abs() < 0.01);
    }

    #[test]
    fn trial_balance_includes_opening_only_accounts_and_balances() {
        let app = AppState::demo();
        let mut opening = HashMap::new();
        opening.insert("111005".to_string(), 5_000_000.0);
        opening.insert("310505".to_string(), 5_000_000.0);

        let req = BalanceRequest {
            company_id: "altavista".into(),
            period: "2026-11".into(),
            opening_balances: opening,
            entries: vec![draft(vec![
                line("513505", 200_000.0, 0.0),
                line("220505", 0.0, 200_000.0),
            ])],
        };

        let out = trial_balance_preview(&req, &app.puc);
        assert_eq!(out["balanced"], serde_json::json!(true));
        let rows = out["rows"].as_array().expect("rows array");
        assert!(rows.iter().any(|r| r["account"] == "310505" && r["balance"] == 5_000_000.0));
        assert!(rows.iter().any(|r| r["account"] == "111005" && r["balance"] == 5_000_000.0));
    }

    #[test]
    fn entry_hash_deterministic() {
        let d = draft(vec![
            line("513505", 100_000.0, 0.0),
            line("220505", 0.0, 100_000.0),
        ]);
        let h1 = entry_hash(&d);
        let h2 = entry_hash(&d);
        assert_eq!(h1, h2);
        assert_eq!(h1.len(), 8);
    }
}
