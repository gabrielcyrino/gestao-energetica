# Gestão Energética Conectada ao Processo

Dashboard web de gestão de energia em que **cada indicador está ancorado na etapa física do processo
produtivo** que o gera: processo → subprocesso → USE → equipamento → variável → indicador intrínseco →
contexto operacional → indicador extrínseco → tendência → desvio → oportunidade.

A ISO 50001 é usada como **referencial metodológico** (não há objetivo de certificação).

> **DEMO / MOCK DATA** — os dados desta instalação são fictícios, gerados por simulação, e **não representam a
> operação real da Bayer**. Servem para demonstrar a metodologia e todas as funcionalidades.

---

## 1. Como executar

Pré-requisitos: **Python 3.12+** e **Node 20+** (ou apenas **Docker**).

Portas usadas (deliberadamente fora dos padrões): `6470` web (container), `6471` front-end em
desenvolvimento, `6472` API, `6473` PostgreSQL/TimescaleDB no host.

### 1.1 Local (Windows PowerShell)

```powershell
# Back-end — API em http://localhost:6472  (documentação em /docs)
cd backend
python -m venv .venv
.venv\Scripts\pip install -r requirements-dev.txt
.venv\Scripts\python -m app.seed.run          # cria o banco DEMO (SQLite) com 3 anos de dados
.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 6472

# Front-end — em outro terminal, http://localhost:6471
cd frontend
npm install
npm run dev
```

Abra <http://localhost:6471> e entre com um dos perfis de demonstração (senha `demo`):

| Usuário | Perfil | O que pode fazer |
|---|---|---|
| `admin` | Administrador | tudo, inclusive usuários e auditoria |
| `energia` | Gestão de Energia | cadastra hierarquia, USEs, equipamentos, indicadores, metas |
| `dono.recebimento` | Dono do Processo | edita apenas a área Recebimento |
| `dono.torre` | Dono do Processo | edita apenas a área Torre |
| `visualizador` | Visualizador | somente leitura |

### 1.2 Docker (TimescaleDB + API + web)

```bash
docker compose up --build
# web  → http://localhost:6470
# api  → http://localhost:6472/docs
```

A primeira subida cria o schema, converte as tabelas temporais em *hypertables* e carrega a base DEMO.

### 1.3 Publicar na Vercel com Neon

O repositório já vem preparado (`vercel.json`, `api/index.py`, `requirements.txt`, `.vercelignore`): o SPA vai
para a CDN e a API vira uma função serverless Python no mesmo domínio. O banco é o **Neon** (PostgreSQL
gerenciado) — SQLite não funciona em ambiente serverless.

1. **Vercel → Storage → Create Database → Neon**, região *AWS US East 1*, conectado a Production/Preview/
   Development. A integração cria `DATABASE_URL`, que a API lê automaticamente.
2. **Carga da base DEMO** a partir da sua máquina, com a string **direta** (`DATABASE_URL_UNPOOLED`, host sem
   `-pooler`):

   ```powershell
   cd backend
   $env:EE_DATABASE_URL  = "postgresql://neondb_owner:SENHA@ep-XXXX.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
   $env:EE_SEED_PASSWORD = "uma-senha-forte"
   .venv\Scripts\python -m app.seed.run
   Remove-Item Env:EE_DATABASE_URL, Env:EE_SEED_PASSWORD
   ```

3. **Settings → Environment Variables**: `EE_JWT_SECRET` (aleatório) e `EE_ENVIRONMENT=demo`.
4. **Redeploy** e verifique `https://SEU-PROJETO.vercel.app/api/auth/demo-users`.

Passo a passo, segurança do ambiente público, limitações e solução de problemas:
**[docs/08-deploy-vercel.md](docs/08-deploy-vercel.md)**.

### 1.4 Testes

```powershell
cd backend
.venv\Scripts\python -m pytest            # 61 testes: motor, períodos, API, segurança
cd ..\frontend
npm run typecheck                          # TypeScript estrito
node scripts/ui-smoke.mjs                  # opcional: navega a aplicação com Edge headless e tira prints
node scripts/ui-acceptance.mjs             # opcional: percorre os critérios de aceitação
# ambos aceitam BASE_URL=https://seu-projeto.vercel.app para validar o ambiente publicado
```

---

## 2. O que está implementado

| Área | Entregue |
|---|---|
| **Dashboard executivo** | consumo total e por fonte, intensidade por área, Sankey do fluxo de energia, consumo por processo, Pareto de USEs, indicadores fora da meta, maiores deteriorações/melhorias, heatmap intensidade × mês, oportunidades |
| **Fluxograma interativo** | React Flow com fluxo de material, energia e resíduo; cada etapa mostra consumo, intensidade, produção e status dos IDEs; painel lateral com USEs, indicadores e desvios; navegação entre áreas |
| **Hierarquia configurável** | empresa → planta → área → processo → subprocesso, cadastrável em tela (sem código) |
| **USEs e equipamentos** | categorias, regime operacional, fonte, potência instalada, dados de placa, variáveis relevantes |
| **Motor de indicadores** | fórmulas cadastráveis com avaliador seguro, vínculos de símbolos (variável/constante/dado de placa/função de período), agregação por símbolo, conversão de unidades, completude, status configurável |
| **Metas e baselines** | metas anuais (Crop Year) e por janela de safra, faixas alvo, referências técnicas; linha de base por regressão com R²/CV(RMSE), consumo esperado e CUSUM |
| **Análise temporal** | séries diária/semanal/mensal, média móvel, tendência (OLS), carta de controle I-MR, regra de sequência (mudança de comportamento), outliers |
| **Comparações** | semana × semana, mês × mês, ano × ano, Crop Year × Crop Year, safra × safra, período livre, mesmo período do ano anterior; períodos parciais com base equivalente; decomposição LMDI (efeito produção × efeito intensidade) |
| **Drill-down** | área → processo → USE → equipamento → indicador → histórico, com período e comparação preservados na URL |
| **Matrizes** | Processo × USE, USE × categoria de indicador (cobertura), matriz completa de IDEs com fórmula, origem, responsável e meta |
| **Qualidade de dados** | completude, origem, frequência, automático/manual, leituras suspeitas; dado ausente nunca vira zero |
| **Oportunidades** | registro ligado ao desvio (retrato do momento), economia estimada, investimento, payback, status |
| **Segurança** | JWT, 4 perfis, escopo por nó, trilha de auditoria com antes/depois |
| **Integração** | ingestão CSV com relatório de rejeições e API máquina-a-máquina autenticada por chave |

---

## 3. Estrutura do repositório

```
backend/
  app/
    api/           rotas REST (OpenAPI em /docs)
    engine/        motor: fórmulas, períodos, agregação, estatística, status
    models/        SQLAlchemy — master data, séries temporais, contexto, operação
    seed/          gerador da planta DEMO (simulação física simplificada)
    services/      energia, hierarquia, baselines, análises
    security.py    autenticação, perfis, escopo, auditoria
  db/timescale/    hypertables e agregados contínuos (PostgreSQL)
  tests/           pytest (motor, períodos, API)
frontend/
  src/components/  ui, charts (ECharts), flow (React Flow), layout, indicadores
  src/pages/       dashboard, área, fluxograma, processo, USE, equipamento, indicador,
                   comparações, tendências, matrizes, oportunidades, qualidade, configurações
  src/lib/         api, tipos, hooks, formatação, cores (validadas para daltonismo)
api/index.py       ponto de entrada da API na Vercel (função serverless ASGI)
docs/              ETAPAS 1 a 6 + roadmap + guia de deploy
docker-compose.yml TimescaleDB + API + web (uso local/servidor)
vercel.json        build do SPA, função Python, rewrites e cabeçalhos
```

---

## 4. Documentação

| Documento | Conteúdo |
|---|---|
| [01 — Entendimento e metodologia](docs/01-entendimento-e-metodologia.md) | a cadeia processo → USE → indicador → oportunidade e as regras de leitura |
| [02 — Arquitetura funcional](docs/02-arquitetura-funcional.md) | módulos, telas, navegação, filtros, drill-down |
| [03 — Arquitetura de dados](docs/03-arquitetura-de-dados.md) | entidades, ERD, séries temporais, motor de cálculo |
| [04 — Arquitetura tecnológica](docs/04-arquitetura-tecnologica.md) | escolhas com prós/contras, MVP × produção, integração industrial, segurança |
| [05 — UX/UI](docs/05-ux-ui.md) | sistema visual, wireframes das telas, padrões de gráfico, acessibilidade |
| [06 — Implementação e operação](docs/06-implementacao.md) | como rodar, API, como estender, testes |
| [07 — Evoluções futuras](docs/07-evolucoes-futuras.md) | anomalias, previsão, M&V, alarmes, IA onde faz sentido |
| [08 — Deploy na Vercel](docs/08-deploy-vercel.md) | publicação do SPA + API serverless com PostgreSQL gerenciado |

---

## 5. Como adicionar coisas sem tocar em código

- **Nova área/processo**: Configurações › Hierarquia → aparece na navegação, no dashboard e no fluxograma.
- **Novo USE/equipamento/variável**: Configurações › respectivas abas.
- **Novo indicador**: Configurações › Indicadores → escreva a fórmula (ex.: `E / P`), vincule os símbolos às
  variáveis, valide, pré-visualize com dados reais e salve. Ele passa a ser calculado, comparado, classificado
  e exibido em todas as telas.
- **Novo Crop Year ou safra**: Configurações › Períodos — datas livres, sem vínculo com o ano civil.
- **Dados reais**: Configurações › Ingestão (CSV) ou `POST /api/ingestion/measurements` com chave de
  integração (gateway OPC UA/MQTT).
