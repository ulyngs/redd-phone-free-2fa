/**
 * ReDD 2FA — Background service worker
 *
 * Opens popup.html in a sidebar panel when the extension icon is clicked.
 * - Chrome: uses the Side Panel API (chrome.sidePanel)
 * - Firefox: uses the Sidebar Action API (browser.sidebarAction)
 */

// Normalise the browser API global (Firefox = `browser`, Chrome/Edge = `chrome`)
const api = typeof browser !== 'undefined' ? browser : chrome;

const isChrome = typeof chrome !== 'undefined' && !!chrome.sidePanel;
const isFirefox = typeof browser !== 'undefined' && !!browser.sidebarAction;

if (isChrome) {
    // Chrome: configure side panel to open when the extension icon is clicked
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
        .catch((error) => console.error('Failed to set side panel behavior:', error));
} else if (isFirefox) {
    // Firefox: toggle the sidebar when the extension icon is clicked
    api.action.onClicked.addListener(() => {
        api.sidebarAction.toggle();
    });
}
