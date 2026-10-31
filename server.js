require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ODDS_API_KEY = process.env.ODDS_API_KEY;
const CACHE_TTL_MS = (parseInt(process.env.CACHE_TTL_SECONDS, 10) || 60) * 1000;

// The Odds API sport keys: https://the-odds-api.com/sports-odds-data/sports-apis.html
const SPORT_KEYS = {
  nfl: 'americanfootball_nfl',
  cfb: 'americanfootball_ncaaf',
  nba: 'basketball_nba'
};

// Default player-prop markets requested per sport. These are real market keys
// from The Odds API's docs (NFL/NCAAF share one player-props table; NBA has its
// own). Coverage of these is "limited to selected bookmakers and sports" per
// The Odds API's own docs and can vary by plan — we don't assume it works,
// we just ask and report back whatever the API actually returns.
const PROP_MARKETS = {
  nfl: 'player_anytime_td,player_pass_tds,player_pass_yds,player_rush_yds,player_reception_yds,player_receptions',
  cfb: 'player_anytime_td,player_pass_tds,player_pass_yds,player_rush_yds,player_reception_yds,player_receptions',
  nba: 'player_points,player_rebounds,player_assists,player_threes,player_points_rebounds_assists'
};

// In-memory cache, one entry per sport (odds) or per sport+event (props). Good
// enough for a single small instance; if you ever run multiple server instances
// behind a load balancer, swap this for a shared cache (Redis, etc.) so they
// don't each burn their own quota.
const cache = {};
const propsCache = {};

async function fetchOdds(sportSlug) {
  const now = Date.now();
  const cached = cache[sportSlug];
  if (cached && (now - cached.fetchedAt) < CACHE_TTL_MS) {
    return { data: cached.data, cached: true, fetchedAt: cached.fetchedAt };
  }

  const sportKey = SPORT_KEYS[sportSlug];
  if (!sportKey) {
    throw Object.assign(new Error('Unknown sport. Use nfl, cfb, or nba.'), { status: 404 });
  }
  if (!ODDS_API_KEY) {
    throw Object.assign(new Error('ODDS_API_KEY is not set on the server. Add it to your .env (locally) or your host\'s environment variables (in production).'), { status: 500 });
  }

  const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${encodeURIComponent(ODDS_API_KEY)}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`;

  let res;
  try {
    res = await fetch(url);
  } catch (networkErr) {
    throw Object.assign(new Error(`Could not reach The Odds API (network error: ${networkErr.message}). If you're running this somewhere with restricted outbound network access, make sure it can reach api.the-odds-api.com.`), { status: 502 });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Object.assign(new Error(`The Odds API returned ${res.status}: ${text}`), { status: res.status === 401 ? 502 : res.status });
  }
  const data = await res.json();

  // The Odds API echoes your remaining monthly quota in response headers — log it
  // so you can keep an eye on usage without checking their dashboard.
  const remaining = res.headers.get('x-requests-remaining');
  const used = res.headers.get('x-requests-used');
  if (remaining != null) {
    console.log(`[odds-api] ${sportSlug}: used=${used} remaining=${remaining}`);
  }

  cache[sportSlug] = { data, fetchedAt: now };
  return { data, cached: false, fetchedAt: now };
}

async function fetchProps(sportSlug, eventId) {
  const now = Date.now();
  const cacheKey = sportSlug + ':' + eventId;
  const cached = propsCache[cacheKey];
  if (cached && (now - cached.fetchedAt) < CACHE_TTL_MS) {
    return { data: cached.data, cached: true, fetchedAt: cached.fetchedAt };
  }

  const sportKey = SPORT_KEYS[sportSlug];
  if (!sportKey) {
    throw Object.assign(new Error('Unknown sport. Use nfl, cfb, or nba.'), { status: 404 });
  }
  const markets = PROP_MARKETS[sportSlug];
  if (!ODDS_API_KEY) {
    throw Object.assign(new Error('ODDS_API_KEY is not set on the server.'), { status: 500 });
  }

  // Player props live on the per-event endpoint, not the whole-sport /odds
  // endpoint — The Odds API only exposes them one event at a time.
  const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/events/${encodeURIComponent(eventId)}/odds?apiKey=${encodeURIComponent(ODDS_API_KEY)}&regions=us&markets=${encodeURIComponent(markets)}&oddsFormat=american`;

  let res;
  try {
    res = await fetch(url);
  } catch (networkErr) {
    throw Object.assign(new Error(`Could not reach The Odds API (network error: ${networkErr.message}).`), { status: 502 });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // We don't guess what this means — The Odds API doesn't document a specific
    // error for "your plan doesn't include this market", so we just pass their
    // real response text straight through for the UI to show honestly.
    throw Object.assign(new Error(`The Odds API returned ${res.status} for player props: ${text || '(no body)'}`), { status: res.status === 401 ? 502 : res.status });
  }
  const data = await res.json();

  const remaining = res.headers.get('x-requests-remaining');
  const used = res.headers.get('x-requests-used');
  if (remaining != null) {
    console.log(`[odds-api] props ${sportSlug}/${eventId}: used=${used} remaining=${remaining}`);
  }

  propsCache[cacheKey] = { data, fetchedAt: now };
  return { data, cached: false, fetchedAt: now };
}

app.get('/api/props/:sport/:eventId', async (req, res) => {
  try {
    const result = await fetchProps(req.params.sport.toLowerCase(), req.params.eventId);
    res.set('Cache-Control', 'no-store');
    res.json(result);
  } catch (err) {
    console.error(`[odds-api] error fetching props ${req.params.sport}/${req.params.eventId}:`, err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.get('/api/odds/:sport', async (req, res) => {
  try {
    const result = await fetchOdds(req.params.sport.toLowerCase());
    res.set('Cache-Control', 'no-store');
    res.json(result);
  } catch (err) {
    console.error(`[odds-api] error fetching ${req.params.sport}:`, err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, hasApiKey: !!ODDS_API_KEY, cacheTtlSeconds: CACHE_TTL_MS / 1000 });
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Chat SB Live server running on http://localhost:${PORT}`);
  if (!ODDS_API_KEY) {
    console.warn('WARNING: ODDS_API_KEY is not set. Requests to /api/odds/* will fail until you set it.');
  }
});
