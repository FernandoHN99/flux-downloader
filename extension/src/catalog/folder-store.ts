import type { HistoryEntry, VideoFolder } from '../shared/types';
import { videoKey } from '../detection/video-key';
import {
  addFolder,
  decorateWithFolders,
  deleteFolderFrom,
  folderDirectoryName,
  forgetKeys,
  keysInFolder,
  moveKeys,
  renameFolderIn,
  type FolderAssignments
} from './folders';

const FOLDERS_KEY = 'videoFolders';
const ASSIGNMENTS_KEY = 'folderAssignments';

export interface FolderStoreDeps {
  /** Called after any change so the popup can be sent the new list. */
  changed: () => void;
  newId?: () => string;
}

interface FolderState {
  folders: VideoFolder[];
  assignments: FolderAssignments;
}

/**
 * Owns the user's folders and which video sits in which. Kept apart from the
 * detection history on purpose: history entries are pruned and rewritten by
 * detection, while a folder is something the user built and expects to stay.
 *
 * Like `HistoryStore`, every mutation is a queued read-modify-write on
 * chrome.storage, so two quick drags cannot overwrite each other.
 */
export class FolderStore {
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly deps: FolderStoreDeps) {}

  async read(): Promise<FolderState> {
    const stored = await chrome.storage.local.get([FOLDERS_KEY, ASSIGNMENTS_KEY]);
    const folders = Array.isArray(stored[FOLDERS_KEY])
      ? (stored[FOLDERS_KEY] as unknown[]).filter(isFolder)
      : [];
    const raw = stored[ASSIGNMENTS_KEY];
    const assignments: FolderAssignments = {};
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const known = new Set(folders.map((folder) => folder.id));
      for (const [key, folderId] of Object.entries(raw)) {
        if (typeof folderId === 'string' && known.has(folderId)) assignments[key] = folderId;
      }
    }
    return { folders, assignments };
  }

  async folders(): Promise<VideoFolder[]> {
    return (await this.read()).folders;
  }

  /** Resolves once every queued write has run, so a read sees them. */
  settled(): Promise<void> {
    return this.writes;
  }

  /** Creates a folder and optionally files videos into it; resolves to its id. */
  create(name: string, keys: string[] = []): Promise<string | undefined> {
    let created: string | undefined;
    return this.enqueue(async (state) => {
      const id = (this.deps.newId ?? defaultId)();
      const folders = addFolder(state.folders, name, id);
      created = id;
      const assignments = moveKeys(state.assignments, folders, keys, id);
      return { folders, assignments };
    }).then(() => created);
  }

  rename(id: string, name: string): Promise<void> {
    return this.enqueue(async (state) => ({
      folders: renameFolderIn(state.folders, id, name),
      assignments: state.assignments
    }));
  }

  /** The videos filed in a folder, as of every write already queued. */
  async keysIn(id: string): Promise<string[]> {
    await this.writes;
    return keysInFolder((await this.read()).assignments, id);
  }

  /** The folder goes, and with it every filing into it. */
  remove(id: string): Promise<void> {
    return this.enqueue(async (state) => deleteFolderFrom(state.folders, state.assignments, id));
  }

  move(keys: string[], folderId: string | null): Promise<void> {
    return this.enqueue(async (state) => ({
      folders: state.folders,
      assignments: moveKeys(state.assignments, state.folders, keys, folderId)
    }));
  }

  /** A video leaving the history leaves its folder too. */
  forget(keys: string[]): Promise<void> {
    return this.enqueue(async (state) => ({
      folders: state.folders,
      assignments: forgetKeys(state.assignments, keys)
    }));
  }

  forgetAll(): Promise<void> {
    return this.enqueue(async (state) => ({ folders: state.folders, assignments: {} }));
  }

  async decorate(entries: HistoryEntry[]): Promise<HistoryEntry[]> {
    const { folders, assignments } = await this.read();
    return decorateWithFolders(entries, assignments, folders, (entry) => videoKey(entry.url));
  }

  /**
   * The directory name of the folder this video is filed in, if any. This is
   * what turns "in a folder" into "downloaded into that folder".
   */
  async directoryNameFor(url: string): Promise<string | undefined> {
    const { folders, assignments } = await this.read();
    const folder = folders.find((item) => item.id === assignments[videoKey(url)]);
    return folder ? folderDirectoryName(folder.name) : undefined;
  }

  private enqueue(transform: (state: FolderState) => Promise<FolderState>): Promise<void> {
    const result = this.writes.then(async () => {
      const state = await this.read();
      const next = await transform(state);
      if (next.folders === state.folders && next.assignments === state.assignments) return;
      await chrome.storage.local.set({
        [FOLDERS_KEY]: next.folders,
        [ASSIGNMENTS_KEY]: next.assignments
      });
      this.deps.changed();
    });
    this.writes = result.catch(() => { /* kept alive for the next write */ });
    return result;
  }
}

function isFolder(value: unknown): value is VideoFolder {
  return !!value && typeof value === 'object'
    && typeof (value as VideoFolder).id === 'string'
    && typeof (value as VideoFolder).name === 'string';
}

function defaultId(): string {
  return crypto.randomUUID();
}
