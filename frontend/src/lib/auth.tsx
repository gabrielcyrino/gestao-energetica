/** Contexto de autenticação: token JWT + perfil do usuário e verificação de permissões. */
import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { api, getToken, setToken } from './api'
import type { NodeBrief, User } from './types'

interface AuthState {
  user: User | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  canEdit: (node?: NodeBrief | { path?: string } | null) => boolean
  isAdmin: boolean
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!getToken()) {
      setLoading(false)
      return
    }
    api
      .get<User>('/auth/me')
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    const res = await api.post<{ access_token: string; user: User }>('/auth/login', { username, password })
    setToken(res.access_token)
    setUser(res.user)
  }, [])

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
    location.href = '/login'
  }, [])

  const canEdit = useCallback(
    (node?: NodeBrief | { path?: string } | null) => {
      if (!user) return false
      if (user.can_edit_master_data) return true
      if (user.role !== 'process_owner') return false
      const path = (node as { path?: string })?.path
      if (!path) return user.scope_paths.length > 0
      return user.scope_paths.some((p) => path.startsWith(p))
    },
    [user],
  )

  const value = useMemo<AuthState>(
    () => ({ user, loading, login, logout, canEdit, isAdmin: user?.role === 'admin' }),
    [user, loading, login, logout, canEdit],
  )
  return <AuthContext value={value}>{children}</AuthContext>
}

export function useAuth(): AuthState {
  const ctx = use(AuthContext)
  if (!ctx) throw new Error('useAuth precisa do AuthProvider')
  return ctx
}
