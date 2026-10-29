'use strict';

// Whether the places Capri fetches things from can be reached from this PC, and how fast. Not a download: each address is asked for
// its first byte only (a ranged GET, because some of the file servers refuse a HEAD). The addresses are the ones in Capri's own code.

const path = require('node:path');

const TIMEOUT = 15000;

// why a connection failed, in words
const WHY = {
  ENOTFOUND: 'адрес не находится (DNS: сайт заблокирован или нет интернета)',
  EAI_AGAIN: 'DNS не отвечает',
  ECONNRESET: 'соединение сброшено (часто это блокировка сайта провайдером или антивирус)',
  ECONNREFUSED: 'соединение отклонено',
  ETIMEDOUT: 'не отвечает (таймаут)',
  UND_ERR_CONNECT_TIMEOUT: 'не отвечает (таймаут)',
  UND_ERR_HEADERS_TIMEOUT: 'не отвечает (таймаут)',
  CERT_HAS_EXPIRED: 'сертификат просрочен (проверьте дату и время на компьютере)',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'сертификат не проверяется (антивирус или фильтр сети подменяет HTTPS)',
  SELF_SIGNED_CERT_IN_CHAIN: 'сертификат подменён (антивирус или фильтр сети перехватывает HTTPS)',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'сертификат подменён (антивирус или фильтр сети перехватывает HTTPS)',
  ERR_TLS_CERT_ALTNAME_INVALID: 'сертификат не от этого сайта (перехват HTTPS)',
};

function explain(err) {
  const code = (err && err.cause && err.cause.code) || (err && err.code) || '';
  if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) return { code: 'TIMEOUT', why: `не ответил за ${TIMEOUT / 1000} с` };
  return { code: code || 'ERROR', why: WHY[code] || String((err && err.cause && err.cause.message) || (err && err.message) || err).slice(0, 160) };
}

// the addresses: [id, title, url, how important ('need' | 'cloud' | 'extra'), options]
function targets(source) {
  const load = (rel) => {
    try {
      return require(path.join(source, 'src', 'main', rel));
    } catch {
      return {};
    }
  };
  const whisper = load('voice/whisper.js');
  const piper = load('voice/piper.js');
  const rel = whisper.RELEASES || 'https://github.com/ggml-org/whisper.cpp/releases/download';
  const version = (whisper.VERSIONS || ['v1.7.6'])[0];
  const asset = (whisper.ASSETS || {})['win32-x64'] || 'whisper-bin-x64.zip';
  const models = whisper.MODELS || 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';
  const files = Object.values(whisper.TIERS || {}).map((t) => t.file);
  const piperRelease = piper.RELEASE || 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2';
  const piperAsset = (piper.ASSETS || {})['win32-x64'] || 'piper_windows_amd64.zip';
  const voices = piper.VOICES || 'https://huggingface.co/rhasspy/piper-voices/resolve/main';
  const list = [
    ['github', 'GitHub (сюда ходит установка)', 'https://github.com', 'need'],
    ['whisper-zip', `Распознавание речи: программа whisper.cpp ${version}`, `${rel}/${version}/${asset}`, 'need', { range: true }],
    ['whisper-api', 'Распознавание речи: список выпусков (запасной путь)', whisper.API_LATEST || 'https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest', 'cloud'],
    ...(files.length ? files : ['ggml-base-q5_1.bin']).map((f) => [`whisper-model-${f}`, `Распознавание речи: модель ${f}`, `${models}/${f}`, 'need', { range: true }]),
    ['piper-zip', 'Голос Piper: программа', `${piperRelease}/${piperAsset}`, 'need', { range: true }],
    ['piper-voices', 'Голос Piper: список голосов', `${voices}/voices.json`, 'need'],
    ['ollama-site', 'Ollama: сайт', 'https://ollama.com/download/OllamaSetup.exe', 'need', { range: true }],
    ['ollama-github', 'Ollama: запасной путь (GitHub)', 'https://github.com/ollama/ollama/releases/latest/download/ollama-windows-amd64.zip', 'extra', { range: true }],
    ['ollama-registry', 'Ollama: склад моделей', 'https://registry.ollama.ai/v2/library/gemma3/manifests/1b', 'need', { accept: 'application/vnd.docker.distribution.manifest.v2+json' }],
    ['node', 'Node.js (сайт)', 'https://nodejs.org/dist/index.json', 'extra'],
    ['pypi', 'Python-пакеты (PyPI), нужны голосу Chatterbox', 'https://pypi.org/simple/pip/', 'extra'],
    ['pytorch', 'PyTorch (для Chatterbox)', 'https://download.pytorch.org/whl/cpu/', 'extra'],
    ['hf-hub', 'Hugging Face (модель голоса Chatterbox)', 'https://huggingface.co/ResembleAI/chatterbox/resolve/main/conds.pt', 'extra', { range: true }],
    ['anthropic', 'Облако: Claude (api.anthropic.com)', 'https://api.anthropic.com/v1/models', 'cloud'],
    ['openai', 'Облако: OpenAI', 'https://api.openai.com/v1/models', 'cloud'],
    ['groq', 'Облако: Groq (бесплатное распознавание речи)', 'https://api.groq.com/openai/v1/models', 'cloud'],
    ['gemini', 'Облако: Google Gemini', 'https://generativelanguage.googleapis.com/v1beta/openai/models', 'cloud'],
    ['openrouter', 'Облако: OpenRouter', 'https://openrouter.ai/api/v1/models', 'cloud'],
    ['pollinations', 'Облако: Pollinations (без ключа)', 'https://text.pollinations.ai/models', 'cloud'],
  ];
  return list.map(([id, title, url, level, options = {}]) => ({ id, title, url, level, ...options }));
}

async function probe(t, fetchFn = fetch) {
  const started = Date.now();
  const headers = { 'user-agent': 'Capri-check', accept: t.accept || '*/*' };
  if (t.range) headers.range = 'bytes=0-0';
  try {
    const res = await fetchFn(t.url, { method: 'GET', headers, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT) });
    const size = Number((/\/(\d+)$/.exec(res.headers.get('content-range') || '') || [])[1]) || Number(res.headers.get('content-length')) || 0;
    const final = new URL(res.url || t.url).host;
    const date = res.headers.get('date');
    try {
      await res.body.cancel();
    } catch {
      // already read
    }
    return { status: res.status, ms: Date.now() - started, size, host: final, date };
  } catch (err) {
    return { status: 0, ms: Date.now() - started, ...explain(err) };
  }
}

// bytes per second of the first megabytes of a file, for "how long will the download take"
async function speed(url, fetchFn = fetch) {
  const started = Date.now();
  try {
    const res = await fetchFn(url, { headers: { range: 'bytes=0-4194303', 'user-agent': 'Capri-check' }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const secs = Math.max(0.05, (Date.now() - started) / 1000);
    return { bytes: buf.byteLength, mbps: Math.round((buf.byteLength / secs / 1048576) * 10) / 10 };
  } catch {
    return null;
  }
}

async function run(ctx) {
  if (typeof fetch !== 'function') {
    ctx.add('network', 'Сеть', 'skip', 'в этом Node нет fetch (нужен Node 18 или новее)');
    return;
  }
  const list = targets(ctx.source || '');
  const found = [];
  const queue = list.slice();
  const worker = async () => {
    for (let t = queue.shift(); t; t = queue.shift()) found.push({ ...t, ...(await probe(t)) });
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  const order = new Map(list.map((t, i) => [t.id, i]));
  found.sort((a, b) => order.get(a.id) - order.get(b.id));
  ctx.facts.network = found.map(({ id, title, url, level, status, ms, size, host, code, why }) => ({ id, title, url, level, status, ms, size, host, code, why }));

  // (no address answering at all is no internet, or a firewall in front of all of it)
  if (!found.some((f) => f.status > 0)) {
    ctx.add('network', 'Интернета нет', 'fail', `ни один адрес не ответил: ${found[0].why}. Остальное записано в отчёт.`);
  }
  for (const f of found) {
    const ok = f.status > 0 && f.status < 400;
    const reachable = f.status > 0 && f.status < 500; // (401, 403, 405: the service is there and wants a key)
    const good = f.level === 'cloud' ? reachable : ok;
    const where = f.host ? ` → ${f.host}` : '';
    const sized = f.size ? `, ${Math.round(f.size / 1048576)} МБ` : '';
    if (good) ctx.add('network', f.title, 'pass', `${f.status}${where}${sized}, ${f.ms} мс`);
    else if (!f.status) ctx.add('network', f.title, f.level === 'need' ? 'fail' : 'warn', `${f.why}`, { url: f.url, code: f.code });
    else ctx.add('network', f.title, f.level === 'need' ? 'fail' : 'warn', `ответ ${f.status}${where}`, { url: f.url });
  }

  // the clock: a TLS check fails when it is far off, and a model dated in the future never "arrives"
  const dated = found.find((f) => f.date);
  if (dated) {
    const skew = Math.round((Date.parse(dated.date) - Date.now()) / 60000);
    ctx.facts.clockSkewMinutes = skew;
    if (Math.abs(skew) > 5) ctx.add('network', 'Часы компьютера идут неправильно', 'warn', `расходятся с интернетом на ${Math.abs(skew)} мин: из-за этого HTTPS может не работать`);
  }

  // the voice model comes from the model hub, whose speed may be nothing like GitHub's
  const hub = found.find((f) => f.id === 'hf-hub');
  if (hub && hub.status > 0 && hub.status < 400) {
    const s = await speed('https://huggingface.co/ResembleAI/chatterbox/resolve/main/t3_cfg.safetensors');
    if (s) {
      ctx.facts.hubSpeedMBps = s.mbps;
      const minutes = Math.round(3200 / Math.max(s.mbps, 0.1) / 60);
      ctx.add('network', 'Скорость с Hugging Face (модель голоса ~3,2 ГБ)', minutes > 25 ? 'warn' : 'info', `${s.mbps} МБ/с: модель скачается примерно за ${minutes} мин`);
    }
  }

  const zip = found.find((f) => f.id === 'whisper-zip');
  if (zip && zip.status > 0 && zip.status < 400) {
    const s = await speed(zip.url);
    if (s) {
      ctx.facts.downloadSpeedMBps = s.mbps;
      ctx.add('network', 'Скорость скачивания', 'info', `${s.mbps} МБ/с: набор в 3–5 ГБ скачается примерно за ${Math.max(1, Math.round(4000 / Math.max(s.mbps, 0.1) / 60))} мин`);
    }
  }
}

module.exports = { run, targets, probe, explain, speed };
