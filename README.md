# Chat SB Live

A small, real web app with a real backend that pulls genuinely live sports odds —
no sandbox, no scraping, no refresh schedule. The server holds an API key and
calls [The Odds API](https://the-odds-api.com) directly; the page polls the
server every 30 seconds (and on demand with the Refresh button) and shows the
best current price across every US book The Odds API covers, for NFL, college
football, and NBA.

This is a different thing from the "Chat SB" page published as a Claude
Artifact earlier in this conversation. That one runs sandboxed in your
browser and can't make outbound calls to third-party APIs — that's a
deliberate platform limit, not a bug. This project is a normal Node.js app
you run and deploy yourself, so it isn't bound by that limit.

## 1. Get a free API key

1. Go to <https://the-odds-api.com> and sign up — the free tier is 500
   requests/month, no credit card required.
2. Copy your API key from their dashboard.

The free tier covers moneylines, spreads, and totals out of the box.

### Player props

This app also pulls player props (anytime TD, rush/pass/reception yards,
points/rebounds/assists, etc.) — click "Show player props" on any game card.
Props are fetched per-event from The Odds API's single-event endpoint, since
they aren't included in the whole-sport odds call.

The Odds API's own docs don't state a hard paid-plan requirement for player
props — they say coverage is "limited to selected bookmakers and sports,
expanding over time." In practice that means: try it on your current plan
first. If a game shows "No player props currently posted," that could mean
no props are posted for that game yet, or that your plan/region doesn't have
access to that market — the app shows you whatever The Odds API actually
returns rather than guessing which. If you consistently get nothing, check
your plan's market coverage at <https://the-odds-api.com> or upgrade.

One cost note: unlike the main odds call, each props request costs quota
proportional to the number of markets requested (markets × regions), and it's
a separate request per game — so clicking into props on a lot of games will
use quota faster than just browsing the main odds board.

## 2. Run it locally

```bash
cd chatsb-live
npm install
cp .env.example .env
# edit .env and paste your real ODDS_API_KEY in
npm start
```

Open <http://localhost:3000>. Switch tabs between NFL / College Football /
NBA. Each tab calls `/api/odds/:sport` on your own server, which calls The
Odds API and caches the result for `CACHE_TTL_SECONDS` (default 60s) so you
don't burn through your quota just by refreshing the page a bunch.

### A note on quota

500 requests/month sounds like a lot until you realize caching is *per
sport*, not per visit — three sports, each re-fetched once per cache window,
adds up if you leave a tab open 24/7. With the default 60-second cache this
app is built for *personal, on-demand* use (you open it, check lines, close
it), not for running unattended all day. If you want it always-fresh and
always-on, either raise `CACHE_TTL_SECONDS` to something like `300` (5 min)
to stretch the free tier further, or move to one of The Odds API's paid
tiers, which also raise your request cap.

## 3. Deploy it somewhere real

The easiest path is **Render** (has a free tier, handles a plain Express app
with zero config changes):

1. Push this folder to a GitHub repo.
2. Go to <https://render.com> → New → Web Service → connect that repo.
3. Build command: `npm install`. Start command: `npm start`.
4. Under Environment, add `ODDS_API_KEY` (and optionally `CACHE_TTL_SECONDS`)
   with your real values — never commit your `.env` file or put the key
   directly in code.
5. Deploy. Render gives you a public `https://your-app.onrender.com` URL.

**Railway** and **Fly.io** work the same way (connect repo, set the env var,
deploy) if you'd rather use one of those.

**Vercel** works too, but Vercel runs Node as serverless functions rather
than a long-lived server, so `server.js` would need to be split into
`api/odds.js`-style function files instead of one `app.listen()` call. Say
the word if you'd rather go that route and I'll restructure it for Vercel
specifically.

## 4. What it actually shows

For every game, three columns: best moneyline price for each side, best
spread price at the most common point across books, and best total price at
the most common point — each tagged with which book actually has that price
right now. That's the one genuinely "live-only" feature a static page can't
fake: real-time line shopping across books, not a single pre-written number.

## Project structure

```
chatsb-live/
  server.js          Express server: /api/odds/:sport, /api/health, static files
  public/index.html  The live dashboard (single file, vanilla JS, polls the server)
  package.json
  .env.example        Copy to .env and fill in your real key
```
