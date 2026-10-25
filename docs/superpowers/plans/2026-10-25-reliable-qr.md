# Reliable QR Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover from invalid/oversized URLs with useful accessible errors and export the same padded PNG through download and clipboard.

**Architecture:** Keep production in `index.html`, add validation/error and shared-export helpers. Add development-only Playwright tests with the exact pinned qrcodejs bytes served locally, PNG decoding and a clipboard boundary double.

**Tech Stack:** Static HTML/CSS/JavaScript; Node test runner + Playwright Chromium; jsQR and pngjs for independent PNG checks.

**Spec:** `docs/superpowers/specs/2026-10-25-reliable-qr-design.md`

## Global Constraints

- The product remains a single static page.
- Production dependencies and the current appearance stay in place.
- Both PNG actions share the existing 40-pixel white padding.
- No arbitrary new lower data limit.
- No merge, deployment or publication.

## Review Focus

- Explicit non-web schemes and malformed hosts must not become misleading HTTPS payloads.
- An earlier valid result must not remain exportable after a failed new generation.
- Capacity errors must be caught regardless of the library's exception wording.
- Clipboard denial/null blobs must give actionable feedback without uncaught errors.
- Non-ASCII URLs and URL punctuation must encode the shown normalized payload.

### Task 1: Recoverable generation and consistent PNG exports

**Files:** Modify `index.html`, `README.md`; create `package.json`, `package-lock.json`, `playwright.config.mjs`, `tests/qr.spec.mjs`, `.gitignore`.

**Interfaces:** Existing global `generateQR()`, `downloadQR()`, `copyPNG()`, `resetAll()` stay callable from HTML. Add private `exportCanvas()` returning the padded canvas or null; errors belong to one inline message associated with the input.

- [x] Write real-browser tests for malformed input, repeated errors, oversized input and recovery, missing QR script, normalized Unicode URL, Clear/Enter, export decoding/white border equality, clipboard rejection/null blob.
- [x] Run `npm test` before production edits. Expected: generation-error and padded-clipboard assertions fail against the original source; baseline valid download decoding succeeds.
- [x] Implement minimal URL validation and inline error state; catch generator failure and clear stale QR/output state.
- [x] Share the padded canvas between PNG download and clipboard; handle null blobs and unavailable clipboard.
- [x] Run `npm test`. Expected: every Chromium scenario passes, no page errors in recovered flows.
- [x] Update README with exact setup/test commands and a short invalid → long → valid → download/copy scenario; document HTTP(S) URL scope and clipboard constraints.
- [x] Run `npm ci && npm test` and `git diff --check`; inspect the final diff; commit with `fix: recover QR generation errors and pad clipboard exports`.

### Task 2: Run the browser scenarios in read-only CI

**Files:** Create `.github/workflows/qr.yml`; modify `README.md`.

**Interfaces:** Reuse `npm test` and the existing pinned Playwright dependencies. No product behavior changes.

- [x] Add push/pull-request triggers for `main` and manual dispatch, `contents: read`, an eight-minute timeout, checkout without persisted credentials, and the trusted immutable checkout/setup-node/setup-python pins from the portfolio workflow.
- [x] Configure Node 24/Python 3.13 setup, script-free `npm ci`, headless Chromium installation with system dependencies, and `npm test`; add no deployment or credential steps.
- [x] Document the actual nine scenarios in CI without a live-pass claim.
- [x] Validate with the existing actionlint binary, rerun all nine browser tests, and check the diff; commit/push to the existing draft PR.
After pushing, read exact-head CI checks through the Code Review connector and report the head for parent review before merge.
