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
        ("110505", "Caja general", "ACTIVO", "D", None),
        ("111005", "Bancos - cuenta recaudadora", "ACTIVO", "D", None),
        ("111010", "Bancos - fondo de imprevistos", "ACTIVO", "D", None),
        ("130505", "Cuotas de administración", "ACTIVO", "D", None),
        ("135515", "IVA descontable", "ACTIVO", "D", None),
        ("139905", "Deterioro de cartera", "ACTIVO", "C", None),
        ("152405", "Muebles y enseres", "ACTIVO", "D", None),
        ("159215", "Depreciación acumulada", "ACTIVO", "C", None),
        ("220505", "Proveedores nacionales", "PASIVO", "C", None),
        ("236540", "Retención en la fuente", "PASIVO", "C", None),
        ("236705", "Retención de IVA", "PASIVO", "C", None),
        ("236801", "Retención de ICA", "PASIVO", "C", None),
        ("281510", "Fondo de imprevistos Ley 675", "PASIVO", "C", None),
        ("310505", "Aportes sociales", "PATRIMONIO", "C", None),
        ("330505", "Excedentes del ejercicio", "PATRIMONIO", "C", None),
        ("370505", "Excedentes por aplicar", "PATRIMONIO", "C", None),
        ("417005", "Cuotas de administración ordinarias", "INGRESO", "C", None),
        ("417035", "Descuentos por pronto pago", "INGRESO", "D", None),
        ("510506", "Sueldos de personal", "GASTO", "D", Some("ADM")),
        ("513505", "Vigilancia y seguridad", "GASTO", "D", Some("VIG")),
        ("513510", "Aseo y cafetería", "GASTO", "D", Some("ASE")),
        ("513525", "Acueducto y alcantarillado", "GASTO", "D", Some("SER")),
        ("513530", "Energía eléctrica", "GASTO", "D", Some("SER")),
        ("514515", "Mantenimiento de ascensores", "GASTO", "D", Some("MAN")),
        ("516005", "Depreciación de propiedad, planta y equipo", "GASTO", "D", Some("MAN")),
        ("519905", "Provisión deterioro de cartera", "GASTO", "D", Some("FIN")),
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
            id: "prov-elevadores".into(),
            name: "Elevadores Andinos S.A.".into(),
            nit: "800.556.221-1".into(),
            retefuente_pct: 4.0,
            reteica_pct: 0.966,
            reteiva_pct: 15.0,
        },
    ]
}
