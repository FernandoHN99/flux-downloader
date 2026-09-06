export type ProcessDownloadType = 'convert' | 'ytdlp';

/** Collision-safe logical keys for process downloads started in one worker. */
export class ProcessDownloadKeyFactory {
  private sequence = 0;

  constructor(private readonly now: () => number = Date.now) {}

  next(type: ProcessDownloadType): string {
    this.sequence += 1;
    return `${type}_${this.now()}_${this.sequence}`;
  }
}
