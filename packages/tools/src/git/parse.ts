/**
 * git/parse — Parsers PUROS de saída do Git.
 *
 * Princípio: nunca parsear saída "humana" do git (locale/cor/aspas variam).
 * As tools chamam o git com formatos **estáveis e à prova de máquina**
 * (`--porcelain=v2 -z`, `--pretty=format:...%x1f...`, `--name-status -z`,
 * `--line-porcelain`, `--no-color`, `core.quotepath=false`) e estas funções
 * traduzem esses bytes em estruturas. Sendo puras, são testáveis sem um repo.
 */

const US = '\x1f'; // unit separator: separa campos dentro de um registro

// ===========================================================================
// git status --porcelain=v2 --branch -z
// ===========================================================================

export interface GitFileStatus {
  path: string;
  /** Caminho de origem (apenas para renomeados/copiados). */
  origPath?: string;
  /** Código de status do índice (staged), ex.: 'M', 'A', 'D', '?', '!'. */
  index: string;
  /** Código de status da árvore de trabalho (unstaged). */
  worktree: string;
}

export interface GitStatus {
  branch?: string;
  oid?: string;
  upstream?: string;
  ahead: number;
  behind: number;
  files: GitFileStatus[];
  clean: boolean;
}

/**
 * Parser do formato porcelain v2 com `-z` (registros separados por NUL).
 * Entradas tipo `2` (rename/copy) consomem o token seguinte (origPath).
 */
export function parseStatusPorcelainV2(raw: string): GitStatus {
  const tokens = raw.split('\0');
  const files: GitFileStatus[] = [];
  let branch: string | undefined;
  let oid: string | undefined;
  let upstream: string | undefined;
  let ahead = 0;
  let behind = 0;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t) continue;

    if (t.startsWith('# ')) {
      const body = t.slice(2);
      if (body.startsWith('branch.head ')) branch = body.slice(12);
      else if (body.startsWith('branch.oid ')) oid = body.slice(11);
      else if (body.startsWith('branch.upstream ')) upstream = body.slice(16);
      else if (body.startsWith('branch.ab ')) {
        for (const part of body.slice(10).split(' ')) {
          if (part.startsWith('+')) ahead = Number.parseInt(part.slice(1), 10) || 0;
          else if (part.startsWith('-')) behind = Number.parseInt(part.slice(1), 10) || 0;
        }
      }
      continue;
    }

    const type = t[0];
    if (type === '1') {
      const parts = t.split(' ');
      const xy = parts[1] ?? '..';
      files.push({ index: xy[0], worktree: xy[1], path: parts.slice(8).join(' ') });
    } else if (type === '2') {
      const parts = t.split(' ');
      const xy = parts[1] ?? '..';
      const path = parts.slice(9).join(' ');
      const origPath = tokens[++i]; // próximo token NUL = caminho de origem
      files.push({ index: xy[0], worktree: xy[1], path, origPath });
    } else if (type === 'u') {
      const parts = t.split(' ');
      const xy = parts[1] ?? 'UU';
      files.push({ index: xy[0], worktree: xy[1], path: parts.slice(10).join(' ') });
    } else if (type === '?') {
      files.push({ index: '?', worktree: '?', path: t.slice(2) });
    } else if (type === '!') {
      files.push({ index: '!', worktree: '!', path: t.slice(2) });
    }
  }

  return { branch, oid, upstream, ahead, behind, files, clean: files.length === 0 };
}

// ===========================================================================
// git log -z --pretty=format:%H<US>%an<US>%aE<US>%aI<US>%s
// ===========================================================================

export interface GitCommit {
  hash: string;
  author: string;
  email: string;
  /** Data de autoria ISO-8601 estrita (%aI). */
  date: string;
  subject: string;
}

/** Parser de `git log` com campos separados por US e commits separados por NUL. */
export function parseLog(raw: string): GitCommit[] {
  return raw
    .split('\0')
    .map((r) => r.replace(/^\n/, '')) // `-z` ainda pode deixar um \n inicial entre registros
    .filter((r) => r.length > 0)
    .map((record) => {
      const [hash = '', author = '', email = '', date = '', subject = ''] = record.split(US);
      return { hash, author, email, date, subject };
    });
}

// ===========================================================================
// git diff --name-status -z
// ===========================================================================

export interface GitDiffFile {
  /** Código: 'A','M','D','R','C','T','U'. */
  status: string;
  path: string;
  /** Caminho de origem (renomeado/copiado). */
  origPath?: string;
}

/**
 * Parser de `--name-status -z`. Renomes/cópias (R/C) gastam dois caminhos
 * (origem, destino); demais gastam um.
 */
export function parseDiffNameStatus(raw: string): GitDiffFile[] {
  const tokens = raw.split('\0').filter((t) => t.length > 0);
  const files: GitDiffFile[] = [];
  for (let i = 0; i < tokens.length; ) {
    const status = tokens[i++];
    if (/^[RC]\d*$/.test(status)) {
      const origPath = tokens[i++];
      const path = tokens[i++];
      files.push({ status: status[0], path, origPath });
    } else {
      const path = tokens[i++];
      files.push({ status, path });
    }
  }
  return files;
}

// ===========================================================================
// git branch --format=%(refname:short)%00%(HEAD)
// ===========================================================================

export interface GitBranch {
  name: string;
  current: boolean;
}

/** Parser da listagem de branches (nome + marca de HEAD por linha). */
export function parseBranchList(raw: string): GitBranch[] {
  return raw
    .split('\n')
    .filter((l) => l.length > 0)
    .map((line) => {
      const [name = '', mark = ''] = line.split('\0');
      return { name, current: mark === '*' };
    });
}

// ===========================================================================
// git blame --line-porcelain
// ===========================================================================

export interface GitBlameLine {
  line: number;
  hash: string;
  author: string;
  content: string;
}

/**
 * Parser do formato `--line-porcelain`. O cabeçalho `author` só aparece na
 * primeira vez que um commit é visto; cacheamos por SHA para preencher as
 * linhas subsequentes do mesmo commit.
 */
export function parseBlamePorcelain(raw: string): GitBlameLine[] {
  const out: GitBlameLine[] = [];
  const authors = new Map<string, string>();
  let hash = '';
  let finalLine = 0;

  for (const line of raw.split('\n')) {
    const header = line.match(/^([0-9a-f]{40}) \d+ (\d+)/);
    if (header) {
      hash = header[1];
      finalLine = Number.parseInt(header[2], 10);
      continue;
    }
    if (line.startsWith('author ')) {
      authors.set(hash, line.slice(7));
      continue;
    }
    if (line.startsWith('\t')) {
      out.push({ line: finalLine, hash, author: authors.get(hash) ?? '', content: line.slice(1) });
    }
  }
  return out;
}
