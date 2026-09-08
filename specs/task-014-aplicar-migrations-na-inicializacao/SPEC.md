# 014 — Aplicar migrations na inicialização

## Contexto
O deploy Coolify executa pnpm start, que iniciava somente node dist/main.js. A migration de review_settings.target_branches não foi aplicada e POST /review-jobs retornou Prisma P2022 em produção.

## Objetivo
Aplicar migrations pendentes antes de aceitar requisições no caminho de inicialização usado pelo Coolify.

## Escopo
Executar prisma migrate deploy no script start antes de node dist/main.js, com encadeamento condicional. Publicar a alteração e verificar migration e inicialização nos logs.

## Fora do escopo
Alterar migrations existentes, resetar o banco, alterar o worker ou disparar reviews reais.

## Requisitos
- Usar o Prisma já disponível nas dependências de produção.
- Não iniciar o servidor se a migration falhar.
- Preservar o comando de desenvolvimento e o fluxo Dockerfile, que já aplica migrations.

## Critérios de aceitação
- pnpm start aplica migrations antes de iniciar a API.
- Logs do deploy confirmam aplicação da migration pendente e inicialização do servidor.
- Nenhum segredo é registrado na especificação ou commit.

## Restrições
Sem novas dependências ou alterações destrutivas de banco.

## Validação
Executar lint, typecheck, build e testes; verificar implantação pelo MCP Hostinger. Registrar limitações conhecidas dos testes de subprocesso no Windows.
