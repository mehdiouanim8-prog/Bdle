# Bundle production-readiness status

This repository contains the production-oriented application code and integration points. It cannot create third-party merchant/provider accounts or legally accept payments/identity documents without credentials owned by Bundle.

## Implemented in code
- Sequential onboarding and separate email/SMS verification pages
- Twilio Verify email + SMS integration
- Persona inquiry creation + hosted verification + signed webhook processing
- Photo-verification state and staff review flow
- PostgreSQL/Prisma state model
- Short-lived access JWT + rotating opaque refresh sessions
- Account recovery and account deletion
- Profile/preferences/location APIs
- Signed object-storage media upload API
- Recommendation scoring/exclusion rules
- Pass, like and mutual-match flows
- Realtime Socket.IO messaging path
- Push-token registration + notification dispatch
- Reporting/blocking
- Staff dashboard API and standalone admin UI
- RevenueCat purchase client + webhook state synchronization
- Audit logs, consent records and privacy export
- Moderation hook for text
- Docker, CI, environment templates and operational docs

## External configuration still required before an actual store launch
- Twilio production Verify Service and verified sending configuration
- Persona production environment, template/workflow, liveness/document checks and webhook
- Apple App Store subscription product + agreements/banking/tax setup
- Google Play subscription product + merchant/banking/tax setup
- RevenueCat apps, entitlement and webhook configuration
- S3-compatible object storage + CDN + lifecycle policy
- Production PostgreSQL + backups/PITR
- APNs/FCM/Expo project configuration for push
- Domain + HTTPS + DNS
- Privacy policy, terms, community/safety policy and regional legal review
- Final content moderation rules, staff SOPs and appeal process
- Load/performance/security testing and store review

## Testing standard
Do not mark the release candidate ready until the complete path has been tested end-to-end in staging:
`register -> email OTP -> phone OTP -> profile -> photos -> Persona ID/passport+liveness -> photo review -> profile review -> Apple/Google purchase -> entitlement webhook -> discover -> like -> match -> realtime message -> report/block -> deletion/export`.


## Current store/provider launch checks

Bundle must be configured to block minors from the dating experience, provide robust UGC reporting/blocking/moderation, provide an in-app account deletion path plus a public deletion-request path, and explain subscription price/renewal/value clearly. Apple additionally expects dating apps to provide a meaningfully differentiated or improved experience. Verify the current Apple and Google Play policies again immediately before submission because store requirements can change.

RevenueCat webhooks are treated as untrusted until authorization/HMAC validation, timestamp validation and idempotency checks pass. Billing-issue, grace-period, refund and expiration transitions are represented explicitly.

Persona inquiry state comes from the provider lifecycle/webhook rather than a client-side verification flag. Raw identity documents are not stored in the Bundle profile database by design.
