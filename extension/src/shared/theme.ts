// Flux is dark-only: there is no theme setting left to read.

export function applyTheme(): void {
  document.documentElement.setAttribute('data-theme', 'dark');
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    meta.setAttribute('content', '#0e1015');
  });
}

export function initTheme(): void {
  applyTheme();
}
