export type DownloadRunKind = 'single' | 'batch';

export interface DownloadLease {
  readonly kind: DownloadRunKind;
}

/** A synchronous, owner-checked lease for the single native download slot. */
export class DownloadRunGate {
  private current: DownloadLease | null = null;

  acquire(kind: DownloadRunKind): DownloadLease | null {
    if (this.current) return null;
    const lease = Object.freeze({ kind });
    this.current = lease;
    return lease;
  }

  release(lease: DownloadLease): boolean {
    if (this.current !== lease) return false;
    this.current = null;
    return true;
  }

  owns(lease: DownloadLease): boolean {
    return this.current === lease;
  }

  get busy(): boolean {
    return this.current !== null;
  }
}
