// Differential test: the encoder against qrcodejs 1.0.0 (the library the page used to load),
// in Chromium. Both encode the same ASCII text in byte mode at the same level; qrcodejs's mask
// is read from its format information and given to qr.js, and the symbols must then match
// module for module. Where the two pick different masks, qrcodejs's penalty score is not the
// standard's, so qr.js's choice must score at least as well under the standard's rules.
// qrcodejs also adds 3 bytes to every length (its UTF-8 helper compares a number with a string,
// `replacedText.length != sText`, which is always true), so near a version's capacity it moves
// up one version; those symbols are compared at qrcodejs's version.
import { test, expect } from '@playwright/test';

test('matches qrcodejs module for module across versions and levels', async ({ page }) => {
  test.setTimeout(120_000);
  const origin = new URL(test.info().project.use.baseURL).origin;
  await page.route('**/*', (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
  );
  // qrcodejs's own demo page from node_modules: it loads qrcode.js and has no CSP.
  await page.goto('/node_modules/qrcodejs/index.html');
  await page.addScriptTag({ url: '/node_modules/jsqr/dist/jsQR.js' });
  const report = await page.evaluate(async () => {
    const own = await import('/qr.js');
    let seed = 2006;
    const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    const capacity = { L: 2953, M: 2331, Q: 1663, H: 1273 };
    const cases = [];
    for (const level of ['L', 'M', 'Q', 'H']) {
      for (let i = 0; i < 30; i++) cases.push([level, 1 + Math.floor(next() * capacity[level])]);
    }
    for (const length of [195, 205, 220]) cases.push(['H', length]); // version 15-H
    const result = { compared: 0, versions: new Set(), maskDiffers: 0, worseThanOurs: 0, refused: [], mismatches: [], larger: [] };
    const byteCapacity = (version, level) => Math.floor((own.dataCodewords(version, level) * 8 - 4 - (version <= 9 ? 8 : 16)) / 8);
    for (const [level, length] of cases) {
      const text = Array.from({ length }, () => String.fromCharCode(32 + Math.floor(next() * 95))).join('');
      let model;
      try {
        const holder = document.createElement('div');
        model = new QRCode(holder, { text, width: 64, height: 64, correctLevel: QRCode.CorrectLevel[level] })._oQRCode;
      } catch (error) {
        const symbol = own.encodeQR(text, { level, mode: 'byte' });
        const side = (symbol.size + 8) * 3;
        const pixels = new Uint8ClampedArray(side * side * 4).fill(255);
        symbol.modules.forEach((dark, i) => {
          if (!dark) return;
          const [row, column] = [Math.floor(i / symbol.size), i % symbol.size];
          for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) pixels.fill(0, (((row + 4) * 3 + y) * side + (column + 4) * 3 + x) * 4, (((row + 4) * 3 + y) * side + (column + 4) * 3 + x) * 4 + 3);
        });
        result.refused.push({ level, length, error: String(error), ownVersion: symbol.version, decoded: jsQR(pixels, side, side)?.data === text });
        continue;
      }
      const size = model.getModuleCount();
      const dark = (row, column) => (model.isDark(row, column) ? 1 : 0);
      // First copy of the format information, least significant bit first.
      const at = [[0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [7, 8], [8, 8], [8, 7], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0]];
      const format = at.reduce((bits, [row, column], i) => bits | (dark(row, column) << i), 0);
      const mask = ((format ^ 0x5412) >> 10) & 7;
      const version = (size - 17) / 4;
      const smallest = own.encodeQR(text, { level, mode: 'byte' }).version;
      if (smallest !== version) {
        result.larger.push({ explained: version === smallest + 1 && length + 3 > byteCapacity(smallest, level) });
      }
      const ours = own.encodeQR(text, { level, mode: 'byte', mask, minVersion: version, maxVersion: version });
      result.compared++;
      result.versions.add(ours.version);
      let differences = 0;
      for (let row = 0; row < size; row++) {
        for (let column = 0; column < size; column++) {
          if (ours.modules[row * size + column] !== dark(row, column)) differences++;
        }
      }
      if (ours.size !== size || differences > 0) result.mismatches.push({ level, length, differences, size, ourSize: ours.size });
      const automatic = own.encodeQR(text, { level, mode: 'byte' });
      if (automatic.mask !== mask) {
        result.maskDiffers++;
        if (automatic.penalty.total > ours.penalty.total) result.worseThanOurs++;
      }
    }
    return { ...result, versions: [...result.versions].sort((a, b) => a - b) };
  });
  console.log(JSON.stringify({ ...report, versions: report.versions.length, larger: report.larger.length }));
  expect(report.mismatches).toEqual([]);
  // Every version difference is qrcodejs's 3-byte allowance at a capacity boundary.
  expect(report.larger.every((entry) => entry.explained)).toBe(true);
  expect(report.compared).toBeGreaterThanOrEqual(115);
  expect(report.versions.length).toBeGreaterThanOrEqual(30);
  // qr.js's automatic mask never scores worse under the standard's rules than qrcodejs's.
  expect(report.worseThanOurs).toBe(0);
  // qrcodejs refuses exactly the version 15-H inputs (its block table is short there);
  // qr.js encodes them at version 15 and jsQR reads them back.
  expect(report.refused.length).toBeGreaterThan(0);
  for (const refusal of report.refused) {
    expect(refusal).toMatchObject({ level: 'H', ownVersion: 15, decoded: true });
    expect(refusal.error).toMatch(/code length overflow/);
  }
});
