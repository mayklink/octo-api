# Corrigir desvios dos padrões arquiteturais em Health, Organizations e Webhooks

## Contexto

Uma auditoria de conformidade contra `project/PROJECT.md` identificou 3 desvios concretos dos padrões de camadas/módulos do projeto:

1. `HealthController` (`src/modules/health/health.controller.ts`) injeta `PrismaService` e `RabbitConnection` (adaptador de infraestrutura de outro módulo) diretamente, sem passar por um service do próprio módulo.
2. `OrganizationsController` (`src/modules/organizations/organizations.controller.ts`) injeta `PrismaService` diretamente e o módulo `organizations` não possui `service` nem `dto`, quebrando a estrutura padrão `controller/service/dto/module`.
3. `WebhooksService` (`src/modules/webhooks/webhooks.service.ts`) lê modelos de outros domínios (`Repository`, `ReviewJob`) diretamente via `PrismaService`, em vez de usar os services públicos `RepositoriesService` e `ReviewsService`. A leitura de `Repository` (linha 12) não filtra por `organizationId`, criando risco de acesso cross-tenant.

## Objetivo

Alinhar os três pontos à regra documentada em `project/PROJECT.md`: "controllers só podem depender de services e dtos do próprio módulo" e "acesso a dados de outro domínio deve passar pelo service público do módulo dono", sem alterar o comportamento observável das rotas/eventos existentes (exceto a correção do escopo de tenant, que é uma correção de bug de segurança implícita na conformidade).

## Escopo

- Criar `HealthService` no módulo `health`, movendo para lá o acesso a `PrismaService`/`RabbitConnection`; `HealthController` passa a depender apenas de `HealthService`.
- Criar `OrganizationsService` e `OrganizationsDto` (ou reaproveitar DTO existente equivalente) no módulo `organizations`, movendo a consulta hoje feita no controller; `OrganizationsController` passa a depender apenas do novo service.
- Em `WebhooksService`: substituir a leitura direta do model `Repository` por chamada ao método público de `RepositoriesService` (adicionando um método novo se necessário, escopado por `organizationId`), e substituir a leitura direta do model `ReviewJob` por um método público equivalente exposto por `ReviewsService` (criar `findByCorrelationId` ou similar caso não exista).
- Ajustar `WebhooksModule` para importar `RepositoriesModule` explicitamente (hoje o acesso só funciona por `PrismaService` ser global).
- Preservar o contrato HTTP e o comportamento funcional atuais (mesmos endpoints, mesmas respostas, mesmo comportamento de deduplicação de webhook), exceto pela correção do escopo de `organizationId` na consulta de repositório, que deve passar a filtrar corretamente.

## Fora do escopo

- Qualquer refatoração do `messaging` (`outbox-dispatcher.service.ts`, `runtime-reconciler.service.ts`) que acessa modelos de `reviews` diretamente — tratado no PROJECT.md como camada de infraestrutura; não incluído nesta tarefa.
- Novas funcionalidades, otimizações de performance, ou mudanças em outros módulos não citados.
- Adição de testes automatizados para módulos hoje sem cobertura, além do necessário para validar as mudanças desta tarefa.
- Alteração de esquemas Prisma.

## Requisitos

1. `HealthController` não deve importar nem injetar `PrismaService` ou `RabbitConnection`; toda lógica de verificação de saúde deve estar em `HealthService`.
2. `OrganizationsController` não deve importar nem injetar `PrismaService`; a consulta de membros/organizações deve estar em `OrganizationsService`, exposta via método público.
3. `OrganizationsModule` deve seguir a estrutura padrão do projeto (`controller`, `service`, `dto` quando aplicável, `module`).
4. `WebhooksService` não deve consultar `this.prisma.repository` nem `this.prisma.reviewJob` diretamente; deve usar métodos públicos de `RepositoriesService` e `ReviewsService`.
5. A consulta de repositório usada por `WebhooksService` deve ser escopada por `organizationId` do contexto do webhook (ou documentar explicitamente, se o `organizationId` não estiver disponível nesse ponto do fluxo, por que a checagem de tenant precisa ocorrer em outra camada).
6. `WebhooksModule` deve declarar explicitamente as dependências de módulo necessárias (`RepositoriesModule`, e `ReviewsModule` já presente).
7. Nenhum comportamento de rota, resposta HTTP ou payload de evento deve mudar de forma não sinalizada.

## Critérios de aceitação

- `grep -rn "PrismaService" src/modules/health/health.controller.ts src/modules/organizations/organizations.controller.ts` não retorna resultado.
- `grep -n "this.prisma.repository\|this.prisma.reviewJob" src/modules/webhooks/webhooks.service.ts` não retorna resultado.
- `src/modules/organizations/` contém `organizations.service.ts` (e `organizations.module.ts`/`organizations.controller.ts` atualizados).
- `src/modules/webhooks/webhooks.module.ts` importa `RepositoriesModule`.
- `pnpm check` (lint + typecheck + test + build) passa sem erros novos introduzidos por esta mudança.
- Testes de integração existentes relacionados (`test/*.test.ts` cobrindo webhooks/credentials/contracts/azure-devops) continuam passando.

## Restrições

- Seguir os padrões de Clean Code/SOLID e nomenclatura (`kebab-case`, um export principal por arquivo) já documentados em `project/PROJECT.md`.
- Não introduzir camada de `repository`/`entity`; manter acesso a dados via `PrismaService` dentro dos services, como já é o padrão do projeto.
- Não remover validações, guards ou testes existentes.
- Não fazer refatorações fora do escopo listado acima.

## Validação

- Executar `npm run lint`, `npm run build` e `npm test` (conforme `ventury.yaml`) e reportar o resultado.
- Revisão manual confirmando que os 3 desvios apontados na auditoria foram eliminados e que nenhum novo desvio foi introduzido.

## Adendo (mesma tarefa, escopo estendido a pedido explícito do usuário)

Após a implementação inicial, o usuário solicitou explicitamente duas ações complementares, ambas mantidas dentro do espírito desta especificação (consolidar a conformidade arquitetural e sua documentação):

1. Documentar em `project/PROJECT.md`, seção "Decisões importantes", a exceção arquitetural já existente e identificada na auditoria (mas fora do escopo de código desta tarefa): `messaging` (`OutboxDispatcherService`, `RuntimeReconcilerService`) acessa modelos de `reviews` diretamente via `PrismaService` por ser tratado como camada de infraestrutura. Mudança somente de documentação, sem alteração de comportamento de código.
2. Adicionar testes de integração em `test/*.test.ts` para os módulos alterados nesta tarefa (`HealthService`, `OrganizationsService`, `WebhooksService`), seguindo a convenção existente de exercitar as classes reais com dependências leves/fakes no lugar de infraestrutura real (não há Postgres/RabbitMQ locais disponíveis neste ambiente; `DATABASE_URL`/`RABBITMQ_URL` apontam para infraestrutura gerenciada real, então os testes não devem depender delas).
