import type { VideoInfo } from '../../lib/types';
import { activeShortcut, buildQualityOptions, lowestQualityIndex, type QualityOption } from '../quality';
import { Component } from './base';

export interface QualityPanelState {
  video: VideoInfo;
  selectedIndex: number;
  /** A run already in flight owns the CoApp, so this row cannot start one. */
  downloadDisabled: boolean;
}

export interface QualityPanelHandlers {
  onSelect(index: number): void;
  onDownload(option: QualityOption): void;
}

/**
 * The download options that open under a row.
 *
 * Everything it touches lives inside its own element. The old version read
 * `.quality-option` off the whole document, which silently selected nothing
 * while the panel was still being built, and had its Download button
 * re-enabled by a second function that also thought it owned it.
 */
export class QualityPanel extends Component<QualityPanelState> {
  private options: QualityOption[];

  constructor(state: QualityPanelState, private readonly handlers: QualityPanelHandlers) {
    super({ className: 'media-expand', state });
    this.options = buildQualityOptions(state.video);
    // Choosing a quality is not a click on the row behind it.
    this.el.addEventListener('click', (event) => event.stopPropagation());
  }

  get qualities(): QualityOption[] {
    return this.options;
  }

  protected render(): void {
    this.options = buildQualityOptions(this.state.video);
    this.el.replaceChildren();

    const list = document.createElement('div');
    list.className = 'quality-list';
    this.el.appendChild(list);

    const download = document.createElement('button');
    download.className = 'btn btn-primary expand-download-btn';
    download.textContent = 'Download';
    download.disabled = this.state.downloadDisabled || this.options.length === 0;
    download.addEventListener('click', () => {
      if (download.disabled) return;
      this.handlers.onDownload(this.options[this.state.selectedIndex]);
    });

    if (this.options.length === 0) {
      const loading = document.createElement('p');
      loading.className = 'no-quality';
      loading.textContent = 'Loading YouTube qualities…';
      list.appendChild(loading);
      this.el.appendChild(download);
      return;
    }

    list.appendChild(this.buildShortcuts());
    list.appendChild(this.buildOptions());
    this.el.appendChild(download);
  }

  private buildShortcuts(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'quick-options';
    const lit = activeShortcut(this.options, this.state.selectedIndex);

    for (const [quality, label] of [['best', 'Best'], ['worst', 'Lowest']] as const) {
      const button = document.createElement('button');
      button.className = quality === lit ? 'quick-btn selected' : 'quick-btn';
      button.dataset.quality = quality;
      button.textContent = label;
      button.setAttribute('aria-pressed', String(quality === lit));
      button.addEventListener('click', () => {
        this.handlers.onSelect(quality === 'worst' ? lowestQualityIndex(this.options) : 0);
      });
      row.appendChild(button);
    }
    return row;
  }

  private buildOptions(): HTMLElement {
    const group = document.createElement('div');
    group.className = 'quality-options';
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', 'Quality options');

    this.options.forEach((quality, index) => {
      const selected = index === this.state.selectedIndex;
      const option = document.createElement('label');
      option.className = selected ? 'quality-option selected' : 'quality-option';
      option.dataset.index = String(index);

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'quality';
      radio.value = String(index);
      radio.className = 'quality-radio';
      radio.checked = selected;
      radio.tabIndex = selected ? 0 : -1;
      radio.setAttribute('aria-checked', String(selected));
      // Focus has to survive the redraw a selection triggers, or arrow-key
      // navigation would stop after one step.
      radio.dataset.focusId = `quality-${index}`;
      option.appendChild(radio);

      option.appendChild(span('quality-label', quality.label));

      if (quality.kind === 'audio' || quality.kind === 'subtitle') {
        const isSub = quality.kind === 'subtitle';
        option.appendChild(span(isSub ? 'quality-kind quality-kind-sub' : 'quality-kind',
          isSub ? 'SUB' : 'Audio'));
      }
      if (quality.resolution) option.appendChild(span('quality-bandwidth', quality.resolution));
      option.appendChild(span('quality-bandwidth', quality.bandwidthLabel));
      if (quality.sizeLabel) option.appendChild(span('quality-size', quality.sizeLabel));

      option.addEventListener('click', () => this.handlers.onSelect(index));
      radio.addEventListener('keydown', (event) => this.onKeydown(event, index));

      group.appendChild(option);
    });

    return group;
  }

  private onKeydown(event: KeyboardEvent, index: number): void {
    const last = this.options.length - 1;
    let next = index;
    switch (event.key) {
      case 'ArrowDown': case 'ArrowRight': next = (index + 1) % this.options.length; break;
      case 'ArrowUp': case 'ArrowLeft': next = (index - 1 + this.options.length) % this.options.length; break;
      case 'Home': next = 0; break;
      case 'End': next = last; break;
      case 'Enter': case ' ': event.preventDefault(); this.handlers.onSelect(index); return;
      default: return;
    }
    event.preventDefault();
    this.handlers.onSelect(next);
  }
}

function span(className: string, text: string): HTMLElement {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  return el;
}
