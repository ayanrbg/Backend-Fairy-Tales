/**
 * Analytics mirror smoke-test — проверяет весь путь события «клиент → сервер → читалка»
 * без сборки Unity-клиента. Шлёт синтетический батч ровно той формы, что описана в
 * SERVER_ANALYTICS_MIRROR_HANDOFF.md, затем читает его обратно по admin-ключу и
 * проверяет, что всё долетело. Печатает подробный PASS/FAIL — если что-то не так,
 * сразу видно, на каком шаге (приём / чтение / расхождение).
 *
 * Запуск:
 *   node scripts/analytics-smoketest.js
 *   node scripts/analytics-smoketest.js --base https://bala-stories.apiapp.kz:3000 --key <ADMIN_KEY>
 *
 * Переменные окружения (альтернатива флагам): ANALYTICS_BASE, ADMIN_KEY.
 * Без admin-ключа шлёт батч, но не может проверить чтение — так и скажет.
 * Флаг --insecure отключает проверку TLS (для локального self-signed).
 */
const axios = require('axios');
const https = require('https');
require('dotenv').config();

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const BASE = (arg('base', process.env.ANALYTICS_BASE) || 'https://bala-stories.apiapp.kz:3000').replace(/\/$/, '');
const KEY = arg('key', process.env.ADMIN_KEY) || '';
const INSECURE = process.argv.includes('--insecure');

const http = axios.create({
  baseURL: BASE,
  timeout: 15000,
  httpsAgent: INSECURE ? new https.Agent({ rejectUnauthorized: false }) : undefined,
  validateStatus: () => true,
});

const rnd = (n) => [...Array(n)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
const session = rnd(12);
const now = Date.now();

// Exactly the shape the client sends (handoff §"Тело запроса").
const batch = {
  session,
  platform: 'editor',
  appVersion: '0.0.0-smoketest',
  events: [
    { name: 'paywall_view',     ts: now,        params: { source: 'tale_locked' } },
    { name: 'purchase_start',   ts: now + 1000, params: { product_id: 'fairytales_yearly', source: 'tale_locked' } },
    { name: 'purchase_success', ts: now + 2000, params: { product_id: 'fairytales_yearly', price: 9.99, currency: 'USD', is_trial: true } },
  ],
};

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);

(async () => {
  console.log(`\nAnalytics mirror smoke-test`);
  console.log(`  base    : ${BASE}`);
  console.log(`  session : ${session}  (уникальный маркер этого прогона)`);
  console.log(`  key     : ${KEY ? 'задан' : 'НЕ задан — чтение пропустим'}\n`);

  // 1) Ingest
  let sent;
  try {
    sent = await http.post('/api/analytics/event', batch, { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    bad(`POST /api/analytics/event упал: ${e.message}`);
    console.log(`\n→ Сервер недоступен или TLS. Проверь base/сеть (для self-signed добавь --insecure).\n`);
    process.exit(1);
  }
  if (sent.status === 200) ok(`POST /api/analytics/event → 200 (fire-and-forget, отправлено 3 события)`);
  else { bad(`POST /api/analytics/event → ${sent.status} (ожидали 200)`); process.exit(1); }

  if (!KEY) {
    console.log(`\n  Admin-ключ не задан — не могу прочитать события обратно.`);
    console.log(`  Проверь вручную на дашборде: ${BASE}/api/analytics/dashboard (session=${session})`);
    console.log(`  или запусти с --key <ADMIN_KEY>.\n`);
    process.exit(0);
  }

  // 2) Read back by session
  let read;
  try {
    read = await http.get(`/api/analytics/events?session=${session}&limit=50`, { headers: { 'X-Admin-Key': KEY } });
  } catch (e) {
    bad(`GET /api/analytics/events упал: ${e.message}`); process.exit(1);
  }
  if (read.status === 401) { bad(`GET /events → 401: неверный admin key`); process.exit(1); }
  if (read.status !== 200) { bad(`GET /events → ${read.status}`); process.exit(1); }
  ok(`GET /api/analytics/events?session=… → 200`);

  const rows = Array.isArray(read.data) ? read.data : [];
  const got = new Set(rows.map((r) => r.name));
  let allGood = true;
  for (const e of batch.events) {
    if (got.has(e.name)) ok(`долетело: ${e.name}`);
    else { bad(`НЕ найдено: ${e.name}`); allGood = false; }
  }

  // 3) Params integrity spot-check
  const ps = rows.find((r) => r.name === 'purchase_success');
  if (ps && ps.params && ps.params.product_id === 'fairytales_yearly' && ps.params.is_trial === true) {
    ok(`params сохранены корректно (purchase_success.product_id / is_trial)`);
  } else { bad(`params у purchase_success потерялись/исказились: ${JSON.stringify(ps && ps.params)}`); allGood = false; }

  console.log('');
  if (allGood && rows.length >= 3) {
    console.log(`\x1b[32mPASS\x1b[0m — зеркало аналитики работает end-to-end. Смотри на дашборде:`);
    console.log(`  ${BASE}/api/analytics/dashboard  (фильтр session=${session})\n`);
    process.exit(0);
  } else {
    console.log(`\x1b[31mFAIL\x1b[0m — приём есть, но что-то не сошлось при чтении (см. ✗ выше).\n`);
    process.exit(1);
  }
})();
