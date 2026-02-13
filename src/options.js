/**
 * ReDD 2FA — Options page controller
 *
 * Handles backup/restore on the full options page.
 */

import browser from './browser.js';
import { unlockWithPassphrase, loadAccounts, saveAccounts } from './storage.js';
import { generateSalt, deriveKey, encrypt, decrypt } from './crypto.js';
import { parseOtpauthURI, buildOtpauthURI } from './totp.js';

const $ = (id) => document.getElementById(id);

let sessionKey = null;
let accounts = [];

// ========================================
// Export Section
// ========================================
$('unlock-for-export').addEventListener('click', async () => {
    const passphrase = $('master-passphrase').value;
    if (!passphrase) return;

    const key = await unlockWithPassphrase(passphrase);
    if (!key) {
        alert('Incorrect passphrase.');
        return;
    }

    sessionKey = key;
    accounts = await loadAccounts(key);
    $('export-section').style.display = 'block';
    $('unlock-for-export').textContent = '✓ Unlocked';
    $('unlock-for-export').disabled = true;
});

$('export-encrypted-btn').addEventListener('click', async () => {
    const pw = $('export-password').value;
    const pwConfirm = $('export-password-confirm').value;
    const errorEl = $('export-error');

    if (pw.length < 8) {
        errorEl.textContent = 'Password must be at least 8 characters.';
        errorEl.style.display = 'block';
        return;
    }
    if (pw !== pwConfirm) {
        errorEl.textContent = 'Passwords do not match.';
        errorEl.style.display = 'block';
        return;
    }

    try {
        const salt = generateSalt();
        const exportKey = await deriveKey(pw, salt);
        const plaintext = JSON.stringify(accounts);
        const encrypted = await encrypt(plaintext, exportKey);

        const exportData = {
            format: 'redd-2fa-backup',
            version: 1,
            salt,
            ...encrypted,
        };

        downloadFile(
            JSON.stringify(exportData, null, 2),
            `redd-2fa-backup-${dateStamp()}.json`,
            'application/json'
        );
        errorEl.style.display = 'none';
    } catch {
        errorEl.textContent = 'Export failed.';
        errorEl.style.display = 'block';
    }
});

$('export-plain-btn').addEventListener('click', () => {
    if (!confirm('⚠️ This will export all secrets as UNENCRYPTED plain text. Anyone with this file can access your accounts.\n\nOnly use this for migrating to another authenticator app.\n\nContinue?')) {
        return;
    }

    const uris = accounts.map(a => buildOtpauthURI(a)).join('\n');
    downloadFile(uris, `redd-2fa-uris-${dateStamp()}.txt`, 'text/plain');
});

// ========================================
// Import Section
// ========================================
$('unlock-for-import').addEventListener('click', async () => {
    const passphrase = $('import-master-passphrase').value;
    if (!passphrase) return;

    const key = await unlockWithPassphrase(passphrase);
    if (!key) {
        alert('Incorrect passphrase.');
        return;
    }

    sessionKey = key;
    accounts = await loadAccounts(key);
    $('import-section').style.display = 'block';
    $('import-unlock-section').style.display = 'none';
});

$('import-file').addEventListener('change', () => {
    const file = $('import-file').files?.[0];
    if (file && file.name.endsWith('.json')) {
        $('import-password-group').style.display = 'block';
    } else {
        $('import-password-group').style.display = 'none';
    }
});

$('import-btn').addEventListener('click', async () => {
    if (!sessionKey) return;

    const file = $('import-file').files?.[0];
    const errorEl = $('import-error');
    const successEl = $('import-success');

    if (!file) {
        errorEl.textContent = 'Please select a file.';
        errorEl.style.display = 'block';
        return;
    }

    try {
        const text = await file.text();

        if (file.name.endsWith('.json')) {
            const data = JSON.parse(text);

            if (data.format === 'redd-2fa-backup') {
                const pw = $('import-password').value;
                if (!pw) {
                    errorEl.textContent = 'Please enter the backup password.';
                    errorEl.style.display = 'block';
                    return;
                }
                const importKey = await deriveKey(pw, data.salt);
                try {
                    const plaintext = await decrypt(data.iv, data.ciphertext, importKey);
                    const imported = JSON.parse(plaintext);
                    await mergeAndSave(imported);
                } catch {
                    errorEl.textContent = 'Wrong password or corrupted backup.';
                    errorEl.style.display = 'block';
                    return;
                }
            } else if (Array.isArray(data)) {
                await mergeAndSave(data);
            } else {
                errorEl.textContent = 'Invalid backup format.';
                errorEl.style.display = 'block';
                return;
            }
        } else {
            // Plain text URIs
            const lines = text.split('\n').map(l => l.trim()).filter(l => l.startsWith('otpauth://'));
            const imported = [];
            for (const line of lines) {
                const parsed = parseOtpauthURI(line);
                if (parsed) {
                    imported.push({ id: generateId(), ...parsed });
                }
            }
            if (imported.length === 0) {
                errorEl.textContent = 'No valid otpauth:// URIs found.';
                errorEl.style.display = 'block';
                return;
            }
            await mergeAndSave(imported);
        }

        errorEl.style.display = 'none';
        successEl.textContent = `✓ Import complete. ${accounts.length} total accounts.`;
        successEl.style.display = 'block';
    } catch {
        errorEl.textContent = 'Import failed. Check file format.';
        errorEl.style.display = 'block';
    }
});

async function mergeAndSave(imported) {
    if (!sessionKey) return;
    const existingSecrets = new Set(accounts.map(a => a.secret));
    const newAccounts = imported.filter(a => !existingSecrets.has(a.secret));
    newAccounts.forEach(a => { a.id = a.id || generateId(); });
    accounts = [...accounts, ...newAccounts];
    await saveAccounts(accounts, sessionKey);
}

// ========================================
// Helpers
// ========================================
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

function dateStamp() {
    return new Date().toISOString().slice(0, 10);
}

function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoke after a short delay to ensure download has started
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}
