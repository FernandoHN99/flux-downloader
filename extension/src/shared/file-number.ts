/**
 * `01-` for the first of a course, padded to the width of the total (two digits
 * at least) so a file manager sorts the names as the course runs. Empty when
 * there is only one video: nothing needs ordering.
 *
 * Shared because two places name a file this way and must agree: a batch
 * (`download/download-plan.ts`) and a video downloaded on its own
 * (`popup/selectors.ts`), so a lesson has the same number either way.
 */
export function numberPrefix(position: number, total: number): string {
  if (total < 2) return '';
  const width = Math.max(2, String(total).length);
  return `${String(position).padStart(width, '0')}-`;
}
