'use strict';

// Looking at the PC (src/main/hardware.js): the readers of what the system prints, and the scan with the
// system's answers made up for each kind of machine.
//   node --test tests/hardware.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const hw = require('../src/main/hardware.js');

const GB = 1024 ** 3;

test('nvidia-smi: the name, the memory in bytes, the driver and what the card can do', () => {
  const cards = hw.parseNvidiaSmi('NVIDIA GeForce RTX 3060, 12288, 552.22, 8.6\nNVIDIA GeForce GTX 1050 Ti, 4096, 552.22, 6.1\n');
  assert.equal(cards.length, 2);
  assert.deepEqual([cards[0].vendor, cards[0].vram, cards[0].driver, cards[0].compute, cards[0].integrated], ['nvidia', 12 * GB, '552.22', 8.6, false]);
  assert.equal(cards[1].vram, 4 * GB);
  assert.deepEqual(hw.parseNvidiaSmi('NVIDIA-SMI has failed because it could not communicate with the NVIDIA driver'), [], 'a message is not a card');
  assert.deepEqual(hw.parseNvidiaSmi(''), []);
  assert.equal(hw.parseNvidiaSmi('NVIDIA GeForce GTX 960, 2048, 391.35')[0].compute, 0, 'an old driver does not say what the card can do');
});

test('who made a card, and whether it shares the PC\'s memory', () => {
  assert.equal(hw.vendorOf('NVIDIA GeForce RTX 4070 Ti'), 'nvidia');
  assert.equal(hw.vendorOf('AMD Radeon RX 7800 XT'), 'amd');
  assert.equal(hw.vendorOf('Intel(R) UHD Graphics 630'), 'intel');
  assert.equal(hw.vendorOf('Intel(R) Arc(TM) A770 Graphics'), 'intel');
  assert.equal(hw.vendorOf('Microsoft Basic Display Adapter'), 'virtual');
  assert.equal(hw.vendorOf('VMware SVGA 3D'), 'virtual');
  assert.equal(hw.card({ name: 'AMD Radeon(TM) Graphics', vram: 512 * 1048576 }).integrated, true, 'the graphics inside a Ryzen');
  assert.equal(hw.card({ name: 'Intel(R) UHD Graphics 630', vram: 1 * GB }).integrated, true);
  assert.equal(hw.card({ name: 'Intel(R) Arc(TM) A770 Graphics', vram: 16 * GB }).integrated, false);
  assert.equal(hw.card({ name: 'AMD Radeon RX 6600', vram: 8 * GB }).integrated, false);
  assert.equal(hw.card({ name: 'NVIDIA GeForce MX150', vram: 2 * GB }).integrated, false, 'an NVIDIA card is a card of its own');
  assert.equal(hw.card({ name: 'Apple M2', vram: 10 * GB, unified: true }).integrated, true);
});

test('Windows: PowerShell\'s JSON is read, and the registry knows the memory of a card past 4 GB', () => {
  const one = hw.parseWindows(JSON.stringify({
    cpu: { Name: 'Intel(R) Core(TM) i5-12400F', NumberOfCores: 6, NumberOfLogicalProcessors: 12 },
    gpu: { Name: 'NVIDIA GeForce RTX 3060', AdapterRAM: 4293918720, DriverVersion: '31.0.15.5222' }, // (a single card is not a list)
    reg: { name: 'NVIDIA GeForce RTX 3060', mem: 12884901888 },
  }));
  assert.equal(one.cpu.name, 'Intel(R) Core(TM) i5-12400F');
  assert.deepEqual([one.cpu.cores, one.cpu.threads], [6, 12]);
  assert.equal(one.gpus.length, 1);
  assert.equal(one.gpus[0].vram, 12 * GB, 'not the 32-bit number of the system, which stops under 4 GB');
  const two = hw.parseWindows(JSON.stringify({
    cpu: { Name: 'AMD Ryzen 5 5600H  with Radeon Graphics' },
    gpu: [{ Name: 'AMD Radeon(TM) Graphics', AdapterRAM: 536870912 }, { Name: 'NVIDIA GeForce GTX 1650', AdapterRAM: 4293918720 }],
    reg: [{ name: 'AMD Radeon(TM) Graphics', mem: [0, 0, 0, 32, 0, 0, 0, 0] }, { name: 'NVIDIA GeForce GTX 1650', mem: 4294967296 }],
  }));
  assert.equal(two.cpu.name, 'AMD Ryzen 5 5600H with Radeon Graphics', 'the spaces are squeezed');
  assert.equal(two.gpus[0].vram, 512 * 1048576, 'an older driver keeps the number as bytes: 0x20000000');
  assert.equal(hw.registryMemory([0, 0, 0, 32, 0, 0, 0, 0]), 536870912);
  assert.equal(two.gpus[1].vram, 4 * GB);
  assert.equal(hw.parseWindows('not json'), null);
  assert.equal(hw.parseWindows('﻿{"cpu":{"Name":"x"}}').cpu.name, 'x', 'a byte-order mark is no trouble');
});

test('an NVIDIA driver as Windows tells it (31.0.15.5222) is the number everybody knows (552.22), and the newest cards are known by name', () => {
  assert.equal(hw.nvidiaDriver('31.0.15.5222'), '552.22');
  assert.equal(hw.nvidiaDriver('27.21.14.5671'), '456.71');
  assert.equal(hw.nvidiaDriver('32.0.15.7602'), '576.02');
  assert.equal(hw.nvidiaDriver('552.22'), '552.22', 'nvidia-smi\'s own form is left');
  assert.equal(hw.nvidiaDriver(''), '');
  const win = hw.parseWindows(JSON.stringify({ cpu: { Name: 'x' }, gpu: [{ Name: 'NVIDIA GeForce RTX 3060', AdapterRAM: 4293918720, DriverVersion: '31.0.15.5222' }, { Name: 'Intel(R) UHD Graphics', AdapterRAM: 1073741824, DriverVersion: '31.0.101.2111' }], reg: [] }));
  assert.equal(win.gpus[0].driver, '552.22');
  assert.equal(win.gpus[1].driver, '31.0.101.2111', 'only NVIDIA\'s numbers are translated');
  assert.equal(hw.card({ name: 'NVIDIA GeForce RTX 5070 Ti', vram: 16 * GB }).compute, 12, 'Blackwell, without nvidia-smi to say');
  assert.equal(hw.card({ name: 'NVIDIA GeForce RTX 4070', vram: 12 * GB }).compute, 0);
  assert.equal(hw.card({ name: 'NVIDIA GeForce RTX 4070', vram: 12 * GB, compute: 8.9 }).compute, 8.9, 'nvidia-smi\'s word stands');
});

test('nvidia-smi is looked for where a 32-bit build of her can reach it too (Sysnative)', async () => {
  const tried = [];
  const execFile = (cmd, _args, _opts, cb) => {
    tried.push(cmd);
    if (/Sysnative/.test(cmd)) return cb(null, 'NVIDIA GeForce RTX 4060, 8188, 560.94, 8.9\n');
    return cb(new Error('not found'));
  };
  const pc = await hw.scan({ platform: 'win32', arch: 'ia32', env: { SystemRoot: 'C:\\Windows', PROCESSOR_ARCHITEW6432: 'AMD64' }, execFile, dir: os.tmpdir() });
  assert.equal(pc.gpu.name, 'NVIDIA GeForce RTX 4060');
  assert.equal(pc.gpu.vram, 8188 * 1048576);
  assert.ok(tried.some((c) => /Sysnative/.test(c)));
});

test('the PowerShell she sends is one encoded command (nothing to quote wrongly) and says what it asks', () => {
  const decoded = Buffer.from(hw.encodePowerShell(hw.WINDOWS_QUERY), 'base64').toString('utf16le');
  assert.equal(decoded, hw.WINDOWS_QUERY);
  assert.match(decoded, /Win32_Processor/);
  assert.match(decoded, /Win32_VideoController/);
  assert.match(decoded, /HardwareInformation\.qwMemorySize/);
  assert.match(decoded, /ConvertTo-Json/);
});

test('Linux: the processor from /proc/cpuinfo, the cards from lspci', () => {
  const info = 'processor\t: 0\nmodel name\t: Intel(R) Xeon(R) CPU @ 2.80GHz\n\nprocessor\t: 1\nmodel name\t: Intel(R) Xeon(R) CPU @ 2.80GHz\n';
  assert.deepEqual(hw.parseCpuinfo(info), { name: 'Intel(R) Xeon(R) CPU @ 2.80GHz', threads: 2 });
  const lspci = '00:02.0 "VGA compatible controller" "Intel Corporation" "UHD Graphics 630" -r02 "Dell" "Device 0870"\n'
    + '01:00.0 "3D controller" "NVIDIA Corporation" "GA104 [GeForce RTX 3070]" -ra1 "Dell" "Device 0870"\n00:1f.3 "Audio device" "Intel" "Cannon Lake"\n';
  const cards = hw.parseLspci(lspci);
  assert.equal(cards.length, 2);
  assert.equal(cards[0].vendor, 'intel');
  assert.equal(cards[1].vendor, 'nvidia');
});

test('the disk: the free space of the nearest folder that exists; the system\'s bits, even for her 32-bit build on a 64-bit Windows', () => {
  const asked = [];
  const d = hw.diskOf('/nowhere/at/all/models', { exists: (p) => p === '/', statfs: (p) => { asked.push(p); return { bavail: 100, bsize: 1 * GB, blocks: 500 }; } });
  assert.deepEqual([d.path, d.free, d.total], ['/', 100 * GB, 500 * GB]);
  assert.deepEqual(asked, ['/']);
  assert.deepEqual(hw.diskOf('/x', { exists: () => true, statfs: () => { throw new Error('no'); } }).free, Infinity, 'unknown is not "full"');
  assert.equal(hw.systemIs64('x64', {}), true);
  assert.equal(hw.systemIs64('ia32', { PROCESSOR_ARCHITECTURE: 'x86', PROCESSOR_ARCHITEW6432: 'AMD64' }), true, 'a 32-bit process on a 64-bit Windows');
  assert.equal(hw.systemIs64('ia32', { PROCESSOR_ARCHITECTURE: 'x86' }), false, 'a 32-bit Windows');
  assert.equal(hw.systemIs64('arm64', {}), true);
});

test('the best card is the biggest real one: a dedicated card over the processor\'s graphics, never a virtual one', () => {
  const cards = [
    hw.card({ name: 'Intel(R) UHD Graphics', vram: 2 * GB }),
    hw.card({ name: 'NVIDIA GeForce GTX 1660', vram: 6 * GB }),
    hw.card({ name: 'Microsoft Basic Display Adapter', vram: 16 * GB }),
  ];
  assert.equal(hw.bestCard(cards).name, 'NVIDIA GeForce GTX 1660');
  assert.equal(hw.bestCard([hw.card({ name: 'Intel(R) UHD Graphics', vram: 1 * GB })]).vendor, 'intel', 'only the processor\'s graphics: that one');
  assert.equal(hw.bestCard([hw.card({ name: 'VMware SVGA 3D' })]), null);
  assert.equal(hw.bestCard([]), null);
});

test('scan on Windows: PowerShell and nvidia-smi answer, and nvidia-smi\'s memory and driver win over the system\'s', async () => {
  const calls = [];
  const execFile = (cmd, args, _opts, cb) => {
    calls.push(path.basename(cmd));
    if (/powershell/i.test(cmd)) {
      return cb(null, JSON.stringify({
        cpu: { Name: 'Intel(R) Core(TM) i7-9700K', NumberOfCores: 8, NumberOfLogicalProcessors: 8 },
        gpu: [{ Name: 'NVIDIA GeForce RTX 2070', AdapterRAM: 4293918720, DriverVersion: '31.0.15.3623' }],
        reg: [],
      }));
    }
    if (/nvidia-smi/.test(cmd)) return cb(null, 'NVIDIA GeForce RTX 2070, 8192, 536.23, 7.5\n');
    return cb(new Error('not here'));
  };
  const pc = await hw.scan({ platform: 'win32', arch: 'x64', env: {}, execFile, dir: os.tmpdir() });
  assert.equal(pc.os.is64, true);
  assert.equal(pc.cpu.name, 'Intel(R) Core(TM) i7-9700K');
  assert.equal(pc.gpus.length, 1, 'the same card, not twice');
  assert.deepEqual([pc.gpu.vram, pc.gpu.driver, pc.gpu.compute], [8 * GB, '536.23', 7.5]);
  assert.ok(pc.disk.free > 0);
  assert.ok(calls.includes('powershell.exe') && calls.includes('nvidia-smi'));
});

test('scan on Windows with neither PowerShell nor a card: it still says what it can (memory, the system), and does not throw', async () => {
  const pc = await hw.scan({ platform: 'win32', arch: 'ia32', env: { PROCESSOR_ARCHITECTURE: 'x86' }, execFile: (_c, _a, _o, cb) => cb(new Error('nothing')), dir: os.tmpdir() });
  assert.equal(pc.os.is64, false);
  assert.deepEqual(pc.gpus, []);
  assert.equal(pc.gpu, null);
  assert.ok(pc.ram > 0);
});

test('scan on a Mac with Apple silicon: the chip is the card, and it shares the memory', async () => {
  const pc = await hw.scan({ platform: 'darwin', arch: 'arm64', env: {}, execFile: (cmd, _a, _o, cb) => cb(null, 'Apple M2 Pro\n'), dir: os.tmpdir() });
  assert.equal(pc.cpu.name, 'Apple M2 Pro');
  assert.equal(pc.gpu.unified, true);
  assert.ok(pc.gpu.vram > 0 && pc.gpu.vram < pc.ram);
});

test('make() takes the older plain description ({ ram, vram }) as a whole picture', () => {
  const pc = hw.normalize({ ram: 16 * GB, vram: 8 * GB });
  assert.equal(pc.os.is64, true);
  assert.equal(pc.gpu.vram, 8 * GB);
  assert.equal(pc.gpu.vendor, 'nvidia');
  assert.equal(hw.normalize({ ram: 4 * GB, vram: 0 }).gpu, null);
  assert.equal(hw.normalize(pc), pc, 'a whole picture is left alone');
  assert.equal(hw.normalize(undefined).ram, 0);
});

test('scan here: whatever machine this is, it gives a whole picture', async () => {
  const pc = await hw.scan({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'capri-hw-')) });
  assert.ok(pc.ram > 0 && pc.cpu.threads > 0 && pc.disk.free > 0);
  assert.equal(typeof pc.os.is64, 'boolean');
  assert.ok(Array.isArray(pc.gpus));
});
