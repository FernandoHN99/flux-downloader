import { Settings, DEFAULT_SETTINGS, loadSettings, saveSettings, checkCoAppStatus, ThemeMode } from '../lib/settings';
import { applyTheme, initTheme } from '../lib/theme';

let currentSettings: Settings = { ...DEFAULT_SETTINGS };

document.addEventListener('DOMContentLoaded', async () => {
  await initTheme();
  await initializeSettings();
  setupThemeSelector();
  setupHistoryMode();
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
  updateThemeButtons(currentSettings.theme);
  updateHistoryButtons(currentSettings.keepHistory);
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

function setupThemeSelector(): void {
  const selector = document.getElementById('theme-selector');
  if (!selector) return;

  const buttons = Array.from(selector.querySelectorAll<HTMLButtonElement>('.theme-option'));
  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const theme = button.dataset.theme as ThemeMode;
      if (!theme) return;
      applyTheme(theme);
      commit({ theme });
    });

    button.addEventListener('keydown', (event) => {
      const index = buttons.indexOf(button);
      let next = index;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length;
      else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % buttons.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = buttons.length - 1;
      else return;

      event.preventDefault();
      buttons[next].click();
      buttons[next].focus();
    });
  });
}

function updateThemeButtons(theme: ThemeMode): void {
  document.querySelectorAll<HTMLButtonElement>('.theme-option').forEach((button) => {
    const selected = button.dataset.theme === theme;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-checked', String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
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
