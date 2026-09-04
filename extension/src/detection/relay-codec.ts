const RELAY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const HOUR_MS = 60 * 60 * 1000;

export interface RelayCodec {
  hour: number;
  prefix: string;
  relayOrigin: string;
  mapping: Record<string, string>;
}

export interface LearnedRelay {
  originalUrl: string;
  relayUrl: string;
  originalOrigin: string;
  codec: RelayCodec;
}

function encodedSource(hour: number, original: URL): string | undefined {
  try {
    return btoa(`${hour}/${original.pathname}${original.search}`);
  } catch {
    return undefined;
  }
}

function candidateHours(original: URL, now: number): number[] {
  const candidates = new Set<number>();
  const addAround = (center: number, radius: number): void => {
    candidates.add(center);
    for (let distance = 1; distance <= radius; distance += 1) {
      candidates.add(center - distance);
      candidates.add(center + distance);
    }
  };

  const currentHour = Math.round(now / HOUR_MS);
  addAround(currentHour, 48);

  const queryTime = Number(original.searchParams.get('t'));
  if (Number.isFinite(queryTime) && queryTime > 0) {
    const queryHour = Math.round(queryTime / HOUR_MS);
    addAround(queryHour, 2);
  }
  return [...candidates];
}

/**
 * Infer the alphabet substitution used by a browser-side relay URL. Digits
 * and Base64 punctuation are invariant, which rejects unrelated URL pairs.
 */
export function inferRelayCodec(
  originalUrl: string,
  relayUrl: string,
  now = Date.now()
): LearnedRelay | null {
  let original: URL;
  let relay: URL;
  try {
    original = new URL(originalUrl);
    relay = new URL(relayUrl);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(original.protocol) || !/^https?:$/.test(relay.protocol)) return null;

  const separator = relay.pathname.lastIndexOf('/');
  const prefix = separator >= 0 ? relay.pathname.slice(0, separator + 1) : '';
  const token = separator >= 0 ? relay.pathname.slice(separator + 1) : '';
  if (!token) return null;

  for (const hour of candidateHours(original, now)) {
    const encoded = encodedSource(hour, original);
    if (!encoded || encoded.length !== token.length) continue;

    const mapping: Record<string, string> = {};
    const reverseMapping: Record<string, string> = {};
    let valid = true;
    for (let index = 0; index < encoded.length; index += 1) {
      const source = encoded[index];
      const target = token[index];
      if (RELAY_ALPHABET.includes(source)) {
        if (
          (mapping[source] && mapping[source] !== target) ||
          (reverseMapping[target] && reverseMapping[target] !== source)
        ) {
          valid = false;
          break;
        }
        mapping[source] = target;
        reverseMapping[target] = source;
      } else if (source !== target) {
        valid = false;
        break;
      }
    }

    if (!valid) continue;
    return {
      originalUrl: original.href,
      relayUrl: relay.href,
      originalOrigin: original.origin,
      codec: {
        hour,
        prefix,
        relayOrigin: relay.origin,
        mapping
      }
    };
  }
  return null;
}

/** Combine observations only when they describe the same relay generation. */
export function mergeRelayCodecs(
  existing: RelayCodec | undefined,
  incoming: RelayCodec
): RelayCodec | null {
  if (!existing) return { ...incoming, mapping: { ...incoming.mapping } };
  if (
    existing.hour !== incoming.hour ||
    existing.prefix !== incoming.prefix ||
    existing.relayOrigin !== incoming.relayOrigin
  ) {
    return null;
  }

  const mapping = { ...existing.mapping };
  for (const [source, target] of Object.entries(incoming.mapping)) {
    if (mapping[source] && mapping[source] !== target) return null;
    mapping[source] = target;
  }
  return { ...existing, mapping };
}

export function encodeRelayUrl(
  originalUrl: string,
  codec: RelayCodec
): string | undefined {
  let original: URL;
  try {
    original = new URL(originalUrl);
  } catch {
    return undefined;
  }

  const encoded = encodedSource(codec.hour, original);
  if (!encoded) return undefined;
  if ([...encoded].some((character) =>
    RELAY_ALPHABET.includes(character) && !codec.mapping[character]
  )) {
    return undefined;
  }

  const token = [...encoded]
    .map((character) =>
      RELAY_ALPHABET.includes(character) ? codec.mapping[character] : character
    )
    .join('');
  return `${codec.relayOrigin}${codec.prefix}${token}`;
}

export function resolveRelayUrl(
  originalUrl: string,
  directMappings?: ReadonlyMap<string, string>,
  codecs?: ReadonlyMap<string, RelayCodec>
): string | undefined {
  const direct = directMappings?.get(originalUrl);
  if (direct) return direct;

  let origin: string;
  try {
    origin = new URL(originalUrl).origin;
  } catch {
    return undefined;
  }
  const codec = codecs?.get(origin);
  return codec ? encodeRelayUrl(originalUrl, codec) : undefined;
}
