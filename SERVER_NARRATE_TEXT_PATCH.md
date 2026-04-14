# Patch: POST /api/tales/:id/narrate — support `text` in body

## Problem

Bundled tales (e.g. `white_camel`) exist only on the client (StreamingAssets).
The server doesn't have their text, so `narrate?page=0` returns **400** — it can't find the page to narrate.

The client already has the personalized page text (with `{childName}` replaced).
We need the server to accept this text directly instead of loading from DB.

## What to change

In the handler for `POST /api/tales/:id/narrate`:

### Before (current logic)

```js
// 1. Load tale from DB
const tale = loadTale(taleId, lang);
if (!tale) return res.status(404).json({ error: "Tale not found" });

// 2. Get page text
const text = tale.pages[page];
if (!text) return res.status(400).json({ error: `page parameter is required (0..${tale.pages.length - 1})` });

// 3. TTS
const audio = await narrate(text, voice);
```

### After (patched logic)

```js
// 1. Text from body takes priority (bundled tales send it from client)
let text = req.body?.text;

if (!text) {
    // Fallback: load from DB (server-side tales)
    const tale = loadTale(taleId, lang);
    if (!tale) return res.status(404).json({ error: "Tale not found" });
    text = tale.pages[page];
    if (!text) return res.status(400).json({ error: `page parameter is required (0..${tale.pages.length - 1})` });
}

// 2. TTS (same as before)
const audio = await narrate(text, voice);
```

### Important

- Make sure the route has `express.json()` middleware (body parsing) — it likely already does for other routes.
- The `text` field is **optional** — if not provided, the old behavior (load from DB) works exactly as before.
- The client sends: `Content-Type: application/json` with body `{ "text": "page text here..." }`
- The `voice` and `page` query parameters remain unchanged.

## Request format (new)

```
POST /api/tales/white_camel/narrate?page=0&voice=narrator&lang=ru
Authorization: Bearer <token>
Content-Type: application/json

{
  "text": "Bir zamanlar bir devecik varmis. Onun adi Akbota..."
}
```

Response: same as before — `audio/mpeg` binary data.

## Client-side changes (already done)

The Unity client now sends `text` in body when page text is available:
- `NarrationService.NarratePage()` accepts optional `text` parameter
- `ReadingScreen.PlayDefaultNarration()` passes `_tale.pages[page]` as text
- `ApiClient.PostJsonForAudio()` sends JSON body and receives binary audio

## Testing

```bash
# With text in body (bundled tale, no server-side text needed):
curl -X POST "http://localhost:3000/api/tales/white_camel/narrate?page=0&voice=narrator&lang=ru" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"text": "Test narration text"}' \
  --output test.mp3

# Without text (server-side tale, old behavior):
curl -X POST "http://localhost:3000/api/tales/kolobok/narrate?page=0&voice=narrator" \
  -H "Authorization: Bearer <token>" \
  --output test2.mp3
```
