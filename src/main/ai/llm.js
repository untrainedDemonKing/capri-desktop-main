'use strict';

// Who she talks with: Ollama, Claude itself (the Anthropic API, through its official SDK:
// anthropic.js), any OpenAI-compatible server (local, cloud, or a keyless gateway), or Claude Code
// (headless `claude -p`, so your messages become its prompts).
// Keys come from config.json's `apiKeys` ({ openai: "sk-..." }) or the provider's env variable.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const ollama = require('./ollama');
const anthropic = require('./anthropic');

const PROVIDERS = {
  ollama: { label: 'Ollama (local)', kind: 'ollama', local: true },
  anthropic: { label: 'Claude (Anthropic API key)', kind: 'anthropic', env: 'ANTHROPIC_API_KEY' },
  lmstudio: { label: 'LM Studio (local)', url: 'http://127.0.0.1:1234/v1', local: true },
  llamacpp: { label: 'llama.cpp / vLLM (local :8080)', url: 'http://127.0.0.1:8080/v1', local: true },
  pollinations: {
    label: 'Pollinations (no key)', url: 'https://text.pollinations.ai/openai', modelsUrl: 'https://text.pollinations.ai/models',
  },
  openrouter: { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1', env: 'OPENROUTER_API_KEY' },
  openai: { label: 'OpenAI', url: 'https://api.openai.com/v1', env: 'OPENAI_API_KEY' },
  groq: { label: 'Groq', url: 'https://api.groq.com/openai/v1', env: 'GROQ_API_KEY' },
  gemini: { label: 'Google Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai', env: 'GEMINI_API_KEY' },
  deepseek: { label: 'DeepSeek', url: 'https://api.deepseek.com/v1', env: 'DEEPSEEK_API_KEY' },
  mistral: { label: 'Mistral', url: 'https://api.mistral.ai/v1', env: 'MISTRAL_API_KEY' },
  custom: { label: 'Custom (customUrl in config)' },
  claude: { label: 'Claude Code (sends to the terminal agent)', kind: 'claude' },
};

// no bypassPermissions: a chat bubble on the desktop shouldn't run anything without asking
const CLAUDE_MODES = ['default', 'acceptEdits'];

function endpoint(id, cfg) {
  const p = PROVIDERS[id];
  const url = (id === 'custom' ? cfg.customUrl : p.url) || '';
  const key = cfg.apiKeys?.[id] || (p.env && process.env[p.env]) || '';
  return { ...p, url: url.replace(/\/+$/, ''), key };
}

const headers = (key) => ({ 'content-type': 'application/json', ...(key && { authorization: `Bearer ${key}` }) });

// Why a server said no, in a sentence (Gemini sends its error inside an array), with a code when it's
// worth another try: 'busy' (too many people on it right now), 'gone' (that model isn't served anymore).
async function failure(res) {
  const body = await res.text().catch(() => '');
  let message = body.slice(0, 200) || `answered ${res.status}`;
  try {
    const parsed = JSON.parse(body);
    const err = (Array.isArray(parsed) ? parsed[0] : parsed)?.error;
    if (err) message = typeof err === 'string' ? err : err.message || message;
  } catch {
    // not JSON: the start of the body says it
  }
  const code = res.status === 429 || res.status === 503 || /overloaded|high demand|unavailable/i.test(message) ? 'busy'
    : res.status === 404 ? 'gone' : null;
  return Object.assign(new Error(message), { status: res.status, code });
}

// Gemini lists every model it has (embeddings, speech, images…): only the ones to chat with, a current
// stable Flash first (older ones get closed to new keys, previews come and go).
function geminiModels(names) {
  const version = (n) => Number(/gemini-(\d+(?:\.\d+)?)/.exec(n)?.[1] || 0);
  const rank = (n) => (/preview|exp/.test(n) ? 4 : 0) + (/flash-lite/.test(n) ? 1 : /flash/.test(n) ? 0 : 2);
  return names
    .filter((n) => /gemini/.test(n) && !/embed|tts|image|audio|live|veo|imagen|computer-use|robotics|aqa/.test(n))
    .sort((a, b) => rank(a) - rank(b) || version(b) - version(a));
}

// The provider's models by name; null when it can't be reached (Ollama only), throws with why otherwise.
async function models(id, cfg) {
  const p = endpoint(id, cfg);
  if (p.kind === 'ollama') return ollama.models().catch(() => null);
  if (p.kind === 'claude') return claudeVersion().then(() => ['Claude Code']);
  // (no key given: the SDK still looks for its own, in the environment or an `ant auth login` profile)
  if (p.kind === 'anthropic') return anthropic.models(p.key);
  // what's missing has a code, so her setup knows what to ask for (setup.js)
  if (!p.url) throw Object.assign(new Error('no address set for this server'), { code: 'nourl' });
  if (p.env && !p.key) throw Object.assign(new Error(`no API key (or ${p.env})`), { code: 'nokey' });
  const res = await fetch(p.modelsUrl || `${p.url}/models`, { headers: headers(p.key), signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw await failure(res);
  const body = await res.json();
  const list = Array.isArray(body) ? body : body.data || body.models || [];
  const names = list.map((m) => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean);
  return id === 'gemini' ? geminiModels(names) : names;
}

function warm(id, model) {
  if (PROVIDERS[id].kind === 'ollama') ollama.warm(model);
}

// OpenAI-style streaming (server-sent events): onDelta(piece) as it comes, resolves with all of it.
async function openaiChat(p, { model, messages }, onDelta, signal) {
  const res = await fetch(`${p.url}/chat/completions`, {
    method: 'POST',
    headers: headers(p.key),
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  });
  if (!res.ok) throw await failure(res);
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  // one line of the stream; true when it says the answer is over
  const feed = (line) => {
    if (!line.startsWith('data:')) return false;
    const data = line.slice(5).trim();
    if (data === '[DONE]') return true;
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return false; // a keep-alive, or a server's own chatter: not a piece of the answer
    }
    if (msg.error) throw new Error(msg.error.message || msg.error);
    const piece = msg.choices?.[0]?.delta?.content || ''; // reasoning comes apart, and is left out
    if (piece) {
      text += piece;
      onDelta(piece);
    }
    return false;
  };
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (feed(line)) return text;
    }
  }
  feed(buffer.trim()); // (the last line of an answer may come without its newline)
  return text;
}

// --- Claude Code ---------------------------------------------------------------------------------
// The prompt goes in on stdin, never on the command line: the shell (needed for an npm claude.cmd)
// only ever sees fixed arguments.

const quote = (s) => (process.platform === 'win32' ? `"${s}"` : s); // cmd joins the arguments
// its session id, picked here so her hooks can tell its events from your other sessions' (main.js)
let claudeSession = null;
let claudeStarted = false; // each message after the first continues the same conversation

function claudeVersion() {
  return new Promise((resolve, reject) => {
    execFile('claude', ['--version'], { shell: process.platform === 'win32', timeout: 10000 }, (err, out) => (
      err ? reject(new Error('Claude Code not found (is `claude` on your PATH?)')) : resolve(out.trim())));
  });
}

function claudeChat(cfg, text, persona, onDelta, signal) {
  // her persona, from a file: too long and too full of quotes and newlines for cmd's command line. It has
  // what she knows about you in it: a folder of its own that only you can open, gone once she's answered.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-'));
  const personaFile = path.join(dir, 'persona.txt');
  fs.writeFileSync(personaFile, persona, { mode: 0o600 });
  const tidy = () => fs.rmSync(dir, { recursive: true, force: true });
  const args = ['-p', '--output-format', 'stream-json', '--verbose',
    '--permission-mode', CLAUDE_MODES.includes(cfg.claudeMode) ? cfg.claudeMode : 'default',
    '--append-system-prompt-file', quote(personaFile)];
  if (!claudeSession) claudeSession = randomUUID();
  args.push(claudeStarted ? '--resume' : '--session-id', claudeSession);
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, {
      cwd: cfg.claudeCwd || os.homedir(),
      shell: process.platform === 'win32',
      windowsHide: true,
    });
    child.stdin.on('error', () => {}); // (it may be gone before it reads the message: that's the 'close' below, not a crash)
    const kill = () => (process.platform === 'win32'
      ? execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], () => {})
      : child.kill());
    signal.addEventListener('abort', kill, { once: true });
    let buffer = '';
    let all = '';
    let result = null;
    let errors = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        claudeStarted = true;
        if (msg.type === 'assistant') {
          for (const block of msg.message?.content || []) {
            if (block.type !== 'text' || !block.text) continue;
            const piece = (all ? '\n' : '') + block.text;
            all += piece;
            onDelta(piece);
          }
        } else if (msg.type === 'result') {
          result = msg;
        }
      }
    });
    child.stderr.on('data', (chunk) => { errors += chunk; });
    child.stdin.end(text);
    child.on('error', (err) => {
      tidy();
      reject(err);
    });
    child.on('close', () => {
      tidy();
      if (signal.aborted) return reject(new Error('stopped'));
      if (result?.is_error) return reject(new Error(result.result || 'Claude Code failed'));
      if (!result) return reject(new Error(errors.trim().slice(0, 300) || 'Claude Code gave no answer'));
      resolve(result.result || all);
    });
  });
}

function resetClaude() {
  claudeSession = null;
  claudeStarted = false;
}

// Claude Code's conversation, to save and pick up again after a restart.
const claudeMemory = () => ({ session: claudeSession, started: claudeStarted });
function restoreClaude(saved) {
  claudeSession = saved?.session || null;
  claudeStarted = Boolean(claudeSession && saved.started);
}

const isChatSession = (id) => Boolean(id) && id === claudeSession;

// `task`: 'chat' (her talk) or 'note' (her notebook about you); `lang`: what she speaks. A local model is asked in the way
// that suits the task (tune.js); the others are left to their own defaults.
async function chat(id, cfg, { model, messages, task = 'chat', lang = 'en' }, onDelta, signal) {
  const p = endpoint(id, cfg);
  if (p.kind === 'ollama') return ollama.chat({ model, messages, task, lang }, onDelta, signal);
  // Claude Code keeps its own memory of the conversation: only her persona and your last message go
  if (p.kind === 'claude') return claudeChat(cfg, messages.at(-1).content, messages[0].content, onDelta, signal);
  if (p.kind === 'anthropic') return anthropic.chat(p.key, { model: model || anthropic.DEFAULT_MODEL, messages }, onDelta, signal);
  return openaiChat(p, { model, messages }, onDelta, signal);
}

// A default vision model to try when you haven't picked one, per provider.
const VISION_MODELS = {
  ollama: 'qwen2.5vl',
  openai: 'gpt-4o-mini',
  openrouter: 'google/gemini-2.0-flash-exp:free',
  gemini: 'gemini-2.0-flash',
  groq: 'meta-llama/llama-4-scout-17b-16e-instruct',
  mistral: 'pixtral-12b-latest',
  pollinations: 'openai',
  anthropic: anthropic.DEFAULT_MODEL,
};

// Her eyes: one look at a picture (base64 JPEG), answered in one go (not streamed). `prompt` is
// what to make of it; `model` the vision model, or the provider's default. Returns the text.
// Claude Code and plain local servers with no vision model throw; the caller falls back.
async function see(id, cfg, { image, prompt, model = null }) {
  const p = endpoint(id, cfg);
  const use = model || cfg.visionModel || VISION_MODELS[id];
  if (p.kind === 'claude') throw Object.assign(new Error('Claude Code has no eyes here'), { code: 'noeyes' });
  // (a vision model named for another service isn't one of Claude's)
  if (p.kind === 'anthropic') return anthropic.see(p.key, { model: /^claude-/.test(use || '') ? use : anthropic.DEFAULT_MODEL, image, prompt });
  if (p.kind === 'ollama') {
    if (!use) throw Object.assign(new Error('no vision model set'), { code: 'novision' });
    return ollama.once({ model: use, messages: [{ role: 'user', content: prompt, images: [image] }] }, AbortSignal.timeout(40000));
  }
  if (!p.url) throw Object.assign(new Error('no address for this server'), { code: 'nourl' });
  if (p.env && !p.key) throw Object.assign(new Error(`no API key (or ${p.env})`), { code: 'nokey' });
  if (!use) throw Object.assign(new Error('no vision model set'), { code: 'novision' });
  const content = [
    { type: 'text', text: prompt },
    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image}` } },
  ];
  const res = await fetch(`${p.url}/chat/completions`, {
    method: 'POST',
    headers: headers(p.key),
    body: JSON.stringify({ model: use, messages: [{ role: 'user', content }], max_tokens: 300, stream: false }),
    signal: AbortSignal.timeout(40000),
  });
  if (!res.ok) throw await failure(res);
  const body = await res.json();
  return body.choices?.[0]?.message?.content || '';
}

// Whether her answers stay on this PC: a server on this machine.
function isLocal(id, cfg) {
  if (id === 'ollama') return /^(https?:\/\/)?(127\.0\.0\.1|localhost|0\.0\.0\.0|\[?::1\]?)(:|\/|$)/.test(process.env.OLLAMA_HOST || '127.0.0.1');
  if (id === 'custom') return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(cfg.customUrl || '');
  return Boolean(PROVIDERS[id].local);
}

// A model as her menus show it (Claude's have names: "Claude Opus 5.5"; the rest are their own ids).
const modelLabel = (id, model) => (PROVIDERS[id]?.kind === 'anthropic' ? anthropic.label(model) : model);

module.exports = { isLocal, PROVIDERS, CLAUDE_MODES, VISION_MODELS, models, modelLabel, warm, chat, see, resetClaude, isChatSession, claudeMemory, restoreClaude };
