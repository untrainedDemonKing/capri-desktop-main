// How the steps of her preparation are drawn, for the two windows that show them (her preparation window and her
// main menu): a row for each step with its icon, what is going on, a bar, and on failure the reason and the
// buttons that help. A classic script (the pages' CSP allows only their own).
(() => {
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const ICON = { pending: '·', running: '…', done: '✓', failed: '!', skipped: '–' };
  const groupState = (steps) => {
    if (steps.some((s) => s.state === 'failed')) return 'failed';
    if (steps.every((s) => s.state === 'done')) return 'done';
    return steps.some((s) => s.state === 'running') ? 'running' : 'pending';
  };
  const fill = (text, args = {}) => String(text).replace(/\{(\w+)\}/g, (_m, k) => (args[k] === undefined ? '' : args[k]));
  const fmtBytes = (n) => {
    const ru = document.documentElement.lang === 'ru';
    return n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} ${ru ? 'ГБ' : 'GB'}` : `${Math.max(1, Math.round(n / 1048576))} ${ru ? 'МБ' : 'MB'}`;
  };

  // one step: opts { ui, actions (id -> (step) => { label, run }), open (a Set of the steps whose log is open), toggle(id) }
  function stepRow(s, { ui, actions, open, toggle }) {
    const row = el('div', 'step');
    row.dataset.state = s.state;
    row.dataset.id = s.id;
    row.append(el('div', 'step__icon', ICON[s.state] || '·'));
    const body = el('div', 'step__body');
    body.append(el('div', 'step__name', ui[s.id] || s.id));
    if (s.state === 'pending') body.append(el('div', 'step__detail', ui.pending));
    else if (s.detail) body.append(el('div', 'step__detail', s.detail));
    if (s.state === 'running' && (s.heavy || s.progress !== null)) {
      const bar = el('div', 'bar');
      const fillBar = el('i');
      if (s.progress === null) bar.dataset.unknown = 'true';
      else fillBar.style.width = `${Math.round(s.progress * 100)}%`;
      bar.append(fillBar);
      bar.setAttribute('role', 'progressbar');
      if (s.progress !== null) bar.setAttribute('aria-valuenow', String(Math.round(s.progress * 100)));
      body.append(bar);
    }
    if (s.state === 'failed') {
      if (s.error && s.error !== s.detail) body.append(el('div', 'step__error', s.error));
      const btns = el('div', 'step__btns');
      for (const id of s.actions || []) {
        const make = actions[id];
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
        more.addEventListener('click', () => toggle(s.id));
        btns.append(more);
      }
      body.append(btns);
      if (open.has(s.id) && s.log?.length) body.append(el('pre', 'step__log', s.log.join('\n')));
    }
    row.append(body);
    return row;
  }

  // the groups of a snapshot ("the mind", "the voice") into `container`; returns how many there are
  function renderGroups(snap, container, opts) {
    container.replaceChildren();
    for (const id of ['tools', 'ollama', 'voice']) {
      const steps = snap.steps.filter((s) => s.group === id && s.state !== 'skipped');
      if (!steps.length) continue;
      const box = el('section', 'group');
      box.dataset.state = groupState(steps);
      box.dataset.group = id;
      const title = id === 'tools' ? opts.ui.groupTools : id === 'ollama' ? opts.ui.groupOllama : snap.plan.piper ? opts.ui.groupPiper : opts.ui.groupChatterbox;
      box.append(el('h2', 'group__title', title));
      for (const s of steps) box.append(stepRow(s, opts));
      container.append(box);
    }
    return container.children.length;
  }

  window.StepsView = { el, ICON, groupState, fill, fmtBytes, stepRow, renderGroups };
})();
