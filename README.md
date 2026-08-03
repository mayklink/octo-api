# octo-api

API NestJS responsável por persistência, autenticação, Azure DevOps, orquestração E2B e integração RabbitMQ do Octob. O `llm-worker` permanece sem estado e não publica conteúdo no Azure DevOps.

## Requisitos

- Node.js 22
- pnpm 10.15
- PostgreSQL 15+
- RabbitMQ 4 com suporte a quorum queues
- Projeto Supabase Auth usando signing key assimétrica
- Template E2B `octob-review-worker` já publicado

## Desenvolvimento

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm prisma:generate
pnpm migrate:deploy
pnpm seed
pnpm dev
```

Edite o seed com um `SEED_USER_ID` que corresponda ao `sub` do usuário no Supabase. A API não implementa login nem cria organizações automaticamente.

Swagger fica em `http://localhost:3000/docs`. Liveness e readiness ficam em `/health/live` e `/health/ready`.

## Autenticação do frontend

O frontend autentica diretamente no Supabase Auth. A API não recebe nem armazena a senha do usuário e não expõe rotas próprias de login, refresh ou logout.

Configure no frontend apenas valores públicos:

```env
SUPABASE_URL=https://project-ref.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
OCTOB_API_URL=https://api.example.com
```

Depois do login com o SDK do Supabase, envie o `access_token` em todas as chamadas protegidas:

```http
Authorization: Bearer <supabase-access-token>
X-Organization-Id: <organization-uuid>
```

O header `X-Organization-Id` não é necessário em `GET /me` e `GET /organizations`. O fluxo recomendado é:

1. Autenticar no Supabase com e-mail/senha, magic link ou OAuth.
2. Consultar `GET /me` para validar a sessão na API.
3. Consultar `GET /organizations` e selecionar uma organização.
4. Enviar o UUID escolhido em `X-Organization-Id` nas demais rotas.

As URLs do frontend devem ser cadastradas em **Authentication → URL Configuration** no Dashboard do Supabase. Senhas, tokens de sessão, chaves `service_role`, PATs e arquivos `auth.json` nunca devem ser adicionados ao repositório; provisione e rotacione esses valores fora do Git.

## Ordem de configuração

1. Executar migrations e provisionar organização/membership com o seed.
2. Configurar o auth do Codex com `PUT /organizations/:id/integrations/codex`.
3. Criar um repositório com `POST /repositories`.
4. Enviar o PAT em `PUT /repositories/:id/integrations/azure-devops`.
5. Copiar a `webhookUrl` retornada e configurá-la no Service Hook do Azure DevOps.
6. Enviar JWT Supabase e `X-Organization-Id` nas rotas protegidas.

O token do webhook aparece na URL somente durante criação/rotação. A aplicação persiste apenas SHA-256 e remove `token` dos logs estruturados.

## Rotas

| Método | Rota | Uso |
| --- | --- | --- |
| GET | `/me` | Identidade autenticada |
| GET | `/organizations` | Memberships do usuário |
| GET/POST | `/repositories` | Listar e cadastrar repositórios |
| PATCH | `/repositories/:id` | Alterar nome/estado |
| PUT | `/repositories/:id/integrations/azure-devops` | Validar e rotacionar PAT |
| POST | `/repositories/:id/webhook-secret/rotate` | Rotacionar URL secreta |
| PUT | `/organizations/:id/integrations/codex` | Armazenar auth.json cifrado |
| GET/POST | `/review-jobs` | Listar/criar reviews |
| GET | `/review-jobs/:id` | Detalhes e tentativas |
| POST | `/review-jobs/:id/retry` | Retry manual |
| GET | `/review-jobs/:id/findings` | Findings persistidos |
| GET/PUT | `/review-settings/:repositoryId` | Política do repositório |
| POST | `/webhooks/azure-devops` | Service Hook público autenticado por token |

## Processamento

Criação de review persiste job, tentativa e outbox na mesma transação. O dispatcher publica `review.requested.v2` com publisher confirm e `mandatory`, e somente depois inicia o sandbox E2B. Resultados são validados com AJV e deduplicados por `eventId` na inbox.

`review.attempt_failed` agenda backoff persistido; `review.failed` é terminal. `review.completed` persiste findings e cria publicações idempotentes. Um scheduler publica threads e status no Azure DevOps, mantendo falha de publicação separada do resultado técnico do review.

## Segurança

- PAT e auth do Codex usam AES-256-GCM em repouso.
- Cada tentativa cria envelopes de transporte separados para `source-control` e `engine` com IV novo e AAD compatível com o worker v2.
- Authorization, query token, PAT, auth JSON e ciphertext são redigidos nos logs.
- Toda consulta de domínio é limitada à organização validada pelo guard.
- A API aceita apenas modelos presentes em `ALLOWED_CODEX_MODELS`.

## Validação

```bash
pnpm check
```

Executa ESLint, typecheck, testes Vitest e build NestJS. A suíte cobre validação do contrato v2, binding AES-GCM/AAD, formato do auth Codex e segredo do webhook.
