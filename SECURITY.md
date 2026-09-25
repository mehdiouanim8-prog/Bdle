# Bundle security baseline

- Password hashes use bcrypt with a work factor of 12.
- Access tokens are short-lived JWTs; refresh tokens are opaque, hashed server-side, rotated and revocable.
- Verification codes are never generated or accepted by the mobile client.
- Twilio Verify is the source of truth for email and SMS possession checks.
- Persona webhook authenticity is checked from the raw HTTP body and signature header.
- RevenueCat webhook authorization and optional HMAC are checked before state changes.
- UGC is subject to report/block controls; text messaging can be screened through the configured moderation API.
- Sensitive identity documents are delegated to the identity provider rather than stored in the Bundle profile database.
- Media uses signed object-storage uploads rather than local server files.
- Account deletion and privacy export endpoints are included.
- Staff endpoints require a staff role and are audit logged.
- Production must use HTTPS, secret management, managed PostgreSQL backups/PITR, monitoring, alerting, and a controlled deployment process.
