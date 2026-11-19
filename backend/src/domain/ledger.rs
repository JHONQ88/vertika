use crate::domain::{
    ClosePeriodRequest, FrontendLinea, FrontendRubro, LedgerAccount, ThirdParty, ValidationResult,
};
use rust_decimal::{Decimal, RoundingStrategy};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fmt::Write;

pub const CARTERA_ACCOUNTS: [&str; 4] = ["130505", "130510", "130515", "130520"];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Line {
    pub account: String,
    pub description: String,
    pub debit: Decimal,
    pub credit: Decimal,
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
    pub debit: Decimal,
    pub credit: Decimal,
    pub net_payable: Decimal,
}

pub fn round_cop(v: Decimal) -> Decimal {
    let hundred = Decimal::from(100);
    (v / hundred).round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero) * hundred
}

fn fmt_dec_2(mut d: Decimal) -> String {
    d = d.round_dp(2);
    d.rescale(2);
    d.to_string()
}

pub fn lines_from_frontend(lineas: &[FrontendLinea]) -> Vec<Line> {
    lineas
        .iter()
        .map(|l| Line {
            account: l.cuenta.clone(),
            description: l.descripcion.clone(),
            debit: l.debito,
            credit: l.credito,
            third_party_id: l.tercero_id.clone(),
            unit_id: l.unidad_id.clone(),
            rubric_id: l.rubro_id.clone(),
        })
        .collect()
}

pub fn validate_entry(draft: &EntryDraft, puc: &[LedgerAccount]) -> ValidationResult {
    let mut errors = Vec::new();
    let known: HashSet<&str> = puc.iter().map(|a| a.code.as_str()).collect();

    if draft.lines.len() < 2 {
        errors.push("El comprobante debe tener al menos 2 líneas.".into());
    }

    let mut total_debit = Decimal::ZERO;
    let mut total_credit = Decimal::ZERO;

    for (i, l) in draft.lines.iter().enumerate() {
        let n = i + 1;
        if !known.contains(l.account.as_str()) {
            errors.push(format!(
                "Línea {n}: la cuenta {} no existe en el PUC ESAL.",
                l.account
            ));
        }
        let d = l.debit.round_dp(2);
        let c = l.credit.round_dp(2);
        if d < Decimal::ZERO || c < Decimal::ZERO {
            errors.push(format!("Línea {n}: los montos no pueden ser negativos."));
        }
        if d > Decimal::ZERO && c > Decimal::ZERO {
            errors.push(format!(
                "Línea {n}: no puede tener débito y crédito simultáneos."
            ));
        }
        if d == Decimal::ZERO && c == Decimal::ZERO {
            errors.push(format!("Línea {n}: el monto debe ser mayor a cero."));
        }
        total_debit += d;
        total_credit += c;
    }

    total_debit = total_debit.round_dp(2);
    total_credit = total_credit.round_dp(2);
    let difference = (total_debit - total_credit).round_dp(2);
    if difference != Decimal::ZERO {
        errors.push(format!(
            "El comprobante está descuadrado: débitos {} ≠ créditos {}.",
            fmt_dec_2(total_debit),
            fmt_dec_2(total_credit)
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

/// Hash criptográfico SHA-256 (hex 64 caracteres) sobre el contenido canónico del comprobante.
pub fn entry_hash(draft: &EntryDraft) -> String {
    let mut hasher = Sha256::new();
    let mut feed = |s: &str| {
        hasher.update(s.as_bytes());
        hasher.update(b"|");
    };
    feed(&draft.company_id);
    feed(&draft.entry_type);
    feed(&draft.period);
    feed(&draft.date);
    feed(&draft.description);
    for l in &draft.lines {
        feed(&l.account);
        feed(&fmt_dec_2(l.debit));
        feed(&fmt_dec_2(l.credit));
        feed(l.third_party_id.as_deref().unwrap_or(""));
        feed(l.unit_id.as_deref().unwrap_or(""));
        feed(l.rubric_id.as_deref().unwrap_or(""));
        feed(&l.description);
    }
    let digest = hasher.finalize();
    let mut hex = String::with_capacity(64);
    for b in digest {
        let _ = write!(&mut hex, "{b:02x}");
    }
    hex
}

/// Aplica reglas deterministas de retención según el tercero.
/// Replica el concepto de "acarreo IA" del frontend: calcula ReteFuente/ReteICA/ReteIVA
/// sobre base e IVA y recompone la línea de cuenta por pagar conservando débitos exactos.
pub fn carry_forward(pre: &PreEntryDraft, third_parties: &[ThirdParty]) -> Option<CarryForwardResult> {
    let tp_id = pre.third_party_id.as_ref()?;
    let tp = third_parties.iter().find(|t| &t.id == tp_id)?;
    if tp.retefuente_pct == Decimal::ZERO
        && tp.reteica_pct == Decimal::ZERO
        && tp.reteiva_pct == Decimal::ZERO
    {
        return None;
    }

    let base_lines: Vec<Line> = pre
        .lines
        .iter()
        .filter(|l| {
            l.debit > Decimal::ZERO
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
        .filter(|l| l.debit > Decimal::ZERO && l.account == "135515")
        .cloned()
        .collect();

    let base_raw: Decimal = base_lines.iter().map(|l| l.debit).sum();
    let iva_raw: Decimal = iva_lines.iter().map(|l| l.debit).sum();
    if base_raw <= Decimal::ZERO {
        return None;
    }

    let hundred = Decimal::from(100);
    let rf = round_cop(base_raw * tp.retefuente_pct / hundred);
    let ri = round_cop(base_raw * tp.reteica_pct / hundred);
    let riva = round_cop(iva_raw * tp.reteiva_pct / hundred);
    let neto = (base_raw + iva_raw - rf - ri - riva).round_dp(2);
    if neto < Decimal::ZERO {
        return None;
    }

    let mut out: Vec<Line> = Vec::with_capacity(base_lines.len() + iva_lines.len() + 4);
    out.extend(base_lines);
    out.extend(iva_lines);

    if neto > Decimal::ZERO {
        out.push(Line {
            account: "220505".into(),
            description: "Cuenta por pagar".into(),
            debit: Decimal::ZERO,
            credit: neto,
            third_party_id: Some(tp.id.clone()),
            unit_id: None,
            rubric_id: None,
        });
    }
    if rf > Decimal::ZERO {
        out.push(Line {
            account: "236540".into(),
            description: "Retención en la fuente".into(),
            debit: Decimal::ZERO,
            credit: rf,
            third_party_id: None,
            unit_id: None,
            rubric_id: None,
        });
    }
    if ri > Decimal::ZERO {
        out.push(Line {
            account: "236801".into(),
            description: "Retención de ICA".into(),
            debit: Decimal::ZERO,
            credit: ri,
            third_party_id: None,
            unit_id: None,
            rubric_id: None,
        });
    }
    if riva > Decimal::ZERO {
        out.push(Line {
            account: "236705".into(),
            description: "Retención de IVA".into(),
            debit: Decimal::ZERO,
            credit: riva,
            third_party_id: None,
            unit_id: None,
            rubric_id: None,
        });
    }

    let mut parts = Vec::new();
    if rf > Decimal::ZERO {
        parts.push(format!(
            "ReteFuente {}% = {}",
            tp.retefuente_pct.normalize(),
            rf.round_dp(0)
        ));
    }
    if ri > Decimal::ZERO {
        parts.push(format!(
            "ReteICA {}% = {}",
            tp.reteica_pct.normalize(),
            ri.round_dp(0)
        ));
    }
    if riva > Decimal::ZERO {
        parts.push(format!(
            "ReteIVA {}% = {}",
            tp.reteiva_pct.normalize(),
            riva.round_dp(0)
        ));
    }
    let detail = format!(
        "Acarreo: {}. Neto a pagar ${}.",
        parts.join(" · "),
        neto.round_dp(0)
    );

    Some(CarryForwardResult {
        applied: true,
        detail,
        totals: Totals {
            debit: (base_raw + iva_raw).round_dp(2),
            credit: (neto + rf + ri + riva).round_dp(2),
            net_payable: neto,
        },
        lines: out,
    })
}

/// Calcula líneas del comprobante de cierre mensual respetando toggles y omitiendo montos en cero.
pub fn build_closing_lines(
    period: &str,
    escala: Decimal,
    cartera_total: Decimal,
    traslado_fondo: Decimal,
    opts: &ClosePeriodRequest,
    rubros: &[FrontendRubro],
) -> Vec<FrontendLinea> {
    let find_rubro = |key: &str| rubros.iter().find(|r| r.key == key).map(|r| r.id.clone());
    let depreciacion = round_cop(Decimal::from(2_500_000) * escala);
    let provision = round_cop(cartera_total * Decimal::new(5, 2));
    let traslado = round_cop(traslado_fondo);

    let mut lineas = Vec::new();
    if opts.depreciacion && depreciacion > Decimal::ZERO {
        lineas.push(FrontendLinea {
            id: format!("cie-{period}-1"),
            cuenta: "516005".into(),
            descripcion: "Depreciación de PP&E".into(),
            debito: depreciacion,
            credito: Decimal::ZERO,
            tercero_id: None,
            unidad_id: None,
            rubro_id: find_rubro("MAN"),
        });
        lineas.push(FrontendLinea {
            id: format!("cie-{period}-2"),
            cuenta: "159215".into(),
            descripcion: "Depreciación acumulada".into(),
            debito: Decimal::ZERO,
            credito: depreciacion,
            tercero_id: None,
            unidad_id: None,
            rubro_id: None,
        });
    }
    if opts.provision && provision > Decimal::ZERO {
        lineas.push(FrontendLinea {
            id: format!("cie-{period}-3"),
            cuenta: "519905".into(),
            descripcion: "Provisión deterioro de cartera".into(),
            debito: provision,
            credito: Decimal::ZERO,
            tercero_id: None,
            unidad_id: None,
            rubro_id: find_rubro("FIN"),
        });
        lineas.push(FrontendLinea {
            id: format!("cie-{period}-4"),
            cuenta: "139905".into(),
            descripcion: "Deterioro de cartera".into(),
            debito: Decimal::ZERO,
            credito: provision,
            tercero_id: None,
            unidad_id: None,
            rubro_id: None,
        });
    }
    if opts.traslado && traslado > Decimal::ZERO {
        lineas.push(FrontendLinea {
            id: format!("cie-{period}-5"),
            cuenta: "111010".into(),
            descripcion: "Bancos - Fondo de imprevistos".into(),
            debito: traslado,
            credito: Decimal::ZERO,
            tercero_id: None,
            unidad_id: None,
            rubro_id: None,
        });
        lineas.push(FrontendLinea {
            id: format!("cie-{period}-6"),
            cuenta: "111005".into(),
            descripcion: "Bancos - cuenta recaudadora".into(),
            debito: Decimal::ZERO,
            credito: traslado,
            tercero_id: None,
            unidad_id: None,
            rubro_id: None,
        });
    }
    lineas
}

/// Vista previa de balance de prueba con aritmética exacta `Decimal`.
pub fn trial_balance_preview(
    req: &crate::domain::BalanceRequest,
    puc: &[LedgerAccount],
) -> serde_json::Value {
    let mut movement: HashMap<String, (Decimal, Decimal)> = HashMap::new();
    for e in &req.entries {
        if req.period != "todos" && e.period > req.period {
            continue;
        }
        for l in &e.lines {
            let m = movement
                .entry(l.account.clone())
                .or_insert((Decimal::ZERO, Decimal::ZERO));
            m.0 += l.debit;
            m.1 += l.credit;
        }
    }
    build_balance_report(
        &req.company_id,
        &req.period,
        &req.opening_balances,
        &movement,
        puc,
    )
}

/// Construye el reporte de balance de prueba desde saldos iniciales y movimientos agregados.
pub fn build_balance_report(
    company_id: &str,
    period: &str,
    opening_balances: &HashMap<String, Decimal>,
    movement: &HashMap<String, (Decimal, Decimal)>,
    puc: &[LedgerAccount],
) -> serde_json::Value {
    let account_meta: HashMap<&str, &LedgerAccount> =
        puc.iter().map(|a| (a.code.as_str(), a)).collect();
    let mut accounts: HashSet<String> = opening_balances.keys().cloned().collect();
    accounts.extend(movement.keys().cloned());

    let mut rows = Vec::new();
    let mut net_signed = Decimal::ZERO;
    let mut total_debits = Decimal::ZERO;
    let mut total_credits = Decimal::ZERO;

    for acc in accounts {
        let (d, c) = movement
            .get(&acc)
            .copied()
            .unwrap_or((Decimal::ZERO, Decimal::ZERO));
        let opening = opening_balances
            .get(&acc)
            .copied()
            .unwrap_or(Decimal::ZERO);
        if opening == Decimal::ZERO && d == Decimal::ZERO && c == Decimal::ZERO {
            continue;
        }
        let meta = account_meta.get(acc.as_str()).copied();
        let n = meta.map(|m| m.nature.as_str()).unwrap_or("D");
        let name = meta.map(|m| m.name.as_str()).unwrap_or("");
        let account_type = meta.map(|m| m.account_type.as_str()).unwrap_or("");
        let balance = if n == "D" {
            opening + d - c
        } else {
            opening + c - d
        };
        net_signed += if n == "D" { balance } else { -balance };
        total_debits += d;
        total_credits += c;
        rows.push(serde_json::json!({
            "account": acc,
            "name": name,
            "account_type": account_type,
            "nature": n,
            "opening": opening,
            "debit": d,
            "credit": c,
            "balance": balance
        }));
    }
    rows.sort_by(|a, b| a["account"].as_str().cmp(&b["account"].as_str()));
    let balanced = net_signed.abs() < Decimal::new(1, 2);
    serde_json::json!({
        "company_id": company_id,
        "period": period,
        "balanced": balanced,
        "net_signed": net_signed.round_dp(2),
        "total_debits": total_debits.round_dp(2),
        "total_credits": total_credits.round_dp(2),
        "rows": rows
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{AppState, BalanceRequest};

    fn d(val: &str) -> Decimal {
        val.parse().expect("decimal")
    }

    fn line(account: &str, debit: &str, credit: &str) -> Line {
        Line {
            account: account.into(),
            description: format!("Mov {account}"),
            debit: d(debit),
            credit: d(credit),
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
        let entry = draft(vec![
            line("513505", "1000000", "0"),
            line("220505", "0", "1000000"),
        ]);
        let res = validate_entry(&entry, &app.puc);
        assert!(res.ok, "errors: {:?}", res.errors);
        assert_eq!(res.difference, Decimal::ZERO);
        assert_eq!(res.total_debit, d("1000000"));
        assert_eq!(res.total_credit, d("1000000"));
    }

    #[test]
    fn validate_entry_rejects_unbalanced_negative_zero_both_sides_unknown_and_single_line() {
        let app = AppState::demo();

        let single = validate_entry(&draft(vec![line("513505", "100", "0")]), &app.puc);
        assert!(!single.ok);

        let unbalanced = validate_entry(
            &draft(vec![
                line("513505", "1000", "0"),
                line("220505", "0", "900"),
            ]),
            &app.puc,
        );
        assert!(!unbalanced.ok);

        let negative = validate_entry(
            &draft(vec![
                line("513505", "-100", "0"),
                line("220505", "0", "-100"),
            ]),
            &app.puc,
        );
        assert!(!negative.ok);

        let both_sides = validate_entry(
            &draft(vec![
                line("513505", "500", "500"),
                line("220505", "0", "0"),
            ]),
            &app.puc,
        );
        assert!(!both_sides.ok);

        let unknown = validate_entry(
            &draft(vec![
                line("999999", "500", "0"),
                line("220505", "0", "500"),
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
                line("513505", "10000000", "0"),
                line("135515", "1900000", "0"),
                line("220505", "0", "11900000"),
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
                line("513505", "1250350", "0"),
                line("135515", "237566.50", "0"),
                line("220505", "0", "1487916.50"),
            ],
        };
        let res2 = carry_forward(&non_round_pre, &app.third_parties).expect("non-round carry_forward");
        let v2 = validate_entry(&draft(res2.lines), &app.puc);
        assert!(v2.ok, "errors: {:?}", v2.errors);
        assert_eq!(res2.totals.debit, res2.totals.credit);
    }

    #[test]
    fn trial_balance_includes_opening_only_accounts_and_balances() {
        let app = AppState::demo();
        let mut opening = HashMap::new();
        opening.insert("111005".to_string(), d("5000000"));
        opening.insert("310505".to_string(), d("5000000"));

        let req = BalanceRequest {
            company_id: "altavista".into(),
            period: "2026-11".into(),
            opening_balances: opening,
            entries: vec![draft(vec![
                line("513505", "200000", "0"),
                line("220505", "0", "200000"),
            ])],
        };

        let out = trial_balance_preview(&req, &app.puc);
        assert_eq!(out["balanced"], serde_json::json!(true));
        let rows = out["rows"].as_array().expect("rows array");
        assert!(rows.iter().any(|r| r["account"] == "310505" && r["balance"].as_f64() == Some(5_000_000.0)));
        assert!(rows.iter().any(|r| r["account"] == "111005" && r["balance"].as_f64() == Some(5_000_000.0)));
    }

    #[test]
    fn entry_hash_sha256_deterministic_and_sensitive() {
        let mut d1 = draft(vec![
            line("513505", "100000", "0"),
            line("220505", "0", "100000"),
        ]);
        let h1 = entry_hash(&d1);
        let h2 = entry_hash(&d1);
        assert_eq!(h1, h2);
        assert_eq!(h1.len(), 64);
        assert!(h1.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));

        d1.description = "Otro concepto".into();
        let h3 = entry_hash(&d1);
        assert_ne!(h1, h3);
    }
}
