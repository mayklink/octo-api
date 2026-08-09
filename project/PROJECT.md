# Contexto do projeto

## Objetivo

Ainda precisa ser documentado: descreva o propósito do produto e o valor entregue.

## Tecnologias e versões

- Runtime: Node.js >= 22, gerenciado com pnpm 10.
- Framework: NestJS 11 (`@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`), TypeScript 5.9.
- Persistência: PostgreSQL via Prisma 6 (`prisma/schema.prisma`, schema único, 13 models).
- Validação: `class-validator` + `class-transformer` nos DTOs; `zod` para validação de variáveis de ambiente (`src/config/environment.ts`).
- Autenticação: JWT (Supabase) verificado com `jose`, aplicado globalmente via `APP_GUARD`.
- Mensageria/async: RabbitMQ (`amqplib`), padrão transactional outbox/inbox (`MessageOutbox`/`MessageInbox`), `@nestjs/schedule` para jobs agendados/retry.
- Execução isolada: E2B (`e2b`) para rodar o worker de review em sandbox.
- Observabilidade: `nestjs-pino` / `pino` com redaction de segredos e correlation id.
- Documentação de API: Swagger (`@nestjs/swagger`), exposto em `/docs`.
- Testes: Vitest (`vitest.config.ts`), lint com ESLint 9 (flat config) + `typescript-eslint`.

## Módulos ou serviços

Organização modular por domínio em `src/modules/*`, cada um com `*.controller.ts`, `*.service.ts`, `*.dto.ts` e `*.module.ts`:

- `auth` — guard global de autenticação (Supabase JWT).
- `organizations` — organizações e membros (multi-tenant).
- `credentials` — credenciais de integração (ex.: tokens Azure DevOps), armazenadas de forma criptografada.
- `contracts` — contratos/regras de negócio compartilhadas entre módulos.
- `azure-devops` — integração com Azure DevOps (repositórios, pull requests).
- `repositories` — repositórios monitorados por organização.
- `reviews` — núcleo do domínio: criação, publicação (`publication.service.ts`), processamento de resultado (`result-processor.service.ts`) e retry (`retry.scheduler.ts`) de review jobs.
- `webhooks` — ponto de entrada de eventos externos (ex.: PR aberto), com deduplicação e lock de processamento, que aciona `reviews`.
- `messaging` — módulo global (`@Global()`) com conexão RabbitMQ, dispatcher do outbox e cliente do runtime E2B.
- `health` — endpoint de health check.

## Arquitetura

Monólito modular NestJS, multi-tenant (a maioria dos models tem `organizationId`). Fluxo principal: um evento externo chega em `webhooks`, é deduplicado e validado, e aciona `reviews`, que cria um `ReviewJob`. O processamento pesado roda de forma assíncrona via `messaging` (outbox → RabbitMQ → execução em sandbox E2B), com resultado publicado de volta (`publication.service.ts`) e falhas tratadas por retry agendado (`retry.scheduler.ts`).

Fronteiras:
- **Camada HTTP** (`controllers`): recebe requisições, valida DTOs, delega para services. Não acessa Prisma nem outros módulos diretamente.
- **Camada de aplicação** (`services`): contém as regras de negócio e orquestra chamadas a Prisma, a outros módulos e a integrações externas.
- **Camada de infraestrutura** (`src/infrastructure`, partes de `src/modules/messaging`): adaptadores técnicos (Prisma, RabbitMQ, E2B) sem regra de negócio.
- **Transversal** (`src/common`, `src/config`): middleware de correlation id, filtro global de exceções, validação e mapeamento de configuração. Não depende de nenhum módulo de domínio.

## Organização das camadas

- `src/main.ts` / `src/app.module.ts` — bootstrap: registram `ValidationPipe` global (`transform`, `whitelist`, `forbidNonWhitelisted`), `GlobalExceptionFilter`, `SupabaseAuthGuard` (via `APP_GUARD`), `CorrelationIdMiddleware`, Swagger e `ScheduleModule`.
- `src/config` — camada mais interna: `environment.ts` valida `process.env` com Zod; `configuration.ts` mapeia para um objeto tipado (`app`, `auth`, `rabbit`, `secrets`, `e2b`, `review`, `azure`) consumido via `ConfigService`. Não deve depender de mais nada em `src/`.
- `src/common` — utilitários transversais reutilizáveis por qualquer módulo (middleware, exception filter). Não conhece regras de negócio de nenhum módulo específico.
- `src/infrastructure/prisma` — encapsula o `PrismaService`/`PrismaModule`. É a única porta de acesso ao banco.
- `src/modules/<feature>` — cada módulo segue o padrão `controller → service → PrismaService`. Não há camada de `repository`/`entity` separada hoje: os services acessam `PrismaService` diretamente e são responsáveis pela persistência do próprio domínio. Módulos mais complexos (ex.: `reviews`) dividem a lógica em múltiplos services especializados (`ReviewsService`, `PublicationService`, `ResultProcessorService`, `RetryScheduler`) em vez de um único service "faz tudo" — use esse módulo como referência ao criar funcionalidades complexas novas.

## Regras de dependência

- `controllers` só podem depender de `services` e `dto`s do próprio módulo. Nunca injetam `PrismaService` nem services de outro módulo diretamente.
- `services` podem depender de: `PrismaService`, `ConfigService`, services de outros módulos (via import explícito do módulo no NestJS) e adaptadores de infraestrutura (`RabbitConnection`, `E2bRuntimeService`).
- `src/common` e `src/infrastructure` nunca dependem de `src/modules/*` — são camadas mais baixas e reutilizáveis; uma dependência nesse sentido criaria acoplamento circular.
- `src/config` não depende de nenhuma outra pasta em `src/`.
- Dependências entre módulos de domínio devem ser explícitas e unidirecionais (ex.: `webhooks` → `credentials`, `reviews`; `messaging` → `reviews`). Evite ciclos entre módulos.
- Acesso a dados de outro domínio deve passar pelo service público do módulo dono, não por leitura direta do model Prisma de outro módulo.
- Novas integrações externas (filas, clientes HTTP, sandboxes) devem viver em um módulo dedicado (seguindo o padrão de `messaging`), não espalhadas dentro de services de feature.

## Padrões de implementação

### Clean Code

- Nomes descritivos e no domínio do negócio (ex.: `ReviewJob`, `PublicationService`), sem abreviações obscuras.
- Funções pequenas, um nível de abstração por função; prefira early return/guard clauses a aninhamento profundo de `if`.
- Sem números/strings mágicos: valores de configuração passam por `ConfigService`/`configuration.ts`, nunca `process.env` direto fora de `src/config`.
- Um exporte principal por arquivo, nomenclatura kebab-case (`<feature>.controller.ts`, `.service.ts`, `.dto.ts`, `.module.ts`).
- Erros seguem o formato único do `GlobalExceptionFilter` (`statusCode/code/message/correlationId/timestamp`); não invente formatos de erro ad hoc.
- DTOs de entrada sempre validados com `class-validator`; não contorne o `ValidationPipe` global (`whitelist`/`forbidNonWhitelisted` já ativos).

### SOLID (aplicado a módulos NestJS)

- **SRP** — cada classe tem um motivo para mudar. Se um service está crescendo para cobrir responsabilidades distintas (ex.: publicação, processamento, retry), separe em services distintos como em `reviews`.
- **OCP** — estenda comportamento adicionando novos providers/estratégias em vez de empilhar `if/else`/`switch` crescentes em código existente.
- **LSP** — implementações que seguem um mesmo contrato (ex.: múltiplos providers de integração) devem ser substituíveis sem casos especiais no código que as consome.
- **ISP** — DTOs e interfaces injetadas devem ser enxutos; não force uma classe a depender de métodos/campos que não usa.
- **DIP** — dependa de abstrações injetadas pelo DI do Nest (construtor + tokens); nunca instancie infraestrutura concreta (`new PrismaClient()`, `new` de clientes externos) dentro de um service.

### Testes

- Convenção atual: testes de integração em `test/*.test.ts` (não colocados como `*.spec.ts` dentro de `src/`), exercitando classes reais com `ConfigService` construído. Siga esse padrão até que uma mudança seja decidida e registrada explicitamente.
- `pnpm check` (lint + typecheck + test + build) deve passar antes de considerar uma tarefa concluída.

### Padrões para código gerado por IA (via comandos/agentes)

- Antes de gerar código, identifique o módulo/camada existente mais próximo e replique a mesma estrutura (`controller`/`service`/`dto`/`module`) em vez de introduzir uma convenção nova.
- Não crie uma camada de `repository`/`entity` "mais limpa" por conta própria — este projeto usa `PrismaService` direto nos services. Mudar esse padrão arquitetural exige decisão explícita registrada em "Decisões importantes", nunca introdução silenciosa via IA.
- Não adicione bibliotecas novas (outro ORM, outro client HTTP, outro validador) quando já existe equivalente no projeto (Prisma, Zod, class-validator) sem justificar a necessidade.
- Aplique Clean Code e SOLID acima também a código gerado automaticamente — não é permitido relaxar padrões por ser "só um rascunho de IA".
- Toda mudança de contrato público (DTO, resposta HTTP, payload de fila/evento) deve ser sinalizada explicitamente no resumo da tarefa, nunca silenciosa.
- Não remova testes, validações (`ValidationPipe`, `class-validator`) ou o guard global de autenticação (`SupabaseAuthGuard`) apenas para fazer uma tarefa "passar".
- Siga as regras já definidas em `AGENTS.md` e `.ventury/standards/*`: não inventar requisitos, não fazer refatoração oportunista fora do escopo da especificação.

## Segurança

Ainda precisa ser documentado: registre autenticação, autorização, dados sensíveis e controles obrigatórios.

## Observabilidade

Ainda precisa ser documentado: registre logs, métricas, traces e alertas esperados.

## Estratégia de testes

Ainda precisa ser documentado: descreva níveis de teste, ferramentas e expectativas de cobertura.

## Comandos

Os valores abaixo foram derivados da mesma detecção usada para gerar `ventury.yaml`. Revise-os antes do uso.

- Instalação: `pnpm install --frozen-lockfile`
- Lint: `npm run lint`
- Build: `npm run build`
- Testes: `npm test`

## Restrições

Ainda precisa ser documentado: registre restrições técnicas, regulatórias e operacionais.

## Decisões importantes

Ainda precisa ser documentado: registre decisões que um agente não deve reverter sem discussão.
