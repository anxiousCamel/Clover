/**
 * Heuristic Gate — lightweight, zero-LLM signal detection.
 *
 * Determines if an input likely contains a filesystem/action intent
 * BEFORE calling the LLM classifier. Tuned for recall over precision:
 * false positives are cheap (just an LLM classify call), false negatives
 * cause silent failures.
 *
 * Each feature detector returns a score 0–3.
 * Inputs scoring >= ACTION_THRESHOLD proceed to LLM classification.
 *
 * @module pipeline/heuristic.gate
 */

// --- Weights ---
const WEIGHTS = {
  filePath: 4,
  filesystemNoun: 3,
  actionVerb: 4, // Increased from 2
  deictic: 2,
  imperative: 3, // Increased from 1
  contentRequest: 3,
};

// --- Thresholds ---
const ACTION_THRESHOLD = 1; // Lowered from 2 to be extremely proactive

export interface GateResult {
  /** Whether this input should proceed to LLM classification. */
  looksLikeAction: boolean;
  /** Individual feature scores for logging. */
  features: Record<string, number>;
  /** Total combined score. */
  score: number;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Strip diacritics so "área" matches "area", "diretório" matches "diretorio".
 * Uses Unicode NFD decomposition + strip combining marks.
 */
function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// ---------------------------------------------------------------------------
// Feature detectors
// ---------------------------------------------------------------------------

/** File extensions and path separators. Score 0–3. */
function scoreFilePath(input: string): number {
  const normalized = input.toLowerCase();
  // Absolute Windows path (C:\ or C:/)
  if (/[A-Za-z]:[/\\]/.test(input)) return 3;
  // Absolute Unix path
  if (normalized.startsWith('/') && normalized.length > 5) return 2;
  // Quoted filename with extension
  if (/["'][^"']+\.[a-z]{1,6}["']/i.test(input)) return 3;
  // Bare filename with common extension
  if (/\b[^\s/\\:*?"<>|]+\.(txt|md|json|ts|js|py|csv|xml|yaml|yml|log|sh|ps1|html|css|ini|env|c|cpp|h|java|go|rs|rb|php)\b/i.test(input)) return 3;
  // Path separator with segments
  if (/[/\\][^\s/\\]{2,}/.test(input)) return 2;
  return 0;
}

/** Filesystem noun keywords (PT + EN), accent-normalized. Score 0–2. */
function scoreFilesystemNoun(input: string): number {
  const normalized = stripAccents(input.toLowerCase());
  const nouns = [
    'arquivo', 'ficheiro', 'pasta', 'diretorio', 'diretoria',
    'file', 'folder', 'directory',
    'desktop', 'area de trabalho', 'workspace',
    'downloads', 'documentos', 'documents',
    'home', 'users', 'usuario', 'root',
  ];
  // Match as whole words or specific patterns
  return nouns.some(n => {
    const regex = new RegExp(`\\b${n.replace(/\s+/g, '\\s+')}\\b`, 'i');
    return regex.test(normalized);
  }) ? 2 : 0;
}

/**
 * Action verb keywords (PT + EN). Score 0–2.
 * Includes modals and variations.
 */
function scoreActionVerb(input: string): number {
  const normalized = stripAccents(input.toLowerCase());
  const verbs = [
    // PT
    'listar', 'lista', 'liste', 'mostra', 'exibe',
    'criar', 'cria', 'crie', 'faz', 'faca',
    'escrever', 'escreva', 'escreve', 'salva', 'salve', 'grava', 'grave', 'coloca', 'coloque',
    'ler', 'leia', 'le ', 'abre', 'abra',
    'deletar', 'deleta', 'delete', 'apaga', 'apague', 'remove', 'remova',
    'executa', 'execute', 'roda', 'rode',
    'consegue', 'pode', 'tenta', 'quero', // Modals
    // EN
    'list', 'create', 'write', 'read', 'open', 'save', 'put', 'add',
    'delete', 'remove', 'run', 'execute', 'show', 'display',
  ];
  return verbs.some(v => {
    const regex = new RegExp(`\\b${v}\\b`, 'i');
    return regex.test(normalized);
  }) ? 2 : 0;
}

/** Deictic references — pronouns pointing at prior context. Score 0–1. */
function scoreDeictic(input: string): number {
  const normalized = stripAccents(input.toLowerCase());
  const deictics = ['la', 'ali', 'ai', 'nele', 'nela', 'isso', 'esse', 'essa', 'naquele', 'naquela', 'aqui'];
  return deictics.some(d => {
    const regex = new RegExp(`\\b${d}\\b`);
    return regex.test(normalized);
  }) ? 1 : 0;
}

/** Short imperative (≤12 words). Score 0–1. */
function scoreImperative(input: string): number {
  const words = input.trim().split(/\s+/);
  if (words.length <= 12) return 1;
  return 0;
}

/** Interrogative and follow-up words (PT + EN). Score 0–1. */
function scoreInterrogative(input: string): number {
  const normalized = stripAccents(input.toLowerCase());
  const interrogatives = [
    'cade', 'onde', 'qual', 'quais', 'quem', 'quanto', 'quantos',
    'where', 'what', 'which', 'who', 'how',
    'mostra', 'exibe', 'revela', 'encontra',
  ];
  return interrogatives.some(i => {
    const regex = new RegExp(`\\b${i}\\b`, 'i');
    return regex.test(normalized);
  }) ? 1 : 0;
}

/** Content-generation request words. Score 0–1. */
function scoreContentRequest(input: string): number {
  const normalized = stripAccents(input.toLowerCase());
  const contentWords = [
    'poema', 'texto', 'conteudo', 'content', 'poem', 'story',
    'historia', 'descricao', 'description', 'resumo', 'summary',
    'codigo', 'code', 'script', 'funcao', 'function', 'config',
  ];
  return contentWords.some(w => normalized.includes(w)) ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate whether an input warrants LLM intent classification.
 */
export function evaluateGate(input: string, context?: { lastIntent?: string }): GateResult {
  const features: Record<string, number> = {
    filePath: scoreFilePath(input),
    filesystemNoun: scoreFilesystemNoun(input),
    actionVerb: scoreActionVerb(input),
    deictic: scoreDeictic(input),
    imperative: scoreImperative(input),
    interrogative: scoreInterrogative(input),
    contentRequest: scoreContentRequest(input),
  };

  let score = Object.values(features).reduce((sum, v) => sum + v, 0);

  // CONTEXT BONUS: if we have an active action context, follow-ups are more likely actions
  if (context?.lastIntent && context.lastIntent !== 'chat' && context.lastIntent !== 'unknown') {
    // If it looks even slightly like an interrogation or deictic, boost it
    if (features['interrogative'] > 0 || features['deictic'] > 0 || features['imperative'] > 0) {
      score += 1;
    }
  }

  return {
    looksLikeAction: score >= ACTION_THRESHOLD,
    features,
    score,
  };
}
