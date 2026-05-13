# Rough Riders Golf — Registration & Sponsorship

A 3-page registration + sponsorship system with Square checkout and an admin dashboard.

---

## Project Structure

```
roughriders-golf/
├── netlify.toml                    # Netlify build config
├── package.json                    # Dependencies (square, uuid)
├── .env.example                    # Environment variable template
├── .gitignore                      # Keeps .env out of GitHub
├── netlify/functions/
│   ├── create-checkout.js          # Creates Square payment link
│   ├── admin-auth.js               # Admin login / token
│   └── get-orders.js               # Fetches orders from Square
└── public/
    ├── register.html               # Public-facing registration page
    ├── admin.html                  # Staff admin dashboard
    └── success.html                # Post-payment confirmation
```

---

## Deploy in 5 Steps

### 1. Push to GitHub
```bash
cd roughriders-golf
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR-USERNAME/roughriders-golf.git
git push -u origin main
```

### 2. Connect to Netlify
1. Go to https://app.netlify.com → "Add new site" → "Import from Git"
2. Select your GitHub repo
3. Build settings are already in `netlify.toml` — just click **Deploy**

### 3. Set Environment Variables in Netlify
Go to: **Site Settings → Environment Variables → Add variable**

| Key | Value |
|---|---|
| `SQUARE_ACCESS_TOKEN` | Your Square access token (from Square Developer Dashboard) |
| `SQUARE_LOCATION_ID` | Your Square location ID |
| `SQUARE_BASE_URL` | `https://connect.squareup.com` (production) or `https://connect.squareupsandbox.com` (sandbox) |
| `ADMIN_EMAILS` | `you@example.com,staff@example.com` |
| `ADMIN_PASSWORD` | A strong password for admin login |
| `SESSION_SECRET` | Any random 32+ character string |
| `SUCCESS_URL` | `https://YOUR-SITE.netlify.app/success.html` |
| `CANCEL_URL` | `https://YOUR-SITE.netlify.app/register.html` |

### 4. Update the NETLIFY_BASE URLs
In both `public/register.html` and `public/admin.html`, find and replace:
```
const NETLIFY_BASE = 'https://YOUR-SITE.netlify.app';
```
with your actual Netlify URL, e.g.:
```
const NETLIFY_BASE = 'https://roughriders-golf.netlify.app';
```

### 5. Trigger a redeploy
In Netlify dashboard: **Deploys → Trigger deploy → Deploy site**

---

## Embedding the Registration Page in Wild Apricot

1. In your WA page editor, add a **Custom HTML** block
2. Use an iframe:
```html
<iframe
  src="https://YOUR-SITE.netlify.app/register.html"
  style="width:100%; min-height:900px; border:none;"
  scrolling="no"
  id="rr-golf-frame">
</iframe>
<script>
  // Auto-resize iframe to content height
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'resize') {
      document.getElementById('rr-golf-frame').style.height = e.data.height + 'px';
    }
  });
</script>
```

---

## Getting Your Square Credentials

1. Go to https://developer.squareup.com/apps
2. Create or open your app
3. **Access Token**: Under "Credentials" tab — use Sandbox for testing, Production for live
4. **Location ID**: Under "Locations" tab

---

## Admin Access

Go to: `https://YOUR-SITE.netlify.app/admin.html`

Login with the email from `ADMIN_EMAILS` and password from `ADMIN_PASSWORD`.

Features:
- **Orders tab** — all transactions, expandable golfer details, search + filter
- **Golfers tab** — every registered golfer with shirt size, handicap, company
- **Sponsors tab** — all sponsorship purchases with tier badges
- **CSV export** on every tab
- **Live refresh** pulls latest from Square

---

## Testing with Square Sandbox

1. Set `SQUARE_BASE_URL` to `https://connect.squareupsandbox.com`
2. Use your Sandbox access token
3. Test card number: `4111 1111 1111 1111`, any future expiry, any CVV

Switch to production by updating `SQUARE_BASE_URL` to `https://connect.squareup.com` and using your Production access token.
