# 011 — Impedir reviews presos em processamento

## Contexto

Tentativas que entram em `retry_wait` podem permanecer ativas indefinidamente quando o agendador de retry não consegue preparar a próxima tentativa. O reconciliador atual expira apenas tentativas `published` e `running`, embora jobs em `created`, `queued` e `retry_wait` também sejam apresentados ao usuário como ativos.

## Objetivo

Garantir que nenhuma tentativa ativa permaneça indefinidamente em revisão depois do prazo de execução.

## Escopo

- Reconciliar tentativas vencidas nos estados ativos `created`, `published`, `running` e `retry_wait`.
- Aplicar a transição de timeout de forma atômica e sem sobrescrever uma tentativa mais nova criada concorrentemente.
- Publicar o estado terminal pelo fluxo existente.
- Adicionar testes de regressão.

## Fora do escopo

- Alterar os contratos HTTP ou de mensageria.
- Alterar a política de quantidade e intervalo entre retries.
- Reiniciar ou modificar recursos de produção.

## Requisitos

1. Uma tentativa ativa com `deadlineAt` vencido deve terminar como `timed_out`.
2. O job correspondente deve terminar como `failed` somente se a tentativa expirada ainda for a tentativa corrente.
3. Uma tentativa cujo estado mudou concorrentemente não pode ser sobrescrita.
4. A publicação de status existente deve ser criada apenas quando o job for terminalizado.

## Critérios de aceitação

- `retry_wait` vencido deixa de ser considerado ativo pelo reconciliador.
- Corridas com o scheduler não terminalizam uma tentativa nova.
- Os testes existentes e os novos testes passam.

## Restrições

- Preservar os contratos públicos e o modelo transacional existente.

## Validação

- `pnpm check`
