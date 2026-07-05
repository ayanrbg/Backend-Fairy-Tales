/**
 * Edge TTS playground — локальная песочница для подбора голоса/prosody.
 *
 * Запуск:   node scripts/tts-playground.js
 * Открыть:  http://localhost:5055
 *
 * Ползунками крутишь скорость/высоту/громкость, слушаешь в реальном времени,
 * внизу страница показывает готовые строки для .env с выбранными числами.
 * Отдельный сервер (порт 5055), с основным приложением не конфликтует.
 */
const http = require('http');
const { EdgeTTS } = require('@andresaya/edge-tts');

const PORT = process.env.TTS_PLAYGROUND_PORT || 5055;

// Локаль-префикс для отбора родных голосов по языку приложения.
const LOCALE = { ru: 'ru-RU', uz: 'uz-UZ', kz: 'kk-KZ', en: 'en-' };

// Кэш списка голосов Edge (грузится один раз с сервиса MS).
let _voicesCache = null;
async function allVoices() {
  if (!_voicesCache) _voicesCache = await new EdgeTTS().getVoices();
  return _voicesCache;
}

const SAMPLE = {
  ru: 'Жили-были дед да баба, и была у них курочка Ряба. Снесла курочка яичко, да не простое, а золотое.',
  uz: 'Bir bor ekan, bir yoʻq ekan, qadim zamonda bir chol bilan kampir bor ekan.',
  kz: 'Ерте-ерте, ертеде бір шал мен кемпір болыпты. Олардың Айгүл деген қыздары болыпты.',
  en: 'Once upon a time, in a land far away, there lived a little girl who loved fairy tales.',
};

const PAGE = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Edge TTS — песочница</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 720px; margin: 32px auto; padding: 0 16px; color: #1a1a1a; }
  h1 { font-size: 20px; }
  label { display: block; margin: 14px 0 4px; font-weight: 600; font-size: 14px; }
  select, textarea { width: 100%; padding: 8px; font-size: 15px; box-sizing: border-box; }
  textarea { height: 90px; resize: vertical; }
  .row { display: flex; gap: 20px; }
  .row > div { flex: 1; }
  .slider { display: flex; align-items: center; gap: 10px; }
  input[type=range] { flex: 1; }
  .val { min-width: 64px; text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
  button { margin-top: 18px; padding: 10px 20px; font-size: 15px; cursor: pointer; border: 0; border-radius: 6px; background: #2563eb; color: #fff; }
  button:disabled { opacity: .5; cursor: default; }
  pre { background: #f3f4f6; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 13px; }
  .hint { color: #6b7280; font-size: 13px; margin-top: 4px; }
  #status { margin-left: 12px; font-size: 14px; color: #6b7280; }
</style>
</head>
<body>
  <h1>🎙️ Edge TTS — подбор голоса</h1>

  <div class="row">
    <div>
      <label>Язык</label>
      <select id="lang">
        <option value="ru">Русский</option>
        <option value="uz">Oʻzbek</option>
        <option value="kz">Қазақша</option>
        <option value="en">English</option>
      </select>
    </div>
    <div>
      <label>Голос</label>
      <select id="voice"></select>
    </div>
  </div>
  <div class="hint">Родные голоса ru/uz/kz — по 2 штуки. «Мультиязычные» тоже умеют читать эти языки и часто звучат живее — пробуй их.</div>

  <label>Текст</label>
  <textarea id="text"></textarea>

  <label>Скорость (rate) — отрицательное = медленнее</label>
  <div class="slider"><input type="range" id="rate" min="-50" max="50" step="1" value="-8"><span class="val" id="rateV"></span></div>

  <label>Высота (pitch) — отрицательное = ниже/теплее</label>
  <div class="slider"><input type="range" id="pitch" min="-20" max="20" step="1" value="-2"><span class="val" id="pitchV"></span></div>

  <label>Громкость (volume)</label>
  <div class="slider"><input type="range" id="volume" min="-50" max="50" step="1" value="0"><span class="val" id="volumeV"></span></div>

  <button id="play">▶ Прослушать</button>
  <span id="status"></span>

  <audio id="audio" controls style="width:100%; margin-top:16px; display:none"></audio>

  <label style="margin-top:24px">Строки для .env (скопируй нужные числа на прод):</label>
  <pre id="env"></pre>
  <div class="hint">После правки .env на сервере: <code>pm2 restart fairy-backend</code></div>

<script>
  const $ = id => document.getElementById(id);
  const samples = ${JSON.stringify(SAMPLE)};

  function syncLabels() {
    $('rateV').textContent = ($('rate').value >= 0 ? '+' : '') + $('rate').value + '%';
    $('pitchV').textContent = ($('pitch').value >= 0 ? '+' : '') + $('pitch').value + 'Hz';
    $('volumeV').textContent = ($('volume').value >= 0 ? '+' : '') + $('volume').value + '%';
    $('env').textContent =
      'TTS_RATE=' + $('rate').value + '\\n' +
      'TTS_PITCH=' + $('pitch').value + '\\n' +
      'TTS_VOLUME=' + $('volume').value;
  }

  async function loadVoices() {
    const lang = $('lang').value;
    $('text').value = samples[lang];
    const sel = $('voice');
    sel.innerHTML = '<option>загрузка…</option>';
    try {
      const data = await (await fetch('/voices?lang=' + lang)).json();
      sel.innerHTML = '';
      const group = (title, list) => {
        if (!list.length) return;
        const og = document.createElement('optgroup');
        og.label = title;
        list.forEach(v => {
          const o = document.createElement('option');
          o.value = v.ShortName;
          o.textContent = v.ShortName + ' (' + (v.Gender === 'Male' ? 'муж' : 'жен') + ')';
          og.appendChild(o);
        });
        sel.appendChild(og);
      };
      group('Родные', data.native);
      group('Мультиязычные', data.multilingual);
    } catch (e) {
      sel.innerHTML = '<option>ошибка загрузки</option>';
    }
  }

  ['rate','pitch','volume'].forEach(id => $(id).addEventListener('input', syncLabels));
  $('lang').addEventListener('change', loadVoices);
  syncLabels();
  loadVoices();

  $('play').addEventListener('click', async () => {
    const btn = $('play');
    btn.disabled = true;
    $('status').textContent = 'Генерирую…';
    try {
      const params = new URLSearchParams({
        voice: $('voice').value,
        rate: $('rate').value, pitch: $('pitch').value, volume: $('volume').value,
        text: $('text').value,
      });
      const res = await fetch('/tts?' + params.toString());
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const audio = $('audio');
      audio.src = URL.createObjectURL(blob);
      audio.style.display = 'block';
      audio.play();
      $('status').textContent = 'Готово ✓';
    } catch (e) {
      $('status').textContent = 'Ошибка: ' + e.message;
    } finally {
      btn.disabled = false;
    }
  });
</script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(PAGE);
  }

  if (url.pathname === '/voices') {
    const lang = url.searchParams.get('lang') || 'ru';
    const prefix = LOCALE[lang] || 'ru-RU';
    try {
      const voices = await allVoices();
      const native = voices.filter(v => v.Locale.startsWith(prefix));
      const multilingual = voices.filter(v => /Multilingual/i.test(v.ShortName));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ native, multilingual }));
    } catch (e) {
      res.writeHead(500); return res.end('voices error: ' + e.message);
    }
  }

  if (url.pathname === '/tts') {
    const q = url.searchParams;
    const text = (q.get('text') || '').trim();
    const voice = q.get('voice');
    if (!text) { res.writeHead(400); return res.end('Пустой текст'); }
    if (!voice) { res.writeHead(400); return res.end('Не выбран голос'); }

    const num = (v, d) => (v === null || v === '' || isNaN(Number(v)) ? d : Number(v));
    try {
      const tts = new EdgeTTS();
      await tts.synthesize(text, voice, {
        rate: num(q.get('rate'), 0),
        pitch: num(q.get('pitch'), 0),
        volume: num(q.get('volume'), 0),
      });
      const buf = tts.toBuffer();
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': buf.length });
      return res.end(buf);
    } catch (e) {
      res.writeHead(500);
      return res.end('TTS error: ' + e.message);
    }
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`🎙️  Edge TTS playground: http://localhost:${PORT}`);
  console.log('   Ctrl+C — остановить');
});
