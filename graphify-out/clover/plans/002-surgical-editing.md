# Plano de Implementação: Edição Cirúrgica (Patch Tool)

Substitui a reescrita total de arquivos por edições incrementais, economizando tokens e evitando alucinações.

## 1. Requisitos
- Ferramenta que aceita `filePath`, `searchString` e `replaceString`.
- Validação de que a `searchString` é única no arquivo para evitar edições erradas.
- Suporte a edição por intervalo de linhas (line ranges).
- Backup automático do arquivo original antes da edição.

## 2. Design
- **Patch Engine:** Utilizar a técnica de "Search & Replace" baseada em blocos de texto exatos.
- **Tool Plugin:** Criar `apply-patch.tool.ts` como um plugin de ferramenta de alto nível.
- **Safety:** Integrar com o `ExecutionRouter` para garantir que o patch respeita os limites do Workspace.

## 3. Tarefas
- [ ] Criar o plugin `apply-patch.tool.ts`.
- [ ] Implementar lógica de busca por bloco de texto com suporte a indentação flexível.
- [ ] Adicionar parâmetro opcional de `lineRange` para maior precisão em arquivos gigantes.
- [ ] Atualizar o `ParamExtractor` para reconhecer intenções de "edite a linha X" ou "troque o trecho Y".
- [ ] Implementar mecanismo de Rollback em caso de erro na aplicação do patch.
