/** Fluxograma interativo do processo produtivo com os indicadores ancorados em cada etapa.
 *  É o elemento central da navegação: cada etapa física carrega consumo, intensidade e status dos IDEs. */
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import { ArrowRightLeft, Flame, PackageOpen, Recycle, Truck } from 'lucide-react'
import { useCallback, useMemo } from 'react'

import { STATUS_META, statusColor } from '../../lib/colors'
import { fmtAuto, fmtNum, fmtPct } from '../../lib/format'
import type { FlowResponse, FlowNodeDto, StatusCode } from '../../lib/types'
import { cn } from '../ui/primitives'
import { StatusIcon } from '../ui/status'

export type FlowMetric = 'energy' | 'intensity' | 'production' | 'status'

const METRIC_LABEL: Record<FlowMetric, string> = {
  energy: 'Consumo',
  intensity: 'Intensidade',
  production: 'Produção',
  status: 'Status dos IDEs',
}

interface ProcessNodeData extends Record<string, unknown> {
  dto: FlowNodeDto
  metric: FlowMetric
  selected: boolean
  compact: boolean
  onOpen?: (dto: FlowNodeDto) => void
}

function worstStatus(counts?: Record<string, number>): StatusCode | null {
  if (!counts) return null
  const order: StatusCode[] = ['critico', 'atencao', 'sem_dados', 'normal', 'sem_meta', 'sem_operacao']
  return order.find((s) => (counts[s] ?? 0) > 0) ?? null
}

function ProcessNode({ data }: NodeProps<Node<ProcessNodeData>>) {
  const { dto, metric, selected, compact } = data
  const m = dto.metrics
  const status = worstStatus(m?.status_counts)
  const energy = m?.energy.energy_mwh
  const intensity = m?.energy.intensity_kwh_per_unit
  const production = m?.energy.production
  const delta =
    metric === 'intensity' ? m?.intensity_delta_pct : metric === 'production' ? m?.production_delta_pct : m?.energy_delta_pct

  const value =
    metric === 'intensity'
      ? { v: intensity, unit: m?.energy.intensity_unit ?? '' }
      : metric === 'production'
        ? { v: production, unit: m?.energy.production_unit ?? '' }
        : { v: energy, unit: 'MWh' }

  return (
    <div
      className={cn(
        'group relative w-[208px] overflow-hidden rounded-xl border bg-surface text-left shadow-sm transition-shadow',
        selected ? 'border-accent ring-2 ring-[var(--accent)]/30' : 'border-edge hover:shadow-md',
      )}
    >
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <Handle type="target" position={Position.Top} id="t" />
      <Handle type="source" position={Position.Bottom} id="b" />
      {status && <div className="absolute inset-y-0 left-0 w-1" style={{ background: statusColor(status) }} />}
      <div className="px-3 py-2 pl-4">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-[13px] font-semibold text-ink">{dto.label}</p>
          {status && <StatusIcon status={status} size={14} />}
        </div>
        {!compact && (
          <>
            <div className="mt-1.5 flex items-baseline gap-1">
              <span className="num text-[17px] font-semibold text-ink">{fmtAuto(value.v)}</span>
              <span className="text-[11px] text-muted">{value.unit}</span>
              {delta !== null && delta !== undefined && (
                <span
                  className="num ml-auto text-[11px] font-medium"
                  style={{
                    color:
                      (metric === 'production' ? -delta : delta) > 0 ? 'var(--critical-text)' : 'var(--good-text)',
                  }}
                  title={`${METRIC_LABEL[metric]} vs período de comparação`}
                >
                  {fmtPct(delta, 1, true)}
                </span>
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {m &&
                (['critico', 'atencao', 'sem_dados'] as StatusCode[])
                  .filter((s) => (m.status_counts[s] ?? 0) > 0)
                  .map((s) => (
                    <span
                      key={s}
                      className="inline-flex items-center gap-0.5 rounded border px-1 text-[10px] font-medium"
                      style={{ borderColor: STATUS_META[s].color }}
                      title={STATUS_META[s].label}
                    >
                      <StatusIcon status={s} size={10} />
                      {m.status_counts[s]}
                    </span>
                  ))}
              <span className="ml-auto text-[10px] text-muted">
                {m?.uses ?? 0} USEs · {m?.indicators ?? 0} IDEs
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function IoNode({ data }: NodeProps<Node<ProcessNodeData>>) {
  const { dto } = data
  const icon =
    dto.kind === 'link' ? <ArrowRightLeft size={13} /> : dto.kind === 'output' ? <PackageOpen size={13} /> : dto.kind === 'utility' ? <Flame size={13} /> : <Truck size={13} />
  const isResidue = /resíduo|palha|impureza|descarte/i.test(dto.label)
  return (
    <div
      className={cn(
        'flex max-w-[190px] items-center gap-1.5 rounded-full border border-dashed px-3 py-1.5 text-[11px]',
        dto.kind === 'link' ? 'border-accent bg-accent-soft text-accent-ink' : 'border-edge bg-surface-2 text-ink-2',
      )}
      title={dto.kind === 'link' ? 'Abre a outra área' : undefined}
    >
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      {isResidue ? <Recycle size={13} /> : icon}
      <span className="truncate">{dto.label}</span>
    </div>
  )
}

const nodeTypes = { process: ProcessNode, io: IoNode }

export function ProcessFlow({
  flow,
  metric = 'energy',
  selectedId,
  onSelect,
  onOpen,
  compact = false,
  height = 460,
  highlightNodeId,
}: {
  flow: FlowResponse
  metric?: FlowMetric
  selectedId?: number | null
  onSelect?: (dto: FlowNodeDto) => void
  onOpen?: (dto: FlowNodeDto) => void
  compact?: boolean
  height?: number | string
  highlightNodeId?: number | null
}) {
  const { nodes, edges } = useMemo(() => {
    const ordered = [...flow.nodes]
    const autoX = new Map<number, number>()
    ordered.forEach((n, i) => autoX.set(n.id, i * 260))
    const rfNodes: Node<ProcessNodeData>[] = ordered.map((dto) => ({
      id: String(dto.id),
      type: dto.kind === 'process' ? 'process' : 'io',
      position: { x: dto.pos_x ?? autoX.get(dto.id) ?? 0, y: dto.pos_y ?? 0 },
      draggable: false,
      selectable: true,
      data: {
        dto,
        metric,
        compact,
        selected: selectedId === dto.id || (highlightNodeId != null && dto.hierarchy_node_id === highlightNodeId),
        onOpen,
      },
    }))
    const rfEdges: Edge[] = flow.edges.map((e) => {
      const energy = e.stream_type === 'energy'
      const residue = e.stream_type === 'residue'
      const color = energy ? 'var(--s4)' : residue ? 'var(--muted)' : 'var(--ink-2)'
      return {
        id: String(e.id),
        source: String(e.source),
        target: String(e.target),
        label: e.label ?? undefined,
        animated: energy,
        style: {
          stroke: color,
          strokeWidth: energy ? 2.5 : 1.6,
          strokeDasharray: residue ? '4 3' : undefined,
        },
        labelStyle: { fill: 'var(--ink-2)', fontSize: 10 },
        labelBgStyle: { fill: 'var(--surface)' },
        labelBgPadding: [4, 2] as [number, number],
        labelBgBorderRadius: 3,
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
      }
    })
    return { nodes: rfNodes, edges: rfEdges }
  }, [flow, metric, selectedId, compact, onOpen, highlightNodeId])

  const handleClick = useCallback(
    (_: unknown, node: Node) => {
      const dto = (node.data as ProcessNodeData).dto
      onSelect?.(dto)
    },
    [onSelect],
  )

  const handleDouble = useCallback(
    (_: unknown, node: Node) => {
      const dto = (node.data as ProcessNodeData).dto
      onOpen?.(dto)
    },
    [onOpen],
  )

  return (
    <div style={{ height }} className="w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={handleClick}
        onNodeDoubleClick={handleDouble}
        fitView
        fitViewOptions={{ padding: compact ? 0.08 : 0.12, maxZoom: compact ? 0.9 : 1 }}
        minZoom={0.2}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        panOnScroll
        zoomOnScroll={!compact}
        preventScrolling={!compact}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--line)" />
        {!compact && <Controls showInteractive={false} position="bottom-right" />}
      </ReactFlow>
    </div>
  )
}

export function FlowLegend({ metric }: { metric?: FlowMetric }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-[11px] text-muted">
      <span className="inline-flex items-center gap-1.5">
        <svg width="26" height="8" aria-hidden>
          <line x1="0" y1="4" x2="26" y2="4" stroke="var(--ink-2)" strokeWidth="1.6" />
        </svg>
        Fluxo de material
      </span>
      <span className="inline-flex items-center gap-1.5">
        <svg width="26" height="8" aria-hidden>
          <line x1="0" y1="4" x2="26" y2="4" stroke="var(--s4)" strokeWidth="2.5" strokeDasharray="5 3" />
        </svg>
        Fluxo de energia (vapor, combustível)
      </span>
      <span className="inline-flex items-center gap-1.5">
        <svg width="26" height="8" aria-hidden>
          <line x1="0" y1="4" x2="26" y2="4" stroke="var(--muted)" strokeWidth="1.6" strokeDasharray="4 3" />
        </svg>
        Resíduo / subproduto
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-3 w-1 rounded-sm" style={{ background: 'var(--critical)' }} />
        Barra lateral = pior status dos IDEs da etapa
      </span>
      {metric && <span className="ml-auto">Métrica exibida: {METRIC_LABEL[metric]}</span>}
    </div>
  )
}

export function flowMetricOptions() {
  return (Object.keys(METRIC_LABEL) as FlowMetric[]).map((m) => ({ value: m, label: METRIC_LABEL[m] }))
}

export function summarizeFlow(flow: FlowResponse) {
  const processes = flow.nodes.filter((n) => n.kind === 'process' && n.metrics)
  const total = processes.reduce((acc, n) => acc + (n.metrics?.energy.energy_mwh ?? 0), 0)
  return {
    processes,
    total,
    table: {
      columns: ['Etapa', 'Consumo (MWh)', 'Δ %', 'Produção', 'Intensidade', 'IDEs fora da meta'],
      rows: processes.map((n) => [
        n.label,
        n.metrics?.energy.energy_mwh ?? null,
        n.metrics?.energy_delta_pct != null ? fmtPct(n.metrics.energy_delta_pct, 1, true) : null,
        n.metrics?.energy.production != null
          ? `${fmtNum(n.metrics.energy.production, 0)} ${n.metrics.energy.production_unit ?? ''}`
          : null,
        n.metrics?.energy.intensity_kwh_per_unit != null
          ? `${fmtAuto(n.metrics.energy.intensity_kwh_per_unit)} ${n.metrics.energy.intensity_unit ?? ''}`
          : null,
        (n.metrics?.status_counts.critico ?? 0) + (n.metrics?.status_counts.atencao ?? 0),
      ]),
    },
  }
}
