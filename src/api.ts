import type {
  Comprobante,
  Copropiedad,
  Documento,
  EstadoApp,
  EventoAuditoria,
  Linea,
  PreAsiento,
  Rubro,
  Tercero,
  Unidad,
} from './domain/types';

export const API_URL: string = (import.meta as any).env?.VITE_API_URL || '';
export const apiEnabled = !!API_URL;
export const DEMO_MODE_ENABLED: boolean =
  (import.meta as any).env?.VITE_DEMO_MODE === 'true' || !apiEnabled;

export type UserRole =
  | 'SUPER_ADMIN'
  | 'CONTADOR'
  | 'ADMINISTRADOR'
  | 'REVISOR_FISCAL'
  | 'CONSEJO';

export interface AuthUser {
  id: string;
  email: string;
  nombre: string;
  rol: UserRole;
  roles?: Array<{ company_id: string; role: UserRole }>;
  isSuperAdmin?: boolean;
  maxCopropiedades?: number;
  planNombre?: string;
  expiresAt?: string | null;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}

const TOKEN_KEY = 'vertika.token.v1';

function isJwtExpired(token: string): boolean {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return true;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=');
    const payload = JSON.parse(atob(padded)) as { exp?: number };
    return typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now();
  } catch {
    return false;
  }
}

export function getAuthToken(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    if (isJwtExpired(raw)) {
      localStorage.removeItem(TOKEN_KEY);
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

export function setAuthToken(token: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage no disponible
  }
}

export interface BootstrapPayload {
  datos: any;
  estado: EstadoApp;
  mode?: 'demo-memory' | 'postgres' | string;
}

export interface ApproveResponse {
  comprobante: Comprobante;
  auditoria: EventoAuditoria;
  preAsientoId: string;
}

export interface RejectResponse {
  ok: boolean;
  auditoria: EventoAuditoria;
}

export interface VoidResponse {
  anulado: Comprobante;
  reverso: Comprobante;
  auditoria: EventoAuditoria;
}

export interface ClosePeriodResponse {
  comprobante: Comprobante;
  periodoCerrado: string;
  auditoria: EventoAuditoria;
}

export interface CreateEntryPayload {
  companyId: string;
  period: string;
  entryType: string;
  date: string;
  description: string;
  reference?: string;
  origin?: string;
  lines: Linea[];
}

export interface CreateEntryResponse {
  comprobante: Comprobante;
  auditoria: EventoAuditoria;
}

export interface BillPeriodResponse {
  comprobante: Comprobante;
  auditoria: EventoAuditoria;
  unidadesFacturadas: number;
}

export interface OpenNextPeriodResponse {
  empresaId: string;
  periodoAnterior: string;
  periodoNuevo: string;
  auditoria: EventoAuditoria;
}

export interface UpsertUnitPayload {
  torre: string;
  numero: string;
  tipo: 'APARTAMENTO' | 'CASA' | 'LOCAL';
  area: number;
  coeficiente: number;
  matricula: string;
  propietarioId: string;
  arrendatarioId?: string;
  carteraCongelada: boolean;
}

export interface UpsertThirdPartyPayload {
  nombre: string;
  tipo: Tercero['tipo'];
  documento: string;
  dv?: string;
  email: string;
  telefono: string;
  ciudad: string;
  retefuentePct: number;
  reteicaPct: number;
  reteivaPct: number;
  noObligado: boolean;
  regimenEspecial?: boolean;
}

export interface CreatePucPayload {
  codigo: string;
  nombre: string;
  tipo: 'ACTIVO' | 'PASIVO' | 'PATRIMONIO' | 'INGRESO' | 'GASTO';
  naturaleza: 'D' | 'C';
  rubroKey?: string;
  requiereTercero?: boolean;
  requiereUnidad?: boolean;
  nota?: string;
}

export interface BackendLedgerAccount {
  code: string;
  name: string;
  account_type: 'ACTIVO' | 'PASIVO' | 'PATRIMONIO' | 'INGRESO' | 'GASTO';
  nature: 'D' | 'C';
  rubric_key?: string | null;
  requires_third_party?: boolean;
  requires_unit?: boolean;
  is_cash?: boolean;
  restricted?: boolean;
  note?: string | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAuthToken();
  const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...authHeaders, ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    if (res.status === 401 && token && !path.startsWith('/api/v1/auth/login')) {
      setAuthToken(null);
    }
    const text = await res.text().catch(() => '');
    let msg = text;
    if (text) {
      try {
        const parsed = JSON.parse(text) as { error?: string; message?: string };
        msg = parsed.error || parsed.message || text;
      } catch {
        // Texto plano
      }
    }
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function loginApi(email: string, password: string): Promise<LoginResponse> {
  return request<LoginResponse>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function meApi(): Promise<{ user: AuthUser }> {
  return request<{ user: AuthUser }>('/api/v1/auth/me');
}

export async function changePasswordApi(
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/api/v1/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export interface CreateUserPayload {
  email: string;
  nombre: string;
  password: string;
  rol: UserRole;
  companyIds?: string[];
}

export async function createUserApi(payload: CreateUserPayload): Promise<{ user: AuthUser }> {
  return request<{ user: AuthUser }>('/api/v1/auth/users', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export interface CreateCompanyPayload {
  nit: string;
  razonSocial: string;
  nombreCorto: string;
  ciudad?: string;
  direccion?: string;
  grupoNiif?: number;
  periodoActual?: string;
  presupuestoAnual?: number;
  fondoImprevistosPct?: number;
  tasaMoraMensual?: number;
}

export interface CreateCompanyResponse {
  copropiedad: Copropiedad;
  auditoria: EventoAuditoria;
  user: AuthUser;
  token: string;
}

export async function createCompanyApi(
  payload: CreateCompanyPayload,
): Promise<CreateCompanyResponse> {
  return request<CreateCompanyResponse>('/api/v1/companies', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export interface AdminCompanyBrief {
  id: string;
  nit: string;
  nombreCorto: string;
  razonSocial: string;
  periodoActual: string;
}

export interface AdminContadorItem {
  id: string;
  email: string;
  nombre: string;
  activo: boolean;
  planNombre: string;
  maxCopropiedades: number;
  copropiedadesUsadas: number;
  usuariosCreados: number;
  expiresAt: string | null;
  vencido: boolean;
  createdAt: string;
  copropiedades: AdminCompanyBrief[];
}

export interface AdminOverviewResponse {
  totalContadores: number;
  contadoresActivos: number;
  totalCopropiedades: number;
  pruebasActivas: number;
  cuentasSuspendidasOVencidas: number;
  contadores: AdminContadorItem[];
}

export interface CreateContadorPayload {
  email: string;
  nombre: string;
  password: string;
  planNombre?: string;
  maxCopropiedades?: number;
  diasPrueba?: number;
}

export interface UpdateAdminUserPayload {
  activo?: boolean;
  maxCopropiedades?: number;
  planNombre?: string;
  expiresAt?: string;
  extendDays?: number;
}

export async function fetchAdminOverviewApi(): Promise<AdminOverviewResponse> {
  return request<AdminOverviewResponse>('/api/v1/admin/overview');
}

export async function adminCreateContadorApi(
  payload: CreateContadorPayload,
): Promise<{ user: AuthUser }> {
  return request<{ user: AuthUser }>('/api/v1/admin/contadores', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function adminUpdateUserApi(
  userId: string,
  payload: UpdateAdminUserPayload,
): Promise<{ contador: AdminContadorItem }> {
  return request<{ contador: AdminContadorItem }>(
    `/api/v1/admin/users/${encodeURIComponent(userId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    },
  );
}

export async function fetchBootstrap(): Promise<BootstrapPayload> {
  return request<BootstrapPayload>('/api/v1/bootstrap');
}

export async function fetchPucApi(companyId?: string): Promise<BackendLedgerAccount[]> {
  const qs = companyId ? `?company_id=${encodeURIComponent(companyId)}` : '';
  return request<BackendLedgerAccount[]>(`/api/v1/puc${qs}`);
}

export async function saveState(estado: EstadoApp): Promise<void> {
  if (!apiEnabled) return;
  await request('/api/v1/state', { method: 'PUT', body: JSON.stringify(estado) });
}

export async function resetRemote(): Promise<BootstrapPayload | EstadoApp> {
  return request('/api/v1/reset', { method: 'POST' });
}

export interface CreatePreEntryPayload {
  companyId: string;
  period: string;
  entryType: 'CC' | 'DS' | 'RC' | 'CE' | 'NC';
  date: string;
  agent?: string;
  confianza?: number;
  terceroId: string;
  unidadId?: string;
  rubroId?: string;
  description: string;
  document?: Documento;
  lines: Linea[];
  notes?: string[];
}

export interface CreatePreEntryResponse {
  preAsiento: PreAsiento;
  auditoria: EventoAuditoria;
}

export async function createPreEntryApi(
  payload: CreatePreEntryPayload,
): Promise<CreatePreEntryResponse> {
  return request<CreatePreEntryResponse>('/api/v1/pre-entries', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updatePreEntryLinesApi(id: string, lineas: Linea[]): Promise<PreAsiento> {
  return request<PreAsiento>(`/api/v1/pre-entries/${encodeURIComponent(id)}/lines`, {
    method: 'PUT',
    body: JSON.stringify({ lineas }),
  });
}

export async function approvePreEntryApi(id: string): Promise<ApproveResponse> {
  return request<ApproveResponse>(`/api/v1/pre-entries/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
  });
}

export async function rejectPreEntryApi(id: string): Promise<RejectResponse> {
  return request<RejectResponse>(`/api/v1/pre-entries/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
  });
}

export async function createEntryApi(payload: CreateEntryPayload): Promise<CreateEntryResponse> {
  return request<CreateEntryResponse>('/api/v1/entries', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function voidEntryApi(id: string, reason?: string): Promise<VoidResponse> {
  return request<VoidResponse>(`/api/v1/entries/${encodeURIComponent(id)}/void`, {
    method: 'POST',
    body: JSON.stringify(reason ? { reason } : {}),
  });
}

export async function closePeriodApi(
  companyId: string,
  period: string,
  opts: { depreciacion: boolean; provision: boolean; traslado: boolean },
): Promise<ClosePeriodResponse> {
  return request<ClosePeriodResponse>(
    `/api/v1/companies/${encodeURIComponent(companyId)}/periods/${encodeURIComponent(period)}/close`,
    { method: 'POST', body: JSON.stringify(opts) },
  );
}

export async function billPeriodApi(
  companyId: string,
  period: string,
  incluirMora: boolean,
): Promise<BillPeriodResponse> {
  return request<BillPeriodResponse>(
    `/api/v1/companies/${encodeURIComponent(companyId)}/periods/${encodeURIComponent(period)}/bill`,
    { method: 'POST', body: JSON.stringify({ incluirMora }) },
  );
}

export async function openNextPeriodApi(companyId: string): Promise<OpenNextPeriodResponse> {
  return request<OpenNextPeriodResponse>(
    `/api/v1/companies/${encodeURIComponent(companyId)}/periods/open-next`,
    { method: 'POST' },
  );
}

export async function createUnitApi(companyId: string, payload: UpsertUnitPayload): Promise<Unidad> {
  return request<Unidad>(`/api/v1/companies/${encodeURIComponent(companyId)}/units`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateUnitApi(
  companyId: string,
  unitId: string,
  payload: UpsertUnitPayload,
): Promise<Unidad> {
  return request<Unidad>(
    `/api/v1/companies/${encodeURIComponent(companyId)}/units/${encodeURIComponent(unitId)}`,
    { method: 'PUT', body: JSON.stringify(payload) },
  );
}

export async function createThirdPartyApi(
  companyId: string,
  payload: UpsertThirdPartyPayload,
): Promise<Tercero> {
  return request<Tercero>(`/api/v1/companies/${encodeURIComponent(companyId)}/third-parties`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export interface CopyThirdPartiesResult {
  copiados: number;
  omitidos: number;
  terceros: Tercero[];
}

export async function copyThirdPartiesApi(
  targetCompanyId: string,
  sourceCompanyId: string,
  thirdPartyIds?: string[],
): Promise<CopyThirdPartiesResult> {
  return request<CopyThirdPartiesResult>(
    `/api/v1/companies/${encodeURIComponent(targetCompanyId)}/third-parties/copy-from`,
    {
      method: 'POST',
      body: JSON.stringify({ sourceCompanyId, thirdPartyIds }),
    },
  );
}

export async function updateThirdPartyApi(
  companyId: string,
  tpId: string,
  payload: UpsertThirdPartyPayload,
): Promise<Tercero> {
  return request<Tercero>(
    `/api/v1/companies/${encodeURIComponent(companyId)}/third-parties/${encodeURIComponent(tpId)}`,
    { method: 'PUT', body: JSON.stringify(payload) },
  );
}

export async function createPucAccountApi(
  companyId: string,
  payload: CreatePucPayload,
): Promise<BackendLedgerAccount> {
  return request<BackendLedgerAccount>(`/api/v1/companies/${encodeURIComponent(companyId)}/puc`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateRubroBudgetApi(
  companyId: string,
  rubroId: string,
  presupuestoAnual: number,
): Promise<Rubro> {
  return request<Rubro>(
    `/api/v1/companies/${encodeURIComponent(companyId)}/rubros/${encodeURIComponent(rubroId)}`,
    { method: 'PUT', body: JSON.stringify({ presupuestoAnual }) },
  );
}

export interface UpdateCompanySettingsPayload
  extends Partial<
    Pick<
      Copropiedad,
      | 'razonSocial'
      | 'direccion'
      | 'fondoImprevistosPct'
      | 'tasaMoraMensual'
      | 'diaCorteProntoPago'
      | 'descuentoProntoPagoPct'
      | 'llaveBreB'
      | 'wompiPublicKey'
      | 'wompiSandbox'
    >
  > {
  wompiIntegritySecret?: string;
  wompiEventsSecret?: string;
}

export async function updateCompanySettingsApi(
  companyId: string,
  patch: UpdateCompanySettingsPayload,
): Promise<Copropiedad> {
  return request<Copropiedad>(`/api/v1/companies/${encodeURIComponent(companyId)}/settings`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export interface PortalUnitLinkItem {
  unitId: string;
  torre: string;
  numero: string;
  propietarioNombre: string;
  propietarioEmail: string;
  propietarioTelefono: string;
  arrendatarioNombre?: string | null;
  arrendatarioEmail?: string | null;
  arrendatarioTelefono?: string | null;
  token: string;
}

export interface PortalMovimientoItem {
  fecha: string;
  periodo: string;
  comprobante: string;
  tipo: string;
  descripcion: string;
  cargo: number;
  abono: number;
}

export interface PortalIntencionPagoItem {
  id: string;
  referencia: string;
  periodo: string;
  montoTotal: number;
  estado: string;
  pasarela: string;
  pasarelaTxId?: string | null;
  createdAt: string;
  paidAt?: string | null;
}

export interface PortalUnitStatement {
  companyId: string;
  razonSocial: string;
  nombreCorto: string;
  nit: string;
  ciudad: string;
  direccion: string;
  periodoActual: string;
  llaveBreB: string;
  tasaMoraMensual: number;
  diaCorteProntoPago: number;
  descuentoProntoPagoPct: number;
  wompiPublicKey: string;
  wompiSandbox: boolean;
  wompiConfigurado: boolean;
  unitId: string;
  torre: string;
  numero: string;
  tipoUnidad: string;
  coeficiente: number;
  matricula: string;
  carteraCongelada: boolean;
  propietarioNombre: string;
  propietarioDocumento: string;
  propietarioEmail: string;
  arrendatarioNombre?: string | null;
  cuotaMensual: number;
  cargadoTotal: number;
  pagadoTotal: number;
  saldoActual: number;
  descuentoProntoPago: number;
  totalConDescuento: number;
  estadoCartera: string;
  movimientos: PortalMovimientoItem[];
  intenciones: PortalIntencionPagoItem[];
}

export interface PortalCheckoutResponse {
  referencia: string;
  montoTotal: number;
  montoEnCentavos: number;
  moneda: string;
  wompiPublicKey: string;
  wompiSandbox: boolean;
  signatureIntegrity: string;
  checkoutUrl: string;
  sandboxSimulable: boolean;
}

export async function fetchPortalLinksApi(companyId: string): Promise<PortalUnitLinkItem[]> {
  const res = await request<{ links: PortalUnitLinkItem[] }>(
    `/api/v1/companies/${encodeURIComponent(companyId)}/portal-links`,
  );
  return res.links ?? [];
}

export interface PortalCompanyPublicInfo {
  companyId: string;
  razonSocial: string;
  nombreCorto: string;
  nit: string;
  ciudad: string;
  direccion: string;
  periodoActual: string;
  turnstileSiteKey: string;
  portalLogoUrl: string;
  portalCoverUrl: string;
  portalColorPrimario: string;
  portalMensajeBienvenida: string;
  portalWhatsappSoporte: string;
}

export interface PortalLookupUnitMatch {
  token: string;
  unitId: string;
  torre: string;
  numero: string;
  tipoUnidad: string;
  propietarioNombre: string;
  saldoActual: number;
  cuotaMensual: number;
  estadoCartera: string;
}

export async function fetchPortalCompanyApi(slug: string): Promise<PortalCompanyPublicInfo> {
  return request<PortalCompanyPublicInfo>(`/api/v1/portal/company/${encodeURIComponent(slug)}`);
}

export async function portalLookupApi(payload: {
  companySlug: string;
  unidad?: string;
  documento: string;
  matriculaUltimos4?: string;
  turnstileToken?: string;
}): Promise<{ token: string; units: PortalLookupUnitMatch[] }> {
  return request<{ token: string; units: PortalLookupUnitMatch[] }>('/api/v1/portal/lookup', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchPortalStatementApi(token: string): Promise<PortalUnitStatement> {
  return request<PortalUnitStatement>(`/api/v1/portal/unit/${encodeURIComponent(token)}`);
}

export async function portalCreateCheckoutApi(
  token: string,
  payload: { monto?: number; aplicarDescuento?: boolean; redirectUrl?: string },
): Promise<PortalCheckoutResponse> {
  return request<PortalCheckoutResponse>(
    `/api/v1/portal/unit/${encodeURIComponent(token)}/checkout`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
}

export async function portalSimulatePaymentApi(
  token: string,
  payload: { referencia: string; montoEnCentavos: number },
): Promise<{ ok: boolean; idempotent?: boolean; referencia: string }> {
  return request<{ ok: boolean; idempotent?: boolean; referencia: string }>(
    `/api/v1/portal/unit/${encodeURIComponent(token)}/simulate-payment`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
}
