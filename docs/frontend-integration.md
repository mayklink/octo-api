# Integração do frontend com o Octob API

Este documento descreve o contrato HTTP atualmente exposto pelo `octo-api`. Os exemplos usam valores fictícios e não devem conter credenciais reais.

## Visão geral

- A autenticação acontece diretamente no Supabase Auth.
- O frontend envia o `access_token` do Supabase como Bearer token para a API.
- Depois de selecionar uma organização, o frontend envia também `X-Organization-Id`.
- Todas as respostas e requisições com corpo usam JSON.
- Datas são strings ISO 8601 em UTC.
- IDs internos são UUIDs, exceto o ID do pull request no Azure DevOps, que é uma string.
- A API usa camelCase nos campos JSON.

## Configuração

Variáveis públicas esperadas pelo frontend:

```env
SUPABASE_URL=https://project-ref.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
OCTOB_API_URL=https://api.example.com
```

Nunca inclua no bundle do frontend ou no Git:

- senha de usuário;
- chave `service_role`;
- PAT do Azure DevOps;
- `auth.json` do Codex;
- token secreto do webhook;
- chaves de criptografia da API.

## Autenticação

A API não possui endpoints próprios de login, refresh ou logout. Use o SDK do Supabase no frontend:

```ts
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.SUPABASE_URL,
  import.meta.env.SUPABASE_PUBLISHABLE_KEY,
);

const { data, error } = await supabase.auth.signInWithPassword({
  email,
  password,
});

if (error) throw error;
const accessToken = data.session.access_token;
```

Configure no Dashboard do Supabase, em **Authentication → URL Configuration**, a URL do frontend e os redirects permitidos.

### Headers

Rotas autenticadas sem contexto obrigatório de organização:

```http
Authorization: Bearer <supabase-access-token>
```

Demais rotas protegidas:

```http
Authorization: Bearer <supabase-access-token>
X-Organization-Id: <organization-uuid>
Content-Type: application/json
```

`GET /me` e `GET /organizations` não exigem `X-Organization-Id`. O endpoint de integração Codex exige que o header tenha o mesmo UUID presente na URL.

### Cliente HTTP sugerido

```ts
type ApiOptions = RequestInit & { organizationId?: string };

export async function octobFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Unauthenticated");

  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (options.organizationId) headers.set("X-Organization-Id", options.organizationId);
  if (options.body) headers.set("Content-Type", "application/json");

  const response = await fetch(`${import.meta.env.OCTOB_API_URL}${path}`, {
    ...options,
    headers,
  });

  const body = await response.json();
  if (!response.ok) throw body as ApiError;
  return body as T;
}
```

## Tipos compartilhados

```ts
type UUID = string;
type ISODate = string;

type MemberRole = "owner" | "admin" | "member";
type RepositoryStatus = "pending" | "active" | "disabled" | "error";
type JobSource = "manual" | "webhook" | "retry";
type JobStatus = "created" | "queued" | "running" | "retry_wait" | "completed" | "failed";
type AttemptStatus = "created" | "published" | "running" | "retry_wait" | "completed" | "failed" | "timed_out";
type Severity = "info" | "warning" | "error";

interface ApiError {
  statusCode: number;
  code: string;
  message: string | string[];
  details?: string[];
  correlationId: string;
  timestamp: ISODate;
}

interface AuthContext {
  userId: UUID;
  email?: string;
  organizationId?: UUID;
  role?: MemberRole;
  correlationId: string;
}

interface Organization {
  id: UUID;
  name: string;
  slug: string;
  role: MemberRole;
  createdAt: ISODate;
  updatedAt: ISODate;
}

interface Repository {
  id: UUID;
  organizationId: UUID;
  name: string;
  provider: "azure-devops";
  azureOrganization: string;
  azureProjectId: string;
  azureRepositoryId: string;
  cloneUrl: string;
  status: RepositoryStatus;
  webhookSecretVersion: number;
  createdAt: ISODate;
  updatedAt: ISODate;
}

interface PullRequest {
  id: UUID;
  repositoryId: UUID;
  providerPullRequestId: string;
  title: string;
  status: string;
  sourceBranch: string;
  targetBranch: string;
  sourceCommit: string;
  targetCommit: string;
  raw: unknown | null;
  createdAt: ISODate;
  updatedAt: ISODate;
}

interface ReviewAttempt {
  id: UUID;
  reviewJobId: UUID;
  attempt: number;
  eventId: string;
  status: AttemptStatus;
  sandboxId: string | null;
  deadlineAt: ISODate;
  nextRetryAt: ISODate | null;
  failureCode: string | null;
  failureCategory: string | null;
  failureMessage: string | null;
  timings: ReviewTimings | null;
  startedAt: ISODate | null;
  completedAt: ISODate | null;
  createdAt: ISODate;
  updatedAt: ISODate;
}

interface ReviewTimings {
  totalMs?: number;
  azureMs?: number;
  repositoryMs?: number;
  contextMs?: number;
  engineMs?: number;
}

interface ReviewSummary {
  markdown: string;
  filesReviewed: number;
  findingsBySeverity: Record<Severity, number>;
  truncated: boolean;
  engine: { name: string; version?: string; model: string };
  policyVersion: string;
  tokenUsage?: { input?: number; output?: number; total?: number };
}

interface ReviewFinding {
  id: UUID;
  reviewJobId: UUID;
  attemptId: UUID;
  ordinal: number;
  filePath: string;
  line: number | null;
  severity: Severity;
  category: string;
  title: string;
  description: string;
  suggestion: string | null;
  createdAt: ISODate;
}

interface ReviewSettings {
  repositoryId: UUID;
  prompt: string;
  severityThreshold: Severity | null;
  model: string;
  autoReview: boolean;
  policyVersion: string;
  maxAttempts: number;
  createdAt: ISODate;
  updatedAt: ISODate;
}
```

## Formato de erro

Toda falha passa pelo mesmo envelope:

```json
{
  "statusCode": 400,
  "code": "BAD_REQUEST",
  "message": ["name must be shorter than or equal to 160 characters"],
  "details": ["name must be shorter than or equal to 160 characters"],
  "correlationId": "4d3d75c0-8956-4a47-9a6f-bd27ce4492aa",
  "timestamp": "2026-08-03T12:00:00.000Z"
}
```

Erros relevantes para o frontend:

| Status | Situação |
| --- | --- |
| `400` | Header de organização inválido, UUID inválido ou DTO rejeitado |
| `401` | Bearer token ausente, inválido ou expirado |
| `403` | Usuário fora da organização ou sem papel suficiente |
| `404` | Recurso não encontrado dentro da organização |
| `409` | Repositório duplicado ou job ainda ativo |
| `422` | Webhook do Azure com payload inválido |
| `502` | Azure DevOps indisponível ou retornou resposta inválida |
| `503` | Banco ou RabbitMQ indisponível no readiness |

Todas as respostas expõem `x-correlation-id`. Preserve esse valor ao registrar um erro no frontend.

## Rotas públicas

### `GET /health/live`

Confirma que o processo está vivo.

Resposta `200`:

```json
{
  "status": "ok",
  "timestamp": "2026-08-03T12:00:00.000Z"
}
```

### `GET /health/ready`

Confirma acesso ao PostgreSQL e RabbitMQ.

Resposta `200`:

```json
{
  "status": "ready",
  "checks": {
    "database": "up",
    "rabbitmq": "up"
  }
}
```

Retorna `503` quando uma dependência obrigatória não está pronta.

## Sessão e organizações

### `GET /me`

Headers: somente Bearer token.

Resposta `200`: `AuthContext` sem `organizationId` e `role` quando nenhum header de organização for enviado.

```json
{
  "userId": "7f85b833-aebe-44cf-9bbc-e1b7b3fc3fd4",
  "email": "user@example.com",
  "correlationId": "4d3d75c0-8956-4a47-9a6f-bd27ce4492aa"
}
```

### `GET /organizations`

Headers: somente Bearer token.

Resposta `200`:

```ts
{ data: Organization[] }
```

Não existem atualmente rotas públicas para criar organizações, convidar membros ou alterar papéis. Esses dados precisam ser provisionados administrativamente.

## Repositórios

Todas as rotas desta seção exigem Bearer token e `X-Organization-Id`.

### `GET /repositories`

Permissão: qualquer membro.

Resposta `200`:

```ts
Repository[]
```

Os itens são ordenados do mais recente para o mais antigo.

### `POST /repositories`

Permissão: `owner` ou `admin`.

Body:

```ts
{
  name: string;                 // 1..160
  azureOrganization: string;    // 1..160
  azureProjectId: string;       // 1..256; nome ou UUID aceito pelo Azure
  azureRepositoryId: string;    // 1..256
  cloneUrl: string;             // URL HTTPS
}
```

Exemplo:

```json
{
  "name": "service-api",
  "azureOrganization": "example-org",
  "azureProjectId": "example-project",
  "azureRepositoryId": "11111111-1111-4111-8111-111111111111",
  "cloneUrl": "https://dev.azure.com/example-org/example-project/_git/service-api"
}
```

Resposta `201`: `Repository`, inicialmente com `status: "pending"`. A API também cria as configurações padrão de revisão.

### `PATCH /repositories/:id`

Permissão: `owner` ou `admin`.

Body:

```ts
{
  name?: string;   // 1..160
  enabled?: boolean;
}
```

`enabled: true` altera o status para `active`; `false`, para `disabled`.

Resposta `200`: `Repository`.

### `PUT /repositories/:id/integrations/azure-devops`

Permissão: `owner` ou `admin`.

Body:

```ts
{ pat: string } // 1..512
```

A API valida o PAT consultando o repositório no Azure, cifra a credencial em repouso, ativa o repositório e gera um novo segredo de webhook.

Resposta `200`:

```ts
Repository & { webhookUrl: string }
```

`webhookUrl` contém um token secreto e é retornada somente nessa configuração/rotação. O frontend deve permitir copiá-la, mas nunca persistir o valor em analytics, logs ou armazenamento público.

### `POST /repositories/:id/webhook-secret/rotate`

Permissão: `owner` ou `admin`.

Sem body.

Resposta `201`:

```ts
{ webhookUrl: string }
```

A URL anterior deixa de ser válida imediatamente.

## Credencial Codex

### `PUT /organizations/:organizationId/integrations/codex`

Permissão: `owner` ou `admin`. Exige Bearer token e `X-Organization-Id` igual a `:organizationId`.

Body:

```ts
{
  authJson: {
    OPENAI_API_KEY?: null;
    auth_mode?: "chatgpt";
    tokens: {
      access_token: string;
      refresh_token: string;
      account_id: string;
      id_token?: string;
    };
    [key: string]: unknown;
  };
}
```

`OPENAI_API_KEY` deve estar ausente ou ser `null`. Os três campos obrigatórios de `tokens` precisam ser strings não vazias.

Resposta `200`:

```json
{
  "connected": true,
  "validatedAt": "2026-08-03T12:00:00.000Z"
}
```

O contrato atual não possui `GET` para consultar o estado dessa integração. O frontend deve considerar sucesso após o `PUT` e obter novamente esse estado quando uma rota de leitura for implementada.

## Configurações de revisão

### `GET /review-settings/:repositoryId`

Permissão: qualquer membro da organização.

Resposta `200`: `ReviewSettings`.

### `PUT /review-settings/:repositoryId`

Permissão: `owner` ou `admin`.

Body completo:

```ts
{
  prompt: string;                         // 1..60000
  model: string;                          // 1..128 e presente na allowlist da API
  severityThreshold?: Severity;
  autoReview: boolean;
  maxAttempts?: number;                   // inteiro entre 1 e 10
}
```

Resposta `200`: `ReviewSettings`.

O frontend deve carregar o objeto atual com `GET`, editar e enviar os campos obrigatórios `prompt`, `model` e `autoReview` no `PUT`.

## Reviews

Todas as rotas desta seção exigem Bearer token e `X-Organization-Id`.

### `GET /review-jobs?limit=25`

Permissão: qualquer membro.

- `limit` é inteiro.
- Padrão: `25`.
- Máximo efetivo: `100`.

Resposta `200`: array ordenado do job mais recente para o mais antigo.

```ts
interface ReviewJobListItem {
  id: UUID;
  organizationId: UUID;
  repositoryId: UUID;
  pullRequestId: UUID;
  source: JobSource;
  status: JobStatus;
  correlationId: string;
  currentAttempt: number;
  summary: ReviewSummary | null;
  completedAt: ISODate | null;
  createdAt: ISODate;
  updatedAt: ISODate;
  repository: { id: UUID; name: string };
  pullRequest: { providerPullRequestId: string; title: string };
}

type Response = ReviewJobListItem[];
```

### `GET /review-jobs/:id`

Permissão: qualquer membro.

Resposta `200`:

```ts
interface ReviewJobDetail {
  id: UUID;
  organizationId: UUID;
  repositoryId: UUID;
  pullRequestId: UUID;
  source: JobSource;
  status: JobStatus;
  correlationId: string;
  currentAttempt: number;
  summary: ReviewSummary | null;
  completedAt: ISODate | null;
  createdAt: ISODate;
  updatedAt: ISODate;
  repository: { id: UUID; name: string };
  pullRequest: PullRequest;
  attempts: ReviewAttempt[]; // tentativa mais recente primeiro
}
```

### `POST /review-jobs`

Permissão: `owner` ou `admin`.

Body:

```ts
{
  repositoryId: UUID;
  pullRequestId: string; // 1..128; ID do PR no Azure DevOps
}
```

Resposta `201`: `ReviewJobDetail`.

Antes de criar o job, a API consulta o Azure DevOps e agrega ao contexto enviado ao worker:

- metadados e descrição do pull request;
- work items vinculados, incluindo descrição e critérios de aceite quando disponíveis;
- discussões existentes no pull request;
- SHAs e branches atuais.

O repositório precisa estar `active`, e as credenciais Azure e Codex precisam estar configuradas.

### `POST /review-jobs/:id/retry`

Permissão: `owner` ou `admin`.

Sem body.

Resposta `201`: `ReviewJobDetail` com nova tentativa.

O retry é rejeitado quando o job ainda está em `created`, `queued` ou `running`, ou quando atingiu `maxAttempts`.

### `GET /review-jobs/:id/findings`

Permissão: qualquer membro.

Resposta `200`:

```ts
ReviewFinding[]
```

### Polling recomendado

1. Após criar ou selecionar um job, consulte `GET /review-jobs/:id`.
2. Enquanto `status` for `created`, `queued`, `running` ou `retry_wait`, faça polling com intervalo de 3 a 5 segundos.
3. Em `completed`, renderize `summary.markdown` e consulte `/findings`.
4. Em `failed`, mostre `failureCode`, `failureCategory` e `failureMessage` da tentativa mais recente.
5. Interrompa o polling ao desmontar a tela e aplique backoff quando houver erro de rede.

A publicação do comentário/status no Azure acontece de forma assíncrona depois da persistência do resultado. O contrato atual de leitura do job não expõe o estado das publicações.

## Webhook do Azure DevOps

### `POST /webhooks/azure-devops?repository=:repositoryId&token=:secret`

Esta rota é pública para o Azure DevOps e não deve ser chamada pelo frontend. A autenticação usa o token secreto presente na `webhookUrl`.

Eventos aceitos para review automático:

- `git.pullrequest.created`;
- `git.pullrequest.updated`.

Resposta HTTP `202`, conforme o caso:

```ts
type WebhookResponse =
  | { accepted: true; jobId: UUID }
  | { accepted: true; duplicate: true; jobId: UUID | null }
  | { accepted: true; duplicate: true; processing: true }
  | { accepted: true; ignored: true };
```

O evento é persistido antes da criação do review. O mesmo `providerEventId` não cria jobs duplicados.

## Matriz de permissões

| Operação | member | admin | owner |
| --- | :---: | :---: | :---: |
| Consultar organizações | Sim | Sim | Sim |
| Listar repositórios | Sim | Sim | Sim |
| Criar/editar repositório | Não | Sim | Sim |
| Configurar PAT/webhook | Não | Sim | Sim |
| Configurar Codex | Não | Sim | Sim |
| Ler configurações | Sim | Sim | Sim |
| Alterar configurações | Não | Sim | Sim |
| Listar/detalhar reviews e findings | Sim | Sim | Sim |
| Criar/reexecutar review | Não | Sim | Sim |

## Lacunas atuais para o frontend

Ainda não existem contratos HTTP para:

- criar ou editar organizações;
- convidar, remover ou alterar papel de membros;
- consultar o estado da integração Codex sem reconfigurá-la;
- consultar o estado da publicação do comentário no Azure;
- excluir repositórios ou reviews;
- paginação por cursor dos reviews;
- atualizações em tempo real por WebSocket ou SSE.

Até essas rotas existirem, o frontend deve tratar esses fluxos como indisponíveis ou administrativos.

## Referências locais

- Swagger/OpenAPI: `/docs`
- OpenAPI JSON: `/docs-json`
- Credenciais locais de desenvolvimento: `.secrets/` (ignorado pelo Git)
- Exemplo de ambiente da API: `.env.example`
