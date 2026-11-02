# JUST QR

Turn a web link into a QR code in your browser. No ads, no login, no analytics.

**[Open JUST QR](https://ult666666.github.io/JUST-QR/)**

![JUST QR showing a generated code for github.com/ult666666/JUST-QR](docs/screenshot.png)

## Try it

Paste a link and press Enter or **Generate**. A missing `https://` is added for you. Then
download the code as a PNG, or copy it and paste it into a document or chat.

To run it locally, serve the folder. Browsers do not load JavaScript modules from `file://`
pages, so opening `index.html` directly does not work.

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## What it does

- Error correction defaults to level H, so a code still scans with about 30% of it damaged or
  covered. Levels L, M and Q make smaller codes and fit longer links.
- Downloads and copies are the same PNG: the code with a 40-pixel white border (the quiet zone
  that scanners need), 320 × 320 pixels for typical links. Longer links get a larger image, so
  each module stays at least 2 pixels wide. The file is named after the link, for example
  `qr_github_com_ult666666_JUST_QR.png`.
- If the browser blocks image copying, the page suggests downloading instead.
- An invalid link, or one too long for a QR code, shows an error under the input and clears the
  previous code, so a stale code cannot be exported by mistake.
- The page has no backend, and the link you enter never leaves your browser. It loads nothing
  from other sites, and its Content Security Policy only allows scripts from its own origin.

## How it works

The page is four files and has no build step: [`index.html`](index.html), [`style.css`](style.css),
[`app.js`](app.js) for the page logic and [`qr.js`](qr.js) for the encoder.

`qr.js` is a dependency-free ES module that follows ISO/IEC 18004:2015 (QR Code Model 2). It
supports versions 1 to 40, error correction levels L, M, Q and H, and numeric, alphanumeric and
byte (UTF-8) modes. It computes Reed-Solomon error correction over GF(256), interleaves the
blocks, adds the BCH-coded format and version information, and tries all eight data masks,
keeping the one with the lowest penalty under the standard's four rules. It picks the smallest
version that holds the data. Its structure follows the standard's sections and two public
walkthroughs: [Thonky's QR Code Tutorial](https://www.thonky.com/qr-code-tutorial/) and
[Nayuki's step-by-step guide](https://www.nayuki.io/page/creating-a-qr-code-step-by-step).

`app.js` accepts HTTP and HTTPS links, including localhost, IP addresses and ports. It rejects
other schemes, internal whitespace, backslashes and embedded credentials, and it never fetches a
link to check it. The encoded URL uses the browser's canonical escaping, so Unicode paths work.
Modules are drawn on a canvas as whole-pixel squares, so exports stay sharp. Copying uses the
asynchronous Clipboard API with a PNG `ClipboardItem`.

The Content Security Policy is `default-src 'none'; script-src 'self'; style-src 'self';
img-src 'self'; base-uri 'none'; form-action 'none'`. There are no inline scripts, styles or
event handlers.

## Tests

With Node.js 20 or newer and Python 3:

```sh
npm ci
npx playwright install chromium --only-shell
npm test
```

`npm test` runs 27 Playwright tests. They check the encoder against the standard's worked
example and zxing's test vectors, compare 120 random symbols module for module with qrcodejs (the
library the page used before), and drive the page in Chromium, decoding every exported PNG with
jsQR. Along the way they found a wrong block table in qrcodejs and a misplaced alignment pattern in
jsQR. [docs/TESTING.md](docs/TESTING.md) describes each test file, both bugs, the CI workflow and a
manual walkthrough.

## Limits

- Each code holds one segment: no mixed modes, ECI headers, Kanji, Micro QR or structured append.
- The page must be served over HTTP, because modules do not load from `file://`.
- Copying an image needs a browser that supports the Clipboard API and grants permission,
  normally on HTTPS or localhost. Download always works.
- Long links make dense codes. Scan-test an exported code before you print it.

Built with AI coding assistants. I reviewed the code and the tests that check it.

## License

[MIT](LICENSE)
