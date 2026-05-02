# Referência: Configuração do @doc-toolkit/cli

Arquivo de referência da skill `doc-project`. Carregue apenas se o projeto usa
o pacote `@doc-toolkit/cli`.

---

## Estrutura do DocToolkitConfig

```typescript
// doc-toolkit.config.ts
import type { DocToolkitConfig } from '@doc-toolkit/cli';

const config: DocToolkitConfig = {
  project: {
    name: 'nome-do-projeto',
    description: 'Descrição em uma linha',
    language: 'pt-BR',       // ou 'en-US' — consistente em todos os docs
    outputDir: './docs',
  },

  // Generator: architecture.md
  architecture: {
    containers: [
      { name: 'Web App', tech: 'Next.js', description: 'Interface do usuário' },
      { name: 'API',     tech: 'NestJS',  description: 'Lógica de negócio'   },
    ],
    databases: [
      { name: 'PostgreSQL', type: 'relational', orm: 'Prisma' },
    ],
    externalServices: [
      { name: 'AWS S3', purpose: 'Armazenamento de arquivos' },
    ],
    adrs: ['./docs/adr'],     // caminho para índice de ADRs
  },

  // Generator: tech-stack.md
  techStack: {
    categories: [
      {
        name: 'Backend',
        technologies: [
          { name: 'NestJS',     version: '10.x', purpose: 'Framework HTTP'  },
          { name: 'Prisma',     version: '5.x',  purpose: 'ORM'             },
          { name: 'PostgreSQL', version: '16',    purpose: 'Banco de dados'  },
        ],
      },
      {
        name: 'Frontend',
        technologies: [
          { name: 'Next.js',   version: '14.x', purpose: 'Framework React' },
          { name: 'Tailwind',  version: '3.x',  purpose: 'CSS utility'     },
        ],
      },
    ],
    architecturalPatterns: ['Clean Architecture', 'Repository Pattern', 'CQRS'],
  },

  // Generator: infrastructure.md
  infrastructure: {
    ports: [
      { service: 'Web App', port: 3000, description: 'HTTP dev server' },
      { service: 'API',     port: 3001, description: 'REST API'        },
      { service: 'Redis',   port: 6379, description: 'Cache / Queue'   },
    ],
    envVars: [
      { name: 'DATABASE_URL',   required: true,  example: 'postgresql://...',  description: 'Connection string do PostgreSQL' },
      { name: 'REDIS_URL',      required: true,  example: 'redis://localhost',  description: 'URL do Redis'                    },
      { name: 'JWT_SECRET',     required: true,  example: 'change-me',          description: 'Secret para assinar JWTs'        },
      { name: 'NODE_ENV',       required: false, example: 'development',         description: 'Ambiente de execução'            },
    ],
    scripts: [
      { name: 'dev',     command: 'npm run dev',     description: 'Inicia em modo desenvolvimento' },
      { name: 'build',   command: 'npm run build',   description: 'Compila para produção'          },
      { name: 'migrate', command: 'npx prisma migrate dev', description: 'Aplica migrations'      },
    ],
    troubleshooting: [
      {
        problem: 'Erro de conexão com banco',
        cause: 'DATABASE_URL incorreta ou banco não iniciado',
        solution: 'Verifique .env e execute `docker compose up db`',
      },
    ],
  },

  // Generator: api-reference.md
  apiReference: {
    baseUrl: '/api/v1',
    authentication: { type: 'Bearer JWT', header: 'Authorization' },
    resources: [
      {
        name: 'Users',
        endpoints: [
          {
            method: 'POST',
            path: '/users',
            description: 'Cria um novo usuário',
            body: { email: 'string', name: 'string', password: 'string' },
            responses: [
              { status: 201, description: 'Usuário criado', schema: 'UserResponse' },
              { status: 409, description: 'Email já existe' },
            ],
          },
          {
            method: 'GET',
            path: '/users/:id',
            description: 'Retorna um usuário por ID',
            params: { id: 'uuid' },
            responses: [
              { status: 200, description: 'Usuário encontrado', schema: 'UserResponse' },
              { status: 404, description: 'Usuário não encontrado' },
            ],
          },
        ],
      },
    ],
  },

  // Generator: error-codes.md
  errorCodes: {
    codes: [
      { code: 'USER_NOT_FOUND',      httpStatus: 404, message: 'Usuário não encontrado',   retryable: false },
      { code: 'EMAIL_ALREADY_EXISTS', httpStatus: 409, message: 'Email já cadastrado',      retryable: false },
      { code: 'INVALID_TOKEN',        httpStatus: 401, message: 'Token inválido ou expirado', retryable: false },
      { code: 'INTERNAL_ERROR',       httpStatus: 500, message: 'Erro interno do servidor',  retryable: true  },
    ],
  },

  // Parser: data-model.md (gerado do schema Prisma)
  dataModel: {
    prismaSchemaPath: './prisma/schema.prisma',
  },
};

export default config;
```

---

## Comandos CLI

```bash
# Inicializa o arquivo de configuração
npx tsx src/cli.ts init

# Gera todos os docs configurados
npx tsx src/cli.ts generate

# Valida docs na pasta padrão (./docs)
npx tsx src/cli.ts validate

# Valida pasta específica
npx tsx src/cli.ts validate ./minha-pasta-de-docs
```

---

## Interpretando o relatório de validação

O `validate` retorna um relatório com três seções:

| Seção | O que verifica |
|-------|---------------|
| `markdown` | Headings duplicados, code blocks sem fechar, links quebrados, tabelas malformadas |
| `mermaid` | Sintaxe de cada diagrama (erDiagram, graph, flowchart, sequenceDiagram, stateDiagram) |
| `content` | Placeholders (TODO/FIXME), mínimo de palavras por seção, estrutura obrigatória |

**Saída de erro típica:**
```
[ERROR] architecture.md:42 — Placeholder encontrado: "TODO: adicionar diagrama"
[ERROR] flows.md:15 — Mermaid inválido: unexpected token 'end' at line 8
[WARN]  contributing.md — Checklist de PR ausente (mínimo 5 itens)
```

Corrija todos os `[ERROR]` antes de commitar. `[WARN]` são recomendações.
