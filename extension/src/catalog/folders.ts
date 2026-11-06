import type { HistoryEntry, VideoFolder } from '../shared/types';

/** Folder id by `videoKey`: which folder each video was filed into. */
export type FolderAssignments = Record<string, string>;

export const FOLDER_NAME_LIMIT = 60;

const RESERVED_DIRECTORY_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** What the user typed, made tidy enough to show and to compare. */
export function normalizeFolderName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, FOLDER_NAME_LIMIT).trim();
}

/**
 * The directory a folder's downloads land in. A folder name is user input that
 * becomes a path segment, so separators, dot-only names, trailing dots and
 * Windows device names are neutralised: the result can never leave the
 * download directory.
 */
export function folderDirectoryName(name: string): string {
  const cleaned = normalizeFolderName(name)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .trim();
  if (!cleaned || RESERVED_DIRECTORY_NAMES.test(cleaned)) return cleaned ? `${cleaned}_` : 'Folder';
  return cleaned;
}

/**
 * A name no other folder uses. Two names that sanitise to one directory would
 * pour into the same place, so uniqueness is judged on the directory, ignoring
 * case: "Aulas" and "aulas" collide on every filesystem the CoApp runs on.
 */
export function uniqueFolderName(
  folders: readonly VideoFolder[],
  name: string,
  ignoreId?: string
): string {
  const base = normalizeFolderName(name) || 'New folder';
  const taken = new Set(
    folders.filter((folder) => folder.id !== ignoreId)
      .map((folder) => folderDirectoryName(folder.name).toLowerCase())
  );
  let candidate = base;
  for (let n = 2; taken.has(folderDirectoryName(candidate).toLowerCase()); n += 1) {
    const suffix = ` ${n}`;
    candidate = `${base.slice(0, FOLDER_NAME_LIMIT - suffix.length).trim()}${suffix}`;
  }
  return candidate;
}

export function addFolder(folders: VideoFolder[], name: string, id: string): VideoFolder[] {
  return [...folders, { id, name: uniqueFolderName(folders, name) }];
}

export function renameFolderIn(folders: VideoFolder[], id: string, name: string): VideoFolder[] {
  const target = folders.find((folder) => folder.id === id);
  if (!target || !normalizeFolderName(name)) return folders;
  const next = uniqueFolderName(folders, name, id);
  if (next === target.name) return folders;
  return folders.map((folder) => (folder.id === id ? { ...folder, name: next } : folder));
}

/** The videos filed in a folder. */
export function keysInFolder(assignments: FolderAssignments, id: string): string[] {
  return Object.entries(assignments)
    .filter(([, folder]) => folder === id)
    .map(([key]) => key);
}

/**
 * Takes the folder away along with every filing into it. The videos are the
 * history's: whoever deletes a folder removes them there first (see
 * `keysInFolder`), so none is left behind unfiled.
 */
export function deleteFolderFrom(
  folders: VideoFolder[],
  assignments: FolderAssignments,
  id: string
): { folders: VideoFolder[]; assignments: FolderAssignments } {
  if (!folders.some((folder) => folder.id === id)) return { folders, assignments };
  return {
    folders: folders.filter((folder) => folder.id !== id),
    assignments: Object.fromEntries(Object.entries(assignments).filter(([, folder]) => folder !== id))
  };
}

/**
 * Files `keys` into `folderId`, or takes them out of any folder when it is
 * null. A video playing right now can be filed like any other. Returns the
 * same object when nothing changed.
 */
export function moveKeys(
  assignments: FolderAssignments,
  folders: readonly VideoFolder[],
  keys: readonly string[],
  folderId: string | null
): FolderAssignments {
  if (folderId !== null && !folders.some((folder) => folder.id === folderId)) return assignments;
  let next = assignments;
  for (const key of keys) {
    if (next[key] === (folderId ?? undefined)) continue;
    if (next === assignments) next = { ...assignments };
    if (folderId === null) delete next[key];
    else next[key] = folderId;
  }
  return next;
}

export function forgetKeys(assignments: FolderAssignments, keys: readonly string[]): FolderAssignments {
  if (!keys.some((key) => key in assignments)) return assignments;
  const gone = new Set(keys);
  return Object.fromEntries(Object.entries(assignments).filter(([key]) => !gone.has(key)));
}

/** Tags each entry with its folder for the popup; a stale folder id is ignored. */
export function decorateWithFolders(
  entries: HistoryEntry[],
  assignments: FolderAssignments,
  folders: readonly VideoFolder[],
  keyOf: (entry: HistoryEntry) => string
): HistoryEntry[] {
  const known = new Set(folders.map((folder) => folder.id));
  return entries.map((entry) => {
    const folderId = assignments[keyOf(entry)];
    return folderId && known.has(folderId) ? { ...entry, folderId } : entry;
  });
}
