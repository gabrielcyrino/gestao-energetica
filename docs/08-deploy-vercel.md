# Deploy na Vercel

Guia para publicar o dashboard (SPA) **e** a API (FastAPI) em um único projeto Vercel, com PostgreSQL
gerenciado. Tudo já está preparado no repositório: `vercel.json`, `api/index.py`, `requirements.txt` e
`.vercelignore`.

> Os dados publicados continuam sendo **DEMO/fictícios**. Antes de publicar em endereço acessível, leia a
> seção 6 (segurança).

## 1. Como fica a arquitetura

```mermaid
flowchart LR
  U[Navegador] --> CDN[Vercel CDN<br/>SPA estática · frontend/dist]
  U --> FN[Vercel Function Python<br/>api/index.py → FastAPI]
  FN --> PG[(PostgreSQL gerenciado<br/>Neon · Supabase · Timescale Cloud)]
```

- **Mesma origem**: o front-end chama `/api/...` no próprio domínio — não há CORS nem variável de ambiente
  no front-end.
- `vercel.json` reescreve `/api/*`, `/health`, `/docs`, `/redoc` e `/openapi.json` para a função Python; todo o
  resto cai no `index.html` (rotas do SPA).
- A função recebe o caminho original, então as rotas do FastAPI continuam idênticas ao ambiente local.

### O que muda em relação ao ambiente local

| Item | Local / Docker | Vercel |
|---|---|---|
| Banco | SQLite ou TimescaleDB em container | PostgreSQL gerenciado (obrigatório) |
| Conexões | pool de 10 no processo | `NullPool` + pooler do provedor (ativado automaticamente por `VERCEL=1`) |
| Prepared statements | ativos | desativados (exigência do PgBouncer em modo transação) |
| Processo | servidor contínuo | função efêmera, com *cold start* |
| Sistema de arquivos | gravável | somente leitura (exceto `/tmp`) — por isso SQLite não funciona |

A aplicação detecta o ambiente: com `VERCEL` (ou `EE_SERVERLESS=1`) definido e `EE_DATABASE_URL` apontando
para SQLite, a API falha com mensagem explícita em vez de quebrar silenciosamente.

## 2. Criar o banco

Qualquer PostgreSQL gerenciado serve. Recomendado para começar: **Neon** (tem plano gratuito e integração na
Vercel: *Storage → Create Database → Neon*).

1. Crie o banco e copie a connection string **com pooler** (host terminado em `-pooler`).
2. Converta o prefixo para o driver usado pelo projeto:

```
# string do Neon
postgresql://usuario:senha@ep-xxx-pooler.sa-east-1.aws.neon.tech/energia?sslmode=require

# valor a usar em EE_DATABASE_URL
postgresql+psycopg://usuario:senha@ep-xxx-pooler.sa-east-1.aws.neon.tech/energia?sslmode=require
```

> **TimescaleDB**: Neon e Supabase não têm a extensão. A aplicação percebe isso e segue funcionando em
> PostgreSQL puro (o repositório de séries usa SQL portável e a chave primária `(variable_id, ts)` atende as
> consultas). Para volume industrial real — telemetria de 1 min, retenção de anos — use **Timescale Cloud**
> com a mesma string de conexão: hypertables, compressão e agregados contínuos são criados automaticamente.

## 3. Carregar a base DEMO (uma vez, da sua máquina)

O seed roda localmente contra o banco remoto e usa `COPY` (carga de ~272 mil medições em poucos segundos):

```powershell
cd backend
$env:EE_DATABASE_URL = "postgresql+psycopg://usuario:senha@ep-xxx-pooler.../energia?sslmode=require"
$env:EE_SEED_PASSWORD = "uma-senha-forte"      # senha dos usuários de demonstração
.venv\Scripts\python -m app.seed.run
```

Saída esperada: `banco: postgresql+psycopg://usuario:***@… · medições: 271846 · Base DEMO criada com sucesso.`

Para recarregar depois, basta repetir o comando (o schema é recriado do zero). Use `--keep` para apenas
criar o schema sem apagar dados existentes.

## 4. Publicar

### Opção A — CLI (mais rápido, sem precisar de repositório Git)

```powershell
npm i -g vercel
cd C:\Users\Gabriel\Downloads\bayer-eficiencia-energetica
vercel login
vercel link                 # cria/associa o projeto
vercel env add EE_DATABASE_URL production
vercel env add EE_JWT_SECRET production
vercel env add EE_ENVIRONMENT production      # valor: demo
vercel --prod
```

### Opção B — GitHub

1. `git init && git add . && git commit -m "Dashboard de gestão energética"` e envie para um repositório.
2. Na Vercel: *Add New → Project → Import*.
3. **Não altere** Framework Preset, Build Command nem Output Directory: o `vercel.json` já define
   `npm --prefix frontend ci`, `npm --prefix frontend run build` e `frontend/dist`.
4. Configure as variáveis de ambiente (seção 5) e faça o deploy.

## 5. Variáveis de ambiente

| Variável | Obrigatória | Valor |
|---|---|---|
| `EE_DATABASE_URL` | sim | `postgresql+psycopg://…-pooler…?sslmode=require` |
| `EE_JWT_SECRET` | sim | segredo aleatório longo (ex.: `openssl rand -hex 32`) |
| `EE_ENVIRONMENT` | recomendado | `demo` (mostra o aviso de dados fictícios) ou `prod` |
| `EE_DEMO_AUTH` | opcional | `false` esconde a lista de perfis na tela de login |
| `EE_INGESTION_API_KEY` | opcional | chave usada pelo gateway/ETL no endpoint de ingestão |
| `EE_CALC_CACHE_TTL` | opcional | segundos de cache de cálculo por instância (padrão 300) |

`EE_CORS_ORIGINS` não é necessário: front-end e API compartilham o domínio.

## 6. Segurança antes de publicar um endereço acessível

1. **Troque o segredo**: `EE_JWT_SECRET` aleatório e exclusivo do ambiente.
2. **Troque as senhas de demonstração**: rode o seed com `EE_SEED_PASSWORD` e guarde a senha; sem isso, a
   senha publicada é `demo`.
3. **Esconda os perfis de um clique**: `EE_DEMO_AUTH=false` (o formulário de login continua funcionando).
4. **Restrinja o acesso**, se o conteúdo não puder ser público: *Project → Settings → Deployment Protection*
   (Vercel Authentication ou Password Protection).
5. Mantenha o aviso de **DEMO/MOCK DATA** enquanto os dados não forem reais — ele já aparece no cabeçalho e na
   documentação.

## 7. Verificação pós-deploy

O `/health` é um diagnóstico completo — configuração, conexão e schema:

```powershell
curl https://SEU-PROJETO.vercel.app/health
```

| Resposta | Significado | Ação |
|---|---|---|
| `{"status":"ok","connected":true,"schema_ready":true,"users":5,"measurements":271846}` | tudo certo | nenhuma |
| `{"status":"degraded","connected":true,"schema_ready":false}` | banco acessível, sem as tabelas | rodar a carga (seção 3) |
| `{"status":"error","connected":false,"detail":"..."}` | string de conexão errada, banco pausado ou rede | conferir `EE_DATABASE_URL` e o estado do banco |
| `{"status":"error","config_error":"SQLite não funciona..."}` | `EE_DATABASE_URL` ausente | definir a variável nos três ambientes e **redeploy** |
| HTTP 503 com `"stage":"boot"` e `hints` | a função não conseguiu carregar a aplicação | seguir as dicas retornadas (a própria resposta diz o que falta) |
| HTTP 500 `FUNCTION_INVOCATION_FAILED` | falha antes do nosso código (dependência do bundle, versão de Python) | `vercel logs SEU-PROJETO` |

> Variáveis de ambiente só valem para **novos deploys**: depois de criar ou alterar qualquer uma, rode
> `vercel --prod` de novo (ou *Redeploy* no painel). Marque os três escopos (Production, Preview, Development).

```powershell
curl https://SEU-PROJETO.vercel.app/openapi.json -o $env:TEMP\openapi.json
```

Depois, no navegador: login → dashboard → *Recebimento → Fluxograma* → clicar em **Secador** → abrir um
indicador → *Comparações → Crop Year × Crop Year*. É o mesmo roteiro do script
`frontend/scripts/ui-acceptance.mjs`, que pode ser executado contra o ambiente publicado:

```powershell
cd frontend
$env:BASE_URL = "https://SEU-PROJETO.vercel.app"
node scripts/ui-smoke.mjs
```

## 8. Limitações e ajustes esperados na Vercel

| Tema | Situação | O que fazer |
|---|---|---|
| **Cold start** | primeira chamada após ociosidade leva ~2–5 s (import de numpy/SQLAlchemy + wake-up do banco) | aceitar no demo; em uso real, desativar *scale to zero* no banco e/ou migrar a API para servidor contínuo |
| **Duração máxima** | `maxDuration: 60` no `vercel.json` | se o plano recusar, reduza para `10`; as consultas medidas ficam entre 0,02 s e 0,5 s |
| **Sem worker/cron** | materialização de `indicator_value` e alarmes não rodam | usar **Vercel Cron** chamando um endpoint protegido, ou um worker fora da Vercel |
| **Sem TimescaleDB no Neon** | funciona sem hypertables | Timescale Cloud quando o volume crescer |
| **Bundle da função** | ~120 MB (numpy, SQLAlchemy, psycopg) — limite 250 MB | manter `requirements.txt` da raiz enxuto |
| **Ingestão de CSV** | funciona (o arquivo vai para memória e para o banco) | arquivos muito grandes: enviar direto pelo endpoint de API em lotes |
| **Logs** | `vercel logs SEU-PROJETO --follow` | erros do banco aparecem aqui |

## 9. Problemas comuns

| Sintoma | Causa provável | Correção |
|---|---|---|
| `/health` com `config_error` de SQLite | `EE_DATABASE_URL` ausente ou não aplicada ao ambiente | configurar nos três escopos e **redeployar** (variável nova não entra em deploy existente) |
| 503 com `"stage":"boot"` | a aplicação não carregou | ler `hints` e `traceback` da própria resposta |
| `ModuleNotFoundError: No module named 'app'` | `backend/**` não subiu com a função | conferir `functions."api/index.py".includeFiles` no `vercel.json` e se `.vercelignore` não exclui `backend/app` |
| `prepared statement "..." already exists` | string de conexão sem pooler, ou pooler em modo *session* | usar o host `-pooler` (Neon) ou `?pgbouncer=true` (Supabase) |
| 404 ao recarregar uma rota interna (ex.: `/processos/7`) | rewrite de SPA ausente | manter a última regra de `rewrites` (`/((?!api/).*) → /index.html`) |
| 504 em comparações longas | `maxDuration` baixo ou banco frio | aumentar `maxDuration`, reduzir o período comparado ou ativar *always-on* no banco |
| Login falha em produção | seed rodou com outra senha | repetir o seed com `EE_SEED_PASSWORD` conhecido |

## 10. Alternativas de topologia

| Cenário | Recomendação |
|---|---|
| Demonstração e validação com a equipe | **Vercel (este guia)** — simples, um domínio, HTTPS automático |
| Uso interno contínuo na planta | API em servidor/container (Docker Compose deste repositório) + Timescale Cloud ou PostgreSQL corporativo; front-end pode seguir na Vercel ou no mesmo Nginx |
| Dois projetos Vercel (front e API separados) | possível: `frontend/` e `backend/` como *Root Directory* distintos; exige `VITE_API_URL` no front e `EE_CORS_ORIGINS` na API |
| Rede fechada (sem internet) | Docker Compose deste repositório, dentro da rede da planta |
