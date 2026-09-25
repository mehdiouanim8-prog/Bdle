# Bundle production architecture

```text
iOS / Android (Expo + Expo Router)
          |
          | HTTPS / JWT
          v
Node.js + Express API + Socket.IO
          |
    +-----+-----+----------------------+
    |           |                      |
 PostgreSQL    Redis*            Provider APIs
    |                              /   |    \
 Prisma                        Twilio Persona RevenueCat
    |
Audit / moderation / membership / dating state

Media: signed mobile upload -> S3-compatible object storage -> CDN
Push: Expo Push Service -> APNs / FCM
Admin: separate Vite web console -> same protected API
```

`*` Redis is intentionally optional in this build. The current API does not make Redis a required dependency; add it when horizontal API scaling requires shared rate-limit/cache state.

## Server trust boundary
The client can request an action but cannot grant itself a verified state. The backend is the source of truth for email, phone, identity, photo verification, profile approval and membership entitlement.

## External secrets
No third-party secret is committed. Twilio, Persona, RevenueCat, storage and optional moderation credentials must be injected through environment/secret management.
