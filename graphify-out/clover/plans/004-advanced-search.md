# Plano de Implementação: Busca Avançada (Glob & Grep)

Melhora a capacidade do agente de encontrar informações em repositórios grandes.

## 1. Requisitos
- Busca por arquivos usando padrões Glob (ex: `**/*.test.ts`).
- Busca por conteúdo de texto (Grep) com suporte a Regex.
- Performance: Deve ser capaz de escanear 1000+ arquivos em menos de 1 segundo.

## 2. Design
- **Fast Search Engine:** Utilizar a biblioteca `fast-glob` para arquivos e um wrapper sobre `ripgrep` (ou implementação Node.js otimizada) para conteúdo.
- **Tools:** `search-files.tool.ts` e `grep-text.tool.ts`.
- **Safety:** Ignorar automaticamente `node_modules` e pastas ocultas.

## 3. Tarefas
- [ ] Instalar `fast-glob` e `ignore`.
- [ ] Criar a ferramenta `search-files` (Glob).
- [ ] Criar a ferramenta `grep-text` (Search in files).
- [ ] Implementar paginação de resultados para evitar estouro de contexto do LLM.
- [ ] Adicionar suporte a filtros de extensão de arquivo no `ParamExtractor`.
