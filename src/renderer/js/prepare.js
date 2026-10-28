// Her preparation window: what she is getting ready, step by step, how far each is, and what failed with
// the buttons that may help. Everything it shows comes from the main process (prepare.js there), through the
// small `prepare` bridge of prepare-preload.js. A classic script (the page's CSP allows only its own).
(() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const ICON = { pending: '·', running: '…', done: '✓', failed: '!', skipped: '–' };
  let ui = {};
  let snap = null;
  const open = new Set(); // steps whose details are open

  const stepName = (id) => ui[id] || id;
  const groupState = (steps) => {
    if (steps.some((s) => s.state === 'failed')) return 'failed';
    if (steps.every((s) => s.state === 'done')) return 'done';
    return steps.some((s) => s.state === 'running') ? 'running' : 'pending';
  };
  const ACTIONS = {
    retry: (s) => ({ label: ui.retry, run: () => window.prepare.retry(s.id) }),
    'choose-ollama': () => ({ label: ui.chooseOllama, run: () => window.prepare.choose('ollama') }),
    'choose-chatterbox': () => ({ label: ui.chooseChatterbox, run: () => window.prepare.choose('chatterbox') }),
    'choose-piper': () => ({ label: ui.choosePiper, run: () => window.prepare.choose('piper') }),
    'open-ollama-site': () => ({ label: ui.openOllamaSite, run: () => window.prepare.open('https://ollama.com/download') }),
    'open-python-site': () => ({ label: ui.openPythonSite, run: () => window.prepare.open('https://www.python.org/downloads/') }),
  };

  function stepRow(s) {
    const row = el('div', 'step');
    row.dataset.state = s.state;
    row.dataset.id = s.id;
    row.append(el('div', 'step__icon', ICON[s.state] || '·'));
    const body = el('div', 'step__body');
    body.append(el('div', 'step__name', stepName(s.id)));
    if (s.state === 'pending') body.append(el('div', 'step__detail', ui.pending));
    else if (s.detail) body.append(el('div', 'step__detail', s.detail));
    if (s.state === 'running' && (s.heavy || s.progress !== null)) {
      const bar = el('div', 'bar');
      const fill = el('i');
      if (s.progress === null) bar.dataset.unknown = 'true';
      else fill.style.width = `${Math.round(s.progress * 100)}%`;
      bar.append(fill);
      bar.setAttribute('role', 'progressbar');
      if (s.progress !== null) bar.setAttribute('aria-valuenow', String(Math.round(s.progress * 100)));
      body.append(bar);
    }
    if (s.state === 'failed') {
      if (s.error && s.error !== s.detail) body.append(el('div', 'step__error', s.error));
      const btns = el('div', 'step__btns');
      for (const id of s.actions || []) {
        const make = ACTIONS[id];
        if (!make) continue;
        const a = make(s);
        const b = el('button', 'btn btn--small', a.label);
        b.type = 'button';
        b.addEventListener('click', a.run);
        btns.append(b);
      }
      if (s.log?.length) {
        const more = el('button', 'btn btn--small', ui.details);
        more.type = 'button';
        more.addEventListener('click', () => { if (open.has(s.id)) open.delete(s.id); else open.add(s.id); render(); });
        btns.append(more);
      }
      body.append(btns);
      if (open.has(s.id) && s.log?.length) body.append(el('pre', 'step__log', s.log.join('\n')));
    }
    row.append(body);
    return row;
  }

  const fill = (text, args = {}) => String(text).replace(/\{(\w+)\}/g, (_m, k) => (args[k] === undefined ? '' : args[k]));
  const fmtBytes = (n) => {
    const ru = document.documentElement.lang === 'ru';
    return n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} ${ru ? 'ГБ' : 'GB'}` : `${Math.max(1, Math.round(n / 1048576))} ${ru ? 'МБ' : 'MB'}`;
  };
  let choice = null; // the profile picked in the list, not yet applied

  // the PC she has looked at, the profile it got, and what that means to fetch
  function renderPc() {
    const box = $('pc');
    const scan = snap.steps.find((s) => s.id === 'scan');
    if (!snap.pc || !snap.profile) {
      // (before the look is done: just its row)
      box.hidden = !scan || scan.state === 'pending';
      $('pcFacts').replaceChildren();
      $('planLine').textContent = '';
      $('notes').replaceChildren();
      $('pcScan').replaceChildren(...(scan && !box.hidden ? [stepRow(scan)] : []));
      $('pcTitle').textContent = ui.groupPc;
      $('pcTag').textContent = '';
      for (const id of ['profile', 'applyProfile', 'rescan']) $(id).hidden = true;
      $('profileLabel').hidden = true;
      return;
    }
    box.hidden = false;
    for (const id of ['profile', 'applyProfile', 'rescan']) $(id).hidden = false;
    $('profileLabel').hidden = false;
    box.dataset.state = scan && scan.state === 'failed' ? 'failed' : 'done';
    $('pcTitle').textContent = ui.groupPc;
    const p = snap.profile;
    $('pcTag').textContent = `${ui[`profile-${p.id}`]} · ${p.auto ? ui.profileAutoNow : ui.profileAsked}`;
    const pc = snap.pc;
    const facts = [
      [ui.pcCpu, [pc.cpu, pc.threads ? fill(ui.pcThreads, { n: pc.threads }) : ''].filter(Boolean).join(' · ') || '?'],
      [ui.pcRam, fmtBytes(pc.ram)],
      [ui.pcGpu, pc.gpu && !pc.gpu.integrated ? `${pc.gpu.name}${pc.gpu.vram ? ` · ${fmtBytes(pc.gpu.vram)}` : ''}` : ui.pcNoGpu],
      ...(pc.diskFree ? [[ui.pcDisk, fmtBytes(pc.diskFree)]] : []),
      [ui.pcOs, `${ui[`os-${pc.os}`] || pc.os} ${fill(ui.pcBits, { n: pc.bits })}`],
    ];
    $('pcFacts').replaceChildren(...facts.flatMap(([k, v]) => [el('dt', '', k), el('dd', '', v)]));
    const voice = p.voice.engine;
    const device = p.voice.device ? ui[`device-${p.voice.device}`] : '';
    $('planLine').textContent = fill(ui.planLine, {
      mind: p.mind.kind === 'cloud' ? ui.mindCloud : `${p.mind.model} (${fmtBytes(p.mind.bytes)})`,
      voice: fill(ui[`voiceName-${voice}`] || voice, { device }).trim(),
      size: p.download.total > 0 ? fmtBytes(p.download.total) : ui.planNothing,
    });
    $('notes').replaceChildren(...p.notes.filter((n) => ui[`note-${n}`] && !(n === 'diskLighter' && p.id === 'cloud')).map((n) => el('li', '', ui[`note-${n}`])));
    $('pcScan').replaceChildren(...(scan && (scan.state === 'failed' || scan.state === 'running') ? [stepRow(scan)] : []));
    // the list of profiles
    const select = $('profile');
    if (select.options.length !== p.choices.length + 1) {
      select.replaceChildren(...['auto', ...p.choices].map((id) => {
        const o = el('option', '', id === 'auto' ? ui.profileAuto : `${ui[`profile-${id}`]}: ${ui[`profileWhat-${id}`]}`);
        o.value = id;
        return o;
      }));
    }
    if (choice === null) select.value = p.auto ? 'auto' : p.id;
    select.disabled = snap.running;
    $('rescan').disabled = snap.running;
    $('applyProfile').disabled = snap.running || choice === null || choice === (p.auto ? 'auto' : p.id);
    $('openAi').hidden = p.mind.kind !== 'cloud';
  }

  function render() {
    if (!snap) return;
    renderPc();
    const groups = $('groups');
    groups.replaceChildren();
    for (const id of ['ollama', 'voice']) {
      const steps = snap.steps.filter((s) => s.group === id && s.state !== 'skipped');
      if (!steps.length) continue;
      const box = el('section', 'group');
      box.dataset.state = groupState(steps);
      box.dataset.group = id;
      const title = id === 'ollama' ? ui.groupOllama : snap.plan.piper ? ui.groupPiper : ui.groupChatterbox;
      box.append(el('h2', 'group__title', title));
      for (const s of steps) box.append(stepRow(s));
      groups.append(box);
    }
    const failed = snap.steps.some((s) => s.state === 'failed');
    const summary = $('summary');
    if (snap.running) {
      summary.textContent = ui.working;
      summary.dataset.kind = '';
    } else if (snap.finished && snap.ok) {
      summary.textContent = groups.children.length ? ui.allDone : ui.nothing;
      summary.dataset.kind = 'ok';
    } else if (failed) {
      summary.textContent = ui.someFailed;
      summary.dataset.kind = 'bad';
    } else {
      summary.textContent = '';
    }
    $('skip').hidden = !snap.running;
    $('retryAll').hidden = snap.running || !failed;
  }

  async function init() {
    const first = await window.prepare.state();
    ui = first.ui;
    document.documentElement.lang = first.lang || 'en';
    document.title = ui.title;
    $('title').textContent = ui.title;
    $('subtitle').textContent = ui.subtitle;
    $('neverLabel').textContent = ui.never;
    $('never').checked = first.never === true;
    $('copy').textContent = ui.copyReport;
    $('retryAll').textContent = ui.retryAll;
    $('skip').textContent = ui.skip;
    $('close').textContent = ui.close;
    $('profileLabel').textContent = ui.profileTitle;
    $('applyProfile').textContent = ui.applyProfile;
    $('rescan').textContent = ui.rescan;
    $('openAi').textContent = ui.openAi;
    $('profile').addEventListener('change', (e) => { choice = e.target.value; render(); });
    $('applyProfile').addEventListener('click', async () => {
      const id = choice;
      choice = null;
      if (id !== null) await window.prepare.profile(id);
    });
    $('rescan').addEventListener('click', () => window.prepare.rescan());
    $('openAi').addEventListener('click', () => window.prepare.openAi());
    $('never').addEventListener('change', (e) => window.prepare.never(e.target.checked));
    $('copy').addEventListener('click', async () => {
      const text = await window.prepare.report();
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        window.prepare.copy(text); // (the clipboard of this page is not allowed: the main process's)
      }
      $('copy').textContent = ui.copied;
      setTimeout(() => { $('copy').textContent = ui.copyReport; }, 1500);
    });
    $('retryAll').addEventListener('click', () => window.prepare.retry(null));
    $('skip').addEventListener('click', () => window.prepare.skip());
    $('close').addEventListener('click', () => window.prepare.close());
    snap = first.snapshot;
    render();
    window.prepare.onChange((next) => { snap = next; render(); });
  }
  init();
})();
