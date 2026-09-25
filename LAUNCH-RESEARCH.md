# Bundle — launch research decisions

Current verification date: 2026-09-17.

## Store safety and account controls

Google Play currently requires dating/matchmaking apps to use the applicable minor-access controls, and its user-generated-content rules require ongoing moderation plus in-app reporting/blocking. Google also requires an in-app deletion path and an external web resource for account-deletion requests.

Apple requires an in-app account-deletion path and expects user-generated content associated with a deleted account to be deleted, subject to lawful retention requirements. Apple also applies additional scrutiny to dating apps and requires a meaningfully differentiated/improved experience for this established category.

Bundle therefore includes:

- explicit 18+ onboarding acknowledgment plus server-side age eligibility
- identity + photo + profile verification gates
- report/block/unmatch controls
- Trust & Safety queues
- public account-deletion page
- in-app account deletion
- subscription management links
- community guidelines

## Subscription state

RevenueCat currently documents webhook delivery for purchase, renewal, cancellation, billing issue, expiration, refund and related events. Bundle stores subscription events and distinguishes active membership from billing issues/grace periods and expiration/refund states. Webhooks require authorization/HMAC checks and idempotent processing.

## Identity state

Persona currently documents inquiry lifecycle states including pending/completed/failed/expired and optional approved/declined decisions, plus verification-level statuses such as passed/requires-retry/failed. Bundle uses the identity provider as the source of truth for the KYC decision and stores provider references/status rather than ordinary profile copies of identity documents.

## Product decisions added after review

1. Changing profile photos invalidates photo verification and profile approval so verified accounts cannot silently swap in unreviewed media.
2. Profiles are limited to six photos server-side.
3. Account security includes password change, email change verification, phone change verification, session revocation and sign-out-everywhere.
4. Discovery excludes users already passed/liked/matched/blocked and ranks candidates using age, distance, declared intent, shared interests and activity recency.
5. A realtime notification inbox is included alongside push notifications.
6. Public password-reset and account-deletion pages are included so the consumer app has an external web surface for these account controls.

These decisions are product/engineering choices, not legal advice. Re-check store policies and local privacy requirements immediately before submission.

## Defense-in-depth integrity research

Apple's App Attest and Google's Play Integrity API can provide server-verified signals about genuine app/device integrity and should be considered for high-risk actions such as account creation, rapid automation, and sensitive account changes. They are deliberately not made a hard dependency of the first Bundle release because they require platform-native production configuration and should be introduced with tested native builds; Bundle already has server-side sessions, device IDs, rate limiting and risk signals to support the rollout. Apple documents App Attest as a way to validate genuine app/device properties and protect sensitive payloads; Google documents Play Integrity as a server-verified integrity/licensing signal.
