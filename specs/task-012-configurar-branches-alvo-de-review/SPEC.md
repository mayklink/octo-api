# Configurar branches alvo de review

## Objetivo

Executar reviews somente em pull requests cuja branch de destino esteja na lista configurada para o repositório. O padrão deve ser `developer`.

## Escopo

- Persistir a lista de branches alvo nas configurações de review de cada repositório.
- Expor a configuração na API e na tela de configurações.
- Ignorar webhooks de PR cuja branch destino não esteja permitida.
- Bloquear também a criação manual de review para uma branch não permitida.

## Critérios de aceite

- Uma instalação nova usa `developer` como única branch alvo.
- O administrador pode alterar a lista por repositório.
- `refs/heads/developer` e `developer` são tratados como a mesma branch.
- PRs para branches fora da lista não geram jobs nem ficam pendentes.

## Validação

- Testes do webhook e do serviço de review.
- Lint, typecheck e build dos dois projetos.
