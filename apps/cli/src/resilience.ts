/**
 * Resiliência catastrófica (Escopo 3.3).
 *
 * Em produção o terminal NUNCA deve ejetar um stack trace cru. Capturamos o erro
 * graciosamente, persistimos o estado no Blackboard (para recovery do Scheduler)
 * e encerramos com um log polido. A stack só vai para o Blackboard, não para a
 * tela do usuário.
 */

import type { Blackboard } from '@clover/blackboard';
import type { ThemeManager } from '@clover/tui';

export interface CrashHandlerDeps {
  blackboard: Pick<Blackboard, 'post'>;
  theme: ThemeManager;
  render: (text: string) => void;
  exit: (code: number) => void;
}

export type CrashKind = 'uncaughtException' | 'unhandledRejection';

export function buildCrashHandler(d: CrashHandlerDeps): (kind: CrashKind, err: unknown) => void {
  let handling = false;
  return (kind, err) => {
    if (handling) return; // evita loop de re-entrância
    handling = true;
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;

    // Persiste o estado para recovery (stack vai só para cá, não para a tela).
    try {
      d.blackboard.post({ topic: 'crash', author: 'cli', payload: { kind, message, stack } });
    } catch {
      /* nunca falhar dentro do handler de falha */
    }

    d.render(
      d.theme.error(
        `${d.theme.symbols.fail} Erro fatal (${kind}) capturado. Estado salvo no Blackboard para recovery do Scheduler.`,
      ),
    );
    d.render(d.theme.dim(`Detalhe: ${message}`));
    d.exit(1);
  };
}

export function installResilience(d: CrashHandlerDeps): void {
  const handler = buildCrashHandler(d);
  process.on('uncaughtException', (err) => handler('uncaughtException', err));
  process.on('unhandledRejection', (reason) => handler('unhandledRejection', reason));
}
