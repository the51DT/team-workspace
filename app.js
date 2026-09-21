const workspaceNames={cx:'CX',enterprise:'기업',aldot:'알닷'};
let currentWorkspace='cx';
let homeVisible=true;
const workspaceDrafts=new Map();
function storageKey(key){return currentWorkspace==='cx'?key:currentWorkspace+':'+key}
const statusClasses={"배정":"status-assigned","진행중":"status-in-progress","내부검수":"status-internal-review","검수요청":"status-review-requested","반영대기":"status-pending-release","완료":"status-completed","취소":"status-cancelled","보류":"status-on-hold"};
const statusClass=value=>Object.hasOwn(statusClasses,value)?statusClasses[value]:'';
const ID='1QEgjN6IXs473j1oNuTt-5WM39CcihQNHfUN7Piyp6WI',statuses=['배정','진행중','내부검수','검수요청','반영대기','완료','취소','보류'],KEY='cx-workflow-edits-v5';
let workers=[];
function visibleWorkers(){return workers}
let editPrefix='',serverConnected=false;
let authToken='',currentUser=null,setupRequired=false;
const canEdit=()=>currentUser&&['admin','editor'].includes(currentUser.role);
let saving=false,autoSaveTimer=0,suppressAutoSave=false;
const calendarToday=new Date();
let selectedMonth=new Date(calendarToday.getFullYear(),calendarToday.getMonth(),1);
let currentView='list',currentTab='active';
let data=[],newRows=new Set(),deleteMode=false,edits={};const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)],esc=v=>String(v??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
const nowText=()=>{let d=new Date(),p=n=>String(n).padStart(2,'0');return `${p(d.getFullYear()%100)}.${p(d.getMonth()+1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`};
function normalize(row){
  if(!Array.isArray(row)||![9,11].includes(row.length)||row.some(v=>v!==null&&!['string','number','boolean'].includes(typeof v)))throw new Error('업무 데이터는 9개 열의 배열이어야 합니다.');
  const values=row.map(v=>String(v??''));
  if(values.length===9)values.splice(7,0,'','');
  values[3]=values[3]==='진행'?'진행중':values[3]==='이월'?'취소':values[3];
  return values;
}
function snapshotKey(){return 'workflow-snapshot-v1:'+window.APPS_SCRIPT_URL+':'+currentWorkspace}
function cacheSnapshot(tasks){try{localStorage.setItem(snapshotKey(),JSON.stringify({tasks,savedAt:Date.now()}))}catch{}}
function previewSnapshot(){
 if(data.length)return false;
 try{
  const cached=JSON.parse(localStorage.getItem(snapshotKey()));
  if(!cached||!Array.isArray(cached.tasks))return false;
  data=cached.tasks.map(normalize);
  workers=[...new Set([...workers,...data.map(r=>r[2])].filter(Boolean))];
  filters();render();return true;
 }catch{return false}
}
let pendingRequests=0;
function updateLoadingBar(delta){pendingRequests=Math.max(0,pendingRequests+delta);const bar=$('#loadingBar');if(!bar)return;const active=pendingRequests>0;bar.classList?.toggle('active',active);bar.setAttribute?.('aria-hidden',String(!active))}
async function trackedFetch(url,options){updateLoadingBar(1);try{return await fetch(url,options)}finally{updateLoadingBar(-1)}}
let loading=false;
async function requestServer(payload){
  if(!window.APPS_SCRIPT_URL)throw new Error('config.js에 Apps Script 웹 앱 URL을 설정해 주세요.');
  const publicRead=payload.action==='loadAudit'||(payload.action==='load'&&!authToken);
  const url=new URL(window.APPS_SCRIPT_URL);
  if(publicRead){url.searchParams.set('action',payload.action);url.searchParams.set('workspace',currentWorkspace);}
  const response=await trackedFetch(url.toString(),{method:publicRead?'GET':'POST',cache:'no-store',...(!publicRead?{headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({...payload,workspace:currentWorkspace,token:authToken})}:{}),signal:AbortSignal.timeout(payload.action==='load'?60000:30000)});
  if(!response.ok)throw new Error('서버 응답 오류 (HTTP '+response.status+')');
  let result;
  try{result=await response.json()}catch{throw new Error('서버가 JSON을 반환하지 않습니다. 웹 앱 배포와 접근 권한을 확인해 주세요.')}
  if(!result?.ok){
    if(result?.error==='POST 로그인 요청을 사용해 주세요.')throw new Error('서버에 이전 조회 코드가 배포되어 있습니다. Code.gs를 반영하고 배포 관리에서 새 버전으로 배포한 뒤 config.js의 /exec URL을 확인해 주세요.');
    throw new Error(result?.error||result?.message||'Apps Script 요청에 실패했습니다.');
  }
  if(['load','save','saveWorkers','loadAudit'].includes(payload.action)&&((result.workspace&&result.workspace!==currentWorkspace)||(currentWorkspace!=='cx'&&result.workspace!==currentWorkspace)))throw new Error('기업·알닷 저장소를 사용하려면 수정된 Code.gs를 Apps Script에 새 버전으로 배포해 주세요.');
  return result;
}
function lockControls(busy){['newTask','carryOver','saveAll','deleteToggle'].forEach(id=>{const el=$("#"+id);if(el)el.disabled=busy||!canEdit()});const refresh=$("#refresh");if(refresh)refresh.disabled=busy;$("#rows").inert=busy}
async function load(){
  if(loading||saving)return;
  loading=true;lockControls(true);serverConnected=false;

  $('#refresh').textContent='…';
  $('#refresh').setAttribute('aria-busy','true');
  const preview=previewSnapshot();
  $('#saveStatus').textContent=preview?'● 이전 조회 목록 표시 중 · 최신 데이터 확인 중…':'● 최신 업무를 불러오는 중…';
  try{
    let result;
    try{result=await requestServer({action:'load'})}
    catch(error){
      if(!['TimeoutError','AbortError','TypeError'].includes(error.name)&&!/timed? ?out/i.test(error.message))throw error;

      $('#saveStatus').textContent='● 서버 응답이 지연되어 다시 불러오는 중…';
      result=await requestServer({action:'load'});
    }
    if(!Array.isArray(result.tasks))throw new Error('load 응답에 tasks가 없습니다. 제공하신 Apps Script 코드를 새 버전으로 배포해 주세요.');
    const rows=result.tasks.map(normalize);
    cacheSnapshot(result.tasks);
    data=rows;newRows.clear();edits={};deleteMode=false;
    $('#deleteToggle').textContent='삭제';
    workers=[...new Set([...(Array.isArray(result.workers)?result.workers:[]),...data.map(r=>r[2])].filter(Boolean))];
    serverConnected=true;if(result.user)currentUser=result.user;filters();applyPermissions();render();

    $('#saveStatus').textContent='● 새로고침 완료 · '+new Date().toLocaleTimeString('ko-KR');

  }catch(error){

    serverConnected=false;
    const reason=['TimeoutError','AbortError'].includes(error.name)||/timed? ?out/i.test(error.message)?'서버 응답 시간이 초과되었습니다. 잠시 후 새로고침 버튼(↻)으로 다시 시도해 주세요.':error.message;
    $('#saveStatus').textContent='● 조회 실패: '+reason;
  }finally{loading=false;lockControls(false);$('#saveAll').disabled=!serverConnected||Boolean(currentUser&&!canEdit());$('#refresh').textContent='↻';$('#refresh').setAttribute('aria-busy','false')}
}
async function saveAll(options={}){
  const automatic=options?.automatic===true;
  if(currentUser&&!canEdit()){if(!automatic)alert('수정하려면 편집 권한이 있는 계정으로 로그인해 주세요.');return false;}
  if(autoSaveTimer){clearTimeout(autoSaveTimer);autoSaveTimer=0;}
  if(loading||saving)return false;
  if(!serverConnected){if(!automatic)alert('서버 데이터를 먼저 불러와 주세요.');return false}
  suppressAutoSave=true;document.activeElement?.blur?.();suppressAutoSave=false;
  const incomplete=data.findIndex(r=>!r[2].trim()||!r[5].trim());
  if(incomplete!==-1){
    const row=data[incomplete],missing=[!row[2].trim()?'작업자':'',!row[5].trim()?'업무제목':''].filter(Boolean).join(', ');
    const message=(incomplete+1)+'번째 업무 (등록일 '+(row[0]||'없음')+', '+(row[5]||'제목 없음')+')의 '+missing+'을 입력해 주세요.';
    $('#saveStatus').textContent=automatic?'● 자동 저장 대기: '+missing+' 입력 필요':'● 저장 취소: '+message;if(!automatic)alert(message);return false;
  }
  saving=true;lockControls(true);$('#saveStatus').textContent='● 저장 중…';
  const orderedRows=[...data.filter((_,i)=>!newRows.has(i)),...data.filter((_,i)=>newRows.has(i))];
  const pendingRows=new Set([...newRows].map(i=>data[i]));
  const tasks=orderedRows.map(row=>{
    const columns=monthMeta(row)?[0,1,2,3,4,5,6,7,8,9,10]:[0,1,2,3,4,5,6,9,10];
    return columns.map(c=>c===0&&pendingRows.has(row)?registrationLabel(row[0]):row[c]??'');
  });
  try{
    const result=await requestServer({action:'save',tasks});
    data=orderedRows.map((row,i)=>[tasks[i][0],...row.slice(1)]);newRows.clear();edits={};try{localStorage.removeItem(storageKey(KEY))}catch{}
    cacheSnapshot(tasks);
    $('#saveStatus').textContent=automatic?'● 자동 저장 완료 · '+new Date().toLocaleTimeString('ko-KR'):'● Apps Script 저장 완료';
    render();return true;
  }catch(error){const reason=error.name==='TimeoutError'?'서버 응답 시간이 초과되었습니다. 입력 내용은 유지되어 있습니다.':error.message;$('#saveStatus').textContent='● 저장 실패: '+reason;if(!automatic)alert('저장 실패: '+reason);return false}
  finally{saving=false;lockControls(false)}
}
function filters(){$('#worker').innerHTML='<option value="all">전체 작업자</option>'+visibleWorkers().map(x=>`<option>${esc(x)}</option>`).join('');$('#status').innerHTML='<option value="all">전체 단계</option>'+statuses.map(x=>`<option>${esc(x)}</option>`).join('')}
function inSelectedMonth(value){
  const match=String(value??'').trim().match(/^(?:(\d{4}|\d{2})[.\/-]\s*)?(\d{1,2})[.\/-]\s*(\d{1,2})(?:$|[T\s])/);
  if(!match)return false;
  const year=match[1]?(match[1].length===2?2000+Number(match[1]):Number(match[1])):calendarToday.getFullYear();
  return year===selectedMonth.getFullYear()&&Number(match[2])===selectedMonth.getMonth()+1;
}
const MONTH_META='cx-month-v1:';
function monthKey(date){return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')}
function monthMeta(row){try{return String(row[7]).startsWith(MONTH_META)?JSON.parse(row[7].slice(MONTH_META.length)):null}catch{return null}}
function rowMonth(row){
 const meta=monthMeta(row);if(meta)return meta.month;
 const m=String(row[0]).trim().match(/^(?:(\d{4}|\d{2})[.\/-]\s*)?(\d{1,2})[.\/-]\s*(\d{1,2})/);
 if(!m)return '';
 const y=m[1]?(m[1].length===2?2000+Number(m[1]):Number(m[1])):calendarToday.getFullYear();
 return y+'-'+String(Number(m[2])).padStart(2,'0');
}
function copyPreviousMonth(targetMonth=selectedMonth){
 if(!serverConnected)return 0;
 const target=monthKey(targetMonth),previous=monthKey(new Date(targetMonth.getFullYear(),targetMonth.getMonth()-1,1));
 let count=0;
 data.filter(row=>rowMonth(row)===previous&&!['보류','취소','완료'].includes(row[3])).forEach(row=>{
  let meta=monthMeta(row);
  if(!meta){meta={id:Date.now().toString(36)+'-'+Math.random().toString(36).slice(2),month:previous};row[7]=MONTH_META+JSON.stringify(meta)}
  if(meta.skipped?.includes(target)||data.some(other=>{const m=monthMeta(other);return m&&m.id===meta.id&&m.month===target}))return;
  const clone=[...row];clone[9]='';clone[10]='';clone[7]=MONTH_META+JSON.stringify({id:meta.id,month:target});
  data.push(clone);newRows.add(data.length-1);count++;
 });
 if(count)$('#saveStatus').textContent='● 이전 달 업무 '+count+'개 복사됨 · 저장을 눌러 반영해 주세요';
 return count;
}
function updateMonth(){
  $('#prevMonth').disabled=selectedMonth<=new Date(2026,8,1);
  $('#monthLabel').textContent=selectedMonth.getFullYear()+'년 '+String(selectedMonth.getMonth()+1).padStart(2,'0')+'월';
}
function changeMonth(offset){
  if(loading||saving)return;
  const next=new Date(selectedMonth.getFullYear(),selectedMonth.getMonth()+offset,1);
  if(next<new Date(2026,8,1))return;
  suppressAutoSave=true;document.activeElement?.blur?.();suppressAutoSave=false;selectedMonth=next;
  updateMonth();render();
}
function carryOver(){
  if(loading||saving||!serverConnected)return;
  suppressAutoSave=true;document.activeElement?.blur?.();suppressAutoSave=false;
  const next=new Date(selectedMonth.getFullYear(),selectedMonth.getMonth()+1,1);
  const count=copyPreviousMonth(next);
  if(!count){$('#saveStatus').textContent='● 이월할 업무가 없거나 이미 이월되었습니다.';return}
  selectedMonth=next;$('#search').value='';$('#worker').value='all';$('#status').value='all';
  updateMonth();render();
}
function selected(){let q=$('#search').value.toLowerCase(),w=$('#worker').value,s=$('#status').value;return data.map((r,i)=>({r,i})).filter(x=>rowMonth(x.r)===monthKey(selectedMonth)&&(currentTab!=='active'||!['완료','보류','취소'].includes(x.r[3]))&&(!q||x.r.join(' ').toLowerCase().includes(q))&&(w==='all'||x.r[2]===w)&&(s==='all'||x.r[3]===s)).sort((a,b)=>Number(newRows.has(b.i))-Number(newRows.has(a.i))||(newRows.has(a.i)?b.i-a.i:a.i-b.i))}
function cell(v,r,c,cl=''){return `<td class="editable ${cl}" contenteditable="true" data-row="${r}" data-col="${c}" spellcheck="false">${esc(v)}</td>`}
function numberCell(v,r,c){return `<td class="number-cell"><input class="number-input" type="text" inputmode="decimal" aria-label="${c===9?'실 작업 시간':'조정'}" data-row="${r}" data-col="${c}" value="${esc(v)}"></td>`}
function rmsCell(v,r){let num=String(v||'').replace(/\D/g,'');return `<td class="rms-cell"><input class="rms-input" data-row="${r}" value="${esc(v)}" inputmode="numeric">${num?`<a href="http://kms-redmine.medialog.co.kr/redmine/issues/${num}" target="_blank" rel="noopener">↗</a>`:''}</td>`}
function dateValue(v){let m=String(v||'').trim().match(/^(?:(\d{4})[.\/-])?(\d{1,2})[.\/-](\d{1,2})$/);return m?`${m[1]||new Date().getFullYear()}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`:''}
function dateCell(v,r){return `<td class="date-cell"><input type="date" class="date-input" aria-label="완료 및 반영일" data-row="${r}" value="${dateValue(v)}"></td>`}function selectCell(v,r,c,items,type){return `<td class="select-cell"><select class="cell-select ${type} ${type==='status-select'?statusClass(v):''}" data-row="${r}" data-col="${c}">${items.map(x=>`<option ${x===v?'selected':''}>${esc(x)}</option>`).join('')}</select></td>`}
function parsedHours(value){const normalized=String(value??"").trim().replace(",",".").replace(/\s*h(?:ours?)?$/i,"");const hours=Number(normalized);return Number.isFinite(hours)?hours:0;}
function renderWorkSummary(rows){const totals=new Map();rows.forEach(({r})=>{const worker=String(r[2]||"").trim();if(worker)totals.set(worker,(totals.get(worker)||0)+parsedHours(r[9]));});const order=[...visibleWorkers(),...totals.keys()].filter((name,index,all)=>totals.has(name)&&all.indexOf(name)===index);const summary=$("#workSummary");summary.hidden=!order.length;summary.innerHTML=order.map((name,index)=>{const total=totals.get(name);return`<article ${order.length===1?'id="publishingWorkSummary" ':""}class="summary-card summary-work-card" data-worker="${esc(name)}"><span class="summary-label">작업시간</span><strong class="worker-name">${esc(name)}</strong><div class="work-time-value"><strong class="publishing-total-hours">${esc(total.toFixed(3))}</strong><span class="hour-unit">h</span></div></article>`;}).join("");}
function render(){let a=selected();renderWorkSummary(a);$("#rows").innerHTML=a.map(({r,i})=>`<tr data-index="${i}" class="${newRows.has(i)?"new-row":""}"><td class="locked">${deleteMode?`<input class="row-check" type="checkbox" data-check="${i}" aria-label="행 선택">`:esc(registrationLabel(r[0]))}</td>${rmsCell(r[1],i)}${selectCell(r[2],i,2,["",...new Set([...visibleWorkers(),...(r[2]?[r[2]]:[])])],"worker-select")}${selectCell(r[3],i,3,statuses,"status-select")}${dateCell(r[4],i)}${cell(r[5],i,5,"task")}${cell(r[6],i,6)}${numberCell(r[9],i,9)}${numberCell(r[10],i,10)}</tr>`).join("");$("#count").textContent=`총 ${a.length}개의 업무`;bind();if(currentUser&&!canEdit()){$$("#rows input, #rows select").forEach(el=>el.disabled=true);$$("#rows [contenteditable]").forEach(el=>el.setAttribute("contenteditable","false"));}$$(".row-check").forEach((x)=>(x.onchange=updateDeleteButton));updateDeleteButton();}
function scheduleAutoSave(){
 if(suppressAutoSave||!serverConnected||(currentUser&&!canEdit())||typeof document.getElementById!=='function')return;
 if(autoSaveTimer)clearTimeout(autoSaveTimer);
 $('#saveStatus').textContent='● 자동 저장 대기 중…';
 autoSaveTimer=setTimeout(async()=>{autoSaveTimer=0;if(loading||saving){scheduleAutoSave();return}await saveAll({automatic:true})},700);
}
function remember(r,c,v){data[r][c]=v;$('#saveStatus').textContent='● 변경사항 자동 저장 예정';if(!newRows.has(r)){edits[`${editPrefix}${r}:${c}`]=v;try{localStorage.setItem(storageKey(KEY),JSON.stringify(edits))}catch{}}scheduleAutoSave()}
function editableText(element){const text=element.innerText??element.textContent;return +element.dataset.col===6?text:text.trim()}
function bind(){$$(".number-input").forEach((x)=>(x.oninput=()=>{remember(+x.dataset.row,+x.dataset.col,x.value);renderWorkSummary(selected());}));$$(".rms-input").forEach((x)=>(x.onchange=()=>{remember(+x.dataset.row,1,x.value.trim());render();}));$$(".date-input").forEach((x)=>(x.onchange=()=>remember(+x.dataset.row,4,x.value)));$$("#rows [contenteditable]").forEach((x)=>{x.oninput=()=>remember(+x.dataset.row,+x.dataset.col,editableText(x));x.onkeydown=(e)=>{if(e.key==="Enter"&&!e.isComposing&&+x.dataset.col!==6){e.preventDefault();x.blur();}};x.onfocus=()=>(x.dataset.old=editableText(x));x.onblur=()=>{let v=editableText(x),r=+x.dataset.row,c=+x.dataset.col;if(v!==x.dataset.old){remember(r,c,v);x.classList.add("saved");setTimeout(()=>x.classList.remove("saved"),700);}};});$$(".cell-select").forEach((x)=>(x.onchange=()=>{let r=+x.dataset.row,c=+x.dataset.col,v=x.value;remember(r,c,v);if(c===3&&v==="진행중"&&!data[r][7])remember(r,7,nowText());if(c===3&&v==="완료")remember(r,8,nowText());render();}));}
function addRow(){let d=new Date(),day=d.getFullYear()===selectedMonth.getFullYear()&&d.getMonth()===selectedMonth.getMonth()?d.getDate():1;data.push([`${selectedMonth.getFullYear()}-${String(selectedMonth.getMonth()+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`,'','','배정','','','','','','','']);newRows.add(data.length-1);deleteMode=false;$('#saveStatus').textContent='● 새 업무 저장 필요';$('#search').value='';$('#worker').value='all';$('#status').value='all';render();requestAnimationFrame(()=>$('#rows tr:first-child .worker-select')?.focus())}
function registrationLabel(value){
 const match=String(value??'').trim().match(/^(?:\d{2,4}[.\/-])?(\d{1,2})[.\/-](\d{1,2})$/);
 return match?Number(match[1])+'/'+Number(match[2]):String(value??'');
}
async function deleteSelected(){
 if(loading||saving)return;
 const ids=$$('.row-check:checked').map(x=>+x.dataset.check);
 if(!ids.length){alert('삭제할 업무를 선택해 주세요.');return}
 if(!confirm(ids.length+'개의 업무를 삭제하고 현재 변경사항을 서버에 저장하시겠습니까?'))return;
 const previousData=data.map(row=>[...row]),previousNewRows=new Set(newRows);
 ids.forEach(i=>{const deleted=monthMeta(data[i]);if(!deleted)return;data.forEach(row=>{const m=monthMeta(row);if(m&&m.id===deleted.id&&m.month<deleted.month){m.skipped=[...new Set([...(m.skipped||[]),deleted.month])];row[7]=MONTH_META+JSON.stringify(m)}})});
 const pending=new Set([...newRows].map(i=>data[i]));
 data=data.filter((_,i)=>!ids.includes(i));
 newRows=new Set(data.flatMap((r,i)=>pending.has(r)?[i]:[]));
 if(await saveAll()){
  deleteMode=false;$('#saveStatus').textContent='● 삭제 및 서버 저장 완료';
 }else{
  data=previousData;newRows=previousNewRows;
 }
 render();
}


function showView(){currentView='list';$('#list').hidden=false}
function selectTab(tab){
 currentTab=tab;
 $$('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
 showView();
 render();
}
function updateWorkspaceHeader(){
 const name=workspaceNames[currentWorkspace];
 document.title=name+' 업무 관리';
 $('header h1').textContent=name+' 업무 관리';$('header > i').textContent=name;
 $$('aside [data-workspace]').forEach(b=>b.classList.toggle('active',b.dataset.workspace===currentWorkspace));
}
async function switchWorkspace(key){
 if(loading||saving||!Object.hasOwn(workspaceNames,key))return;
 showWorkspacePage(key);
 if(key===currentWorkspace){updateWorkspaceHeader();selectTab('active');if(!serverConnected)await load();return}
 document.activeElement?.blur?.();
 workspaceDrafts.set(currentWorkspace,{data,newRows,edits,workers,serverConnected,status:$('#saveStatus').textContent});
 currentWorkspace=key;data=[];newRows=new Set();edits={};serverConnected=false;
 workers=[];
 const cached=workspaceDrafts.get(key);
 if(cached){({data,newRows,edits,workers,serverConnected}=cached)}
 $('#search').value='';filters();selectTab('active');
 updateWorkspaceHeader();
 if(cached&&serverConnected){$('#saveStatus').textContent=cached.status;$('#saveAll').disabled=Boolean(currentUser&&!canEdit())}
 else await load();
}
function setRoute(key){
 const hash=key?'#'+key:'';
 if(window.location.hash!==hash)window.history.pushState(null,'',window.location.pathname+window.location.search+hash);
}
function showWorkspacePage(key){
 homeVisible=false;$('#homePage').hidden=true;$('#workspacePage').hidden=false;setRoute(key);
}
function showHome(){
 if(loading||saving)return;
 document.activeElement?.blur?.();
 homeVisible=true;$('#homePage').hidden=false;$('#workspacePage').hidden=true;
 document.title='유플러스 업무 관리';setRoute('');
}
async function restoreRoute(){
 const key=window.location.hash.slice(1);
 if(loading||saving){window.history.replaceState(null,'',window.location.pathname+window.location.search+(homeVisible?'':'#'+currentWorkspace));return}
 if(Object.hasOwn(workspaceNames,key))await switchWorkspace(key);
 else showHome();
}
$$('[data-workspace]').forEach(b=>b.onclick=()=>switchWorkspace(b.dataset.workspace));
$('#goHome').onclick=showHome;
window.addEventListener('popstate',restoreRoute);
$$('[data-tab]').forEach(b=>b.onclick=()=>selectTab(b.dataset.tab));
['search','worker','status'].forEach(x=>$('#'+x).addEventListener(x==='search'?'input':'change',render));
$('#newTask').onclick=addRow;
$('#carryOver').onclick=carryOver;
$('#saveAll').onclick=saveAll;
function updateDeleteButton(){
  const count=$$('.row-check:checked').length;
  $('#deleteToggle').textContent=deleteMode?(count?'삭제 ('+count+')':'삭제 취소'):'삭제';
}
$('#deleteToggle').onclick=()=>{
  if(deleteMode&&$$('.row-check:checked').length){return deleteSelected();}
  deleteMode=!deleteMode;render();
};

$('#refresh').onclick=async()=>{
  if(loading||saving)return;
  suppressAutoSave=true;document.activeElement?.blur?.();suppressAutoSave=false;
  $('#search').value='';
  selectTab('active');
  await load();
};
$('#prevMonth').onclick=()=>changeMonth(-1);
$('#nextMonth').onclick=()=>changeMonth(1);
updateMonth();
// Keep sticky rows aligned when toolbar groups wrap or tabs change visibility.
if(typeof ResizeObserver!=='undefined'){
 const panel=$('.panel'),toolbar=$('.panel-toolbar'),tools=$('.tools');
 const updateStickyOffsets=()=>{
  panel.style.setProperty('--toolbar-height',toolbar.getBoundingClientRect().height+'px');
  panel.style.setProperty('--tools-height',tools.getBoundingClientRect().height+'px');
 };
 const stickyObserver=new ResizeObserver(updateStickyOffsets);
 stickyObserver.observe(toolbar);stickyObserver.observe(tools);updateStickyOffsets();
}


function roleName(role){return {admin:'관리자',editor:'편집자'}[role]||role}
function applyPermissions(){if(!currentUser)return;$('#logoutButton').hidden=!authToken;$$('[data-login]').forEach(el=>el.hidden=Boolean(authToken));$('#currentUser').textContent=currentUser.name+(currentUser.role?' · '+roleName(currentUser.role):'');$('#usersButton').hidden=currentUser.role!=='admin';const editable=canEdit();$('#workspacePage').classList.toggle('read-only',!editable);['newTask','carryOver','saveAll','deleteToggle'].forEach(id=>$('#'+id).disabled=!editable);render();}
function showAuthenticated(){$('#authPage').hidden=true;$('#homePage').hidden=false;}
async function publicRequest(payload){const response=await trackedFetch(window.APPS_SCRIPT_URL,{method:'POST',cache:'no-store',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(payload),signal:AbortSignal.timeout(30000)});const result=await response.json();if(!result?.ok)throw new Error(result?.error||'요청에 실패했습니다.');return result;}
const AUTH_USER_KEY='workflow-auth-user';
function storeAuthUser(user){sessionStorage.setItem(AUTH_USER_KEY,JSON.stringify(user));}
function clearAuthSession(){sessionStorage.removeItem('workflow-auth-token');sessionStorage.removeItem(AUTH_USER_KEY);authToken='';currentUser=null;}
async function validateRestoredSession(){try{const result=await requestServer({action:'session'});currentUser=result.user;storeAuthUser(currentUser);applyPermissions();}catch{clearAuthSession();location.reload();}}
const guestUser={name:'로그인 없이 조회 중'};
async function initAuth(){
 currentUser=guestUser;
 try{authToken=sessionStorage.getItem('workflow-auth-token')||'';}catch{}
 showAuthenticated();applyPermissions();
 await restoreRoute();
 if(authToken&&!serverConnected)validateRestoredSession();
}
async function openLogin(){
 $('#authPage').hidden=false;$('#homePage').hidden=true;$('#workspacePage').hidden=true;
 $('#authError').textContent='';$('#loginSubmit').disabled=true;
 try{const status=await publicRequest({action:'authStatus'});setupRequired=status.setupRequired;
 $('#authTitle').textContent=setupRequired?'초기 관리자 생성':'로그인';
 $('#authDescription').textContent=setupRequired?'첫 관리자 계정을 생성해 주세요.':'업무를 수정할 계정으로 로그인해 주세요.';
 $('#nameField').hidden=!setupRequired;$('#loginName').required=setupRequired;
 $('#loginSubmit').textContent=setupRequired?'관리자 생성':'로그인';
 }catch(error){$('#authError').textContent=error.message;}finally{$('#loginSubmit').disabled=false;}
}
$$('[data-login]').forEach(el=>el.onclick=openLogin);
$('#cancelLogin').onclick=()=>{showAuthenticated();restoreRoute();};
$("#authForm").onsubmit=async(event)=>{event.preventDefault();$("#authError").textContent="";$("#loginSubmit").disabled=true;try{if(setupRequired){await publicRequest({action:"setupAdmin",username:$("#loginUsername").value,password:$("#loginPassword").value,name:$("#loginName").value,});setupRequired=false;}const result=await publicRequest({action:"login",username:$("#loginUsername").value,password:$("#loginPassword").value,});authToken=result.token;currentUser=result.user;sessionStorage.setItem("workflow-auth-token",authToken);storeAuthUser(currentUser);showAuthenticated();applyPermissions();await restoreRoute();}catch(error){$("#authError").textContent=error.message;}finally{$("#loginSubmit").disabled=false;}};
$("#logoutButton").onclick=async()=>{try{await requestServer({action:"logout"});}catch{}clearAuthSession();location.reload();};
$('#usersButton').onclick=async()=>{try{const result=await requestServer({action:'listUsers'});$('#userList').innerHTML=result.users.map(u=>`<div class="user-row"><span><strong>${esc(u.name)}</strong><small>${esc(u.username)}</small></span><span class="role-badge">${esc(roleName(u.role))}</span></div>`).join('');$('#userError').textContent='';$('#usersDialog').showModal();}catch(error){alert(error.message);}};
$('#createUserButton').onclick=async()=>{try{await requestServer({action:'createUser',name:$('#newUserName').value,username:$('#newUsername').value,password:$('#newUserPassword').value,role:$('#newUserRole').value});$('#usersDialog').close();$('#usersButton').click();}catch(error){$('#userError').textContent=error.message;}};
$('#historyButton').onclick=async()=>{$('#historyList').textContent='수정 이력을 불러오는 중…';$('#historyDialog').showModal();try{const result=await requestServer({action:'loadAudit'});$('#historyList').innerHTML=result.entries.length?result.entries.map(e=>`<div class="history-row"><strong>${esc(e.name)} · ${esc(e.action)} · ${esc(e.task)}</strong><small>${esc(e.at)} · ${esc(roleName(e.role))} · ${esc(e.field)}</small><span class="history-change">${esc(e.before)} → ${esc(e.after)}</span></div>`).join(''):'<p>아직 수정 이력이 없습니다.</p>';}catch(error){$('#historyList').textContent=error.message;}};

if(typeof document.getElementById==='function')initAuth();else restoreRoute();
