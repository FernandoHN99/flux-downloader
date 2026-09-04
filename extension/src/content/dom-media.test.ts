import { beforeEach, describe, expect, it } from 'vitest';
import { collectDomMediaUrls } from './dom-media';

const PAGE = 'https://course.example/lessons/intro';

describe('collectDomMediaUrls', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('treats video, audio, and source elements as direct media evidence', () => {
    document.body.innerHTML = `
      <video src="../opaque-video"></video>
      <audio src="blob:https://course.example/audio-id"></audio>
      <video><source src="/streams/opaque-source"></video>
    `;

    expect(collectDomMediaUrls(document, PAGE)).toEqual([
      'https://course.example/opaque-video',
      'blob:https://course.example/audio-id',
      'https://course.example/streams/opaque-source'
    ]);
  });

  it('accepts recognizable media URLs on arbitrary src-bearing elements only', () => {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div src="https://player.example/master.m3u8"></div>
      <div src="https://player.example/embed/42"></div>
      <span src="/preview/video.mp4"></span>
      <span src="/assets/app.js"></span>
    `;

    expect(collectDomMediaUrls(wrapper, PAGE)).toEqual([
      'https://player.example/master.m3u8',
      'https://course.example/preview/video.mp4'
    ]);
  });

  it('finds media nested inside a newly inserted wrapper', () => {
    const wrapper = document.createElement('section');
    wrapper.innerHTML = `
      <div><video src="nested/video.webm"></video></div>
      <source src="nested/audio-stream">
    `;

    expect(collectDomMediaUrls(wrapper, PAGE)).toEqual([
      'https://course.example/lessons/nested/video.webm',
      'https://course.example/lessons/nested/audio-stream'
    ]);
  });

  it('includes the root element and deduplicates repeated normalized URLs', () => {
    const media = document.createElement('video');
    media.setAttribute('src', '/same/video.mp4');
    media.innerHTML = '<source src="/same/video.mp4">';

    expect(collectDomMediaUrls(media, PAGE)).toEqual([
      'https://course.example/same/video.mp4'
    ]);
  });

  it('returns an empty list for malformed URLs', () => {
    const source = document.createElement('source');
    source.setAttribute('src', 'http://[');
    expect(collectDomMediaUrls(source, PAGE)).toEqual([]);
  });
});
