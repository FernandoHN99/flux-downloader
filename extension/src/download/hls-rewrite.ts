export interface HlsManifestRewrite {
  content: string;
  rewrittenCount: number;
  unresolvedUrls: string[];
}

function absoluteManifestUrl(value: string, manifestUrl: string): string {
  try {
    return new URL(value, manifestUrl).href;
  } catch {
    return value;
  }
}

/**
 * Replace every media URI in an HLS media playlist with its browser-relay
 * equivalent. The caller decides whether a partial mapping is acceptable.
 */
export function rewriteHlsManifestUris(
  manifest: string,
  manifestUrl: string,
  relayForUrl: (absoluteUrl: string) => string | undefined
): HlsManifestRewrite {
  let rewrittenCount = 0;
  const unresolvedUrls = new Set<string>();

  const rewriteUri = (value: string): string => {
    const absoluteUrl = absoluteManifestUrl(value, manifestUrl);
    const relayUrl = relayForUrl(absoluteUrl);
    if (!relayUrl) {
      unresolvedUrls.add(absoluteUrl);
      return value;
    }
    rewrittenCount += 1;
    return relayUrl;
  };

  const lines = manifest.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith('#')) {
      return line.replace(/URI="([^"]+)"/g, (_match, uri: string) =>
        `URI="${rewriteUri(uri)}"`
      );
    }
    return line.replace(trimmed, rewriteUri(trimmed));
  });

  return {
    content: lines.join('\n'),
    rewrittenCount,
    unresolvedUrls: [...unresolvedUrls]
  };
}
