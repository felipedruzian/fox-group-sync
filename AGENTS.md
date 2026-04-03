# Repository Guidelines

## Project Structure & Module Organization

This repository is a small Firefox WebExtension with a flat structure:

- `manifest.json`: extension metadata, permissions, Firefox-specific settings, and version.
- `background.js`: background logic for saving, restoring, deleting, and syncing tab-group snapshots.
- `popup.html`, `popup.js`, `popup.css`: popup UI and interaction logic.
- `icons/`: extension icons.
- `README.md`, `CHANGELOG.md`: release notes, setup, and AMO submission context.

There is no `src/` or build output directory. Keep new files close to the feature they support.

## Build, Test, and Development Commands

There is no formal build pipeline. Use these commands during development:

- `node --check background.js`: syntax check for the background script.
- `node --check popup.js`: syntax check for the popup script.
- `zip -r fox-group-sync.zip manifest.json background.js popup.html popup.js popup.css icons README.md LICENSE CHANGELOG.md`: create a clean package for AMO upload.

Local testing is manual in Firefox:

1. Open `about:debugging#/runtime/this-firefox`
2. Choose **Load Temporary Add-on**
3. Select `manifest.json`

## Coding Style & Naming Conventions

- Use plain JavaScript, HTML, and CSS only; no framework or bundler.
- Prefer 2-space indentation and semicolons, matching the existing files.
- Use `camelCase` for variables/functions and `UPPER_SNAKE_CASE` for storage keys and constants.
- Keep UI strings concise and user-facing text in Portuguese, consistent with the current extension.
- Avoid inline JavaScript in HTML-generated markup; keep behavior in script files.

## Testing Guidelines

This project currently relies on manual testing. Validate:

- save/update of grouped tabs
- restore into a new group
- delete and clear-sync flows
- `storage.sync` fallback behavior

When changing persistence or permissions, test on Firefox 141+ and re-check AMO-facing metadata in `manifest.json`.

## Commit & Pull Request Guidelines

Recent history uses short conventional prefixes such as `feat:`, `fix:`, and `release:`. Follow that pattern, for example:

- `fix: avoid inline handlers in popup markup`
- `release: prepare 0.1.3 for AMO upload`

Pull requests should include a short summary, manual test notes, and screenshots for popup UI changes. If a change affects packaging or AMO submission, mention the manifest fields updated.

## Security & Submission Notes

- Do not add remote code, dynamic script injection, or unnecessary permissions.
- Keep `manifest.json` aligned with actual synced data, especially `data_collection_permissions`.
- Package only extension files, with `manifest.json` at the archive root.
