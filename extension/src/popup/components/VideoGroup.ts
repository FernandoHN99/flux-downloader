import { Component } from './base';
import { downloadIcon } from './icons';

export interface VideoGroupState {
  domain: string;
  count: number;
  /** A page on this site, used to look its icon up. */
  pageUrl: string;
  collapsed: boolean;
  /** No downloading while a run is going or rows are being picked. */
  downloadDisabled: boolean;
}

export interface VideoGroupHandlers {
  onToggle(domain: string): void;
  onDownloadAll(domain: string): void;
}

/**
 * The folder heading one site's videos sit under. Its icon is the site's
 * favicon until pointed at, when it offers to download everything below it.
 */
export class VideoGroup extends Component<VideoGroupState> {
  /** Where this group's rows go. Kept across redraws of the heading. */
  readonly body: HTMLElement;
  private readonly head: HTMLElement;

  constructor(state: VideoGroupState, private readonly handlers: VideoGroupHandlers) {
    super({ className: 'media-group', state });
    this.head = document.createElement('div');
    this.head.className = 'group-head';
    this.head.setAttribute('role', 'button');
    this.head.tabIndex = 0;
    this.head.addEventListener('click', () => this.handlers.onToggle(this.state.domain));
    this.head.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      this.handlers.onToggle(this.state.domain);
    });

    this.body = document.createElement('div');
    this.body.className = 'group-body';
    this.el.append(this.head, this.body);
  }

  protected render(): void {
    const { domain, count, collapsed, downloadDisabled } = this.state;
    this.el.dataset.domain = domain;
    this.head.setAttribute('aria-expanded', String(!collapsed));
    this.head.replaceChildren();

    const icon = document.createElement('button');
    icon.className = 'group-icon';
    icon.title = `Download all ${count} from ${domain}`;
    icon.setAttribute('aria-label', icon.title);
    icon.disabled = downloadDisabled;
    icon.addEventListener('click', (event) => {
      event.stopPropagation();
      if (icon.disabled) return;
      this.handlers.onDownloadAll(domain);
    });

    const favicon = document.createElement('img');
    favicon.className = 'group-favicon';
    favicon.alt = '';
    favicon.src = faviconUrl(this.state.pageUrl);
    favicon.addEventListener('error', () => favicon.classList.add('hidden'));

    const folder = document.createElement('span');
    folder.className = 'group-folder';
    folder.setAttribute('aria-hidden', 'true');

    icon.append(favicon, folder, downloadIcon());
    this.head.appendChild(icon);

    const name = document.createElement('span');
    name.className = 'group-name';
    name.textContent = domain;

    const badge = document.createElement('span');
    badge.className = 'group-count';
    badge.textContent = String(count);

    const chevron = document.createElement('span');
    chevron.className = collapsed ? 'group-chevron' : 'group-chevron open';
    chevron.setAttribute('aria-hidden', 'true');

    this.head.append(name, badge, chevron);
    this.body.hidden = collapsed;
  }
}

/** Chrome's own favicon store — no request leaves the browser for an icon. */
export function faviconUrl(pageUrl: string): string {
  const url = new URL(chrome.runtime.getURL('/_favicon/'));
  url.searchParams.set('pageUrl', pageUrl);
  url.searchParams.set('size', '32');
  return url.toString();
}
