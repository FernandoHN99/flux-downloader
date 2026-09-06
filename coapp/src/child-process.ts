import type { ChildProcess } from 'child_process';

export interface ChildSettlement {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
}

/**
 * Attach the process error listener immediately after spawn. Node emits an
 * unhandled `error` event when an executable cannot be found; in a native
 * host that would terminate the entire RPC channel instead of rejecting only
 * the operation that requested the tool.
 */
export function settleChild(child: ChildProcess): Promise<ChildSettlement> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: ChildSettlement): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    child.once('error', (value) => {
      const error = value instanceof Error ? value : new Error(String(value));
      finish({ exitCode: null, signal: null, error });
    });
    child.once('exit', (exitCode, signal) => {
      finish({ exitCode, signal });
    });
  });
}

export function spawnFailure(tool: string, executable: string, error: Error): string {
  return `Could not start ${tool} (${executable}): ${error.message}`;
}
