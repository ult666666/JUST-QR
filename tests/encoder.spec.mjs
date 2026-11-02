// Encoder checks that run in Node (no browser): published test vectors, the standard's tables
// cross-checked against qrcodejs's independent copies, and decoding with jsQR.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import jsQR from 'jsqr';
import {
  ECC_CODEWORDS_PER_BLOCK,
  ERROR_CORRECTION_BLOCKS,
  ERROR_CORRECTION_LEVELS,
  QRCapacityError,
  alignmentPositions,
  dataCodewords,
  encodeQR,
  formatBits,
  gfMultiply,
  penaltyScore,
  rawDataModules,
  reedSolomonGenerator,
  reedSolomonRemainder,
  versionBits,
} from '../qr.js';

function random(seed) {
  let state = seed >>> 0;
  return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

/** Renders a symbol with a 4-module quiet zone as RGBA pixels and decodes it with jsQR. */
function decode(symbol, scale = 3) {
  const side = (symbol.size + 8) * scale;
  const pixels = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let row = 0; row < symbol.size; row++) {
    for (let column = 0; column < symbol.size; column++) {
      if (!symbol.modules[row * symbol.size + column]) continue;
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          const offset = (((row + 4) * scale + y) * side + (column + 4) * scale + x) * 4;
          pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0;
        }
      }
    }
  }
  return jsQR(pixels, side, side);
}

// qrcodejs 1.0.0 (a devDependency, never loaded by the page) carries its own copy of the
// standard's tables; parse them from its source as an independent reference.
const qrcodejs = await readFile(new URL('../node_modules/qrcodejs/qrcode.js', import.meta.url), 'utf8');
const table = (pattern) => JSON.parse(qrcodejs.match(pattern)[1]);
const RS_BLOCK_TABLE = table(/RS_BLOCK_TABLE=(\[\[.*?\]\]);/);
const PATTERN_POSITION_TABLE = table(/PATTERN_POSITION_TABLE:(\[\[.*?\]\]),G15/);
const BYTE_CAPACITY = table(/QRCodeLimitLength=(\[\[.*?\]\]);/);

test.describe('Reed-Solomon over GF(256)', () => {
  test('matches the ISO/IEC 18004 Annex I example and a second zxing vector', () => {
    expect(gfMultiply(0x80, 2)).toBe(0x1d); // x^8 reduces by 0x11D
    expect(
      reedSolomonRemainder([0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11], reedSolomonGenerator(10)),
    ).toEqual([0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55]);
    expect(
      reedSolomonRemainder(
        [0x72, 0x67, 0x2f, 0x77, 0x69, 0x6b, 0x69, 0x2f, 0x4d, 0x61, 0x69, 0x6e, 0x5f, 0x50, 0x61, 0x67,
          0x65, 0x3b, 0x3b, 0x00, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11],
        reedSolomonGenerator(18),
      ),
    ).toEqual([0xd8, 0xb8, 0xef, 0x14, 0xec, 0xd0, 0xcc, 0x85, 0x73, 0x40, 0x0b, 0xb5, 0x5a, 0xb8, 0x8b, 0x2e, 0x08, 0x62]);
  });

  test('produces codewords whose polynomial vanishes at every generator root', () => {
    const next = random(7);
    for (const degree of [7, 10, 17, 22, 30]) {
      const data = Array.from({ length: 20 }, () => Math.floor(next() * 256));
      const codeword = [...data, ...reedSolomonRemainder(data, reedSolomonGenerator(degree))];
      for (let root = 0; root < degree; root++) {
        let alpha = 1;
        for (let i = 0; i < root; i++) alpha = gfMultiply(alpha, 2);
        const value = codeword.reduce((sum, c) => gfMultiply(sum, alpha) ^ c, 0); // Horner
        expect(value).toBe(0);
      }
    }
  });
});

test.describe('BCH format and version information', () => {
  test('matches the published format examples (Annex C; zxing and JIS X 0510)', () => {
    const remainder = (level, mask) => (formatBits(level, mask) ^ 0x5412) & 0x3ff;
    expect(remainder('M', 5)).toBe(0xdc); // data 00101
    expect(remainder('H', 3)).toBe(0x1c2); // data 10011
    expect(remainder('Q', 3)).toBe(0x214); // data 11011
    expect(formatBits('M', 5).toString(2).padStart(15, '0')).toBe('100000011001110');
  });

  test('keeps every pair of the 32 format words at least 7 bits apart', () => {
    const words = ERROR_CORRECTION_LEVELS.flatMap((level) => [0, 1, 2, 3, 4, 5, 6, 7].map((mask) => formatBits(level, mask)));
    const distance = (a, b) => [...(a ^ b).toString(2)].filter((bit) => bit === '1').length;
    for (const a of words) for (const b of words) if (a !== b) expect(distance(a, b)).toBeGreaterThanOrEqual(7);
  });

  test('matches the published version examples (Annex D; zxing)', () => {
    expect(versionBits(7).toString(2).padStart(18, '0')).toBe('000111110010010100');
    const expected = { 7: 0xc94, 8: 0x5bc, 9: 0xa99, 10: 0x4d3, 20: 0x9a6, 30: 0xd75, 40: 0xc69 };
    for (const [version, remainder] of Object.entries(expected)) {
      expect(versionBits(Number(version)) & 0xfff).toBe(remainder);
    }
  });
});

test.describe('data masking penalties (zxing MaskUtil test cases)', () => {
  const score = (rows) => penaltyScore(Uint8Array.from(rows.flat()), rows[0].length);
  test('rule 1: runs of five or more', () => {
    expect(score([[0, 0, 0, 0]]).n1).toBe(0);
    expect(score([[0, 0, 0, 0, 0, 1]]).n1).toBe(3);
    expect(score([[0, 0, 0, 0, 0, 0]]).n1).toBe(4);
    expect(score([[0], [0], [0], [0], [0], [1]]).n1).toBe(3);
    expect(score([[0], [0], [0], [0], [0], [0]]).n1).toBe(4);
  });
  test('rule 2: 2x2 blocks', () => {
    expect(score([[0]]).n2).toBe(0);
    expect(score([[0, 0], [0, 1]]).n2).toBe(0);
    expect(score([[0, 0], [0, 0]]).n2).toBe(3);
    expect(score([[0, 0, 0], [0, 0, 0], [0, 0, 0]]).n2).toBe(12);
  });
  test('rule 3: 1:1:3:1:1 with four light modules on one side', () => {
    expect(score([[0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1]]).n3).toBe(40);
    expect(score([[1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0]]).n3).toBe(40);
    expect(score([[1, 0, 1, 1, 1, 0, 1]]).n3).toBe(0);
    expect(score([[0], [0], [0], [0], [1], [0], [1], [1], [1], [0], [1]]).n3).toBe(40);
    expect(score([[1], [0], [1], [1], [1], [0], [1]]).n3).toBe(0);
  });
  test('rule 4: dark share in 5% steps', () => {
    expect(score([[0]]).n4).toBe(100);
    expect(score([[1, 0]]).n4).toBe(0);
    expect(score([[0, 1, 1, 1, 1, 0]]).n4).toBe(30);
  });
});

test('reproduces zxing\'s published symbol for "ABCDEF" at level H, mask included', () => {
  const expected = [
  '111111101111001111111',
  '100000100111001000001',
  '101110100101101011101',
  '101110101110101011101',
  '101110100111001011101',
  '100000100100001000001',
  '111111101010101111111',
  '000000000010100000000',
  '001011101100110001001',
  '101110010001010000000',
  '001100101000101010110',
  '110101011101010000010',
  '001101111000101011110',
  '000000001001110101000',
  '111111100010101100001',
  '100000101111010111101',
  '101110101011010100001',
  '101110100110111101010',
  '101110101000101011101',
  '100000100110110100011',
  '111111100000000010101',
  ];
  const symbol = encodeQR('ABCDEF', { level: 'H' });
  expect([symbol.version, symbol.mode, symbol.mask]).toEqual([1, 'alphanumeric', 0]);
  const rows = Array.from({ length: 21 }, (_, r) => Array.from(symbol.modules.slice(r * 21, r * 21 + 21)).join(''));
  expect(rows).toEqual(expected);
});

test.describe('the standard\'s tables', () => {
  test('match qrcodejs\'s block table, alignment positions and byte capacities', () => {
    for (let version = 1; version <= 40; version++) {
      expect(alignmentPositions(version)).toEqual(PATTERN_POSITION_TABLE[version - 1]);
      ERROR_CORRECTION_LEVELS.forEach((level, l) => {
        // qrcodejs orders levels L, M, Q, H; entries are [count, total, data, (count, total, data)].
        const row = RS_BLOCK_TABLE[(version - 1) * 4 + l];
        if (version === 15 && level === 'H') {
          // qrcodejs lists only [11, 36, 12] here, 396 codewords where version 15 holds 655;
          // Table 9 has 11 blocks of (36, 12) and 7 of (37, 13).
          expect(row).toEqual([11, 36, 12]);
          expect(row[0] * row[1]).toBeLessThan(Math.floor(rawDataModules(15) / 8));
          expect([ERROR_CORRECTION_BLOCKS.H[14], ECC_CODEWORDS_PER_BLOCK.H[14]]).toEqual([18, 24]);
          expect(11 * 36 + 7 * 37).toBe(Math.floor(rawDataModules(15) / 8));
          return;
        }
        const blocks = row[0] + (row[3] ?? 0);
        expect(ERROR_CORRECTION_BLOCKS[level][version - 1]).toBe(blocks);
        expect(ECC_CODEWORDS_PER_BLOCK[level][version - 1]).toBe(row[1] - row[2]);
        expect(dataCodewords(version, level)).toBe(row[0] * row[2] + (row[3] ?? 0) * (row[5] ?? 0));
        const countBits = version <= 9 ? 8 : 16;
        expect(Math.floor((dataCodewords(version, level) * 8 - 4 - countBits) / 8)).toBe(BYTE_CAPACITY[version - 1][l]);
      });
      const [count, total, , count2 = 0, total2 = 0] = RS_BLOCK_TABLE[(version - 1) * 4];
      expect(Math.floor(rawDataModules(version) / 8)).toBe(count * total + count2 * total2);
    }
  });

  test('fill version 40 exactly: the published maximum fits and one more character does not', () => {
    const maxima = { L: [7089, 4296, 2953], M: [5596, 3391, 2331], Q: [3993, 2420, 1663], H: [3057, 1852, 1273] };
    for (const [level, [numeric, alphanumeric, bytes]] of Object.entries(maxima)) {
      for (const [mode, length, char] of [['numeric', numeric, '7'], ['alphanumeric', alphanumeric, 'A'], ['byte', bytes, 'a']]) {
        expect(encodeQR(char.repeat(length), { level, mode }).version).toBe(40);
        expect(() => encodeQR(char.repeat(length + 1), { level, mode })).toThrow(QRCapacityError);
      }
    }
  });
});

test('decodes with jsQR across all versions, levels, modes and masks', () => {
  const next = random(18004);
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
  const unicode = ['é', 'ß', 'ж', '中', '✓', '😀', 'a', '/', '?'];
  const seen = new Set();
  let decoded = 0;
  for (let i = 0; i < 160; i++) {
    const level = ERROR_CORRECTION_LEVELS[i % 4];
    const kind = ['numeric', 'alphanumeric', 'ascii', 'unicode'][Math.floor(i / 4) % 4];
    const length = 1 + Math.floor(next() ** 2 * (kind === 'numeric' ? 3000 : kind === 'unicode' ? 300 : 1200));
    const pick = (chars) => chars[Math.floor(next() * chars.length)];
    const text = Array.from({ length }, () =>
      kind === 'numeric' ? pick('0123456789') : kind === 'alphanumeric' ? pick(alphabet) : kind === 'ascii' ? String.fromCharCode(32 + Math.floor(next() * 95)) : pick(unicode),
    ).join('');
    let symbol;
    try {
      symbol = encodeQR(text, { level, mask: i % 3 === 0 ? i % 8 : undefined });
    } catch (error) {
      expect(error).toBeInstanceOf(QRCapacityError);
      continue;
    }
    // jsQR 1.4.0 misplaces an alignment pattern at version 23 (see the next test); at level L
    // the resulting errors exceed what Reed-Solomon can correct. The qrcodejs comparison
    // checks those symbols instead.
    if (symbol.version === 23 && level === 'L') continue;
    const result = decode(symbol);
    expect(result?.data, `${level} v${symbol.version} ${symbol.mode} mask ${symbol.mask}`).toBe(text);
    expect(result?.version).toBe(symbol.version);
    seen.add(symbol.version);
    decoded++;
  }
  expect(decoded).toBeGreaterThan(120);
  expect(seen.size).toBeGreaterThan(30);
});

test('jsQR 1.4.0 has one alignment position wrong (version 23), which only level L cannot absorb', async () => {
  const source = await readFile(new URL('../node_modules/jsqr/dist/jsQR.js', import.meta.url), 'utf8');
  const centers = [...source.matchAll(/versionNumber: (\d+),\s*alignmentPatternCenters: (\[[^\]]*\])/g)];
  expect(centers).toHaveLength(40);
  const differing = centers.filter(([, version, list]) => JSON.stringify(alignmentPositions(Number(version))) !== list.replace(/\s/g, ''));
  expect(differing.map(([, version, list]) => [version, list])).toEqual([['23', '[6, 30, 54, 74, 102]']]);
  expect(alignmentPositions(23)).toEqual([6, 30, 54, 78, 102]); // Annex E, and qrcodejs agrees
  const text = 'https://example.com/' + 'x'.repeat(20);
  for (const level of ERROR_CORRECTION_LEVELS) {
    const symbol = encodeQR(text, { level, minVersion: 23, maxVersion: 23 });
    expect(decode(symbol)?.data === text, level).toBe(level !== 'L');
  }
});

test('picks the mask with the lowest penalty, ties to the lower number', () => {
  for (const text of ['https://example.com/', 'HELLO WORLD', '01234567', 'x'.repeat(300)]) {
    for (const level of ERROR_CORRECTION_LEVELS) {
      const chosen = encodeQR(text, { level });
      const scores = [0, 1, 2, 3, 4, 5, 6, 7].map((mask) => encodeQR(text, { level, mask }).penalty.total);
      expect(chosen.penalty.total).toBe(Math.min(...scores));
      expect(chosen.mask).toBe(scores.indexOf(Math.min(...scores)));
    }
  }
});

test('rejects invalid options', () => {
  expect(() => encodeQR('a', { level: 'X' })).toThrow(RangeError);
  expect(() => encodeQR('a', { mask: 8 })).toThrow(RangeError);
  expect(() => encodeQR('a', { minVersion: 0 })).toThrow(RangeError);
  expect(() => encodeQR('abc', { mode: 'numeric' })).toThrow(RangeError);
  expect(() => encodeQR('abc', { mode: 'alphanumeric' })).toThrow(RangeError);
  expect(() => encodeQR(42)).toThrow(TypeError);
  expect(() => encodeQR('ABCDEF', { level: 'H', maxVersion: 1, mode: 'byte', minVersion: 1 })).not.toThrow();
  expect(() => encodeQR('x'.repeat(20), { level: 'H', maxVersion: 1 })).toThrow(QRCapacityError);
});
