/**
 * @clover/tools — Arsenal de ferramentas do CloverOS.
 *
 * Organizado por namespaces/departamentos. Cada tool é uma `LocalTool` pronta
 * para registro no Kernel (`kernel.registerTools`), o que a torna visível ao
 * Planner e ao Context Builder automaticamente (ver `@clover/agent`).
 *
 * Fatia atual: `git/` (leitura) + a primitiva `sys/exec` + a ponte Zod→ABI.
 */

import type { LocalTool } from '@clover/tool-abi';

import { devTools } from './dev/index.js';
import { fsTools } from './fs/index.js';
import { gitTools } from './git/index.js';

export * from './abi.js';
export * as sys from './sys/index.js';
export * from './git/index.js';
export * from './fs/index.js';
export * from './dev/index.js';

/** Agrega todas as tools do arsenal (para registro em massa no Kernel). */
export const cloverTools: LocalTool[] = [...gitTools, ...fsTools, ...devTools];
