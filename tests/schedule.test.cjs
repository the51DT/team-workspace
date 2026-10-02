// 휴가 일정 서버 로직 검증 — 별도 스프레드시트 저장 / 검증 / 권한
// Created: 2026-10-01
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {harness}=require('./apps-script-harness.cjs');

const ev=(id,over={})=>({id,ws:'cx',name:'홍길동',leave:'연차',start:'2026-10-14',end:'',...over});
const save=(app,events,user={name:'편집자'})=>app.run(`saveSchedulePayload(${JSON.stringify(events)},${JSON.stringify(user)})`);

test('schedule is stored in the separate spreadsheet, not the work-data book',()=>{
 const app=harness({scheduleId:'schedule-test-id'});
 save(app,[ev('a'),ev('b',{ws:'aldot',name:'김철수',leave:'오전 반차',end:'2026-10-16'})]);
 assert.equal(app.sheets.size,0);              // 업무 데이터 스프레드시트에는 아무것도 만들지 않음
 assert.equal(app.scheduleSheets.size,1);
 const sheet=app.scheduleSheets.get('휴가일정');
 assert.deepEqual(sheet.rows[0],['ID','구분','이름','휴가 종류','시작일','마감일','수정자','수정시각']);
 assert.equal(sheet.rows.length,3);
 const loaded=app.run('loadSchedulePayload().events');
 assert.equal(loaded.length,2);
 assert.deepEqual(JSON.parse(JSON.stringify(loaded[1])),{id:'b',ws:'aldot',name:'김철수',leave:'오전 반차',start:'2026-10-14',end:'2026-10-16'});
});

test('saving replaces the list and keeps modifier of unchanged rows',()=>{
 const app=harness({scheduleId:'schedule-test-id'});
 save(app,[ev('a'),ev('b')],{name:'첫번째'});
 save(app,[ev('a'),ev('b',{name:'변경됨'})],{name:'두번째'});
 const rows=app.scheduleSheets.get('휴가일정').rows;
 assert.equal(rows[1][6],'첫번째');   // a: 그대로 → 수정자 유지
 assert.equal(rows[2][6],'두번째');   // b: 바뀜 → 새 수정자
 save(app,[ev('b',{name:'변경됨'})],{name:'세번째'});
 assert.equal(app.run('loadSchedulePayload().events.length'),1);
 save(app,[],{name:'세번째'});
 assert.equal(app.run('loadSchedulePayload().events.length'),0);
});

test('schedule input is validated',()=>{
 const app=harness({scheduleId:'schedule-test-id'});
 assert.throws(()=>save(app,'x'),/올바르지/);
 assert.throws(()=>save(app,[ev('a',{name:''})]),/이름/);
 assert.throws(()=>save(app,[ev('a',{ws:'zzz'})]),/구분/);
 assert.throws(()=>save(app,[ev('a',{start:'내일'})]),/시작일/);
 assert.throws(()=>save(app,[ev('a',{end:'2026-10-01'})]),/마감일/);
 assert.throws(()=>save(app,[ev('a'),ev('a')]),/중복/);
 assert.equal(app.scheduleSheets.size,0);       // 검증 실패 시 시트도 만들지 않음
});

test('dates edited in the sheet are normalized on load',()=>{
 const app=harness({scheduleId:'schedule-test-id'});
 save(app,[ev('a')]);
 app.scheduleSheets.get('휴가일정').rows[1][4]='2026.10.5';
 assert.equal(app.run('loadSchedulePayload().events[0].start'),'2026-10-05');
});

test('missing spreadsheet id gives a clear error',()=>{
 const app=harness({scheduleId:''});
 assert.throws(()=>app.run('loadSchedulePayload()'),/SCHEDULE_SPREADSHEET_ID/);
});

test('schedule API needs a session and saving needs edit permission',()=>{
 const app=harness({scheduleId:'schedule-test-id'});app.run('jsonResponse=payload=>payload');
 const post=payload=>app.run('doPost({postData:{contents:'+JSON.stringify(JSON.stringify(payload))+'}})');
 for(const action of ['loadSchedule','saveSchedule'])assert.match(post({action,events:[]}).error,/로그인/);
 app.run("setupAdmin({username:'admin',password:'password1',name:'관리자'})");
 const admin=app.run("loginPayload({username:'admin',password:'password1'})");
 assert.equal(post({action:'saveSchedule',token:admin.token,events:[ev('a')]}).ok,true);
 const loaded=post({action:'loadSchedule',token:admin.token});
 assert.equal(loaded.ok,true);assert.equal(loaded.events.length,1);assert.equal(loaded.user.role,'admin');
});
