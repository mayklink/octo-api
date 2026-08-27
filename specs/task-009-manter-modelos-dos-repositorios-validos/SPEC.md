# 009 — Manter modelos dos repositórios válidos

## Contexto

A política de modelos da organização pode ser reduzida sem atualizar os `ReviewSetting.model` existentes. Isso deixa repositórios apontando para modelos proibidos e faz a criação de reviews falhar com `400 Review model is not allowed`.

Esta correção substitui explicitamente o requisito 11 da especificação 003, que permitia manter configurações de repositório fora da nova política.

## Objetivo

Garantir que a atualização da política de modelos preserve a invariável de que todo modelo configurado em um repositório da organização permanece permitido.

## Escopo

- Atualizar para o novo `defaultModel` os `ReviewSetting` da organização cujo modelo não esteja na nova lista permitida.
- Persistir a política e a adequação dos repositórios na mesma transação.
- Cobrir o comportamento com teste automatizado.

## Fora do escopo

- Alterar contratos HTTP ou payloads de fila.
- Alterar configurações de outras organizações.
- Modificar configurações cujo modelo continue permitido.

## Requisitos

1. `updateModelPolicy` deve continuar validando o catálogo e a presença do modelo padrão na lista permitida.
2. A política da organização e a adequação dos repositórios devem ocorrer atomicamente.
3. Apenas configurações da organização atual com modelo fora de `allowedModels` devem receber `defaultModel`.
4. O formato da resposta do endpoint deve permanecer inalterado.

## Critérios de aceitação

- Após reduzir `allowedModels`, nenhum `ReviewSetting` da organização permanece com modelo fora da lista.
- Repositórios de outros tenants não são alterados.
- Uma falha em qualquer escrita desfaz toda a operação.
- O check completo do projeto passa.

## Restrições

- Preservar autorização, isolamento multi-tenant e validações existentes.
- Não criar migration, pois a correção usa o schema atual.

## Validação

- `pnpm check`
- Teste direcionado de `OrganizationsService.updateModelPolicy`.
