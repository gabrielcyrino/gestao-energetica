/** Helpers compartilhados pelas abas de Configurações: feedback, mutações, confirmação e seletores. */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Search } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'

import { Button, Dialog, Input, Select, Tooltip, cn } from '../../components/ui/primitives'
import { useApi } from '../../lib/hooks'
import type { NodeBrief, TreeNode, Variable } from '../../lib/types'

/* ------------------------------------------------------------------ feedback */

export interface Feedback {
  kind: 'ok' | 'error'
  message: string
}

export function FeedbackBanner({ feedback, onClose }: { feedback: Feedback | null; onClose?: () => void }) {
  if (!feedback) return null
  const ok = feedback.kind === 'ok'
  return (
    <div
      className="mx-4 mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs"
      style={{ borderColor: ok ? 'var(--good)' : 'var(--critical)' }}
      role="status"
    >
      {ok ? (
        <CheckCircle2 size={14} style={{ color: 'var(--good)' }} className="mt-px shrink-0" />
      ) : (
        <AlertTriangle size={14} style={{ color: 'var(--critical)' }} className="mt-px shrink-0" />
      )}
      <span className="flex-1 text-ink">{feedback.message}</span>
      {onClose && (
        <button onClick={onClose} className="text-muted hover:text-ink" aria-label="Fechar aviso">
          ×
        </button>
      )}
    </div>
  )
}

export function useFeedback() {
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  return {
    feedback,
    ok: (message: string) => setFeedback({ kind: 'ok', message }),
    fail: (message: string) => setFeedback({ kind: 'error', message }),
    clear: () => setFeedback(null),
  }
}

/* ------------------------------------------------------------------ mutações */

/** Mutação que invalida as queries afetadas (chaves são [path, params]). */
export function useSave<TVars>(
  fn: (vars: TVars) => Promise<unknown>,
  options: { prefixes?: string[]; onDone?: (result: unknown, vars: TVars) => void; onFail?: (message: string) => void } = {},
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (result, vars) => {
      const prefixes = options.prefixes ?? []
      qc.invalidateQueries({
        predicate: (q) => {
          const key = q.queryKey[0]
          return typeof key === 'string' && (prefixes.length === 0 || prefixes.some((p) => key.startsWith(p)))
        },
      })
      options.onDone?.(result, vars)
    },
    onError: (e: Error) => options.onFail?.(e.message),
  })
}

/* ------------------------------------------------------------------ confirmação */

export function ConfirmDialog({
  open,
  title,
  description,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  description: ReactNode
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={title}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={busy} onClick={onConfirm}>
            {busy ? 'Excluindo…' : 'Confirmar exclusão'}
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-2">{description}</p>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ permissão */

export function EditGuard({ can, children }: { can: boolean; children: ReactNode }) {
  if (can) return <>{children}</>
  return (
    <Tooltip content="Seu perfil não permite editar este cadastro.">
      <span className="inline-block cursor-not-allowed opacity-50">
        <span className="pointer-events-none block">{children}</span>
      </span>
    </Tooltip>
  )
}

export function SettingsNote({ children }: { children: ReactNode }) {
  return (
    <p className="mx-4 my-3 rounded-lg border border-edge bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-ink-2">
      {children}
    </p>
  )
}

/* ------------------------------------------------------------------ seletores */

export function flattenTree(nodes: TreeNode[] | undefined, depth = 0): { node: TreeNode; depth: number }[] {
  if (!nodes) return []
  return nodes.flatMap((n) => [{ node: n, depth }, ...flattenTree(n.children, depth + 1)])
}

export function NodeSelect({
  value,
  onChange,
  levels,
  allowEmpty,
  emptyLabel = '— todos —',
  disabled,
}: {
  value: number | null
  onChange: (id: number | null) => void
  levels?: string[]
  allowEmpty?: boolean
  emptyLabel?: string
  disabled?: boolean
}) {
  const tree = useApi<TreeNode[]>('/hierarchy/tree')
  const flat = useMemo(() => flattenTree(tree.data), [tree.data])
  const options = flat
    .filter(({ node }) => !levels || levels.includes(node.level))
    .map(({ node, depth }) => ({ value: node.id, label: `${'  '.repeat(depth)}${node.name}` }))
  return (
    <Select
      disabled={disabled}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      options={allowEmpty ? [{ value: '', label: emptyLabel }, ...options] : options}
    />
  )
}

/** Seleção de variável com filtro textual (a planta tem centenas de tags). */
export function VariableSelect({
  value,
  onChange,
  nodeId,
  allowEmpty = true,
  disabled,
  types,
}: {
  value: number | null
  onChange: (id: number | null) => void
  nodeId?: number | null
  allowEmpty?: boolean
  disabled?: boolean
  types?: string[]
}) {
  const [filter, setFilter] = useState('')
  const vars = useApi<Variable[]>('/variables', nodeId ? { node_id: nodeId } : undefined)
  const list = (vars.data ?? [])
    .filter((v) => !types || types.includes(v.variable_type))
    .filter((v) => {
      const q = filter.trim().toLowerCase()
      return !q || v.code.toLowerCase().includes(q) || v.name.toLowerCase().includes(q)
    })
  const selected = (vars.data ?? []).find((v) => v.id === value)
  return (
    <div className="space-y-1">
      <div className="relative">
        <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
        <Input
          className="pl-6 text-[11px]"
          placeholder="filtrar tag…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          disabled={disabled}
        />
      </div>
      <Select
        disabled={disabled}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        options={[
          ...(allowEmpty ? [{ value: '', label: '— selecione —' }] : []),
          ...(selected && !list.some((v) => v.id === selected.id)
            ? [{ value: selected.id, label: `${selected.code} — ${selected.name}` }]
            : []),
          ...list.slice(0, 300).map((v) => ({ value: v.id, label: `${v.code} — ${v.name} (${v.unit})` })),
        ]}
      />
      {selected && (
        <p className="text-[10px] text-muted">
          {selected.unit} · agregação padrão {selected.aggregation} · {selected.data_source?.name ?? 'sem fonte'}
        </p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ tabela */

export function TableShell({ children, maxHeight = 520 }: { children: ReactNode; maxHeight?: number }) {
  return (
    <div className="overflow-auto" style={{ maxHeight }}>
      <table className="table">{children}</table>
    </div>
  )
}

export function RowActions({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-end gap-1">{children}</div>
}

export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-wrap items-end gap-2 px-4 py-3', className)}>{children}</div>
}

export function nodeLabel(node: NodeBrief | null | undefined) {
  return node?.name ?? '—'
}
