// Her preparation window: what she is getting ready, step by step, how far each is, and what failed with
// the buttons that may help. Everything it shows comes from the main process (prepare.js there), through the
// small `prepare` bridge of prepare-preload.js. A classic script (the page's CSP allows only its own).
(() => {
  const { el, fill, fmtBytes, renderGroups } = window.StepsView;
  const $ = (id) => document.getElementById(id);
  let ui = {};
  let snap = null;
  const open = new Set(); // steps whose details are open

  const ACTIONS = {
    retry: (s) => ({ label: ui.retry, run: () => window.prepare.retry(s.id) }),
    'choose-ollama': () => ({ label: ui.chooseOllama, run: () => window.prepare.choose('ollama') }),
    'choose-chatterbox': () => ({ label: ui.chooseChatterbox, run: () => window.prepare.choose('chatterbox') }),
    'choose-piper': () => ({ label: ui.choosePiper, run: () => window.prepare.choose('piper') }),
    'open-ollama-site': () => ({ label: ui.openOllamaSite, run: () => window.prepare.open('https://ollama.com/download') }),
    'open-node-site': () => ({ label: ui.openNodeSite, run: () => window.prepare.open('https://nodejs.org/en/download') }),
    'open-python-site': () => ({ label: ui.openPythonSite, run: () => window.prepare.open('https://www.python.org/downloads/') }),
  };

  const toggleLog = (id) => { if (open.has(id)) open.delete(id); else open.add(id); render(); };
  const oneRow = (s) => window.StepsView.stepRow(s, { ui, actions: ACTIONS, open, toggle: toggleLog });
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
      $('pcScan').replaceChildren(...(scan && !box.hidden ? [oneRow(scan)] : []));
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
    $('pcScan').replaceChildren(...(scan && (scan.state === 'failed' || scan.state === 'running') ? [oneRow(scan)] : []));
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
    renderGroups(snap, groups, { ui, actions: ACTIONS, open, toggle: toggleLog });
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
