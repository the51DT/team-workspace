const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
const NativeDate=Date;
class FixedDate extends NativeDate{
  constructor(...args){super(...(args.length?args:['2026-09-30T12:00:00+09:00']))}
  static now(){return new NativeDate('2026-09-30T12:00:00+09:00').getTime()}
}
function app(handler,storage=new Map(),hash='#cx',guest=false,sessionStore=new Map(),origin='https://the51dt.github.io'){
  const location={hash,origin,pathname:'/team-workspace/index.html',search:''};
  const navigate=(_state,_title,url)=>{location.hash=url.includes('#')?url.slice(url.indexOf('#')):''};
  const elements=new Map(),requests=[];
  const element=id=>{if(!elements.has(id))elements.set(id,{value:['#worker','#workTypeFilter','#status'].includes(id)?'all':'',innerHTML:'',textContent:'',classList:{active:false,toggle(_name,on){this.active=on}},addEventListener(){},setAttribute(){},focus(){}});return elements.get(id)};
  const context=vm.createContext({window:{location,history:{pushState:navigate,replaceState:navigate},addEventListener(){},APPS_SCRIPT_URL:'https://example.test/exec',WORKERS:['작업자 A']},URL,AbortSignal,console,Date:FixedDate,
    fetch:async(url,options)=>{const payload=options.method==='GET'?Object.fromEntries(new URL(url).searchParams):JSON.parse(options.body);requests.push({url,payload,method:options.method,headers:options.headers});const result=await handler(payload);return {ok:true,json:async()=>result}},
    localStorage:{get length(){return storage.size},key:i=>[...storage.keys()][i]??null,getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},sessionStorage:{get length(){return sessionStore.size},key:i=>[...sessionStore.keys()][i]??null,getItem:key=>sessionStore.get(key)??null,setItem:(key,value)=>sessionStore.set(key,value),removeItem:key=>sessionStore.delete(key)},alert(){},confirm:()=>true,requestAnimationFrame:fn=>fn(),setTimeout,
    document:{querySelector:element,querySelectorAll:()=>[],...(guest?{getElementById:element}:{})}});
  const ready=vm.runInContext(guest?source:source.replace("let authToken=''","let authToken='test-session'"),context);
  return {ready,requests,element,run:code=>vm.runInContext(code,context)};
}
const task=['9/19','123','작업자 A','배정','2026-09-20','업무 제목','메모','1.5','0'];
function timeoutError(){return Object.assign(new Error('signal timed out'),{name:'TimeoutError'});}
function nextTurn(){return new Promise(resolve=>setImmediate(resolve));}

test('new tasks stay below existing tasks after consecutive saves and reload',async()=>{
  let tasks=[task];
  const page=app(p=>{if(p.action==='save'){tasks=p.tasks;return {ok:true}}return {ok:true,tasks}});
  await page.ready;
  for(const title of ['새 업무 1','새 업무 2']){
    page.run('addRow()');
    assert.equal(page.run('selected()[0].i'),page.run('data.length-1'));
    page.run("remember(data.length-1,2,'작업자 A')");
    page.run('remember(data.length-1,5,'+JSON.stringify(title)+')');
    await page.run('saveAll()');
  }
  assert.deepEqual(tasks.map(row=>row[5]),['업무 제목','새 업무 1','새 업무 2']);
  await page.run('load()');
  assert.equal(page.run('data[2][5]'),'새 업무 2');
});
test('loading bar is active only while a server request is pending',async()=>{
 let resolve;const pending=new Promise(done=>resolve=done);const page=app(()=>pending);
 await nextTurn();
 assert.equal(page.element('#loadingBar').classList.active,true);
 resolve({ok:true,tasks:[task]});await page.ready;
 assert.equal(page.element('#loadingBar').classList.active,false);
});
test('load uses Apps Script tasks and maps nine columns without losing work hours',async()=>{
  const page=app(()=>({ok:true,tasks:[task],updatedAt:'2026-09-19T00:00:00Z',holidayError:'key missing'}));await page.ready;
  assert.equal(page.requests[0].payload.action,'load');assert.equal(page.run('data[0][9]'),'1.5');
  assert.match(page.element('#rows').innerHTML,/업무 제목/);assert.equal(page.run('serverConnected'),true);
});
test('save upgrades legacy tasks to the full thirteen-column task list',async()=>{
  let tasks=[task];const page=app(p=>{if(p.action==='save'){tasks=p.tasks;return {ok:true,updatedAt:'saved'}}return {ok:true,tasks}});await page.ready;
  page.run("remember(0,5,'수정 업무')");await page.run('saveAll()');
  assert.equal(tasks[0][5],'수정 업무');assert.equal(tasks[0].length,13);
  assert.equal(page.requests[1].headers['Content-Type'],'text/plain;charset=utf-8');
  await page.run('load()');assert.equal(page.run('data[0][5]'),'수정 업무');
});
test('failed or incompatible load cannot overwrite remote data',async()=>{
  for(const result of [{ok:false,error:'권한 없음'},{ok:true,service:'old API'},{ok:true,tasks:[{title:'unknown format'}]}]){
    const page=app(()=>result);await page.ready;await page.run('saveAll()');
    assert.equal(page.run('serverConnected'),false);assert.equal(page.requests.length,1);assert.equal(page.element('#saveAll').disabled,true);
  }
});
test('server worker choices populate the dropdown and an empty task list can be saved',async()=>{
  const page=app(p=>p.action==='load'?{ok:true,tasks:[],workers:['작업자 A']}:{ok:true});await page.ready;
  assert.match(page.element('#worker').innerHTML,/작업자 A/);await page.run('saveAll()');assert.deepEqual(page.requests[1].payload.tasks,[]);
});
test('save failure retains unsaved rows and reports the server error',async()=>{
  const page=app(p=>p.action==='load'?{ok:true,tasks:[task]}:{ok:false,error:'셀 저장 한도 초과'});await page.ready;
  page.run('newRows.add(0)');await page.run('saveAll()');assert.equal(page.run('newRows.size'),1);assert.match(page.element('#saveStatus').textContent,/셀 저장 한도 초과/);
});

test('tab selection refreshes the rendered rows immediately',async()=>{
 const completed=[...task];completed[3]='완료';completed[5]='완료 업무';
 const page=app(()=>({ok:true,tasks:[task,completed]}));await page.ready;
 assert.doesNotMatch(page.element('#rows').innerHTML,/완료 업무/);
 page.run("selectTab('list')");
 assert.match(page.element('#rows').innerHTML,/완료 업무/);
 page.run("selectTab('active')");
 assert.doesNotMatch(page.element('#rows').innerHTML,/완료 업무/);
});
test('refresh button fetches changed server rows and clears stale search',async()=>{
 let tasks=[task];const page=app(()=>({ok:true,tasks}));await page.ready;
 tasks=[[...task.slice(0,5),'서버에서 바뀐 제목',...task.slice(6)]];
 page.element('#search').value='이전 검색어';await page.element('#refresh').onclick();
 assert.equal(page.requests.length,2);assert.equal(page.run('data[0][5]'),'서버에서 바뀐 제목');
 assert.equal(page.element('#search').value,'');assert.match(page.element('#saveStatus').textContent,/새로고침 완료/);
 assert.equal(page.element('#refresh').disabled,false);
});



test('notes allow Enter and preserve rendered line breaks through save and reload',async()=>{
 let tasks=[task];const page=app(p=>{if(p.action==='save'){tasks=p.tasks;return {ok:true}}return {ok:true,tasks}});await page.ready;
 page.run("note={dataset:{row:'0',col:'6'},innerText:'첫 줄\\n둘째 줄',textContent:'첫 줄둘째 줄',blur(){throw Error('unexpected blur')}};document.querySelectorAll=s=>s==='#rows [contenteditable]'?[note]:[];bind()");
 page.run("note.onkeydown({key:'Enter',preventDefault(){throw Error('Enter blocked')}});note.oninput()");
 await page.run('saveAll()');await page.run('load()');
 assert.equal(page.run('data[0][6]'),'첫 줄\n둘째 줄');
});

test('initial load timeout retries once and unlocks saving after successful load',async()=>{
 let attempts=0;const page=app(()=>{if(++attempts===1)throw timeoutError();return {ok:true,tasks:[task]}});await page.ready;
 assert.equal(attempts,2);assert.equal(page.run('serverConnected'),true);assert.equal(page.element('#saveAll').disabled,false);
});
test('repeated load timeouts stop retrying and leave refresh available',async()=>{
 let attempts=0;const page=app(()=>{attempts++;throw timeoutError()});await page.ready;
 assert.equal(attempts,2);assert.equal(page.element('#refresh').disabled,false);assert.equal(page.element('#saveAll').disabled,true);
 assert.match(page.element('#saveStatus').textContent,/서버 응답 시간이 초과/);
});

test('legacy server cannot load CX data as enterprise or receive enterprise saves',async()=>{
 const page=app(()=>({ok:true,tasks:[task]}));await page.ready;await page.run("switchWorkspace('enterprise')");await page.run('saveAll()');
 assert.equal(page.run('serverConnected'),false);assert.equal(page.run('data.length'),0);assert.equal(page.requests.filter(r=>r.payload.action==='save').length,0);
});

test('initial page and refresh use the active tab',async()=>{
 const page=app(()=>({ok:true,tasks:[task,[...task.slice(0,3),'완료',...task.slice(4)]]}));await page.ready;
 assert.equal(page.run('currentTab'),'active');assert.equal(page.run('selected().length'),1);
 page.run("selectTab('list')");await page.element('#refresh').onclick();assert.equal(page.run('currentTab'),'active');
});

test('legacy snapshots and edits are removed without clearing login or unrelated storage',async()=>{
 const storage=new Map([['workflow-snapshot-v1:old:cx','private'],['enterprise:cx-workflow-edits-v5','draft'],['workflow-auth-token','token'],['unrelated','keep']]);
 const page=app(()=>({ok:true,user:{name:'A',role:'admin'}}),storage,'',true);await page.ready;
 assert.equal(storage.has('workflow-snapshot-v1:old:cx'),false);assert.equal(storage.has('enterprise:cx-workflow-edits-v5'),false);assert.equal(storage.get('workflow-auth-token'),'token');assert.equal(storage.get('unrelated'),'keep');
});
test('stored tasks are never displayed while server data is pending',async()=>{
 const storage=new Map([['workflow-snapshot-v1:old:cx',JSON.stringify({tasks:[task]})]]);
 let resolve;const pending=new Promise(done=>resolve=done);const page=app(()=>pending,storage);await nextTurn();
 assert.equal(page.run('data.length'),0);assert.doesNotMatch(page.element('#rows').innerHTML,/업무 제목/);
 resolve({ok:true,tasks:[task]});await page.ready;page.run("remember(0,5,'edited')");
 assert.equal(storage.size,0);
});

test('unauthenticated visitors cannot open home or workspaces',async()=>{
 const page=app(()=>({ok:true,tasks:[task]}),new Map(),'',true);await page.ready;
 assert.equal(page.element('#authPage').hidden,false);assert.equal(page.element('#homePage').hidden,true);
 await page.run("switchWorkspace('enterprise')");assert.equal(page.requests.length,0);assert.equal(page.element('#workspacePage').hidden,true);
});

test('all reads and saves use authenticated POST',async()=>{
 const page=app(p=>({ok:true,workspace:p.workspace,tasks:[]}));await page.ready;
 assert.equal(page.requests[0].method,'POST');assert.equal(page.requests[0].payload.workspace,'cx');
 assert.equal(new URL(page.requests[0].url).searchParams.has('token'),false);
 page.run("authToken='secret';currentUser={name:'편집자',role:'editor'}");await page.run('load()');
 assert.equal(page.requests[1].method,'POST');assert.equal(page.requests[1].payload.token,'secret');
 await page.run('saveAll()');assert.equal(page.requests[2].method,'POST');
 await page.run("requestServer({action:'loadAudit'})");assert.equal(page.requests[3].method,'POST');assert.equal(page.requests[3].url.includes('secret'),false);
});

test('opening login is immediate and login submits without an auth status request',async()=>{
 const page=app(()=>({ok:true,setupRequired:true}),new Map(),'',true);await page.ready;
 page.run('openLogin()');assert.equal(page.requests.length,0);assert.equal(page.element('#loginSubmit').disabled,false);
 page.element('#loginUsername').value='admin';page.element('#loginPassword').value='password1';
 await page.element('#authForm').onsubmit({preventDefault(){}});
 assert.equal(page.requests.length,1);assert.equal(page.requests[0].payload.action,'login');
 assert.equal(page.element('#nameField').hidden,false);assert.equal(page.element('#loginSubmit').textContent,'관리자 생성');
});

test('login follows five server verification steps and shows progress',async()=>{
 let step=0;
 const page=app(payload=>payload.action==='login'||payload.action==='loginContinue'?(++step<5?{ok:true,pending:true,challenge:'challenge',step,total:5}:{ok:true,token:'token',user:{name:'관리자',role:'admin'}}):({ok:true,tasks:[]}),new Map(),'',true);
 await page.ready;page.element('#loginUsername').value='admin';page.element('#loginPassword').value='password1';
 await page.element('#authForm').onsubmit({preventDefault(){}});
 assert.equal(step,5);assert.equal(page.run('authToken'),'token');
 assert.equal(page.requests.filter(request=>['login','loginContinue'].includes(request.payload.action)).length,5);
});

test('home and workspace both expose logout controls',()=>{
 const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
 assert.equal((html.match(/data-logout/g)||[]).length,2);
 assert.match(html,/account-actions[\s\S]*data-logout/);
});


test('invalid session returns to login without public fallback',async()=>{
 const page=app(p=>p.token?{ok:false,error:'로그인이 만료되었습니다.'}:{ok:true,workspace:p.workspace,tasks:[task]});await page.ready;
 page.run("authToken='expired';currentUser={name:'편집자',role:'editor'}");await page.run('load()');
 assert.equal(page.run('serverConnected'),false);assert.equal(page.run('authToken'),'');
 assert.equal(page.element('#saveAll').disabled,true);assert.equal(page.element('#authPage').hidden,false);
});


test('home guide appears only on home, once per Korean calendar day including after reload',async()=>{
 const storage=new Map();
 const page=app(()=>({ok:true,tasks:[]}),storage,'',true);await page.ready;
 page.run("document.querySelector('#authPage').hidden=true;guideCount=0;document.querySelector('#guideDialog').showModal=function(){this.open=true;guideCount++};document.querySelector('#guideDialog').close=function(){this.open=false}");
 page.run("document.querySelector('#homePage').hidden=true;showHomeGuide(new Date('2026-09-23T01:00:00Z'))");assert.equal(page.run('guideCount'),0);
 page.run("document.querySelector('#homePage').hidden=false;showHomeGuide(new Date('2026-09-23T01:00:00Z'));closeGuide();showHomeGuide(new Date('2026-09-23T14:59:59Z'))");
 assert.equal(page.run('guideCount'),1);
 page.run("guideSeenDay='';showHomeGuide(new Date('2026-09-23T14:59:59Z'))");assert.equal(page.run('guideCount'),1);
 page.run("showHomeGuide(new Date('2026-09-23T15:00:00Z'))");assert.equal(page.run('guideCount'),2);
 page.run('openLogin()');assert.equal(page.element('#guideDialog').open,false);page.run("guideSeenDay='';localStorage.removeItem(GUIDE_SEEN_KEY);showHomeGuide(new Date('2026-09-24T01:00:00Z'))");assert.equal(page.run('guideCount'),2);
});

test('home guide stops at November 1 Korean time and works when browser storage is unavailable',async()=>{
 const page=app(()=>({ok:true,tasks:[]}),new Map(),'',true);await page.ready;
 page.run("document.querySelector('#authPage').hidden=true;guideCount=0;document.querySelector('#homePage').hidden=false;document.querySelector('#guideDialog').showModal=function(){this.open=true;guideCount++};document.querySelector('#guideDialog').close=function(){this.open=false};localStorage.getItem=()=>{throw Error('blocked')};localStorage.setItem=()=>{throw Error('blocked')}");
 page.run("showHomeGuide(new Date('2026-10-31T14:59:59Z'));closeGuide();showHomeGuide(new Date('2026-10-31T14:59:59Z'))");assert.equal(page.run('guideCount'),1);
 page.run("showHomeGuide(new Date('2026-10-31T15:00:00Z'))");assert.equal(page.run('guideCount'),1);
});


test('login timeout gives a readable message and allows retry without automatic duplicate submission',async()=>{
 const page=app(()=>{throw timeoutError()},new Map(),'',true);await page.ready;
 await page.element('#authForm').onsubmit({preventDefault(){}});
 assert.match(page.element('#authError').textContent,/서버 응답 시간이 초과/);assert.equal(page.element('#loginSubmit').disabled,false);
 assert.equal(page.requests.length,1);assert.equal(page.run("requestTimeout('login')"),90000);
});

test('account list timeout is shown inside dialog and duplicate clicks share the active attempt',async()=>{
 let reject;const pending=new Promise((_resolve,fail)=>reject=fail);
 const page=app(()=>pending,new Map(),'');await page.ready;page.element('#usersDialog').showModal=()=>{};
 const first=page.element('#usersButton').onclick();await page.element('#usersButton').onclick();assert.equal(page.requests.length,1);
 reject(timeoutError());await first;
 assert.match(page.element('#userError').textContent,/서버 응답 시간이 초과/);assert.equal(page.run('usersLoading'),false);
 assert.equal(page.run("requestTimeout('listUsers')"),60000);
});


test('password confirmation mismatch does not send a request',async()=>{
 const page=app(()=>({ok:true,tasks:[]}),new Map(),'');await page.ready;
 page.run("authToken='session'");page.element('#currentPassword').value='password1';page.element('#nextPassword').value='password2';page.element('#confirmPassword').value='different';
 await page.element('#passwordForm').onsubmit({preventDefault(){}});
 assert.equal(page.requests.length,0);assert.match(page.element('#passwordMessage').textContent,/일치하지/);
});


test('restored session shows home before session check finishes without enabling edits',async()=>{
 let finish;const pending=new Promise(resolve=>finish=resolve);
 const storage=new Map([['workflow-auth-token','existing']]);
 const page=app(()=>pending,storage,'',true);await nextTurn();
 assert.equal(page.element('#homePage').hidden,false);assert.equal(page.element('#authPage').hidden,true);assert.equal(page.run('canEdit()'),false);
 finish({ok:true,user:{name:'편집자',role:'editor'}});await page.ready;assert.equal(page.run('canEdit()'),true);
});

test('direct workspace entry validates login in the load request and does not show cached private rows first',async()=>{
 let finish;const pending=new Promise(resolve=>finish=resolve);
 const storage=new Map([['workflow-auth-token','existing'],['workflow-snapshot-v1:https://example.test/exec:cx',JSON.stringify({tasks:[task]})]]);
 const page=app(()=>pending,storage,'#cx',true);await nextTurn();
 assert.equal(page.requests.length,1);assert.equal(page.requests[0].payload.action,'load');assert.doesNotMatch(page.element('#rows').innerHTML,/업무 제목/);
 finish({ok:true,workspace:'cx',tasks:[task],user:{name:'편집자',role:'editor'}});await page.ready;
 assert.equal(page.requests.length,1);assert.match(page.element('#rows').innerHTML,/업무 제목/);assert.equal(page.run('canEdit()'),true);
});

test('history shows each changed field with escaped before and after values',async()=>{
 const page=app(()=>({ok:true,tasks:[]}));await page.ready;
 page.run("historyEntries=[{task:'업무',action:'수정',name:'작성자',at:'2026-09-24T01:00:00Z',field:'비고',before:'<script>',after:'수정 내용'}];renderHistory()");
 const html=page.element('#historyList').innerHTML;assert.match(html,/변경 전/);assert.match(html,/변경 후/);assert.match(html,/&lt;script&gt;/);assert.match(html,/수정 내용/);
});

test('edits remain local until the save button is used',async()=>{
 let saved;const page=app(p=>{if(p.action==='save'){saved=p.tasks;return {ok:true}}return {ok:true,tasks:[task]}});await page.ready;
 const before=page.requests.length;
 page.run("currentUser={role:'editor'};remember(0,5,'수동 저장 업무')");
 await new Promise(resolve=>setTimeout(resolve,850));
 assert.equal(saved,undefined);assert.equal(page.requests.length,before);
 assert.match(page.element('#saveStatus').textContent,/저장 버튼/);
 await page.element('#saveAll').onclick();
 assert.equal(saved[0][5],'수동 저장 업무');
});
test('CX summary uses calculated adjustments while other workspaces show rounded whole hours',async()=>{
 const first=[...task];first[2]='작업자 A';first[7]='1.234';
 const second=[...task];second[2]='작업자 A';second[7]='2.5';
 const third=[...task];third[2]='작업자 B';third[7]='4';
 const page=app(p=>({ok:true,workspace:p.workspace,tasks:[first,second,third]}));await page.ready;
 assert.match(page.element('#workSummary').innerHTML,/작업자 A/);
 assert.doesNotMatch(page.element('#workSummary').innerHTML,/summary-label|>작업시간</);
 assert.match(page.element('#workSummary').innerHTML,/0\.467/);
 assert.match(page.element('#workSummary').innerHTML,/작업자 B/);
 assert.match(page.element('#workSummary').innerHTML,/0\.50/);
 assert.equal(page.run('data[0][10]'),'0.154');
 assert.equal(page.run('data[1][10]'),'0.313');
 assert.equal(page.run("calculatedAdjustment('9.6')"),'1.20');
 assert.match(page.element('#rows').innerHTML,/aria-label="조정"[^>]*>0\.154</);
 page.element('#worker').value='작업자 B';page.run('render()');
 assert.doesNotMatch(page.element('#workSummary').innerHTML,/작업자 A/);
 assert.match(page.element('#workSummary').innerHTML,/작업자 B/);
 await page.run("switchWorkspace('enterprise')");
 assert.match(page.element('#workSummary').innerHTML,/publishing-total-hours">4</);
 assert.doesNotMatch(page.element('#workSummary').innerHTML,/\.\d{3}/);
});
test('planning and publishing filter narrows both table rows and summaries',async()=>{
 const planning=[...task],publishing=[...task];planning[2]='기획자';planning.push('','','','기획');publishing[2]='퍼블리셔';publishing.push('','','','퍼블');
 const page=app(p=>({ok:true,workspace:p.workspace,tasks:[planning,publishing]}));await page.ready;
 assert.equal(page.run('selected().length'),2);
 page.element('#workTypeFilter').value='기획';page.run('render()');
 assert.equal(page.run('selected().length'),1);assert.match(page.element('#workSummary').innerHTML,/기획자/);assert.doesNotMatch(page.element('#workSummary').innerHTML,/퍼블리셔/);
 page.element('#workTypeFilter').value='퍼블';page.run('render()');
 assert.equal(page.run('selected().length'),1);assert.match(page.element('#workSummary').innerHTML,/퍼블리셔/);
});
test('save commits focused edit and storage cleanup failure does not report remote save failure',async()=>{
 let saved;const page=app(p=>{if(p.action==='save'){saved=p.tasks;return {ok:true}}return {ok:true,tasks:[task]}});await page.ready;
 page.run("document.activeElement={blur(){remember(0,5,'입력 중인 제목')}};localStorage.removeItem=()=>{throw new Error('storage blocked')}");
 await page.run('saveAll()');assert.equal(saved[0][5],'입력 중인 제목');assert.match(page.element('#saveStatus').textContent,/저장 완료/);
});

test('new registration dates save as M/D and remain so on later saves',async()=>{
 let saved;const page=app(p=>{if(p.action==='save'){saved=p.tasks;return {ok:true}}return {ok:true,tasks:[]}});await page.ready;
 page.run("addRow();remember(0,0,'2026-09-19');remember(0,2,'작업자 A');remember(0,5,'새 업무')");
 assert.doesNotMatch(page.element('#rows').innerHTML,/data-save|서버에 저장/);
 await page.run('saveAll()');assert.equal(saved[0][0],'9/19');await page.run('saveAll()');assert.equal(saved[0][0],'9/19');
});

test('deletion persists immediately after confirmation',async()=>{
 let tasks=[task];const page=app(p=>{if(p.action==='save'){tasks=p.tasks;return {ok:true}}return {ok:true,tasks}});await page.ready;
 page.run("document.querySelectorAll=s=>s==='.row-check:checked'?[{dataset:{check:'0'}}]:[];deleteMode=true");
 const before=page.requests.length;await page.run('deleteSelected()');
 assert.equal(page.run('data.length'),0);assert.equal(page.requests.length,before+1);assert.equal(tasks.length,0);
 assert.match(page.element('#saveStatus').textContent,/삭제 및 서버 저장 완료/);
 await page.element('#saveAll').onclick();assert.equal(tasks.length,0);
});

test('old GET deployment gives actionable update instructions and keeps saving disabled',async()=>{
 const page=app(()=>({ok:false,error:'POST 로그인 요청을 사용해 주세요.'}));await page.ready;
 assert.match(page.element('#saveStatus').textContent,/Code.gs.*새 버전/);
 assert.equal(page.element('#saveAll').disabled,true);assert.equal(page.requests.length,1);
});


test('CSV exports visible table values including controls, quotes, newlines and deletion-mode dates',async()=>{
 const page=app(()=>({ok:true,tasks:[task]}));await page.ready;
 page.run(`csvCell=(text,input=null,checkbox=false)=>({innerText:text,querySelector:s=>s==='input[type="checkbox"]'?(checkbox?{}:null):input});
 document.querySelector=((original)=>selector=>selector==='#list table'?{querySelectorAll:()=>[
 {cells:[csvCell('등록'),csvCell('RMS'),csvCell('작업자'),csvCell('비고')]},
 {dataset:{index:'0'},cells:[csvCell('',null,true),csvCell('↗',{value:'00123'}),csvCell('전체 옵션',{value:'작업자 A'}),csvCell('쉼표, 따옴표 "내용"\\n다음 줄')]}
 ]}:original(selector))(document.querySelector);`);
 const csv=page.run('tableCsv()');
 assert.ok(csv.startsWith('\uFEFF'));assert.match(csv,/"9\/19","00123","작업자 A"/);
 assert.ok(csv.includes('"쉼표, 따옴표 ""내용""\n다음 줄"'));assert.ok(!csv.includes('↗'));
});
test('completion date sort toggles ascending and descending with blanks last',async()=>{
 const early=[...task];early[4]='2026-09-02';early[5]='이른 업무';
 const late=[...task];late[4]='2026-09-28';late[5]='늦은 업무';
 const blank=[...task];blank[4]='';blank[5]='날짜 없음';
 const page=app(()=>({ok:true,tasks:[late,blank,early]}));await page.ready;
 page.run("completionSort='asc'");
 assert.equal(page.run("selected().map(x=>x.r[5]).join(',')"),'이른 업무,늦은 업무,날짜 없음');
 page.run('toggleCompletionSort()');
 assert.equal(page.run("selected().map(x=>x.r[5]).join(',')"),'늦은 업무,이른 업무,날짜 없음');
});

test('blank operating completion date renders empty until focused',async()=>{
 const blank=[...task];blank[4]='';
 const page=app(()=>({ok:true,tasks:[blank]}));await page.ready;
 assert.match(page.element('#rows').innerHTML,/type="text" class="date-input" aria-label="운영 반영일"/);
 page.run("data[0][4]='2026-09-30';render()");
 assert.match(page.element('#rows').innerHTML,/type="date" class="date-input" aria-label="운영 반영일"/);
});

test('blank enterprise STG date renders empty until focused',async()=>{
 const page=app(p=>({ok:true,workspace:p.workspace,tasks:[task]}));await page.ready;
 await page.run("switchWorkspace('enterprise')");
 assert.match(page.element('#rows').innerHTML,/type="text" class="date-input" aria-label="STG 반영일"/);
 page.run("data[0][11]='2026-09-30';render()");
 assert.match(page.element('#rows').innerHTML,/type="date" class="date-input" aria-label="STG 반영일"/);
});

test('enterprise STG date persists separately and every workspace has planning/publishing choice',async()=>{
 const stores={cx:[task],enterprise:[task],aldot:[task]};
 const page=app(p=>{if(p.action==='save')stores[p.workspace]=p.tasks;return {ok:true,workspace:p.workspace,tasks:stores[p.workspace]}});await page.ready;
 assert.match(page.element('#rows').innerHTML,/aria-label="조정"/);
 assert.match(page.element('#rows').innerHTML,/work-type-select[\s\S]*기획[\s\S]*퍼블/);
 await page.run("switchWorkspace('enterprise')");
 assert.match(page.element('#rows').innerHTML,/aria-label="STG 반영일"/);
 assert.doesNotMatch(page.element('#rows').innerHTML,/aria-label="조정"/);
 page.run("remember(0,11,'2026-09-25');remember(0,12,'기획')");await page.run('saveAll()');await page.run('load()');
 assert.equal(stores.enterprise[0].length,13);assert.equal(page.run('data[0][11]'),'2026-09-25');assert.equal(page.run('data[0][12]'),'기획');assert.equal(page.run('data[0][4]'),'2026-09-20');
 await page.run("switchWorkspace('aldot')");assert.doesNotMatch(page.element('#rows').innerHTML,/STG 반영일|aria-label="조정"/);assert.match(page.element('#rows').innerHTML,/work-type-select/);
 page.run("remember(0,12,'퍼블')");await page.run('saveAll()');assert.equal(stores.aldot[0][12],'퍼블');
});


test('select all toggles rendered deletion rows and reflects partial and empty selection',async()=>{
 const page=app(()=>({ok:true,tasks:[task]}));await page.ready;
 page.run("selectedMonth=new Date(new Date().getFullYear()+1,0,1);data[0][7]=MONTH_META+JSON.stringify({id:'carry-test',month:monthKey(selectedMonth)});deleteMode=true;checks=[{checked:false},{checked:false}];document.querySelectorAll=s=>s==='.row-check'?checks:s==='.row-check:checked'?checks.filter(x=>x.checked):[];updateDeleteButton()");
 assert.equal(page.element('#selectAllRows').hidden,false);
 page.element('#selectAllRows').checked=true;page.element('#selectAllRows').onchange();
 assert.equal(page.run('checks.every(x=>x.checked)'),true);assert.match(page.element('#deleteToggle').textContent,/2/);
 page.run('checks[0].checked=false;updateDeleteButton()');assert.equal(page.element('#selectAllRows').indeterminate,true);
 page.element('#selectAllRows').checked=false;page.element('#selectAllRows').onchange();assert.equal(page.run('checks.some(x=>x.checked)'),false);
 page.run('checks=[];updateDeleteButton()');assert.equal(page.element('#selectAllRows').disabled,true);
 page.run('deleteMode=false;updateDeleteButton()');assert.equal(page.element('#selectAllRows').hidden,true);
});

test('cancel is migrated to held and is not offered as a stage',async()=>{
 const tasks=['배정','진행중','내부검수','검수요청','반영대기','완료','보류','취소'].map(stage=>{const row=[...task];row[3]=stage;return row});
 const page=app(()=>({ok:true,tasks}));await page.ready;
 page.run("currentTab='active'");assert.equal(page.run('selected().length'),5);
 assert.equal(page.run("statuses.includes('취소')"),false);assert.equal(page.run("data[7][3]"),'보류');
 page.element('#worker').value='다른 작업자';assert.equal(page.run('selected().length'),0);
 page.element('#worker').value='all';page.run("currentTab='list'");assert.equal(page.run('selected().length'),8);
});
test('month navigation crosses years and save retains tasks from other months',async()=>{
 let saved;const rows=['2026-12-15','2027-01-03'].map(date=>[date,...task.slice(1,3),'완료',...task.slice(4)]);
 const page=app(p=>{if(p.action==='save'){saved=p.tasks;return {ok:true}}return {ok:true,tasks:rows}});await page.ready;
 page.run("Date=class extends Date {static now(){return 1797260400000}};currentTab='list';selectedMonth=new Date(2026,11,1);updateMonth()");
 assert.equal(page.run('selected().length'),1);
 page.run('changeMonth(1)');assert.equal(page.element('#monthLabel').textContent,'2027년 01월');
 assert.equal(page.run('selected()[0].r[0]'),'2027-01-03');
 page.run("remember(1,5,'1월 수정')");await page.run('saveAll()');
 assert.equal(saved.length,2);assert.equal(saved[0][0],'2026-12-15');assert.equal(saved[1][5],'1월 수정');
 page.run('changeMonth(-1)');assert.equal(page.element('#monthLabel').textContent,'2026년 12월');
});
test('new tasks belong to selected month with explicit year',async()=>{
 const page=app(()=>({ok:true,tasks:[]}));await page.ready;
 page.run('Date=class extends Date {static now(){return 1802617200000}};selectedMonth=new Date(2027,1,1);addRow()');
 assert.equal(page.run('data[0][0]'),'2027-02-01');assert.equal(page.run('selected().length'),1);
});

test('multiple drafts display first but are appended on save, with failures retaining drafts',async()=>{
 let fail=true,saved;const page=app(p=>{if(p.action==='save'){if(fail)return {ok:false,error:'실패'};saved=p.tasks;return {ok:true}}return {ok:true,tasks:[task]}});await page.ready;
 for(const title of ['초안 A','초안 B']){page.run('addRow()');page.run("remember(data.length-1,2,'작업자 A')");page.run('remember(data.length-1,5,'+JSON.stringify(title)+')')}
 assert.equal(page.run('selected()[0].r[5]'),'초안 B');
 await page.run('saveAll()');assert.equal(page.run('newRows.size'),2);assert.equal(page.run('selected()[0].r[5]'),'초안 B');
 fail=false;await page.run('saveAll()');assert.deepEqual(saved.map(r=>r[5]),['업무 제목','초안 A','초안 B']);assert.equal(page.run('selected()[0].r[5]'),'업무 제목');
});

test('legacy statuses migrate and monthly copies persist without duplicating after edits',async()=>{
 let tasks=['보류','이월','완료','진행'].map((status,i)=>['2026-12-19',''+i,'작업자 A',status,'','업무 '+i,'메모','1','0']);
 const page=app(p=>{if(p.action==='save'){tasks=p.tasks;return {ok:true}}return {ok:true,tasks}});await page.ready;
 assert.equal(page.run('data[1][3]'),'보류');assert.equal(page.run('data[3][3]'),'진행중');
 await page.run('Date=class extends Date {static now(){return 1797260400000}};selectedMonth=new Date(2026,11,1);carryOver()');
 assert.equal(page.run('selected().length'),1);assert.equal(page.run('data.length'),7);
 assert.equal(page.run('selected()[0].r[3]'),'진행중');
 page.run("remember(selected()[0].i,5,'수정된 복사 업무')");await page.run('saveAll()');await page.run('load()');
 assert.equal(page.run('data.length'),7);assert.equal(page.run('selected().length'),1);
 await page.run('changeMonth(-1);carryOver()');assert.equal(await page.run('data.length'),7);
});

test('all stages except completed copy to the next month',async()=>{
 const stages=['배정','진행중','내부검수','검수요청','반영대기','보류','취소','완료'];
 const page=app(()=>({ok:true,tasks:stages.map((stage,i)=>['2026-09-19',''+i,'작업자 A',stage,'','업무 '+i,'비고','2','1'])}));await page.ready;
 await page.run('selectedMonth=new Date(2026,8,1);carryOver()');
 assert.equal(page.run('selected().length'),5);assert.equal(page.run('data.length'),15);
 assert.equal(page.run("selected().every(({r})=>r[0]==='2026-09-19'&&r[6]==='비고'&&r[9]===''&&r[10]==='')"),true);
 page.run("selectTab('list');changeMonth(-1)");assert.equal(page.run('selected().length'),8);
 assert.equal(page.run("selected().every(({r})=>r[9]==='2'&&r[10]==='0.25')"),true);
 await page.run('carryOver()');assert.equal(await page.run('data.length'),15);
});

test('month navigation is restricted to three months and never creates copies',async()=>{
 const page=app(()=>({ok:true,tasks:[task]}));await page.ready;
 page.run('selectedMonth=new Date(2026,7,1);updateMonth();changeMonth(-1)');
 assert.equal(page.element('#monthLabel').textContent,'2026년 08월');assert.equal(page.element('#prevMonth').disabled,true);
 page.run('changeMonth(1);changeMonth(1)');assert.equal(page.run('data.length'),1);assert.equal(page.run('selected().length'),0);assert.equal(page.element('#nextMonth').disabled,true);page.run('changeMonth(1)');assert.equal(page.element('#monthLabel').textContent,'2026년 10월');
 await page.run('changeMonth(-1);carryOver()');assert.equal(await page.run('data.length'),2);assert.equal(page.element('#monthLabel').textContent,'2026년 10월');
 await page.run('changeMonth(-1);carryOver()');assert.equal(await page.run('data.length'),2);
});

test('workspaces preserve drafts and save to their own server namespace',async()=>{
 const stores={cx:[task],enterprise:[],aldot:[]};
 const page=app(p=>{if(p.action==='save')stores[p.workspace]=p.tasks;return {ok:true,workspace:p.workspace,tasks:stores[p.workspace]}});await page.ready;
 page.run("remember(0,5,'CX 초안')");await page.run("switchWorkspace('enterprise')");assert.equal(page.run('data.length'),0);
 page.run("addRow();remember(0,2,'작업자 A');remember(0,5,'기업 업무')");await page.run('saveAll()');
 await page.run("switchWorkspace('aldot')");assert.equal(page.run('data.length'),0);
 await page.run("switchWorkspace('cx')");assert.equal(page.run('data[0][5]'),'CX 초안');assert.equal(stores.cx[0][5],'업무 제목');assert.equal(stores.enterprise[0][5],'기업 업무');
});
test('workspace and matching title survive page reloads',async()=>{
 const storage=new Map();const handler=p=>({ok:true,workspace:p.workspace,tasks:[]});
 const first=app(handler,storage);await first.ready;assert.equal(first.element('header h1').textContent,'CX 업무 관리');
 for(const [key,name] of [['enterprise','기업'],['aldot','알닷'],['cx','CX']]){
  await first.run('switchWorkspace('+JSON.stringify(key)+')');
  const reloaded=app(handler,storage,first.run("window.location.hash"));await reloaded.ready;
  assert.equal(reloaded.requests[0].payload.workspace,key);assert.equal(reloaded.element('header h1').textContent,name+' 업무 관리');assert.equal(reloaded.run('currentTab'),'active');
 }
});

test('home entry makes no server request and workspace navigation preserves drafts',async()=>{
 const page=app(p=>({ok:true,workspace:p.workspace,tasks:[task]}),new Map([['workflow-active-workspace','enterprise']]),'');await page.ready;
 assert.equal(page.requests.length,0);assert.equal(page.element('#homePage').hidden,false);assert.equal(page.element('#workspacePage').hidden,true);
 await page.run("switchWorkspace('cx')");assert.equal(page.requests.length,1);assert.equal(page.element('#homePage').hidden,true);assert.equal(page.run('window.location.hash'),'#cx');
 page.run("remember(0,5,'미저장 업무');showHome()");assert.equal(page.run('window.location.hash'),'');assert.equal(page.element('#homePage').hidden,false);
 await page.run("switchWorkspace('cx')");assert.equal(page.run('data[0][5]'),'미저장 업무');assert.equal(page.requests.length,1);
 page.run("window.location.hash='';restoreRoute()");assert.equal(page.element('#homePage').hidden,false);
 await page.run("window.location.hash='#aldot';restoreRoute()");assert.equal(page.run('currentWorkspace'),'aldot');assert.equal(page.run('currentTab'),'active');
});
test('unknown workspace route opens home without loading data',async()=>{
 const page=app(()=>({ok:true,tasks:[]}),new Map(),'#unknown');await page.ready;assert.equal(page.requests.length,0);assert.equal(page.run('window.location.hash'),'');
});


test('slow workspace response does not block navigation or overwrite the active workspace',async()=>{
 let finishCx;const pending=new Promise(resolve=>finishCx=resolve);
 const page=app(p=>p.workspace==='cx'?pending:{ok:true,workspace:p.workspace,tasks:[]});
 await nextTurn();
 await page.run("switchWorkspace('enterprise')");
 assert.equal(page.run('currentWorkspace'),'enterprise');assert.equal(page.run('serverConnected'),true);
 finishCx({ok:true,workspace:'cx',tasks:[task]});await page.ready;
 assert.equal(page.run('data.length'),0);assert.equal(page.run('serverConnected'),true);
});

test('returning to a loading workspace reuses its pending request',async()=>{
 let finish;const pending=new Promise(resolve=>finish=resolve);
 const page=app(()=>pending);await nextTurn();
 page.run('showHome()');assert.equal(page.element('#homePage').hidden,false);
 const back=page.run("switchWorkspace('cx')");assert.equal(page.requests.length,1);
 finish({ok:true,workspace:'cx',tasks:[task]});await Promise.all([page.ready,back]);
 assert.equal(page.run('data.length'),1);assert.equal(page.run('loading'),false);
});

test('failed request from a previous workspace cannot disconnect the current one',async()=>{
 let fail;const pending=new Promise((_resolve,reject)=>fail=reject);
 const page=app(p=>p.workspace==='cx'?pending:{ok:true,workspace:p.workspace,tasks:[]});
 await nextTurn();await page.run("switchWorkspace('aldot')");
 fail(new TypeError('offline'));await page.ready;
 assert.equal(page.run('serverConnected'),true);assert.equal(page.requests.length,2);
});


test('deleted carried task stays deleted after reload and can be carried again without duplicates',async()=>{
 let tasks=[task];const page=app(p=>{if(p.action==='save')tasks=p.tasks;return {ok:true,tasks}});await page.ready;
 await page.run('selectedMonth=new Date(2026,8,1);carryOver()');await page.run('saveAll()');
 page.run("document.querySelectorAll=s=>s==='.row-check:checked'?[{dataset:{check:'1'}}]:[]");
 await page.run('deleteSelected()');await page.run('load()');assert.equal(page.run('selected().length'),0);
 await page.run("changeMonth(-1);const meta=monthMeta(data[0]);meta.skipped=['2026-10'];data[0][7]=MONTH_META+JSON.stringify(meta);carryOver()");
 assert.equal(page.run('selected().length'),1);await page.run('saveAll()');await page.run('load()');
 assert.equal(await page.run('selected().length'),1);await page.run('changeMonth(-1);carryOver()');assert.equal(await page.run('data.length'),2);
});

test('failed deletion restores the list and unsaved draft markers',async()=>{
 const page=app(p=>p.action==='save'?{ok:false,error:'저장 거부'}:{ok:true,tasks:[task]});await page.ready;
 page.run("newRows.add(0);document.querySelectorAll=s=>s==='.row-check:checked'?[{dataset:{check:'0'}}]:[]");
 await page.run('deleteSelected()');assert.equal(page.run('data.length'),1);assert.equal(page.run('newRows.has(0)'),true);
 assert.match(page.element('#saveStatus').textContent,/목록을 복원/);
});


test('repeated carry overwrites one linked task and removes linked duplicates without affecting unrelated rows',async()=>{
 let tasks=[task];const page=app(p=>{if(p.action==='save')tasks=p.tasks;return {ok:true,tasks}});await page.ready;
 await page.run('selectedMonth=new Date(2026,8,1);carryOver()');await page.run('saveAll()');
 await page.run("data.push([...data[1]]);newRows.add(2);data.push(['2026-10-01','','작업자 A','배정','','별도 업무','','','','3','']);newRows.add(3);remember(0,5,'원본 변경');remember(1,5,'이월 변경');remember(1,9,'5');changeMonth(-1);carryOver()");
 assert.equal(page.run('data.length'),3);assert.equal(page.run('data[1][5]'),'원본 변경');assert.equal(page.run('data[1][9]'),'');
 assert.equal(page.run('data[2][5]'),'별도 업무');assert.equal(page.run('newRows.has(2)'),true);
 await page.run('saveAll()');await page.run('load()');await page.run('changeMonth(-1);carryOver()');
 assert.equal(page.run('data.length'),3);assert.equal(page.run('selected().length'),2);
});


test('bulk selection is hidden in the current month and future months without carried tasks',async()=>{
 const page=app(()=>({ok:true,tasks:[task]}));await page.ready;
 page.run('deleteMode=true;selectedMonth=new Date();updateDeleteButton()');assert.equal(page.element('#selectAllRows').hidden,true);
 page.run('selectedMonth=new Date(new Date().getFullYear()+1,0,1);updateDeleteButton()');assert.equal(page.element('#selectAllRows').hidden,true);
 page.run("data[0][7]=MONTH_META+JSON.stringify({id:'carry',month:monthKey(selectedMonth)});updateDeleteButton()");assert.equal(page.element('#selectAllRows').hidden,false);
 page.run('selectedMonth=new Date();data[0][7]=MONTH_META+JSON.stringify({id:"carry",month:monthKey(selectedMonth)});updateDeleteButton()');assert.equal(page.element('#selectAllRows').hidden,true);
});


test('saving after carry over backs up the original enterprise month',async()=>{
 let backup;
 const enterprise=[...task.slice(0,7),'','',...task.slice(7),'2026-09-24'];enterprise[5]='기업 업무';
 const page=app(p=>{
  if(p.action==='backupLedger'){backup=p;return {ok:true,workspace:p.workspace,sheet:'기업_2026-09',rowCount:p.rows.length}}
  return {ok:true,workspace:p.workspace,tasks:p.workspace==='enterprise'?[enterprise]:[]};
 });
 await page.ready;await page.run("switchWorkspace('enterprise')");
 await page.run("selectedMonth=new Date(2026,8,1);carryOver()");
 assert.equal(backup,undefined);await page.run('saveAll()');
 assert.equal(backup.workspace,'enterprise');assert.equal(backup.month,'2026-09');
 assert.deepEqual(backup.headers,['등록','RMS','작업자','기획/퍼블','단계','STG 반영일','운영 반영일','업무제목','비고','작업시간']);
 assert.equal(backup.rows.length,1);assert.equal(backup.rows[0][5],'2026-09-24');assert.equal(backup.rows[0][7],'기업 업무');
 assert.equal(page.run("monthKey(selectedMonth)"),'2026-10');
});


test('ledger after carry saves all source-month rows regardless of filters and preserves next-month tasks',async()=>{
 let backup,tasks=[task,[...task.slice(0,3),'완료',...task.slice(4)],['2026-10-01','','작업자 B','배정','','다음 달 업무','','4','0']];
 const page=app(p=>{if(p.action==='backupLedger')backup=p;if(p.action==='save')tasks=p.tasks;return {ok:true,workspace:p.workspace,tasks}});await page.ready;
 page.element('#search').value='검색에 없는 내용';page.element('#worker').value='다른 작업자';
 await page.run('selectedMonth=new Date(2026,8,1);carryOver()');assert.equal(backup,undefined);
 await page.run('saveAll()');assert.equal(backup.rows.length,2);assert.ok(backup.rows.some(r=>r[4]==='완료'));assert.ok(!backup.rows.some(r=>r[6]==='다음 달 업무'));
 assert.equal(tasks.length,4);assert.equal(page.run('pendingLedgerMonths.size'),0);
});

test('ledger failure retains carry save context for retry',async()=>{
 let fail=true;const page=app(p=>p.action==='backupLedger'&&fail?{ok:false,error:'대장 실패'}:{ok:true,tasks:[task]});await page.ready;
 await page.run('selectedMonth=new Date(2026,8,1);carryOver()');await page.run('saveAll()');
 assert.equal(page.run("pendingLedgerMonths.get('cx')"),'2026-09');assert.equal(page.requests.filter(r=>r.payload.action==='save').length,0);
 fail=false;await page.run('saveAll()');assert.equal(page.run('pendingLedgerMonths.size'),0);
});

test('redirected Google result 404 retries only the result GET',async()=>{
 const page=app(()=>({ok:true}),new Map(),'',true);await page.ready;
 page.run("let calls=[];fetch=async(url,options)=>{calls.push({url,method:options.method});return calls.length===1?{ok:false,status:404,redirected:true,url:'https://script.googleusercontent.com/macros/echo?test=result'}:{ok:true,json:async()=>({ok:true})}};");
 await page.run("publicRequest({action:'login',username:'example',password:'password1'})");
 assert.equal(page.run("calls.map(x=>x.method).join(',')"),'POST,GET');
});
test('deployment 404 is actionable and does not replay the POST',async()=>{
 const page=app(()=>({ok:true}),new Map(),'',true);await page.ready;
 page.run("let count=0;fetch=async()=>{count++;return {ok:false,status:404,redirected:false,url:'https://script.google.com/macros/s/deployment/exec'}}");
 await assert.rejects(page.run("publicRequest({action:'login'})"),/배포 주소.*404/);
 assert.equal(page.run('count'),1);
});
test('persistent result 404 stops after one GET without repeating a save',async()=>{
 const page=app(()=>({ok:true}),new Map(),'',true);await page.ready;
 page.run("let methods=[];fetch=async(url,options)=>{methods.push(options.method);return {ok:false,status:404,redirected:true,url:'https://script.googleusercontent.com/macros/echo?test=result'}}");
 await assert.rejects(page.run("publicRequest({action:'save',tasks:[]})"),/반영 여부/);
 assert.equal(page.run("methods.join(',')"),'POST,GET');
});

test('login token survives a new tab and legacy tab tokens migrate',async()=>{
 const local=new Map([['workflow-auth-token','persistent']]);
 const handler=p=>({ok:true,user:{username:'admin',name:'관리자',role:'admin'},tasks:[]});
 const page=app(handler,local,'',true,new Map());await page.ready;
 assert.equal(page.requests[0].payload.token,'persistent');
 const legacyLocal=new Map(),tab=new Map([['workflow-auth-token','legacy']]);
 const migrated=app(handler,legacyLocal,'',true,tab);await migrated.ready;
 assert.equal(legacyLocal.get('workflow-auth-token'),'legacy');assert.equal(tab.has('workflow-auth-token'),false);
 migrated.run('clearAuthSession()');assert.equal(legacyLocal.has('workflow-auth-token'),false);
});
test('temporary session request failure preserves persistent login',async()=>{
 const local=new Map([['workflow-auth-token','persistent']]);
 const page=app(()=>{throw new TypeError('Failed to fetch')},local,'',true,new Map());await page.ready;
 assert.equal(local.get('workflow-auth-token'),'persistent');
});

test('select option reuse preserves row bindings, selection and escaping',async()=>{
 const page=app(()=>({ok:true,tasks:[]}));await page.ready;
 page.run('var optionCache=new Map()');
 const first=page.run('selectCell("A",0,2,["","A","<B>"],"worker-select",optionCache)');
 const second=page.run('selectCell("A",99,2,["","A","<B>"],"worker-select",optionCache)');
 assert.match(first,/data-row="0"/);assert.match(second,/data-row="99"/);
 assert.match(second,/<option selected>A/);assert.match(second,/&lt;B&gt;/);
 assert.equal(page.run('optionCache.size'),1);
 const other=page.run('selectCell("<B>",1,2,["","A","<B>"],"worker-select",optionCache)');
 assert.match(other,/<option selected>&lt;B&gt;/);assert.equal(page.run('optionCache.size'),2);
});

test('file and unsupported origins show a data-free preview and cannot send API requests',async()=>{
 for(const origin of ['null','file:///C:/app/index.html','ftp://example.com']){
  const page=app(()=>{throw Error('must not request')},new Map(),'#cx',true,new Map(),origin);await page.ready;
  assert.equal(page.requests.length,0);assert.equal(page.element('#authPage').hidden,true);assert.equal(page.element('#workspacePage').hidden,false);
  assert.match(page.element('#saveStatus').textContent,/화면 미리보기/);assert.equal(page.element('#saveAll').disabled,true);
  await page.run("switchWorkspace('enterprise')");assert.equal(page.run('currentWorkspace'),'enterprise');assert.equal(page.requests.length,0);
  for(const action of ['load','login','save'])await assert.rejects(page.run('postJson('+JSON.stringify({action})+')'),/직접 실행/);
 }
});
test('localhost, loopback and static hosting permit authenticated requests',async()=>{
 for(const origin of ['http://localhost:3000','http://127.0.0.1:8000','https://localhost:443','https://example.com','https://the51dt.github.io']){
  const page=app(p=>({ok:true,workspace:p.workspace,tasks:[],user:{name:'A',role:'admin'}}),new Map([['workflow-auth-token','existing']]),'#cx',true,new Map(),origin);await page.ready;
  assert.equal(page.requests.length,1);assert.equal(page.requests[0].payload.token,'existing');assert.equal(page.requests[0].method,'POST');
  const guest=app(()=>{throw Error('must log in first')},new Map(),'#cx',true,new Map(),origin);await guest.ready;assert.equal(guest.requests.length,0);
 }
});

test('logout clears in-memory tasks and drafts',async()=>{
 const page=app(()=>({ok:true,tasks:[task]}));await page.ready;page.run("workspaceDrafts.set('cx',{data});clearAuthSession()");
 assert.equal(page.run('data.length'),0);assert.equal(page.run('workspaceDrafts.size'),0);assert.equal(page.element('#rows').innerHTML,'');
});

test('three-month view preserves all server rows on save and blocks out-of-range carry',async()=>{
 let saved;const tasks=['2026-07-01','2026-08-01','2026-09-01','2026-10-01','2026-11-01'].map(date=>[date,...task.slice(1)]);
 const page=app(p=>{if(p.action==='save')saved=p.tasks;return {ok:true,tasks}});await page.ready;
 page.run("selectedMonth=new Date(2026,9,1);updateMonth()");
 await page.run('carryOver()');assert.equal(page.run('data.length'),5);assert.equal(page.run('pendingLedgerMonths.size'),0);
 page.run("selectedMonth=new Date(2026,6,1)");assert.equal(page.run('selected().length'),0);
 page.run("selectedMonth=new Date(2026,8,1);remember(2,5,'수정')");await page.run('saveAll()');
 assert.equal(saved.length,5);assert.equal(saved[0][0],'2026-07-01');assert.equal(saved[4][0],'2026-11-01');assert.equal(saved[2][5],'수정');
});
test('view window rolls over at Korean midnight and across years',async()=>{
 const page=app(()=>({ok:true,tasks:[]}));await page.ready;
 for(const [date,expected] of [['2026-09-30T14:59:59Z','2026-08,2026-09,2026-10'],['2026-09-30T15:00:00Z','2026-09,2026-10,2026-11'],['2026-12-31T15:00:00Z','2026-12,2027-01,2027-02']]){
  assert.equal(page.run('Object.values(viewMonthBounds('+Date.parse(date)+')).map(monthKey).join(",")'),expected);
 }
});

test('login retries only explicit pre-issuance busy responses and stops after two retries',async()=>{
 let count=0;const page=app(()=>++count<3?{ok:false,code:'LOGIN_BUSY',error:'busy'}:{ok:true,token:'t'},new Map(),'',true);await page.ready;
 page.run('setTimeout=fn=>fn()');const result=await page.run("loginRequest({action:'login'})");assert.equal(result.token,'t');assert.equal(count,3);
 const busy=app(()=>({ok:false,code:'LOGIN_BUSY',error:'busy'}),new Map(),'',true);await busy.ready;busy.run('setTimeout=fn=>fn()');await assert.rejects(busy.run("loginRequest({action:'login'})"),/busy/);assert.equal(busy.requests.length,3);
 const failed=app(()=>{throw new TypeError('Failed to fetch')},new Map(),'',true);await failed.ready;await assert.rejects(failed.run("loginRequest({action:'login'})"));assert.equal(failed.requests.length,1);
});
