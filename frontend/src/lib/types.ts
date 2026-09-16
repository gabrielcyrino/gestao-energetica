/** Tipos espelhando os contratos da API (OpenAPI em /docs). */

export type StatusCode = 'normal' | 'atencao' | 'critico' | 'sem_dados' | 'sem_operacao' | 'sem_meta'
export type ChangeClass = 'melhoria' | 'piora' | 'estavel' | 'aumento' | 'reducao' | 'indefinido'
export type TrendClass = 'melhoria' | 'deterioracao' | 'estavel' | 'aumento' | 'reducao' | 'insuficiente'
export type Direction = 'lower_better' | 'higher_better' | 'target_range' | 'none'
export type Role = 'admin' | 'energy_manager' | 'process_owner' | 'viewer'

export interface User {
  id: number
  username: string
  display_name: string
  role: Role
  role_label: string
  can_edit_master_data: boolean
  scope_paths: string[]
}

export interface PeriodInfo {
  spec: string
  kind: string
  label: string
  short_label: string
  start: string
  end: string
  eff_start: string
  eff_end: string
  days: number
  partial: boolean
  aligned: boolean
  season_type?: string
}

export interface PeriodOptions {
  data_start: string
  data_end: string
  default: string
  week: PeriodInfo[]
  month: PeriodInfo[]
  year: PeriodInfo[]
  crop_year: PeriodInfo[]
  season: PeriodInfo[]
}

export interface NodeBrief {
  id: number
  code: string
  name: string
  level: string
  parent_id: number | null
  color_slot: number | null
}

export interface TreeNode extends NodeBrief {
  path: string
  uses: number
  equipment: number
  indicators: number
  children: TreeNode[]
}

export interface CarrierBreakdown {
  carrier: string
  name: string
  kind: 'boundary' | 'internal'
  color_slot: number
  mwh: number
  native: number
  unit: string
}

export interface EnergySummary {
  node_id: number
  energy_mwh: number | null
  boundary_mwh: number
  internal_mwh: number
  by_carrier: CarrierBreakdown[]
  production: number | null
  production_unit: string | null
  production_name: string | null
  intensity_kwh_per_unit: number | null
  intensity_unit: string | null
  completeness_pct: number | null
  metering: string
}

export interface Decomposition {
  delta_energy: number
  production_effect: number
  intensity_effect: number
  intensity_before: number
  intensity_after: number
}

export interface EnergyCompare {
  current: EnergySummary
  previous: EnergySummary
  energy_delta_pct: number | null
  production_delta_pct: number | null
  intensity_delta_pct: number | null
  decomposition: Decomposition | null
}

export type StatusCounts = Record<StatusCode, number>

export interface Component {
  symbol: string
  source_type: string
  value: number | null
  unit: string | null
  aggregation: string | null
  variable_id: number | null
  variable_code: string | null
  variable_name: string | null
  variable_type: string | null
  completeness_pct: number | null
  days_with_data?: number | null
  expected_days?: number | null
}

export interface Evaluation {
  indicator_id: number
  value: number | null
  reason: string | null
  completeness_pct: number
  status: StatusCode
  status_label: string
  status_explanation: string
  deviation_pct: number | null
  target: number | null
  target_min: number | null
  target_max: number | null
  baseline: number | null
  deviation_target_pct: number | null
  deviation_baseline_pct: number | null
  expected_days: number
  operating_days: number | null
  components?: Component[]
}

export interface IndicatorBrief {
  id: number
  code: string
  name: string
  description: string | null
  kind: 'intrinsic' | 'extrinsic'
  category: string
  level: 'process' | 'use' | 'equipment'
  formula: string
  unit: string
  unit_id: number
  frequency: string
  direction: Direction
  decimals: number
  node: NodeBrief | null
  area: NodeBrief | null
  process: NodeBrief | null
  use: { id: number; code: string; name: string; category: CategoryBrief | null } | null
  equipment: { id: number; tag: string; name: string } | null
  responsible: Person | null
  data_sources: string[]
  collection: string
  template_id: number | null
  active: boolean
}

export interface IndicatorRow extends IndicatorBrief {
  current: Evaluation
  previous: Evaluation | null
  delta: number | null
  delta_pct: number | null
  change_class: ChangeClass
  open_opportunities: number
  spark?: (number | null)[]
  bindings?: BindingBrief[]
}

export interface BindingBrief {
  symbol: string
  source_type: string
  variable: string | null
  aggregation: string | null
  constant_value: number | null
  attribute: string | null
  builtin: string | null
}

export interface Binding {
  id?: number
  symbol: string
  source_type: 'variable' | 'constant' | 'equipment_attribute' | 'builtin'
  variable_id: number | null
  variable?: Variable | null
  aggregation: string | null
  unit_id: number | null
  unit?: string | null
  constant_value: number | null
  attribute: string | null
  builtin: string | null
}

export interface Target {
  id?: number
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

export interface IndicatorDetail extends IndicatorBrief {
  path: NodeBrief[]
  status_rule: { basis?: string; tolerance_pct?: number; critical_pct?: number }
  upper_limit: number | null
  lower_limit: number | null
  min_completeness_pct: number
  stability_band_pct: number
  operating_variable: Variable | null
  operating_variable_id: number | null
  baseline_model_id: number | null
  baseline_model: Baseline | null
  data_origin_note: string | null
  template: { id: number; code: string; name: string } | null
  bindings: Binding[]
  targets: Target[]
}

export interface CategoryBrief {
  id: number
  code: string
  name: string
  icon: string | null
  color_slot: number
}

export interface Person {
  id: number
  name: string
  role_title: string | null
  email: string | null
}

export interface CarrierBrief {
  id: number
  code: string
  name: string
  kind: 'boundary' | 'internal'
  color_slot: number
  unit: string
}

export interface Variable {
  id: number
  code: string
  name: string
  variable_type: string
  unit: string
  unit_id: number
  node: NodeBrief | null
  equipment: { id: number; tag: string; name: string } | null
  carrier: CarrierBrief | null
  data_source: { id: number; code: string; name: string; kind: string; protocol: string | null; is_automatic: boolean } | null
  source_tag: string | null
  collection_frequency: string
  is_automatic: boolean
  measurement_method: string
  aggregation: string
  counts_toward_total: boolean
  notes: string | null
  rationale?: string | null
}

export interface VariableQuality extends Variable {
  days_with_data: number
  expected_days: number
  completeness_pct: number
  quality_breakdown: Record<string, number>
  suspect_or_bad_pct: number
  last_value_at: string | null
  quality_status: 'normal' | 'atencao' | 'sem_dados'
}

export interface Equipment {
  id: number
  tag: string
  name: string
  equipment_type: string
  manufacturer: string | null
  model: string | null
  rated_power_kw: number | null
  rated_efficiency_pct: number | null
  efficiency_class: string | null
  has_vfd: boolean
  commissioning_year: number | null
  attributes: Record<string, string | number | boolean>
  active: boolean
  use: { id: number; code: string; name: string; category: CategoryBrief | null } | null
  node: NodeBrief | null
  path?: NodeBrief[]
  area?: NodeBrief | null
  process?: NodeBrief | null
  variables?: Variable[]
  mwh?: number | null
  previous_mwh?: number | null
  delta_pct?: number | null
}

export interface Use {
  id: number
  code: string
  name: string
  description: string | null
  category: CategoryBrief | null
  node: NodeBrief | null
  area: NodeBrief | null
  process: NodeBrief | null
  carrier: CarrierBrief | null
  operating_regime: string
  operating_period: string | null
  significance_reason: string | null
  responsible: Person | null
  active: boolean
  installed_power_kw: number | null
  equipment_count: number
  path?: NodeBrief[]
  equipment?: Equipment[]
  relevant_variables?: Variable[]
  mwh?: number | null
  share_pct?: number | null
  previous_mwh?: number | null
  delta_pct?: number | null
}

export interface UseEnergyRow {
  use_id: number
  code: string
  name: string
  node_id: number
  node_name: string | null
  category_id: number
  category: string
  category_code: string
  color_slot: number
  operating_regime: string
  mwh: number
  carriers: string[]
  equipment_count: number
  internal: boolean
  share_pct: number | null
  previous_mwh?: number | null
  delta_pct?: number | null
  worst_status?: StatusCode | null
  indicator_count?: number
}

export interface FlowNodeDto {
  id: number
  kind: 'process' | 'input' | 'output' | 'storage' | 'utility' | 'link'
  label: string
  hierarchy_node_id: number | null
  linked_node_id: number | null
  pos_x: number | null
  pos_y: number | null
  node: NodeBrief | null
  linked_node: NodeBrief | null
  metrics: {
    energy: EnergySummary
    previous: EnergySummary
    energy_delta_pct: number | null
    production_delta_pct: number | null
    intensity_delta_pct: number | null
    status_counts: StatusCounts
    indicators: number
    uses: number
  } | null
}

export interface FlowEdgeDto {
  id: number
  source: number
  target: number
  stream_type: 'material' | 'energy' | 'residue'
  label: string | null
  carrier: CarrierBrief | null
}

export interface FlowResponse {
  node: NodeBrief
  auto_generated: boolean
  nodes: FlowNodeDto[]
  edges: FlowEdgeDto[]
}

export interface HistoryPoint {
  start: string
  end: string
  label: string
  value: number | null
  reason: string | null
  completeness_pct: number
  status: StatusCode
  target: number | null
  baseline: number | null
  components: Record<string, number | null>
  moving_avg: number | null
  trend: number | null
  out_of_control: boolean
}

export interface History {
  indicator: IndicatorBrief
  start: string
  end: string
  grain: string
  moving_average_window: number
  points: HistoryPoint[]
  trend: { classification: TrendClass; slope_per_bucket: number | null; relative_change_pct: number | null; r2: number | null; n: number }
  control: {
    applicable: boolean
    reason: string | null
    center: number | null
    ucl: number | null
    lcl: number | null
    out_of_control_count: number
    shift_detected_at: string | null
  }
}

export interface Diagnostic {
  type: 'desvio' | 'deterioracao' | 'contexto' | 'qualidade_dados'
  severity: StatusCode
  title: string
  explanation: string
  indicator_id?: number
  indicator?: string
  code?: string
  unit?: string
  value?: number | null
  target?: number | null
  baseline?: number | null
  deviation_pct?: number | null
  delta_pct?: number | null
  status?: StatusCode
  decimals?: number
  node?: NodeBrief | null
  use?: { id: number; name: string } | null
  equipment?: { id: number; tag: string; name: string } | null
  open_opportunities?: number
  behavior_change_since?: string
  trend?: TrendClass
}

export interface EnergySeries {
  grain: string
  buckets: { start: string; end: string; label: string }[]
  groups: { key: string; name: string; color_slot: number | null; values: (number | null)[] }[]
  total: (number | null)[]
  production: (number | null)[] | null
  production_unit: string | null
  intensity: (number | null)[] | null
}

export interface Baseline {
  id: number
  code: string
  name: string
  scope_level: string
  model_type: string
  node: NodeBrief | null
  use_id: number | null
  equipment_id: number | null
  energy_variable: { id: number; code: string; name: string; unit: string } | null
  period_start: string
  period_end: string
  status: string
  notes: string | null
  model: {
    variables?: Record<string, number>
    variable_details?: Record<string, { id: number; code: string; name: string; unit: string }>
    intercept?: number
    coefficients?: Record<string, number>
    r2?: number
    adj_r2?: number
    cv_rmse_pct?: number
    n?: number
    t_stats?: Record<string, number>
    acceptance?: { r2_ok: boolean; cv_rmse_ok: boolean; note: string }
  }
}

export interface BaselineEvaluation {
  baseline: Baseline
  unit: string | null
  grain: string
  points: {
    start: string
    end: string
    label: string
    observed: number | null
    expected: number | null
    difference: number | null
    difference_pct?: number | null
    cusum: number
    days: number
  }[]
  daily: Record<string, number | string>[]
  total_observed: number
  total_expected: number
  savings: number
  savings_pct: number | null
  operating_days: number
}

export interface Opportunity {
  id: number
  code: string
  title: string
  node_id: number
  use_id: number | null
  equipment_id: number | null
  indicator_id: number | null
  problem: string
  opportunity: string
  reference_consumption: number | null
  reference_unit: string | null
  estimated_savings_mwh_year: number | null
  estimated_savings_brl_year: number | null
  estimated_investment_brl: number | null
  priority: 'alta' | 'media' | 'baixa'
  status: string
  due_date: string | null
  notes: string | null
  deviation_snapshot: Record<string, unknown> | null
  created_at: string
  node: NodeBrief | null
  area: NodeBrief | null
  use: { id: number; name: string } | null
  equipment: { id: number; tag: string; name: string } | null
  indicator: { id: number; code: string; name: string; unit: string } | null
  responsible: Person | null
}

export interface Meta {
  app_name: string
  environment: string
  demo: boolean
  data_notice: string
  reference_energy_unit: string
  periods: PeriodOptions
  statuses: { code: StatusCode; label: string }[]
  levels: { code: string; name: string; depth: number; has_flow: boolean; allows_uses: boolean }[]
  carriers: { id: number; code: string; name: string; kind: string; color_slot: number; kwh_per_unit: number; unit_id: number; description: string | null }[]
  use_categories: { id: number; code: string; name: string; icon: string | null; color_slot: number; sort_order: number; description: string | null }[]
  units: { id: number; symbol: string; name: string; quantity: string; factor_to_base: number }[]
  data_sources: { id: number; code: string; name: string; kind: string; protocol: string | null; is_automatic: boolean }[]
  people: Person[]
  formula: { functions: Record<string, string>; builtins: Record<string, string>; aggregations: string[]; operators: string[] }
  roles: Record<string, string>
}

export interface DashboardOverview {
  node: NodeBrief
  period: PeriodInfo
  comparison_period: PeriodInfo
  energy: EnergyCompare
  areas: ({ node: NodeBrief; status_counts: StatusCounts; indicator_count: number } & EnergyCompare)[]
  processes: ({ node: NodeBrief; area: NodeBrief | null; status_counts: StatusCounts; indicator_count: number; worst_status: StatusCode | null } & EnergyCompare)[]
  carriers: { current: CarrierBreakdown[]; previous: CarrierBreakdown[] }
  uses: UseEnergyRow[]
  use_categories: { category_id: number; name: string; code: string; color_slot: number; mwh: number; uses: number; share_pct: number | null }[]
  unallocated: { carrier: string; name: string; measured_mwh: number; allocated_mwh: number; unallocated_mwh: number; inconsistent: boolean }[]
  status_counts: StatusCounts
  indicator_count: number
  off_target: IndicatorRow[]
  worsening: IndicatorRow[]
  improving: IndicatorRow[]
  energy_series: EnergySeries
  carrier_series: EnergySeries
  intensity_heatmap: { node: NodeBrief; unit: string | null; cells: { label: string; start: string; value: number | null; yoy_pct: number | null }[] }[]
  opportunities: { open: number; total: number; savings_mwh_year: number }
}

export interface CompareResponse {
  scope: { type: string; id: number; name: string; node: NodeBrief }
  period: PeriodInfo
  comparison_period: PeriodInfo
  energy: EnergyCompare
  children: ({ node: NodeBrief } & EnergyCompare)[]
  uses: UseEnergyRow[]
  indicators: IndicatorRow[]
  status_counts: StatusCounts
  overlay: { grain: string; current: EnergySeries; previous: EnergySeries }
  diagnostics: Diagnostic[]
}

export interface TrendItem extends Pick<IndicatorBrief, 'id' | 'code' | 'name' | 'unit' | 'kind' | 'category' | 'direction' | 'decimals' | 'node' | 'area' | 'process' | 'use' | 'equipment' | 'level'> {
  current: Evaluation
  previous: Evaluation | null
  delta_pct: number | null
  change_class: ChangeClass
  trend: History['trend']
  control: History['control']
  series: { label: string; start: string; value: number | null; target: number | null; out_of_control: boolean; moving_avg: number | null }[]
}

export interface MatrixProcessUse {
  period: PeriodInfo
  categories: CategoryBrief[]
  rows: {
    node: NodeBrief
    area: NodeBrief | null
    total_mwh: number
    cells: Record<
      string,
      {
        uses: { id: number; name: string; code: string; node: string | null; mwh: number; regime: string }[]
        mwh: number
        equipment: number
        share_pct: number | null
        worst_status: StatusCode | null
      }
    >
  }[]
}

export interface SankeyData {
  nodes: { name: string; kind: string; ref?: number | null; color_slot?: number | null }[]
  links: { source: string; target: string; value: number; carrier?: string | null }[]
  unit?: string
  period?: PeriodInfo
}
