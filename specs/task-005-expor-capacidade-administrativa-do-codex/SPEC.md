# 005 — Expor capacidade administrativa do Codex

## Contexto

A API armazena a credencial ChatGPT/Codex por organização e o worker usa essa credencial para executar reviews, mas não existe uma consulta administrativa de conexão e franquia. O protocolo oficial do Codex App Server oferece `account/read` e `account/rateLimits/read`, com janelas de consumo e reset. Consultar esse protocolo é mais correto do que estimar limite por tokens já consumidos.

## Objetivo

Expor um endpoint autenticado para owner/admin consultar, de forma segura, o estado da integração Codex e a franquia real informada pela CLI para a organização ativa.

## Escopo

- Adicionar `GET /organizations/:organizationId/integrations/codex/status` protegido para `owner` e `admin`.
- Criar um serviço dedicado que execute o Codex App Server em diretório efêmero com a credencial da organização.
- Consultar conta e limites via JSON-RPC, normalizar as janelas e destruir todos os arquivos temporários ao final.
- Adicionar configuração de binário e timeout da consulta.
- Cachear respostas por um intervalo curto para evitar processos e chamadas repetidos.
- Adicionar testes unitários do protocolo, normalização, autorização declarada e estados de erro.

## Fora do escopo

- Consultar endpoints privados/não documentados do provedor.
- Expor ou devolver `auth.json`, access token, refresh token ou account id.
- Persistir snapshots de franquia no banco.
- Suportar provedores diferentes de Codex nesta tarefa.
- Consumir créditos, comprar créditos ou alterar a conta Codex.

## Requisitos

1. Somente `owner` e `admin` podem chamar o endpoint.
2. O contexto de organização da autenticação deve coincidir com o parâmetro da rota.
3. A credencial deve existir apenas em arquivo temporário com permissões restritas durante a consulta.
4. O subprocesso deve receber ambiente mínimo, sem herdar segredos da API.
5. A consulta deve ter timeout e encerramento garantido; diretórios temporários devem ser removidos em sucesso e falha.
6. A resposta nunca deve conter material de autenticação nem texto bruto do subprocesso.
7. A resposta deve distinguir `not_configured`, `available` e `unavailable`.
8. Janelas válidas devem conter duração em minutos, percentual usado, percentual restante e reset ISO quando disponível.
9. Percentuais devem ser normalizados ao intervalo de 0 a 100.
10. A resposta deve conter o horário da verificação e usar cache curto por organização.

## Critérios de aceitação

- Owner/admin com credencial válida recebe estado `available` e janelas normalizadas do Codex.
- Organização sem credencial recebe estado `not_configured` sem erro 500.
- Binário ausente, timeout ou falha do provedor recebe estado `unavailable` com mensagem segura.
- Membro comum é bloqueado pelo guard global por causa de `@Roles("owner", "admin")`.
- O teste prova que o ambiente do processo não contém segredos da API e que o diretório temporário é removido.
- `pnpm check` passa.

## Restrições

- Usar apenas o protocolo oficial do Codex App Server.
- Não registrar stdout/stderr bruto nem credenciais.
- Manter a implementação dentro do módulo `credentials`, responsável pela integração Codex.
- Não adicionar tabela ou migração de banco.

## Validação

- Executar `pnpm check`.
- Executar teste do serviço com binário falso que simula respostas JSON-RPC.
- Fazer uma consulta local com credencial controlada sem expor a resposta sensível em logs.

