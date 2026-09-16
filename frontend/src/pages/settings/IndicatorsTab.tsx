/** Cadastro de IDEs: fórmula textual + vínculos de símbolos + metas. Nenhum cálculo é escrito em código. */
import { Calculator, CheckCircle2, Pencil, Plus, Sigma, Trash2, TriangleAlert } from 'lucide-react'
import { useState } from 'react'

import {
  Button,
  Card,
  CardHeader,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Select,
  Spinner,
  Textarea,
  Tooltip,
} from '../../components/ui/primitives'
import { StatusPill } from '../../components/ui/status'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { AGGREGATION_LABEL, KIND_LABEL, LEVEL_LABEL, fmtAuto, fmtPct } from '../../lib/format'
import { useApi, useFilters, useMeta } from '../../lib/hooks'
import type { Equipment, Evaluation, IndicatorBrief, IndicatorDetail, Use, Variable } from '../../lib/types'
import {
  ConfirmDialog,
  FeedbackBanner,
  NodeSelect,
  SettingsNote,
  TableShell,
  Toolbar,
  VariableSelect,
  useFeedback,
  useSave,
} from './common'

interface BindingForm {
  symbol: string
  source_type: 'variable' | 'constant' | 'equipment_attribute' | 'builtin'
  variable_id: number | null
  aggregation: string | null
  unit_id: number | null
  constant_value: number | null
  attribute: string | null
  builtin: string | null
}

interface TargetForm {
  valid_from: string
  valid_to: string | null
  target_value: number | null
  target_min: number | null
  target_max: number | null
  baseline_value: number | null
  scope: 'all' | 'annual' | 'seasonal'
  label: string | null
  justification: string | null
}

interface IndicatorForm {
  code: string
  name: string
  description: string
  kind: 'intrinsic' | 'extrinsic'
  category: string
  node_id: number
  use_id: number | null
  equipment_id: number | null
  formula: string
  unit_id: number
  frequency: string
  direction: 'lower_better' | 'higher_better' | 'target_range' | 'none'
  decimals: number
  status_rule: { basis: 'target' | 'baseline'; tolerance_pct: number; critical_pct: number }
  upper_limit: number | null
  lower_limit: number | null
  min_completeness_pct: number
  operating_variable_id: number | null
  stability_band_pct: number
  baseline_model_id: number | null
  responsible_id: number | null
  data_origin_note: string
  active: boolean
  bindings: BindingForm[]
  targets: TargetForm[]
}

const DIRECTIONS = [
  { value: 'lower_better', label: 'Menor é melhor' },
  { value: 'higher_better', label: 'Maior é melhor' },
  { value: 'target_range', label: 'Faixa ideal (mín–máx)' },
  { value: 'none', label: 'Informativo (sem meta)' },
]

const SOURCE_TYPES = [
  { value: 'variable', label: 'Variável / tag' },
  { value: 'constant', label: 'Constante' },
  { value: 'equipment_attribute', label: 'Atributo do equipamento' },
  { value: 'builtin', label: 'Função do período' },
]

const CATEGORIES = ['intensidade', 'eficiência', 'desperdício', 'operacional', 'consumo', 'qualidade de energia', 'distribuição', 'variável relevante']

const emptyForm = (nodeId: number, unitId: number): IndicatorForm => ({
  code: '',
  name: '',
  description: '',
  kind: 'extrinsic',
  category: 'intensidade',
  node_id: nodeId,
  use_id: null,
  equipment_id: null,
  formula: '',
  unit_id: unitId,
  frequency: '1d',
  direction: 'lower_better',
  decimals: 2,
  status_rule: { basis: 'target', tolerance_pct: 4, critical_pct: 10 },
  upper_limit: null,
  lower_limit: null,
  min_completeness_pct: 80,
  operating_variable_id: null,
  stability_band_pct: 3,
  baseline_model_id: null,
  responsible_id: null,
  data_origin_note: '',
  active: true,
  bindings: [],
  targets: [],
})

export function IndicatorsTab() {
  const meta = useMeta()
  const { canEdit } = useAuth()
  const [nodeFilter, setNodeFilter] = useState<number | null>(null)
  const list = useApi<{ items: IndicatorBrief[]; count: number }>('/indicators', {
    node_id: nodeFilter ?? undefined,
    evaluate: false,
  })
  const fb = useFeedback()
  const [editing, setEditing] = useState<{ id: number | null; form: IndicatorForm } | null>(null)
  const [deleting, setDeleting] = useState<IndicatorBrief | null>(null)

  const remove = useSave<number>((id) => api.del(`/indicators/${id}`), {
    prefixes: ['/indicators', '/nodes', '/matrix', '/dashboard', '/trends'],
    onDone: () => {
      fb.ok('Indicador removido.')
      setDeleting(null)
    },
    onFail: (m) => {
      fb.fail(m)
      setDeleting(null)
    },
  })

  const openNew = () => {
    fb.clear()
    const unit = meta.data?.units.find((u) => u.symbol === 'kWh/t')?.id ?? meta.data?.units[0]?.id ?? 0
    setEditing({ id: null, form: emptyForm(nodeFilter ?? 0, unit) })
  }

  const openEdit = async (ind: IndicatorBrief) => {
    fb.clear()
    const detail = await api.get<{ indicator: IndicatorDetail }>(`/indicators/${ind.id}`)
    const d = detail.indicator
    setEditing({
      id: d.id,
      form: {
        code: d.code,
        name: d.name,
        description: d.description ?? '',
        kind: d.kind,
        category: d.category,
        node_id: d.node?.id ?? 0,
        use_id: d.use?.id ?? null,
        equipment_id: d.equipment?.id ?? null,
        formula: d.formula,
        unit_id: d.unit_id,
        frequency: d.frequency,
        direction: d.direction,
        decimals: d.decimals,
        status_rule: {
          basis: (d.status_rule?.basis as 'target' | 'baseline') ?? 'target',
          tolerance_pct: d.status_rule?.tolerance_pct ?? 4,
          critical_pct: d.status_rule?.critical_pct ?? 10,
        },
        upper_limit: d.upper_limit,
        lower_limit: d.lower_limit,
        min_completeness_pct: d.min_completeness_pct,
        operating_variable_id: d.operating_variable_id,
        stability_band_pct: d.stability_band_pct,
        baseline_model_id: d.baseline_model_id,
        responsible_id: d.responsible?.id ?? null,
        data_origin_note: d.data_origin_note ?? '',
        active: d.active,
        bindings: d.bindings.map((b) => ({
          symbol: b.symbol,
          source_type: b.source_type,
          variable_id: b.variable_id,
          aggregation: b.aggregation,
          unit_id: b.unit_id,
          constant_value: b.constant_value,
          attribute: b.attribute,
          builtin: b.builtin,
        })),
        targets: d.targets.map((t) => ({
          valid_from: t.valid_from,
          valid_to: t.valid_to,
          target_value: t.target_value,
          target_min: t.target_min,
          target_max: t.target_max,
          baseline_value: t.baseline_value,
          scope: t.scope,
          label: t.label,
          justification: t.justification,
        })),
      },
    })
  }

  if (list.error) return <ErrorState error={list.error} />

  return (
    <Card>
      <CardHeader
        title="Indicadores de Desempenho Energético (IDEs)"
        subtitle="Fórmula, vínculos, unidade, meta e regra de status são dados — criar um indicador não exige alterar código."
        icon={<Sigma size={15} />}
        actions={
          <Button variant="primary" onClick={openNew} disabled={!canEdit()}>
            <Plus size={14} /> Novo indicador
          </Button>
        }
      />
      <FeedbackBanner feedback={fb.feedback} onClose={fb.clear} />
      <Toolbar>
        <div className="w-72">
          <Field label="Filtrar por processo">
            <NodeSelect value={nodeFilter} onChange={setNodeFilter} allowEmpty />
          </Field>
        </div>
        <span className="pb-1 text-[11px] text-muted">{list.data?.count ?? 0} indicador(es)</span>
      </Toolbar>
      {list.isPending ? (
        <Spinner />
      ) : list.data?.items.length === 0 ? (
        <EmptyState title="Nenhum indicador" description="Cadastre indicadores intrínsecos e extrínsecos para este escopo." />
      ) : (
        <TableShell>
          <thead>
            <tr>
              <th>Indicador</th>
              <th>Escopo</th>
              <th>Fórmula</th>
              <th>Unid.</th>
              <th>Tipo</th>
              <th>Origem</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.data?.items.map((i) => (
              <tr key={i.id}>
                <td className="max-w-[300px]">
                  <span className="block truncate font-medium text-ink">{i.name}</span>
                  <span className="block font-mono text-[10px] text-muted">{i.code}</span>
                </td>
                <td className="text-[11px] text-ink-2">
                  {[i.process?.name, i.use?.name, i.equipment?.tag].filter(Boolean).join(' › ') || i.node?.name}
                </td>
                <td className="font-mono text-[11px] text-ink-2">{i.formula}</td>
                <td className="text-[11px]">{i.unit}</td>
                <td className="text-[11px] text-ink-2">
                  {KIND_LABEL[i.kind]} · {LEVEL_LABEL[i.level]}
                </td>
                <td className="max-w-[160px] truncate text-[11px] text-muted">{i.data_sources.join(', ') || '—'}</td>
                <td>
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" title="Editar" disabled={!canEdit()} onClick={() => void openEdit(i)}>
                      <Pencil size={13} />
                    </Button>
                    <Button size="sm" variant="ghost" title="Excluir" disabled={!canEdit()} onClick={() => setDeleting(i)}>
                      <Trash2 size={13} />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
      <SettingsNote>
        <b>Indicadores são dados — nenhum código é alterado.</b> A fórmula é avaliada por um interpretador restrito
        (sem acesso a arquivos ou funções do sistema) sobre os valores agregados do período: razões como kWh/t são
        calculadas como Σ energia ÷ Σ produção, e não como média das razões diárias.
      </SettingsNote>

      {editing && (
        <IndicatorEditor
          state={editing}
          onChange={(form) => setEditing({ ...editing, form })}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            fb.ok(msg)
            setEditing(null)
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title={`Excluir indicador "${deleting?.name}"?`}
        description="O histórico calculado deixa de aparecer nas telas. Oportunidades vinculadas permanecem, sem o indicador."
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        onClose={() => setDeleting(null)}
      />
    </Card>
  )
}

/* ------------------------------------------------------------------ editor */

function IndicatorEditor({
  state,
  onChange,
  onClose,
  onSaved,
}: {
  state: { id: number | null; form: IndicatorForm }
  onChange: (form: IndicatorForm) => void
  onClose: () => void
  onSaved: (msg: string) => void
}) {
  const meta = useMeta()
  const filters = useFilters()
  const { form, id } = state
  const uses = useApi<Use[]>('/uses', form.node_id ? { node_id: form.node_id } : undefined)
  const equipment = useApi<Equipment[]>('/equipment', form.use_id ? { use_id: form.use_id } : form.node_id ? { node_id: form.node_id } : undefined)
  const vars = useApi<Variable[]>('/variables', form.node_id ? { node_id: form.node_id } : undefined)
  const [validation, setValidation] = useState<{ valid: boolean; errors: string[]; symbols: string[]; unused_bindings: string[] } | null>(null)
  const [preview, setPreview] = useState<{ evaluation: Evaluation; unit: string } | null>(null)
  const [busy, setBusy] = useState<'validate' | 'preview' | 'save' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof IndicatorForm>(key: K, value: IndicatorForm[K]) => onChange({ ...form, [key]: value })

  const payload = () => ({
    ...form,
    description: form.description || null,
    data_origin_note: form.data_origin_note || null,
    targets: form.targets.map((t) => ({ ...t, valid_to: t.valid_to || null })),
  })

  const validate = async () => {
    setBusy('validate')
    setError(null)
    try {
      const res = await api.post<{ valid: boolean; errors: string[]; symbols: string[]; unused_bindings: string[] }>(
        '/indicators/validate',
        { formula: form.formula, bindings: form.bindings },
      )
      setValidation(res)
      const missing = res.symbols.filter((s) => !form.bindings.some((b) => b.symbol === s))
      if (missing.length) {
        onChange({
          ...form,
          bindings: [
            ...form.bindings,
            ...missing.map((symbol) => ({
              symbol,
              source_type: (symbol === 'PERIOD_DAYS' || symbol === 'PERIOD_HOURS' ? 'builtin' : 'variable') as BindingForm['source_type'],
              variable_id: null,
              aggregation: null,
              unit_id: null,
              constant_value: null,
              attribute: null,
              builtin: symbol === 'PERIOD_DAYS' || symbol === 'PERIOD_HOURS' ? symbol : null,
            })),
          ],
        })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao validar')
    } finally {
      setBusy(null)
    }
  }

  const runPreview = async () => {
    setBusy('preview')
    setError(null)
    setPreview(null)
    try {
      const res = await api.post<{ evaluation: Evaluation }>('/indicators/preview', { ...payload(), period: filters.period })
      const unit = meta.data?.units.find((u) => u.id === form.unit_id)?.symbol ?? ''
      setPreview({ evaluation: res.evaluation, unit })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha na pré-visualização')
    } finally {
      setBusy(null)
    }
  }

  const save = useSave<void>(() => (id ? api.put(`/indicators/${id}`, payload()) : api.post('/indicators', payload())), {
    prefixes: ['/indicators', '/nodes', '/matrix', '/dashboard', '/trends', '/uses', '/equipment'],
    onDone: () => onSaved(id ? 'Indicador atualizado e recalculado.' : 'Indicador criado — já aparece nas listas, matrizes e páginas de processo.'),
    onFail: (m) => setError(m),
  })

  const canSave = form.code.length > 2 && form.name.length > 2 && !!form.node_id && !!form.formula && !!form.unit_id

  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      wide
      title={id ? `Editar indicador ${form.code}` : 'Novo indicador de desempenho energético'}
      description="Indicadores são dados: fórmula, vínculos e metas ficam no banco. Nenhum código é alterado."
      footer={
        <>
          {error && <span className="mr-auto max-w-[50%] truncate text-xs text-critical-text">{error}</span>}
          <Button onClick={validate} disabled={busy !== null || !form.formula}>
            <Calculator size={13} /> {busy === 'validate' ? 'Validando…' : 'Validar fórmula'}
          </Button>
          <Button onClick={runPreview} disabled={busy !== null || !canSave}>
            {busy === 'preview' ? 'Calculando…' : 'Pré-visualizar'}
          </Button>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={!canSave || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {/* identificação */}
        <section className="grid gap-3 md:grid-cols-3">
          <Field label="Código" required>
            <Input value={form.code} disabled={!!id} onChange={(e) => set('code', e.target.value.toUpperCase())} />
          </Field>
          <div className="md:col-span-2">
            <Field label="Nome" required>
              <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
            </Field>
          </div>
          <Field label="Tipo" required hint="Intrínseco: característica do equipamento. Extrínseco: como ele é usado no processo.">
            <Select
              value={form.kind}
              onChange={(e) => set('kind', e.target.value as IndicatorForm['kind'])}
              options={Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))}
            />
          </Field>
          <Field label="Categoria">
            <Select value={form.category} onChange={(e) => set('category', e.target.value)} options={CATEGORIES.map((c) => ({ value: c, label: c }))} />
          </Field>
          <Field label="Responsável">
            <Select
              value={form.responsible_id ?? ''}
              onChange={(e) => set('responsible_id', e.target.value === '' ? null : Number(e.target.value))}
              options={[{ value: '', label: '—' }, ...(meta.data?.people ?? []).map((p) => ({ value: p.id, label: p.name }))]}
            />
          </Field>
          <div className="md:col-span-3">
            <Field label="Descrição">
              <Textarea rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} />
            </Field>
          </div>
        </section>

        {/* escopo */}
        <section>
          <h3 className="mb-2 text-xs font-semibold text-ink">Onde o indicador vive no processo</h3>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Processo / subprocesso" required>
              <NodeSelect value={form.node_id || null} onChange={(v) => set('node_id', v ?? 0)} levels={['area', 'process', 'subprocess']} />
            </Field>
            <Field label="USE (opcional)">
              <Select
                value={form.use_id ?? ''}
                onChange={(e) => set('use_id', e.target.value === '' ? null : Number(e.target.value))}
                options={[{ value: '', label: '— nível de processo —' }, ...(uses.data ?? []).map((u) => ({ value: u.id, label: u.name }))]}
              />
            </Field>
            <Field label="Equipamento (opcional)">
              <Select
                value={form.equipment_id ?? ''}
                onChange={(e) => set('equipment_id', e.target.value === '' ? null : Number(e.target.value))}
                options={[{ value: '', label: '— nível de USE —' }, ...(equipment.data ?? []).map((eq) => ({ value: eq.id, label: `${eq.tag} — ${eq.name}` }))]}
              />
            </Field>
          </div>
        </section>

        {/* fórmula */}
        <section>
          <h3 className="mb-2 text-xs font-semibold text-ink">Fórmula</h3>
          <div className="grid gap-3 md:grid-cols-[1fr_280px]">
            <div className="space-y-2">
              <Field label="Expressão" required hint='Use os símbolos que você vincula abaixo. Ex.: "E / P", "(E - EV) / H", "V * h / W"'>
                <Input className="font-mono" value={form.formula} onChange={(e) => set('formula', e.target.value)} placeholder="E / P" />
              </Field>
              {validation && (
                <div
                  className="rounded-lg border px-3 py-2 text-[11px]"
                  style={{ borderColor: validation.valid ? 'var(--good)' : 'var(--critical)' }}
                >
                  <p className="flex items-center gap-1 font-medium text-ink">
                    {validation.valid ? <CheckCircle2 size={13} style={{ color: 'var(--good)' }} /> : <TriangleAlert size={13} style={{ color: 'var(--critical)' }} />}
                    {validation.valid ? 'Fórmula válida' : 'Fórmula com problemas'}
                  </p>
                  {validation.symbols.length > 0 && (
                    <p className="mt-1 text-ink-2">
                      Símbolos detectados: <b className="font-mono">{validation.symbols.join(', ')}</b>
                    </p>
                  )}
                  {validation.errors.map((err) => (
                    <p key={err} className="mt-0.5 text-critical-text">
                      {err}
                    </p>
                  ))}
                  {validation.unused_bindings.length > 0 && (
                    <p className="mt-0.5 text-muted">Vínculos não usados: {validation.unused_bindings.join(', ')}</p>
                  )}
                </div>
              )}
            </div>
            <div className="rounded-lg border border-edge bg-surface-2 p-3 text-[11px] text-ink-2">
              <p className="mb-1 font-medium text-ink">Operadores e funções</p>
              <p className="font-mono">{(meta.data?.formula.operators ?? []).join('  ')}</p>
              <ul className="mt-2 space-y-0.5">
                {Object.entries(meta.data?.formula.functions ?? {}).map(([fn, desc]) => (
                  <li key={fn}>
                    <span className="font-mono text-ink">{fn}()</span> — {desc}
                  </li>
                ))}
              </ul>
              <p className="mt-2 font-medium text-ink">Funções do período</p>
              <ul className="space-y-0.5">
                {Object.entries(meta.data?.formula.builtins ?? {}).map(([fn, desc]) => (
                  <li key={fn}>
                    <span className="font-mono text-ink">{fn}</span> — {desc}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* vínculos */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-ink">Vínculos dos símbolos</h3>
            <Button
              size="sm"
              onClick={() =>
                set('bindings', [
                  ...form.bindings,
                  { symbol: '', source_type: 'variable', variable_id: null, aggregation: null, unit_id: null, constant_value: null, attribute: null, builtin: null },
                ])
              }
            >
              <Plus size={13} /> Adicionar símbolo
            </Button>
          </div>
          {form.bindings.length === 0 ? (
            <p className="rounded-lg border border-dashed border-edge px-3 py-4 text-center text-[11px] text-muted">
              Escreva a fórmula e clique em "Validar fórmula": os símbolos detectados viram linhas automaticamente.
            </p>
          ) : (
            <div className="space-y-2">
              {form.bindings.map((b, i) => (
                <div key={i} className="grid items-start gap-2 rounded-lg border border-edge p-2 md:grid-cols-[90px_170px_1fr_140px_140px_36px]">
                  <Field label="Símbolo">
                    <Input
                      className="font-mono"
                      value={b.symbol}
                      onChange={(e) => {
                        const next = [...form.bindings]
                        next[i] = { ...b, symbol: e.target.value }
                        set('bindings', next)
                      }}
                    />
                  </Field>
                  <Field label="Origem do valor">
                    <Select
                      value={b.source_type}
                      onChange={(e) => {
                        const next = [...form.bindings]
                        next[i] = { ...b, source_type: e.target.value as BindingForm['source_type'] }
                        set('bindings', next)
                      }}
                      options={SOURCE_TYPES}
                    />
                  </Field>
                  <div>
                    {b.source_type === 'variable' && (
                      <Field label="Variável">
                        <VariableSelect
                          value={b.variable_id}
                          nodeId={form.node_id}
                          onChange={(v) => {
                            const next = [...form.bindings]
                            next[i] = { ...b, variable_id: v }
                            set('bindings', next)
                          }}
                        />
                      </Field>
                    )}
                    {b.source_type === 'constant' && (
                      <Field label="Valor da constante">
                        <Input
                          type="number"
                          step="any"
                          value={b.constant_value ?? ''}
                          onChange={(e) => {
                            const next = [...form.bindings]
                            next[i] = { ...b, constant_value: e.target.value === '' ? null : Number(e.target.value) }
                            set('bindings', next)
                          }}
                        />
                      </Field>
                    )}
                    {b.source_type === 'equipment_attribute' && (
                      <Field label="Atributo" hint="rated_power_kw, rated_efficiency_pct ou chave de atributos.">
                        <Input
                          value={b.attribute ?? ''}
                          onChange={(e) => {
                            const next = [...form.bindings]
                            next[i] = { ...b, attribute: e.target.value }
                            set('bindings', next)
                          }}
                        />
                      </Field>
                    )}
                    {b.source_type === 'builtin' && (
                      <Field label="Função do período">
                        <Select
                          value={b.builtin ?? ''}
                          onChange={(e) => {
                            const next = [...form.bindings]
                            next[i] = { ...b, builtin: e.target.value || null }
                            set('bindings', next)
                          }}
                          options={[
                            { value: '', label: '—' },
                            ...Object.keys(meta.data?.formula.builtins ?? {}).map((k) => ({ value: k, label: k })),
                          ]}
                        />
                      </Field>
                    )}
                  </div>
                  <Field label="Agregação">
                    <Select
                      disabled={b.source_type !== 'variable'}
                      value={b.aggregation ?? ''}
                      onChange={(e) => {
                        const next = [...form.bindings]
                        next[i] = { ...b, aggregation: e.target.value || null }
                        set('bindings', next)
                      }}
                      options={[
                        { value: '', label: 'padrão da variável' },
                        ...Object.entries(AGGREGATION_LABEL).map(([value, label]) => ({ value, label })),
                      ]}
                    />
                  </Field>
                  <Field label="Converter para">
                    <Select
                      disabled={b.source_type !== 'variable'}
                      value={b.unit_id ?? ''}
                      onChange={(e) => {
                        const next = [...form.bindings]
                        next[i] = { ...b, unit_id: e.target.value === '' ? null : Number(e.target.value) }
                        set('bindings', next)
                      }}
                      options={[{ value: '', label: 'unidade original' }, ...(meta.data?.units ?? []).map((u) => ({ value: u.id, label: u.symbol }))]}
                    />
                  </Field>
                  <div className="pt-5">
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Remover símbolo"
                      onClick={() => set('bindings', form.bindings.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 size={13} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="mt-2 text-[11px] text-muted">
            {vars.data?.length ?? 0} variáveis disponíveis neste escopo. A agregação define como o valor do período é
            formado (soma de energia, média de umidade, contagem de dias…).
          </p>
        </section>

        {/* comportamento */}
        <section>
          <h3 className="mb-2 text-xs font-semibold text-ink">Unidade, direção e regra de status</h3>
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="Unidade" required>
              <Select
                value={form.unit_id}
                onChange={(e) => set('unit_id', Number(e.target.value))}
                options={(meta.data?.units ?? []).map((u) => ({ value: u.id, label: `${u.symbol} — ${u.name}` }))}
              />
            </Field>
            <Field label="Direção desejada">
              <Select value={form.direction} onChange={(e) => set('direction', e.target.value as IndicatorForm['direction'])} options={DIRECTIONS} />
            </Field>
            <Field label="Casas decimais">
              <Input type="number" min={0} max={6} value={form.decimals} onChange={(e) => set('decimals', Number(e.target.value))} />
            </Field>
            <Field label="Frequência de cálculo">
              <Select
                value={form.frequency}
                onChange={(e) => set('frequency', e.target.value)}
                options={[
                  { value: '1d', label: 'Diária' },
                  { value: '1h', label: 'Horária' },
                  { value: 'turno', label: 'Por turno' },
                  { value: 'lote', label: 'Por lote' },
                ]}
              />
            </Field>
            <Field label="Base do status">
              <Select
                value={form.status_rule.basis}
                onChange={(e) => set('status_rule', { ...form.status_rule, basis: e.target.value as 'target' | 'baseline' })}
                options={[
                  { value: 'target', label: 'Meta' },
                  { value: 'baseline', label: 'Linha de base' },
                ]}
              />
            </Field>
            <Field label="Tolerância (%)" hint="Até aqui continua 'dentro da meta'.">
              <Input
                type="number"
                step="0.5"
                value={form.status_rule.tolerance_pct}
                onChange={(e) => set('status_rule', { ...form.status_rule, tolerance_pct: Number(e.target.value) })}
              />
            </Field>
            <Field label="Desvio crítico (%)" hint="Acima disso o status vira 'desvio significativo'.">
              <Input
                type="number"
                step="0.5"
                value={form.status_rule.critical_pct}
                onChange={(e) => set('status_rule', { ...form.status_rule, critical_pct: Number(e.target.value) })}
              />
            </Field>
            <Field label="Completude mínima (%)" hint="Abaixo disso o período fica 'sem dados suficientes'.">
              <Input
                type="number"
                value={form.min_completeness_pct}
                onChange={(e) => set('min_completeness_pct', Number(e.target.value))}
              />
            </Field>
            <Field label="Limite operacional inferior">
              <Input
                type="number"
                step="any"
                value={form.lower_limit ?? ''}
                onChange={(e) => set('lower_limit', e.target.value === '' ? null : Number(e.target.value))}
              />
            </Field>
            <Field label="Limite operacional superior">
              <Input
                type="number"
                step="any"
                value={form.upper_limit ?? ''}
                onChange={(e) => set('upper_limit', e.target.value === '' ? null : Number(e.target.value))}
              />
            </Field>
            <Field label="Banda de estabilidade (%)" hint="Variações menores que isso são consideradas estáveis.">
              <Input type="number" step="0.5" value={form.stability_band_pct} onChange={(e) => set('stability_band_pct', Number(e.target.value))} />
            </Field>
            <div>
              <Field label="Variável de operação" hint="Dias com esta variável zerada contam como 'sem operação', não como dado faltante.">
                <VariableSelect
                  value={form.operating_variable_id}
                  nodeId={form.node_id}
                  onChange={(v) => set('operating_variable_id', v)}
                  types={['operational']}
                />
              </Field>
            </div>
          </div>
          <div className="mt-3">
            <Field label="Observação sobre a origem do dado">
              <Input value={form.data_origin_note} onChange={(e) => set('data_origin_note', e.target.value)} />
            </Field>
          </div>
        </section>

        {/* metas */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-ink">Metas e linha de base</h3>
            <Button
              size="sm"
              onClick={() =>
                set('targets', [
                  ...form.targets,
                  {
                    valid_from: new Date().toISOString().slice(0, 10),
                    valid_to: null,
                    target_value: null,
                    target_min: null,
                    target_max: null,
                    baseline_value: null,
                    scope: 'all',
                    label: '',
                    justification: '',
                  },
                ])
              }
            >
              <Plus size={13} /> Adicionar meta
            </Button>
          </div>
          {form.targets.length === 0 ? (
            <p className="rounded-lg border border-dashed border-edge px-3 py-3 text-center text-[11px] text-muted">
              Sem meta o indicador fica informativo. Metas podem ser anuais (Crop Year) ou por janela de safra.
            </p>
          ) : (
            <TableShell maxHeight={240}>
              <thead>
                <tr>
                  <th>Escopo</th>
                  <th>Válida de</th>
                  <th>Até</th>
                  <th className="right">Meta</th>
                  <th className="right">Mín.</th>
                  <th className="right">Máx.</th>
                  <th className="right">Baseline</th>
                  <th>Rótulo / justificativa</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {form.targets.map((t, i) => {
                  const upd = (patch: Partial<TargetForm>) => {
                    const next = [...form.targets]
                    next[i] = { ...t, ...patch }
                    set('targets', next)
                  }
                  return (
                    <tr key={i}>
                      <td>
                        <Select
                          value={t.scope}
                          onChange={(e) => upd({ scope: e.target.value as TargetForm['scope'] })}
                          options={[
                            { value: 'all', label: 'Qualquer período' },
                            { value: 'annual', label: 'Anual (períodos longos)' },
                            { value: 'seasonal', label: 'Safra (períodos curtos)' },
                          ]}
                        />
                      </td>
                      <td>
                        <Input type="date" value={t.valid_from} onChange={(e) => upd({ valid_from: e.target.value })} />
                      </td>
                      <td>
                        <Input type="date" value={t.valid_to ?? ''} onChange={(e) => upd({ valid_to: e.target.value || null })} />
                      </td>
                      <td>
                        <Input
                          type="number"
                          step="any"
                          value={t.target_value ?? ''}
                          onChange={(e) => upd({ target_value: e.target.value === '' ? null : Number(e.target.value) })}
                        />
                      </td>
                      <td>
                        <Input
                          type="number"
                          step="any"
                          value={t.target_min ?? ''}
                          onChange={(e) => upd({ target_min: e.target.value === '' ? null : Number(e.target.value) })}
                        />
                      </td>
                      <td>
                        <Input
                          type="number"
                          step="any"
                          value={t.target_max ?? ''}
                          onChange={(e) => upd({ target_max: e.target.value === '' ? null : Number(e.target.value) })}
                        />
                      </td>
                      <td>
                        <Input
                          type="number"
                          step="any"
                          value={t.baseline_value ?? ''}
                          onChange={(e) => upd({ baseline_value: e.target.value === '' ? null : Number(e.target.value) })}
                        />
                      </td>
                      <td>
                        <Input value={t.label ?? ''} placeholder="rótulo" onChange={(e) => upd({ label: e.target.value })} />
                        <Input
                          className="mt-1"
                          value={t.justification ?? ''}
                          placeholder="justificativa"
                          onChange={(e) => upd({ justification: e.target.value })}
                        />
                      </td>
                      <td>
                        <Button size="sm" variant="ghost" onClick={() => set('targets', form.targets.filter((_, idx) => idx !== i))}>
                          <Trash2 size={13} />
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </TableShell>
          )}
        </section>

        {preview && (
          <section className="rounded-lg border border-accent bg-accent-soft px-3 py-2">
            <p className="mb-1 text-xs font-semibold text-accent-ink">Pré-visualização com dados reais do período selecionado</p>
            <div className="flex flex-wrap items-center gap-4 text-xs text-ink">
              <span className="num text-base font-semibold">
                {fmtAuto(preview.evaluation.value, form.decimals)} <span className="text-[11px] font-normal text-ink-2">{preview.unit}</span>
              </span>
              <StatusPill status={preview.evaluation.status} explanation={preview.evaluation.status_explanation} />
              <span>Completude {fmtPct(preview.evaluation.completeness_pct, 0)}</span>
              {preview.evaluation.reason && <span className="text-ink-2">{preview.evaluation.reason}</span>}
              <Tooltip content="Valores agregados de cada símbolo no período">
                <span className="font-mono text-[11px] text-ink-2">
                  {(preview.evaluation.components ?? [])
                    .map((c) => `${c.symbol}=${fmtAuto(c.value)}${c.unit ? ` ${c.unit}` : ''}`)
                    .join('  ·  ')}
                </span>
              </Tooltip>
            </div>
          </section>
        )}

        <label className="flex items-center gap-2 text-xs text-ink-2">
          <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} />
          Indicador ativo
        </label>
      </div>
    </Dialog>
  )
}
