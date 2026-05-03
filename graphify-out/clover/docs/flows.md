# Fluxos do Sistema

## 1. Pipeline de Processamento de Mensagem

Este é o fluxo principal quando o usuário envia uma mensagem. O objetivo é transformar uma intenção em linguagem natural em uma ação segura no sistema operacional.

```mermaid
sequenceDiagram
    participant U as Usuário
    participant G as Orchestrator
    participant H as HeuristicGate
    participant I as IntentClassifier
    participant P as ParamExtractor
    participant R as ExecutionRouter
    participant OS as OS Abstraction

    U->>G: Envia mensagem
    G->>H: Avalia se precisa de ferramentas
    H-->>G: Score de Intenção
    G->>I: Classifica qual ferramenta usar
    I-->>G: Nome da Ferramenta
    G->>P: Extrai parâmetros do texto
    P-->>G: JSON com Argumentos
    G->>R: Valida Permissões/Workspace
    R->>OS: Executa Ação (FS/Bash)
    OS-->>R: Resultado
    R-->>G: Tool Result
    G-->>U: Resposta Final
```

## 2. Indexação de Memória (RAG)

Fluxo de como o Clover "aprende" sobre o código do usuário.

```mermaid
flowchart TD
    A[Início do Scan] --> B{Arquivo alterado?}
    B -- Sim --> C[Extrair Chunks]
    C --> D[Gerar Embeddings via Ollama]
    D --> E[Inserir no LanceDB]
    E --> F[Fim]
    B -- Não --> F
```

## 3. Ciclo de Vida de uma Task Autônoma

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Thinking: Usuário envia pedido
    Thinking --> ToolExecution: Agent escolhe ferramenta
    ToolExecution --> UserConfirmation: Ferramenta requer aprovação
    UserConfirmation --> ToolExecution: Aprovado
    UserConfirmation --> Thinking: Rejeitado
    ToolExecution --> Thinking: Resultado processado
    Thinking --> Idle: Resposta final enviada
```
