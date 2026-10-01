const {test}=require('node:test');
const assert=require('node:assert/strict');
const {harness}=require('./apps-script-harness.cjs');

function setupAdmin(app){return app.run("setupAdmin({username:'admin',password:'password1',name:'관리자'})");}

test('accounts enforce roles and editor saves create audit history',()=>{
 const app=harness();
 assert.equal(app.run('hasUsers()'),false);
 setupAdmin(app);
 assert.equal(app.run('hasUsers()'),true);
 assert.throws(()=>app.run("setupAdmin({username:'other',password:'password1',name:'다른 관리자'})"));
 const admin=app.run("loginPayload({username:'admin',password:'password1'})");
 assert.throws(()=>app.run("createUserPayload({username:'viewer',password:'password2',name:'조회자',role:'viewer'})"),/권한/);
 app.run("createUserPayload({username:'editor',password:'password3',name:'편집자',role:'editor'})");
 const editor=app.run("loginPayload({username:'editor',password:'password3'})");
 assert.equal(app.run(`requireSession(${JSON.stringify(admin.token)}).role`),'admin');
 app.run(`savePayload([['9/21','','담당자','배정','','업무','','','']], 'cx', requireSession(${JSON.stringify(editor.token)}))`);
 app.run(`savePayload([['9/21','','담당자','진행중','','업무','','','']], 'cx', requireSession(${JSON.stringify(editor.token)}))`);
 const audit=app.run("loadAuditPayload('cx')");
 assert.ok(audit.entries.some(entry=>entry.name==='편집자'&&entry.field==='단계'&&entry.before==='배정'&&entry.after==='진행중'));
});

test('all workspace reads and mutations require a session',()=>{
 const app=harness();app.run('jsonResponse=payload=>payload');
 const post=payload=>app.run('doPost({postData:{contents:'+JSON.stringify(JSON.stringify(payload))+'}})');
 for(const workspace of ['cx','enterprise','aldot']){
  assert.equal(post({action:'load',workspace}).ok,false);
  const history=post({action:'loadAudit',workspace});assert.equal(history.ok,false);assert.match(history.error,/로그인/);
 }
 for(const action of ['save','saveWorkers','listUsers','createUser']){
  const result=post({action,workspace:'cx',tasks:[],workers:[]});assert.equal(result.ok,false);assert.match(result.error,/로그인/);
 }
});

test('nine-column work hours are recorded with the correct audit field',()=>{
 const app=harness();
 app.run("appendAudit('cx',{username:'editor',name:'편집자',role:'editor'},[['9/21','','담당자','배정','','업무','','1','0']],[['9/21','','담당자','배정','','업무','','2','3']],'2026-09-21')");
 const entries=app.run("loadAuditPayload('cx').entries");
 assert.equal(entries.find(e=>e.field==='작업시간').after,'2');
 assert.equal(entries.find(e=>e.field==='조정').after,'3');
});


test('GET never exposes private reads or mutations',()=>{
 const app=harness();app.run('jsonResponse=payload=>payload');
 const get=parameter=>app.run('doGet({parameter:'+JSON.stringify(parameter)+'})');
 for(const workspace of ['cx','enterprise','aldot']){
  for(const action of ['load','loadAudit']){
   const result=get({action,workspace});assert.equal(result.ok,false);assert.match(result.error,/로그인/);
  }
 }
 for(const action of ['save','saveWorkers','setupAdmin','createUser','login','listUsers','logout','session']){
  assert.equal(get({action,workspace:'cx'}).ok,false);
 }
 assert.equal(get({action:'load',workspace:'unknown'}).ok,false);
 assert.equal(app.run('hasUsers()'),false);
});


test('retired account roles cannot log in or reuse existing sessions',()=>{
 const app=harness();setupAdmin(app);
 app.run("createUserPayload({username:'legacy',password:'password2',name:'이전 계정',role:'editor'})");
 const session=app.run("loginPayload({username:'legacy',password:'password2'})");
 app.sheets.get('웹앱_계정').rows[2][2]='viewer';
 assert.throws(()=>app.run("loginPayload({username:'legacy',password:'password2'})"));
 assert.throws(()=>app.run('requireSession('+JSON.stringify(session.token)+')'));
 assert.equal(app.run('listUsers().length'),1);
});


test('login identifies initial setup without a separate status request',()=>{
 const app=harness();assert.equal(app.run("loginPayload({username:'admin',password:'password1'}).setupRequired"),true);
 setupAdmin(app);
 assert.throws(()=>app.run("loginPayload({username:'unknown',password:'password1'})"));
 assert.ok(app.run("loginPayload({username:'admin',password:'password1'}).token"));
});

test('web login verifies the existing hash in five resumable steps without caching plaintext',()=>{
 const app=harness();setupAdmin(app);
 let result=app.run("loginChunkPayload({username:'admin',password:'password1'})");
 assert.equal(result.step,1);assert.equal(result.total,5);
 const cached=app.cache.get('login-challenge-v1:'+result.challenge);
 assert.ok(cached);assert.equal(cached.includes('password1'),false);
 let requests=1;
 while(result.pending){result=app.run('loginChunkPayload({challenge:'+JSON.stringify(result.challenge)+'})');requests++;}
 assert.equal(requests,5);assert.ok(result.token);
 assert.ok(app.run("loginChunkPayload({username:'admin',password:'password1'}).token"));
});

test('existing workspace reads do not wait for the write lock',()=>{
 const app=harness();app.run("loadPayload('cx')");
 app.run("LockService.getScriptLock=()=>({waitLock(){throw Error('writer busy')},releaseLock(){}})");
 assert.equal(app.run("loadPayload('cx').ok"),true);
 assert.throws(()=>app.run("loadPayload('enterprise')"),/writer busy/);
});


test('STG date saves and appears under its own audit field',()=>{
 const app=harness();
 app.run("savePayload([['9/22','','담당자','배정','','업무','','','','1','0','']], 'enterprise')");
 app.run("savePayload([['9/22','','담당자','배정','','업무','','','','1','0','2026-09-25']], 'enterprise', {username:'editor',name:'편집자',role:'editor'})");
 assert.equal(app.run("loadPayload('enterprise').tasks[0][11]"),'2026-09-25');
 assert.equal(app.run("loadAuditPayload('enterprise').entries[0].field"),'STG 반영일');
});


test('session lookup reads only the matched row even for old sessions',()=>{
 const app=harness();setupAdmin(app);
 const first=app.run("loginPayload({username:'admin',password:'password1'})");
 const sheet=app.sheets.get('웹앱_세션');
 for(let i=0;i<250;i++)sheet.appendRow(['other-'+i,'admin',first.expiresAt]);
 const sizes=[],getRange=sheet.getRange.bind(sheet);sheet.getRange=(...args)=>{const range=getRange(...args),read=range.getValues;range.getValues=function(){sizes.push(args[2]);return read.call(this)};return range};
 assert.equal(app.run('requireSession('+JSON.stringify(first.token)+').role'),'admin');assert.deepEqual(sizes,[1]);
 sizes.length=0;assert.equal(app.run("requireSession('other-249').role"),'admin');assert.deepEqual(sizes,[1]);
});


test('audit pages find workspace records beyond the global latest 500 without dropping entries',()=>{
 const app=harness();app.run("auditSheet()");const sheet=app.sheets.get('웹앱_수정이력');
 for(let i=0;i<63;i++)sheet.appendRow(['2026-09-24','editor','편집자','editor','cx','수정','업무 '+i,'비고','전','후']);
 for(let i=0;i<510;i++)sheet.appendRow(['2026-09-24','editor','편집자','editor','enterprise','수정','기업 '+i,'비고','전','후']);
 const first=app.run("loadAuditPayload('cx')");assert.equal(first.entries.length,50);assert.equal(first.entries[0].task,'업무 62');
 const second=app.run("loadAuditPayload('cx',"+first.nextCursor+")");assert.equal(second.entries.length,13);assert.equal(second.nextCursor,null);
 const tasks=[...first.entries,...second.entries].map(e=>e.task);assert.equal(new Set(tasks).size,63);
});

test('all edited fields in a single save produce separate audit entries',()=>{
 const app=harness();app.run("appendAudit('cx',{username:'editor',name:'편집자',role:'editor'},[['9/24','','A','배정','','업무','전','1','0']],[['9/24','','B','검수요청','2026-09-25','새 제목','후','2','0']],'2026-09-24')");
 assert.equal(app.run("loadAuditPayload('cx').entries.length"),6);
});
test('workspace ledger backup replaces the matching sheet with table data',()=>{
 const app=harness();
 const headers=['등록','RMS','작업자','단계','STG 반영일','운영 반영일','업무제목','비고','작업시간'];
 const rows=[['9/22','123','담당자','진행중','2026-09-24','2026-09-25','기업 업무','비고','1.250']];
 for(const [workspace,name] of [['cx','CX_2026-09'],['enterprise','기업_2026-09'],['aldot','알닷_2026-09']]){
  const result=app.run(`backupLedgerPayload(${JSON.stringify(headers)},${JSON.stringify(rows)},${JSON.stringify(workspace)},'2026-09')`);
  assert.equal(app.sheets.size,0);assert.equal(result.sheet,name);assert.equal(result.rowCount,1);
  assert.deepEqual(app.backupSheets.get(name).rows,[headers,...rows]);
  assert.equal(app.backupSheets.get(name).frozenRows,1);
 }
});


test('password change verifies current password, updates only the session owner and revokes their sessions',()=>{
 const app=harness();setupAdmin(app);
 app.run("createUserPayload({username:'editor',password:'password2',name:'편집자',role:'editor'})");
 const admin=app.run("loginPayload({username:'admin',password:'password1'})"),first=app.run("loginPayload({username:'editor',password:'password2'})"),second=app.run("loginPayload({username:'editor',password:'password2'})");
 const change=(currentPassword,newPassword)=>app.run('changePasswordPayload('+JSON.stringify({token:first.token,username:'admin',currentPassword,newPassword})+')');
 assert.throws(()=>change('incorrect','newpassword'),/현재 비밀번호/);
 assert.throws(()=>change('password2','short'));
 assert.throws(()=>change('password2','password2'));
 assert.equal(change('password2','newpassword').ok,true);
 assert.throws(()=>app.run('requireSession('+JSON.stringify(first.token)+')'));
 assert.throws(()=>app.run('requireSession('+JSON.stringify(second.token)+')'));
 assert.equal(app.run('requireSession('+JSON.stringify(admin.token)+').role'),'admin');
 assert.throws(()=>app.run("loginPayload({username:'editor',password:'password2'})"));
 assert.ok(app.run("loginPayload({username:'editor',password:'newpassword'}).token"));
 assert.ok(!JSON.stringify(app.sheets.get('웹앱_계정').rows).includes('newpassword'));
 assert.throws(()=>app.run("changePasswordPayload({currentPassword:'password1',newPassword:'newpassword'})"),/로그인/);
});


test('password bounds and Korean-midnight sessions enforce the expiry policy',()=>{
 const app=harness();for(const n of [7,21,100])assert.throws(()=>app.run('cleanPassword('+JSON.stringify('a'.repeat(n))+')'));
 for(const n of [8,20])assert.equal(app.run('cleanPassword('+JSON.stringify('a'.repeat(n))+')').length,n);
 setupAdmin(app);const before=Date.now(),session=app.run("loginPayload({username:'admin',password:'password1'})"),expires=new Date(session.expiresAt).getTime();
 assert.ok(expires>before&&expires-before<=24*3600000);assert.equal(new Date(expires+9*3600000).toISOString().slice(11),'00:00:00.000Z');
 assert.equal(app.run('requireSession('+JSON.stringify(session.token)+').role'),'admin');
 app.run('Date=class extends Date {static now(){return '+(expires+1)+'}}');assert.throws(()=>app.run('requireSession('+JSON.stringify(session.token)+')'));
 app.run('logoutPayload('+JSON.stringify(session.token)+')');assert.throws(()=>app.run('requireSession('+JSON.stringify(session.token)+')'));
});

test('Google Sheets store workspace timestamps as KST ISO and private logs as labeled KST',()=>{
 const app=harness();setupAdmin(app);
 const accountRow=app.sheets.get('웹앱_계정').rows[1];
 assert.match(accountRow[6],/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} KST$/);
 const session=app.run("loginPayload({username:'admin',password:'password1'})");
 assert.match(app.sheets.get('웹앱_세션').rows[1][2],/^\d{4}-\d{2}-\d{2} 00:00:00 KST$/);
 for(const [workspace,sheet] of [['cx','웹앱_CX_업무데이터'],['enterprise','웹앱_기업_업무데이터'],['aldot','웹앱_알닷_업무데이터']]){
  const result=app.run("savePayload([['9/21','','담당자','배정','','업무','','','']], "+JSON.stringify(workspace)+", requireSession("+JSON.stringify(session.token)+"))");
  assert.match(result.updatedAt,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/);
  assert.match(app.sheets.get(sheet).rows[1][1],/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/);
 }
 assert.match(app.sheets.get('웹앱_수정이력').rows[1][0],/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} KST$/);
});

test('session lookup rejects partial, wrong-case, expired and disabled credentials',()=>{
 const app=harness();setupAdmin(app);
 const session=app.run("loginPayload({username:'admin',password:'password1'})");
 for(const token of [session.token.slice(1),session.token.toUpperCase(),'.*'])assert.throws(()=>app.run('requireSession('+JSON.stringify(token)+')'));
 const sheet=app.sheets.get('웹앱_세션');sheet.rows[1][2]='2000-01-01';
 assert.throws(()=>app.run('requireSession('+JSON.stringify(session.token)+')'));
 sheet.rows[1][2]='';assert.throws(()=>app.run('requireSession('+JSON.stringify(session.token)+')'));
 app.sheets.get('웹앱_계정').rows[1][5]=false;
 assert.throws(()=>app.run('requireSession('+JSON.stringify(session.token)+')'));
});
test('login hashes outside the write lock and rechecks credentials before issuing a session',()=>{
 const app=harness();setupAdmin(app);
 app.run("let held=false;LockService.getScriptLock=()=>({waitLock(){held=true},releaseLock(){held=false}});const originalHash=passwordHash;passwordHash=(p,s)=>{if(held)throw Error('hash holds lock');return originalHash(p,s)}");
 assert.ok(app.run("loginPayload({username:'admin',password:'password1'}).token"));
 app.run("LockService.getScriptLock=()=>({waitLock(){authSheet().rows[1][4]='changed'},releaseLock(){}})");
 assert.throws(()=>app.run("loginPayload({username:'admin',password:'password1'})"),/계정 정보/);
 assert.equal(app.sheets.get('웹앱_세션').rows.length,2);
});

test('warm session validation reads two live rows without searching sheets',()=>{
 const app=harness();setupAdmin(app);
 const session=app.run("loginPayload({username:'admin',password:'password1'})");
 const validate=()=>app.run('requireSession('+JSON.stringify(session.token)+')');validate();
 let reads=0;
 for(const name of ['웹앱_계정','웹앱_세션']){
  const sheet=app.sheets.get(name),range=sheet.getRange.bind(sheet);
  sheet.getLastRow=()=>{throw Error('unexpected scan')};
  sheet.getRange=(...args)=>{assert.equal(args[2],1);reads++;return range(...args)};
 }
 assert.equal(validate().role,'admin');assert.equal(reads,2);
 app.sheets.get('웹앱_계정').rows[1][5]=false;assert.throws(validate,/만료/);
});
test('row hints recover after deletion and cache loss without accepting revoked tokens',()=>{
 const app=harness();setupAdmin(app);
 const first=app.run("loginPayload({username:'admin',password:'password1'})"),second=app.run("loginPayload({username:'admin',password:'password1'})");
 const validate=token=>app.run('requireSession('+JSON.stringify(token)+')');
 validate(first.token);validate(second.token);
 app.run('logoutPayload('+JSON.stringify(first.token)+')');
 assert.equal(validate(second.token).role,'admin');assert.throws(()=>validate(first.token));
 app.cache.clear();assert.equal(validate(second.token).role,'admin');
 app.run("CacheService.getScriptCache=()=>{throw Error('cache unavailable')}");
 assert.equal(validate(second.token).role,'admin');
});

test('optimized hashes match independent SHA-256 for legacy passwords and both base64 paddings',()=>{
 const crypto=require('node:crypto');
 for(const padded of [false,true]){
  const app=harness();
  if(padded)app.run("const encode=Utilities.base64EncodeWebSafe;Utilities.base64EncodeWebSafe=bytes=>encode(bytes)+'='");
  for(const input of ['salt:password1','한글:비밀번호🔐123','s:','x'.repeat(140)]){
   let expected=input;
   for(let i=0;i<2000;i++)expected=crypto.createHash('sha256').update(expected).digest(padded?'base64':'base64url').replace(/\+/g,'-').replace(/\//g,'_');
   assert.equal(app.run('advancePasswordHash('+JSON.stringify(input)+',2000)'),expected);
  }
 }
});
test('login completes in one POST and hashing uses one digest service call',()=>{
 const app=harness();setupAdmin(app);app.cache.clear();
 app.run("let digestCalls=0;const digest=Utilities.computeDigest;Utilities.computeDigest=(...args)=>{digestCalls++;return digest(...args)}");
 app.run("passwordHash('password1','salt')");assert.equal(app.run('digestCalls'),1);
 app.run('jsonResponse=payload=>payload');
 const result=app.run('doPost({postData:{contents:JSON.stringify({action:"login",username:"admin",password:"password1"})}})');
 assert.equal(result.ok,true);assert.ok(result.token);assert.equal(result.pending,undefined);
});
test('session remains valid right until Korean midnight',()=>{
 const app=harness();setupAdmin(app);const session=app.run("loginPayload({username:'admin',password:'password1'})");
 const expires=Date.parse(session.expiresAt);
 app.run('Date=class extends Date {static now(){return '+(expires-1)+'}}');
 assert.equal(app.run('requireSession('+JSON.stringify(session.token)+').role'),'admin');
 app.run('Date=class extends Date {static now(){return '+expires+'}}');
 assert.throws(()=>app.run('requireSession('+JSON.stringify(session.token)+')'),/만료/);
});

test('session expiry uses Korean midnight across day, month and year boundaries',()=>{
 const app=harness();
 for(const [now,expected] of [
  ['2026-09-29T00:00:00+09:00','2026-09-30T00:00:00+09:00'],
  ['2026-09-29T23:59:59+09:00','2026-09-30T00:00:00+09:00'],
  ['2026-09-30T23:00:00+09:00','2026-10-01T00:00:00+09:00'],
  ['2026-12-31T23:00:00+09:00','2027-01-01T00:00:00+09:00']
 ])assert.equal(app.run('nextSessionMidnight('+Date.parse(now)+')'),Date.parse(expected));
});
test('legacy 24-hour sessions expire at the first midnight after issuance',()=>{
 const app=harness();setupAdmin(app);
 const session=app.run("loginPayload({username:'admin',password:'password1'})");
 app.sheets.get('웹앱_세션').rows[1][2]='2026-09-30T13:00:00+09:00';
 app.run('Date=class extends Date {static now(){return '+Date.parse('2026-09-29T23:59:59+09:00')+'}}');
 assert.equal(app.run('requireSession('+JSON.stringify(session.token)+').role'),'admin');
 app.run('Date=class extends Date {static now(){return '+Date.parse('2026-09-30T00:00:00+09:00')+'}}');
 assert.throws(()=>app.run('requireSession('+JSON.stringify(session.token)+')'),/만료/);
});

test('backup separates months and overwrites repeat saves without duplicate tabs',()=>{
 const app=harness();app.run("backupLedgerPayload(['업무'],[['A'],['B']],'cx','2026-09')");
 app.run("backupLedgerPayload(['업무'],[['C']],'cx','2026-10')");
 app.run("backupLedgerPayload(['업무'],[['D']],'cx','2026-09')");
 assert.equal(app.backupSheets.size,2);assert.deepEqual(app.backupSheets.get('CX_2026-09').rows,[['업무'],['D']]);assert.deepEqual(app.backupSheets.get('CX_2026-10').rows,[['업무'],['C']]);
 assert.throws(()=>app.run("backupLedgerPayload(['업무'],[],'cx','2026-13')"));
 app.run("SpreadsheetApp.openById=()=>{throw Error('denied')}");
 assert.throws(()=>app.run("backupLedgerPayload(['업무'],[],'cx','2026-09')"),/편집 권한/);
 assert.deepEqual(app.backupSheets.get('CX_2026-09').rows,[['업무'],['D']]);
});
