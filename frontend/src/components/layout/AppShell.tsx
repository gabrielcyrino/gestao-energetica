/** Casca da aplicação: navegação hierárquica, barra de filtros globais e aviso de dados fictícios. */
import {
  Activity,
  BarChart3,
  ChevronRight,
  Database,
  Factory,
  GitCompareArrows,
  Grid3x3,
  LayoutDashboard,
  Lightbulb,
  LogOut,
  Moon,
  Network,
  Settings,
  Sun,
  TrendingUp,
  Workflow,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useParams } from 'react-router'

import { useAuth } from '../../lib/auth'
import { applyTheme, getTheme, useApi, useFilters, useMeta, type Theme } from '../../lib/hooks'
import type { TreeNode } from '../../lib/types'
import { Button, Tooltip, cn } from '../ui/primitives'
import { PeriodPicker } from './PeriodPicker'

function NavItem({ to, icon, children, exact }: { to: string; icon: ReactNode; children: ReactNode; exact?: boolean }) {
  const filters = useFilters()
  return (
    <NavLink
      to={`${to}${filters.search}`}
      end={exact}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors',
          isActive ? 'bg-accent-soft font-medium text-accent-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
        )
      }
    >
      <span className="shrink-0 opacity-80">{icon}</span>
      <span className="truncate">{children}</span>
    </NavLink>
  )
}

function AreaNav({ area }: { area: TreeNode }) {
  const location = useLocation()
  const params = useParams()
  const filters = useFilters()
  const activeArea = location.pathname.includes(`/areas/${area.id}`) || area.children.some((c) => String(c.id) === params.nodeId)
  const [open, setOpen] = useState(activeArea)
  useEffect(() => {
    if (activeArea) setOpen(true)
  }, [activeArea])

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors',
          activeArea ? 'text-ink' : 'text-ink-2 hover:bg-surface-2',
        )}
      >
        <Factory size={15} className="shrink-0 opacity-80" style={{ color: `var(--s${area.color_slot ?? 1})` }} />
        <span className="flex-1 truncate text-left">{area.name}</span>
        <ChevronRight size={14} className={cn('transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <div className="ml-3 border-l border-edge pl-2">
          <NavItem to={`/areas/${area.id}`} icon={<LayoutDashboard size={14} />} exact>
            Visão geral
          </NavItem>
          <NavItem to={`/areas/${area.id}/fluxograma`} icon={<Workflow size={14} />}>
            Fluxograma
          </NavItem>
          {area.children.map((proc) => (
            <div key={proc.id}>
              <NavLink
                to={`/processos/${proc.id}${filters.search}`}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors',
                    isActive ? 'bg-accent-soft font-medium text-accent-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
                  )
                }
              >
                <span className="ml-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--muted)]" />
                <span className="truncate">{proc.name}</span>
              </NavLink>
              {proc.children.length > 0 && (
                <div className="ml-4 border-l border-edge pl-2">
                  {proc.children.map((sub) => (
                    <NavLink
                      key={sub.id}
                      to={`/processos/${sub.id}${filters.search}`}
                      className={({ isActive }) =>
                        cn(
                          'block truncate rounded-lg px-2.5 py-1 text-xs transition-colors',
                          isActive ? 'font-medium text-accent-ink' : 'text-muted hover:text-ink',
                        )
                      }
                    >
                      {sub.name}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(getTheme())
  const next: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' }
  return (
    <Tooltip content={`Tema: ${theme === 'system' ? 'sistema' : theme === 'light' ? 'claro' : 'escuro'}`}>
      <button
        className="btn btn-ghost px-1.5 py-1"
        onClick={() => {
          const n = next[theme]
          setTheme(n)
          applyTheme(n)
        }}
        aria-label="Alternar tema"
      >
        {theme === 'dark' ? <Moon size={15} /> : <Sun size={15} />}
      </button>
    </Tooltip>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const meta = useMeta()
  const tree = useApi<TreeNode[]>('/hierarchy/tree')
  const { user, logout } = useAuth()
  const plant = tree.data?.[0]?.children?.[0]
  const areas = plant?.children ?? []

  return (
    <div className="flex h-full">
      <aside className="flex w-60 shrink-0 flex-col border-r border-edge bg-surface">
        <div className="flex items-center gap-2 border-b border-edge px-4 py-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-white">
            <Activity size={16} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold leading-tight">Gestão Energética</p>
            <p className="truncate text-[11px] text-muted">{plant?.name ?? 'Planta'}</p>
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
          <NavItem to="/" icon={<LayoutDashboard size={15} />} exact>
            Dashboard geral
          </NavItem>
          <div className="px-2.5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-muted">Áreas</div>
          {areas.map((area) => (
            <AreaNav key={area.id} area={area} />
          ))}
          <div className="px-2.5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-muted">Análise</div>
          <NavItem to="/uses" icon={<Network size={15} />}>
            USEs
          </NavItem>
          <NavItem to="/indicadores" icon={<Grid3x3 size={15} />}>
            Indicadores
          </NavItem>
          <NavItem to="/comparacoes" icon={<GitCompareArrows size={15} />}>
            Comparações
          </NavItem>
          <NavItem to="/tendencias" icon={<TrendingUp size={15} />}>
            Tendências
          </NavItem>
          <NavItem to="/oportunidades" icon={<Lightbulb size={15} />}>
            Oportunidades
          </NavItem>
          <NavItem to="/qualidade" icon={<Database size={15} />}>
            Qualidade dos dados
          </NavItem>
          <div className="px-2.5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-muted">Sistema</div>
          <NavItem to="/configuracoes" icon={<Settings size={15} />}>
            Configurações
          </NavItem>
          <a
            href="/docs"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <BarChart3 size={15} className="opacity-80" />
            API (OpenAPI)
          </a>
        </nav>

        <div className="border-t border-edge px-3 py-2">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">{user?.display_name}</p>
              <p className="truncate text-[11px] text-muted">{user?.role_label}</p>
            </div>
            <ThemeToggle />
            <Tooltip content="Sair">
              <button className="btn btn-ghost px-1.5 py-1" onClick={logout} aria-label="Sair">
                <LogOut size={15} />
              </button>
            </Tooltip>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-edge bg-surface/95 backdrop-blur">
          <div className="flex flex-wrap items-center gap-3 px-5 py-2">
            <PeriodPicker />
            <div className="ml-auto flex items-center gap-2">
              {meta.data?.demo && (
                <Tooltip content={meta.data.data_notice}>
                  <span className="inline-flex items-center gap-1 rounded-md border border-[var(--warning)] px-2 py-1 text-[11px] font-semibold text-ink">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--warning)]" />
                    DEMO · dados fictícios
                  </span>
                </Tooltip>
              )}
              <Link to="/metodologia" className="btn btn-ghost text-xs">
                Metodologia
              </Link>
            </div>
          </div>
        </header>
        <main className="min-w-0 flex-1 overflow-y-auto bg-page">{children}</main>
      </div>
    </div>
  )
}

export function PageHeader({
  breadcrumb,
  title,
  subtitle,
  actions,
  badges,
}: {
  breadcrumb?: { label: string; to?: string }[]
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  badges?: ReactNode
}) {
  const filters = useFilters()
  return (
    <div className="border-b border-edge bg-surface px-5 pb-3 pt-4">
      {breadcrumb && breadcrumb.length > 0 && (
        <nav className="mb-1 flex flex-wrap items-center gap-1 text-[11px] text-muted">
          {breadcrumb.map((b, i) => (
            <span key={`${b.label}-${i}`} className="flex items-center gap-1">
              {i > 0 && <ChevronRight size={11} />}
              {b.to ? (
                <Link to={`${b.to}${filters.search}`} className="hover:text-ink hover:underline">
                  {b.label}
                </Link>
              ) : (
                <span>{b.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2 text-lg font-semibold leading-tight text-ink">
            {title}
            {badges}
          </h1>
          {subtitle && <p className="mt-0.5 text-xs text-ink-2">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  )
}

export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('space-y-4 p-5', className)}>{children}</div>
}

export { Button }
