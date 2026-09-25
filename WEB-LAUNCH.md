# Bundle — $0 Web Launch

This package is prepared for the first Bundle website deployment.

## Web onboarding

The website flow is:

`Create account → Email verification → Profile → Photos → Identity/liveness → Photo verification → Bundle review → Membership stage`

Phone number and SMS verification are **not part of the web flow**. The native mobile flow remains unchanged and still requires phone + SMS verification.

The backend distinguishes the web client with the `X-Bundle-Client: web` request header. The Expo frontend adds this header automatically on web and `mobile` on native builds.

## Web session storage

Native access/refresh tokens continue to use Expo SecureStore. The web build uses browser local storage for session persistence. This is a browser security trade-off and is not equivalent to native secure storage.

## Free GitHub Pages path

The Expo frontend is configured for static web export and a GitHub Pages project named `bundle`.

1. Create a **public** GitHub repository named `bundle`.
2. Upload this repository to it.
3. In the repository, set Pages to **GitHub Actions**.
4. Push to `main`; the included workflow exports `frontend/` and publishes `frontend/dist`.

Expected site URL:

`https://YOUR_GITHUB_USERNAME.github.io/bundle/`

The frontend can render without a live backend, but account actions need `EXPO_PUBLIC_API_URL` pointing to a deployed Bundle API. GitHub Pages hosts only the static frontend; it does not run Node/Express or PostgreSQL.

## Membership

The native $9.99/month RevenueCat flow remains unchanged. The $0 web launch does not fake or bypass billing.

## SMS endpoints

The web client cannot call the phone-number, SMS resend, SMS verification, or phone-change API routes. Those routes remain available to the native client only.
