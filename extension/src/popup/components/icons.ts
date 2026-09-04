// Small inline SVGs. Built as nodes rather than innerHTML so nothing ever
// parses a string into this popup's DOM.

function svg(paths: string[], size = 13, width = '2.5'): SVGSVGElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('width', String(size));
  el.setAttribute('height', String(size));
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('fill', 'none');
  el.setAttribute('stroke', 'currentColor');
  el.setAttribute('stroke-width', width);
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-linejoin', 'round');
  el.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    el.appendChild(path);
  }
  return el;
}

export const PATHS = {
  rename: ['M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z'],
  remove: ['M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6'],
  confirm: ['M20 6 9 17l-5-5'],
  cancel: ['M18 6 6 18M6 6l12 12'],
  refresh: ['M20 11a8 8 0 0 0-14.9-3M4 3v5h5', 'M4 13a8 8 0 0 0 14.9 3M20 21v-5h-5'],
  download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3']
} as const;

export function iconButton(kind: keyof typeof PATHS, label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = `icon-btn-sm icon-btn-${kind}`;
  button.setAttribute('aria-label', label);
  button.title = label;
  button.appendChild(svg(PATHS[kind] as unknown as string[]));
  return button;
}

export function downloadIcon(): SVGSVGElement {
  const el = svg(PATHS.download as unknown as string[], 15, '2.2');
  el.setAttribute('class', 'group-download');
  return el;
}

export function refreshIcon(): SVGSVGElement {
  return svg(PATHS.refresh as unknown as string[], 12, '2.2');
}

export function dragHandle(): HTMLElement {
  const handle = document.createElement('span');
  handle.className = 'drag-handle';
  handle.setAttribute('aria-hidden', 'true');
  handle.title = 'Drag to reorder';
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('width', '12');
  el.setAttribute('height', '12');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('fill', 'none');
  el.setAttribute('stroke', 'currentColor');
  el.setAttribute('stroke-width', '2');
  el.setAttribute('stroke-linecap', 'round');
  for (const y of [9, 15]) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', '4');
    line.setAttribute('x2', '20');
    line.setAttribute('y1', String(y));
    line.setAttribute('y2', String(y));
    el.appendChild(line);
  }
  handle.appendChild(el);
  return handle;
}

export function playIcon(className: string): HTMLElement {
  const icon = document.createElement('div');
  icon.className = className;
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('width', '20');
  el.setAttribute('height', '20');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('fill', 'currentColor');
  el.setAttribute('aria-hidden', 'true');
  const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  polygon.setAttribute('points', '5 3 19 12 5 21 5 3');
  el.appendChild(polygon);
  icon.appendChild(el);
  return icon;
}

export function badge(className: string, text: string, label: string): HTMLElement {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  el.title = label;
  el.setAttribute('aria-label', label);
  return el;
}

export function selectDot(checked: boolean): HTMLElement {
  const dot = document.createElement('span');
  dot.className = checked ? 'select-dot checked' : 'select-dot';
  dot.setAttribute('aria-hidden', 'true');
  return dot;
}

export function spinner(): HTMLElement {
  const el = document.createElement('span');
  el.className = 'row-spinner';
  el.title = 'Downloading — stop the download to edit this video';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-label', 'Downloading');
  return el;
}
