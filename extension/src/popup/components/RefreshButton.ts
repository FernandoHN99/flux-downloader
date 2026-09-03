import { Component } from './base';
import { refreshIcon } from './icons';

export interface RefreshButtonState {
  refreshing: boolean;
}

/** Always-visible entry point for rescanning every open tab. */
export class RefreshButton extends Component<RefreshButtonState> {
  constructor(state: RefreshButtonState, private readonly onRefresh: () => void) {
    super({ tag: 'button', className: 'refresh-tabs-btn', state });
    this.el.id = 'refresh-tabs-btn';
    this.el.setAttribute('type', 'button');
    this.el.addEventListener('click', () => {
      if ((this.el as HTMLButtonElement).disabled) return;
      this.onRefresh();
    });
  }

  protected render(): void {
    const button = this.el as HTMLButtonElement;
    button.disabled = this.state.refreshing;
    button.classList.toggle('refreshing', this.state.refreshing);
    button.setAttribute('aria-label', this.state.refreshing
      ? 'Refreshing media from open tabs'
      : 'Refresh media from all open tabs');
    button.title = button.getAttribute('aria-label')!;

    const label = document.createElement('span');
    label.textContent = this.state.refreshing ? 'Refreshing…' : 'Refresh tabs';
    button.replaceChildren(refreshIcon(), label);
  }
}
