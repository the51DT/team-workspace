const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { once } = require('node:events');
const { createServer } = require('../server.cjs');

test('manual tasks persist, survive restart, and do not duplicate on retry', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cx-api-'));
  const destination = path.join(directory, 'cx.json');
  await fs.writeFile(destination, JSON.stringify({ tasks: [], workers: ['테스트 작업자'], source: { sha256: 'empty' }, importedAt: null }));
  let server;
  t.after(async () => {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  async function start() {
    server = createServer(destination);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return `http://127.0.0.1:${server.address().port}/api/tasks`;
  }
  let url = await start();
  assert.equal((await (await fetch(url)).json()).rows.length, 0);
  const values = ['9/19', '', '테스트 작업자', '배정', '', '등록 테스트', '', '', '', '', ''];
  const post = id => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, values }) });
  assert.equal((await post('task-a')).status, 200);
  assert.equal((await post('task-a')).status, 200);
  const results = await Promise.all([post('task-b'), post('task-c')]);
  assert.ok(results.every(r => r.status === 200));
  assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 400);
  await new Promise(resolve => server.close(resolve));
  url = await start();
  const stored = await (await fetch(url)).json();
  assert.equal(stored.rows.length, 3);
  assert.deepEqual(stored.rows[0], values);
});
