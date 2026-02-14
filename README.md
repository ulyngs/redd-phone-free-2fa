# ReDD 2FA

Minimalist, local-only TOTP authenticator browser extension. Secure, encrypted, distraction-free.

Part of the [reddfocus.org](https://reddfocus.org) family of productivity tools.

## Features

### Security
- **Strong encryption** — AES-256-GCM via Web Crypto API with PBKDF2 key derivation (600,000 iterations, SHA-256)
- **Local-only** — never makes network requests; all data stays on your device
- **Minimal permissions** — only requests `storage`; no host permissions, no remote code
- **Master passphrase** — all account data encrypted at rest; decrypted only while unlocked
- **Passphrase never stored** — only a verification hash is persisted
- **Memory safety** — derived key is held in memory only while unlocked; wiped on lock or popup close
- **Auto-lock** — configurable inactivity timeout (1, 5, 15, or 30 minutes); also locks when popup closes
- **Brute-force protection** — progressive lockout after failed unlock attempts (5s → 30s → 5min)
- **Clipboard auto-clear** — copied codes are removed from clipboard after 30 seconds
- **Constant-time comparison** — passphrase hash verification uses XOR-based comparison to prevent timing attacks
- **No secrets in DOM** — TOTP secrets are kept in memory only; never written to HTML attributes

### Biometric Unlock
- **Touch ID / Windows Hello** — optional biometric unlock via WebAuthn PRF extension
- Passphrase is encrypted with a PRF-derived key (HKDF → AES-256-GCM) and stored locally
- Biometric data is automatically cleared when passphrase is changed

### Usability
- **Cross-browser** — Chrome, Firefox, Edge, and Safari (Manifest V3)
- **Dark / light mode** — auto-detects system preference, or set manually
- **Search & filter** — search accounts by name or issuer
- **Copy on click** — tap any account card to copy its current code
- **Progress ring** — visual countdown showing time remaining for each code
- **Change passphrase** — re-encrypts all accounts with a new key
- **Backup / restore** — password-protected JSON export and import
- **Account migration** — view secret keys in the edit view for manual transfer to another app
- **Data loss warning** — clear warning during setup about passphrase recovery

## How It Works

1. On first launch, you create a master passphrase (minimum 8 characters)
2. A 256-bit encryption key is derived from your passphrase using PBKDF2 (600k iterations)
3. All account data is encrypted with AES-256-GCM and stored in `browser.storage.local`
4. When you unlock, the key is re-derived and held in memory for the duration of your session
5. TOTP codes are generated using HMAC-SHA1/256/512 per RFC 6238 — entirely via Web Crypto API
6. On lock (manual, auto-lock timeout, or popup close), the key is wiped from memory

## Loading the Extension

No build step required — the extension runs as vanilla ES modules.

### Chrome / Edge

1. Go to `chrome://extensions` (or `edge://extensions`)
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `src/` folder

### Firefox

1. Go to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select `src/manifest.json`

### Safari

1. Run `xcrun safari-web-extension-converter src/` to generate an Xcode project
2. Open the generated Xcode project
3. Build and run in Xcode
4. Enable the extension in Safari → Settings → Extensions

## Security Model

| Layer | Implementation |
|-------|---------------|
| Encryption | AES-256-GCM (Web Crypto API) |
| Key derivation | PBKDF2 · 600,000 iterations · SHA-256 |
| Passphrase verification | Constant-time XOR comparison of derived hashes |
| Biometric key wrapping | WebAuthn PRF → HKDF → AES-256-GCM |
| TOTP generation | HMAC-SHA1/256/512 (Web Crypto API), RFC 6238 |
| Network access | None — no host permissions declared |
| Storage | `browser.storage.local` only |
| Dependencies | Zero external runtime dependencies |

## Tech Stack

- Vanilla JavaScript (ES modules, no transpilation)
- Vanilla CSS with custom properties (light/dark themes)
- Web Crypto API for all cryptographic operations
- Custom TOTP engine implementing RFC 6238 / RFC 4226
- Minimal browser API shim (no webextension-polyfill)
- Manifest V3

## Project Structure

```
src/
├── manifest.json       # Extension manifest (MV3)
├── popup.html          # Main popup UI
├── popup.css           # Styles (light/dark themes)
├── popup.js            # Popup controller (UI, events, TOTP refresh)
├── crypto.js           # Encryption/decryption (AES-GCM, PBKDF2)
├── totp.js             # TOTP engine (Base32, HMAC, RFC 6238)
├── storage.js          # Encrypted storage manager
├── session.js          # In-memory session & auto-lock
├── biometric.js        # WebAuthn PRF biometric unlock
├── browser.js          # Minimal browser API shim
├── options.html        # Options page (backup/restore)
├── options.js          # Options page controller
└── icons/              # Extension icons
```

## License

CC-BY-NC-ND-3.0 — see [LICENSE](./LICENSE).
