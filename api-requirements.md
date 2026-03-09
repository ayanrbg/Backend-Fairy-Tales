# Missing Server Endpoints (for backend developer)

## Existing Endpoints (already working)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/login` | POST | Login by userId, returns JWT |
| `/api/voice/clone` | POST | Upload WAV for voice cloning |
| `/api/voice` | DELETE | Delete cloned voice |
| `/api/tales?lang=ru` | GET | List tales |
| `/api/tales/:id` | GET | Tale details (all pages) |
| `/api/tales/:id/narrate?page=N` | POST | Narrate single page → MP3 |

## Required New Endpoints

### User Profile
| # | Endpoint | Method | Body/Params | Response | Notes |
|---|----------|--------|-------------|----------|-------|
| 1 | `/api/auth/register` | POST | `{ userId, name, gender, lang }` | `{ token, profile }` | Creates profile, personalizes tales |
| 2 | `/api/user/profile` | GET | — | `{ name, gender, lang }` | Restore session info |
| 3 | `/api/user/profile` | PUT | `{ name?, gender?, lang? }` | `{ profile }` | Update profile |

### Personalization
| # | Endpoint | Method | Body/Params | Response | Notes |
|---|----------|--------|-------------|----------|-------|
| 4 | `/api/tales/:id/personalize` | POST | `{ name, gender }` | `{ pages: [...] }` | Returns personalized text |

### Full Book Narration (async)
| # | Endpoint | Method | Body/Params | Response | Notes |
|---|----------|--------|-------------|----------|-------|
| 5 | `/api/tales/:id/narrate-all` | POST | — | `{ jobId, status }` | Start full book narration with cloned voice |
| 6 | `/api/tales/:id/narration-status` | GET | — | `{ status, pagesReady, totalPages }` | Poll for progress |
| 7 | `/api/tales/:id/narration/:page` | GET | — | MP3 bytes | Download narrated page |

### Drafts
| # | Endpoint | Method | Body/Params | Response | Notes |
|---|----------|--------|-------------|----------|-------|
| 8 | `/api/voice/drafts` | GET | — | `[{ id, narratorName, taleId, lastPage, createdAt }]` | List all drafts |
| 9 | `/api/voice/drafts` | POST | `{ narratorName, taleId }` | `{ draft }` | Create draft |
| 10 | `/api/voice/drafts/:id` | GET | — | `{ id, narratorName, taleId, lastPage, voiceId }` | Get draft details |
| 11 | `/api/voice/drafts/:id` | DELETE | — | `{ status }` | Delete draft |

## Notes
- `narrate-all` is async — client polls `narration-status` until all pages ready
- Drafts store: narrator name, which pages narrated, associated voiceId
- Personalization substitutes child's name + adjusts gender in tale text
- Voice clone requires ~4 sentences of audio (WAV, ~30s)
