# 007 — Suportar API key na integração Codex

## Contexto

A integração Codex aceita apenas o cache de autenticação de uma conta ChatGPT. O Codex CLI também oferece autenticação oficial por API key, mas o contrato HTTP, a validação da credencial, o worker e a consulta administrativa ainda rejeitam esse modo.

## Objetivo

Permitir que owner e admin configurem a integração Codex com uma conta ChatGPT ou uma API key da OpenAI, preservando o armazenamento criptografado e sem expor segredos em respostas ou logs.

## Escopo

- Estender o contrato de configuração Codex com os modos `chatgpt` e `api_key`.
- Manter compatibilidade com clientes que ainda enviam apenas `authJson`.
- Validar e normalizar ambos os formatos antes de armazenar a credencial.
- Informar no status administrativo qual modo está configurado.
- Tratar API key como integração disponível mesmo sem janelas de franquia ChatGPT.
- Ampliar a redação de logs para os novos campos sensíveis.
- Cobrir contrato, validação e status com testes.

## Fora do escopo

- Alterar o login Supabase dos usuários do produto.
- Consultar saldo financeiro, faturamento ou créditos da OpenAI.
- Retornar a API key ou qualquer parte dela após o salvamento.
- Criar tabela ou migração de banco.
- Validar acesso a todos os modelos no momento do cadastro.

## Requisitos

1. Somente `owner` e `admin` continuam autorizados a configurar a integração.
2. A requisição deve conter exatamente uma credencial coerente com o modo informado.
3. O modo `api_key` deve exigir uma chave não vazia e armazená-la no envelope criptografado existente.
4. O modo `chatgpt` deve preservar a validação atual de access token, refresh token e account id.
5. O worker deve autenticar a CLI executando `codex login --with-api-key` e entregar a chave exclusivamente por `stdin`; o modo ChatGPT continua usando o cache `auth.json`.
6. Renovação de credencial deve continuar restrita a sessões ChatGPT.
7. O status não deve apresentar ausência de franquia ChatGPT como falha quando o modo for API key.
8. Respostas HTTP e mensagens de erro nunca devem conter a chave.
9. Campos `apiKey` e `OPENAI_API_KEY` devem ser redigidos dos logs.

## Critérios de aceitação

- É possível salvar uma API key válida e a resposta contém apenas confirmação, modo e horário.
- O payload legado com `authJson` continua funcionando.
- Payload vazio, ambíguo ou incoerente retorna erro 400 seguro.
- O worker aceita credencial ChatGPT, executa o login real da CLI para API key e rejeita formatos incompletos.
- O status de API key informa conexão por consumo sem inventar percentual restante.
- `pnpm check` passa.

## Restrições

- Não registrar nem devolver segredos.
- Reutilizar `CredentialKind.codex_auth` e a criptografia existente.
- Não adicionar dependências nem migração.
- Preservar o fluxo ChatGPT atual.

## Validação

- Executar `pnpm check`.
- Executar os testes de credenciais e status Codex.
- Verificar que os novos caminhos de log estão configurados para redação.
