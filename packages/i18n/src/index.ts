/**
 * @clover/i18n — Dicionário de strings do CloverOS (EN + PT-BR).
 *
 * O idioma ativo vem da config do usuário (`@clover/config`). `t(key, vars)`
 * interpola `{var}`. Chaves ausentes caem para EN e, por fim, para a própria
 * chave (nunca quebra a UI).
 */

export type Lang = 'en' | 'pt-BR';
export const LANGUAGES: Lang[] = ['en', 'pt-BR'];

type Dict = Record<string, string>;

const ptBR: Dict = {
  'repl.banner.title': 'CloverOS REPL',
  'repl.banner.hint': 'Digite uma tarefa, ou /help para os comandos.',
  'repl.bye': 'Até logo',
  'repl.sessionEnded': 'Sessão encerrada.',
  'repl.unknown': 'Comando desconhecido: /{name}. Use /help.',

  'help.title': 'Comandos do REPL',
  'help.help': '/help            mostra esta ajuda',
  'help.model': '/model [nome]     lista ou troca o modelo ativo',
  'help.status': '/status          saúde do Kernel e do Blackboard',
  'help.config': '/config          painel de configuração (idioma, modelo, log)',
  'help.mode': '/mode [step|auto] alterna a autonomia (confirmações)',
  'help.provider': '/provider        adiciona/ativa um provedor de LLM (OpenRouter/OpenAI)',
  'help.exec': '/exec <comando>  roda no Sandbox Tier 3 (pede autorização)',
  'help.clear': '/clear           limpa a tela',
  'help.exit': '/exit            sai do REPL',
  'help.freeText': 'Qualquer outro texto vira uma tarefa para o agente.',
  'help.fileTags': 'Caminhos de arquivo/imagem viram tags limpas automaticamente.',

  'model.title': 'Modelos disponíveis',
  'model.active': '(ativo)',
  'model.switched': 'Modelo ativo agora: {name}',
  'model.notFound': 'Modelo não encontrado: {name}',

  'status.title': 'Status do CloverOS',
  'status.kernel': 'Kernel: {n} tools registradas',
  'status.model': 'Modelo ativo: {name}',
  'status.provider': 'Provedor: {name}',
  'status.mode': 'Modo: {mode}',
  'status.language': 'Idioma: {lang}',
  'status.blackboard': 'Blackboard: {entries} entradas em {topics} tópicos',

  'task.attachments': 'Anexos detectados: {tags}',
  'task.failed': 'Falhou: {reason}',
  'task.error': 'Erro: {msg}',
  'task.suspended': 'Task suspensa: teto de segurança atingido ({reason}). Estado salvo no Blackboard.',

  'mode.switched': 'Modo de autonomia: {mode}',
  'mode.invalid': 'Modo inválido: {mode} (use step ou auto)',

  'config.title': 'Configuração do CloverOS',
  'config.language': 'Idioma',
  'config.defaultModel': 'Modelo padrão',
  'config.logLevel': 'Nível de log',
  'config.mode': 'Modo de autonomia',
  'config.saved': 'Configuração salva em {path}',
  'config.cancelled': 'Configuração não alterada.',
  'config.pickField': 'O que deseja configurar?',
  'config.pickValue': 'Escolha um valor para {field}',

  'provider.addName': 'Nome do provedor (ex.: openrouter)',
  'provider.baseUrl': 'Base URL (ex.: https://openrouter.ai/api/v1)',
  'provider.apiKey': 'API Key (digitação oculta)',
  'provider.saved': 'Provedor {name} salvo e ativado.',
  'provider.cancelled': 'Provedor não configurado.',

  'exec.confirm': 'Autorizar a execução deste comando no Sandbox Tier 3?',
  'exec.once': 'Executar uma vez',
  'exec.onceHint': 'roda agora, isolado e com timeout',
  'exec.always': 'Sempre nesta sessão',
  'exec.alwaysHint': 'não perguntar de novo',
  'exec.cancel': 'Cancelar',
  'exec.cancelHint': 'não executar',
  'exec.cancelled': 'Execução cancelada.',
  'exec.usage': 'Uso: /exec <comando>',

  'choice.nav': 'setas navegam / numero seleciona / Enter confirma / Esc cancela',
};

const en: Dict = {
  'repl.banner.title': 'CloverOS REPL',
  'repl.banner.hint': 'Type a task, or /help for commands.',
  'repl.bye': 'Goodbye',
  'repl.sessionEnded': 'Session ended.',
  'repl.unknown': 'Unknown command: /{name}. Use /help.',

  'help.title': 'REPL commands',
  'help.help': '/help            show this help',
  'help.model': '/model [name]     list or switch the active model',
  'help.status': '/status          Kernel and Blackboard health',
  'help.config': '/config          configuration panel (language, model, log)',
  'help.mode': '/mode [step|auto] toggle autonomy (confirmations)',
  'help.provider': '/provider        add/activate an LLM provider (OpenRouter/OpenAI)',
  'help.exec': '/exec <command>  run in the Tier-3 sandbox (asks authorization)',
  'help.clear': '/clear           clear the screen',
  'help.exit': '/exit            leave the REPL',
  'help.freeText': 'Any other text becomes a task for the agent.',
  'help.fileTags': 'File/image paths are turned into clean tags automatically.',

  'model.title': 'Available models',
  'model.active': '(active)',
  'model.switched': 'Active model now: {name}',
  'model.notFound': 'Model not found: {name}',

  'status.title': 'CloverOS status',
  'status.kernel': 'Kernel: {n} registered tools',
  'status.model': 'Active model: {name}',
  'status.provider': 'Provider: {name}',
  'status.mode': 'Mode: {mode}',
  'status.language': 'Language: {lang}',
  'status.blackboard': 'Blackboard: {entries} entries across {topics} topics',

  'task.attachments': 'Detected attachments: {tags}',
  'task.failed': 'Failed: {reason}',
  'task.error': 'Error: {msg}',
  'task.suspended': 'Task suspended: safety ceiling reached ({reason}). State saved to the Blackboard.',

  'mode.switched': 'Autonomy mode: {mode}',
  'mode.invalid': 'Invalid mode: {mode} (use step or auto)',

  'config.title': 'CloverOS configuration',
  'config.language': 'Language',
  'config.defaultModel': 'Default model',
  'config.logLevel': 'Log level',
  'config.mode': 'Autonomy mode',
  'config.saved': 'Configuration saved to {path}',
  'config.cancelled': 'Configuration unchanged.',
  'config.pickField': 'What do you want to configure?',
  'config.pickValue': 'Pick a value for {field}',

  'provider.addName': 'Provider name (e.g. openrouter)',
  'provider.baseUrl': 'Base URL (e.g. https://openrouter.ai/api/v1)',
  'provider.apiKey': 'API Key (hidden input)',
  'provider.saved': 'Provider {name} saved and activated.',
  'provider.cancelled': 'Provider not configured.',

  'exec.confirm': 'Authorize running this command in the Tier-3 sandbox?',
  'exec.once': 'Run once',
  'exec.onceHint': 'runs now, isolated and time-boxed',
  'exec.always': 'Always this session',
  'exec.alwaysHint': "don't ask again",
  'exec.cancel': 'Cancel',
  'exec.cancelHint': 'do not run',
  'exec.cancelled': 'Execution cancelled.',
  'exec.usage': 'Usage: /exec <command>',

  'choice.nav': 'arrows navigate / number selects / Enter confirms / Esc cancels',
};

const DICTS: Record<Lang, Dict> = { en, 'pt-BR': ptBR };

export class I18n {
  constructor(private language: Lang = 'pt-BR') {}

  get lang(): Lang {
    return this.language;
  }

  setLang(lang: Lang): void {
    if (DICTS[lang]) this.language = lang;
  }

  t(key: string, vars?: Record<string, string | number>): string {
    let value = DICTS[this.language]?.[key] ?? en[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) value = value.replaceAll(`{${k}}`, String(v));
    }
    return value;
  }
}

export function createI18n(lang: Lang = 'pt-BR'): I18n {
  return new I18n(lang);
}
