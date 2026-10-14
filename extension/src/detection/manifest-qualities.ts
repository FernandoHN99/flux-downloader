import type { ParsedDash } from './dash-parser';
import { getFfmpegHttpArgs } from './http-media';
import type { MediaRendition, ParsedM3U8 } from './m3u8-parser';
import type { VideoQuality } from '../shared/types';

function renditionType(rendition: MediaRendition): string {
  return rendition.type.toUpperCase();
}

function renditionLabel(rendition: MediaRendition, prefix: string): string {
  const parts = [prefix];
  if (rendition.name) parts.push(rendition.name);
  else if (rendition.language) parts.push(rendition.language);
  return parts.join(' — ');
}

function variantLabel(name: string | undefined, height: number | undefined): string {
  return name || (height ? `${height}p` : 'Video');
}

const DURATION_PROBE_LIMIT = 3;

/**
 * The length of a video whose master playlist does not state one: ask a media
 * playlist. The last rendition goes first, because the first is the one a
 * master can list without serving (a 4K that was never encoded answers 404),
 * and a failure there used to leave every lesson without a length. Gives up
 * after a few tries; the renditions are all the same video.
 */
export async function firstKnownDuration(
  urls: readonly string[],
  load: (url: string) => Promise<number | undefined>
): Promise<number | undefined> {
  for (const url of [...urls].reverse().slice(0, DURATION_PROBE_LIMIT)) {
    try {
      const seconds = await load(url);
      if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) return seconds;
    } catch {
      // A rendition that cannot be read says nothing about the others.
    }
  }
  return undefined;
}

/**
 * Project a parsed HLS manifest into the choices shown by the popup and sent
 * to FFmpeg. Fetching the master/media playlists remains a background concern.
 */
export function buildHlsQualities(
  parsed: ParsedM3U8,
  referer?: string
): VideoQuality[] {
  const qualities: VideoQuality[] = [];
  const renditions = parsed.mediaRenditions || [];
  const audioRenditions = renditions.filter((item) => renditionType(item) === 'AUDIO');
  const activeRenditionGroups = new Set(
    parsed.variants
      .flatMap((variant) => [variant.audioGroupId, variant.subtitleGroupId])
      .filter((groupId): groupId is string => Boolean(groupId))
  );

  for (const variant of parsed.variants) {
    const matchingAudio = audioRenditions
      .filter((item) => item.groupId === variant.audioGroupId && item.uri)
      .sort((a, b) =>
        Number(Boolean(b.default)) - Number(Boolean(a.default)) ||
        Number(Boolean(b.autoselect)) - Number(Boolean(a.autoselect))
      );

    if (matchingAudio.length === 0) {
      qualities.push({
        height: variant.height || 0,
        width: variant.width,
        bitrate: variant.bandwidth,
        url: variant.url,
        label: variantLabel(variant.name, variant.height),
        kind: 'video'
      });
      continue;
    }

    for (const audio of matchingAudio) {
      const audioLabel = audio.name || audio.language || 'Audio';
      qualities.push({
        height: variant.height || 0,
        width: variant.width,
        bitrate: variant.bandwidth,
        url: variant.url,
        label: `${variantLabel(variant.name, variant.height)} - ${audioLabel}`,
        kind: 'video',
        language: audio.language,
        formatArgs: [
          ...getFfmpegHttpArgs(referer),
          '-i', variant.url,
          ...getFfmpegHttpArgs(referer),
          '-i', audio.uri!,
          '-map', '0:v:0',
          '-map', '1:a:0',
          '-c', 'copy'
        ]
      });
    }
  }

  for (const rendition of renditions) {
    const type = renditionType(rendition);
    if (!rendition.uri || type === 'CLOSED-CAPTIONS') continue;
    if (rendition.groupId && !activeRenditionGroups.has(rendition.groupId)) continue;

    if (type === 'AUDIO') {
      qualities.push({
        height: 0,
        url: rendition.uri,
        bitrate: 0,
        label: renditionLabel(rendition, 'Audio'),
        kind: 'audio',
        language: rendition.language
      });
    } else if (type === 'SUBTITLES') {
      qualities.push({
        height: 0,
        url: rendition.uri,
        bitrate: 0,
        label: renditionLabel(rendition, 'Subtitles'),
        kind: 'subtitle',
        language: rendition.language
      });
    }
  }

  return qualities;
}

/** Project parsed DASH video and subtitle tracks into popup choices. */
export function buildDashQualities(parsed: ParsedDash): VideoQuality[] {
  const qualities: VideoQuality[] = parsed.variants.map((variant) => ({
    height: variant.height || 0,
    width: variant.width,
    bitrate: variant.bandwidth,
    url: variant.url,
    label: variant.name,
    kind: 'video'
  }));

  for (const subtitle of parsed.subtitleTracks || []) {
    const labelParts = ['Subtitles'];
    if (subtitle.lang) labelParts.push(subtitle.lang);
    qualities.push({
      height: 0,
      url: subtitle.url,
      bitrate: 0,
      label: labelParts.join(' — '),
      kind: 'subtitle',
      language: subtitle.lang
    });
  }

  return qualities;
}
