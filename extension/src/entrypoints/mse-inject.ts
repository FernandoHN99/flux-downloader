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
    origPushState.apply(this, arguments as any);
    notifyNavigation();
  }, origPushState);

  const origReplaceState = history.replaceState;
  history.replaceState = disguise(function(this: any): void {
    origReplaceState.apply(this, arguments as any);
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

  // Tagging the objects themselves (xhr.__FluxRelayWrapped) put an enumerable
  // property on something the page owns and could read. WeakSets are private.
  const wrappedXhrs = new WeakSet<object>();
  const wrappedXhrConstructors = new WeakSet<object>();

  function wrapXhrInstance(xhr: any): void {
    if (!xhr || wrappedXhrs.has(xhr) || typeof xhr.open !== 'function') return;
    wrappedXhrs.add(xhr);
    let report = () => {};
    for (const property of ['onload', 'onreadystatechange', 'onloadend']) {
      try {
        let handler: any;
        Object.defineProperty(xhr, property, {
          configurable: true,
          get: () => handler,
          set: (value: any) => {
            handler = typeof value === 'function'
              ? function(this: any, event: any): any {
                report();
                return value.call(this, event);
              }
              : value;
          }
        });
      } catch {}
    }
    const originalOpen = xhr.open;
    // Defined rather than assigned: a plain assignment leaves an enumerable
    // own property, so Object.keys(xhr) would show the instance was touched.
    Object.defineProperty(xhr, 'open', {
      configurable: true,
      writable: true,
      enumerable: false,
      value: disguise(function(this: any, method: string, url: string, ...args: any[]): any {
      const originalUrl = String(url || '');
      const generation = pageGeneration;
      const startTime = performance.now();
      report = () => reportMediaUrlMapping(originalUrl, startTime, xhr.responseURL, generation);
      try {
        xhr.addEventListener('loadend', report, { once: true });
      } catch {}
        return originalOpen.call(this, method, url, ...args);
      }, originalOpen)
    });
  }

  function wrapXhrConstructor(value: any): any {
    if (!value || wrappedXhrConstructors.has(value)) return value;
    const Wrapped = function(this: any, ...args: any[]): any {
      const xhr = new value(...args);
      wrapXhrInstance(xhr);
      return xhr;
    } as any;
    Wrapped.prototype = value.prototype;
    try { Object.setPrototypeOf(Wrapped, value); } catch {}
    disguise(Wrapped, value);
    wrappedXhrConstructors.add(Wrapped);
    return Wrapped;
  }

  try {
    // Kept as a plain data property. An accessor here re-wrapped a constructor
    // the page installed later, but it also turned a value property into a
    // getter/setter — something a page can spot with one
    // getOwnPropertyDescriptor call, and a cheap way to notice an extension.
    const descriptor = Object.getOwnPropertyDescriptor(window, 'XMLHttpRequest');
    Object.defineProperty(window, 'XMLHttpRequest', {
      value: wrapXhrConstructor(window.XMLHttpRequest),
      writable: descriptor?.writable ?? true,
      enumerable: descriptor?.enumerable ?? true,
      configurable: descriptor?.configurable ?? true
    });
  } catch {
    // Some page environments expose an immutable XMLHttpRequest property.
  }

  const origCreateObjectURL = URL.createObjectURL;
  URL.createObjectURL = disguise(function(this: any, obj: any): string {
    const url = origCreateObjectURL.call(this, obj);
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
    const sourceBuffer = origAddSourceBuffer.call(this, mimeType);
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
      origAppendBuffer.call(this, data);
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
          return origDurationSet.call(this, val);
        }
        MSE_STATE.duration = val;
        postToContentScript({ type: 'duration', blobUrl: MSE_STATE.blobUrl, duration: val });
        return origDurationSet.call(this, val);
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
    return origFetch.apply(this, arguments as any);
  }, origFetch);

  const origXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = disguise(function(this: any, method: string, url: string): void {
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
    return origXHROpen.apply(this, arguments as any);
  }, origXHROpen);
})();
