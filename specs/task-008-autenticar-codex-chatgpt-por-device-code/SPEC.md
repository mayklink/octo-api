# 008 — Autenticar Codex ChatGPT por device code

## Contexto

A integração ChatGPT do Codex exige hoje que um administrador gere e cole manualmente um `auth.json`. Essa jornada depende de uma instalação local da CLI e expõe material sensível ao navegador. A Codex CLI oferece `codex login --device-auth` para ambientes remotos ou headless.

## Objetivo

Permitir que owner e admin iniciem e concluam a autenticação ChatGPT da Codex CLI pelo servidor, usando URL e código temporário, sem receber ou transmitir o conteúdo do `auth.json` pelo frontend.

## Escopo

- Criar endpoints administrativos para iniciar, consultar e cancelar uma sessão efêmera de device auth por organização.
- Executar a CLI em diretório temporário isolado, com armazenamento de credencial em arquivo e ambiente mínimo.
- Expor somente identificador da sessão, estado, URL OpenAI permitida, código temporário, expiração e mensagem segura.
- Ao concluir o subprocesso, ler, validar e cifrar o cache ChatGPT no armazenamento existente.
- Encerrar subprocessos e remover diretórios temporários em sucesso, falha, cancelamento, timeout e desligamento da aplicação.
- Cobrir autorização, parsing, lifecycle, persistência e limpeza com testes.

## Fora do escopo

- Implementar OAuth próprio ou armazenar código de dispositivo no banco.
- Retornar `auth.json`, access token, refresh token ou account id ao cliente.
- Alterar o modo API key ou a autenticação Supabase.
- Adicionar tabela ou migração.

## Requisitos

1. Somente owner e admin podem iniciar, consultar ou cancelar uma sessão.
2. O contexto de organização autenticado deve coincidir com a rota.
3. Deve existir no máximo uma sessão ativa por organização; iniciar outra cancela e limpa a anterior.
4. O subprocesso deve usar `codex login --device-auth` com `cli_auth_credentials_store="file"`, `CODEX_HOME` efêmero e ambiente mínimo.
5. A saída do subprocesso deve ter limite de tamanho, remoção de ANSI e parsing allowlist de URL HTTPS da OpenAI e código temporário.
6. A resposta nunca deve incluir saída bruta, credenciais ou variáveis de ambiente.
7. O cache final deve ser validado como autenticação ChatGPT antes de ser cifrado.
8. Sessões devem expirar, matar o processo e remover o diretório mesmo sem polling do cliente.
9. Estados terminais devem permanecer consultáveis por um intervalo curto e depois ser removidos da memória.
10. A conclusão deve invalidar o cache de capacidade para a organização.

## Critérios de aceitação

- Um admin inicia o fluxo e recebe URL/código temporário sem material de autenticação.
- Após autorização, o status muda para concluído, a credencial ChatGPT fica cifrada e a franquia volta a ser consultável.
- Falha, timeout e cancelamento produzem mensagem segura e deixam zero arquivos temporários.
- Requisições de membro comum ou de outra organização são bloqueadas.
- O teste prova que stdout/stderr bruto e tokens não chegam às respostas.
- Lint, typecheck, testes e build passam.

## Restrições

- Não adicionar dependências ou migração.
- Manter sessões somente em memória e credenciais apenas no envelope cifrado existente.
- Não registrar stdout/stderr do login.
- Usar apenas o fluxo oficial da Codex CLI.

## Validação

- Executar testes com binário falso cobrindo instruções, sucesso, falha, cancelamento e timeout.
- Executar lint, typecheck, suíte completa e build.
- Validar o fluxo real em produção sem imprimir credenciais.
