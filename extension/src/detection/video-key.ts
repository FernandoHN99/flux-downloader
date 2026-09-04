/**
 * Signed CDN links carry rotating tokens, so the same video comes back with a
 * different query string on every visit. Identity is the path, not the token.
 *
 * The popup and the background both key videos this way and must agree, so
 * this lives in one place rather than being copied into each.
 */

/**
 * Query parameters that identify *which* video a URL points at, for hosts that
 * put the id in the query string instead of the path. Dropping these would
 * collapse every video on the host into one entry — every YouTube watch URL is
 * `/watch`, and only `?v=` tells them apart.
 */
const IDENTITY_PARAMS: Record<string, readonly string[]> = {
  'youtube.com': ['v', 'list'],
  'www.youtube.com': ['v', 'list'],
  'm.youtube.com': ['v', 'list'],
  'youtube-nocookie.com': ['v', 'list'],
  'www.youtube-nocookie.com': ['v', 'list']
};

export function videoKey(url: string): string {
  try {
    const parsed = new URL(url);
    const identity = IDENTITY_PARAMS[parsed.hostname];
    if (!identity) return `${parsed.origin}${parsed.pathname}`;

    // Sorted so the same params in a different order still key the same.
    const kept = identity
      .map((name) => [name, parsed.searchParams.get(name)] as const)
      .filter((pair): pair is readonly [string, string] => pair[1] !== null)
      .map(([name, value]) => `${name}=${value}`)
      .sort();
    const suffix = kept.length > 0 ? `?${kept.join('&')}` : '';
    return `${parsed.origin}${parsed.pathname}${suffix}`;
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
