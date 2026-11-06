export type DownloadRunKind = 'single' | 'batch';

export interface DownloadLease {
  readonly kind: DownloadRunKind;
  /** The videos this run was started for. They cannot be edited until it ends. */
  readonly keys: ReadonlySet<string>;
}

const NO_KEYS: ReadonlySet<string> = new Set();

/** A synchronous, owner-checked lease for one user-visible download run. */
export class DownloadRunGate {
  private current: DownloadLease | null = null;

  /** Told whenever a run starts or ends, so something can show that one is going. */
  constructor(private readonly changed: () => void = () => {}) {}

  acquire(kind: DownloadRunKind, keys: Iterable<string> = []): DownloadLease | null {
    if (this.current) return null;
    const lease = Object.freeze({ kind, keys: new Set(keys) });
    this.current = lease;
    this.changed();
    return lease;
  }

  release(lease: DownloadLease): boolean {
    if (this.current !== lease) return false;
    this.current = null;
    this.changed();
    return true;
  }

  owns(lease: DownloadLease): boolean {
    return this.current === lease;
  }

  get busy(): boolean {
    return this.current !== null;
  }

  /** The videos of the run in flight: what the user may not edit right now. */
  get lockedKeys(): ReadonlySet<string> {
    return this.current?.keys ?? NO_KEYS;
  }
}
