/**
 * Phone-Free 2FA — Storage manager
 *
 * Manages encrypted account data in browser.storage.local.
 * All data is stored as a single encrypted JSON blob.
 */

import browser from './browser.js';
import { encrypt, decrypt, generateSalt, createPassphraseHash, deriveKey, verifyPassphrase } from './crypto.js';

const STORAGE_KEY_DATA = 'redd2fa_data';
const STORAGE_KEY_META = 'redd2fa_meta';
const STORAGE_KEY_SETTINGS = 'redd2fa_settings';
const STORAGE_KEY_BACKUP_FINGERPRINT = 'redd2fa_backup_fingerprint';
const STORAGE_KEY_LOCKOUT = 'redd2fa_lockout';
const SCHEMA_VERSION = 1;

/** Default settings */
export const DEFAULT_SETTINGS = {
    autoLockMinutes: 5,
    clipboardClearSeconds: 30,
    theme: 'system',
    fetchIcons: false,
    accountHelpExpanded: true,
};

/**
 * Check if this is the first launch (no meta stored).
 */
export async function isFirstLaunch() {
    const result = await browser.storage.local.get(STORAGE_KEY_META);
    return !result[STORAGE_KEY_META];
}

/**
 * Set up encryption for the first time with a new passphrase.
 * Generates salt, derives key, stores empty encrypted accounts.
 */
export async function setupPassphrase(passphrase) {
    const salt = generateSalt();
    const key = await deriveKey(passphrase, salt);
    const passphraseHash = await createPassphraseHash(passphrase, salt);

    // Store meta
    const meta = {
        salt,
        passphraseHash,
        version: SCHEMA_VERSION,
    };
    await browser.storage.local.set({ [STORAGE_KEY_META]: meta });

    // Store empty accounts
    await saveAccounts([], key);

    return key;
}

/**
 * Attempt to unlock with a passphrase.
 * Returns the derived CryptoKey if successful, null otherwise.
 */
export async function unlockWithPassphrase(passphrase) {
    const result = await browser.storage.local.get(STORAGE_KEY_META);
    const meta = result[STORAGE_KEY_META];

    if (!meta) return null;

    const isValid = await verifyPassphrase(passphrase, meta.salt, meta.passphraseHash);
    if (!isValid) return null;

    return deriveKey(passphrase, meta.salt);
}

/**
 * Change the master passphrase. Re-encrypts all accounts with a new key.
 * Returns the new CryptoKey.
 */
export async function changePassphrase(accounts, newPassphrase) {
    const salt = generateSalt();
    const newKey = await deriveKey(newPassphrase, salt);
    const passphraseHash = await createPassphraseHash(newPassphrase, salt);

    // Update meta with new salt and hash
    const meta = { salt, passphraseHash, version: SCHEMA_VERSION };
    await browser.storage.local.set({ [STORAGE_KEY_META]: meta });

    // Re-encrypt accounts with the new key
    await saveAccounts(accounts, newKey);

    return newKey;
}

/**
 * Save accounts (encrypted) to storage.
 */
export async function saveAccounts(accounts, key) {
    const plaintext = JSON.stringify(accounts);
    const encrypted = await encrypt(plaintext, key);
    await browser.storage.local.set({ [STORAGE_KEY_DATA]: encrypted });
}

/**
 * Load and decrypt accounts from storage.
 */
export async function loadAccounts(key) {
    const result = await browser.storage.local.get(STORAGE_KEY_DATA);
    const blob = result[STORAGE_KEY_DATA];

    if (!blob) return [];

    try {
        const plaintext = await decrypt(blob.iv, blob.ciphertext, key);
        return JSON.parse(plaintext);
    } catch {
        throw new Error('Failed to decrypt accounts. Wrong passphrase?');
    }
}

/**
 * Load settings from storage.
 */
export async function loadSettings() {
    const result = await browser.storage.local.get(STORAGE_KEY_SETTINGS);
    const stored = result[STORAGE_KEY_SETTINGS];
    return {
        autoLockMinutes: stored?.autoLockMinutes ?? 5,
        clipboardClearSeconds: stored?.clipboardClearSeconds ?? 30,
        theme: stored?.theme ?? 'system',
        fetchIcons: stored?.fetchIcons ?? false,
        accountHelpExpanded: stored?.accountHelpExpanded ?? true,
    };
}

/**
 * Save settings to storage.
 */
export async function saveSettings(settings) {
    await browser.storage.local.set({ [STORAGE_KEY_SETTINGS]: settings });
}

/**
 * Get the stored meta (for export/backup purposes).
 */
export async function getStoredMeta() {
    const result = await browser.storage.local.get(STORAGE_KEY_META);
    return result[STORAGE_KEY_META] || null;
}

/**
 * Get the raw encrypted blob (for backup/export).
 */
export async function getRawEncryptedData() {
    const result = await browser.storage.local.get(STORAGE_KEY_DATA);
    return result[STORAGE_KEY_DATA] || null;
}

/**
 * Import accounts, merging or replacing existing ones.
 */
export async function importAccounts(accounts, key, replace = false) {
    if (replace) {
        await saveAccounts(accounts, key);
    } else {
        const existing = await loadAccounts(key);
        const existingIds = new Set(existing.map(a => a.id));
        const merged = [...existing, ...accounts.filter(a => !existingIds.has(a.id))];
        await saveAccounts(merged, key);
    }
}

/**
 * Save biometric credential data (credential ID + PRF salt + encrypted passphrase).
 */
export async function saveBiometricData(data) {
    // Remove disabled flag if present
    const { disabled, ...cleanData } = data;
    await browser.storage.local.set({ redd2fa_biometric: cleanData });
}

/**
 * Load biometric credential data. Returns null if not set or disabled.
 */
export async function loadBiometricData() {
    const result = await browser.storage.local.get('redd2fa_biometric');
    const data = result.redd2fa_biometric || null;
    if (data?.disabled) return null;
    return data;
}

/**
 * Load biometric data even if disabled (for re-enabling without creating a new credential).
 */
export async function loadBiometricDataRaw() {
    const result = await browser.storage.local.get('redd2fa_biometric');
    return result.redd2fa_biometric || null;
}

/**
 * Soft-disable biometric unlock (keep credential data for potential re-use).
 */
export async function disableBiometric() {
    const result = await browser.storage.local.get('redd2fa_biometric');
    const data = result.redd2fa_biometric;
    if (data) {
        data.disabled = true;
        await browser.storage.local.set({ redd2fa_biometric: data });
    }
}

/**
 * Fully clear biometric data (used when passphrase changes and old data is invalid).
 */
export async function clearBiometricData() {
    await browser.storage.local.remove('redd2fa_biometric');
}

/**
 * Check if the extension has any data stored at all.
 */
export async function hasData() {
    const result = await browser.storage.local.get([STORAGE_KEY_META, STORAGE_KEY_DATA]);
    return !!(result[STORAGE_KEY_META] && result[STORAGE_KEY_DATA]);
}

/**
 * Compute a fingerprint of the accounts array for backup staleness detection.
 * Only considers label + secret (the essential data), ignoring internal fields.
 * Returns a hex-encoded SHA-256 hash.
 */
export async function computeAccountsFingerprint(accounts) {
    if (!accounts || accounts.length === 0) return null;
    const essential = accounts
        .map(a => ({ label: a.issuer || a.accountName, secret: a.secret }))
        .sort((a, b) => a.label.localeCompare(b.label) || a.secret.localeCompare(b.secret));
    const json = JSON.stringify(essential);
    const encoded = new TextEncoder().encode(json);
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Save the current accounts fingerprint as the "last backed-up" state.
 */
export async function saveBackupFingerprint(accounts) {
    const fingerprint = await computeAccountsFingerprint(accounts);
    await browser.storage.local.set({ [STORAGE_KEY_BACKUP_FINGERPRINT]: fingerprint });
}

/**
 * Load the persisted brute-force lockout state.
 * Returns { failedAttempts, lockoutUntil } with safe defaults.
 */
export async function loadLockoutState() {
    const result = await browser.storage.local.get(STORAGE_KEY_LOCKOUT);
    const state = result[STORAGE_KEY_LOCKOUT];
    if (!state) return { failedAttempts: 0, lockoutUntil: 0 };
    return {
        failedAttempts: Number(state.failedAttempts) || 0,
        lockoutUntil: Number(state.lockoutUntil) || 0,
    };
}

/**
 * Persist the brute-force lockout state. Survives popup close.
 */
export async function saveLockoutState(state) {
    await browser.storage.local.set({
        [STORAGE_KEY_LOCKOUT]: {
            failedAttempts: state.failedAttempts,
            lockoutUntil: state.lockoutUntil,
        },
    });
}

/**
 * Clear the brute-force lockout state on successful unlock.
 */
export async function clearLockoutState() {
    await browser.storage.local.remove(STORAGE_KEY_LOCKOUT);
}

/**
 * Check whether the current accounts differ from the last backed-up state.
 * Returns 'current' if backup is up to date, 'never' if no backup exists,
 * or 'stale' if accounts have changed since the last backup.
 */
export async function getBackupStatus(accounts) {
    if (!accounts || accounts.length === 0) return 'current'; // nothing to back up
    const result = await browser.storage.local.get(STORAGE_KEY_BACKUP_FINGERPRINT);
    const savedFingerprint = result[STORAGE_KEY_BACKUP_FINGERPRINT];
    if (!savedFingerprint) return 'never';
    const currentFingerprint = await computeAccountsFingerprint(accounts);
    return currentFingerprint !== savedFingerprint ? 'stale' : 'current';
}
