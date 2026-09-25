# Bundle — Windows setup and first launch

Use **PowerShell in VS Code**. Follow the commands in order. Do not publish the app until the staging checklist in `PRODUCTION-READINESS.md` is complete.

## 1. Extract and open

Extract the ZIP and open the extracted `Bundle-production` folder in VS Code.

## 2. Start PostgreSQL

From the repository root:

```powershell
docker compose up -d postgres
```

Check it:

```powershell
docker ps
```

## 3. Configure backend

```powershell
cd backend
copy .env.example .env
npm install
npx prisma generate
npx prisma migrate deploy
npm run dev
```

The checked-in initial migration is at `backend/prisma/migrations/0001_initial/migration.sql`.

For future schema changes in development:

```powershell
npx prisma migrate dev --name your_change_name
```

Commit new migration directories to source control. Production/staging should use:

```powershell
npx prisma migrate deploy
```

The API should report:

```text
Bundle API + realtime server running on http://localhost:4000
```

Health check:

```powershell
Invoke-RestMethod http://localhost:4000/api/health
```

## 4. Configure the mobile app

Open a second VS Code terminal:

```powershell
cd frontend
copy .env.example .env
npm install
```

For a physical phone on the same Wi-Fi, find the laptop's LAN IPv4 address:

```powershell
ipconfig
```

Then set, for example:

```text
EXPO_PUBLIC_API_URL=http://192.168.1.20:4000/api
```

Start Expo:

```powershell
npx expo start
```

Expo Go is useful for UI/navigation work. A native Expo development build is required for real native purchase testing with RevenueCat.

## 5. Real provider setup

### Twilio Verify

Create one Verify Service and configure the SMS and Email channels. Set:

```text
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_VERIFY_SERVICE_SID
```

Bundle's server calls Twilio to start/check verification. Never place Twilio secrets in the frontend.

### Persona

Create the required verification workflow/templates for:

- government ID
- passport
- liveness / face checks

Set:

```text
PERSONA_API_KEY
PERSONA_ENVIRONMENT_ID
PERSONA_INQUIRY_TEMPLATE_ID
PERSONA_ID_TEMPLATE_ID
PERSONA_PASSPORT_TEMPLATE_ID
PERSONA_WEBHOOK_SECRET
PERSONA_HOSTED_FLOW_BASE_URL
```

Configure the webhook to:

```text
POST https://YOUR_API_DOMAIN/api/webhooks/persona
```

Use Persona's production environment only after the sandbox flow works end-to-end.

### RevenueCat + Apple / Google

Create the same Bundle Membership entitlement in RevenueCat and map the Apple and Google monthly products to it.

Set:

```text
EXPO_PUBLIC_REVENUECAT_IOS_PUBLIC_KEY
EXPO_PUBLIC_REVENUECAT_ANDROID_PUBLIC_KEY
EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID=bundle_membership
EXPO_PUBLIC_REVENUECAT_MONTHLY_PRODUCT_ID=bundle_monthly_999
```

Backend:

```text
REVENUECAT_API_KEY
REVENUECAT_WEBHOOK_AUTH
REVENUECAT_WEBHOOK_SIGNING_SECRET
REVENUECAT_ENTITLEMENT_ID=bundle_membership
BUNDLE_MONTHLY_PLAN=MONTHLY_9_99
```

Webhook:

```text
POST https://YOUR_API_DOMAIN/api/webhooks/revenuecat
```

### Media storage

Create a private S3-compatible bucket and configure:

```text
AWS_REGION
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_S3_BUCKET
AWS_S3_PUBLIC_BASE_URL
```

Use signed URLs/CDN delivery in production. Do not expose bucket credentials to the mobile app.

### Moderation

Set `OPENAI_API_KEY` to enable the configured message/profile/image moderation calls. Production moderation should combine automated detection with human review.

### Transactional email / password recovery

Set:

```text
RESEND_API_KEY
RESEND_FROM_EMAIL
APP_BASE_URL=https://YOUR_PUBLIC_WEB_DOMAIN
```

`APP_BASE_URL` must point to the public Bundle web origin because password-reset links use that origin.

## 6. Staff console

Open a third terminal:

```powershell
cd admin
copy .env.example .env
npm install
npm run dev
```

Create a normal Bundle account. Then promote it from the backend terminal:

```powershell
npm run admin:promote -- user@example.com
```

Open the admin Vite URL. Staff sign in using the same account credentials; the backend role determines access.

For public production, put the admin origin behind HTTPS and your organization's MFA/access-control layer.

## 7. Public web pages

`web/` contains the public privacy, terms, community-guidelines, safety, account-deletion and password-reset pages. The external account-deletion flow verifies control of the account email before the request becomes actionable by staff.

Deploy these files to your public web host and set:

```text
EXPO_PUBLIC_PUBLIC_WEB_URL=https://YOUR_PUBLIC_WEB_DOMAIN
APP_BASE_URL=https://YOUR_PUBLIC_WEB_DOMAIN
```

Before public launch, have the Terms and Privacy Policy reviewed/finalized for the jurisdictions where Bundle operates. The supplied documents are product drafts, not legal advice.

## 8. What to test before production

Run the complete journey:

```text
Register
→ Terms/Privacy + 18+ gate
→ Email OTP
→ Phone number
→ SMS OTP
→ Profile
→ Photos
→ Persona ID/passport + liveness
→ Identity approved
→ Photo review
→ Profile review
→ $9.99 membership
→ Discovery
→ Pass / Like
→ Match
→ Realtime message
→ Report / Block / Unmatch
```

Then deliberately test:

```text
Wrong / expired OTP
Refresh and reopen app
Refresh after saving bio
Refresh after uploading photo
Expired access token
Rotated refresh token
Revoked session
Duplicate webhook
Invalid webhook signature
Billing issue / grace period
Refund / expiration
Account deletion
Public deletion request
Suspended account
Blocked user
Rejected photo
Rejected identity
Profile edit after approval
```
