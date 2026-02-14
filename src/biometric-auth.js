/**
 * ReDD 2FA — Tab-based biometric auth (for Firefox)
 *
 * This page opens in a new tab when the popup can't keep focus during
 * WebAuthn (Firefox closes popups when system dialogs appear).
 *
 * URL params:
 *   ?action=register&passphrase=<base64>  — register biometric credential
 *   ?action=unlock                        — unlock with existing credential
 */

import { registerBiometric, authenticateBiometric } from './biometric.js';
import { saveBiometricData, loadBiometricData } from './storage.js';
import './browser.js';

const title = document.getElementById('title');
const message = document.getElementById('message');
const status = document.getElementById('status');

const params = new URLSearchParams(location.search);
const action = params.get('action');

(async () => {
    try {
        if (action === 'register') {
            await handleRegister();
        } else if (action === 'unlock') {
            await handleUnlock();
        } else {
            showError('Unknown action.');
        }
    } catch (err) {
        showError(err.message || 'Biometric authentication failed.');
    }
})();

async function handleRegister() {
    title.textContent = 'Enable Touch ID';
    message.textContent = 'Complete the biometric prompt to enable Touch ID…';

    const passphrase = params.get('passphrase');
    if (!passphrase) {
        showError('Missing passphrase data.');
        return;
    }

    // Decode passphrase from base64
    const decoded = atob(passphrase);
    const data = await registerBiometric(decoded);
    await saveBiometricData(data);

    // Signal success so popup can detect it
    await browser.storage.local.set({ redd2fa_biometric_pending: 'registered' });

    showSuccess('Touch ID enabled! You can close this tab.');
    autoClose();
}

async function handleUnlock() {
    title.textContent = 'Unlock with Touch ID';
    message.textContent = 'Complete the biometric prompt to unlock…';

    const biometricData = await loadBiometricData();
    if (!biometricData) {
        showError('No biometric data found. Please set up Touch ID again.');
        return;
    }

    const passphrase = await authenticateBiometric(biometricData);

    // Store passphrase temporarily so popup can pick it up
    // Encode as base64 for safe storage
    await browser.storage.local.set({
        redd2fa_biometric_pending: 'unlocked',
        redd2fa_biometric_passphrase: btoa(passphrase),
    });

    showSuccess('Unlocked! You can close this tab.');
    autoClose();
}

function showError(msg) {
    status.textContent = msg;
    status.className = 'status error';
    message.textContent = 'Something went wrong.';
}

function showSuccess(msg) {
    status.textContent = msg;
    status.className = 'status success';
    message.textContent = '';
}

function autoClose() {
    setTimeout(() => window.close(), 1500);
}
