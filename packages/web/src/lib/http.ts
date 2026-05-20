const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';
const RETRY_DELAY_MS = 1500;
const MAX_RETRIES = 10;

export function wsUrl(path: string): string {
  const raw = import.meta.env.VITE_API_BASE_URL;
  if (raw && /^https?:\/\//i.test(raw)) {
    const u = new URL(raw);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.pathname = path;
    u.search = '';
    return u.toString();
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}${path}`;
}

function getHeaders(): HeadersInit {
  const headers: HeadersInit = {};
  let apiKey: string | null = null;
  try {
    apiKey = localStorage.getItem('paperApiKey');
  } catch {
    apiKey = null;
  }
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }
  return headers;
}

export async function fetchJson<T>(path: string): Promise<T> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        headers: getHeaders(),
      });

      if (res.status === 503) {
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
        throw new Error('Server still initializing');
      }

      if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
      return res.json() as Promise<T>;
    } catch (err) {
      if (attempt < MAX_RETRIES && err instanceof TypeError) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
      throw err;
    }
  }

  throw new Error('Max retries exceeded');
}
