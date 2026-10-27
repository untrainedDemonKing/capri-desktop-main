'use strict';

// Her chat through an OpenAI-style server (src/main/llm.js openaiChat), against a small stand-in that
// streams the way real ones do, and a little worse: comments and keep-alives between the pieces, a line
// that isn't JSON, a last line with no newline after it, an error in the middle.
//   node --test tests/openai.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

let server;
let body = '';
test.before(async () => {
  server = http.createServer((req, res) => {
    req.resume();
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
});
test.after(() => server.close());

const piece = (t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`;
const ask = async () => {
  const llm = require('../src/main/llm.js');
  const got = [];
  const text = await llm.chat('custom', { customUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKeys: {} },
    { model: 'm', messages: [{ role: 'user', content: 'hi' }] }, (p) => got.push(p), new AbortController().signal);
  return { text, got };
};

test('an answer comes through keep-alives, chatter and a non-JSON line', async () => {
  body = `: OPENROUTER PROCESSING\n\n${piece('При')}data: this is not json\n\nevent: ping\n\n${piece('вет')}data: [DONE]\n\n`;
  const { text, got } = await ask();
  assert.equal(text, 'Привет');
  assert.deepEqual(got, ['При', 'вет']);
});

test('the last piece counts even without a newline after it', async () => {
  body = `${piece('Ну')}${piece(', слушаю').trimEnd()}`;
  assert.equal((await ask()).text, 'Ну, слушаю');
});

test('an error the server sends in the stream is still an error', async () => {
  body = `${piece('Ну')}data: ${JSON.stringify({ error: { message: 'quota exceeded' } })}\n\n`;
  await assert.rejects(ask(), /quota exceeded/);
});
