'use strict';

// The full check's real run of what Capri fetches and runs for her ears and her voice, with Capri's own code (src/main/voice):
// whisper.cpp and a small model are fetched into a temporary folder, its server is started and asked to recognise speech that
// Windows' own voices made (Russian and English), then Piper and a voice are fetched, made to speak, and what they said is
// recognised again. About 200 MB come down; all of it is taken off at the end (unless --keep).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { exec, psFile, WIN } = require('./proc');
const wav = require('./wav');

const EN = { say: 'Hello Capri, how are you today? Please open the browser.', words: ['hello', 'today', 'browser'], lang: 'en' };
const RU = { say: 'Привет, Капри. Открой браузер и включи музыку.', words: ['привет', 'браузер', 'музык'], lang: 'ru' };
const SAY_EN = { say: 'Hello, this is a test of the voice. The weather is good today.', words: ['hello', 'test', 'weather'], lang: 'en' };
const SAY_RU = { say: 'Привет, это проверка голоса. Сегодня хорошая погода.', words: ['привет', 'проверк', 'погод'], lang: 'ru' };

const norm = (t) => String(t).toLowerCase().replace(/ё/g, 'е');
const matched = (heard, words) => words.filter((w) => norm(heard).includes(w));
const mb = (n) => `${Math.round(n / 1048576)} МБ`;

function progress(ctx, label) {
  let shown = -1;
  return ({ completed, total }) => {
    if (!total) return;
    const pct = Math.floor((completed / total) * 100 / 25) * 25;
    if (pct !== shown && pct > 0) {
      shown = pct;
      ctx.say(`      ${label}: ${pct}% (${mb(completed)} из ${mb(total)})`);
    }
  };
}

async function speech(ctx, dir, item, name) {
  const out = path.join(dir, `${name}.wav`);
  const r = await psFile(path.join(ctx.kit, 'windows', 'sapi.ps1'), [out, Buffer.from(item.say, 'utf8').toString('base64'), item.lang], { timeout: 60000 });
  if (/NOVOICE/.test(r.out)) return null;
  if (r.code !== 0 || !fs.existsSync(out)) throw new Error((r.err || r.out || 'голос Windows не сработал').trim().slice(0, 300));
  return fs.readFileSync(out);
}

async function ears(ctx, base, lib) {
  const { Whisper, TIERS } = lib.whisper;
  const dir = path.join(base, 'whisper');
  const w = new Whisper({ roots: () => [], defaultDir: () => dir, is64: lib.hardware.systemIs64() });
  const t0 = Date.now();
  let loc;
  try {
    loc = await w.install({ onProgress: progress(ctx, 'программа') });
  } catch (err) {
    ctx.add('real', 'Распознавание речи: установка программы whisper.cpp', 'fail', String(err.message || err).slice(0, 500));
    return null;
  }
  ctx.add('real', 'Распознавание речи: программа скачана и распакована', 'pass', `${path.basename(loc.exe)}, ${((Date.now() - t0) / 1000).toFixed(1)} с`);
  await new Promise((r) => setTimeout(r, lib.settleMs === undefined ? 3000 : lib.settleMs)); // (an antivirus that takes it away does so a moment after it appears)
  if (!fs.existsSync(loc.exe)) {
    ctx.add('real', 'Распознавание речи: программа исчезла после распаковки', 'fail', 'файл удалён сразу после распаковки: это почти наверняка антивирус (Защитник Windows или другой)');
    return null;
  }
  const help = await exec(loc.exe, ['--help'], { cwd: path.dirname(loc.exe), timeout: 20000 });
  ctx.write('logs/whisper-server-help.txt', `exit code: ${help.code}${help.error ? ` (${help.error})` : ''}\n\n${help.out}\n${help.err}`);
  if (help.code === null || (help.code !== 0 && help.code !== 1 && !/usage|--port|--host/i.test(help.out + help.err))) {
    ctx.add('real', 'Распознавание речи: программа запускается', 'fail', `код выхода ${help.code}${help.code === 3221225781 ? ' (нет Visual C++ Redistributable)' : help.code === 3221225501 ? ' (процессор без нужных инструкций)' : ''}`);
    return null;
  }
  const flags = ['--port', '--host', '-m', '-t', '-l'].filter((f) => !new RegExp(`(^|\\s|,)${f}(\\s|,|=|$)`, 'm').test(help.out + help.err));
  ctx.add('real', 'Распознавание речи: программа запускается, флаги сервера на месте', flags.length ? 'warn' : 'pass', flags.length ? `в справке не нашлись флаги: ${flags.join(' ')} (Капри передаёт их серверу)` : 'справка перечисляет --host, --port, -m, -t, -l');

  const tier = 'base';
  const t1 = Date.now();
  try {
    await w.fetchModel({}, tier, { onProgress: progress(ctx, 'модель') });
  } catch (err) {
    ctx.add('real', 'Распознавание речи: модель', 'fail', String(err.message || err).slice(0, 400));
    return null;
  }
  ctx.add('real', 'Распознавание речи: модель скачана', 'pass', `${TIERS[tier].file}, ${((Date.now() - t1) / 1000).toFixed(1)} с`);

  const t2 = Date.now();
  try {
    await w.check({});
  } catch (err) {
    ctx.write('logs/whisper-server.log', `${err.message}\n\n${w.status().log.join('\n')}`);
    ctx.add('real', 'Распознавание речи: сервер запускается и отвечает', 'fail', `${String(err.message || err).slice(0, 300)}`, { log: 'logs/whisper-server.log' });
    return null;
  }
  ctx.add('real', 'Распознавание речи: сервер запускается и отвечает', 'pass', `загрузка модели и первый ответ: ${((Date.now() - t2) / 1000).toFixed(1)} с`);

  // speech made by Windows, recognised by it
  const wavs = path.join(base, 'wavs');
  fs.mkdirSync(wavs, { recursive: true });
  let anyVoice = false;
  for (const item of [EN, RU]) {
    try {
      const audio = await (lib.speech || speech)(ctx, wavs, item, `sapi-${item.lang}`);
      if (!audio) {
        ctx.add('real', `Распознавание речи (${item.lang}): голоса Windows для проверки нет`, 'skip', 'в системе нет голоса этого языка (Параметры → Время и язык → Голос)');
        continue;
      }
      anyVoice = true;
      const t = Date.now();
      const heard = await lib.stt.transcribe({ sttEngine: 'local' }, {}, { audio, mime: 'audio/wav', lang: item.lang }, { whisper: w });
      const hit = matched(heard, item.words);
      ctx.add('real', `Распознавание речи (${item.lang === 'ru' ? 'русский' : 'английский'})`, hit.length >= 2 ? 'pass' : 'fail',
        `сказано «${item.say}», услышано «${String(heard).trim().slice(0, 120)}» (${hit.length}/${item.words.length} слов, ${((Date.now() - t) / 1000).toFixed(1)} с)`);
    } catch (err) {
      ctx.add('real', `Распознавание речи (${item.lang})`, 'fail', String(err.message || err).slice(0, 400));
    }
  }
  if (!anyVoice) ctx.add('real', 'Распознавание живой речи', 'skip', 'без голосов Windows нечем проверить, понимает ли оно слова (микрофон проверяется отдельно, в приложении)');
  return w;
}

async function voice(ctx, base, lib, w) {
  const { Piper } = lib.piper;
  const dir = path.join(base, 'piper');
  const p = new Piper({ roots: () => [], defaultDir: () => dir, is64: lib.hardware.systemIs64() });
  const t0 = Date.now();
  try {
    await p.install({ onProgress: progress(ctx, 'Piper') });
  } catch (err) {
    ctx.add('real', 'Голос Piper: установка программы', 'fail', String(err.message || err).slice(0, 500));
    return;
  }
  ctx.add('real', 'Голос Piper: программа скачана и распакована', 'pass', `${((Date.now() - t0) / 1000).toFixed(1)} с`);
  for (const item of [SAY_EN, SAY_RU]) {
    const label = item.lang === 'ru' ? 'русский' : 'английский';
    try {
      const t = Date.now();
      await p.fetchVoice({}, item.lang, { onProgress: progress(ctx, `голос ${item.lang}`) });
      const audio = await p.speak({}, { text: item.say, lang: item.lang });
      const info = wav.read(audio);
      const seconds = info.samples.length / info.rate;
      const loud = wav.peak(audio);
      if (seconds < 0.8 || loud < 0.02) {
        ctx.add('real', `Голос Piper (${label})`, 'fail', `получилась тишина или обрывок: ${seconds.toFixed(1)} с, громкость ${loud.toFixed(3)}`);
        continue;
      }
      let heard = '';
      let verdict = '';
      if (w) {
        heard = await lib.stt.transcribe({ sttEngine: 'local' }, {}, { audio: wav.to16k(audio), mime: 'audio/wav', lang: item.lang }, { whisper: w });
        const hit = matched(heard, item.words);
        verdict = `; её же ушами услышано «${String(heard).trim().slice(0, 100)}» (${hit.length}/${item.words.length})`;
        ctx.add('real', `Голос Piper (${label}) говорит и его понимают`, hit.length >= 2 ? 'pass' : 'warn', `речь ${seconds.toFixed(1)} с${verdict}, ${((Date.now() - t) / 1000).toFixed(1)} с вместе с загрузкой голоса`);
      } else {
        ctx.add('real', `Голос Piper (${label}) говорит`, 'pass', `речь ${seconds.toFixed(1)} с, громкость ${loud.toFixed(2)}`);
      }
    } catch (err) {
      ctx.write('logs/piper.log', `${err.message}\n\n${p.status().log.join('\n')}`);
      ctx.add('real', `Голос Piper (${label})`, 'fail', String(err.message || err).slice(0, 400), { log: 'logs/piper.log' });
    }
  }
  p.stop(false);
}

async function run(ctx) {
  if (!ctx.full || !ctx.wants('real')) {
    ctx.add('real', 'Настоящая установка распознавания речи и голоса', 'skip', 'это в полной проверке (качает около 200 МБ и удаляет)');
    return;
  }
  if (!WIN) {
    ctx.add('real', 'Настоящая установка распознавания речи и голоса', 'skip', 'Капри ставит whisper.cpp и Piper только на Windows');
    return;
  }
  if (!ctx.source) return;
  const src = (rel) => require(path.join(ctx.source, 'src', 'main', rel));
  const lib = { whisper: src('voice/whisper.js'), piper: src('voice/piper.js'), stt: src('voice/stt.js'), hardware: src('setup/hardware.js') };
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-check-'));
  ctx.say(`  временная папка: ${base}`);
  let w = null;
  // (if this part is given up on as stuck: the programs it started are ended, what it fetched taken off)
  ctx.onAbort = async () => {
    try {
      w && w.stop(false);
    } catch {
      // not running
    }
    if (!ctx.opts.keep) fs.rmSync(base, { recursive: true, force: true });
  };
  try {
    w = await ears(ctx, base, lib);
    await voice(ctx, base, lib, w);
  } finally {
    try {
      w && w.stop(false);
    } catch {
      // not running
    }
    if (ctx.opts.keep) ctx.say(`  скачанное оставлено в ${base}`);
    else {
      await new Promise((r) => setTimeout(r, 1500)); // (the programs let go of their files)
      try {
        fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
      } catch (err) {
        ctx.add('real', 'Временная папка не удалилась', 'warn', `${base}: ${err.message}`);
      }
    }
  }
}

module.exports = { run, ears, voice };
