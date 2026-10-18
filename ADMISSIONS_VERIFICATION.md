# Admissions assistant — verified release scope

Date: 18 October 2026. This is the first Telegram implementation inside the existing Edmission backend, not a claim that every advanced integration in the original proposal is complete.

| Requested module | Implemented in this release | Limits / setup |
| --- | --- | --- |
| Automatic replies | Private Telegram messages, saved conversational context, approved-information retrieval, unknown-question staff queue | Real Telegram response awaits a user-started chat. Tiny local model can fall back to approved excerpts. |
| Knowledge base | Staff CRUD, categories/languages, admin approval, expiration, draft PDF/DOCX/TXT/MD/CSV extraction, edit history, source-tracked public university draft synchronization | Actual business content requires staff approval. Scanned files require OCR; `.doc` unsupported. |
| Consultation booking | Built-in availability calendar, consultant slots, atomic reservation, overlap protection, cancellation/rescheduling | Google Calendar synchronization is not implemented. Staff supply meeting links/addresses. |
| Reminders | Confirmation plus scheduled 24/6/2/1-hour reminders; cancellations invalidate pending reminders | Tests exercise scheduling; real scheduled delivery requires an actual booked chat. |
| Follow-ups | Individual opt-in, staff scheduling, configurable timing/templates, considering/parents/completed-consultation triggers, reply cancellation, monthly cap | Personalized templates/rules, not unrestricted autonomous sales. Other agreed dates are entered by staff. |
| Qualification | Validated AI extraction into destination, degree, program, intake, budget, English, education, scholarship, readiness; phone/name booking intake | Model quality varies; staff can edit all profile fields. |
| Career guidance | Preliminary interests question and professional consultation promotion | Explicitly not a psychological assessment. |
| Languages | English, Russian, Uzbek; detection and `/en`, `/ru`, `/uz` | Staff should provide approved business answers in these languages. |
| Human handover | Queue, pause/resume, conversation summary, staff reply and assignment | Staff workspace is the default queue; optional internal Telegram group must be configured. |
| CRM | Profile, history, statuses, notes, interests, assignment, bookings and follow-up history | Instagram and cross-channel identity matching are not implemented. |
| Analysis/scoring | Rule-assisted intent/objections/readiness priority and next action; model summaries | This is explainable initial scoring, not a trained conversion model. |
| Staff alerts | Database events for bookings/cancellation, unknown answers, handover, documents, failures and high priority | Group delivery requires a configured `staffChatId`. |
| Analytics | Date-filtered activity, sourced AI answers, student-confirmed resolution, handovers, first-delivered response latency, reminder delivery rate, seven-day follow-up response attribution, recorded attendance/coverage, timestamped cohort conversion and separate current-status snapshot, FAQ/unanswered topics | Tracking starts explicitly at this release. Earlier historical denominators are not reconstructed. Rates show n/a until enough observations exist. This is operational attribution, not causal marketing attribution. |
| Administration | Existing staff auth/RBAC, admin-only publication/settings/deletion, per-lead pause, provider and feature controls, synthetic preview, retention/deletion, logs | Console is directly accessible at `/api/admissions/console`; original frontend/navigation was preserved. |

## Verified checks

- Existing source baseline matched production before patching. The login Telegram bot was not changed.
- TypeScript build and console JavaScript syntax passed.
- Isolated integration suite covers languages, source approval/expiration, citation validation, JSON parsing, incoming dedupe, unknown handling, extraction, takeover, explicit external-AI consent, opt-in/out follow-ups, reply cancellation, overlapping slots, concurrent booking, reminders, durable outbound retry, draft document import/magic validation, role authorization and deletion.
- The production staff API returned HTTP 200 for an existing administrator JWT. Anonymous CRM access returned HTTP 401. A student JWT was rejected with HTTP 403 in isolated tests.
- Telegram authorized the bot identity and the live poller held its database lease without integration errors. No student conversation existed when checked, so getMe/poller success is not represented as delivered reply evidence.
- Meta's key authenticated successfully, but the account returned an empty model list and the documented example model returned `model_not_found`. Local Ollama is active; the Meta adapter/key are available for a future accessible model. Contributor models are prohibited.
- A synthetic local-model question completed and returned grounded approved workflow information. Weak model output is not allowed to invent business facts.
- Analytics fixtures separately verify current snapshot versus observed cohort, skipped stages, direct consultation/application/enrollment conversions, original reminder due dates, complete follow-up observation windows, missing attendance, first-successful-delivery latency, absent denominators and source-grounded numerical fee rejection. A source ID with an invented fee does not pass validation.
- Public university draft import selects existing public API fields, excludes private data and unqualified prices, preserves unchanged staff edits and requires renewed approval when public source content changes.

## Residual reliability boundaries

Telegram cannot guarantee exactly-once delivery across a crash after send and before receipt persistence. Outgoing retries reuse stored message receipts to reduce duplication. Failed incoming workflow processing is visible in the staff event queue rather than automatically repeating booking side effects. The built-in calendar protects reservations inside this service; an independently maintained external calendar is not synchronized.

Deployment has a server-side backup of prior code, environment and dependencies under the existing Edmission backend backups directory. The public frontend, including its custom hero, was not rebuilt or replaced. Secrets are server-only and excluded from source control.
