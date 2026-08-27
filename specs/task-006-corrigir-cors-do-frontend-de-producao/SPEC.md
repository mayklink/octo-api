# 006 — Corrigir CORS do frontend de produção

## Contexto

O frontend publicado em `https://octoreview.vercel.app` consome a API em `https://octo-api.mbdev.online`. Quando `CORS_ALLOWED_ORIGINS` não é definido, a API usa apenas `http://localhost:5173`; por isso a resposta de produção não inclui `Access-Control-Allow-Origin` e o navegador bloqueia as chamadas.

## Objetivo

Permitir chamadas do frontend oficial de produção sem ampliar o CORS para origens desconhecidas.

## Escopo

- Incluir `https://octoreview.vercel.app` no fallback seguro de `CORS_ALLOWED_ORIGINS`.
- Manter `http://localhost:5173` para desenvolvimento local.
- Atualizar o exemplo de ambiente e cobrir o fallback com teste.

## Fora do escopo

- Permitir wildcard (`*`).
- Permitir automaticamente URLs de preview da Vercel.
- Alterar autenticação, headers autorizados ou credenciais.
- Alterar o frontend.

## Requisitos

1. O fallback deve conter somente as origens exatas local e de produção.
2. Uma configuração explícita por ambiente deve continuar substituindo o fallback.
3. Wildcard e origens inválidas devem continuar rejeitados.

## Critérios de aceitação

- Sem `CORS_ALLOWED_ORIGINS`, a configuração contém `http://localhost:5173` e `https://octoreview.vercel.app`.
- Com configuração explícita, somente os valores informados são usados.
- O preflight da origem oficial recebe `Access-Control-Allow-Origin` após o novo deploy.
- `pnpm check` passa.

## Restrições

- Não afrouxar o controle para `*`.
- Não incluir domínios que não sejam usados pelo produto.

## Validação

- Executar `pnpm check`.
- Subir a API local sem a variável e validar request/preflight com `Origin: https://octoreview.vercel.app`.
- Revalidar a resposta pública após o deploy.

