/**
 * ReDD 2FA — Storage manager
 *
 * Manages encrypted account data in browser.storage.local.
 * All data is stored as a single encrypted JSON blob.
 */

import browser from './browser';
import { encrypt, decrypt, generateSalt, createPassphraseHash, deriveKey, verifyPassphrase } from './crypto';
import type { Account, EncryptedBlob, StoredMeta, Settings, DEFAULT_SETTINGS } from './types';

const STORAGE_KEY_DATA = 'redd2fa_data';
const STORAGE_KEY_META = 'redd2fa_meta';
const STORAGE_KEY_SETTINGS = 'redd2fa_settings';
const SCHEMA_VERSION = 1;

/**
 * Check if this is the first launch (no meta stored).
 */
export async function isFirstLaunch(): Promise<boolean> {
    const result = await browser.storage.local.get(STORAGE_KEY_META);
    return !result[STORAGE_KEY_META];
}

/**
 * Set up encryption for the first time with a new passphrase.
 * Generates salt, derives key, stores empty encrypted accounts.
 */
export async function setupPassphrase(passphrase: string): Promise<CryptoKey> {
    const salt = generateSalt();
    const key = await deriveKey(passphrase, salt);
    const passphraseHash = await createPassphraseHash(passphrase, salt);

    // Store meta
    const meta: StoredMeta = {
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
export async function unlockWithPassphrase(passphrase: string): Promise<CryptoKey | null> {
    const result = await browser.storage.local.get(STORAGE_KEY_META);
    const meta = result[STORAGE_KEY_META] as StoredMeta | undefined;

    if (!meta) return null;

    const isValid = await verifyPassphrase(passphrase, meta.salt, meta.passphraseHash);
    if (!isValid) return null;

    return deriveKey(passphrase, meta.salt);
}

/**
 * Save accounts (encrypted) to storage.
 */
export async function saveAccounts(accounts: Account[], key: CryptoKey): Promise<void> {
    const plaintext = JSON.stringify(accounts);
    const encrypted = await encrypt(plaintext, key);
    await browser.storage.local.set({ [STORAGE_KEY_DATA]: encrypted });
}

/**
 * Load and decrypt accounts from storage.
 */
export async function loadAccounts(key: CryptoKey): Promise<Account[]> {
    const result = await browser.storage.local.get(STORAGE_KEY_DATA);
    const blob = result[STORAGE_KEY_DATA] as EncryptedBlob | undefined;

    if (!blob) return [];

    try {
        const plaintext = await decrypt(blob.iv, blob.ciphertext, key);
        return JSON.parse(plaintext) as Account[];
    } catch {
        throw new Error('Failed to decrypt accounts. Wrong passphrase?');
    }
}

/**
 * Load settings from storage.
 */
export async function loadSettings(): Promise<Settings> {
    const result = await browser.storage.local.get(STORAGE_KEY_SETTINGS);
    const stored = result[STORAGE_KEY_SETTINGS] as Partial<Settings> | undefined;
    return {
        autoLockMinutes: stored?.autoLockMinutes ?? 5,
        clipboardClearSeconds: stored?.clipboardClearSeconds ?? 15,
        theme: stored?.theme ?? 'system',
        fetchIcons: stored?.fetchIcons ?? false,
    };
}

/**
 * Save settings to storage.
 */
export async function saveSettings(settings: Settings): Promise<void> {
    await browser.storage.local.set({ [STORAGE_KEY_SETTINGS]: settings });
}

/**
 * Get the stored meta (for export/backup purposes).
 */
export async function getStoredMeta(): Promise<StoredMeta | null> {
    const result = await browser.storage.local.get(STORAGE_KEY_META);
    return (result[STORAGE_KEY_META] as StoredMeta) || null;
}

/**
 * Get the raw encrypted blob (for backup/export).
 */
export async function getRawEncryptedData(): Promise<EncryptedBlob | null> {
    const result = await browser.storage.local.get(STORAGE_KEY_DATA);
    return (result[STORAGE_KEY_DATA] as EncryptedBlob) || null;
}

/**
 * Import accounts, merging or replacing existing ones.
 */
export async function importAccounts(
    accounts: Account[],
    key: CryptoKey,
    replace: boolean = false
): Promise<void> {
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
 * Check if the extension has any data stored at all.
 */
export async function hasData(): Promise<boolean> {
    const result = await browser.storage.local.get([STORAGE_KEY_META, STORAGE_KEY_DATA]);
    return !!(result[STORAGE_KEY_META] && result[STORAGE_KEY_DATA]);
}
