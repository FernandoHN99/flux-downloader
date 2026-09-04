// Error types for Flux Downloader extension

export class CoAppError extends Error {
  constructor(
    message: string,
    public code: string,
    public recoverable: boolean = true
  ) {
    super(message);
    this.name = 'CoAppError';
  }
}

export class ConnectionError extends CoAppError {
  constructor(message: string = 'Failed to connect to CoApp') {
    super(message, 'CONNECTION_ERROR', true);
  }
}

export class TimeoutError extends CoAppError {
  constructor(method: string, timeout: number = 60000) {
    super(`Method '${method}' timed out after ${timeout}ms`, 'TIMEOUT', true);
    this.name = 'TimeoutError';
  }
}

export class MethodError extends CoAppError {
  constructor(message: string, public method?: string) {
    super(message, 'METHOD_ERROR', false);
    this.name = 'MethodError';
  }
}

export class FFmpegError extends CoAppError {
  constructor(message: string, public exitCode?: number) {
    super(message, 'FFMPEG_ERROR', false);
    this.name = 'FFmpegError';
  }
}

export class DownloadError extends CoAppError {
  constructor(message: string, public downloadId?: string) {
    super(message, 'DOWNLOAD_ERROR', true);
    this.name = 'DownloadError';
  }
}

// Error codes for easy checking
export const ErrorCodes = {
  CONNECTION_ERROR: 'CONNECTION_ERROR',
  TIMEOUT: 'TIMEOUT',
  METHOD_ERROR: 'METHOD_ERROR',
  FFMPEG_ERROR: 'FFMPEG_ERROR',
  DOWNLOAD_ERROR: 'DOWNLOAD_ERROR'
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];
/**
 * Chrome reports a missing or unreachable native host through the generic
 * runtime error channel, so the text surfaces verbatim in whatever operation
 * happened to need the CoApp first — "Could not create Flux_1788…: Specified
 * native messaging host not found" names the folder, not the actual problem.
 * This maps those messages to something the user can act on.
 */
const NATIVE_HOST_FAILURES: ReadonlyArray<[RegExp, string]> = [
  [
    /host not found|not found\.?$/i,
    'Flux Downloader’s companion app is not installed or not registered with this browser. Install it, then reload the extension.'
  ],
  [
    /forbidden|not allowed/i,
    'This browser is not allowed to reach the companion app. Re-register it for this extension ID, then reload the extension.'
  ],
  [
    /native host has exited|disconnected|communicating with the native/i,
    'The companion app stopped responding. Reload the extension to reconnect; if it keeps happening, reinstall it.'
  ]
];

/**
 * Returns a message worth showing the user. Failures to reach the CoApp are
 * rewritten; everything else is passed through, since those messages describe
 * the operation that actually failed.
 */
export function describeCoAppError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  for (const [pattern, message] of NATIVE_HOST_FAILURES) {
    if (pattern.test(raw)) return message;
  }
  return raw || 'Something went wrong.';
}

/** True when the failure is the CoApp being unreachable, not the work itself. */
export function isCoAppUnreachable(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  return NATIVE_HOST_FAILURES.some(([pattern]) => pattern.test(raw));
}
