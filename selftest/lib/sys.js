'use strict';

// The PC as it is, in facts: the system, the language, the programs Capri leans on (Node, Python, winget, Ollama, nvidia-smi…),
// PowerShell (its version, whether it may run scripts, whether it is locked down), the proxy, the antivirus, the free space. And
// Capri's own look at the PC (hardware.js, the one that picks which models to fetch) run on the real thing.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { exec, ps, version, which, WIN } = require('./proc');

const GB = 1024 ** 3;
const round1 = (n) => Math.round(n * 10) / 10;

const SYSTEM_QUERY = String.raw`
$o = [ordered]@{}
$o.ps = $PSVersionTable.PSVersion.ToString()
$o.edition = [string]$PSVersionTable.PSEdition
$o.languageMode = $ExecutionContext.SessionState.LanguageMode.ToString()
try { $o.policy = (Get-ExecutionPolicy -List | ForEach-Object { "$($_.Scope)=$($_.ExecutionPolicy)" }) -join '; ' } catch { $o.policy = 'unknown' }
try {
  $os = Get-CimInstance Win32_OperatingSystem
  $o.os = $os.Caption; $o.build = $os.BuildNumber; $o.osArch = $os.OSArchitecture; $o.installed = [string]$os.InstallDate
} catch { $o.os = 'unknown' }
try { $o.culture = (Get-Culture).Name; $o.uiCulture = (Get-UICulture).Name } catch {}
try { $o.clr = [Environment]::Version.ToString() } catch {}
try { $o.av = @(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction Stop | ForEach-Object { $_.displayName }) } catch { $o.av = @() }
try { $o.admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) } catch {}
try { $o.vm = (Get-CimInstance Win32_ComputerSystem).Model } catch {}
try { Add-Type -AssemblyName System.Speech; $o.speechVoices = @((New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name + ' (' + $_.VoiceInfo.Culture.Name + ')' }) } catch { $o.speechVoices = @() }
try {
  $k = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction Stop
  $o.proxyEnabled = [int]$k.ProxyEnable; $o.proxyServer = [string]$k.ProxyServer; $o.proxyPac = [string]$k.AutoConfigURL
} catch {}
try { $o.defender = (Get-MpComputerStatus -ErrorAction Stop | Select-Object -Property RealTimeProtectionEnabled, AntivirusEnabled | ConvertTo-Json -Compress) } catch {}
ConvertTo-Json -Compress -InputObject $o
`;

// the programs Capri uses or fetches, by the name they have on this system
const TOOLS = WIN
  ? [['node', ['-v']], ['npm.cmd', ['-v']], ['git', ['--version']], ['py', ['--version']], ['python', ['--version']], ['python3', ['--version']], ['winget', ['--version']],
    ['ollama', ['--version']], ['nvidia-smi', ['--query-gpu=name,driver_version,memory.total', '--format=csv,noheader']], ['pwsh', ['-v']], ['ffmpeg', ['-version']], ['curl', ['--version']], ['tar', ['--version']], ['wsl', ['--version']]]
  : [['node', ['-v']], ['npm', ['-v']], ['git', ['--version']], ['python3', ['--version']], ['python', ['--version']], ['ollama', ['--version']], ['nvidia-smi', ['--query-gpu=name,driver_version,memory.total', '--format=csv,noheader']],
    ['ffmpeg', ['-version']], ['curl', ['--version']], ['unzip', ['-v']], ['tar', ['--version']], ['espeak-ng', ['--version']], ['say', ['-v', '?']]];

function diskFree(dir) {
  try {
    const s = fs.statfsSync(dir);
    return { path: dir, freeGB: round1((s.bavail * s.bsize) / GB), totalGB: round1((s.blocks * s.bsize) / GB) };
  } catch (err) {
    return { path: dir, error: String(err.message || err) };
  }
}

function canWrite(dir) {
  try {
    const f = path.join(dir, `.capri-check-${process.pid}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(f, 'x');
    fs.unlinkSync(f);
    return true;
  } catch {
    return false;
  }
}

async function snapshot(ctx) {
  const cpus = os.cpus();
  const sys = {
    platform: process.platform, arch: process.arch, release: os.release(), version: os.version ? os.version() : '',
    cpu: cpus[0] ? cpus[0].model.trim() : '', threads: cpus.length, ramGB: round1(os.totalmem() / GB), ramFreeGB: round1(os.freemem() / GB),
    uptimeHours: round1(os.uptime() / 3600), timezoneOffsetMin: new Date().getTimezoneOffset(), locale: Intl.DateTimeFormat().resolvedOptions().locale,
    envLang: process.env.LANG || process.env.LC_ALL || '', runtime: { exe: process.execPath, node: process.versions.node, viaCapri: ctx.runtime.viaCapri, electron: process.versions.electron || '' },
    processArch: process.arch, wow64: process.env.PROCESSOR_ARCHITEW6432 || '', hostArch: process.env.PROCESSOR_ARCHITECTURE || '',
    disks: { kit: diskFree(ctx.kit), temp: diskFree(os.tmpdir()), home: diskFree(os.homedir()) },
    writable: { results: canWrite(ctx.out), temp: canWrite(os.tmpdir()), home: canWrite(os.homedir()) },
    pathHasNonAscii: /[^\x00-\x7f]/.test(ctx.kit) || /[^\x00-\x7f]/.test(os.homedir()),
    kitPath: ctx.kit, homePath: os.homedir(),
    proxyEnv: Object.fromEntries(['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY'].map((k) => [k, Boolean(process.env[k] || process.env[k.toLowerCase()])])),
  };
  ctx.facts.system = sys;

  ctx.add('system', 'Система', 'info', `${process.platform} ${os.release()} ${process.arch}, ${sys.cpu || 'процессор неизвестен'} (${sys.threads} потоков), ОЗУ ${sys.ramGB} ГБ`);
  if (sys.ramGB < 4) ctx.add('system', 'Оперативной памяти мало', 'warn', `${sys.ramGB} ГБ: локальная нейросеть будет медленной, Капри выберет облегчённый набор`);

  if (WIN) {
    const r = await ps(SYSTEM_QUERY, { timeout: 45000 });
    let win = null;
    try {
      win = JSON.parse(r.out.trim().split(/\r?\n/).pop());
    } catch {
      // not JSON
    }
    if (!win) {
      const why = r.error ? `не запустился (${r.error}): его нет в системе или запуск запрещён` : r.timedOut ? 'не ответил за 45 секунд' : (r.err || r.out || 'пустой ответ').trim().slice(0, 300);
      ctx.add('system', 'PowerShell не отвечает', 'fail', why, { code: r.code, timedOut: r.timedOut });
    } else {
      sys.windows = win;
      ctx.add('system', 'Windows', 'info', `${win.os || '?'} (сборка ${win.build || '?'}, ${win.osArch || '?'}), язык ${win.uiCulture || '?'}, PowerShell ${win.ps} ${win.edition}`);
      if (win.languageMode && win.languageMode !== 'FullLanguage') {
        ctx.add('system', 'PowerShell ограничен', 'fail', `Режим ${win.languageMode}: сценарии, которыми Капри двигает мышь и окна, здесь работать не будут (политика безопасности, AppLocker или WDAC)`);
      } else ctx.add('system', 'PowerShell может исполнять сценарии', 'pass', `режим ${win.languageMode}`);
      if (/MachinePolicy=(Restricted|AllSigned)|UserPolicy=(Restricted|AllSigned)/.test(win.policy || '')) {
        ctx.add('system', 'Политика запуска сценариев задана администратором', 'warn', `${win.policy}: ключ -ExecutionPolicy Bypass у Капри может быть отменён политикой`);
      }
      if ((win.av || []).length) ctx.add('system', 'Антивирус', 'info', win.av.join(', '));
      if (win.proxyEnabled || win.proxyPac) ctx.add('system', 'В системе включён прокси', 'warn', 'Загрузки Капри идут напрямую (без системного прокси): если сеть только через прокси, они не пройдут', { proxy: win.proxyServer ? 'есть' : 'PAC' });
      if (!(win.speechVoices || []).length) ctx.add('system', 'Голосов Windows (SAPI) нет', 'info', 'для полной проверки речь не из чего сгенерировать, часть теста распознавания будет пропущена');
      if (win.admin) ctx.add('system', 'Проверка запущена от администратора', 'warn', 'Капри обычно работает от обычного пользователя: окна и буфер обмена могут вести себя иначе');
    }
    const chcp = await exec('cmd.exe', ['/c', 'chcp'], { timeout: 5000 });
    sys.codepage = (chcp.out.match(/\d+/) || [''])[0];
  } else {
    sys.session = process.env.XDG_SESSION_TYPE || '';
  }

  if (sys.pathHasNonAscii) ctx.add('system', 'В путях есть не латинские буквы', 'info', 'это нормально, но на этом ПК Капри и проверяется именно так (русское имя пользователя и т. п.)');
  for (const [where, w] of Object.entries(sys.writable)) {
    if (!w) ctx.add('system', `Нельзя писать: ${where}`, 'fail', 'в эту папку не удалось создать файл');
  }
  for (const [where, d] of Object.entries(sys.disks)) {
    if (d.freeGB !== undefined && d.freeGB < 3 && where !== 'kit') ctx.add('system', `Мало места (${where})`, 'warn', `свободно ${d.freeGB} ГБ`);
  }

  // the programs
  const looked = await Promise.all(TOOLS.map(async ([name, args]) => {
    const found = await which(name);
    return [name, found ? { path: found, version: await version(found, args) } : null];
  }));
  const tools = Object.fromEntries(looked); // (in the order of the list, not of who answered first)
  sys.tools = tools;
  const seen = Object.entries(tools).filter(([, v]) => v).map(([k, v]) => `${k.replace(/\.cmd$/, '')} ${String(v.version || '').replace(/^v/, '').slice(0, 40)}`.trim());
  ctx.add('system', 'Программы, которыми пользуется Капри', 'info', seen.join('; ') || 'ничего из списка не найдено', { all: seen });
  if (!(tools.python || tools.python3 || tools.py)) ctx.add('system', 'Python не найден', 'info', 'нужен только для голоса Chatterbox: для Piper и распознавания речи не нужен');
  if (!tools.ollama) ctx.add('system', 'Ollama не установлена', 'info', 'Капри поставит её сама при первой подготовке (или используйте облачную нейросеть)');
  if (!tools['nvidia-smi']) ctx.add('system', 'Драйвер NVIDIA (nvidia-smi) не найден', 'info', 'если видеокарта не NVIDIA, так и должно быть');
}

// Capri's own look at the PC and what she would fetch for it
async function hardware(ctx) {
  if (!ctx.source) return;
  const dir = path.join(ctx.source, 'src', 'main');
  const scan = require(path.join(dir, 'setup', 'hardware.js'));
  const profiles = require(path.join(dir, 'setup', 'profiles.js'));
  const t0 = Date.now();
  const hw = await scan.scan({ dir: os.tmpdir() });
  const plan = profiles.plan(hw, {});
  ctx.facts.hardware = hw;
  ctx.facts.plan = { profile: plan.id, mind: plan.mind, voice: plan.voice, ears: plan.ears, disk: plan.disk, notes: plan.notes };
  const gpu = hw.gpu ? `${hw.gpu.name}${hw.gpu.vram ? ` (${round1(hw.gpu.vram / GB)} ГБ)` : ''}` : 'нет видеокарты';
  ctx.add('system', 'Как Капри видит этот ПК', hw.cpu && hw.cpu.name && hw.ram ? 'pass' : 'warn',
    `${hw.cpu.name || 'процессор не определён'}, ${hw.cpu.threads || '?'} потоков, ${round1(hw.ram / GB)} ГБ ОЗУ, ${gpu} (${Date.now() - t0} мс)`);
  if (!hw.cpu || !hw.cpu.name) ctx.add('system', 'Процессор не определился', 'warn', 'запрос к Windows не вернул модель: профиль будет выбран по памяти');
  if (hw.gpus && !hw.gpus.length && process.platform === 'win32') ctx.add('system', 'Видеокарт не найдено', 'warn', 'запрос к Windows не вернул ни одной (виртуальная машина или запрет запроса)');
  ctx.add('system', 'Что Капри поставит на этом ПК', 'info', `профиль «${plan.id}»: ${plan.mind && plan.mind.kind === 'ollama' ? `Ollama, ${plan.mind.model}` : 'облачная нейросеть'}, голос ${plan.voice && plan.voice.engine}, уши ${plan.ears ? plan.ears.tier : 'нет'}`);
}

module.exports = { snapshot, hardware, SYSTEM_QUERY };
