// MSE Hook — runs in the MAIN world via manifest.json content_scripts world: "MAIN".
// Cannot use any extension APIs (chrome.*), only window.postMessage to communicate
// with the isolated-world content script.

(function() {
  // --- Staying out of the page's way -------------------------------------
  //
  // Hooking MSE, fetch and XHR is unavoidable for MSE capture, but a player
  // that checks whether those are still native will refuse to play when it
  // finds them patched. Everything below exists to keep the patches from
  // announcing themselves: no enumerable globals, no tags on page objects,
  // wrappers that report the original source, and a per-load channel name.

  // Re-entry guard. Registered so a second injection finds it, non-enumerable
  // so it stays out of Object.keys, and deliberately unbranded: a page that
  // enumerates window symbols should not learn which extension is present.
  const HOOK_MARK = Symbol.for('mediasource.observer');
  if ((window as any)[HOOK_MARK]) return;
  Object.defineProperty(window, HOOK_MARK, {
    value: true,
    enumerable: false,
    configurable: true,
    writable: false
  });

  /**
   * Makes a wrapper answer `toString()` with the source of the function it
   * replaced, which is what integrity checks compare. Function.prototype
   * .toString is itself patched once, and reports itself as native.
   */
  const nativeSource = new WeakMap<Function, Function>();
  const origFunctionToString = Function.prototype.toString;
  Function.prototype.toString = function(this: Function): string {
    const original = nativeSource.get(this);
    return origFunctionToString.call(original || this);
  };
  nativeSource.set(Function.prototype.toString, origFunctionToString);

  // Our own script URL, read from a stack we raise ourselves. Every frame that
  // mentions it is a frame the page should never see.
  const OWN_URL = (() => {
    try {
      const frames = String(new Error().stack || '').split('\n');
      for (const frame of frames.slice(1)) {
        const match = frame.match(/\(?((?:https?|chrome-extension|moz-extension):\/\/[^\s)]+?):\d+:\d+\)?/);
        if (match) return match[1];
      }
    } catch { /* stacks are best-effort */ }
    return '';
  })();

  /**
   * Removes this script's frames from an error on its way to the page.
   *
   * Disguising toString() is not enough on its own: a player only has to make
   * one patched call throw — probing addSourceBuffer with an unsupported MIME
   * type is routine codec detection — and read err.stack to find, and name,
   * the extension. The error itself is passed through untouched.
   */
  function scrubStack<T>(error: T): T {
    if (!OWN_URL) return error;
    try {
      const stack = (error as any)?.stack;
      if (typeof stack !== 'string' || stack.indexOf(OWN_URL) < 0) return error;
      (error as any).stack = stack
        .split('\n')
        .filter((line: string) => line.indexOf(OWN_URL) < 0)
        .join('\n');
    } catch { /* frozen or exotic error objects keep their stack */ }
    return error;
  }

  /**
   * Calls the function a wrapper stands in for, keeping this script out of any
   * stack the page can reach — including a rejected promise's.
   */
  function passThrough(original: Function, thisArg: any, args: IArguments | any[]): any {
    try {
      const result = original.apply(thisArg, args as any);
      if (result && typeof result.then === 'function' && typeof result.catch === 'function') {
        return result.catch((error: unknown) => { throw scrubStack(error); });
      }
      return result;
    } catch (error) {
      throw scrubStack(error);
    }
  }

  /** Registers `wrapper` as standing in for `original`, and returns it. */
  function disguise<T extends Function>(wrapper: T, original: Function): T {
    nativeSource.set(wrapper, original);
    try {
      Object.defineProperty(wrapper, 'name', {
        value: original.name,
        configurable: true
      });
      Object.defineProperty(wrapper, 'length', {
        value: original.length,
        configurable: true
      });
    } catch { /* frozen function objects keep their own name */ }
    return wrapper;
  }

  // The postMessage marker stays constant. The isolated world cannot learn a
  // per-load token without publishing it somewhere the page can read as well,
  // so randomizing it would cost the bridge its reliability and buy nothing.
  // A page that listens for `message` sees this traffic either way.

  const MSE_STATE: any = {
    blobUrl: null,
    mimeType: null,
    codecs: null,
    totalBytes: 0,
    segmentCount: 0,
    segmentUrls: [] as string[],
    initSegmentUrl: null,
    duration: 0
  };

  let pageGeneration = 0;
  const mediaSourceGenerations = new WeakMap<MediaSource, number>();
  const sourceBufferGenerations = new WeakMap<SourceBuffer, number>();

  function postToContentScript(payload: any, generation = pageGeneration): void {
    if (generation !== pageGeneration) return;
    window.postMessage(Object.assign({
      // Must equal BRIDGE_SOURCE in detection/mse-bridge.ts, which validates
      // it. Inlined because this bundle is a standalone MAIN-world IIFE.
      source: 'mse-observer',
      pageUrl: window.location.href,
      generation
    }, payload), '*');
  }

  function resetMSEState(): void {
    MSE_STATE.blobUrl = null;
    MSE_STATE.mimeType = null;
    MSE_STATE.codecs = null;
    MSE_STATE.totalBytes = 0;
    MSE_STATE.segmentCount = 0;
    MSE_STATE.segmentUrls = [];
    MSE_STATE.initSegmentUrl = null;
    MSE_STATE.duration = 0;
  }

  function notifyNavigation(): void {
    pageGeneration++;
    resetMSEState();
    postToContentScript({ type: 'navigation' });
  }

  const origPushState = history.pushState;
  history.pushState = disguise(function(this: any): void {
    passThrough(origPushState, this, arguments);
    notifyNavigation();
  }, origPushState);

  const origReplaceState = history.replaceState;
  history.replaceState = disguise(function(this: any): void {
    passThrough(origReplaceState, this, arguments);
    notifyNavigation();
  }, origReplaceState);

  window.addEventListener('popstate', notifyNavigation);
  window.addEventListener('hashchange', notifyNavigation);

  function extractCodecs(mime: string): string | null {
    const m = mime.match(/codecs="([^"]+)"/);
    return m ? m[1] : null;
  }

  function isVideoMime(mime: string): boolean {
    return mime && (mime.indexOf('video/mp4') === 0 || mime.indexOf('video/webm') === 0 || mime.indexOf('audio/mp4') === 0);
  }

  function looksLikeSegment(url: string): boolean {
    if (!url || url.indexOf('http') !== 0) return false;
    const path = url.split('?')[0].toLowerCase();
    if (path.indexOf('.m4s') >= 0) return true;
    if (path.indexOf('.mp4') >= 0) return true;
    if (path.indexOf('.webm') >= 0) return true;
    if (path.indexOf('.ts') >= 0 && path.indexOf('.ts/') < 0) return true;
    if (path.indexOf('segment') >= 0 || path.indexOf('seg-') >= 0) return true;
    if (path.indexOf('chunk') >= 0 || path.indexOf('fragment') >= 0) return true;
    if (path.indexOf('init') >= 0 && path.indexOf('.mp4') >= 0) return true;
    return false;
  }

  function isLikelyMediaRequest(url: string): boolean {
    try {
      const path = new URL(url, window.location.href).pathname.toLowerCase();
      return /\.(m3u8|mpd|ts|m4s|mp4|webm)$/.test(path);
    } catch {
      return false;
    }
  }

  function findRelayUrl(originalUrl: string, startTime: number, responseUrl?: string): string | undefined {
    try {
      const original = new URL(originalUrl, window.location.href);
      if (responseUrl) {
        const response = new URL(responseUrl, window.location.href);
        if (response.href !== original.href && response.origin === original.origin && response.pathname !== original.pathname) {
          return response.href;
        }
      }

      const now = performance.now();
      const entry = performance.getEntriesByType('resource')
        .filter((item): item is PerformanceResourceTiming => {
          if (item.startTime < startTime - 50 || item.startTime > now + 50) return false;
          try {
            const resource = new URL(item.name, window.location.href);
            return resource.origin === original.origin && resource.pathname !== original.pathname;
          } catch {
            return false;
          }
        })
        .sort((a, b) => Math.abs(a.startTime - startTime) - Math.abs(b.startTime - startTime))[0];

      return entry?.name;
    } catch {
      return undefined;
    }
  }

  function reportMediaUrlMapping(originalUrl: string, startTime: number, responseUrl?: string, generation = pageGeneration): void {
    if (generation !== pageGeneration || !isLikelyMediaRequest(originalUrl)) return;
    const relayUrl = findRelayUrl(originalUrl, startTime, responseUrl);
    if (!relayUrl || relayUrl === originalUrl) return;
    postToContentScript({ type: 'media-url-map', originalUrl, relayUrl }, generation);
  }

  const origCreateObjectURL = URL.createObjectURL;
  URL.createObjectURL = disguise(function(this: any, obj: any): string {
    const url = passThrough(origCreateObjectURL, this, [obj]);
    if (obj instanceof MediaSource) {
      mediaSourceGenerations.set(obj, pageGeneration);
      MSE_STATE.blobUrl = url;
      postToContentScript({ type: 'mse-detected', blobUrl: url });
    }
    return url;
  }, origCreateObjectURL);

  const origAddSourceBuffer = MediaSource.prototype.addSourceBuffer;
  MediaSource.prototype.addSourceBuffer = disguise(function(this: any, mimeType: string): SourceBuffer {
    const generation = mediaSourceGenerations.get(this) ?? pageGeneration;
    if (isVideoMime(mimeType) && generation === pageGeneration) {
      MSE_STATE.mimeType = mimeType;
      MSE_STATE.codecs = extractCodecs(mimeType);
      postToContentScript({
        type: 'source-buffer',
        blobUrl: MSE_STATE.blobUrl,
        mimeType,
        codecs: MSE_STATE.codecs
      });
    }
    const sourceBuffer = passThrough(origAddSourceBuffer, this, [mimeType]);
    sourceBufferGenerations.set(sourceBuffer, generation);
    return sourceBuffer;
  }, origAddSourceBuffer);

  const origAppendBuffer = SourceBuffer.prototype.appendBuffer;
  SourceBuffer.prototype.appendBuffer = disguise(function(this: any, data: any): void {
    try {
      const generation = sourceBufferGenerations.get(this);
      if (generation !== pageGeneration) return;

      if (generation === pageGeneration && data instanceof ArrayBuffer) {
        MSE_STATE.totalBytes += data.byteLength;
      } else if (generation === pageGeneration && data && data.buffer) {
        MSE_STATE.totalBytes += data.buffer.byteLength;
      }

      MSE_STATE.segmentCount++;

      if (MSE_STATE.segmentCount === 1) {
        postToContentScript({
          type: 'first-segment',
          blobUrl: MSE_STATE.blobUrl,
          mimeType: MSE_STATE.mimeType,
          codecs: MSE_STATE.codecs,
          totalBytes: MSE_STATE.totalBytes,
          segmentCount: MSE_STATE.segmentCount
        });
      }

      if (MSE_STATE.segmentCount % 50 === 0) {
        postToContentScript({
          type: 'progress',
          blobUrl: MSE_STATE.blobUrl,
          totalBytes: MSE_STATE.totalBytes,
          segmentCount: MSE_STATE.segmentCount
        });
      }
    } catch {}
    finally {
      passThrough(origAppendBuffer, this, [data]);
    }
  }, origAppendBuffer);

  const origDurationDesc = Object.getOwnPropertyDescriptor(MediaSource.prototype, 'duration');
  if (origDurationDesc && origDurationDesc.set) {
    const origDurationSet = origDurationDesc.set;
    Object.defineProperty(MediaSource.prototype, 'duration', {
      enumerable: origDurationDesc.enumerable,
      get: origDurationDesc.get,
      set: disguise(function(this: any, val: number) {
        const generation = mediaSourceGenerations.get(this);
        if (generation !== undefined && generation !== pageGeneration) {
          return passThrough(origDurationSet, this, [val]);
        }
        MSE_STATE.duration = val;
        postToContentScript({ type: 'duration', blobUrl: MSE_STATE.blobUrl, duration: val });
        return passThrough(origDurationSet, this, [val]);
      }, origDurationSet),
      configurable: true
    });
  }

  const origFetch = window.fetch;
  window.fetch = disguise(function(this: any, input: any, init?: any): Promise<Response> {
    const url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
    const generation = pageGeneration;
    if (looksLikeSegment(url) && generation === pageGeneration && MSE_STATE.segmentUrls.length < 500) {
      MSE_STATE.segmentUrls.push(url);
      if (url.indexOf('init') >= 0 || MSE_STATE.segmentUrls.length === 1) {
        MSE_STATE.initSegmentUrl = MSE_STATE.initSegmentUrl || url;
      }
      postToContentScript({
        type: 'segment-url',
        url,
        isInit: url.indexOf('init') >= 0,
        totalUrls: MSE_STATE.segmentUrls.length
      }, generation);
    }
    return passThrough(origFetch, this, arguments);
  }, origFetch);

  // Relay learning and segment observation both hang off the prototype, never
  // off window.XMLHttpRequest. Anything the page installs later — telemetry
  // SDKs and polyfills routinely replace the constructor — still delegates to
  // this prototype, so the mappings keep arriving. Wrapping the constructor
  // instead meant one such replacement silently stopped relay learning, and
  // downloads fell back to fetching every segment straight from the CDN.
  const origXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = disguise(function(this: any, method: string, url: string): void {
    const generation = pageGeneration;
    const originalUrl = String(url || '');
    const startTime = performance.now();

    if (looksLikeSegment(originalUrl) && generation === pageGeneration && MSE_STATE.segmentUrls.length < 500) {
      MSE_STATE.segmentUrls.push(originalUrl);
      if (originalUrl.indexOf('init') >= 0 || MSE_STATE.segmentUrls.length === 1) {
        MSE_STATE.initSegmentUrl = MSE_STATE.initSegmentUrl || originalUrl;
      }
      postToContentScript({
        type: 'segment-url',
        url: originalUrl,
        isInit: originalUrl.indexOf('init') >= 0,
        totalUrls: MSE_STATE.segmentUrls.length
      }, generation);
    }

    // responseURL is only final once the request settles.
    try {
      this.addEventListener('loadend', () => {
        reportMediaUrlMapping(originalUrl, startTime, this.responseURL, generation);
      }, { once: true });
    } catch { /* an exotic XHR stand-in may not take listeners */ }

    return passThrough(origXHROpen, this, arguments);
  }, origXHROpen);
})();
