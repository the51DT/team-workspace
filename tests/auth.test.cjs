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


test('session lookup searches older batches while recent sessions use one batch',()=>{
 const app=harness();setupAdmin(app);
 const first=app.run("loginPayload({username:'admin',password:'password1'})");
 const sheet=app.sheets.get('웹앱_세션');
 for(let i=0;i<250;i++)sheet.appendRow(['other-'+i,'admin',first.expiresAt]);
 const sizes=[],getRange=sheet.getRange.bind(sheet);sheet.getRange=(...args)=>{sizes.push(args[2]);return getRange(...args)};
 assert.equal(app.run('requireSession('+JSON.stringify(first.token)+').role'),'admin');assert.deepEqual(sizes,[100,100,51]);
 sizes.length=0;assert.equal(app.run("requireSession('other-249').role"),'admin');assert.deepEqual(sizes,[100]);
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
 for(const [workspace,name] of [['cx','웹앱_CX_업무대장'],['enterprise','웹앱_기업_업무대장'],['aldot','웹앱_알닷_업무대장']]){
  const result=app.run(`backupLedgerPayload(${JSON.stringify(headers)},${JSON.stringify(rows)},${JSON.stringify(workspace)})`);
  assert.equal(result.sheet,name);assert.equal(result.rowCount,1);
  assert.deepEqual(app.sheets.get(name).rows,[headers,...rows]);
  assert.equal(app.sheets.get(name).frozenRows,1);
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


test('password bounds and persistent sessions enforce new policy',()=>{
 const app=harness();for(const n of [7,21,100])assert.throws(()=>app.run('cleanPassword('+JSON.stringify('a'.repeat(n))+')'));
 for(const n of [8,20])assert.equal(app.run('cleanPassword('+JSON.stringify('a'.repeat(n))+')').length,n);
 setupAdmin(app);const session=app.run("loginPayload({username:'admin',password:'password1'})");assert.equal(session.expiresAt,'');
 app.run('Date=class extends Date {static now(){return 4102444800000}}');assert.equal(app.run('requireSession('+JSON.stringify(session.token)+').role'),'admin');
 app.run('logoutPayload('+JSON.stringify(session.token)+')');assert.throws(()=>app.run('requireSession('+JSON.stringify(session.token)+')'));
});
