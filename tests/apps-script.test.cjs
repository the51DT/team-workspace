const {test}=require('node:test');
const assert=require('node:assert/strict');
const {harness}=require('./apps-script-harness.cjs');

test('Apps Script isolates load and save by workspace',()=>{
 const {run,sheets}=harness();
 for(const key of ['cx','enterprise','aldot'])run(`savePayload([['9/20','','작업자','배정','','${key}','','','']], '${key}')`);
 for(const key of ['cx','enterprise','aldot'])assert.equal(run(`loadPayload('${key}').tasks[0][5]`),key);
 assert.equal(sheets.size,3);
 assert.throws(()=>run("loadPayload('unknown')"));
});
