import { Settings, DEFAULT_SETTINGS, loadSettings, saveSettings, checkCoAppStatus } from '../lib/settings';
import { initTheme } from '../lib/theme';

let currentSettings: Settings = { ...DEFAULT_SETTINGS };

document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  await initializeSettings();
  setupHistoryMode();
  setupGroupMode();
  checkCoAppConnection();
});

async function initializeSettings(): Promise<void> {
  try {
    currentSettings = await loadSettings();
  } catch (error) {
    showStatusError('Could not read your settings — showing defaults.');
  }
  render();
}

function render(): void {
  updateHistoryButtons(currentSettings.keepHistory);
  updateGroupButtons(currentSettings.groupByDomain);
}

/**
 * There is no Save button: a click is the commit. Everything writes through
 * here so a storage failure is reported instead of silently lost.
 */
async function commit(change: Partial<Settings>): Promise<void> {
  const next = { ...currentSettings, ...change };
  currentSettings = next;
  render();
  try {
    await saveSettings(next);
    hideStatusError();
  } catch (error: any) {
    showStatusError(`Could not save: ${error?.message || error}`);
  }
}

function setupHistoryMode(): void {
  document.querySelectorAll<HTMLButtonElement>('#history-mode .segmented-option').forEach((button) => {
    button.addEventListener('click', () => {
      commit({ keepHistory: button.dataset.history !== 'current' });
    });
  });
}

function updateHistoryButtons(keepHistory: boolean): void {
  document.querySelectorAll<HTMLButtonElement>('#history-mode .segmented-option').forEach((button) => {
    const selected = (button.dataset.history === 'current') === !keepHistory;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-checked', String(selected));
  });

  const help = document.querySelector('#history-mode ~ .setting-help');
  if (help) {
    help.textContent = keepHistory
      ? 'Keeps everything Flux has detected, newest first'
      : 'Holds only what your open tabs are playing';
  }
}

function setupGroupMode(): void {
  document.querySelectorAll<HTMLButtonElement>('#group-mode .segmented-option').forEach((button) => {
    button.addEventListener('click', () => {
      commit({ groupByDomain: button.dataset.group === 'domain' });
    });
  });
}

function updateGroupButtons(groupByDomain: boolean): void {
  document.querySelectorAll<HTMLButtonElement>('#group-mode .segmented-option').forEach((button) => {
    const selected = (button.dataset.group === 'domain') === groupByDomain;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-checked', String(selected));
  });
}

async function checkCoAppConnection(): Promise<void> {
  const statusEl = document.getElementById('coapp-status');
  const versionEl = document.getElementById('coapp-version');
  if (!statusEl) return;

  statusEl.textContent = 'Checking\u2026';
  statusEl.className = 'status-indicator checking';

  const status = await checkCoAppStatus();

  if (status.connected) {
    statusEl.textContent = 'Connected';
    statusEl.className = 'status-indicator connected';
    if (versionEl) versionEl.textContent = status.version ? `v${status.version}` : '';
    hideStatusError();
    return;
  }

  statusEl.textContent = 'Disconnected';
  statusEl.className = 'status-indicator disconnected';
  if (versionEl) versionEl.textContent = '';
  showStatusError(status.error || 'Flux could not reach its companion app. Downloads will not start until it is running.');
}

// Errors surface in the status block itself rather than as a toast that
// disappears before it can be read.
function showStatusError(message: string): void {
  const el = document.getElementById('coapp-error');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

function hideStatusError(): void {
  document.getElementById('coapp-error')?.classList.add('hidden');
}
