import type {
  Comprobante,
  EstadoApp,
  EventoAuditoria,
  Linea,
  PreAsiento,
} from './domain/types';

export const API_URL: string = (import.meta as any).env?.VITE_API_URL || '';
export const apiEnabled = !!API_URL;

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
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

export async function fetchBootstrap(): Promise<BootstrapPayload> {
  return request<BootstrapPayload>('/api/v1/bootstrap');
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
