# Security posture — Edmission backend

This document lists **residual risks** (weakest / highest-impact areas) and **controls** already in place. It is not a penetration-test report.

## Libraries & middleware (defense in depth)

| Layer | Library / mechanism | Role |
|--------|---------------------|------|
| HTTP headers | `helmet` | CSP (when Swagger off), HSTS in production, MIME sniffing, etc. |
| CORS | `cors` + allowlist | Reduces cross-origin browser abuse; not a substitute for auth. |
| Rate limits | `express-rate-limit` | Global `/api`, auth routes, search, uploads, public visit beacon. Configurable via env. |
| Soft throttle | `express-slow-down` | After many `/api` requests per IP in a window, adds increasing delay (before hard 429). Skips health + Stripe webhook. |
| Request timeout | `connect-timeout` | Drops hung / very slow requests (production default 120s; skips multipart + webhook). `DISABLE_API_REQUEST_TIMEOUT=true` or `API_REQUEST_TIMEOUT_MS=0` to disable. |
| JSON size | `express.json({ limit })` | Reduces large-body DoS. |
| NoSQL operators | `express-mongo-sanitize` | Strips `$…` / polluted keys from body, query, params (Mongoose is not a full sandbox). |
| Parameter pollution | `hpp` | Picks last value when duplicate keys appear (predictable server behavior). |
| Validation | `zod` + route `validate()` | Primary input contract; keep adding schemas anywhere `req.body` is still “raw”. |
| Response compression | `compression` (gzip/deflate) | Enabled in production by default: less bandwidth for JSON/text (modest CPU). Opt out: `DISABLE_RESPONSE_COMPRESSION=true`. |

**Not SQL injection:** data store is MongoDB. Relevant analogue is **NoSQL / operator injection** (mitigated in layers above).

**DDoS / volumetric:** protect at **CDN / WAF / reverse proxy** (e.g. Cloudflare, nginx `limit_req`). Node alone cannot absorb large L7 floods.

---

## Weakest / highest-priority areas (by impact)

### 1. Unauthenticated static files — `/api/uploads`

- **Risk:** Anyone with a URL can fetch an object if the filename (UUID) leaks (open tab, email, chat, referrer).
- **Mitigation today:** UUID filenames, `dotfiles: 'deny'`, `index: false`.
- **Hardening ideas:** short-lived signed URLs, auth gate for sensitive doc types, separate bucket with private ACL.

### 2. Admin bulk profile updates — Zod on the route (done)

- **Previously:** wide `req.body` + service whitelist only.
- **Now:** `adminPatchStudentProfileBodySchema` / `adminPatchUniversityProfileBodySchema` validate before the service; whitelist remains as defense in depth.

### 3. File uploads — SVG and “polyglot” files

- **Risk:** `image/svg+xml` can carry script if served/embedded in certain contexts; MIME sniffing can be wrong for some types.
- **Mitigation today:** extension + MIME checks, size limits.
- **Hardening ideas:** strip SVG for user-controlled “inline” use, virus scan pipeline, `Content-Disposition: attachment` for risky types.

### 4. Public writable endpoint — `POST /public/analytics/visit`

- **Risk:** DB write spam, inflated metrics.
- **Mitigation today:** Zod bounds on `visitorId` / `path`, **dedicated rate limit** (`publicVisitRateLimiter`), global API limit still applies in production.

### 5. Socket.IO — token in query string (optional client behavior)

- **Risk:** Token may appear in **proxy logs**, **browser history**, or **Referer** if misused.
- **Mitigation today:** Prefer `handshake.auth.token`; JWT verified on connect.
- **Hardening ideas:** document client to never pass token in query; optional short-lived socket-only ticket.

### 6. Socket connect — suspended users (addressed in code)

- **Risk:** Old JWT could still open a socket after suspension.
- **Mitigation:** handshake now checks `User.suspended` before `next()`.

### 7. Dependency vulnerabilities

- Run `npm audit` / `npm audit fix` regularly; some issues need major version bumps — schedule them.

### 8. Secrets & defaults

- **Never commit** real `.env`, DB URIs, SMTP passwords, or bot tokens.
- Rotate anything that ever appeared in a repo or chat.
- Default dev JWT secrets are **blocked in production** in `config/index.ts` — keep it that way.

### 9. Telegram bot flows

- **Risk:** OTP or linking codes in chat are **visible** to anyone with device access; weak compared to TOTP/WebAuthn for high-assurance actions.
- **Scope:** acceptable for notifications / convenience; not for high-risk admin actions without extra factors.

### 10. Frontend

- **Risk:** XSS via rich text, `dangerouslySetInnerHTML`, or compromised CDN scripts.
- **Mitigation today:** production build `sourcemap: false` in Vite (reduces leaked source).
- **Hardening ideas:** strict CSP on static hosting, Subresource Integrity for third-party scripts, regular dependency review.

---

## Operational checklist

1. **Production:** `TRUST_PROXY=1` behind a reverse proxy so rate limits see real client IPs.
2. **Tune limits** via `RATE_LIMIT_*` env vars under load; avoid `DISABLE_RATE_LIMIT` except controlled tests.
3. **Enable rate limits in dev** when testing abuse scenarios: `ENABLE_RATE_LIMIT_IN_DEV=true`.
4. **Stripe webhook:** keep raw body verification path unchanged; do not run extra parsers before webhook if you change middleware order.
5. **Monitoring:** alert on 401/429 spikes, DB write rate on `SiteVisit`, disk use on `uploads/`.

---

## Change log (high level)

- Added `express-mongo-sanitize`, `hpp`, stricter production rate limits, JSON body cap, public route validation, public visit rate limit, socket suspended check, and this document.
