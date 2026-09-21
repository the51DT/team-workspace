const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const spreadsheetId = '1QEgjN6IXs473j1oNuTt-5WM39CcihQNHfUN7Piyp6WI';
const storePath = path.join(__dirname, 'data', 'cx.json');
const columns = ['등록', 'RMS', '작업자', '단계', '완료 & 반영일', '업무제목', '비고', '업무 시작 시간', '업무 종료 시간', '실 작업시간', '조정'];

// CSV exports preserve mixed text/date cells that Visualization type inference drops.
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (c === ',' || c === '\r' || c === '\n')) {
      row.push(field); field = '';
      if (c !== ',') {
        rows.push(row); row = [];
        if (c === '\r' && text[i + 1] === '\n') i++;
      }
    } else field += c;
  }
  if (quoted) throw new Error('CSV의 따옴표가 닫히지 않았습니다.');
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function makeSnapshot(csv) {
  const rawRows = parseCSV(csv);
  const headers = rawRows[0]?.map(value => value.trim()) || [];
  for (const name of ['등록', '작업자', '단계', '업무제목']) {
    if (!headers.includes(name)) throw new Error(`CX 필수 열이 없습니다: ${name}`);
  }
  const tasks = rawRows.slice(1).flatMap((row, index) => {
    if (!row.some(value => value.trim())) return [];
    const values = columns.map(name => row[headers.indexOf(name)] ?? '');
    if (values[3] === '진행중') values[3] = '진행';
    return [{ sourceRow: index + 2, values }];
  });
  return {
    version: 1,
    importedAt: new Date().toISOString(),
    source: { spreadsheetId, sheet: 'CX', gid: 0,
      url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=0`,
      sha256: createHash('sha256').update(csv).digest('hex') },
    columns, rawRows, tasks,
    workers: [...new Set(tasks.map(task => task.values[2].trim()).filter(Boolean))],
  };
}

async function saveSnapshot(snapshot, destination = storePath) {
  const directory = path.dirname(destination);
  await fs.mkdir(directory, { recursive: true });
  let previous;
  try { previous = await fs.readFile(destination, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous) {
    if (JSON.parse(previous).tasks.length && !snapshot.tasks.length) {
      throw new Error('빈 시트로 기존 서버 데이터를 덮어쓰지 않았습니다.');
    }
    const backup = path.join(directory, 'backups');
    await fs.mkdir(backup, { recursive: true });
    await fs.writeFile(path.join(backup, `cx-${Date.now()}-${randomUUID()}.json`), previous, { flag: 'wx' });
  }
  const temporary = destination + '.' + randomUUID() + '.tmp';
  try {
    await fs.writeFile(temporary, JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx' });
    await fs.rename(temporary, destination);
  } finally { await fs.rm(temporary, { force: true }); }
}

async function importCX() {
  const url = new URL(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/export`);
  url.search = new URLSearchParams({ format: 'csv', gid: '0', cache: String(Date.now()) });
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok || !response.headers.get('content-type')?.includes('text/csv')) {
    throw new Error(`CX 다운로드 실패: HTTP ${response.status}`);
  }
  const snapshot = makeSnapshot(await response.text());
  await saveSnapshot(snapshot);
  console.log(`CX 업무 ${snapshot.tasks.length}건 저장 완료: ${storePath}`);
}

if (require.main === module) importCX().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { parseCSV, makeSnapshot, saveSnapshot, storePath };
