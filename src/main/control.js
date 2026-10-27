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

const b64 = (text) => Buffer.from(String(text ?? ''), 'utf8').toString('base64');

// Runs a script with the helper; resolves with its last output line, or throws its error (with a
// short code when it's one the overlay should word nicely).
function run(script, timeout = 30000) {
  if (!WIN) return Promise.reject(Object.assign(new Error('Windows only'), { code: 'nowin' }));
  return new Promise((resolve, reject) => {
    const full = `[Console]::OutputEncoding = [Text.Encoding]::UTF8; $ErrorActionPreference = 'Stop'; ${HELPER}
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
        const code = /lostfocus/.test(msg) ? 'lostfocus' : /nowindow/.test(msg) ? 'nowindow' : null;
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

module.exports = { windowOp, showDesktop, type, prepareMessage, sendPrepared, appKey, APPS, OPS };
