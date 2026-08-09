# Especificações

Cada tarefa deve possuir uma especificação em:

```text
specs/task-<id>-<titulo>/SPEC.md
```

## Criar uma especificação

```sh
ventury spec new <id> --title "Título da tarefa"
```

O título informado é convertido em um slug seguro para o nome da pasta, sem alterar o título exibido dentro do documento.

## Estrutura mínima

Toda especificação deve conter:

- contexto do problema;
- objetivo da mudança;
- escopo;
- itens fora do escopo;
- requisitos;
- critérios de aceitação;
- restrições conhecidas;
- validações esperadas.

A especificação define **o que deve mudar** e não deve repetir decisões de arquitetura que já pertencem ao contexto ou aos padrões do projeto.

Detalhes de implementação só devem ser incluídos quando forem uma restrição explícita da tarefa.

Não inclua melhorias, refatorações ou mudanças que não sejam necessárias para atender ao objetivo da tarefa.

## Validar uma especificação

Antes da implementação, execute:

```sh
ventury spec validate <id>
```

A implementação não deve começar enquanto a especificação obrigatória:

- não existir;
- estiver estruturalmente inválida;
- possuir seções obrigatórias sem conteúdo;
- possuir conflitos ou ambiguidades conhecidos sem resolução.
