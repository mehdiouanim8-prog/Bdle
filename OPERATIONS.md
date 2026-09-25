# Bundle operations runbook

## Staff setup
1. Register an ordinary Bundle account.
2. Run `npm run admin:promote -- user@example.com` in `backend`.
3. Sign into the admin console with the issued staff account access token.

## Moderation queues
- `/api/admin/profiles` — pending profile review.
- `/api/admin/photos` — pending photo verification.
- `/api/admin/kyc` — identity inquiries waiting on provider decisions.
- `/api/admin/reports` — open safety reports.

## Provider webhooks
All provider webhook URLs must be public HTTPS endpoints in production. Configure Persona and RevenueCat to point to:
- `POST /api/webhooks/persona`
- `POST /api/webhooks/revenuecat`

Verify signatures/secrets in the provider dashboards and keep clock synchronization enabled on the server.


### Staff console launch control

The bundled staff console uses Bundle staff credentials and backend role checks. Before public production exposure, put the admin origin behind HTTPS and a hardened staff access layer with MFA, short session lifetimes and your organization's incident-response controls. Do not expose the staff console on the same public origin as the consumer app without access controls.
