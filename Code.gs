const DATA_SHEETS = {cx:'웹앱_CX_업무데이터', enterprise:'웹앱_기업_업무데이터', aldot:'웹앱_알닷_업무데이터'};
const WORKER_SHEETS = {cx:'웹앱_CX_작업자', enterprise:'웹앱_기업_작업자', aldot:'웹앱_알닷_작업자'};
const AUTH_SHEET='웹앱_계정', SESSION_SHEET='웹앱_세션', AUDIT_SHEET='웹앱_수정이력';
const ROLES=['admin','editor'], SESSION_HOURS=12;
function workspaceKey(value){const key=value||'cx';if(!Object.prototype.hasOwnProperty.call(DATA_SHEETS,key))throw new Error('지원하지 않는 업무 공간입니다.');return key}

function doGet(e) {
  try {
    const request=(e&&e.parameter)||{};
    if(request.action==='load')return jsonResponse(loadPayload(request.workspace));
    if(request.action==='loadAudit')return jsonResponse(loadAuditPayload(request.workspace,request.cursor));
    return jsonResponse({ok:false,error:'GET은 업무·수정 이력 조회만 지원합니다. action과 workspace를 지정해 주세요.'});
  }catch(error){return jsonResponse({ok:false,error:error.message});}
}

function doPost(e) {
  try {
    const request=JSON.parse((e&&e.postData&&e.postData.contents)||'{}');
    if(request.action==='authStatus')return jsonResponse({ok:true,setupRequired:!hasUsers()});
    if(request.action==='setupAdmin')return jsonResponse(setupAdmin(request));
    if(request.action==='login')return jsonResponse(loginPayload(request));
    if(request.action==='loadAudit')return jsonResponse(loadAuditPayload(request.workspace,request.cursor));
    if(request.action==='load'&&!request.token)return jsonResponse(loadPayload(request.workspace));
    const user=requireSession(request.token);
    if(request.action==='logout')return jsonResponse(logoutPayload(request.token));
    if(request.action==='session')return jsonResponse({ok:true,user:publicUser(user)});
    if(request.action==='load')return jsonResponse(Object.assign(loadPayload(request.workspace),{user:publicUser(user)}));
    if(request.action==='save'){requireRole(user,['admin','editor']);return jsonResponse(savePayload(request.tasks,request.workspace,user));}
    if(request.action==='saveWorkers'){requireRole(user,['admin']);return jsonResponse(saveWorkersPayload(request.workers,request.workspace));}
    if(request.action==='listUsers'){requireRole(user,['admin']);return jsonResponse({ok:true,users:listUsers()});}
    if(request.action==='createUser'){requireRole(user,['admin']);return jsonResponse(createUserPayload(request));}
    return jsonResponse({ok:false,error:'지원하지 않는 요청입니다.'});
  }catch(error){return jsonResponse({ok:false,error:error.message});}
}
function loadPayload(workspace) {
  workspace=workspaceKey(workspace);
  // Existing data is read in one range call; readers need not wait for writers.
  const book=SpreadsheetApp.getActiveSpreadsheet();
  let sheet=book.getSheetByName(DATA_SHEETS[workspace]);
  if(!sheet){
    const lock=LockService.getScriptLock();lock.waitLock(10000);
    try{sheet=getDataSheet(workspace);}finally{lock.releaseLock();}
  }
  const values=sheet.getRange('A2:B2').getValues()[0];
  const tasks=values[0]?JSON.parse(values[0]):[];
  validateTasks(tasks);
  return {ok:true,workspace:workspace,tasks:tasks,workers:loadWorkers(workspace),updatedAt:values[1]||''};
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

// 9열: 등록, RMS, 작업자, 단계, 운영 반영일, 업무제목, 비고, 작업시간, 조정.
// 기존 프로젝트에서 저장한 11열 데이터도 조회할 수 있습니다.
function validateTasks(tasks) {
  if (!Array.isArray(tasks) || tasks.some(function (row) {
    return !Array.isArray(row) || (row.length !== 9 && row.length !== 11 && row.length !== 12) ||
      row.some(function (value) {
        return value !== null && ['string', 'number', 'boolean'].indexOf(typeof value) === -1;
      });
  })) {
    throw new Error('업무 데이터는 9, 11 또는 12개 열의 배열이어야 합니다.');
  }
}

function savePayload(tasks, workspace, user) {
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
    const dataSheet=getDataSheet(workspace),old=dataSheet.getRange('A2:B2').getValues()[0];
    const previous=old[0]?JSON.parse(old[0]):[];
    dataSheet.getRange('A2:B2').setValues([[json, updatedAt]]);
    if(user)appendAudit(workspace,user,previous,tasks,updatedAt);
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

function hiddenSheet(name,headers){const book=SpreadsheetApp.getActiveSpreadsheet();if(!book)throw new Error('대상 스프레드시트에서 실행해 주세요.');let sheet=book.getSheetByName(name);if(!sheet){sheet=book.insertSheet(name);sheet.getRange(1,1,1,headers.length).setValues([headers]);sheet.hideSheet();}return sheet;}
function authSheet(){return hiddenSheet(AUTH_SHEET,['아이디','이름','권한','Salt','Password Hash','활성','생성일']);}
function sessionSheet(){return hiddenSheet(SESSION_SHEET,['Token','아이디','만료시각']);}
function auditSheet(){return hiddenSheet(AUDIT_SHEET,['시각','아이디','이름','권한','워크스페이스','작업','업무','항목','변경 전','변경 후']);}
function hasUsers(){return authSheet().getLastRow()>1;}
function cleanUsername(v){const u=String(v||'').trim().toLowerCase();if(!/^[a-z0-9._-]{3,40}$/.test(u))throw new Error('아이디는 영문 소문자, 숫자, ., _, -로 3~40자여야 합니다.');return u;}
function cleanPassword(v){const p=String(v||'');if(p.length<8||p.length>100)throw new Error('비밀번호는 8자 이상이어야 합니다.');return p;}
function passwordHash(p,s){let v=s+':'+p;for(let i=0;i<2000;i++)v=Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,v,Utilities.Charset.UTF_8));return v;}
function account(u,p,n,r){u=cleanUsername(u);p=cleanPassword(p);n=String(n||'').trim();if(!n)throw new Error('이름을 입력해 주세요.');if(ROLES.indexOf(r)<0)throw new Error('권한이 올바르지 않습니다.');const sh=authSheet(),rows=sh.getLastRow()>1?sh.getRange(2,1,sh.getLastRow()-1,7).getValues():[];if(rows.some(x=>String(x[0]).toLowerCase()===u))throw new Error('이미 존재하는 아이디입니다.');const salt=Utilities.getUuid();sh.appendRow([u,n,r,salt,passwordHash(p,salt),true,new Date().toISOString()]);return {username:u,name:n,role:r};}
function setupAdmin(r){const lock=LockService.getScriptLock();lock.waitLock(10000);try{if(hasUsers())throw new Error('초기 관리자 설정이 완료되었습니다.');return {ok:true,user:account(r.username,r.password,r.name,'admin')};}finally{lock.releaseLock();}}
function createUserPayload(r){return {ok:true,user:account(r.username,r.password,r.name,r.role)};}
function findUser(u){const sh=authSheet();if(sh.getLastRow()<2)return null;const rows=sh.getRange(2,1,sh.getLastRow()-1,7).getValues();for(let row of rows)if(String(row[0]).toLowerCase()===u)return {username:String(row[0]),name:String(row[1]),role:String(row[2]),salt:String(row[3]),hash:String(row[4]),active:row[5]===true||String(row[5]).toLowerCase()==='true'};return null;}
function publicUser(u){return {username:u.username,name:u.name,role:u.role};}
function loginPayload(r){const u=cleanUsername(r.username),p=cleanPassword(r.password),user=findUser(u);if(!user&&!hasUsers())return {ok:true,setupRequired:true};if(!user||!user.active||ROLES.indexOf(user.role)<0||passwordHash(p,user.salt)!==user.hash)throw new Error('아이디 또는 비밀번호가 올바르지 않습니다.');const token=Utilities.getUuid()+Utilities.getUuid().replace(/-/g,''),expires=new Date(Date.now()+SESSION_HOURS*3600000).toISOString();sessionSheet().appendRow([token,u,expires]);return {ok:true,token:token,user:publicUser(user),expiresAt:expires};}
function requireSession(token){
 token=String(token||'');if(!token)throw new Error('로그인이 필요합니다.');
 const sh=sessionSheet(),last=sh.getLastRow();
 // Read recent sessions first rather than transferring the entire session history.
 for(let end=last;end>=2;){
  const start=Math.max(2,end-99),rows=sh.getRange(start,1,end-start+1,3).getValues();
  for(let i=rows.length-1;i>=0;i--)if(String(rows[i][0])===token){
   if(new Date(rows[i][2]).getTime()>Date.now()){
    const u=findUser(String(rows[i][1]).toLowerCase());if(u&&u.active&&ROLES.indexOf(u.role)>=0)return u;
   }
   throw new Error('로그인이 만료되었습니다.');
  }
  end=start-1;
 }
 throw new Error('로그인이 만료되었습니다.');
}

function logoutPayload(token){const sh=sessionSheet();if(sh.getLastRow()>1){const rows=sh.getRange(2,1,sh.getLastRow()-1,3).getValues();for(let i=rows.length-1;i>=0;i--)if(String(rows[i][0])===String(token))sh.deleteRow(i+2);}return {ok:true};}
function requireRole(u,a){if(a.indexOf(u.role)<0)throw new Error('이 작업을 수행할 권한이 없습니다.');}
function listUsers(){const sh=authSheet();if(sh.getLastRow()<2)return [];return sh.getRange(2,1,sh.getLastRow()-1,7).getValues().map(r=>({username:String(r[0]),name:String(r[1]),role:String(r[2]),active:r[5]===true||String(r[5]).toLowerCase()==='true',createdAt:String(r[6]||'')})).filter(u=>ROLES.indexOf(u.role)>=0);}
const AUDIT_FIELDS=['등록','RMS','작업자','단계','운영 반영일','업무제목','비고','진행시각','완료시각','작업시간','조정','STG 반영일'];
function appendAudit(ws,u,before,after,at){const rows=[],max=Math.max(before.length,after.length);for(let i=0;i<max;i++){const normalize=r=>r&&r.length===9?r.slice(0,7).concat(['',''],r.slice(7)):r;const a=normalize(before[i]),b=normalize(after[i]),title=String((b||a||[])[5]||('업무 '+(i+1)));if(!a||!b){rows.push([at,u.username,u.name,u.role,ws,!a?'추가':'삭제',title,'전체',a?JSON.stringify(a):'',b?JSON.stringify(b):'']);continue;}for(let c=0;c<Math.max(a.length,b.length);c++){const x=String(a[c]??''),y=String(b[c]??'');if(x!==y)rows.push([at,u.username,u.name,u.role,ws,'수정',title,AUDIT_FIELDS[c]||('열 '+(c+1)),x,y]);}}if(rows.length){const sh=auditSheet();sh.getRange(sh.getLastRow()+1,1,rows.length,10).setValues(rows);}}
function loadAuditPayload(ws,cursor){
 ws=workspaceKey(ws);const sh=auditSheet(),last=sh.getLastRow();
 let end=cursor===undefined||cursor===''?last:Number(cursor);
 if(!Number.isInteger(end)||end<1)throw new Error('이력 조회 위치가 올바르지 않습니다.');
 end=Math.min(end,last);const entries=[];
 while(end>=2&&entries.length<50){
  const start=Math.max(2,end-499),values=sh.getRange(start,1,end-start+1,10).getDisplayValues();
  for(let i=values.length-1;i>=0;i--){
   const r=values[i];end=start+i-1;
   if(r[4]!==ws)continue;
   entries.push({at:r[0],username:r[1],name:r[2],role:r[3],workspace:r[4],action:r[5],task:r[6],field:r[7],before:r[8],after:r[9]});
   if(entries.length===50)break;
  }
 }
 return {ok:true,workspace:ws,entries:entries,nextCursor:end>=2?end:null};
}
