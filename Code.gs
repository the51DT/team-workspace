const DATA_SHEETS = {cx:'웹앱_CX_업무데이터', enterprise:'웹앱_기업_업무데이터', aldot:'웹앱_알닷_업무데이터'};
const WORKER_SHEETS = {cx:'웹앱_CX_작업자', enterprise:'웹앱_기업_작업자', aldot:'웹앱_알닷_작업자'};
const LEDGER_SPREADSHEET_ID='1GE6qRt40qIQH_lol2XD7T9cTPBrrqPk2gDvZy2y-pz8';
const LEDGER_NAMES={cx:'CX',enterprise:'기업',aldot:'알닷'};
const AUTH_SHEET='웹앱_계정', SESSION_SHEET='웹앱_세션', AUDIT_SHEET='웹앱_수정이력';
const ROLES=['admin','editor'];
const KST_OFFSET_MS=9*60*60*1000,DAY_MS=24*60*60*1000;
function kstTimestamp(value){return new Date((value||new Date()).getTime()+KST_OFFSET_MS).toISOString().slice(0,19).replace('T',' ')+' KST';}
function kstIsoTimestamp(value){return new Date((value||new Date()).getTime()+KST_OFFSET_MS).toISOString().slice(0,19)+'+09:00';}
function timestampMillis(value){
 const match=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) KST$/);
 return match?Date.UTC(+match[1],+match[2]-1,+match[3],+match[4]-9,+match[5],+match[6]):new Date(value).getTime();
}
function nextSessionMidnight(now=Date.now()){return (Math.floor((now+KST_OFFSET_MS)/DAY_MS)+1)*DAY_MS-KST_OFFSET_MS;}
function sessionExpiry(value){
 const stored=timestampMillis(value);
 // Also align legacy 24-hour expiry values to the intervening Korean midnight.
 return Math.floor((stored+KST_OFFSET_MS)/DAY_MS)*DAY_MS-KST_OFFSET_MS;
}
function workspaceKey(value){const key=value||'cx';if(!Object.prototype.hasOwnProperty.call(DATA_SHEETS,key))throw new Error('지원하지 않는 업무 공간입니다.');return key}

function doGet(){return jsonResponse({ok:false,error:'로그인이 필요합니다. 인증된 POST 요청을 사용해 주세요.'});}

let requestStartedAt=0,requestBook=null,requestPhases=null;
function activeBook(){return requestBook||SpreadsheetApp.getActiveSpreadsheet();}
function doPost(e) {
  requestStartedAt=Date.now();requestPhases={};
  try {
    const request=JSON.parse((e&&e.postData&&e.postData.contents)||'{}');
    requestBook=SpreadsheetApp.getActiveSpreadsheet();
    if(request.action==='authStatus')return jsonResponse({ok:true,setupRequired:!hasUsers()});
    if(request.action==='setupAdmin')return jsonResponse(setupAdmin(request));
    if(request.action==='login')return jsonResponse(loginPayload(request));
    if(request.action==='loginContinue')return jsonResponse(loginChunkPayload(request));

    const authStartedAt=Date.now();
    const user=requireSession(request.token);
    requestPhases.authMs=Date.now()-authStartedAt;
    if(request.action==='loadAudit')return jsonResponse(loadAuditPayload(request.workspace,request.cursor));
    if(request.action==='changePassword')return jsonResponse(changePasswordPayload(request));
    if(request.action==='logout')return jsonResponse(logoutPayload(request.token));
    if(request.action==='session')return jsonResponse({ok:true,user:publicUser(user)});
    if(request.action==='load'){const started=Date.now(),result=loadPayload(request.workspace);requestPhases.loadMs=Date.now()-started;return jsonResponse(Object.assign(result,{user:publicUser(user)}));}
    if(request.action==='save'){requireRole(user,['admin','editor']);return jsonResponse(savePayload(request.tasks,request.workspace,user));}
    if(request.action==='backupLedger'){requireRole(user,['admin','editor']);return jsonResponse(backupLedgerPayload(request.headers,request.rows,request.workspace,request.month));}
    if(request.action==='saveWorkers'){requireRole(user,['admin']);return jsonResponse(saveWorkersPayload(request.workers,request.workspace));}
    if(request.action==='listUsers'){requireRole(user,['admin']);return jsonResponse({ok:true,users:listUsers()});}
    if(request.action==='createUser'){requireRole(user,['admin']);return jsonResponse(createUserPayload(request));}
    return jsonResponse({ok:false,error:'지원하지 않는 요청입니다.'});
  }catch(error){return jsonResponse({ok:false,error:error.message});}
}
function loadPayload(workspace) {
  workspace=workspaceKey(workspace);
  // Existing data is read in one range call; readers need not wait for writers.
  const book=activeBook();
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
  const last=sheet?sheet.getLastRow():0;
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, 1).getDisplayValues()
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
  const book=activeBook();
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

// 13열: 기존 12개 열 + 기획/퍼블 구분. 이전 9·11·12열 데이터도 조회합니다.
function validateTasks(tasks) {
  if (!Array.isArray(tasks) || tasks.some(function (row) {
    return !Array.isArray(row) || [9,11,12,13].indexOf(row.length) === -1 ||
      row.some(function (value) {
        return value !== null && ['string', 'number', 'boolean'].indexOf(typeof value) === -1;
      });
  })) {
    throw new Error('업무 데이터는 9, 11, 12 또는 13개 열의 배열이어야 합니다.');
  }
}

function backupLedgerPayload(headers,rows,workspace,month) {
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month||'')))throw new Error('백업 대상 월이 필요합니다. 최신 화면으로 새로고침해 주세요.');
  workspace=workspaceKey(workspace);
  if(!Array.isArray(headers)||!headers.length||headers.some(value=>typeof value!=='string'))throw new Error('업무대장 헤더 형식이 올바르지 않습니다.');
  if(!Array.isArray(rows)||rows.some(row=>!Array.isArray(row)||row.length!==headers.length||row.some(value=>value!==null&&!['string','number','boolean'].includes(typeof value))))throw new Error('업무대장 데이터 형식이 올바르지 않습니다.');
  const lock=LockService.getScriptLock();
  lock.waitLock(10000);
  try{
    let book;
    try{book=SpreadsheetApp.openById(LEDGER_SPREADSHEET_ID);}catch{throw new Error('백업 스프레드시트에 접근할 수 없습니다. Apps Script 실행 계정의 편집 권한과 스프레드시트 접근 승인을 확인해 주세요.');}
    const name=LEDGER_NAMES[workspace]+'_'+month;
    let sheet=book.getSheetByName(name);
    if(!sheet)sheet=book.insertSheet(name);
    sheet.clearContents();
    const values=[headers,...rows].map(row=>row.map(value=>value===null?'':value));
    sheet.getRange(1,1,values.length,headers.length).setValues(values);
    if(sheet.setFrozenRows)sheet.setFrozenRows(1);
    SpreadsheetApp.flush();
    return {ok:true,workspace:workspace,sheet:name,rowCount:rows.length,backedUpAt:kstTimestamp()};
  }finally{lock.releaseLock();}
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
    const updatedAt = kstIsoTimestamp();
    const dataSheet=getDataSheet(workspace),old=dataSheet.getRange('A2:B2').getValues()[0];
    const previous=old[0]?JSON.parse(old[0]):[];
    dataSheet.getRange('A2:B2').setValues([[json, updatedAt]]);
    if(user)appendAudit(workspace,user,previous,tasks,kstTimestamp());
    SpreadsheetApp.flush();
    return { ok: true, workspace: workspace, updatedAt: updatedAt };
  } finally {
    lock.releaseLock();
  }
}

function getDataSheet(workspace) {
  workspace=workspaceKey(workspace);
  const sheetName=DATA_SHEETS[workspace];
  const book=activeBook();
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
  if(requestPhases)payload.serverPhases=requestPhases;
  if(requestStartedAt)payload.serverElapsedMs=Date.now()-requestStartedAt;
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function hiddenSheet(name,headers){const book=activeBook();if(!book)throw new Error('대상 스프레드시트에서 실행해 주세요.');let sheet=book.getSheetByName(name);if(!sheet){sheet=book.insertSheet(name);sheet.getRange(1,1,1,headers.length).setValues([headers]);sheet.hideSheet();}return sheet;}
function authSheet(){return hiddenSheet(AUTH_SHEET,['아이디','이름','권한','Salt','Password Hash','활성','생성일']);}
function sessionSheet(){return hiddenSheet(SESSION_SHEET,['Token','아이디','만료시각']);}
function auditSheet(){return hiddenSheet(AUDIT_SHEET,['시각','아이디','이름','권한','워크스페이스','작업','업무','항목','변경 전','변경 후']);}
function hasUsers(){return authSheet().getLastRow()>1;}
function cleanUsername(v){const u=String(v||'').trim().toLowerCase();if(!/^[a-z0-9._-]{3,40}$/.test(u))throw new Error('아이디는 영문 소문자, 숫자, ., _, -로 3~40자여야 합니다.');return u;}
function cleanPassword(v){const p=String(v||'');if(p.length<8||p.length>20)throw new Error('비밀번호는 8~20자여야 합니다.');return p;}
// After the first digest the input is always 43/44 ASCII base64url bytes.
// Process this single SHA-256 block locally instead of making 4,000 service calls.
function hashBase64Block(value){
 const k=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
 const initial=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],w=new Array(64).fill(0);
 const rotate=(x,n)=>(x>>>n)|(x<<(32-n));
 for(let i=0;i<value.length;i++)w[i>>>2]|=value.charCodeAt(i)<<(24-(i%4)*8);
 w[value.length>>>2]|=0x80<<(24-(value.length%4)*8);w[15]=value.length*8;
 for(let i=16;i<64;i++){
  const x=w[i-15],y=w[i-2];
  w[i]=(w[i-16]+(rotate(x,7)^rotate(x,18)^(x>>>3))+w[i-7]+(rotate(y,17)^rotate(y,19)^(y>>>10)))|0;
 }
 let [a,b,c,d,e,f,g,h]=initial;
 for(let i=0;i<64;i++){
  const t1=(h+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^(~e&g))+k[i]+w[i])|0;
  const t2=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c)))|0;
  h=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0;
 }
 const words=[a,b,c,d,e,f,g,h].map((v,i)=>(v+initial[i])|0),bytes=[];
 for(const word of words)for(let shift=24;shift>=0;shift-=8)bytes.push((word>>>shift)&255);
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';let out='';
 for(let i=0;i<bytes.length;i+=3){const v=(bytes[i]<<16)|((bytes[i+1]||0)<<8)|(bytes[i+2]||0);out+=alphabet[(v>>>18)&63]+alphabet[(v>>>12)&63];if(i+1<bytes.length)out+=alphabet[(v>>>6)&63];if(i+2<bytes.length)out+=alphabet[v&63];}
 return out+(value.endsWith('=')?'=':'');
}
function advancePasswordHash(value,iterations){
 if(iterations<1)return value;
 value=Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,value,Utilities.Charset.UTF_8));
 for(let i=1;i<iterations;i++)value=hashBase64Block(value);
 return value;
}
function passwordHash(p,s){return advancePasswordHash(s+':'+p,2000);}
function passwordFingerprint(p,user){return 'password-ok-v1:'+Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,user.username+'\u0000'+user.hash+'\u0000'+p,Utilities.Charset.UTF_8));}
function passwordMatches(p,user){
 const key=passwordFingerprint(p,user);
 let cache;
 try{cache=CacheService.getScriptCache();if(cache.get(key)==='1')return true;}catch{}
 const valid=passwordHash(p,user.salt)===user.hash;
 if(valid)try{if(cache)cache.put(key,'1',21600);}catch{}
 return valid;
}
function account(u,p,n,r){u=cleanUsername(u);p=cleanPassword(p);n=String(n||'').trim();if(!n)throw new Error('이름을 입력해 주세요.');if(ROLES.indexOf(r)<0)throw new Error('권한이 올바르지 않습니다.');const sh=authSheet(),rows=sh.getLastRow()>1?sh.getRange(2,1,sh.getLastRow()-1,7).getValues():[];if(rows.some(x=>String(x[0]).toLowerCase()===u))throw new Error('이미 존재하는 아이디입니다.');const salt=Utilities.getUuid();sh.appendRow([u,n,r,salt,passwordHash(p,salt),true,kstTimestamp()]);return {username:u,name:n,role:r};}
function setupAdmin(r){const lock=LockService.getScriptLock();lock.waitLock(10000);try{if(hasUsers())throw new Error('초기 관리자 설정이 완료되었습니다.');return {ok:true,user:account(r.username,r.password,r.name,'admin')};}finally{lock.releaseLock();}}
function createUserPayload(r){return {ok:true,user:account(r.username,r.password,r.name,r.role)};}
// Cache only row positions. Always reread live values before authenticating.
function findAuthRow(sheet,kind,value,width,ignoreCase){
 const key='auth-row-v1:'+kind+':'+Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,value,Utilities.Charset.UTF_8));
 let cache,cached;
 try{cache=CacheService.getScriptCache();cached=Number(cache.get(key));}catch{}
 const matches=row=>ignoreCase?String(row[0]).toLowerCase()===value:String(row[0])===value;
 if(Number.isInteger(cached)&&cached>=2){
  try{const row=sheet.getRange(cached,1,1,width).getValues()[0];if(matches(row))return row;}catch{}
 }
 const last=sheet.getLastRow();
 if(last>1){
  const found=sheet.getRange(2,1,last-1,1).createTextFinder(value)
   .matchEntireCell(true).matchCase(!ignoreCase).useRegularExpression(false).findNext();
  if(found){
   const position=found.getRow(),row=sheet.getRange(position,1,1,width).getValues()[0];
   if(matches(row)){try{if(cache)cache.put(key,String(position),21600);}catch{}return row;}
  }
 }
 try{if(cache)cache.remove(key);}catch{}
 return null;
}
function findUser(u){
 const row=findAuthRow(authSheet(),'user',u,7,true);
 return row?{username:String(row[0]),name:String(row[1]),role:String(row[2]),salt:String(row[3]),hash:String(row[4]),active:row[5]===true||String(row[5]).toLowerCase()==='true'}:null;
}
function publicUser(u){return {username:u.username,name:u.name,role:u.role};}
function issueLoginSession(user){
 const lock=LockService.getScriptLock();lock.waitLock(10000);
 try{
  const latest=findUser(user.username);
  if(!latest||!latest.active||ROLES.indexOf(latest.role)<0||latest.hash!==user.hash||latest.salt!==user.salt)throw new Error('계정 정보가 변경되었습니다. 다시 로그인해 주세요.');
  const token=Utilities.getUuid()+Utilities.getUuid().replace(/-/g,''),expiryDate=new Date(nextSessionMidnight()),expires=expiryDate.toISOString();
  sessionSheet().appendRow([token,user.username,kstTimestamp(expiryDate)]);
  return {ok:true,token:token,user:publicUser(latest),expiresAt:expires};
 }finally{lock.releaseLock();}
}
function loginPayload(r){
 const u=cleanUsername(r.username),p=cleanPassword(r.password),user=findUser(u);
 if(!user&&!hasUsers())return {ok:true,setupRequired:true};
 if(!user||!user.active||ROLES.indexOf(user.role)<0||!passwordMatches(p,user))throw new Error('아이디 또는 비밀번호가 올바르지 않습니다.');
 return issueLoginSession(user);
}
const LOGIN_HASH_STEPS=5, LOGIN_HASH_ITERATIONS=400;
function loginChunkPayload(r){
 const cache=CacheService.getScriptCache();let challenge,state,key,user;
 if(!r.challenge){
  const u=cleanUsername(r.username),p=cleanPassword(r.password);user=findUser(u);
  if(!user&&!hasUsers())return {ok:true,setupRequired:true};
  if(!user||!user.active||ROLES.indexOf(user.role)<0)throw new Error('아이디 또는 비밀번호가 올바르지 않습니다.');
  const verifiedKey=passwordFingerprint(p,user);
  try{if(cache.get(verifiedKey)==='1')return issueLoginSession(user);}catch{}
  challenge=Utilities.getUuid()+Utilities.getUuid().replace(/-/g,'');key='login-challenge-v1:'+challenge;
  // Hash the password before persisting state. Cache never receives plaintext.
  state={username:user.username,salt:user.salt,hash:user.hash,value:advancePasswordHash(user.salt+':'+p,LOGIN_HASH_ITERATIONS),step:1,verifiedKey:verifiedKey};
 }else{
  challenge=String(r.challenge);key='login-challenge-v1:'+challenge;
  const raw=cache.get(key);if(!raw)throw new Error('로그인 확인 시간이 만료되었습니다. 다시 로그인해 주세요.');
  state=JSON.parse(raw);user=findUser(state.username);
  if(!user||!user.active||user.hash!==state.hash||user.salt!==state.salt)throw new Error('계정 정보가 변경되었습니다. 다시 로그인해 주세요.');
  state.value=advancePasswordHash(state.value,LOGIN_HASH_ITERATIONS);state.step++;
 }
 if(state.step<LOGIN_HASH_STEPS){cache.put(key,JSON.stringify(state),600);return {ok:true,pending:true,challenge:challenge,step:state.step,total:LOGIN_HASH_STEPS};}
 cache.remove(key);
 if(state.value!==state.hash)throw new Error('아이디 또는 비밀번호가 올바르지 않습니다.');
 try{cache.put(state.verifiedKey,'1',21600);}catch{}
 return issueLoginSession(user);
}
function requireSession(token){
 token=String(token||'');if(!token)throw new Error('로그인이 필요합니다.');
 const row=findAuthRow(sessionSheet(),'session',token,3,false);
 if(row&&row[2]&&sessionExpiry(row[2])>Date.now()){
  const user=findUser(String(row[1]).toLowerCase());
  if(user&&user.active&&ROLES.indexOf(user.role)>=0)return user;
 }
 throw new Error('로그인이 만료되었습니다.');
}

function logoutPayload(token){const sh=sessionSheet();if(sh.getLastRow()>1){const rows=sh.getRange(2,1,sh.getLastRow()-1,3).getValues();for(let i=rows.length-1;i>=0;i--)if(String(rows[i][0])===String(token))sh.deleteRow(i+2);}return {ok:true};}
function requireRole(u,a){if(a.indexOf(u.role)<0)throw new Error('이 작업을 수행할 권한이 없습니다.');}
function listUsers(){const sh=authSheet();if(sh.getLastRow()<2)return [];return sh.getRange(2,1,sh.getLastRow()-1,7).getValues().map(r=>({username:String(r[0]),name:String(r[1]),role:String(r[2]),active:r[5]===true||String(r[5]).toLowerCase()==='true',createdAt:String(r[6]||'')})).filter(u=>ROLES.indexOf(u.role)>=0);}
const AUDIT_FIELDS=['등록','RMS','작업자','단계','운영 반영일','업무제목','비고','진행시각','완료시각','작업시간','조정','STG 반영일','기획/퍼블'];
function appendAudit(ws,u,before,after,at){const rows=[],max=Math.max(before.length,after.length);for(let i=0;i<max;i++){const normalize=r=>{if(!r)return r;const v=[...r];if(v.length===9)v.splice(7,0,'','');while(v.length<13)v.push('');return v};const a=normalize(before[i]),b=normalize(after[i]),title=String((b||a||[])[5]||('업무 '+(i+1)));if(!a||!b){rows.push([at,u.username,u.name,u.role,ws,!a?'추가':'삭제',title,'전체',a?JSON.stringify(a):'',b?JSON.stringify(b):'']);continue;}for(let c=0;c<Math.max(a.length,b.length);c++){const x=String(a[c]??''),y=String(b[c]??'');if(x!==y)rows.push([at,u.username,u.name,u.role,ws,'수정',title,AUDIT_FIELDS[c]||('열 '+(c+1)),x,y]);}}if(rows.length){const sh=auditSheet();sh.getRange(sh.getLastRow()+1,1,rows.length,10).setValues(rows);}}
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

function changePasswordPayload(request){
 const lock=LockService.getScriptLock();lock.waitLock(10000);
 try{
  const user=requireSession(request.token),old=cleanPassword(request.currentPassword),next=cleanPassword(request.newPassword);
  if(passwordHash(old,user.salt)!==user.hash)throw new Error('현재 비밀번호가 올바르지 않습니다.');
  if(old===next)throw new Error('새 비밀번호는 현재 비밀번호와 다르게 입력해 주세요.');
  const salt=Utilities.getUuid(),hash=passwordHash(next,salt),sh=authSheet(),rows=sh.getRange(2,1,sh.getLastRow()-1,7).getValues();
  const index=rows.findIndex(row=>String(row[0]).toLowerCase()===user.username);
  if(index<0)throw new Error('계정을 찾을 수 없습니다.');
  const sessions=sessionSheet(),last=sessions.getLastRow();
  if(last>1){const values=sessions.getRange(2,1,last-1,3).getValues();for(let i=values.length-1;i>=0;i--)if(String(values[i][1]).toLowerCase()===user.username)sessions.deleteRow(i+2);}
  sh.getRange(index+2,4,1,2).setValues([[salt,hash]]);SpreadsheetApp.flush();
  return {ok:true};
 }finally{lock.releaseLock();}
}
