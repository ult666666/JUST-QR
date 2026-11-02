# Testing JUST QR

## Run the tests

With Node.js 20 or newer and Python 3 installed:

```sh
npm ci
npx playwright install chromium --only-shell
npm test
```

`npm test` runs 27 Playwright tests in three files. The test server listens on port 8096; set
`QR_TEST_PORT` to use another port.

## What each file checks

[`tests/encoder.spec.mjs`](../tests/encoder.spec.mjs) runs in Node, without a browser. It checks
the encoder against published examples: the ISO/IEC 18004 Annex I Reed-Solomon example, and the
format, version, mask-penalty and full-symbol ("ABCDEF" at level H) vectors from
[zxing's encoder tests](https://github.com/zxing/zxing/tree/master/core/src/test/java/com/google/zxing/qrcode/encoder).
It also:

- compares the error correction block table, alignment positions and byte capacities with
  qrcodejs's copies;
- fills version 40 to its published maximum in every mode and level;
- decodes random numeric, alphanumeric, ASCII and Unicode texts across more than 30 versions, all
  levels and forced masks with [jsQR](https://github.com/cozmo/jsQR);
- checks that the chosen mask has the lowest penalty.

[`tests/differential.spec.mjs`](../tests/differential.spec.mjs) runs
[qrcodejs](https://github.com/davidshimjs/qrcodejs) 1.0.0, the library the page used to load (now
only a development dependency), in Chromium. It encodes 123 random ASCII texts, up to each level's
capacity. qrcodejs refuses 3 of them (see below). The other 120 span 38 versions, and every symbol
matches qr.js module for module once both use qrcodejs's mask and version.

The two encoders can differ in two legitimate ways:

| Difference | Why | Cases |
| --- | --- | --- |
| Mask | qrcodejs scores masks with its own rules, not the standard's. qr.js's choice never scored worse under the standard's rules. | 83 of 120 |
| Version | qrcodejs adds 3 bytes to every length, because its UTF-8 helper compares a number with a string, so near a capacity boundary it uses one version more. | 8 of 120 |

[`tests/qr.spec.mjs`](../tests/qr.spec.mjs) drives the page in Chromium: generation, invalid and
oversized input recovery, Enter and Clear, Unicode URLs, the error-correction selector, an
unavailable encoder, clipboard failure, and a check that the page requests nothing from another
origin and the Content Security Policy reports no violations. It decodes the downloaded and copied
PNGs with jsQR and checks every pixel of their white quiet zones. Only the operating-system
clipboard is replaced with a stub.

## Bugs found in the reference libraries

The tests found two errors in the libraries they use as references. Both are recorded as tests.

- qrcodejs's block table for version 15-H lists 11 blocks instead of 18. It refuses URLs of about
  195 to 220 bytes at level H with "code length overflow", so the old page reported them as too
  long. qr.js encodes them.
- jsQR 1.4.0 puts version 23's fourth alignment pattern at 74 instead of 78 (Annex E). It cannot
  read version 23 symbols at level L, where error correction cannot absorb the misread modules.

## Continuous integration

The [QR checks workflow](../.github/workflows/qr.yml) runs these tests for pull requests to
`main`, pushes to `main` and manual runs, with Node.js 24 and Python 3.13. It installs the pinned
test dependencies without package install scripts, then runs headless Chromium. It has read-only
permissions and no deployment steps.

## Manual walkthrough

1. Serve the folder with `python3 -m http.server 8000` and open `http://localhost:8000`.
2. Generate `example.com/docs`. The preview shows the normalized HTTPS URL.
3. Try `not a URL` or `ftp://example.com/file`. An error appears under the input and the previous
   code is cleared.
4. Try a valid but oversized URL, for example `https://example.com/?q=` followed by 2,000 `a`
   characters. The page asks you to shorten it.
5. Generate `https://example.com/recovered`. The error disappears. Download the PNG or copy it;
   both have the same white border.
