import { spinnerArc, type SpinnerPorts } from './toolbar-spinner';

/**
 * The toolbar icon, drawn for the spinner. A service worker has no DOM, so the
 * frames are painted on an OffscreenCanvas and handed to `action.setIcon` as
 * pixels. Thin on purpose: the timing is `ToolbarSpinner`, the geometry is
 * `spinnerArc`, and only this file needs a browser.
 */

/** Toolbar sizes, at 1x and 2x, and the shipped icon each is cut down from. */
const SOURCES: Record<number, string> = {
  16: 'public/icons/icon-32.png',
  32: 'public/icons/icon-48.png'
};

/** The manifest's own icons, put back when the animation ends. */
const RESTING_ICON = {
  16: 'public/icons/icon-16.png',
  32: 'public/icons/icon-32.png',
  48: 'public/icons/icon-48.png',
  128: 'public/icons/icon-128.png'
};

const TRACK = 'rgba(139, 92, 246, 0.30)';
const ARC = '#8b5cf6';

export function createToolbarIconPorts(): SpinnerPorts {
  let bitmaps: Promise<Map<number, ImageBitmap>> | null = null;

  const load = (): Promise<Map<number, ImageBitmap>> => {
    bitmaps ??= (async () => {
      const loaded = new Map<number, ImageBitmap>();
      for (const [size, path] of Object.entries(SOURCES)) {
        const response = await fetch(chrome.runtime.getURL(path));
        loaded.set(Number(size), await createImageBitmap(await response.blob()));
      }
      return loaded;
    })().catch((error) => {
      bitmaps = null;
      throw error;
    });
    return bitmaps;
  };

  return {
    async paint(frame, frames) {
      const sources = await load();
      const imageData: Record<number, ImageData> = {};
      for (const [size, source] of sources) {
        imageData[size] = drawFrame(size, source, frame, frames);
      }
      await chrome.action.setIcon({ imageData });
    },
    async restore() {
      await chrome.action.setIcon({ path: RESTING_ICON });
    }
  };
}

function drawFrame(size: number, source: ImageBitmap, frame: number, frames: number): ImageData {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d')!;

  // The icon shrinks a little to leave room for the ring around it.
  const inset = Math.round(size * 0.17);
  ctx.drawImage(source, inset, inset, size - inset * 2, size - inset * 2);

  const width = Math.max(1.6, size * 0.11);
  const radius = size / 2 - width / 2;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';

  ctx.strokeStyle = TRACK;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
  ctx.stroke();

  const { start, end } = spinnerArc(frame, frames);
  ctx.strokeStyle = ARC;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, radius, start, end);
  ctx.stroke();

  return ctx.getImageData(0, 0, size, size);
}
