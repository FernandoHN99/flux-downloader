import { describe, expect, it } from 'vitest';
import {
  encodeRelayUrl,
  inferRelayCodec,
  mergeRelayCodecs,
  resolveRelayUrl,
  type RelayCodec
} from './relay-codec';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const HOUR_MS = 60 * 60 * 1000;

function substitute(value: string): string {
  return [...value].map((character) => {
    const index = ALPHABET.indexOf(character);
    return index < 0 ? character : ALPHABET[(index + 7) % ALPHABET.length];
  }).join('');
}

function relayPair(hour: number, originalUrl: string): [string, string] {
  const original = new URL(originalUrl);
  const encoded = btoa(`${hour}/${original.pathname}${original.search}`);
  return [original.href, `https://relay.example/cache/${substitute(encoded)}`];
}

describe('inferRelayCodec', () => {
  it('learns a substitution and reconstructs the observed URL', () => {
    const hour = 500_000;
    const [original, relay] = relayPair(hour, 'https://cdn.example/video/segment.ts?token=abc');
    const learned = inferRelayCodec(original, relay, hour * HOUR_MS);

    expect(learned).toMatchObject({
      originalUrl: original,
      relayUrl: relay,
      originalOrigin: 'https://cdn.example',
      codec: {
        hour,
        prefix: '/cache/',
        relayOrigin: 'https://relay.example'
      }
    });
    expect(encodeRelayUrl(original, learned!.codec)).toBe(relay);
  });

  it('uses a signed query timestamp outside the current 48-hour window', () => {
    const signedHour = 400_000;
    const nowHour = 500_000;
    const timestamp = signedHour * HOUR_MS;
    const [original, relay] = relayPair(
      signedHour,
      `https://cdn.example/segment.ts?t=${timestamp}`
    );
    expect(inferRelayCodec(original, relay, nowHour * HOUR_MS)?.codec.hour).toBe(signedHour);
  });

  it.each([
    ['not a URL', 'https://relay.example/token'],
    ['blob:https://cdn.example/id', 'https://relay.example/token'],
    ['https://cdn.example/file', 'data:text/plain,token'],
    ['https://cdn.example/file', 'https://relay.example/']
  ])('rejects an invalid pair', (original, relay) => {
    expect(inferRelayCodec(original, relay, 0)).toBeNull();
  });

  it('rejects tokens whose invariant Base64 characters were changed', () => {
    const hour = 500_000;
    const [original, relay] = relayPair(hour, 'https://cdn.example/path?q=one');
    const changed = relay.replace(/([0-9=])(?=[^/]*$)/, '!');
    expect(inferRelayCodec(original, changed, hour * HOUR_MS)).toBeNull();
  });
});

describe('mergeRelayCodecs', () => {
  const existing: RelayCodec = {
    hour: 1,
    prefix: '/cache/',
    relayOrigin: 'https://relay.example',
    mapping: { A: 'H' }
  };

  it('merges compatible observations without mutating either input', () => {
    const incoming: RelayCodec = {
      ...existing,
      mapping: { B: 'I' }
    };
    const merged = mergeRelayCodecs(existing, incoming);
    expect(merged?.mapping).toEqual({ A: 'H', B: 'I' });
    expect(existing.mapping).toEqual({ A: 'H' });
    expect(incoming.mapping).toEqual({ B: 'I' });
  });

  it('rejects a different generation, destination, or conflicting substitution', () => {
    expect(mergeRelayCodecs(existing, { ...existing, hour: 2 })).toBeNull();
    expect(mergeRelayCodecs(existing, { ...existing, relayOrigin: 'https://other.example' }))
      .toBeNull();
    expect(mergeRelayCodecs(existing, { ...existing, mapping: { A: 'Z' } })).toBeNull();
  });
});

describe('encodeRelayUrl', () => {
  it('returns undefined when a URL needs an alphabet mapping not learned yet', () => {
    expect(encodeRelayUrl('https://cdn.example/other', {
      hour: 1,
      prefix: '/cache/',
      relayOrigin: 'https://relay.example',
      mapping: {}
    })).toBeUndefined();
  });

  it('returns undefined for malformed originals', () => {
    expect(encodeRelayUrl('not a URL', {
      hour: 1,
      prefix: '/',
      relayOrigin: 'https://relay.example',
      mapping: {}
    })).toBeUndefined();
  });
});

describe('resolveRelayUrl', () => {
  it('prefers an exact observation before attempting a codec', () => {
    expect(resolveRelayUrl(
      'https://cdn.example/one',
      new Map([['https://cdn.example/one', 'https://relay.example/exact']]),
      new Map()
    )).toBe('https://relay.example/exact');
  });

  it('returns undefined without a direct observation or origin codec', () => {
    expect(resolveRelayUrl('https://cdn.example/one', new Map(), new Map())).toBeUndefined();
    expect(resolveRelayUrl('not a URL')).toBeUndefined();
  });
});
