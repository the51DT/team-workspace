const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');

function harness(options={}){
 const sheets=new Map(),cache=new Map(),backupSheets=new Map(),scheduleSheets=new Map();
 const CacheService={getScriptCache:()=>({get:key=>cache.get(key)??null,put:(key,value)=>cache.set(key,value),remove:key=>cache.delete(key)})};
 class Sheet{
  constructor(){this.rows=[]}
  hideSheet(){}
  clearContents(){this.rows=[]}
  getMaxRows(){return this.rows.length}
  setFrozenRows(count){this.frozenRows=count}
  getLastRow(){return this.rows.length}
  appendRow(row){this.rows.push([...row])}
  deleteRow(n){this.rows.splice(n-1,1)}
  getRange(a,b,c,d){
   if(typeof a==='string'){const map={'A2:B2':[2,1,1,2]};[a,b,c,d]=map[a]||[1,1,1,1]}
   const sheet=this;
   return {createTextFinder(text){
    let entire=false,caseSensitive=false,regex=false;
    return {matchEntireCell(value){entire=value;return this},matchCase(value){caseSensitive=value;return this},useRegularExpression(value){regex=value;return this},findNext(){
     if(regex)throw new Error('Unexpected regex search');
     for(let i=0;i<c;i++)for(let j=0;j<d;j++){
      let value=String(sheet.rows[a-1+i]?.[b-1+j]??''),query=String(text);
      if(!caseSensitive){value=value.toLowerCase();query=query.toLowerCase()}
      if(entire?value===query:value.includes(query))return {getRow:()=>a+i};
     }
     return null;
    }};
   },setValues(values){for(let i=0;i<values.length;i++){sheet.rows[a-1+i]??=[];for(let j=0;j<values[i].length;j++)sheet.rows[a-1+i][b-1+j]=values[i][j]}},getValues(){return Array.from({length:c},(_,i)=>Array.from({length:d},(_,j)=>sheet.rows[a-1+i]?.[b-1+j]??''))},getDisplayValues(){return this.getValues().map(row=>row.map(String))},setNumberFormat(){return this},clearContent(){for(let i=0;i<c;i++)for(let j=0;j<d;j++)if(sheet.rows[a-1+i])sheet.rows[a-1+i][b-1+j]=''}};
  }
 }
 const book={getSheetByName:name=>sheets.get(name)||null,insertSheet(name){const sheet=new Sheet();sheets.set(name,sheet);return sheet}};
 const backupBook={getSheetByName:name=>backupSheets.get(name)||null,insertSheet(name){const sheet=new Sheet();backupSheets.set(name,sheet);return sheet}};
 const scheduleBook={getSheetByName:name=>scheduleSheets.get(name)||null,insertSheet(name){const sheet=new Sheet();scheduleSheets.set(name,sheet);return sheet}};
 const lock={waitLock(){},releaseLock(){}};
 let id=0;
 const Utilities={DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},getUuid:()=>`uuid-${++id}`,computeDigest:(_algo,value)=>[...crypto.createHash('sha256').update(value).digest()],base64EncodeWebSafe:bytes=>Buffer.from(bytes).toString('base64url')};
 const context=vm.createContext({CacheService,SpreadsheetApp:{getActiveSpreadsheet:()=>book,openById:id=>{if(id==='schedule-test-id')return scheduleBook;if(id!=='1GE6qRt40qIQH_lol2XD7T9cTPBrrqPk2gDvZy2y-pz8')throw Error('wrong destination');return backupBook},flush(){}},LockService:{getScriptLock:()=>lock},Utilities,Date,JSON});
 let source=fs.readFileSync(require('node:path').join(__dirname,'../Code.gs'),'utf8');
 // 실제 스프레드시트 ID 가 Code.gs 에 들어 있어도 테스트는 그 값에 기대지 않는다: 항상 테스트 값(또는 빈 값)으로 바꿔서 실행
 source=source.replace(/SCHEDULE_SPREADSHEET_ID='[^']*'/,"SCHEDULE_SPREADSHEET_ID='"+(options.scheduleId||'')+"'");
 vm.runInContext(source,context);
 return {run:code=>vm.runInContext(code,context),sheets,cache,backupSheets,scheduleSheets};
}

module.exports={harness};
