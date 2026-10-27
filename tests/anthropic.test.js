'use strict';

// Claude as her chat (src/main/anthropic.js), against a small stand-in for the Anthropic API that
// speaks its wire format: the real SDK does the talking, so streaming, the model list, the error
// mapping and the fallback retry are all exercised without a network or a key.
//   npm run test:claude

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

let server;
let seen = [];
let mode = 'ok';

const sse = (res, events) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const [event, data] of events) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  res.end();
};

const answer = (text, { stop = 'end_turn', model = 'claude-opus-5-5' } = {}) => {
  const pieces = text.match(/.{1,6}/g) || [''];
  return [
    ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 1 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ...pieces.map((t) => ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } }]),
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_details: stop === 'refusal' ? { type: 'refusal', category: 'cyber', explanation: 'declined' } : null }, usage: { output_tokens: 5 } }],
    ['message_stop', { type: 'message_stop' }],
  ];
};

const fail = (res, status, type, message) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ type: 'error', error: { type, message } }));
};

test.before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const parsed = body ? JSON.parse(body) : null;
      seen.push({ method: req.method, url: req.url, key: String(req.headers.authorization || req.headers['x-api-key'] || '').replace(/^Bearer /, ''), beta: req.headers['anthropic-beta'], body: parsed });
      if (seen.at(-1).key === 'bad') return fail(res, 401, 'authentication_error', 'invalid x-api-key');
      if (req.url.startsWith('/v1/models')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({
          data: [
            { type: 'model', id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5', created_at: '2026-09-01T00:00:00Z' },
            { type: 'model', id: 'claude-opus-4-1', display_name: 'Claude Opus 4.1', created_at: '2025-08-01T00:00:00Z' },
            { type: 'model', id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', created_at: '2026-10-01T00:00:00Z' },
            { type: 'model', id: 'not-claude', display_name: 'Other', created_at: '2026-10-01T00:00:00Z' },
          ],
          has_more: false, first_id: 'a', last_id: 'b',
        }));
      }
      if (req.url.startsWith('/v1/messages')) {
        if (mode === 'busy') return fail(res, 529, 'overloaded_error', 'Overloaded');
        if (mode === 'credit') return fail(res, 400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API.');
        if (mode === 'nofallback' && req.headers['anthropic-beta']) return fail(res, 400, 'invalid_request_error', 'unknown beta: server-side-fallback-2026-07-01');
        if (mode === 'refusal') return sse(res, answer('', { stop: 'refusal' }));
        if (parsed.stream) return sse(res, answer('Ну, слушаю тебя, чумба.', { model: parsed.model }));
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ id: 'msg_2', type: 'message', role: 'assistant', model: parsed.model, content: [{ type: 'text', text: '{"scene":"code","mood":"smug","line":"О, код."}' }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 5 } }));
      }
      return fail(res, 404, 'not_found_error', 'nope');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => new Promise((r) => server.close(r)));
test.beforeEach(() => { seen = []; mode = 'ok'; });

const claude = () => require('../src/main/anthropic.js');

test('the account\'s models: only Claude ones, her favourites first, names kept for the menu', async () => {
  const list = await claude().models('sk-ant-test');
  assert.deepEqual(list, ['claude-opus-5-5', 'claude-haiku-5-5', 'claude-opus-4-1']);
  assert.equal(claude().label('claude-opus-5-5'), 'Claude Opus 5.5');
  assert.equal(claude().label('unlisted'), 'unlisted');
  assert.equal(seen[0].key, 'sk-ant-test');
});

test('her answer streams in pieces and comes back whole, with her persona as the system prompt', async () => {
  const pieces = [];
  const text = await claude().chat('sk-ant-test', {
    model: 'claude-opus-5-5',
    messages: [
      { role: 'system', content: 'You are Capri.' },
      { role: 'assistant', content: 'stray first line' },
      { role: 'user', content: 'привет' },
    ],
  }, (p) => pieces.push(p), new AbortController().signal);
  assert.equal(text, 'Ну, слушаю тебя, чумба.');
  assert.ok(pieces.length > 1);
  assert.equal(pieces.join(''), text);
  const sent = seen.find((r) => r.url.startsWith('/v1/messages')).body;
  assert.equal(sent.system, 'You are Capri.');
  assert.deepEqual(sent.messages, [{ role: 'user', content: 'привет' }], 'the first turn is yours');
  assert.equal(sent.model, 'claude-opus-5-5');
  assert.deepEqual(sent.output_config, { effort: 'low' });
  assert.equal(sent.thinking, undefined, 'thinking is left to the model');
  assert.equal(sent.temperature, undefined);
});

test('where the API can re-run a declined request elsewhere, she asks for it; an older model does not', async () => {
  await claude().chat('k', { model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'hi' }] }, () => {}, new AbortController().signal);
  let req = seen.find((r) => r.url.startsWith('/v1/messages'));
  assert.equal(req.beta, 'server-side-fallback-2026-07-01');
  assert.equal(req.body.fallbacks, 'default');
  seen = [];
  await claude().chat('k', { model: 'claude-sonnet-4-5', messages: [{ role: 'user', content: 'hi' }] }, () => {}, new AbortController().signal);
  req = seen.find((r) => r.url.startsWith('/v1/messages'));
  assert.equal(req.beta, undefined);
  assert.equal(req.body.fallbacks, undefined);
  assert.equal(req.body.output_config, undefined, 'the older ones reject effort');
});

test('an account without the fallback beta gets the same request without it', async () => {
  mode = 'nofallback';
  const text = await claude().chat('k', { model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'hi' }] }, () => {}, new AbortController().signal);
  assert.equal(text, 'Ну, слушаю тебя, чумба.');
  const calls = seen.filter((r) => r.url.startsWith('/v1/messages'));
  assert.equal(calls.length, 2);
  assert.equal(calls[1].beta, undefined);
});

test('errors come with a code her setup understands', async () => {
  await assert.rejects(claude().models('bad'), (e) => e.code === 'badkey' && /x-api-key/.test(e.message));
  mode = 'busy';
  await assert.rejects(claude().chat('k', { model: 'claude-haiku-5-5', messages: [{ role: 'user', content: 'hi' }] }, () => {}, new AbortController().signal), (e) => e.code === 'busy');
  mode = 'credit';
  await assert.rejects(claude().chat('k', { model: 'claude-haiku-5-5', messages: [{ role: 'user', content: 'hi' }] }, () => {}, new AbortController().signal), (e) => e.code === 'credit');
  mode = 'refusal';
  await assert.rejects(claude().chat('k', { model: 'claude-haiku-5-5', messages: [{ role: 'user', content: 'hi' }] }, () => {}, new AbortController().signal), (e) => e.code === 'refused');
});

test('a message to stop it stops it', async () => {
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(claude().chat('k', { model: 'claude-haiku-5-5', messages: [{ role: 'user', content: 'hi' }] }, () => {}, abort.signal));
});

test('her eyes: a screenshot goes as an image block, the answer comes back as text', async () => {
  const text = await claude().see('k', { model: 'claude-opus-5-5', image: 'QUJD', prompt: 'what is on screen?' });
  assert.match(text, /"scene":"code"/);
  const sent = seen.find((r) => r.url.startsWith('/v1/messages')).body;
  assert.equal(sent.messages[0].content[0].type, 'image');
  assert.equal(sent.messages[0].content[0].source.media_type, 'image/jpeg');
  assert.equal(sent.messages[0].content[1].text, 'what is on screen?');
});

test('the conversation is split into system text and turns', () => {
  const { system, turns } = claude().split([
    { role: 'system', content: 'a' },
    { role: 'system', content: 'b' },
    { role: 'user', content: 'x' },
    { role: 'assistant', content: 'y' },
  ]);
  assert.equal(system, 'a\n\nb');
  assert.deepEqual(turns.map((t) => t.role), ['user', 'assistant']);
});
