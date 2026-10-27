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

  function render() {
    if (!snap) return;
    const groups = $('groups');
    groups.replaceChildren();
    for (const id of ['ollama', 'chatterbox']) {
      const steps = snap.steps.filter((s) => s.group === id && s.state !== 'skipped');
      if (!steps.length) continue;
      const box = el('section', 'group');
      box.dataset.state = groupState(steps);
      box.dataset.group = id;
      const title = el('h2', 'group__title', id === 'ollama' ? ui.groupOllama : ui.groupChatterbox);
      box.append(title);
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
