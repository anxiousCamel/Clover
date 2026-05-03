# Guia de Contribuição

Obrigado por ajudar a construir o Clover!

## Fluxo de Desenvolvimento

1. **Crie uma Branch:** `feature/nome-da-feature` ou `fix/nome-do-bug`.
2. **Commits:** Use [Conventional Commits](https://www.conventionalcommits.org/):
    - `feat:` para novas funcionalidades.
    - `fix:` para correções de bugs.
    - `docs:` para mudanças na documentação.
    - `refactor:` para melhorias no código sem mudar comportamento.
3. **Testes:** Rode os testes antes de abrir o PR:
    ```bash
    npm test
    ```
4. **Pull Request:** Abra o PR descrevendo as mudanças e referenciando a Issue se houver.

## Checklist de PR

- [ ] O código segue as [Convenções](./conventions.md).
- [ ] Novos arquivos têm testes unitários correspondentes.
- [ ] A build (`npm run build`) passa sem erros de tipagem.
- [ ] O pipeline de agentes foi testado com o modelo `llama3`.
- [ ] Nenhuma variável sensível foi exposta em logs ou arquivos.
