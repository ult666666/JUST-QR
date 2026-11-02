// JUST QR page logic. The QR encoder (qr.js, same origin) is imported on demand, so a failed
// load is reported beside the input instead of leaving the buttons without a handler.
let encoder;
let currentURL = '';
let generation = 0;
let toastTimeout;

const urlInput = document.getElementById('urlInput');
const urlError = document.getElementById('urlError');
const levelSelect = document.getElementById('level');
const outputArea = document.getElementById('outputArea');
const qrCodeEl = document.getElementById('qrCode');
const urlPreview = document.getElementById('urlPreview');
const toast = document.getElementById('toast');

/** Display size of the symbol in CSS pixels; modules are drawn at whole-pixel sizes. */
const SYMBOL_SIZE = 240;
/** White border added around downloaded and copied images, in pixels. */
const QUIET_ZONE = 40;

function loadEncoder() {
  encoder ??= import('./qr.js');
  return encoder;
}
loadEncoder().catch(() => {}); // Start early; a failure is reported when Generate is used.

urlInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') generateQR();
});
document.getElementById('generate').addEventListener('click', () => generateQR());
document.getElementById('download').addEventListener('click', downloadQR);
document.getElementById('copy').addEventListener('click', copyPNG);
document.getElementById('clear').addEventListener('click', resetAll);
levelSelect.addEventListener('change', () => {
  if (currentURL) generateQR();
});

/** Accepts HTTP(S) URLs, adding https:// when no scheme is given; returns undefined otherwise. */
function normalizeURL(input) {
  try {
    // A host with a port is schemeless; other explicit schemes must be HTTP(S).
    const hostWithPort = /^(?:localhost|[^\s/?#:@]+\.[^\s/?#:@]+):\d+(?:[/?#]|$)/i.test(input);
    const explicitScheme = /^[a-z][a-z\d+.-]*:/i.test(input);
    if (/[\s\\]/u.test(input) || (explicitScheme && !hostWithPort && !/^https?:\/\//i.test(input))) {
      return undefined;
    }
    const parsed = new URL(/^https?:\/\//i.test(input) ? input : 'https://' + input);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) {
      return undefined;
    }
    // Canonical escaping keeps the encoded bytes identical to what the browser would request.
    return parsed.href;
  } catch {
    return undefined;
  }
}

async function generateQR() {
  const run = ++generation;
  clearResult();
  clearError();
  clearToast();

  const input = urlInput.value.trim();
  if (!input) {
    showInputError('Enter a URL first.');
    return;
  }
  const url = normalizeURL(input);
  if (url === undefined) {
    showInputError('Enter a valid HTTP or HTTPS URL without spaces or embedded credentials.');
    return;
  }

  let qr;
  try {
    qr = await loadEncoder();
  } catch {
    encoder = undefined; // Let a later attempt retry the import.
    if (run === generation) {
      showInputError('The QR generator could not load. Check your connection and reload the page.');
    }
    return;
  }
  if (run !== generation) return; // A newer request replaced this one.

  const level = levelSelect.value;
  let symbol;
  try {
    symbol = qr.encodeQR(url, { level });
  } catch (error) {
    if (!(error instanceof qr.QRCapacityError)) throw error;
    showInputError(
      level === 'L'
        ? 'This URL is too long for a QR code. Shorten it and try again.'
        : 'This URL is too long for a QR code at this error correction level. Shorten it or choose a lower level, then try again.',
    );
    return;
  }

  qrCodeEl.replaceChildren(drawSymbol(symbol, url));
  currentURL = url;
  urlInput.value = url;
  urlPreview.textContent = url.length > 60 ? url.substring(0, 60) + '...' : url;
  outputArea.removeAttribute('inert');
  outputArea.classList.add('visible');
}

/**
 * Draws dark modules as whole-pixel squares, centred on a white canvas of at least 240 pixels.
 * Larger symbols get a larger canvas so that each module stays at least 2 pixels wide.
 */
function drawSymbol(symbol, url) {
  const scale = Math.max(2, Math.floor(SYMBOL_SIZE / symbol.size));
  const side = Math.max(SYMBOL_SIZE, symbol.size * scale);
  const offset = Math.floor((side - symbol.size * scale) / 2);
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `QR code for ${url}`);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, side, side);
  ctx.fillStyle = '#0a0a0a';
  for (let row = 0; row < symbol.size; row++) {
    for (let column = 0; column < symbol.size; column++) {
      if (symbol.modules[row * symbol.size + column]) {
        ctx.fillRect(offset + column * scale, offset + row * scale, scale, scale);
      }
    }
  }
  return canvas;
}

function clearResult() {
  currentURL = '';
  qrCodeEl.replaceChildren();
  urlPreview.textContent = '';
  outputArea.classList.remove('visible');
  outputArea.setAttribute('inert', '');
}

function clearError() {
  urlError.textContent = '';
  urlError.hidden = true;
  urlInput.setAttribute('aria-invalid', 'false');
}

function showInputError(message) {
  clearResult();
  urlError.textContent = message;
  urlError.hidden = false;
  urlInput.setAttribute('aria-invalid', 'true');
}

function exportCanvas() {
  const canvas = qrCodeEl.querySelector('canvas');
  if (!canvas) {
    showToast('Generate a QR code first');
    return null;
  }
  const size = canvas.width + QUIET_ZONE * 2;
  const padded = document.createElement('canvas');
  padded.width = size;
  padded.height = size;
  const ctx = padded.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(canvas, QUIET_ZONE, QUIET_ZONE);
  return padded;
}

function downloadQR() {
  const canvas = exportCanvas();
  if (!canvas) return;
  const link = document.createElement('a');
  const safeName = currentURL
    .replace(/^https?:\/\//, '')
    .replace(/[^a-zA-Z0-9]/g, '_')
    .substring(0, 30);
  link.download = `qr_${safeName}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
  showToast('PNG downloaded');
}

async function copyPNG() {
  const canvas = exportCanvas();
  if (!canvas) return;
  try {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('PNG encoding failed');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    showToast('Copied to clipboard');
  } catch {
    showToast('Copy failed. Try download instead.');
  }
}

function resetAll() {
  generation++;
  urlInput.value = '';
  clearResult();
  clearError();
  clearToast();
  urlInput.focus();
}

function clearToast() {
  clearTimeout(toastTimeout);
  toast.classList.remove('show');
  toast.textContent = '';
}

function showToast(message) {
  clearTimeout(toastTimeout);
  toast.textContent = message;
  toast.classList.add('show');
  toastTimeout = setTimeout(() => toast.classList.remove('show'), 2000);
}

urlInput.focus();
