import { titleFromMediaUrl, titleFromPageUrl } from './media-title';

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

export interface DetectedTitle {
  title: string;
  /** True when the page supplied it, so a later page update may replace it. */
  fromPage: boolean;
}

/**
 * Names a detected video. The media URL wins when it carries a real name; a
 * single-page site that has not set its title yet falls back to the page URL
 * slug, which changes per lesson even when the title lags behind.
 */
export function detectedTitle(
  document: Document,
  mediaUrl?: string,
  pageUrl?: string
): DetectedTitle {
  const fromMedia = mediaUrl ? titleFromMediaUrl(mediaUrl) : null;
  if (fromMedia) return { title: fromMedia, fromPage: false };

  const fromPage = pageTitle(document);
  if (fromPage && fromPage !== 'Unknown Video') return { title: fromPage, fromPage: true };

  const fromUrl = pageUrl ? titleFromPageUrl(pageUrl) : null;
  return { title: fromUrl || fromPage || 'Unknown Video', fromPage: true };
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
