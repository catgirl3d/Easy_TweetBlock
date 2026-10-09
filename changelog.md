# Changelog

## v0.2.1 - 2026-10-09

Trust and permission fixes for the Firefox install and update flow.

### Key Changes

- The extension now declares that it does not collect or transmit any data. The Firefox install page used to claim it collects authentication information, website activity, and website content, even though everything stays on your device.
- Removed the unused abs.twimg.com permission, so Firefox now asks for access to two sites instead of three.
- Added a warning with an "Enable access" button in the popup: if access to X/Twitter is disabled (for example, after an update added a new host, or you revoked it yourself), you can restore it in one click.

## v0.2.0 - 2026-10-09

Feature update with promoted post filtering, a refreshed popup, and dark theme fixes.

### Key Changes

- Added promoted post filtering with Off, Hide, and Hide + block modes. Hide is the default; Hide + block also blocks the author of each detected promoted post. Switch to Off in Settings if you want promoted posts back.
- Fixed the white background Firefox showed around the popup panel; the panel and native controls now stay dark.
- Fixed the outline block buttons on X's dark theme: the icon no longer blends into the background, and the border no longer clashes with native controls.
- Refreshed the popup with card icons, settings grouped into sections (Ad filtering, Block button, Add button, Batch blocking), an unsaved-changes bar, and smoother view transitions.
- Reworked the Followers tool: one scan now fills a queue of ready accounts up to "Find up to" instead of stopping at one batch, so several block runs can reuse it. A safety limit pauses long scans and offers to resume.
- The follower scan is now tied to the profile and source instead of the limits, so changing "Block up to" or "Find up to" no longer resets the preview; Reset scan appears only while a scan exists.
- Added a warning when a follower block run starts, reminding to keep the popup open until blocking completes.
- Renamed the follow graph heading to Followers Tool.

## v0.1.0 - 2026-07-18

Initial release of Easy TweetBlock.

### Key Changes

- Added Chrome and Firefox Manifest V3 builds.
- Added username blocklists, follower scanning, and native X block flows.
- Added deterministic ZIP and XPI production packages.
