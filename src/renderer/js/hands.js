// Her hands, from her chat (control.js does the work on the PC): arranging and showing windows, and
// writing a message in Telegram, Discord, WhatsApp or Slack. Off unless you turn it on (her menu ›
// Hands). What she types she only sends after you click yes, and you see who it's going to and what
// it says first.
//
// She acts on what you wrote plainly ("капри, открой телеграм и напиши маме, скоро буду") and on a
// tag her AI can add ([[msg: telegram | Мама | Скоро буду]]); either way a message waits for your
// yes, and the app and text are shown before you confirm.

import { pick, fmt } from './util.js';
import { lifeLines } from './lines-life.js';

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
  }

  get t() {
    return lifeLines(this.brain.lang).hands;
  }

  configure(cfg) {
    this.enabled = cfg.hands === true;
    this.canType = cfg.handsType !== false;
  }

  // What you asked her to do with her hands, from your message, or null.
  // { kind: 'message', app, chat, message } | { kind: 'window', op, name } | { kind: 'desktop' }
  parse(text) {
    if (!this.enabled) return null;
    const msg = this.parseMessage(text);
    if (msg) return msg;
    if (SHOW_DESKTOP.test(text)) return { kind: 'desktop' };
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

  // Window work: done right away (low-risk), her line about it.
  async op(intent) {
    const t = this.t;
    if (intent.kind === 'desktop') {
      const ok = await this.host.showDesktop().catch(() => false);
      return ok ? { line: pick(t.desktop), face: 'smug' } : null;
    }
    this.zap();
    const n = await this.host.windowOp(intent.op, intent.name).catch((err) => ({ error: err }));
    if (n && n.error) return { line: n.error.code === 'nowindow' ? fmt(t.noWindow, { name: intent.name }) : `${t.failed} ${n.error.message}`, face: 'aside' };
    if (!n) return { line: fmt(t.noWindow, { name: intent.name }), face: 'aside' };
    return { line: fmt(t.window[intent.op], { name: intent.name }), face: 'smug' };
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
    if (this.canType) {
      lines.push('When the user asks you to write a message in Telegram, Discord, WhatsApp or Slack, end your answer with one tag: [[msg: app | chat name | the message]] (app = telegram, discord, whatsapp or slack). You never send it yourself — the user gets a button to confirm — so say you\'ve typed it out and ask if you should send it, never that it is sent.');
    }
    return lines;
  }
}
