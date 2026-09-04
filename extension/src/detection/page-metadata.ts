import { titleFromMediaUrl } from './media-title';

const THUMBNAIL_META_SELECTORS = [
  'meta[property="og:image"]',
  'meta[property="og:image:secure_url"]',
  'meta[name="twitter:image"]',
  'meta[property="twitter:image"]',
  'meta[name="twitter:image:src"]',
  'meta[itemprop="thumbnailUrl"]',
  'meta[itemprop="image"]'
];

const THUMBNAIL_IMAGE_SELECTOR =
  'img[class*="poster" i], img[class*="preview" i], img[class*="thumb" i], ' +
  'img[alt*="poster" i], img[alt*="постер" i]';

export interface ContentPageMetadata {
  title: string;
  thumbnail?: string;
  duration?: number;
  pageUrl: string;
  generation: number;
}

export function pageTitle(document: Document): string {
  const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
  if (ogTitle) return ogTitle;

  const twitterTitle = document.querySelector('meta[name="twitter:title"]')?.getAttribute('content');
  if (twitterTitle) return twitterTitle;

  return document.title || 'Unknown Video';
}

export function detectedTitle(document: Document, mediaUrl?: string): string {
  return (mediaUrl && titleFromMediaUrl(mediaUrl)) || pageTitle(document);
}

export function pageDuration(document: Document): number | undefined {
  const duration = Number(document.querySelector('video')?.duration);
  return Number.isFinite(duration) && duration > 0 ? duration : undefined;
}

export function normalizeImageUrl(
  value: string | null | undefined,
  pageUrl: string
): string | undefined {
  const url = value?.trim();
  if (!url || /^data:image\/gif/i.test(url)) return undefined;
  try {
    return new URL(url, pageUrl).href;
  } catch {
    return undefined;
  }
}

export function pageThumbnail(document: Document, pageUrl: string): string | undefined {
  for (const selector of THUMBNAIL_META_SELECTORS) {
    const image = normalizeImageUrl(document.querySelector(selector)?.getAttribute('content'), pageUrl);
    if (image) return image;
  }

  const poster = normalizeImageUrl(
    document.querySelector('video[poster]')?.getAttribute('poster'),
    pageUrl
  );
  if (poster) return poster;

  const image = document.querySelector(THUMBNAIL_IMAGE_SELECTOR) as HTMLImageElement | null;
  if (!image) return undefined;
  return normalizeImageUrl(
    image.currentSrc ||
      image.getAttribute('src') ||
      image.getAttribute('data-src') ||
      image.getAttribute('data-original'),
    pageUrl
  );
}

export function collectPageMetadata(
  document: Document,
  pageUrl: string,
  generation: number
): ContentPageMetadata {
  return {
    title: pageTitle(document),
    thumbnail: pageThumbnail(document, pageUrl),
    duration: pageDuration(document),
    pageUrl,
    generation
  };
}
