# JUST QR

A minimal QR code generator that runs entirely in your browser. No ads, no login, no analytics.

**[Open JUST QR](https://ult666666.github.io/JUST-QR/)**

![JUST QR showing a generated code for github.com/ult666666/JUST-QR](docs/screenshot.png)

## Features

- **Paste and go.** Type or paste a URL and press Enter or **Generate**. A missing `https://` is added for you.
- **Scans reliably.** Codes use error-correction level H, so they still scan with roughly 30% of the symbol damaged or covered.
- **Download PNG.** Exports the code with a white quiet zone around it, named after the URL, for example `qr_github_com_ult666666_JUST_QR.png`.
- **Copy to clipboard.** Copies the image itself, ready to paste into a document or chat. If the browser blocks image copying, it suggests downloading instead.
- **Private by design.** There is no backend: the URL you enter never leaves your browser. The page loads only the QR library and its fonts from public CDNs.

## Run it locally

It's a single static file. Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## How it works

[`index.html`](index.html) holds the markup, styles and about 90 lines of JavaScript.

- **Rendering:** codes come from [qrcodejs](https://github.com/davidshimjs/qrcodejs) 1.0.0, loaded from cdnjs with a Subresource Integrity hash, so the browser refuses a tampered copy.
- **Download:** redraws the code onto a padded canvas and saves it as a PNG.
- **Copy:** uses the asynchronous Clipboard API with a PNG `ClipboardItem`.
