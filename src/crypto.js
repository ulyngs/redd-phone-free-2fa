/**
 * ReDD 2FA — Crypto module
 *
 * Uses Web Crypto API for all cryptographic operations:
 * - PBKDF2 (600,000 iterations) for key derivation
 * - AES-256-GCM for encryption/decryption
 *
 * No external crypto dependencies — fully native browser APIs.
 */

const PBKDF2_ITERATIONS = 600_000;
const SALT_LENGTH = 32;
const IV_LENGTH = 12;
const KEY_LENGTH = 256;

/** Convert ArrayBuffer to Base64 string */
function bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/** Convert Base64 string to ArrayBuffer */
function base64ToBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

/** Encode a string to UTF-8 bytes */
function encodeText(text) {
    return new TextEncoder().encode(text);
}

/** Decode UTF-8 bytes to string */
function decodeText(buffer) {
    return new TextDecoder().decode(buffer);
}

/** Generate a cryptographically random salt */
export function generateSalt() {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    return bufferToBase64(salt.buffer);
}

/** Generate a random IV for AES-GCM */
function generateIV() {
    return crypto.getRandomValues(new Uint8Array(IV_LENGTH));
}

/**
 * Derive an AES-256-GCM key from a passphrase using PBKDF2.
 * Returns a CryptoKey that can be used for encrypt/decrypt.
 */
export async function deriveKey(passphrase, saltBase64) {
    const salt = base64ToBuffer(saltBase64);
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encodeText(passphrase),
        'PBKDF2',
        false,
        ['deriveKey']
    );

    return crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt,
            iterations: PBKDF2_ITERATIONS,
            hash: 'SHA-256',
        },
        keyMaterial,
        {
            name: 'AES-GCM',
            length: KEY_LENGTH,
        },
        false,
        ['encrypt', 'decrypt']
    );
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns { iv, ciphertext } as Base64 strings.
 */
export async function encrypt(plaintext, key) {
    const iv = generateIV();
    const encoded = encodeText(plaintext);

    const ciphertextBuffer = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        encoded
    );

    return {
        iv: bufferToBase64(iv.buffer),
        ciphertext: bufferToBase64(ciphertextBuffer),
    };
}

/**
 * Decrypt an AES-256-GCM ciphertext.
 * Returns the plaintext string.
 */
export async function decrypt(ivBase64, ciphertextBase64, key) {
    const iv = base64ToBuffer(ivBase64);
    const ciphertext = base64ToBuffer(ciphertextBase64);

    const plaintextBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(iv) },
        key,
        ciphertext
    );

    return decodeText(plaintextBuffer);
}

/**
 * Create a hash of the passphrase for verification purposes.
 * This allows checking if the entered passphrase is correct without
 * storing the passphrase itself — we derive a separate key and encrypt
 * a known sentinel value.
 */
export async function createPassphraseHash(passphrase, saltBase64) {
    // Derive a verification-specific key using a different salt prefix
    const verifySalt = saltBase64 + ':verify';
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encodeText(passphrase),
        'PBKDF2',
        false,
        ['deriveBits']
    );

    const bits = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt: encodeText(verifySalt),
            iterations: PBKDF2_ITERATIONS,
            hash: 'SHA-256',
        },
        keyMaterial,
        256
    );

    return bufferToBase64(bits);
}

/**
 * Verify a passphrase against a stored hash.
 */
export async function verifyPassphrase(passphrase, saltBase64, storedHash) {
    const hash = await createPassphraseHash(passphrase, saltBase64);
    return constantTimeEqual(hash, storedHash);
}

/**
 * Constant-time string comparison to prevent timing side-channel attacks.
 */
function constantTimeEqual(a, b) {
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) {
        result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
}
