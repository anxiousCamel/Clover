import { embed as ollamaEmbed } from '../ollama/ollama.client.js';
import modelsConfig from '../../../../config/models.config.json' with { type: 'json' };

/** Resolve the default embed model name from models.config.json. */
function getEmbedModel(): string {
  const entry = modelsConfig.models.find(
    (m) => m.capabilities.includes('embed') && m.default,
  );
  if (!entry) {
    throw new Error(
      'No default embed model found in models.config.json — add a model with capabilities:["embed"] and default:true',
    );
  }
  return entry.name;
}

const embedModel = getEmbedModel();

/**
 * Embed a text string into a float vector via Ollama.
 * Stateless — no caching.
 */
export async function embed(text: string): Promise<number[]> {
  return ollamaEmbed(text, embedModel);
}
