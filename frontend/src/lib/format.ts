/** Formatação pt-BR de números, datas e variações. */

export const EMPTY = '—'

export function fmtNum(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return EMPTY
  return value.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

/** Reduz casas conforme a magnitude — evita "0,000" e "12.345,678" na mesma tabela. */
export function fmtAuto(value: number | null | undefined, decimals?: number): string {
  if (value === null || value === undefined || Number.isNaN(value)) return EMPTY
  if (decimals !== undefined) return fmtNum(value, decimals)
  const abs = Math.abs(value)
  if (abs >= 1000) return fmtNum(value, 0)
  if (abs >= 100) return fmtNum(value, 1)
  if (abs >= 1) return fmtNum(value, 2)
  return fmtNum(value, 3)
}

/** Rótulo de eixo: inteiros sem casas, decimais só quando a escala exige. */
export function fmtAxis(value: number): string {
  if (!Number.isFinite(value)) return ''
  if (value === 0) return '0'
  const abs = Math.abs(value)
  if (abs >= 1000) return fmtNum(value, 0)
  if (abs >= 10) return fmtNum(value, Number.isInteger(value) ? 0 : 1)
  if (abs >= 1) return fmtNum(value, Number.isInteger(value) ? 0 : 1)
  return fmtNum(value, 2)
}

export function fmtCompact(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return EMPTY
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${fmtNum(value / 1_000_000, decimals)} mi`
  if (abs >= 10_000) return `${fmtNum(value / 1000, decimals)} mil`
  return fmtNum(value, abs >= 100 ? 0 : decimals)
}

export function fmtPct(value: number | null | undefined, decimals = 1, signed = false): string {
  if (value === null || value === undefined || Number.isNaN(value)) return EMPTY
  const s = signed && value > 0 ? '+' : ''
  return `${s}${fmtNum(value, decimals)}%`
}

export function fmtMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return EMPTY
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return EMPTY
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

export function fmtDateFull(iso: string | null | undefined): string {
  if (!iso) return EMPTY
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`)
  return d.toLocaleDateString('pt-BR')
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return EMPTY
  const d = new Date(iso)
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function fmtValue(value: number | null | undefined, unit?: string | null, decimals?: number): string {
  if (value === null || value === undefined) return EMPTY
  return `${fmtAuto(value, decimals)}${unit ? ` ${unit}` : ''}`
}

export const REGIME_LABEL: Record<string, string> = {
  continuous_24x7: 'Contínuo 24×7',
  intermittent: 'Intermitente',
  batch: 'Por batelada',
  seasonal: 'Sazonal',
}

export const OPPORTUNITY_STATUS: Record<string, string> = {
  identificada: 'Identificada',
  em_analise: 'Em análise',
  aprovada: 'Aprovada',
  em_implementacao: 'Em implementação',
  implementada: 'Implementada',
  verificada: 'Verificada (M&V)',
  cancelada: 'Cancelada',
}

export const PRIORITY_LABEL: Record<string, string> = { alta: 'Alta', media: 'Média', baixa: 'Baixa' }

export const KIND_LABEL: Record<string, string> = { intrinsic: 'Intrínseco', extrinsic: 'Extrínseco' }

export const LEVEL_LABEL: Record<string, string> = {
  company: 'Empresa',
  plant: 'Planta',
  area: 'Área',
  process: 'Processo',
  subprocess: 'Subprocesso',
  use: 'USE',
  equipment: 'Equipamento',
}

export const TREND_LABEL: Record<string, string> = {
  melhoria: 'Melhoria',
  deterioracao: 'Deterioração',
  estavel: 'Estável',
  aumento: 'Aumento',
  reducao: 'Redução',
  insuficiente: 'Dados insuficientes',
}

export const CHANGE_LABEL: Record<string, string> = {
  melhoria: 'Melhorou',
  piora: 'Piorou',
  estavel: 'Estável',
  aumento: 'Aumentou',
  reducao: 'Reduziu',
  indefinido: 'Sem comparação',
}

export const VARIABLE_TYPE_LABEL: Record<string, string> = {
  energy: 'Energia',
  energy_state: 'Energia por estado',
  production: 'Produção',
  operational: 'Operacional',
  electrical: 'Elétrica',
  process_condition: 'Condição de processo',
  context: 'Contexto',
}

export const METHOD_LABEL: Record<string, string> = {
  measured: 'Medido',
  estimated: 'Estimado',
  calculated: 'Calculado',
}

export const AGGREGATION_LABEL: Record<string, string> = {
  sum: 'soma',
  avg: 'média',
  min: 'mínimo',
  max: 'máximo',
  last: 'último',
  count: 'contagem de dias',
}
