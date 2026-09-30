const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');

function harness(){
 const sheets=new Map(),cache=new Map(),properties=new Map();
 const PropertiesService={getScriptProperties:()=>({getProperty:key=>properties.get(key)??null,setProperty:(key,value)=>properties.set(key,String(value)),deleteProperty:key=>properties.delete(key)})};
 const CacheService={getScriptCache:()=>({get:key=>cache.get(key)??null,put:(key,value)=>cache.set(key,value),remove:key=>cache.delete(key)})};
 class Sheet{
  constructor(){this.rows=[]}
  hideSheet(){}
  clearContents(){this.rows=[]}
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
   },setValues(values){for(let i=0;i<values.length;i++){sheet.rows[a-1+i]??=[];for(let j=0;j<values[i].length;j++)sheet.rows[a-1+i][b-1+j]=values[i][j]}},getValues(){return Array.from({length:c},(_,i)=>Array.from({length:d},(_,j)=>sheet.rows[a-1+i]?.[b-1+j]??''))},getDisplayValues(){return this.getValues().map(row=>row.map(String))},clearContent(){for(let i=0;i<c;i++)for(let j=0;j<d;j++)if(sheet.rows[a-1+i])sheet.rows[a-1+i][b-1+j]=''}};
  }
 }
 const book={getSheetByName:name=>sheets.get(name)||null,insertSheet(name){const sheet=new Sheet();sheets.set(name,sheet);return sheet}};
 const lock={waitLock(){},releaseLock(){}};
 let id=0;
 const Utilities={DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},getUuid:()=>`uuid-${++id}`,computeDigest:(_algo,value)=>[...crypto.createHash('sha256').update(value).digest()],base64EncodeWebSafe:bytes=>Buffer.from(bytes).toString('base64url')};
 const context=vm.createContext({CacheService,PropertiesService,SpreadsheetApp:{getActiveSpreadsheet:()=>book,flush(){}},LockService:{getScriptLock:()=>lock},Utilities,Date,JSON});
 vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../Code.gs'),'utf8'),context);
 return {run:code=>vm.runInContext(code,context),sheets,cache,properties};
}

module.exports={harness};
