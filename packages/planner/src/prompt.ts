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
  '- Cada nó tem um id único (ex: "n1", "n2") e kind "tool_call".',
  '- Para usar a saída de um nó anterior, use uma referência:',
  '  {"kind":"ref","nodeId":"<id>","path":"<campo>"}.',
  '- "outputs" lista as referências do resultado final. IMPORTANTE: o campo "nodeId" em outputs DEVE ser exatamente um dos IDs que você declarou em "nodes".',
  '- Para perguntas gerais ou conversação, use a ferramenta "respond" com args {"message": "<sua resposta>"}.',
  '- Se a meta NÃO exigir ferramentas, use "respond".',
  '- Não explique; produza apenas o plano no formato exigido.',
  '',
  '# Gerenciamento de Contexto',
  '- Você tem orçamento LIMITADO de tokens — apenas ferramentas RELEVANTES para a meta estão listadas.',
  '- Se a pergunta for sobre as CAPACIDADES do sistema ("o que você sabe fazer?", "quais ferramentas possui?"), use a ferramenta "list_available_tools" para obter o catálogo completo.',
  '- Use "list_files" para listar diretórios; NÃO use git_clean/git_restore para explorar arquivos.',
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
    '',
    'Sugestões de correção:',
    '- Ferramenta desconhecida? Verifique o nome correto na lista acima.',
    '- ID de nó não encontrado? Use apenas os IDs que você declarou em "nodes".',
    '- Plano muito curto ou vazio? Pode ser uma pergunta geral — use "respond" com uma mensagem amigável.',
    '- Se a meta é ambígua ou muito vaga, responda educadamente pedindo mais detalhes e sugerindo ações concretas (ex.: "Tente: listar arquivos, buscar no código, ou /help para ver os comandos.").',
    '',
    'Corrija e gere um novo plano válido.',
  ].join('\n');
}
