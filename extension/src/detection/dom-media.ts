import { isMediaUrl, resolveMediaUrl } from './media-url';

/**
 * Collect normalized media candidates from one DOM subtree. Media and source
 * elements are evidence by themselves; arbitrary `src` attributes still need
 * a recognizable media extension.
 */
export function collectDomMediaUrls(root: ParentNode, pageUrl: string): string[] {
  const elements: Element[] = [];
  if (root instanceof Element) elements.push(root);
  elements.push(...Array.from(root.querySelectorAll('video, audio, [src]')));

  const urls = new Set<string>();
  const add = (value: string | null | undefined, mediaElementEvidence: boolean): void => {
    if (!value) return;
    if (!mediaElementEvidence && !isMediaUrl(value, pageUrl)) return;
    const normalized = resolveMediaUrl(value, pageUrl);
    if (normalized) urls.add(normalized);
  };

  for (const element of elements) {
    if (element instanceof HTMLMediaElement) {
      const declaredSrc = element.getAttribute('src');
      if (declaredSrc) add(declaredSrc, true);
      else if (!element.querySelector('source[src]')) add(element.currentSrc || element.src, true);
      continue;
    }

    const src = element.getAttribute('src');
    add(src, element instanceof HTMLSourceElement);
  }

  return [...urls];
}
