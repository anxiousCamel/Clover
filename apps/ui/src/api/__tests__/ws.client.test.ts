/**
 * Unit tests for WebSocket client reconnection behaviour.
 *
 * Validates: Requirements 27.2, 27.3
 *
 * - 27.2: WHEN the WebSocket connection is lost, THE ws.client SHALL attempt
 *         reconnection with exponential backoff.
 * - 27.3: THE ws.client SHALL preserve registered event handlers across
 *         reconnections.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Minimal WebSocket mock
// ---------------------------------------------------------------------------

type WsListener = (...args: unknown[]) => void;

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  url: string;

  private listeners = new Map<string, Set<WsListener>>();

  constructor(url: string) {
    this.url = url;
    // Track all created instances for assertions
    mockInstances.push(this);
  }

  addEventListener(type: string, listener: WsListener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: WsListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  send = vi.fn();

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.dispatchEvent('close');
  }

  // ── Helpers for tests ──────────────────────────────────────────────

  /** Simulate the server accepting the connection. */
  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.dispatchEvent('open');
  }

  /** Simulate receiving a message from the server. */
  simulateMessage(data: string): void {
    this.dispatchEvent('message', { data } as unknown);
  }

  /** Simulate an unexpected close (server-side disconnect). */
  simulateUnexpectedClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.dispatchEvent('close');
  }

  private dispatchEvent(type: string, event?: unknown): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const fn of set) {
      fn(event ?? {});
    }
  }
}

// Track all WebSocket instances created during a test
let mockInstances: MockWebSocket[] = [];

// ---------------------------------------------------------------------------
// Test setup — fresh module per test
// ---------------------------------------------------------------------------

/**
 * Because ws.client.ts uses module-level state (singleton), we need to
 * re-import it fresh for each test to avoid cross-test contamination.
 */
async function loadFreshModule() {
  // Reset the module registry so the next import gets a fresh copy
  vi.resetModules();

  // Stub the global WebSocket with our mock BEFORE importing the module
  vi.stubGlobal('WebSocket', MockWebSocket);

  const mod = await import('../../api/ws.client.js');
  return mod;
}

describe('WebSocket client reconnection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockInstances = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── Requirement 27.3: Preserve event handlers across reconnections ─

  describe('event handler preservation across reconnections (Req 27.3)', () => {
    it('should invoke handlers registered before a reconnection after the new socket opens', async () => {
      const { connect, onEvent } = await loadFreshModule();

      // Register a handler BEFORE connecting
      const handler = vi.fn();
      onEvent('message:token', handler);

      // Connect — first socket
      connect('session-1');
      const ws1 = mockInstances[0];
      ws1.simulateOpen();

      // Verify handler works on the first connection
      ws1.simulateMessage(JSON.stringify({ type: 'message:token', data: { token: 'hello' } }));
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ token: 'hello' });

      // Simulate unexpected close → triggers reconnection
      ws1.simulateUnexpectedClose();

      // Advance past the initial backoff (1 000 ms)
      await vi.advanceTimersByTimeAsync(1_000);

      // A new WebSocket should have been created
      expect(mockInstances).toHaveLength(2);
      const ws2 = mockInstances[1];
      ws2.simulateOpen();

      // The same handler should fire on the new socket
      handler.mockClear();
      ws2.simulateMessage(JSON.stringify({ type: 'message:token', data: { token: 'world' } }));
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ token: 'world' });
    });

    it('should preserve multiple handlers for different event types across reconnections', async () => {
      const { connect, onEvent } = await loadFreshModule();

      const tokenHandler = vi.fn();
      const statusHandler = vi.fn();
      onEvent('message:token', tokenHandler);
      onEvent('agent:status', statusHandler);

      connect('session-2');
      const ws1 = mockInstances[0];
      ws1.simulateOpen();

      // Simulate disconnect + reconnect
      ws1.simulateUnexpectedClose();
      await vi.advanceTimersByTimeAsync(1_000);

      const ws2 = mockInstances[1];
      ws2.simulateOpen();

      ws2.simulateMessage(JSON.stringify({ type: 'message:token', data: 'tok' }));
      ws2.simulateMessage(JSON.stringify({ type: 'agent:status', data: { status: 'running' } }));

      expect(tokenHandler).toHaveBeenCalledWith('tok');
      expect(statusHandler).toHaveBeenCalledWith({ status: 'running' });
    });

    it('should preserve handlers added after connect but before disconnect', async () => {
      const { connect, onEvent } = await loadFreshModule();

      connect('session-3');
      const ws1 = mockInstances[0];
      ws1.simulateOpen();

      // Register handler AFTER the connection is open
      const lateHandler = vi.fn();
      onEvent('tool:result', lateHandler);

      // Disconnect + reconnect
      ws1.simulateUnexpectedClose();
      await vi.advanceTimersByTimeAsync(1_000);

      const ws2 = mockInstances[1];
      ws2.simulateOpen();

      ws2.simulateMessage(JSON.stringify({ type: 'tool:result', data: { success: true } }));
      expect(lateHandler).toHaveBeenCalledWith({ success: true });
    });
  });

  // ── Requirement 27.2: Exponential backoff ──────────────────────────

  describe('exponential backoff timing (Req 27.2)', () => {
    it('should reconnect after INITIAL_BACKOFF_MS (1 000 ms) on first disconnect', async () => {
      const { connect } = await loadFreshModule();

      connect('session-4');
      const ws1 = mockInstances[0];
      ws1.simulateOpen();

      // Unexpected close
      ws1.simulateUnexpectedClose();

      // Not yet reconnected at 999 ms
      await vi.advanceTimersByTimeAsync(999);
      expect(mockInstances).toHaveLength(1);

      // Reconnected at 1 000 ms
      await vi.advanceTimersByTimeAsync(1);
      expect(mockInstances).toHaveLength(2);
    });

    it('should double the backoff on each successive failure (1s → 2s → 4s)', async () => {
      const { connect } = await loadFreshModule();

      connect('session-5');
      const ws1 = mockInstances[0];
      ws1.simulateOpen();

      // ── First disconnect → 1 000 ms backoff ──
      ws1.simulateUnexpectedClose();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(mockInstances).toHaveLength(2);

      const ws2 = mockInstances[1];
      // Don't open — simulate immediate failure
      ws2.simulateUnexpectedClose();

      // ── Second disconnect → 2 000 ms backoff ──
      await vi.advanceTimersByTimeAsync(1_999);
      expect(mockInstances).toHaveLength(2); // not yet
      await vi.advanceTimersByTimeAsync(1);
      expect(mockInstances).toHaveLength(3);

      const ws3 = mockInstances[2];
      ws3.simulateUnexpectedClose();

      // ── Third disconnect → 4 000 ms backoff ──
      await vi.advanceTimersByTimeAsync(3_999);
      expect(mockInstances).toHaveLength(3); // not yet
      await vi.advanceTimersByTimeAsync(1);
      expect(mockInstances).toHaveLength(4);
    });

    it('should cap backoff at MAX_BACKOFF_MS (30 000 ms)', async () => {
      const { connect } = await loadFreshModule();

      connect('session-6');
      let ws = mockInstances[0];
      ws.simulateOpen();

      // Simulate many consecutive failures to exceed the cap:
      // backoff sequence: 1s, 2s, 4s, 8s, 16s, 32s → capped at 30s
      const expectedBackoffs = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

      for (let i = 0; i < expectedBackoffs.length; i++) {
        ws.simulateUnexpectedClose();
        const backoff = expectedBackoffs[i];

        // Not reconnected just before the backoff
        await vi.advanceTimersByTimeAsync(backoff - 1);
        expect(mockInstances).toHaveLength(i + 1);

        // Reconnected at the backoff time
        await vi.advanceTimersByTimeAsync(1);
        expect(mockInstances).toHaveLength(i + 2);

        ws = mockInstances[i + 1];
        // Don't call simulateOpen — keep failing
      }

      // After the cap, the next backoff should still be 30 000 ms
      ws.simulateUnexpectedClose();
      await vi.advanceTimersByTimeAsync(29_999);
      expect(mockInstances).toHaveLength(expectedBackoffs.length + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(mockInstances).toHaveLength(expectedBackoffs.length + 2);
    });

    it('should reset backoff to initial value after a successful connection', async () => {
      const { connect } = await loadFreshModule();

      connect('session-7');
      const ws1 = mockInstances[0];
      ws1.simulateOpen();

      // First disconnect → 1s backoff
      ws1.simulateUnexpectedClose();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(mockInstances).toHaveLength(2);

      const ws2 = mockInstances[1];
      // Second disconnect without opening → 2s backoff
      ws2.simulateUnexpectedClose();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(mockInstances).toHaveLength(3);

      const ws3 = mockInstances[2];
      // This time the connection succeeds — backoff should reset
      ws3.simulateOpen();

      // Disconnect again → should be back to 1s (initial backoff)
      ws3.simulateUnexpectedClose();
      await vi.advanceTimersByTimeAsync(999);
      expect(mockInstances).toHaveLength(3); // not yet
      await vi.advanceTimersByTimeAsync(1);
      expect(mockInstances).toHaveLength(4);
    });

    it('should not reconnect after intentional disconnect()', async () => {
      const { connect, disconnect } = await loadFreshModule();

      connect('session-8');
      const ws1 = mockInstances[0];
      ws1.simulateOpen();

      // Intentional disconnect
      disconnect();

      // Advance well past any backoff
      await vi.advanceTimersByTimeAsync(60_000);

      // No new WebSocket should have been created (only the original one)
      expect(mockInstances).toHaveLength(1);
    });
  });
});
