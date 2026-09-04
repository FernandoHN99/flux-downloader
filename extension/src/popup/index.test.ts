import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Incoming } from './messages';
import { App } from './index';

let receive: (message: Incoming) => void;
let postMessage: ReturnType<typeof vi.fn>;

function shell() {
  document.body.innerHTML = `
    <button id="settings-btn"></button>
    <span id="refresh-tabs"></span>
    <div id="status-bar"></div>
    <div id="empty-state"></div>
    <div id="download-progress"></div>
    <div id="history-section"></div>
    <div id="error"><span id="error-message"></span><button id="error-dismiss"></button></div>
  `;
  return {
    section: document.getElementById('history-section')!,
    progress: document.getElementById('download-progress')!,
    refresh: document.getElementById('refresh-tabs')!,
    empty: document.getElementById('empty-state')!,
    status: document.getElementById('status-bar')!,
    error: document.getElementById('error')!
  };
}

describe('App refresh', () => {
  beforeEach(() => {
    postMessage = vi.fn();
    const port = {
      postMessage,
      onMessage: { addListener: vi.fn((listener: (message: Incoming) => void) => { receive = listener; }) },
      onDisconnect: { addListener: vi.fn() }
    } as unknown as chrome.runtime.Port;
    vi.mocked(chrome.runtime.connect).mockReturnValue(port);
  });

  it('uses one request to refresh every tab and waits for its result', async () => {
    const app = new App(shell());
    await app.start();
    postMessage.mockClear();

    const button = document.getElementById('refresh-tabs-btn') as HTMLButtonElement;
    button.click();

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({ type: 'REFRESH_TABS' });
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Refreshing…');

    receive({ type: 'MEDIA_LIST', videos: [], currentKeys: [] });

    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('Refresh tabs');
  });
});
