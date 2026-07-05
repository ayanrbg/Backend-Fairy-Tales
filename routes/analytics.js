const express = require('express');
const pool = require('../db');
const auth = require('../middleware/auth');
const adminKey = require('../middleware/adminKey');

const optionalAuth = auth.optional;
const router = express.Router();

// Cap how much a single request can insert so a misbehaving client can't
// hammer the DB. GA4 itself batches ~25 events per request.
const MAX_BATCH = 50;
const MAX_NAME_LEN = 64;

// The mirror whitelist (SERVER_ANALYTICS_MIRROR_HANDOFF §"вайтлист"). We still
// accept anything the client sends — but knowing the canonical set lets us flag
// typos/unexpected names in the log and dashboard, which is exactly what makes a
// bad build obvious. Descriptions are shown in the dashboard glossary ("что к чему").
const MIRROR_EVENTS = {
  paywall_view:     { ru: 'Показан пейволл',              params: 'source' },
  paywall_dismiss:  { ru: 'Пейволл закрыт без покупки',   params: 'source' },
  purchase_start:   { ru: 'Нажата кнопка покупки',        params: 'product_id, source' },
  purchase_success: { ru: 'Покупка подтверждена',         params: 'product_id, price, currency, is_trial' },
  purchase_error:   { ru: 'Ошибка/отмена покупки',        params: 'product_id, error_code, error_message?' },
  purchase_restore: { ru: 'Восстановление покупок',       params: 'restored' },
  promo_redeem:     { ru: 'Активирован промокод',          params: 'success' },
  tale_complete:    { ru: 'Сказка дочитана до конца',      params: 'tale_id, total_pages, duration_ms' },
};
const KNOWN_NAMES = new Set(Object.keys(MIRROR_EVENTS));

// One readable line per received batch so a real device build is debuggable
// without SSH-tailing raw SQL. Set ANALYTICS_LOG=0 to silence. Shows who sent
// it, how many events, per-name counts, and marks unknown names with `?` so a
// client-side typo (e.g. "purchse_success") jumps out immediately.
function logIngest(req, b, events, userIdSource) {
  if (process.env.ANALYTICS_LOG === '0') return;
  const counts = {};
  for (const e of events) counts[e.name] = (counts[e.name] || 0) + 1;
  const parts = Object.entries(counts)
    .map(([n, c]) => `${KNOWN_NAMES.has(n) ? '' : '?'}${n}×${c}`);
  const dropped = (Array.isArray(b.events) ? b.events.length : 1) - events.length;
  console.log(
    `[ANALYTICS] ingest session=${b.session || '-'} platform=${b.platform || '-'} ` +
    `v${b.appVersion || '-'} user=${userIdSource} events=${events.length}` +
    `${dropped > 0 ? ` dropped=${dropped}` : ''} [${parts.join(', ') || 'none'}]`
  );
}

// Accept both a single event and a batch. Shape:
//   { session, platform, appVersion, events: [ { name, ts, params } ] }
//   or a single { name|ev, ts, params, session, platform, appVersion }
function normalizeEvents(b) {
  const list = Array.isArray(b.events) ? b.events : [b];
  const out = [];
  for (const e of list) {
    if (!e || typeof e !== 'object') continue;
    const name = String(e.name || e.ev || '').trim().slice(0, MAX_NAME_LEN);
    if (!name) continue;
    let params = e.params != null ? e.params : null;
    if (params != null && typeof params !== 'object') params = { value: params };
    out.push({
      name,
      params,
      clientTs: e.ts ? new Date(e.ts) : (b.ts ? new Date(b.ts) : null),
    });
    if (out.length >= MAX_BATCH) break;
  }
  return out;
}

// POST /api/analytics/event — our own copy of client GA4 events (§3C).
// No auth required (events may flow before login); a valid JWT overrides the
// body's userId. Always 200, fire-and-forget — analytics must never break the app.
router.post('/event', optionalAuth, async (req, res) => {
  try {
    const b = req.body || {};
    const userId = req.userId || b.userId || null;
    const events = normalizeEvents(b);
    // How we resolved userId — surfacing this is key when "app_open before login"
    // events arrive anonymously and you're wondering why user is empty.
    const userSrc = req.userId ? `jwt(${req.userId})` : (b.userId ? `body(${b.userId})` : 'anon');
    logIngest(req, b, events, userSrc);
    if (events.length) {
      // Single multi-row INSERT.
      const values = [];
      const params = [];
      events.forEach((e, i) => {
        const o = i * 7;
        values.push(`($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6}, $${o + 7})`);
        params.push(
          userId, b.session || null, b.platform || null, b.appVersion || null,
          e.name, e.params != null ? JSON.stringify(e.params) : null, e.clientTs
        );
      });
      await pool.query(
        `INSERT INTO analytics_events
           (user_id, session, platform, app_version, name, params, client_ts)
         VALUES ${values.join(', ')}`,
        params
      );
    }
  } catch (e) {
    console.error(`[ANALYTICS] event ingest error: ${e.message}`);
  }
  return res.json({});
});

// GET /api/analytics/events?name=&userId=&session=&since=&platform=&limit= — reader (admin).
// platform=editor isolates Unity-Editor test events from real ios/android traffic.
router.get('/events', adminKey, async (req, res) => {
  try {
    const { name, userId, session, since, platform } = req.query;
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
    const where = [];
    const params = [];
    if (name)     { params.push(name);     where.push(`name = $${params.length}`); }
    if (userId)   { params.push(userId);   where.push(`user_id = $${params.length}`); }
    if (session)  { params.push(session);  where.push(`session = $${params.length}`); }
    if (platform) { params.push(platform); where.push(`platform = $${params.length}`); }
    if (since)    { params.push(new Date(since)); where.push(`received_at >= $${params.length}`); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(limit);
    const { rows } = await pool.query(
      `SELECT id, user_id, session, platform, app_version, name, params, client_ts, received_at
         FROM analytics_events ${whereSql}
         ORDER BY received_at DESC
         LIMIT $${params.length}`,
      params
    );
    res.json(rows);
  } catch (e) {
    console.error(`[ANALYTICS] events read error: ${e.message}`);
    res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/analytics/summary?since= — per-event counts (admin), quick sanity view.
router.get('/summary', adminKey, async (req, res) => {
  try {
    const since = req.query.since ? new Date(req.query.since) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const { rows } = await pool.query(
      `SELECT name, COUNT(*)::int AS count, MAX(received_at) AS last_seen
         FROM analytics_events
        WHERE received_at >= $1
        GROUP BY name
        ORDER BY count DESC`,
      [since]
    );
    res.json({ since, events: rows });
  } catch (e) {
    console.error(`[ANALYTICS] summary error: ${e.message}`);
    res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/analytics/insights?since= — aggregated view for the admin dashboard.
// All aggregation is server-side SQL so numbers stay accurate regardless of row
// caps, pulling values out of the JSONB `params` (revenue/trials/products from
// purchase_success, source from paywall/purchase, tale_id/duration from
// tale_complete). Powers the charts on the promo admin site's Analytics tab.
router.get('/insights', adminKey, async (req, res) => {
  try {
    const since = req.query.since ? new Date(req.query.since) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    // Optional platform filter (e.g. platform=editor to see only Unity-Editor
    // test traffic). When present it's bound as $2 and appended to every WHERE.
    const platform = req.query.platform || null;
    const pf = platform ? ' AND platform = $2' : '';
    const args = platform ? [since, platform] : [since];
    const [counts, purch, totals, daily, sources, platforms, tales] = await Promise.all([
      pool.query(
        `SELECT name, COUNT(*)::int AS count, MAX(received_at) AS last_seen
           FROM analytics_events WHERE received_at >= $1${pf} GROUP BY name ORDER BY count DESC`, args),
      pool.query(
        `SELECT params->>'product_id' AS product_id,
                COALESCE(params->>'currency', '?') AS currency,
                COUNT(*)::int AS count,
                COALESCE(SUM((params->>'price')::numeric), 0) AS revenue,
                COUNT(*) FILTER (WHERE (params->>'is_trial')::boolean)::int AS trials
           FROM analytics_events
          WHERE received_at >= $1${pf} AND name = 'purchase_success'
          GROUP BY 1, 2 ORDER BY count DESC`, args),
      pool.query(
        `SELECT COUNT(DISTINCT session)::int AS sessions, COUNT(*)::int AS events
           FROM analytics_events WHERE received_at >= $1${pf}`, args),
      pool.query(
        `SELECT to_char(date_trunc('day', received_at), 'YYYY-MM-DD') AS date,
                COUNT(*) FILTER (WHERE name = 'paywall_view')::int     AS paywall_view,
                COUNT(*) FILTER (WHERE name = 'purchase_start')::int   AS purchase_start,
                COUNT(*) FILTER (WHERE name = 'purchase_success')::int AS purchase_success,
                COUNT(*) FILTER (WHERE name = 'tale_complete')::int    AS tale_complete
           FROM analytics_events WHERE received_at >= $1${pf}
          GROUP BY 1 ORDER BY 1`, args),
      pool.query(
        `SELECT params->>'source' AS source, COUNT(*)::int AS count
           FROM analytics_events
          WHERE received_at >= $1${pf} AND name IN ('paywall_view', 'purchase_start') AND params ? 'source'
          GROUP BY 1 ORDER BY 2 DESC`, args),
      pool.query(
        `SELECT COALESCE(platform, '?') AS platform, COUNT(*)::int AS count
           FROM analytics_events WHERE received_at >= $1${pf} GROUP BY 1 ORDER BY 2 DESC`, args),
      pool.query(
        `SELECT params->>'tale_id' AS tale_id, COUNT(*)::int AS completions,
                ROUND(AVG((params->>'duration_ms')::numeric))::int AS avg_duration_ms
           FROM analytics_events
          WHERE received_at >= $1${pf} AND name = 'tale_complete' AND params ? 'tale_id'
          GROUP BY 1 ORDER BY 2 DESC LIMIT 12`, args),
    ]);

    const countByName = {};
    counts.rows.forEach((r) => { countByName[r.name] = r.count; });
    const revenue = {};
    let trials = 0, purchases = 0;
    purch.rows.forEach((r) => {
      revenue[r.currency] = (revenue[r.currency] || 0) + Number(r.revenue);
      trials += r.trials;
      purchases += r.count;
    });

    res.json({
      since,
      totals: {
        events: totals.rows[0].events,
        sessions: totals.rows[0].sessions,
        purchases,
        trials,
        completions: countByName['tale_complete'] || 0,
        revenue,
      },
      funnel: {
        paywall_view: countByName['paywall_view'] || 0,
        purchase_start: countByName['purchase_start'] || 0,
        purchase_success: countByName['purchase_success'] || 0,
        paywall_dismiss: countByName['paywall_dismiss'] || 0,
        purchase_error: countByName['purchase_error'] || 0,
        purchase_restore: countByName['purchase_restore'] || 0,
        promo_redeem: countByName['promo_redeem'] || 0,
      },
      counts: counts.rows,
      daily: daily.rows,
      sources: sources.rows,
      platforms: platforms.rows,
      products: purch.rows.map((r) => ({
        product_id: r.product_id, currency: r.currency,
        count: r.count, revenue: Number(r.revenue), trials: r.trials,
      })),
      topTales: tales.rows,
    });
  } catch (e) {
    console.error(`[ANALYTICS] insights error: ${e.message}`);
    res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/analytics/tale/:id?since=&platform= — deep dive for a single tale.
// Needs the reading events mirrored (tale_open / tale_page_view / tale_abandon,
// plus tale_complete). Returns the page-retention curve (how many reached each
// page), the exit-page distribution (where readers quit) and average dwell time
// per page (derived from consecutive tale_page_view timestamps in a session).
router.get('/tale/:id', adminKey, async (req, res) => {
  try {
    const taleId = req.params.id;
    const since = req.query.since ? new Date(req.query.since) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const platform = req.query.platform || null;
    // $1 since, $2 tale_id, ($3 platform when filtering).
    const pf = platform ? ' AND platform = $3' : '';
    const args = platform ? [since, taleId, platform] : [since, taleId];
    const [byName, comp, reach, exits, dwell] = await Promise.all([
      pool.query(
        `SELECT name, COUNT(*)::int AS count, COUNT(DISTINCT session)::int AS sessions
           FROM analytics_events
          WHERE received_at >= $1${pf} AND params->>'tale_id' = $2
            AND name IN ('tale_open', 'tale_page_view', 'tale_complete', 'tale_abandon')
          GROUP BY name`, args),
      pool.query(
        `SELECT ROUND(AVG((params->>'duration_ms')::numeric))::int AS avg_duration_ms,
                MAX((params->>'total_pages')::int) AS total_pages
           FROM analytics_events
          WHERE received_at >= $1${pf} AND name = 'tale_complete' AND params->>'tale_id' = $2`, args),
      pool.query(
        `SELECT (params->>'page_index')::int AS page, COUNT(DISTINCT session)::int AS sessions
           FROM analytics_events
          WHERE received_at >= $1${pf} AND name = 'tale_page_view'
            AND params->>'tale_id' = $2 AND params ? 'page_index'
          GROUP BY 1 ORDER BY 1`, args),
      pool.query(
        `SELECT (params->>'page_index')::int AS page, COUNT(*)::int AS exits
           FROM analytics_events
          WHERE received_at >= $1${pf} AND name = 'tale_abandon'
            AND params->>'tale_id' = $2 AND params ? 'page_index'
          GROUP BY 1 ORDER BY 1`, args),
      pool.query(
        `WITH pv AS (
           SELECT session, (params->>'page_index')::int AS page, client_ts,
                  LEAD(client_ts) OVER (PARTITION BY session ORDER BY client_ts) AS next_ts
             FROM analytics_events
            WHERE received_at >= $1${pf} AND name = 'tale_page_view'
              AND params->>'tale_id' = $2 AND params ? 'page_index'
         )
         SELECT page,
                ROUND(AVG(EXTRACT(EPOCH FROM (next_ts - client_ts)) * 1000))::int AS avg_dwell_ms,
                COUNT(*)::int AS samples
           FROM pv
          WHERE next_ts IS NOT NULL AND next_ts > client_ts
            AND next_ts - client_ts < interval '10 minutes'
          GROUP BY page ORDER BY page`, args),
    ]);

    const cn = {};
    byName.rows.forEach((r) => { cn[r.name] = r; });
    res.json({
      taleId,
      since,
      platform,
      totals: {
        opens: cn['tale_open'] ? cn['tale_open'].sessions : 0,
        completions: cn['tale_complete'] ? cn['tale_complete'].count : 0,
        abandons: cn['tale_abandon'] ? cn['tale_abandon'].count : 0,
        completionRate: (cn['tale_open'] && cn['tale_open'].sessions > 0)
          ? Math.round((cn['tale_complete'] ? cn['tale_complete'].count : 0) / cn['tale_open'].sessions * 100)
          : null,
        avgDurationMs: comp.rows[0].avg_duration_ms || null,
        totalPages: comp.rows[0].total_pages || null,
      },
      pageReach: reach.rows,
      exits: exits.rows,
      dwell: dwell.rows,
    });
  } catch (e) {
    console.error(`[ANALYTICS] tale insights error: ${e.message}`);
    res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/analytics/dashboard — human-readable view of the mirror ("что к чему").
// The HTML shell is public (contains no data); it asks for the admin key once,
// keeps it in localStorage, and calls /summary and /events with X-Admin-Key.
// This is the "site with clear logs" for verifying a build end-to-end.
router.get('/dashboard', (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8').send(dashboardHtml());
});

function dashboardHtml() {
  const glossary = Object.entries(MIRROR_EVENTS)
    .map(([n, m]) => `<tr><td><code>${n}</code></td><td>${m.ru}</td><td><code>${m.params}</code></td></tr>`)
    .join('');
  const knownJson = JSON.stringify(Object.keys(MIRROR_EVENTS));
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Аналитика — зеркало событий</title>
<style>
  :root { --bg:#0f172a; --card:#1e293b; --line:#334155; --txt:#e2e8f0; --dim:#94a3b8; --ok:#22c55e; --warn:#f59e0b; --bad:#ef4444; --accent:#3b82f6; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, sans-serif; margin: 0; background: var(--bg); color: var(--txt); }
  header { padding: 16px 20px; border-bottom: 1px solid var(--line); display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  h1 { font-size: 18px; margin: 0 12px 0 0; }
  main { padding: 20px; max-width: 1100px; margin: 0 auto; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 16px; margin-bottom: 18px; }
  .card h2 { font-size: 15px; margin: 0 0 12px; color: var(--dim); text-transform: uppercase; letter-spacing: .04em; }
  input, select, button { font: inherit; padding: 7px 10px; border-radius: 7px; border: 1px solid var(--line); background: #0b1220; color: var(--txt); }
  button { background: var(--accent); border-color: var(--accent); cursor: pointer; }
  button.ghost { background: transparent; }
  label { font-size: 13px; color: var(--dim); margin-right: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { color: var(--dim); font-weight: 600; }
  code { background: #0b1220; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
  .funnel { display: flex; gap: 10px; flex-wrap: wrap; align-items: stretch; }
  .step { flex: 1; min-width: 130px; background: #0b1220; border: 1px solid var(--line); border-radius: 8px; padding: 12px; }
  .step .n { font-size: 26px; font-weight: 700; }
  .step .l { font-size: 12px; color: var(--dim); }
  .step .pct { font-size: 12px; color: var(--ok); }
  .arrow { align-self: center; color: var(--dim); font-size: 20px; }
  .pill { display: inline-block; padding: 1px 7px; border-radius: 999px; font-size: 11px; }
  .pill.unknown { background: var(--bad); color: #fff; }
  .pill.known { background: #0b1220; color: var(--dim); }
  .muted { color: var(--dim); }
  .status { font-size: 13px; }
  .status.err { color: var(--bad); }
  pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 12px; color: #cbd5e1; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  @media (max-width: 720px) { .grid2 { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<header>
  <h1>📊 Зеркало аналитики</h1>
  <label>Admin key</label><input id="key" type="password" size="20" placeholder="X-Admin-Key">
  <label>Период</label>
  <select id="range">
    <option value="1">1 час</option>
    <option value="24" selected>24 часа</option>
    <option value="168">7 дней</option>
    <option value="720">30 дней</option>
  </select>
  <button id="load">Загрузить</button>
  <label><input type="checkbox" id="auto"> авто-обновление 10с</label>
  <span id="status" class="status muted"></span>
</header>
<main>
  <div class="card">
    <h2>Воронка монетизации</h2>
    <div id="funnelMoney" class="funnel muted">— загрузите данные —</div>
  </div>

  <div class="grid2">
    <div class="card">
      <h2>Счётчики по событиям</h2>
      <table><thead><tr><th>Событие</th><th>Кол-во</th><th>Последнее</th></tr></thead>
      <tbody id="summary"><tr><td class="muted" colspan="3">—</td></tr></tbody></table>
    </div>
    <div class="card">
      <h2>Дочитывания сказок</h2>
      <div id="reading" class="muted">—</div>
    </div>
  </div>

  <div class="card">
    <h2>Живой поток событий (что реально прислал клиент)</h2>
    <div style="margin-bottom:10px; display:flex; gap:8px; flex-wrap:wrap;">
      <input id="fName" placeholder="фильтр: name (напр. purchase_success)" size="24">
      <input id="fSession" placeholder="session" size="16">
      <input id="fUser" placeholder="userId" size="16">
      <button class="ghost" id="applyFilters">Фильтр</button>
    </div>
    <table><thead><tr><th>Получено</th><th>Событие</th><th>Платформа/верс.</th><th>User / session</th><th>params</th></tr></thead>
    <tbody id="events"><tr><td class="muted" colspan="5">—</td></tr></tbody></table>
  </div>

  <div class="card">
    <h2>Легенда: какие события шлёт клиент в зеркало</h2>
    <p class="muted" style="font-size:13px;margin-top:0">
      Только эти 8 имён идут в наш backend. Всё остальное (tale_open, tale_page_view, narration_* …) —
      только в Firebase GA4. Имя <span class="pill unknown">красным</span> в потоке = незнакомое (возможно опечатка в билде).
    </p>
    <table><thead><tr><th>Событие</th><th>Смысл</th><th>Параметры</th></tr></thead>
    <tbody>${glossary}</tbody></table>
  </div>
</main>
<script>
const KNOWN = new Set(${knownJson});
const $ = (id) => document.getElementById(id);
const key = $('key');
key.value = localStorage.getItem('adminKey') || '';
key.addEventListener('change', () => localStorage.setItem('adminKey', key.value.trim()));

function sinceIso() {
  const h = parseInt($('range').value, 10);
  return new Date(Date.now() - h * 3600 * 1000).toISOString();
}
async function api(path) {
  const r = await fetch(path, { headers: { 'X-Admin-Key': key.value.trim() } });
  if (r.status === 401) throw new Error('Неверный admin key (401)');
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
function fmtTime(t) {
  if (!t) return '—';
  const d = new Date(t);
  return d.toLocaleString('ru-RU', { hour12: false }).replace(',', '');
}
function setStatus(msg, err) {
  const s = $('status'); s.textContent = msg; s.className = 'status ' + (err ? 'err' : 'muted');
}

function renderSummary(events) {
  const map = {}; events.forEach(e => map[e.name] = e);
  $('summary').innerHTML = events.length
    ? events.map(e => \`<tr><td>\${KNOWN.has(e.name) ? '' : '<span class="pill unknown">?</span> '}<code>\${e.name}</code></td><td>\${e.count}</td><td class="muted">\${fmtTime(e.last_seen)}</td></tr>\`).join('')
    : '<tr><td class="muted" colspan="3">Пусто за период</td></tr>';
  // Reading
  const tc = map['tale_complete'];
  $('reading').innerHTML = tc
    ? \`<div class="step"><div class="n">\${tc.count}</div><div class="l">tale_complete — сказок дочитано до конца</div><div class="muted" style="margin-top:6px">последнее: \${fmtTime(tc.last_seen)}</div></div>\`
    : '<span class="muted">Ещё нет событий tale_complete за период.</span>';
  // Money funnel
  const n = (name) => (map[name] ? map[name].count : 0);
  const view = n('paywall_view'), start = n('purchase_start'), ok = n('purchase_success');
  const err = n('purchase_error'), rest = n('purchase_restore');
  const pct = (a, b) => (b > 0 ? Math.round(a / b * 100) + '%' : '—');
  $('funnelMoney').className = 'funnel';
  $('funnelMoney').innerHTML =
    step(view, 'paywall_view', '') +
    '<div class="arrow">→</div>' + step(start, 'purchase_start', pct(start, view) + ' от показов') +
    '<div class="arrow">→</div>' + step(ok, 'purchase_success', pct(ok, start) + ' от нажатий') +
    '<div class="arrow">·</div>' + step(err, 'purchase_error', 'ошибки/отмены', true) +
    step(rest, 'purchase_restore', 'восстановления', true);
}
function step(num, label, sub, dim) {
  return \`<div class="step"><div class="n" style="\${dim ? 'color:var(--dim)' : ''}">\${num}</div><div class="l">\${label}</div><div class="pct">\${sub}</div></div>\`;
}

function renderEvents(rows) {
  $('events').innerHTML = rows.length
    ? rows.map(e => {
        const unknown = !KNOWN.has(e.name);
        const params = e.params ? JSON.stringify(e.params, null, 0) : '—';
        return \`<tr>
          <td class="muted">\${fmtTime(e.received_at)}<br><span style="font-size:11px">client: \${fmtTime(e.client_ts)}</span></td>
          <td>\${unknown ? '<span class="pill unknown">?</span> ' : ''}<code>\${e.name}</code></td>
          <td>\${e.platform || '—'}<br><span class="muted">v\${e.app_version || '?'}</span></td>
          <td><span class="muted">\${e.user_id || 'anon'}</span><br><code>\${e.session || '—'}</code></td>
          <td><pre>\${params}</pre></td>
        </tr>\`;
      }).join('')
    : '<tr><td class="muted" colspan="5">Нет событий по фильтру за период.</td></tr>';
}

async function load() {
  if (!key.value.trim()) { setStatus('Введите admin key', true); return; }
  setStatus('Загрузка…');
  try {
    const since = encodeURIComponent(sinceIso());
    const [sum, ev] = await Promise.all([
      api('/api/analytics/summary?since=' + since),
      api('/api/analytics/events?limit=200&since=' + since +
          ($('fName').value.trim() ? '&name=' + encodeURIComponent($('fName').value.trim()) : '') +
          ($('fSession').value.trim() ? '&session=' + encodeURIComponent($('fSession').value.trim()) : '') +
          ($('fUser').value.trim() ? '&userId=' + encodeURIComponent($('fUser').value.trim()) : '')),
    ]);
    renderSummary(sum.events || []);
    renderEvents(ev || []);
    const total = (sum.events || []).reduce((a, e) => a + e.count, 0);
    setStatus('Обновлено ' + new Date().toLocaleTimeString('ru-RU', { hour12: false }) + ' · ' + total + ' событий за период');
  } catch (e) {
    setStatus(e.message, true);
  }
}

$('load').onclick = load;
$('applyFilters').onclick = load;
$('range').onchange = load;
let timer = null;
$('auto').onchange = (e) => {
  clearInterval(timer);
  if (e.target.checked) { timer = setInterval(load, 10000); load(); }
};
if (key.value.trim()) load();
</script>
</body>
</html>`;
}

module.exports = router;
module.exports.MIRROR_EVENTS = MIRROR_EVENTS;
