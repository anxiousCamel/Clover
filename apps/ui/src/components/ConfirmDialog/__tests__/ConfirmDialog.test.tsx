/**
 * Unit tests for ConfirmDialog component.
 *
 * Validates:
 * - Requirement 19.3: Approve sends `confirmation:response` with approved=true
 * - Requirement 19.4: Deny sends `confirmation:response` with approved=false
 * - Requirement 19.6: Dialog blocks all other UI interactions until user responds
 *
 * @module components/ConfirmDialog/__tests__/ConfirmDialog.test
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import { ConfirmDialog } from '../ConfirmDialog.js';

// ---------------------------------------------------------------------------
// Mock ws.client — capture onEvent registrations and emit calls
// ---------------------------------------------------------------------------

/** Stores the handler registered via onEvent for a given event type. */
const registeredHandlers = new Map<string, (data: unknown) => void>();

/** Captures all calls to emit(type, data). */
const emitCalls: Array<{ type: string; data: unknown }> = [];

vi.mock('../../../api/ws.client.js', () => ({
  onEvent: vi.fn((type: string, handler: (data: unknown) => void) => {
    registeredHandlers.set(type, handler);
    return () => {
      registeredHandlers.delete(type);
    };
  }),
  emit: vi.fn((type: string, data: unknown) => {
    emitCalls.push({ type, data });
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sample confirmation request payload. */
function sampleRequest(overrides: Record<string, unknown> = {}) {
  return {
    requestId: 'req-001',
    toolName: 'delete-file',
    operation: 'Delete file',
    details: 'Permanently removes src/temp.ts',
    args: { path: 'src/temp.ts' },
    ...overrides,
  };
}

/**
 * Simulate the backend sending a `confirmation:request` event by invoking
 * the handler that ConfirmDialog registered via onEvent.
 * Wrapped in act() because it triggers a React state update.
 */
function simulateConfirmationRequest(data: unknown) {
  const handler = registeredHandlers.get('confirmation:request');
  if (!handler) throw new Error('No handler registered for confirmation:request');
  act(() => {
    handler(data);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConfirmDialog', () => {
  beforeEach(() => {
    registeredHandlers.clear();
    emitCalls.length = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // ── Rendering ──────────────────────────────────────────────────────

  it('should not render anything when there is no pending request', () => {
    const { container } = render(<ConfirmDialog />);
    expect(container.innerHTML).toBe('');
  });

  it('should render the dialog when a confirmation:request event is received', () => {
    render(<ConfirmDialog />);
    simulateConfirmationRequest(sampleRequest());

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('delete-file')).toBeInTheDocument();
    expect(screen.getByText('Permanently removes src/temp.ts')).toBeInTheDocument();
  });

  it('should display the operation arguments as formatted JSON', () => {
    render(<ConfirmDialog />);
    simulateConfirmationRequest(sampleRequest({ args: { path: 'foo.ts', force: true } }));

    const dialog = screen.getByRole('dialog');
    // The args should be pretty-printed JSON inside a <pre> element
    const pre = within(dialog).getByText(/"path": "foo.ts"/);
    expect(pre).toBeInTheDocument();
  });

  // ── Requirement 19.3: Approve sends correct WebSocket event ────────

  describe('Approve button (Req 19.3)', () => {
    it('should send confirmation:response with approved=true when Approve is clicked', async () => {
      const user = userEvent.setup();
      render(<ConfirmDialog />);
      simulateConfirmationRequest(sampleRequest());

      const approveBtn = screen.getByRole('button', { name: /approve/i });
      await user.click(approveBtn);

      expect(emitCalls).toHaveLength(1);
      expect(emitCalls[0]).toEqual({
        type: 'confirmation:response',
        data: { requestId: 'req-001', approved: true },
      });
    });

    it('should close the dialog after approval', async () => {
      const user = userEvent.setup();
      render(<ConfirmDialog />);
      simulateConfirmationRequest(sampleRequest());

      expect(screen.getByRole('dialog')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /approve/i }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('should include the correct requestId in the approval response', async () => {
      const user = userEvent.setup();
      render(<ConfirmDialog />);
      simulateConfirmationRequest(sampleRequest({ requestId: 'custom-id-42' }));

      await user.click(screen.getByRole('button', { name: /approve/i }));

      expect(emitCalls[0].data).toEqual({
        requestId: 'custom-id-42',
        approved: true,
      });
    });
  });

  // ── Requirement 19.4: Deny sends correct WebSocket event ───────────

  describe('Deny button (Req 19.4)', () => {
    it('should send confirmation:response with approved=false when Deny is clicked', async () => {
      const user = userEvent.setup();
      render(<ConfirmDialog />);
      simulateConfirmationRequest(sampleRequest());

      const denyBtn = screen.getByRole('button', { name: /deny/i });
      await user.click(denyBtn);

      expect(emitCalls).toHaveLength(1);
      expect(emitCalls[0]).toEqual({
        type: 'confirmation:response',
        data: { requestId: 'req-001', approved: false },
      });
    });

    it('should close the dialog after denial', async () => {
      const user = userEvent.setup();
      render(<ConfirmDialog />);
      simulateConfirmationRequest(sampleRequest());

      expect(screen.getByRole('dialog')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /deny/i }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('should send denial via Escape key', async () => {
      const user = userEvent.setup();
      render(<ConfirmDialog />);
      simulateConfirmationRequest(sampleRequest());

      // Verify dialog is showing before pressing Escape
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      await user.keyboard('{Escape}');

      expect(emitCalls).toHaveLength(1);
      expect(emitCalls[0]).toEqual({
        type: 'confirmation:response',
        data: { requestId: 'req-001', approved: false },
      });
    });
  });

  // ── Requirement 19.6: Dialog blocks UI interaction ─────────────────

  describe('Modal blocking behaviour (Req 19.6)', () => {
    it('should render with aria-modal="true" to indicate modal blocking', () => {
      render(<ConfirmDialog />);
      simulateConfirmationRequest(sampleRequest());

      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-modal', 'true');
    });

    it('should render a full-screen overlay that covers the entire viewport', () => {
      render(<ConfirmDialog />);
      simulateConfirmationRequest(sampleRequest());

      const dialog = screen.getByRole('dialog');
      // The overlay is the dialog element itself with position:fixed and inset:0
      expect(dialog.style.position).toBe('fixed');
      expect(dialog.style.inset).toBe('0px');
    });

    it('should have a high z-index overlay to block interaction with elements behind it', () => {
      render(<ConfirmDialog />);
      simulateConfirmationRequest(sampleRequest());

      const dialog = screen.getByRole('dialog');
      const zIndex = parseInt(dialog.style.zIndex, 10);
      expect(zIndex).toBeGreaterThanOrEqual(9999);
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────

  describe('Edge cases', () => {
    it('should update the dialog when a new request replaces the current one', () => {
      render(<ConfirmDialog />);
      simulateConfirmationRequest(sampleRequest({ toolName: 'delete-file' }));

      expect(screen.getByText('delete-file')).toBeInTheDocument();

      // A second request arrives before the first is answered
      simulateConfirmationRequest(
        sampleRequest({ requestId: 'second', toolName: 'execute-command' }),
      );

      expect(screen.getByText('execute-command')).toBeInTheDocument();
    });

    it('should display operation field as fallback when details is empty', () => {
      render(<ConfirmDialog />);
      simulateConfirmationRequest(
        sampleRequest({ details: '', operation: 'Fallback operation text' }),
      );

      expect(screen.getByText('Fallback operation text')).toBeInTheDocument();
    });
  });
});
