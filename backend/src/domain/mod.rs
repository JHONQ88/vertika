pub mod ledger;
pub mod models;

pub use models::*;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LedgerAccount {
    pub code: String,
    pub name: String,
    pub account_type: String, // ACTIVO|PASIVO|PATRIMONIO|INGRESO|GASTO
    pub nature: String,       // D|C
    pub rubric_key: Option<String>,
    #[serde(default)]
    pub requires_third_party: bool,
    #[serde(default)]
    pub requires_unit: bool,
    #[serde(default)]
    pub is_cash: bool,
    #[serde(default)]
    pub restricted: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThirdParty {
    pub id: String,
    pub name: String,
    pub nit: String,
    pub retefuente_pct: Decimal,
    pub reteica_pct: Decimal,
    pub reteiva_pct: Decimal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Health {
    pub status: String,
    pub service: String,
    pub version: String,
    pub mode: String,
    pub postgres_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BalanceRequest {
    pub company_id: String,
    pub period: String,
    /// Saldos iniciales por cuenta (firmados según naturaleza de la cuenta en el origen).
    #[serde(default)]
    pub opening_balances: HashMap<String, Decimal>,
    /// Movimientos ya asentados a considerar.
    #[serde(default)]
    pub entries: Vec<ledger::EntryDraft>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationResult {
    pub ok: bool,
    pub total_debit: Decimal,
    pub total_credit: Decimal,
    pub difference: Decimal,
    pub errors: Vec<String>,
}

#[cfg(test)]
#[derive(Debug, Clone)]
pub struct AppState {
    pub puc: Vec<LedgerAccount>,
    pub third_parties: Vec<ThirdParty>,
}

#[cfg(test)]
impl AppState {
    pub fn demo() -> Self {
        Self {
            puc: demo_puc(),
            third_parties: demo_third_parties(),
        }
    }
}

pub fn demo_puc() -> Vec<LedgerAccount> {
    struct Row(&'static str, &'static str, &'static str, &'static str, Option<&'static str>, bool, bool, bool, bool, Option<&'static str>);
    let rows = vec![
        // ACTIVO
        Row("110505", "Caja general", "ACTIVO", "D", None, false, false, true, false, None),
        Row("111005", "Bancos - cuenta recaudadora", "ACTIVO", "D", None, false, false, true, false, Some("Cuenta maestra de recaudo de expensas.")),
        Row("111010", "Bancos - Fondo de imprevistos", "ACTIVO", "D", None, false, false, true, true, Some("Efectivo restringido. Ley 675 art. 36.")),
        Row("130505", "CxC expensas ordinarias", "ACTIVO", "D", None, true, true, false, false, None),
        Row("130510", "CxC expensas extraordinarias", "ACTIVO", "D", None, true, true, false, false, None),
        Row("130515", "CxC intereses de mora", "ACTIVO", "D", None, true, true, false, false, None),
        Row("130520", "CxC multas y sanciones", "ACTIVO", "D", None, true, true, false, false, None),
        Row("135515", "IVA descontable", "ACTIVO", "D", None, false, false, false, false, None),
        Row("139905", "Deterioro de cartera", "ACTIVO", "C", None, false, false, false, false, Some("Cuenta contra-activo.")),
        Row("152405", "Construcciones y edificaciones", "ACTIVO", "D", None, false, false, false, false, None),
        Row("152805", "Equipo de cómputo y comunicaciones", "ACTIVO", "D", None, false, false, false, false, None),
        Row("159215", "Depreciación acumulada", "ACTIVO", "C", None, false, false, false, false, Some("Cuenta contra-activo.")),
        // PASIVO
        Row("220505", "Proveedores nacionales", "PASIVO", "C", None, true, false, false, false, None),
        Row("236540", "Retención en la fuente", "PASIVO", "C", None, false, false, false, false, None),
        Row("236705", "Retención de IVA", "PASIVO", "C", None, false, false, false, false, None),
        Row("236801", "Retención de ICA", "PASIVO", "C", None, false, false, false, false, None),
        Row("250505", "Salarios y prestaciones por pagar", "PASIVO", "C", None, true, false, false, false, None),
        Row("280505", "Anticipos de copropietarios", "PASIVO", "C", None, true, true, false, false, None),
        Row("281510", "Fondo de imprevistos - Ley 675", "PASIVO", "C", None, false, false, false, false, Some("Mínimo 1% de las expensas comunes.")),
        // PATRIMONIO
        Row("310505", "Fondo social", "PATRIMONIO", "C", None, false, false, false, false, None),
        Row("330505", "Reservas estatutarias", "PATRIMONIO", "C", None, false, false, false, false, None),
        Row("360505", "Excedente del ejercicio", "PATRIMONIO", "C", None, false, false, false, false, None),
        Row("370505", "Excedentes de ejercicios anteriores", "PATRIMONIO", "C", None, false, false, false, false, None),
        // INGRESOS
        Row("417005", "Cuotas de administración ordinarias", "INGRESO", "C", None, false, true, false, false, None),
        Row("417010", "Cuotas extraordinarias", "INGRESO", "C", None, false, true, false, false, None),
        Row("417015", "Multas y sanciones", "INGRESO", "C", None, false, true, false, false, None),
        Row("417020", "Reservas de zonas comunes", "INGRESO", "C", None, false, true, false, false, None),
        Row("417025", "Parqueaderos y depósitos", "INGRESO", "C", None, false, true, false, false, None),
        Row("417030", "Intereses de mora", "INGRESO", "C", None, false, true, false, false, None),
        Row("417035", "Descuento por pronto pago", "INGRESO", "D", None, false, false, false, false, Some("Cuenta contra-ingreso.")),
        Row("417040", "Recuperación de deterioro de cartera", "INGRESO", "C", None, false, false, false, false, None),
        // GASTOS
        Row("510506", "Sueldos y salarios", "GASTO", "D", Some("ADM"), false, false, false, false, None),
        Row("510530", "Cesantías", "GASTO", "D", Some("ADM"), false, false, false, false, None),
        Row("510536", "Intereses sobre cesantías", "GASTO", "D", Some("ADM"), false, false, false, false, None),
        Row("510539", "Prima de servicios", "GASTO", "D", Some("ADM"), false, false, false, false, None),
        Row("510542", "Vacaciones", "GASTO", "D", Some("ADM"), false, false, false, false, None),
        Row("510548", "Aportes a seguridad social", "GASTO", "D", Some("ADM"), false, false, false, false, None),
        Row("510551", "Aportes parafiscales", "GASTO", "D", Some("ADM"), false, false, false, false, None),
        Row("511005", "Honorarios", "GASTO", "D", Some("HON"), false, false, false, false, None),
        Row("512010", "Arrendamientos", "GASTO", "D", Some("ADM"), false, false, false, false, None),
        Row("513010", "Seguros", "GASTO", "D", Some("SEG"), false, false, false, false, None),
        Row("513505", "Vigilancia y seguridad", "GASTO", "D", Some("VIG"), false, false, false, false, None),
        Row("513510", "Aseo y cafetería", "GASTO", "D", Some("ASE"), false, false, false, false, None),
        Row("513525", "Energía eléctrica", "GASTO", "D", Some("SPU"), false, false, false, false, None),
        Row("513530", "Acueducto y alcantarillado", "GASTO", "D", Some("SPU"), false, false, false, false, None),
        Row("513535", "Gas natural", "GASTO", "D", Some("SPU"), false, false, false, false, None),
        Row("513540", "Internet y telecomunicaciones", "GASTO", "D", Some("SPU"), false, false, false, false, None),
        Row("514505", "Mantenimiento de ascensores", "GASTO", "D", Some("ASC"), false, false, false, false, None),
        Row("514510", "Mantenimiento de zonas comunes", "GASTO", "D", Some("MAN"), false, false, false, false, None),
        Row("514515", "Jardinería", "GASTO", "D", Some("MAN"), false, false, false, false, None),
        Row("516005", "Depreciación de PP&E", "GASTO", "D", Some("MAN"), false, false, false, false, None),
        Row("519505", "Gastos bancarios", "GASTO", "D", Some("FIN"), false, false, false, false, None),
        Row("519510", "Gastos legales y notariales", "GASTO", "D", Some("ASM"), false, false, false, false, None),
        Row("519520", "Gastos de asamblea", "GASTO", "D", Some("ASM"), false, false, false, false, None),
        Row("519530", "Elementos de aseo y cafetería", "GASTO", "D", Some("ASE"), false, false, false, false, None),
        Row("519905", "Deterioro de cartera", "GASTO", "D", Some("FIN"), false, false, false, false, None),
        Row("530520", "Intereses financieros", "GASTO", "D", Some("FIN"), false, false, false, false, None),
        Row("540505", "Impuesto de industria y comercio", "GASTO", "D", Some("FIN"), false, false, false, false, None),
        Row("540525", "Gravamen a los movimientos financieros", "GASTO", "D", Some("FIN"), false, false, false, false, None),
    ];
    rows.into_iter()
        .map(|r| LedgerAccount {
            code: r.0.into(),
            name: r.1.into(),
            account_type: r.2.into(),
            nature: r.3.into(),
            rubric_key: r.4.map(Into::into),
            requires_third_party: r.5,
            requires_unit: r.6,
            is_cash: r.7,
            restricted: r.8,
            note: r.9.map(Into::into),
        })
        .collect()
}

fn dec(v: &str) -> Decimal {
    v.parse().expect("valid decimal literal")
}

fn demo_third_parties() -> Vec<ThirdParty> {
    vec![
        ThirdParty {
            id: "prov-atlas".into(),
            name: "Seguridad Atlas S.A.S.".into(),
            nit: "900.412.887-3".into(),
            retefuente_pct: dec("4"),
            reteica_pct: dec("0.966"),
            reteiva_pct: dec("15"),
        },
        ThirdParty {
            id: "prov-limpieza".into(),
            name: "Limpieza Total S.A.S.".into(),
            nit: "901.223.456-7".into(),
            retefuente_pct: dec("4"),
            reteica_pct: dec("0.966"),
            reteiva_pct: dec("15"),
        },
        ThirdParty {
            id: "prov-enel".into(),
            name: "Enel Colombia S.A. ESP".into(),
            nit: "860.007.211-6".into(),
            retefuente_pct: Decimal::ZERO,
            reteica_pct: Decimal::ZERO,
            reteiva_pct: Decimal::ZERO,
        },
        ThirdParty {
            id: "prov-eaab".into(),
            name: "EAAB Esp".into(),
            nit: "899.999.094-4".into(),
            retefuente_pct: Decimal::ZERO,
            reteica_pct: dec("0.966"),
            reteiva_pct: Decimal::ZERO,
        },
        ThirdParty {
            id: "prov-elevadores".into(),
            name: "Elevadores Andinos Ltda.".into(),
            nit: "830.112.554-1".into(),
            retefuente_pct: dec("4"),
            reteica_pct: dec("0.966"),
            reteiva_pct: dec("15"),
        },
        ThirdParty {
            id: "prov-seguros".into(),
            name: "Aseguradora del Norte S.A.".into(),
            nit: "890.903.937-8".into(),
            retefuente_pct: dec("4"),
            reteica_pct: dec("0.966"),
            reteiva_pct: dec("15"),
        },
        ThirdParty {
            id: "prov-jardineria".into(),
            name: "José Rodríguez — Jardinero".into(),
            nit: "8.012.447".into(),
            retefuente_pct: dec("4"),
            reteica_pct: Decimal::ZERO,
            reteiva_pct: Decimal::ZERO,
        },
        ThirdParty {
            id: "prov-contador".into(),
            name: "Carlos Andrés Mejía — Contador".into(),
            nit: "1.020.304.556".into(),
            retefuente_pct: dec("11"),
            reteica_pct: dec("0.966"),
            reteiva_pct: Decimal::ZERO,
        },
        ThirdParty {
            id: "prov-revisoria".into(),
            name: "Marta Lucía Peña — Revisora Fiscal".into(),
            nit: "52.334.887".into(),
            retefuente_pct: dec("11"),
            reteica_pct: dec("0.966"),
            reteiva_pct: Decimal::ZERO,
        },
        ThirdParty {
            id: "prov-banco".into(),
            name: "Banco de Bogotá".into(),
            nit: "860.002.222-5".into(),
            retefuente_pct: Decimal::ZERO,
            reteica_pct: Decimal::ZERO,
            reteiva_pct: Decimal::ZERO,
        },
    ]
}

fn json_decimal(val: Option<&serde_json::Value>) -> Decimal {
    let Some(v) = val else {
        return Decimal::ZERO;
    };
    if let Some(s) = v.as_str() {
        return s.parse().unwrap_or(Decimal::ZERO);
    }
    serde_json::from_value(v.clone()).unwrap_or(Decimal::ZERO)
}

/// Extrae los terceros desde `seed["datos"]["terceros"]`, con respaldo al catálogo demo.
pub fn third_parties_from_seed(seed: &serde_json::Value) -> Vec<ThirdParty> {
    let Some(arr) = seed
        .get("datos")
        .and_then(|d| d.get("terceros"))
        .and_then(|t| t.as_array())
    else {
        return demo_third_parties();
    };

    let parsed: Vec<ThirdParty> = arr
        .iter()
        .filter_map(|item| {
            let id = item.get("id")?.as_str()?.to_string();
            let name = item.get("nombre")?.as_str()?.to_string();
            let doc = item.get("documento").and_then(|v| v.as_str()).unwrap_or("");
            let dv = item.get("dv").and_then(|v| v.as_str()).filter(|s| !s.is_empty());
            let nit = match dv {
                Some(d) => format!("{doc}-{d}"),
                None => doc.to_string(),
            };
            Some(ThirdParty {
                id,
                name,
                nit,
                retefuente_pct: json_decimal(item.get("retefuentePct")),
                reteica_pct: json_decimal(item.get("reteicaPct")),
                reteiva_pct: json_decimal(item.get("reteivaPct")),
            })
        })
        .collect();

    if parsed.is_empty() {
        demo_third_parties()
    } else {
        parsed
    }
}
