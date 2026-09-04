import { beforeEach, describe, expect, it } from 'vitest';
import {
  collectPageMetadata,
  detectedTitle,
  normalizeImageUrl,
  pageDuration,
  pageThumbnail,
  pageTitle
} from './page-metadata';

const PAGE = 'https://course.example/lessons/one';

describe('page metadata', () => {
  beforeEach(() => {
    document.head.replaceChildren();
    document.body.replaceChildren();
    document.title = '';
  });

  it('prefers Open Graph, then Twitter, then the document title', () => {
    document.head.innerHTML = [
      '<title>Document</title>',
      '<meta name="twitter:title" content="Twitter">',
      '<meta property="og:title" content="Open Graph">'
    ].join('');
    expect(pageTitle(document)).toBe('Open Graph');

    document.querySelector('[property="og:title"]')?.remove();
    expect(pageTitle(document)).toBe('Twitter');

    document.querySelector('[name="twitter:title"]')?.remove();
    expect(pageTitle(document)).toBe('Document');
  });

  it('uses a meaningful media filename before the page title', () => {
    document.title = 'Lesson';
    expect(detectedTitle(document, 'https://cdn.example/react-hooks.mp4'))
      .toEqual({ title: 'react-hooks', fromPage: false });
    expect(detectedTitle(document, 'https://cdn.example/master.m3u8'))
      .toEqual({ title: 'Lesson', fromPage: true });
  });

  it('names a lesson from the page URL when the page has no title yet', () => {
    const named = detectedTitle(
      document,
      'https://cdn.example/master.m3u8',
      'https://app.rocketseat.com.br/jornada/react-2025/aula/testando-com-babel-repl'
    );

    expect(named).toEqual({ title: 'Testando Com Babel Repl', fromPage: true });
  });

  it('prefers the page title over the URL slug once the page has one', () => {
    document.title = 'Estruturação | React | Rocketseat';
    const named = detectedTitle(
      document,
      'https://cdn.example/master.m3u8',
      'https://app.rocketseat.com.br/jornada/react-2025/aula/estruturacao'
    );

    expect(named.title).toBe('Estruturação | React | Rocketseat');
  });

  it('returns a stable fallback when the page has no title', () => {
    expect(pageTitle(document)).toBe('Unknown Video');
  });

  it('normalizes relative images and rejects tracking GIF placeholders', () => {
    expect(normalizeImageUrl('../poster.jpg', PAGE))
      .toBe('https://course.example/poster.jpg');
    expect(normalizeImageUrl('data:image/gif;base64,R0lGODlh', PAGE)).toBeUndefined();
    expect(normalizeImageUrl('image.png', 'not a base')).toBeUndefined();
  });

  it('uses metadata before a video poster', () => {
    document.head.innerHTML = '<meta property="og:image" content="/og.jpg">';
    document.body.innerHTML = '<video poster="/poster.jpg"></video>';
    expect(pageThumbnail(document, PAGE)).toBe('https://course.example/og.jpg');
  });

  it('falls through an empty placeholder to the video poster', () => {
    document.head.innerHTML = '<meta property="og:image" content="data:image/gif;base64,x">';
    document.body.innerHTML = '<video poster="/poster.jpg"></video>';
    expect(pageThumbnail(document, PAGE)).toBe('https://course.example/poster.jpg');
  });

  it('uses lazy image attributes as the final thumbnail fallback', () => {
    document.body.innerHTML = '<img class="course-preview" data-src="/lazy.jpg">';
    expect(pageThumbnail(document, PAGE)).toBe('https://course.example/lazy.jpg');
  });

  it('accepts only finite positive video durations', () => {
    document.body.innerHTML = '<video></video>';
    const video = document.querySelector('video')!;

    Object.defineProperty(video, 'duration', { configurable: true, value: 123.5 });
    expect(pageDuration(document)).toBe(123.5);

    Object.defineProperty(video, 'duration', { configurable: true, value: Infinity });
    expect(pageDuration(document)).toBeUndefined();

    Object.defineProperty(video, 'duration', { configurable: true, value: 0 });
    expect(pageDuration(document)).toBeUndefined();
  });

  it('collects one serializable snapshot', () => {
    document.head.innerHTML = [
      '<title>Course</title>',
      '<meta property="og:image" content="/cover.jpg">'
    ].join('');
    expect(collectPageMetadata(document, PAGE, 7)).toEqual({
      title: 'Course',
      thumbnail: 'https://course.example/cover.jpg',
      duration: undefined,
      pageUrl: PAGE,
      generation: 7
    });
  });
});
