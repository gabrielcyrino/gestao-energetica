# ETAPA 6 — Implementação e operação

## 6.1 O que roda hoje

Aplicação funcional (não wireframe): front-end React + TypeScript, API FastAPI documentada em OpenAPI, banco
com schema completo, motor de cálculo de indicadores e base DEMO com três anos de séries temporais simuladas.

| Número | Item |
|---|---|
| 279 | variáveis/tags cadastradas (energia, produção, estados, condições de processo, elétricas) |
| ~272 mil | medições diárias (01/09/2023 a 14/09/2026) |
| 249 | indicadores configurados (intrínsecos e extrínsecos) |
| 21 | USEs em 8 processos e 4 subprocessos, com 37 equipamentos |
| 5 | linhas de base por regressão (R² de 0,89 a 0,99) |
| 61 | testes automatizados no back-end |

## 6.2 Como a base DEMO foi construída

`backend/app/seed/` contém um simulador da planta: sazonalidade de safra verão e safrinha, balanço de massa
(espigas → grãos úmidos → grãos secos), água evaporada no secador, vapor em função da água removida,
rendimento da caldeira com incrustação e limpezas, estoques que alimentam a Torre, motores com horas, tempo em
vazio, fator de carga, fator de potência e partidas, e ar comprimido com vazamentos.

Histórias plantadas nos dados (todas fictícias) para demonstrar as análises:

| # | História | Onde aparece |
|---|---|---|
| 1 | Debulhador 02 passa a operar em vazio (jan/2026) | tempo em vazio crítico, mudança de comportamento, oportunidade OP-2026-001 |
| 2 | Retrofit térmico do secador (dez/2025) | queda de MJ/kg de água evaporada entre Crop Years, CUSUM negativo |
| 3 | Safra Verão 2026 com grão mais úmido | consumo absoluto sobe e eficiência melhora — decomposição LMDI |
| 4 | Caldeira sem limpeza na Safrinha 2026 | rendimento em queda, gases mais quentes, O₂ fora da faixa |
| 5 | Damper travado no ventilador 03 (20/07/2026) | fator de carga ~100%, kWh/t crítico, carta de controle |
| 6 | Inversor nos elevadores da limpeza (mar/2025) | melhoria ano × ano |
| 7 | Filtro de mangas colmatando (jul/2026) | consumo específico do exaustor em deterioração |
| 8 | Vazamentos de ar comprimido crescentes em 2026 | Nm³/saco acima da meta, partidas do compressor C-02 |
| 9 | Falha do medidor das mesas densimétricas (10–21/08/2026) | completude 61% → *Sem dados suficientes* |

Recarregar a base: `python -m app.seed.run` (recria o banco DEMO do zero).

## 6.3 API

Documentação interativa: `http://localhost:6472/docs` · esquema: `/openapi.json`

| Grupo | Endpoints principais |
|---|---|
| Autenticação | `POST /api/auth/login`, `GET /api/auth/me`, `GET /api/auth/demo-users` |
| Metadados | `GET /api/meta` (catálogos, períodos disponíveis, vocabulário de status, funções de fórmula) |
| Hierarquia | `GET /api/hierarchy/tree`, `GET/POST/PUT/DELETE /api/nodes…`, `GET/PUT /api/nodes/{id}/flow` |
| Energia | `/api/nodes/{id}/summary`, `/energy/children`, `/energy/uses`, `/energy/series`, `/sankey`, `/diagnostics` |
| USEs e ativos | `/api/uses`, `/api/equipment`, `/api/variables`, `/api/variables/quality`, `/api/variables/{id}/series` |
| Indicadores | `/api/indicators`, `/api/indicators/{id}`, `/history`, `/components`, `/quality`, `/validate`, `/preview`, `POST /api/evaluations` |
| Linhas de base | `/api/baselines`, `/api/baselines/{id}/evaluate`, `POST /api/baselines/{id}/fit` |
| Análises | `/api/dashboard/overview`, `/api/compare`, `/api/trends`, `/api/matrix/process-use`, `/api/matrix/use-indicator`, `/api/matrix/indicators` |
| Períodos | `/api/periods/options`, `/api/periods/resolve`, CRUD de Crop Years e safras |
| Operação | `/api/opportunities`, `/api/ingestion/csv`, `/api/ingestion/measurements`, `/api/ingestion/batches`, `/api/audit-log` |

Especificação de período (query `period`) e comparação (`compare`):

```
week:2026-W32 | month:2026-08 | year:2026 | crop_year:CY2026 | season:SV2026
custom:2026-08-01..2026-08-31 | last:30            compare = prev | yoy | <outra especificação>
```

## 6.4 Como estender

### Adicionar uma área ou processo
Configurações › Hierarquia › *Adicionar área* → informe código, nome e ordem. A área aparece imediatamente na
navegação, no dashboard e ganha um fluxograma automático (etapas em sequência) que pode ser desenhado na aba
de fluxogramas. Nenhum deploy é necessário.

### Adicionar um indicador
Configurações › Indicadores › *Novo indicador*:

1. escopo (processo, USE ou equipamento);
2. fórmula textual — operadores `+ - * / ^`, funções `min, max, abs, sqrt, log, exp, round, se(cond, a, b)`;
3. vínculos: cada símbolo aponta para uma variável (com agregação e unidade), uma constante, um dado de placa
   do equipamento ou uma função de período (`PERIOD_DAYS`, `PERIOD_HOURS`);
4. direção desejada, unidade, casas decimais, regra de status (tolerância e crítico), completude mínima;
5. metas (anual, por safra ou fixa) com justificativa;
6. **Validar fórmula** e **Pré-visualizar** com dados reais antes de salvar.

O indicador passa a ser calculado, comparado entre períodos, classificado por status e listado nas matrizes.

### Conectar dados reais
1. Cadastre a variável com a tag do historiador em `source_tag` e a frequência real de coleta.
2. Envie os dados por `POST /api/ingestion/measurements` (chave `X-API-Key`) a partir do gateway/ETL, ou faça
   upload de CSV em Configurações › Ingestão.
3. Ajuste `counts_toward_total` para separar medidor geral de submedições.
4. Refaça o ajuste das linhas de base com o período real (`POST /api/baselines/{id}/fit`).

## 6.5 Testes automatizados

```
backend/tests/test_formula.py   avaliador de fórmulas: sintaxe, divisão por zero, tentativas de injeção
backend/tests/test_periods.py   semana/mês/ano/Crop Year/safra, período anterior, YoY, parcial + base equivalente
backend/tests/test_engine.py    razão de somas × média de razões, completude, unidades, status, tendência,
                                carta de controle, LMDI, dupla contagem de energia secundária
backend/tests/test_api.py       autenticação, perfis e escopo, fluxograma, comparações, drill-down completo,
                                criação de indicador e de área pela API, matrizes, ingestão CSV, OpenAPI
```

Cobertura dos critérios de aceitação do cliente:

| Critério | Onde é verificado |
|---|---|
| Abrir Recebimento e ver as 4 etapas | `test_hierarchy_tree_has_areas_and_processes` |
| Entender o fluxo e clicar em uma etapa | `test_flow_has_process_nodes_and_energy_stream` + tela `FlowPage` |
| Ver USEs, equipamentos e indicadores da etapa | `test_drilldown_chain` |
| Histórico e tendência | `test_drilldown_chain`, `test_history_detects_*` |
| Semana/mês/ano/Crop Year/safra/custom | `test_period_comparisons` |
| Voltar ao fluxograma sem perder contexto | filtros na URL (`?p=…&c=…&sel=…`) |
| Repetir na Torre | mesma árvore e rotas; `test_hierarchy_tree_has_areas_and_processes` |
| Adicionar área sem reconstruir | `test_create_area_and_process_appears_in_tree` |
| Adicionar indicador sem alterar código | `test_create_indicator_without_touching_code` |
| Indicador ligado à etapa física | `path`/breadcrumb em todas as respostas e telas |

## 6.6 Operação do dia a dia (sugestão)

| Ritmo | Atividade | Tela |
|---|---|---|
| Diário | conferir desvios críticos e falhas de coleta | Dashboard e Qualidade dos dados |
| Semanal | reunião com donos de processo sobre os desvios da semana | Fluxograma da área + Diagnóstico |
| Mensal | fechamento: mês × mês, atualização de oportunidades | Comparações + Oportunidades |
| Por safra | revisão de metas por janela e reajuste de baselines | Configurações › Indicadores e Linhas de base |
| Anual (Crop Year) | metas do novo ciclo e verificação de economias (M&V) | Comparações + Linhas de base |

## 6.7 Limitações conscientes desta entrega

- Os dados são simulados; números absolutos não devem ser usados para decisão real.
- O cálculo é sob demanda com cache em memória; a materialização por worker (`indicator_value`) existe no
  modelo, mas o agendador ainda não está ligado.
- A edição do fluxograma é tabular (nós, posições e arestas), não *drag-and-drop* no canvas.
- Autenticação local no modo DEMO; a integração OIDC está desenhada, não implementada.
- Alarmes/notificações, previsão e detecção automática de anomalias estão no roadmap
  ([07](07-evolucoes-futuras.md)), com a base estatística já disponível no motor.
