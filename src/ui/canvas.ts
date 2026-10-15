/** Canvas and theme helpers shared by the views. */

/** Read a CSS custom property from :root (theme tokens such as --ink, --muted). */
export const tok = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Size a canvas's backing store to its CSS size at device pixel ratio (max 2) and return a scaled context. */
export function fit(c: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } {
  const d = Math.min(window.devicePixelRatio || 1, 2), w = c.clientWidth, h = c.clientHeight;
  if (c.width !== Math.round(w * d) || c.height !== Math.round(h * d)) { c.width = Math.round(w * d); c.height = Math.round(h * d); }
  const ctx = c.getContext('2d')!;
  ctx.setTransform(d, 0, 0, d, 0, 0);
  return { ctx, w, h };
}

export const hex = (c: string): [number, number, number] => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

/** NWS reflectivity colour table, 5-dBZ steps from 5 dBZ. */
export const NWS = ['#04e9e7', '#019ff4', '#0300f4', '#02fd02', '#01c501', '#008e00', '#fdf802', '#e5bc00', '#fd9500', '#fd0000', '#d40000', '#bc0000', '#f800fd', '#9854c6'];
const NWS_RGB = NWS.map(hex);
export function dbzRGB(v: number): [number, number, number] | null {
  if (v < 5) return null;
  return NWS_RGB[Math.min(13, Math.floor((v - 5) / 5))];
}

/** Redraw callbacks when the colour scheme or theme attribute changes. Returns an unsubscribe function. */
export function onThemeChange(fn: () => void): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', fn);
  const mo = new MutationObserver(fn);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => { mq.removeEventListener('change', fn); mo.disconnect(); };
}
