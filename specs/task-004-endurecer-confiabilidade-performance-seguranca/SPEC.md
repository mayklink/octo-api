# 004 — Endurecer confiabilidade, performance e segurança operacional

## Contexto

Uma revisão técnica identificou mensagens e publicações que podem ficar presas após crash, concorrência irrestrita na descoberta Azure DevOps, hardening HTTP incompleto, tipagem frágil em fronteiras e dependências vulneráveis.

## Objetivo

Corrigir esses riscos sem alterar os contratos públicos de review e sem tratar o envio de Bearer token para URL configurável, que permanece explicitamente fora do escopo.

## Escopo

- Recuperar outbox `processing` com lease expirado.
- Recuperar publicações `publishing` abandonadas.
- Limitar concorrência da descoberta Azure e remover leitura duplicada do PAT no retry.
- Restringir CORS, adicionar headers defensivos e limitar o webhook público.
- Substituir `any` nas fronteiras alteradas.
- Atualizar dependências vulneráveis quando houver versão compatível.
- Adicionar testes para os comportamentos novos.

## Fora do escopo

- Alterar configuração dinâmica da URL da API no frontend ou a forma como o Bearer token é anexado.
- Alterar os contratos `review.requested.v2` e `review.*.v2`.
- Alterar roles, memberships ou regras multi-tenant.

## Requisitos

1. Claims devem ser atômicos e seguros entre múltiplas instâncias.
2. Registros com lease válido não podem ser recuperados.
3. Registros abandonados devem voltar a ser processados até o limite de tentativas.
4. Descoberta Azure deve usar concorrência limitada e preservar resultados válidos quando um projeto isolado falhar.
5. CORS deve aceitar somente origens configuradas e chamadas sem `Origin`.
6. Webhook deve possuir rate limit sem registrar seu token.
7. Testes existentes e novos devem passar.

## Validação

- `pnpm check`
- `pnpm audit --prod`
