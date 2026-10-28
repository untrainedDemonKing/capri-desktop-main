// Her main menu: pick what she thinks with (Ollama and a model, or a cloud service with its key tried on the
// spot), what she talks with (Piper, Chatterbox, the system's voice, or a service with a key), see what that costs
// to fetch, and press one button. The page only shows and asks: what is fetched and started is the preparation
// of the main process (provision.js), whose steps are drawn here as they go. A classic script.
(() => {
  const { el, fill, fmtBytes, renderGroups } = window.StepsView;
  const $ = (id) => document.getElementById(id);
  let ui = {};
  let data = null; // what the main process told (hub:state)
  let snap = null; // the preparation's steps
  let applied = false; // the button was pressed in this window
  let seq = 0; // the preview asked last
  let preview = null;
  const open = new Set(); // steps whose log is open
  const sel = { mind: 'ollama', model: '', voice: 'piper', cloud: null, node: true };

  const ACTIONS = {
    retry: () => ({ label: ui.retry, run: () => window.hub.retry() }),
    'choose-ollama': () => ({ label: ui.chooseOllama, run: () => window.hub.choose('ollama') }),
    'choose-chatterbox': () => ({ label: ui.chooseChatterbox, run: () => window.hub.choose('chatterbox') }),
    'choose-piper': () => ({ label: ui.choosePiper, run: () => window.hub.choose('piper') }),
    'repair-ollama': () => ({ label: ui.repairOllama, run: () => window.hub.repairOllama() }),
    'open-ollama-site': () => ({ label: ui.openOllamaSite, run: () => window.hub.open('https://ollama.com/download') }),
    'open-node-site': () => ({ label: ui.openNodeSite, run: () => window.hub.open('https://nodejs.org/en/download') }),
    'open-python-site': () => ({ label: ui.openPythonSite, run: () => window.hub.open('https://www.python.org/downloads/') }),
  };
  const toggleLog = (id) => { if (open.has(id)) open.delete(id); else open.add(id); renderProgress(); };
  const running = () => Boolean(snap && snap.running);
  // (moving what is fetched already into the folder in use: further down)
  let move = null; // the last the main process said of a move
  let moveArmed = false; // the plan is shown, and waits for the second press
  let moveTimer = 0;
  let moveSaid = '';
  let moveKind = ''; // '', 'ok' or 'bad'
  const moving = () => Boolean(move && move.running);
  const kindName = (kind) => ui[`moveKind-${kind}`] || kind;
  const kinds = (list) => list.map(kindName).join(', ');
  const voiceValue = () => (sel.voice === 'cloud' ? $('voiceEngine').value : sel.voice);

  // ---- cards to choose from ----

  function buildChoices(container, name, options, current, onPick) {
    container.replaceChildren(...options.map((o) => {
      const label = el('label', 'choice');
      label.dataset.value = o.value;
      const input = el('input');
      input.type = 'radio';
      input.name = name;
      input.value = o.value;
      input.addEventListener('change', () => onPick(o.value));
      label.append(input, el('span', 'choice__title', o.title), el('span', 'choice__tag', o.tag), el('span', 'choice__what', o.what));
      if (o.badge) label.append(el('span', 'choice__badge', o.badge));
      return label;
    }));
    mark(container, current);
  }

  // which one is picked: the radio, and the card's look
  function mark(container, value) {
    for (const label of container.children) {
      const on = label.dataset.value === value;
      label.dataset.checked = String(on);
      const input = label.querySelector('input');
      input.checked = on;
      input.disabled = running();
    }
  }

  function buildMind() {
    const rec = data.recommended.mind.kind === 'cloud' ? 'cloud' : 'ollama';
    buildChoices($('mindChoices'), 'mind', [
      { value: 'ollama', title: ui.mindOllama, tag: ui.mindOllamaTag, what: ui.mindOllamaWhat, badge: rec === 'ollama' ? ui.recommendedTag : '' },
      { value: 'cloud', title: ui.mindCloud, tag: ui.mindCloudTag, what: ui.mindCloudWhat, badge: rec === 'cloud' ? ui.recommendedTag : '' },
      { value: 'skip', title: ui.mindSkip, tag: ui.mindSkipTag, what: ui.mindSkipWhat },
    ], sel.mind, (v) => { sel.mind = v; showPanels(); refreshPlan(); });
  }

  function buildVoice() {
    const rec = data.recommended.voice.engine;
    buildChoices($('voiceChoices'), 'voice', [
      { value: 'piper', title: ui.voicePiper, tag: ui.voicePiperTag, what: ui.voicePiperWhat, badge: rec === 'piper' ? ui.recommendedTag : '' },
      { value: 'chatterbox', title: ui.voiceChatterbox, tag: ui.voiceChatterboxTag, what: ui.voiceChatterboxWhat, badge: rec === 'chatterbox' ? ui.recommendedTag : '' },
      { value: 'system', title: ui.voiceSystem, tag: ui.voiceSystemTag, what: ui.voiceSystemWhat, badge: rec === 'system' ? ui.recommendedTag : '' },
      { value: 'cloud', title: ui.voiceCloud, tag: ui.voiceCloudTag, what: ui.voiceCloudWhat },
    ], sel.voice, (v) => { sel.voice = v; showPanels(); refreshPlan(); });
  }

  // ---- the model, for Ollama ----

  function buildModels() {
    const box = $('models');
    const installed = data.have.models || [];
    const same = (m, name) => m === name || m.startsWith(`${name}-`);
    const rows = data.models.map((m) => ({ value: m.model, bytes: m.bytes, rec: m.rank === 'best', alt: m.rank === 'alt', ru: m.ru, have: m.have, eyes: m.vision, heavy: m.heavy, name: m.model }));
    // (the ones she has that are not on the list: kept as they are)
    for (const name of installed) if (!data.models.some((m) => same(name, m.model))) rows.push({ value: name, bytes: 0, rec: false, have: true, eyes: null, heavy: false, name: fill(ui.modelKeep, { name }) });
    box.replaceChildren(...rows.map((r) => {
      const label = el('label', 'model');
      label.dataset.value = r.value;
      const input = el('input');
      input.type = 'radio';
      input.name = 'model';
      input.value = r.value;
      input.addEventListener('change', () => { sel.model = r.value; markModels(); refreshPlan(); });
      label.append(input, el('span', 'model__name', r.name));
      if (r.bytes) label.append(el('span', 'model__size', fmtBytes(r.bytes)));
      if (r.rec) label.append(el('span', 'model__tag', ui.recommendedTag));
      if (r.alt) label.append(el('span', 'model__tag', ui.modelAlt));
      if (r.ru) label.append(el('span', 'model__size', ui[`recWhy-ru-${r.ru}`]));
      if (r.have) label.append(el('span', 'model__tag', ui.modelHave));
      if (r.eyes === true) label.append(el('span', 'model__tag', ui.modelEyes));
      if (r.eyes === false) label.append(el('span', 'model__tag model__tag--warn', ui.modelBlind));
      if (r.heavy) label.append(el('span', 'model__tag model__tag--warn', ui.modelHeavy));
      return label;
    }));
    markModels();
  }

  function markModels() {
    for (const label of $('models').children) {
      const on = label.dataset.value === sel.model;
      label.dataset.checked = String(on);
      const input = label.querySelector('input');
      input.checked = on;
      input.disabled = running();
    }
  }

  // what the PC is best at carrying, in words: the model, and the voice (and whether Chatterbox is worth it here)
  function renderRecs() {
    const m = data.rec.mind;
    const why = (keys) => keys.map((k) => ui[`recWhy-${k}`]).filter(Boolean).join(', ');
    $('recBox').hidden = false;
    $('recTitle').textContent = ui.recTitle;
    $('recMind').textContent = fill(ui.recBest, { model: m.best, why: why(m.bestWhy) });
    $('recAlt').textContent = m.alt ? fill(ui.recAlt, { model: m.alt, why: why(m.altWhy) }) : '';
    const v = data.rec.voice;
    const key = v.engine === 'chatterbox' ? `recVoice-chatterbox-${v.device}` : `recVoice-${v.engine}`;
    $('recVoice').textContent = fill(ui[key] || '', { slow: ui[`recSlow-${v.chatterbox || 'slow'}`] || '' });
  }

  function renderOllamaLine() {
    const have = data.have;
    const parts = [fill(ui.ollamaIs, { state: ui[`ollamaState-${have.ollama ? 'found' : 'missing'}`] })];
    if ((have.models || []).length) parts.push(fill(ui.ollamaModels, { list: have.models.join(', ') }));
    $('ollamaLine').textContent = parts.join(' · ');
    // (Ollama that is there but will not answer, or whose engine is gone: it is put in again over itself, the models stay)
    $('ollamaRepair').hidden = !have.ollama;
    twoStep($('ollamaRepair'), { label: ui.repairOllama, sure: ui.repairSure, run: () => window.hub.repairOllama() });
    $('ollamaRepair').disabled = running() || moving();
  }

  // ---- the services in the cloud ----

  function renderProviders() {
    const box = $('providers');
    box.replaceChildren(...data.cloud.map((c) => {
      const b = el('button', 'provider');
      b.type = 'button';
      b.dataset.id = c.id;
      b.setAttribute('aria-pressed', String(sel.cloud === c.id));
      b.append(el('span', '', ui[`cloudName-${c.id}`] || c.id), el('span', 'provider__tag', ui[`cloudTag-${c.tag}`] || ''));
      if (c.connected) b.append(el('span', 'provider__ok', `✓ ${ui.cloudConnected}`));
      else if (c.keySaved) b.append(el('span', 'provider__tag', ui.cloudKeySaved));
      b.disabled = running();
      b.addEventListener('click', () => { sel.cloud = c.id; $('keyResult').textContent = ''; $('keyResult').dataset.kind = ''; renderProviders(); renderKeyBox(); });
      return b;
    }));
  }

  function renderKeyBox() {
    const c = data.cloud.find((x) => x.id === sel.cloud);
    $('keyBox').hidden = !c;
    if (!c) return;
    const one = $('keyStep1');
    one.replaceChildren();
    if (c.keyPage) {
      const b = el('button', 'btn btn--small', ui.cloudGetKey);
      b.type = 'button';
      b.addEventListener('click', () => window.hub.keyPage(c.id));
      one.append(el('span', '', ui.cloudStep1), b);
    } else if (!c.key && !c.url) {
      one.append(el('span', '', ui.cloudNoKey));
    }
    const two = $('keyStep2');
    two.replaceChildren();
    let input = null;
    if (c.key || c.url) {
      input = el('input');
      input.type = c.url ? 'text' : 'password';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.id = 'cloudInput';
      input.placeholder = c.url ? ui.urlPlaceholder : c.keySaved ? `••••••• (${ui.cloudKeySaved})` : ui.keyPlaceholder;
      if (c.url && data.current.customUrl) input.value = data.current.customUrl;
      two.append(el('span', '', c.url ? ui.cloudStepUrl : ui.cloudStep2), input);
    }
    const go = el('button', 'btn btn--small', ui.cloudConnect);
    go.type = 'button';
    go.id = 'cloudConnect';
    go.addEventListener('click', () => connect(c, input, go));
    two.append(go);
    input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click(); });
    go.disabled = running();
    if (input) input.disabled = running();
  }

  async function connect(c, input, button) {
    const out = $('keyResult');
    const value = input ? input.value.trim() : '';
    if (c.url && !value) {
      out.textContent = ui.cloudNeedUrl;
      out.dataset.kind = 'bad';
      return;
    }
    if (c.key && !value && !c.keySaved) {
      out.textContent = ui.cloudNeedKey;
      out.dataset.kind = 'bad';
      return;
    }
    button.disabled = true;
    out.textContent = ui.cloudChecking;
    out.dataset.kind = '';
    const res = await window.hub.connect({ provider: c.id, key: c.url ? '' : value, url: c.url ? value : '' }).catch((err) => ({ ok: false, error: err.message }));
    button.disabled = running();
    if (res.cloud) data.cloud = res.cloud;
    if (res.ok) {
      out.textContent = fill(ui.cloudOk, { model: res.model || '' });
      out.dataset.kind = 'ok';
      if (input) input.value = '';
      data.current.provider = c.id;
    } else {
      out.textContent = fill(ui.cloudFail, { error: res.error || '?' });
      out.dataset.kind = 'bad';
    }
    renderProviders();
    refreshPlan();
  }

  // ---- the voice in the cloud ----

  function renderVoiceKey({ keepMessage = false } = {}) {
    const engine = $('voiceEngine').value;
    $('voiceKey').placeholder = data.voiceKeys[engine] ? `••••••• (${ui.cloudKeySaved})` : ui.voiceKeyPlaceholder;
    if (keepMessage) return;
    $('voiceKeyResult').textContent = '';
    $('voiceKeyResult').dataset.kind = '';
  }

  async function saveVoiceKey() {
    const engine = $('voiceEngine').value;
    const key = $('voiceKey').value.trim();
    const out = $('voiceKeyResult');
    if (!key) {
      out.textContent = ui.cloudNeedKey;
      out.dataset.kind = 'bad';
      return;
    }
    const res = await window.hub.voiceKey({ engine, key });
    if (res && res.ok !== false) {
      data.voiceKeys[engine] = true;
      $('voiceKey').value = '';
      out.textContent = ui.voiceKeySaved;
      out.dataset.kind = 'ok';
      renderVoiceKey({ keepMessage: true });
      refreshPlan();
    } else {
      out.textContent = fill(ui.cloudFail, { error: (res && res.error) || '?' });
      out.dataset.kind = 'bad';
    }
  }

  // ---- what will be done ----

  function showPanels() {
    $('mindOllama').hidden = sel.mind !== 'ollama';
    $('mindCloud').hidden = sel.mind !== 'cloud';
    $('voiceCloud').hidden = sel.voice !== 'cloud';
    $('voiceSample').hidden = sel.voice !== 'chatterbox';
    mark($('mindChoices'), sel.mind);
    mark($('voiceChoices'), sel.voice);
  }

  async function refreshPlan() {
    const mine = ++seq;
    const choice = { mind: sel.mind, model: sel.mind === 'ollama' ? sel.model : '', voice: voiceValue(), node: sel.node };
    const res = await window.hub.preview(choice).catch(() => null);
    if (mine !== seq || !res) return;
    preview = res;
    renderPlan();
  }

  function renderPlan() {
    const p = preview;
    const tbody = $('plan').tBodies[0];
    tbody.replaceChildren(...p.items.map((c) => {
      const tr = el('tr');
      tr.append(el('td', '', fill(ui[`comp-${c.id}`], { name: c.name || '' })), el('td', '', fmtBytes(c.bytes)));
      const state = el('td', '', c.have ? ui.compHave : ui.compFetch);
      state.dataset.have = String(c.have);
      tr.append(state);
      return tr;
    }));
    $('totals').textContent = [p.total > 0 ? fill(ui.totalFetch, { size: fmtBytes(p.total) }) : ui.totalNothing, p.free ? fill(ui.totalFree, { size: fmtBytes(p.free) }) : ''].filter(Boolean).join(' · ');
    const warns = [];
    for (const n of p.notes) warns.push(n === 'diskShort' ? ui.warnDisk : n === 'heavy' ? ui.warnHeavy : ui[`note-${n}`]);
    const cloudOk = data.cloud.some((c) => c.connected);
    if (sel.mind === 'cloud' && !cloudOk) warns.push(ui.warnCloud);
    if (sel.voice === 'cloud' && !data.voiceKeys[$('voiceEngine').value]) warns.push(ui.warnVoiceKey);
    $('warns').replaceChildren(...warns.filter(Boolean).map((w) => el('li', '', w)));
    const blocked = (sel.mind === 'cloud' && !cloudOk) || (sel.voice === 'cloud' && !data.voiceKeys[$('voiceEngine').value]) || (sel.mind === 'ollama' && !sel.model);
    $('go').textContent = p.total > 0 ? ui.install : ui.installDone;
    $('go').disabled = running() || blocked || moving();
  }

  // ---- what is on this PC, and taking it off ----

  let inv = null;      // what the main process told (hub:inventory)
  let invSeq = 0;      // the newest look at it: an older answer that comes late is dropped
  let working = false; // something is being taken off
  const armed = new Map(); // button -> its timer: pressed once, waiting for the second press

  // a button that asks again before it does what it says: press, read, press
  function twoStep(button, { label, sure, run }) {
    button.textContent = label;
    button.dataset.armed = 'false';
    button.onclick = () => {
      if (working) return;
      if (armed.has(button)) {
        clearTimeout(armed.get(button));
        armed.delete(button);
        button.dataset.armed = 'false';
        button.textContent = label;
        run();
        return;
      }
      button.dataset.armed = 'true';
      button.textContent = typeof sure === 'function' ? sure() : sure;
      armed.set(button, setTimeout(() => {
        armed.delete(button);
        button.dataset.armed = 'false';
        button.textContent = label;
      }, 6000));
    };
  }

  const sizeText = (item) => (item.bytes ? `${item.partial ? '~' : ''}${fmtBytes(item.bytes)}` : '—');
  const hers = () => (inv ? inv.items.filter((i) => i.ours && i.removable) : []);
  const nameOf = (item) => (item.kind === 'model' ? item.label : ui[`invKind-${item.kind}`] || item.label);

  function setResult(text, kind = '') {
    $('invResult').textContent = text;
    $('invResult').dataset.kind = kind;
  }

  function renderInventory() {
    if (!inv || !ui.invEmpty) return;
    const box = $('inv');
    const items = inv.items;
    if (!items.length) {
      box.replaceChildren(el('p', 'inv__empty', ui.invEmpty));
    } else {
      const nodes = [];
      for (const group of ['mind', 'voice', 'tools']) {
        const here = items.filter((i) => i.group === group);
        if (!here.length) continue;
        nodes.push(el('h3', 'inv__group', ui[`invGroup-${group}`]));
        for (const item of here) {
          const row = el('div', 'inv__row');
          row.dataset.hers = String(Boolean(item.ours));
          row.dataset.id = item.id;
          row.append(el('span', 'inv__name', nameOf(item)));
          const tag = item.kind === 'model' ? (item.ours ? ui.invOurs : ui.invYours) : item.ours ? (item.how && item.how !== 'zip' ? ui.invHowInstalled : item.how === 'zip' ? ui.invHow : ui.invOurs) : ui.invYours;
          row.append(el('span', item.ours ? 'inv__tag' : 'inv__tag inv__tag--other', tag));
          row.append(el('span', 'inv__size', sizeText(item)));
          if (item.removable) {
            const b = el('button', 'btn btn--small');
            b.type = 'button';
            b.disabled = running() || working;
            twoStep(b, { label: ui.invDelete, sure: ui.invSure, run: () => removeOne(item) });
            row.append(b);
          } else {
            row.append(el('p', 'inv__where', fill(ui.invWhere, { path: item.path || '' })));
          }
          nodes.push(row);
        }
      }
      box.replaceChildren(...nodes);
    }
    const total = hers().reduce((n, i) => n + i.bytes, 0);
    $('invTotal').textContent = hers().length ? fill(ui.invTotal, { size: fmtBytes(total) }) : ui.invTotalNone;
    $('invNote').textContent = inv.ollamaUp ? '' : ui.invOllamaDown;
    const all = $('removeAll');
    const un = $('uninstall');
    all.disabled = !hers().length || running() || working;
    un.disabled = running() || working;
    const list = () => hers().map(nameOf).join(', ');
    twoStep(all, { label: ui.invAll, sure: () => fill(ui.invAllSure, { list: list(), size: fmtBytes(total) }), run: removeEverything });
    twoStep(un, { label: ui.invUninstall, sure: () => fill(ui.invUninstallSure, { size: fmtBytes(total) }), run: uninstallCapri });
  }

  async function refreshInventory() {
    const mine = ++invSeq;
    $('invTotal').textContent = ui.invCounting;
    const got = await window.hub.inventory().catch(() => ({ items: [], ollamaUp: true, total: 0, count: 0 }));
    if (mine !== invSeq) return; // (something was taken off meanwhile: that answer is newer)
    inv = got;
    renderInventory();
  }

  // after something was taken off, the rest of the page (what is installed, the plan, the choices) follows
  async function resync() {
    const fresh = await window.hub.state();
    data = fresh;
    ui = fresh.ui;
    await load(fresh, { keepInventory: true });
  }

  const reason = (error) => (error === 'preparing' ? ui.invBusyPreparing : error === 'moving' ? ui.invBusyMoving : error === 'missing' ? ui.invMissing : error === 'not hers' ? ui.invNotHers : error);

  async function removeOne(item) {
    working = true;
    renderInventory();
    setResult(ui.invWorking);
    const res = await window.hub.remove(item.id).catch((err) => ({ ok: false, error: err.message }));
    working = false;
    invSeq++;
    if (res.inventory) inv = res.inventory;
    if (res.ok) setResult(fill(ui.invDone, { what: nameOf(item), size: fmtBytes(res.freed || 0) }), 'ok');
    else setResult(fill(ui.invFailed, { what: nameOf(item), error: reason(res.error) }), 'bad');
    renderInventory();
    await resync();
  }

  async function removeEverything() {
    working = true;
    renderInventory();
    setResult(ui.invWorking);
    const res = await window.hub.removeAll().catch((err) => ({ ok: false, failed: [{ id: '', error: err.message }], removed: [], freed: 0 }));
    working = false;
    invSeq++;
    if (res.inventory) inv = res.inventory;
    const failed = (res.failed || []).map((f) => `${f.id || ''} ${reason(f.error)}`.trim());
    if (res.error) setResult(reason(res.error), 'bad');
    else if (failed.length) setResult(fill(ui.invFailed, { what: '', error: failed.join('; ') }), 'bad');
    else {
      const left = (res.left || []).map((id) => id.replace(/^model:/, ''));
      setResult(`${fill(ui.invAllDone, { count: (res.removed || []).length, size: fmtBytes(res.freed || 0) })}${left.length ? ` ${fill(ui.invAllLeft, { list: left.join(', ') })}` : ''}`, 'ok');
    }
    renderInventory();
    await resync();
  }

  async function uninstallCapri() {
    working = true;
    renderInventory();
    setResult(ui.invWorking);
    const res = await window.hub.uninstall().catch((err) => ({ ok: false, error: err.message }));
    if (res.ok && res.manual) {
      working = false;
      setResult(fill(ui.invUninstallManual, { dir: res.dir || '' }), 'ok');
      await refreshInventory();
      await resync();
    } else if (res.ok) {
      setResult(ui.invUninstallDone, 'ok'); // (she quits: the window goes with her)
    } else {
      working = false;
      const list = (res.failed || []).map((f) => `${f.id} ${reason(f.error)}`).join('; ') || reason(res.error);
      setResult(fill(ui.invUninstallFailed, { list }), 'bad');
      await refreshInventory();
    }
  }

  // ---- the folder everything is fetched into (downloads.js) ----

  function renderFolder(said = '', bad = false) {
    const f = data.folder;
    $('folder').hidden = !f;
    if (!f) return;
    $('folderPath').textContent = fill(f.custom ? ui.folderNow : ui.folderNowDefault, { dir: f.dir });
    $('folderFree').textContent = f.free ? fill(ui.folderFree, { size: fmtBytes(f.free) }) : '';
    $('folderReset').hidden = !f.custom;
    for (const id of ['folderChoose', 'folderReset']) $(id).disabled = running() || working || moving();
    const out = $('folderResult');
    out.textContent = said;
    out.dataset.kind = said ? (bad ? 'bad' : 'ok') : '';
    renderMove();
  }

  // the answer to picking the place (or putting the default back): the folder as it is now, and the plan counted again for the disk it is on
  async function folderChanged(res, doneLine) {
    if (res.error === 'canceled') return;
    if (res.folder) data.folder = res.folder;
    const said = res.ok
      ? [fill(doneLine, { dir: res.folder?.dir || '' }), res.adopted?.length ? fill(ui.moveAdopted, { list: kinds(res.adopted) }) : ''].filter(Boolean).join(' ')
      : ui[`folderErr-${res.error}`] || ui['folderErr-missing'];
    renderFolder(said, !res.ok);
    if (res.ok) await refreshPlan();
  }

  // ---- moving what is fetched already into it (relocate.js) ----


  function sayMove(text, kind = '') {
    moveSaid = text;
    moveKind = text ? kind : '';
    renderMove();
  }

  function renderMove() {
    const f = data?.folder;
    const going = moving();
    const movable = f?.movable || [];
    $('moveBox').hidden = !f || !(going || movable.length || moveSaid);
    if ($('moveBox').hidden) return;
    const note = movable.length && !going ? fill(ui.moveNote, { list: kinds(movable) }) : '';
    $('moveNote').textContent = note;
    $('moveNote').hidden = !note;
    $('moveGo').hidden = going || !movable.length;
    $('moveGo').textContent = moveArmed ? ui.moveSure : ui.moveGo;
    $('moveGo').disabled = running() || working;
    $('moveStop').hidden = !going;
    $('moveStop').disabled = move?.stopping === true;
    $('moveStop').textContent = move?.stopping ? ui.stopping : ui.moveStop;
    $('moveBar').hidden = !going;
    if (going) $('moveBar').firstElementChild.style.width = `${move.total ? Math.min(100, Math.round((move.done / move.total) * 100)) : 0}%`;
    const line = $('moveLine');
    if (going) {
      line.textContent = move.stopping ? ui.stopping : fill(ui.moveNow, { what: kindName(move.kind), index: move.index, count: move.count, done: fmtBytes(move.done), total: fmtBytes(move.total) });
      line.dataset.kind = '';
    } else {
      line.textContent = moveSaid;
      line.dataset.kind = moveKind;
    }
  }

  // the first press shows what would be moved and what it takes; the second one moves
  async function pressMove() {
    if (moving()) return;
    if (!moveArmed) {
      const plan = await window.hub.folderPlan().catch(() => null);
      if (!plan || !plan.items.length) return sayMove(ui[plan?.conflicts?.length ? 'moveErr-taken' : 'moveErr-nothing'], 'bad');
      if (!plan.enough) return sayMove(fill(ui.moveShort, { need: fmtBytes(plan.need), free: fmtBytes(plan.free) }), 'bad');
      const lines = [fill(ui.movePlan, { list: kinds(plan.items.map((i) => i.kind)), size: fmtBytes(plan.bytes), free: plan.free ? fmtBytes(plan.free) : '?' })];
      if (plan.conflicts.length) lines.push(fill(ui.moveTaken, { list: kinds(plan.conflicts) }));
      moveArmed = true;
      clearTimeout(moveTimer);
      moveTimer = setTimeout(() => { moveArmed = false; sayMove(''); }, 12000);
      return sayMove(lines.join(' '));
    }
    moveArmed = false;
    clearTimeout(moveTimer);
    const res = await window.hub.folderMove().catch(() => ({ ok: false, error: 'missing' }));
    sayMove(res.ok ? '' : ui[`moveErr-${res.error}`] || ui['moveErr-missing'], 'bad');
  }

  // what the main process says: how far it is, and how it ended
  async function moveChanged(next) {
    const was = moving();
    move = next;
    if (next.running) moveArmed = false;
    if (was && !next.running) {
      const parts = [];
      if (next.cancelled) parts.push(next.moved.length ? fill(ui.moveCancelled, { list: kinds(next.moved) }) : ui.moveCancelledNone);
      else if (next.moved.length) parts.push(fill(ui.moveDone, { list: kinds(next.moved) }));
      if (next.failed.length) parts.push(fill(ui.moveFailed, { list: next.failed.map((f) => `${kindName(f.kind)} (${f.error})`).join('; ') }));
      if (next.skipped.length) parts.push(fill(ui.moveSkipped, { list: kinds(next.skipped) }));
      if (next.left.length) parts.push(fill(ui.moveLeft, { dirs: next.left.join(', ') }));
      sayMove(parts.join(' '), next.failed.length || next.left.length ? 'bad' : 'ok');
      // (what is where has changed)
      const fresh = await window.hub.state().catch(() => null);
      if (fresh) {
        data.folder = fresh.folder;
        data.have = fresh.have;
        data.models = fresh.models;
        buildModels();
        renderOllamaLine();
        refreshPlan();
        refreshInventory();
      }
    }
    renderFolder(document.getElementById('folderResult').textContent, $('folderResult').dataset.kind === 'bad');
    if (preview) renderPlan();
  }

  // ---- how it is going ----

  let drawnRunning = false;
  function renderProgress() {
    if (!snap) return;
    const was = drawnRunning;
    drawnRunning = running();
    const shown = applied || running();
    const groups = $('groups');
    if (shown) renderGroups(snap, groups, { ui, actions: ACTIONS, open, toggle: toggleLog });
    else groups.replaceChildren();
    const failed = shown && snap.steps.some((s) => s.state === 'failed');
    const stopped = shown && !running() && snap.cancelled === true;
    const summary = $('summary');
    if (running()) {
      summary.textContent = snap.stopping ? ui.stopping : ui.installing;
      summary.dataset.kind = '';
    } else if (stopped) {
      summary.textContent = ui.stoppedAll;
      summary.dataset.kind = '';
    } else if (shown && snap.finished && snap.ok) {
      summary.textContent = groups.children.length ? ui.allDone : ui.savedNothing;
      summary.dataset.kind = 'ok';
    } else if (failed) {
      summary.textContent = ui.someFailed;
      summary.dataset.kind = 'bad';
    } else {
      summary.textContent = '';
      summary.dataset.kind = '';
    }
    $('stop').hidden = !running();
    if (data?.folder) for (const id of ['folderChoose', 'folderReset']) $(id).disabled = running() || working; // (the place is not changed while something is fetched)
    $('stop').disabled = snap.stopping === true; // (pressed: it is being stopped, and it says so)
    $('stop').textContent = snap.stopping ? ui.stopping : ui.stop;
    $('retry').hidden = running() || !(failed || stopped);
    $('skip').hidden = applied;
    // while it works, the choices are not to be changed
    for (const id of ['mindChoices', 'voiceChoices', 'models']) for (const input of $(id).querySelectorAll('input')) input.disabled = running();
    $('nodeBox').disabled = running();
    for (const b of $('providers').children) b.disabled = running();
    if (inv && was !== running()) renderInventory(); // (the delete buttons wait while something is fetched; not redrawn at every step)
    if (data?.tune && was !== running()) renderTune(); // (the button that checks again waits too)
    if (preview) renderPlan();
  }

  // ---- how her mind was fitted to this PC (tune.js) ----

  function renderTune() {
    const t = data.tune;
    const card = $('tune');
    // only a model on this PC is fitted (a cloud service has its own settings)
    card.hidden = !t || t.provider !== 'ollama' || !t.model;
    if (card.hidden) return;
    const row = (name, value) => {
      const tr = el('tr');
      tr.append(el('td', '', name), el('td', '', value));
      return tr;
    };
    const rows = [row(ui.tuneModel, t.model)];
    if (t.measured) {
      rows.push(row(ui.tuneSpeed, fill(ui.tuneSpeedLine, { tps: t.tps, grade: ui[`tuneGrade-${t.speed}`] || '' })));
      const where = t.onCard === null ? ui['tuneWhere-unknown'] : t.onCard >= 0.95 ? ui['tuneWhere-card'] : t.onCard > 0.05 ? fill(ui['tuneWhere-part'], { pct: Math.round(t.onCard * 100) }) : ui['tuneWhere-cpu'];
      rows.push(row(ui.tuneWhere, where));
    }
    if (t.numCtx) rows.push(row(ui.tuneMemory, fill(ui.tuneMemoryLine, { n: t.numCtx, max: t.maxCtx || t.numCtx })));
    rows.push(row(ui.tuneChat, fill(ui.tuneChatLine, { t: t.chat.temperature, n: t.chat.num_predict })));
    rows.push(row(ui.tuneNote, fill(ui.tuneNoteLine, { t: t.note.temperature, n: t.note.num_predict })));
    $('tuneTable').tBodies[0].replaceChildren(...rows);
    $('tuneState').textContent = t.running ? ui.tuneMeasuring : t.measured ? '' : ui.tuneNone;
    $('retune').disabled = t.running || running();
  }

  async function retune() {
    $('retune').disabled = true;
    data.tune = { ...data.tune, running: true };
    renderTune();
    data.tune = (await window.hub.retune().catch(() => null)) || data.tune;
    renderTune();
  }

  // ---- the recording she has as her voice (voice-sample.js) ----

  function renderSample(st, said = '', bad = false) {
    // only when Chatterbox is the voice that is picked (the other voices cannot copy one)
    $('voiceSample').hidden = sel.voice !== 'chatterbox';
    if (!st) return;
    const length = st.seconds != null ? fill(ui.sampleSeconds, { n: st.seconds }) : '';
    $('sampleState').textContent = st.has ? fill(ui.sampleHave, { file: `${st.name}${st.ext}`, length }) : ui.sampleNone;
    $('sampleRemove').hidden = !st.has;
    const out = $('sampleResult');
    const warns = st.has ? (st.warn || []).map((w) => ui[`sampleWarn-${w}`]).filter(Boolean) : [];
    out.textContent = [said, ...warns].filter(Boolean).join(' ');
    out.dataset.kind = bad ? 'bad' : said ? 'ok' : '';
  }

  async function chooseSample() {
    const res = await window.hub.sampleChoose().catch(() => null);
    if (!res || res.error === 'canceled') return;
    renderSample(res, res.ok ? ui.sampleOk : ui[`sampleErr-${res.error}`] || ui['sampleErr-copy'], !res.ok);
  }

  // ---- the start ----

  function renderPc() {
    const pc = data.pc;
    $('pc').hidden = false;
    const cpu = (pc.cpu || '').replace(/\((R|TM)\)|CPU|Processor/gi, '').replace(/\s+/g, ' ').trim() || '?';
    const gpu = pc.gpu && !pc.gpu.integrated ? `${pc.gpu.name.replace(/NVIDIA GeForce |AMD Radeon |Intel\(R\) /g, '')}${pc.gpu.vram ? ` ${fmtBytes(pc.gpu.vram)}` : ''}` : ui.scanNoGpu;
    $('pcLine').textContent = fill(ui.pcLine, { cpu, ram: fmtBytes(pc.ram), gpu, disk: pc.diskFree ? fmtBytes(pc.diskFree) : '?' });
    $('pcRec').textContent = fill(ui.recommended, { profile: ui[`profile-${data.recommended.id}`] });
  }

  function chooseStart() {
    const cur = data.current;
    const connected = data.cloud.find((c) => c.connected);
    if (!data.first && cur.provider !== 'ollama' && connected) {
      sel.mind = 'cloud';
      sel.cloud = connected.id;
    } else {
      sel.mind = data.recommended.mind.kind === 'cloud' && !data.have.ollama ? 'cloud' : 'ollama';
    }
    const installed = data.have.models || [];
    sel.model = cur.chatModel && installed.includes(cur.chatModel) ? cur.chatModel : installed[0] || data.rec.mind.best || data.recommended.mind.model || 'gemma3:4b';
    const eng = cur.ttsEngine;
    if (!data.first && ['piper', 'chatterbox', 'system'].includes(eng)) sel.voice = eng;
    else if (!data.first && ['openai', 'elevenlabs'].includes(eng)) {
      sel.voice = 'cloud';
      $('voiceEngine').value = eng;
    } else sel.voice = data.recommended.voice.engine;
    sel.node = data.node.auto;
    $('nodeBox').checked = sel.node;
  }

  async function load(fresh, { keepInventory = false } = {}) {
    data = fresh;
    ui = data.ui;
    renderPc();
    chooseStart();
    buildMind();
    buildModels();
    buildVoice();
    renderOllamaLine();
    renderRecs();
    renderProviders();
    renderKeyBox();
    renderVoiceKey();
    showPanels();
    renderTune();
    move = data.move;
    renderFolder();
    window.hub.sample().then((st) => renderSample(st)).catch(() => {});
    snap = data.snapshot;
    renderProgress();
    renderInventory();
    await refreshPlan();
    if (!keepInventory) refreshInventory();
  }

  // "3. Set-up": the number in a font of its own (the heading's font draws a 3 that reads as a Cyrillic Э)
  function numbered(node, text) {
    const m = /^(\d+)\.\s*(.*)$/.exec(text);
    if (!m) {
      node.textContent = text;
      return;
    }
    const whole = el('span');
    whole.append(el('span', 'num', `${m[1]}.`), document.createTextNode(` ${m[2]}`));
    node.replaceChildren(whole);
  }

  async function init() {
    const first = await window.hub.state();
    ui = first.ui;
    document.documentElement.lang = first.lang || 'en';
    document.title = ui.title;
    $('title').textContent = ui.title;
    $('subtitle').textContent = ui.subtitle;
    $('pcTitle').textContent = ui.pcTitle;
    $('rescan').textContent = ui.rescan;
    numbered($('mindTitle'), ui.mindTitle);
    $('mindSub').textContent = ui.mindSub;
    $('modelTitle').textContent = ui.modelTitle;
    $('cloudTitle').textContent = ui.cloudTitle;
    numbered($('voiceTitle'), ui.voiceTitle);
    $('voiceSub').textContent = ui.voiceSub;
    $('voiceEngineLabel').textContent = ui.voiceCloudEngine;
    $('voiceKeyPage').textContent = ui.cloudGetKey;
    $('voiceSave').textContent = ui.voiceSaveKey;
    numbered($('installTitle'), ui.installTitle);
    $('installSub').textContent = ui.installSub;
    numbered($('tuneTitle'), ui.tuneTitle);
    $('tuneSub').textContent = ui.tuneSub;
    $('retune').textContent = ui.tuneAgain;
    $('sampleTitle').textContent = ui.sampleTitle;
    $('sampleNote').textContent = ui.sampleNote;
    $('sampleChoose').textContent = ui.sampleChoose;
    $('sampleRemove').textContent = ui.sampleRemove;
    numbered($('manageTitle'), ui.manageTitle);
    $('manageSub').textContent = ui.manageSub;
    $('folderTitle').textContent = ui.folderTitle;
    $('folderNote').textContent = `${ui.folderNote} ${ui.folderStays} ${ui.folderStaysOllama}`;
    $('folderChoose').textContent = ui.folderChoose;
    $('folderOpen').textContent = ui.folderOpen;
    $('folderReset').textContent = ui.folderReset;
    $('nodeLabel').textContent = ui.nodeLabel;
    $('nodeWhat').textContent = ui.nodeWhat;
    $('nodeBox').addEventListener('change', (e) => { sel.node = e.target.checked; refreshPlan(); });
    $('stop').textContent = ui.stop;
    $('retry').textContent = ui.retry;
    $('skip').textContent = ui.skipAll;
    $('copy').textContent = ui.copyReport;
    $('close').textContent = ui.close;

    $('rescan').addEventListener('click', async () => { $('rescan').disabled = true; await load(await window.hub.rescan()); $('rescan').disabled = false; });
    $('voiceEngine').addEventListener('change', () => { renderVoiceKey(); refreshPlan(); });
    $('voiceKeyPage').addEventListener('click', () => window.hub.keyPage($('voiceEngine').value));
    $('voiceSave').addEventListener('click', saveVoiceKey);
    $('voiceKey').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveVoiceKey(); });
    $('go').addEventListener('click', async () => {
      if (working) return; // (something is being taken off)
      applied = true;
      $('go').disabled = true;
      await window.hub.apply({ mind: sel.mind, model: sel.mind === 'ollama' ? sel.model : '', voice: voiceValue(), node: sel.node });
      renderProgress();
    });
    $('retune').addEventListener('click', retune);
    $('folderChoose').addEventListener('click', async () => folderChanged(await window.hub.folderChoose().catch(() => ({ ok: false, error: 'missing' })), ui.folderSet));
    $('folderReset').addEventListener('click', async () => folderChanged(await window.hub.folderReset().catch(() => ({ ok: false, error: 'missing' })), ui.folderResetDone));
    $('folderOpen').addEventListener('click', () => window.hub.folderOpen());
    $('moveGo').addEventListener('click', pressMove);
    $('moveStop').addEventListener('click', () => {
      $('moveStop').disabled = true; // (at once: it was pressed)
      $('moveStop').textContent = ui.stopping;
      window.hub.folderMoveStop();
    });
    window.hub.onMove(moveChanged);
    $('sampleChoose').addEventListener('click', chooseSample);
    $('sampleRemove').addEventListener('click', async () => renderSample(await window.hub.sampleRemove()));
    window.hub.onTune((next) => {
      if (!data || !next) return;
      data.tune = next;
      renderTune();
    });
    $('stop').addEventListener('click', () => {
      $('stop').disabled = true; // (at once, before the answer: it was pressed)
      $('stop').textContent = ui.stopping;
      window.hub.stop();
    });
    $('retry').addEventListener('click', () => window.hub.retry());
    $('skip').addEventListener('click', () => window.hub.skip());
    $('close').addEventListener('click', () => window.hub.close());
    $('copy').addEventListener('click', async () => {
      const text = await window.hub.report();
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        window.hub.copy(text);
      }
      $('copy').textContent = ui.copied;
      setTimeout(() => { $('copy').textContent = ui.copyReport; }, 1500);
    });
    window.hub.onChange((next) => {
      const was = running();
      snap = next;
      renderProgress();
      // (a fetch finished: what is there now is what the next look says)
      if (was && !next.running) window.hub.state().then((fresh) => { data.have = fresh.have; data.models = fresh.models; data.cloud = fresh.cloud; data.folder = fresh.folder; renderFolder(); buildModels(); renderOllamaLine(); refreshPlan(); });
    });
    // a button elsewhere (her menu's "More" tab) opens the page at the part about what is on this PC
    const goTo = (section) => {
      const card = section === 'folder' ? $('install') : section === 'manage' ? $('manage') : null;
      if (!card) return;
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      card.dataset.flash = 'true';
      setTimeout(() => { card.dataset.flash = 'false'; }, 1800);
    };
    window.hub.onFocus(goTo);
    await load(first);
    if (location.hash === '#manage' || location.hash === '#folder') goTo(location.hash.slice(1));
  }
  init();
})();
