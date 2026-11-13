# Edmission Telegram recovery

Prepared for @Edmission_bot, 2026-11-13. Production recovery is not yet verified.

## Registration

A website LOGIN_ deep link keeps its existing session. New users share their own
Telegram contact; profile first/last names are reused. Previously linked users
continue directly. No channel subscription is required. Private chat, sender ID
and contact user ID must match. Legacy manual-name sessions remain supported.

Polling begins only after MongoDB connects, including the reconnect path.
Polling and webhook-removal requests have deadlines, as do shared bot API calls.
Only one backend instance may poll this bot token. Do not enable a second poller.

## Validation

Run `npm ci`, `npm run build`, then
`node scripts/telegram-registration.test.cjs`.
The regression test uses mocked storage/auth/Telegram transport: it checks contact
collection, name reuse, rejection of another person's contact, private-chat
identity, returning users, and the return button. It does not prove delivery
through Telegram or actual database/session redemption.

## Production verification still required

The supplied server inventory lists edmission.uz, backend port 4002 and PM2
process edmission-backend. Confirm these against the live host before changes.
The Cloud Environment TCP policy currently grants no SSH destination; access to
173.212.216.216:22 is required. No production restart has been performed.

1. Inspect only the Edmission PM2 process, recent sanitized logs, deployed commit
   and MongoDB readiness. Never print process environment or token-bearing URLs.
2. With the configured token, check Telegram getMe/getWebhookInfo without logging
   the token. Confirm username Edmission_bot. Determine whether the outage is a
   missing token, backend/database failure, webhook conflict or competing poller.
3. Preserve the current release and environment; compare the proposed changes
   against production before deploying. Do not overwrite unrelated live changes.
4. Build the reviewed backend release using the existing deployment convention.
   Restart only edmission-backend; keep the previous release for rollback.
   Do not restart Logic Coin or other applications.
5. Check backend health, PM2 stability and Telegram API errors after restart.
6. On a test account, follow the website login link, share its own contact, redeem
   the return link, and verify the originating browser signs in. Repeat login with
   the linked account. Check expired sessions and another person's contact fail.
7. Verify ordinary bot chat/notifications still work. Persist the known-good PM2
   configuration according to the host's deployment convention.

The frontend companion branch updates the EN/RU/UZ instructions to describe the
contact-only flow. It does not change API contracts.
