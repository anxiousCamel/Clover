/**
 * Construção do prompt do Planner. Mantido enxuto (modelos pequenos): descreve
 * as tools disponíveis e pede um Plan IR. A garantia de forma vem do schema
 * (constrained decoding), não do prompt — o prompt foca no CONTEÚDO.
 */

import type { ToolDescriptor } from '@clover/contracts';

export const PLANNER_SYSTEM = [
  'Você é o Planner do CloverOS. Produza APENAS JSON válido no formato Plan IR.',
  '',
  '# REGRAS CRÍTICAS',
  '1. NUNCA use sintaxe de template ({{ }}, Jinja, Handlebars). Isso é INVÁLIDO.',
  '2. Para passar dados entre nós, use APENAS referências IR: {"kind":"ref","nodeId":"n1","path":"campo"}',
  '3. IDs em "outputs[].nodeId" DEVEM existir em "nodes[].id".',
  '4. Use SOMENTE ferramentas da lista abaixo.',
  '5. "respond.message" DEVE ser sempre texto puro (string literal). NUNCA passe uma ref de array para respond.',
  '',
  '# PADRÃO PADRÃO: PADRÃO A',
  'Na dúvida, USE PADRÃO A. Ferramentas só quando a meta EXPLICITAMENTE pede uma ação de arquivo.',
  '',
  '## PADRÃO A — PADRÃO (saudação, conversa, pergunta geral, qualquer dúvida):',
  '  Use UM nó: respond. Exemplos que usam A: "oi", "tudo bem?", "o que você faz?", "explique X", "qual a cor do céu?"',
  '  {"nodes":[{"id":"n1","kind":"tool_call","tool":"respond","args":{"message":"<resposta em texto>"}}],"edges":[],"outputs":[{"kind":"ref","nodeId":"n1","path":"message"}]}',
  '',
  '## PADRÃO B — SOMENTE se a meta contém palavras como "listar", "mostrar arquivos", "ver pasta":',
  '  Use UM nó: list_files. NÃO encadeie com respond.',
  '  {"nodes":[{"id":"n1","kind":"tool_call","tool":"list_files","args":{"path":"<caminho>"}}],"edges":[],"outputs":[{"kind":"ref","nodeId":"n1","path":"entries"}]}',
  '',
  '## PADRÃO C — SOMENTE se a meta pede para LER e explicar um arquivo específico:',
  '  Use DOIS nós: read_file → respond.',
  '  {"nodes":[{"id":"n1","kind":"tool_call","tool":"read_file","args":{"path":"<arq>"}},{"id":"n2","kind":"tool_call","tool":"respond","args":{"message":{"kind":"ref","nodeId":"n1","path":"content"}}}],"edges":[{"from":"n1","to":"n2"}],"outputs":[{"kind":"ref","nodeId":"n2","path":"message"}]}',
  '',
  '# DECISÃO (em ordem — pare na primeira que bate)',
  '1. Meta é saudação, conversa, pergunta geral, explicação ou dúvida? → PADRÃO A',
  '2. Meta EXPLICITAMENTE pede para listar/ver arquivos de um diretório? → PADRÃO B',
  '3. Meta EXPLICITAMENTE pede para ler/explicar um arquivo? → PADRÃO C',
  '4. Dúvida sobre capacidades do sistema? → list_available_tools',
  'Não explique. Produza apenas o JSON.',
].join('\n');

export function buildPlannerPrompt(
  goalText: string,
  tools: ToolDescriptor[],
  contextText?: string,
  osContext?: string,
): string {
  const toolLines = tools.map((t) => {
    const input = JSON.stringify(t.inputSchema);
    const output = t.outputSchema ? ` | outputSchema=${JSON.stringify(t.outputSchema)}` : '';
    return `- ${t.name}: ${t.description} | inputSchema=${input}${output}`;
  });
  const lines = [`Meta: ${goalText}`, ''];
  if (osContext && osContext.trim()) {
    lines.push(osContext.trim(), '');
  }
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
  osContext?: string,
): string {
  return [
    buildPlannerPrompt(goalText, tools, contextText, osContext),
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
