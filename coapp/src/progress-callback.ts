/** Keep the legacy callback prefix stable and append concurrent attribution. */
export function progressCallbackArgs(
  progressTime: number,
  currentSeconds: number,
  info: Record<string, unknown>,
  startHandler: unknown
): [number, number, Record<string, unknown>, unknown] {
  return [progressTime, currentSeconds, info, startHandler ?? null];
}
