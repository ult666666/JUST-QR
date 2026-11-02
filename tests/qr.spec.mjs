import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

// The page and its encoder are served from this folder. Any request to another origin is recorded
// and aborted, so tests need no network. Page errors and CSP violations are collected.
async function openApp(page, { missingLibrary = false } = {}) {
  const origin = new URL(test.info().project.use.baseURL).origin;
  const pageErrors = [];
  const external = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    if (/Content Security Policy|Refused to/i.test(message.text())) pageErrors.push(message.text());
  });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin && !(missingLibrary && url.pathname === '/qr.js')) return route.continue();
    if (url.origin !== origin) external.push(url.href);
    return route.abort();
  });
  await page.goto('/');
  page.externalRequests = external;
  return pageErrors;
}

async function generate(page, value, enter = false) {
  await page.getByRole('textbox', { name: 'URL to encode' }).fill(value);
  if (enter) await page.getByRole('textbox', { name: 'URL to encode' }).press('Enter');
  else await page.getByRole('button', { name: 'Generate', exact: true }).click();
}

function checkPNG(bytes, payload, { size = 320 } = {}) {
  const png = PNG.sync.read(bytes);
  if (size !== null) expect(png.width).toBe(size);
  expect(png.height).toBe(png.width);
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      if (x >= 40 && x < png.width - 40 && y >= 40 && y < png.height - 40) continue;
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
  await page.getByRole('button', { name: 'Copy image' }).click();
  await expect(page.getByRole('status')).toHaveText('Copied to clipboard');
  return Buffer.from(await page.evaluate(() => window.copiedPNG));
}

test('the page loads nothing from another origin and a CSP allows only its own scripts', async ({ page }) => {
  expect(html).not.toMatch(/<script[^>]+src="(?:https?:)?\/\//i);
  expect(html).not.toMatch(/<(?:link|img|iframe|source)[^>]+(?:href|src)="(?:https?:)?\/\//i);
  expect(html).toContain("script-src 'self'");
  expect(html).not.toMatch(/onclick=|style="/i);
  const errors = await openApp(page);
  await generate(page, 'example.com/csp');
  checkPNG((await downloadPNG(page)).bytes, 'https://example.com/csp');
  // Nothing is requested from another origin.
  expect(page.externalRequests).toEqual([]);
  expect(errors).toEqual([]);
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

test('error correction level is selectable and a lower level fits a longer URL', async ({ page }) => {
  const errors = await openApp(page);
  const level = page.getByRole('combobox', { name: 'Error correction' });
  await expect(level).toHaveValue('H');
  const long = `https://example.com/?q=${'a'.repeat(1400)}`;
  await generate(page, long);
  await expect(page.getByRole('alert')).toContainText(/lower level/i);
  await level.selectOption('L');
  await generate(page, long);
  await expect(page.getByRole('alert')).toHaveCount(0);
  const large = checkPNG((await downloadPNG(page)).bytes, long, { size: null });
  expect(large.width).toBeGreaterThan(320);
  // Changing the level regenerates the shown code; a short URL keeps the 320-pixel export.
  await generate(page, 'example.com/levels');
  const sizes = {};
  for (const value of ['L', 'M', 'Q', 'H']) {
    await level.selectOption(value);
    await expect(page.locator('#qrCode canvas')).toHaveCount(1);
    checkPNG((await downloadPNG(page)).bytes, 'https://example.com/levels');
    sizes[value] = await page.locator('#qrCode canvas').evaluate(canvas => canvas.width);
  }
  expect(Object.values(sizes)).toEqual([240, 240, 240, 240]);
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
  await page.getByRole('button', { name: 'Copy image' }).click();
  await expect(page.getByRole('status')).toContainText(/download/i);
  // Some browsers can fail PNG encoding with a null blob.
  await page.evaluate(() => {
    HTMLCanvasElement.prototype.toBlob = callback => callback(null);
  });
  await page.getByRole('button', { name: 'Copy image' }).click();
  await expect(page.getByRole('status')).toContainText(/download/i);
  expect(errors).toEqual([]);
});
