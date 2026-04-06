/**
 * ReDD 2FA — Main popup controller
 *
 * Manages all popup UI: setup, lock/unlock, account list,
 * TOTP code generation, modals, search, clipboard, and settings.
 */


import { generateTOTP, getRemainingSeconds, parseOtpauthURI, buildOtpauthURI, validateBase32, normalizeSecret } from './totp.js';
import { isFirstLaunch, setupPassphrase, unlockWithPassphrase, changePassphrase, loadAccounts, saveAccounts, loadSettings, saveSettings, saveBiometricData, loadBiometricData, loadBiometricDataRaw, disableBiometric, clearBiometricData, getBackupStatus, saveBackupFingerprint } from './storage.js';
import { setSessionKey, getSessionKey, isUnlocked, lock, touchActivity, setAutoLockMinutes, setOnLockCallback } from './session.js';
import { isBiometricAvailable, registerBiometric, authenticateBiometric } from './biometric.js';

// ========================================
// State
// ========================================
let accounts = [];
let settings;
let totpInterval = null;
let editingAccountId = null;
let pendingPassphrase = null; // held briefly for biometric registration


// ========================================
// DOM refs
// ========================================
const $ = (id) => document.getElementById(id);

// Screens
const setupScreen = $('setup-screen');
const lockScreen = $('lock-screen');
const mainScreen = $('main-screen');

// Setup
const setupPassphraseInput = $('setup-passphrase');
const setupPassphraseConfirm = $('setup-passphrase-confirm');
const setupError = $('setup-error');
const setupBtn = $('setup-btn');

// Lock
const unlockPassphraseInput = $('unlock-passphrase');
const unlockError = $('unlock-error');
const unlockBtn = $('unlock-btn');
const biometricUnlockBtn = $('biometric-unlock-btn');
const biometricError = $('biometric-error');
const passphraseDivider = $('passphrase-divider');

// Biometric prompt
const biometricPromptOverlay = $('biometric-prompt-overlay');
const biometricToggleBtn = $('biometric-toggle-btn');

// Main
const searchInput = $('search-input');
const accountList = $('account-list');
const emptyState = $('empty-state');
const settingsDropdown = $('settings-dropdown');

// Modal
const accountModalOverlay = $('account-modal-overlay');
const modalTitle = $('modal-title');
const manualLabel = $('manual-label');
const manualSecret = $('manual-secret');
const secretValidation = $('secret-validation');
const modalError = $('modal-error');
const modalSaveBtn = $('modal-save-btn');

// Delete modal
const deleteModalOverlay = $('delete-modal-overlay');
const deleteAccountName = $('delete-account-name');

// Export modal
const exportModalOverlay = $('export-modal-overlay');
const exportPassword = $('export-password');
const exportPasswordConfirm = $('export-password-confirm');
const exportError = $('export-error');

// Import modal
const importModalOverlay = $('import-modal-overlay');
const importFile = $('import-file');
const importPasswordSection = $('import-password-section');
const importPassword = $('import-password');
const importError = $('import-error');
const importSuccess = $('import-success');


// Toast
const toast = $('toast');

// Settings
const themeSelect = $('theme-select');
const autoLockSelect = $('auto-lock-select');

// ========================================
// Initialization
// ========================================
document.addEventListener('DOMContentLoaded', async () => {
    settings = await loadSettings();
    applyTheme(settings.theme);
    initEventListeners();
    initBiometricListeners();
    setOnLockCallback(() => { showScreen('lock'); setupLockScreen(); });

    if (await isFirstLaunch()) {
        showScreen('setup');
    } else {
        showScreen('lock');
        await setupLockScreen();
    }
});


// ========================================
// Screen management
// ========================================
function showScreen(screen) {
    setupScreen.style.display = screen === 'setup' ? 'block' : 'none';
    lockScreen.style.display = screen === 'lock' ? 'block' : 'none';
    mainScreen.style.display = screen === 'main' ? 'block' : 'none';

    if (screen === 'main') {
        startTOTPRefresh();
    } else {
        stopTOTPRefresh();
    }
}

// ========================================
// Theme
// ========================================
function applyTheme(theme) {
    document.documentElement.classList.remove('dark-mode');
    if (theme === 'dark') {
        document.documentElement.classList.add('dark-mode');
    } else if (theme === 'system') {
        if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
            document.documentElement.classList.add('dark-mode');
        }
    }
}

// Listen for system theme changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (settings.theme === 'system') {
        applyTheme('system');
    }
});

// ========================================
// Event Listeners
// ========================================
function initEventListeners() {
    // Setup screen
    const validateSetup = () => {
        const p = setupPassphraseInput.value;
        const c = setupPassphraseConfirm.value;
        setupBtn.disabled = p.length < 8 || p !== c;
        if (p.length > 0 && p.length < 8) {
            showElement(setupError, 'Passphrase must be at least 8 characters.');
        } else if (c.length > 0 && p !== c) {
            showElement(setupError, 'Passphrases do not match.');
        } else {
            hideElement(setupError);
        }
    };
    setupPassphraseInput.addEventListener('input', validateSetup);
    setupPassphraseConfirm.addEventListener('input', validateSetup);
    setupBtn.addEventListener('click', handleSetup);
    setupPassphraseConfirm.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !setupBtn.disabled) handleSetup();
    });

    // Lock screen
    unlockBtn.addEventListener('click', handleUnlock);
    unlockPassphraseInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleUnlock();
    });

    // Add account
    $('add-account-btn').addEventListener('click', () => openAccountModal());
    $('empty-add-btn').addEventListener('click', () => openAccountModal());


    // Settings
    $('settings-btn').addEventListener('click', async () => {
        settingsDropdown.style.display = settingsDropdown.style.display === 'none' ? 'block' : 'none';
        if (settingsDropdown.style.display === 'block') {
            updateBiometricToggle();
            // Check backup staleness
            const status = await getBackupStatus(accounts);
            const badge = $('backup-badge');
            if (status === 'never') {
                badge.textContent = 'no backup exported';
                badge.style.display = 'inline';
            } else if (status === 'stale') {
                badge.textContent = 'changes since last export';
                badge.style.display = 'inline';
            } else {
                badge.style.display = 'none';
            }
        }
    });
    $('settings-close-btn').addEventListener('click', () => {
        settingsDropdown.style.display = 'none';
    });

    themeSelect.value = settings.theme;
    themeSelect.addEventListener('change', async () => {
        settings.theme = themeSelect.value;
        applyTheme(settings.theme);
        await saveSettings(settings);
    });

    autoLockSelect.value = String(settings.autoLockMinutes);
    autoLockSelect.addEventListener('change', async () => {
        settings.autoLockMinutes = parseInt(autoLockSelect.value, 10);
        setAutoLockMinutes(settings.autoLockMinutes);
        await saveSettings(settings);
    });

    $('lock-btn').addEventListener('click', async () => {
        lock();
        settingsDropdown.style.display = 'none';
        showScreen('lock');
        await setupLockScreen();
    });

    // Change passphrase
    $('change-passphrase-btn').addEventListener('click', () => {
        openChangePassphraseModal();
    });
    $('change-passphrase-cancel-btn').addEventListener('click', closeChangePassphraseModal);
    $('change-passphrase-confirm-btn').addEventListener('click', handleChangePassphrase);

    // Export/Import
    $('export-btn').addEventListener('click', () => {
        openExportModal();
    });
    $('import-btn').addEventListener('click', () => {
        openImportModal();
    });

    // Export format toggle
    document.querySelectorAll('input[name="export-format"]').forEach(radio => {
        radio.addEventListener('change', () => {
            const isEncrypted = radio.value === 'encrypted';
            $('export-password-section').style.display = isEncrypted ? 'block' : 'none';
            $('export-plain-section').style.display = isEncrypted ? 'none' : 'block';
        });
    });

    // Migration toggle
    $('migration-toggle').addEventListener('click', () => {
        const content = $('migration-content');
        const chevron = $('migration-toggle').querySelector('.chevron-icon');
        const isOpen = content.style.display !== 'none';
        content.style.display = isOpen ? 'none' : 'block';
        chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
    });

    $('how-it-works-toggle').addEventListener('click', () => {
        const content = $('how-it-works-content');
        const chevron = $('how-it-works-toggle').querySelector('.chevron-icon');
        const isOpen = content.style.display !== 'none';
        content.style.display = isOpen ? 'none' : 'block';
        chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
    });


    // Account modal
    $('modal-close-btn').addEventListener('click', closeAccountModal);
    $('modal-cancel-btn').addEventListener('click', closeAccountModal);
    accountModalOverlay.addEventListener('click', (e) => {
        if (e.target === accountModalOverlay) closeAccountModal();
    });
    modalSaveBtn.addEventListener('click', handleSaveAccount);
    $('secret-help-toggle').addEventListener('click', () => {
        const content = $('secret-help-content');
        const chevron = $('secret-help-toggle').querySelector('.chevron-icon');
        const isOpen = content.style.display !== 'none';
        content.style.display = isOpen ? 'none' : 'block';
        chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
    });
    $('download-instructions-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>ReDD 2FA — Setup Instructions</title>
<style>body{font-family:system-ui,sans-serif;max-width:600px;margin:40px auto;padding:0 20px;line-height:1.6;color:#333}h1{font-size:1.3em}ol{padding-left:20px}ol li{margin-bottom:8px}em{color:#555}</style>
</head><body>
<h1>Where do I find my secret key?</h1>
<p>Services usually show the secret key as a QR code — but a QR code is just a fancy way of displaying it. There's always an option to reveal the key as text instead.</p>
<p><strong>For university Microsoft accounts:</strong></p>
<ol>
<li>Go to <a href="https://mysignins.microsoft.com/security-info" target="_blank">mysignins.microsoft.com/security-info</a> and click <strong>Add sign-in method</strong></li>
<li>Select <strong>Microsoft Authenticator</strong> → <strong>Set up a different authentication app</strong> → <strong>Next</strong> → <strong>Can't scan the QR code?</strong> → copy the secret key</li>
<li>Paste the secret key in ReDD 2FA, then copy one of the generated codes and give it to Microsoft — done!</li>
</ol>
<p><em>Note: When you next time log in, your Microsoft account may still default to the Authenticator app — click "Sign in another way" / "I can't use my Microsoft Authenticator app right now" → Use a verification code.</em></p>
</body></html>`;
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'redd-2fa-setup-instructions.html';
        a.click();
        URL.revokeObjectURL(url);
    });

    // Secret validation
    manualSecret.addEventListener('input', () => {
        const val = manualSecret.value.trim();
        if (val.length === 0) {
            hideElement(secretValidation);
        } else if (validateBase32(val)) {
            secretValidation.className = 'feedback-text valid';
            secretValidation.textContent = '✓ Valid secret key';
            showElement(secretValidation);
        } else {
            secretValidation.className = 'feedback-text invalid';
            secretValidation.textContent = 'Invalid key — use letters A-Z and digits 2-7';
            showElement(secretValidation);
        }
    });

    // Search
    searchInput.addEventListener('input', renderAccounts);

    // Delete modal
    $('delete-cancel-btn').addEventListener('click', () => {
        deleteModalOverlay.style.display = 'none';
    });
    $('delete-confirm-btn').addEventListener('click', handleDeleteAccount);

    // Export modal
    $('export-cancel-btn').addEventListener('click', () => {
        exportModalOverlay.style.display = 'none';
    });
    exportModalOverlay.addEventListener('click', (e) => {
        if (e.target === exportModalOverlay) exportModalOverlay.style.display = 'none';
    });
    $('export-confirm-btn').addEventListener('click', handleExport);

    // Import modal
    $('import-cancel-btn').addEventListener('click', () => {
        importModalOverlay.style.display = 'none';
    });
    importModalOverlay.addEventListener('click', (e) => {
        if (e.target === importModalOverlay) importModalOverlay.style.display = 'none';
    });
    $('import-confirm-btn').addEventListener('click', handleImport);
    importFile.addEventListener('change', () => {
        const file = importFile.files?.[0];
        if (file && file.name.endsWith('.json')) {
            importPasswordSection.style.display = 'block';
        } else {
            importPasswordSection.style.display = 'none';
        }
    });


    // Toggle visibility buttons
    document.querySelectorAll('.toggle-visibility').forEach((btn) => {
        btn.addEventListener('click', () => {
            const targetId = btn.dataset.target;
            const input = $(targetId);
            input.type = input.type === 'password' ? 'text' : 'password';
        });
    });

    // Activity tracking
    document.addEventListener('click', () => touchActivity());
    document.addEventListener('keydown', () => touchActivity());

    // Open external links in a new tab
    document.addEventListener('click', (e) => {
        const link = e.target.closest('a[href]');
        if (link && link.href.startsWith('http')) {
            e.preventDefault();
            window.open(link.href, '_blank');
        }
    });
}

// ========================================
// Setup handler
// ========================================
async function handleSetup() {
    const passphrase = setupPassphraseInput.value;
    setupBtn.disabled = true;
    setupBtn.textContent = 'Setting up...';

    try {
        const key = await setupPassphrase(passphrase);
        setSessionKey(key);
        setAutoLockMinutes(settings.autoLockMinutes);
        accounts = [];
        showScreen('main');
        renderAccounts();

        // Offer biometric setup after first passphrase creation
        await promptBiometricSetup(passphrase);
    } catch (err) {
        showElement(setupError, 'Setup failed. Please try again.');
        setupBtn.disabled = false;
        setupBtn.textContent = 'Create & Unlock';
    }
}

// ========================================
// Unlock handler
// ========================================
let failedAttempts = 0;
let lockoutUntil = 0;

async function handleUnlock() {
    const passphrase = unlockPassphraseInput.value;
    if (!passphrase) return;

    // Check lockout
    const now = Date.now();
    if (now < lockoutUntil) {
        const remaining = Math.ceil((lockoutUntil - now) / 1000);
        showElement(unlockError, `Too many failed attempts. Try again in ${remaining}s.`);
        return;
    }

    unlockBtn.disabled = true;
    unlockBtn.textContent = 'Unlocking...';

    try {
        const key = await unlockWithPassphrase(passphrase);
        if (!key) {
            failedAttempts++;
            // Progressive lockout: 5s after 5 failures, 30s after 10, 5min after 15
            if (failedAttempts >= 15) {
                lockoutUntil = Date.now() + 5 * 60 * 1000;
                showElement(unlockError, 'Too many failed attempts. Locked for 5 minutes.');
            } else if (failedAttempts >= 10) {
                lockoutUntil = Date.now() + 30 * 1000;
                showElement(unlockError, 'Too many failed attempts. Locked for 30 seconds.');
            } else if (failedAttempts >= 5) {
                lockoutUntil = Date.now() + 5 * 1000;
                showElement(unlockError, 'Too many failed attempts. Locked for 5 seconds.');
            } else {
                showElement(unlockError, 'Incorrect passphrase.');
            }
            unlockBtn.disabled = false;
            unlockBtn.textContent = 'Unlock';
            return;
        }

        // Success — reset counter
        failedAttempts = 0;
        lockoutUntil = 0;
        setSessionKey(key);
        setAutoLockMinutes(settings.autoLockMinutes);
        accounts = await loadAccounts(key);
        unlockPassphraseInput.value = '';
        hideElement(unlockError);
        showScreen('main');
        renderAccounts();

        // Offer biometric setup if not already configured
        const existingBiometric = await loadBiometricData();
        if (!existingBiometric) {
            await promptBiometricSetup(passphrase);
        }
    } catch (err) {
        showElement(unlockError, 'Failed to unlock. Please try again.');
    }

    unlockBtn.disabled = false;
    unlockBtn.textContent = 'Unlock';
}

// ========================================
// Biometric
// ========================================

/**
 * Configure the lock screen — show Touch ID button if biometric is set up.
 */
async function setupLockScreen() {
    const biometricData = await loadBiometricData();
    if (biometricData) {
        biometricUnlockBtn.style.display = 'flex';
        passphraseDivider.style.display = 'flex';
    } else {
        biometricUnlockBtn.style.display = 'none';
        passphraseDivider.style.display = 'none';
        unlockPassphraseInput.focus();
    }
    hideElement(biometricError);
}

/**
 * Prompt user to enable biometric unlock (if available and not already set up).
 */
let pendingPassphraseTimer = null;

async function promptBiometricSetup(passphrase) {
    try {
        const available = await isBiometricAvailable();
        if (!available) return;

        // Check if user dismissed the prompt permanently
        const { redd2fa_biometric_dont_ask } = await browser.storage.local.get('redd2fa_biometric_dont_ask');
        if (redd2fa_biometric_dont_ask) return;

        pendingPassphrase = passphrase;
        $('biometric-dont-ask-checkbox').checked = false;
        biometricPromptOverlay.style.display = 'flex';

        // Auto-clear passphrase from memory after 60s if user doesn't act
        if (pendingPassphraseTimer) clearTimeout(pendingPassphraseTimer);
        pendingPassphraseTimer = setTimeout(() => {
            pendingPassphrase = null;
            biometricPromptOverlay.style.display = 'none';
            pendingPassphraseTimer = null;
        }, 60_000);
    } catch {
        // Biometric not available — silently skip
    }
}

/**
 * Handle biometric unlock from the lock screen.
 */
async function handleBiometricUnlock() {
    try {
        biometricUnlockBtn.disabled = true;
        hideElement(biometricError);

        const biometricData = await loadBiometricData();
        if (!biometricData) return;


        const passphrase = await authenticateBiometric(biometricData);
        const key = await unlockWithPassphrase(passphrase);
        if (!key) {
            showElement(biometricError, 'Biometric data outdated. Please use your passphrase.');
            return;
        }

        setSessionKey(key);
        setAutoLockMinutes(settings.autoLockMinutes);
        accounts = await loadAccounts(key);
        hideElement(biometricError);
        showScreen('main');
        renderAccounts();
    } catch (err) {
        showElement(biometricError, 'Touch ID failed. Try again or use your passphrase.');
    } finally {
        biometricUnlockBtn.disabled = false;
    }
}

/**
 * Perform the actual biometric registration (WebAuthn credential creation + PRF).
 * If a previously disabled credential exists, try to reuse it first.
 */
async function performBiometricRegistration() {
    try {
        // Check for existing (disabled) credential we can reuse
        const existing = await loadBiometricDataRaw();
        if (existing?.disabled && existing.credentialId) {
            try {
                // Test if the old credential still works
                const passphrase = await authenticateBiometric(existing);
                // It works — re-enable with existing data
                delete existing.disabled;
                await saveBiometricData(existing);
                pendingPassphrase = null;
                if (pendingPassphraseTimer) { clearTimeout(pendingPassphraseTimer); pendingPassphraseTimer = null; }
                biometricPromptOverlay.style.display = 'none';
                showToast('Touch ID re-enabled!');
                updateBiometricToggle();
                return;
            } catch {
                // Old credential failed — fall through to create a new one
                console.log('Existing credential could not be reused, creating new one.');
            }
        }

        const data = await registerBiometric(pendingPassphrase);
        await saveBiometricData(data);
        pendingPassphrase = null;
        if (pendingPassphraseTimer) { clearTimeout(pendingPassphraseTimer); pendingPassphraseTimer = null; }
        biometricPromptOverlay.style.display = 'none';
        showToast('Touch ID enabled!');
        updateBiometricToggle();
    } catch (err) {
        console.error('Biometric registration failed:', err);
        pendingPassphrase = null;
        if (pendingPassphraseTimer) { clearTimeout(pendingPassphraseTimer); pendingPassphraseTimer = null; }
        biometricPromptOverlay.style.display = 'none';
        showToast('Biometric setup failed. Try deleting old passkeys in your OS settings.');
    }
}

/**
 * Register biometric listeners.
 */
function initBiometricListeners() {
    biometricUnlockBtn.addEventListener('click', handleBiometricUnlock);

    $('biometric-enable-btn').addEventListener('click', async () => {
        if (!pendingPassphrase) return;

        const isWindows = navigator.userAgent.includes('Windows');
        if (isWindows) {
            // Show Windows hint before proceeding
            biometricPromptOverlay.style.display = 'none';
            $('windows-hint-overlay').style.display = 'flex';
        } else {
            await performBiometricRegistration();
        }
    });

    // Windows hint buttons
    $('windows-hint-proceed-btn').addEventListener('click', async () => {
        $('windows-hint-overlay').style.display = 'none';
        await performBiometricRegistration();
    });

    $('windows-hint-cancel-btn').addEventListener('click', () => {
        $('windows-hint-overlay').style.display = 'none';
        pendingPassphrase = null;
        if (pendingPassphraseTimer) { clearTimeout(pendingPassphraseTimer); pendingPassphraseTimer = null; }
    });

    $('biometric-skip-btn').addEventListener('click', async () => {
        if ($('biometric-dont-ask-checkbox').checked) {
            await browser.storage.local.set({ redd2fa_biometric_dont_ask: true });
        }
        pendingPassphrase = null;
        if (pendingPassphraseTimer) { clearTimeout(pendingPassphraseTimer); pendingPassphraseTimer = null; }
        biometricPromptOverlay.style.display = 'none';
    });

    biometricToggleBtn.addEventListener('click', async () => {
        const biometricData = await loadBiometricData();
        if (biometricData) {
            await disableBiometric();
            showToast('Touch ID disabled.');
            updateBiometricToggle();
        } else {
            // To re-enable, user needs to lock and unlock with passphrase
            showToast('Lock and unlock with passphrase to re-enable Touch ID.');
        }
    });
}

/**
 * Update the biometric toggle button text in settings.
 */
async function updateBiometricToggle() {
    try {
        const available = await isBiometricAvailable();
        if (!available) {
            biometricToggleBtn.style.display = 'none';
            return;
        }
        const biometricData = await loadBiometricData();
        biometricToggleBtn.style.display = 'block';
        biometricToggleBtn.textContent = biometricData ? 'Disable Touch ID' : 'Enable Touch ID';
        if (biometricData) {
            biometricToggleBtn.classList.add('settings-action-danger');
        } else {
            biometricToggleBtn.classList.remove('settings-action-danger');
        }
    } catch {
        biometricToggleBtn.style.display = 'none';
    }
}

// ========================================
// Account rendering
// ========================================
async function renderAccounts() {
    const query = searchInput.value.toLowerCase().trim();
    const filtered = query
        ? accounts.filter(a =>
            a.issuer.toLowerCase().includes(query) ||
            a.accountName.toLowerCase().includes(query)
        )
        : accounts;

    if (accounts.length === 0) {
        accountList.style.display = 'none';
        emptyState.style.display = 'block';
        return;
    }

    accountList.style.display = 'block';
    emptyState.style.display = 'none';

    // Generate all codes in parallel (async Web Crypto)
    const codes = await Promise.all(
        filtered.map(a => generateTOTP(a.secret, a.digits, a.period, a.algorithm))
    );

    const fragment = document.createDocumentFragment();
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const circumference = 2 * Math.PI * 10;

    filtered.forEach((account, i) => {
        const formattedCode = formatCode(codes[i]);

        const card = document.createElement('div');
        card.className = 'account-card';
        card.dataset.id = account.id;
        card.title = 'Click to copy code';

        // Account actions
        const actions = document.createElement('div');
        actions.className = 'account-actions';

        const editQuickBtn = document.createElement('button');
        editQuickBtn.className = 'account-edit-btn';
        editQuickBtn.dataset.id = account.id;
        editQuickBtn.title = 'Edit account';
        editQuickBtn.setAttribute('aria-label', 'Edit account');
        editQuickBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3Z" />
                <path d="m15 5 4 4" />
            </svg>
        `;

        const more = document.createElement('div');
        more.className = 'account-more';
        const moreBtn = document.createElement('button');
        moreBtn.className = 'more-btn';
        moreBtn.dataset.id = account.id;
        moreBtn.title = 'More options';
        moreBtn.textContent = '⋮';
        const menu = document.createElement('div');
        menu.className = 'more-menu';
        menu.dataset.id = account.id;
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'more-menu-item delete-btn';
        deleteBtn.dataset.id = account.id;
        deleteBtn.textContent = 'Delete';
        menu.append(deleteBtn);
        more.append(moreBtn, menu);
        actions.append(editQuickBtn, more);

        // Info
        const info = document.createElement('div');
        info.className = 'account-info';
        const issuerEl = document.createElement('div');
        issuerEl.className = 'account-issuer';
        issuerEl.textContent = account.issuer || 'Unknown';
        info.appendChild(issuerEl);

        // Code section
        const codeSection = document.createElement('div');
        codeSection.className = 'account-code-section';
        const codeSpan = document.createElement('span');
        codeSpan.className = 'account-code';
        codeSpan.dataset.accountId = account.id;
        codeSpan.textContent = formattedCode;

        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('class', 'progress-ring');
        svg.setAttribute('viewBox', '0 0 26 26');
        const track = document.createElementNS(SVG_NS, 'circle');
        track.setAttribute('class', 'progress-ring__track');
        track.setAttribute('cx', '13');
        track.setAttribute('cy', '13');
        track.setAttribute('r', '10');
        const fill = document.createElementNS(SVG_NS, 'circle');
        fill.setAttribute('class', 'progress-ring__fill');
        fill.setAttribute('cx', '13');
        fill.setAttribute('cy', '13');
        fill.setAttribute('r', '10');
        fill.setAttribute('stroke-dasharray', String(circumference));
        fill.setAttribute('stroke-dashoffset', '0');
        fill.dataset.accountId = account.id;
        const text = document.createElementNS(SVG_NS, 'text');
        text.setAttribute('class', 'progress-ring__text');
        text.setAttribute('x', '13');
        text.setAttribute('y', '13');
        text.dataset.accountId = account.id;
        svg.append(track, fill, text);
        codeSection.append(codeSpan, svg);

        card.append(actions, info, codeSection);
        fragment.appendChild(card);
    });
    accountList.replaceChildren(fragment);

    // Attach click handlers
    accountList.querySelectorAll('.account-card').forEach((card) => {
        card.addEventListener('click', (e) => {
            const target = e.target;
            // Don't copy if clicking row action buttons or menus
            if (target.closest('.account-actions')) return;
            const id = card.dataset.id;
            copyCode(id, card);
        });
    });

    accountList.querySelectorAll('.account-edit-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            closeAllMoreMenus();
            openAccountModal(id);
        });
    });

    // Ellipsis menu toggle
    accountList.querySelectorAll('.more-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            // Close any other open menus
            accountList.querySelectorAll('.more-menu.open').forEach(m => {
                if (m.dataset.id !== id) m.classList.remove('open');
            });
            const menu = accountList.querySelector(`.more-menu[data-id="${id}"]`);
            if (menu) menu.classList.toggle('open');
        });
    });

    accountList.querySelectorAll('.delete-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            closeAllMoreMenus();
            openDeleteModal(id);
        });
    });

    updateProgressRings();
}

function closeAllMoreMenus() {
    document.querySelectorAll('.more-menu.open').forEach(m => m.classList.remove('open'));
}

// Close menus when clicking outside
document.addEventListener('click', () => closeAllMoreMenus());

// ========================================
// TOTP refresh loop
// ========================================
function startTOTPRefresh() {
    stopTOTPRefresh();
    totpInterval = setInterval(() => {
        updateCodes();
        updateProgressRings();
    }, 1000);
}

function stopTOTPRefresh() {
    if (totpInterval) {
        clearInterval(totpInterval);
        totpInterval = null;
    }
}

// Track last known TOTP counter per account to detect period rollovers
const lastCounters = new Map();

async function updateCodes() {
    const nowSec = Math.floor(Date.now() / 1000);
    const elements = accountList.querySelectorAll('.account-code');
    for (const el of elements) {
        const account = accounts.find(a => a.id === el.dataset.accountId);
        if (!account) continue;
        const period = account.period || 30;
        const counter = Math.floor(nowSec / period);

        // Only regenerate when the counter changes
        if (lastCounters.get(account.id) === counter) continue;
        lastCounters.set(account.id, counter);

        const code = await generateTOTP(account.secret, account.digits || 6, period, account.algorithm || 'SHA1');
        el.textContent = formatCode(code);
    }
}

function updateProgressRings() {
    accountList.querySelectorAll('.progress-ring__fill').forEach((circle) => {
        const account = accounts.find(a => a.id === circle.dataset.accountId);
        const period = account?.period || 30;
        const remaining = getRemainingSeconds(period);
        const circumference = 2 * Math.PI * 10;
        const progress = remaining / period;
        const offset = circumference * (1 - progress);

        circle.style.strokeDashoffset = String(offset);

        // Color based on remaining time
        if (remaining <= 5) {
            circle.style.stroke = 'var(--ring-critical)';
        } else if (remaining <= 10) {
            circle.style.stroke = 'var(--ring-warn)';
        } else {
            circle.style.stroke = '';
        }
    });

    accountList.querySelectorAll('.progress-ring__text').forEach((text) => {
        const account = accounts.find(a => a.id === text.dataset.accountId);
        const period = account?.period || 30;
        const remaining = getRemainingSeconds(period);
        text.textContent = String(remaining);
    });
}

// ========================================
// Clipboard
// ========================================
let clipboardClearTimer = null;

async function copyCode(accountId, cardElement) {
    const account = accounts.find(a => a.id === accountId);
    if (!account) return;

    const code = await generateTOTP(account.secret, account.digits, account.period, account.algorithm);

    try {
        await navigator.clipboard.writeText(code);
        showToast('Copied!');

        // Flash card
        cardElement.classList.add('copied');
        setTimeout(() => cardElement.classList.remove('copied'), 600);

        // Auto-clear clipboard after 30 seconds
        if (clipboardClearTimer) clearTimeout(clipboardClearTimer);
        clipboardClearTimer = setTimeout(() => {
            navigator.clipboard.writeText('').catch(() => { });
            clipboardClearTimer = null;
        }, 30_000);
    } catch {
        showToast('Failed to copy');
    }
}

// ========================================
// Account Modal
// ========================================
function openAccountModal(editId) {
    editingAccountId = editId || null;
    resetModal();

    if (editId) {
        const account = accounts.find(a => a.id === editId);
        if (!account) return;
        modalTitle.textContent = 'Edit Account';
        manualLabel.value = account.issuer || account.accountName;
        manualSecret.value = account.secret;
    } else {
        modalTitle.textContent = 'Add Account';
    }

    accountModalOverlay.style.display = 'flex';
    manualLabel.focus();
}

function closeAccountModal() {
    accountModalOverlay.style.display = 'none';
    resetModal();
}

function resetModal() {
    manualLabel.value = '';
    manualSecret.value = '';
    manualSecret.type = 'password';
    hideElement(secretValidation);
    hideElement(modalError);
}

async function handleSaveAccount() {
    const key = getSessionKey();
    if (!key) return;

    const label = manualLabel.value.trim();
    const secret = manualSecret.value.trim();

    if (!label) {
        showElement(modalError, 'Label is required.');
        return;
    }
    if (!secret || !validateBase32(secret)) {
        showElement(modalError, 'A valid secret key is required (letters A-Z and digits 2-7).');
        return;
    }

    const account = {
        id: editingAccountId || generateId(),
        issuer: label,
        accountName: label,
        secret: normalizeSecret(secret),
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
    };

    // Save
    if (editingAccountId) {
        const idx = accounts.findIndex(a => a.id === editingAccountId);
        if (idx >= 0) accounts[idx] = account;
    } else {
        accounts.push(account);
    }

    await saveAccounts(accounts, key);
    closeAccountModal();
    renderAccounts();
    showToast(editingAccountId ? 'Account updated' : 'Account added');
}

// ========================================
// Delete
// ========================================
let deletingAccountId = null;

function openDeleteModal(id) {
    const account = accounts.find(a => a.id === id);
    if (!account) return;
    deletingAccountId = id;
    deleteAccountName.textContent = `${account.issuer || 'Unknown'} — ${account.accountName}`;
    deleteModalOverlay.style.display = 'flex';
}

async function handleDeleteAccount() {
    if (!deletingAccountId) return;
    const key = getSessionKey();
    if (!key) return;

    accounts = accounts.filter(a => a.id !== deletingAccountId);
    await saveAccounts(accounts, key);
    deleteModalOverlay.style.display = 'none';
    deletingAccountId = null;
    renderAccounts();
    showToast('Account deleted');
}

// ========================================
// Change Passphrase
// ========================================
function openChangePassphraseModal() {
    $('current-passphrase').value = '';
    $('new-passphrase').value = '';
    $('new-passphrase-confirm').value = '';
    hideElement($('change-passphrase-error'));
    $('change-passphrase-overlay').style.display = 'flex';
    $('current-passphrase').focus();
}

function closeChangePassphraseModal() {
    $('change-passphrase-overlay').style.display = 'none';
}

async function handleChangePassphrase() {
    const current = $('current-passphrase').value;
    const newPw = $('new-passphrase').value;
    const newPwConfirm = $('new-passphrase-confirm').value;
    const errorEl = $('change-passphrase-error');

    if (!current) {
        showElement(errorEl, 'Please enter your current passphrase.');
        return;
    }

    // Verify current passphrase
    const key = await unlockWithPassphrase(current);
    if (!key) {
        showElement(errorEl, 'Current passphrase is incorrect.');
        return;
    }

    if (newPw.length < 8) {
        showElement(errorEl, 'New passphrase must be at least 8 characters.');
        return;
    }
    if (newPw !== newPwConfirm) {
        showElement(errorEl, 'New passphrases do not match.');
        return;
    }

    try {
        const newKey = await changePassphrase(accounts, newPw);
        setSessionKey(newKey);

        // Clear biometric data — it wraps the old passphrase
        await clearBiometricData();

        closeChangePassphraseModal();
        showToast('Passphrase changed successfully');
    } catch {
        showElement(errorEl, 'Failed to change passphrase. Please try again.');
    }
}

// ========================================
// Export
// ========================================
function openExportModal() {
    exportPassword.value = '';
    exportPasswordConfirm.value = '';
    hideElement(exportError);
    // Reset to encrypted format
    const encryptedRadio = document.querySelector('input[name="export-format"][value="encrypted"]');
    if (encryptedRadio) encryptedRadio.checked = true;
    $('export-password-section').style.display = 'block';
    $('export-plain-section').style.display = 'none';
    exportModalOverlay.style.display = 'flex';
}

async function handleExport() {
    const format = document.querySelector('input[name="export-format"]:checked')?.value || 'encrypted';

    if (format === 'plain') {
        // Plain text URI export
        const uris = accounts.map(a => buildOtpauthURI(a)).join('\n');
        downloadFile(uris, `redd-2fa-uris-${dateStamp()}.txt`, 'text/plain');
        exportModalOverlay.style.display = 'none';
        showToast('Plain text URIs exported');
        return;
    }

    // Encrypted export
    const pw = exportPassword.value;
    const pwConfirm = exportPasswordConfirm.value;

    if (pw.length < 8) {
        showElement(exportError, 'Password must be at least 8 characters.');
        return;
    }
    if (pw !== pwConfirm) {
        showElement(exportError, 'Passwords do not match.');
        return;
    }

    try {
        const { generateSalt, deriveKey, encrypt } = await import('./crypto.js');
        const salt = generateSalt();
        const exportKey = await deriveKey(pw, salt);

        // Export only essential data: label + secret pairs
        const essentialData = accounts.map(a => ({
            label: a.issuer || a.accountName,
            secret: a.secret,
        }));
        const plaintext = JSON.stringify(essentialData);
        const encrypted = await encrypt(plaintext, exportKey);

        const exportData = {
            format: 'redd-2fa-backup',
            version: 2,
            salt,
            ...encrypted,
        };

        downloadFile(
            JSON.stringify(exportData, null, 2),
            `redd-2fa-backup-${dateStamp()}.json`,
            'application/json'
        );

        // Save backup fingerprint so we can detect future changes
        await saveBackupFingerprint(accounts);
        $('backup-badge').style.display = 'none';

        exportModalOverlay.style.display = 'none';
        showToast('Backup exported');
    } catch {
        showElement(exportError, 'Export failed.');
    }
}



// ========================================
// Import
// ========================================
function openImportModal() {
    importFile.value = '';
    importPassword.value = '';
    importPasswordSection.style.display = 'none';
    hideElement(importError);
    hideElement(importSuccess);
    importModalOverlay.style.display = 'flex';
}

async function handleImport() {
    const file = importFile.files?.[0];
    if (!file) {
        showElement(importError, 'Please select a file.');
        return;
    }

    const key = getSessionKey();
    if (!key) return;

    try {
        const text = await file.text();

        if (file.name.endsWith('.json')) {
            // Encrypted backup
            const data = JSON.parse(text);

            if (data.format === 'redd-2fa-backup') {
                const pw = importPassword.value;
                if (!pw) {
                    showElement(importError, 'Please enter the backup password.');
                    return;
                }
                const { deriveKey: dk, decrypt: dec } = await import('./crypto.js');
                const importKey = await dk(pw, data.salt);
                try {
                    const plaintext = await dec(data.iv, data.ciphertext, importKey);
                    let imported = JSON.parse(plaintext);

                    // v2 format: convert label+secret pairs to full account objects
                    if (data.version >= 2) {
                        imported = imported.map(item => ({
                            id: generateId(),
                            issuer: item.label,
                            accountName: item.label,
                            secret: item.secret,
                            algorithm: 'SHA1',
                            digits: 6,
                            period: 30,
                        }));
                    }

                    await importMerge(imported, key);
                } catch {
                    showElement(importError, 'Wrong password or corrupted backup.');
                    return;
                }
            } else {
                // Try as plain account array
                const imported = data;
                if (!Array.isArray(imported)) {
                    showElement(importError, 'Invalid backup file format.');
                    return;
                }
                await importMerge(imported, key);
            }
        } else {
            // Plain text — otpauth:// URIs
            const lines = text.split('\n').map(l => l.trim()).filter(l => l.startsWith('otpauth://'));
            if (lines.length === 0) {
                showElement(importError, 'No valid otpauth:// URIs found.');
                return;
            }
            const imported = [];
            for (const line of lines) {
                const parsed = parseOtpauthURI(line);
                if (parsed) {
                    imported.push({ id: generateId(), ...parsed });
                }
            }
            if (imported.length === 0) {
                showElement(importError, 'Could not parse any valid URIs.');
                return;
            }
            await importMerge(imported, key);
        }

        importModalOverlay.style.display = 'none';
        renderAccounts();
        showToast('Import complete');
    } catch {
        showElement(importError, 'Import failed. Check file format.');
    }
}

async function importMerge(imported, key) {
    const existingSecrets = new Set(accounts.map(a => a.secret));
    const newAccounts = imported.filter(a => !existingSecrets.has(a.secret));
    // Ensure unique IDs
    newAccounts.forEach(a => {
        if (accounts.some(existing => existing.id === a.id)) {
            a.id = generateId();
        }
    });
    accounts = [...accounts, ...newAccounts];
    await saveAccounts(accounts, key);
}

// ========================================
// Helpers
// ========================================
function showElement(el, text) {
    if (text) el.textContent = text;
    el.style.display = 'block';
}

function hideElement(el) {
    el.style.display = 'none';
}

function showToast(message) {
    toast.textContent = message;
    toast.style.display = 'block';
    setTimeout(() => {
        toast.style.display = 'none';
    }, 2000);
}

function formatCode(code) {
    if (code.length === 6) return code.slice(0, 3) + ' ' + code.slice(3);
    if (code.length === 8) return code.slice(0, 4) + ' ' + code.slice(4);
    return code;
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

function dateStamp() {
    return new Date().toISOString().slice(0, 10);
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
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
