// Explicit tag colors are independent of dashboard themes.
export const TAG_COLORS = Object.freeze({
  cyan: '#39D2C0',
  purple: '#B392F0',
  pink: '#F778BA',
  green: '#00D4AA',
  blue: '#4DA6FF',
  yellow: '#FFB870',
  red: '#F85149'
});

export const DEFAULT_TAG_COLORS = Object.freeze(['cyan', 'purple', 'pink', 'green', 'blue', 'yellow']);

const splitTags = value => String(value || '').split(',').map(tag => tag.trim()).filter(Boolean);

function resolveColor(value) {
  if (Object.hasOwn(TAG_COLORS, value)) return TAG_COLORS[value];
  if (!/^#(?:[\da-fA-F]{3}|[\da-fA-F]{6})$/.test(value)) return null;
  return (value.length === 4 ? '#' + [...value.slice(1)].map(char => char + char).join('') : value).toUpperCase();
}

function parseTag(raw) {
  const match = /^([^<>]+)<([^<>]+)>$/.exec(raw);
  const color = match && resolveColor(match[2]);
  return color && match[1].trim()
    ? { text: match[1].trim(), color, suffix: `<${match[2]}>` }
    : { text: raw, color: null, suffix: '' };
}

export function normalizeServerTags(value) {
  return splitTags(value).slice(0, 12).map(raw => {
    const tag = parseTag(raw.replace(/[\u0000-\u001f\u007f]/g, ''));
    const text = [...tag.text].slice(0, 32).join('').trim();
    return text ? text + tag.suffix : '';
  }).filter(Boolean).join(',');
}

function foregroundColor(background) {
  const channels = background.slice(1).match(/../g).map(hex => {
    const value = parseInt(hex, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#FFFFFF';
}

export function parseServerTags(value) {
  return splitTags(value).map((raw, index) => {
    const tag = parseTag(raw);
    const background = tag.color || TAG_COLORS[DEFAULT_TAG_COLORS[index % DEFAULT_TAG_COLORS.length]];
    return { text: tag.text, background, foreground: foregroundColor(background) };
  });
}
