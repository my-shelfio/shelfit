import { describe, expect, it } from 'vitest';
import {
  bold,
  dim,
  pad,
  red,
  renderTable,
  truncate,
  width,
  yellow,
} from '../../../src/shared/terminal/render.mjs';

// The width of a rendered table's widest line, which every line shares.
const tableWidth = (out) => Math.max(...out.split('\n').map(width));

describe('width', () => {
  it('counts ASCII as 1 column each', () => {
    expect(width('abc')).toBe(3);
  });

  it('counts Japanese (East Asian wide) characters as 2 columns', () => {
    expect(width('日本語')).toBe(6);
  });

  it('handles mixed ASCII and wide characters', () => {
    expect(width('ios日本')).toBe(3 + 4);
  });

  it('counts emoji as 2 columns', () => {
    expect(width('🚀')).toBe(2);
  });

  it('counts full-width punctuation as 2 columns', () => {
    expect(width('！')).toBe(2);
  });

  it('counts a ZWJ-joined emoji sequence (e.g. family emoji) as 2 columns, not per-component', () => {
    expect(width('👨‍👩‍👧')).toBe(2);
  });

  it('counts a variation-selector character the same as its base character', () => {
    expect(width('⚠️')).toBe(width('⚠'));
  });
});

describe('truncate', () => {
  it('returns the string untouched when it already fits', () => {
    expect(truncate('abc', 3)).toBe('abc');
    expect(truncate('日本', 4)).toBe('日本');
  });

  it('spends one column of the budget on the ellipsis', () => {
    expect(truncate('abcdef', 4)).toBe('abc\u2026');
    expect(width(truncate('abcdef', 4))).toBe(4);
  });

  it('never leaves half a wide character behind', () => {
    // Two columns per character, so an odd budget cannot be filled exactly —
    // the result must come in under it rather than split one.
    expect(truncate('日本語', 4)).toBe('日\u2026');
    expect(truncate('日本語', 5)).toBe('日本\u2026');
  });

  it('keeps a ZWJ-joined sequence whole', () => {
    expect(truncate('a👨‍👩‍👧b', 3)).toBe('a\u2026');
  });

  it('keeps a variation selector with the character it modifies', () => {
    expect(truncate('⚠️x', 1)).toBe('\u2026');
  });

  it.each([0, -1])('returns an empty string for a budget of %i', (maxWidth) => {
    expect(truncate('abc', maxWidth)).toBe('');
  });
});

describe('pad', () => {
  it('pads ASCII strings to the target width', () => {
    expect(pad('ab', 5)).toBe('ab   ');
  });

  it('accounts for wide-character width when padding', () => {
    expect(pad('日本', 6)).toBe('日本  ');
  });

  it('does not pad (or truncate) when already at/over width', () => {
    expect(pad('abcdef', 3)).toBe('abcdef');
  });
});

describe('dim / bold', () => {
  it('wraps text in ANSI codes when isTTY is true', () => {
    expect(dim('x', true)).toBe('\x1b[2mx\x1b[0m');
    expect(bold('x', true)).toBe('\x1b[1mx\x1b[0m');
  });

  it('returns plain text when isTTY is false', () => {
    expect(dim('x', false)).toBe('x');
    expect(bold('x', false)).toBe('x');
  });
});

describe('yellow / red', () => {
  it('wraps text in ANSI codes when isTTY is true', () => {
    expect(yellow('x', true)).toBe('\x1b[33mx\x1b[0m');
    expect(red('x', true)).toBe('\x1b[31mx\x1b[0m');
  });

  it('returns plain text when isTTY is false', () => {
    expect(yellow('x', false)).toBe('x');
    expect(red('x', false)).toBe('x');
  });
});

describe('renderTable', () => {
  it('computes column widths from headers and rows, non-TTY output has no ANSI codes', () => {
    const out = renderTable(['A', 'B'], [['1', '22']], { isTTY: false });
    expect(out.includes('\x1b[')).toBe(false);
    expect(out.split('\n')).toHaveLength(5); // top, header, sep, row, bottom
  });

  it('handles an empty row set', () => {
    const out = renderTable(['A', 'B'], [], { isTTY: false });
    expect(out.split('\n')).toHaveLength(4); // top, header, sep, bottom
  });

  it('widens columns to fit Japanese content', () => {
    const out = renderTable(['APP'], [['日本語アプリ']], { isTTY: false });
    const lines = out.split('\n');
    expect(lines.some((l) => l.includes('日本語アプリ'))).toBe(true);
  });

  it('treats missing cells as empty strings', () => {
    const out = renderTable(['A', 'B'], [['x', undefined]], { isTTY: false });
    expect(out).toContain('x');
  });

  it('does not throw RangeError on a large number of rows', () => {
    const rows = Array.from({ length: 200_000 }, (_, i) => [String(i)]);
    expect(() => renderTable(['A'], rows, { isTTY: false })).not.toThrow();
  });

  it('is unchanged by an unset maxWidth, however wide the content', () => {
    const headers = ['ACCOUNT', 'APP'];
    const rows = [['myorg', 'a'.repeat(120)]];
    expect(renderTable(headers, rows, { isTTY: false })).toBe(
      renderTable(headers, rows, { isTTY: false, maxWidth: null })
    );
  });

  it('fits the table into maxWidth', () => {
    const out = renderTable(['ACCOUNT', 'APP'], [['myorg', 'a'.repeat(120)]], {
      isTTY: false,
      maxWidth: 40,
    });
    expect(tableWidth(out)).toBeLessThanOrEqual(40);
    expect(out).toContain('\u2026');
  });

  it('takes the columns off the widest column, leaving narrower ones intact', () => {
    const out = renderTable(['ACCOUNT', 'APP'], [['myorg', 'a'.repeat(120)]], {
      isTTY: false,
      maxWidth: 40,
    });
    expect(out).toContain('myorg');
  });

  it('stops at the header widths rather than hiding what a column holds', () => {
    const headers = ['ACCOUNT', 'APP'];
    const out = renderTable(headers, [['myorg', 'storefront']], { isTTY: false, maxWidth: 1 });
    for (const header of headers) expect(out).toContain(header);
  });

  it('keeps every line the same width when a wide character cannot be split', () => {
    const out = renderTable(['APP'], [['日本語アプリ']], { isTTY: false, maxWidth: 10 });
    const lineWidths = new Set(out.split('\n').map(width));
    expect(lineWidths.size).toBe(1);
  });
});
