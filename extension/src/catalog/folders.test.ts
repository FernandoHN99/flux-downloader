import { describe, expect, it } from 'vitest';
import type { HistoryEntry, VideoFolder } from '../shared/types';
import {
  addFolder,
  decorateWithFolders,
  deleteFolderFrom,
  folderDirectoryName,
  forgetKeys,
  keysInFolder,
  moveKeys,
  normalizeFolderName,
  renameFolderIn,
  uniqueFolderName
} from './folders';

const folder = (id: string, name: string): VideoFolder => ({ id, name });

describe('folderDirectoryName', () => {
  it.each([
    ['Aulas', 'Aulas'],
    ['  Curso:  React?  ', 'Curso_ React_'],
    ['a/b\\c', 'a_b_c'],
    ['..', 'Folder'],
    ['...hidden', 'hidden'],
    ['trailing. .', 'trailing'],
    ['   ', 'Folder'],
    ['CON', 'CON_'],
    ['nul', 'nul_']
  ])('turns %j into the safe directory %j', (name, directory) => {
    expect(folderDirectoryName(name)).toBe(directory);
  });

  it('can never contain a path separator or climb out of the download directory', () => {
    for (const name of ['../../etc', '..\\..\\x', '/abs', 'C:\\Windows']) {
      const directory = folderDirectoryName(name);
      expect(directory).not.toMatch(/[\\/]/);
      expect(directory).not.toBe('..');
      expect(directory.startsWith('.')).toBe(false);
    }
  });
});

describe('normalizeFolderName', () => {
  it('collapses whitespace and caps the length', () => {
    expect(normalizeFolderName('  a   b  ')).toBe('a b');
    expect(normalizeFolderName('x'.repeat(200))).toHaveLength(60);
  });
});

describe('uniqueFolderName', () => {
  it('keeps a free name as typed', () => {
    expect(uniqueFolderName([folder('1', 'Aulas')], 'Cursos')).toBe('Cursos');
  });

  it('numbers a name another folder already uses, ignoring case', () => {
    expect(uniqueFolderName([folder('1', 'Aulas')], 'aulas')).toBe('aulas 2');
  });

  it('treats names that share a directory as taken', () => {
    expect(uniqueFolderName([folder('1', 'a/b')], 'a\\b')).toBe('a\\b 2');
  });

  it('lets a folder keep its own name when renamed', () => {
    expect(uniqueFolderName([folder('1', 'Aulas')], 'Aulas', '1')).toBe('Aulas');
  });

  it('falls back to a default for an empty name', () => {
    expect(uniqueFolderName([], '   ')).toBe('New folder');
  });
});

describe('addFolder / renameFolderIn', () => {
  it('appends the folder with a unique name', () => {
    const folders = addFolder([folder('1', 'Aulas')], 'Aulas', '2');

    expect(folders.map((item) => item.name)).toEqual(['Aulas', 'Aulas 2']);
  });

  it('renames in place and ignores an empty name', () => {
    const folders = [folder('1', 'Aulas')];

    expect(renameFolderIn(folders, '1', 'Cursos')).toEqual([folder('1', 'Cursos')]);
    expect(renameFolderIn(folders, '1', '  ')).toBe(folders);
    expect(renameFolderIn(folders, 'nope', 'X')).toBe(folders);
    expect(renameFolderIn(folders, '1', 'Aulas')).toBe(folders);
  });
});

describe('keysInFolder', () => {
  it('lists just the videos filed in that folder', () => {
    expect(keysInFolder({ k1: '1', k2: '2', k3: '1' }, '1')).toEqual(['k1', 'k3']);
    expect(keysInFolder({ k1: '1' }, 'nope')).toEqual([]);
  });
});

describe('deleteFolderFrom', () => {
  it('drops the folder and every filing into it, leaving other folders alone', () => {
    const result = deleteFolderFrom(
      [folder('1', 'A'), folder('2', 'B')],
      { k1: '1', k2: '2', k3: '1' },
      '1'
    );

    expect(result.folders).toEqual([folder('2', 'B')]);
    expect(result.assignments).toEqual({ k2: '2' });
  });

  it('is a no-op for an unknown folder', () => {
    const folders = [folder('1', 'A')];
    const assignments = { k1: '1' };

    const result = deleteFolderFrom(folders, assignments, 'zzz');

    expect(result.folders).toBe(folders);
    expect(result.assignments).toBe(assignments);
  });
});

describe('moveKeys', () => {
  const folders = [folder('1', 'A'), folder('2', 'B')];

  it('files videos into a folder', () => {
    expect(moveKeys({}, folders, ['k1', 'k2'], '1')).toEqual({ k1: '1', k2: '1' });
  });

  it('moves a video from one folder to another', () => {
    expect(moveKeys({ k1: '1' }, folders, ['k1'], '2')).toEqual({ k1: '2' });
  });

  it('takes a video out of its folder when the target is null', () => {
    expect(moveKeys({ k1: '1', k2: '1' }, folders, ['k1'], null)).toEqual({ k2: '1' });
  });

  it('refuses a folder that does not exist', () => {
    const assignments = {};

    expect(moveKeys(assignments, folders, ['k1'], 'ghost')).toBe(assignments);
  });

  it('returns the same object when nothing changed', () => {
    const assignments = { k1: '1' };

    expect(moveKeys(assignments, folders, ['k1'], '1')).toBe(assignments);
    expect(moveKeys(assignments, folders, ['k9'], null)).toBe(assignments);
  });
});

describe('forgetKeys', () => {
  it('drops the given videos and keeps the rest', () => {
    expect(forgetKeys({ a: '1', b: '1' }, ['a'])).toEqual({ b: '1' });
  });

  it('returns the same object when none were filed', () => {
    const assignments = { a: '1' };

    expect(forgetKeys(assignments, ['zzz'])).toBe(assignments);
  });
});

describe('decorateWithFolders', () => {
  const entry = (url: string): HistoryEntry => ({
    id: url, url, title: url, type: 'hls', qualities: [], detectedAt: 1
  });
  const keyOf = (item: HistoryEntry) => item.url;

  it('tags filed entries and leaves the others untouched', () => {
    const [filed, loose] = decorateWithFolders(
      [entry('a'), entry('b')], { a: '1' }, [folder('1', 'A')], keyOf
    );

    expect(filed.folderId).toBe('1');
    expect(loose.folderId).toBeUndefined();
  });

  it('ignores an assignment whose folder no longer exists', () => {
    const [item] = decorateWithFolders([entry('a')], { a: 'gone' }, [folder('1', 'A')], keyOf);

    expect(item.folderId).toBeUndefined();
  });
});
