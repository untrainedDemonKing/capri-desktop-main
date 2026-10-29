'use strict';

// Collects the PowerShell scripts that Capri's hands (src/main/system/control.js) would run, without running them: the program
// is started as `node capture.js <source folder> <output folder>`, PowerShell's start is replaced by a recorder, and every action
// is asked for once. Each script is written out whole (as the encoded command that would be handed to PowerShell, decoded back),
// so that PowerShell itself can be asked to parse them (windows.js). In a process of its own because control.js takes
// child_process.spawn when it is first loaded.

const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const cp = require('node:child_process');

const [source, out] = [process.argv[2], process.argv[3]];
const captured = [];
cp.spawn = function recorder(file, args) {
  const at = Array.isArray(args) ? args.indexOf('-EncodedCommand') : -1;
  const encoded = at >= 0 ? args[at + 1] : '';
  captured.push({ file, encodedLength: encoded.length, script: encoded ? Buffer.from(encoded, 'base64').toString('utf16le') : '' });
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  setImmediate(() => { child.stdout.emit('data', '1\n'); child.emit('close', 0); });
  return child;
};
if (process.platform !== 'win32' && process.env.CAPRI_CHECK_FAKE_WIN) Object.defineProperty(process, 'platform', { value: 'win32' });

const control = require(path.join(source, 'src', 'main', 'system', 'control.js'));

const CALLS = [
  ['window-focus', () => control.windowOp('focus', 'notepad')],
  ['window-minimize', () => control.windowOp('minimize', 'Блокнот')],
  ['window-maximize', () => control.windowOp('maximize', 'notepad')],
  ['window-restore', () => control.windowOp('restore', 'notepad')],
  ['window-close', () => control.windowOp('close', 'notepad')],
  ['show-desktop', () => control.showDesktop()],
  ['type', () => control.type('Привет, мир — "кавычки" и \'апостроф\' $x `y`', 'notepad')],
  ['mouse-move-name', () => control.moveMouse('center')],
  ['mouse-move-xy', () => control.moveMouse({ x: 500, y: 300 })],
  ['mouse-click', () => control.clickMouse({ button: 'left' })],
  ['mouse-rightdouble', () => control.clickMouse({ button: 'right', double: true })],
  ['mouse-scroll', () => control.scrollMouse(-5)],
  ['element-press', () => control.elementAction({ action: 'press', window: 'notepad', name: 'Сохранить' })],
  ['element-move', () => control.elementAction({ action: 'move', window: 'chrome', name: 'Search' })],
  ['keys', () => control.pressKeys({ window: 'notepad', mods: ['ctrl', 'shift'], key: 's' })],
  ['message-prepare', () => control.prepareMessage({ app: 'telegram', chat: 'Мама', message: 'Привет! Как дела? "Тест"' })],
  ['message-send', () => control.sendPrepared({ hwnd: '123456' })],
  ['probe', () => control.probe()],
];

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const index = [];
  for (const [name, call] of CALLS) {
    const before = captured.length;
    let error = '';
    try {
      await call();
    } catch (err) {
      error = String(err && err.message || err);
    }
    const made = captured.slice(before);
    if (!made.length) {
      index.push({ name, error: error || 'no script was made' });
      continue;
    }
    const file = `${name}.ps1`;
    // (with the mark at its start, so that PowerShell reads the letters of the script as they are)
    fs.writeFileSync(path.join(out, file), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(made[0].script, 'utf8')]));
    index.push({ name, file, chars: made[0].script.length, encodedLength: made[0].encodedLength, error });
  }
  process.stdout.write(`${JSON.stringify(index)}\n`);
})();
