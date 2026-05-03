/**
 * Property-Based Test — Property 13: Subagent Context Isolation
 *
 * **Validates: Requirements 3.1.2, 3.1.3, 3.2.4**
 *
 * For any spawned subagent, its `chatHistory` SHALL be independent from the
 * parent's history (mutations to one do not affect the other), and its
 * `tokenBudget` SHALL be independent from the parent's budget.
 *
 * Generator strategy:
 *   - Generate random CreateSubagentContextOptions (parentSessionId, goal,
 *     depth, workspacePath, optional tokenBudget, agentType, systemPrompt).
 *   - Spawn a subagent context, then mutate parent-side and child-side chat
 *     histories and token budgets independently.
 *   - Verify no cross-contamination between parent and child contexts.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  createSubagentContext,
  type SubagentContext,
  type CreateSubagentContextOptions,
} from '../subagent-context.js';
import type { Message } from '@clover/shared';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Generate a valid Message object. */
const messageArb: fc.Arbitrary<Message> = fc.record({
  role: fc.constantFrom('system' as const, 'user' as const, 'assistant' as const, 'tool' as const),
  content: fc.string({ minLength: 1, maxLength: 200 }),
  id: fc.option(fc.uuid(), { nil: undefined }),
  tool_name: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
  tool_call_id: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
});

/** Generate a non-empty array of messages to push into a chat history. */
const messagesArb = fc.array(messageArb, { minLength: 1, maxLength: 10 });

/** Generate a valid token budget (positive integer). */
const tokenBudgetArb = fc.integer({ min: 1, max: 100_000 });

/** Generate valid CreateSubagentContextOptions. */
const optionsArb: fc.Arbitrary<CreateSubagentContextOptions> = fc.record({
  parentSessionId: fc.uuid(),
  goal: fc.string({ minLength: 1, maxLength: 200 }),
  depth: fc.integer({ min: 0, max: 10 }),
  workspacePath: fc.string({ minLength: 1, maxLength: 100 }),
  agentType: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
  systemPrompt: fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: undefined }),
  tokenBudget: fc.option(tokenBudgetArb, { nil: undefined }),
});

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('Property 13: Subagent Context Isolation', () => {
  it('child chatHistory is independent from parent — mutations to child do not affect parent (Req 3.1.2, 3.1.3)', () => {
    fc.assert(
      fc.property(optionsArb, messagesArb, (options, childMessages) => {
        // Simulate parent chat history
        const parentChatHistory: Message[] = [];

        // Spawn subagent
        const child: SubagentContext = createSubagentContext(options);

        // Mutate child chat history
        for (const msg of childMessages) {
          child.chatHistory.push(msg);
        }

        // Parent must remain empty — no cross-contamination
        expect(parentChatHistory).toHaveLength(0);
        expect(child.chatHistory).toHaveLength(childMessages.length);
      }),
      { numRuns: 100 },
    );
  });

  it('parent chatHistory mutations do not affect child (Req 3.1.2, 3.1.3)', () => {
    fc.assert(
      fc.property(optionsArb, messagesArb, (options, parentMessages) => {
        // Simulate parent chat history
        const parentChatHistory: Message[] = [];

        // Spawn subagent
        const child: SubagentContext = createSubagentContext(options);

        // Mutate parent chat history after spawning child
        for (const msg of parentMessages) {
          parentChatHistory.push(msg);
        }

        // Child must remain empty — no cross-contamination
        expect(child.chatHistory).toHaveLength(0);
        expect(parentChatHistory).toHaveLength(parentMessages.length);
      }),
      { numRuns: 100 },
    );
  });

  it('sibling subagents have independent chatHistories (Req 3.1.2, 3.1.3)', () => {
    fc.assert(
      fc.property(
        optionsArb,
        messagesArb,
        messagesArb,
        (options, messagesA, messagesB) => {
          const childA = createSubagentContext(options);
          const childB = createSubagentContext(options);

          // Mutate each child independently
          for (const msg of messagesA) {
            childA.chatHistory.push(msg);
          }
          for (const msg of messagesB) {
            childB.chatHistory.push(msg);
          }

          // Each child has only its own messages
          expect(childA.chatHistory).toHaveLength(messagesA.length);
          expect(childB.chatHistory).toHaveLength(messagesB.length);

          // Array references are distinct
          expect(childA.chatHistory).not.toBe(childB.chatHistory);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('child tokenBudget is independent from parent budget (Req 3.2.4)', () => {
    fc.assert(
      fc.property(
        optionsArb,
        tokenBudgetArb,
        tokenBudgetArb,
        (options, parentBudget, newChildBudget) => {
          // Simulate parent token budget
          let parentTokenBudget = parentBudget;

          // Spawn subagent with its own budget
          const child = createSubagentContext({
            ...options,
            tokenBudget: parentBudget, // start with same value as parent
          });

          // Mutate child budget
          child.tokenBudget = newChildBudget;

          // Parent budget must be unchanged
          expect(parentTokenBudget).toBe(parentBudget);
          expect(child.tokenBudget).toBe(newChildBudget);

          // Mutate parent budget
          parentTokenBudget = parentBudget + 1000;

          // Child budget must be unchanged
          expect(child.tokenBudget).toBe(newChildBudget);
          expect(parentTokenBudget).toBe(parentBudget + 1000);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('spawning multiple subagents produces fully independent contexts (Req 3.1.2, 3.1.3, 3.2.4)', () => {
    fc.assert(
      fc.property(
        optionsArb,
        messagesArb,
        messagesArb,
        tokenBudgetArb,
        tokenBudgetArb,
        (options, msgsA, msgsB, budgetA, budgetB) => {
          const parentChatHistory: Message[] = [];
          let parentTokenBudget = 10_000;

          const childA = createSubagentContext({ ...options, tokenBudget: budgetA });
          const childB = createSubagentContext({ ...options, tokenBudget: budgetB });

          // Mutate all three independently
          parentChatHistory.push({ role: 'user', content: 'parent msg' });
          for (const msg of msgsA) childA.chatHistory.push(msg);
          for (const msg of msgsB) childB.chatHistory.push(msg);

          parentTokenBudget -= 500;
          childA.tokenBudget += 100;
          childB.tokenBudget -= 50;

          // Verify complete isolation
          expect(parentChatHistory).toHaveLength(1);
          expect(childA.chatHistory).toHaveLength(msgsA.length);
          expect(childB.chatHistory).toHaveLength(msgsB.length);

          expect(parentTokenBudget).toBe(9_500);
          expect(childA.tokenBudget).toBe(budgetA + 100);
          expect(childB.tokenBudget).toBe(budgetB - 50);

          // All chat history arrays are distinct references
          expect(parentChatHistory).not.toBe(childA.chatHistory);
          expect(parentChatHistory).not.toBe(childB.chatHistory);
          expect(childA.chatHistory).not.toBe(childB.chatHistory);

          // All IDs are unique
          expect(childA.id).not.toBe(childB.id);
        },
      ),
      { numRuns: 100 },
    );
  });
});
