# 003 — Configurar modelo de LLM (Codex) por organização

## Contexto

Hoje a política de modelos de LLM usados pelo engine de review (`codex`) é global e vem de variáveis de ambiente da API (`ALLOWED_CODEX_MODELS`, `DEFAULT_CODEX_MODEL`, validadas em `src/config/environment.ts` e mapeadas em `src/config/configuration.ts` como `review.allowedModels`/`review.defaultModel`). Isso afeta três pontos: a semente de `ReviewSetting.model` ao criar um repositório (`repositories.service.ts`), a validação de qualquer `model` informado em `ReviewSetting` (`ReviewsService.assertModel`) e o endpoint que expõe a lista de modelos permitidos ao front-end (`GET /review-settings/allowed-models`). Como o sistema é multi-tenant (`organizationId` presente na maioria dos models), diferentes organizações podem precisar de políticas de modelo diferentes (ex.: acesso a modelos distintos por plano/contrato), o que uma única variável de ambiente global não permite.

## Objetivo

Mover a política de modelos permitidos e o modelo padrão para dentro da organização, persistida no Postgres via Prisma, mantendo as variáveis de ambiente apenas como valores de fábrica (fallback) usados quando a organização ainda não tem política própria configurada.

## Escopo

- Adicionar `allowedModels` (lista) e `defaultModel` a `Organization` no Prisma schema, com migration correspondente.
- Alterar `ReviewsService.assertModel` e `ReviewsService.getAllowedModels` para ler a política a partir da organização, com fallback para `review.allowedModels`/`review.defaultModel` (env) quando a organização não tiver `allowedModels`/`defaultModel` definidos.
- Alterar `RepositoriesService.create` para semear `ReviewSetting.model` com o `defaultModel` efetivo da organização (organização, com fallback ao valor global).
- Expor endpoints em `organizations` para o owner/admin consultar e atualizar `allowedModels`/`defaultModel` da própria organização.
- Garantir que `DEFAULT_CODEX_MODEL` continue obrigatório em `ALLOWED_CODEX_MODELS` (regra hoje em `validateEnvironment`) e que a mesma regra (`defaultModel` ∈ `allowedModels`) valha para a política por organização.
- Atualizar `.env.example` (comentário) e documentação relevante indicando que os env vars agora são apenas fallback.

## Fora do escopo

- Suporte a múltiplos engines de LLM além de `codex` (contrato `engine.kind: "codex"` permanece fixo).
- Billing, cobrança ou limite de uso por modelo.
- Migração de dados históricos de `ReviewSetting.model` (repositórios já existentes mantêm o `model` já salvo; a mudança afeta apenas a política de validação e a semente de novos repositórios).
- Alterar o payload `ReviewRequestedV2`/contratos de fila (`review.schemas.ts`, `review-contracts.ts`) — o campo `engine.model` continua sendo apenas o valor já resolvido por `ReviewSetting`.
- UI do `octoreview` para gerenciar a política (fica como consumo futuro do contrato HTTP; este spec cobre apenas a API).

## Requisitos

1. O Prisma schema deve adicionar em `Organization`: `allowedModels String[] @default([])` e `defaultModel String? @map("default_model")`, com migration correspondente (`prisma/migrations`).
2. `review.allowedModels`/`review.defaultModel` (vindos de `ALLOWED_CODEX_MODELS`/`DEFAULT_CODEX_MODEL`) passam a ser tratados como fallback global de fábrica, não mais como única fonte de verdade em runtime.
3. Deve existir um método (ex.: `resolveModelPolicy(organizationId)`) que retorna `{ allowedModels, defaultModel }` efetivos da organização: se `Organization.allowedModels` estiver vazio, usar `review.allowedModels`; se `Organization.defaultModel` for `null`, usar `review.defaultModel`.
4. `ReviewsService.getAllowedModels(organizationId)` deve retornar a política efetiva (via requisito 3), e a rota `GET /review-settings/allowed-models` deve passar a exigir `organizationId` do contexto autenticado (já disponível via `AuthContext`) e repassá-lo ao service.
5. `ReviewsService.assertModel` deve validar o `model` contra a política efetiva da organização (requisito 3), não mais contra o env var global diretamente.
6. `RepositoriesService.create` deve semear `ReviewSetting.model` com o `defaultModel` efetivo da organização (requisito 3), em vez de `config.getOrThrow("review.defaultModel")` direto.
7. Deve existir `GET /organizations/:organizationId/model-policy`, protegido por `@Roles("owner", "admin")`, retornando a política efetiva da organização (mesmo formato do requisito 4).
8. Deve existir `PUT /organizations/:organizationId/model-policy`, protegido por `@Roles("owner")`, recebendo `UpdateModelPolicyDto` (`allowedModels: string[]`, `defaultModel: string`) validado por `class-validator`, persistindo em `Organization` e retornando a política atualizada.
9. A atualização do requisito 8 deve validar que `defaultModel` está contido em `allowedModels` e que `allowedModels` não é uma lista vazia; violação deve responder `400` via `BadRequestException` (mesmo padrão de erro do `GlobalExceptionFilter`).
10. A atualização do requisito 8 deve validar que toda organização respeita `organizationId` do contexto autenticado (mesmo padrão de `assertOrganization` já usado em `OrganizationsController`); não pode haver acesso cross-tenant.
11. Alterar `allowedModels` de uma organização para uma lista que não contenha o `model` já salvo em algum `ReviewSetting` existente da mesma organização não deve falhar nem alterar retroativamente esses `ReviewSetting`; a nova política vale apenas para futuras criações/atualizações de `ReviewSetting` (`assertModel`).
12. Devem ser adicionados/estendidos testes de integração cobrindo: fallback para env var quando a organização não tem política própria, resolução da política quando a organização tem política própria, `assertModel` rejeitando modelo fora da política efetiva, seed de `ReviewSetting.model` usando o `defaultModel` efetivo, autorização das duas novas rotas (`owner`/`admin` para leitura, `owner` para escrita) e a validação do requisito 9.

## Critérios de aceitação

- `Organization` possui `allowedModels`/`defaultModel` persistidos no Postgres, com migration aplicada.
- Uma organização sem política própria continua funcionando exatamente como hoje (fallback para env var), sem quebra de comportamento para tenants existentes.
- Uma organização com política própria tem seus modelos permitidos e modelo padrão respeitados em: criação de repositório (seed do `ReviewSetting.model`), atualização de `ReviewSetting` (`assertModel`) e no endpoint `GET /review-settings/allowed-models`.
- `GET /organizations/:organizationId/model-policy` e `PUT /organizations/:organizationId/model-policy` existem, respeitam `organizationId` do contexto autenticado e os roles definidos nos requisitos 7 e 8.
- `PUT /organizations/:organizationId/model-policy` recusa `defaultModel` fora de `allowedModels` e `allowedModels` vazio.
- `pnpm check` (lint, typecheck, testes e build) passa sem erros novos.

## Restrições

- Seguir `project/PROJECT.md`: arquitetura `controller → service → PrismaService`, DTOs `class-validator`, nomenclatura `kebab-case`, controllers dependendo apenas de service/DTO do próprio módulo.
- Não remover nem contornar `ValidationPipe` global, `SupabaseAuthGuard` ou o `Roles` guard existentes.
- Não alterar o contrato de fila (`ReviewRequestedV2`/`review.schemas.ts`) nem o formato de erro do `GlobalExceptionFilter`.
- Não fazer refatoração oportunista fora do escopo listado (ex.: não mexer no fluxo de convites/membros do módulo `organizations` além do necessário para adicionar as duas novas rotas).
- Preservar a regra já existente de `defaultModel` ∈ `allowedModels`, tanto para o fallback global (`validateEnvironment`, inalterado) quanto para a política por organização (requisito 9).

## Validação

- Executar `pnpm check` no `octo-api` (lint + typecheck + test + build).
- Executar os testes de integração novos/estendidos cobrindo o service de resolução de política, `assertModel`, seed de `ReviewSetting.model` e autorização das rotas de `model-policy`.
- Revisar manualmente que uma organização existente (sem `allowedModels`/`defaultModel` definidos) continua se comportando de forma idêntica ao estado atual (fallback para env var).
