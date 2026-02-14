/**
 * ReDD 2FA — Background service worker
 *
 * Opens (or focuses) popup.html in a tab when the extension icon is clicked.
 */

browser.action.onClicked.addListener(async () => {
    // Check if popup.html is already open in a tab
    const extensionUrl = browser.runtime.getURL('popup.html');
    const tabs = await browser.tabs.query({ url: extensionUrl });

    if (tabs.length > 0) {
        // Focus existing tab
        await browser.tabs.update(tabs[0].id, { active: true });
        await browser.windows.update(tabs[0].windowId, { focused: true });
    } else {
        // Open new tab
        await browser.tabs.create({ url: extensionUrl });
    }
});
