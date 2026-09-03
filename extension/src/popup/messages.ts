// The popup's half of the port protocol, in one place so the message names
// are not scattered as string literals across the UI.

import type { PopupMessage, PopupRequest } from '../lib/popup-protocol';

export type Incoming = PopupMessage;
export type Outgoing = PopupRequest;
export type { OutgoingVideo } from '../lib/popup-protocol';

/**
 * A typed wrapper over the port. It stays usable after a disconnect —
 * Chrome shuts the service worker down while the popup is open, and a send
 * that throws must not take the UI down with it.
 */
export class Messenger {
  private port: chrome.runtime.Port | null = null;

  constructor(private readonly onMessage: (message: Incoming) => void) {}

  connect(): void {
    this.port = chrome.runtime.connect({ name: 'popup' });
    this.port.onMessage.addListener((message) => this.onMessage(message as Incoming));
    this.port.onDisconnect.addListener(() => { this.port = null; });
  }

  send(message: Outgoing): boolean {
    if (!this.port) return false;
    try {
      this.port.postMessage(message);
      return true;
    } catch {
      // The worker went away mid-send; the next open reconnects.
      this.port = null;
      return false;
    }
  }

  get connected(): boolean {
    return this.port !== null;
  }
}
