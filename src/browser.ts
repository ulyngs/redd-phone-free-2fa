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

/* eslint-disable @typescript-eslint/no-explicit-any */

// Use the native `browser` global if it exists (Firefox, Safari),
// otherwise fall back to `chrome` (Chrome, Edge).
const _browser: any =
    typeof (globalThis as any).browser !== 'undefined'
        ? (globalThis as any).browser
        : typeof (globalThis as any).chrome !== 'undefined'
            ? (globalThis as any).chrome
            : undefined;

export default _browser;
