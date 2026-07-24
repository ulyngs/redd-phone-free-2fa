/**
 * Phone-Free 2FA — Main popup controller
 *
 * Manages all popup UI: setup, lock/unlock, account list,
 * TOTP code generation, modals, search, clipboard, and settings.
 */


import browser from './browser.js';
import { generateTOTP, getRemainingSeconds, parseOtpauthURI, buildOtpauthURI, validateBase32, normalizeSecret } from './totp.js';
import { isFirstLaunch, setupPassphrase, unlockWithPassphrase, changePassphrase, loadAccounts, saveAccounts, loadSettings, saveSettings, saveBiometricData, loadBiometricData, loadBiometricDataRaw, disableBiometric, clearBiometricData, getBackupStatus, saveBackupFingerprint, loadLockoutState, saveLockoutState, clearLockoutState } from './storage.js';
import { setSessionKey, getSessionKey, isUnlocked, lock, touchActivity, setAutoLockMinutes, setOnLockCallback } from './session.js';
import { isBiometricAvailable, registerBiometric, authenticateBiometric } from './biometric.js';
import { checkPassphraseStrength } from './passphrase-strength.js';

// ========================================
// EULA
// ========================================
const EULA_STORAGE_KEY = 'redd2fa_eula';
const CURRENT_EULA_REVISION = 1;

// ========================================
// State
// ========================================
let accounts = [];
let settings;
let totpInterval = null;
let editingAccountId = null;
let pendingPassphrase = null; // held briefly for biometric registration


// ========================================
// Passphrase validation helpers
// ========================================
const MIN_PASSPHRASE_LENGTH = 12;

// Example phrases shown in the setup tips — must not be used verbatim.
const EXAMPLE_PASSPHRASES = [
    'correct-horse-battery-staple',
    'My dog loves chasing squirrels in the park!',
];

function isExamplePassphrase(passphrase) {
    const normalized = passphrase.trim().toLowerCase();
    return EXAMPLE_PASSPHRASES.some((ex) => ex.toLowerCase() === normalized);
}


// ========================================
// DOM refs
// ========================================
const $ = (id) => document.getElementById(id);

// Screens
const eulaOverlay = $('eula-overlay');
const setupScreen = $('setup-screen');
const lockScreen = $('lock-screen');
const mainScreen = $('main-screen');

// Setup
const setupPassphraseInput = $('setup-passphrase');
const setupPassphraseConfirm = $('setup-passphrase-confirm');
const setupError = $('setup-error');
const setupBtn = $('setup-btn');
const setupStrengthFill = $('setup-strength-fill');

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
const copySecretBtn = $('copy-secret-btn');
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
const popupFooter = $('popup-footer');

const EYE_ICON = `
    <svg class="eye-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>`;

const EYE_OFF_ICON = `
    <svg class="eye-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20C5 20 1 12 1 12a20.29 20.29 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A10.75 10.75 0 0 1 12 4c7 0 11 8 11 8a20.3 20.3 0 0 1-3.23 4.31" />
      <path d="M14.12 14.12a3 3 0 0 1-4.24-4.24" />
      <path d="M1 1l22 22" />
    </svg>`;

const WARNING_TRIANGLE_ICON = `
    <svg class="backup-badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>`;

const COPY_ICON = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
      stroke-linejoin="round" aria-hidden="true">
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>`;

const CHECK_ICON = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
      stroke-linejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>`;

function flashCopyButton(btn) {
    if (!btn) return;
    if (btn._copyFlashTimer) clearTimeout(btn._copyFlashTimer);
    btn.classList.add('is-copied');
    btn.innerHTML = CHECK_ICON;
    btn._copyFlashTimer = setTimeout(() => {
        btn._copyFlashTimer = null;
        btn.classList.remove('is-copied');
        btn.innerHTML = COPY_ICON;
    }, 600);
}

function setBackupBadgeLabel(badge, text) {
    badge.innerHTML = `${WARNING_TRIANGLE_ICON}<span>${text}</span>`;
}

function setFooterVisible(visible) {
    if (popupFooter) popupFooter.style.display = visible ? 'block' : 'none';
}

function restoreInputSelection(input, start, end, direction) {
    const len = input.value.length;
    const selStart = start == null ? len : Math.min(start, len);
    const selEnd = end == null ? selStart : Math.min(end, len);

    try {
        input.focus({ preventScroll: true });
        input.setSelectionRange(selStart, selEnd, direction || 'none');
    } catch {
        // Selection restore is best-effort across browsers.
    }
}

function setInputRevealed(input, revealed, selection) {
    const nextType = revealed ? 'text' : 'password';
    if (input.type === nextType) return;

    const start = selection?.start ?? input.selectionStart;
    const end = selection?.end ?? input.selectionEnd;
    const direction = selection?.direction ?? input.selectionDirection;

    input.type = nextType;
    restoreInputSelection(input, start, end, direction);
    requestAnimationFrame(() => restoreInputSelection(input, start, end, direction));
    setTimeout(() => restoreInputSelection(input, start, end, direction), 0);
}

function updateVisibilityToggle(btn, input) {
    const hasValue = input.value.length > 0;
    if (!hasValue && input.type === 'text') input.type = 'password';

    const isRevealed = input.type === 'text';
    btn.classList.toggle('is-visible', hasValue);
    btn.innerHTML = isRevealed ? EYE_OFF_ICON : EYE_ICON;
    btn.title = isRevealed ? 'Hide passphrase' : 'Show passphrase';
    btn.setAttribute('aria-label', btn.title);
    btn.setAttribute('aria-pressed', String(isRevealed));
}

function updateAllVisibilityToggles() {
    document.querySelectorAll('.toggle-visibility').forEach((btn) => {
        const input = $(btn.dataset.target);
        if (input) updateVisibilityToggle(btn, input);
    });
}

function updateSetupStrengthMeter(passphrase) {
    if (!setupStrengthFill) return;
    if (!passphrase) {
        setupStrengthFill.style.width = '0%';
        setupStrengthFill.classList.remove('is-weak', 'is-strong');
        return;
    }

    let percent = Math.min((passphrase.length / MIN_PASSPHRASE_LENGTH) * 55, 55);
    const strength = passphrase.length >= MIN_PASSPHRASE_LENGTH
        ? checkPassphraseStrength(passphrase)
        : { ok: false };

    if (passphrase.length >= MIN_PASSPHRASE_LENGTH) {
        percent = strength.ok ? 100 : 38;
        setupStrengthFill.classList.toggle('is-weak', !strength.ok);
        setupStrengthFill.classList.toggle('is-strong', strength.ok);
    } else {
        setupStrengthFill.classList.remove('is-weak', 'is-strong');
    }

    setupStrengthFill.style.width = `${percent}%`;
}

function getSetupButtonLabel(passphrase, confirm, tooShort, isExample, strengthOk, matches) {
    if (passphrase.length === 0) return 'Enter a passphrase to continue';
    if (tooShort) return 'Use at least 12 characters';
    if (isExample) return 'Choose your own passphrase';
    if (!strengthOk) return 'Choose a stronger passphrase';
    if (confirm.length === 0) return 'Confirm your passphrase';
    if (!matches) return 'Passphrases must match';
    return 'Create & Unlock';
}

function validateSetup() {
    const p = setupPassphraseInput.value;
    const c = setupPassphraseConfirm.value;
    const tooShort = p.length < MIN_PASSPHRASE_LENGTH;
    const isExample = p.length > 0 && isExamplePassphrase(p);
    const strength = p.length >= MIN_PASSPHRASE_LENGTH ? checkPassphraseStrength(p) : { ok: false };
    const matches = p === c;

    updateSetupStrengthMeter(p);
    setupBtn.disabled = tooShort || isExample || !strength.ok || !matches || c.length === 0;
    setupBtn.textContent = getSetupButtonLabel(p, c, tooShort, isExample, strength.ok, matches);

    if (p.length >= MIN_PASSPHRASE_LENGTH && !strength.ok) {
        showElement(setupError, strength.message);
    } else {
        hideElement(setupError);
    }
}

// ========================================
// Initialization
// ========================================
document.addEventListener('DOMContentLoaded', async () => {
    settings = await loadSettings();
    applyTheme(settings.theme);
    initEventListeners();
    initBiometricListeners();
    initHelpTabs();
    setOnLockCallback(() => {
        wipeSensitiveState();
        showScreen('lock');
        setupLockScreen();
    });

    // Check EULA acceptance before showing any screen
    if (!await hasAcceptedEula()) {
        showEulaOverlay();
        return;
    }

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
    eulaOverlay.style.display = 'none';
    setupScreen.style.display = screen === 'setup' ? 'block' : 'none';
    lockScreen.style.display = screen === 'lock' ? 'block' : 'none';
    mainScreen.style.display = screen === 'main' ? 'block' : 'none';
    setFooterVisible(screen === 'setup' || screen === 'lock' || screen === 'main');

    if (screen === 'main') {
        startTOTPRefresh();
        updateTopBarBackupBadge();
    } else {
        stopTOTPRefresh();
    }
}

/**
 * Show/hide the backup status badge in the top bar.
 */
async function updateTopBarBackupBadge() {
    const badge = $('backup-badge-topbar');
    if (!badge) return;
    try {
        const status = await getBackupStatus(accounts);
        if (status === 'never') {
            setBackupBadgeLabel(badge, 'no backup exported');
            badge.style.display = 'inline-flex';
        } else if (status === 'stale') {
            setBackupBadgeLabel(badge, 'Changes since last backup');
            badge.style.display = 'inline-flex';
        } else {
            badge.style.display = 'none';
        }
    } catch {
        badge.style.display = 'none';
    }
}

// ========================================
// EULA helpers
// ========================================
async function hasAcceptedEula() {
    try {
        const result = await browser.storage.local.get(EULA_STORAGE_KEY);
        const data = result[EULA_STORAGE_KEY];
        return data?.acceptedRevision === CURRENT_EULA_REVISION;
    } catch {
        return false;
    }
}

async function acceptEula() {
    await browser.storage.local.set({
        [EULA_STORAGE_KEY]: {
            acceptedRevision: CURRENT_EULA_REVISION,
            acceptedAt: Date.now(),
        }
    });
}

function showEulaOverlay() {
    // Hide all other screens
    setupScreen.style.display = 'none';
    lockScreen.style.display = 'none';
    mainScreen.style.display = 'none';
    setFooterVisible(false);
    // Reset checkbox state
    const checkbox = $('eula-agree-checkbox');
    const continueBtn = $('eula-continue-btn');
    if (checkbox) checkbox.checked = false;
    if (continueBtn) continueBtn.disabled = true;
    eulaOverlay.style.display = 'block';
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
    // EULA acceptance
    const eulaCheckbox = $('eula-agree-checkbox');
    const eulaContinueBtn = $('eula-continue-btn');
    if (eulaCheckbox && eulaContinueBtn) {
        eulaCheckbox.addEventListener('change', () => {
            eulaContinueBtn.disabled = !eulaCheckbox.checked;
        });
        eulaContinueBtn.addEventListener('click', async () => {
            if (!eulaCheckbox.checked) return;
            const originalText = eulaContinueBtn.textContent;
            eulaContinueBtn.disabled = true;
            eulaContinueBtn.textContent = 'Continuing...';
            try {
                await acceptEula();
                // Now proceed to the normal startup flow
                if (await isFirstLaunch()) {
                    showScreen('setup');
                } else {
                    showScreen('lock');
                    await setupLockScreen();
                }
            } catch (err) {
                console.error('Failed to accept EULA:', err);
                eulaContinueBtn.disabled = !eulaCheckbox.checked;
                eulaContinueBtn.textContent = originalText;
            }
        });
    }

    // Setup screen
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




    // Settings
    $('settings-btn').addEventListener('click', async () => {
        settingsDropdown.style.display = settingsDropdown.style.display === 'none' ? 'block' : 'none';
        if (settingsDropdown.style.display === 'block') {
            updateBiometricToggle();
            // Check backup staleness
            const status = await getBackupStatus(accounts);
            const badge = $('backup-badge');
            if (status === 'never') {
                setBackupBadgeLabel(badge, 'no backup exported');
                badge.style.display = 'inline-flex';
            } else if (status === 'stale') {
                setBackupBadgeLabel(badge, 'Changes since last backup');
                badge.style.display = 'inline-flex';
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
        wipeSensitiveState();
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
    $('backup-badge-topbar').addEventListener('click', () => {
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




    // Account modal
    $('modal-close-btn').addEventListener('click', closeAccountModal);
    $('modal-cancel-btn').addEventListener('click', closeAccountModal);
    accountModalOverlay.addEventListener('click', (e) => {
        if (e.target === accountModalOverlay) closeAccountModal();
    });
    modalSaveBtn.addEventListener('click', handleSaveAccount);

    // Copy the secret key without revealing it. Programmatic clipboard
    // writes are allowed even while the input is type="password" (the
    // browser only blocks selection-copy from password fields).
    copySecretBtn.addEventListener('click', async () => {
        const secret = manualSecret.value.trim();
        if (!secret) return;
        try {
            await navigator.clipboard.writeText(secret);
            flashCopyButton(copySecretBtn);
            scheduleClipboardClear();
        } catch {
            showToast('Failed to copy');
        }
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
    $('export-password-confirm').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleExport();
    });

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
        const targetId = btn.dataset.target;
        const input = $(targetId);
        if (!input) return;
        let pendingSelection = null;

        const captureSelection = () => {
            pendingSelection = {
                start: input.selectionStart,
                end: input.selectionEnd,
                direction: input.selectionDirection,
            };
        };

        updateVisibilityToggle(btn, input);
        input.addEventListener('input', () => updateVisibilityToggle(btn, input));
        btn.addEventListener('pointerdown', (e) => {
            captureSelection();
            e.preventDefault();
        });
        btn.addEventListener('mousedown', (e) => {
            captureSelection();
            e.preventDefault();
        });
        btn.addEventListener('click', () => {
            if (!input.value) return;
            if (!pendingSelection) captureSelection();
            setInputRevealed(input, input.type === 'password', pendingSelection);
            updateVisibilityToggle(btn, input);
            pendingSelection = null;
        });
    });

    // Activity tracking
    document.addEventListener('click', () => touchActivity());
    document.addEventListener('keydown', () => touchActivity());

    // Chrome side panels often keep this document alive when "closed".
    // Lock + wipe on hide so the AES key and decrypted secrets do not
    // linger in memory. Skip while a biometric tab owns the ceremony —
    // that flow takes focus away from the panel and needs pending state.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') lockOnPanelHide();
    });
    window.addEventListener('pagehide', lockOnPanelHide);

    // Open external links in a new tab. The rel="noopener noreferrer" on the
    // <a> doesn't carry through when we intercept the click and call
    // window.open ourselves — the features string is what actually applies it.
    document.addEventListener('click', (e) => {
        const link = e.target.closest('a[href]');
        if (link && link.href.startsWith('http')) {
            e.preventDefault();
            window.open(link.href, '_blank', 'noopener,noreferrer');
        }
    });
}

/**
 * Initialise help tab switching.
 */
function initTabGroup(tabSelector, panelSelector) {
    const tabs = document.querySelectorAll(tabSelector);
    const panels = document.querySelectorAll(panelSelector);
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => {
                t.classList.remove('active');
                t.setAttribute('aria-selected', 'false');
            });
            panels.forEach(p => { p.style.display = 'none'; });
            tab.classList.add('active');
            tab.setAttribute('aria-selected', 'true');
            $(tab.getAttribute('aria-controls')).style.display = 'block';
        });
    });
}

function initHelpCollapsible(toggleBtnId, contentId, defaultVisible = true) {
    const toggleBtn = $(toggleBtnId);
    const collapsible = $(contentId);
    if (!toggleBtn || !collapsible) return;

    collapsible.style.display = defaultVisible ? 'block' : 'none';
    toggleBtn.textContent = defaultVisible ? 'hide' : 'show';

    toggleBtn.addEventListener('click', () => {
        const isVisible = collapsible.style.display !== 'none';
        collapsible.style.display = isVisible ? 'none' : 'block';
        toggleBtn.textContent = isVisible ? 'show' : 'hide';
    });
}

function initHelpTabs() {
    initTabGroup('.help-subtab', '.help-subtab-panel');
    initHelpCollapsible('help-toggle-btn', 'help-tabs-content', true);
    initHelpCollapsible('how-works-toggle-btn', 'how-works-content', false);
}

// ========================================
// Setup handler
// ========================================
async function handleSetup() {
    const passphrase = setupPassphraseInput.value;

    if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
        showElement(setupError, `Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`);
        return;
    }
    if (isExamplePassphrase(passphrase)) {
        showElement(setupError, 'Please choose your own passphrase, not the example phrase.');
        return;
    }

    const strength = checkPassphraseStrength(passphrase);
    if (!strength.ok) {
        showElement(setupError, strength.message);
        return;
    }

    setupBtn.disabled = true;
    setupBtn.textContent = 'Setting up...';

    try {
        const key = await setupPassphrase(passphrase);
        setSessionKey(key);
        setAutoLockMinutes(settings.autoLockMinutes);
        accounts = [];
        // Clear the plaintext passphrase out of the hidden input values now
        // that it's been derived into the session key. The screen is hidden
        // by showScreen('main') but the DOM nodes (and their .value) live on.
        setupPassphraseInput.value = '';
        setupPassphraseConfirm.value = '';
        updateAllVisibilityToggles();
        showScreen('main');
        renderAccounts();

        // Offer biometric setup after first passphrase creation
        await promptBiometricSetup(passphrase);
    } catch (err) {
        showElement(setupError, 'Setup failed. Please try again.');
        setupBtn.disabled = false;
        validateSetup();
    }
}

// ========================================
// Unlock handler
// ========================================
// Brute-force lockout state — persisted to storage so closing the side panel
// doesn't reset the counter. Hydrated in setupLockScreen().
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
            await saveLockoutState({ failedAttempts, lockoutUntil });
            unlockBtn.disabled = false;
            unlockBtn.textContent = 'Unlock';
            return;
        }

        // Success — reset counter
        failedAttempts = 0;
        lockoutUntil = 0;
        await clearLockoutState();
        setSessionKey(key);
        setAutoLockMinutes(settings.autoLockMinutes);
        accounts = await loadAccounts(key);
        unlockPassphraseInput.value = '';
        updateAllVisibilityToggles();
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
        unlockBtn.classList.remove('is-primary');
    } else {
        biometricUnlockBtn.style.display = 'none';
        passphraseDivider.style.display = 'none';
        unlockBtn.classList.add('is-primary');
        unlockPassphraseInput.focus();
    }
    hideElement(biometricError);

    // Hydrate persisted lockout state so closing the panel can't reset it.
    const persisted = await loadLockoutState();
    failedAttempts = persisted.failedAttempts;
    lockoutUntil = persisted.lockoutUntil;
    const now = Date.now();
    if (now < lockoutUntil) {
        const remaining = Math.ceil((lockoutUntil - now) / 1000);
        showElement(unlockError, `Too many failed attempts. Try again in ${remaining}s.`);
    } else {
        hideElement(unlockError);
    }
}

/**
 * Prompt user to enable biometric unlock (if available and not already set up).
 */
let pendingPassphraseTimer = null;

function resetBiometricPromptUI({ showPassphraseField = false, showDontAsk = true } = {}) {
    $('biometric-passphrase-group').style.display = showPassphraseField ? 'block' : 'none';
    $('biometric-dont-ask-label').style.display = showDontAsk ? 'flex' : 'none';
    if (showPassphraseField) $('biometric-setup-passphrase').value = '';
    $('biometric-dont-ask-checkbox').checked = false;
}

function showBiometricSetupFromSettings() {
    resetBiometricPromptUI({ showPassphraseField: true, showDontAsk: false });
    biometricPromptOverlay.style.display = 'flex';
}

async function promptBiometricSetup(passphrase) {
    try {
        const available = await isBiometricAvailable();
        if (!available) return;

        // Check if user dismissed the prompt permanently
        const { redd2fa_biometric_dont_ask } = await browser.storage.local.get('redd2fa_biometric_dont_ask');
        if (redd2fa_biometric_dont_ask) return;

        pendingPassphrase = passphrase;
        resetBiometricPromptUI({ showPassphraseField: false, showDontAsk: true });
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

async function beginBiometricRegistration() {
    if (isWindowsPlatform()) {
        biometricPromptOverlay.style.display = 'none';
        $('windows-hint-overlay').style.display = 'flex';
    } else {
        await performBiometricRegistration();
    }
}

/**
 * Enable Touch ID from settings — bypasses the post-unlock "don't ask again"
 * preference and starts setup immediately when possible.
 */
async function enableBiometricFromSettings() {
    const raw = await loadBiometricDataRaw();
    const canReEnableDisabled = !!(raw?.disabled && raw.credentialId);

    if (pendingPassphrase || canReEnableDisabled) {
        await beginBiometricRegistration();
        return;
    }

    showBiometricSetupFromSettings();
}

/**
 * Handle biometric unlock from the lock screen.
 */
async function handleBiometricUnlock() {
    if (await needsTabWorkaroundForWebAuthn()) {
        try {
            biometricUnlockBtn.disabled = true;
            hideElement(biometricError);
            await openBiometricTab('unlock');
        } catch (err) {
            console.error('Failed to open biometric unlock tab:', err);
            biometricUnlockBtn.disabled = false;
            showElement(biometricError, 'Could not open Touch ID tab.');
        }
        return;
    }

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

        // Successful biometric proves user presence — clear the lockout state.
        failedAttempts = 0;
        lockoutUntil = 0;
        await clearLockoutState();
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

function isWindowsPlatform() {
    return navigator.userAgent.includes('Windows');
}

function getWindowsBiometricGuidance() {
    return 'On Windows, biometric unlock may work in Edge if you use a compatible passkey provider like 1Password or Google Password Manager. If your browser only offers Windows Hello, use Chrome instead.';
}

/**
 * Build a user-facing message from a WebAuthn error. NotAllowedError covers
 * both "user cancelled" and "request timed out" — we let the user retry
 * rather than nuking the prompt.
 */
function biometricErrorMessage(err) {
    if (isWindowsPlatform()) return getWindowsBiometricGuidance();
    const name = err?.name || '';
    const message = String(err?.message || '');
    if (name === 'NotAllowedError') {
        return 'Touch ID was cancelled or timed out. Click Enable Touch ID to try again.';
    }
    if (name === 'OperationError') {
        // Chrome throws this for concurrent WebAuthn ceremonies — e.g. a
        // passkey prompt left open in another tab.
        return 'Another passkey prompt is already open. Finish or cancel it, then try again.';
    }
    if (name === 'InvalidStateError') {
        return 'A Touch ID credential already exists for this extension. Remove old Phone-Free 2FA passkeys in your OS or browser settings, then try again.';
    }
    if (message.includes('PRF')) {
        return 'Your browser does not support secure biometric unlock (PRF). Touch ID is unavailable.';
    }
    return 'Biometric setup failed. If this persists, remove old Phone-Free 2FA passkeys in your OS/browser settings.';
}

// =================================================================
// Biometric tab workaround (Chrome side panel)
// =================================================================
// Chrome doesn't show WebAuthn prompts from side panels or action popups —
// the navigator.credentials API call just hangs silently. When we detect we
// aren't in a regular tab, we pop a dedicated tab (biometric-tab.html) that
// does the ceremony in a working context and reports back via runtime
// messaging.

let biometricTab = null;        // { id, mode: 'setup' | 'unlock' }
let biometricTabRemoveListener = null;

async function needsTabWorkaroundForWebAuthn() {
    // If we're already in a regular tab, WebAuthn works inline — don't pop another.
    try {
        if (browser.tabs?.getCurrent) {
            const tab = await browser.tabs.getCurrent();
            if (tab) return false;
        }
    } catch { /* ignore */ }
    return true;
}

async function openBiometricTab(mode) {
    if (biometricTab) {
        // Focus the existing tab rather than spawn a duplicate. If the tracked
        // tab is gone (closed before our onRemoved handler ran, or some other
        // race), clear the stale state and fall through to creating a new tab
        // — otherwise the user's first click after such a race would silently
        // no-op and they'd have to click again.
        try {
            await browser.tabs.update(biometricTab.id, { active: true });
            return;
        } catch {
            clearBiometricTab();
        }
    }
    const url = browser.runtime.getURL(`biometric-tab.html?mode=${mode}`);
    const tab = await browser.tabs.create({ url, active: true });
    biometricTab = { id: tab.id, mode };
    biometricTabRemoveListener = (closedId) => {
        if (biometricTab && closedId === biometricTab.id) {
            handleBiometricTabClosedUnexpectedly();
        }
    };
    try { browser.tabs.onRemoved.addListener(biometricTabRemoveListener); }
    catch { /* ignore */ }
}

function clearBiometricTab() {
    if (biometricTabRemoveListener) {
        try { browser.tabs.onRemoved.removeListener(biometricTabRemoveListener); }
        catch { /* ignore */ }
        biometricTabRemoveListener = null;
    }
    biometricTab = null;
}

function handleBiometricTabClosedUnexpectedly() {
    const mode = biometricTab?.mode;
    clearBiometricTab();
    if (mode === 'setup') {
        pendingPassphrase = null;
        if (pendingPassphraseTimer) { clearTimeout(pendingPassphraseTimer); pendingPassphraseTimer = null; }
        biometricPromptOverlay.style.display = 'none';
        showToast('Touch ID setup cancelled.');
    } else if (mode === 'unlock') {
        biometricUnlockBtn.disabled = false;
        hideElement(biometricError);
    }
}

/**
 * True only for the tab we opened for the current WebAuthn ceremony.
 * Fail closed: no tracked tab, missing sender.tab, or ID mismatch → reject.
 */
function isTrustedBiometricSender(sender) {
    if (!biometricTab || sender?.tab?.id !== biometricTab.id) return false;
    if (sender.url) {
        const extensionOrigin = browser.runtime.getURL('');
        if (!sender.url.startsWith(extensionOrigin)) return false;
    }
    return true;
}

function initBiometricMessaging() {
    if (!browser.runtime?.onMessage) return;
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!message?.type) return;
        // Defence in depth: only honour messages from our currently-tracked tab.
        if (!isTrustedBiometricSender(sender)) {
            if (message.type === 'biometric-setup-request-passphrase') {
                sendResponse({ error: 'unauthorized' });
                return false;
            }
            return;
        }

        switch (message.type) {
            case 'biometric-setup-request-passphrase':
                // Hand off the passphrase but keep it until the tab confirms
                // success/failure — that way the tab's "Try again" button works
                // without forcing the user to re-unlock.
                if (pendingPassphrase) sendResponse({ passphrase: pendingPassphrase });
                else sendResponse({ error: 'no-pending' });
                return false; // synchronous response

            case 'biometric-setup-done':
                pendingPassphrase = null;
                if (pendingPassphraseTimer) { clearTimeout(pendingPassphraseTimer); pendingPassphraseTimer = null; }
                biometricPromptOverlay.style.display = 'none';
                clearBiometricTab();
                showToast(message.reEnabled ? 'Touch ID re-enabled!' : 'Touch ID enabled!');
                updateBiometricToggle();
                return;

            case 'biometric-setup-failed':
                // The tab is still open and offering its own retry. Surface a
                // toast in the side panel but don't tear down state — the tab
                // will message us again on success or be closed by the user.
                showToast(message.error || 'Touch ID setup failed.');
                return;

            case 'biometric-unlock-result':
                handleBiometricUnlockResult(message);
                return;
        }
    });
}

async function handleBiometricUnlockResult(message) {
    clearBiometricTab();
    biometricUnlockBtn.disabled = false;

    if (message.error) {
        showElement(biometricError, message.error);
        return;
    }
    if (!message.passphrase) {
        showElement(biometricError, 'Biometric authentication failed.');
        return;
    }

    try {
        const key = await unlockWithPassphrase(message.passphrase);
        if (!key) {
            showElement(biometricError, 'Biometric data outdated. Please use your passphrase.');
            return;
        }
        failedAttempts = 0;
        lockoutUntil = 0;
        await clearLockoutState();
        setSessionKey(key);
        setAutoLockMinutes(settings.autoLockMinutes);
        accounts = await loadAccounts(key);
        hideElement(biometricError);
        showScreen('main');
        renderAccounts();
    } catch {
        showElement(biometricError, 'Failed to unlock. Please try again.');
    }
}

/**
 * Perform the actual biometric registration (WebAuthn credential creation + PRF).
 * If a previously disabled credential exists, try to reuse it first.
 *
 * The Enable / Not now buttons are disabled for the duration of the call so a
 * second click can't start a parallel WebAuthn ceremony (which Chrome rejects
 * with NotAllowedError, surfacing as a confusing "setup failed" toast).
 */
async function performBiometricRegistration() {
    if (await needsTabWorkaroundForWebAuthn()) {
        try {
            await openBiometricTab('setup');
            biometricPromptOverlay.style.display = 'none';
            showToast('Touch ID setup opened in a new tab.');
        } catch (err) {
            console.error('Failed to open biometric setup tab:', err);
            showToast('Could not open Touch ID setup tab.');
        }
        return;
    }

    const enableBtn = $('biometric-enable-btn');
    const skipBtn = $('biometric-skip-btn');
    const originalEnableText = enableBtn.textContent;
    enableBtn.disabled = true;
    skipBtn.disabled = true;
    enableBtn.textContent = 'Waiting for Touch ID…';

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
        // Recoverable: user just needs to retry. Don't tear down the prompt.
        //   NotAllowedError  → user cancelled or timed out
        //   OperationError   → another passkey ceremony was already pending
        const recoverable = err?.name === 'NotAllowedError' || err?.name === 'OperationError';
        if (!recoverable) {
            // Real failure — clear the held passphrase and close the prompt.
            pendingPassphrase = null;
            if (pendingPassphraseTimer) { clearTimeout(pendingPassphraseTimer); pendingPassphraseTimer = null; }
            biometricPromptOverlay.style.display = 'none';
        }
        // On recoverable errors we keep the overlay open and the pending
        // passphrase alive so the user can press Enable Touch ID again
        // without re-unlocking.
        showToast(biometricErrorMessage(err));
    } finally {
        enableBtn.disabled = false;
        skipBtn.disabled = false;
        enableBtn.textContent = originalEnableText;
    }
}

/**
 * Register biometric listeners.
 */
function initBiometricListeners() {
    initBiometricMessaging();
    biometricUnlockBtn.addEventListener('click', handleBiometricUnlock);

    $('biometric-enable-btn').addEventListener('click', async () => {
        if (!pendingPassphrase) {
            const entered = $('biometric-setup-passphrase').value.trim();
            if (!entered) return;
            const key = await unlockWithPassphrase(entered);
            if (!key) {
                showToast('Incorrect passphrase.');
                return;
            }
            pendingPassphrase = entered;
            $('biometric-setup-passphrase').value = '';
            $('biometric-passphrase-group').style.display = 'none';
        }

        await beginBiometricRegistration();
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
        // Keep pendingPassphrase for this session so settings can enable Touch ID
        // without another unlock. It is cleared on lock via wipeSensitiveState().
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
            await enableBiometricFromSettings();
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

        const editBtn = document.createElement('button');
        editBtn.className = 'more-menu-item edit-btn';
        editBtn.dataset.id = account.id;
        editBtn.textContent = 'Edit';

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'more-menu-item delete-btn';
        deleteBtn.dataset.id = account.id;
        deleteBtn.textContent = 'Delete';
        menu.append(editBtn, deleteBtn);
        more.append(moreBtn, menu);
        actions.append(more);

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

        const copyBtn = document.createElement('button');
        copyBtn.className = 'account-copy-btn';
        copyBtn.dataset.id = account.id;
        copyBtn.title = 'Copy code';
        copyBtn.setAttribute('aria-label', 'Copy code');
        copyBtn.innerHTML = COPY_ICON;

        codeSection.append(codeSpan, svg, copyBtn);

        card.append(info, codeSection, actions);
        fragment.appendChild(card);
    });
    accountList.replaceChildren(fragment);

    // Attach click handlers
    accountList.querySelectorAll('.account-card').forEach((card) => {
        card.addEventListener('click', (e) => {
            const target = e.target;
            // Don't copy if clicking row action buttons or menus
            if (target.closest('.account-actions') || target.closest('.account-copy-btn')) return;
            const id = card.dataset.id;
            copyCode(id, card);
        });
    });

    accountList.querySelectorAll('.account-copy-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            const card = btn.closest('.account-card');
            if (card) copyCode(id, card);
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

/**
 * Schedule the clipboard to be wiped after the user's configured delay.
 * Cancels any previously scheduled clear so back-to-back copies extend
 * the lifetime of the most recent code rather than stacking timers.
 */
function scheduleClipboardClear() {
    const seconds = Number(settings?.clipboardClearSeconds);
    const delayMs = (Number.isFinite(seconds) && seconds > 0 ? seconds : 30) * 1000;
    if (clipboardClearTimer) clearTimeout(clipboardClearTimer);
    clipboardClearTimer = setTimeout(() => {
        clipboardClearTimer = null;
        navigator.clipboard.writeText('').catch(() => { });
    }, delayMs);
}

/**
 * Fire the scheduled clear immediately (and cancel the pending timer).
 * Called when the panel becomes hidden — its timer would otherwise die
 * with the page and leave the code on the clipboard indefinitely.
 *
 * Note: the write is async; the browser is unlikely to settle the promise
 * if the page is being torn down. This is a best-effort flush.
 */
function flushClipboardClear() {
    if (!clipboardClearTimer) return;
    clearTimeout(clipboardClearTimer);
    clipboardClearTimer = null;
    navigator.clipboard.writeText('').catch(() => { });
}

async function copyCode(accountId, cardElement) {
    const account = accounts.find(a => a.id === accountId);
    if (!account) return;

    const code = await generateTOTP(account.secret, account.digits, account.period, account.algorithm);

    try {
        await navigator.clipboard.writeText(code);
        flashCopyButton(cardElement?.querySelector('.account-copy-btn'));
        cardElement.classList.add('copied');
        setTimeout(() => cardElement.classList.remove('copied'), 600);
        scheduleClipboardClear();
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
        // Copy button only makes sense in edit mode (migration flow) —
        // in add mode the user just pasted the secret themselves.
        copySecretBtn.style.display = 'flex';
        copySecretBtn.parentElement.classList.add('has-copy');
    } else {
        modalTitle.textContent = 'Add Account';
    }

    updateAllVisibilityToggles();
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
    copySecretBtn.style.display = 'none';
    copySecretBtn.parentElement.classList.remove('has-copy');
    updateAllVisibilityToggles();
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
    updateTopBarBackupBadge();
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
    const issuer = (account.issuer || '').trim();
    const accountName = (account.accountName || '').trim();
    deleteAccountName.textContent = issuer && accountName && issuer !== accountName
        ? `${issuer} — ${accountName}`
        : issuer || accountName || 'Unknown';
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
    updateTopBarBackupBadge();
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

    if (newPw.length < MIN_PASSPHRASE_LENGTH) {
        showElement(errorEl, `New passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`);
        return;
    }
    if (isExamplePassphrase(newPw)) {
        showElement(errorEl, 'Please choose your own passphrase, not one of the example phrases.');
        return;
    }
    if (newPw !== newPwConfirm) {
        showElement(errorEl, 'New passphrases do not match.');
        return;
    }

    const strength = checkPassphraseStrength(newPw);
    if (!strength.ok) {
        showElement(errorEl, strength.message);
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

    if (pw.length < 12) {
        showElement(exportError, 'Password must be at least 12 characters.');
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
        updateTopBarBackupBadge();

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
    const hadExistingAccounts = accounts.length > 0;
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

    // If importing into an empty vault, the imported file is effectively
    // the backup — save its fingerprint so we don't nag about backups.
    if (!hadExistingAccounts && newAccounts.length > 0) {
        await saveBackupFingerprint(accounts);
    }

    updateTopBarBackupBadge();
}

// ========================================
// Helpers
// ========================================

/**
 * Lock when the side panel is hidden/closed. Chrome often keeps the
 * document alive after close, so visibility/pagehide is the signal we get.
 * Skip during an in-flight biometric tab ceremony (it steals focus).
 */
function lockOnPanelHide() {
    if (biometricTab) {
        flushClipboardClear();
        return;
    }
    if (!isUnlocked()) {
        flushClipboardClear();
        return;
    }
    lock();
    wipeSensitiveState();
    showScreen('lock');
    setupLockScreen();
}

/**
 * Wipe every piece of decrypted state held in the popup on lock.
 * The session key alone isn't enough — `accounts` holds plaintext TOTP
 * secrets, rendered DOM holds the live codes, modal inputs may hold a
 * freshly-typed secret or passphrase, and the biometric-prompt path
 * briefly retains the passphrase. Clear all of it.
 */
function wipeSensitiveState() {
    accounts = [];
    lastCounters.clear();
    if (accountList) accountList.replaceChildren();
    stopTOTPRefresh();

    editingAccountId = null;
    deletingAccountId = null;

    pendingPassphrase = null;
    if (pendingPassphraseTimer) {
        clearTimeout(pendingPassphraseTimer);
        pendingPassphraseTimer = null;
    }
    flushClipboardClear();

    // Close any in-flight biometric tab and clear its state. Without this,
    // (a) the stale biometricTab id can cause the next "Enable Touch ID" click
    //     to silently no-op while openBiometricTab tries to focus a gone tab,
    // (b) a tab that completes setup after the side panel locks would dispatch
    //     biometric-setup-done and "succeed" against a locked panel that can't
    //     surface the result to the user.
    // Detach the onRemoved listener before removing the tab so we don't trip
    // the "Touch ID setup cancelled" toast on the lock screen we're transitioning to.
    if (biometricTab) {
        const closingTabId = biometricTab.id;
        clearBiometricTab();
        try { browser.tabs.remove(closingTabId).catch(() => { }); } catch { /* ignore */ }
    }

    // Clear any inputs that may hold a secret or passphrase.
    const clearValue = (el) => { if (el) el.value = ''; };
    clearValue(manualLabel);
    clearValue(manualSecret);
    clearValue(searchInput);
    clearValue(exportPassword);
    clearValue(exportPasswordConfirm);
    clearValue(importPassword);
    clearValue(setupPassphraseInput);
    clearValue(setupPassphraseConfirm);
    clearValue($('current-passphrase'));
    clearValue($('new-passphrase'));
    clearValue($('new-passphrase-confirm'));
    clearValue($('biometric-setup-passphrase'));
    updateAllVisibilityToggles();

    // Close any open modal overlays so they don't reappear over the lock screen.
    accountModalOverlay.style.display = 'none';
    deleteModalOverlay.style.display = 'none';
    exportModalOverlay.style.display = 'none';
    importModalOverlay.style.display = 'none';
    biometricPromptOverlay.style.display = 'none';
    const changePassphraseOverlay = $('change-passphrase-overlay');
    if (changePassphraseOverlay) changePassphraseOverlay.style.display = 'none';
    const windowsHintOverlay = $('windows-hint-overlay');
    if (windowsHintOverlay) windowsHintOverlay.style.display = 'none';
}

function showElement(el, text) {
    if (text) el.textContent = text;
    el.style.display = 'block';
}

function hideElement(el) {
    el.style.display = 'none';
}

let toastHideTimer = null;

function showToast(message) {
    toast.textContent = message;
    toast.style.display = 'block';
    // Duration scales with length so long error messages stay readable.
    // Roughly 50ms/char + 1500ms base, clamped to a comfortable range.
    const duration = Math.max(2000, Math.min(7000, 1500 + message.length * 50));
    if (toastHideTimer) clearTimeout(toastHideTimer);
    toastHideTimer = setTimeout(() => {
        toast.style.display = 'none';
        toastHideTimer = null;
    }, duration);
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
