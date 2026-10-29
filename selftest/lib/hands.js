'use strict';

// The full check's test of Capri's hands on Windows: a window of our own ("CapriSelfTest", windows/target.ps1) is brought to the
// front, typed into, pressed on, minimized, restored and closed with the same functions the app uses (src/main/system/control.js),
// and the window's state file says what it really saw. The pointer is put back where it was. Takes about half a minute.

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { ps: realPs, killTree, wait, WIN } = require('./proc');

const TITLE = 'CapriSelfTest';

function readState(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

async function until(file, test, ms = 6000) {
  const end = Date.now() + ms;
  let last = null;
  while (Date.now() < end) {
    last = readState(file);
    if (last && test(last)) return last;
    await wait(120);
  }
  return last;
}

const centre = (b) => ({ x: Math.round(b.x + b.w / 2), y: Math.round(b.y + b.h / 2) });

// `deps` is for the tests, which stand in for PowerShell and the window: { win, control, start(stateFile) -> child, ps }
async function run(ctx, deps = {}) {
  const onWindows = deps.win === undefined ? WIN : deps.win;
  const ps = deps.ps || realPs;
  if (!onWindows) {
    ctx.add('hands', 'Руки Капри на тестовом окне', 'skip', 'только Windows');
    return;
  }
  if (!ctx.full || !ctx.wants('hands')) {
    ctx.add('hands', 'Руки Капри на тестовом окне', 'skip', 'это в полной проверке (быстрая ничего не двигает)');
    return;
  }
  if (!ctx.source) return;
  const control = deps.control || require(path.join(ctx.source, 'src', 'main', 'system', 'control.js'));
  const file = ctx.path('logs/target-state.json');
  fs.rmSync(file, { force: true });

  const child = deps.start ? deps.start(file) : spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', path.join(ctx.kit, 'windows', 'target.ps1'), file], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let said = '';
  child.stderr.on('data', (d) => { said += d; });
  child.stdout.on('data', (d) => { said += d; });
  const started = await until(file, (s) => s.ready, 25000);
  if (!started) {
    ctx.add('hands', 'Тестовое окно', 'fail', `не открылось за 25 секунд. ${said.trim().slice(0, 300)}`);
    killTree(child);
    return;
  }
  ctx.add('hands', 'Тестовое окно открылось', 'pass', `${started.form.w}×${started.form.h} в точке ${started.form.x},${started.form.y}`);
  const home = started.cursor;
  const steps = [];
  const check = async (name, action, verify) => {
    const t0 = Date.now();
    let outcome = '';
    let ok = false;
    try {
      const result = await action();
      const state = await verify.state();
      ok = Boolean(verify.test(state, result));
      outcome = verify.say(state, result);
    } catch (err) {
      outcome = `ошибка: ${String(err && err.message || err)}${err && err.code ? ` [${err.code}]` : ''}`;
    }
    steps.push({ name, ok, outcome, ms: Date.now() - t0 });
    ctx.add('hands', name, ok ? 'pass' : 'fail', outcome);
    return ok;
  };
  const now = () => readState(file) || {};
  const settle = (test, ms) => () => until(file, test, ms || 4000);

  try {
    await check('Окно выводится вперёд (focus)', () => control.windowOp('focus', TITLE), {
      state: settle((s) => s.inFront), test: (s) => s.inFront, say: (s) => (s.inFront ? 'окно в фокусе' : 'окно не оказалось в фокусе: Windows не отдаёт ему передний план'),
    });

    // the clipboard: what was there is back after the typing
    const sentinel = `capri-clip-${Date.now()}`;
    await ps(`Set-Clipboard -Value '${sentinel}'`, { timeout: 15000 });
    const typed = 'Привет, Капри! Проверка: «кавычки», "двойные", \'одинарные\', $x, `y`, 100%';
    await check('Печать русского текста через буфер обмена (type)', () => control.type(typed, TITLE), {
      state: settle((s) => s.text.length > 0), test: (s) => s.text.replace(/\r/g, '') === typed, say: (s) => (s.text.replace(/\r/g, '') === typed ? 'текст напечатан без искажений' : `напечатано другое: «${String(s.text).slice(0, 80)}»`),
    });
    const clip = await ps('Get-Clipboard -Raw', { timeout: 15000 });
    const back = clip.out.trim() === sentinel;
    steps.push({ name: 'Буфер обмена возвращён', ok: back });
    ctx.add('hands', 'Буфер обмена после печати возвращён на место', back ? 'pass' : 'fail', back ? 'то, что было скопировано, на месте' : `в буфере: «${clip.out.trim().slice(0, 60)}»`);

    await check('Комбинация клавиш (Ctrl+A)', () => control.pressKeys({ window: TITLE, mods: ['ctrl'], key: 'a' }), {
      state: settle((s) => s.selected > 0), test: (s) => s.selected >= typed.length - 2, say: (s) => `выделено знаков: ${s.selected} из ${typed.length}`,
    });

    const one = centre(started.one);
    await check('Указатель плавно идёт в точку (moveMouse)', () => control.moveMouse({ x: one.x, y: one.y }), {
      state: settle((s) => Math.abs(s.cursor.x - one.x) < 4 && Math.abs(s.cursor.y - one.y) < 4, 2500),
      test: (s, r) => r === 'ok' && Math.abs(s.cursor.x - one.x) < 4 && Math.abs(s.cursor.y - one.y) < 4,
      say: (s, r) => `ответ «${r}», указатель в ${s.cursor.x},${s.cursor.y}, нужно ${one.x},${one.y}`,
    });
    const before = now().clicks || 0;
    await check('Щелчок мыши (clickMouse)', () => control.clickMouse({ button: 'left' }), {
      state: settle((s) => s.clicks > before), test: (s) => s.clicks === before + 1, say: (s) => `нажатий кнопки: ${s.clicks - before}`,
    });
    await check('Нажатие кнопки по имени (elementAction, UI Automation)', () => control.elementAction({ action: 'press', window: TITLE, name: 'Press me' }), {
      state: settle((s) => s.clicks > before + 1), test: (s) => s.clicks === before + 2, say: (s) => `нажатий кнопки: ${s.clicks - before} (ждали 2)`,
    });
    const ruBefore = now().clicksRu || 0;
    await check('Нажатие кнопки с русским именем', () => control.elementAction({ action: 'press', window: TITLE, name: started.ruName }), {
      state: settle((s) => s.clicksRu > ruBefore), test: (s) => s.clicksRu === ruBefore + 1, say: (s) => `нажатий: ${s.clicksRu - ruBefore}`,
    });
    await check('Колесо мыши (scrollMouse) выполняется', () => control.scrollMouse(-1), { state: async () => now(), test: () => true, say: () => 'без ошибки' });

    await check('Свернуть окно (minimize)', () => control.windowOp('minimize', TITLE), {
      state: settle((s) => s.windowState === 'Minimized'), test: (s) => s.windowState === 'Minimized', say: (s) => `состояние окна: ${s.windowState}`,
    });
    await check('Развернуть обратно (restore)', () => control.windowOp('restore', TITLE), {
      state: settle((s) => s.windowState === 'Normal'), test: (s) => s.windowState === 'Normal', say: (s) => `состояние окна: ${s.windowState}`,
    });
    await check('На весь экран (maximize)', () => control.windowOp('maximize', TITLE), {
      state: settle((s) => s.windowState === 'Maximized'), test: (s) => s.windowState === 'Maximized', say: (s) => `состояние окна: ${s.windowState}`,
    });
    await control.windowOp('restore', TITLE).catch(() => {});
    await check('Закрыть окно (close)', () => control.windowOp('close', TITLE), {
      state: async () => { const end = Date.now() + 5000; while (Date.now() < end && child.exitCode === null) await wait(150); return { closed: child.exitCode !== null }; },
      test: (s) => s.closed, say: (s) => (s.closed ? 'окно закрылось' : 'окно не закрылось'),
    });
  } finally {
    // the pointer goes back to where it was
    if (home) await control.moveMouse({ x: home.x, y: home.y }).catch(() => {});
    killTree(child);
    ctx.facts.hands = { ...(ctx.facts.hands || {}), target: steps };
  }
}

module.exports = { run };
