/** Oportunidades de melhoria: registro, acompanhamento e ligação com o desvio que as originou. */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Lightbulb, Pencil, Plus, Search, Target, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'

import { ChartCard, ParetoChart } from '../components/charts'
import { KpiTile, StatRow } from '../components/common/Kpi'
import { Page, PageHeader } from '../components/layout/AppShell'
import { OpportunityDialog } from '../components/ops/OpportunityDialog'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Chip,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Select,
  Skeleton,
  Textarea,
  Tooltip,
} from '../components/ui/primitives'
import { StatusPill } from '../components/ui/status'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { EMPTY, OPPORTUNITY_STATUS, PRIORITY_LABEL, fmtAuto, fmtDateFull, fmtMoney, fmtNum, fmtPct } from '../lib/format'
import { useApi, useFilters, useMeta } from '../lib/hooks'
import type { Opportunity, StatusCode, TreeNode } from '../lib/types'

interface OpportunityList {
  items: Opportunity[]
  summary: { open: number; implemented: number; savings_mwh_year: number; savings_brl_year: number; investment_brl: number }
}

const OPEN_STATUS = ['identificada', 'em_analise', 'aprovada', 'em_implementacao']

function flatten(tree: TreeNode[] | undefined): TreeNode[] {
  const out: TreeNode[] = []
  const walk = (nodes: TreeNode[]) => nodes.forEach((n) => (out.push(n), walk(n.children)))
  walk(tree ?? [])
  return out
}

function priorityColor(p: string): string {
  return p === 'alta' ? 'var(--critical)' : p === 'media' ? 'var(--warning)' : 'var(--muted)'
}

/* ------------------------------------------------------------------ criação (precisa escolher a etapa) */

function NewOpportunityDialog({ open, onClose, nodes }: { open: boolean; onClose: () => void; nodes: TreeNode[] }) {
  const meta = useMeta()
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    title: '',
    node_id: 0,
    problem: '',
    opportunity: '',
    estimated_savings_mwh_year: null as number | null,
    estimated_savings_brl_year: null as number | null,
    estimated_investment_brl: null as number | null,
    responsible_id: null as number | null,
    priority: 'media',
    status: 'identificada',
    due_date: '',
    notes: '',
  })
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }))

  const save = useMutation({
    mutationFn: () => api.post('/opportunities', { ...form, due_date: form.due_date || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/opportunities'] })
      onClose()
    },
    onError: (e: Error) => setError(e.message),
  })

  const valid = form.title.length > 2 && form.node_id > 0 && form.problem.length > 2 && form.opportunity.length > 2

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      wide
      title="Nova oportunidade de melhoria"
      description="Registre a oportunidade na etapa do processo onde ela ocorre — assim ela aparece no diagnóstico daquela etapa."
      footer={
        <>
          {error && <span className="mr-auto text-xs text-critical-text">{error}</span>}
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2">
          <Field label="Título" required>
            <Input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Ex.: Intertravamento para desligar motor sem carga" />
          </Field>
        </div>
        <div className="md:col-span-2">
          <Field label="Etapa do processo" required>
            <Select
              value={form.node_id || ''}
              onChange={(e) => set('node_id', Number(e.target.value))}
              options={[
                { value: '', label: 'Selecione…' },
                ...nodes
                  .filter((n) => ['area', 'process', 'subprocess'].includes(n.level))
                  .map((n) => ({ value: n.id, label: `${n.level === 'subprocess' ? '   ' : n.level === 'process' ? ' ' : ''}${n.name}` })),
              ]}
            />
          </Field>
        </div>
        <Field label="Problema identificado" required>
          <Textarea value={form.problem} onChange={(e) => set('problem', e.target.value)} />
        </Field>
        <Field label="Oportunidade / ação proposta" required>
          <Textarea value={form.opportunity} onChange={(e) => set('opportunity', e.target.value)} />
        </Field>
        <Field label="Economia estimada (MWh/ano)">
          <Input
            type="number"
            value={form.estimated_savings_mwh_year ?? ''}
            onChange={(e) => set('estimated_savings_mwh_year', e.target.value === '' ? null : Number(e.target.value))}
          />
        </Field>
        <Field label="Economia estimada (R$/ano)">
          <Input
            type="number"
            value={form.estimated_savings_brl_year ?? ''}
            onChange={(e) => set('estimated_savings_brl_year', e.target.value === '' ? null : Number(e.target.value))}
          />
        </Field>
        <Field label="Investimento estimado (R$)">
          <Input
            type="number"
            value={form.estimated_investment_brl ?? ''}
            onChange={(e) => set('estimated_investment_brl', e.target.value === '' ? null : Number(e.target.value))}
          />
        </Field>
        <Field label="Prazo">
          <Input type="date" value={form.due_date} onChange={(e) => set('due_date', e.target.value)} />
        </Field>
        <Field label="Prioridade">
          <Select
            value={form.priority}
            onChange={(e) => set('priority', e.target.value)}
            options={Object.entries(PRIORITY_LABEL).map(([value, label]) => ({ value, label }))}
          />
        </Field>
        <Field label="Status">
          <Select
            value={form.status}
            onChange={(e) => set('status', e.target.value)}
            options={Object.entries(OPPORTUNITY_STATUS).map(([value, label]) => ({ value, label }))}
          />
        </Field>
        <Field label="Responsável">
          <Select
            value={form.responsible_id ?? ''}
            onChange={(e) => set('responsible_id', e.target.value === '' ? null : Number(e.target.value))}
            options={[{ value: '', label: '—' }, ...(meta.data?.people ?? []).map((p) => ({ value: p.id, label: p.name }))]}
          />
        </Field>
        <div className="md:col-span-2">
          <Field label="Observações">
            <Textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </div>
      </div>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ detalhe */

function OpportunityDetail({ item, onClose, onEdit }: { item: Opportunity; onClose: () => void; onEdit: () => void }) {
  const filters = useFilters()
  const snap = item.deviation_snapshot as
    | { value?: number; unit?: string; target?: number; baseline?: number; deviation_pct?: number; status?: StatusCode; period?: { label?: string }; captured_at?: string }
    | null
  const payback =
    item.estimated_investment_brl && item.estimated_savings_brl_year
      ? item.estimated_investment_brl / item.estimated_savings_brl_year
      : null

  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      wide
      title={`${item.code} · ${item.title}`}
      description={[item.area?.name, item.node?.name, item.use?.name, item.equipment?.tag].filter(Boolean).join(' › ')}
      footer={
        <>
          <Button onClick={onClose}>Fechar</Button>
          <Button variant="primary" onClick={onEdit}>
            <Pencil size={13} /> Editar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div>
            <p className="label">Status</p>
            <p className="text-sm font-medium">{OPPORTUNITY_STATUS[item.status] ?? item.status}</p>
          </div>
          <div>
            <p className="label">Prioridade</p>
            <Badge color={priorityColor(item.priority)}>{PRIORITY_LABEL[item.priority]}</Badge>
          </div>
          <div>
            <p className="label">Responsável</p>
            <p className="text-sm">{item.responsible?.name ?? EMPTY}</p>
          </div>
          <div>
            <p className="label">Prazo</p>
            <p className="text-sm">{fmtDateFull(item.due_date)}</p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <Card className="card-pad">
            <p className="label mb-1">Problema identificado</p>
            <p className="text-[13px] leading-relaxed text-ink-2">{item.problem}</p>
          </Card>
          <Card className="card-pad">
            <p className="label mb-1">Oportunidade proposta</p>
            <p className="text-[13px] leading-relaxed text-ink-2">{item.opportunity}</p>
          </Card>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <div>
            <p className="label">Economia estimada</p>
            <p className="num text-sm font-medium">{fmtNum(item.estimated_savings_mwh_year, 1)} MWh/ano</p>
          </div>
          <div>
            <p className="label">Economia financeira</p>
            <p className="num text-sm font-medium">{fmtMoney(item.estimated_savings_brl_year)}/ano</p>
          </div>
          <div>
            <p className="label">Investimento</p>
            <p className="num text-sm font-medium">{fmtMoney(item.estimated_investment_brl)}</p>
          </div>
          <div>
            <p className="label">Payback simples</p>
            <p className="num text-sm font-medium">{payback === null ? EMPTY : `${fmtNum(payback, 1)} anos`}</p>
          </div>
        </div>

        {snap && (
          <Card>
            <CardHeader
              title="Retrato do desvio que originou a oportunidade"
              subtitle={`${item.indicator?.name ?? 'Indicador'} · ${snap.period?.label ?? ''}${snap.captured_at ? ` · registrado em ${fmtDateFull(snap.captured_at)}` : ''}`}
              icon={<Target size={15} />}
            />
            <div className="grid gap-3 px-4 py-3 md:grid-cols-5">
              <div>
                <p className="label">Valor no período</p>
                <p className="num text-sm font-medium">
                  {fmtAuto(snap.value ?? null)} {snap.unit ?? item.reference_unit ?? ''}
                </p>
              </div>
              <div>
                <p className="label">Meta</p>
                <p className="num text-sm">{fmtAuto(snap.target ?? null)}</p>
              </div>
              <div>
                <p className="label">Baseline</p>
                <p className="num text-sm">{fmtAuto(snap.baseline ?? null)}</p>
              </div>
              <div>
                <p className="label">Desvio</p>
                <p className="num text-sm">{fmtPct(snap.deviation_pct ?? null, 1, true)}</p>
              </div>
              <div>
                <p className="label">Status</p>
                {snap.status ? <StatusPill status={snap.status} compact /> : <span className="text-sm">{EMPTY}</span>}
              </div>
            </div>
            {item.indicator && (
              <div className="border-t border-edge px-4 py-2">
                <Link to={filters.link(`/indicadores/${item.indicator.id}`)} className="text-xs text-accent-ink hover:underline">
                  Abrir o indicador {item.indicator.code} e ver o histórico →
                </Link>
              </div>
            )}
          </Card>
        )}

        {item.notes && (
          <div>
            <p className="label mb-1">Observações</p>
            <p className="text-[13px] text-ink-2">{item.notes}</p>
          </div>
        )}
      </div>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ página */

export function OpportunitiesPage() {
  const filters = useFilters()
  const { user } = useAuth()
  const qc = useQueryClient()
  const canEdit = !!user?.can_edit_master_data

  const [status, setStatus] = useState<string | null>(null)
  const [priority, setPriority] = useState<string | null>(null)
  const [nodeId, setNodeId] = useState<string>('')
  const [search, setSearch] = useState('')
  const [detail, setDetail] = useState<Opportunity | null>(null)
  const [editing, setEditing] = useState<Opportunity | null>(null)
  const [creating, setCreating] = useState(false)

  const tree = useApi<TreeNode[]>('/hierarchy/tree')
  const nodes = useMemo(() => flatten(tree.data), [tree.data])
  const data = useApi<OpportunityList>('/opportunities', {
    node_id: nodeId || undefined,
    status: status ?? undefined,
    priority: priority ?? undefined,
  })

  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/opportunities/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/opportunities'] }),
  })

  const items = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (data.data?.items ?? []).filter(
      (o) =>
        !q ||
        o.title.toLowerCase().includes(q) ||
        o.code.toLowerCase().includes(q) ||
        (o.node?.name ?? '').toLowerCase().includes(q) ||
        (o.equipment?.name ?? '').toLowerCase().includes(q),
    )
  }, [data.data, search])

  const pareto = useMemo(() => {
    const byProcess = new Map<string, number>()
    items
      .filter((o) => OPEN_STATUS.includes(o.status) && (o.estimated_savings_mwh_year ?? 0) > 0)
      .forEach((o) => {
        const key = o.node?.name ?? 'Sem etapa'
        byProcess.set(key, (byProcess.get(key) ?? 0) + (o.estimated_savings_mwh_year ?? 0))
      })
    const sorted = [...byProcess.entries()].sort((a, b) => b[1] - a[1])
    const total = sorted.reduce((acc, [, v]) => acc + v, 0)
    return {
      categories: sorted.map(([k]) => k),
      values: sorted.map(([, v]) => v),
      shares: sorted.map(([, v]) => (total ? (v / total) * 100 : 0)),
      total,
    }
  }, [items])

  const summary = data.data?.summary

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Análise' }, { label: 'Oportunidades' }]}
        title="Oportunidades de melhoria"
        subtitle="Cada oportunidade nasce de um desvio identificado no dashboard e guarda o retrato do indicador no momento do registro."
        actions={
          <Tooltip content={canEdit ? undefined : 'Seu perfil não permite criar oportunidades.'}>
            <span>
              <Button variant="primary" disabled={!canEdit} onClick={() => setCreating(true)}>
                <Plus size={14} /> Nova oportunidade
              </Button>
            </span>
          </Tooltip>
        }
      />

      <Page>
        {data.error ? (
          <ErrorState error={data.error} />
        ) : (
          <>
            <StatRow cols={5}>
              <KpiTile label="Oportunidades abertas" value={summary?.open ?? null} hint="Identificadas, em análise, aprovadas ou em implementação" />
              <KpiTile label="Implementadas / verificadas" value={summary?.implemented ?? null} hint="Concluídas — verificação por M&V quando aplicável" />
              <KpiTile label="Economia estimada" value={summary?.savings_mwh_year ?? null} unit="MWh/ano" decimals={0} hint="Soma das oportunidades abertas" />
              <KpiTile label="Economia financeira" value={summary ? fmtMoney(summary.savings_brl_year) : null} hint="Estimativa das oportunidades abertas" />
              <KpiTile label="Investimento previsto" value={summary ? fmtMoney(summary.investment_brl) : null} hint="CAPEX estimado das oportunidades abertas" />
            </StatRow>

            {pareto.categories.length > 0 && (
              <ChartCard
                title="Onde está o potencial de economia"
                subtitle="Participação de cada etapa na economia estimada das oportunidades abertas"
                icon={<Lightbulb size={15} />}
                table={{
                  columns: ['Etapa', 'Economia (MWh/ano)', 'Participação (%)'],
                  rows: pareto.categories.map((c, i) => [c, pareto.values[i], pareto.shares[i]]),
                }}
                note={`Total estimado: ${fmtNum(pareto.total, 0)} MWh/ano nas oportunidades abertas.`}
              >
                <ParetoChart categories={pareto.categories} shares={pareto.shares} height={280} />
              </ChartCard>
            )}

            <Card>
              <CardHeader
                title="Carteira de oportunidades"
                subtitle={`${items.length} registro(s)`}
                actions={
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative">
                      <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
                      <Input className="w-52 pl-7" placeholder="Buscar…" value={search} onChange={(e) => setSearch(e.target.value)} />
                    </div>
                    <Select
                      value={nodeId}
                      onChange={(e) => setNodeId(e.target.value)}
                      className="w-44"
                      options={[
                        { value: '', label: 'Todas as etapas' },
                        ...nodes
                          .filter((n) => ['area', 'process', 'subprocess'].includes(n.level))
                          .map((n) => ({ value: n.id, label: n.name })),
                      ]}
                    />
                  </div>
                }
              />
              <div className="flex flex-wrap items-center gap-1 px-4 py-2">
                {Object.entries(OPPORTUNITY_STATUS).map(([value, label]) => (
                  <Chip key={value} active={status === value} onClick={() => setStatus(status === value ? null : value)}>
                    {label}
                  </Chip>
                ))}
                <span className="mx-2 h-4 w-px bg-[var(--edge)]" />
                {Object.entries(PRIORITY_LABEL).map(([value, label]) => (
                  <Chip key={value} active={priority === value} onClick={() => setPriority(priority === value ? null : value)}>
                    Prioridade {label.toLowerCase()}
                  </Chip>
                ))}
              </div>

              {data.isPending ? (
                <Skeleton className="m-4" style={{ height: 240 }} />
              ) : items.length === 0 ? (
                <EmptyState
                  title="Nenhuma oportunidade encontrada"
                  description="Ajuste os filtros ou registre uma nova oportunidade a partir de um desvio no dashboard."
                  icon={<Lightbulb size={20} />}
                />
              ) : (
                <div className="overflow-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Código</th>
                        <th>Oportunidade</th>
                        <th>Etapa / equipamento</th>
                        <th>Indicador</th>
                        <th>Prioridade</th>
                        <th>Status</th>
                        <th className="right">MWh/ano</th>
                        <th className="right">R$/ano</th>
                        <th className="right">Investimento</th>
                        <th className="right">Payback</th>
                        <th>Responsável</th>
                        <th>Prazo</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((o) => {
                        const payback =
                          o.estimated_investment_brl && o.estimated_savings_brl_year
                            ? o.estimated_investment_brl / o.estimated_savings_brl_year
                            : null
                        return (
                          <tr key={o.id} className="cursor-pointer" onClick={() => setDetail(o)}>
                            <td className="num text-[11px] text-muted">{o.code}</td>
                            <td className="max-w-[320px]">
                              <span className="block truncate font-medium text-ink">{o.title}</span>
                              <span className="block truncate text-[11px] text-muted">{o.problem}</span>
                            </td>
                            <td className="text-[11px] text-ink-2">
                              {[o.node?.name, o.use?.name, o.equipment?.tag].filter(Boolean).join(' › ') || EMPTY}
                            </td>
                            <td className="max-w-[180px]">
                              {o.indicator ? (
                                <Link
                                  to={filters.link(`/indicadores/${o.indicator.id}`)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="block truncate text-[12px] text-accent-ink hover:underline"
                                >
                                  {o.indicator.name}
                                </Link>
                              ) : (
                                <span className="text-muted">{EMPTY}</span>
                              )}
                            </td>
                            <td>
                              <Badge color={priorityColor(o.priority)}>{PRIORITY_LABEL[o.priority]}</Badge>
                            </td>
                            <td className="text-[12px]">{OPPORTUNITY_STATUS[o.status] ?? o.status}</td>
                            <td className="right">{fmtNum(o.estimated_savings_mwh_year, 1)}</td>
                            <td className="right text-ink-2">{o.estimated_savings_brl_year ? fmtMoney(o.estimated_savings_brl_year) : EMPTY}</td>
                            <td className="right text-ink-2">{o.estimated_investment_brl ? fmtMoney(o.estimated_investment_brl) : EMPTY}</td>
                            <td className="right">{payback === null ? EMPTY : `${fmtNum(payback, 1)} a`}</td>
                            <td className="text-[12px] text-ink-2">{o.responsible?.name ?? EMPTY}</td>
                            <td className="text-[12px] text-ink-2">{fmtDateFull(o.due_date)}</td>
                            <td onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center gap-1">
                                <Button size="sm" variant="ghost" onClick={() => setEditing(o)} disabled={!canEdit} title="Editar">
                                  <Pencil size={13} />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={!canEdit || remove.isPending}
                                  title="Excluir"
                                  onClick={() => {
                                    if (confirm(`Excluir a oportunidade ${o.code}?`)) remove.mutate(o.id)
                                  }}
                                >
                                  <Trash2 size={13} />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}
      </Page>

      {detail && (
        <OpportunityDetail
          item={detail}
          onClose={() => setDetail(null)}
          onEdit={() => {
            setEditing(detail)
            setDetail(null)
          }}
        />
      )}
      {editing && <OpportunityDialog open opportunity={editing} onClose={() => setEditing(null)} />}
      {creating && <NewOpportunityDialog open onClose={() => setCreating(false)} nodes={nodes} />}
    </>
  )
}
