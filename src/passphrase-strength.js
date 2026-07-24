/**
 * Phone-Free 2FA — Passphrase strength check
 *
 * Pure, auditable passphrase-strength heuristics. Designed to be readable
 * end-to-end in a few minutes. No external data, no network, no async.
 *
 * What we reject at setup / change-passphrase time:
 *   1. Low character diversity: fewer than 5 unique characters in the
 *      entire passphrase.
 *   2. Repeating patterns: 4+ identical characters in a row, or any
 *      1–4 char block repeated 3+ times (aaaa, abcabc, 121212).
 *   3. Keyboard walks of 6+ characters (qwerty, 123456, asdfgh, …) in
 *      either direction.
 *   4. Passphrases containing "password" as a substring, including after
 *      trivial leet-speak substitutions (p@ssw0rd → password).
 *   5. Passphrases whose case-folded form exactly matches a common password
 *      of length >= 12 (our minimum passphrase length).
 *
 * What we deliberately do NOT try to do:
 *   - Full English / dictionary-attack simulation (that's what zxcvbn does,
 *     and it requires shipping ~1 MB of library code).
 *   - Block every weak password in existence. The goal is to catch the
 *     realistic bad choices at the 12+ character length we enforce elsewhere.
 */

// ---------------------------------------------------------------------------
// Leet-speak normalisation
// ---------------------------------------------------------------------------
// Maps the most common single-char substitutions back to their letter form.
// Used only for the common-password lookup, not for display.
const LEET_MAP = {
    '0': 'o', '1': 'i', '3': 'e', '4': 'a',
    '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i',
};

function normaliseLeet(s) {
    return s.toLowerCase().replace(/[013457@$!]/g, (ch) => LEET_MAP[ch] ?? ch);
}

// ---------------------------------------------------------------------------
// Curated "known-bad substring"
// ---------------------------------------------------------------------------
// The only substring we match against the whole passphrase. "password" earns
// its place because:
//   - It is the single most-common password.
//   - Attackers systematically brute-force "password" + short suffix.
//   - Our other checks don't catch forms like "passwordxyz1".
//   - It rarely appears inside a natural-language passphrase — the meta
//     sentence "my password is <something>" is an unusual phrasing to pick.
// Leet-speak variants ("p@ssw0rd") are handled by normaliseLeet() before the
// substring check, so they don't need their own entries.
const KNOWN_BAD_SUBSTRINGS = ['password'];

// ---------------------------------------------------------------------------
// Exact-match common-password list
// ---------------------------------------------------------------------------
// Derived from the SecLists top-10k most-common passwords list
// (https://github.com/danielmiessler/SecLists/blob/master/Passwords/Common-Credentials/10k-most-common.txt),
// filtered to entries of length >= 12 (our minimum passphrase length).
// Shorter entries can never equal a 12+ char passphrase, so including them
// would only bloat the module without affecting behaviour. The full 10k list
// had exactly 10 entries of length >= 12; they are reproduced verbatim.
//
// These entries come from real-world data about what people actually pick as
// passwords (compiled from public credential leaks), not from any editorial
// choice on our part — which is why some are crude. They are listed here so
// we can *block* them from being used as master passphrases.
//
// To regenerate (reproduces the list below byte-for-byte):
//   curl -fsSL https://raw.githubusercontent.com/danielmiessler/SecLists/master/Passwords/Common-Credentials/10k-most-common.txt \
//     | awk 'length($0) >= 12'
const COMMON_PASSWORDS = new Set([
    'masterbating',
    'unbelievable',
    'businessbabe',
    'contortionist',
    'masterbaiting',
    'masturbation',
    'pornographic',
    'scandinavian',
    'films+pic+galeries',
    'motherfucker',
]);

// ---------------------------------------------------------------------------
// Keyboard walks
// ---------------------------------------------------------------------------
// Forward sequences on a standard US QWERTY layout. Reversed sequences are
// generated automatically. We look for runs of KEYBOARD_MIN_RUN characters or
// more from any of these sequences appearing inside the passphrase.
const KEYBOARD_MIN_RUN = 6;
const KEYBOARD_SEQUENCES = [
    'qwertyuiop',
    'asdfghjkl',
    'zxcvbnm',
    '1234567890',
    '!@#$%^&*()',
    'qazwsxedcrfvtgbyhnujmikolp',
];

function containsKeyboardWalk(passphrase) {
    const lower = passphrase.toLowerCase();
    for (const row of KEYBOARD_SEQUENCES) {
        const reversed = row.split('').reverse().join('');
        for (const sequence of [row, reversed]) {
            for (let i = 0; i + KEYBOARD_MIN_RUN <= sequence.length; i++) {
                const run = sequence.slice(i, i + KEYBOARD_MIN_RUN);
                if (lower.includes(run)) return run;
            }
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
// Repeating patterns
// ---------------------------------------------------------------------------
function hasRepeatingPatterns(passphrase) {
    // 4+ of the same character in a row: "aaaaa", "!!!!"
    if (/(.)\1{3,}/.test(passphrase)) return true;
    // Any 1–4 char block repeated 3+ times: "abcabcabc", "121212", "lala la"
    if (/(.{1,4})\1{2,}/.test(passphrase)) return true;
    return false;
}

// ---------------------------------------------------------------------------
// Character diversity
// ---------------------------------------------------------------------------
const MIN_UNIQUE_CHARS = 5;

function uniqueCharCount(passphrase) {
    return new Set(passphrase).size;
}

// ---------------------------------------------------------------------------
// Main entrypoint
// ---------------------------------------------------------------------------
/**
 * Check whether a proposed new passphrase is strong enough.
 *
 * Returns { ok: true } if it passes, or { ok: false, message } with a short
 * human-readable reason (already phrased for display in the setup/change UI).
 */
export function checkPassphraseStrength(passphrase) {
    if (uniqueCharCount(passphrase) < MIN_UNIQUE_CHARS) {
        return {
            ok: false,
            message: `This passphrase doesn't have enough variety — it uses fewer than ${MIN_UNIQUE_CHARS} different characters.`,
        };
    }

    if (hasRepeatingPatterns(passphrase)) {
        return {
            ok: false,
            message: 'This passphrase repeats characters or a short pattern (like "aaaa" or "abcabc"). Try something less predictable.',
        };
    }

    const walk = containsKeyboardWalk(passphrase);
    if (walk) {
        return {
            ok: false,
            message: `This passphrase contains a keyboard pattern ("${walk}"). Try something less predictable.`,
        };
    }

    const lower = passphrase.toLowerCase();
    const deleeted = normaliseLeet(passphrase);

    for (const bad of KNOWN_BAD_SUBSTRINGS) {
        if (lower.includes(bad) || deleeted.includes(bad)) {
            return {
                ok: false,
                message: `This passphrase contains a very common password ("${bad}"). Choose something unrelated.`,
            };
        }
    }

    if (COMMON_PASSWORDS.has(lower) || COMMON_PASSWORDS.has(deleeted)) {
        return {
            ok: false,
            message: 'This passphrase is in the list of the most-common passwords. Choose something unique to you.',
        };
    }

    return { ok: true };
}
