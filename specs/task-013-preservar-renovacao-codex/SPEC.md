# 013 — Preservar renovação de credenciais Codex

## Contexto
A consulta de franquia executa o Codex em diretório temporário e descarta possíveis atualizações de auth.json. Mensagens de review carregam snapshots da credencial; a renovação recebida do worker também precisa respeitar gravações concorrentes.

## Objetivo
Preservar renovações produzidas na consulta e impedir que uma renovação antiga sobrescreva um login ou outra renovação mais recente.

## Escopo
- Persistir auth.json atualizado antes da limpeza, inclusive quando a consulta falha após renovar.
- Esperar encerramento do subprocesso antes de ler o arquivo.
- Compartilhar consultas simultâneas de franquia por organização na instância da API.
- Usar comparação atômica de versão para renovações locais e retornadas pelo worker.
- Invalidar cache após configuração manual de credencial.

## Fora do escopo
Alterar contratos de fila, executar reviews reais, fazer deploy ou modificar o worker (não disponível neste workspace). Mensagens já publicadas continuam contendo snapshots; coordenar renovação entre API e worker requer trabalho no worker.

## Requisitos
1. Não expor tokens em resposta ou logs.
2. Persistir credenciais cifradas no armazenamento existente.
3. Renovação só pode substituir a credencial da mesma conta e refresh token de origem, desde que a versão lida ainda seja atual.
4. Limpar arquivos em sucesso e falha, após tentar preservar uma renovação.
5. Não executar duas consultas simultâneas na mesma organização nesta instância.

## Critérios de aceitação
- Testes simulam renovação com sucesso e falha de consulta e comprovam persistência antes da limpeza.
- Credencial inalterada não gera gravação.
- Concorrência não sobrescreve versão mais recente.
- Consulta mantém resposta pública sem segredos.

## Restrições
Sem novas dependências, migrations ou alterações de contrato público.

## Validação
Executar testes de regressão, lint, typecheck e build; declarar falhas preexistentes ou específicas da plataforma.
