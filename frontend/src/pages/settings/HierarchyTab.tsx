/** Cadastro da hierarquia (empresa → planta → área → processo → subprocesso) e do fluxograma de cada nível.
 *  É aqui que se cumpre o critério "adicionar novas áreas sem reconstruir a aplicação". */
import { ChevronRight, GitBranch, Pencil, Plus, Trash2, Workflow } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'

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
  cn,
} from '../../components/ui/primitives'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { LEVEL_LABEL, REGIME_LABEL } from '../../lib/format'
import { useApi, useFilters, useMeta } from '../../lib/hooks'
import type { FlowResponse, TreeNode, Variable } from '../../lib/types'
import {
  ConfirmDialog,
  FeedbackBanner,
  SettingsNote,
  TableShell,
  VariableSelect,
  flattenTree,
  useFeedback,
  useSave,
} from './common'

interface NodeRow {
  id: number
  code: string
  name: string
  level: string
  parent_id: number | null
  path: string
  sort_order: number
  description: string | null
  owner_id: number | null
  color_slot: number | null
  production_variable_id: number | null
  operating_regime: string | null
  active: boolean
}

interface NodeForm {
  code: string
  name: string
  level: string
  parent_id: number | null
  sort_order: number
  description: string
  owner_id: number | null
  color_slot: number | null
  production_variable_id: number | null
  operating_regime: string
  active: boolean
}

const EMPTY_FORM: NodeForm = {
  code: '',
  name: '',
  level: 'area',
  parent_id: null,
  sort_order: 1,
  description: '',
  owner_id: null,
  color_slot: null,
  production_variable_id: null,
  operating_regime: '',
  active: true,
}

const CODE_RE = /^[a-z0-9][a-z0-9._-]*$/

function slugify(name: string, parentCode?: string) {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return parentCode && parentCode.includes('.') ? `${parentCode}.${base}` : parentCode ? `${parentCode}.${base}` : base
}

export function HierarchyTab() {
  const meta = useMeta()
  const filters = useFilters()
  const { user, canEdit } = useAuth()
  const tree = useApi<TreeNode[]>('/hierarchy/tree')
  const fb = useFeedback()
  const [editing, setEditing] = useState<{ form: NodeForm; id: number | null; parentName?: string } | null>(null)
  const [deleting, setDeleting] = useState<TreeNode | null>(null)
  const [flowNode, setFlowNode] = useState<TreeNode | null>(null)
  const [createdAreaId, setCreatedAreaId] = useState<number | null>(null)

  const flat = useMemo(() => flattenTree(tree.data), [tree.data])
  const levels = meta.data?.levels ?? []
  const canEditAll = !!user?.can_edit_master_data

  const save = useSave<{ id: number | null; form: NodeForm }>(
    ({ id, form }) => {
      const payload = { ...form, description: form.description || null, operating_regime: form.operating_regime || null }
      return id ? api.put(`/nodes/${id}`, payload) : api.post('/nodes', payload)
    },
    {
      prefixes: ['/hierarchy', '/nodes', '/meta'],
      onDone: (result, vars) => {
        const created = result as NodeRow
        fb.ok(
          vars.id
            ? `"${vars.form.name}" atualizado.`
            : `"${vars.form.name}" criado — já aparece na navegação lateral, no dashboard e nos filtros, sem nenhuma alteração de código.`,
        )
        if (!vars.id && vars.form.level === 'area') setCreatedAreaId(created?.id ?? null)
        setEditing(null)
      },
      onFail: (msg) => fb.fail(msg),
    },
  )

  const remove = useSave<number>((id) => api.del(`/nodes/${id}`), {
    prefixes: ['/hierarchy', '/nodes'],
    onDone: () => {
      fb.ok('Nó removido.')
      setDeleting(null)
    },
    onFail: (msg) => {
      fb.fail(msg)
      setDeleting(null)
    },
  })

  const childLevel = (level: string) => {
    const idx = levels.findIndex((l) => l.code === level)
    return levels[idx + 1]?.code ?? 'process'
  }

  const openCreate = (parent?: TreeNode) => {
    const level = parent ? childLevel(parent.level) : 'area'
    setCreatedAreaId(null)
    fb.clear()
    setEditing({
      id: null,
      parentName: parent?.name,
      form: {
        ...EMPTY_FORM,
        level,
        parent_id: parent?.id ?? null,
        sort_order: (parent?.children.length ?? 0) + 1,
      },
    })
  }

  const openEdit = async (node: TreeNode) => {
    fb.clear()
    setCreatedAreaId(null)
    const detail = await api.get<NodeRow>(`/nodes/${node.id}`)
    setEditing({
      id: node.id,
      form: {
        code: detail.code,
        name: detail.name,
        level: detail.level,
        parent_id: detail.parent_id,
        sort_order: detail.sort_order,
        description: detail.description ?? '',
        owner_id: detail.owner_id,
        color_slot: detail.color_slot,
        production_variable_id: detail.production_variable_id,
        operating_regime: detail.operating_regime ?? '',
        active: detail.active,
      },
    })
  }

  if (tree.error) return <ErrorState error={tree.error} />

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Estrutura da planta"
          subtitle="Empresa → planta → área → processo → subprocesso. A hierarquia é dado: níveis, nomes e ordem são cadastrados aqui."
          icon={<GitBranch size={15} />}
          actions={
            <Button variant="primary" disabled={!canEditAll} onClick={() => openCreate(flat.find((f) => f.node.level === 'plant')?.node)}>
              <Plus size={14} /> Nova área
            </Button>
          }
        />
        <FeedbackBanner feedback={fb.feedback} onClose={fb.clear} />
        {createdAreaId && (
          <div className="mx-4 mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-accent bg-accent-soft px-3 py-2 text-xs text-accent-ink">
            <span>Próximo passo sugerido: desenhar o fluxograma da nova área e cadastrar seus USEs.</span>
            <Button
              size="sm"
              onClick={() => {
                const node = flat.find((f) => f.node.id === createdAreaId)?.node
                if (node) setFlowNode(node)
              }}
            >
              <Workflow size={13} /> Editar fluxograma
            </Button>
            <Link to={filters.link(`/areas/${createdAreaId}`)} className="btn text-xs">
              Abrir área
            </Link>
          </div>
        )}
        {tree.isPending ? (
          <Spinner />
        ) : (
          <TableShell maxHeight={560}>
            <thead>
              <tr>
                <th>Nó</th>
                <th>Nível</th>
                <th>Código</th>
                <th className="right">USEs</th>
                <th className="right">Equip.</th>
                <th className="right">IDEs</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {flat.map(({ node, depth }) => {
                const level = levels.find((l) => l.code === node.level)
                const canAddChild = !!levels[levels.findIndex((l) => l.code === node.level) + 1]
                return (
                  <tr key={node.id}>
                    <td>
                      <div className="flex items-center gap-1" style={{ paddingLeft: depth * 14 }}>
                        {depth > 0 && <ChevronRight size={12} className="shrink-0 text-muted" />}
                        <span className={cn('truncate', depth <= 2 ? 'font-medium text-ink' : 'text-ink-2')}>{node.name}</span>
                      </div>
                    </td>
                    <td className="text-[11px] text-ink-2">{LEVEL_LABEL[node.level] ?? node.level}</td>
                    <td className="font-mono text-[11px] text-muted">{node.code}</td>
                    <td className="right num">{node.uses || '—'}</td>
                    <td className="right num">{node.equipment || '—'}</td>
                    <td className="right num">{node.indicators || '—'}</td>
                    <td>
                      <div className="flex items-center justify-end gap-1">
                        {level?.has_flow && (
                          <Button size="sm" variant="ghost" title="Editar fluxograma" onClick={() => setFlowNode(node)}>
                            <Workflow size={13} />
                          </Button>
                        )}
                        {canAddChild && (
                          <Button
                            size="sm"
                            variant="ghost"
                            title={`Adicionar ${LEVEL_LABEL[childLevel(node.level)]?.toLowerCase() ?? 'filho'}`}
                            disabled={!canEditAll}
                            onClick={() => openCreate(node)}
                          >
                            <Plus size={13} />
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Editar"
                          disabled={!canEdit({ path: node.path })}
                          onClick={() => void openEdit(node)}
                        >
                          <Pencil size={13} />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Excluir"
                          disabled={!canEditAll}
                          onClick={() => {
                            fb.clear()
                            setDeleting(node)
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
          </TableShell>
        )}
        <SettingsNote>
          A aplicação não conhece "Recebimento" nem "Torre": ela lê esta árvore. Novas áreas, processos e subprocessos
          aparecem automaticamente na navegação, no dashboard, nas matrizes e nos filtros de período.
        </SettingsNote>
      </Card>

      {editing && (
        <NodeDialog
          state={editing}
          levels={levels.map((l) => ({ value: l.code, label: l.name }))}
          people={(meta.data?.people ?? []).map((p) => ({ value: p.id, label: p.name }))}
          nodes={flat.map(({ node, depth }) => ({ value: node.id, label: `${'  '.repeat(depth)}${node.name}` }))}
          busy={save.isPending}
          onChange={(form) => setEditing((s) => (s ? { ...s, form } : s))}
          onSave={() => editing && save.mutate({ id: editing.id, form: editing.form })}
          onClose={() => setEditing(null)}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title={`Excluir "${deleting?.name}"?`}
        description={
          <>
            A exclusão só é permitida se o nó não tiver filhos nem USEs vinculados. Medições e indicadores associados
            devem ser removidos antes.
          </>
        }
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        onClose={() => setDeleting(null)}
      />

      {flowNode && <FlowEditorDialog node={flowNode} onClose={() => setFlowNode(null)} onSaved={(msg) => fb.ok(msg)} />}
    </div>
  )
}

function NodeDialog({
  state,
  levels,
  people,
  nodes,
  busy,
  onChange,
  onSave,
  onClose,
}: {
  state: { form: NodeForm; id: number | null; parentName?: string }
  levels: { value: string; label: string }[]
  people: { value: number; label: string }[]
  nodes: { value: number; label: string }[]
  busy: boolean
  onChange: (form: NodeForm) => void
  onSave: () => void
  onClose: () => void
}) {
  const { form, id } = state
  const set = <K extends keyof NodeForm>(key: K, value: NodeForm[K]) => onChange({ ...form, [key]: value })
  const codeOk = CODE_RE.test(form.code)
  const canSave = form.name.trim().length > 1 && codeOk && !!form.level
  const prodVars = useApi<Variable[]>('/variables', id ? { node_id: id } : undefined, { enabled: !!id })

  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      wide
      title={id ? `Editar ${form.name}` : `Novo ${LEVEL_LABEL[form.level]?.toLowerCase() ?? 'nó'}`}
      description={state.parentName ? `Dentro de ${state.parentName}` : undefined}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={!canSave || busy} onClick={onSave}>
            {busy ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Nome" required>
          <Input
            value={form.name}
            onChange={(e) => {
              const name = e.target.value
              if (!id && (!form.code || form.code === slugify(form.name))) {
                onChange({ ...form, name, code: slugify(name) })
              } else {
                set('name', name)
              }
            }}
          />
        </Field>
        <Field
          label="Código"
          required
          hint={codeOk || !form.code ? 'Minúsculas, números, ponto, hífen ou underscore.' : 'Código inválido.'}
        >
          <Input value={form.code} onChange={(e) => set('code', e.target.value)} disabled={!!id} />
        </Field>
        <Field label="Nível" required>
          <Select value={form.level} onChange={(e) => set('level', e.target.value)} options={levels} disabled={!!id} />
        </Field>
        <Field label="Nó pai">
          <Select
            value={form.parent_id ?? ''}
            onChange={(e) => set('parent_id', e.target.value === '' ? null : Number(e.target.value))}
            options={[{ value: '', label: '— raiz —' }, ...nodes]}
          />
        </Field>
        <Field label="Ordem de exibição">
          <Input type="number" value={form.sort_order} onChange={(e) => set('sort_order', Number(e.target.value))} />
        </Field>
        <Field label="Responsável (dono do processo)">
          <Select
            value={form.owner_id ?? ''}
            onChange={(e) => set('owner_id', e.target.value === '' ? null : Number(e.target.value))}
            options={[{ value: '', label: '— sem responsável —' }, ...people]}
          />
        </Field>
        <Field label="Cor da série (1–8)" hint="Usada nos gráficos para manter a identidade visual da área.">
          <Select
            value={form.color_slot ?? ''}
            onChange={(e) => set('color_slot', e.target.value === '' ? null : Number(e.target.value))}
            options={[{ value: '', label: '— automática —' }, ...Array.from({ length: 8 }, (_, i) => ({ value: i + 1, label: `Cor ${i + 1}` }))]}
          />
        </Field>
        <Field label="Regime operacional">
          <Input
            value={form.operating_regime}
            onChange={(e) => set('operating_regime', e.target.value)}
            placeholder="ex.: sazonal — safra, 3 turnos seg–sáb"
            list="regimes"
          />
          <datalist id="regimes">
            {Object.values(REGIME_LABEL).map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </Field>
        {id && (
          <div className="md:col-span-2">
            <Field
              label="Variável de produção de referência"
              hint="Base da intensidade energética (kWh por tonelada, por lote, por saco…). Sem ela, a etapa mostra apenas consumo."
            >
              <VariableSelect
                value={form.production_variable_id}
                onChange={(v) => set('production_variable_id', v)}
                nodeId={id}
                types={['production']}
              />
            </Field>
            {prodVars.data && prodVars.data.filter((v) => v.variable_type === 'production').length === 0 && (
              <p className="mt-1 text-[11px] text-muted">Nenhuma variável de produção cadastrada neste nó ainda.</p>
            )}
          </div>
        )}
        <div className="md:col-span-2">
          <Field label="Descrição">
            <Textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={2} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-xs text-ink-2">
          <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} />
          Ativo
        </label>
      </div>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ editor de fluxograma */

interface FlowNodeForm {
  key: string
  id: number | null
  kind: 'process' | 'input' | 'output' | 'storage' | 'utility' | 'link'
  label: string
  hierarchy_node_id: number | null
  linked_node_id: number | null
  pos_x: number
  pos_y: number
}

interface FlowEdgeForm {
  key: string
  source: string
  target: string
  stream_type: 'material' | 'energy' | 'residue'
  label: string
  energy_carrier_id: number | null
}

const KIND_OPTIONS = [
  { value: 'process', label: 'Etapa do processo' },
  { value: 'input', label: 'Entrada' },
  { value: 'output', label: 'Saída / resíduo' },
  { value: 'storage', label: 'Armazenagem' },
  { value: 'utility', label: 'Utilidade' },
  { value: 'link', label: 'Ligação para outra área' },
]

const STREAM_OPTIONS = [
  { value: 'material', label: 'Material' },
  { value: 'energy', label: 'Energia' },
  { value: 'residue', label: 'Resíduo' },
]

function FlowEditorDialog({ node, onClose, onSaved }: { node: TreeNode; onClose: () => void; onSaved: (msg: string) => void }) {
  const meta = useMeta()
  const tree = useApi<TreeNode[]>('/hierarchy/tree')
  const flow = useApi<FlowResponse>(`/nodes/${node.id}/flow`, { metrics: false })
  const fb = useFeedback()
  const [nodes, setNodes] = useState<FlowNodeForm[] | null>(null)
  const [edges, setEdges] = useState<FlowEdgeForm[] | null>(null)
  const flat = useMemo(() => flattenTree(tree.data), [tree.data])
  const children = flat.filter(({ node: n }) => n.parent_id === node.id)
  const areas = flat.filter(({ node: n }) => n.level === 'area' && n.id !== node.id)

  const state = useMemo(() => {
    if (nodes && edges) return { nodes, edges }
    if (!flow.data) return null
    const auto = flow.data.auto_generated
    const ns: FlowNodeForm[] = flow.data.nodes.map((n, i) => ({
      key: auto ? `new-${i}` : String(n.id),
      id: auto ? null : n.id,
      kind: n.kind,
      label: n.label,
      hierarchy_node_id: n.hierarchy_node_id,
      linked_node_id: n.linked_node_id,
      pos_x: n.pos_x ?? i * 280,
      pos_y: n.pos_y ?? 0,
    }))
    const es: FlowEdgeForm[] = flow.data.edges.map((e, i) => ({
      key: `e-${i}`,
      source: auto ? `new-${flow.data!.nodes.findIndex((n) => n.id === e.source)}` : String(e.source),
      target: auto ? `new-${flow.data!.nodes.findIndex((n) => n.id === e.target)}` : String(e.target),
      stream_type: e.stream_type,
      label: e.label ?? '',
      energy_carrier_id: e.carrier?.id ?? null,
    }))
    return { nodes: ns, edges: es }
  }, [flow.data, nodes, edges])

  const save = useSave<void>(
    () => {
      const current = state!
      return api.put(`/nodes/${node.id}/flow`, {
        nodes: current.nodes.map((n) => ({
          id: n.id ?? undefined,
          key: n.key,
          kind: n.kind,
          label: n.label,
          hierarchy_node_id: n.kind === 'process' ? n.hierarchy_node_id : null,
          linked_node_id: n.kind === 'link' ? n.linked_node_id : null,
          pos_x: n.pos_x,
          pos_y: n.pos_y,
        })),
        edges: current.edges.map((e) => ({
          source: e.source,
          target: e.target,
          stream_type: e.stream_type,
          label: e.label || null,
          energy_carrier_id: e.stream_type === 'energy' ? e.energy_carrier_id : null,
        })),
      })
    },
    {
      prefixes: ['/nodes', '/hierarchy'],
      onDone: () => {
        onSaved(`Fluxograma de ${node.name} salvo.`)
        onClose()
      },
      onFail: (msg) => fb.fail(msg),
    },
  )

  const update = (next: { nodes: FlowNodeForm[]; edges: FlowEdgeForm[] }) => {
    setNodes(next.nodes)
    setEdges(next.edges)
  }

  if (!state) {
    return (
      <Dialog open onOpenChange={onClose} wide title={`Fluxograma — ${node.name}`}>
        <Spinner />
      </Dialog>
    )
  }

  const nodeOptions = state.nodes.map((n) => ({ value: n.key, label: n.label || '(sem rótulo)' }))

  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      wide
      title={`Fluxograma — ${node.name}`}
      description="Cada etapa do fluxo aponta para um processo da hierarquia; é assim que os indicadores aparecem ancorados no desenho."
      footer={
        <>
          {fb.feedback && <span className="mr-auto text-xs text-critical-text">{fb.feedback.message}</span>}
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Salvando…' : 'Salvar fluxograma'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {flow.data?.auto_generated && (
          <p className="rounded-lg border border-accent bg-accent-soft px-3 py-2 text-[11px] text-accent-ink">
            Esta área ainda não tem fluxograma desenhado: os processos abaixo foram sugeridos em sequência. Ajuste,
            acrescente entradas/saídas e salve.
          </p>
        )}

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-ink">Etapas e nós do diagrama</h3>
            <Button
              size="sm"
              onClick={() =>
                update({
                  nodes: [
                    ...state.nodes,
                    {
                      key: `new-${Date.now()}`,
                      id: null,
                      kind: 'process',
                      label: '',
                      hierarchy_node_id: null,
                      linked_node_id: null,
                      pos_x: state.nodes.length * 280,
                      pos_y: 0,
                    },
                  ],
                  edges: state.edges,
                })
              }
            >
              <Plus size={13} /> Adicionar nó
            </Button>
          </div>
          <TableShell maxHeight={260}>
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Rótulo</th>
                <th>Processo vinculado</th>
                <th>Posição X</th>
                <th>Posição Y</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {state.nodes.map((n, i) => (
                <tr key={n.key}>
                  <td>
                    <Select
                      value={n.kind}
                      onChange={(e) => {
                        const next = [...state.nodes]
                        next[i] = { ...n, kind: e.target.value as FlowNodeForm['kind'] }
                        update({ nodes: next, edges: state.edges })
                      }}
                      options={KIND_OPTIONS}
                    />
                  </td>
                  <td>
                    <Input
                      value={n.label}
                      onChange={(e) => {
                        const next = [...state.nodes]
                        next[i] = { ...n, label: e.target.value }
                        update({ nodes: next, edges: state.edges })
                      }}
                    />
                  </td>
                  <td>
                    {n.kind === 'process' ? (
                      <Select
                        value={n.hierarchy_node_id ?? ''}
                        onChange={(e) => {
                          const id = e.target.value === '' ? null : Number(e.target.value)
                          const picked = children.find(({ node: c }) => c.id === id)
                          const next = [...state.nodes]
                          next[i] = { ...n, hierarchy_node_id: id, label: n.label || picked?.node.name || '' }
                          update({ nodes: next, edges: state.edges })
                        }}
                        options={[
                          { value: '', label: '— selecione —' },
                          ...children.map(({ node: c }) => ({ value: c.id, label: c.name })),
                        ]}
                      />
                    ) : n.kind === 'link' ? (
                      <Select
                        value={n.linked_node_id ?? ''}
                        onChange={(e) => {
                          const next = [...state.nodes]
                          next[i] = { ...n, linked_node_id: e.target.value === '' ? null : Number(e.target.value) }
                          update({ nodes: next, edges: state.edges })
                        }}
                        options={[{ value: '', label: '— área destino —' }, ...areas.map(({ node: a }) => ({ value: a.id, label: a.name }))]}
                      />
                    ) : (
                      <span className="text-[11px] text-muted">—</span>
                    )}
                  </td>
                  <td>
                    <Input
                      type="number"
                      value={n.pos_x}
                      onChange={(e) => {
                        const next = [...state.nodes]
                        next[i] = { ...n, pos_x: Number(e.target.value) }
                        update({ nodes: next, edges: state.edges })
                      }}
                    />
                  </td>
                  <td>
                    <Input
                      type="number"
                      value={n.pos_y}
                      onChange={(e) => {
                        const next = [...state.nodes]
                        next[i] = { ...n, pos_y: Number(e.target.value) }
                        update({ nodes: next, edges: state.edges })
                      }}
                    />
                  </td>
                  <td>
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Remover nó"
                      onClick={() =>
                        update({
                          nodes: state.nodes.filter((x) => x.key !== n.key),
                          edges: state.edges.filter((e) => e.source !== n.key && e.target !== n.key),
                        })
                      }
                    >
                      <Trash2 size={13} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
          {state.nodes.length === 0 && <EmptyState title="Nenhum nó no diagrama" description="Adicione as etapas do processo." />}
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-ink">Fluxos (arestas)</h3>
            <Button
              size="sm"
              disabled={state.nodes.length < 2}
              onClick={() =>
                update({
                  nodes: state.nodes,
                  edges: [
                    ...state.edges,
                    {
                      key: `e-${Date.now()}`,
                      source: state.nodes[0].key,
                      target: state.nodes[1].key,
                      stream_type: 'material',
                      label: '',
                      energy_carrier_id: null,
                    },
                  ],
                })
              }
            >
              <Plus size={13} /> Adicionar fluxo
            </Button>
          </div>
          <TableShell maxHeight={240}>
            <thead>
              <tr>
                <th>Origem</th>
                <th>Destino</th>
                <th>Tipo</th>
                <th>Rótulo</th>
                <th>Fonte de energia</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {state.edges.map((e, i) => (
                <tr key={e.key}>
                  <td>
                    <Select
                      value={e.source}
                      onChange={(ev) => {
                        const next = [...state.edges]
                        next[i] = { ...e, source: ev.target.value }
                        update({ nodes: state.nodes, edges: next })
                      }}
                      options={nodeOptions}
                    />
                  </td>
                  <td>
                    <Select
                      value={e.target}
                      onChange={(ev) => {
                        const next = [...state.edges]
                        next[i] = { ...e, target: ev.target.value }
                        update({ nodes: state.nodes, edges: next })
                      }}
                      options={nodeOptions}
                    />
                  </td>
                  <td>
                    <Select
                      value={e.stream_type}
                      onChange={(ev) => {
                        const next = [...state.edges]
                        next[i] = { ...e, stream_type: ev.target.value as FlowEdgeForm['stream_type'] }
                        update({ nodes: state.nodes, edges: next })
                      }}
                      options={STREAM_OPTIONS}
                    />
                  </td>
                  <td>
                    <Input
                      value={e.label}
                      placeholder="ex.: Grãos úmidos, Vapor"
                      onChange={(ev) => {
                        const next = [...state.edges]
                        next[i] = { ...e, label: ev.target.value }
                        update({ nodes: state.nodes, edges: next })
                      }}
                    />
                  </td>
                  <td>
                    <Select
                      disabled={e.stream_type !== 'energy'}
                      value={e.energy_carrier_id ?? ''}
                      onChange={(ev) => {
                        const next = [...state.edges]
                        next[i] = { ...e, energy_carrier_id: ev.target.value === '' ? null : Number(ev.target.value) }
                        update({ nodes: state.nodes, edges: next })
                      }}
                      options={[{ value: '', label: '—' }, ...(meta.data?.carriers ?? []).map((c) => ({ value: c.id, label: c.name }))]}
                    />
                  </td>
                  <td>
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Remover fluxo"
                      onClick={() => update({ nodes: state.nodes, edges: state.edges.filter((x) => x.key !== e.key) })}
                    >
                      <Trash2 size={13} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </section>
      </div>
    </Dialog>
  )
}
