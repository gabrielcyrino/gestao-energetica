/** Cliente HTTP da API: token em memória + sessionStorage, erros com mensagem do backend. */

const TOKEN_KEY = 'ee.token'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string | null) {
  if (token) sessionStorage.setItem(TOKEN_KEY, token)
  else sessionStorage.removeItem(TOKEN_KEY)
}

export type Params = Record<string, string | number | boolean | null | undefined>

export function url(path: string, params?: Params): string {
  const qs = new URLSearchParams()
  Object.entries(params ?? {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.append(k, String(v))
  })
  const q = qs.toString()
  return `/api${path}${q ? `?${q}` : ''}`
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken()
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  })
  if (res.status === 401) {
    setToken(null)
    if (!location.pathname.startsWith('/login')) location.href = '/login'
    throw new ApiError(401, 'Sessão expirada.')
  }
  if (!res.ok) {
    let detail = `Erro ${res.status}`
    try {
      const body = await res.json()
      detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail ?? body)
    } catch {
      /* resposta sem corpo JSON */
    }
    throw new ApiError(res.status, detail)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const api = {
  get: <T,>(path: string, params?: Params) => request<T>(url(path, params)),
  post: <T,>(path: string, body?: unknown) =>
    request<T>(url(path), { method: 'POST', body: JSON.stringify(body ?? {}) }),
  put: <T,>(path: string, body?: unknown) =>
    request<T>(url(path), { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  del: <T,>(path: string) => request<T>(url(path), { method: 'DELETE' }),
  upload: <T,>(path: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<T>(url(path), { method: 'POST', body: form })
  },
}
