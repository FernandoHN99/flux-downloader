import { formatETA, formatSpeed } from '../format';
import type { ProgressDetail } from '../state';
import type { ProgressView } from '../selectors';
import { Component } from './base';

export interface ProgressPanelState {
  view: ProgressView | null;
  detail: ProgressDetail | null;
}

/**
 * One panel for both kinds of run. A batch counts through its queue, a
 * one-off download counts 1 / 1 — where the number never moves, so the
 * percentage is what shows progress.
 */
export class ProgressPanel extends Component<ProgressPanelState> {
  constructor(state: ProgressPanelState, private readonly onStop: () => void) {
    super({ className: 'download-progress hidden', state });
    this.el.id = 'download-progress';
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
  }

  protected render(): void {
    const { view, detail } = this.state;
    this.el.classList.toggle('hidden', view === null);
    this.el.replaceChildren();
    if (!view) return;

    const percent = clampPercent(detail?.percent);
    const measured = percent > 0;

    const header = document.createElement('div');
    header.className = 'progress-header';
    header.append(
      text('span', 'progress-filename', `Downloading ${view.current}/${view.total}`),
      text('span', 'progress-percent', measured ? `${Math.round(percent)}%` : '…')
    );

    const track = document.createElement('div');
    track.className = 'progress-bar';
    const fill = document.createElement('div');
    fill.id = 'progress-fill';
    fill.setAttribute('role', 'progressbar');
    fill.setAttribute('aria-label', 'Download progress');
    fill.setAttribute('aria-valuemin', '0');
    fill.setAttribute('aria-valuemax', '100');
    if (measured) {
      fill.style.width = `${percent}%`;
      fill.setAttribute('aria-valuenow', String(Math.round(percent)));
      fill.setAttribute('aria-valuetext', `${Math.round(percent)}%`);
    } else {
      // Nothing has reported yet; a moving bar is honest, a 0% one is not.
      fill.classList.add('indeterminate');
      fill.style.width = '35%';
      fill.setAttribute('aria-valuetext', 'Downloading…');
    }
    track.appendChild(fill);

    const info = document.createElement('div');
    info.className = 'progress-info';
    const stop = document.createElement('button');
    stop.className = 'btn btn-cancel';
    stop.textContent = 'Stop';
    stop.addEventListener('click', () => this.onStop());
    info.append(
      text('span', 'progress-speed', describeSpeed(detail)),
      text('span', 'progress-eta', detail?.eta ? formatETA(detail.eta) : ''),
      stop
    );

    this.el.append(header, track, info);
  }
}

function clampPercent(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/**
 * The CoApp reports bytes for a direct download and an ffmpeg rate like
 * "1.5x" while remuxing, which are different things and read differently.
 */
function describeSpeed(detail: ProgressDetail | null): string {
  if (!detail) return '';
  if (detail.bytesReceived !== undefined && (detail.totalBytes ?? 0) > 0) {
    const mb = (n: number) => (n / 1_000_000).toFixed(1);
    return `${mb(detail.bytesReceived)} / ${mb(detail.totalBytes!)} MB`;
  }
  if (typeof detail.speed === 'string' && detail.speed.trim()) {
    const label = detail.speed.trim().toLowerCase().endsWith('x') ? 'Processing' : 'Speed';
    return `${label}: ${detail.speed}`;
  }
  if (typeof detail.speed === 'number' && detail.speed > 0) return formatSpeed(detail.speed);
  return '';
}

function text(tag: string, className: string, content: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  el.id = className;
  el.textContent = content;
  return el;
}
