# Referência: Padrões Mermaid para Documentação

Arquivo de referência da skill `doc-project`. Carregue este arquivo apenas quando
precisar de sintaxe detalhada de diagramas Mermaid.

---

## erDiagram — Modelo de Dados

```mermaid
erDiagram
  USER {
    uuid id PK
    string email UK
    string name
    datetime createdAt
  }
  ORDER {
    uuid id PK
    uuid userId FK
    enum status
    decimal total
    datetime createdAt
  }
  ORDER_ITEM {
    uuid id PK
    uuid orderId FK
    uuid productId FK
    int quantity
    decimal unitPrice
  }
  USER ||--o{ ORDER : "has"
  ORDER ||--|{ ORDER_ITEM : "contains"
```

**Cardinalidades:**
- `||--||` — exatamente um para exatamente um
- `||--o{` — exatamente um para zero ou mais
- `||--|{` — exatamente um para um ou mais
- `}o--o{` — zero ou mais para zero ou mais

**Tipos de atributo comuns:** `string`, `int`, `uuid`, `decimal`, `boolean`, `datetime`, `enum`

**Restrições:** `PK` (primary key), `FK` (foreign key), `UK` (unique key)

---

## sequenceDiagram — Fluxo End-to-End

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant Web as Web App
  participant API as API Server
  participant DB as Database
  participant Email as Email Service

  User->>Web: Submits form
  Web->>API: POST /auth/register

  API->>DB: Check if email exists
  DB-->>API: Not found

  API->>DB: INSERT user
  DB-->>API: User created

  API->>Email: Send verification email
  Note over Email: Async — fire and forget

  API-->>Web: 201 Created { userId }
  Web-->>User: "Check your email"

  alt Email already exists
    API-->>Web: 409 Conflict
    Web-->>User: "Email already in use"
  end
```

**Sintaxe de setas:**
- `A->>B` — síncrono (linha sólida, ponta aberta)
- `A-->>B` — resposta (linha tracejada, ponta aberta)
- `A-)B` — assíncrono (linha sólida, ponta aberta fina)

**Blocos condicionais:**
```
alt Caso A
  ...
else Caso B
  ...
end

opt Opcional
  ...
end

loop A cada 5 segundos
  ...
end
```

---

## stateDiagram-v2 — Ciclo de Vida

```mermaid
stateDiagram-v2
  direction LR

  [*] --> Draft : create()
  Draft --> Submitted : submit()
  Submitted --> UnderReview : assign()

  state UnderReview {
    [*] --> Reviewing
    Reviewing --> Approved : approve()
    Reviewing --> RequestedChanges : requestChanges()
    RequestedChanges --> Reviewing : resubmit()
  }

  UnderReview --> Published : publish()
  UnderReview --> Rejected : reject()
  Published --> Archived : archive()
  Rejected --> [*]
  Archived --> [*]

  note right of Draft : Rascunho editável\naté o submit
```

---

## C4Context — Nível 1 (Sistema no Universo)

```mermaid
C4Context
  title Context — NomeDoProjeto

  Person(customer, "Cliente", "Usuário final do sistema")
  Person(admin, "Administrador", "Gerencia o sistema")

  System(system, "NomeDoProjeto", "Descrição em uma linha")
  System_Ext(payment, "Gateway de Pagamento", "Stripe / PagSeguro")
  System_Ext(email, "Serviço de Email", "SendGrid")

  Rel(customer, system, "Usa", "HTTPS")
  Rel(admin, system, "Administra", "HTTPS")
  Rel(system, payment, "Processa pagamentos", "REST/HTTPS")
  Rel(system, email, "Envia notificações", "SMTP/API")
```

## C4Container — Nível 2 (Containers Internos)

```mermaid
C4Container
  title Containers — NomeDoProjeto

  Person(user, "Usuário", "")

  Container_Boundary(system, "NomeDoProjeto") {
    Container(web, "Web App", "Next.js 14", "SPA com SSR")
    Container(api, "API", "NestJS", "REST API — lógica de negócio")
    Container(worker, "Worker", "Bull/Redis", "Processamento assíncrono")
    ContainerDb(db, "PostgreSQL", "Banco relacional", "Dados persistidos")
    ContainerDb(cache, "Redis", "Cache / Queue", "Sessions e filas")
  }

  System_Ext(s3, "AWS S3", "Armazenamento de arquivos")

  Rel(user, web, "Acessa", "HTTPS")
  Rel(web, api, "Consome", "REST/JSON")
  Rel(api, db, "Lê/Escreve", "Prisma ORM")
  Rel(api, cache, "Cache", "ioredis")
  Rel(api, worker, "Enfileira jobs", "Bull")
  Rel(worker, s3, "Upload", "AWS SDK")
```

---

## flowchart — Algoritmo / Decisão

```mermaid
flowchart TD
  A([Início]) --> B[Recebe requisição]
  B --> C{Token válido?}
  C -- Não --> D[Retorna 401]
  C -- Sim --> E{Permissão?}
  E -- Não --> F[Retorna 403]
  E -- Sim --> G[Processa request]
  G --> H{Sucesso?}
  H -- Não --> I[Log erro + Retorna 500]
  H -- Sim --> J[Retorna 200]
  D & F & I & J --> Z([Fim])
```

**Formas de nó:**
- `[texto]` — retângulo (processo)
- `{texto}` — losango (decisão)
- `(texto)` — retângulo arredondado (subprocesso)
- `([texto])` — estádio (início/fim)
- `[(texto)]` — cilindro (banco de dados)

---

## Regras de qualidade para Mermaid

1. Sempre coloque um heading (`###`) ou legenda imediatamente **antes** do bloco.
2. Nunca use caracteres especiais sem aspas nos labels: prefira `"texto com espaços"`.
3. Em `erDiagram`, use snake_case para nomes de atributos.
4. Em `sequenceDiagram`, use `autonumber` para rastreabilidade.
5. Em `C4Container`, use `Container_Boundary` para agrupar visualmente.
6. Valide sempre colando o código em [mermaid.live](https://mermaid.live) antes de commitar.
