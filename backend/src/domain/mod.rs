pub mod ledger;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LedgerAccount {
    pub code: String,
    pub name: String,
    pub account_type: String, // ACTIVO|PASIVO|PATRIMONIO|INGRESO|GASTO
    pub nature: String,       // D|C
    pub rubric_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThirdParty {
    pub id: String,
    pub name: String,
    pub nit: String,
    pub retefuente_pct: f64,
    pub reteica_pct: f64,
    pub reteiva_pct: f64,
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
    pub opening_balances: std::collections::HashMap<String, f64>,
    /// Movimientos ya asentados a considerar.
    #[serde(default)]
    pub entries: Vec<ledger::EntryDraft>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationResult {
    pub ok: bool,
    pub total_debit: f64,
    pub total_credit: f64,
    pub difference: f64,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct AppState {
    pub mode: String,
    pub puc: Vec<LedgerAccount>,
    pub third_parties: Vec<ThirdParty>,
}

impl AppState {
    pub fn demo() -> Self {
        Self {
            mode: "demo-memory".into(),
            puc: demo_puc(),
            third_parties: demo_third_parties(),
        }
    }
}

fn demo_puc() -> Vec<LedgerAccount> {
    let rows: Vec<(&str, &str, &str, &str, Option<&str>)> = vec![
        // ACTIVO
        ("110505", "Caja general", "ACTIVO", "D", None),
        ("111005", "Bancos - cuenta recaudadora", "ACTIVO", "D", None),
        ("111010", "Bancos - Fondo de imprevistos", "ACTIVO", "D", None),
        ("130505", "CxC expensas ordinarias", "ACTIVO", "D", None),
        ("130510", "CxC expensas extraordinarias", "ACTIVO", "D", None),
        ("130515", "CxC intereses de mora", "ACTIVO", "D", None),
        ("130520", "CxC multas y sanciones", "ACTIVO", "D", None),
        ("135515", "IVA descontable", "ACTIVO", "D", None),
        ("139905", "Deterioro de cartera", "ACTIVO", "C", None),
        ("152405", "Construcciones y edificaciones", "ACTIVO", "D", None),
        ("152805", "Equipo de cómputo y comunicaciones", "ACTIVO", "D", None),
        ("159215", "Depreciación acumulada", "ACTIVO", "C", None),
        // PASIVO
        ("220505", "Proveedores nacionales", "PASIVO", "C", None),
        ("236540", "Retención en la fuente", "PASIVO", "C", None),
        ("236705", "Retención de IVA", "PASIVO", "C", None),
        ("236801", "Retención de ICA", "PASIVO", "C", None),
        ("250505", "Salarios y prestaciones por pagar", "PASIVO", "C", None),
        ("280505", "Anticipos de copropietarios", "PASIVO", "C", None),
        ("281510", "Fondo de imprevistos - Ley 675", "PASIVO", "C", None),
        // PATRIMONIO
        ("310505", "Fondo social", "PATRIMONIO", "C", None),
        ("330505", "Reservas estatutarias", "PATRIMONIO", "C", None),
        ("360505", "Excedente del ejercicio", "PATRIMONIO", "C", None),
        ("370505", "Excedentes de ejercicios anteriores", "PATRIMONIO", "C", None),
        // INGRESOS
        ("417005", "Cuotas de administración ordinarias", "INGRESO", "C", None),
        ("417010", "Cuotas extraordinarias", "INGRESO", "C", None),
        ("417015", "Multas y sanciones", "INGRESO", "C", None),
        ("417020", "Reservas de zonas comunes", "INGRESO", "C", None),
        ("417025", "Parqueaderos y depósitos", "INGRESO", "C", None),
        ("417030", "Intereses de mora", "INGRESO", "C", None),
        ("417035", "Descuento por pronto pago", "INGRESO", "D", None),
        ("417040", "Recuperación de deterioro de cartera", "INGRESO", "C", None),
        // GASTOS
        ("510506", "Sueldos y salarios", "GASTO", "D", Some("ADM")),
        ("510530", "Cesantías", "GASTO", "D", Some("ADM")),
        ("510536", "Intereses sobre cesantías", "GASTO", "D", Some("ADM")),
        ("510539", "Prima de servicios", "GASTO", "D", Some("ADM")),
        ("510542", "Vacaciones", "GASTO", "D", Some("ADM")),
        ("510548", "Aportes a seguridad social", "GASTO", "D", Some("ADM")),
        ("510551", "Aportes parafiscales", "GASTO", "D", Some("ADM")),
        ("511005", "Honorarios", "GASTO", "D", Some("HON")),
        ("512010", "Arrendamientos", "GASTO", "D", Some("ADM")),
        ("513010", "Seguros", "GASTO", "D", Some("SEG")),
        ("513505", "Vigilancia y seguridad", "GASTO", "D", Some("VIG")),
        ("513510", "Aseo y cafetería", "GASTO", "D", Some("ASE")),
        ("513525", "Energía eléctrica", "GASTO", "D", Some("SPU")),
        ("513530", "Acueducto y alcantarillado", "GASTO", "D", Some("SPU")),
        ("513535", "Gas natural", "GASTO", "D", Some("SPU")),
        ("513540", "Internet y telecomunicaciones", "GASTO", "D", Some("SPU")),
        ("514505", "Mantenimiento de ascensores", "GASTO", "D", Some("ASC")),
        ("514510", "Mantenimiento de zonas comunes", "GASTO", "D", Some("MAN")),
        ("514515", "Jardinería", "GASTO", "D", Some("MAN")),
        ("516005", "Depreciación de PP&E", "GASTO", "D", Some("MAN")),
        ("519505", "Gastos bancarios", "GASTO", "D", Some("FIN")),
        ("519510", "Gastos legales y notariales", "GASTO", "D", Some("ASM")),
        ("519520", "Gastos de asamblea", "GASTO", "D", Some("ASM")),
        ("519530", "Elementos de aseo y cafetería", "GASTO", "D", Some("ASE")),
        ("519905", "Deterioro de cartera", "GASTO", "D", Some("FIN")),
        ("530520", "Intereses financieros", "GASTO", "D", Some("FIN")),
        ("540505", "Impuesto de industria y comercio", "GASTO", "D", Some("FIN")),
        ("540525", "Gravamen a los movimientos financieros", "GASTO", "D", Some("FIN")),
    ];
    rows.into_iter()
        .map(|(c, n, t, nat, r)| LedgerAccount {
            code: c.into(),
            name: n.into(),
            account_type: t.into(),
            nature: nat.into(),
            rubric_key: r.map(|x| x.into()),
        })
        .collect()
}

fn demo_third_parties() -> Vec<ThirdParty> {
    vec![
        ThirdParty {
            id: "prov-atlas".into(),
            name: "Seguridad Atlas S.A.S.".into(),
            nit: "900.412.887-3".into(),
            retefuente_pct: 4.0,
            reteica_pct: 0.966,
            reteiva_pct: 15.0,
        },
        ThirdParty {
            id: "prov-limpieza".into(),
            name: "Limpieza Total S.A.S.".into(),
            nit: "901.223.456-7".into(),
            retefuente_pct: 4.0,
            reteica_pct: 0.966,
            reteiva_pct: 15.0,
        },
        ThirdParty {
            id: "prov-enel".into(),
            name: "Enel Colombia S.A. ESP".into(),
            nit: "860.007.211-6".into(),
            retefuente_pct: 0.0,
            reteica_pct: 0.0,
            reteiva_pct: 0.0,
        },
        ThirdParty {
            id: "prov-eaab".into(),
            name: "EAAB Esp".into(),
            nit: "899.999.094-4".into(),
            retefuente_pct: 0.0,
            reteica_pct: 0.966,
            reteiva_pct: 0.0,
        },
        ThirdParty {
            id: "prov-elevadores".into(),
            name: "Elevadores Andinos Ltda.".into(),
            nit: "830.112.554-1".into(),
            retefuente_pct: 4.0,
            reteica_pct: 0.966,
            reteiva_pct: 15.0,
        },
        ThirdParty {
            id: "prov-seguros".into(),
            name: "Aseguradora del Norte S.A.".into(),
            nit: "890.903.937-8".into(),
            retefuente_pct: 4.0,
            reteica_pct: 0.966,
            reteiva_pct: 15.0,
        },
        ThirdParty {
            id: "prov-jardineria".into(),
            name: "José Rodríguez — Jardinero".into(),
            nit: "8.012.447".into(),
            retefuente_pct: 4.0,
            reteica_pct: 0.0,
            reteiva_pct: 0.0,
        },
        ThirdParty {
            id: "prov-contador".into(),
            name: "Carlos Andrés Mejía — Contador".into(),
            nit: "1.020.304.556".into(),
            retefuente_pct: 11.0,
            reteica_pct: 0.966,
            reteiva_pct: 0.0,
        },
        ThirdParty {
            id: "prov-revisoria".into(),
            name: "Marta Lucía Peña — Revisora Fiscal".into(),
            nit: "52.334.887".into(),
            retefuente_pct: 11.0,
            reteica_pct: 0.966,
            reteiva_pct: 0.0,
        },
        ThirdParty {
            id: "prov-banco".into(),
            name: "Banco de Bogotá".into(),
            nit: "860.002.222-5".into(),
            retefuente_pct: 0.0,
            reteica_pct: 0.0,
            reteiva_pct: 0.0,
        },
    ]
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
                retefuente_pct: item.get("retefuentePct").and_then(|v| v.as_f64()).unwrap_or(0.0),
                reteica_pct: item.get("reteicaPct").and_then(|v| v.as_f64()).unwrap_or(0.0),
                reteiva_pct: item.get("reteivaPct").and_then(|v| v.as_f64()).unwrap_or(0.0),
            })
        })
        .collect();

    if parsed.is_empty() {
        demo_third_parties()
    } else {
        parsed
    }
}
