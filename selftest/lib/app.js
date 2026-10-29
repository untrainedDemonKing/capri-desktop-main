'use strict';

// The installed Capri itself: started with --selftest in a data folder of its own (it reads nothing of yours and starts nothing), it
// looks at herself for half a minute (src/main/system/selftest.js), and what she found is read back here. If her window comes out
// empty or black, she is tried again with the other ways of drawing (her menu › Display) to find the one that works on this PC.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { exec, WIN, killTree } = require('./proc');
const { spawn } = require('node:child_process');

// where the installer puts her, and the other places she may be
async function findCapri(ctx) {
  const want = ctx.opts.capri || process.env.CAPRI_EXE;
  if (want) return fs.existsSync(want) ? { exe: want, how: 'указана вручную' } : null;
  const env = process.env;
  const names = WIN ? ['Capri.exe'] : process.platform === 'darwin' ? ['Capri.app/Contents/MacOS/Capri'] : ['capri', 'Capri'];
  const dirs = [];
  if (WIN) {
    for (const base of [env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs'), env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432, env.USERPROFILE && path.join(env.USERPROFILE, 'Desktop')].filter(Boolean)) {
      for (const sub of ['Capri', 'capri-desktop', 'Capri Desktop']) dirs.push(path.join(base, sub));
    }
    // what the installer wrote down
    for (const hive of ['HKCU', 'HKLM']) {
      for (const key of ['capri.desktop', 'Capri']) {
        const r = await exec('reg', ['query', `${hive}\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${key}`, '/v', 'InstallLocation'], { timeout: 6000 });
        const m = /InstallLocation\s+REG_SZ\s+(.+)/.exec(r.out);
        if (m) dirs.unshift(m[1].trim());
      }
    }
  } else {
    dirs.push('/Applications', '/opt/Capri', '/opt/capri', path.join(os.homedir(), 'Applications'), path.join(os.homedir(), 'Capri'));
  }
  // next to the check, and the build of a copy of the project
  dirs.push(path.join(ctx.kit, 'Capri'), path.join(ctx.kit, '..', 'Capri'));
  if (ctx.source) dirs.push(path.join(ctx.source, 'dist', 'win-unpacked'), path.join(ctx.source, 'dist', 'linux-unpacked'));
  for (const d of dirs) {
    for (const n of names) {
      const exe = path.join(d, n);
      if (fs.existsSync(exe)) return { exe, how: 'найдена' };
    }
  }
  // a copy of the project with Electron installed: run from sources
  if (ctx.source) {
    const electron = path.join(ctx.source, 'node_modules', '.bin', WIN ? 'electron.cmd' : 'electron');
    if (fs.existsSync(electron)) return { exe: electron, how: 'из исходников (electron)', args: [ctx.source] };
  }
  return null;
}

// one run of her in a folder of its own; resolves what she wrote, and how she ended
async function runOnce(ctx, found, name, extra) {
  const dir = ctx.path(`app/${name}`);
  fs.mkdirSync(dir, { recursive: true });
  const args = [...(found.args || []), `--selftest=${dir}`, ...extra, '--enable-logging', `--log-file=${path.join(dir, 'chromium.log')}`];
  if (process.platform === 'linux' && process.getuid && process.getuid() === 0) args.unshift('--no-sandbox');
  const env = { ...process.env, ELECTRON_ENABLE_LOGGING: '1' };
  delete env.ELECTRON_RUN_AS_NODE; // (set when this check runs on Capri's own Node: she must start as herself)
  delete env.NODE_OPTIONS;
  const started = Date.now();
  let out = '';
  const child = spawn(found.exe, args, { env, windowsHide: false, stdio: ['ignore', 'pipe', 'pipe'], shell: WIN && /\.cmd$/i.test(found.exe) });
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const code = await new Promise((resolve) => {
    const timer = setTimeout(() => { killTree(child); resolve('timeout'); }, 180000);
    child.on('error', (e) => { clearTimeout(timer); out += `\nspawn error: ${e.message}`; resolve('error'); });
    child.on('close', (c) => { clearTimeout(timer); resolve(c); });
  });
  ctx.write(`logs/app-${name}.output.txt`, out);
  let trail = '';
  try {
    trail = fs.readFileSync(path.join(dir, 'selftest.log'), 'utf8').trim().split(/\r?\n/).slice(-4).join(' | ');
  } catch {
    // she wrote no log: she did not start as far as the first line
  }
  let report = null;
  try {
    report = JSON.parse(fs.readFileSync(path.join(dir, 'electron.json'), 'utf8'));
  } catch {
    // she did not get as far as writing it
  }
  // her data folder of the run is not part of the results (it has her settings file and the Chromium caches)
  fs.rmSync(path.join(dir, 'userdata'), { recursive: true, force: true });
  return { name, dir, code, ms: Date.now() - started, report, output: out, trail };
}

const step = (report, name) => (report.steps || []).find((s) => s.name === name);

// what a report says, as findings
function judge(ctx, run, label) {
  const { report } = run;
  const where = label ? ` (${label})` : '';
  if (!report) {
    const hex = typeof run.code === 'number' && run.code > 0x7fffffff ? ` (0x${(run.code >>> 0).toString(16).toUpperCase()})` : '';
    ctx.add('app', `Капри запускается${where}`, 'fail', run.code === 'timeout'
      ? 'не закончила проверку за 3 минуты'
      : `закрылась, не написав отчёта; код выхода ${run.code}${hex}. ${run.trail ? `Последнее в её журнале: ${run.trail}` : 'Журнала нет совсем: это версия Капри без режима проверки (поставьте новую) или она упала в самом начале'}`, { log: `logs/app-${run.name}.output.txt` });
    return { drawn: false, ran: false };
  }
  const bad = (report.steps || []).filter((s) => !s.ok);
  ctx.add('app', `Капри запускается и проходит осмотр самой себя${where}`, report.done ? (bad.length ? 'warn' : 'pass') : 'fail',
    report.done ? `${report.steps.length} осмотров за ${(run.ms / 1000).toFixed(0)} с${bad.length ? `, не удались: ${bad.map((s) => s.name).join(', ')}` : ''}` : 'осмотр прервался на полпути', { log: `app/${run.name}/electron.json` });
  for (const s of bad) ctx.add('app', `Осмотр «${s.name}»${where}`, 'fail', s.error);

  const program = step(report, 'program');
  if (program && program.ok && !label) {
    const d = program.data;
    ctx.facts.app = { version: d.version, electron: d.electron, chrome: d.chrome, node: d.node, packaged: d.packaged, exe: d.exe, os: d.osName || d.os };
    ctx.add('app', 'Версия Капри', 'info', `${d.version}, Electron ${d.electron}, Chromium ${d.chrome}${d.packaged ? '' : ' (из исходников)'}`);
  }

  const draws = step(report, 'what she draws');
  let drawn = false;
  if (draws && draws.ok) {
    const v = draws.data;
    drawn = v.verdict === 'drawn';
    ctx.add('app', `Её окно рисуется${where}`, drawn ? 'pass' : 'fail',
      drawn ? `нарисовано ${v.opaque} из ${v.sampled} проверенных точек, чёрных ${v.black}` : v.verdict === 'black' ? 'окно чёрное (так выглядит ошибка видеодрайвера с прозрачными окнами)' : 'окно пустое: ничего не нарисовано', { log: `app/${run.name}/overlay.png` });
  }

  const page = step(report, 'her page');
  if (page && page.ok) {
    const p = page.data;
    if (!p.webgl) ctx.add('app', `WebGL${where}`, 'fail', 'видеокарта или драйвер не дали WebGL: Капри не сможет себя нарисовать');
    else ctx.add('app', `WebGL${where}`, 'pass', `${p.webgl.renderer}${p.webgl2 ? ', WebGL 2 есть' : ', WebGL 2 нет'}`);
    if (label) return { drawn, ran: true }; // (another way of drawing is judged on drawing alone)
    const bad200 = Object.entries(p.protocol || {}).filter(([, v]) => !/^200 /.test(v));
    if (bad200.length) ctx.add('app', `Файлы программы по capri://${where}`, 'fail', bad200.map(([k, v]) => `${k}: ${v}`).join('; '));
    if (p.audio) {
      ctx.add('app', `Звук: AudioContext 16 кГц и worklet для микрофона${where}`, p.audio.worklet === 'ok' && p.audio.sampleRate === 16000 ? 'pass' : 'fail',
        `частота ${p.audio.sampleRate}, worklet: ${p.audio.worklet}, частота по умолчанию ${p.audio.defaultRate}`);
    }
    if (p.devices) {
      const n = p.devices.count || {};
      ctx.add('app', `Устройства звука${where}`, n.audioinput ? 'pass' : 'warn', `микрофонов: ${n.audioinput || 0}, динамиков: ${n.audiooutput || 0}${n.audioinput ? '' : ' (микрофон не найден или Windows его не показывает приложениям)'}`);
    }
    if (p.permissions && p.permissions.microphone === 'denied') ctx.add('app', `Микрофон запрещён${where}`, 'warn', 'Windows (Параметры → Конфиденциальность → Микрофон) не пускает приложения к микрофону');
    if (p.microphone) {
      const m = p.microphone;
      if (m.ok) ctx.add('app', `Микрофон открывается${where}`, 'pass', `${(m.tracks[0] && m.tracks[0].label) || 'устройство'}, пик сигнала за секунду ${m.peak}${m.peak === 0 ? ' (абсолютная тишина: микрофон выключен кнопкой или заглушен)' : ''}`);
      else ctx.add('app', `Микрофон открывается${where}`, /NotFound/.test(m.error) ? 'warn' : 'fail', /NotFound/.test(m.error) ? 'микрофона нет (или Windows не показывает его приложениям)' : m.error);
    }
    if (p.speech && p.speech.available) {
      ctx.add('app', `Системные голоса (запасная озвучка)${where}`, p.speech.count ? 'info' : 'warn', `голосов: ${p.speech.count}${p.speech.russian && p.speech.russian.length ? `, русские: ${p.speech.russian.join(', ')}` : ', русского нет'}`);
    }
    if ((p.errors || []).length) ctx.add('app', `Ошибки на странице проверки${where}`, 'warn', p.errors.join('; '));
  }

  const files = step(report, 'program files');
  if (files && files.ok) {
    const f = files.data;
    ctx.add('app', `Файлы программы на месте${where}`, f.ok ? 'pass' : 'fail', f.ok ? `${f.checked} файлов, сценарии PowerShell распакованы из архива` : `не хватает: ${f.missing.join(', ') || '—'}; не читаются: ${f.unpacked.filter((u) => !u.readable).map((u) => u.file).join(', ') || '—'}`);
  }
  const pcs = step(report, 'her helpers');
  if (pcs && pcs.ok) {
    const h = pcs.data;
    if (!h.tray) ctx.add('app', `Значок в трее${where}`, 'warn', 'не создан');
    if (h.shortcut === false) ctx.add('app', `Сочетание Ctrl+Alt+C${where}`, 'warn', 'занято: другой программой или уже запущенной Капри (тогда это нормально)');
    if (WIN && h.windowsSeen === null) ctx.add('app', `Наблюдатель за окнами в приложении${where}`, 'warn', 'за 8 секунд не прислал данных (на этом ПК Капри не узнает, где другие окна)');
    else if (WIN) ctx.add('app', `Наблюдатель за окнами в приложении${where}`, 'pass', `видит окон: ${h.windowsSeen}`);
  }
  const ps = step(report, 'PowerShell and her hands');
  if (ps && ps.ok) ctx.add('app', `Руки Капри внутри приложения${where}`, /ps=\S+ screen=\d+x\d+/.test(ps.data.probe) ? 'pass' : 'fail', String(ps.data.probe).slice(0, 200));
  const sight = step(report, 'her sight (screen capture)');
  if (sight && sight.ok) {
    const s = sight.data;
    const empty = !s.length || s.every((x) => x.empty || x.black === 100);
    ctx.add('app', `Зрение: снимок экрана${where}`, empty ? 'warn' : 'pass', empty ? 'снимок пустой или чёрный (защита экрана, разрешения macOS или драйвер)' : `экранов: ${s.length}`);
  }
  const menu = step(report, 'her main menu');
  if (menu && menu.ok) ctx.add('app', `Главное меню открывается${where}`, menu.data.buttons > 5 && menu.data.visible ? 'pass' : 'fail', `кнопок: ${menu.data.buttons}, текста ${menu.data.text} знаков`, { log: `app/${run.name}/hub.png` });
  const hw = step(report, 'this PC and her plan for it');
  if (hw && hw.ok && !label) ctx.facts.appHardware = hw.data;
  const gfx = step(report, 'graphics');
  if (gfx && gfx.ok && !label) {
    const dev = (gfx.data.devices || []).map((d) => `${d.vendorId}:${d.deviceId}${d.driverVersion ? ` драйвер ${d.driverVersion}` : ''}`).join('; ');
    ctx.add('app', 'Графика Chromium', 'info', `${Object.entries(gfx.data.features || {}).filter(([k]) => ['gpu_compositing', 'webgl', 'webgl2', 'rasterization'].includes(k)).map(([k, v]) => `${k}=${v}`).join(', ')}${dev ? `; ${dev}` : ''}`);
  }
  if ((report.errors || []).length) {
    const errs = report.errors.filter((e) => !/GPU stall|ReadPixels/i.test(e.text));
    if (errs.length) ctx.add('app', `События во время проверки${where}`, 'warn', errs.slice(0, 6).map((e) => `${e.kind}: ${e.text}`).join(' | '), { count: errs.length });
  }
  return { drawn, ran: true };
}

async function run(ctx) {
  const found = await findCapri(ctx);
  if (!found) {
    ctx.add('app', 'Капри', 'skip', 'не найдена: поставьте её установщиком и запустите проверку снова (или укажите путь: --capri "C:\\...\\Capri.exe")');
    return;
  }
  ctx.facts.capriExe = found.exe;
  ctx.add('app', 'Капри найдена', 'info', `${found.exe} (${found.how})`);
  ctx.say('  запускаю Капри в режиме проверки, это займёт около полминуты (она ненадолго покажет своё окно и главное меню)...');
  const extra = ctx.full ? ['--selftest-mic'] : [];
  const first = await runOnce(ctx, found, 'default', extra);
  const verdict = judge(ctx, first, '');
  if (!first.report) return;

  // another way of drawing: only when the first does not work (a quick check), always in the full one
  if (!verdict.drawn || ctx.full) {
    let exit = false;
    for (const mode of ['software', 'gl']) {
      ctx.say(`  пробую способ отрисовки «${mode}»...`);
      const again = await runOnce(ctx, found, mode, [`--selftest-render=${mode}`]);
      const v = judge(ctx, again, mode === 'software' ? 'без видеокарты' : 'через OpenGL');
      if (v.drawn && !verdict.drawn && !exit) {
        exit = true;
        ctx.add('app', `Выход найден: в её меню › Дисплей выберите «${mode === 'software' ? 'без видеокарты' : 'OpenGL'}»`, 'info', 'с настройкой по умолчанию окно не рисуется, с этой — рисуется', { hint: true });
      }
      if (!ctx.full && v.drawn) break;
    }
  }
}

module.exports = { run, findCapri, runOnce, judge };
