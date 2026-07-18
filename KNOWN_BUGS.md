# Known Bugs

## Closing or canceling a follower block run can leave completed accounts queued

**Status:** Known limitation

Follower block results are saved only after the entire batch finishes. If the popup is closed or the run is canceled after one or more requests have already succeeded, those completed accounts can remain in the scan queue.

**Impact:** A later block run can send another block request for an account that was already blocked. Session totals can also be inaccurate.

**Temporary mitigation:** Keep the popup open and let a follower block batch finish. Do not cancel a batch after it has started unless necessary.

**Planned fix:** Persist each candidate result outside the popup, through the background/service worker, so closing the popup cannot lose partial batch progress.
