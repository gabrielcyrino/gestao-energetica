# ETAPA 5 — UX/UI

> Documento descritivo da interface **efetivamente construída** (`frontend/src`). Cada tela citada existe
> como rota da aplicação. A ISO 50001 é usada como **referencial metodológico** — não há objetivo de
> certificação. Os dados exibidos no ambiente atual são **DEMO/fictícios**, gerados por simulação.

---

## 1. Princípios de design

| Princípio | Como se manifesta na interface |
|---|---|
| **Corporativo e industrial, não "dashboard de marketing"** | Superfícies neutras, tipografia de sistema, zero ilustração decorativa, nenhum gradiente ou sombra pesada. A cor entra quase só no dado. |
| **Hierarquia da informação evidente** | Toda página segue a mesma ordem: cabeçalho com contexto → KPIs → leitura visual (gráfico/fluxograma) → detalhamento tabular → diagnóstico/ações. |
| **Densidade calibrada para 16:9 corporativo** | Base 14 px, cartões de 16 px de respiro, tabelas de 8 px de célula, grade de 4 px. Um monitor 1920×1080 mostra KPIs + gráfico principal + tabela sem rolagem. |
| **Cor com significado** | Oito matizes categóricas para *identidade* (área, fonte, categoria de USE), rampa azul para *magnitude*, par azul↔vermelho para *polaridade*, e uma paleta de *estado* reservada. Filtrar nunca repinta séries: a cor segue a entidade (`color_slot` cadastrado), não a posição no ranking. |
| **Nunca só cor** | Todo estado carrega **ícone + rótulo** (`StatusPill`, `StatusIcon`). Todo gráfico tem **visão de tabela**. Variações trazem seta (↗/↘) além da cor. |
| **O número é o herói** | Hero de 34 px apenas uma vez por tela (`KpiTile hero`); demais valores em 22 px; nada de "gauge" decorativo. |
| **Energia conectada ao processo** | O fluxograma não é uma página isolada: é o mapa de navegação. Todo indicador exibe o caminho Área › Processo › USE › Equipamento e tem atalho "Ver no fluxograma". |

---

## 2. Sistema visual

### 2.1 Tokens (definidos em `src/index.css`, expostos ao Tailwind via `@theme inline`)

| Papel | Token | Claro | Escuro |
|---|---|---|---|
| Plano de fundo da página | `--page` | `#f1f1ee` | `#0d0d0d` |
| Superfície de cartão/gráfico | `--surface` | `#fcfcfb` | `#1a1a19` |
| Superfície secundária (hover, faixas) | `--surface-2` | `#f7f7f4` | `#211f1e` |
| Trilho/track neutro | `--surface-3` | `#eeeeea` | `#2c2c2a` |
| Tinta primária | `--ink` | `#0b0b0b` | `#ffffff` |
| Tinta secundária | `--ink-2` | `#52514e` | `#c3c2b7` |
| Tinta discreta (eixos, legendas) | `--muted` | `#898781` | `#898781` |
| Grade de gráfico | `--line` | `#e1e0d9` | `#2c2c2a` |
| Borda hairline | `--edge` | `rgba(11,11,11,.10)` | `rgba(255,255,255,.12)` |
| Acento / seleção | `--accent` | `#2a78d6` | `#3987e5` |

O tema é decidido em três camadas, nesta ordem de precedência: `:root[data-theme="dark"|"light"]`
(escolha explícita do usuário) → `@media (prefers-color-scheme: dark)` (preferência do sistema) →
padrão claro. O botão de tema cicla **sistema → claro → escuro**, persiste em `localStorage` e dispara o
evento `ee-theme`, que os gráficos escutam para recolorir sem recarregar a página (`useChartTheme`).

### 2.2 Paleta categórica (identidade — 8 séries)

| Slot | Matiz | Claro | Escuro |
|---|---|---|---|
| 1 | azul | `#2a78d6` | `#3987e5` |
| 2 | laranja | `#eb6834` | `#d95926` |
| 3 | verde-água | `#1baf7a` | `#199e70` |
| 4 | amarelo | `#eda100` | `#c98500` |
| 5 | magenta | `#e87ba4` | `#d55181` |
| 6 | verde | `#008300` | `#008300` |
| 7 | violeta | `#4a3aa7` | `#9085e9` |
| 8 | vermelho | `#e34948` | `#e66767` |

A ordem dos slots **é** o mecanismo de segurança para daltonismo: a sequência foi validada por script
para protanopia e deuteranopia (simulação Machado-Oliveira-Fernandes, severidade 1,0), garantindo ΔE
(OKLab ×100) ≥ 8 entre pares adjacentes e ΔE ≥ 15 em visão normal, nos dois temas. Regras de uso:

- atribuição **em sequência e fixa por entidade** (`seriesColor(color_slot)`), nunca cíclica;
- formas com sobreposição livre (dispersão, mapas) limitam-se aos **3 primeiros slots**;
- a partir da 9ª categoria não se gera matiz nova: agrupa-se em "Outros" ou usa-se *small multiples*;
- três slots claros (verde-água, amarelo, magenta) ficam abaixo de 3:1 no fundo claro — por isso **todo
  gráfico oferece a visão de tabela** e rótulos diretos quando cabem (regra de alívio de contraste).

### 2.3 Rampa sequencial e par divergente

- **Sequencial** (magnitude: heatmap de consumo, intensidade de célula): uma única matiz azul, `--seq-100`
  → `--seq-700`, claro→escuro. No tema escuro a âncora inverte (100 é o passo mais escuro).
- **Divergente** (polaridade: desvio vs meta, variação ano a ano): azul (favorável) ↔ **cinza neutro**
  (`--surface-3`) ↔ vermelho (desfavorável). Nunca uma matiz no ponto médio; nunca arco-íris.
  `deviationColor(pct, lowerIsBetter)` já inverte o sinal conforme a direção desejada do indicador, de
  modo que "vermelho = pior" vale também para indicadores em que *maior é melhor*.

### 2.4 Paleta de estado (reservada, seis estados)

| Estado | Rótulo na tela | Cor | Ícone |
|---|---|---|---|
| `normal` | Dentro da meta | `#0ca30c` | `check-circle` |
| `atencao` | Atenção | `#fab219` | `alert-triangle` |
| `critico` | Desvio significativo | `#d03b3b` | `alert-octagon` |
| `sem_dados` | Sem dados suficientes | `#ec835a` | `database-zap` |
| `sem_operacao` | Sem operação | `#898781` | `pause-circle` |
| `sem_meta` | Informativo | `#898781` | `info` |

Essas cores **não** entram no rodízio categórico: um status nunca se disfarça de série. Os dois estados
cinzas são deliberados — "sem operação" (entressafra, equipamento parado) e "informativo" (indicador sem
meta) não são problemas e não devem competir visualmente com desvios reais. No fundo claro, *atenção* e
*sem dados* ficam abaixo de 3:1, e a mitigação é justamente o par **ícone + rótulo**, sempre presente.

### 2.5 Tipografia e números

- Uma única família: `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`. Sem fonte display.
- Escala: 34 px (hero) · 22 px (KPI) · 17 px (valor em cartão) · 13 px (corpo/tabela) · 11 px (rótulo,
  legenda, eixo) · 10 px (metadado).
- `.num` aplica `font-variant-numeric: tabular-nums` **apenas** onde há alinhamento vertical: colunas de
  tabela, ticks de eixo, listas de variação. Valores grandes isolados usam figuras proporcionais.
- Formatação pt-BR centralizada em `src/lib/format.ts`: `fmtAuto` reduz casas conforme a magnitude
  (≥1000 → 0 casas; ≥100 → 1; ≥1 → 2; <1 → 3), evitando "0,000" e "12.345,678" na mesma coluna.

---

## 3. Navegação e preservação de contexto

```
┌────────────┬──────────────────────────────────────────────────────────────────────┐
│  SIDEBAR   │  BARRA DE FILTROS GLOBAIS (sticky)                                   │
│  240 px    │  [📅 Agosto de 2026 ▾] comparar com [Julho de 2026 ▾] [S][M][A]      │
│            │                          … [DEMO · dados fictícios] [Metodologia]    │
│ Dashboard  ├──────────────────────────────────────────────────────────────────────┤
│            │  BREADCRUMB: Dashboard › Recebimento › Secador                       │
│ ÁREAS      │  H1 do contexto + badges + ações                                     │
│ ▾ Recebim. ├──────────────────────────────────────────────────────────────────────┤
│   Visão g. │                                                                      │
│   Fluxogr. │   CONTEÚDO DA PÁGINA                                                 │
│   Despalha │                                                                      │
│   Debulha  │                                                                      │
│   Secador  │                                                                      │
│   Caldeira │                                                                      │
│ ▸ Torre    │                                                                      │
│            │                                                                      │
│ ANÁLISE    │                                                                      │
│  USEs      │                                                                      │
│  Indicad.  │                                                                      │
│  Comparaç. │                                                                      │
│  Tendênc.  │                                                                      │
│  Oportun.  │                                                                      │
│  Qualidade │                                                                      │
│ SISTEMA    │                                                                      │
│  Config.   │                                                                      │
│  API       │                                                                      │
├────────────┤                                                                      │
│ usuário    │                                                                      │
│ perfil ☀ ⏻ │                                                                      │
└────────────┴──────────────────────────────────────────────────────────────────────┘
```

- **Sidebar hierárquica**: a árvore vem da API (`/hierarchy/tree`), não do código. Criar uma área nova em
  Configurações a faz aparecer aqui sem recompilar. Áreas expandem para *Visão geral*, *Fluxograma*,
  processos e subprocessos.
- **Barra de filtros globais**: uma única linha, acima de tudo que ela escopa. Contém o período, o período
  de comparação e atalhos (semana/mês/ano). Nenhum gráfico tem filtro próprio de período.
- **Breadcrumb** em toda página de detalhe, com cada nível clicável.
- **Contexto na URL**: `p` (período, ex.: `month:2026-08`, `crop_year:CY2026`, `season:SV2026`,
  `custom:2026-08-01..2026-08-15`) e `c` (comparação: `prev`, `yoy` ou outra especificação). Parâmetros
  locais viajam junto quando fazem sentido: `sel` (etapa selecionada no fluxograma), `node`/`use`/`eq`
  (escopo do comparador), `tab`, `id`.
- **Drill-down sem perder o filtro**: todo link interno é gerado por `filters.link(path, extra)`, que
  reanexa `p` e `c`. O caminho Recebimento → Secador → Sistema de ventilação → Motor ventilador 01 →
  kWh/t → histórico mantém o mesmo período do começo ao fim, e o botão "voltar" do navegador devolve o
  fluxograma **com a etapa ainda selecionada**, porque `sel` está na URL.

---

## 4. Telas

### 4.1 Dashboard geral (`/`)

**Objetivo**: em 10 segundos, responder *quanto consumimos, onde, se melhorou e o que exige ação*.

```
┌ KPI ROW ───────────────────────────────────────────────────────────────────────────┐
│ Consumo total   │ Energia elétrica │ Biomassa      │ Intens. Recebim.│ Intens. Torre│
│  2.670,7 MWh    │  606,2 MWh       │ 2.064,5 MWh   │ 414,8 kWh/t     │ 26,3 kWh/t   │
│  ↘ 12,6% vs jul │  ↗ 3,1%          │ 7.842 t       │ ↘ 4,2%          │ ↗ 1,1%       │
└────────────────────────────────────────────────────────────────────────────────────┘
┌ Consumo por área ao longo do tempo (13 meses) ─────┐┌ Consumo por fonte ───────────┐
│ ▮▮▮ colunas empilhadas por área          [gráf|tab]││ barras atual × anterior      │
└────────────────────────────────────────────────────┘└──────────────────────────────┘
┌ Fluxo de energia da planta (Sankey) ───────────────────────────────────────────────┐
│ Eletricidade ┐                    ┌ Despalha ┐                                     │
│              ├─ Recebimento ──────┤ Secador  ├── Ventilação / Transporte / …       │
│ Biomassa ────┘                    └ Caldeira ─┬─ Vapor gerado → Secador → Térmico  │
│                                               └─ Perdas na geração de vapor        │
└────────────────────────────────────────────────────────────────────────────────────┘
┌ Consumo por processo (barras) ─────────────────────┐┌ Pareto dos USEs ─────────────┐
└────────────────────────────────────────────────────┘└──────────────────────────────┘
┌ Indicadores fora da meta (tabela) ─────────────────┐┌ Composição dos status        │
│                                                    ││ ▮▮▮▮▮▮▮ + oportunidades      │
│                                                    │├──────────────────────────────┤
│                                                    ││ Maiores movimentos           │
│                                                    ││  Deterioração │ Melhoria     │
└────────────────────────────────────────────────────┘└──────────────────────────────┘
┌ Intensidade por processo × mês — variação vs mesmo mês do ano anterior (heatmap) ──┐
└────────────────────────────────────────────────────────────────────────────────────┘
┌ Cartão Recebimento ────────────────────┐┌ Cartão Torre ─────────────────────────┐
│ status bar · consumo/produção/intens.  ││ … [Fluxograma] [Abrir]                │
└────────────────────────────────────────┘└───────────────────────────────────────┘
```

**Ações**: comparar períodos, abrir oportunidades, entrar em área/fluxograma, clicar em qualquer
indicador da lista "fora da meta". **Retorno**: sidebar sempre visível; o período escolhido acompanha.

### 4.2 Área — visão geral (`/areas/:nodeId`)

**Objetivo**: desempenho da área e comparação entre suas etapas.
**Blocos**: KPIs (consumo, produção de referência, intensidade, indicadores com `StatusBar`, completude)
→ fluxograma compacto (clique navega para a etapa) + barras "consumo por etapa" (atual × anterior) →
consumo mensal empilhado por etapa + Sankey da área → cartões por etapa (com status) + tabela de USEs da
área → diagnóstico do período.
**Drill-down**: etapa → `/processos/:id`; USE → `/uses/:id`; "Abrir fluxograma completo".

### 4.3 Fluxograma (`/areas/:nodeId/fluxograma`)

**Objetivo**: é a tela-assinatura do projeto — o indicador ancorado na etapa física.

```
┌ Fluxograma · Recebimento         [Consumo|Intensidade|Produção|Status] [Visão geral]┐
├──────────────────────────────────────────────────────┬──────────────────────────────┤
│ ( Espigas )→┌Despalha┐→┌Debulha┐→┌Secador ┐→(→ Torre)│ Secador            [Abrir ↗] │
│             │ 63 MWh │  │46 MWh│  │181 MWh│          │ Consumo │Produção │Intensid. │
│             │ ↘4,1%  │  │↗2,0% │  │↗8,7%  │          │ 181 MWh │ 6.098 t │ 34,4     │
│             │ ▌2 ! 1 │  │▌3 !  │  │▌1 !   │          │ vs ant: ↗8,7% ↗24,6% ↘12,8%  │
│             └────────┘  └───┬──┘  └───▲───┘          ├──────────────────────────────┤
│  (Palha)◄───────┘           │sabugo   │vapor         │[Resumo][USEs][Indic.][Desvios]│
│  (Cavaco)──────────────────►┌Caldeira─┘              │ status bar ▮▮▮▮▮             │
│                             │2.064 MWh│              │ energia por fonte            │
│                             └─────────┘              │ "Por que o consumo mudou?"   │
├──────────────────────────────────────────────────────┤ LMDI: produção +X / intens.-Y│
│ ── material   ┄┄ energia (vapor)  ·· resíduo         │ consumo mensal por fonte     │
│ ▌ barra lateral = pior status dos IDEs da etapa      │                              │
├──────────────────────────────────────────────────────┴──────────────────────────────┤
│ Resumo das etapas (tabela clicável: consumo, Δ, produção, intensidade, IDEs fora)    │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

- **Nó de processo** (208 px): nome, barra lateral com o pior status, valor da métrica escolhida, Δ%,
  chips de contagem por status (crítico/atenção/sem dados) e rodapé "N USEs · M IDEs".
- **Nós de entrada/saída/ligação**: pílula tracejada; a ligação "→ Torre" navega para a outra área.
- **Arestas**: material (linha sólida, seta, rótulo do fluxo), energia (tracejada animada, âmbar, ex.
  "Vapor"), resíduo (pontilhada cinza, ex. "Sabugo (combustível)").
- **Interações**: clique seleciona (grava `sel` na URL) · duplo clique abre a página do processo · a
  legenda explica os três tipos de fluxo · o seletor de métrica troca o número exibido em todos os nós.
- **Painel lateral** (400 px): cabeçalho com KPIs e variações; abas **Resumo** (status, energia por fonte,
  leitura LMDI, série mensal), **USEs** (lista com consumo e participação), **Indicadores** (tabela densa
  com sparkline), **Desvios** (diagnóstico com ação "Registrar oportunidade").

### 4.4 Processo (`/processos/:nodeId`)

**Objetivo**: a página de trabalho do dono do processo.
**Blocos**: cabeçalho com regime operacional e responsável → KPIs (produção como herói, consumo por
fonte, intensidade, indicadores, completude) → **faixa de leitura da variação** (texto com decomposição
LMDI) → posição no fluxo (mini-fluxograma com a etapa destacada; subprocessos como atalhos) + cartões de
USE com barra de participação → histórico do indicador selecionável + "consumo e produção mês a mês"
(dois gráficos empilhados, jamais dois eixos) → tabela completa de indicadores → comparação por USE +
diagnóstico.
**Retorno**: "Ver no fluxograma" leva ao canvas com a etapa já selecionada.

### 4.5 USE (`/uses/:useId`)

**Objetivo**: entender um uso significativo e seus equipamentos.
**Blocos**: breadcrumb do USE + badges (categoria, regime, fonte, responsável) → KPIs (consumo e Δ,
participação na etapa, potência instalada, nº de equipamentos, horas/tempo em vazio) → "por que é
significativo" e período de operação → tabela de equipamentos (placa + consumo) → barras de consumo por
equipamento → **indicadores intrínsecos** e **extrínsecos** em seções separadas → **variáveis relevantes**
com a justificativa de cada uma (base da normalização).
**Drill-down**: equipamento → `/equipamentos/:id`; indicador → `/indicadores/:id`.

### 4.6 Equipamento (`/equipamentos/:equipmentId`)

**Objetivo**: ligar dado de placa, tags e desempenho.
**Blocos**: KPIs (consumo, horas, tempo em vazio, fator de carga, fator de potência — com status) →
**dados de placa** (potência, rendimento, classe IE, tensão/corrente, inversor, fabricante, ano) →
histórico da tag selecionável (barra para energia, linha para as demais) → indicadores do equipamento →
tabela de variáveis/tags (origem, tag no historiador, frequência, automática/manual, método, agregação,
se compõe o total) → eventos operacionais (paradas, manutenções, intervenções) que explicam saltos.

### 4.7 Indicador (`/indicadores/:indicatorId`)

**Objetivo**: a análise completa de um IDE — e a resposta a "posso confiar neste número?".

```
┌ Breadcrumb: Dashboard › Recebimento › Secador › Sistema de ventilação › REC-SEC-VEN-01 ┐
│ H1: Consumo específico — Motor ventilador 01   [Intrínseco][intensidade][IDE-…][Status]│
│ ações: [Ver no fluxograma] [Comparar] [Registrar oportunidade]                          │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ Valor (hero) │ Período anterior │ Meta + bullet │ Baseline │ Completude               │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ [Histórico e tendência][Energia × produção][Observado × esperado][Definição][Qualidade] │
│ ┌ diário|semanal|mensal · 12|26|52 ────── Tendência: deterioração ↗ · 2 fora de controle│
│ │ linha do valor + média móvel + reta de tendência                                      │
│ │ linhas de referência: Meta, Baseline, LSC, LIC   ● pontos fora de controle            │
│ └───────────────────────────────────────────────────────────────────[gráfico|tabela]───┘
└────────────────────────────────────────────────────────────────────────────────────────┘
```

Abas: **Histórico** (série + média móvel + tendência + limites I-MR + marcação de mudança de patamar);
**Energia × produção** (tabela de componentes da fórmula A×B + dispersão diária com reta de ajuste — a
inclinação é o consumo específico e o intercepto revela o consumo fixo); **Observado × esperado** (só
quando há linha de base: série observado vs esperado + CUSUM, com R², CV(RMSE) e a equação escrita por
extenso); **Definição** (fórmula, vínculos símbolo→tag→agregação→unidade, direção, regra de status,
metas anuais e por safra com justificativa, oportunidades ligadas); **Qualidade** (por variável: dias com
dado/dias esperados, completude, % suspeitas/ruins, última leitura).

### 4.8 Comparador de períodos (`/comparacoes`)

**Objetivo**: comparar A × B sem enganar a leitura.
**Blocos**: cabeçalho "Período A × Período B" com avisos `parcial` e `base equivalente` → chips de atalho
(semana × semana, mês × mês, ano × ano, Crop Year × Crop Year, safra × safra, mesmo período do ano
anterior, personalizado) + seletor de escopo (planta → área → processo → subprocesso, ou USE, ou
equipamento) → KPIs A×B → **decomposição LMDI em cascata** (Consumo B → efeito produção → efeito
intensidade → Consumo A) com o texto explicando que consumo maior pode ser volume, não ineficiência →
barras por etapa (dois tons da mesma matiz) → sobreposição temporal alinhada pelo nº de períodos
decorridos → tabela de USEs → indicadores nos dois períodos → diagnóstico.

### 4.9 Matriz de indicadores (`/indicadores`)

**Objetivo**: o inventário completo de IDEs e a cobertura da medição.
Aba 1 — **Matriz**: Processo → USE → Equipamento → Indicador → Fórmula → Unidade → Origem do dado →
Frequência → Responsável → Meta → Baseline → Valor → Status, com busca, filtros (tipo, nível, status) e
exportação CSV. Aba 2 — **Cobertura USE × categoria de indicador**: contagem e pior status por célula;
**células vazias são lacunas de medição** e aparecem contabilizadas no subtítulo.

### 4.10 Tendências (`/tendencias`)

**Objetivo**: separar melhoria real de ruído.
**Blocos**: filtros (escopo, granularidade, janela 12/26/52) → KPIs por classificação → **radar** ordenado
por severidade (classificação, variação da janela, R², pontos fora de controle, mudança de patamar,
status, valor) → seleção de até 4 indicadores → **small multiples** (um gráfico por indicador, cada um
com seu eixo) → heatmap indicador × período do desvio em relação à meta.

### 4.11 Oportunidades (`/oportunidades`)

**Objetivo**: transformar desvio em ação rastreável.
**Blocos**: KPIs (abertas, implementadas/verificadas, MWh/ano, R$/ano, investimento) → Pareto do potencial
por etapa → filtros + carteira (código, título, escopo, indicador ligado, prioridade, status, economia,
payback simples calculado, responsável, prazo) → detalhe com o **retrato do desvio** (valor, meta,
baseline, desvio, status e período no momento do registro) e link para o indicador.
Criação também acontece **de dentro do diagnóstico** (botão "Registrar" em cada achado), já pré-preenchida.

### 4.12 Qualidade dos dados (`/qualidade`)

**Objetivo**: tornar a confiabilidade visível antes que alguém tome decisão errada.
**Blocos**: KPIs (variáveis monitoradas, completude média, abaixo de 90%, % de leituras suspeitas/ruins,
coleta manual) → tabela ordenada da menor completude (tipo, método, etapa/equipamento, origem + tag,
frequência, dias com dado/esperados, barra de completude, distribuição de qualidade, última atualização,
status) → barras das 15 piores completudes → cartão com as regras (ausente ≠ zero; mínimo por indicador;
parada ≠ falha; leitura `bad` é descartada do cálculo).

### 4.13 Configurações (`/configuracoes`)

**Objetivo**: provar que a estrutura é **dado**, não código.
Abas: **Hierarquia & fluxogramas** (árvore com criar/editar/excluir área, processo e subprocesso + editor
do diagrama: nós, tipos, posições e arestas com tipo de fluxo) · **USEs** · **Equipamentos** ·
**Variáveis/tags** · **Indicadores** (editor completo: fórmula, construtor de vínculos, direção, unidade,
regra de status, completude mínima, metas por escopo, com **validar fórmula** e **pré-visualizar** contra
dados reais) · **Linhas de base** (R², CV(RMSE), coeficientes, reajuste) · **Períodos** (Crop Years e
safras com datas próprias) · **Catálogos** · **Ingestão** (CSV com relatório de rejeições) · **Auditoria**.

### 4.14 Metodologia (`/metodologia`) e Login (`/login`)

- **Metodologia**: página de apoio, sem dados, que explica a cadeia Processo → USE → Equipamento →
  Variável → IDE intrínseco → contexto → IDE extrínseco → tendência → desvio → oportunidade, com exemplos
  reais da planta DEMO e links para as telas correspondentes.
- **Login**: perfis de demonstração em um clique (Administrador, Gestão de Energia, Dono do Processo,
  Visualizador) com a descrição do que cada um pode fazer, além do formulário usuário/senha.

---

## 5. Padrões de gráfico

### 5.1 Forma conforme o trabalho do dado

| O leitor precisa… | Forma usada | Onde |
|---|---|---|
| Um número e sua variação | Stat tile (`KpiTile`) com Δ e sparkline | todas as telas |
| Tendência no tempo | Linha 2 px (+ média móvel tracejada) | Indicador, Processo, Tendências |
| Comparar magnitudes | Barra horizontal ≤ 24 px, ponta arredondada | Processo, Fonte, USE |
| Composição no tempo | Colunas empilhadas com gap de 2 px | Dashboard, Área |
| Fluxo e conversão de energia | Sankey | Dashboard, Área |
| Matriz (entidade × período) | Heatmap divergente ou sequencial | Dashboard, Tendências |
| Relação entre duas medidas | Dispersão + reta de ajuste | Indicador |
| Concentração | Pareto (barras % + acumulado **no mesmo eixo 0–100%**) | Dashboard, USEs, Oportunidades |
| Realizado × meta | Bullet (barra + marca de meta + marca de baseline) | Indicador |
| Mais de ~7 classes com significado | Tabela (ou tabela + gráfico) | Matriz de indicadores |

### 5.2 Regras invioláveis

1. **Eixo único.** Nenhum gráfico tem dois eixos Y. Quando há duas escalas (energia e produção; observado
   e CUSUM), usam-se **dois gráficos empilhados** compartilhando o eixo X, ou *small multiples*.
2. **Marcas finas.** Barra ≤ 24 px com folga na banda; linha 2 px; marcador ≥ 7 px com anel de 2 px na cor
   da superfície; área a 10% de opacidade.
3. **Dois espaçadores brancos.** Gap de 2 px na cor da superfície entre segmentos empilhados e entre
   barras adjacentes; anel de 2 px em pontos sobrepostos. Nunca contorno escuro para separar marcas.
4. **Grade discreta.** Uma linha hairline sólida (`--line`), nunca tracejada; eixo de valor sem linha;
   rótulos 11 px em `--muted`.
5. **Legenda a partir de 2 séries**, sempre presente; série única não ganha caixa de legenda (o título já
   nomeia). **Rótulos diretos seletivos** (extremo, último ponto) — nunca um número em cada ponto.
6. **Texto nunca veste a cor do dado.** Rótulos e valores usam tinta; a identidade vem da marca colorida
   ao lado.
7. **Tooltip com crosshair** em linhas e colunas (todas as séries do X de uma vez); tooltip por marca em
   dispersão e heatmap; valores formatados em pt-BR com unidade.
8. **Visão de tabela em todo gráfico** (`ChartCard table=…`): alternância gráfico/tabela no cabeçalho do
   cartão. É o equivalente acessível — e a mitigação exigida pelos slots de baixo contraste.

### 5.3 Estados

- **Carregando**: `Skeleton` com a altura final do bloco (sem salto de layout).
- **Refetch** (troca de período): a renderização anterior permanece a 60% de opacidade até o novo dado
  chegar — sem *flash* de esqueleto (`keepPreviousData` + `QueryBoundary`).
- **Vazio**: `EmptyState` com título, explicação e, quando aplicável, ação ("Cadastre os equipamentos
  deste USE").
- **Erro**: `ErrorState` com a mensagem vinda da API, em faixa discreta — a página continua utilizável.

---

## 6. Acessibilidade

| Requisito | Implementação |
|---|---|
| Não depender de cor | Status = ícone + rótulo (`StatusPill`); variação = seta + sinal; fluxo de energia = traço tracejado + rótulo textual. |
| Equivalente textual de gráficos | Alternância **gráfico/tabela** em todo `ChartCard`; tabelas com cabeçalho semântico. |
| Contraste | Tinta e superfícies escolhidas para ≥ 4,5:1 em texto corrente; marcas de gráfico ≥ 3:1 sempre que possível, com regra de alívio (rótulo/tabela) nos três slots claros. |
| Foco visível | `outline` de 2 px na cor de acento em campos e controles; navegação por teclado nas abas (Radix `Tabs`), diálogos (`Dialog` com foco preso e `Esc`) e popovers. |
| Semântica | `role="tablist"`/`aria-selected` no controle segmentado; `aria-label` em selects de filtro e botões de ícone; `<th scope>` implícito nas tabelas; segmentos da barra de status expõem `aria-label` com estado e contagem. |
| Movimento | Nenhuma animação acima de 300 ms; a única animação contínua é o tracejado das arestas de energia, de baixa amplitude. |

---

## 7. Responsividade

- **Alvo primário**: desktop 16:9 (1440–1920 px). A grade principal usa `lg:` (1024 px) e `xl:` (1280 px);
  acima de 1280 px o fluxograma divide a tela com o painel lateral de 400 px.
- **Tablet (768–1279 px)**: as colunas colapsam para uma; o painel do fluxograma passa a ficar **abaixo**
  do canvas (a borda muda de vertical para horizontal); os `StatRow` reagrupam por `auto-fit
  minmax(150–190px, 1fr)`; tabelas largas rolam horizontalmente dentro do próprio cartão, sem estourar a
  página.
- **Gráficos** reagem via `ResizeObserver` (não via *media query*), então qualquer redimensionamento —
  inclusive abrir/fechar o painel — redesenha na proporção correta.
- A sidebar é fixa em 240 px; em telas menores o conteúdo mantém 16 px de respiro lateral mínimo.

---

## 8. Microcopy — como a interface fala sobre incerteza

| Situação | O que aparece |
|---|---|
| Valor inexistente | `—` (nunca 0), com o motivo em tooltip: "sem dados para: E, P". |
| Etapa parada / entressafra | Status **Sem operação** + texto "Sem produção no período." — explicitamente diferente de falha de dado. |
| Completude abaixo do mínimo | Status **Sem dados suficientes** + "Completude 61% abaixo do mínimo de 80%." O valor calculado continua visível, mas marcado como não confiável. |
| Período em andamento | Chip `parcial` no seletor e no cabeçalho: "Período em andamento: recortado na última data com dados." |
| Comparação recortada | Chip `base equivalente`: "Recortado para o mesmo número de dias decorridos do período atual." |
| Consumo sobe com produção subindo | Faixa de leitura no processo: "Aumento de consumo acompanhado de queda de intensidade indica mais produção, não perda de eficiência." |
| Energia secundária | Nota fixa no Sankey e nos totais: "Vapor é energia secundária e não é somado ao total da planta, para evitar dupla contagem." |
| Submedição incompleta | "Não alocado a USEs: X MWh — diferença entre o medidor do CCM e a soma das submedições." |
| Ambiente | Selo permanente **DEMO · dados fictícios** na barra superior, com o aviso completo em tooltip. |
