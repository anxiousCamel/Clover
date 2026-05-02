/**
 * Task Service — manages the lifecycle of autonomous tasks.
 *
 * Handles task creation, step tracking, budget enforcement, and state
 * persistence.  Provides a unified interface for the Agent Engine to
 * interact with the current task.
 *
 * @module orchestrator/task-service
 */

import { v4 as uuidv4 } from 'uuid';
import type { TaskState, TaskStep, ExecutionBudget } from '@clover/shared';
import * as sessionManager from './session.manager.js';
import { SQLiteStore } from '../storage/sqlite.store.js';

let store: SQLiteStore;

/** Initialise the task service with the global SQLite store. */
export function init(sqliteStore: SQLiteStore): void {
  store = sqliteStore;
}

/**
 * Create a new autonomous task for a session.
 */
export function createTask(
  sessionId: string,
  goal: string,
  budget: Partial<ExecutionBudget> = {},
): TaskState {
  const task: TaskState = {
    id: uuidv4(),
    goal,
    status: 'running',
    steps: [],
    attempts: 0,
    budget: {
      maxFileWrites: budget.maxFileWrites ?? 10,
      maxCommands: budget.maxCommands ?? 20,
      maxTurns: budget.maxTurns ?? 15,
    },
  };

  store.saveTask(sessionId, task);
  return task;
}

/**
 * Retrieve the active task for a session.
 */
export function getActiveTask(sessionId: string): TaskState | undefined {
  const raw = store.getTaskBySession(sessionId);
  if (!raw || raw.status === 'done' || raw.status === 'failed') return undefined;
  return raw as TaskState;
}

/**
 * Update the status of a specific task step.
 */
export function updateStep(
  sessionId: string,
  taskId: string,
  stepId: string,
  status: TaskStep['status'],
  result?: string,
): void {
  const task = store.getTask(taskId) as TaskState;
  if (!task) return;

  const step = task.steps.find(s => s.id === stepId);
  if (step) {
    step.status = status;
    if (result) step.result = result;
  } else {
    task.steps.push({ id: stepId, description: '', status, result });
  }

  store.saveTask(sessionId, task);
}

/**
 * Record a tool execution attempt and check if budgets are exceeded.
 */
export function recordAttempt(sessionId: string, taskId: string): boolean {
  const task = store.getTask(taskId) as TaskState;
  if (!task) return true;

  task.attempts += 1;
  store.saveTask(sessionId, task);

  return task.attempts < task.budget.maxTurns;
}

/**
 * Check if the task's success criteria are met.
 * Currently uses a simple heuristic; will be enhanced with LLM-based verification.
 */
export async function verifySuccess(
  sessionId: string,
  taskId: string,
): Promise<boolean> {
  const task = store.getTask(taskId) as TaskState;
  if (!task) return false;

  // Placeholder for advanced validation logic (e.g., calling an evaluator agent)
  const allCompleted = task.steps.length > 0 && task.steps.every(s => s.status === 'completed');
  
  if (allCompleted) {
    task.status = 'done';
    store.saveTask(sessionId, task);
    return true;
  }

  return false;
}
