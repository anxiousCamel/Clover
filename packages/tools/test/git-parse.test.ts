/**
 * git/parse — Testes PUROS dos parsers (sem git). Fixtures sintéticas espelham
 * exatamente os formatos à prova de máquina que as tools pedem ao git.
 */

import { describe, expect, it } from 'vitest';

import {
  parseBlamePorcelain,
  parseBranchList,
  parseDiffNameStatus,
  parseLog,
  parseStatusPorcelainV2,
} from '../src/git/parse.js';

const US = '\x1f';

describe('parseStatusPorcelainV2', () => {
  it('extrai branch, ahead/behind, upstream e arquivos (incl. rename e untracked)', () => {
    const raw = [
      '# branch.oid abc123',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -1',
      '1 .M N... 100644 100644 100644 hhh hhh a.txt',
      '2 R. N... 100644 100644 100644 hhh hhh R100 new.txt',
      'old.txt', // origPath do rename acima
      '? b.txt',
    ].join('\0');

    const s = parseStatusPorcelainV2(raw);
    expect(s.branch).toBe('main');
    expect(s.oid).toBe('abc123');
    expect(s.upstream).toBe('origin/main');
    expect(s.ahead).toBe(2);
    expect(s.behind).toBe(1);
    expect(s.clean).toBe(false);

    const a = s.files.find((f) => f.path === 'a.txt');
    expect(a).toEqual({ index: '.', worktree: 'M', path: 'a.txt' });

    const rename = s.files.find((f) => f.path === 'new.txt');
    expect(rename?.origPath).toBe('old.txt');
    expect(rename?.index).toBe('R');

    const untracked = s.files.find((f) => f.path === 'b.txt');
    expect(untracked).toEqual({ index: '?', worktree: '?', path: 'b.txt' });
  });

  it('árvore limpa → clean=true, sem arquivos', () => {
    const raw = ['# branch.head main', '# branch.ab +0 -0'].join('\0');
    const s = parseStatusPorcelainV2(raw);
    expect(s.clean).toBe(true);
    expect(s.files).toHaveLength(0);
  });
});

describe('parseLog', () => {
  it('separa commits por NUL e campos por US', () => {
    const raw = [
      ['abc', 'Ana', 'ana@x', '2024-01-01T00:00:00Z', 'feat: x'].join(US),
      ['def', 'Bob', 'bob@y', '2024-01-02T00:00:00Z', 'fix: y'].join(US),
    ].join('\0');
    const commits = parseLog(raw);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toEqual({
      hash: 'abc',
      author: 'Ana',
      email: 'ana@x',
      date: '2024-01-01T00:00:00Z',
      subject: 'feat: x',
    });
    expect(commits[1].subject).toBe('fix: y');
  });

  it('saída vazia → lista vazia', () => {
    expect(parseLog('')).toEqual([]);
  });
});

describe('parseDiffNameStatus', () => {
  it('M/A/D + rename (R consome dois caminhos)', () => {
    const raw = ['M', 'a.txt', 'A', 'b.txt', 'R100', 'old.txt', 'new.txt', 'D', 'c.txt'].join('\0');
    const files = parseDiffNameStatus(raw);
    expect(files).toEqual([
      { status: 'M', path: 'a.txt' },
      { status: 'A', path: 'b.txt' },
      { status: 'R', path: 'new.txt', origPath: 'old.txt' },
      { status: 'D', path: 'c.txt' },
    ]);
  });
});

describe('parseBranchList', () => {
  it('marca a branch atual (HEAD = *)', () => {
    const raw = ['main\0*', 'dev\0', 'feature\0'].join('\n');
    const branches = parseBranchList(raw);
    expect(branches).toEqual([
      { name: 'main', current: true },
      { name: 'dev', current: false },
      { name: 'feature', current: false },
    ]);
  });
});

describe('parseBlamePorcelain', () => {
  it('preenche autor de linhas subsequentes do mesmo commit (cache por SHA)', () => {
    const sha = 'a'.repeat(40);
    const raw = [
      `${sha} 1 1 2`,
      'author Ana',
      'author-mail <ana@x>',
      'summary first',
      'filename f.ts',
      '\tline one',
      `${sha} 2 2`, // cabeçalho abreviado: sem repetir author
      '\tline two',
    ].join('\n');
    const lines = parseBlamePorcelain(raw);
    expect(lines).toEqual([
      { line: 1, hash: sha, author: 'Ana', content: 'line one' },
      { line: 2, hash: sha, author: 'Ana', content: 'line two' },
    ]);
  });
});
