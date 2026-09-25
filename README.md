# Bundle — production-oriented full-stack dating platform

## Web-first $0 launch

The first public web deployment removes phone/SMS verification from web onboarding to avoid SMS spend. Native iOS/Android keeps the original phone + SMS gate. See `WEB-LAUNCH.md`.

Bundle is a verification-first, membership dating application for iOS and Android with a separate staff console. The repository contains the application code, backend state machine, provider integration points, safety/moderation infrastructure, media pipeline hooks, realtime messaging, subscription synchronization, Docker setup and CI.

## Product gate

A user cannot reach discovery, likes, matches or messaging unless the backend confirms:

```text
email verified
+ phone verified
+ identity verified
+ photo verification verified
+ profile approved
+ active $9.99/month Bundle Membership
= dating access
```

Payment cannot bypass identity verification. The $9.99 charge is the Bundle Membership, not an identity-verification fee.

## Verification journey

```text
Create account
  -> Email OTP page
  -> Phone number page
  -> SMS OTP page
  -> Profile page
  -> Profile photos page
  -> Government ID / Passport + liveness (Persona Hosted Flow)
  -> Identity pending/decision
  -> Photo verification review
  -> Bundle profile review
  -> Membership ($9.99/month through Apple / Google)
  -> Discover
  -> Like / Pass
  -> Match
  -> Realtime chat
```

Twilio Verify supports SMS and email verification over HTTPS. Persona supports API-created inquiries, hosted verification flows, inquiry templates and signed webhooks. RevenueCat supports subscription lifecycle webhooks and HMAC verification. See the linked provider documentation in `docs/OPERATIONS.md` and the source references supplied with this build.

## Repository

- `frontend/` — Expo Router / React Native application
- `backend/` — Node.js / Express / TypeScript / Prisma API + Socket.IO
- `admin/` — Vite/React Trust & Safety console
- `docs/` — architecture, security and operations
- `docker-compose.yml` — local PostgreSQL

## External services used

### Twilio Verify

Required backend variables:

```text
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_VERIFY_SERVICE_SID
```

Email and SMS are verified by Twilio on the server. The client never decides that a code is valid.

### Persona

Required backend variables:

```text
PERSONA_API_KEY
PERSONA_ENVIRONMENT_ID
PERSONA_INQUIRY_TEMPLATE_ID
PERSONA_ID_TEMPLATE_ID
PERSONA_PASSPORT_TEMPLATE_ID
PERSONA_WEBHOOK_SECRET
PERSONA_HOSTED_BASE_URL
```

The selected Persona template must actually be configured for the ID/passport and liveness checks you want to require. Bundle stores verification metadata and provider references, not passport/ID document images in the ordinary profile database.

Webhook:

```text
POST /api/webhooks/persona
```

### RevenueCat + Apple / Google

Mobile variables:

```text
EXPO_PUBLIC_REVENUECAT_IOS_PUBLIC_KEY
EXPO_PUBLIC_REVENUECAT_ANDROID_PUBLIC_KEY
EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID
EXPO_PUBLIC_REVENUECAT_MONTHLY_PRODUCT_ID
```

Backend variables:

```text
REVENUECAT_WEBHOOK_AUTH
REVENUECAT_WEBHOOK_SIGNING_SECRET
REVENUECAT_ENTITLEMENT_ID
BUNDLE_MONTHLY_PLAN
```

The app uses RevenueCat's native purchase path. Configure the $9.99/month product in Apple App Store Connect and Google Play, then map both products to the same Bundle Membership entitlement in RevenueCat.

RevenueCat webhook:

```text
POST /api/webhooks/revenuecat
```

### Media storage

The media API uses signed S3-compatible uploads. Variables:

```text
AWS_REGION
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_S3_BUCKET
AWS_S3_PUBLIC_BASE_URL
```

Use a CDN in front of the bucket in production, private bucket policies where appropriate, and lifecycle/deletion rules.

### Push notifications

Expo push tokens are registered by the mobile client. The backend dispatches notifications to Expo Push Service, which delivers to APNs/FCM. Configure an EAS project ID in the frontend when required by the current Expo setup.

### Text moderation

Set `OPENAI_API_KEY` to enable the configured moderation call for messages. Without that key, the backend does not pretend moderation is active; staff reporting/blocking remains available. Production should combine automated detection with human moderation.

## Local development

### 1. PostgreSQL

From the repository root:

```powershell
docker compose up -d postgres
```

Or use a separately managed PostgreSQL instance and set `DATABASE_URL` manually.

### 2. Backend

```powershell
cd backend
copy .env.example .env
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run dev
```

The first migration is generated from the checked-in Prisma schema. For a deployment pipeline, commit the generated `backend/prisma/migrations/` directory and use `npx prisma migrate deploy` in staging/production.

### 3. Frontend

Create `frontend/.env` from `frontend/.env.example` and set the computer's LAN IP for `EXPO_PUBLIC_API_URL` when using a physical phone.

```powershell
cd frontend
npm install
npx expo start
```

Expo Go is enough to work on non-native navigation/UI, but real subscription purchases require a native development build because RevenueCat's native purchase path is not a normal Expo Go production path.

### 4. Staff admin

```powershell
cd admin
copy .env.example .env
npm install
npm run dev
```

Register a normal Bundle user first, then from the backend:

```powershell
npm run admin:promote -- user@example.com
```

Use that account's access token in the staff console.

## Security model

- short-lived access JWT
- rotating, revocable, hashed refresh sessions
- server-side OTP verification
- rate limits
- Helmet security headers
- CORS allowlist support
- provider webhook signature validation
- audit logging
- staff role authorization
- account deletion
- privacy export
- signed object-storage uploads
- message moderation hook
- block/report controls

See `docs/SECURITY.md`.

## What this repository cannot do by itself

Code cannot create or own external merchant/provider accounts, bank accounts, App Store/Play Store products, a Persona production environment, a Twilio production sender/configuration, RevenueCat products, a production domain, or legally required privacy/terms documents. Those require your organization/account credentials and, where applicable, store/legal approval.

The application is intentionally written so those real credentials are injected through environment/secret management instead of being fabricated in the repository.

Before store release, run the complete staging journey in `PRODUCTION-READINESS.md`, load-test it, verify backups/restore, test abuse and moderation workflows, test Apple/Google billing state changes, and complete legal/store review.
