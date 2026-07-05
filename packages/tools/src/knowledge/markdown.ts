/**
 * knowledge/markdown — Serialização do formato de memória (SRP: só o formato).
 *
 * Cada memória é um arquivo Markdown legível por humanos com frontmatter
 * delimitado por `---`. Formato próprio, mínimo e estável (sem dependência de
 * YAML): `chave: valor` por linha; listas como CSV. O corpo após o segundo
 * `---` é o conteúdo da memória.
 */

export interface MemoryFrontmatter {
  id: string;
  title: string;
  tags: string[];
  /** IDs de memórias relacionadas. */
  links: string[];
  createdAt: number;
  updatedAt: number;
}

export interface MemoryDocument extends MemoryFrontmatter {
  content: string;
}

/** Serializa memória → Markdown com frontmatter. */
export function serializeMemory(doc: MemoryDocument): string {
  const fm = [
    '---',
    `id: ${doc.id}`,
    `title: ${doc.title}`,
    `tags: ${doc.tags.join(', ')}`,
    `links: ${doc.links.join(', ')}`,
    `createdAt: ${doc.createdAt}`,
    `updatedAt: ${doc.updatedAt}`,
    '---',
    '',
  ].join('\n');
  return fm + doc.content.trimEnd() + '\n';
}

const csv = (v: string): string[] =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

/** Parseia Markdown com frontmatter → memória; `null` se o formato for inválido. */
export function parseMemory(text: string): MemoryDocument | null {
  if (!text.startsWith('---\n')) return null;
  const end = text.indexOf('\n---', 4);
  if (end === -1) return null;

  const fields = new Map<string, string>();
  for (const line of text.slice(4, end).split('\n')) {
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    fields.set(line.slice(0, sep).trim(), line.slice(sep + 1).trim());
  }
  const id = fields.get('id');
  const title = fields.get('title');
  if (!id || !title) return null;

  // Corpo: após o `---` de fechamento (+ quebra e linha em branco opcionais).
  const body = text.slice(end + 4).replace(/^\n+/, '');
  return {
    id,
    title,
    tags: csv(fields.get('tags') ?? ''),
    links: csv(fields.get('links') ?? ''),
    createdAt: Number(fields.get('createdAt') ?? 0),
    updatedAt: Number(fields.get('updatedAt') ?? 0),
    content: body.trimEnd(),
  };
}

/** Slug estável a partir do título (id da memória; colisão tratada pelo store). */
export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // remove acentos
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'memory'
  );
}
