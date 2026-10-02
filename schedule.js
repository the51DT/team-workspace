// Created: 2026-10-01 16:31
// 캘린더 · 일정 추가/수정/삭제 · 드래그앤드롭을 가져왔습니다. (TO DO LIST · 작업시간 표는 뺌, 일정 입력은 휴가용으로 단순화)
// 데이터는 Apps Script(Code.gs)를 거쳐 '별도 스프레드시트'의 '휴가일정' 시트에 저장됩니다. (브라우저에는 저장하지 않음)
// app.js 는 window.scheduleView.show() 로 화면을 열고, window.scheduleApi 로 서버를 부릅니다.
(function () {
  'use strict';
  const LEAVE_TYPES = ['연차', '오전 반차', '오후 반차', '반반차']; 
  // 키는 띄어쓰기 없이 적는다 ('오전 반차'도 '오전반차' 키로 찾음)
  const LEAVE_COLOR = { '연차': 'blue', '오전반차': 'orange', '오후반차': 'purple', '반반차': 'green' };
  const TEAMS = { ALL: '전체', cx: 'CX', enterprise: '기업', aldot: '알닷' };
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];

  const $id = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const pad = n => String(n).padStart(2, '0');
  const fmtDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayStr = () => fmtDate(new Date());
  const leaveColor = s => LEAVE_COLOR[String(s).replace(/\s+/g, '')] || 'gray'; // 띄어쓰기는 무시하고 찾음 ('오전 반차' = '오전반차')
  const optHTML = (arr, sel) => (arr || []).map(o => `<option ${o === sel ? 'selected' : ''}>${esc(o)}</option>`).join('');
  const $v = id => $id(id).value.trim();

  // ================== 저장소 (서버) ==================
  let DB = { cal: [] };
  let loaded = false;       // 서버에서 한 번 성공적으로 읽은 뒤에만 수정 가능 — 읽기 실패 상태로 저장하면 서버 데이터를 덮어쓰기 때문
  let loading = false;
  let saveChain = Promise.resolve();
  const api = () => window.scheduleApi;
  const canEdit = () => loaded && Boolean(api() && api().canEdit());
  const pick = c => ({ id: c.id, ws: c.ws, name: c.name, leave: c.leave, start: c.start, end: c.end || '' });
  function setStatus(text, error = false) {
    const el = $id('schStatus'); el.textContent = text; el.classList.toggle('error', error);
  }
  const timeText = () => new Date().toLocaleTimeString('ko-KR');
  const errorText = error => ['TimeoutError', 'AbortError'].includes(error.name) ? '서버 응답 시간이 초과되었습니다.' : error.message;

  async function loadRemote() {
    if (loading) return;
    loading = true; setStatus('● 휴가 일정을 불러오는 중…'); $id('schRefresh').disabled = true;
    try {
      const result = await saveChain.then(() => api().request({ action: 'loadSchedule' }), () => api().request({ action: 'loadSchedule' }));
      if (!Array.isArray(result.events)) throw new Error('휴가 일정 응답이 올바르지 않습니다. Code.gs 를 새 버전으로 배포했는지 확인해 주세요.');
      DB.cal = result.events; loaded = true;
      setStatus('● 불러오기 완료 · ' + timeText());
    } catch (error) {
      loaded = false; DB.cal = [];
      setStatus('● 불러오기 실패: ' + errorText(error), true);
    } finally {
      loading = false; $id('schRefresh').disabled = false; render();
    }
  }
  // 화면에는 바로 반영하고, 서버 저장은 순서대로 한 건씩 보낸다. 실패하면 서버 상태로 되돌린다.
  function save(show = true) {
    render();
    setStatus('● 저장 중…');
    const snapshot = DB.cal.map(pick);
    saveChain = saveChain.then(() => api().request({ action: 'saveSchedule', events: snapshot })).then(() => {
      setStatus('● 저장 완료 · ' + timeText());
      if (show) toast('저장됨');
    }).catch(async error => {
      setStatus('● 저장 실패: ' + errorText(error), true);
      alert('저장 실패: ' + errorText(error) + ' 서버에 저장된 내용으로 되돌립니다.');
      // 여기서 await 하면 안 된다: loadRemote 가 saveChain(지금 실행 중인 이 체인)을 기다리므로 서로 기다리는 교착이 생긴다.
      loaded = false; loadRemote();
    });
  }
  let toastT;
  function toast(msg) {
    const t = $id('schToast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 1600);
  }

  // ================== 모달 ==================
  const modal = $id('schModal'), overlay = $id('schOverlay');
  let dlg = null; // {onSave, onDelete}
  function openDialog(title, bodyHTML, onSave, onDelete, position = 'right') {
    $id('schDlgTitle').textContent = title;
    $id('schDlgBody').innerHTML = bodyHTML;
    $id('schDlgDelete').hidden = !onDelete;
    dlg = { onSave, onDelete };
    modal.classList.toggle('center', position === 'center');
    modal.classList.toggle('right', position !== 'center');
    modal.classList.add('on');
    if (position === 'center') overlay.classList.add('on');
    const first = modal.querySelector('input,textarea,select'); if (first) first.focus();
    modal.querySelectorAll('textarea.auto-height').forEach(ta => {
      const adjust = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
      adjust(); ta.addEventListener('input', adjust);
    });
  }
  function closeDialog(shouldSave = true) {
    if (shouldSave && dlg && dlg.onSave && dlg.onSave() === false) return;
    modal.classList.remove('on'); overlay.classList.remove('on'); dlg = null;
  }
  $id('schDlgCancel').onclick = () => closeDialog(false);
  $id('schDlgSave').onclick = () => closeDialog(true);
  $id('schDlgDelete').onclick = () => { if (dlg && dlg.onDelete && confirm('삭제할까요?')) { dlg.onDelete(); closeDialog(false); } };
  modal.addEventListener('click', e => { if (e.target === modal) closeDialog(true); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && modal.classList.contains('on')) closeDialog(true); });

  // ================== 대한민국 공휴일 (API 없이 계산) ==================
  // 양력 고정 공휴일 + 음력(설날·추석·부처님오신날)은 브라우저 내장 한국식 음력(Intl 'dangi')으로 계산하고,
  // 대체공휴일은 현행 규칙(설·추석은 일요일/겹침, 삼일절·어린이날·광복절·개천절·한글날·부처님오신날·성탄절은 토·일/겹침)으로 계산합니다.
  // 임시공휴일은 계산할 수 없어 아래 TEMP_HOLIDAYS 에 직접 추가합니다. (제헌절은 공휴일이 아니라 넣지 않음)
  const TEMP_HOLIDAYS = { '2026-06-03': '전국동시지방선거' };
  const lunarFmt=new Intl.DateTimeFormat('ko-KR-u-ca-dangi',{month:'numeric',day:'numeric'});
  function lunarOf(d){let m,day;for(const p of lunarFmt.formatToParts(d)){if(p.type==='month')m=p.value;if(p.type==='day')day=p.value}return /^\d+$/.test(m)?[+m,+day]:null} // 윤달은 null
  function holidaysOf(year){
    const map=new Map(),add=(d,n)=>{const k=typeof d==='string'?d:fmtDate(d);map.set(k,map.has(k)?map.get(k)+'·'+n:n)};
    const groups=[]; // 대체공휴일 판정 단위 {days:[], seol:bool}
    const fixed=[['01-01','신정',false],['03-01','삼일절',true],['05-05','어린이날',true],['06-06','현충일',false],['08-15','광복절',true],['10-03','개천절',true],['10-09','한글날',true],['12-25','성탄절',true]];
    fixed.forEach(([md,n,sub])=>{add(`${year}-${md}`,n);if(sub)groups.push({days:[`${year}-${md}`],multi:false})});
    for(let i=0;i<366;i++){
      const d=new Date(year,0,1+i,12);if(d.getFullYear()!==year)break;
      const l=lunarOf(d);if(!l)continue;const [m,dd]=l,prev=new Date(year,0,i,12),next=new Date(year,0,2+i,12);
      if(m===1&&dd===1){add(prev,'설날 연휴');add(d,'설날');add(next,'설날 연휴');groups.push({days:[fmtDate(prev),fmtDate(d),fmtDate(next)],multi:true})}
      if(m===8&&dd===15){add(prev,'추석 연휴');add(d,'추석');add(next,'추석 연휴');groups.push({days:[fmtDate(prev),fmtDate(d),fmtDate(next)],multi:true})}
      if(m===4&&dd===8){add(d,'부처님오신날');groups.push({days:[fmtDate(d)],multi:false})}
    }
    Object.entries(TEMP_HOLIDAYS).forEach(([k, n]) => { if (k.startsWith(year + '-')) add(k, n); });
    const handled=new Set();
    groups.sort((a,b)=>a.days[0].localeCompare(b.days[0]));
    for(const g of groups){
      const dows=g.days.map(k=>new Date(k+'T12:00:00').getDay());
      const overlapDays=g.days.filter(k=>(map.get(k)||'').includes('·'));
      const weekend=g.multi?dows.includes(0):dows.some(w=>w===0||w===6);
      const newOverlap=overlapDays.some(k=>!handled.has(k));
      overlapDays.forEach(k=>handled.add(k));
      if(!weekend&&!newOverlap)continue;
      const d=new Date(g.days[g.days.length-1]+'T12:00:00');
      do d.setDate(d.getDate()+1);while(d.getDay()===0||d.getDay()===6||map.has(fmtDate(d)));
      add(d,'대체공휴일');
    }
    return map;
  }
  const holidayCache = new Map();
  function holidayName(ds) {
    const y = Number(ds.slice(0, 4));
    if (!holidayCache.has(y)) holidayCache.set(y, holidaysOf(y));
    return holidayCache.get(y).get(ds) || '';
  }
  window.koreanHolidayName = holidayName;

  // ================== 캘린더 & 리스트 ==================
  let calYM = todayStr().slice(0, 7);
  let calTab = 'all'; // cx | enterprise | aldot | all

  function calFilter(list) {
    return list.filter(c => calTab === 'all' || c.ws === 'ALL' || c.ws === calTab); // 구분 '전체'는 모든 탭에 보인다
  }
  function inRange(c, d) { if (!c.start) return false; const e = c.end || c.start; return c.start <= d && d <= e; }

  function renderCal() {
    const [y, m] = calYM.split('-').map(Number);
    $id('schTitle').textContent = `${y}.${pad(m)}`;
    const startDow = new Date(y, m - 1, 1).getDay();
    const daysInMonth = new Date(y, m, 0).getDate();
    const t = todayStr();
    const items = calFilter(DB.cal);
    let html = DOW.map(d => `<div class="sch-dh">${d}</div>`).join('');
    const total = Math.ceil((startDow + daysInMonth) / 7) * 7;
    for (let i = 0; i < total; i++) {
      const dayNum = i - startDow + 1;
      const d = new Date(y, m - 1, dayNum);
      const ds = fmtDate(d);
      const other = dayNum < 1 || dayNum > daysInMonth;
      const evs = items.filter(c => inRange(c, ds)).sort((a, b) => (a.leave || '~').localeCompare(b.leave || '~'));
      const hol = holidayName(ds);
      html += `<div class="sch-cell ${other ? 'other' : ''} ${ds === t ? 'today' : ''} ${d.getDay() === 0 ? 'sun' : d.getDay() === 6 ? 'sat' : ''} ${hol ? 'holiday' : ''}" data-date="${ds}">
        <span class="sch-dn">${d.getDate()}</span>${hol ? `<span class="sch-hol" title="${esc(hol)}">${esc(hol)}</span>` : ''}
        ${evs.map(c => `<span class="sch-ev ${c.done ? 'done' : ''} ${c.leave ? 'c-' + leaveColor(c.leave) : 'off'}" data-id="${esc(c.id)}" draggable="true" title="${esc(c.name)}${c.leave ? ' · ' + esc(c.leave) : ''}">${esc(c.name)}${c.leave ? ' <b>' + esc(c.leave) + '</b>' : ''}</span>`).join('')}
      </div>`;
    }
    $id('schGrid').innerHTML = html;
  }

  function calDialog(c, presetDate, position) {
    if (!canEdit()) { toast(loaded ? '수정 권한이 없습니다' : '일정을 불러온 뒤 수정할 수 있습니다'); return; }
    const isNew = !c;
    c = c || { name: '', ws: calTab === 'all' ? 'ALL' : calTab, leave: '연차', start: presetDate || '', end: '' };
    openDialog(isNew ? '휴가 일정 추가' : '휴가 일정 수정', `
      <div class="f"><label for="schF_ws">구분</label><select id="schF_ws">${Object.entries(TEAMS).map(([k, v]) => `<option value="${k}" ${k === c.ws ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="f"><label for="schF_name">이름</label><input type="text" id="schF_name" value="${esc(c.name)}" placeholder="이름"></div>
      <div class="f"><label for="schF_leave">휴가 일정</label><select id="schF_leave">${optHTML(LEAVE_TYPES, c.leave)}</select></div>
      <div class="fs"><div class="f"><label for="schF_start">휴가 시작일</label><input type="date" id="schF_start" value="${esc(c.start || '')}"></div>
      <div class="f"><label for="schF_end">휴가 마감일 (선택)</label><input type="date" id="schF_end" value="${esc(c.end || '')}"></div></div>`,
      () => {
        const name = $v('schF_name'); if (!name) { alert('이름을 입력하세요'); return false; }
        const start = $v('schF_start'); if (!start) { alert('휴가 시작일을 선택하세요'); return false; }
        const end = $v('schF_end'); if (end && end < start) { alert('마감일은 시작일보다 빠를 수 없습니다'); return false; }
        const obj = { id: c.id || uid(), name, ws: $v('schF_ws'), leave: $v('schF_leave'), start, end: end === start ? '' : end };
        if (isNew) DB.cal.push(obj); else { const old = DB.cal.find(x => x.id === c.id); for (const k of Object.keys(old)) delete old[k]; Object.assign(old, obj); }
        calYM = start.slice(0, 7);
        save();
      },
      isNew ? null : () => { DB.cal = DB.cal.filter(x => x.id !== c.id); save(); }, position);
  }

  function shiftMonth(n) {
    const [y, m] = calYM.split('-').map(Number); const d = new Date(y, m - 1 + n, 1);
    calYM = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; renderCal();
  }
  $id('schPrev').onclick = () => shiftMonth(-1);
  $id('schNext').onclick = () => shiftMonth(1);
  $id('schToday').onclick = () => { calYM = todayStr().slice(0, 7); renderCal(); };
  $id('schTabs').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    calTab = b.dataset.v; [...e.currentTarget.children].forEach(x => x.classList.toggle('on', x === b)); renderCal();
  });
  $id('schGrid').addEventListener('click', e => {
    const ev = e.target.closest('.sch-ev');
    if (ev) { calDialog(DB.cal.find(x => x.id === ev.dataset.id), null, 'center'); return; }
    const cell = e.target.closest('.sch-cell'); if (cell) calDialog(null, cell.dataset.date, 'center');
  });

  // 캘린더 그리드: 드래그앤드롭으로 날짜 변경
  const gridEl = $id('schGrid');
  let calDragId = null;
  gridEl.addEventListener('dragstart', e => {
    const ev = e.target.closest('.sch-ev'); if (!ev) return;
    if (!canEdit()) { e.preventDefault(); return; }
    calDragId = ev.dataset.id; ev.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', calDragId);
  });
  gridEl.addEventListener('dragend', e => {
    const ev = e.target.closest('.sch-ev'); if (ev) ev.classList.remove('dragging');
    gridEl.querySelectorAll('.sch-cell.over').forEach(x => x.classList.remove('over')); calDragId = null;
  });
  gridEl.addEventListener('dragover', e => {
    if (!calDragId) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    const cell = e.target.closest('.sch-cell'); if (!cell) return;
    gridEl.querySelectorAll('.sch-cell.over').forEach(x => { if (x !== cell) x.classList.remove('over'); });
    cell.classList.add('over');
  });
  gridEl.addEventListener('dragleave', e => {
    if (!calDragId) return;
    const cell = e.target.closest('.sch-cell');
    if (cell && !cell.contains(e.relatedTarget)) cell.classList.remove('over');
  });
  gridEl.addEventListener('drop', e => {
    const cell = e.target.closest('.sch-cell'); if (!cell || !calDragId) return; e.preventDefault();
    const c = DB.cal.find(x => x.id === calDragId); if (!c) return;
    const newDate = cell.dataset.date;
    if (c.start && c.end) {
      const days = Math.floor((new Date(c.end) - new Date(c.start)) / 86400000);
      if (days > 0) { const endDate = new Date(newDate); endDate.setDate(endDate.getDate() + days); c.end = fmtDate(endDate); }
    }
    c.start = newDate; calYM = newDate.slice(0, 7);
    save(); toast(`"${c.name.slice(0, 20)}" → ${newDate}`);
  });

  $id('schRefresh').onclick = () => loadRemote();
  function render() { $id('schGrid').closest('.sch-wrap').classList.toggle('readonly', !canEdit()); renderCal(); }
  // 화면을 열 때마다 서버에서 최신 일정을 다시 읽는다.
  window.scheduleView = { render, show() { render(); loadRemote(); } };
})();
