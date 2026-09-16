# Deploy na Vercel com banco Neon

Publica o dashboard (SPA) e a API (FastAPI) em **um único projeto Vercel**, com PostgreSQL no **Neon**. O
repositório já está preparado: `vercel.json`, `api/index.py`, `requirements.txt` e `.vercelignore`.

> Os dados publicados continuam sendo **DEMO/fictícios**. Antes de abrir o endereço para outras pessoas, leia
> a seção 6.

## Resumo em 5 passos

| # | Passo | Onde |
|---|---|---|
| 1 | Criar o banco Neon conectado ao projeto | Vercel → *Storage* |
| 2 | Carregar a base DEMO no Neon (uma vez) | sua máquina |
| 3 | Definir `EE_JWT_SECRET` (e `EE_ENVIRONMENT`) | Vercel → *Settings → Environment Variables* |
| 4 | **Redeploy** | Vercel → *Deployments* |
| 5 | Verificar | navegador / `curl` |

> **Por que o deploy atual responde 500 em todas as rotas:** sem banco configurado a API não tem onde gravar
> (SQLite não funciona em serverless) e a função falha ao carregar — a Vercel mostra isso como
> `FUNCTION_INVOCATION_FAILED`. Os passos abaixo resolvem.

## 1. Como fica a arquitetura

```mermaid
flowchart LR
  U[Navegador] --> CDN[Vercel CDN<br/>SPA estática · frontend/dist]
  U --> FN[Vercel Function Python<br/>api/index.py → FastAPI]
  FN -->|DATABASE_URL · pooled| NEON[(Neon PostgreSQL)]
  DEV[Sua máquina · seed] -->|DATABASE_URL_UNPOOLED · direta| NEON
```

- Front-end e API no **mesmo domínio**: nada de CORS nem variável de ambiente no front-end.
- `vercel.json` envia `/api/*`, `/health`, `/docs`, `/redoc` e `/openapi.json` para a função Python; o resto
  cai no `index.html`.
- `"framework": null` no `vercel.json` é **obrigatório**: sem ele a Vercel detecta FastAPI no
  `requirements.txt`, o preset de framework assume o projeto e `api/index.py` deixa de ser uma função.
  Não remova essa linha nem escolha um *Framework Preset* no painel.
- A função usa a **conexão com pooler** do Neon (sem pool local e sem prepared statements); a carga inicial usa
  a **conexão direta**.

## 2. Criar o banco Neon

### Caminho recomendado — integração pela Vercel

1. No projeto `gestao-energetica` na Vercel: **Storage → Create Database → Neon**.
2. **Região: AWS US East 1 (N. Virginia)** — a mesma das funções da Vercel por padrão (`iad1`). Banco e função
   em regiões distantes somam latência a cada consulta.
3. Plano **Free** é suficiente para a DEMO (a base ocupa algumas dezenas de MB; limite do plano: 0,5 GB).
4. Conecte o banco ao projeto marcando **Production, Preview e Development**.

A integração cria sozinha, entre outras, estas variáveis no projeto:

| Variável | Tipo | Usada por |
|---|---|---|
| `DATABASE_URL` | com pooler (PgBouncer) | a API na Vercel — lida automaticamente, nada a configurar |
| `DATABASE_URL_UNPOOLED` | conexão direta | a carga inicial (passo 3 deste guia) |

### Caminho alternativo — conta Neon separada

Crie o projeto no [console do Neon](https://console.neon.tech), abra **Connect** e copie duas strings: com
*Connection pooling* **ligado** (host com `-pooler`) e **desligado**. Na Vercel, crie `DATABASE_URL` com a
string com pooler, nos três ambientes. Use a outra na carga inicial.

> O formato entregue pelo Neon (`postgresql://…?sslmode=require&channel_binding=require`) é aceito como está —
> a aplicação ajusta o driver sozinha. Se definida, `EE_DATABASE_URL` tem precedência sobre `DATABASE_URL`.

## 3. Carregar a base DEMO no Neon (uma vez, da sua máquina)

Use a string **direta** (`DATABASE_URL_UNPOOLED`, host **sem** `-pooler`). Para vê-la: Vercel → *Storage* →
banco → aba de variáveis (*Show secret*), ou console do Neon → *Connect* com pooling desligado.

```powershell
cd C:\Users\Gabriel\Downloads\bayer-eficiencia-energetica\backend

$env:EE_DATABASE_URL  = "postgresql://neondb_owner:SENHA@ep-XXXX.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
$env:EE_SEED_PASSWORD = "escolha-uma-senha-forte"    # senha dos 5 usuários de demonstração

.venv\Scripts\python -m app.seed.run

# limpa as variáveis para não rodar o ambiente local contra o Neon por engano
Remove-Item Env:EE_DATABASE_URL, Env:EE_SEED_PASSWORD
```

Saída esperada (o tempo depende da sua conexão; as medições são carregadas com `COPY`):

```
banco: postgresql+psycopg://neondb_owner:***@ep-XXXX.us-east-1.aws.neon.tech/neondb?...
...
[  ... s] medições: 271846
...
Base DEMO criada com sucesso.
```

- Rodar de novo **recria** o schema do zero (apaga o que houver no banco).
- O Neon não tem TimescaleDB; a aplicação detecta e usa PostgreSQL puro, sem impacto no funcionamento.
- Guarde a senha usada em `EE_SEED_PASSWORD`: é com ela que se entra no dashboard publicado.

## 4. Variáveis de ambiente na Vercel

*Settings → Environment Variables* (marque **Production, Preview e Development**):

| Variável | Obrigatória | Valor |
|---|---|---|
| `DATABASE_URL` | sim | criada pela integração Neon (passo 2) |
| `EE_JWT_SECRET` | sim | segredo aleatório longo — gere com `backend\.venv\Scripts\python -c "import secrets; print(secrets.token_hex(32))"` |
| `EE_ENVIRONMENT` | recomendado | `demo` (mantém o aviso de dados fictícios) |
| `EE_DEMO_AUTH` | opcional | `false` esconde os perfis de um clique na tela de login |
| `EE_INGESTION_API_KEY` | opcional | chave do endpoint de ingestão máquina-a-máquina |

**Depois de criar ou alterar variáveis, faça Redeploy** (*Deployments → ⋯ → Redeploy*). Variáveis novas não
entram em deploys que já existem.

## 5. Verificar

```powershell
curl https://gestao-energetica.vercel.app/health
# {"status":"ok","database":"postgresql","environment":"demo"}

curl https://gestao-energetica.vercel.app/api/auth/demo-users
# lista com os 5 perfis → API, conexão com o Neon e carga OK
```

No navegador: login com um perfil e a senha do passo 3 → dashboard → *Recebimento → Fluxograma* → clicar em
**Secador** → abrir um indicador → *Comparações → Crop Year × Crop Year*.

Os roteiros automatizados também rodam contra o ambiente publicado (eles entram com a senha `demo`; se você
definiu outra no seed, ajuste o login no início dos scripts):

```powershell
cd frontend
$env:BASE_URL = "https://gestao-energetica.vercel.app"
node scripts/ui-smoke.mjs
```

A primeira requisição após alguns minutos parado pode levar alguns segundos: o Neon suspende a computação
ociosa e a função Python também tem *cold start*.

## 6. Segurança antes de compartilhar o endereço

1. `EE_JWT_SECRET` aleatório e exclusivo (sem ele, vale o segredo padrão do código).
2. Senha de demonstração própria via `EE_SEED_PASSWORD` (sem ela, a senha publicada é `demo`).
3. `EE_DEMO_AUTH=false` para esconder a lista de perfis (o login por formulário continua funcionando).
4. Se o conteúdo não puder ser público: *Settings → Deployment Protection*.
5. Mantenha o aviso **DEMO/MOCK DATA** enquanto os dados não forem reais.

## 7. Limitações nesta topologia

| Tema | Situação | Quando incomodar |
|---|---|---|
| Cold start | função Python + Neon suspenso: a primeira chamada pode levar alguns segundos | desligar *autosuspend* no Neon (planos pagos) ou manter a API em servidor contínuo |
| Duração máxima | `maxDuration: 60` no `vercel.json`; consultas medidas entre 0,02 s e 0,5 s | reduza para `10` se o plano recusar |
| Worker/cron | materialização de `indicator_value` e alarmes não rodam | Vercel Cron chamando endpoint protegido, ou worker fora da Vercel |
| TimescaleDB | indisponível no Neon | volume industrial real (1 min, anos de retenção): Timescale Cloud, trocando só a URL |
| Logs | `vercel logs gestao-energetica` | qualquer erro da função aparece ali com o traceback |

## 8. Problemas comuns

| Sintoma | Causa | Correção |
|---|---|---|
| 500 `FUNCTION_INVOCATION_FAILED` em todas as rotas; log com `RuntimeError: SQLite não funciona em ambiente serverless` | banco não conectado, ou variável criada sem redeploy | passos 2 e 4, depois **Redeploy** |
| 500 em todas as rotas mesmo com banco configurado | `"framework": null` removido ou preset escolhido no painel | restaurar o `vercel.json`; em *Settings → Build and Deployment*, Framework Preset = *Other* |
| `relation "app_user" does not exist` nos logs | banco conectado, carga não executada | passo 3 |
| Login recusado | senha diferente da usada no seed | repetir o passo 3 com `EE_SEED_PASSWORD` conhecido |
| Seed falha com `connection timeout` | string errada, banco demorando a acordar ou rede corporativa bloqueando a porta 5432 | conferir a string direta; tentar de outra rede |
| Lentidão constante (não só na primeira chamada) | banco e função em regiões diferentes | recriar o banco em AWS US East 1 |
| 404 ao recarregar uma rota interna | rewrite do SPA ausente | manter a última regra de `rewrites` no `vercel.json` |

## 9. Outras topologias

| Cenário | Recomendação |
|---|---|
| Demonstração e validação com a equipe | **Vercel + Neon** (este guia) |
| Uso interno contínuo | Docker Compose deste repositório (API + TimescaleDB) em servidor/VM; front-end na Vercel ou no mesmo Nginx |
| Rede fechada da planta | Docker Compose dentro da rede |
