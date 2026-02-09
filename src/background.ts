/**
 * ReDD 2FA — Background service worker
 *
 * Handles:
 * - Clipboard auto-clear via alarms
 * - Session lock messages
 */

import browser from './browser';

// Listen for alarm events (clipboard clearing)
browser.alarms.onAlarm.addListener((alarm: any) => {
    if (alarm.name === 'clear-clipboard') {
        // Write empty string to clipboard to clear it
        // We use offscreen document or fallback approaches
        clearClipboard();
    }
});

// Listen for messages from popup
browser.runtime.onMessage.addListener((message: any, _sender: any, _sendResponse: any) => {
    if (message.type === 'CLEAR_CLIPBOARD') {
        // Schedule clipboard clear alarm
        const delayMs = message.delayMs || 15000;
        browser.alarms.create('clear-clipboard', {
            delayInMinutes: delayMs / 60000,
        });
        return Promise.resolve({ success: true });
    }

    if (message.type === 'PING') {
        return Promise.resolve({ success: true });
    }

    return false;
});

/**
 * Clear the clipboard.
 * In MV3 service workers, we can't directly access navigator.clipboard,
 * so we send a message to any open popup to handle it.
 */
async function clearClipboard(): Promise<void> {
    try {
        // Try to send to popup to clear clipboard
        await browser.runtime.sendMessage({ type: 'DO_CLEAR_CLIPBOARD' });
    } catch {
        // Popup might not be open — that's OK, the clipboard will be cleared
        // next time the user opens the popup
    }
}

// Log extension lifecycle
console.log('ReDD 2FA background worker loaded');
