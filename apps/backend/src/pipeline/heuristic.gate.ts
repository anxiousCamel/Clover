/**
 * Heuristic Gate — lightweight, zero-LLM signal detection.
 *
 * Determines if an input likely contains a filesystem/action intent
 * BEFORE calling the LLM classifier. Conservative approach: only signals
 * "action" when there is clear evidence, keeping LLM calls to a minimum.
 *
 * Each feature detector returns a score 0–3.
 * Inputs scoring >= ACTION_THRESHOLD proceed to LLM classification.
 *
 * @module pipeline/heuristic.gate
 */

const ACTION_THRESHOLD = 2;

export interface GateResult {
  /** Whether this input should proceed to LLM classification. */
  looksLikeAction: boolean;
  /** Individual feature scores for logging. */
  features: Record<string, number>;
  /** Total combined score. */
  score: number;
}

// ---------------------------------------------------------------------------
// Feature detectors
// ---------------------------------------------------------------------------

/** File extensions and path separators. Score 0–3. */
function scoreFilePath(input: string): number {
  // Absolute Windows path
  if (/[A-Za-z]:[/\\]/.test(input)) return 3;
  // Quoted filename with extension
  if (/["'][^"']+\.[a-z]{1,6}["']/i.test(input)) return 3;
  // Bare filename with common extension
  if (/\b[^\s/\\:*?"<>|]+\.(txt|md|json|ts|js|py|csv|xml|yaml|yml|log|sh|ps1|html|css)\b/i.test(input)) return 3;
  // Path separator
  if (/[/\\][^\s/\\]{2,}/.test(input)) return 2;
  return 0;
}

/** Filesystem noun keywords (PT + EN). Score 0–2. */
function scoreFilesystemNoun(input: string): number {
  const lower = input.toLowerCase();
  const nouns = [
    'arquivo', 'ficheiro', 'pasta', 'diretório', 'diretorio',
    'file', 'folder', 'directory', 'desktop', 'área de trabalho',
    'downloads', 'documentos', 'documents',
  ];
  return nouns.some(n => lower.includes(n)) ? 2 : 0;
}

/** Deictic references — pronouns pointing at prior context. Score 0–1. */
function scoreDeictic(input: string): number {
  const lower = input.toLowerCase();
  const deictics = ['lá', 'ali', 'aí', 'nele', 'nela', 'isso', 'esse', 'essa', 'naquele', 'naquela', 'aqui'];
  return deictics.some(d => lower.includes(d)) ? 1 : 0;
}

/** Short imperative (≤6 words, no question mark). Score 0–1. */
function scoreImperative(input: string): number {
  const words = input.trim().split(/\s+/);
  if (words.length <= 6 && !input.includes('?')) return 1;
  return 0;
}

/** Content-generation request words. Score 0–1. */
function scoreContentRequest(input: string): number {
  const lower = input.toLowerCase();
  const contentWords = [
    'poema', 'texto', 'conteúdo', 'content', 'poem', 'story',
    'história', 'descrição', 'description', 'resumo', 'summary',
  ];
  return contentWords.some(w => lower.includes(w)) ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate whether an input warrants LLM intent classification.
 *
 * Returns `looksLikeAction: false` for clearly conversational inputs
 * (greetings, questions, opinions) so they bypass the classifier entirely.
 */
export function evaluateGate(input: string): GateResult {
  const features: Record<string, number> = {
    filePath: scoreFilePath(input),
    filesystemNoun: scoreFilesystemNoun(input),
    deictic: scoreDeictic(input),
    imperative: scoreImperative(input),
    contentRequest: scoreContentRequest(input),
  };

  const score = Object.values(features).reduce((sum, v) => sum + v, 0);

  return {
    looksLikeAction: score >= ACTION_THRESHOLD,
    features,
    score,
  };
}
