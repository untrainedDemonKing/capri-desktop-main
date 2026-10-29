// The little pieces her circular menu (ring.js, ring-tabs.js) is made of: rows, switches, sliders,
// choices, chips. Plain DOM, styled in ring.css with her colour tokens.

export function el(tag, cls = '', text = '') {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

export const heading = (text) => el('h3', 'ring__h', text);

export function note(text, dim = false) {
  return el('p', `ring__note${dim ? ' is-dim' : ''}`, text);
}

// A line with a label (and maybe a small hint under it) and a control at the right.
export function row(label, control, { hint = '', off = false } = {}) {
  const r = el('div', `ring__row${off ? ' is-off' : ''}`);
  const text = el('span', 'ring__label-text', label);
  if (hint) text.append(el('small', '', hint));
  r.append(text);
  if (control) r.append(control);
  return r;
}

export function button(label, onClick, { primary = false, danger = false, disabled = false } = {}) {
  const b = el('button', `ring__btn${primary ? ' is-primary' : ''}${danger ? ' is-danger' : ''}`, label);
  b.type = 'button';
  b.disabled = disabled;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!b.disabled) onClick(e);
  });
  return b;
}

export const buttons = (...list) => {
  const d = el('div', 'ring__btns');
  d.append(...list.filter(Boolean));
  return d;
};

// An on/off row.
export function toggle(label, on, onChange, { hint = '', disabled = false } = {}) {
  const sw = el('button', `ring__switch${on ? ' is-on' : ''}`);
  sw.type = 'button';
  sw.setAttribute('role', 'switch');
  sw.setAttribute('aria-checked', String(Boolean(on)));
  sw.setAttribute('aria-label', label);
  sw.disabled = disabled;
  sw.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!sw.disabled) onChange(!on);
  });
  const r = row(label, sw, { hint, off: disabled });
  // the whole row is the target
  r.addEventListener('click', () => !sw.disabled && onChange(!on));
  return r;
}

// A choice of one among rows: items [{ id, label }].
export function pick(items, current, onPick) {
  const d = el('div', 'ring__picks');
  for (const item of items) {
    const b = el('button', `ring__pick${item.id === current ? ' is-on' : ''}`, item.label);
    b.type = 'button';
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (item.id !== current) onPick(item.id);
    });
    d.append(b);
  }
  return d;
}

// A short row of choices (a size, a language): items [{ id, label }].
export function seg(items, current, onPick) {
  const d = el('div', 'ring__seg');
  for (const item of items) {
    const b = el('button', item.id === current ? 'is-on' : '', item.label);
    b.type = 'button';
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (item.id !== current) onPick(item.id);
    });
    d.append(b);
  }
  return d;
}

// A slider with a word at each end and the value on top. onInput(value) while dragging (the caller
// keeps it light), onChange(value) when let go. `show(value)` is the text for the value.
export function slider({ left = '', right = '', title = '', min = 0, max = 1, step = 0.01, value = 0, show = null, onInput = () => {}, onChange = () => {} }) {
  const wrap = el('div', 'ring__slide');
  const top = el('div', 'ring__slide-top');
  const l = el('span', '', left || title);
  const mid = el('b', '', show ? show(value) : '');
  const r = el('span', '', right);
  top.append(l, mid, r);
  const input = el('input', 'ring__range');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  const paint = () => input.style.setProperty('--fill', `${((Number(input.value) - min) / (max - min)) * 100}%`);
  paint();
  input.addEventListener('input', () => {
    paint();
    const v = Number(input.value);
    if (show) mid.textContent = show(v);
    onInput(v);
  });
  input.addEventListener('change', () => onChange(Number(input.value)));
  input.addEventListener('click', (e) => e.stopPropagation());
  wrap.append(top, input);
  return wrap;
}

// Notebook lines as chips with a ✕ to take one back.
export function chips(list, onRemove, removeLabel = '') {
  const d = el('div', 'ring__chips');
  for (const text of list) {
    const c = el('span', 'ring__chip');
    c.append(el('span', '', text));
    const x = el('button', '', '✕');
    x.type = 'button';
    x.title = removeLabel;
    x.setAttribute('aria-label', `${removeLabel}: ${text}`);
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      onRemove(text);
    });
    c.append(x);
    d.append(c);
  }
  return d;
}

// A sentence of hers in the notebook, with a small label and a ✕.
export function quote(label, text, onRemove, removeLabel = '') {
  const q = el('p', 'ring__quote');
  const small = el('small', '', label);
  q.append(small, document.createTextNode(text));
  if (onRemove) {
    const x = el('button', '', ' ✕');
    x.type = 'button';
    x.title = removeLabel;
    x.className = 'ring__chip-x';
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      onRemove();
    });
    small.append(x);
  }
  return q;
}
