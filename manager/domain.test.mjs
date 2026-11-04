// 단위 테스트용 메모리 내 수치. 페르소나 원문이나 실제 실험 기록을 생성하지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregate,personaMean,validatePersonas,validateResult,safeId,csvExport,CSV_HEADER} from './domain.mjs';
const metricRow=(personaId,repeat,success,elapsedMs,version='A',status=success?'completed':'failed')=>({personaId,repeat,success,taskId:'T01',version,status,timing:{elapsedMs,modelAndToolWaitMs:null,externalWaitMs:null},behavior:{actionCount:null,unnecessaryActionCount:null},aiEvaluation:{easeScore:null}});
test('결측 시간은 0으로 대체하지 않는다',()=>{assert.deepEqual(personaMean([{personaId:'unit'}],()=>null),{value:null,personas:0,samples:0});const a=aggregate([metricRow('unit',1,false,null)]);assert.equal(a.time.value,null);assert.equal(a.successRate.value,0);});
test('실패는 유효 분모에 포함하고 오류는 제외한다',()=>{const a=aggregate([metricRow('unit',1,true,100),metricRow('unit',2,false,200),metricRow('unit',3,null,null,'A','invalid')]);assert.equal(a.valid,2);assert.equal(a.invalid,1);assert.equal(a.successRate.value,.5);assert.equal(a.time.value,100);});
test('반복 수가 달라도 페르소나별 평균을 먼저 구한다',()=>{const rows=[metricRow('one',1,true,100),metricRow('one',2,true,100),metricRow('two',1,true,400)];assert.equal(aggregate(rows).time.value,250);});
test('A/B 성공 쌍은 같은 TASK·페르소나·반복 차수만 연결한다',()=>{const a=aggregate([metricRow('one',1,true,500,'A'),metricRow('one',1,true,300,'B'),metricRow('two',1,false,100,'A'),metricRow('two',1,true,200,'B'),metricRow('one',2,true,100,'B')]);assert.equal(a.paired.value,-200);assert.equal(a.paired.samples,1);});
test('미선정 빈 배열은 허용하고 가짜 불완전 원문은 거부한다',()=>{assert.doesNotThrow(()=>validatePersonas({dataset:{},personas:[]}));assert.throws(()=>validatePersonas({dataset:{},personas:[{}]}));});
test('미실행 양식과 잘못된 결과는 가져오지 않는다',()=>{assert.throws(()=>validateResult({status:'not_started',success:null}));assert.throws(()=>validateResult(null));});
test('경로 조작을 runId로 사용하지 못한다',()=>{for(const id of ['../x','x/y','a?x','<script>',''])assert.equal(safeId(id),false);assert.equal(safeId('ut-1_a'),true);});
test('CSV는 빈 결과에서 헤더만 내보내고 결측 셀을 비운다',()=>{assert.equal(csvExport([]),CSV_HEADER+'\n');const line=csvExport([metricRow('unit',1,false,null)]).split('\n')[1];assert.match(line,/,"false",,,,,,,/);});

test('실제 양식 구조는 상태·대기 시간·점수 불일치를 거부한다',async()=>{
 const {readFile}=await import('node:fs/promises');
 const template=JSON.parse(await readFile(new URL('../templates/result.json',import.meta.url),'utf8'));
 // 구조 검증 전용 복제본. 디스크나 runs에는 쓰지 않는다.
 const r={...template,runId:'unit-only',personaId:'unit-only',taskId:'T01',version:'current',repeat:1,status:'failed',success:false,terminationReason:'gave_up'};
 assert.doesNotThrow(()=>validateResult(r));
 assert.throws(()=>validateResult({...r,success:true}));
 assert.throws(()=>validateResult({...r,timing:{...r.timing,elapsedMs:10,externalWaitMs:20}}));
 assert.throws(()=>validateResult({...r,aiEvaluation:{easeScore:6,reason:null}}));
 assert.throws(()=>validateResult({...r,timing:{...r.timing,elapsedMs:-1}}));
});

async function selectedSource() {
 const {readFile}=await import('node:fs/promises');
 return JSON.parse(await readFile(new URL('../personas.json',import.meta.url),'utf8'));
}

test('가져오기는 개별 조건 null과 experimentalConditions 전체 null을 보존한다',async()=>{
 const data=await selectedSource();
 data.personas[0].experimentalConditions={webProficiency:null,similarServiceExperience:null,priorExperienceWithTargetService:null};
 data.personas[1].experimentalConditions=null;
 const before=structuredClone(data);
 assert.doesNotThrow(()=>validatePersonas(data));
 assert.deepEqual(data,before);
});

test('선택하지 않은 27명의 null은 P01~P03 T02 대기 생성을 막지 않는다',async()=>{
 const {createQueuedRuns}=await import('./domain.mjs');
 const data=await selectedSource();
 for(const p of data.personas)if(!['P01','P02','P03'].includes(p.personaId))p.experimentalConditions=null;
 const before=structuredClone(data);
 const {queue,added}=createQueuedRuns(data,{personaIds:['P01','P02','P03'],taskIds:['T02'],version:'current',repeat:1,serviceCommit:'',referenceTime:''});
 assert.equal(added,3);
 assert.deepEqual(queue.map(r=>[r.personaId,r.taskId,r.version,r.repeat]),[['P01','T02','current',1],['P02','T02','current',1],['P03','T02','current',1]]);
 for(const r of queue){assert.match(r.promptDelivered,/연구자가 별도로 부여한 실험 조건/);assert.match(r.promptDelivered,/"webProficiency": "중간"/);}
 assert.deepEqual(data,before);
});

test('선택한 페르소나의 누락 조건은 personaId와 모든 필드명을 안내한다',async()=>{
 const {createQueuedRuns}=await import('./domain.mjs');
 const data=await selectedSource();
 data.personas.find(p=>p.personaId==='P02').experimentalConditions=null;
 assert.throws(()=>createQueuedRuns(data,{personaIds:['P01','P02','P03'],taskIds:['T02'],version:'current',repeat:1,serviceCommit:'',referenceTime:''}),error=>{
  for(const field of ['webProficiency','similarServiceExperience','priorExperienceWithTargetService'])assert.ok(error.message.includes(`P02: experimentalConditions.${field}`));
  assert.ok(!error.message.includes('P01:'));return true;
 });
});

test('승인한 30명 모두 T02 current 1차 대기를 만들 수 있다',async()=>{
 const {createQueuedRuns}=await import('./domain.mjs');
 const data=await selectedSource();
 const {queue,added}=createQueuedRuns(data,{personaIds:data.personas.map(p=>p.personaId),taskIds:['T02'],version:'current',repeat:1,serviceCommit:'',referenceTime:''});
 assert.equal(added,30);assert.equal(new Set(queue.map(r=>r.runId)).size,30);
});
