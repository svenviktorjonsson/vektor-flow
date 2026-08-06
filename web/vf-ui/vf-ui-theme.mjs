export const UI_THEMES = Object.freeze(['dark', 'light']);

const PALETTES = Object.freeze({
  dark: Object.freeze({
    canvasBackground: '#000000',
    surfaceOutsideOverlay: 'rgba(6, 10, 12, 0.56)',
    grid: 'rgba(215, 232, 236, 0.14)',
    gridPoint: 'rgba(215, 232, 236, 0.30)',
    axis: 'rgba(246, 248, 249, 0.64)',
    foreground: '#f6f8f9',
    mutedForeground: '#bfc5d0',
    selection: '#78d3c6',
    active: '#e9c46a',
    marqueeFill: 'rgba(120, 183, 211, 0.08)',
    marqueeStroke: 'rgba(120, 183, 211, 0.82)'
  }),
  light: Object.freeze({
    canvasBackground: '#f4f4f0',
    surfaceOutsideOverlay: 'rgba(244, 244, 240, 0.68)',
    grid: 'rgba(23, 33, 38, 0.16)',
    gridPoint: 'rgba(23, 33, 38, 0.30)',
    axis: 'rgba(23, 33, 38, 0.66)',
    foreground: '#172126',
    mutedForeground: '#617078',
    selection: '#18786e',
    active: '#b78608',
    marqueeFill: 'rgba(24, 120, 110, 0.09)',
    marqueeStroke: 'rgba(24, 120, 110, 0.82)'
  })
});

export function normalizeUiTheme(theme) {
  return theme === 'light' ? 'light' : 'dark';
}

export function uiThemePalette(theme) {
  return PALETTES[normalizeUiTheme(theme)];
}

function normalizeHexColor(color) {
  const value = String(color || '').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(value)) return value;
  if (/^#[0-9a-f]{3}$/.test(value)) {
    return `#${[...value.slice(1)].map((part) => part + part).join('')}`;
  }
  return null;
}

function adaptRgbBrightness(channels) {
  const [red, green, blue] = channels.map((channel) => channel / 255);
  const maximum = Math.max(red, green, blue);
  if (maximum === 0) return [255, 255, 255];
  // Holding HSV hue and saturation constant while replacing V with 1-V
  // is exactly a uniform scale of all RGB channels.
  const scale = (1 - maximum) / maximum;
  return channels.map((channel) => Math.round(channel * scale));
}

function adaptHexColor(color) {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
  return `#${adaptRgbBrightness(channels)
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`;
}

function adaptCssColor(color) {
  const match = String(color || '').trim().match(
    /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*([\d.]+))?\s*\)$/i
  );
  if (!match) return null;
  const channels = match.slice(1, 4).map(Number);
  if (!channels.every((channel) => channel >= 0 && channel <= 255)) return null;
  const [red, green, blue] = adaptRgbBrightness(channels);
  return match[4] == null
    ? `rgb(${red}, ${green}, ${blue})`
    : `rgba(${red}, ${green}, ${blue}, ${match[4]})`;
}

export function themeDisplayColor(color, {
  theme = 'dark',
  defaultColors = [],
  adaptAppliedColors = false,
  invertAppliedGrayscales = false
} = {}) {
  if (normalizeUiTheme(theme) !== 'light') return color;
  const hex = normalizeHexColor(color);
  const defaults = new Set(defaultColors.map(normalizeHexColor).filter(Boolean));
  if (!hex) {
    return adaptAppliedColors || invertAppliedGrayscales ? adaptCssColor(color) || color : color;
  }
  return defaults.has(hex) || adaptAppliedColors || invertAppliedGrayscales
    ? adaptHexColor(hex)
    : color;
}

export function createUiTheme({ theme = 'dark', onChange } = {}) {
  let current = normalizeUiTheme(theme);

  function snapshot() {
    return Object.freeze({ theme: current, palette: uiThemePalette(current) });
  }

  function set(nextTheme) {
    const next = normalizeUiTheme(nextTheme);
    if (next === current) return snapshot();
    current = next;
    const nextSnapshot = snapshot();
    onChange?.(nextSnapshot);
    return nextSnapshot;
  }

  function toggle() {
    return set(current === 'dark' ? 'light' : 'dark');
  }

  return Object.freeze({ snapshot, set, toggle });
}
