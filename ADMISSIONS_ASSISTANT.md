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

## Calendar and outreach

The built-in calendar is the source of availability; this is not a Google Calendar integration. Staff create non-overlapping slots per consultant with an office address or meeting link. Slot reservation uses an atomic database update. Rescheduling retains the old appointment until the replacement is booked. Booking confirmation is immediate; future reminders are scheduled at 24, 6, 2 and 1 hours before the appointment. Cancellation invalidates reminders. Student times are shown in Asia/Tashkent; staff times follow the browser timezone.

Sales follow-ups require the student to send `/followups`; `/stop` revokes that consent. A new inbound message cancels pending follow-ups. Closed, uninterested, enrolled, on-hold or human-managed leads cannot receive automated follow-ups. Automated triggers currently cover considering options, parental discussion and a completed consultation. Staff can schedule other agreed dates and personalized messages. Automatic outreach is capped at three delivered follow-ups per 30 days. The workflow is rule-assisted, not a psychological or definitive career assessment.

Staff alerts always appear in the authenticated Events workspace. Internal Telegram delivery additionally requires the administrator to configure `staffChatId` and add the assistant bot to that chat. No group is invented or created automatically.

Jobs use database leases and bounded retry with delivery status. Telegram does not offer a send-message idempotency key: a crash between a successful Telegram delivery and saving its receipt can duplicate that notification. Incoming Telegram update IDs are deduplicated. Failed incoming processing is logged for staff review rather than silently replaying financial or booking side effects.

## Privacy

Only Telegram's private chats are processed. The bot explains stored data in `/privacy`, discourages identity and payment documents, supports `/delete`, and does not forward uploaded student documents to an LLM. Students are not matched across accounts by name alone. Staff can run retention cleanup for expired closed/uninterested leads; active applications are preserved.

## Verification

`npm run build` compiles the module with the existing application. `node scripts/admissions.test.cjs` exercises only the isolated QA listener on port 27939 and a disposable `admissions_qa_` database. It checks languages, approved/expired sources, citation validation, Telegram dedupe, unknown-question escalation, qualification, takeover, opt-in/opt-out, reply cancellation, overlapping slots, concurrent booking, reminders, deletion and HTTP authorization. Tests mock AI and Telegram transport; they do not prove real chat delivery. Verify live Telegram independently with a user-started chat.
