/** Login. Em modo DEMO oferece os perfis pré-cadastrados (um clique) além do formulário. */
import { useQuery } from '@tanstack/react-query'
import { Activity, LogIn, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'

import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { Button, Card, Field, Input, Spinner } from '../components/ui/primitives'

interface DemoUser {
  username: string
  display_name: string
  role: string
  role_label: string
}

const ROLE_HINT: Record<string, string> = {
  admin: 'Acesso total, incluindo usuários e auditoria.',
  energy_manager: 'Cadastra processos, USEs, indicadores e metas.',
  process_owner: 'Edita apenas a própria área; registra oportunidades.',
  viewer: 'Somente leitura.',
}

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('energia')
  const [password, setPassword] = useState('demo')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const demo = useQuery({ queryKey: ['demo-users'], queryFn: () => api.get<DemoUser[]>('/auth/demo-users'), retry: false })

  const doLogin = async (user: string, pass = 'demo') => {
    setBusy(true)
    setError(null)
    try {
      await login(user, pass)
      navigate('/', { replace: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha no login')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-page p-6">
      <div className="w-full max-w-4xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-white">
            <Activity size={20} />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Gestão Energética Conectada ao Processo</h1>
            <p className="text-xs text-ink-2">
              Energia, USEs e indicadores ancorados nas etapas físicas da planta · ambiente DEMO com dados fictícios
            </p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-[1fr_340px]">
          <Card className="p-4">
            <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck size={15} /> Perfis de demonstração
            </h2>
            <p className="mb-3 text-xs text-ink-2">
              Cada perfil enxerga os mesmos dados, mas com permissões diferentes de edição e escopo.
            </p>
            {demo.isPending ? (
              <Spinner />
            ) : demo.error ? (
              <p className="text-xs text-ink-2">Use o formulário ao lado para entrar.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {demo.data?.map((u) => (
                  <button
                    key={u.username}
                    disabled={busy}
                    onClick={() => doLogin(u.username)}
                    className="rounded-lg border border-edge p-3 text-left transition-colors hover:border-accent hover:bg-surface-2"
                  >
                    <p className="text-[13px] font-medium">{u.role_label}</p>
                    <p className="truncate text-[11px] text-ink-2">{u.display_name}</p>
                    <p className="mt-1 text-[11px] text-muted">{ROLE_HINT[u.role]}</p>
                  </button>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold">Entrar</h2>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault()
                doLogin(username, password)
              }}
            >
              <Field label="Usuário">
                <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
              </Field>
              <Field label="Senha" hint="Ambiente DEMO: senha 'demo'. Em produção, login via IdP corporativo (OIDC).">
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
              </Field>
              {error && <p className="text-xs text-critical-text">{error}</p>}
              <Button variant="primary" className="w-full justify-center" disabled={busy}>
                <LogIn size={14} /> {busy ? 'Entrando…' : 'Entrar'}
              </Button>
            </form>
          </Card>
        </div>
      </div>
    </div>
  )
}
