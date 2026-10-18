# Admissions assistant

This module adds an independent Telegram bot to the existing Edmission backend. The existing Telegram sign-in/linking service is unchanged. Instagram is intentionally not enabled in this first release.

## Staff workspace

Open `/api/admissions/console` on the Edmission website. Existing administrator, manager and counsellor-coordinator accounts can sign in; only administrators approve knowledge, change global configuration and delete student data. Existing same-origin platform sessions are reused. No credentials are embedded in the console.

The workspace provides approved multilingual knowledge with draft document imports and version history; lead profiles and conversations; consultant takeover and replies; a built-in consultation calendar; attendance, reminders, follow-ups, real analytics, event/error queues, testing and automation controls. The original production frontend is not rebuilt or replaced.

## Configuration

Server-only environment variables:

- `ADMISSIONS_TELEGRAM_TOKEN`: a bot token separate from the login bot.
- `LLAMA_API_KEY`: Meta Model API key, optional.
- `ADMISSIONS_OLLAMA_MODEL`: default `qwen3:0.6b`.

Meta uses the documented `https://api.meta.ai/v1/chat/completions` endpoint. Contributor models are rejected. If Meta cannot answer, the adapter tries local Ollama. Unparseable model output falls back to relevant approved excerpts; absent information is sent to the staff review queue. AI content remains probabilistic: staff must review sensitive admissions details and keep approved documents current.

Populate approved knowledge with Edmission's actual office details, services, fees and university requirements. Unapproved and expired records never participate in retrieval. Uploaded PDF, DOCX, TXT, Markdown and CSV documents become drafts; scanned PDFs require OCR first. Documents are limited to 8 MB and 60,000 extracted characters, with a visible truncation warning. Historical Word `.doc` is not supported. Files are parsed as data, never executed.

Administrators can import drafts from the existing publicly exposed university catalog. Only the public name, location, description and language/GPA requirements are selected; account identities, documents and unqualified tuition values are excluded. Source URL, source digest and import time are retained. Unchanged synchronization preserves staff edits; changed source content becomes a new draft with prior-version history. Explicit staff approval is still required. Imports are capped at 500 public entries per synchronization and report truncation.

## Calendar and outreach

The built-in calendar is the source of availability; this is not a Google Calendar integration. Staff create non-overlapping slots per consultant with an office address or meeting link. Slot reservation uses an atomic database update. Rescheduling retains the old appointment until the replacement is booked. Booking confirmation is immediate; future reminders are scheduled at 24, 6, 2 and 1 hours before the appointment. Cancellation invalidates reminders. Student times are shown in Asia/Tashkent; staff times follow the browser timezone.

Sales follow-ups require the student to send `/followups`; `/stop` revokes that consent. A new inbound message cancels pending follow-ups. Closed, uninterested, enrolled, on-hold or human-managed leads cannot receive automated follow-ups. Automated triggers currently cover considering options, parental discussion and a completed consultation. Staff can schedule other agreed dates and personalized messages. Automatic outreach is capped at three delivered follow-ups per 30 days. The workflow is rule-assisted, not a psychological or definitive career assessment.

Staff alerts always appear in the authenticated Events workspace. Internal Telegram delivery additionally requires the administrator to configure `staffChatId` and add the assistant bot to that chat. No group is invented or created automatically.

Jobs use database leases and bounded retry with delivery status. Ordinary replies are persisted before sending and retried from a durable outbox; job retries reuse the same outgoing receipt and preserve inline keyboards. Telegram does not offer a send-message idempotency key: a crash between a successful Telegram delivery and saving its receipt can duplicate that notification. Incoming Telegram update IDs are deduplicated. Failed incoming processing is logged for staff review rather than silently replaying financial or booking side effects.

## Privacy

Only Telegram's private chats are processed. The bot explains stored data in `/privacy`, discourages identity and payment documents, supports `/delete`, and does not forward uploaded student documents to an LLM. External Meta processing additionally requires each student's `/external_ai` opt-in, even if an administrator has selected Meta; `/local_ai` revokes it. The default is local processing. Staff's synthetic preview explicitly uses the selected provider. Students are not matched across accounts by name alone. Staff can run retention cleanup for expired closed/uninterested leads; active applications are preserved. Staff document extraction runs in a separate, time-limited, heap-limited process, not inside the HTTP worker.

## Verification

`npm run build` compiles the module with the existing application. `node scripts/admissions.test.cjs` exercises only the isolated QA listener on port 27939 and a disposable `admissions_qa_` database. It checks languages, approved/expired sources, citation validation, Telegram dedupe, unknown-question escalation, qualification, takeover, opt-in/opt-out, reply cancellation, overlapping slots, concurrent booking, reminders, deletion and HTTP authorization. Tests mock AI and Telegram transport; they do not prove real chat delivery. Verify live Telegram independently with a user-started chat.

## Analytics definitions

The Overview workspace uses `/api/admissions/analytics` with an optional `from`/`to` date range of at most 366 days. Tracking has an explicit persisted start date. No legacy milestones, responses or attendance are invented from current statuses. Missing rate denominators are `null` in the API and `n/a` in the workspace.

- **Activity:** incoming messages, newly created leads and actual booking receipts in the selected period.
- **AI answers:** delivered sourced answers to non-command inquiries. **Resolved** means the student explicitly selected Helpful; a valid source ID alone is not a satisfaction outcome. Consultant requests are counted separately. Numerical figures not present in cited source content are rejected; this is a useful guard, not universal semantic entailment proof.
- **Reminder delivery:** sent / due tracked reminders, excluding cancellations; the original scheduled due time is retained through retries.
- **Follow-up response:** the first non-command response is attributed only to the most recent delivered follow-up. The seven-day response rate uses only closed seven-day windows; newer deliveries are shown as still observing.
- **Attendance:** attended / (attended + missed) for non-cancelled tracked appointments that have started. Pending attendance and recording coverage are displayed separately. Immutable reservation receipts survive reuse of a free calendar slot.
- **Response latency:** server receipt to first successful Telegram delivery, including retries, grouped once per incoming update. Commands and queue acknowledgements are included and labeled; this is not consultant handling time.
- **Conversion cohort:** leads first seen in the selected range after tracking began. Only observed, timestamped milestones count, through the stated as-of time. Ordered intersections define stage conversions. Direct consultation-to-application and application-to-enrollment rates do not require optional intervening stages. A separate current-status snapshot is not presented as historical conversion.
- **FAQ/unanswered:** exact question text grouped case-insensitively, excluding commands and booking-form fields.

Personal-data deletion removes the corresponding metric records as well. `node scripts/admissions-analytics.test.cjs` verifies deterministic denominator, date, maturity, attribution, skipped-stage, empty-history and numeric-grounding fixtures in its own disposable QA database.


## Guided Telegram intake and calendar
The bot first asks language, sends an introduction and a separate name question, then accepts a shared or typed international phone number. Intake persists across restarts; explicit language remains selected. Intake messages (including name and phone) are excluded from model history. AI processing is enabled by the clear intake notice and can be revoked with /local_ai; /human works throughout.

Meta is the active provider; failed Meta requests never silently use Ollama. The supplied key authenticates to api.meta.ai but its models list is empty; documented Muse models and the native responses endpoint currently return model_not_found. The replacement key works from the user’s Windows computer, while the server currently receives model_not_found. This is an environment/network discrepancy under investigation, not proof of missing account access. Calendar and human assistance remain available.

The hidden show_booking_calendar action only opens validated server availability. Monthly buttons show available future dates only; hours default to 09:00 through17:00 inclusive, Asia/Tashkent (the final appointment ends18:00). Slot generation and staff manual scheduling share a consultant lease. Selecting a time does not reserve it: explicit confirmation rechecks and atomically reserves the slot. Rescheduling holds the existing reservation until the new one succeeds. Staff schedule JSON in Settings controls hours, horizon, weekdays, closed dates, consultant and meeting location. Bookings appear in the existing Calendar workspace.

Public bot navigation uses localized readable message buttons; legacy slash commands remain internal compatibility routes and are removed from Telegram’s command menu. Outgoing text and button labels sanitize old command references in approved knowledge and scheduled messages. Privacy preferences and deletion confirmation are available in the main menu.


## Current student chat mode: AI only
The latest user instruction supersedes the original human-handover requirement. Student questions go to Meta after intake and consent. Old handover pause flags do not block replies; legacy human buttons return to AI help. Consultant chat buttons, queues, takeover controls and manual staff chat replies are disabled. Scheduled internal staff alerts and real consultation bookings remain. Unknown business facts are disclosed as unverified; the AI may ask one strictly validated short clarification question without a source citation, while all numeric business claims still require approved support.
