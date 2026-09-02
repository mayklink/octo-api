# Encaminhar eventos do Azure DevOps para o Discord

## Contexto

O Azure DevOps entrega eventos no formato de Service Hooks, enquanto o Discord
aceita mensagens no formato de Incoming Webhooks. Cada repositório já possui
uma URL pública autenticada para receber esses eventos.

## Objetivo

Permitir que um administrador cadastre um webhook do Discord por repositório e
que eventos recebidos do Azure DevOps sejam convertidos e encaminhados a ele.

## Escopo

- Cadastro autenticado da URL de Incoming Webhook do Discord por repositório.
- Armazenamento cifrado da URL e validação de que ela pertence ao Discord.
- Conversão de eventos Azure DevOps para uma mensagem Discord sem encaminhar o
  payload bruto.
- Entrega antes da confirmação final do evento ao Azure DevOps, permitindo retry
  do Service Hook em caso de falha temporária do Discord.
- Aplicação automática das migrations pendentes antes da API iniciar em produção.
- Cobertura automatizada do cadastro, transformação e fluxo de entrega.

## Fora do escopo

- Múltiplos canais Discord por repositório.
- Edição de mensagens já publicadas, anexos ou comandos Discord.
- Configuração automática de Service Hooks no Azure DevOps.

## Requisitos

1. Apenas `owner` e `admin` podem cadastrar a URL do Discord.
2. A URL deve usar HTTPS, ter host Discord permitido e o caminho de Incoming
   Webhook (`/api/webhooks/{id}/{token}`).
3. A URL nunca pode ser retornada por uma API de leitura nem registrada em logs.
4. Todo evento Azure DevOps autenticado deve ser publicado quando houver um
   webhook Discord configurado para o repositório.
5. A mensagem Discord deve informar tipo do evento, repositório, projeto e,
   quando disponíveis, pull request, autor, data e link; menções devem ficar
   desabilitadas.
6. Quando não houver cadastro Discord, o fluxo atual de review permanece
   inalterado.

## Critérios de aceitação

- `PUT /repositories/:id/integrations/discord-webhook` aceita uma URL válida e
  retorna somente o estado de configuração.
- Uma URL inválida ou de host externo é rejeitada com HTTP 400.
- O evento recebido produz um payload compatível com Discord e é enviado ao
  webhook cadastrado.
- Falha de entrega Discord impede marcar o evento como processado.
- A suíte automatizada cobre os casos acima e `pnpm check` passa.
- O container de produção executa `prisma migrate deploy` antes de atender
  requisições.

## Restrições

- Usar o mecanismo atual de credenciais cifradas e `fetch` nativo do Node; não
  adicionar biblioteca HTTP.
- Manter a autenticação existente do endpoint público por segredo de repositório.

## Validação

- Executar `pnpm check` no projeto `octo-api`.
