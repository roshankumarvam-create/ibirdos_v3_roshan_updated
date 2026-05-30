# IBirdOS Deployment Targets

## Production hosting
- **Web (Next.js)** → Vercel
- **API + Workers (NestJS, BullMQ)** → Railway (signup pending)
- **Postgres** → Railway plugin
- **Redis** → Railway plugin
- **Object storage** → Cloudflare R2

## Domains
- Domain registrar: **GoDaddy** (not Cloudflare)
- `workspace.ibirdos.com` → Vercel (this is the web dashboard, the main user-facing URL)
- `api.ibirdos.com` → Railway

## GoDaddy DNS notes
GoDaddy DNS is managed at godaddy.com → My Products → Domains → ibirdos.com → DNS.
Add CNAME records there:
  Type=CNAME, Name=workspace, Value=cname.vercel-dns.com, TTL=1 Hour
  Type=CNAME, Name=api,       Value=<railway-host>.up.railway.app, TTL=1 Hour
GoDaddy CNAMEs on subdomains work without their "Forwarding" feature.
DNS propagation is usually 5–30 minutes after saving.

## Cookies / cross-subdomain
Both subdomains live under ibirdos.com, so AUTH_COOKIE_DOMAIN=.ibirdos.com
(leading dot) on the API server, so sessions work across both.

## Step order for deploy
1. Confirm local pnpm dev works at http://localhost:3000
2. Deploy backend to Railway first, get the railway URL
3. Configure GoDaddy DNS (CNAME api → railway host)
4. Add custom domain api.ibirdos.com in Railway, wait for cert
5. Deploy web to Vercel with NEXT_PUBLIC_API_URL=https://api.ibirdos.com
6. Configure GoDaddy DNS (CNAME workspace → cname.vercel-dns.com)
7. Add custom domain workspace.ibirdos.com in Vercel, wait for cert
8. Configure Stripe webhook → https://api.ibirdos.com/api/v1/billing/webhook
9. Smoke test: signup, login, change-password flow, dashboard

## What NOT to put in Vercel env
The web app does NOT need DATABASE_URL, REDIS_URL, AUTH_SECRET, ARGON2_*,
R2_*, OPENAI_API_KEY, STRIPE_SECRET_KEY. Those are API-only secrets.
Vercel only needs NEXT_PUBLIC_API_URL and NEXT_PUBLIC_APP_URL.