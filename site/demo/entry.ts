// The popup, running on the download page with sample lessons.
//
// This installs a stand-in for the extension's background (the real one reads
// browser tabs and talks to the companion app), then loads the real popup code
// on top of it. So what visitors click is the product's own interface: the
// list, Shift-select, folders. It only keeps a list in memory and never
// downloads anything. Built by site/build.mjs; not part of the extension.

import { videoKey } from '../../extension/src/detection/video-key';

const LESSONS: Array<[string, string, number]> = [
  ['Why the command line?', 'why-the-command-line', 402],
  ['Files and folders', 'files-and-folders', 555],
  ['Moving around: cd, ls, pwd', 'moving-around', 663],
  ['Copying, moving, deleting', 'copying-moving-deleting', 507],
  ['Reading files: cat, less, head', 'reading-files', 471],
  ['Searching with grep', 'searching-with-grep', 756],
  ['Pipes and redirection', 'pipes-and-redirection', 608],
  ['Permissions explained', 'permissions-explained', 824],
  ['Users and groups', 'users-and-groups', 599],
  ['Processes and signals', 'processes-and-signals', 690],
  ['Installing software', 'installing-software', 492],
  ['Environment variables', 'environment-variables', 440],
  ['Writing your first script', 'first-script', 845],
  ['Cron: running things on a schedule', 'cron', 581],
  ['SSH basics', 'ssh-basics', 738],
  ['Wrapping up', 'wrapping-up', 276]
];

const DEMO_NOTICE = 'This is a demo, so nothing is saved. Install Flux to download for real.';

interface Entry {
  id: string;
  title: string;
  type: 'hls';
  url: string;
  pageUrl: string;
  pageTitle: string;
  duration: number;
  qualities: Array<{ height: number; url: string; label: string; bitrate: number }>;
  detectedAt: number;
  folderId?: string;
  failed?: boolean;
}

const entries: Entry[] = LESSONS.map(([title, slug, duration], index) => ({
  id: `lesson-${index + 1}`,
  title,
  type: 'hls',
  url: `https://cdn.example.com/linux-basics/${slug}/playlist.m3u8?token=demo`,
  pageUrl: `https://courses.example.com/linux-basics/lesson/${slug}`,
  pageTitle: 'Linux basics',
  duration,
  qualities: [
    { height: 1080, url: `https://cdn.example.com/linux-basics/${slug}/1080p.m3u8`, label: '1080p', bitrate: 4_500_000 },
    { height: 720, url: `https://cdn.example.com/linux-basics/${slug}/720p.m3u8`, label: '720p', bitrate: 2_200_000 },
    { height: 480, url: `https://cdn.example.com/linux-basics/${slug}/480p.m3u8`, label: '480p', bitrate: 1_000_000 }
  ],
  detectedAt: Date.now() - index * 1000
}));
// One thing that went wrong, so the badge is part of the picture.
entries[9].failed = true;

let folders: Array<{ id: string; name: string }> = [];
let nextFolder = 1;

const currentKeys = [videoKey(entries[0].url)];
const listeners: Array<(message: unknown) => void> = [];
const reply = (message: unknown): void => {
  setTimeout(() => listeners.forEach((listener) => listener(message)), 0);
};
const snapshot = () => ({ type: 'HISTORY_LIST', entries: entries.map((entry) => ({ ...entry })), folders });
const entryFor = (key: string) => entries.find((entry) => videoKey(entry.url) === key);

const port = {
  name: 'popup',
  postMessage(message: any): void {
    switch (message.type) {
      case 'GET_HISTORY':
        return reply(snapshot());
      case 'GET_MEDIA':
      case 'REFRESH_TABS':
        return reply({ type: 'MEDIA_LIST', videos: [entries[0]], currentKeys });
      case 'GET_BATCH_STATUS':
        return reply({ type: 'BATCH_STATUS', batch: null });
      case 'GET_ACTIVE_DOWNLOAD':
        return reply({ type: 'NO_ACTIVE_DOWNLOAD' });
      case 'CREATE_FOLDER': {
        const id = `folder-${nextFolder++}`;
        folders = [...folders, { id, name: message.name }];
        for (const key of message.keys || []) {
          const entry = entryFor(key);
          if (entry) entry.folderId = id;
        }
        return reply(snapshot());
      }
      case 'MOVE_TO_FOLDER':
        for (const key of message.keys) {
          const entry = entryFor(key);
          if (!entry) continue;
          if (message.folderId) entry.folderId = message.folderId;
          else delete entry.folderId;
        }
        return reply(snapshot());
      case 'RENAME_FOLDER':
        folders = folders.map((folder) => (folder.id === message.id ? { ...folder, name: message.name } : folder));
        return reply(snapshot());
      case 'DELETE_FOLDER':
        folders = folders.filter((folder) => folder.id !== message.id);
        for (const entry of entries) if (entry.folderId === message.id) delete entry.folderId;
        return reply(snapshot());
      case 'RENAME_HISTORY_ITEM': {
        const entry = entryFor(message.key);
        if (entry) entry.title = message.title;
        return reply(snapshot());
      }
      case 'DELETE_HISTORY_ITEMS': {
        const gone = new Set<string>(message.keys);
        for (let i = entries.length - 1; i >= 0; i--) if (gone.has(videoKey(entries[i].url))) entries.splice(i, 1);
        return reply(snapshot());
      }
      case 'CLEAR_HISTORY':
        entries.length = 0;
        return reply(snapshot());
      case 'DOWNLOAD':
        return reply({ type: 'DOWNLOAD_STARTED', success: false, error: DEMO_NOTICE });
      case 'DOWNLOAD_ALL':
        return reply({ type: 'ERROR', message: DEMO_NOTICE });
      default:
        return undefined;
    }
  },
  onMessage: { addListener: (listener: (message: unknown) => void) => { listeners.push(listener); } },
  onDisconnect: { addListener: () => undefined }
};

const store: Record<string, unknown> = {};
(window as any).chrome = {
  runtime: {
    connect: () => port,
    lastError: undefined,
    getURL: (path: string) => new URL(path, location.href).href
  },
  storage: {
    local: {
      get: (keys: string | string[]) => Promise.resolve(
        Array.isArray(keys) ? Object.fromEntries(keys.map((key) => [key, store[key]])) : { [keys]: store[keys] }
      ),
      set: (items: Record<string, unknown>) => { Object.assign(store, items); return Promise.resolve(); }
    },
    onChanged: { addListener: () => undefined }
  },
  tabs: { query: (_query: unknown, callback: (tabs: Array<{ id: number }>) => void) => callback([{ id: 1 }]) }
};

import '../../extension/src/popup/index';
