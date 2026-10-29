'use strict';

// Runs ONE test file of the project with node:test's own runner and says what happened as lines of JSON on its output, so that the
// check does not depend on how a given Node version prints (spec, TAP, dot…). Started by unit.js with the Node (or Capri's own Node)
// the tests are to run with.

delete process.env.NODE_TEST_CONTEXT; // (when this is started from inside a test run, node:test would take it for one of its own files)
const { run } = require('node:test');
const path = require('node:path');

process.stdout.on('error', () => {}); // (the reader went away)
const file = path.resolve(process.argv[2] || '');
const say = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);

const errorText = (err) => {
  if (!err) return '';
  const cause = err.cause && err.cause !== err ? err.cause : err;
  const text = String(cause.stack || cause.message || cause);
  const extra = cause.code && cause.code !== 'ERR_TEST_FAILURE' ? ` [${cause.code}]` : '';
  return text.slice(0, 4000) + extra;
};

const stream = run({ files: [file], concurrency: 1 });
stream.on('test:pass', (d) => {
  if (d.details && d.details.type === 'suite') return;
  say({ t: d.skip ? 'skip' : d.todo ? 'todo' : 'pass', name: d.name, nesting: d.nesting, ms: Math.round((d.details && d.details.duration_ms) || 0) });
});
stream.on('test:fail', (d) => {
  if (d.details && d.details.type === 'suite') return;
  say({ t: 'fail', name: d.name, nesting: d.nesting, ms: Math.round((d.details && d.details.duration_ms) || 0), error: errorText(d.details && d.details.error) });
});
stream.on('test:stdout', (d) => say({ t: 'out', text: String(d.message || '').slice(0, 4000) }));
stream.on('test:stderr', (d) => say({ t: 'err', text: String(d.message || '').slice(0, 4000) }));
stream.on('test:diagnostic', (d) => say({ t: 'diag', text: String(d.message || '') }));
stream.on('data', () => {}); // (the events only flow while the stream is read)
stream.on('end', () => say({ t: 'end' }));
stream.on('error', (err) => { say({ t: 'crash', error: String(err && err.stack || err) }); process.exitCode = 2; });
