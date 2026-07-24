/**
 * Phone-Free 2FA — TOTP engine
 *
 * Pure Web Crypto API implementation — no external dependencies.
 * Implements RFC 6238 (TOTP) and RFC 4226 (HOTP).
 */

// ========================================
// Base32 Decoding
// ========================================
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input) {
    const cleaned = input.replace(/[\s=-]+/g, '').toUpperCase();
    const length = cleaned.length;

    let bits = 0;
    let value = 0;
    let index = 0;
    const output = new Uint8Array(Math.ceil(length * 5 / 8));

    for (let i = 0; i < length; i++) {
        const charIndex = BASE32_ALPHABET.indexOf(cleaned[i]);
        if (charIndex === -1) continue;

        value = (value << 5) | charIndex;
        bits += 5;

        if (bits >= 8) {
            output[index++] = (value >>> (bits - 8)) & 0xff;
            bits -= 8;
        }
    }

    return output.slice(0, index);
}

// ========================================
// HMAC-based One-Time Password (HOTP)
// ========================================

function getAlgorithm(algo) {
    switch (algo.toUpperCase()) {
        case 'SHA256': return 'SHA-256';
        case 'SHA512': return 'SHA-512';
        case 'SHA1':
        default: return 'SHA-1';
    }
}

async function hmacDigest(algorithm, keyBytes, message) {
    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyBytes,
        { name: 'HMAC', hash: { name: algorithm } },
        false,
        ['sign']
    );
    return crypto.subtle.sign('HMAC', cryptoKey, message);
}

function intToBytes(num) {
    const bytes = new Uint8Array(8);
    for (let i = 7; i >= 0; i--) {
        bytes[i] = num & 0xff;
        num = Math.floor(num / 256);
    }
    return bytes;
}

function dynamicTruncate(hmacResult, digits) {
    const offset = hmacResult[hmacResult.length - 1] & 0x0f;
    const code =
        ((hmacResult[offset] & 0x7f) << 24) |
        ((hmacResult[offset + 1] & 0xff) << 16) |
        ((hmacResult[offset + 2] & 0xff) << 8) |
        (hmacResult[offset + 3] & 0xff);

    const otp = code % Math.pow(10, digits);
    return otp.toString().padStart(digits, '0');
}

// ========================================
// TOTP Generation
// ========================================

/**
 * Generate a TOTP code for the given secret.
 * Uses Web Crypto API for HMAC — fully async.
 */
export async function generateTOTP(secret, digits = 6, period = 30, algorithm = 'SHA1') {
    try {
        const keyBytes = base32Decode(secret);
        const time = Math.floor(Date.now() / 1000);
        const counter = Math.floor(time / period);
        const counterBytes = intToBytes(counter);
        const algo = getAlgorithm(algorithm);

        const hmacResult = await hmacDigest(algo, keyBytes, counterBytes);
        return dynamicTruncate(new Uint8Array(hmacResult), digits);
    } catch {
        return '------';
    }
}

/**
 * Get remaining seconds in the current TOTP period.
 */
export function getRemainingSeconds(period = 30) {
    const now = Math.floor(Date.now() / 1000);
    return period - (now % period);
}

/**
 * Validate a Base32-encoded secret string.
 */
export function validateBase32(secret) {
    if (!secret || secret.length === 0) return false;
    const cleaned = secret.replace(/[\s-]+/g, '').toUpperCase();
    return /^[A-Z2-7]+=*$/.test(cleaned) && cleaned.length >= 16;
}

/**
 * Clean and normalize a Base32 secret.
 */
export function normalizeSecret(secret) {
    return secret.replace(/[\s-]+/g, '').toUpperCase().replace(/=+$/, '');
}

/**
 * Parse an otpauth:// URI into account components.
 *
 * Format: otpauth://totp/ISSUER:ACCOUNT?secret=SECRET&issuer=ISSUER&algorithm=SHA1&digits=6&period=30
 *
 * @returns {{ issuer: string, accountName: string, secret: string, algorithm: string, digits: number, period: number } | null}
 */
export function parseOtpauthURI(uri) {
    try {
        const url = new URL(uri);

        if (url.protocol !== 'otpauth:') return null;
        if (url.hostname !== 'totp') return null;

        let path = decodeURIComponent(url.pathname).replace(/^\//, '');
        let issuer = '';
        let accountName = '';

        if (path.includes(':')) {
            const colonIndex = path.indexOf(':');
            issuer = path.substring(0, colonIndex).trim();
            accountName = path.substring(colonIndex + 1).trim();
        } else {
            accountName = path.trim();
        }

        const secret = url.searchParams.get('secret');
        if (!secret) return null;

        const issuerParam = url.searchParams.get('issuer');
        if (issuerParam) {
            issuer = issuerParam;
        }

        const algorithmParam = (url.searchParams.get('algorithm') || 'SHA1').toUpperCase();
        const algorithm = ['SHA1', 'SHA256', 'SHA512'].includes(algorithmParam)
            ? algorithmParam
            : 'SHA1';

        const digitsParam = parseInt(url.searchParams.get('digits') || '6', 10);
        const digits = digitsParam === 8 ? 8 : 6;

        const period = parseInt(url.searchParams.get('period') || '30', 10);

        return {
            issuer,
            accountName,
            secret: normalizeSecret(secret),
            algorithm,
            digits,
            period: period > 0 ? period : 30,
        };
    } catch {
        return null;
    }
}

/**
 * Build an otpauth:// URI from account data.
 */
export function buildOtpauthURI(account) {
    const label = account.issuer
        ? `${encodeURIComponent(account.issuer)}:${encodeURIComponent(account.accountName)}`
        : encodeURIComponent(account.accountName);

    const params = new URLSearchParams();
    params.set('secret', account.secret);
    if (account.issuer) params.set('issuer', account.issuer);
    if (account.algorithm && account.algorithm !== 'SHA1') {
        params.set('algorithm', account.algorithm);
    }
    if (account.digits && account.digits !== 6) {
        params.set('digits', String(account.digits));
    }
    if (account.period && account.period !== 30) {
        params.set('period', String(account.period));
    }

    return `otpauth://totp/${label}?${params.toString()}`;
}
