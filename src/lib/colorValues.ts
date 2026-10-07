/** A concrete CSS color, with its location in the source line left intact. */
export interface ColorValue {
  start: number;
  end: number;
  source: string;
  red: number;
  green: number;
  blue: number;
  alpha: number;
  hex: string;
  rgb: string;
  hsl: string;
  opacity: string;
}

type Channels = [red: number, green: number, blue: number, alpha: number];

// Take the whole hash token, including invalid letters, so #FFFFFFoops never
// turns into a preview of its valid prefix. Bare color names are ordinary
// identifiers too often to be useful in a code review.
const COLOR_TOKEN = /#[\w-]+|(?:rgba?|hsla?)\([^()\r\n]*\)/gi;
const IDENTIFIER = /[\p{L}\p{N}_$#-]/u;
const NUMBER = /^([+-]?(?:\d*\.)?\d+(?:e[+-]?\d+)?)(%|deg|grad|rad|turn)?$/i;

function clamp(value: number, maximum = 1): number {
  return Math.min(maximum, Math.max(0, value));
}

function numberWithUnit(value: string): [number, string] | undefined {
  const match = NUMBER.exec(value);
  if (match == null) return undefined;
  const number = Number(match[1]);
  return Number.isFinite(number)
    ? [number, (match[2] ?? '').toLowerCase()]
    : undefined;
}

function alphaChannel(value: string): number | undefined {
  const parsed = numberWithUnit(value);
  if (parsed == null || (parsed[1] !== '' && parsed[1] !== '%')) {
    return undefined;
  }
  return clamp(parsed[0] / (parsed[1] === '%' ? 100 : 1));
}

function parseHex(source: string): Channels | undefined {
  const digits = source.slice(1);
  if (!/^(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(digits)) {
    return undefined;
  }
  const full =
    digits.length <= 4
      ? [...digits].map((digit) => digit + digit).join('')
      : digits;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
    full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1,
  ];
}

function parseFunction(source: string): Channels | undefined {
  const opening = source.indexOf('(');
  const name = source.slice(0, opening).toLowerCase();
  const body = source.slice(opening + 1, -1).trim();
  const legacy = body.includes(',');
  let components: string[];
  let alpha = 1;
  if (legacy) {
    if (body.includes('/')) return undefined;
    components = body.split(',').map((value) => value.trim());
    if (components.length !== 3 && components.length !== 4) return undefined;
    if (components.length === 4) {
      const parsed = alphaChannel(components.pop()!);
      if (parsed == null) return undefined;
      alpha = parsed;
    }
  } else {
    const parts = body.split('/');
    if (parts.length > 2) return undefined;
    components = parts[0].trim().split(/\s+/);
    if (components.length !== 3) return undefined;
    if (parts.length === 2) {
      const parsed = alphaChannel(parts[1].trim());
      if (parsed == null) return undefined;
      alpha = parsed;
    }
  }

  const channels = components.map(numberWithUnit);
  const [first, second, third] = channels;
  if (first == null || second == null || third == null) return undefined;
  if (name.startsWith('rgb')) {
    if (channels.some((channel) => channel![1] !== '' && channel![1] !== '%')) {
      return undefined;
    }
    if (legacy && channels.some((channel) => channel![1] !== first[1])) {
      return undefined;
    }
    const rgb = [first, second, third].map(([value, unit]) =>
      clamp((value / (unit === '%' ? 100 : 255)) * 255, 255)
    );
    return [rgb[0], rgb[1], rgb[2], alpha];
  }

  const hueScale: Record<string, number> = {
    '': 1,
    deg: 1,
    grad: 0.9,
    rad: 180 / Math.PI,
    turn: 360,
  };
  if (
    !Object.hasOwn(hueScale, first[1]) ||
    (second[1] !== '%' && (legacy || second[1] !== '')) ||
    (third[1] !== '%' && (legacy || third[1] !== ''))
  ) {
    return undefined;
  }
  const hue = (((first[0] * hueScale[first[1]]) % 360) + 360) % 360;
  const saturation = clamp(second[0] / 100);
  const lightness = clamp(third[0] / 100);
  const amplitude = saturation * Math.min(lightness, 1 - lightness);
  const channel = (offset: number) => {
    const position = (offset + hue / 30) % 12;
    return (
      (lightness -
        amplitude * Math.max(-1, Math.min(position - 3, 9 - position, 1))) *
      255
    );
  };
  return [channel(0), channel(8), channel(4), alpha];
}

function format(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function hexByte(value: number): string {
  return Math.round(value).toString(16).padStart(2, '0').toUpperCase();
}

function describeColor(
  source: string,
  start: number,
  channels: Channels
): ColorValue {
  const [red, green, blue, alpha] = channels;
  const rgb = [red, green, blue].map((value) => value / 255);
  const maximum = Math.max(...rgb);
  const minimum = Math.min(...rgb);
  const delta = maximum - minimum;
  const lightness = (maximum + minimum) / 2;
  const saturation =
    delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (delta !== 0) {
    if (maximum === rgb[0]) hue = ((rgb[1] - rgb[2]) / delta) % 6;
    else if (maximum === rgb[1]) hue = (rgb[2] - rgb[0]) / delta + 2;
    else hue = (rgb[0] - rgb[1]) / delta + 4;
    hue = (hue * 60 + 360) % 360;
  }
  const alphaSuffix = alpha === 1 ? '' : ` / ${format(alpha * 100)}%`;
  return {
    start,
    end: start + source.length,
    source,
    red,
    green,
    blue,
    alpha,
    hex: `#${[red, green, blue].map(hexByte).join('')}${alpha === 1 ? '' : hexByte(alpha * 255)}`,
    rgb: `rgb(${[red, green, blue].map(format).join(' ')}${alphaSuffix})`,
    hsl: `hsl(${format(hue)} ${format(saturation * 100)}% ${format(lightness * 100)}%${alphaSuffix})`,
    opacity: `${format(alpha * 100)}%`,
  };
}

/** Finds literal colors in any language, without evaluating code or variables. */
export function findColorValues(line: string): ColorValue[] {
  const colors: ColorValue[] = [];
  for (const match of line.matchAll(COLOR_TOKEN)) {
    const start = match.index;
    const source = match[0];
    const before = line[start - 1];
    const after = line[start + source.length];
    if (
      (before != null && IDENTIFIER.test(before)) ||
      (after != null && IDENTIFIER.test(after))
    ) {
      continue;
    }
    const channels = source.startsWith('#')
      ? parseHex(source)
      : parseFunction(source);
    if (channels != null) colors.push(describeColor(source, start, channels));
  }
  return colors;
}
