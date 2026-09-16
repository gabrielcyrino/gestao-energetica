/** Metodologia: como a energia é conectada ao processo produtivo nesta aplicação.
 *  Página de apoio (sem dados) — serve de referência para os donos de processo. */
import {
  AlertOctagon,
  ArrowRight,
  BookOpen,
  Database,
  Factory,
  Gauge,
  GitCompareArrows,
  Lightbulb,
  LineChart,
  Network,
  Ruler,
  Sigma,
  Target,
  TrendingUp,
  Workflow,
  Wrench,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'

import { Page, PageHeader } from '../components/layout/AppShell'
import { Badge, Card, CardHeader } from '../components/ui/primitives'
import { StatusPill } from '../components/ui/status'
import { useFilters } from '../lib/hooks'

interface Step {
  icon: ReactNode
  title: string
  description: string
  example: string
}

const CHAIN: Step[] = [
  {
    icon: <Factory size={16} />,
    title: 'Processo',
    description: 'Etapa produtiva onde a energia é demandada.',
    example: 'Recebimento → Secador',
  },
  {
    icon: <Workflow size={16} />,
    title: 'Subprocesso',
    description: 'Recorte interno quando a etapa tem operações distintas.',
    example: 'Tratamento → Preparo de calda / Aplicação',
  },
  {
    icon: <Network size={16} />,
    title: 'USE',
    description: 'Uso Significativo de Energia presente naquele processo.',
    example: 'Sistema de ventilação do secador',
  },
  {
    icon: <Wrench size={16} />,
    title: 'Equipamento',
    description: 'Ativo físico que realiza o uso, com dados de placa.',
    example: 'Motor ventilador 01 — 75 kW, IE3',
  },
  {
    icon: <Database size={16} />,
    title: 'Variável',
    description: 'Tag medida, calculada ou apontada (energia, horas, produção, umidade).',
    example: 'Energia ativa (kWh), horas em operação, t processadas',
  },
  {
    icon: <Gauge size={16} />,
    title: 'Indicador intrínseco',
    description: 'Desempenho do próprio equipamento, independente do processo.',
    example: 'Fator de carga 78%, fator de potência 0,87',
  },
  {
    icon: <Ruler size={16} />,
    title: 'Contexto operacional',
    description: 'Como o equipamento é usado: regime, horas, produção, condições.',
    example: '24 h/dia na safra; grão entrando com 33% de umidade',
  },
  {
    icon: <Sigma size={16} />,
    title: 'Indicador extrínseco',
    description: 'Desempenho energético relativo ao uso no processo.',
    example: 'kWh/t, % do tempo em vazio, kWh por lote',
  },
  {
    icon: <LineChart size={16} />,
    title: 'Análise temporal',
    description: 'Histórico, média móvel, tendência e comparação entre períodos.',
    example: 'Semana × semana, safra × safra, Crop Year × Crop Year',
  },
  {
    icon: <AlertOctagon size={16} />,
    title: 'Desvio',
    description: 'Afastamento da meta/baseline ou mudança de comportamento.',
    example: 'kWh/t 24,6% acima da meta desde 20/07',
  },
  {
    icon: <Lightbulb size={16} />,
    title: 'Oportunidade',
    description: 'Ação de melhoria com economia estimada e responsável.',
    example: 'Liberar damper travado e avaliar inversor',
  },
]

function Section({ title, subtitle, icon, children }: { title: string; subtitle?: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} icon={icon} />
      <div className="px-4 py-3 text-[13px] leading-relaxed text-ink-2">{children}</div>
    </Card>
  )
}

export function MethodologyPage() {
  const filters = useFilters()
  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Sistema' }, { label: 'Metodologia' }]}
        title="Metodologia: energia conectada ao processo"
        subtitle="Como os Usos Significativos de Energia e os Indicadores de Desempenho Energético (IDEs) são organizados nesta aplicação."
        badges={
          <>
            <Badge color="var(--warning)">DEMO · dados fictícios</Badge>
            <Badge color="var(--muted)">ISO 50001 como referencial</Badge>
          </>
        }
      />

      <Page>
        <Section
          title="Princípio"
          icon={<BookOpen size={15} />}
          subtitle="O indicador só significa alguma coisa quando está ancorado na etapa física que consome a energia"
        >
          <p>
            Todo indicador desta plataforma nasce de uma etapa do processo produtivo. A pergunta que a aplicação responde não é
            apenas <i>“quanta energia foi consumida?”</i>, e sim <b>onde</b> a energia é usada, <b>por que</b> é usada,{' '}
            <b>qual equipamento</b> a consome, <b>como medir</b> seu desempenho e <b>como esse desempenho evolui</b> ao longo do tempo.
          </p>
          <p className="mt-2">
            A ISO 50001 é utilizada como <b>referencial metodológico e fonte de boas práticas</b> — a identificação dos USEs, a
            definição de IDEs, linhas de base e variáveis relevantes seguem essa lógica. Não há objetivo de certificação, e nenhuma
            funcionalidade aqui pressupõe auditoria.
          </p>
        </Section>

        <Card>
          <CardHeader
            title="A cadeia metodológica"
            subtitle="Do processo produtivo até a oportunidade de melhoria — o caminho percorrido por cada IDE"
            icon={<Workflow size={15} />}
          />
          <div className="grid gap-2 px-4 py-4 md:grid-cols-2 xl:grid-cols-3">
            {CHAIN.map((step, i) => (
              <div key={step.title} className="flex gap-3 rounded-lg border border-edge bg-surface-2 p-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface text-accent-ink">
                  {step.icon}
                </div>
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                    <span className="num text-[11px] text-muted">{String(i + 1).padStart(2, '0')}</span>
                    {step.title}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-2">{step.description}</p>
                  <p className="mt-1 text-[11px] text-muted">
                    <b>Exemplo:</b> {step.example}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <p className="border-t border-edge px-4 py-2 text-[11px] text-muted">
            O exemplo completo pode ser percorrido na aplicação: Recebimento → Secador → Sistema de ventilação → Motor ventilador 01
            → kWh/t → histórico.
          </p>
        </Card>

        <div className="grid gap-4 xl:grid-cols-2">
          <Section
            title="Indicador intrínseco × extrínseco"
            icon={<Gauge size={15} />}
            subtitle="Duas perguntas diferentes sobre o mesmo equipamento"
          >
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-edge p-3">
                <p className="mb-1 text-[13px] font-semibold text-ink">Intrínseco</p>
                <p className="text-xs">
                  Depende das características técnicas e do estado do equipamento. Responde: <i>“o equipamento está operando bem?”</i>
                </p>
                <ul className="mt-2 list-inside list-disc text-xs text-muted">
                  <li>Fator de carga (%)</li>
                  <li>Fator de potência</li>
                  <li>Corrente média e horas de funcionamento</li>
                  <li>Rendimento térmico da caldeira</li>
                  <li>Consumo em vazio</li>
                </ul>
              </div>
              <div className="rounded-lg border border-edge p-3">
                <p className="mb-1 text-[13px] font-semibold text-ink">Extrínseco</p>
                <p className="text-xs">
                  Depende de como o equipamento é usado dentro do processo. Responde: <i>“o processo usa bem esse equipamento?”</i>
                </p>
                <ul className="mt-2 list-inside list-disc text-xs text-muted">
                  <li>kWh por tonelada, por lote ou por mil sacos</li>
                  <li>% do tempo ligado sem produto</li>
                  <li>Horas de operação por tonelada</li>
                  <li>Consumo em horas sem produção</li>
                  <li>Partidas por dia e utilização (24×7 × intermitente)</li>
                </ul>
              </div>
            </div>
            <p className="mt-3 text-xs">
              Um motor que precisa operar 24 h por dia tem pouca oportunidade em redução de horas; um motor intermitente pode ter
              ganhos expressivos em sequenciamento, intertravamento e eliminação de operação em vazio. Por isso o regime operacional
              é um atributo do USE.
            </p>
          </Section>

          <Section
            title="Como um indicador é definido"
            icon={<Sigma size={15} />}
            subtitle="Fórmula em texto + vínculos de símbolos — sem código"
          >
            <p>
              O motor de cálculo lê a <b>fórmula</b> cadastrada e resolve cada símbolo por um vínculo: variável (com agregação e
              unidade), constante, atributo de placa do equipamento ou função do período.
            </p>
            <div className="mt-3 rounded-lg border border-edge bg-surface-2 p-3 text-xs">
              <p className="num text-[13px] font-semibold text-ink">E / P</p>
              <ul className="mt-2 space-y-1 text-muted">
                <li>
                  <b>E</b> → Energia ativa do CCM do Secador (kWh), agregação <i>soma</i>
                </li>
                <li>
                  <b>P</b> → Grão seco produzido (t), agregação <i>soma</i>
                </li>
                <li>Unidade do indicador: kWh/t · direção desejada: menor é melhor</li>
              </ul>
            </div>
            <p className="mt-3 text-xs">
              O valor do período é sempre <b>Σ numerador ÷ Σ denominador</b> — nunca a média das razões diárias, que produziria um
              número diferente e sem significado físico. Cada símbolo tem sua própria regra de agregação (soma, média, mínimo,
              máximo, último, contagem) e pode ser convertido de unidade antes do cálculo.
            </p>
            <p className="mt-2 text-xs">
              Novos indicadores são criados em <Link className="text-accent-ink hover:underline" to={filters.link('/configuracoes')}>Configurações</Link>{' '}
              e passam a ser calculados imediatamente, sem alterar a aplicação.
            </p>
          </Section>
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          <Section title="Metas e status" icon={<Target size={15} />} subtitle="Sem limites universais: cada IDE tem a sua regra">
            <p className="text-xs">
              Cada indicador guarda metas versionadas no tempo, com dois escopos:
            </p>
            <ul className="mt-2 list-inside list-disc text-xs text-muted">
              <li>
                <b>Meta anual</b> (Crop Year) — usada em períodos longos.
              </li>
              <li>
                <b>Meta por janela de safra</b> — usada em períodos curtos, porque a intensidade de uma safrinha de baixo volume não
                deve ser julgada pela média do ano.
              </li>
            </ul>
            <p className="mt-2 text-xs">
              O status vem de uma regra configurável por indicador (tolerância e limite crítico, em % sobre meta ou baseline), mais
              limites operacionais absolutos quando existirem:
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <StatusPill status="normal" />
              <StatusPill status="atencao" />
              <StatusPill status="critico" />
              <StatusPill status="sem_dados" />
              <StatusPill status="sem_operacao" />
              <StatusPill status="sem_meta" />
            </div>
          </Section>

          <Section title="Qualidade do dado" icon={<Database size={15} />} subtitle="Ausência de dado nunca vira zero">
            <ul className="list-inside list-disc text-xs text-muted">
              <li>
                Cada indicador mostra <b>completude</b> (dias com dado ÷ dias esperados) e só recebe status quando atinge o mínimo
                configurado.
              </li>
              <li>
                Dia sem leitura <b>não</b> é zero: reduz a completude e pode invalidar o período.
              </li>
              <li>
                Equipamento parado ou etapa sem produção é <b>“Sem operação”</b> — situação operacional, não falha de medição.
              </li>
              <li>Origem, frequência, método (medido, estimado, calculado) e última atualização ficam visíveis em cada variável.</li>
              <li>
                A diferença entre o medidor geral e a soma das submedições aparece como <b>consumo não alocado</b>.
              </li>
            </ul>
            <p className="mt-2 text-xs">
              Visão completa em{' '}
              <Link className="text-accent-ink hover:underline" to={filters.link('/qualidade')}>
                Qualidade dos dados
              </Link>
              .
            </p>
          </Section>

          <Section title="Linha de base e consumo esperado" icon={<TrendingUp size={15} />} subtitle="Normalização por variáveis relevantes">
            <p className="text-xs">
              Para os usos em que existe relação estatística clara, a aplicação ajusta um modelo de regressão no período de
              referência:
            </p>
            <p className="num mt-2 rounded-md border border-edge bg-surface-2 p-2 text-[12px] text-ink">
              consumo esperado = a + b × variável relevante
            </p>
            <p className="mt-2 text-xs">
              Exemplo: o vapor do secador é explicado pela <b>água removida</b> (massa × diferença de umidade). Assim é possível
              comparar <b>observado × esperado</b> e acumular a diferença (CUSUM) — uma safra com grão mais úmido consome mais vapor
              sem que isso seja piora de eficiência.
            </p>
            <p className="mt-2 text-xs">Qualidade do ajuste é reportada (R² e CV(RMSE)) para uso consciente do modelo.</p>
          </Section>
        </div>

        <Section
          title="Comparar períodos sem enganar a leitura"
          icon={<GitCompareArrows size={15} />}
          subtitle="Decomposição LMDI: volume de produção × eficiência"
        >
          <p className="text-xs">
            Ao comparar dois períodos, a variação de consumo é decomposta em duas parcelas que somam exatamente a diferença total:
          </p>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <div className="rounded-lg border border-edge p-3 text-xs">
              <p className="font-semibold text-ink" style={{ color: 'var(--s1)' }}>
                Efeito produção
              </p>
              <p className="mt-1 text-muted">Parcela explicada por processar mais (ou menos) toneladas, lotes ou sacos.</p>
            </div>
            <div className="rounded-lg border border-edge p-3 text-xs">
              <p className="font-semibold text-ink">Efeito intensidade</p>
              <p className="mt-1 text-muted">Parcela explicada pela mudança de eficiência — é aqui que a gestão atua.</p>
            </div>
          </div>
          <p className="mt-3 text-xs">
            Períodos em andamento são recortados na última data com dados e comparados em <b>base equivalente</b> (mesmo número de
            dias decorridos). Crop Year e safra são entidades configuráveis, com datas próprias — nada assume ano civil, e uma
            safrinha é sempre comparada com a safrinha anterior.
          </p>
          <p className="mt-2 text-xs">
            Ferramenta completa em{' '}
            <Link className="text-accent-ink hover:underline" to={filters.link('/comparacoes')}>
              Comparações
            </Link>
            .
          </p>
        </Section>

        <Card>
          <CardHeader title="Por onde navegar" subtitle="Cada tela responde a uma pergunta da metodologia" icon={<ArrowRight size={15} />} />
          <div className="grid gap-2 px-4 py-3 md:grid-cols-2 xl:grid-cols-3">
            {[
              { to: '/', label: 'Dashboard geral', hint: 'Onde a energia está sendo usada agora' },
              { to: '/uses', label: 'USEs e matriz Processo × USE', hint: 'Quais usos significativos existem em cada etapa' },
              { to: '/indicadores', label: 'Matriz de indicadores', hint: 'Fórmula, unidade, origem, frequência, meta e responsável' },
              { to: '/tendencias', label: 'Tendências', hint: 'O que está melhorando, piorando ou mudou de comportamento' },
              { to: '/comparacoes', label: 'Comparações', hint: 'Semana, mês, ano, Crop Year, safra e períodos livres' },
              { to: '/oportunidades', label: 'Oportunidades', hint: 'O que fazer com os desvios encontrados' },
            ].map((item) => (
              <Link
                key={item.to}
                to={filters.link(item.to)}
                className="rounded-lg border border-edge p-3 transition-colors hover:border-accent hover:bg-surface-2"
              >
                <p className="text-[13px] font-medium text-ink">{item.label}</p>
                <p className="text-[11px] text-muted">{item.hint}</p>
              </Link>
            ))}
          </div>
        </Card>
      </Page>
    </>
  )
}
