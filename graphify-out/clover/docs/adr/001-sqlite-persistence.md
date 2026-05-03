# ADR 001: Uso de SQLite para Persistência Local

**Status:** Aceita

## Contexto
O Clover precisa persistir o histórico de conversas e estados de sessão de forma local e persistente entre reinicializações do servidor. Precisamos de uma solução que seja leve, não exija um processo de banco de dados separado (como Docker ou Postgres instalado) e que suporte consultas relacionais.

## Decisão
Decidimos usar o **SQLite** (via biblioteca `better-sqlite3`) como o motor de persistência principal.

## Alternativas Consideradas
- **LokiJS / NeDB:** In-memory com persistência em JSON. Descartado por falta de robustez em consultas complexas.
- **PostgreSQL:** Descartado para manter a filosofia "Local-First" e facilidade de instalação zero-conf.
- **Arquivos JSON puros:** Descartado por performance e falta de ACID.

## Consequências
- **Positivas:** Facilidade de backup (um único arquivo `.db`), alta performance para leituras locais, ACID.
- **Negativas:** Dificuldade em escalar horizontalmente (não é um problema para o escopo local do Clover).
