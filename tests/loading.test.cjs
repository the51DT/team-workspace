const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
function app(handler,storage=new Map(),hash='#cx'){
  const location={hash,pathname:'/index.html',search:''};
  const navigate=(_state,_title,url)=>{location.hash=url.includes('#')?url.slice(url.indexOf('#')):''};
  const elements=new Map(),requests=[];
  const element=id=>{if(!elements.has(id))elements.set(id,{value:['#worker','#status'].includes(id)?'all':'',innerHTML:'',textContent:'',addEventListener(){},setAttribute(){},focus(){}});return elements.get(id)};
  const context=vm.createContext({window:{location,history:{pushState:navigate,replaceState:navigate},addEventListener(){},APPS_SCRIPT_URL:'https://example.test/exec',WORKERS:['작업자 A']},AbortSignal,console,
    fetch:async(url,options)=>{const payload=JSON.parse(options.body);requests.push({url,payload,headers:options.headers});const result=await handler(payload);return {ok:true,json:async()=>result}},
    localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},alert(){},confirm:()=>true,requestAnimationFrame:fn=>fn(),setTimeout,
    document:{querySelector:element,querySelectorAll:()=>[]}});
  const ready=vm.runInContext(source,context);
  return {ready,requests,element,run:code=>vm.runInContext(code,context)};
}
const task=['9/19','123','작업자 A','배정','2026-09-20','업무 제목','메모','1.5','0'];
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
test('load uses Apps Script tasks and maps nine columns without losing work hours',async()=>{
  const page=app(()=>({ok:true,tasks:[task],updatedAt:'2026-09-19T00:00:00Z',holidayError:'key missing'}));await page.ready;
  assert.equal(page.requests[0].payload.action,'load');assert.equal(page.run('data[0][9]'),'1.5');
  assert.match(page.element('#rows').innerHTML,/업무 제목/);assert.equal(page.run('serverConnected'),true);
});
test('save sends the full nine-column task list and reload retrieves it',async()=>{
  let tasks=[task];const page=app(p=>{if(p.action==='save'){tasks=p.tasks;return {ok:true,updatedAt:'saved'}}return {ok:true,tasks}});await page.ready;
  page.run("remember(0,5,'수정 업무')");await page.run('saveAll()');
  assert.equal(tasks[0][5],'수정 업무');assert.equal(tasks[0].length,9);
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

test('active tab excludes completed, held and carried-over tasks',async()=>{
 const tasks=['배정','진행중','내부검수','검수요청','반영대기','완료','보류','취소'].map(stage=>{const row=[...task];row[3]=stage;return row});
 const page=app(()=>({ok:true,tasks}));await page.ready;
 page.run("currentTab='active'");assert.equal(page.run('selected().length'),5);
 page.element('#worker').value='다른 작업자';assert.equal(page.run('selected().length'),0);
 page.element('#worker').value='all';page.run("currentTab='list'");assert.equal(page.run('selected().length'),8);
});
test('save commits focused edit and storage cleanup failure does not report remote save failure',async()=>{
 let saved;const page=app(p=>{if(p.action==='save'){saved=p.tasks;return {ok:true}}return {ok:true,tasks:[task]}});await page.ready;
 page.run("document.activeElement={blur(){remember(0,5,'입력 중인 제목')}};localStorage.removeItem=()=>{throw new Error('storage blocked')}");
 await page.run('saveAll()');assert.equal(saved[0][5],'입력 중인 제목');assert.match(page.element('#saveStatus').textContent,/저장 완료/);
});

test('month navigation crosses years and save retains tasks from other months',async()=>{
 let saved;const rows=['2026-12-15','2027-01-03'].map(date=>[date,...task.slice(1,3),'완료',...task.slice(4)]);
 const page=app(p=>{if(p.action==='save'){saved=p.tasks;return {ok:true}}return {ok:true,tasks:rows}});await page.ready;
 page.run("currentTab='list';selectedMonth=new Date(2026,11,1);updateMonth()");
 assert.equal(page.run('selected().length'),1);
 page.run('changeMonth(1)');assert.equal(page.element('#monthLabel').textContent,'2027년 01월');
 assert.equal(page.run('selected()[0].r[0]'),'2027-01-03');
 page.run("remember(1,5,'1월 수정')");await page.run('saveAll()');
 assert.equal(saved.length,2);assert.equal(saved[0][0],'2026-12-15');assert.equal(saved[1][5],'1월 수정');
 page.run('changeMonth(-1)');assert.equal(page.element('#monthLabel').textContent,'2026년 12월');
});
test('new tasks belong to selected month with explicit year',async()=>{
 const page=app(()=>({ok:true,tasks:[]}));await page.ready;
 page.run('selectedMonth=new Date(2027,1,1);addRow()');
 assert.equal(page.run('data[0][0]'),'2027-02-01');assert.equal(page.run('selected().length'),1);
});

test('multiple drafts display first but are appended on save, with failures retaining drafts',async()=>{
 let fail=true,saved;const page=app(p=>{if(p.action==='save'){if(fail)return {ok:false,error:'실패'};saved=p.tasks;return {ok:true}}return {ok:true,tasks:[task]}});await page.ready;
 for(const title of ['초안 A','초안 B']){page.run('addRow()');page.run("remember(data.length-1,2,'작업자 A')");page.run('remember(data.length-1,5,'+JSON.stringify(title)+')')}
 assert.equal(page.run('selected()[0].r[5]'),'초안 B');
 await page.run('saveAll()');assert.equal(page.run('newRows.size'),2);assert.equal(page.run('selected()[0].r[5]'),'초안 B');
 fail=false;await page.run('saveAll()');assert.deepEqual(saved.map(r=>r[5]),['업무 제목','초안 A','초안 B']);assert.equal(page.run('selected()[0].r[5]'),'업무 제목');
});

test('new registration dates save as M/D and remain so on later saves',async()=>{
 let saved;const page=app(p=>{if(p.action==='save'){saved=p.tasks;return {ok:true}}return {ok:true,tasks:[]}});await page.ready;
 page.run("addRow();remember(0,0,'2026-09-19');remember(0,2,'작업자 A');remember(0,5,'새 업무')");
 assert.doesNotMatch(page.element('#rows').innerHTML,/data-save|서버에 저장/);
 await page.run('saveAll()');assert.equal(saved[0][0],'9/19');await page.run('saveAll()');assert.equal(saved[0][0],'9/19');
});

test('refresh button fetches changed server rows and clears stale search',async()=>{
 let tasks=[task];const page=app(()=>({ok:true,tasks}));await page.ready;
 tasks=[[...task.slice(0,5),'서버에서 바뀐 제목',...task.slice(6)]];
 page.element('#search').value='이전 검색어';await page.element('#refresh').onclick();
 assert.equal(page.requests.length,2);assert.equal(page.run('data[0][5]'),'서버에서 바뀐 제목');
 assert.equal(page.element('#search').value,'');assert.match(page.element('#saveStatus').textContent,/새로고침 완료/);
 assert.equal(page.element('#refresh').disabled,false);
});



test('delete persists immediately and failed deletion restores local rows',async()=>{
 for(const fail of [false,true]){
  let tasks=[task];const page=app(p=>{if(p.action==='save'){if(fail)return {ok:false,error:'저장 거부'};tasks=p.tasks;return {ok:true}}return {ok:true,tasks}});await page.ready;
  page.run("document.querySelectorAll=s=>s==='.row-check:checked'?[{dataset:{check:'0'}}]:[];deleteMode=true");
  await page.run('deleteSelected()');assert.equal(page.run('data.length'),fail?1:0);
  await page.run('load()');assert.equal(page.run('data.length'),fail?1:0);
 }
});

test('legacy statuses migrate and monthly copies persist without duplicating after edits',async()=>{
 let tasks=['보류','이월','완료','진행'].map((status,i)=>['2026-12-19',''+i,'작업자 A',status,'','업무 '+i,'메모','1','0']);
 const page=app(p=>{if(p.action==='save'){tasks=p.tasks;return {ok:true}}return {ok:true,tasks}});await page.ready;
 assert.equal(page.run('data[1][3]'),'취소');assert.equal(page.run('data[3][3]'),'진행중');
 page.run('selectedMonth=new Date(2026,11,1);carryOver()');
 assert.equal(page.run('selected().length'),1);assert.equal(page.run('data.length'),5);
 assert.equal(page.run('selected()[0].r[3]'),'진행중');
 page.run("remember(4,5,'수정된 복사 업무')");await page.run('saveAll()');await page.run('load()');
 assert.equal(page.run('data.length'),5);assert.equal(page.run('selected().length'),1);
 page.run('changeMonth(-1);carryOver()');assert.equal(page.run('data.length'),5);
});

test('all unfinished stages copy while terminal stages remain in the original month',async()=>{
 const stages=['배정','진행중','내부검수','검수요청','반영대기','보류','취소','완료'];
 const page=app(()=>({ok:true,tasks:stages.map((stage,i)=>['2026-09-19',''+i,'작업자 A',stage,'','업무 '+i,'비고','2','1'])}));await page.ready;
 page.run('selectedMonth=new Date(2026,8,1);carryOver()');
 assert.equal(page.run('selected().length'),5);assert.equal(page.run('data.length'),13);
 assert.equal(page.run("selected().every(({r})=>r[0]==='2026-09-19'&&r[6]==='비고'&&r[9]===''&&r[10]==='')"),true);
 page.run("selectTab('list');changeMonth(-1)");assert.equal(page.run('selected().length'),8);
 assert.equal(page.run("selected().every(({r})=>r[9]==='2'&&r[10]==='1')"),true);
 page.run('carryOver()');assert.equal(page.run('data.length'),13);
});

test('month navigation cannot go before September 2026 and never creates copies',async()=>{
 const page=app(()=>({ok:true,tasks:[task]}));await page.ready;
 page.run('selectedMonth=new Date(2026,8,1);updateMonth();changeMonth(-1)');
 assert.equal(page.element('#monthLabel').textContent,'2026년 09월');assert.equal(page.element('#prevMonth').disabled,true);
 page.run('changeMonth(1)');assert.equal(page.run('data.length'),1);assert.equal(page.run('selected().length'),0);
 page.run('changeMonth(-1);carryOver()');assert.equal(page.run('data.length'),2);assert.equal(page.element('#monthLabel').textContent,'2026년 10월');
 page.run('changeMonth(-1);carryOver()');assert.equal(page.run('data.length'),2);
});

test('notes allow Enter and preserve rendered line breaks through save and reload',async()=>{
 let tasks=[task];const page=app(p=>{if(p.action==='save'){tasks=p.tasks;return {ok:true}}return {ok:true,tasks}});await page.ready;
 page.run("note={dataset:{row:'0',col:'6'},innerText:'첫 줄\\n둘째 줄',textContent:'첫 줄둘째 줄',blur(){throw Error('unexpected blur')}};document.querySelectorAll=s=>s==='#rows [contenteditable]'?[note]:[];bind()");
 page.run("note.onkeydown({key:'Enter',preventDefault(){throw Error('Enter blocked')}});note.oninput()");
 await page.run('saveAll()');await page.run('load()');
 assert.equal(page.run('data[0][6]'),'첫 줄\n둘째 줄');
});

test('initial load timeout retries once and unlocks saving after successful load',async()=>{
 let attempts=0;const page=app(()=>{if(++attempts===1)throw Object.assign(new Error('signal timed out'),{name:'TimeoutError'});return {ok:true,tasks:[task]}});await page.ready;
 assert.equal(attempts,2);assert.equal(page.run('serverConnected'),true);assert.equal(page.element('#saveAll').disabled,false);
});
test('repeated load timeouts stop retrying and leave refresh available',async()=>{
 let attempts=0;const page=app(()=>{attempts++;throw Object.assign(new Error('signal timed out'),{name:'TimeoutError'})});await page.ready;
 assert.equal(attempts,2);assert.equal(page.element('#refresh').disabled,false);assert.equal(page.element('#saveAll').disabled,true);
 assert.match(page.element('#saveStatus').textContent,/서버 응답 시간이 초과/);
});

test('workspaces preserve drafts and save to their own server namespace',async()=>{
 const stores={cx:[task],enterprise:[],aldot:[]};
 const page=app(p=>{if(p.action==='save')stores[p.workspace]=p.tasks;return {ok:true,workspace:p.workspace,tasks:stores[p.workspace]}});await page.ready;
 page.run("remember(0,5,'CX 초안')");await page.run("switchWorkspace('enterprise')");assert.equal(page.run('data.length'),0);
 page.run("addRow();remember(0,2,'작업자 A');remember(0,5,'기업 업무')");await page.run('saveAll()');
 await page.run("switchWorkspace('aldot')");assert.equal(page.run('data.length'),0);
 await page.run("switchWorkspace('cx')");assert.equal(page.run('data[0][5]'),'CX 초안');assert.equal(stores.cx[0][5],'업무 제목');assert.equal(stores.enterprise[0][5],'기업 업무');
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

test('cached preview is visible on failed reload but cannot be saved',async()=>{
 let fail=false;const page=app(()=>fail?{ok:false,error:'서버 일시 오류'}:{ok:true,tasks:[task]});await page.ready;
 page.run("cacheValue=JSON.stringify({tasks:[['9/19','123','작업자 A','배정','','캐시 업무','','','']]});localStorage.getItem=key=>key===snapshotKey()?cacheValue:null;data=[]");
 fail=true;await page.run('load()');assert.equal(page.run('data[0][5]'),'캐시 업무');assert.equal(page.run('serverConnected'),false);assert.equal(page.element('#saveAll').disabled,true);
 const before=page.requests.length;await page.run('saveAll()');assert.equal(page.requests.length,before);
 page.run("currentWorkspace='enterprise'");assert.match(page.run('snapshotKey()'),/:enterprise$/);
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
