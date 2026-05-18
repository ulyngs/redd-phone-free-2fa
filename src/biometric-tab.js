/**
 * ReDD 2FA — Biometric setup/unlock tab
 *
 * Chrome doesn't show WebAuthn prompts from extension side panels — the
 * navigator.credentials.create()/get() call hangs silently. This page is
 * opened as a regular tab from the side panel when the user triggers
 * biometric setup or unlock; the WebAuthn ceremony happens here (where
 * it works), the result is reported back to the side panel via runtime
 * messaging, and the tab closes itself.
 *
 * The URL ?mode= parameter selects between:
 *   setup  — register a new Touch ID credential (passphrase is requested
 *            from the side panel via runtime messaging)
 *   unlock — authenticate against an existing credential and return the
 *            recovered passphrase to the side panel
 */

import browser from './browser.js';
import { registerBiometric, authenticateBiometric } from './biometric.js';
import { loadBiometricData, saveBiometricData } from './storage.js';

const titleEl = document.getElementById('title');
const statusEl = document.getElementById('status');
const errorEl = document.getElementById('error');
const cancelBtn = document.getElementById('cancel-btn');
const retryBtn = document.getElementById('retry-btn');

const params = new URLSearchParams(location.search);
const mode = params.get('mode') === 'unlock' ? 'unlock' : 'setup';

if (mode === 'unlock') titleEl.textContent = 'Unlock with Touch ID';

cancelBtn.addEventListener('click', () => window.close());
retryBtn.addEventListener('click', () => {
    retryBtn.style.display = 'none';
    errorEl.style.display = 'none';
    statusEl.style.display = 'block';
    statusEl.textContent = 'Look for the Touch ID prompt from your browser.';
    run();
});

function showError(message) {
    errorEl.textContent = message;
    errorEl.style.display = 'block';
    statusEl.style.display = 'none';
    retryBtn.style.display = 'inline-block';
}

function errorToMessage(err) {
    const name = err?.name || '';
    const message = String(err?.message || '');
    if (name === 'NotAllowedError') {
        return 'Touch ID was cancelled or timed out. Click Try again to retry.';
    }
    if (name === 'OperationError') {
        return 'Another passkey prompt is already open. Finish or cancel it, then click Try again.';
    }
    if (name === 'InvalidStateError') {
        return 'A Touch ID credential already exists for this extension. Remove old ReDD 2FA passkeys in your OS or browser settings, then try again.';
    }
    if (name === 'SecurityError') {
        return 'Your browser does not allow Touch ID from this extension.';
    }
    if (message.includes('PRF')) {
        return 'Your browser does not support secure biometric unlock (PRF).';
    }
    return 'Touch ID failed. Click Try again to retry.';
}

async function requestPassphraseFromSidePanel() {
    const response = await browser.runtime.sendMessage({
        type: 'biometric-setup-request-passphrase',
    });
    if (!response || response.error) return null;
    return response.passphrase || null;
}

async function run() {
    try {
        if (mode === 'setup') {
            const passphrase = await requestPassphraseFromSidePanel();
            if (!passphrase) {
                showError('Could not retrieve the passphrase from the extension. Close this tab and start setup again from the side panel.');
                return;
            }
            const data = await registerBiometric(passphrase);
            await saveBiometricData(data);
            await browser.runtime.sendMessage({ type: 'biometric-setup-done' }).catch(() => { });
            window.close();
            return;
        }

        // mode === 'unlock'
        const data = await loadBiometricData();
        if (!data) {
            showError('No Touch ID credential found. Close this tab and unlock with your passphrase.');
            return;
        }
        const passphrase = await authenticateBiometric(data);
        await browser.runtime.sendMessage({
            type: 'biometric-unlock-result',
            passphrase,
        }).catch(() => { });
        window.close();
    } catch (err) {
        console.error('Biometric tab error:', err);
        const userMessage = errorToMessage(err);
        showError(userMessage);
        // Best-effort notify the side panel so it can re-enable its UI.
        // (Failure here is fine — user can still retry from this tab.)
        await browser.runtime.sendMessage({
            type: mode === 'setup' ? 'biometric-setup-failed' : 'biometric-unlock-result',
            error: userMessage,
            errorName: err?.name || '',
        }).catch(() => { });
    }
}

run();
