'use strict';

// Her hands on your PC (Windows), only when you ask and, for anything she types, only after you've
// clicked yes in her panel. She can arrange, show or close windows, type text into a window, and
// write a message in Telegram, Discord, WhatsApp or Slack.
//
// Safety:
// - Everything she types goes through the clipboard (Ctrl+V), and the text you had copied is put
//   back afterwards (a window op that types nothing never touches the clipboard). Your message text
//   is never written into the PowerShell script as code, only as base64 data for the clipboard.
// - A key or a paste only happens once the window it is meant for is really in the foreground. If
//   anything else steals focus in between, she stops instead of typing into the wrong place.
// - A message is two steps: prepareMessage() opens the chat and types the message WITHOUT sending
//   it, so you can read it on screen; sendMessage() presses Enter, and only runs after your yes.
// - The mouse (moveMouse, clickMouse, scrollMouse), a control of a window by its name (pressElement, moveToElement) and a key
//   combination (pressKeys) are separate scripts. Nothing from the chat is ever put into a script as code: a target is one of a
//   fixed list or two whole numbers, a name goes in as base64 data, a key is built from a list of keys. The pointer is moved by a
//   few steps at a time, and if you take hold of the mouse she stops at once ('interrupted').

const { spawn } = require('node:child_process');

const WIN = process.platform === 'win32';

// Win32 calls, compiled once per PowerShell run.
const HELPER = String.raw`
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static class CapriHands {
  delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr hwnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hwnd, uint cmd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);

  // The visible top-level windows of a program, by its process name, else by a word of its title
  // (front first). Never Capri's own windows, nor the AI she runs on (Claude, Ollama).
  public static List<IntPtr> Find(string name) {
    var found = new List<IntPtr>();
    var titled = new List<IntPtr>();
    string want = name.ToLowerInvariant();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h) || GetWindow(h, 4) != IntPtr.Zero) return true; // owned windows are dialogs
      int len = GetWindowTextLength(h);
      if (len == 0) return true;
      var sb = new StringBuilder(len + 1);
      GetWindowText(h, sb, sb.Capacity);
      uint pid;
      GetWindowThreadProcessId(h, out pid);
      string proc = "";
      try { proc = Process.GetProcessById((int)pid).ProcessName.ToLowerInvariant(); } catch {}
      if (proc == "capri" || proc == "electron" || proc == "claude" || proc.StartsWith("ollama")) return true;
      if (proc == want || proc.Contains(want)) found.Add(h);
      else if (sb.ToString().ToLowerInvariant().Contains(want)) titled.Add(h);
      return true;
    }, IntPtr.Zero);
    return found.Count > 0 ? found : titled;
  }

  // In front, for real. Windows only hands the foreground over right after a key press, so we fake
  // one (the Alt tap) first.
  public static bool Focus(IntPtr h) {
    if (IsIconic(h)) ShowWindow(h, 9);
    keybd_event(0x12, 0, 0, UIntPtr.Zero);
    keybd_event(0x12, 0, 2, UIntPtr.Zero);
    SetForegroundWindow(h);
    System.Threading.Thread.Sleep(140);
    return Same(GetForegroundWindow(), h);
  }

  // Same program (a messenger may raise another of its own windows).
  public static bool Same(IntPtr a, IntPtr b) {
    if (a == b) return true;
    uint pa, pb;
    GetWindowThreadProcessId(a, out pa);
    GetWindowThreadProcessId(b, out pb);
    return pa == pb;
  }
}
"@
$ws = New-Object -ComObject WScript.Shell
function Txt($b64) { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64)) }
function Win($name, $waitMs) {
  $t0 = [DateTime]::Now
  do {
    $list = [CapriHands]::Find((Txt $name))
    if ($list.Count -gt 0) { return $list[0] }
    Start-Sleep -Milliseconds 300
  } while (([DateTime]::Now - $t0).TotalMilliseconds -lt $waitMs)
  return [IntPtr]::Zero
}
# a key press or a paste, only once the window it's for is really in front
function Ensure($h) {
  if ([CapriHands]::Same([CapriHands]::GetForegroundWindow(), $h)) { return }
  if (-not [CapriHands]::Focus($h)) { throw 'lostfocus' }
}
function Keys($h, $keys) { Ensure $h; $ws.SendKeys($keys); Start-Sleep -Milliseconds 90 }
# the clipboard is only touched by a paste: kept the first time, put back at the end (run())
$global:clipOld = $null; $global:clipSaved = $false
function Paste($h, $b64) {
  if (-not $global:clipSaved) { try { $global:clipOld = Get-Clipboard -Raw } catch {}; $global:clipSaved = $true }
  Set-Clipboard -Value (Txt $b64); Start-Sleep -Milliseconds 90; Ensure $h; $ws.SendKeys('^v'); Start-Sleep -Milliseconds 160
}
`;


// The mouse, in a script of its own (so that a fault in it cannot touch the windows and messages above): the pointer moved in
// steps that ease in and out (and given up at once if you take hold of the mouse), a click, the wheel. SetProcessDPIAware: the
// numbers are the screen's own pixels, not scaled ones.
const MOUSE_HELPER = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class CapriMouse {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern void mouse_event(uint flags, uint dx, uint dy, int data, UIntPtr extra);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);

  public static void Aware() { try { SetProcessDPIAware(); } catch (Exception) { } }
  public static int Width() { return GetSystemMetrics(0); }
  public static int Height() { return GetSystemMetrics(1); }

  public static string Move(int x, int y, int ms) {
    POINT start;
    GetCursorPos(out start);
    int steps = Math.Max(8, ms / 10);
    int lastX = start.X;
    int lastY = start.Y;
    for (int i = 1; i <= steps; i++) {
      double t = (double)i / steps;
      double e = t < 0.5 ? 2 * t * t : 1 - Math.Pow(-2 * t + 2, 2) / 2;
      int nx = start.X + (int)Math.Round((x - start.X) * e);
      int ny = start.Y + (int)Math.Round((y - start.Y) * e);
      POINT now;
      GetCursorPos(out now);
      if (Math.Abs(now.X - lastX) > 8 || Math.Abs(now.Y - lastY) > 8) return "interrupted";
      SetCursorPos(nx, ny);
      lastX = nx;
      lastY = ny;
      System.Threading.Thread.Sleep(10);
    }
    return "ok";
  }

  public static void Click(bool right, bool twice) {
    uint down = right ? 0x0008u : 0x0002u;
    uint up = right ? 0x0010u : 0x0004u;
    int n = twice ? 2 : 1;
    for (int i = 0; i < n; i++) {
      mouse_event(down, 0, 0, 0, UIntPtr.Zero);
      System.Threading.Thread.Sleep(35);
      mouse_event(up, 0, 0, 0, UIntPtr.Zero);
      System.Threading.Thread.Sleep(70);
    }
  }

  public static void Wheel(int clicks) { mouse_event(0x0800, 0, 0, clicks * 120, UIntPtr.Zero); }
}
'@
[CapriMouse]::Aware()
`;

const b64 = (text) => Buffer.from(String(text ?? ''), 'utf8').toString('base64');

// Runs a script with the helper; resolves with its last output line, or throws its error (with a
// short code when it's one the overlay should word nicely).
function run(script, timeout = 30000, { mouse = false } = {}) {
  if (!WIN) return Promise.reject(Object.assign(new Error('Windows only'), { code: 'nowin' }));
  return new Promise((resolve, reject) => {
    const full = `[Console]::OutputEncoding = [Text.Encoding]::UTF8; $ErrorActionPreference = 'Stop'; ${HELPER}${mouse ? MOUSE_HELPER : ''}
try {
${script}
} catch {
  [Console]::Out.WriteLine('ERR ' + $_.Exception.Message)
} finally {
  # what you had copied, back (text; with nothing copied before, it's left blank, not with her text)
  if ($global:clipSaved) {
    if ($global:clipOld -ne $null) { try { Set-Clipboard -Value $global:clipOld } catch {} } else { try { Set-Clipboard -Value ' ' } catch {} }
  }
}`;
    const encoded = Buffer.from(full, 'utf16le').toString('base64');
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', () => {
      clearTimeout(timer);
      const last = out.trim().split(/\r?\n/).pop() || '';
      if (last.startsWith('ERR ')) {
        const msg = last.slice(4);
        const code = /lostfocus/.test(msg) ? 'lostfocus' : /nowindow/.test(msg) ? 'nowindow' : /noelement/.test(msg) ? 'noelement' : /interrupted/.test(msg) ? 'interrupted' : null;
        reject(Object.assign(new Error(msg), { code }));
      } else if (!out.trim() && err.trim()) {
        reject(new Error(err.trim().split(/\r?\n/)[0]));
      } else {
        resolve(last);
      }
    });
  });
}

// ---------- windows ----------

const SHOW = { minimize: 6, maximize: 3, restore: 9 };
const OPS = new Set([...Object.keys(SHOW), 'focus', 'close']);

// op: 'minimize' | 'maximize' | 'restore' | 'focus' | 'close'; name: a program or a word of a title.
// Resolves with how many windows it touched.
async function windowOp(op, name) {
  if (!OPS.has(op)) throw new Error('what to do with the window?'); // (it goes into the script as code)
  const target = String(name || '').trim().slice(0, 60);
  if (!target) throw new Error('which window?');
  const act = op === 'focus' ? '[void][CapriHands]::Focus($h)'
    : op === 'close' ? '[void][CapriHands]::PostMessage($h, 0x10, [IntPtr]::Zero, [IntPtr]::Zero)' // WM_CLOSE, like its own close button
      : `[void][CapriHands]::ShowWindow($h, ${SHOW[op]})`;
  const script = `
$list = [CapriHands]::Find((Txt '${b64(target)}'))
if ($list.Count -eq 0) { throw 'nowindow' }
$n = 0
foreach ($h in $list) { ${act}; $n++${op === 'focus' ? '; break' : ''} }
[Console]::Out.WriteLine($n)`;
  return Number(await run(script, 12000)) || 0;
}

// Minimize everything (show the desktop).
async function showDesktop() {
  return run("(New-Object -ComObject Shell.Application).MinimizeAll(); [Console]::Out.WriteLine('1')", 8000);
}

// Type text into the window named by `into` (no Enter). For "write ... in Notepad" and the like.
async function type(text, into) {
  const name = String(into || '').trim().slice(0, 60);
  const body = String(text ?? '');
  if (!name) throw new Error('into which window?');
  if (!body) throw new Error('type what?');
  const script = `
$h = Win '${b64(name)}' 3000
if ($h -eq [IntPtr]::Zero) { throw 'nowindow' }
Paste $h '${b64(body)}'
[Console]::Out.WriteLine('1')`;
  await run(script, 15000);
  return true;
}

// ---------- the mouse, the controls of a window, key combinations ----------

// where the pointer can be sent by name: the share of the screen's width and height
const TARGETS = {
  center: [0.5, 0.5], topleft: [0.02, 0.03], topright: [0.98, 0.03], bottomleft: [0.02, 0.97], bottomright: [0.98, 0.97],
  top: [0.5, 0.03], bottom: [0.5, 0.97], left: [0.03, 0.5], right: [0.97, 0.5],
};
const runner = { run }; // (the tests put a stand-in here)

// The pointer to a place of the screen, smoothly: a name from TARGETS, or { x, y } in pixels. Resolves 'ok' or 'interrupted'
// (you took hold of the mouse).
async function moveMouse(target) {
  let place;
  if (typeof target === 'string' && Object.hasOwn(TARGETS, target)) {
    const [fx, fy] = TARGETS[target];
    place = `$x = [int]($w * ${fx}); $y = [int]($h * ${fy})`;
  } else if (target && Number.isInteger(target.x) && Number.isInteger(target.y) && Math.abs(target.x) < 100000 && Math.abs(target.y) < 100000) {
    place = `$x = ${target.x}; $y = ${target.y}`;
  } else throw new Error('where to?');
  const script = `
$w = [CapriMouse]::Width(); $h = [CapriMouse]::Height()
${place}
$x = [Math]::Max(0, [Math]::Min($w - 1, $x)); $y = [Math]::Max(0, [Math]::Min($h - 1, $y))
[Console]::Out.WriteLine([CapriMouse]::Move($x, $y, 450))`;
  return runner.run(script, 10000, { mouse: true });
}

// A click where the pointer is: { button: 'left' | 'right', double }.
async function clickMouse({ button = 'left', double = false } = {}) {
  if (!['left', 'right'].includes(button)) throw new Error('which button?');
  const script = `[CapriMouse]::Click($${button === 'right'}, $${double === true})
[Console]::Out.WriteLine('1')`;
  await runner.run(script, 8000, { mouse: true });
  return true;
}

// The wheel: clicks up (positive) or down (negative), up to thirty.
async function scrollMouse(clicks) {
  const n = Number(clicks);
  if (!Number.isInteger(n) || n === 0 || Math.abs(n) > 30) throw new Error('how far?');
  await runner.run(`[CapriMouse]::Wheel(${n})\n[Console]::Out.WriteLine('1')`, 8000, { mouse: true });
  return true;
}

// A control of a window found by its name (a button, a menu entry, a link, a tab…), through Windows' accessibility tree (UI
// Automation): `action` 'press' moves the pointer to it and presses it (its own "invoke" where it has one, else a click), 'move'
// only moves the pointer there. Resolves the name it found; 'nowindow' / 'noelement' when there is none.
async function elementAction({ action = 'press', window: into, name } = {}) {
  if (!['press', 'move'].includes(action)) throw new Error('what to do with it?');
  const win = String(into || '').trim().slice(0, 60);
  const what = String(name || '').trim().slice(0, 80);
  if (!win) throw new Error('in which window?');
  if (!what) throw new Error('which one?');
  const script = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$h = Win '${b64(win)}' 3000
if ($h -eq [IntPtr]::Zero) { throw 'nowindow' }
[void][CapriHands]::Focus($h)
$want = (Txt '${b64(what)}').ToLowerInvariant()
$root = [System.Windows.Automation.AutomationElement]::FromHandle($h)
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$best = $null; $bestScore = 0; $n = 0
foreach ($e in $all) {
  $n++
  if ($n -gt 4000) { break }
  try {
    $c = $e.Current
    $nm = $c.Name
    if ([string]::IsNullOrEmpty($nm) -or $c.IsOffscreen -or -not $c.IsEnabled) { continue }
    $low = $nm.ToLowerInvariant()
    $score = 0
    if ($low -eq $want) { $score = 100 } elseif ($low.StartsWith($want)) { $score = 60 } elseif ($low.Contains($want)) { $score = 30 }
    if ($score -eq 0) { continue }
    if ($c.ControlType.ProgrammaticName -match 'Button|MenuItem|Hyperlink|TabItem|ListItem|CheckBox|RadioButton|TreeItem|ComboBox') { $score += 10 }
    $r = $c.BoundingRectangle
    if ($r.IsEmpty -or $r.Width -lt 2 -or $r.Height -lt 2) { continue }
    if ($score -gt $bestScore) { $best = $e; $bestScore = $score }
  } catch { }
}
if ($best -eq $null) { throw 'noelement' }
$r = $best.Current.BoundingRectangle
$x = [int]($r.X + $r.Width / 2); $y = [int]($r.Y + $r.Height / 2)
$moved = [CapriMouse]::Move($x, $y, 450)
if ($moved -ne 'ok') { throw 'interrupted' }
${action === 'press' ? `$pattern = $null
if ($best.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) { $pattern.Invoke() } else { [CapriMouse]::Click($false, $false) }` : ''}
[Console]::Out.WriteLine($best.Current.Name)`;
  return runner.run(script, 25000, { mouse: true });
}

// SendKeys' words for the keys that are not a letter or a digit
const SPECIAL_KEYS = {
  enter: 'ENTER', return: 'ENTER', esc: 'ESC', escape: 'ESC', tab: 'TAB', space: ' ', backspace: 'BACKSPACE', delete: 'DEL', del: 'DEL',
  up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT', home: 'HOME', end: 'END', pageup: 'PGUP', pagedown: 'PGDN', insert: 'INS',
};
const MODIFIERS = { ctrl: '^', alt: '%', shift: '+' };

// A key combination as SendKeys writes it: { mods: ['ctrl', 'shift'], key: 's' } -> "^+s". Throws for a key it does not know, and for
// the combinations she never presses (Alt+F4 closes a window: that is her closing flow, with its button, not a key).
function keysString({ mods = [], key } = {}) {
  const k = String(key ?? '').toLowerCase();
  if (mods != null && !Array.isArray(mods)) throw new Error('which keys?');
  const list = [...new Set((mods || []).map((m) => String(m).toLowerCase()))];
  if (!list.every((m) => Object.hasOwn(MODIFIERS, m))) throw new Error('which keys?');
  let body;
  if (/^[a-z0-9]$/.test(k)) body = k;
  else if (/^f([1-9]|1[0-2])$/.test(k)) body = `{${k.toUpperCase()}}`;
  else if (Object.hasOwn(SPECIAL_KEYS, k)) body = SPECIAL_KEYS[k] === ' ' ? ' ' : `{${SPECIAL_KEYS[k]}}`;
  else throw new Error('which key?');
  if (list.includes('alt') && k === 'f4') throw Object.assign(new Error('that one closes windows'), { code: 'denied' });
  if (list.includes('ctrl') && list.includes('shift') && k === 'esc') throw Object.assign(new Error('not that one'), { code: 'denied' });
  return `${list.map((m) => MODIFIERS[m]).join('')}${body}`;
}

// A key combination into a window (it is brought to the front first, and nothing is pressed if something else takes the front).
async function pressKeys({ window: into, mods, key } = {}) {
  const win = String(into || '').trim().slice(0, 60);
  if (!win) throw new Error('in which window?');
  const keys = keysString({ mods, key });
  const script = `
$h = Win '${b64(win)}' 3000
if ($h -eq [IntPtr]::Zero) { throw 'nowindow' }
Keys $h (Txt '${b64(keys)}')
[Console]::Out.WriteLine('1')`;
  await runner.run(script, 12000);
  return true;
}

// A look that touches nothing (her self-check, selftest.js): both helpers compiled the way every action above does, then PowerShell's
// version, the screen's size in its own pixels and how many windows the finder sees. Nothing is moved, pressed or copied.
async function probe() {
  const script = `
$seen = [CapriHands]::Find('').Count
[Console]::Out.WriteLine('ps=' + $PSVersionTable.PSVersion + ' screen=' + [CapriMouse]::Width() + 'x' + [CapriMouse]::Height() + ' windows=' + $seen)`;
  return runner.run(script, 30000, { mouse: true });
}

// ---------- messengers ----------

// How to reach a chat by name in each app: the process to look for, how to open its search or
// switcher, and whether a browser form (we only do the desktop apps here).
const APPS = {
  telegram: { proc: 'telegram', open: '^f', clearFirst: true },
  discord: { proc: 'discord', open: '^k' },
  whatsapp: { proc: 'whatsapp', open: '^f', clearFirst: true },
  slack: { proc: 'slack', open: '^k' },
};
// stems, so any case ending matches ("телеге", "вотсапом"…)
const STEMS = [
  [/телег|telegram|^tg$/i, 'telegram'],
  [/дискорд|discord/i, 'discord'],
  [/вотсап|ватсап|whats/i, 'whatsapp'],
  [/слак|slack/i, 'slack'],
];

function appKey(name) {
  const n = String(name || '').toLowerCase().trim();
  if (APPS[n]) return n;
  for (const [re, key] of STEMS) if (re.test(n)) return key;
  return null;
}

// Step one: bring the app up, find the chat, and type the message into it WITHOUT sending.
// Resolves with { app, hwnd } so step two can check it's still the same window. 'nowindow' if the
// app isn't open (the caller launches it and tries again).
async function prepareMessage({ app, chat, message }) {
  const key = appKey(app);
  if (!key) throw Object.assign(new Error('unknown app'), { code: 'unknownapp' });
  const recipe = APPS[key];
  const name = String(chat || '').trim().slice(0, 80);
  const text = String(message ?? '').trim();
  if (!name) throw new Error('which chat?');
  if (!text) throw new Error('what message?');
  const clear = recipe.clearFirst ? "Keys $h '^a{DEL}'" : '';
  const script = `
$h = Win '${b64(recipe.proc)}' 4000
if ($h -eq [IntPtr]::Zero) { throw 'nowindow' }
Ensure $h
Keys $h '${recipe.open}'
Start-Sleep -Milliseconds 400
${clear}
Paste $h '${b64(name)}'
Start-Sleep -Milliseconds 1100
Keys $h '{ENTER}'
Start-Sleep -Milliseconds 700
Ensure $h
Paste $h '${b64(text)}'
[Console]::Out.WriteLine([CapriHands]::GetForegroundWindow().ToInt64())`;
  const hwnd = await run(script, 25000);
  return { app: key, hwnd: String(hwnd || '').trim() };
}

// Step two, after your yes: press Enter in the window step one left it in. The chat and message are
// never passed again — only Enter — and only if that same program is still in front.
async function sendPrepared({ hwnd }) {
  const id = String(hwnd || '').replace(/[^\d-]/g, '');
  if (!id) throw new Error('nothing prepared');
  const script = `
$h = [IntPtr][int64]${id}
if (-not [CapriHands]::Same([CapriHands]::GetForegroundWindow(), $h)) { throw 'lostfocus' }
$ws.SendKeys('{ENTER}')
[Console]::Out.WriteLine('1')`;
  await run(script, 8000);
  return true;
}

module.exports = { windowOp, showDesktop, type, prepareMessage, sendPrepared, appKey, APPS, OPS, moveMouse, clickMouse, scrollMouse, elementAction, pressKeys, keysString, probe, TARGETS, runner };
