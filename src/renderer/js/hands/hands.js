// Her hands, from her chat (control.js does the work on the PC): arranging and showing windows,
// writing a message in Telegram, Discord, WhatsApp or Slack, and (hands-parse.js reads what you ask) the mouse, the keys and the controls
// of a window: "подвинь мышку в центр", "кликни", "нажми «Сохранить» в блокноте", "нажми ctrl+s в блокноте", "напиши в блокноте …".
// Off unless you turn it on (her menu › Hands). What she types in a messenger she only sends after you click yes, and you see who it's going
// to and what it says first; what her AI asks for with a tag (not what you said yourself) waits for a button too.
//
// She acts on what you wrote plainly ("капри, открой телеграм и напиши маме, скоро буду") and on a
// tag her AI can add ([[msg: telegram | Мама | Скоро буду]]); either way a message waits for your
// yes, and the app and text are shown before you confirm.

import { pick, fmt } from '../util.js';
import { lifeLines } from '../mind/lines-life.js';
import { parseAct, parseActTag, windowName, sayCombo } from './hands-parse.js';

// window arrangement, said plainly (RU / EN). Each op: how it's named, and
// the word that comes right before the window's name, which is stripped off.
// (\w and \b don't match Cyrillic in JS, so every boundary here is \p{L} with the u flag)
const END = '(?![\\p{L}])';
const SHOW_DESKTOP = /сверн(?:и|уть)\s+вс[её]|покажи\s+рабочий\s+стол|show\s+(?:the\s+)?desktop|свернуть\s+все\s+окна|minimize\s+all/iu;
const WINDOW_OPS = [
  ['minimize', new RegExp(`(сверни|свернуть|минимизируй|minimi[sz]e)${END}`, 'iu')],
  ['maximize', new RegExp(`(разверни|разверну|во\\s+весь\\s+экран|maximi[sz]e)${END}`, 'iu')],
  ['restore', new RegExp(`(восстанови|восстановить|restore)${END}`, 'iu')],
  ['focus', new RegExp('(переключись\\s+на|покажи\\s+окно|подними\\s+окно|на\\s+передний\\s+план|switch\\s+to|bring\\s+up|focus\\s+on)', 'iu')],
];
// "окно/window" before the name, and little filler we drop from the front
const WINDOW_WORD = /^\s*(?:окн[оа]|window|of)\s+/iu;

// the messengers she can write in, named plainly
const MESSENGERS = /(телеграм\p{L}*|телег\p{L}*|\btg\b|telega|telegram|дискорд\p{L}*|discord|вотсап\p{L}*|ватсап\p{L}*|whats\s?app|слак\p{L}*|slack)/iu;
// a verb that means "write/send a message"
const WRITE = /(напиш\p{L}*|напеч\p{L}*|отправ\p{L}*|сообщ\p{L}*|скаж\p{L}*|передай|write|send|message|text)/iu;
// filler at the start of the chat part: "и напиши В телеграме МАМЕ" -> "маме"
const LEAD = new RegExp(`^(?:(?:и|а|в|во|на|у|то|что|для|сообщение|message|to|in|the|a|that)${END}[\\s,:]*)+`, 'iu');

export class Hands {
  constructor({ host, capri, panel, voice, brain }) {
    this.host = host;
    this.capri = capri;
    this.panel = panel;
    this.voice = voice;
    this.brain = brain;
    this.enabled = false;
    this.canType = true;
    this.canMouse = true;
  }

  get t() {
    return lifeLines(this.brain.lang).hands;
  }

  configure(cfg) {
    this.enabled = cfg.hands === true;
    this.canType = cfg.handsType !== false;
    this.canMouse = cfg.handsMouse !== false;
  }

  // What you asked her to do with her hands, from your message, or null.
  // { kind: 'message', app, chat, message } | { kind: 'window', op, name } | { kind: 'desktop' }
  parse(text) {
    if (!this.enabled) return null;
    const msg = this.parseMessage(text);
    if (msg) return msg;
    if (SHOW_DESKTOP.test(text)) return { kind: 'desktop' };
    // the mouse, a control of a window, a key combination, text into a window (each behind its own switch)
    const act = parseAct(text, { type: this.canType });
    // (text into a messenger is a message: it has its own way, with the chat and your yes)
    if (act && act.kind === 'type' && MESSENGERS.test(text)) return null;
    if (act && (act.kind === 'type' || this.canMouse)) return act;
    for (const [op, re] of WINDOW_OPS) {
      const m = re.exec(text);
      if (!m) continue;
      // the window's name is what follows the op word (minus a leading "окно"/"window")
      const name = text.slice(m.index + m[0].length).replace(WINDOW_WORD, '').trim().replace(/[.!?]+$/, '').slice(0, 40);
      if (name) return { kind: 'window', op, name };
    }
    return null;
  }

  // "...телеграм... напиши <chat>[,:] <message>". Needs a messenger, a write verb, a chat and a message.
  parseMessage(text) {
    if (!this.canType) return null;
    const appM = MESSENGERS.exec(text);
    const writeM = WRITE.exec(text);
    if (!appM || !writeM) return null;
    // everything after the write verb, with the app name and leading filler stripped off
    let rest = text.slice(writeM.index + writeM[0].length).replace(MESSENGERS, ' ').replace(/\s+/g, ' ').trim();
    rest = rest.replace(LEAD, '').trim();
    // "<chat>, <message>" / "<chat>: <message>", else "<chat> что <message>" / "<chat> <message>"
    let m = rest.match(/^(.{1,60}?)\s*[,:;—]\s*(.+)$/s);
    if (!m) m = rest.match(/^(.{1,30}?)\s+(?:что\s+|чтобы\s+|that\s+)(.+)$/is);
    if (!m) {
      const words = rest.split(' ').filter(Boolean);
      if (words.length >= 2) m = [null, words[0], words.slice(1).join(' ')];
    }
    if (!m) return null;
    // a trailing preposition the app sat after ("жене в [вотсапе]") isn't part of the name
    const chat = m[1].trim().replace(/\s+(?:в|во|на|у|in|to|on)$/iu, '').replace(/^["'«»]+|["'«»]+$/g, '').trim();
    const message = m[2].trim().replace(/^["'«»]+|["'«»]+$/g, '');
    if (!chat || !message) return null;
    return { kind: 'message', app: appM[1], chat, message };
  }

  // A tag her AI added: [[msg: app | chat | message]]. Returns the intent, or null.
  parseTag(raw) {
    const m = /\[\[\s*msg\s*:\s*([^|\]]+)\|([^|\]]+)\|([^\]]+)\]\]/i.exec(String(raw || ''));
    if (!m || !this.enabled || !this.canType) return null;
    return { kind: 'message', app: m[1].trim(), chat: m[2].trim(), message: m[3].trim() };
  }

  // A tag her AI added for the mouse, a control, keys or text: [[click: …]], [[keys: …]], [[type: …]], [[mouse: …]]. The intent, or null.
  parseActTag(raw) {
    if (!this.enabled) return null;
    const act = parseActTag(raw, { type: this.canType });
    return act && (act.kind === 'type' || this.canMouse) ? act : null;
  }

  // What it is that she would do, in a few words (the button of what her AI asked for).
  describe(intent) {
    const t = this.t.do;
    const window = intent.window || '…';
    if (intent.kind === 'element') return fmt(intent.action === 'move' ? t.moveTo : t.press, { name: intent.name, window });
    if (intent.kind === 'keys') return fmt(t.keys, { keys: sayCombo(intent), window });
    if (intent.kind === 'type') return fmt(t.type, { window, text: intent.text.length > 24 ? `${intent.text.slice(0, 23)}…` : intent.text });
    if (intent.kind === 'mouse' && intent.op === 'move') return fmt(t.move, { where: this.where(intent.target) });
    if (intent.kind === 'mouse' && intent.op === 'click') return intent.double ? t.doubleClick : intent.button === 'right' ? t.rightClick : t.click;
    if (intent.kind === 'mouse' && intent.op === 'scroll') return intent.clicks < 0 ? t.scrollDown : t.scrollUp;
    return '';
  }

  where(target) {
    const w = this.t.where;
    return typeof target === 'string' ? w[target] || target : fmt(w.xy, { x: target.x, y: target.y });
  }

  // What her AI asked for with a tag: a button that says what it will do, and nothing happens before it is clicked.
  offer(intent, { addLine, setActions, answer }) {
    const t = this.t;
    const label = this.describe(intent);
    if (!label) return;
    setActions(
      [{ id: 'do', label: label.length > 46 ? `${label.slice(0, 45)}…` : label, primary: true }, { id: 'no', label: t.no }],
      async (id) => {
        setActions([]);
        if (id !== 'do') return;
        const done = await this.op(intent);
        if (done) addLine(answer, done.line, done.face);
      },
    );
  }

  // Window work: done right away (low-risk), her line about it. The mouse, the controls of a window, keys and text go through act().
  async op(intent) {
    const t = this.t;
    if (intent.kind === 'desktop') {
      const ok = await this.host.showDesktop().catch(() => false);
      return ok ? { line: pick(t.desktop), face: 'smug' } : null;
    }
    if (['mouse', 'element', 'keys', 'type'].includes(intent.kind)) return this.act(intent);
    this.zap();
    const n = await this.host.windowOp(intent.op, windowName(intent.name) || intent.name).catch((err) => ({ error: err }));
    if (n && n.error) return { line: n.error.code === 'nowindow' ? fmt(t.noWindow, { name: intent.name }) : `${t.failed} ${n.error.message}`, face: 'aside' };
    if (!n) return { line: fmt(t.noWindow, { name: intent.name }), face: 'aside' };
    return { line: fmt(t.window[intent.op], { name: intent.name }), face: 'smug' };
  }

  // The mouse, a control of a window by its name, a key combination, text into a window: the pointer is shown going there (it is a real
  // pointer: you can take hold of it and she stops), and her line says what she did, or why she could not.
  async act(intent) {
    const t = this.t;
    const host = this.host;
    const lost = (res) => {
      const code = res?.error?.code;
      if (code === 'off') return { line: t.offMouse, face: 'aside' };
      if (code === 'denied') return { line: t.denied, face: 'aside' };
      if (code === 'nowindow') return { line: fmt(t.noWindow, { name: intent.window || intent.name || '' }), face: 'aside' };
      if (code === 'noelement') return { line: fmt(t.noElement, { name: intent.name, window: intent.window }), face: 'aside' };
      if (code === 'interrupted') return { line: t.interrupted, face: 'wide' };
      if (code === 'nowin') return { line: t.winOnly, face: 'aside' };
      return { line: `${t.failed} ${res?.error?.message || ''}`.trim(), face: 'aside' };
    };
    if ((intent.kind === 'element' || intent.kind === 'keys' || intent.kind === 'type') && !intent.window) return { line: t.needWindow, face: 'look' };
    this.zap();
    if (intent.kind === 'mouse') {
      if (intent.op === 'move') {
        const res = await host.moveMouse(intent.target).catch((error) => ({ error }));
        if (res?.error) return lost(res);
        return res === 'interrupted' ? { line: t.interrupted, face: 'wide' } : { line: fmt(t.pointerMoved, { where: this.where(intent.target) }), face: 'smug' };
      }
      if (intent.op === 'click') {
        const res = await host.clickMouse({ button: intent.button, double: intent.double }).catch((error) => ({ error }));
        if (res?.error) return lost(res);
        return { line: intent.double ? t.doubleClicked : intent.button === 'right' ? t.rightClicked : t.clicked, face: 'smug' };
      }
      const res = await host.scrollMouse(intent.clicks).catch((error) => ({ error }));
      if (res?.error) return lost(res);
      return { line: intent.clicks < 0 ? t.scrolledDown : t.scrolledUp, face: 'smug' };
    }
    if (intent.kind === 'element') {
      const res = await host.elementAction({ action: intent.action, window: intent.window, name: intent.name }).catch((error) => ({ error }));
      if (res?.error) return lost(res);
      return { line: fmt(intent.action === 'move' ? t.movedTo : t.pressed, { name: typeof res === 'string' && res ? res : intent.name, window: intent.window }), face: 'smug' };
    }
    if (intent.kind === 'keys') {
      const res = await host.pressKeys({ window: intent.window, mods: intent.mods, key: intent.key }).catch((error) => ({ error }));
      if (res?.error) return lost(res);
      return { line: fmt(t.keysPressed, { keys: sayCombo(intent), window: intent.window }), face: 'smug' };
    }
    const res = await host.typeInto(intent.text, intent.window).catch((error) => ({ error }));
    if (res?.error) return lost(res);
    return { line: fmt(t.typed, { window: intent.window }), face: 'smug' };
  }

  // A message: she prepares it (opens the app if need be, types it in without sending), shows you
  // where it's going and what it says, and sends only when you click yes. Uses the chat panel's
  // buttons (addLine / setActions come from chat.js), so her chat stays open.
  async message(intent, { addLine, setActions, answer }) {
    const t = this.t;
    if (!this.host.hands) return;
    this.zap();
    let prepared = await this.prepare(intent);
    // app not open: open it and try once more
    if (prepared?.code === 'nowindow') {
      addLine(answer, fmt(t.opening, { app: intent.app }), 'look');
      const item = await this.host.findLaunch(intent.app).catch(() => null);
      if (item) await this.host.launch(item).catch(() => {});
      await new Promise((r) => setTimeout(r, 3500));
      prepared = await this.prepare(intent);
    }
    if (!prepared || prepared.error) {
      addLine(answer, prepared?.code === 'unknownapp' ? fmt(t.unknownApp, { app: intent.app })
        : prepared?.code === 'nowindow' ? fmt(t.noApp, { app: intent.app })
          : `${t.failed} ${prepared?.message || ''}`, 'aside');
      return;
    }
    // ready: show who and what, then wait for yes
    addLine(answer, fmt(t.ready, { chat: intent.chat, message: intent.message }), 'smug');
    setActions(
      [{ id: 'send', label: fmt(t.sendIt, { chat: intent.chat }), primary: true }, { id: 'no', label: t.no }],
      async (id) => {
        setActions([]);
        if (id !== 'send') {
          addLine(answer, t.cancelled, 'aside');
          return;
        }
        this.zap();
        const ok = await this.host.sendMessage(prepared).catch((err) => ({ error: err }));
        if (ok === true) {
          this.capri.react?.('happy');
          addLine(answer, fmt(pick(t.sent), { chat: intent.chat }), 'laugh');
        } else {
          addLine(answer, ok?.error?.code === 'lostfocus' ? t.moved : `${t.failed} ${ok?.error?.message || ''}`, 'wide');
        }
      },
    );
  }

  async prepare(intent) {
    try {
      return await this.host.prepareMessage(intent);
    } catch (err) {
      return { error: err, code: err.code, message: err.message };
    }
  }

  // a bolt of red lightning off her fingers, at what she's doing
  zap() {
    const h = this.capri.head();
    this.capri.zap?.(h.x + this.capri.towardCenter() * 280, h.y - 170);
  }

  // What she can do with her hands, for her chat's prompt (only while it's on).
  powers() {
    if (!this.enabled) return [];
    const lines = ['When (and only when) the user asks you to arrange a window on their PC, you can: minimize, maximize, restore or bring a window to the front, or show the desktop. Just do it and say so.'];
    if (this.canMouse) {
      lines.push('You can also move their mouse pointer, click, scroll, press a button or menu entry of a window by its name, and press a key combination in a window, only when they ask: end your answer with one tag: [[click: WINDOW | BUTTON NAME]], [[keys: WINDOW | ctrl+s]], [[mouse: move | center]] (center, topleft, topright, bottomleft, bottomright, top, bottom, left, right), [[mouse: click]], [[mouse: rightclick]], [[mouse: doubleclick]] or [[mouse: scroll | down 5]]. WINDOW is the program or a word of the window\'s title (notepad, chrome, telegram). They get a button to confirm, so never say it is already done.');
    }
    if (this.canType) {
      lines.push('To type text into a window (a note, a document), end your answer with [[type: WINDOW | the text]]; they get a button to confirm it.');
      lines.push('When the user asks you to write a message in Telegram, Discord, WhatsApp or Slack, end your answer with one tag: [[msg: app | chat name | the message]] (app = telegram, discord, whatsapp or slack). You never send it yourself — the user gets a button to confirm — so say you\'ve typed it out and ask if you should send it, never that it is sent.');
    }
    return lines;
  }
}
