# Server spec — Remote log mirror + kill-switch

Client component: `Assets/Scripts/FairyTales/Diagnostics/RemoteLogMirror.cs`.
Purpose: mirror the **entire** Unity log stream from the LIVE App Store build to the
server (batched, fire-and-forget) so we can debug purchases with nothing on screen —
and **turn it OFF later without shipping a new client** via a server-controlled flag.

The client already self-bootstraps and defaults to **ON**. You only need to implement
the two endpoints below. Until they exist, the client keeps buffering and retrying
(bounded, no crash) — harmless.

---

## 1) `POST /api/debug/logs` — receive a batch

Auth: same Bearer token as the rest of the API (optional to enforce).

Request body (JSON):
```json
{
  "userId": "abc123",
  "session": "9f3c1a2b",          // groups one app launch
  "platform": "IPhonePlayer",
  "appVersion": "1.4.0",
  "lines": [
    { "ts": "2026-07-05T10:11:12.345Z", "level": "Log",   "message": "[IAP-DBG] Purchase() called productId=fairytales_yearly", "stack": "" },
    { "ts": "2026-07-05T10:11:13.000Z", "level": "Error", "message": "[IAP-DBG] ValidateCoroutine: ERROR: [500] ...", "stack": "UnityEngine..." }
  ]
}
```
- `level` ∈ `Log | Warning | Error | Exception | Assert`.
- `stack` is only populated for Warning/Error/Exception (empty otherwise).
- Batches arrive every ~4s or when 40 lines accumulate (both server-tunable, see §3).
- On transient network/5xx failure the client **re-queues** the batch and retries, so
  expect occasional duplicates — dedupe on `(session, ts, message)` if you care.

Response: **200** with an OPTIONAL config block (see §3). If you don't want to
piggyback config here, return `{}` or `{"hasConfig": false}`.

Storage: append to a per-user/session log store (DB table or a log file keyed by
`userId`/`session`). Minimum columns: `userId, session, platform, appVersion, ts,
level, message, stack, receivedAt`. A simple admin view filtered by `userId` +
`session` is enough to read a purchase flow top-to-bottom.

---

## 2) `GET /api/debug/config?userId=<id>` — the kill-switch

Called by the client on every app start. Returns the current logging policy.

Response (JSON):
```json
{
  "hasConfig": true,     // REQUIRED true, else client ignores the response
  "enabled": true,       // false = client STOPS capturing and sending (kill-switch)
  "level": "all",        // "all" = every log | "warn" = only Warning/Error/Exception
  "flushSec": 4,         // optional: batch interval seconds
  "batchMax": 40         // optional: flush early after this many lines
}
```

**How we disable logging after the fix (no client update):**
flip `enabled` to `false` (globally, or per-`userId` if you want to keep one tester on).
Next app launch the client reads it, caches it in `PlayerPrefs`, and goes silent.
Set `enabled` back to `true` to re-enable.

`level: "warn"` is a middle ground — keeps error/warning reporting on but drops the
noisy `Log` volume.

---

## 3) `hasConfig` — why it's required

`JsonUtility` on the client can't tell "field absent" from "field = false". So the
client only applies a config when `hasConfig: true`. That lets the `POST /api/debug/logs`
response return an empty/plain body most of the time and only carry the switch when you
actually want to change client behaviour (e.g. push `enabled:false` to everyone at once
without waiting for the next app start).

---

## Notes / privacy
- No PII beyond `userId` (device-based) is sent; messages are raw client logs.
- Consider a retention window (e.g. auto-delete after 30 days).
- Keep the store cheap — this is high volume when `level:"all"`. Recommended default
  once shipped and stable: `enabled:true, level:"warn"`, and flip to `"all"` only when
  actively chasing a bug.
