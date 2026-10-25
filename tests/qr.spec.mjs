import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';

const library = await readFile(new URL('../node_modules/qrcodejs/qrcode.min.js', import.meta.url));
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

// The production CDN asset is fulfilled with the identical real bytes, never a QR stub.
async function openApp(page, { missingLibrary = false } = {}) {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith('http://127.0.0.1:8096/')) return route.continue();
    if (url === 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js' && !missingLibrary) {
      return route.fulfill({
        body: library,
        contentType: 'application/javascript',
        headers: { 'access-control-allow-origin': '*' },
      });
    }
    return route.abort(); // No fonts or other external network dependency in tests.
  });
  await page.goto('/');
  return pageErrors;
}

async function generate(page, value, enter = false) {
  await page.getByRole('textbox', { name: 'URL to encode' }).fill(value);
  if (enter) await page.getByRole('textbox', { name: 'URL to encode' }).press('Enter');
  else await page.getByRole('button', { name: 'Generate', exact: true }).click();
}

function checkPNG(bytes, payload) {
  const png = PNG.sync.read(bytes);
  expect(png.width).toBe(320);
  expect(png.height).toBe(320);
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      if (x >= 40 && x < 280 && y >= 40 && y < 280) continue;
      const offset = (y * png.width + x) * 4;
      if (!png.data.subarray(offset, offset + 4).equals(Buffer.from([255, 255, 255, 255]))) {
        throw new Error(`The quiet zone is not opaque white at ${x},${y}`);
      }
    }
  }
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  expect(decoded?.data).toBe(payload);
  return png;
}

async function downloadPNG(page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PNG' }).click();
  const download = await pending;
  return { bytes: await readFile(await download.path()), name: download.suggestedFilename() };
}

async function captureClipboard(page) {
  // Replace only the OS clipboard boundary. ClipboardItem and PNG blobs are real.
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        async write(items) {
          const blob = await items[0].getType('image/png');
          window.copiedPNG = Array.from(new Uint8Array(await blob.arrayBuffer()));
        },
      },
    });
  });
  await page.getByRole('button', { name: 'Copy to Clipboard' }).click();
  await expect(page.getByRole('status')).toHaveText('Copied to clipboard');
  return Buffer.from(await page.evaluate(() => window.copiedPNG));
}

test('local QR fixture matches the page SRI pin', () => {
  const actual = createHash('sha512').update(library).digest('base64');
  expect(html).toContain(`integrity="sha512-${actual}"`);
});

test('Enter generates a real downloadable QR for a schemeless URL', async ({ page }) => {
  const errors = await openApp(page);
  await generate(page, 'example.com/docs?from=qr#start', true);
  await expect(page.locator('#urlPreview')).toHaveText('https://example.com/docs?from=qr#start');
  const { bytes, name } = await downloadPNG(page);
  checkPNG(bytes, 'https://example.com/docs?from=qr#start');
  expect(name).toMatch(/^qr_example_com_docs_from_qr_start\.png$/);
  expect(errors).toEqual([]);
});

test('invalid URLs show one persistent field error and clear stale output, then recover', async ({ page }) => {
  const errors = await openApp(page);
  await generate(page, 'example.com/old');
  const input = page.getByRole('textbox', { name: 'URL to encode' });
  for (const invalid of ['not a URL', 'javascript:alert(1)', 'ftp://example.com/file', 'https://', 'https://user:password@example.com/', 'https://exa mple.com']) {
    await generate(page, invalid);
    const alert = page.getByRole('alert');
    await expect(alert).toHaveCount(1);
    await expect(alert).toContainText(/valid|http|credentials/i);
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    expect((await input.getAttribute('aria-describedby'))?.split(/\s+/)).toContain(await alert.getAttribute('id'));
    await expect(page.locator('#outputArea')).not.toHaveClass(/visible/);
    await expect(page.locator('#qrCode canvas')).toHaveCount(0);
  }
  // Field errors survive the short-lived toast interval.
  await page.waitForTimeout(2200);
  await expect(page.getByRole('alert')).toBeVisible();
  await generate(page, 'https://example.com/recovered');
  await expect(input).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('alert')).toHaveCount(0);
  checkPNG((await downloadPNG(page)).bytes, 'https://example.com/recovered');
  expect(errors).toEqual([]);
});

test('empty input explains the problem and Clear resets a recovered result', async ({ page }) => {
  const errors = await openApp(page);
  await generate(page, '');
  await expect(page.getByRole('alert')).toContainText(/enter.*url/i);
  await generate(page, 'example.com');
  await downloadPNG(page);
  await expect(page.getByRole('status')).toHaveText('PNG downloaded');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'URL to encode' })).toHaveValue('');
  await expect(page.getByRole('textbox', { name: 'URL to encode' })).toBeFocused();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('status')).toBeEmpty();
  await expect(page.locator('#qrCode canvas')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('real QR capacity failure is explained without page errors and a valid retry works', async ({ page }) => {
  const errors = await openApp(page);
  await generate(page, 'example.com/before');
  await generate(page, `https://example.com/?q=${'a'.repeat(2000)}`);
  await expect(page.getByRole('alert')).toContainText(/too long|shorten/i);
  await expect(page.locator('#outputArea')).not.toHaveClass(/visible/);
  await expect(page.locator('#qrCode canvas')).toHaveCount(0);
  await generate(page, 'https://example.com/after');
  await expect(page.getByRole('alert')).toHaveCount(0);
  checkPNG((await downloadPNG(page)).bytes, 'https://example.com/after');
  expect(errors).toEqual([]);
});

test('clipboard PNG has the same decoded URL and full quiet zone as download', async ({ page }) => {
  const errors = await openApp(page);
  await generate(page, 'example.com/share');
  const downloaded = checkPNG((await downloadPNG(page)).bytes, 'https://example.com/share');
  const copied = checkPNG(await captureClipboard(page), 'https://example.com/share');
  expect(copied.data.equals(downloaded.data)).toBe(true);
  expect(errors).toEqual([]);
});

test('canonical Unicode URL and a localhost port generate usable QR payloads', async ({ page }) => {
  const errors = await openApp(page);
  for (const [input, expected] of [
    ['https://example.com/café?next=%2Fdocs#menu', 'https://example.com/caf%C3%A9?next=%2Fdocs#menu'],
    ['localhost:8000/path', 'https://localhost:8000/path'],
    ['http://127.0.0.1:3000/', 'http://127.0.0.1:3000/'],
  ]) {
    await generate(page, input);
    await expect(page.locator('#urlPreview')).toHaveText(expected);
    checkPNG((await downloadPNG(page)).bytes, expected);
  }
  expect(errors).toEqual([]);
});

test('missing QR library gives an actionable error', async ({ page }) => {
  const errors = await openApp(page, { missingLibrary: true });
  await generate(page, 'https://example.com');
  await expect(page.getByRole('alert')).toContainText(/load|unavailable|connection/i);
  await expect(page.locator('#qrCode canvas')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('clipboard denial and empty PNG give download guidance without page errors', async ({ page }) => {
  const errors = await openApp(page);
  await generate(page, 'example.com');
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { write: async () => { throw new DOMException('Denied', 'NotAllowedError'); } },
  }));
  await page.getByRole('button', { name: 'Copy to Clipboard' }).click();
  await expect(page.getByRole('status')).toContainText(/download/i);
  // Some browsers can fail PNG encoding with a null blob.
  await page.evaluate(() => {
    HTMLCanvasElement.prototype.toBlob = callback => callback(null);
  });
  await page.getByRole('button', { name: 'Copy to Clipboard' }).click();
  await expect(page.getByRole('status')).toContainText(/download/i);
  expect(errors).toEqual([]);
});
