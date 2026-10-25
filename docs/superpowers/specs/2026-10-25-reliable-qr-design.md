# Reliable URL QR generation

The product remains a single static page. A user pastes an HTTP(S) URL, generates a
QR code, then downloads or copies a scannable PNG. Invalid or oversized input must
explain what to fix without leaving a blank/stale result or an uncaught exception.
The next valid generation must clear the error and restore export actions.

Use the browser URL parser after adding `https://` to schemeless input. Reject
non-HTTP(S) schemes, missing/invalid hosts, whitespace and embedded credentials.
Allow localhost, IP addresses, ports, IDNs, query strings and fragments. Use the
browser's canonical URL form for the preview and QR payload, including Unicode
escaping; this also avoids the library's reproduced non-ASCII byte-count failure.
Render errors inline with `aria-invalid` and `aria-describedby`; do not rely on a
two-second toast. Clear prior QR output on an error so export cannot use stale data.

Catch the real QR library's generation failure (its oversized-input exception is
not a stable public type). Give a shortening suggestion for too-long payloads and
a separate unavailable-generator message if the CDN has failed. No arbitrary new
lower data limit. Both PNG actions share the existing 40-pixel white padding.

Approaches: keep inline JS and add small helpers (chosen: smallest reviewable patch);
extract a module (unnecessary for this size); replace the generator/framework
(outside scope). Production dependencies and the current appearance stay in place.
The task owner authorized inline execution without a clarification loop.

Validation uses Chromium, the exact CDN library bytes, real canvases, decoded PNG
payloads and full 40-pixel border checks. Only clipboard permission/failure is
simulated; QR generation, canvas encoding and PNG decoding remain real. Include
repeated invalid attempts, valid recovery, missing generator, clipboard failure,
Enter submission, Clear, and non-ASCII URL payloads.
