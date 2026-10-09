# Easy TweetBlock — Chrome Web Store listing

## Name (from manifest)

Easy TweetBlock

## Summary (from manifest `description`, 132 characters max)

Quickly block unwanted accounts on X, hide promoted posts, and manage local username lists with controlled batch actions

## Detailed description

Easy TweetBlock helps you take control of your X timeline by blocking unwanted accounts and hiding promoted posts.

Block accounts directly from posts, profiles, and account lists with quick block buttons. Promoted posts are hidden from your timeline by default, and you can also enable automatic blocking of the accounts behind them.

For larger cleanups, create local username lists, import accounts from text, CSV, or JSON files, and preview followers or following before taking action. Process accounts in limited batches with a delay you choose.

Key features:

- Quick block controls on supported X pages
- Ad blocking on X: hides promoted posts (ads) from your timeline by default, with an option to automatically block their authors.
- Multiple locally stored username lists
- Import usernames from text, CSV, or JSON files
- Preview followers and following before taking action
- Configurable limits and delays for batch blocking
- Individual controls for button appearance and visibility

Privacy:

- No analytics, telemetry, or advertising
- Username lists and settings are stored in Chrome local storage
- No information is sent to the extension developer
- The extension communicates directly with X only when required to retrieve account information or perform an action requested by the user

Easy TweetBlock is an independent extension and is not affiliated with, endorsed by, or sponsored by X Corp.

## Chrome Web Store form notes

- Single purpose: Block unwanted accounts on X/Twitter and manage local username blocklists.
- Permission justifications:
  - `storage`: stores username lists and settings locally on the user's device.
  - `scripting`: adds the block controls to X pages.
  - `activeTab`: lets the popup work with the X tab the user is currently viewing.
  - Host permissions `https://x.com/*` and `https://twitter.com/*`: inject the block controls into X pages and communicate with X to block accounts or fetch follower lists when the user requests it.
- Data usage disclosures: the extension does not collect, transmit, or share any user data. Username lists and settings stay in local storage; page content is read locally to find accounts and promoted posts and is never sent anywhere.
- The store summary comes from the manifest `description` field; changing it requires a new package version.
