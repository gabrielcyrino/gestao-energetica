/** Hooks de dados (React Query) e estado global de filtros na URL. */
import { keepPreviousData, useQuery, type UseQueryOptions } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'

import { api, type Params } from './api'
import type { Meta } from './types'

export function useApi<T>(path: string | null, params?: Params, options?: Partial<UseQueryOptions<T>>) {
  return useQuery<T>({
    queryKey: [path, params],
    queryFn: () => api.get<T>(path as string, params),
    enabled: path !== null && (options?.enabled ?? true),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    ...options,
  })
}

export function useMeta() {
  return useApi<Meta>('/meta', undefined, { staleTime: Infinity })
}

/* ------------------------------------------------------------------ filtros globais na URL
   p  = período (week:2026-W32 | month:2026-08 | crop_year:CY2026 | season:SV2026 | custom:a..b)
   c  = comparação (prev | yoy | outra especificação)
   Os demais parâmetros (escopo, status, tipo) são locais de cada página, mas viajam junto
   nos links de drill-down para preservar o contexto. */
export interface Filters {
  period: string
  compare: string
  params: { period: string; compare: string }
  setPeriod: (spec: string) => void
  setCompare: (spec: string) => void
  get: (key: string) => string | null
  set: (key: string, value: string | null) => void
  link: (path: string, extra?: Record<string, string | number | undefined>) => string
  search: string
}

export function useFilters(): Filters {
  const [sp, setSp] = useSearchParams()
  const meta = useMeta()
  const period = sp.get('p') ?? meta.data?.periods.default ?? 'last:30'
  const compare = sp.get('c') ?? 'prev'

  const update = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(sp)
      if (value === null || value === '') next.delete(key)
      else next.set(key, value)
      setSp(next, { replace: false })
    },
    [sp, setSp],
  )

  const link = useCallback(
    (path: string, extra?: Record<string, string | number | undefined>) => {
      const next = new URLSearchParams()
      next.set('p', period)
      next.set('c', compare)
      Object.entries(extra ?? {}).forEach(([k, v]) => {
        if (v !== undefined && v !== '') next.set(k, String(v))
      })
      return `${path}?${next.toString()}`
    },
    [period, compare],
  )

  return useMemo(
    () => ({
      period,
      compare,
      params: { period, compare },
      setPeriod: (spec: string) => update('p', spec),
      setCompare: (spec: string) => update('c', spec),
      get: (key: string) => sp.get(key),
      set: update,
      link,
      search: `?p=${encodeURIComponent(period)}&c=${encodeURIComponent(compare)}`,
    }),
    [period, compare, sp, update, link],
  )
}

/** Tema claro/escuro persistido (ambiente industrial costuma alternar). */
const THEME_KEY = 'ee.theme'
export type Theme = 'light' | 'dark' | 'system'

export function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
  localStorage.setItem(THEME_KEY, theme)
  window.dispatchEvent(new CustomEvent('ee-theme'))
}

export function getTheme(): Theme {
  return (localStorage.getItem(THEME_KEY) as Theme) ?? 'system'
}
