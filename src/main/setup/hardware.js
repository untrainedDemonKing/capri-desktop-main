'use strict';

// What this PC is, for choosing what she can live on (profiles.js): the system and its bits, the processor, the
// memory, the graphics card(s) with their own memory, and the free space on the disk her things go to. One
// look, a second or two (Windows is asked through PowerShell once). Every outside call is injectable, and the
// parsing of what they print is plain functions, so it is tested without the machines.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const GB = 1024 ** 3;
const MB = 1024 ** 2;

function vendorOf(name = '') {
  if (/nvidia|geforce|quadro|\brtx\b|\bgtx\b|tesla|titan/i.test(name)) return 'nvidia';
  if (/\bamd\b|radeon|\bati\b|firepro/i.test(name)) return 'amd';
  if (/intel|iris|\buhd\b|\bhd graphics\b|\barc\b/i.test(name)) return 'intel';
  if (/apple/i.test(name)) return 'apple';
  if (/microsoft basic|remote display|virtual|vmware|virtualbox|vbox|parallels|hyper-v|qxl|cirrus|llvmpipe|swiftshader/i.test(name)) return 'virtual';
  return 'other';
}

// one card from what the system says: { vendor, name, vram (bytes), driver, compute, integrated, unified }
function card({ name, vram = 0, driver = '', compute = 0, unified = false }) {
  const vendor = vendorOf(name);
  // (a card that shares the PC's memory is no help to a model: the processor graphics of Intel and AMD, an Apple chip)
  const integrated = unified || (vendor !== 'nvidia' && (Number(vram) < 3 * GB || /uhd|iris|hd graphics|radeon(\(tm\))? graphics$|vega \d+ graphics/i.test(name)));
  // (without nvidia-smi nothing tells what the newest cards can do: the name does)
  const known = Number(compute) || (vendor === 'nvidia' && /rtx\s*(pro\s*)?[56]\d{3}\b.*blackwell|rtx\s*50\d{2}|blackwell/i.test(name) ? 12 : 0);
  return { vendor, name: String(name || '').trim(), vram: Math.max(0, Number(vram) || 0), driver: String(driver || ''), compute: known, integrated, unified };
}

// Windows tells an NVIDIA driver as 31.0.15.5222; the number everybody (and PyTorch's table) knows is 552.22:
// the last five digits of the last two parts
function nvidiaDriver(version) {
  const m = /^\d+\.\d+\.(\d+)\.(\d+)$/.exec(String(version || ''));
  if (!m) return String(version || '');
  const digits = `${m[1]}${m[2]}`.slice(-5);
  return `${digits.slice(0, 3)}.${digits.slice(3)}`;
}

// nvidia-smi --query-gpu=name,memory.total,driver_version,compute_cap --format=csv,noheader,nounits
function parseNvidiaSmi(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const parts = line.split(',').map((p) => p.trim());
    if (parts.length < 2 || !parts[0] || !/^\d+(\.\d+)?$/.test(parts[1])) continue;
    out.push(card({ name: parts[0], vram: Number(parts[1]) * MB, driver: parts[2] || '', compute: parts[3] && /^\d+(\.\d+)?$/.test(parts[3]) ? parts[3] : 0 }));
  }
  return out;
}

// the memory of a card as the registry keeps it: a number, or (older drivers) the bytes of a 64-bit number
function registryMemory(mem) {
  if (Array.isArray(mem)) return mem.slice(0, 8).reduce((n, b, i) => n + (Number(b) || 0) * 256 ** i, 0);
  return Number(mem) || 0;
}

const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);

// PowerShell's JSON: { cpu: { Name, NumberOfCores, NumberOfLogicalProcessors }, gpu: [{ Name, AdapterRAM, DriverVersion }], reg: [{ name, mem }] }
function parseWindows(text) {
  let data;
  try {
    data = JSON.parse(String(text).replace(/^\uFEFF/, '').trim());
  } catch {
    return null;
  }
  const cpu = list(data.cpu)[0] || {};
  const reg = list(data.reg).map((r) => ({ name: String(r.name || ''), mem: registryMemory(r.mem) }));
  const gpus = list(data.gpu).map((g) => {
    // (AdapterRAM is a 32-bit number: it stops at 4 GB, so the registry's, when there is one for the card, is the truth)
    const own = reg.find((r) => r.name && r.name === g.Name && r.mem);
    return card({ name: g.Name, vram: own ? own.mem : Number(g.AdapterRAM) || 0, driver: vendorOf(g.Name) === 'nvidia' ? nvidiaDriver(g.DriverVersion) : g.DriverVersion });
  });
  return { cpu: { name: String(cpu.Name || '').replace(/\s+/g, ' ').trim(), cores: Number(cpu.NumberOfCores) || 0, threads: Number(cpu.NumberOfLogicalProcessors) || 0 }, gpus };
}

// the PowerShell that asks (sent encoded: no quoting to get wrong)
const WINDOWS_QUERY = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  '$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1 Name, NumberOfCores, NumberOfLogicalProcessors',
  '$gpu = @(Get-CimInstance Win32_VideoController | Select-Object Name, AdapterRAM, DriverVersion)',
  "$reg = @(Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*' | ForEach-Object { [pscustomobject]@{ name = $_.DriverDesc; mem = $_.'HardwareInformation.qwMemorySize' } })",
  '[pscustomobject]@{ cpu = $cpu; gpu = $gpu; reg = $reg } | ConvertTo-Json -Depth 4 -Compress',
].join('; ');
const encodePowerShell = (script) => Buffer.from(script, 'utf16le').toString('base64');

function parseCpuinfo(text) {
  const name = /model name\s*:\s*(.+)/i.exec(text)?.[1] || /hardware\s*:\s*(.+)/i.exec(text)?.[1] || '';
  const threads = (String(text).match(/^processor\s*:/gim) || []).length;
  return { name: name.replace(/\s+/g, ' ').trim(), threads };
}

// `lspci -mm` lines of the display adapters: names only (the memory of those cards is not told there)
function parseLspci(text) {
  return String(text).split(/\r?\n/).filter((l) => /vga compatible|3d controller|display controller/i.test(l))
    .map((l) => {
      const q = [...l.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
      return q.length >= 3 ? `${q[1]} ${q[2]}`.replace(/\s*\[[^\]]*\]/g, (m) => ` ${m.slice(1, -1)}`).replace(/\s+/g, ' ').trim() : '';
    }).filter(Boolean).map((name) => card({ name }));
}

function run(execFile, cmd, args, timeout = 8000) {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' }, (err, out) => resolve(err ? '' : String(out)));
    } catch {
      resolve('');
    }
  });
}

// the free and total bytes of the disk `dir` is on (the nearest folder that exists)
function diskOf(dir, { statfs = fs.statfsSync, exists = fs.existsSync } = {}) {
  let at = path.resolve(dir || '.');
  while (!exists(at) && path.dirname(at) !== at) at = path.dirname(at);
  try {
    const s = statfs(at);
    return { path: at, free: Number(s.bavail) * Number(s.bsize), total: Number(s.blocks) * Number(s.bsize) };
  } catch {
    return { path: at, free: Infinity, total: 0 };
  }
}

// Whether the system is 64-bit, even for her 32-bit build running on it (WOW64 says so in the environment)
function systemIs64(arch = process.arch, env = process.env) {
  return arch === 'x64' || arch === 'arm64' || Boolean(env.PROCESSOR_ARCHITEW6432) || /64/.test(env.PROCESSOR_ARCHITECTURE || '');
}

// the card that matters: the biggest dedicated one, else the biggest of any
function bestCard(gpus) {
  const usable = gpus.filter((g) => g.vendor !== 'virtual');
  const dedicated = usable.filter((g) => !g.integrated);
  const pool = dedicated.length ? dedicated : usable;
  return pool.slice().sort((a, b) => b.vram - a.vram)[0] || null;
}

// Looks at this PC. `dir`: where her things go (for the free space). Resolves the shape make() builds.
async function scan({ dir = '', execFile = cp.execFile, platform = process.platform, arch = process.arch, env = process.env, osx = os, statfs, exists } = {}) {
  const started = Date.now();
  let cpu = { name: '', cores: 0, threads: 0 };
  let gpus = [];
  if (platform === 'win32') {
    const [windows, smi] = await Promise.all([
      run(execFile, 'powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodePowerShell(WINDOWS_QUERY)], 20000),
      nvidiaSmi(execFile, platform, env),
    ]);
    const parsed = parseWindows(windows);
    if (parsed) {
      cpu = parsed.cpu;
      gpus = parsed.gpus;
    }
    mergeNvidia(gpus, parseNvidiaSmi(smi));
  } else if (platform === 'darwin') {
    const brand = (await run(execFile, 'sysctl', ['-n', 'machdep.cpu.brand_string'])).trim();
    cpu = { name: brand || osx.cpus()[0]?.model || '', cores: 0, threads: 0 };
    if (arch === 'arm64' || /apple/i.test(brand)) gpus = [card({ name: brand || 'Apple Silicon', vram: osx.totalmem() * 0.66, unified: true })];
  } else {
    let cpuinfo = '';
    try {
      cpuinfo = fs.readFileSync('/proc/cpuinfo', 'utf8');
    } catch {
      // not Linux proper
    }
    cpu = { ...cpu, ...parseCpuinfo(cpuinfo) };
    const [smi, lspci] = await Promise.all([nvidiaSmi(execFile, platform, env), run(execFile, 'lspci', ['-mm'])]);
    gpus = parseLspci(lspci);
    mergeNvidia(gpus, parseNvidiaSmi(smi));
  }
  return make({ platform, arch, env, osx, cpu, gpus, dir, statfs, exists, ms: Date.now() - started });
}

function nvidiaSmi(execFile, platform, env) {
  // (a 32-bit build of her on a 64-bit Windows is sent to SysWOW64 when it asks for System32: "Sysnative" is the real one)
  const files = platform === 'win32'
    ? ['nvidia-smi', path.join(env.SystemRoot || 'C:\\Windows', 'System32', 'nvidia-smi.exe'), path.join(env.SystemRoot || 'C:\\Windows', 'Sysnative', 'nvidia-smi.exe'),
      path.join(env.ProgramW6432 || env.ProgramFiles || 'C:\\Program Files', 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe')]
    : ['nvidia-smi'];
  const full = ['--query-gpu=name,memory.total,driver_version,compute_cap', '--format=csv,noheader,nounits'];
  const plain = ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader,nounits']; // (older drivers do not know compute_cap)
  return (async () => {
    for (const file of files) {
      const text = (await run(execFile, file, full, 6000)) || (await run(execFile, file, plain, 6000));
      if (text.trim()) return text;
    }
    return '';
  })();
}

// nvidia-smi knows an NVIDIA card's real memory, driver and capability: it replaces what the system listed, or adds the card
function mergeNvidia(gpus, smi) {
  for (const s of smi) {
    const at = gpus.findIndex((g) => g.vendor === 'nvidia' && (g.name === s.name || g.name.includes(s.name) || s.name.includes(g.name)));
    if (at >= 0) gpus[at] = { ...gpus[at], ...s, name: gpus[at].name || s.name };
    else gpus.push(s);
  }
}

// The picture of a PC in the one shape everything else reads. Also what the tests build their machines with.
function make({
  platform = 'win32', arch = 'x64', env = {}, osx = os, cpu = {}, gpus = [], ram = osx.totalmem(), ramFree = osx.freemem?.() ?? 0, dir = '', disk, statfs, exists, ms = 0,
} = {}) {
  const cards = gpus.map((g) => (g.integrated === undefined ? card(g) : g));
  return {
    os: { platform, arch, release: osx.release?.() || '', is64: systemIs64(arch, env) },
    cpu: { name: cpu.name || '', cores: cpu.cores || 0, threads: cpu.threads || cpu.cores || osx.cpus?.().length || 0 },
    ram, ramFree,
    gpus: cards,
    gpu: bestCard(cards),
    disk: disk || diskOf(dir, { statfs, exists }),
    ms,
  };
}

// An older, plainer description ({ ram, vram } and nothing else) or none, as the same shape
function normalize(h) {
  if (h && h.os && h.gpus) return h;
  const { ram = 0, vram = 0, ...rest } = h || {};
  return make({
    platform: process.platform, arch: 'x64', env: { PROCESSOR_ARCHITECTURE: 'AMD64' }, ram, ramFree: ram,
    cpu: { name: '', cores: 8, threads: 8 }, gpus: vram ? [{ name: 'NVIDIA GPU', vram }] : [], disk: { path: '', free: Infinity, total: 0 }, ...rest,
  });
}

module.exports = { scan, make, normalize, card, vendorOf, nvidiaDriver, parseNvidiaSmi, parseWindows, parseCpuinfo, parseLspci, registryMemory, diskOf, systemIs64, bestCard, mergeNvidia, WINDOWS_QUERY, encodePowerShell, GB };
