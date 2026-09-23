const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');

function harness(){
 const sheets=new Map();
 class Sheet{
  constructor(){this.rows=[]}
  hideSheet(){}
  getLastRow(){return this.rows.length}
  appendRow(row){this.rows.push([...row])}
  deleteRow(n){this.rows.splice(n-1,1)}
  getRange(a,b,c,d){
   if(typeof a==='string'){const map={'A2:B2':[2,1,1,2]};[a,b,c,d]=map[a]||[1,1,1,1]}
   const sheet=this;
   return {setValues(values){for(let i=0;i<values.length;i++){sheet.rows[a-1+i]??=[];for(let j=0;j<values[i].length;j++)sheet.rows[a-1+i][b-1+j]=values[i][j]}},getValues(){return Array.from({length:c},(_,i)=>Array.from({length:d},(_,j)=>sheet.rows[a-1+i]?.[b-1+j]??''))},getDisplayValues(){return this.getValues().map(row=>row.map(String))},clearContent(){for(let i=0;i<c;i++)for(let j=0;j<d;j++)if(sheet.rows[a-1+i])sheet.rows[a-1+i][b-1+j]=''}};
  }
 }
 const book={getSheetByName:name=>sheets.get(name)||null,insertSheet(name){const sheet=new Sheet();sheets.set(name,sheet);return sheet}};
 const lock={waitLock(){},releaseLock(){}};
 let id=0;
 const Utilities={DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},getUuid:()=>`uuid-${++id}`,computeDigest:(_algo,value)=>[...crypto.createHash('sha256').update(value).digest()],base64EncodeWebSafe:bytes=>Buffer.from(bytes).toString('base64url')};
 const context=vm.createContext({SpreadsheetApp:{getActiveSpreadsheet:()=>book,flush(){}},LockService:{getScriptLock:()=>lock},Utilities,Date,JSON});
 vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../Code.gs'),'utf8'),context);
 return {run:code=>vm.runInContext(code,context),sheets};
}

test('accounts enforce roles and editor saves create audit history',()=>{
 const app=harness();
 assert.equal(app.run('hasUsers()'),false);
 app.run("setupAdmin({username:'admin',password:'password1',name:'관리자'})");
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

test('public reads work in every workspace while mutations still require a session',()=>{
 const app=harness();app.run('jsonResponse=payload=>payload');
 const post=payload=>app.run('doPost({postData:{contents:'+JSON.stringify(JSON.stringify(payload))+'}})');
 for(const workspace of ['cx','enterprise','aldot']){
  assert.equal(post({action:'load',workspace}).ok,true);
  const history=post({action:'loadAudit',workspace});assert.equal(history.ok,true);assert.equal(history.workspace,workspace);
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


test('GET exposes only workspace-scoped public reads and never performs mutations',()=>{
 const app=harness();app.run('jsonResponse=payload=>payload');
 const get=parameter=>app.run('doGet({parameter:'+JSON.stringify(parameter)+'})');
 for(const workspace of ['cx','enterprise','aldot']){
  for(const action of ['load','loadAudit']){
   const result=get({action,workspace});assert.equal(result.ok,true);assert.equal(result.workspace,workspace);
  }
 }
 for(const action of ['save','saveWorkers','setupAdmin','createUser','login','listUsers','logout','session']){
  assert.equal(get({action,workspace:'cx'}).ok,false);
 }
 assert.equal(get({action:'load',workspace:'unknown'}).ok,false);
 assert.equal(app.run('hasUsers()'),false);
});


test('retired account roles cannot log in or reuse existing sessions',()=>{
 const app=harness();app.run("setupAdmin({username:'admin',password:'password1',name:'관리자'})");
 app.run("createUserPayload({username:'legacy',password:'password2',name:'이전 계정',role:'editor'})");
 const session=app.run("loginPayload({username:'legacy',password:'password2'})");
 app.sheets.get('웹앱_계정').rows[2][2]='viewer';
 assert.throws(()=>app.run("loginPayload({username:'legacy',password:'password2'})"));
 assert.throws(()=>app.run('requireSession('+JSON.stringify(session.token)+')'));
 assert.equal(app.run('listUsers().length'),1);
});


test('login identifies initial setup without a separate status request',()=>{
 const app=harness();assert.equal(app.run("loginPayload({username:'admin',password:'password1'}).setupRequired"),true);
 app.run("setupAdmin({username:'admin',password:'password1',name:'관리자'})");
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
 const app=harness();app.run("setupAdmin({username:'admin',password:'password1',name:'관리자'})");
 const first=app.run("loginPayload({username:'admin',password:'password1'})");
 const sheet=app.sheets.get('웹앱_세션');
 for(let i=0;i<250;i++)sheet.appendRow(['other-'+i,'admin',first.expiresAt]);
 const sizes=[],getRange=sheet.getRange.bind(sheet);sheet.getRange=(...args)=>{sizes.push(args[2]);return getRange(...args)};
 assert.equal(app.run('requireSession('+JSON.stringify(first.token)+').role'),'admin');assert.deepEqual(sizes,[100,100,51]);
 sizes.length=0;assert.equal(app.run("requireSession('other-249').role"),'admin');assert.deepEqual(sizes,[100]);
});
