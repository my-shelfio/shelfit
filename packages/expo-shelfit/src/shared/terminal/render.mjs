// Kept dependency-free and pure so they are easy to unit test.

// East Asian Wide characters and the main emoji blocks -> 2 columns.
const WIDE_RANGES = [
  [0x1100, 0x115f],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f], // emoji: pictographs / emoticons
  [0x1f680, 0x1f6ff], // emoji: transport & map symbols
  [0x1f900, 0x1f9ff], // emoji: supplemental symbols & pictographs
];

// Combining marks and variation selectors render on top of the previous
// glyph rather than taking their own column -> 0 columns.
const ZERO_WIDTH_RANGES = [
  [0x0300, 0x036f], // combining diacritics
  [0xfe00, 0xfe0f], // variation selectors
];

const ZWJ = 0x200d;

const inRanges = (c, ranges) => ranges.some(([lo, hi]) => c >= lo && c <= hi);

/**
 * A base character plus everything that renders on top of it: combining
 * marks, variation selectors, and ZWJ-joined components (family emoji and
 * the like), each carrying the width of the whole group. Not real
 * grapheme-cluster segmentation, but enough to keep a joined emoji at 2
 * columns instead of ballooning per component.
 *
 * `width` and `truncate` both walk through here, so a cell can never be
 * measured one way and cut another — a cut through the middle of a group
 * renders at an unpredictable width and shifts every column after it.
 */
function* clusters(str) {
  let current = null;

  for (const ch of String(str)) {
    const c = ch.codePointAt(0);
    const attaches = c === ZWJ || inRanges(c, ZERO_WIDTH_RANGES);

    if (current && (attaches || current.joining)) {
      current.text += ch;
      current.joining = c === ZWJ;
      continue;
    }

    if (current) yield current;
    current = {
      text: ch,
      width: attaches ? 0 : inRanges(c, WIDE_RANGES) ? 2 : 1,
      joining: c === ZWJ,
    };
  }

  if (current) yield current;
}

export function width(str) {
  let w = 0;
  for (const cluster of clusters(str)) w += cluster.width;
  return w;
}

// One column wide, so it costs the same as the character it replaces.
const ELLIPSIS = '\u2026';

/**
 * Cuts `str` down to `maxWidth` columns, spending one of them on a trailing
 * ellipsis so a shortened cell is visibly shortened. Returns `str` untouched
 * when it already fits, which is every cell whenever --max-width is unset.
 */
export function truncate(str, maxWidth) {
  const text = String(str);
  if (maxWidth <= 0) return '';
  if (width(text) <= maxWidth) return text;

  let out = '';
  let w = 0;
  for (const cluster of clusters(text)) {
    if (w + cluster.width > maxWidth - 1) break;
    out += cluster.text;
    w += cluster.width;
  }
  return out + ELLIPSIS;
}

export const pad = (str, len) => str + ' '.repeat(Math.max(0, len - width(str)));

/** ANSI dim. `isTTY` is threaded through explicitly so this is testable without a real TTY. */
export function dim(s, isTTY = process.stdout.isTTY) {
  return isTTY ? `\x1b[2m${s}\x1b[0m` : s;
}

/** ANSI bold. See `dim` for why `isTTY` is a parameter. */
export function bold(s, isTTY = process.stdout.isTTY) {
  return isTTY ? `\x1b[1m${s}\x1b[0m` : s;
}

/** ANSI yellow, for non-fatal deprecation notices. See `dim` for why `isTTY` is a parameter. */
export function yellow(s, isTTY = process.stdout.isTTY) {
  return isTTY ? `\x1b[33m${s}\x1b[0m` : s;
}

/** ANSI red, for errors and per-account/app failures. See `dim` for why `isTTY` is a parameter. */
export function red(s, isTTY = process.stdout.isTTY) {
  return isTTY ? `\x1b[31m${s}\x1b[0m` : s;
}

// Single pass over rows rather than Math.max(...rows.map(...)) per column,
// which turns row count into Math.max's argument count and blows the call
// stack on large tables.
function computeWidths(headers, rows) {
  const widths = headers.map((h) => width(h));
  for (const row of rows) {
    for (let i = 0; i < widths.length; i++) {
      const w = width(row[i] ?? '');
      if (w > widths[i]) widths[i] = w;
    }
  }
  return widths;
}

// Per column: a border and the two spaces padding its cell. Plus one for the
// table's closing border. None of it can give, so only content widths do.
const CHROME_PER_COLUMN = 3;

/**
 * Takes one column off the widest column at a time until the table fits, so
 * the columns that overflow are the ones that pay — without this module
 * having to know which column holds an app name and which holds a date. A
 * column stops at its own header width: narrower than that and the column no
 * longer says what it holds, which is worse than a table that stays too wide.
 */
function fitWidths(widths, floors, maxWidth) {
  let total = widths.length * CHROME_PER_COLUMN + 1 + widths.reduce((sum, w) => sum + w, 0);

  while (total > maxWidth) {
    let widest = -1;
    for (let i = 0; i < widths.length; i++) {
      if (widths[i] <= floors[i]) continue;
      if (widest === -1 || widths[i] > widths[widest]) widest = i;
    }
    if (widest === -1) return;
    widths[widest]--;
    total--;
  }
}

export function renderTable(headers, rows, { isTTY = process.stdout.isTTY, maxWidth = null } = {}) {
  const widths = computeWidths(headers, rows);
  if (maxWidth !== null) fitWidths(widths, headers.map(width), maxWidth);
  const line = (l, m, r) => dim(l + widths.map((w) => '─'.repeat(w + 2)).join(m) + r, isTTY);

  const out = [];
  out.push(line('┌', '┬', '┐'));
  out.push(
    dim('│', isTTY) +
      headers.map((h, i) => ` ${bold(pad(h, widths[i]), isTTY)} `).join(dim('│', isTTY)) +
      dim('│', isTTY)
  );
  out.push(line('├', '┼', '┤'));
  for (const row of rows) {
    out.push(
      dim('│', isTTY) +
        row
          .map((c, i) => ` ${pad(truncate(c ?? '', widths[i]), widths[i])} `)
          .join(dim('│', isTTY)) +
        dim('│', isTTY)
    );
  }
  out.push(line('└', '┴', '┘'));
  return out.join('\n');
}
