# Cedar Lane Auto Detailing: AI receptionist

An AI receptionist for a small auto detailing shop. It books, changes and cancels appointments in Google Calendar, keeps a row per caller and a log of every call in Google Sheets, answers common questions, and hands anything it shouldn't decide to a human.

- **Phase 1:** a text chat agent with a basic web UI.
- **Phase 2:** the same agent as a voice agent on Vapi.

**Demo videos**

- Phase 1 (text chat): _add link_
- Phase 2 (voice call): _add link_

## What it handles

| The caller wants to | What the agent does |
|---|---|
| Book an appointment | Checks the Calendar, offers the nearest open times if the slot is full, books, and saves the contact |
| Change an appointment | Finds the booking by phone and name, checks the new time, moves the same Calendar event |
| Cancel | Reads the booking back, asks for a clear yes, then cancels |
| Ask about pricing, hours, prep or vehicle types | Answers from configuration; it has no other source of facts |
| Say they're running late | Up to 15 minutes: adds a note to the booking for staff. More: offers to reschedule |
| Complain about a charge, ask for a refund, report damage, ask for a ceramic or fleet quote, ask for a manager | Hands off to a human: logs the issue in the Sheet as open, with a callback time worked out from opening hours |

The agent never promises refunds or discounts and never admits fault. Anything it is unsure about is a handoff.

## How it works

```
Text chat (browser) ──► POST /chat ──► agent loop (LLM) ──┐
                                                          ├──► tool registry ──► Google Calendar
Voice call ──► Vapi (speech + LLM) ──► POST /vapi ────────┘                 └──► Google Sheets
```

**The model never touches the Calendar or the Sheet.** It can only call tools, and every rule lives in the tool code: opening hours, bay capacity, conflicts, duplicate bookings, identity checks. The text chat and the voice agent use the same tool registry, so the rules are written once.

The shop itself is configuration in [src/config/business.ts](src/config/business.ts): timezone, hours, number of bays, services with duration and price per vehicle size, holidays and policies. The system prompt is generated from it.

### The tools

| Tool | Purpose |
|---|---|
| `check_availability` | Is a time open for a service, or which times are open on a day |
| `book_appointment` | Re-checks availability, then creates the Calendar event |
| `find_appointments` | A caller's upcoming bookings, by phone and name |
| `reschedule_appointment` | Moves an existing booking |
| `cancel_appointment` | Cancels a booking |
| `report_running_late` | Notes a late arrival on today's booking |
| `request_human_handoff` | Logs an issue for staff and returns the callback promise |
| `log_call` | Chat only: saves the conversation summary. On voice, the server writes it when the call ends |

Each tool is one zod schema plus a handler ([src/tools/define.ts](src/tools/define.ts)). The schema is shown to the model as JSON Schema and also validates whatever the model sends back. Tools never throw at the model: every result is `{ ok: true, ... }` or `{ ok: false, error, message }`, and the message says what was wrong so the model can correct itself on the next call.

## Correctness

Correctness was the priority. These are the failure cases I designed for.

| Risk | How it is handled |
|---|---|
| **Time zones** | One shop timezone in config. Every date calculation names it explicitly through Luxon; nothing depends on the server's clock zone. Times are sent to Google with their UTC offset |
| **Double booking** | Capacity is the number of jobs running at the same moment compared with the number of bays, not a count of overlapping events ([src/domain/availability.ts](src/domain/availability.ts)). Booking re-checks availability immediately before writing |
| **Two bookings at once** | Bookings go through a queue, so nothing can be written between one booking's check and its insert |
| **Duplicate bookings** | Three layers: the event ID is generated before the insert, so a network retry can't create a second event; the same phone, service and time returns the existing booking; a caller with another upcoming booking is asked whether this is an additional one |
| **Invalid input from the model** | Every argument is validated before any tool logic runs. Errors echo the bad value back |
| **The model working things out** | The model copies what the caller said and the code does the working out: am or pm (from opening hours), which date a weekday falls on, and the wording of dates and times. Each of these is in code because the model got it wrong when it was left to do it |
| **Failed API calls** | One retry on rate limits, server errors and network errors, only for operations that are safe to repeat. After that the tool reports the failure and the agent offers a callback |
| **Calendar and Sheet disagreeing** | The Calendar is the source of truth. If a Sheet write fails after a booking, the booking stands and the error is logged. A handoff is the exception: there the Sheet row is the result, so a failed write fails the tool |
| **Someone else's booking** | Changing or cancelling requires the phone number and the first name to match the booking. A mismatch reveals no booking details |
| **Jobs that don't fit** | A job must finish by closing time, start on the 30-minute grid, have at least 60 minutes' notice and fall within 60 days |
| **Closures** | Holidays are in config. Staff can also close a day for bookings by adding an all-day event to the Calendar; no code change needed |

The scheduling logic is pure (no API calls inside), which is what makes it testable: `npm test` covers availability and bay capacity, the brief's "3:30 is full, 4:30 is open" scenario, am/pm resolution, weekday resolution, spoken date wording, phone normalisation and the callback promise.

## Decisions and trade-offs

- **Duration depends on vehicle size, not only price.** An SUV takes longer than a sedan, and booking it for the sedan's time would mark a bay free while the car is still in it. The cost is that the agent needs the vehicle before it can check a slot, one more question than the brief's sample dialogue.
- **A plain tool-calling loop, no agent framework.** The loop is under 100 lines ([src/agent/loop.ts](src/agent/loop.ts)). One agent with eight tools doesn't need more, and every step is visible.
- **Two Sheet tabs.** `Contacts` has one row per caller, keyed by phone number in E.164 format. `CallLog` has one row per conversation, created by the first event and updated by later ones, so a booking is logged even if the chat is abandoned.
- **Outcomes are recorded by the tool that did the action,** not taken from the model's description of the call.
- **Model as configuration.** The chat talks to an OpenAI-compatible endpoint (I used Vercel AI Gateway); the model is one environment variable.

### Phase 2: voice

Vapi runs the call, the speech and the model, and calls this server for tools ([src/server/vapi.ts](src/server/vapi.ts)). What I tuned for a natural-sounding call:

- **A non-reasoning model** (`gpt-4.1-mini`), so there is no thinking pause before each reply.
- **A short phrase while a tool runs** ("Let me check."), so the caller hears something during the Calendar lookup.
- **Sheet writes after the reply.** The caller hears "you're booked" as soon as the Calendar event exists; the Sheet rows follow a moment later, through a queue so writes can't collide.
- **Independent Calendar reads run together** when booking.
- **Two alternatives on voice, three in chat.** Three options are easy to read and too many to hear.
- **Spoken wording from code.** Every time in a tool result also comes written out in words, and Vapi's text formatting is off, because its pipeline turned "3:30" into "3.30" and the voice read it digit by digit.
- **The phone number is read back** and confirmed before booking, since digits are easy to mishear.
- **The assistant is generated from this code** and pushed with `npm run vapi:sync`, so the prompt and tool list have one source of truth.
- **The webhook checks a shared secret,** so only Vapi can call the tools.

## Run it

Requires Node 20 or later.

```bash
npm install
cp .env.example .env    # then fill it in
```

**Google setup**

1. Create a Google Cloud project and enable the Calendar API and the Sheets API.
2. Create a service account, download its JSON key and save it as `credentials/service-account.json`.
3. Create a calendar and a spreadsheet, and share both with the service account's email (calendar: "Make changes to events"; sheet: Editor).
4. Put the calendar ID and spreadsheet ID in `.env`.

**Commands**

| Command | What it does |
|---|---|
| `npm run smoke` | Checks the service account can read the Calendar and write to the Sheet |
| `npm run setup-sheet` | Creates the `Contacts` and `CallLog` tabs with headers |
| `npm run seed` | Adds test events and contacts: both bays busy next Thursday 3:00 to 4:30, an existing booking to reschedule, and an all-day closure |
| `npm run dev` | Starts the server and chat UI at http://localhost:3000 |
| `npm run chat` | Chat with the agent in the terminal |
| `npm test` | Runs the unit tests |
| `npm run typecheck` | Type-checks the project |

**Voice (Phase 2)**

1. Add `VAPI_API_KEY` and a random `VAPI_WEBHOOK_SECRET` to `.env`.
2. Expose the server (for example `ngrok http 3000`) and set `PUBLIC_URL` to that address.
3. With `npm run dev` running, run `npm run vapi:sync` to create or update the assistant.
4. Call it from the Vapi dashboard.

`npm run vapi:test` sends the webhook the same requests Vapi sends, without placing a call.

## Project layout

```
src/
  config/     business rules and environment
  domain/     pure logic: availability, callback promise
  lib/        time, phone, retry, queue, logging
  google/     the only code that talks to Calendar and Sheets
  tools/      one file per tool, plus the registry
  agent/      prompt, chat loop, call summaries
  server/     chat endpoint, Vapi webhook, assistant definition
scripts/      setup, seed data, terminal chat, Vapi sync and test
tests/        unit tests
public/       chat UI
```
