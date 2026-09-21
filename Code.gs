const DATA_SHEETS = {cx:'웹앱_CX_업무데이터', enterprise:'웹앱_기업_업무데이터', aldot:'웹앱_알닷_업무데이터'};
const WORKER_SHEETS = {cx:'웹앱_CX_작업자', enterprise:'웹앱_기업_작업자', aldot:'웹앱_알닷_작업자'};
function workspaceKey(value){const key=value||'cx';if(!Object.prototype.hasOwnProperty.call(DATA_SHEETS,key))throw new Error('지원하지 않는 업무 공간입니다.');return key}

function doGet(e) {
  try {
    return jsonResponse(loadPayload(e && e.parameter && e.parameter.workspace));
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message });
  }
}

function doPost(e) {
  try {
    const request = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (request.action === 'load') return jsonResponse(loadPayload(request.workspace));
    if (request.action === 'save') return jsonResponse(savePayload(request.tasks, request.workspace));
    if (request.action === 'saveWorkers') return jsonResponse(saveWorkersPayload(request.workers, request.workspace));
    return jsonResponse({ ok: false, error: '지원하지 않는 요청입니다.' });
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message });
  }
}

function loadPayload(workspace) {
  workspace=workspaceKey(workspace);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const values = getDataSheet(workspace).getRange('A2:B2').getValues()[0];
    const tasks = values[0] ? JSON.parse(values[0]) : [];
    validateTasks(tasks);
    return { ok: true, workspace: workspace, tasks: tasks, workers: loadWorkers(workspace), updatedAt: values[1] || '' };
  } finally {
    lock.releaseLock();
  }
}

function loadWorkers(workspace) {
  const sheet = getWorkerSheet(workspace, false);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues()
    .flat().map(function (name) { return String(name).trim(); }).filter(Boolean);
}

function saveWorkersPayload(workers, workspace) {
  workspace = workspaceKey(workspace);
  if (!Array.isArray(workers)) throw new Error('작업자 목록 형식이 올바르지 않습니다.');
  const names = workers.map(function (name) { return String(name || '').trim(); }).filter(Boolean)
    .filter(function (name, index, all) { return all.indexOf(name) === index; });
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getWorkerSheet(workspace, true);
    if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).clearContent();
    if (names.length) sheet.getRange(2, 1, names.length, 1).setValues(names.map(function (name) { return [name]; }));
    SpreadsheetApp.flush();
    return { ok: true, workspace: workspace, workers: names };
  } finally { lock.releaseLock(); }
}

function getWorkerSheet(workspace, createIfMissing) {
  workspace = workspaceKey(workspace);
  const book = SpreadsheetApp.getActiveSpreadsheet();
  if (!book) throw new Error('대상 스프레드시트의 확장 프로그램 → Apps Script에서 실행해 주세요.');
  const sheetName = WORKER_SHEETS[workspace];
  let sheet = book.getSheetByName(sheetName);
  if (!sheet && createIfMissing) {
    sheet = book.insertSheet(sheetName);
    sheet.getRange('A1:A1').setValues([['작업자']]);
    sheet.hideSheet();
  }
  return sheet;
}

// 9열: 등록, RMS, 작업자, 단계, 완료 & 반영일, 업무제목, 비고, 실 작업 시간, 조정.
// 기존 프로젝트에서 저장한 11열 데이터도 조회할 수 있습니다.
function validateTasks(tasks) {
  if (!Array.isArray(tasks) || tasks.some(function (row) {
    return !Array.isArray(row) || (row.length !== 9 && row.length !== 11) ||
      row.some(function (value) {
        return value !== null && ['string', 'number', 'boolean'].indexOf(typeof value) === -1;
      });
  })) {
    throw new Error('업무 데이터는 9개 열의 배열이어야 합니다.');
  }
}

function savePayload(tasks, workspace) {
  workspace=workspaceKey(workspace);
  validateTasks(tasks);
  const json = JSON.stringify(tasks);
  if (json.length > 50000) {
    throw new Error('업무 데이터가 한 셀의 저장 한도(50,000자)를 초과했습니다.');
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const updatedAt = new Date().toISOString();
    getDataSheet(workspace).getRange('A2:B2').setValues([[json, updatedAt]]);
    SpreadsheetApp.flush();
    return { ok: true, workspace: workspace, updatedAt: updatedAt };
  } finally {
    lock.releaseLock();
  }
}

function getDataSheet(workspace) {
  workspace=workspaceKey(workspace);
  const sheetName=DATA_SHEETS[workspace];
  const book = SpreadsheetApp.getActiveSpreadsheet();
  if (!book) throw new Error('대상 스프레드시트의 확장 프로그램 → Apps Script에서 실행해 주세요.');
  let sheet = book.getSheetByName(sheetName);
  if (!sheet) {
    sheet = book.insertSheet(sheetName);
    sheet.getRange('A1:B1').setValues([['업무 데이터(JSON)', '최종 저장 시각']]);
    sheet.hideSheet();
  }
  return sheet;
}

function jsonResponse(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
