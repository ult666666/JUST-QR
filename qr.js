/**
 * QR Code encoder (Model 2) following ISO/IEC 18004:2015, written for JUST QR with no
 * dependencies. It covers versions 1 to 40, error correction levels L, M, Q and H, numeric,
 * alphanumeric and byte (UTF-8) data, Reed-Solomon error correction over GF(256) with block
 * interleaving, BCH-coded format and version information, and all eight data masks chosen by
 * the standard's four penalty rules.
 *
 * Section names below follow the standard: data encodation, error correction (Table 9 gives the
 * block structure), codeword placement, data masking (mask conditions and penalty scores),
 * format information (Annex C), version information (Annex D) and alignment pattern positions
 * (Annex E). Public walkthroughs that follow the same structure: Thonky's QR Code Tutorial
 * (https://www.thonky.com/qr-code-tutorial/) and Nayuki's "Creating a QR Code step by step"
 * (https://www.nayuki.io/page/creating-a-qr-code-step-by-step).
 */

export const ERROR_CORRECTION_LEVELS = ['L', 'M', 'Q', 'H'];

/** Two-bit error correction level indicators used in format information. */
const LEVEL_BITS = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };

/** Table 9: error correction codewords per block, for versions 1 to 40. */
export const ECC_CODEWORDS_PER_BLOCK = {
  L: [7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28,
    28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26,
    26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30,
    28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28,
    30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};

/** Table 9: number of error correction blocks, for versions 1 to 40. */
export const ERROR_CORRECTION_BLOCKS = {
  L: [1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8,
    8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16,
    17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20,
    23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25,
    25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};

/** Mode indicators and character count lengths for versions 1-9, 10-26 and 27-40. */
const MODES = {
  numeric: { indicator: 0b0001, countBits: [10, 12, 14] },
  alphanumeric: { indicator: 0b0010, countBits: [9, 11, 13] },
  byte: { indicator: 0b0100, countBits: [8, 16, 16] },
};
const ALPHANUMERIC_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

/** Penalty weights N1 to N4 of the data masking evaluation. */
const N1 = 3;
const N2 = 3;
const N3 = 40;
const N4 = 10;

/** Thrown when the text does not fit in any allowed version at the chosen level. */
export class QRCapacityError extends Error {
  constructor(message) {
    super(message);
    this.name = 'QRCapacityError';
  }
}

// GF(256) with the primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11D) and generator 2.
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
for (let i = 0, value = 1; i < 255; i++) {
  EXP[i] = value;
  LOG[value] = i;
  value <<= 1;
  if (value & 0x100) value ^= 0x11d;
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];

/** Product of two field elements. */
export function gfMultiply(a, b) {
  return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];
}

/**
 * Coefficients of the generator polynomial (x - α^0)(x - α^1)…(x - α^(degree-1)), highest
 * power first; the leading coefficient is 1.
 */
export function reedSolomonGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMultiply(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** The error correction codewords: the remainder of data · x^degree divided by the generator. */
export function reedSolomonRemainder(data, generator) {
  const degree = generator.length - 1;
  const remainder = new Array(degree).fill(0);
  for (const codeword of data) {
    const factor = codeword ^ remainder.shift();
    remainder.push(0);
    for (let i = 0; i < degree; i++) remainder[i] ^= gfMultiply(generator[i + 1], factor);
  }
  return remainder;
}

/** Format information: level and mask, BCH(15,5) with generator 0x537, XOR 0x5412 (Annex C). */
export function formatBits(level, mask) {
  const data = (LEVEL_BITS[level] << 3) | mask;
  let remainder = data;
  for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  return ((data << 10) | remainder) ^ 0x5412;
}

/** Version information for versions 7 to 40: BCH(18,6) with generator 0x1F25 (Annex D). */
export function versionBits(version) {
  let remainder = version;
  for (let i = 0; i < 12; i++) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
  return (version << 12) | remainder;
}

/** Row and column centres of the alignment patterns (Annex E), computed rather than tabled. */
export function alignmentPositions(version) {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const positions = [6];
  for (let position = version * 4 + 10; positions.length < count; position -= step) {
    positions.splice(1, 0, position);
  }
  return positions;
}

/** Modules left for codewords: everything but function patterns, format and version info. */
export function rawDataModules(version) {
  let modules = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const count = Math.floor(version / 7) + 2;
    modules -= (25 * count - 10) * count - 55;
    if (version >= 7) modules -= 36;
  }
  return modules;
}

/** Data codewords of a version and level: all codewords minus error correction. */
export function dataCodewords(version, level) {
  const blocks = ERROR_CORRECTION_BLOCKS[level][version - 1];
  return Math.floor(rawDataModules(version) / 8) - ECC_CODEWORDS_PER_BLOCK[level][version - 1] * blocks;
}

/** The mode the whole text can use most compactly: numeric, alphanumeric or byte. */
export function chooseMode(text) {
  if (text !== '' && /^[0-9]*$/.test(text)) return 'numeric';
  if (text !== '' && /^[0-9A-Z $%*+\-./:]*$/.test(text)) return 'alphanumeric';
  return 'byte';
}

/** The data bits of one segment (without mode indicator and count) and its character count. */
function segmentBits(text, mode) {
  const bits = [];
  const put = (value, length) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  if (mode === 'numeric') {
    for (let i = 0; i < text.length; i += 3) {
      const group = text.slice(i, i + 3);
      put(Number(group), group.length * 3 + 1);
    }
    return { bits, count: text.length };
  }
  if (mode === 'alphanumeric') {
    for (let i = 0; i < text.length; i += 2) {
      const first = ALPHANUMERIC_CHARSET.indexOf(text[i]);
      if (i + 1 < text.length) put(first * 45 + ALPHANUMERIC_CHARSET.indexOf(text[i + 1]), 11);
      else put(first, 6);
    }
    return { bits, count: text.length };
  }
  const bytes = new TextEncoder().encode(text);
  for (const byte of bytes) put(byte, 8);
  return { bits, count: bytes.length };
}

/**
 * Encodes text as a QR Code symbol.
 *
 * Options: `level` ('L', 'M', 'Q' or 'H', default 'M'), `mode` ('auto' or a mode name), `mask`
 * (0-7 to force one; by default the lowest penalty wins, ties to the lower number), and
 * `minVersion`/`maxVersion` (1-40). The smallest version that holds the data is used.
 *
 * Returns `{ version, level, mode, mask, size, modules, penalty }`, where `modules` is a
 * row-major Uint8Array of `size × size` (1 = dark), without the quiet zone.
 * @throws {QRCapacityError} if the text does not fit; TypeError or RangeError for bad options.
 */
export function encodeQR(text, options = {}) {
  const { level = 'M', mode: requested = 'auto', mask: forcedMask } = options;
  const { minVersion = 1, maxVersion = 40 } = options;
  if (typeof text !== 'string') throw new TypeError('The text to encode must be a string');
  if (!ERROR_CORRECTION_LEVELS.includes(level)) throw new RangeError(`Unknown error correction level "${level}"`);
  if (!(Number.isInteger(minVersion) && Number.isInteger(maxVersion) && minVersion >= 1 && maxVersion <= 40 && minVersion <= maxVersion)) {
    throw new RangeError('Versions must be integers with 1 <= minVersion <= maxVersion <= 40');
  }
  if (forcedMask !== undefined && !(Number.isInteger(forcedMask) && forcedMask >= 0 && forcedMask <= 7)) {
    throw new RangeError('The mask must be an integer from 0 to 7');
  }
  const mode = requested === 'auto' ? chooseMode(text) : requested;
  if (!Object.hasOwn(MODES, mode)) throw new RangeError(`Unknown mode "${mode}"`);
  if (mode !== 'byte' && chooseMode(text) === 'byte') throw new RangeError(`The text cannot use ${mode} mode`);
  if (mode === 'numeric' && chooseMode(text) !== 'numeric') throw new RangeError('The text cannot use numeric mode');

  const segment = segmentBits(text, mode);
  let version = minVersion;
  for (; version <= maxVersion; version++) {
    const countBits = MODES[mode].countBits[version <= 9 ? 0 : version <= 26 ? 1 : 2];
    const needed = 4 + countBits + segment.bits.length;
    if (segment.count < 2 ** countBits && needed <= dataCodewords(version, level) * 8) break;
  }
  if (version > maxVersion) {
    throw new QRCapacityError(`The text needs more than version ${maxVersion} holds at level ${level}`);
  }
  const codewords = interleave(dataCodewordsFor(segment, mode, version, level), version, level);
  return place(codewords, version, level, mode, forcedMask);
}

/** Mode indicator, count, data, terminator, bit padding and pad codewords 0xEC/0x11. */
function dataCodewordsFor(segment, mode, version, level) {
  const capacity = dataCodewords(version, level) * 8;
  const bits = [];
  const put = (value, length) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  put(MODES[mode].indicator, 4);
  put(segment.count, MODES[mode].countBits[version <= 9 ? 0 : version <= 26 ? 1 : 2]);
  bits.push(...segment.bits);
  put(0, Math.min(4, capacity - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  const bytes = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    bytes.push(byte);
  }
  for (let pad = 0xec; bytes.length < capacity / 8; pad ^= 0xec ^ 0x11) bytes.push(pad);
  return bytes;
}

/** Splits data into blocks, adds error correction to each and interleaves them. */
function interleave(data, version, level) {
  const blockCount = ERROR_CORRECTION_BLOCKS[level][version - 1];
  const eccLength = ECC_CODEWORDS_PER_BLOCK[level][version - 1];
  const total = Math.floor(rawDataModules(version) / 8);
  const shortBlocks = blockCount - (total % blockCount);
  const shortLength = Math.floor(total / blockCount) - eccLength;
  const generator = reedSolomonGenerator(eccLength);
  const blocks = [];
  for (let b = 0, offset = 0; b < blockCount; b++) {
    const length = shortLength + (b < shortBlocks ? 0 : 1);
    const blockData = data.slice(offset, offset + length);
    offset += length;
    blocks.push({ data: blockData, ecc: reedSolomonRemainder(blockData, generator) });
  }
  const result = [];
  for (let i = 0; i <= shortLength; i++) {
    for (const block of blocks) if (i < block.data.length) result.push(block.data[i]);
  }
  for (let i = 0; i < eccLength; i++) for (const block of blocks) result.push(block.ecc[i]);
  return result;
}

/** Whether the mask condition inverts the module at (row, column). */
export function maskApplies(mask, row, column) {
  switch (mask) {
    case 0: return (row + column) % 2 === 0;
    case 1: return row % 2 === 0;
    case 2: return column % 3 === 0;
    case 3: return (row + column) % 3 === 0;
    case 4: return (Math.floor(row / 2) + Math.floor(column / 3)) % 2 === 0;
    case 5: return ((row * column) % 2) + ((row * column) % 3) === 0;
    case 6: return (((row * column) % 2) + ((row * column) % 3)) % 2 === 0;
    default: return (((row + column) % 2) + ((row * column) % 3)) % 2 === 0;
  }
}

/** Draws function patterns, places codewords, picks the mask and writes format information. */
function place(codewords, version, level, mode, forcedMask) {
  const size = version * 4 + 17;
  const modules = new Uint8Array(size * size);
  const reserved = new Uint8Array(size * size);
  const set = (row, column, dark) => {
    modules[row * size + column] = dark ? 1 : 0;
    reserved[row * size + column] = 1;
  };
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [row, column] of [[3, 3], [3, size - 4], [size - 4, 3]]) {
    for (let dr = -4; dr <= 4; dr++) {
      for (let dc = -4; dc <= 4; dc++) {
        const r = row + dr;
        const c = column + dc;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        const ring = Math.max(Math.abs(dr), Math.abs(dc));
        set(r, c, ring !== 2 && ring !== 4);
      }
    }
  }
  const positions = alignmentPositions(version);
  const last = positions.length - 1;
  positions.forEach((row, i) => {
    positions.forEach((column, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) set(row + dr, column + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
      }
    });
  });
  drawFormat(set, size, formatBits(level, 0));
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      set(Math.floor(i / 3), size - 11 + (i % 3), dark);
      set(size - 11 + (i % 3), Math.floor(i / 3), dark);
    }
  }

  // Codewords run in two-module columns from the bottom right, upward then downward,
  // skipping the vertical timing pattern; leftover remainder bits stay light.
  let bit = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (const column of [right, right - 1]) {
        if (reserved[row * size + column] || bit >= codewords.length * 8) continue;
        modules[row * size + column] = (codewords[bit >>> 3] >>> (7 - (bit & 7))) & 1;
        bit++;
      }
    }
  }

  const apply = (mask) => {
    for (let row = 0; row < size; row++) {
      for (let column = 0; column < size; column++) {
        if (!reserved[row * size + column] && maskApplies(mask, row, column)) modules[row * size + column] ^= 1;
      }
    }
    drawFormat(set, size, formatBits(level, mask));
  };
  let mask = forcedMask;
  let penalty;
  if (mask === undefined) {
    for (let candidate = 0; candidate < 8; candidate++) {
      apply(candidate);
      const score = penaltyScore(modules, size);
      if (penalty === undefined || score.total < penalty.total) {
        mask = candidate;
        penalty = score;
      }
      apply(candidate); // XOR again to undo
    }
  }
  apply(mask);
  penalty ??= penaltyScore(modules, size);
  return { version, level, mode, mask, size, modules, penalty };
}

/** Writes both copies of the 15 format bits and the dark module (bit 0 is the least significant). */
function drawFormat(set, size, bits) {
  const bitAt = (i) => ((bits >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) set(i, 8, bitAt(i));
  set(7, 8, bitAt(6));
  set(8, 8, bitAt(7));
  set(8, 7, bitAt(8));
  for (let i = 9; i < 15; i++) set(8, 14 - i, bitAt(i));
  for (let i = 0; i < 8; i++) set(8, size - 1 - i, bitAt(i));
  for (let i = 8; i < 15; i++) set(size - 15 + i, 8, bitAt(i));
  set(size - 8, 8, true);
}

/**
 * The four penalty rules of data masking, for a row-major `size × size` module array:
 * N1, runs of five or more same-colored modules in a row or column (3 + run − 5 each); N2,
 * 2×2 same-colored blocks (3 each); N3, the finder-like pattern 1011101 with four light
 * modules on either side, inside the symbol (40 each); N4, 10 for each full 5% that the dark
 * share deviates from 50%.
 */
export function penaltyScore(modules, width) {
  const height = modules.length / width;
  const at = (row, column) => modules[row * width + column];
  let n1 = 0;
  let n2 = 0;
  let n3 = 0;
  const lines = [];
  for (let row = 0; row < height; row++) lines.push(Array.from({ length: width }, (_, c) => at(row, c)));
  for (let column = 0; column < width; column++) lines.push(Array.from({ length: height }, (_, r) => at(r, column)));
  for (const line of lines) {
    for (let start = 0; start < line.length; ) {
      let end = start;
      while (end < line.length && line[end] === line[start]) end++;
      if (end - start >= 5) n1 += N1 + (end - start - 5);
      start = end;
    }
    for (let x = 0; x + 7 <= line.length; x++) {
      if (line[x] !== 1 || line[x + 1] !== 0 || line[x + 2] !== 1 || line[x + 3] !== 1) continue;
      if (line[x + 4] !== 1 || line[x + 5] !== 0 || line[x + 6] !== 1) continue;
      const light = (from, to) => from >= 0 && to <= line.length && line.slice(from, to).every((m) => m === 0);
      if (light(x - 4, x) || light(x + 7, x + 11)) n3 += N3;
    }
  }
  for (let row = 0; row + 1 < height; row++) {
    for (let column = 0; column + 1 < width; column++) {
      const color = at(row, column);
      if (color === at(row, column + 1) && color === at(row + 1, column) && color === at(row + 1, column + 1)) n2 += N2;
    }
  }
  const dark = modules.reduce((sum, module) => sum + module, 0);
  const n4 = Math.floor((Math.abs(dark * 2 - modules.length) * 10) / modules.length) * N4;
  return { n1, n2, n3, n4, total: n1 + n2 + n3 + n4 };
}
