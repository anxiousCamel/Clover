# ADR 002: Pipeline de Execução Robusto e Determinístico

- **Status:** Aceito
- **Data:** 2026-05-03

## Contexto
O sistema original dependia de intenções baseadas em regex e decisão direta do LLM sobre o uso de ferramentas. Isso causava:
1. Inconsistência (o modelo às vezes recusava agir).
2. Perda de estado (não lembrava do arquivo anterior).
3. Falhas de path (paths relativos resolvidos incorretamente).
4. Hallucinação de resultados quando tools falhavam ou o gate bloqueava.

## Decisão
Implementar um pipeline estruturado de 5 camadas que remove a decisão de "se deve usar tool" do LLM e a transfere para um roteador determinístico baseado na classificação de intenção.

### Mudanças principais:
1. **Heuristic Gate Permissivo:** Aumentar o recall para garantir que comandos em linguagem natural (PT/EN) entrem no pipeline.
2. **Contexto Operacional:** Armazenar explicitamente `lastFilePath`, `lastIntent` e `lastGeneratedContent`.
3. **Forçamento de Tool:** Se o classificador retornar uma intenção de escrita, a execução da tool de escrita é mandatória.
4. **Camada de Validação:** Validar caminhos (file vs directory) ANTES de chamar o plugin da tool.

## Alternativas Consideradas
- **Fine-tuning do modelo:** Descartado devido ao custo e necessidade de rodar localmente (Ollama).
- **Prompt Engineering massivo:** Tentado inicialmente, mas insuficiente para garantir determinismo de roteamento.

## Consequências
- **Prós:** Execução 100% consistente para comandos claros. Melhor suporte a deíticos ("coloca lá"). Proteção contra corrupção de diretórios.
- **Contras:** Leve aumento na latência devido à etapa extra de classificação (mitigado por cache LRU).
- **Riscos:** Falsos positivos no gate podem levar a classificações errôneas em conversas puramente chat (resolvido por `MIN_CONFIDENCE`).
