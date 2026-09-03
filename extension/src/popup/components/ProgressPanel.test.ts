import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProgressPanel, type ProgressPanelState } from './ProgressPanel';

function mount(state: Partial<ProgressPanelState> = {}) {
  const onStop = vi.fn();
  const panel = new ProgressPanel({ view: null, detail: null, ...state }, onStop);
  document.body.appendChild(panel.el);
  panel.update();
  return { panel, onStop };
}

const label = (p: ProgressPanel) => p.el.querySelector('.progress-filename')?.textContent;
const percent = (p: ProgressPanel) => p.el.querySelector('.progress-percent')?.textContent;
const fill = (p: ProgressPanel) => p.el.querySelector<HTMLElement>('#progress-fill')!;
const speed = (p: ProgressPanel) => p.el.querySelector('.progress-speed')?.textContent;
const eta = (p: ProgressPanel) => p.el.querySelector('.progress-eta')?.textContent;

describe('ProgressPanel', () => {
  beforeEach(() => document.body.replaceChildren());

  it('stays hidden while nothing is downloading', () => {
    const { panel } = mount();
    expect(panel.el.classList.contains('hidden')).toBe(true);
    expect(panel.el.children).toHaveLength(0);
  });

  it('counts the video being fetched, not the ones finished', () => {
    const { panel } = mount({ view: { current: 1, total: 4, kind: 'batch' }, detail: { percent: 38 } });
    expect(panel.el.classList.contains('hidden')).toBe(false);
    expect(label(panel)).toBe('Downloading 1/4');
    expect(percent(panel)).toBe('38%');
  });

  it('shows a one-off download as 1/1', () => {
    const { panel } = mount({ view: { current: 1, total: 1, kind: 'single' }, detail: { percent: 22 } });
    expect(label(panel)).toBe('Downloading 1/1');
  });

  it('fills the bar to the reported percentage', () => {
    const { panel } = mount({ view: { current: 2, total: 4, kind: 'batch' }, detail: { percent: 37.6 } });
    expect(fill(panel).style.width).toBe('37.6%');
    expect(fill(panel).getAttribute('aria-valuenow')).toBe('38');
  });

  // A 0% bar reads as "stuck"; nothing has reported yet is a different thing.
  it('runs indeterminate until the first number arrives', () => {
    const { panel } = mount({ view: { current: 1, total: 1, kind: 'single' }, detail: { percent: 0 } });
    expect(fill(panel).classList.contains('indeterminate')).toBe(true);
    expect(percent(panel)).toBe('…');
    expect(fill(panel).hasAttribute('aria-valuenow')).toBe(false);
  });

  it('never lets a bad number escape the bar', () => {
    const { panel } = mount({ view: { current: 1, total: 1, kind: 'single' }, detail: { percent: 240 } });
    expect(fill(panel).style.width).toBe('100%');

    panel.setState({ detail: { percent: NaN } });
    expect(fill(panel).classList.contains('indeterminate')).toBe(true);
  });

  describe('the second line', () => {
    const view = { current: 1, total: 1, kind: 'single' } as const;

    it('shows bytes for a direct download', () => {
      const { panel } = mount({ view, detail: { percent: 50, bytesReceived: 5_200_000, totalBytes: 10_400_000 } });
      expect(speed(panel)).toBe('5.2 / 10.4 MB');
    });

    it('shows a rate when the CoApp reports bytes per second', () => {
      const { panel } = mount({ view, detail: { percent: 50, speed: 1_450_000 } });
      expect(speed(panel)).toBe('1.4 MB/s');
    });

    // ffmpeg reports "1.5x", which is a remux rate, not a download speed.
    it('calls an ffmpeg rate processing, not speed', () => {
      const { panel } = mount({ view, detail: { percent: 50, speed: '1.5x' } });
      expect(speed(panel)).toBe('Processing: 1.5x');
    });

    it('shows the estimate when there is one', () => {
      const { panel } = mount({ view, detail: { percent: 50, eta: 92 } });
      expect(eta(panel)).toBe('1:32');
    });

    it('stays quiet when there is nothing to say', () => {
      const { panel } = mount({ view, detail: { percent: 10 } });
      expect(speed(panel)).toBe('');
      expect(eta(panel)).toBe('');
    });
  });

  it('reports Stop, whichever kind of run is showing', () => {
    const { panel, onStop } = mount({ view: { current: 1, total: 4, kind: 'batch' }, detail: null });
    panel.el.querySelector<HTMLButtonElement>('.btn-cancel')!.click();
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('hides again when the run ends', () => {
    const { panel } = mount({ view: { current: 1, total: 1, kind: 'single' }, detail: { percent: 50 } });
    panel.setState({ view: null });
    expect(panel.el.classList.contains('hidden')).toBe(true);
  });
});
