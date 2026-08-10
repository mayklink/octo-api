# 002 — Gerenciar acessos de usuários na organização

## Contexto

Uma organização atualmente não oferece ao seu owner um fluxo completo para administrar acessos de usuários. A mudança atravessa a fronteira entre o front-end (`octoreview`) e a API (`octo-api`) e precisa preservar o isolamento multi-tenant e o modelo de autorização existente.

## Objetivo

Permitir que o owner de uma organização convide usuários por e-mail, altere a role de membros entre `member` e `admin` e revogue acessos, sem limite numérico de membros nesta entrega. O convite deve funcionar para e-mails já cadastrados ou ainda inexistentes no Supabase Auth.

## Escopo

- Evoluir o domínio `organizations` para suportar convites, listagem de membros, alteração de role e remoção de membros.
- Integrar o domínio `auth` à Supabase Admin API para enviar o convite padrão por e-mail.
- Aceitar automaticamente convites pendentes quando o usuário convidado autenticar pela primeira vez.
- Expor contratos HTTP consumíveis pelo `octoreview`.
- Criar a persistência de convites e a denormalização do e-mail no membro da organização.
- Corrigir o módulo `organizations` para seguir a estrutura `controller/service/dto/module` já documentada no projeto.

## Fora do escopo

- Billing, cobrança ou limite de seats/membros.
- Convite associado a múltiplas organizações.
- Reenvio automático de convites.
- Template transacional de e-mail customizado; deve ser usado o template padrão do Supabase Admin API.
- Alterações nas regras de roles além de `owner`, `admin` e `member`.

## Requisitos

1. `POST /organizations/:id/invites`, protegido por `@Roles("owner")`, deve receber e-mail e role (`member` ou `admin`), chamar `auth.admin.inviteUserByEmail`, registrar `OrganizationInvite` com `status=pending` e `expiresAt` igual ao momento da criação mais 7 dias, e retornar o convite criado sem expor segredos.
2. `GET /organizations/:id/invites`, protegido por `@Roles("owner")`, deve listar somente convites pendentes da organização autorizada.
3. `DELETE /organizations/:id/invites/:inviteId`, protegido por `@Roles("owner")`, deve revogar somente convite pendente da organização autorizada, alterando seu status para `revoked`.
4. `GET /organizations/:id/members`, protegido por `@Roles("owner")`, deve listar os membros atuais da organização, incluindo e-mail e role, sem consultar a Supabase Admin API a cada requisição.
5. `PATCH /organizations/:id/members/:userId`, protegido por `@Roles("owner")`, deve aceitar somente a transição `member ↔ admin`; não pode alterar nem rebaixar um `owner`.
6. `DELETE /organizations/:id/members/:userId`, protegido por `@Roles("owner")`, deve remover definitivamente (`hard delete`) o `OrganizationMember` pertencente à organização. Um owner não pode remover a si mesmo quando for o único owner; a operação deve ser recusada e a organização deve permanecer com pelo menos um owner.
7. Convites devem ter status `pending`, `accepted`, `expired` ou `revoked`. Convite expirado não pode ser aceito e precisa de novo convite.
8. No primeiro login do usuário convidado, `AuthController.me()` deve chamar `OrganizationsService.acceptPendingInvitesForEmail(auth.email)` antes de responder. Para cada convite pendente correspondente ao e-mail e ainda dentro da validade, deve ser criado o `OrganizationMember`, o convite deve passar a `accepted` e deve receber `acceptedAt`.
9. Convite já aceito, expirado ou revogado não pode criar vínculo. O fluxo deve ser idempotente para um usuário que repita a chamada a `/me`.
10. O Prisma schema deve adicionar `InviteStatus`, `OrganizationInvite` com `organizationId`, `email`, `role`, `status`, `invitedByUserId`, `expiresAt` e `acceptedAt` opcional, além de `email` em `OrganizationMember`, com migration correspondente.
11. O módulo `organizations` deve conter DTOs validados por `class-validator`: `InviteMemberDto` (`email`, `role`) e `UpdateMemberRoleDto` (`role`).
12. O módulo `auth` deve conter `SupabaseAdminService`, encapsulando `inviteUserByEmail`; a chave deve vir de `SUPABASE_SERVICE_ROLE_KEY`, ser validada em `src/config/environment.ts`, mapeada em `configuration.ts` e incluída na redação de logs. A chave nunca pode ser logada ou retornada em respostas.
13. Controllers devem depender apenas do service/DTO do próprio módulo; o acesso Prisma e a integração Supabase devem permanecer nos services/adaptadores apropriados.
14. Devem ser adicionados testes de integração em `test/organizations.test.ts` cobrindo autorização do owner, convite, listagem, revogação, alteração de role, remoção, proteção do único owner e aceite idempotente/expirado.

## Critérios de aceitação

- As seis rotas de convites/membros existem, exigem autenticação e role `owner`, e respeitam `organizationId` em todas as operações.
- É possível convidar e-mails existentes e inexistentes no Supabase usando a Admin API; o registro local fica pendente por 7 dias.
- A listagem de membros retorna o e-mail denormalizado e não depende de uma chamada à Supabase Admin API por membro.
- Roles `member` e `admin` podem ser alternadas; `owner` não pode ser alterado.
- Remoção de membro é hard delete; remoção/rebaixamento do único owner é recusado sem alterar o estado.
- Convites pendentes podem ser revogados; convites expirados não são aceitos.
- O primeiro `/me` após autenticação cria o vínculo correspondente e repetições não duplicam membros nem reaceitam convites.
- `SUPABASE_SERVICE_ROLE_KEY` é obrigatória no ambiente da API e não aparece em logs, respostas ou mensagens de erro.
- `pnpm check` (lint, typecheck, testes e build) passa sem erros novos.

## Restrições

- Seguir `project/PROJECT.md`: arquitetura `controller → service → PrismaService`, DTOs `class-validator`, dependências entre módulos explícitas e nomenclatura `kebab-case`.
- Usar o template padrão do Supabase Admin API, sem criar serviço transacional de e-mail.
- Preservar o guard global JWT e o formato de erros do `GlobalExceptionFilter`.
- Toda operação deve validar pertencimento à organização e não pode permitir acesso cross-tenant.
- Não registrar a service-role key nem dados sensíveis desnecessários; manter a redação pino existente e ampliá-la para a nova variável.

## Validação

- Executar `pnpm check` no `octo-api`.
- Executar os testes de `test/organizations.test.ts` com dependências externas substituídas por fakes/mocks quando necessário, sem depender de Postgres ou Supabase reais.
- Revisar manualmente o contrato HTTP consumido pelo `octoreview`, os cenários de expiração/revogação e a regra de preservação do único owner.
