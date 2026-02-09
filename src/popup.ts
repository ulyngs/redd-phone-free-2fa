/**
 * ReDD 2FA — Main popup controller
 *
 * Manages all popup UI: setup, lock/unlock, account list,
 * TOTP code generation, modals, search, clipboard, and settings.
 */

import browser from './browser';
import { generateTOTP, getRemainingSeconds, parseOtpauthURI, validateBase32, normalizeSecret, buildOtpauthURI } from './totp';
import { isFirstLaunch, setupPassphrase, unlockWithPassphrase, loadAccounts, saveAccounts, loadSettings, saveSettings } from './storage';
import { setSessionKey, getSessionKey, isUnlocked, lock, touchActivity, setAutoLockMinutes } from './session';
import type { Account, Settings } from './types';

// ========================================
// State
// ========================================
let accounts: Account[] = [];
let settings: Settings;
let totpInterval: ReturnType<typeof setInterval> | null = null;
let editingAccountId: string | null = null;

// ========================================
// DOM refs
// ========================================
const $ = (id: string) => document.getElementById(id)!;

// Screens
const setupScreen = $('setup-screen');
const lockScreen = $('lock-screen');
const mainScreen = $('main-screen');

// Setup
const setupPassphraseInput = $('setup-passphrase') as HTMLInputElement;
const setupPassphraseConfirm = $('setup-passphrase-confirm') as HTMLInputElement;
const setupError = $('setup-error');
const setupBtn = $('setup-btn') as HTMLButtonElement;

// Lock
const unlockPassphraseInput = $('unlock-passphrase') as HTMLInputElement;
const unlockError = $('unlock-error');
const unlockBtn = $('unlock-btn') as HTMLButtonElement;

// Main
const searchInput = $('search-input') as HTMLInputElement;
const accountList = $('account-list');
const emptyState = $('empty-state');
const settingsDropdown = $('settings-dropdown');

// Modal
const accountModalOverlay = $('account-modal-overlay');
const modalTitle = $('modal-title');
const tabUri = $('tab-uri');
const tabManual = $('tab-manual');
const uriPanel = $('uri-panel');
const manualPanel = $('manual-panel');
const uriInput = $('uri-input') as HTMLTextAreaElement;
const uriFeedback = $('uri-feedback');
const manualIssuer = $('manual-issuer') as HTMLInputElement;
const manualAccount = $('manual-account') as HTMLInputElement;
const manualSecret = $('manual-secret') as HTMLInputElement;
const secretValidation = $('secret-validation');
const modalError = $('modal-error');
const modalSaveBtn = $('modal-save-btn') as HTMLButtonElement;

// Delete modal
const deleteModalOverlay = $('delete-modal-overlay');
const deleteAccountName = $('delete-account-name');

// Export modal
const exportModalOverlay = $('export-modal-overlay');
const exportPassword = $('export-password') as HTMLInputElement;
const exportPasswordConfirm = $('export-password-confirm') as HTMLInputElement;
const exportError = $('export-error');

// Import modal
const importModalOverlay = $('import-modal-overlay');
const importFile = $('import-file') as HTMLInputElement;
const importPasswordSection = $('import-password-section');
const importPassword = $('import-password') as HTMLInputElement;
const importError = $('import-error');
const importSuccess = $('import-success');

// Plain export modal
const plainExportModalOverlay = $('plain-export-modal-overlay');

// Toast
const toast = $('toast');

// Settings
const themeSelect = $('theme-select') as HTMLSelectElement;
const autoLockSelect = $('auto-lock-select') as HTMLSelectElement;

// ========================================
// Initialization
// ========================================
document.addEventListener('DOMContentLoaded', async () => {
    settings = await loadSettings();
    applyTheme(settings.theme);
    initEventListeners();

    if (await isFirstLaunch()) {
        showScreen('setup');
    } else {
        showScreen('lock');
        unlockPassphraseInput.focus();
    }
});

// Listen for session lock messages from background
browser.runtime.onMessage.addListener((msg: any) => {
    if (msg.type === 'SESSION_LOCKED') {
        lock();
        showScreen('lock');
    }
    if (msg.type === 'DO_CLEAR_CLIPBOARD') {
        navigator.clipboard.writeText('').catch(() => { });
    }
});

// ========================================
// Screen management
// ========================================
function showScreen(screen: 'setup' | 'lock' | 'main') {
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
function applyTheme(theme: 'system' | 'light' | 'dark') {
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
    });
    $('settings-close-btn').addEventListener('click', () => {
        settingsDropdown.style.display = 'none';
    });

    themeSelect.value = settings.theme;
    themeSelect.addEventListener('change', async () => {
        settings.theme = themeSelect.value as Settings['theme'];
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
    $('export-plain-btn').addEventListener('click', () => {
        settingsDropdown.style.display = 'none';
        plainExportModalOverlay.style.display = 'flex';
    });

    // Account modal
    $('modal-close-btn').addEventListener('click', closeAccountModal);
    $('modal-cancel-btn').addEventListener('click', closeAccountModal);
    modalSaveBtn.addEventListener('click', handleSaveAccount);

    // Tab switching
    tabUri.addEventListener('click', () => switchTab('uri'));
    tabManual.addEventListener('click', () => switchTab('manual'));

    // URI real-time parsing
    uriInput.addEventListener('input', () => {
        const parsed = parseOtpauthURI(uriInput.value.trim());
        if (uriInput.value.trim().length === 0) {
            hideElement(uriFeedback);
        } else if (parsed) {
            uriFeedback.className = 'feedback-text valid';
            uriFeedback.textContent = `✓ ${parsed.issuer || 'Unknown'} — ${parsed.accountName}`;
            showElement(uriFeedback);
        } else {
            uriFeedback.className = 'feedback-text invalid';
            uriFeedback.textContent = 'Invalid otpauth:// URI';
            showElement(uriFeedback);
        }
    });

    // Secret validation
    manualSecret.addEventListener('input', () => {
        const val = manualSecret.value.trim();
        if (val.length === 0) {
            hideElement(secretValidation);
        } else if (validateBase32(val)) {
            secretValidation.className = 'feedback-text valid';
            secretValidation.textContent = '✓ Valid Base32 secret';
            showElement(secretValidation);
        } else {
            secretValidation.className = 'feedback-text invalid';
            secretValidation.textContent = 'Invalid Base32 — use letters A-Z and digits 2-7';
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

    // Plain export modal
    $('plain-export-cancel-btn').addEventListener('click', () => {
        plainExportModalOverlay.style.display = 'none';
    });
    $('plain-export-confirm-btn').addEventListener('click', handlePlainExport);

    // Toggle visibility buttons
    document.querySelectorAll('.toggle-visibility').forEach((btn) => {
        btn.addEventListener('click', () => {
            const targetId = (btn as HTMLElement).dataset.target!;
            const input = $(targetId) as HTMLInputElement;
            input.type = input.type === 'password' ? 'text' : 'password';
        });
    });

    // Activity tracking
    document.addEventListener('click', () => touchActivity());
    document.addEventListener('keydown', () => touchActivity());
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
    } catch (err) {
        showElement(unlockError, 'Failed to unlock. Please try again.');
    }

    unlockBtn.disabled = false;
    unlockBtn.textContent = 'Unlock';
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
        <div class="account-icon" style="background-color: ${color}">${initials}</div>
        <div class="account-info">
          <div class="account-issuer">${escapeHtml(account.issuer || 'Unknown')}</div>
          <div class="account-name">${escapeHtml(account.accountName)}</div>
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
        <div class="account-actions">
          <button class="account-action-btn edit-btn" data-id="${account.id}" title="Edit">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="account-action-btn delete-btn" data-id="${account.id}" title="Delete">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </div>
    `;
    }).join('');

    // Attach click handlers
    accountList.querySelectorAll('.account-card').forEach((card) => {
        card.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            // Don't copy if clicking edit/delete buttons
            if (target.closest('.account-action-btn')) return;
            const id = (card as HTMLElement).dataset.id!;
            copyCode(id, card as HTMLElement);
        });
    });

    accountList.querySelectorAll('.edit-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = (btn as HTMLElement).dataset.id!;
            openAccountModal(id);
        });
    });

    accountList.querySelectorAll('.delete-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = (btn as HTMLElement).dataset.id!;
            openDeleteModal(id);
        });
    });

    updateProgressRings();
}

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
        const secret = (el as HTMLElement).dataset.secret!;
        const digits = parseInt((el as HTMLElement).dataset.digits || '6', 10);
        const period = parseInt((el as HTMLElement).dataset.period || '30', 10);
        const algorithm = (el as HTMLElement).dataset.algorithm || 'SHA1';
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
        const period = parseInt((circle as SVGElement).dataset.period || '30', 10);
        const remaining = getRemainingSeconds(period);
        const circumference = 2 * Math.PI * 10;
        const progress = remaining / period;
        const offset = circumference * (1 - progress);

        (circle as SVGCircleElement).style.strokeDashoffset = String(offset);

        // Color based on remaining time
        if (remaining <= 5) {
            (circle as SVGCircleElement).style.stroke = 'var(--ring-critical)';
        } else if (remaining <= 10) {
            (circle as SVGCircleElement).style.stroke = 'var(--ring-warn)';
        } else {
            (circle as SVGCircleElement).style.stroke = '';
        }
    });

    accountList.querySelectorAll('.progress-ring__text').forEach((text) => {
        const period = parseInt((text as SVGElement).dataset.period || '30', 10);
        const remaining = getRemainingSeconds(period);
        text.textContent = String(remaining);
    });
}

// ========================================
// Clipboard
// ========================================
async function copyCode(accountId: string, cardElement: HTMLElement) {
    const account = accounts.find(a => a.id === accountId);
    if (!account) return;

    const code = await generateTOTP(account.secret, account.digits, account.period, account.algorithm);

    try {
        await navigator.clipboard.writeText(code);
        showToast('Copied!');

        // Flash card
        cardElement.classList.add('copied');
        setTimeout(() => cardElement.classList.remove('copied'), 600);

        // Schedule clipboard clear via background
        browser.runtime.sendMessage({
            type: 'CLEAR_CLIPBOARD',
            delayMs: (settings.clipboardClearSeconds || 15) * 1000,
        }).catch(() => {
            // Fallback: clear from popup directly
            setTimeout(() => {
                navigator.clipboard.writeText('').catch(() => { });
            }, (settings.clipboardClearSeconds || 15) * 1000);
        });
    } catch {
        showToast('Failed to copy');
    }
}

// ========================================
// Account Modal
// ========================================
function openAccountModal(editId?: string) {
    editingAccountId = editId || null;
    resetModal();

    if (editId) {
        const account = accounts.find(a => a.id === editId);
        if (!account) return;
        modalTitle.textContent = 'Edit Account';
        switchTab('manual');
        manualIssuer.value = account.issuer;
        manualAccount.value = account.accountName;
        manualSecret.value = account.secret;
    } else {
        modalTitle.textContent = 'Add Account';
        switchTab('uri');
    }

    accountModalOverlay.style.display = 'flex';
    if (!editId) {
        uriInput.focus();
    }
}

function closeAccountModal() {
    accountModalOverlay.style.display = 'none';
    resetModal();
}

function resetModal() {
    uriInput.value = '';
    manualIssuer.value = '';
    manualAccount.value = '';
    manualSecret.value = '';
    hideElement(uriFeedback);
    hideElement(secretValidation);
    hideElement(modalError);
}

function switchTab(tab: 'uri' | 'manual') {
    tabUri.classList.toggle('active', tab === 'uri');
    tabManual.classList.toggle('active', tab === 'manual');
    uriPanel.style.display = tab === 'uri' ? 'block' : 'none';
    manualPanel.style.display = tab === 'manual' ? 'block' : 'none';
}

async function handleSaveAccount() {
    const key = getSessionKey();
    if (!key) return;

    let account: Account;

    // Determine if we're using URI or manual tab
    const isUriTab = tabUri.classList.contains('active');

    if (isUriTab && !editingAccountId) {
        const parsed = parseOtpauthURI(uriInput.value.trim());
        if (!parsed) {
            showElement(modalError, 'Invalid otpauth:// URI. Please check and try again.');
            return;
        }
        account = {
            id: generateId(),
            ...parsed,
        };
    } else {
        // Manual entry
        const issuer = manualIssuer.value.trim();
        const accountName = manualAccount.value.trim();
        const secret = manualSecret.value.trim();

        if (!accountName) {
            showElement(modalError, 'Account name is required.');
            return;
        }
        if (!secret || !validateBase32(secret)) {
            showElement(modalError, 'A valid Base32 secret is required (at least 16 characters, A-Z and 2-7).');
            return;
        }

        account = {
            id: editingAccountId || generateId(),
            issuer: issuer || '',
            accountName,
            secret: normalizeSecret(secret),
            algorithm: 'SHA1',
            digits: 6,
            period: 30,
        };
    }

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
let deletingAccountId: string | null = null;

function openDeleteModal(id: string) {
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
        // Import crypto functions directly
        const { generateSalt, deriveKey, encrypt } = await import('./crypto');
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

function handlePlainExport() {
    const uris = accounts.map(a => buildOtpauthURI(a)).join('\n');
    downloadFile(uris, `redd-2fa-uris-${dateStamp()}.txt`, 'text/plain');
    plainExportModalOverlay.style.display = 'none';
    showToast('URIs exported (unencrypted)');
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
                const { deriveKey: dk, decrypt: dec } = await import('./crypto');
                const importKey = await dk(pw, data.salt);
                try {
                    const plaintext = await dec(data.iv, data.ciphertext, importKey);
                    const imported = JSON.parse(plaintext) as Account[];
                    await importMerge(imported, key);
                } catch {
                    showElement(importError, 'Wrong password or corrupted backup.');
                    return;
                }
            } else {
                // Try as plain account array
                const imported = data as Account[];
                if (!Array.isArray(imported)) {
                    showElement(importError, 'Invalid backup file format.');
                    return;
                }
                await importMerge(imported, key);
            }
        } else {
            // Plain text — otpauth:// URIs
            const lines = text.split('\n').map((l: string) => l.trim()).filter((l: string) => l.startsWith('otpauth://'));
            if (lines.length === 0) {
                showElement(importError, 'No valid otpauth:// URIs found.');
                return;
            }
            const imported: Account[] = [];
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

async function importMerge(imported: Account[], key: CryptoKey) {
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
function showElement(el: HTMLElement, text?: string) {
    if (text) el.textContent = text;
    el.style.display = 'block';
}

function hideElement(el: HTMLElement) {
    el.style.display = 'none';
}

function showToast(message: string) {
    toast.textContent = message;
    toast.style.display = 'block';
    setTimeout(() => {
        toast.style.display = 'none';
    }, 2000);
}

function formatCode(code: string): string {
    if (code.length === 6) return code.slice(0, 3) + ' ' + code.slice(3);
    if (code.length === 8) return code.slice(0, 4) + ' ' + code.slice(4);
    return code;
}

function generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

function dateStamp(): string {
    return new Date().toISOString().slice(0, 10);
}

function escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function getInitials(name: string): string {
    return name.slice(0, 2).toUpperCase();
}

function getColorForIssuer(issuer: string): string {
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

function downloadFile(content: string, filename: string, mimeType: string) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
