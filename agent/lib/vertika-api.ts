export interface VertikaFetchOptions extends RequestInit {
  signal?: AbortSignal;
  allowStatuses?: number[];
}

export function getVertikaApiBaseUrl(): string {
  const raw =
    process.env.VERTIKA_API_URL ||
    process.env.VITE_API_URL ||
    'http://localhost:8080';
  return raw.replace(/\/+$/, '');
}

export async function vertikaFetch<T = unknown>(
  path: string,
  options: VertikaFetchOptions = {},
): Promise<T> {
  const base = getVertikaApiBaseUrl();
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  const token = process.env.VERTIKA_API_TOKEN?.trim();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const { allowStatuses, ...fetchInit } = options;

  let res: Response;
  try {
    res = await fetch(url, { ...fetchInit, headers });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `No se pudo conectar al backend de Vértika en ${url}. Verifica que el servidor Rust ('cargo run' en backend/) esté activo. Detalle: ${detail}`,
    );
  }

  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  const allowed = allowStatuses?.includes(res.status) ?? false;
  if (!res.ok && !allowed) {
    const errObj =
      parsed && typeof parsed === 'object'
        ? (parsed as { error?: string; message?: string })
        : null;
    const msg =
      errObj?.error ||
      errObj?.message ||
      (typeof parsed === 'string' && parsed) ||
      `HTTP ${res.status}`;
    throw new Error(`Vértika API (${res.status} en ${path}): ${msg}`);
  }

  return parsed as T;
}
