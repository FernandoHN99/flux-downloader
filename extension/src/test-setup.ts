// The popup runs as an extension page, so a few chrome APIs are always there.
// Tests get the smallest stub that keeps components honest: anything they
// actually depend on must be listed here, which makes the dependency visible.
import { vi } from 'vitest';

const runtime = {
  getURL: (path: string) => `chrome-extension://flux-test${path}`,
  getManifest: () => ({ version: '0.0.0-test' }),
  sendMessage: vi.fn(async () => ({ success: true })),
  connect: vi.fn(),
  lastError: undefined as chrome.runtime.LastError | undefined
};

Object.assign(globalThis, {
  chrome: {
    runtime,
    tabs: { query: vi.fn((_q: unknown, cb: (t: unknown[]) => void) => cb([{ id: 1 }])) },
    storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) } }
  }
});
