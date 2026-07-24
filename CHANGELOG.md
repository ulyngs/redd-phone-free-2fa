# Changelog

All notable changes to Phone-Free 2FA are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Releasing

1. Bump `version` in `src/manifest.json`.
2. Add a `## [x.y]` section above (with date and changes).
3. Commit and push to `main`.
4. Tag and push: `git tag vX.Y && git push origin vX.Y`

Pushing a `v*` tag triggers [`.github/workflows/release.yml`](.github/workflows/release.yml), which checks the tag matches `manifest.json`, builds `phone-free-2fa-redd-vX.Y.zip`, and publishes a GitHub Release with that zip attached.

## [2.5] - 2026-07-24

### Added

- Copy button for the secret key in the edit modal — copies without revealing the masked value, with the same 30-second clipboard auto-clear as codes.

### Changed

- Shortened the product name from **Phone-Free 2FA by ReDD** to **Phone-Free 2FA** across the manifest, UI, docs, and store copy.
- Updated in-app attribution, store copy, and privacy contact to Centre for Digital Habits ([digitalhabits.org](https://digitalhabits.org)).

### Security

- Lock and wipe decrypted vault state when the side panel is hidden/closed (Chrome often keeps the panel document alive after close).
- Fail closed on biometric passphrase handoff: only accept messages from the tracked biometric tab.

## [2.4] - 2026-07-04

### Changed

- Redesigned EULA and passphrase setup screens for clearer onboarding.
- Refined main and lock screens and reorganized in-app guidance.
- Aligned settings panel with the main app layout.
- Polished account cards, copy feedback, and lock screen actions.
- Improved passphrase visibility toggle and footer behavior.

### Fixed

- Touch ID can now be re-enabled from Settings after dismissing the post-unlock setup prompt with "Don't ask again".

## [2.3] - 2026-06-25

### Changed

- Updated extension icons.

## [2.2] - 2026-06-10

### Changed

- Rebranded from **ReDD 2FA** to **Phone-Free 2FA by ReDD** for store listings and external docs.
- In-app UI now uses the shorter name **Phone-Free 2FA**; attribution remains in the footer and onboarding copy.
- Updated GitHub repository links to [redd-phone-free-2fa](https://github.com/ulyngs/redd-phone-free-2fa).

## [2.1] - 2026-05-18

### Added

- README install instructions now distinguish Chrome/Edge/Chromium browsers from Firefox.

### Fixed

- Restored Touch ID / biometric unlock via a dedicated tab (Chrome does not show WebAuthn prompts from side panels).
- Touch ID setup: prevent double-click races, show progress, and surface clearer retry-friendly errors.
- Handle concurrent WebAuthn ceremonies (`OperationError`) explicitly.
- Reuse disabled biometric credentials during tab setup instead of creating duplicates.
- Close in-flight biometric tabs on lock and clear their state.
- Clear setup passphrase from the DOM after successful first-time setup.
- Apply `noopener`/`noreferrer` when opening external links.

### Changed

- Toast duration now scales with message length.
- EULA and lock/setup screens harmonised with the unlocked UI.

### Security

- Persist brute-force lockout state across panel restarts.
- Wipe decrypted account state from popup memory on lock.
- Wire up clipboard auto-clear on panel close.
- Tightened security documentation around lockout scope, auto-lock semantics, and memory wiping.

## [2.0] - 2026-04-17

### Added

- Hand-rolled, auditable passphrase strength checks (common passwords, keyboard walks, repeating patterns, low character diversity).

### Changed

- Minimum master passphrase length increased to 12 characters.

### Fixed

- EULA acceptance flow works correctly in Microsoft Edge.

## [1.9.1] - 2026-04-16

### Fixed

- EULA acceptance on first launch in Edge.

## [1.9] - 2026-04-12

### Added

- EULA acceptance prompt on first launch.
- Tabbed in-app instructions (How to use / How it works).
- Clearer backup export dialog and backup-status prompts.
- Provenance notes on onboarding and unlock screens.

### Changed

- Extension UI moved from popup to browser side panel for a better day-to-day experience.
- Settings overlay is now full width.
- Export and instruction wording clarified.

## [1.0.0] - 2026-02-09

### Added

- Local-only TOTP authenticator browser extension (Chrome, Firefox, Edge).
- AES-256-GCM encryption with PBKDF2 key derivation (600,000 iterations).
- Master passphrase unlock with progressive lockout on failed attempts.
- Optional Touch ID / Windows Hello unlock via WebAuthn PRF.
- Account search, copy-on-click codes, and visual TOTP countdown rings.
- Encrypted backup/restore and plain `otpauth://` URI export for migration.
- Dark/light theme with system auto-detection.
- Configurable auto-lock timeout and clipboard auto-clear after 30 seconds.
- Zero-dependency implementation using Web Crypto API only.

[2.5]: https://github.com/ulyngs/redd-phone-free-2fa/releases/tag/v2.5
[2.4]: https://github.com/ulyngs/redd-phone-free-2fa/releases/tag/v2.4
[2.3]: https://github.com/ulyngs/redd-phone-free-2fa/releases/tag/v2.3
[2.2]: https://github.com/ulyngs/redd-phone-free-2fa/releases/tag/v2.2
