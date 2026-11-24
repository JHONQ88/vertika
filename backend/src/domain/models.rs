use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrontendCopropiedad {
    pub id: String,
    pub nit: String,
    #[serde(rename = "razonSocial")]
    pub razon_social: String,
    #[serde(rename = "nombreCorto")]
    pub nombre_corto: String,
    pub sigla: String,
    pub ciudad: String,
    pub direccion: String,
    #[serde(rename = "grupoNiif")]
    pub grupo_niif: i16,
    #[serde(rename = "fondoImprevistosPct")]
    pub fondo_imprevistos_pct: Decimal,
    #[serde(rename = "tasaMoraMensual")]
    pub tasa_mora_mensual: Decimal,
    #[serde(rename = "diaCorteProntoPago")]
    pub dia_corte_pronto_pago: i16,
    #[serde(rename = "descuentoProntoPagoPct")]
    pub descuento_pronto_pago_pct: Decimal,
    #[serde(rename = "llaveBreB")]
    pub llave_bre_b: String,
    #[serde(rename = "presupuestoAnual")]
    pub presupuesto_anual: Decimal,
    #[serde(rename = "periodoActual")]
    pub periodo_actual: String,
    #[serde(rename = "saldosIniciales")]
    pub saldos_iniciales: HashMap<String, Decimal>,
    pub escala: Decimal,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrontendUnidad {
    pub id: String,
    #[serde(rename = "empresaId")]
    pub empresa_id: String,
    pub torre: String,
    pub numero: String,
    pub tipo: String,
    pub area: Decimal,
    pub coeficiente: Decimal,
    pub matricula: String,
    #[serde(rename = "propietarioId")]
    pub propietario_id: String,
    #[serde(rename = "arrendatarioId", default, skip_serializing_if = "Option::is_none")]
    pub arrendatario_id: Option<String>,
    #[serde(rename = "carteraCongelada")]
    pub cartera_congelada: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrontendTercero {
    pub id: String,
    #[serde(rename = "empresaId", default, skip_serializing_if = "Option::is_none")]
    pub empresa_id: Option<String>,
    pub nombre: String,
    pub tipo: String,
    pub documento: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dv: Option<String>,
    pub email: String,
    pub telefono: String,
    pub ciudad: String,
    #[serde(rename = "retefuentePct")]
    pub retefuente_pct: Decimal,
    #[serde(rename = "reteicaPct")]
    pub reteica_pct: Decimal,
    #[serde(rename = "reteivaPct")]
    pub reteiva_pct: Decimal,
    #[serde(rename = "noObligado", default)]
    pub no_obligado: bool,
    #[serde(rename = "regimenEspecial", default, skip_serializing_if = "Option::is_none")]
    pub regimen_especial: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrontendRubro {
    pub id: String,
    #[serde(rename = "empresaId")]
    pub empresa_id: String,
    pub key: String,
    pub nombre: String,
    pub centro: String,
    #[serde(rename = "presupuestoAnual")]
    pub presupuesto_anual: Decimal,
    pub cuenta: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrontendLinea {
    #[serde(default)]
    pub id: String,
    #[serde(alias = "account")]
    pub cuenta: String,
    #[serde(alias = "description", default)]
    pub descripcion: String,
    #[serde(alias = "debit", default)]
    pub debito: Decimal,
    #[serde(alias = "credit", default)]
    pub credito: Decimal,
    #[serde(
        rename = "terceroId",
        alias = "third_party_id",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub tercero_id: Option<String>,
    #[serde(
        rename = "unidadId",
        alias = "unit_id",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub unidad_id: Option<String>,
    #[serde(
        rename = "rubroId",
        alias = "rubric_id",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub rubro_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrontendComprobante {
    pub id: String,
    #[serde(rename = "empresaId")]
    pub empresa_id: String,
    pub periodo: String,
    pub tipo: String,
    pub consecutivo: i64,
    pub fecha: String,
    pub estado: String,
    pub origen: String,
    pub descripcion: String,
    pub lineas: Vec<FrontendLinea>,
    #[serde(rename = "totalDebito")]
    pub total_debito: Decimal,
    #[serde(rename = "totalCredito")]
    pub total_credito: Decimal,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub referencia: Option<String>,
    pub hash: String,
    #[serde(rename = "creadoPor")]
    pub creado_por: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrontendPreAsiento {
    pub id: String,
    #[serde(rename = "empresaId")]
    pub empresa_id: String,
    pub periodo: String,
    pub tipo: String,
    pub fecha: String,
    pub agente: String,
    pub confianza: Decimal,
    #[serde(rename = "terceroId")]
    pub tercero_id: String,
    #[serde(rename = "unidadId", default, skip_serializing_if = "Option::is_none")]
    pub unidad_id: Option<String>,
    #[serde(rename = "rubroId", default, skip_serializing_if = "Option::is_none")]
    pub rubro_id: Option<String>,
    pub descripcion: String,
    pub documento: Value,
    pub lineas: Vec<FrontendLinea>,
    pub estado: String,
    pub notas: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrontendAuditoria {
    pub id: String,
    pub ts: String,
    pub actor: String,
    pub accion: String,
    pub detalle: String,
    #[serde(rename = "empresaId")]
    pub empresa_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BootstrapDatos {
    pub companies: Vec<FrontendCopropiedad>,
    pub units: Vec<FrontendUnidad>,
    pub terceros: Vec<FrontendTercero>,
    pub rubros: Vec<FrontendRubro>,
    pub comprobantes: Vec<FrontendComprobante>,
    #[serde(rename = "preAsientos")]
    pub pre_asientos: Vec<FrontendPreAsiento>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrontendEstadoApp {
    pub version: i32,
    #[serde(rename = "activeCompanyId")]
    pub active_company_id: String,
    pub periodo: String,
    #[serde(rename = "preAsientos")]
    pub pre_asientos: Vec<FrontendPreAsiento>,
    pub comprobantes: Vec<FrontendComprobante>,
    #[serde(rename = "periodosCerrados")]
    pub periodos_cerrados: HashMap<String, Vec<String>>,
    pub auditoria: Vec<FrontendAuditoria>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdatePreEntryLinesRequest {
    pub lineas: Vec<FrontendLinea>,
}

fn default_tipo_cc() -> String {
    "CC".into()
}

fn default_agent_eve() -> String {
    "AGENTE_IA_EVE".into()
}

fn default_confianza() -> Decimal {
    Decimal::from(92)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePreEntryRequest {
    #[serde(rename = "companyId", alias = "company_id", alias = "empresaId")]
    pub company_id: String,
    #[serde(alias = "periodo")]
    pub period: String,
    #[serde(
        rename = "entryType",
        alias = "entry_type",
        alias = "tipo",
        default = "default_tipo_cc"
    )]
    pub entry_type: String,
    #[serde(alias = "fecha")]
    pub date: String,
    #[serde(alias = "agente", default = "default_agent_eve")]
    pub agent: String,
    #[serde(default = "default_confianza")]
    pub confianza: Decimal,
    #[serde(rename = "terceroId", alias = "third_party_id")]
    pub tercero_id: String,
    #[serde(rename = "unidadId", alias = "unit_id", default)]
    pub unidad_id: Option<String>,
    #[serde(rename = "rubroId", alias = "rubric_id", default)]
    pub rubro_id: Option<String>,
    #[serde(alias = "descripcion")]
    pub description: String,
    #[serde(alias = "documento", default)]
    pub document: Option<Value>,
    #[serde(alias = "lineas")]
    pub lines: Vec<FrontendLinea>,
    #[serde(alias = "notas", default)]
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePreEntryResult {
    #[serde(rename = "preAsiento")]
    pub pre_asiento: FrontendPreAsiento,
    pub auditoria: FrontendAuditoria,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateEntryRequest {
    #[serde(rename = "companyId", alias = "company_id")]
    pub company_id: String,
    #[serde(alias = "periodo")]
    pub period: String,
    #[serde(rename = "entryType", alias = "entry_type", alias = "tipo")]
    pub entry_type: String,
    #[serde(alias = "fecha")]
    pub date: String,
    #[serde(alias = "descripcion")]
    pub description: String,
    #[serde(alias = "referencia", default)]
    pub reference: Option<String>,
    #[serde(alias = "origen", default)]
    pub origin: Option<String>,
    #[serde(alias = "lineas")]
    pub lines: Vec<FrontendLinea>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct VoidEntryRequest {
    #[serde(default)]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClosePeriodRequest {
    #[serde(default = "default_true")]
    pub depreciacion: bool,
    #[serde(default = "default_true")]
    pub provision: bool,
    #[serde(default = "default_true")]
    pub traslado: bool,
}

impl Default for ClosePeriodRequest {
    fn default() -> Self {
        Self {
            depreciacion: true,
            provision: true,
            traslado: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApproveResult {
    pub comprobante: FrontendComprobante,
    pub auditoria: FrontendAuditoria,
    #[serde(rename = "preAsientoId")]
    pub pre_asiento_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostEntryResult {
    pub comprobante: FrontendComprobante,
    pub auditoria: FrontendAuditoria,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoidEntryResult {
    pub anulado: FrontendComprobante,
    pub reverso: FrontendComprobante,
    pub auditoria: FrontendAuditoria,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClosePeriodResult {
    pub comprobante: FrontendComprobante,
    #[serde(rename = "periodoCerrado")]
    pub periodo_cerrado: String,
    pub auditoria: FrontendAuditoria,
}

fn default_apt() -> String {
    "APARTAMENTO".into()
}

fn default_prov() -> String {
    "PROVEEDOR".into()
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct BillPeriodRequest {
    #[serde(rename = "incluirMora", alias = "incluir_mora", default)]
    pub incluir_mora: bool,
    #[serde(default)]
    pub descripcion: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BillPeriodResult {
    pub comprobante: FrontendComprobante,
    pub auditoria: FrontendAuditoria,
    #[serde(rename = "unidadesFacturadas")]
    pub unidades_facturadas: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenNextPeriodResult {
    #[serde(rename = "empresaId")]
    pub empresa_id: String,
    #[serde(rename = "periodoAnterior")]
    pub periodo_anterior: String,
    #[serde(rename = "periodoNuevo")]
    pub periodo_nuevo: String,
    pub auditoria: FrontendAuditoria,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpsertUnitRequest {
    pub torre: String,
    pub numero: String,
    #[serde(default = "default_apt")]
    pub tipo: String,
    #[serde(default)]
    pub area: Decimal,
    pub coeficiente: Decimal,
    #[serde(default)]
    pub matricula: String,
    #[serde(rename = "propietarioId", alias = "propietario_id")]
    pub propietario_id: String,
    #[serde(rename = "arrendatarioId", alias = "arrendatario_id", default)]
    pub arrendatario_id: Option<String>,
    #[serde(rename = "carteraCongelada", alias = "cartera_congelada", default)]
    pub cartera_congelada: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpsertThirdPartyRequest {
    pub nombre: String,
    #[serde(default = "default_prov")]
    pub tipo: String,
    pub documento: String,
    #[serde(default)]
    pub dv: Option<String>,
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub telefono: String,
    #[serde(default)]
    pub ciudad: String,
    #[serde(rename = "retefuentePct", alias = "retefuente_pct", default)]
    pub retefuente_pct: Decimal,
    #[serde(rename = "reteicaPct", alias = "reteica_pct", default)]
    pub reteica_pct: Decimal,
    #[serde(rename = "reteivaPct", alias = "reteiva_pct", default)]
    pub reteiva_pct: Decimal,
    #[serde(rename = "noObligado", alias = "no_obligado", default)]
    pub no_obligado: bool,
    #[serde(rename = "regimenEspecial", alias = "regimen_especial", default)]
    pub regimen_especial: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePucAccountRequest {
    #[serde(alias = "code")]
    pub codigo: String,
    #[serde(alias = "name")]
    pub nombre: String,
    #[serde(alias = "account_type")]
    pub tipo: String,
    #[serde(alias = "nature")]
    pub naturaleza: String,
    #[serde(rename = "rubroKey", alias = "rubro_key", default)]
    pub rubro_key: Option<String>,
    #[serde(rename = "requiereTercero", alias = "requiere_tercero", default)]
    pub requiere_tercero: bool,
    #[serde(rename = "requiereUnidad", alias = "requiere_unidad", default)]
    pub requiere_unidad: bool,
    #[serde(alias = "note", default)]
    pub nota: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateRubroBudgetRequest {
    #[serde(rename = "presupuestoAnual", alias = "presupuesto_anual")]
    pub presupuesto_anual: Decimal,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct UpdateCompanySettingsRequest {
    #[serde(rename = "razonSocial", alias = "razon_social", default)]
    pub razon_social: Option<String>,
    #[serde(default)]
    pub direccion: Option<String>,
    #[serde(rename = "fondoImprevistosPct", alias = "fondo_imprevistos_pct", default)]
    pub fondo_imprevistos_pct: Option<Decimal>,
    #[serde(rename = "tasaMoraMensual", alias = "tasa_mora_mensual", default)]
    pub tasa_mora_mensual: Option<Decimal>,
    #[serde(rename = "diaCorteProntoPago", alias = "dia_corte_pronto_pago", default)]
    pub dia_corte_pronto_pago: Option<i16>,
    #[serde(rename = "descuentoProntoPagoPct", alias = "descuento_pronto_pago_pct", default)]
    pub descuento_pronto_pago_pct: Option<Decimal>,
    #[serde(rename = "llaveBreB", alias = "llave_bre_b", default)]
    pub llave_bre_b: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCompanyRequest {
    pub nit: String,
    #[serde(alias = "razon_social")]
    pub razon_social: String,
    #[serde(alias = "nombre_corto")]
    pub nombre_corto: String,
    #[serde(default)]
    pub ciudad: Option<String>,
    #[serde(default)]
    pub direccion: Option<String>,
    #[serde(default, alias = "grupo_niif")]
    pub grupo_niif: Option<i16>,
    #[serde(default, alias = "periodo_actual")]
    pub periodo_actual: Option<String>,
    #[serde(default, alias = "presupuesto_anual")]
    pub presupuesto_anual: Option<Decimal>,
    #[serde(default, alias = "fondo_imprevistos_pct")]
    pub fondo_imprevistos_pct: Option<Decimal>,
    #[serde(default, alias = "tasa_mora_mensual")]
    pub tasa_mora_mensual: Option<Decimal>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCompanyResult {
    pub copropiedad: FrontendCopropiedad,
    pub auditoria: FrontendAuditoria,
    pub user: crate::auth::AuthUser,
    pub token: String,
}
