/**
 * ReDD 2FA — Main popup controller
 *
 * Manages all popup UI: setup, lock/unlock, account list,
 * TOTP code generation, modals, search, clipboard, and settings.
 */


import { generateTOTP, getRemainingSeconds, parseOtpauthURI, validateBase32, normalizeSecret } from './totp.js';
import { isFirstLaunch, setupPassphrase, unlockWithPassphrase, loadAccounts, saveAccounts, loadSettings, saveSettings, saveBiometricData, loadBiometricData, clearBiometricData } from './storage.js';
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
    document.body.classList.remove('dark-mode');
    if (theme === 'dark') {
        document.body.classList.add('dark-mode');
    } else if (theme === 'system') {
        if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
            document.body.classList.add('dark-mode');
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
    $('settings-btn').addEventListener('click', () => {
        settingsDropdown.style.display = settingsDropdown.style.display === 'none' ? 'block' : 'none';
        if (settingsDropdown.style.display === 'block') updateBiometricToggle();
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

    $('lock-btn').addEventListener('click', () => {
        lock();
        settingsDropdown.style.display = 'none';
        showScreen('lock');
    });

    // Export/Import
    $('export-btn').addEventListener('click', () => {
        settingsDropdown.style.display = 'none';
        openExportModal();
    });
    $('import-btn').addEventListener('click', () => {
        settingsDropdown.style.display = 'none';
        openImportModal();
    });
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
    modalSaveBtn.addEventListener('click', handleSaveAccount);
    $('secret-help-toggle').addEventListener('click', () => {
        const content = $('secret-help-content');
        const chevron = $('secret-help-toggle').querySelector('.chevron-icon');
        const isOpen = content.style.display !== 'none';
        content.style.display = isOpen ? 'none' : 'block';
        chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
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
    $('export-confirm-btn').addEventListener('click', handleExport);

    // Import modal
    $('import-cancel-btn').addEventListener('click', () => {
        importModalOverlay.style.display = 'none';
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

    // Open external links in the current tab (not a new tab)
    document.addEventListener('click', (e) => {
        const link = e.target.closest('a[href]');
        if (link && link.href.startsWith('http')) {
            e.preventDefault();
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0]) {
                    chrome.tabs.update(tabs[0].id, { url: link.href });
                }
            });
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
async function handleUnlock() {
    const passphrase = unlockPassphraseInput.value;
    if (!passphrase) return;

    unlockBtn.disabled = true;
    unlockBtn.textContent = 'Unlocking...';

    try {
        const key = await unlockWithPassphrase(passphrase);
        if (!key) {
            showElement(unlockError, 'Incorrect passphrase.');
            unlockBtn.disabled = false;
            unlockBtn.textContent = 'Unlock';
            return;
        }

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
async function promptBiometricSetup(passphrase) {
    try {
        const available = await isBiometricAvailable();
        if (!available) return;

        pendingPassphrase = passphrase;
        biometricPromptOverlay.style.display = 'flex';
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
 * Register biometric listeners.
 */
function initBiometricListeners() {
    biometricUnlockBtn.addEventListener('click', handleBiometricUnlock);

    $('biometric-enable-btn').addEventListener('click', async () => {
        try {
            if (!pendingPassphrase) return;
            const data = await registerBiometric(pendingPassphrase);
            await saveBiometricData(data);
            pendingPassphrase = null;
            biometricPromptOverlay.style.display = 'none';
            showToast('Touch ID enabled!');
            updateBiometricToggle();
        } catch (err) {
            pendingPassphrase = null;
            biometricPromptOverlay.style.display = 'none';
            showToast('Touch ID not available on this device.');
        }
    });

    $('biometric-skip-btn').addEventListener('click', () => {
        pendingPassphrase = null;
        biometricPromptOverlay.style.display = 'none';
    });

    biometricToggleBtn.addEventListener('click', async () => {
        const biometricData = await loadBiometricData();
        if (biometricData) {
            await clearBiometricData();
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

    accountList.innerHTML = filtered.map((account, i) => {
        const formattedCode = formatCode(codes[i]);
        const initials = getInitials(account.issuer || account.accountName);
        const color = getColorForIssuer(account.issuer);

        return `
      <div class="account-card" data-id="${account.id}" title="Click to copy code">
        <div class="account-more">
          <button class="more-btn" data-id="${account.id}" title="More options">⋮</button>
          <div class="more-menu" data-id="${account.id}">
            <button class="more-menu-item edit-btn" data-id="${account.id}">Edit</button>
            <button class="more-menu-item delete-btn" data-id="${account.id}">Delete</button>
          </div>
        </div>
        <div class="account-icon" style="background-color: ${color}">${initials}</div>
        <div class="account-info">
          <div class="account-issuer">${escapeHtml(account.issuer || 'Unknown')}</div>
        </div>
        <div class="account-code-section">
          <span class="account-code" data-secret="${account.secret}" data-digits="${account.digits}" data-period="${account.period}" data-algorithm="${account.algorithm}">${formattedCode}</span>
          <svg class="progress-ring" viewBox="0 0 26 26">
            <circle class="progress-ring__track" cx="13" cy="13" r="10"/>
            <circle class="progress-ring__fill" cx="13" cy="13" r="10"
              stroke-dasharray="${2 * Math.PI * 10}"
              stroke-dashoffset="0"
              data-period="${account.period}"/>
            <text class="progress-ring__text" x="13" y="13" data-period="${account.period}"></text>
          </svg>
        </div>
      </div>
    `;
    }).join('');

    // Attach click handlers
    accountList.querySelectorAll('.account-card').forEach((card) => {
        card.addEventListener('click', (e) => {
            const target = e.target;
            // Don't copy if clicking the more menu or its items
            if (target.closest('.account-more')) return;
            const id = card.dataset.id;
            copyCode(id, card);
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

    accountList.querySelectorAll('.edit-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            closeAllMoreMenus();
            openAccountModal(id);
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

async function updateCodes() {
    const elements = accountList.querySelectorAll('.account-code');
    for (const el of elements) {
        const secret = el.dataset.secret;
        const digits = parseInt(el.dataset.digits || '6', 10);
        const period = parseInt(el.dataset.period || '30', 10);
        const algorithm = el.dataset.algorithm || 'SHA1';
        const remaining = getRemainingSeconds(period);

        // Only update when a new code is generated (at period boundary)
        if (remaining === period || remaining === period - 1) {
            const code = await generateTOTP(secret, digits, period, algorithm);
            el.textContent = formatCode(code);
        }
    }
}

function updateProgressRings() {
    accountList.querySelectorAll('.progress-ring__fill').forEach((circle) => {
        const period = parseInt(circle.dataset.period || '30', 10);
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
        const period = parseInt(text.dataset.period || '30', 10);
        const remaining = getRemainingSeconds(period);
        text.textContent = String(remaining);
    });
}

// ========================================
// Clipboard
// ========================================
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
// Export
// ========================================
function openExportModal() {
    exportPassword.value = '';
    exportPasswordConfirm.value = '';
    hideElement(exportError);
    exportModalOverlay.style.display = 'flex';
}

async function handleExport() {
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
                    const imported = JSON.parse(plaintext);
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

function getInitials(name) {
    return name.slice(0, 2).toUpperCase();
}

function getColorForIssuer(issuer) {
    const colors = [
        '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
        '#ec4899', '#f43f5e', '#ef4444', '#f97316',
        '#f59e0b', '#eab308', '#84cc16', '#22c55e',
        '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6',
    ];
    let hash = 0;
    for (let i = 0; i < issuer.length; i++) {
        hash = issuer.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
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
