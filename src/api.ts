import type {
  Comprobante,
  Copropiedad,
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

export type UserRole = 'CONTADOR' | 'ADMINISTRADOR' | 'REVISOR_FISCAL' | 'CONSEJO';

export interface AuthUser {
  id: string;
  email: string;
  nombre: string;
  rol: UserRole;
  roles?: Array<{ company_id: string; role: UserRole }>;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}

const TOKEN_KEY = 'vertika.token.v1';

export function getAuthToken(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(TOKEN_KEY);
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

export async function updateCompanySettingsApi(
  companyId: string,
  patch: Partial<
    Pick<
      Copropiedad,
      | 'razonSocial'
      | 'direccion'
      | 'fondoImprevistosPct'
      | 'tasaMoraMensual'
      | 'diaCorteProntoPago'
      | 'descuentoProntoPagoPct'
      | 'llaveBreB'
    >
  >,
): Promise<Copropiedad> {
  return request<Copropiedad>(`/api/v1/companies/${encodeURIComponent(companyId)}/settings`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}
