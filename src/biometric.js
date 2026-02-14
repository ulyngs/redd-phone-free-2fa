/**
 * ReDD 2FA — Biometric unlock via WebAuthn
 *
 * Two modes:
 *   1. PRF mode (Chrome 118+, Edge 118+): derives a key from the biometric
 *      gesture itself — the key never exists in storage.
 *   2. Credential-gated mode (Firefox, Safari): a random wrapping key is
 *      stored alongside the credential data, but can only be *used* after
 *      a successful WebAuthn assertion (Touch ID / Windows Hello).
 *
 * The mode is chosen automatically at registration time based on browser
 * support.  Existing data without a `mode` field is treated as PRF.
 */

// ========================================
// Public API
// ========================================

/**
 * Check if platform authenticator (Touch ID / Windows Hello) is available.
 */
export async function isBiometricAvailable() {
    if (!window.PublicKeyCredential) return false;
    try {
        return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
        return false;
    }
}

/**
 * Register a biometric credential and encrypt the passphrase.
 * Tries PRF first; falls back to credential-gated mode.
 * Returns the data to store.
 */
export async function registerBiometric(passphrase) {
    const prfSalt = crypto.getRandomValues(new Uint8Array(32));

    // Create credential requesting PRF
    const credential = await navigator.credentials.create({
        publicKey: {
            challenge: crypto.getRandomValues(new Uint8Array(32)),
            rp: { name: 'ReDD 2FA' },
            user: {
                id: crypto.getRandomValues(new Uint8Array(16)),
                name: 'redd-2fa-user',
                displayName: 'ReDD 2FA',
            },
            pubKeyCredParams: [
                { alg: -7, type: 'public-key' },   // ES256
                { alg: -257, type: 'public-key' },  // RS256
            ],
            authenticatorSelection: {
                authenticatorAttachment: 'platform',
                residentKey: 'preferred',
                userVerification: 'required',
            },
            extensions: {
                prf: {
                    eval: { first: prfSalt.buffer },
                },
            },
        },
    });

    const prfResults = credential.getClientExtensionResults()?.prf;

    // ── PRF supported ─────────────────────────────────────────────
    if (prfResults?.enabled) {
        let prfOutput;
        if (prfResults.results?.first) {
            prfOutput = new Uint8Array(prfResults.results.first);
        } else {
            // Some authenticators only return PRF output during authentication
            const assertion = await navigator.credentials.get({
                publicKey: {
                    challenge: crypto.getRandomValues(new Uint8Array(32)),
                    allowCredentials: [{ id: credential.rawId, type: 'public-key' }],
                    userVerification: 'required',
                    extensions: {
                        prf: { eval: { first: prfSalt.buffer } },
                    },
                },
            });
            const authPrf = assertion.getClientExtensionResults()?.prf?.results?.first;
            if (!authPrf) throw new Error('Failed to obtain PRF output.');
            prfOutput = new Uint8Array(authPrf);
        }

        const wrappingKey = await deriveWrappingKey(prfOutput);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            wrappingKey,
            new TextEncoder().encode(passphrase),
        );

        return {
            mode: 'prf',
            credentialId: bufferToBase64(credential.rawId),
            prfSalt: bufferToBase64(prfSalt),
            iv: bufferToBase64(iv),
            ciphertext: bufferToBase64(ciphertext),
        };
    }

    // ── Credential-gated fallback ─────────────────────────────────
    // PRF not available — encrypt passphrase with a random key that
    // is stored locally.  Security gate: the stored data is only
    // used after a successful WebAuthn assertion (Touch ID).
    const rawKey = crypto.getRandomValues(new Uint8Array(32));
    const wrappingKey = await crypto.subtle.importKey(
        'raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt'],
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        wrappingKey,
        new TextEncoder().encode(passphrase),
    );

    return {
        mode: 'credential',
        credentialId: bufferToBase64(credential.rawId),
        wrappingKey: bufferToBase64(rawKey),
        iv: bufferToBase64(iv),
        ciphertext: bufferToBase64(ciphertext),
    };
}

/**
 * Authenticate with biometrics and decrypt the passphrase.
 * Returns the plaintext passphrase string.
 */
export async function authenticateBiometric(storedData) {
    const credentialId = base64ToBuffer(storedData.credentialId);
    const mode = storedData.mode || 'prf'; // backwards compatibility

    if (mode === 'prf') {
        return authenticatePRF(storedData, credentialId);
    }
    return authenticateCredentialGated(storedData, credentialId);
}

// ========================================
// Authentication strategies
// ========================================

async function authenticatePRF(storedData, credentialId) {
    const prfSalt = base64ToBuffer(storedData.prfSalt);

    const assertion = await navigator.credentials.get({
        publicKey: {
            challenge: crypto.getRandomValues(new Uint8Array(32)),
            allowCredentials: [{ id: credentialId, type: 'public-key' }],
            userVerification: 'required',
            extensions: {
                prf: { eval: { first: prfSalt } },
            },
        },
    });

    const prfOutput = assertion.getClientExtensionResults()?.prf?.results?.first;
    if (!prfOutput) throw new Error('Biometric authentication failed.');

    const wrappingKey = await deriveWrappingKey(new Uint8Array(prfOutput));
    return decryptPassphrase(wrappingKey, storedData);
}

async function authenticateCredentialGated(storedData, credentialId) {
    // WebAuthn assertion — requires Touch ID / Windows Hello
    await navigator.credentials.get({
        publicKey: {
            challenge: crypto.getRandomValues(new Uint8Array(32)),
            allowCredentials: [{ id: credentialId, type: 'public-key' }],
            userVerification: 'required',
        },
    });

    // Assertion succeeded → user is verified, decrypt with stored key
    const rawKey = base64ToBuffer(storedData.wrappingKey);
    const wrappingKey = await crypto.subtle.importKey(
        'raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt'],
    );
    return decryptPassphrase(wrappingKey, storedData);
}

// ========================================
// Internal helpers
// ========================================

async function decryptPassphrase(wrappingKey, storedData) {
    const iv = base64ToBuffer(storedData.iv);
    const ciphertext = base64ToBuffer(storedData.ciphertext);
    const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        wrappingKey,
        ciphertext,
    );
    return new TextDecoder().decode(decrypted);
}

/**
 * Derive a 256-bit AES-GCM key from the PRF output using HKDF.
 */
async function deriveWrappingKey(prfOutput) {
    const keyMaterial = await crypto.subtle.importKey(
        'raw', prfOutput, 'HKDF', false, ['deriveKey'],
    );
    return crypto.subtle.deriveKey(
        {
            name: 'HKDF',
            salt: new Uint8Array(0),
            info: new TextEncoder().encode('redd-2fa-biometric'),
            hash: 'SHA-256',
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
    );
}

function bufferToBase64(buffer) {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function base64ToBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}
