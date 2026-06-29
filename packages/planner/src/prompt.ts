/**
 * Construção do prompt do Planner. Mantido enxuto (modelos pequenos): descreve
 * as tools disponíveis e pede um Plan IR. A garantia de forma vem do schema
 * (constrained decoding), não do prompt — o prompt foca no CONTEÚDO.
 */

import type { ToolDescriptor } from '@clover/contracts';

export const PLANNER_SYSTEM = [
  'Você é o Planner do CloverOS. Produza um PLANO como um DAG de chamadas de ferramenta.',
  'Regras:',
  '- Use SOMENTE as ferramentas listadas.',
  '- Cada nó tem um id único e kind "tool_call".',
  '- Para usar a saída de um nó anterior, use uma referência:',
  '  {"kind":"ref","nodeId":"<id>","path":"<campo>"}.',
  '- "outputs" lista as referências que representam o resultado final do plano.',
  '- Não explique; produza apenas o plano no formato exigido.',
].join('\n');

export function buildPlannerPrompt(
  goalText: string,
  tools: ToolDescriptor[],
  contextText?: string,
): string {
  const toolLines = tools.map((t) => {
    const schema = JSON.stringify(t.inputSchema);
    return `- ${t.name}: ${t.description} | inputSchema=${schema}`;
  });
  const lines = [`Meta: ${goalText}`, ''];
  if (contextText && contextText.trim()) {
    // Contexto estrutural recuperado (AST/KG), já limitado pelo orçamento.
    lines.push('Contexto do código (recuperação estrutural):', contextText.trim(), '');
  }
  lines.push('Ferramentas disponíveis:', ...toolLines, '', 'Gere o plano (Plan IR) que cumpre a meta.');
  return lines.join('\n');
}

/** Prompt de reparo: reenviado quando a tentativa anterior foi inválida. */
export function buildRepairPrompt(
  goalText: string,
  tools: ToolDescriptor[],
  errors: string[],
  contextText?: string,
): string {
  return [
    buildPlannerPrompt(goalText, tools, contextText),
    '',
    'A tentativa anterior foi REJEITADA pelos seguintes motivos:',
    ...errors.map((e) => `- ${e}`),
    'Corrija e gere um novo plano válido.',
  ].join('\n');
}
