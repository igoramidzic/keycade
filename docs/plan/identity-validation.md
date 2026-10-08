# Passwordless access test guide

Historical T06 guide, implemented October 6, 2026, before application creation (T07). See the [current demo guide](../../README.md) for application workflows and the hosted inbox.

## Run locally

After updating dependencies, run `pnpm initialize` to apply the additive identity migration and create the access-email queue. It preserves existing records and configuration. Run `pnpm dev` if the local apps are not already running.

1. Open [the borrower portal](http://127.0.0.1:3001), enter `borrower@example.test`, and choose **Sign in to demo**. You enter immediately, without opening an email.
2. Check the **Demo access** label, reload to check session persistence, and **Sign out**. Reload again to confirm you remain signed out.
3. Open [the bank console](http://127.0.0.1:3002) and repeat with `officer-a@example.test`. A new address such as `nonstaff@example.test` cannot gain staff access. Being an owner or knowing a bank email address does not grant membership.

To test the optional email flow, choose **Use an email link instead**, request a link, then open [Mailpit](http://127.0.0.1:8025). Select that recipient's newest message and open its link. Opening the link only displays confirmation; choose **Confirm and sign in** to use it. Sign out, open the same link again, and confirm it is rejected. A fresh requested link restores access.

Immediate sign-in is enabled by the local API only in `NODE_ENV=development`, for synthetic banks/users. Demo sessions never mark an email verified and are restricted to the selected bank. Production/hosted mode disables demo sign-in and rejects existing demo sessions. Staff access still requires an explicit active seed membership.

Custom ports in `.env` are reflected in initialization output and the in-app inbox link. Keep using the same hostname as the email link: `localhost` and `127.0.0.1` are intentionally separate origins. Borrower and staff sessions can coexist in one browser.

Email links last 15 minutes and sessions eight hours. Throttling persists across API restarts: five emails per normalized address/bank and 20 sends per IP in 15 minutes; 30 confirmation attempts per IP in 15 minutes. Repeated browser runs share the local IP and can legitimately exhaust these limits. Wait for the window rather than resetting application data.

The signed-in screen is an access checkpoint. It does not yet list or create applications. Neither sign-in method creates a draft, and a new address receives no application or staff grants.

## Failure and security coverage

- Fresh real PostgreSQL databases validate migrations, tenant constraints, hashed credentials, pending contact isolation, deliberate use, concurrent/sibling token consumption, expiry, session and membership revocation, rate limiting, transactional audit rollback, and allowlisted returns.
- Both Fastify and the native Worker transport test real cookie sessions, forged/absent origins, CSRF, staff denial, direct application access, and logout invalidation. The Vite proxy preserves the frontend Host for session reads without an Origin header.
- The email worker tests queue send/mark crashes, queue fetch crashes, SMTP failure, SMTP acceptance followed by a crash, retry-issued siblings, and duplicate delivery. All persistent work contains IDs/hashes; safe metadata replaces SMTP exception details.
- Browser journeys use actual Mailpit SMTP delivery. Authentication traces, screenshots, and video are disabled so test reports do not retain bearer links. No real external email is sent.

## Hosted boundary

The original T06 checkpoint was local. [D03](tasks/D03-hosted-demo-parity.md#hosted-acceptance--october-7-2026) subsequently added the hosted private simulated inbox, and [V2-08](v2/04-delivery-and-validation.md#v2-08--hosted-parity-and-deployment-slice) verifies hosted confirmation, link replay denial, setup resume and staff access. Native API/jobs readiness requires valid simulated-inbox configuration; unavailable delivery returns `503 AUTH_DELIVERY_UNAVAILABLE` without partial authentication or intake writes. No real email is sent. Do not expose Mailpit publicly. Neon migrations remain owned by GitHub Actions.

## Validation record

Final command results are recorded in [T06](tasks/T06-identity.md#implementation-record).
