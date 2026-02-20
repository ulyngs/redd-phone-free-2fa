# ReDD 2FA

Simple, secure, local-only authenticator browser extension for time-based one-time passwords (TOTP). Lets you use your computer for 2FA, so you can put your phone away when you need to focus.

Built by computer scientists at the University of Oxford (Dr Ulrik Lyngs) and the University of Maastricht (Dr Konrad Kollnig, Henry Tari), as part of the Reduce Digital Distraction Project ([reddfocus.org](https://reddfocus.org)).

- **Chrome Web Store**: https://chromewebstore.google.com/detail/redd-2fa-phone-free-authe/dhkhbjppnoabmglidgfpndfghbhlkgbn
- **Add-ons for Firefox**: (in review)
- **Safari**: not necessary: the native Passwords application (newer Macs) or Safari itself (older Macs, go to Safari > Settings > Passwords) can generate TOTP codes.

## Features

### Security
- **Strong encryption** — AES-256-GCM via Web Crypto API with PBKDF2 key derivation (600,000 iterations, SHA-256)
- **Local-only** — never makes network requests; all data stays on your device
- **Minimal permissions** — only requests `storage` and `tabs`; no host permissions, no remote code
- **Master passphrase** — all account data encrypted at rest; decrypted only while unlocked
- **Passphrase never stored** — only a derived verification token is persisted
- **Memory safety** — derived key is held in memory only while unlocked; wiped on lock or when the tab is closed
- **Auto-lock** — configurable inactivity timeout (1, 5, 15, 30 minutes, or never)
- **Brute-force protection** — progressive lockout after failed unlock attempts (5s → 30s → 5min)
- **Clipboard auto-clear** — copied codes are removed from clipboard after 30 seconds
- **Constant-time comparison** — passphrase hash verification uses XOR-based comparison to prevent timing attacks
- **No secrets in DOM** — TOTP secrets are kept in memory only; never written to HTML attributes

### Biometric Unlock
- **Touch ID / Windows Hello** — optional biometric unlock via WebAuthn
- **Hardware-backed security** — passphrase is encrypted with a PRF-derived key (HKDF → AES-256-GCM) directly from the security chip; no keys are ever stored on disk
- **Windows note** — Windows Hello does not currently support the WebAuthn PRF extension required for secure key derivation from a browser extension. Windows users should select **Google Password Manager** (or another password manager like 1Password) as their passkey provider when prompted, instead of "Windows Hello"
- Biometric data is automatically cleared when passphrase is changed

### Usability
- **Cross-browser** — Chrome, Firefox, and Edge (Manifest V3)
- **Dark / light mode** — auto-detects system preference, or set manually
- **Search & filter** — search accounts by label
- **Copy on click** — tap any account card to copy its current code
- **Progress ring** — visual countdown showing time remaining for each code
- **Change passphrase** — re-encrypts all accounts with a new key
- **Backup / restore** — encrypted JSON export (stores only label + secret pairs); import supports both encrypted backups and plain `otpauth://` URI text files from other authenticator apps
- **Backup status** — inline badge on the Export button warns if no backup has been exported, or if accounts have changed since the last export
- **Plain text URI export** — export accounts as standard `otpauth://` URIs for migrating to another authenticator app
- **Account migration** — view secret keys in the edit view for manual transfer, or use plain text URI export
- **Data loss warning** — clear warning during setup about passphrase recovery

## How It Works

1. On first launch, you create a master passphrase (minimum 8 characters)
2. A 256-bit encryption key is derived from your passphrase using PBKDF2 (600k iterations)
3. All account data is encrypted with AES-256-GCM and stored in `browser.storage.local`
4. When you unlock, the key is re-derived and held in memory for the duration of your session
5. TOTP codes are generated using HMAC-SHA1/256/512 per RFC 6238 — entirely via Web Crypto API
6. On lock (manual, auto-lock timeout, or popup close), the key is wiped from memory

```mermaid
flowchart TD
    click(["Click extension icon"]) --> background.js["background.js<br>Opens extension tab"]
    background.js --> popup.js["popup.js<br>UI controller"]
    popup.js --> Unlock

    subgraph Unlock
        passphrase(["Enter passphrase"]) --> |"passphrase"| crypto.js["crypto.js<br>PBKDF2 600k iter → AES-256-GCM"]
        touchid(["Touch ID / Windows Hello"]) --> biometric.js["biometric.js<br>WebAuthn PRF (Hardware Key)"] --> |"recovered passphrase"| crypto.js
    end

    crypto.js --> session.js["session.js<br>Holds encryption key in memory<br>Auto-lock timer"]
    session.js --> |"encryption key"| storage.js["storage.js<br>Encrypted accounts in<br>browser.storage.local"]
    storage.js --> |"decrypted secrets"| totp.js["totp.js<br>HMAC-SHA1/256/512 → 6-digit code"]
    totp.js --> |"codes"| popup.js

    session.js -. "lock / timeout / tab close" .-> Unlock
```

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

## Security Model

| Layer | Implementation |
|-------|---------------|
| Encryption | AES-256-GCM (Web Crypto API) |
| Key derivation | PBKDF2 · 600,000 iterations · SHA-256 |
| Passphrase verification | Constant-time XOR comparison of derived hashes |
| Biometric key wrapping | WebAuthn PRF → HKDF → AES-256-GCM (Hardware-backed only) |
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
├── popup.html          # Main UI (opens in a tab)
├── popup.css           # Styles (light/dark themes)
├── popup.js            # UI controller (events, TOTP refresh)
├── background.js       # Service worker (tab management)
├── crypto.js           # Encryption/decryption (AES-GCM, PBKDF2)
├── totp.js             # TOTP engine (Base32, HMAC, RFC 6238)
├── storage.js          # Encrypted storage manager + backup fingerprinting
├── session.js          # In-memory session & auto-lock
├── biometric.js        # WebAuthn biometric unlock (PRF hardware integration)
├── browser.js          # Minimal browser API shim
└── icons/              # Extension icons
```

## License

CC-BY-NC-ND-3.0 — see [LICENSE](./LICENSE).
