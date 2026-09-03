/**
 * Signed CDN links carry rotating tokens, so the same video comes back with a
 * different query string on every visit. Identity is the path, not the token.
 *
 * The popup and the background both key videos this way and must agree, so
 * this lives in one place rather than being copied into each.
 */
export function videoKey(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

/** The site a video was found on, as shown on a group folder. */
export function domainOf(pageUrl: string | undefined, fallbackUrl: string): string {
  try {
    // blob: and data: URLs parse fine but carry no host, which would make a
    // folder with an empty name.
    const host = new URL(pageUrl || fallbackUrl).hostname.replace(/^www\./, '');
    return host || 'Other';
  } catch {
    return 'Other';
  }
}
