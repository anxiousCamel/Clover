/**
 * Unit tests for Gateway Routes.
 *
 * Validates: Requirements 24.3, 24.4, 21.1
 *
 * - 24.3: Gateway validates all HTTP request bodies using Fastify schema validation
 * - 24.4: Gateway returns all errors in the format { error: string, code: string }
 * - 21.1: GET /api/health returns status of OpenClaude, Ollama, LanceDB, SQLite
 *
 * Uses Fastify's inject() method to test routes without starting a real server.
 * All underlying services (orchestrator, session manager, etc.) are mocked.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Mocks — declared before importing route modules
// ---------------------------------------------------------------------------

// ── Orchestrator ──────────────────────────────────────────
const mockHandle = vi.fn();
vi.mock('../../orchestrator/orchestrator.js', () => ({
  handle: (...args: unknown[]) => mockHandle(...args),
}));

// ── Session Manager ───────────────────────────────────────
const mockGetSession = vi.fn();
const mockCreateSession = vi.fn();
const mockDeleteSession = vi.fn();
const mockLoadHistory = vi.fn();
const mockSetModel = vi.fn();
vi.mock('../../orchestrator/session.manager.js', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  createSession: (...args: unknown[]) => mockCreateSession(...args),
  deleteSession: (...args: unknown[]) => mockDeleteSession(...args),
  loadHistory: (...args: unknown[]) => mockLoadHistory(...args),
  setModel: (...args: unknown[]) => mockSetModel(...args),
}));

// ── WebSocket server ──────────────────────────────────────
const mockEmit = vi.fn();
const mockRequestConfirmation = vi.fn();
vi.mock('../ws.server.js', () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
  requestConfirmation: (...args: unknown[]) => mockRequestConfirmation(...args),
  onEvent: vi.fn(),
}));

// ── Ollama Client ─────────────────────────────────────────
const mockListModels = vi.fn();
vi.mock('../../ollama/ollama.client.js', () => ({
  listModels: (...args: unknown[]) => mockListModels(...args),
}));

// ── OpenClaude Client ─────────────────────────────────────
const mockGetClient = vi.fn();
vi.mock('../../openclaude/openclaude.client.js', () => ({
  getClient: (...args: unknown[]) => mockGetClient(...args),
}));

// ── LanceDB Adapter ──────────────────────────────────────
const mockSimilaritySearch = vi.fn();
vi.mock('../../memory/lancedb.adapter.js', () => ({
  similaritySearch: (...args: unknown[]) => mockSimilaritySearch(...args),
}));

// ── Memory Service ────────────────────────────────────────
const mockMemorySearch = vi.fn();
const mockIngestDirectory = vi.fn();
vi.mock('../../memory/memory.service.js', () => ({
  search: (...args: unknown[]) => mockMemorySearch(...args),
  ingestDirectory: (...args: unknown[]) => mockIngestDirectory(...args),
}));

// ── Planner Service ───────────────────────────────────────
const mockGenerate = vi.fn();
vi.mock('../../planner/planner.service.js', () => ({
  generate: (...args: unknown[]) => mockGenerate(...args),
}));

// ── Config ────────────────────────────────────────────────
vi.mock('../../config/config.js', () => ({
  config: {
    gateway: {
      port: 3001,
      host: 'localhost',
      corsOrigin: 'http://localhost:1420',
    },
    openclaude: { host: 'localhost', port: 50051 },
    ollama: { host: 'http://localhost:11434', retryAttempts: 3, retryBackoffMs: 1000 },
    memory: { dbPath: './data/lancedb', topK: 5, chunkSize: 512, chunkOverlap: 50 },
    vault: { path: './vault', watchDebounceMs: 500 },
    execGuard: { timeoutMs: 30000 },
    confirmation: { timeoutMs: 60000 },
    session: { historyLimit: 20 },
  },
}));

// ---------------------------------------------------------------------------
// Test app setup — register route plugins on a fresh Fastify instance
// ---------------------------------------------------------------------------

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });

  // Global error handler matching http.server.ts
  app.setErrorHandler((error, _request, reply) => {
    const statusCode = error.statusCode ?? 500;

    if (error.validation) {
      const message = error.validation
        .map((v: { message?: string }) => v.message ?? 'invalid value')
        .join('; ');
      void reply.status(400).send({ error: message, code: 'VALIDATION_ERROR' });
      return;
    }

    const code = error.code ?? 'INTERNAL_ERROR';
    void reply.status(statusCode).send({ error: error.message, code });
  });

  app.setNotFoundHandler((_request, reply) => {
    void reply.status(404).send({ error: 'Route not found', code: 'NOT_FOUND' });
  });

  // Import and register route plugins
  const { default: chatRoutes } = await import('../routes/chat.routes.js');
  const { default: filesRoutes } = await import('../routes/files.routes.js');
  const { default: healthRoutes } = await import('../routes/health.routes.js');
  const { default: modelsRoutes } = await import('../routes/models.routes.js');
  const { default: memoryRoutes } = await import('../routes/memory.routes.js');
  const { default: terminalRoutes } = await import('../routes/terminal.routes.js');
  const { default: plannerRoutes } = await import('../routes/planner.routes.js');

  await app.register(chatRoutes, { prefix: '/api' });
  await app.register(filesRoutes, { prefix: '/api' });
  await app.register(healthRoutes, { prefix: '/api' });
  await app.register(modelsRoutes, { prefix: '/api' });
  await app.register(memoryRoutes, { prefix: '/api' });
  await app.register(terminalRoutes, { prefix: '/api' });
  await app.register(plannerRoutes, { prefix: '/api' });

  await app.ready();
});

afterAll(async () => {
  await app.close();
});

// ---------------------------------------------------------------------------
// Chat Routes (Req 24.3, 24.4)
// ---------------------------------------------------------------------------

describe('Chat Routes', () => {
  it('POST /api/chat/message returns 202 when session exists', async () => {
    mockGetSession.mockReturnValue({
      id: 'sess-1',
      workspace: '/workspace',
      created_at: new Date().toISOString(),
    });
    mockHandle.mockResolvedValue({ agent: 'coder', text: 'done', cancelled: false });

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/message',
      payload: { sessionId: 'sess-1', content: 'Hello' },
    });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ queued: true });
  });

  it('POST /api/chat/message returns 404 when session not found', async () => {
    mockGetSession.mockReturnValue(undefined);

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/message',
      payload: { sessionId: 'nonexistent', content: 'Hello' },
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body).toHaveProperty('error');
    expect(body).toHaveProperty('code');
    expect(body.code).toBe('SESSION_NOT_FOUND');
  });

  it('POST /api/chat/message returns 400 on missing body fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/message',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body).toHaveProperty('error');
    expect(body).toHaveProperty('code');
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('POST /api/sessions returns 201 with sessionId', async () => {
    mockCreateSession.mockReturnValue({
      id: 'new-sess',
      workspace: '/workspace',
      created_at: '2024-01-01T00:00:00.000Z',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { workspacePath: '/workspace' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toHaveProperty('sessionId', 'new-sess');
    expect(body).toHaveProperty('createdAt');
  });

  it('GET /api/sessions/:id/history returns message array', async () => {
    mockGetSession.mockReturnValue({ id: 'sess-1', workspace: '/w' });
    mockLoadHistory.mockReturnValue([
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello!' },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/sessions/sess-1/history',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
  });

  it('DELETE /api/sessions/:id returns 204', async () => {
    mockGetSession.mockReturnValue({ id: 'sess-1', workspace: '/w' });
    mockDeleteSession.mockReturnValue(undefined);

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/sessions/sess-1',
    });

    expect(res.statusCode).toBe(204);
  });

  it('DELETE /api/sessions/:id returns 404 for unknown session', async () => {
    mockGetSession.mockReturnValue(undefined);

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/sessions/unknown',
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body).toHaveProperty('error');
    expect(body).toHaveProperty('code');
  });
});

// ---------------------------------------------------------------------------
// File Routes (Req 24.3, 24.4)
// ---------------------------------------------------------------------------

describe('File Routes', () => {
  it('POST /api/files returns 400 on missing body fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/files',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body).toHaveProperty('error');
    expect(body).toHaveProperty('code');
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('PATCH /api/files returns 400 on missing body fields', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/files',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body).toHaveProperty('error');
    expect(body).toHaveProperty('code');
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('DELETE /api/files returns 400 on missing body fields', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/files',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body).toHaveProperty('error');
    expect(body).toHaveProperty('code');
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('GET /api/files returns 400 when path query is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/files',
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body).toHaveProperty('error');
    expect(body).toHaveProperty('code');
  });

  it('GET /api/filesystem/tree returns 200 with array', async () => {
    // This hits the real filesystem from cwd, which is fine for a basic test
    const res = await app.inject({
      method: 'GET',
      url: '/api/filesystem/tree?root=.&depth=1',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Health Routes (Req 21.1)
// ---------------------------------------------------------------------------

describe('Health Routes', () => {
  it('GET /api/health returns status of all four components', async () => {
    // Mock all health check dependencies
    mockGetClient.mockReturnValue({
      getChannel: () => ({
        getConnectivityState: () => 2, // READY
      }),
    });
    mockListModels.mockResolvedValue([{ name: 'llama3' }]);
    mockSimilaritySearch.mockResolvedValue([]);
    mockGetSession.mockReturnValue(undefined); // __health_check__ returns undefined = OK

    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // All four components must be present
    expect(body).toHaveProperty('openclaude');
    expect(body).toHaveProperty('ollama');
    expect(body).toHaveProperty('lancedb');
    expect(body).toHaveProperty('sqlite');

    // Each component has status and message
    for (const key of ['openclaude', 'ollama', 'lancedb', 'sqlite'] as const) {
      expect(body[key]).toHaveProperty('status');
      expect(body[key]).toHaveProperty('message');
      expect(['healthy', 'unhealthy']).toContain(body[key].status);
      expect(typeof body[key].message).toBe('string');
    }
  });

  it('GET /api/health reports unhealthy when OpenClaude is unreachable', async () => {
    mockGetClient.mockImplementation(() => {
      throw new Error('gRPC client not initialized');
    });
    mockListModels.mockResolvedValue([]);
    mockSimilaritySearch.mockResolvedValue([]);
    mockGetSession.mockReturnValue(undefined);

    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
    });

    const body = res.json();
    expect(body.openclaude.status).toBe('unhealthy');
    expect(body.openclaude.message).toContain('unreachable');
  });

  it('GET /api/health reports unhealthy when Ollama is unreachable', async () => {
    mockGetClient.mockReturnValue({
      getChannel: () => ({ getConnectivityState: () => 2 }),
    });
    mockListModels.mockRejectedValue(new Error('Connection refused'));
    mockSimilaritySearch.mockResolvedValue([]);
    mockGetSession.mockReturnValue(undefined);

    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
    });

    const body = res.json();
    expect(body.ollama.status).toBe('unhealthy');
    expect(body.ollama.message).toContain('unreachable');
  });

  it('GET /api/health reports unhealthy when LanceDB fails', async () => {
    mockGetClient.mockReturnValue({
      getChannel: () => ({ getConnectivityState: () => 2 }),
    });
    mockListModels.mockResolvedValue([]);
    mockSimilaritySearch.mockRejectedValue(new Error('DB not initialized'));
    mockGetSession.mockReturnValue(undefined);

    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
    });

    const body = res.json();
    expect(body.lancedb.status).toBe('unhealthy');
    expect(body.lancedb.message).toContain('LanceDB error');
  });

  it('GET /api/health reports unhealthy when SQLite fails', async () => {
    mockGetClient.mockReturnValue({
      getChannel: () => ({ getConnectivityState: () => 2 }),
    });
    mockListModels.mockResolvedValue([]);
    mockSimilaritySearch.mockResolvedValue([]);
    mockGetSession.mockImplementation(() => {
      throw new Error('SQLite database is locked');
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
    });

    const body = res.json();
    expect(body.sqlite.status).toBe('unhealthy');
    expect(body.sqlite.message).toContain('SQLite error');
  });

  it('GET /api/health returns 503 when all components are unhealthy', async () => {
    mockGetClient.mockImplementation(() => {
      throw new Error('gRPC down');
    });
    mockListModels.mockRejectedValue(new Error('Ollama down'));
    mockSimilaritySearch.mockRejectedValue(new Error('LanceDB down'));
    mockGetSession.mockImplementation(() => {
      throw new Error('SQLite down');
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
    });

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.openclaude.status).toBe('unhealthy');
    expect(body.ollama.status).toBe('unhealthy');
    expect(body.lancedb.status).toBe('unhealthy');
    expect(body.sqlite.status).toBe('unhealthy');
  });
});

// ---------------------------------------------------------------------------
// Error Response Format (Req 24.4)
// ---------------------------------------------------------------------------

describe('Error Response Format', () => {
  it('404 for unknown routes returns { error, code }', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/nonexistent',
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body).toHaveProperty('error');
    expect(body).toHaveProperty('code');
    expect(typeof body.error).toBe('string');
    expect(typeof body.code).toBe('string');
  });

  it('validation errors return { error, code: "VALIDATION_ERROR" }', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/message',
      payload: { sessionId: 123 }, // wrong type — should be string
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body).toHaveProperty('error');
    expect(body).toHaveProperty('code');
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('session not found errors return { error, code }', async () => {
    mockGetSession.mockReturnValue(undefined);

    const res = await app.inject({
      method: 'GET',
      url: '/api/sessions/missing/history',
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body).toHaveProperty('error');
    expect(body).toHaveProperty('code');
    expect(body.code).toBe('SESSION_NOT_FOUND');
  });

  it('Ollama unavailable returns { error, code }', async () => {
    mockListModels.mockRejectedValue(new Error('Connection refused'));

    const res = await app.inject({
      method: 'GET',
      url: '/api/models',
    });

    expect(res.statusCode).toBe(502);
    const body = res.json();
    expect(body).toHaveProperty('error');
    expect(body).toHaveProperty('code');
    expect(body.code).toBe('OLLAMA_UNAVAILABLE');
  });
});
