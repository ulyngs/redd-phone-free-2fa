# ReDD 2FA

Minimalist, offline-only TOTP authenticator browser extension. Secure, encrypted, distraction-free.

Part of the [reddfocus.org](https://reddfocus.org) family of productivity tools.

## Features

- **Local-only** — never makes network requests; fully local operation
- **Encrypted storage** — AES-256-GCM encryption with PBKDF2 key derivation (600k iterations)
- **Master passphrase** — all data encrypted at rest; unlock with your passphrase
- **Auto-lock** — wipes decryption key from memory after inactivity
- **Cross-browser** — Chrome, Firefox, Edge, and Safari (via Xcode wrapper)
- **Minimal UI** — clean, distraction-free design matching reddfocus aesthetics
- **Dark/light mode** — auto-detects system preference
- **Backup/restore** — encrypted JSON export or plain otpauth:// URIs

## Building

### Prerequisites

- Node.js 18+
- npm

### Install & Build

```bash
npm install
npm run build
```

The built extension is output to `dist/`.

### Development (watch mode)

```bash
npm run watch
```

## Loading the Extension

### Chrome / Edge

1. Go to `chrome://extensions` (or `edge://extensions`)
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `dist/` folder

### Firefox

1. Go to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select `dist/manifest.json`

### Safari

1. Run `xcrun safari-web-extension-converter dist/` to generate an Xcode project
2. Open the generated Xcode project
3. Build and run in Xcode
4. Enable the extension in Safari → Settings → Extensions

Alternatively, use the included Xcode project structure (same pattern as [reddfocus-open-source](https://github.com/ulyngs/reddfocus-open-source)).

## Security

- **Encryption**: AES-256-GCM via Web Crypto API (native, no external crypto libraries)
- **Key derivation**: PBKDF2 with 600,000 iterations and SHA-256 (OWASP recommended)
- **No network access**: Extension declares no host permissions; cannot make HTTP requests
- **Memory safety**: Derived key is held in memory only while unlocked; wiped on lock/close
- **Passphrase never stored**: Only a verification hash is persisted

## Tech Stack

- TypeScript (vanilla, no framework)
- Vanilla CSS with CSS custom properties (light/dark themes)
- Web Crypto API for encryption
- otplib for TOTP generation
- esbuild for bundling
- webextension-polyfill for cross-browser compatibility

## License

CC-BY-NC-ND-3.0 — see [LICENSE](./LICENSE).
