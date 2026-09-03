import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VideoInfo } from '../../lib/types';
import { QualityPanel } from './QualityPanel';

const video = (patch: Partial<VideoInfo> = {}): VideoInfo => ({
  id: 'v1', title: 'aula', url: 'https://cdn.x/a.m3u8', type: 'hls',
  qualities: [
    { height: 1080, width: 1920, bitrate: 2_800_000, url: 'a' },
    { height: 720, width: 1280, bitrate: 1_400_000, url: 'b' },
    { height: 480, width: 854, bitrate: 700_000, url: 'c' }
  ],
  ...patch
}) as VideoInfo;

function mount(state: Partial<Parameters<typeof QualityPanel.prototype.setState>[0]> = {}) {
  const handlers = { onSelect: vi.fn(), onDownload: vi.fn() };
  const panel = new QualityPanel(
    { video: video(), selectedIndex: 0, downloadDisabled: false, ...state } as never,
    handlers
  );
  document.body.appendChild(panel.el);
  panel.update();
  return { panel, handlers };
}

const shortcut = (panel: QualityPanel, which: string) =>
  panel.el.querySelector<HTMLButtonElement>(`.quick-btn[data-quality="${which}"]`)!;
const options = (panel: QualityPanel) => [...panel.el.querySelectorAll('.quality-option')];
const downloadBtn = (panel: QualityPanel) =>
  panel.el.querySelector<HTMLButtonElement>('.expand-download-btn')!;

describe('QualityPanel', () => {
  beforeEach(() => document.body.replaceChildren());

  it('lists every rendition with its details', () => {
    const { panel } = mount();
    expect(options(panel)).toHaveLength(3);
    expect(options(panel)[0].querySelector('.quality-label')!.textContent).toBe('1080p');
    expect(options(panel)[0].textContent).toContain('1920x1080');
    expect(options(panel)[0].textContent).toContain('2.8 Mbps');
  });

  // The bug: selection was applied by querying the document before the panel
  // was attached, so nothing came out selected.
  it('marks the selected option even on its very first paint', () => {
    const { panel } = mount({ selectedIndex: 0 });
    expect(options(panel)[0].classList.contains('selected')).toBe(true);
    expect(options(panel)[0].querySelector<HTMLInputElement>('input')!.checked).toBe(true);
  });

  it('never reaches outside itself for options', () => {
    const stray = document.createElement('label');
    stray.className = 'quality-option';
    document.body.appendChild(stray);

    const { panel } = mount({ selectedIndex: 1 });
    expect(stray.classList.contains('selected')).toBe(false);
    expect(options(panel)[1].classList.contains('selected')).toBe(true);
  });

  it('lights Best on the top rendition and Lowest on the bottom', () => {
    const { panel } = mount({ selectedIndex: 0 });
    expect(shortcut(panel, 'best').classList.contains('selected')).toBe(true);
    expect(shortcut(panel, 'worst').classList.contains('selected')).toBe(false);

    panel.setState({ selectedIndex: 2 });
    expect(shortcut(panel, 'best').classList.contains('selected')).toBe(false);
    expect(shortcut(panel, 'worst').classList.contains('selected')).toBe(true);
  });

  it('lights neither when a middle quality is chosen', () => {
    const { panel } = mount({ selectedIndex: 1 });
    expect(shortcut(panel, 'best').classList.contains('selected')).toBe(false);
    expect(shortcut(panel, 'worst').classList.contains('selected')).toBe(false);
  });

  it('asks for the lowest video index when Lowest is pressed', () => {
    const { panel, handlers } = mount();
    shortcut(panel, 'worst').click();
    expect(handlers.onSelect).toHaveBeenCalledWith(2);
  });

  it('reports the option that was clicked', () => {
    const { panel, handlers } = mount();
    (options(panel)[1] as HTMLElement).click();
    expect(handlers.onSelect).toHaveBeenCalledWith(1);
  });

  it('hands the chosen option to the download handler', () => {
    const { panel, handlers } = mount({ selectedIndex: 2 });
    downloadBtn(panel).click();
    expect(handlers.onDownload).toHaveBeenCalledWith(expect.objectContaining({ label: '480p' }));
  });

  // The bug: the button was disabled by its owner, then re-enabled a line
  // later by the function that filled the list.
  it('stays disabled while another run holds the CoApp', () => {
    const { panel, handlers } = mount({ downloadDisabled: true });
    expect(downloadBtn(panel).disabled).toBe(true);
    downloadBtn(panel).click();
    expect(handlers.onDownload).not.toHaveBeenCalled();
  });

  it('re-enables once the other run finishes', () => {
    const { panel } = mount({ downloadDisabled: true });
    panel.setState({ downloadDisabled: false });
    expect(downloadBtn(panel).disabled).toBe(false);
  });

  it('waits for YouTube formats instead of offering the watch page', () => {
    const { panel } = mount({ video: video({ type: 'ytdlp', qualities: [] }) });
    expect(panel.el.querySelector('.no-quality')!.textContent).toContain('Loading YouTube');
    expect(downloadBtn(panel).disabled).toBe(true);
  });

  it('moves the selection with the arrow keys and wraps around', () => {
    const { panel, handlers } = mount({ selectedIndex: 0 });
    const radio = options(panel)[0].querySelector('input')!;
    radio.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(handlers.onSelect).toHaveBeenLastCalledWith(1);

    const last = options(panel)[0].querySelector('input')!;
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(handlers.onSelect).toHaveBeenLastCalledWith(2);
  });

  it('keeps keyboard focus on the option list across a redraw', () => {
    const { panel } = mount({ selectedIndex: 0 });
    const radio = options(panel)[1].querySelector<HTMLInputElement>('input')!;
    radio.focus();
    expect(document.activeElement).toBe(radio);

    panel.setState({ selectedIndex: 1 });

    expect((document.activeElement as HTMLElement).dataset.focusId).toBe('quality-1');
  });

  it('does not let a click inside it reach the row behind', () => {
    const row = document.createElement('div');
    const onRowClick = vi.fn();
    row.addEventListener('click', onRowClick);
    document.body.appendChild(row);

    const { panel } = mount();
    row.appendChild(panel.el);
    (options(panel)[0] as HTMLElement).click();

    expect(onRowClick).not.toHaveBeenCalled();
  });
});
