import type { EstadoApp } from './domain/types';

export const API_URL: string = (import.meta as any).env?.VITE_API_URL || '';
export const apiEnabled = !!API_URL;

export interface BootstrapPayload {
  datos: any;
  estado: EstadoApp;
  mode?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `HTTP ${res.status}`);
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
