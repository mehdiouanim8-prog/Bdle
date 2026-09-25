# Bundle — Final Pre-Launch Engineering Pass

Date: 2026-09-17

This package is the production-oriented Bundle codebase after the final hardening pass.

## Included
- Sequential email → phone/SMS → profile → photos → identity/liveness → photo review → Bundle review → membership → dating flow.
- Real Twilio Verify integration for email/SMS.
- Persona identity/liveness integration with signed webhook handling and idempotency.
- RevenueCat subscription synchronization and lifecycle webhook handling.
- Apple/Google store subscription configuration points; no custom mobile checkout.
- PostgreSQL/Prisma with checked-in migrations.
- Rotating refresh sessions and persistent secure mobile tokens.
- Persistent profile drafts and server-backed profile/media persistence.
- S3-compatible signed media upload/delivery with media ownership checks.
- Automated moderation hook plus human moderation queues.
- Trust & Safety reports, blocks, unmatch, moderation, audit logs and staff roles.
- Realtime messaging architecture and notifications.
- Password recovery, account security, session revocation and account deletion.
- External account deletion page with email confirmation code and rate limits.
- Full Settings area for account, verification, preferences, privacy, safety, membership and security.
- Location permission + server persistence + distance-aware discovery.
- Push-token registration and notification preferences.
- Admin/staff console.
- CI, Docker definitions and operational/security documentation.

## Important production gates
The code intentionally refuses to start in production without critical integration configuration. Replace every `.env.example` placeholder with real secrets/configuration before production.

You still must create and configure your own:
- Twilio Verify service and production credentials.
- Persona production environment/templates/webhook.
- RevenueCat project, entitlement and Apple/Google products.
- Apple Developer/App Store Connect agreements and subscription products.
- Google Play Console merchant/product configuration.
- Private S3-compatible media storage/CDN.
- Resend transactional email and verified sending domain.
- OpenAI moderation API access.
- HTTPS public API and web domain.
- Final legal/privacy/support content.

## Security note
Apple App Attest and Google Play Integrity are documented in `docs/LAUNCH-RESEARCH.md` as defense-in-depth integrations for later native hardening. The first production build already uses server-enforced auth/session controls, device IDs, rate limiting and risk signals and does not pretend those native attestations are present until configured and tested.
