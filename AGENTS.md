# Instruções para agentes de IA

Antes de analisar ou alterar este projeto:

1. Leia `ventury.yaml` para localizar os documentos, padrões, comandos e regras de workflow aplicáveis.
2. Leia os padrões corporativos referenciados pelo manifesto.
3. Leia o contexto e as decisões específicas em `project/PROJECT.md`.
4. Localize em `specs` a especificação correspondente à tarefa atual.
5. Analise a implementação existente, os testes e as dependências relacionadas ao escopo.
6. Identifique o objetivo, os arquivos potencialmente impactados e as validações necessárias.
7. Apresente um plano curto antes de escrever código.
8. Implemente somente o necessário para atender à especificação.
9. Execute as validações configuradas antes de concluir.

## Responsabilidade dos documentos

- A especificação da tarefa define **o que deve mudar** e quais critérios devem ser atendidos.
- O contexto do projeto define **como a mudança deve ser integrada à arquitetura existente**.
- Os padrões corporativos definem **como o trabalho deve ser conduzido e validado**.
- O manifesto define **onde esses documentos estão e quais comandos devem ser executados**.

## Regras de execução

- Não invente requisitos, regras de negócio ou decisões arquiteturais.
- Não altere comportamentos, contratos ou arquivos fora do escopo sem justificar explicitamente.
- Não faça refatorações oportunistas durante uma tarefa funcional ou corretiva.
- Não remova validações, testes ou controles de segurança apenas para concluir a tarefa.
- Preserve as decisões e restrições documentadas pelo projeto.
- Utilize os comandos definidos no manifesto em vez de assumir ferramentas ou runtimes.

## Informações ausentes ou conflitantes

- Se a especificação for obrigatória e não existir, não inicie a implementação.
- Se um documento obrigatório estiver ausente, registre claramente o bloqueio.
- Se houver ambiguidade, não escolha silenciosamente uma interpretação.
- Se houver conflito entre documentos, identifique o conflito antes da implementação.
- Priorize a instrução mais específica, desde que ela não viole uma restrição explícita do projeto ou do contrato de engenharia.

## Conclusão da tarefa

Ao finalizar, apresente:

1. Resumo das alterações realizadas.
2. Arquivos modificados.
3. Validações executadas e respectivos resultados.
4. Pendências, limitações, riscos ou decisões tomadas.
