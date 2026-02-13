/**
 * ReDD 2FA — Biometric unlock via WebAuthn PRF
 *
 * Uses the WebAuthn PRF extension to derive a key from Touch ID / Windows Hello.
 * That key encrypts the passphrase, which is stored in chrome.storage.local.
 * The passphrase can only be decrypted when biometric auth succeeds.
 *
 * Supported: Chrome 118+, Edge 118+, Firefox 139+ (macOS 15+)
 */

// ========================================
// Public API
// ========================================

/**
 * Check if platform authenticator (Touch ID / Windows Hello) is available.
 * Note: PRF support can only be confirmed during credential creation.
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
 * Register a biometric credential and encrypt the passphrase with the PRF-derived key.
 * Returns the data to store, or throws if PRF is not supported.
 */
export async function registerBiometric(passphrase) {
    const prfSalt = crypto.getRandomValues(new Uint8Array(32));

    // Create credential with PRF extension
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
    if (!prfResults?.enabled) {
        throw new Error('Biometric unlock is not supported on this device.');
    }

    // Get PRF output — available from registration or via follow-up authentication
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

    // Encrypt the passphrase with the PRF-derived key
    const wrappingKey = await deriveWrappingKey(prfOutput);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(passphrase);
    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        wrappingKey,
        encoded,
    );

    return {
        credentialId: bufferToBase64(credential.rawId),
        prfSalt: bufferToBase64(prfSalt),
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

    // Decrypt passphrase
    const wrappingKey = await deriveWrappingKey(new Uint8Array(prfOutput));
    const iv = base64ToBuffer(storedData.iv);
    const ciphertext = base64ToBuffer(storedData.ciphertext);

    const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        wrappingKey,
        ciphertext,
    );

    return new TextDecoder().decode(decrypted);
}

// ========================================
// Internal helpers
// ========================================

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
