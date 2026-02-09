/**
 * ReDD 2FA — TypeScript type definitions
 */

/** A single TOTP account */
export interface Account {
    id: string;
    issuer: string;
    accountName: string;
    secret: string;
    algorithm: 'SHA1' | 'SHA256' | 'SHA512';
    digits: 6 | 8;
    period: number;
    iconUrl?: string;
}

/** Encrypted data blob stored in browser.storage.local */
export interface EncryptedBlob {
    iv: string;       // Base64-encoded IV
    ciphertext: string; // Base64-encoded ciphertext
}

/** Salt and passphrase verification hash stored alongside encrypted data */
export interface StoredMeta {
    salt: string;           // Base64-encoded PBKDF2 salt
    passphraseHash: string; // Base64-encoded hash for passphrase verification
    version: number;        // Schema version for future migrations
}

/** Application state for the popup */
export interface AppState {
    isFirstLaunch: boolean;
    isLocked: boolean;
    accounts: Account[];
    searchQuery: string;
}

/** Settings stored in storage */
export interface Settings {
    autoLockMinutes: number;
    clipboardClearSeconds: number;
    theme: 'system' | 'light' | 'dark';
    fetchIcons: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
    autoLockMinutes: 5,
    clipboardClearSeconds: 15,
    theme: 'system',
    fetchIcons: false,
};

/** Messages between popup ↔ background */
export type BackgroundMessage =
    | { type: 'CLEAR_CLIPBOARD'; delayMs: number }
    | { type: 'LOCK_SESSION' }
    | { type: 'PING' };

export type BackgroundResponse =
    | { success: true }
    | { success: false; error: string };
