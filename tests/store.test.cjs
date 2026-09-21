const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { parseCSV, makeSnapshot, saveSnapshot } = require('../cx-store.cjs');
const header = '등록,RMS,작업자,담당 기획자,단계,완료 & 반영일,업무제목,비고,업무 시작 시간,실 작업시간,조정\r\n';
const csv = header + '1/21,123,작업자 A,기획자 B,진행중,매주,"업무, 제목","첫 줄\n둘째 ""인용""",26.01.21 10:43,14.125,0';

test('CSV preserves commas, quoted newlines, headers, and all original values', () => {
  assert.deepEqual(parseCSV('\uFEFFA,B\r\n"x,y","a""b"\r\n'), [['A', 'B'], ['x,y', 'a"b']]);
  assert.throws(() => parseCSV('"unfinished'), /따옴표/);
  const result = makeSnapshot(csv);
  assert.equal(result.rawRows[1][3], '기획자 B');
  assert.equal(result.rawRows[1][7], '첫 줄\n둘째 "인용"');
  assert.deepEqual(result.tasks[0].values, ['1/21', '123', '작업자 A', '진행', '매주', '업무, 제목', '첫 줄\n둘째 "인용"', '26.01.21 10:43', '', '14.125', '0']);
  assert.equal(result.tasks[0].sourceRow, 2);
  assert.throws(() => makeSnapshot('<html>login</html>'), /필수 열/);
});

test('store persists across reads, backs up replacement, and protects data from empty imports', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cx-store-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const destination = path.join(directory, 'cx.json');
  const first = makeSnapshot(csv);
  await saveSnapshot(first, destination);
  assert.deepEqual(JSON.parse(await fs.readFile(destination, 'utf8')), first);
  const second = makeSnapshot(csv.replace('14.125', '15'));
  await saveSnapshot(second, destination);
  const backups = await fs.readdir(path.join(directory, 'backups'));
  assert.equal(backups.length, 1);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, 'backups', backups[0]), 'utf8')), first);
  await assert.rejects(saveSnapshot(makeSnapshot(header), destination), /빈 시트/);
  assert.deepEqual(JSON.parse(await fs.readFile(destination, 'utf8')), second);
});
