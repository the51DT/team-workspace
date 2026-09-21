const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
test('Apps Script isolates load and save by workspace',()=>{
 const sheets=new Map();const book={getSheetByName:n=>sheets.get(n),insertSheet(n){const sheet={values:['',''],hideSheet(){},getRange(range){return {getValues:()=>[sheet.values],setValues(v){if(range==='A2:B2')sheet.values=v[0]}}}};sheets.set(n,sheet);return sheet}};
 const ctx=vm.createContext({SpreadsheetApp:{getActiveSpreadsheet:()=>book,flush(){}},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})}});
 vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../Code.gs'),'utf8'),ctx);
 for(const key of ['cx','enterprise','aldot'])vm.runInContext(`savePayload([['9/20','','작업자','배정','','${key}','','','']], '${key}')`,ctx);
 for(const key of ['cx','enterprise','aldot'])assert.equal(vm.runInContext(`loadPayload('${key}').tasks[0][5]`,ctx),key);
 assert.equal(sheets.size,3);assert.throws(()=>vm.runInContext("loadPayload('unknown')",ctx));
});
