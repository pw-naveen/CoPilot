# Doctor Persona Content System

A web app and WhatsApp assistant that turns short inputs from busy professionals into ready-to-approve LinkedIn posts written in each person's own voice. The web app handles setup (login, onboarding, persona, tone check, cadence). Day-to-day work happens on WhatsApp: users send topics, photos, events and voice notes, and approve drafts at least 48 hours before each slot.

Built to the *Doctor Persona Content System — Build Brief* (7 Oct 2026). The UI uses the **Pulseworks design system**.

## Quick start (development)

Requirements: Node 22, Postgres 16, Redis 7.

```bash
cp .env.example .env            # set APP_SECRET to 32+ random characters
npm install
npm run db:migrate
npm run db:seed                 # 4 directors, an admin, a sub-admin scoped to two of them
npm run dev                     # web app on http://localhost:3000
npm run worker                  # second terminal; nothing transcribes without it
```

### After pulling

```bash
npm run db:migrate              # `npm run dev` refuses to start while the schema is behind
npm run doctor                  # Redis, Postgres, schema, credentials, stuck jobs
```

`tsx` does not hot-reload, so restart `npm run worker` after changing anything it
runs — including API keys saved in Settings.


Sign in at `/login` as `admin@example.com` (or `SEED_ADMIN_EMAIL`). With `EMAIL_SMTP_URL` empty, emails go to the **dev mailbox** at `/dev/mail`, which shows the sign-in link and code.

With `OPENAI_API_KEY` empty, a deterministic **mock AI** answers every call, so the whole flow runs offline. With `WHATSAPP_GATEWAY=mock`, WhatsApp is simulated.

### Dev tools (`DEV_TOOLS=1`, never in production)

| Page | Use |
| --- | --- |
| `/dev/mail` | Every email sent: sign-in links, invites, alerts, fallbacks |
| `/dev/phone` | Chat as any user through the `MockGateway`: text, voice notes, photos |
| `/dev/clock` | Time travel: move the scheduler clock forward and run any job now |

A full run-through: invite a user (or sign in as `nanda@example.com`), complete setup, open `/dev/phone` to reply to the verification message, send an idea, then use `/dev/clock` to watch prompts, reminders and deadlines fire.

## Tests

```bash
createdb persona_test && npx tsx src/db/migrate.ts postgres://app:app@localhost:5432/persona_test
npm test
```

There are 269 tests, run against a real Postgres database (`persona_test`) and Redis (database 1). Jobs run in-process (`JOBS_INLINE=1`). What they cover, by phase:

- **Phase 1**: `tests/scope.test.ts` calls every exported API handler as an admin, a sub-admin and a user, against accounts inside and outside scope. A coverage test fails if a new route is added without a scope spec. `tests/auth.test.ts` covers the magic link, email OTP, invites and TOTP.
- **Phase 2**: `tests/onboarding.test.ts` covers steps 2–5 end to end. It checks that progress resumes, voice answers are transcribed, the persona JSON is schema-validated and versioned, and the tone check finishes only when all three samples are approved.
- **Phase 3**: `tests/schedule.test.ts` and `tests/cadence.test.ts` cover slot generation, the 20-a-month cap including extras, and the 48-hour deadline. Deadlines are checked across time zones and a DST change.
- **Phase 4**: `tests/whatsapp.test.ts` covers verification and the welcome message on the `MockGateway`, plus bundling, transcription, classification and acknowledgements. It also runs the `EvolutionGateway` against a fake Evolution HTTP server with no other code changes.
- **Phase 5**: `tests/drafts.test.ts` runs the scheduled drafts, the review pass, preview-link actions, WhatsApp "approve", staff approval, reminders, quiet hours, missed slots and the persona refresh. It uses the time-travel clock.

## Architecture

```
Browser ──► Next.js web app ──┐            ┌──► OpenAI API
                              ├─ Postgres  │
                              ├─ Redis ────┤ BullMQ worker ──► Evolution API ──► WhatsApp
                              └─ S3 ───────┘
```

The web app and worker share one TypeScript codebase. **The worker makes every OpenAI and Evolution API call**, so slow responses never block the web app. The web app enqueues jobs and the browser polls them (`jobs` table).

| Area | Where |
| --- | --- |
| Schema and migrations (Drizzle: the brief's 13 core tables plus supporting ones) | `src/db/schema.ts`, `drizzle/` |
| Role scope: one data-access layer | `src/server/scope.ts` |
| Auth: magic link, email OTP, staff TOTP | `src/server/auth.ts` |
| Persona engine and AI calls | `src/server/ai/`, `prompts/*.v1.md`, `src/server/services/persona.ts` |
| Onboarding and tone check | `src/server/services/onboarding.ts`, `tone.ts` |
| Cadence and scheduling maths | `src/server/schedule.ts` (pure functions), `services/cadence.ts` |
| Slot timeline (T−7d … T−48h) | `src/server/scheduler.ts` |
| Drafts and approval | `src/server/services/posts.ts` |
| WhatsApp gateway | `src/server/whatsapp/` (`gateway.ts` interface, `mock.ts`, `evolution.ts`) |
| Inbound pipeline and outbox | `whatsapp/inbound.ts`, `bundle.ts`, `outbox.ts` |
| Publishing stub | `src/server/publisher.ts` (`PublisherAdapter`, `NoopPublisher`) |
| Worker and repeatable jobs | `src/worker/index.ts`, `src/server/cron.ts` |

### Roles

Scope is enforced on the server for every query. Admins see everything. Sub-admins see only the accounts in `subadmin_accounts`. Users see only their own account.

When staff edit or approve on a user's behalf, it is recorded and shown to the user. Staff approval needs the user's own approval too, unless the account has *staff approval is final* switched on (off by default).

### Prompts

Each prompt is a versioned file in `/prompts` (`<name>.v<N>.md`; the highest version wins). Its version is logged with every generation (`ai_generations`, `post_versions.prompt_version`). Model names come from the `OPENAI_MODEL_*` environment variables. Every call uses structured JSON output validated against a Zod schema.

### WhatsApp

Every WhatsApp call goes through `WhatsAppGateway` (`sendText`, `sendMedia`, `onMessage`, `getStatus`). Set `WHATSAPP_GATEWAY=evolution` and configure the Evolution URL, API key, instance name and webhook secret in **Admin → Settings**. Then use **Register webhook**.

The webhook URL includes the shared secret. Events used are `MESSAGES_UPSERT`, `CONNECTION_UPDATE` and `QRCODE_UPDATED`. The endpoint paths used are listed at the top of `src/server/whatsapp/evolution.ts`. **Verify them against the deployed Evolution version.** Moving to the official WhatsApp Cloud API means writing one more implementation of the interface.

Outbound safety:

- Only verified users are messaged.
- Sends are spaced 4 seconds apart, with a typing indicator.
- Nothing is sent between 10pm and 8am local time.
- Messages queue while the connection is down. Drafts and reminders fall back to email after 2 hours.
- A health check runs every 5 minutes and emails admins if the session drops.
- Raw payloads are deleted after 90 days.

## Design system

The UI follows the Pulseworks design system. That system is drawn for 1920×1080 pitch decks, so the app adapts it to screen-sized UI:

- **Kept as-is**: Archivo, the single red accent, the white ground with a blush corner wash, 16px cards with a red-tinted shadow, the red-bar statement card, uppercase two-tone headlines and Phosphor Light icons. The supplied logos are used as provided.
- **Adapted**: the type sizes, and the chevron progress bar used for onboarding.

All tokens live in **`src/styles/tokens.css`**, so a later version of the system can be swapped in one place. Extra Phosphor Light glyphs (microphone, pencil and others) were added in the same set and weight.

## Configuration

See `.env.example`. Secrets set in Admin → Settings are stored AES-256-GCM encrypted with `APP_SECRET`. Environment variables are the fallback.

## Deploy

```bash
docker compose up -d --build     # web, worker, Postgres, Redis; migrations run first
docker compose exec web npm run db:seed   # optional test data
```

For production:

- Set `STORAGE_DRIVER=s3` and the `S3_*` variables, because the local driver is for development only.
- Set `EMAIL_SMTP_URL` and `APP_BASE_URL`.
- Remove `DEV_TOOLS` and `NEXT_PUBLIC_DEV_TOOLS`.

Run Evolution API on the same host or separately.

## Decisions taken where the brief left a question open

| Open question | What the build does now | Where to change it |
| --- | --- | --- |
| Can staff approval be final? | Per account, off by default (the user must approve) | Account settings |
| Draft a suggested topic when there's no input? | Yes, at T−5d, flagged "suggested topic" | `scheduler.ts` |
| Compliance rules | The starting checklist from the brief, in the review prompt | `prompts/draft-review.v1.md` (to be confirmed with Mediwira's compliance contact) |
| Bahasa Malaysia / mixed posts | Languages are captured and passed to the persona; no separate BM tuning | Persona / prompts |
| Input prompt lead time | 7 days, adjustable | Admin → Settings |
| Inputs for slots far ahead | Attached to the slot, then drafted when the slot is within 7 days | `bundle.ts` |
| Slot input cut-off | A slot stops taking new ideas 72h before publish | `bundle.ts` |
| First slot after go-live | At least 5 days out, so the full timeline can run | `schedule.ts` (`MIN_LEAD_DAYS`) |

Out of scope, per the brief: publishing to LinkedIn or other platforms (`NoopPublisher` only logs approved posts), engagement analytics, self-serve sign-up and billing, and the official WhatsApp Cloud API.
