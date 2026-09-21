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
 app.run("createUserPayload({username:'viewer',password:'password2',name:'조회자',role:'viewer'})");
 app.run("createUserPayload({username:'editor',password:'password3',name:'편집자',role:'editor'})");
 const viewer=app.run("loginPayload({username:'viewer',password:'password2'})");
 const editor=app.run("loginPayload({username:'editor',password:'password3'})");
 assert.equal(app.run(`requireSession(${JSON.stringify(admin.token)}).role`),'admin');
 assert.throws(()=>app.run(`requireRole(requireSession(${JSON.stringify(viewer.token)}),['admin','editor'])`));
 app.run(`savePayload([['9/21','','담당자','배정','','업무','','','']], 'cx', requireSession(${JSON.stringify(editor.token)}))`);
 app.run(`savePayload([['9/21','','담당자','진행중','','업무','','','']], 'cx', requireSession(${JSON.stringify(editor.token)}))`);
 const audit=app.run("loadAuditPayload('cx')");
 assert.ok(audit.entries.some(entry=>entry.name==='편집자'&&entry.field==='단계'&&entry.before==='배정'&&entry.after==='진행중'));
});