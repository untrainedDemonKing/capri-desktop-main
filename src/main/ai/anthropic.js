'use strict';

// Claude as her chat, through the official SDK (@anthropic-ai/sdk): an API key from
// console.anthropic.com (or ANTHROPIC_API_KEY, or a profile from `ant auth login`: with no key given the
// SDK finds its own credentials). Her answers stream in, the models are listed from the account (so a new
// one shows up by itself), and the same client reads a screenshot for her eyes.
//
// Her default is Claude Opus 5.5: she's a character that has to hold her voice, and the list lets you pick
// a cheaper or faster one (Sonnet 5.5, Haiku 5.5). Thinking can't be turned off on the newest models, so
// her replies run at low effort: a few words, no long wait.

// (the SDK takes a fifth of a second to load: only when something asks of Claude, not at every start)
let sdkModule = null;
const sdk = () => (sdkModule ||= require('@anthropic-ai/sdk'));

const DEFAULT_MODEL = 'claude-opus-5-5';
const KEY_PAGE = 'https://console.anthropic.com/settings/keys';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

// What to offer first, best-suited first (the rest of the account's models follow, newest first)
const PREFERRED = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1', 'claude-opus-5', 'claude-sonnet-5'];

// Models that take `output_config.effort` (the 4.6 line and everything after: the older ones reject it)
const EFFORT = /^claude-(opus-(4-[6-9]|5)|sonnet-(4-6|5)|haiku-5|fable|mythos)/;
// Models whose safety classifiers can decline a request, and for which the API can re-run it elsewhere
const FALLBACKS = /^claude-(opus-5|sonnet-5-5|fable|mythos)/;

// model id -> its display name, as last listed (her ring menu shows these)
const names = new Map();

const withCode = (err, code) => Object.assign(err, { code });

// The SDK client. `key` empty: the SDK looks for the credentials itself (environment, ant profile).
function make(key, options = {}) {
  const Anthropic = sdk();
  return new Anthropic({ ...(key ? { apiKey: key } : {}), maxRetries: 1, timeout: 90 * 1000, ...options });
}

// Why a call failed, in a sentence, with a code her setup knows: 'nokey' (nothing to sign in with),
// 'badkey' (it was refused), 'busy' (rate limited or overloaded: another model may answer), 'gone' (that
// model isn't there), 'credit' (the account has no balance), 'offline' (no way through to the API).
function explain(err) {
  if (err?.code && ['nokey', 'refused'].includes(err.code)) return err;
  // the API's own sentence ({"error": {"message": ...}}), not the SDK's "401 {...}" around it
  const message = String(err?.error?.error?.message || err?.message || err || 'failed');
  const Anthropic = sdk();
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return withCode(new Error(message), 'badkey');
  }
  if (/could not resolve authentication|apiKey|auth token/i.test(message) && !(err instanceof Anthropic.APIError)) {
    return withCode(new Error('no API key (or ANTHROPIC_API_KEY)'), 'nokey');
  }
  if (err instanceof Anthropic.RateLimitError || (err instanceof Anthropic.APIError && (err.status === 529 || err.status >= 500))) {
    return withCode(new Error(message), 'busy');
  }
  if (err instanceof Anthropic.NotFoundError) return withCode(new Error(message), 'gone');
  if (err instanceof Anthropic.APIError && /credit balance|billing/i.test(message)) return withCode(new Error(message), 'credit');
  if (err instanceof Anthropic.APIConnectionError) return withCode(new Error(`can't reach the Anthropic API (${message})`), 'offline');
  return err instanceof Error ? err : new Error(message);
}

// The models of the account, her favourites first. Throws with a code when it can't (see explain).
async function models(key) {
  try {
    const list = [];
    for await (const m of make(key, { timeout: 8000, maxRetries: 0 }).models.list()) {
      if (!/^claude-/.test(m.id)) continue;
      names.set(m.id, m.display_name || m.id);
      list.push(m.id);
    }
    const rank = (id) => (PREFERRED.includes(id) ? PREFERRED.indexOf(id) : PREFERRED.length);
    return list.sort((a, b) => rank(a) - rank(b));
  } catch (err) {
    throw explain(err);
  }
}

const label = (id) => names.get(id) || id;

// Her persona and the conversation, as the API wants them: the system text apart, the turns after.
// (Consecutive turns of one speaker are fine to it; the first one has to be yours.)
function split(messages) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const turns = messages.filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => ({ role: m.role, content: String(m.content) }));
  while (turns.length && turns[0].role !== 'user') turns.shift();
  return { system, turns };
}

const textOf = (message) => (message?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');

// The request for one answer of hers: low effort (she answers in a few words), and, where the API
// offers it, a refusal re-run on another model so a declined message doesn't leave her speechless.
function request(model, { system, turns }, { max = 8000 } = {}) {
  const params = { model, max_tokens: max, messages: turns };
  if (system) params.system = system;
  if (EFFORT.test(model)) params.output_config = { effort: 'low' };
  return params;
}

// Her answer, streamed: onDelta(piece) as it comes, resolves with all of it. `signal` stops it.
async function chat(key, { model, messages }, onDelta, signal) {
  const params = request(model || DEFAULT_MODEL, split(messages));
  if (!params.messages.length) throw new Error('nothing to answer');
  const go = async (withFallbacks) => {
    const client = make(key);
    const stream = withFallbacks
      ? client.beta.messages.stream({ ...params, betas: [FALLBACK_BETA], fallbacks: 'default' }, { signal })
      : client.messages.stream(params, { signal });
    stream.on('text', (piece) => onDelta(piece));
    return stream.finalMessage();
  };
  let message;
  try {
    try {
      message = await go(FALLBACKS.test(params.model));
    } catch (err) {
      // the account doesn't have the fallback beta: the same request without it
      if (!FALLBACKS.test(params.model) || signal?.aborted || !(err instanceof sdk().BadRequestError) || !/fallback|beta/i.test(err.message)) throw err;
      message = await go(false);
    }
  } catch (err) {
    throw explain(err);
  }
  if (message.stop_reason === 'refusal') {
    throw withCode(new Error(message.stop_details?.explanation || 'the model declined to answer'), 'refused');
  }
  return textOf(message);
}

// Her eyes: one screenshot (base64 JPEG) and what to make of it, answered in one go.
async function see(key, { model, image, prompt }) {
  const use = model || DEFAULT_MODEL;
  const params = {
    model: use,
    max_tokens: 4000, // (room for its thinking too: the answer itself is a line of JSON)
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
        { type: 'text', text: prompt },
      ],
    }],
  };
  if (EFFORT.test(use)) params.output_config = { effort: 'low' };
  try {
    return textOf(await make(key, { timeout: 40 * 1000 }).messages.create(params));
  } catch (err) {
    throw explain(err);
  }
}

module.exports = { DEFAULT_MODEL, KEY_PAGE, PREFERRED, models, label, chat, see, explain, split, request };
