# Rough Riders Golf — Registration & Sponsorship

A 3-step registration + sponsorship system with Stripe checkout and a staff admin dashboard.

---

## Project Structure

```
roughriders-golf/
├── netlify.toml                    # Netlify build config
├── package.json                    # Dependencies (stripe)
├── .env.example                    # Environment variable template
├── .gitignore                      # Keeps .env out of GitHub
├── netlify/functions/
│   ├── create-checkout.js          # Creates Stripe Checkout Session
│   ├── admin-auth.js               # Admin login / token
│   └── get-orders.js               # Fetches sessions from Stripe
└── public/
    ├── register.html               # Public-facing registration page
    ├── admin.html                  # Staff admin dashboard
    └── success.html                # Post-payment confirmation
```

---

## Deploy Steps

### 1. Push to GitHub
Upload files via github.com or GitHub Desktop.

### 2. Connect to Netlify
Netlify → Add new site → Import from Git → select repo → Deploy.
(`netlify.toml` handles all build settings automatically.)

### 3. Set Environment Variables in Netlify
**Site configuration → Environment variables → Add variable**

| Key | Value |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_...` (test) or `sk_live_...` (production) |
| `ADMIN_EMAILS` | `you@example.com,staff@example.com` |
| `ADMIN_PASSWORD` | A strong password for admin login |
| `SESSION_SECRET` | Any random 32+ character string |
| `SUCCESS_URL` | `https://YOUR-SITE.netlify.app/success.html` |
| `CANCEL_URL` | `https://YOUR-SITE.netlify.app/register.html` |

### 4. Update NETLIFY_BASE in the HTML files
In `public/register.html` and `public/admin.html`, find:
```js
const NETLIFY_BASE = 'https://YOUR-SITE.netlify.app';
```
Replace with your actual Netlify URL, commit to GitHub — Netlify redeploys automatically.

---

## Getting Your Stripe Keys

1. Go to https://dashboard.stripe.com/apikeys
2. Copy the **Secret key** — starts with `sk_test_` (test) or `sk_live_` (live)
3. Use test keys until you're ready to go live

**Test card:** `4242 4242 4242 4242` · any future date · any CVV · any ZIP

---

## Embedding in Wild Apricot

Add a **Custom HTML** block to your WA page:
```html
<iframe
  src="https://YOUR-SITE.netlify.app/register.html"
  style="width:100%; min-height:900px; border:none;"
  id="rr-golf-frame">
</iframe>
```

---

## Admin Access

URL: `https://YOUR-SITE.netlify.app/admin.html`

Login with any email from `ADMIN_EMAILS` and the `ADMIN_PASSWORD`.

Tabs: **Orders** · **Golfers** · **Sponsors** — all with CSV export.

---

## Going Live

1. In Stripe dashboard, complete account activation
2. Swap `STRIPE_SECRET_KEY` to your `sk_live_...` key in Netlify env vars
3. Update `SUCCESS_URL` / `CANCEL_URL` if your domain changes
4. Trigger a redeploy in Netlify
