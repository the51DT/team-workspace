const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { storePath, saveSnapshot } = require('./cx-store.cjs');
const { randomUUID } = require('node:crypto');

const files = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/config.js': ['config.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
};
const port = Number(process.env.PORT || 3000);
function createServer(destination = storePath) {
let writes = Promise.resolve();
return http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/api/tasks' && req.method === 'POST') {
    try {
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
        res.writeHead(403).end(); return;
      }
      if (!req.headers['content-type']?.startsWith('application/json')) {
        res.writeHead(415).end(); return;
      }
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 65536) { res.writeHead(413).end(); return; }
      }
      let payload;
      try { payload = JSON.parse(body); } catch { res.writeHead(400).end(); return; }
      const values = payload.values;
      if (!Array.isArray(values) || values.length !== 11 || values.some(v => typeof v !== 'string')
          || !values[2].trim() || !values[5].trim() || typeof payload.id !== 'string'
          || !/^[a-zA-Z0-9-]{1,80}$/.test(payload.id)) {
        res.writeHead(400).end(); return;
      }
      const operation = writes.then(async () => {
        const snapshot = JSON.parse(await fs.readFile(destination, 'utf8'));
        if (!snapshot.tasks.some(task => task.id === payload.id)) {
          snapshot.tasks.unshift({ id: payload.id, values });
          snapshot.updatedAt = new Date().toISOString();
          snapshot.source = { ...snapshot.source, sha256: randomUUID() };
          snapshot.workers = [...new Set([...snapshot.workers, values[2]])];
          await saveSnapshot(snapshot, destination);
        }
      });
      writes = operation.catch(() => {});
      await operation;
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, id: payload.id }));
    } catch (error) {
      console.error('Task save failed:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: false }));
    }
    return;
  }
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  if (pathname === '/api/tasks') {
    try {
      const snapshot = JSON.parse(await fs.readFile(destination, 'utf8'));
      const body = JSON.stringify({ ok: true, importedAt: snapshot.importedAt,
        source: snapshot.source, rows: snapshot.tasks.map(task => task.values), workers: snapshot.workers });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (error) {
      res.writeHead(error.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: '저장된 CX 데이터를 읽을 수 없습니다.' }));
    }
    return;
  }
  const file = Object.hasOwn(files, pathname) ? files[pathname] : null;
  if (!file) {
    res.writeHead(404).end('Not found');
    return;
  }
  try {
    const body = await fs.readFile(path.join(__dirname, file[0]));
    res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(500).end('Unable to read file');
  }
});
}
if (require.main === module) {
const server = createServer();
server.on('error', error => {
  console.error('로컬 서버 시작 실패:', error.message);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  console.log(`CX 업무 관리: http://127.0.0.1:${server.address().port}`);
});
}
module.exports = { createServer };
