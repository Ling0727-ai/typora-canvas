import test from 'node:test';
import assert from 'node:assert/strict';
import { FormulaEngine } from '../src/formula-client.js';

function fakeEngine(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const workers = [];
  const engine = new FormulaEngine({ createWorker: () => {
    const worker = { messages: [], terminated: false,
      postMessage(data) { this.messages.push(data); },
      terminate() { this.terminated = true; },
      receive(data) { this.onmessage({ data }); },
      complete(result = 'SVG') { this.receive({ id: this.messages.at(-1).id, result }); } };
    workers.push(worker); return worker;
  } });
  t.after(() => engine.destroy());
  return { engine, workers };
}

test('startup and time waiting behind earlier formulas do not consume the job timeout', async t => {
  const { engine, workers } = fakeEngine(t);
  const a = engine.render('a'), b = engine.render('b');
  t.mock.timers.tick(6000);
  assert.equal(engine.getStats().failed, 0); assert.equal(workers[0].messages.length, 0);
  workers[0].receive({ type: 'ready' });
  t.mock.timers.tick(4000); workers[0].complete('aSVG');
  t.mock.timers.tick(4000); workers[0].complete('bSVG');
  assert.deepEqual(await Promise.all([a, b]), ['aSVG', 'bSVG']);
  assert.equal(workers.length, 1); assert.equal(engine.getStats().failed, 0);
});

test('a timed out equation alone fails; queued formulas resume after a fresh worker is ready', async t => {
  const { engine, workers } = fakeEngine(t);
  const a = engine.render('a'), bad = engine.render('bad'), b = engine.render('b');
  const rejected = assert.rejects(bad, /公式排版超时/);
  workers[0].receive({ type: 'ready' }); workers[0].complete('aSVG');
  t.mock.timers.tick(5000); await rejected;
  assert.equal(workers[0].terminated, true); assert.equal(workers.length, 2);
  // A late message from the dead worker cannot complete a different job.
  workers[0].complete('late');
  workers[1].receive({ type: 'ready' }); workers[1].complete('bSVG');
  assert.equal(await a, 'aSVG'); assert.equal(await b, 'bSVG');
  assert.deepEqual(engine.getStats(), { submitted: 3, completed: 2, failed: 1, restarts: 1, queued: 0, active: false });
});

test('a formula error keeps the worker and other results; an evicted queued task is never sent', async t => {
  const { engine, workers } = fakeEngine(t), cancel = new AbortController();
  const bad = engine.render('bad'), removed = engine.render('removed', {}, { signal: cancel.signal }), good = engine.render('good');
  const rejected = assert.rejects(bad, /invalid TeX/), aborted = assert.rejects(removed, { name: 'AbortError' });
  cancel.abort(); workers[0].receive({ type: 'ready' });
  workers[0].receive({ id: workers[0].messages[0].id, error: 'invalid TeX' });
  workers[0].complete('goodSVG');
  await rejected; await aborted; assert.equal(await good, 'goodSVG');
  assert.deepEqual(workers[0].messages.map(m => m.tex), ['bad', 'good']);
  assert.equal(workers.length, 1);
});

test('worker startup failure settles the queue once without restarting forever', async t => {
  const { engine, workers } = fakeEngine(t);
  const a = assert.rejects(engine.render('a'), /公式线程启动超时/), b = assert.rejects(engine.render('b'), /公式线程启动超时/);
  t.mock.timers.tick(15000); await Promise.all([a, b]);
  assert.equal(workers.length, 1); assert.equal(engine.pending.size, 0); assert.equal(engine.worker, null);
});
