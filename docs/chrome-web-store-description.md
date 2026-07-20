# Chrome Web Store — listing description

Use your computer browser for 2FA so you don't need to reach for your phone every time you log in to e.g. your Microsoft account.

**Phone-Free 2FA** runs in your browser's sidebar, so your codes stay visible next to the page you're logging into — no hunting through pinned tabs or toolbar popups.

Phone-Free 2FA by ReDD is developed by computer scientists at the University of Oxford (Dr Ulrik Lyngs) and the University of Maastricht (Dr Konrad Kollnig, Henry Tari), as part of the Reduce Digital Distraction project (digitalhabits.org).

⚙️ **How it works**
Two-factor authentication (2FA) makes digital life much more secure — a hacker can't get in with your password alone. Phone-Free 2FA is an authenticator that uses the most common method: time-based one-time passwords (TOTP). You add a 2FA secret key from any service that supports TOTP (e.g. a university Microsoft account). Phone-Free 2FA encrypts it locally and generates a fresh 6-digit login code every 30 seconds.

All data is stored locally in encrypted form in the browser using the extension storage API. Nothing is sent over the network. The code is fully open-source — you can find it at https://github.com/ulyngs/redd-phone-free-2fa

Secret keys are encrypted with AES-256-GCM, using a master passphrase that is key-derived via PBKDF2 with 600,000 iterations. The extension auto-locks after configurable inactivity (or immediately when you close the sidebar) and clears copied codes from the clipboard after 30 seconds. Failed unlock attempts trigger progressive lockout to deter guessing.

🖐️ **Biometric unlock**
On supported devices, you can unlock with Touch ID instead of your passphrase. This uses the WebAuthn PRF extension — the passphrase is never stored in plain text. On Windows, select Google Password Manager (or another password manager like 1Password) as your passkey provider when prompted — Windows Hello does not currently support the secure key derivation required for biometric unlock from a browser extension.

📦 **Backup and migration**
Users can export password-protected backups or view their secret keys to transfer accounts to a different authenticator.

🔐 **Strong-by-default passphrase**
Master passphrases must be at least 12 characters, and new passphrases are checked locally against common-password lists, keyboard patterns (qwerty, 12345…), and repeating patterns so that weak choices are caught at setup time rather than later.
