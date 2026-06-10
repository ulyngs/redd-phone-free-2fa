/**
 * Phone-Free 2FA by ReDD — Session manager
 *
 * Manages in-memory encryption key and auto-lock behavior.
 * The key is never persisted — only held in memory while unlocked.
 */

/** In-memory session state */
let sessionKey = null;
let lastActivity = Date.now();
let autoLockMinutes = 5;
let lockCheckInterval = null;
let onLockCallback = null;

/**
 * Register a callback to be called when the session auto-locks.
 */
export function setOnLockCallback(cb) {
    onLockCallback = cb;
}

/**
 * Store the derived key in memory (unlock).
 */
export function setSessionKey(key) {
    sessionKey = key;
    lastActivity = Date.now();
    startAutoLockTimer();
}

/**
 * Get the current session key.
 */
export function getSessionKey() {
    return sessionKey;
}

/**
 * Check if the session is unlocked.
 */
export function isUnlocked() {
    return sessionKey !== null;
}

/**
 * Lock the session — wipe the key from memory.
 */
export function lock() {
    sessionKey = null;
    stopAutoLockTimer();
}

/**
 * Record user activity to reset the auto-lock timer.
 */
export function touchActivity() {
    lastActivity = Date.now();
}

/**
 * Set the auto-lock timeout duration.
 */
export function setAutoLockMinutes(minutes) {
    autoLockMinutes = minutes;
}

/**
 * Start the auto-lock check interval.
 */
function startAutoLockTimer() {
    stopAutoLockTimer();
    if (autoLockMinutes <= 0) return; // 0 = never auto-lock

    lockCheckInterval = setInterval(() => {
        const elapsed = (Date.now() - lastActivity) / 1000 / 60;
        if (elapsed >= autoLockMinutes) {
            lock();
            if (onLockCallback) onLockCallback();
        }
    }, 10_000); // Check every 10 seconds
}

/**
 * Stop the auto-lock check interval.
 */
function stopAutoLockTimer() {
    if (lockCheckInterval) {
        clearInterval(lockCheckInterval);
        lockCheckInterval = null;
    }
}
