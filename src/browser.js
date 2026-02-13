/**
 * ReDD 2FA — Minimal browser API shim
 *
 * Zero-dependency replacement for webextension-polyfill.
 * In MV3, both Chrome and Firefox support promise-based APIs natively.
 * This shim simply normalises the global to `browser` for consistency.
 *
 * - Firefox/Safari: already expose `browser.*`
 * - Chrome/Edge:    expose `chrome.*` (which returns Promises in MV3)
 */

// Use the native `browser` global if it exists (Firefox, Safari),
// otherwise fall back to `chrome` (Chrome, Edge).
const _browser =
    typeof globalThis.browser !== 'undefined'
        ? globalThis.browser
        : typeof globalThis.chrome !== 'undefined'
            ? globalThis.chrome
            : undefined;

export default _browser;
