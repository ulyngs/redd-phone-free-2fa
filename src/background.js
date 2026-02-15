/**
 * ReDD 2FA — Background service worker
 *
 * Opens (or focuses) popup.html in a tab when the extension icon is clicked.
 */

// Normalise the browser API global (Firefox = `browser`, Chrome/Edge = `chrome`)
const api = typeof browser !== 'undefined' ? browser : chrome;

api.action.onClicked.addListener(async () => {
    // Check if popup.html is already open in a tab
    const extensionUrl = api.runtime.getURL('popup.html');
    const tabs = await api.tabs.query({ url: extensionUrl });

    if (tabs.length > 0) {
        // Focus existing tab
        await api.tabs.update(tabs[0].id, { active: true });
        await api.windows.update(tabs[0].windowId, { focused: true });
    } else {
        // Open new tab
        await api.tabs.create({ url: extensionUrl });
    }
});
