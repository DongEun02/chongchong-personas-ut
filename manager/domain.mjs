export const TASKS = [
  {id:'T01',title:'마감 임박 과제 찾기',role:'멤버',tag:'정보 발견',limit:'8분 · 60행동',goal:'기준 시각은 {referenceTime}, 시간대는 Asia/Seoul입니다. 기준 시각부터 72시간 이내에 마감되는, 내가 해야 하는 미제출 과제를 모두 찾아 제목과 마감 시각을 알려주세요. 과제를 제출하거나 수정할 필요는 없습니다.'},
  {id:'T02',title:'내 스터디 목록으로 이동',role:'멤버',tag:'탐색 경로',limit:'5분 · 40행동',goal:'현재 보고 있는 스터디에서 나와, 내가 가입한 스터디들을 한 번에 볼 수 있는 화면으로 이동해주세요.'},
  {id:'T04',title:'기존 과제에 신규 멤버 포함',role:'운영자',tag:'멤버 관리',limit:'능동 15분 · 100행동',goal:'과제를 하나 만든 다음 새 멤버에게 초대 링크를 전달해주세요. 그 멤버가 가입하면, 방금 만든 기존 과제의 대상자에 포함해주세요. 기존 과제는 유지해주세요.'}
];
// Retained only for reading historical records; excluded from new queues/imports.
export const RETIRED_TASK_IDS = ['T03'];
export function ensure(ok, message) { if (!ok) throw new Error(message); }
export function safeId(id) { return typeof id==='string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(id); }
export const CONDITION_FIELDS = ['webProficiency','similarServiceExperience','priorExperienceWithTargetService'];
export function validateSelectedPersonas(data, personaIds) {
  const selected = [...new Set(personaIds)].map(id => {
    const persona = data.personas.find(p => p.personaId === id);
    ensure(persona, `${id}: 페르소나를 찾을 수 없습니다.`);
    return persona;
  });
  const missing = selected.flatMap(p => CONDITION_FIELDS.filter(k => typeof p.experimentalConditions?.[k] !== 'string' || !p.experimentalConditions[k].trim()).map(k => `${p.personaId}: experimentalConditions.${k}`));
  ensure(!missing.length, `실행 조건이 누락되었습니다: ${missing.join(', ')}`);
  return selected;
}
export function validatePersonas(data) {
  ensure(data && data.dataset && Array.isArray(data.personas),'dataset과 personas 배열이 필요합니다.');
  const ids=new Set(), uuids=new Set();
  for(const p of data.personas) {
    ensure(safeId(p.personaId) && !ids.has(p.personaId),'personaId는 중복 없는 영문·숫자·하이픈·밑줄이어야 합니다.'); ids.add(p.personaId);
    ensure(p.source,`${p.personaId}: source가 필요합니다.`);
    ensure(p.experimentalConditions == null || (typeof p.experimentalConditions === 'object' && !Array.isArray(p.experimentalConditions)),`${p.personaId}: experimentalConditions는 객체 또는 null이어야 합니다.`);
    for(const k of ['uuid','occupation','persona','professional_persona','skills_and_expertise','hobbies_and_interests']) ensure(typeof p.source[k]==='string' && p.source[k].trim(),`source.${k}가 필요합니다.`);
    ensure(Number.isInteger(p.source.age),'source.age는 원본 정수여야 합니다.');
    ensure(!uuids.has(p.source.uuid),'중복 UUID입니다.'); uuids.add(p.source.uuid);
    for(const k of CONDITION_FIELDS) {
      const value = p.experimentalConditions?.[k];
      ensure(value == null || (typeof value === 'string' && value.trim()),`${p.personaId}: experimentalConditions.${k}는 null 또는 비어 있지 않은 문자열이어야 합니다.`);
    }
  }
  if(data.personas.length) {
    ensure(data.dataset.revision === null || (typeof data.dataset.revision === 'string' && data.dataset.revision.trim()),'dataset.revision은 미확정 null 또는 비어 있지 않은 문자열이어야 합니다.');
    ensure(typeof data.dataset.selectedAt==='string' && Number.isFinite(Date.parse(data.dataset.selectedAt)),'dataset.selectedAt에 실제 선정 시각을 기록해주세요.');
  }
  return data;
}
export function validateResult(r) {
  for(const key of ['schemaVersion','runId','personaId','taskId','version','repeat','serviceCommit','executedAt','model','promptDelivered','status','success','terminationReason','failureCategory','timing','behavior','aiEvaluation','verification','taskSpecific','notes']) ensure(r && Object.hasOwn(r,key),`${key} 필드가 필요합니다.`);
  ensure(r && safeId(r.runId) && safeId(r.personaId),'유효한 runId와 personaId가 필요합니다.');
  ensure((TASKS.some(t=>t.id===r.taskId)||RETIRED_TASK_IDS.includes(r.taskId)) && ['current','A','B'].includes(r.version),'TASK 또는 버전이 올바르지 않습니다.');
  ensure(Number.isInteger(r.repeat) && r.repeat>0,'repeat는 1 이상의 정수여야 합니다.');
  ensure(['completed','failed','invalid'].includes(r.status),'실제로 종료된 실행만 가져올 수 있습니다.');
  ensure(r.success===(r.status==='completed'?true:r.status==='failed'?false:null),'status와 success가 일치하지 않습니다.');
  ensure(['goal_met','gave_up','time_limit','action_limit','infra_error'].includes(r.terminationReason),'종료 사유가 필요합니다.');
  if(r.status==='completed') ensure(r.terminationReason==='goal_met','성공은 goal_met이어야 합니다.');
  if(r.status==='invalid') ensure(r.terminationReason==='infra_error','실험 오류는 infra_error이어야 합니다.');
  if(r.status==='failed') ensure(r.terminationReason!=='infra_error','인프라 오류는 invalid로 기록해주세요.');
  for(const group of ['timing','behavior','aiEvaluation','verification']) ensure(r[group] && typeof r[group]==='object',`${group} 객체가 필요합니다.`);
  for(const [group,keys] of Object.entries({timing:['elapsedMs','modelAndToolWaitMs','externalWaitMs'],behavior:['actionCount','unnecessaryActionCount'],aiEvaluation:['easeScore']})) for(const key of keys) {
    const n=r[group][key]; ensure(n===null || (typeof n==='number' && Number.isFinite(n) && n>=0),`${group}.${key}는 null 또는 음수가 아닌 수여야 합니다.`);
    if(n!==null && group!=='timing') ensure(Number.isInteger(n),`${key}는 정수여야 합니다.`);
  }
  ensure(r.aiEvaluation.easeScore===null || (r.aiEvaluation.easeScore>=1 && r.aiEvaluation.easeScore<=5),'용이성 점수는 1~5 또는 null입니다.');
  if(r.behavior.actionCount!==null && r.behavior.unnecessaryActionCount!==null) ensure(r.behavior.unnecessaryActionCount<=r.behavior.actionCount,'불필요 행동 수가 전체 행동 수보다 큽니다.');
  ensure(Array.isArray(r.verification.evidenceFiles),'evidenceFiles 배열이 필요합니다.');
  ensure(Array.isArray(r.notes) && r.taskSpecific && typeof r.taskSpecific==='object' && !Array.isArray(r.taskSpecific),'notes 배열과 taskSpecific 객체가 필요합니다.');
  for(const key of ['startedAt','endedAt']) ensure(r.timing[key]===null || (typeof r.timing[key]==='string' && /([+-]\d{2}:\d{2}|Z)$/.test(r.timing[key]) && Number.isFinite(Date.parse(r.timing[key]))),`${key}는 null 또는 오프셋 포함 시각이어야 합니다.`);
  if(r.timing.startedAt && r.timing.endedAt) ensure(Date.parse(r.timing.endedAt)>=Date.parse(r.timing.startedAt),'종료 시각이 시작 시각보다 빠릅니다.');
  for(const key of ['method','observedState','verifiedBy'])ensure(Object.hasOwn(r.verification,key),`verification.${key}가 필요합니다.`);
  ensure(Object.hasOwn(r.aiEvaluation,'reason'),'aiEvaluation.reason이 필요합니다.');
  if(r.timing.elapsedMs!==null)ensure((r.timing.modelAndToolWaitMs??0)+(r.timing.externalWaitMs??0)<=r.timing.elapsedMs,'분리한 대기 시간의 합이 총 경과 시간보다 큽니다.');
  ensure(r.schemaVersion==='1.0','지원하는 schemaVersion은 1.0입니다.');
  return r;
}
export function makePrompt(persona,task,referenceTime) {
  return `이것은 실제 사용자 UT가 아닌 AI 모의 UT입니다.\n새 대화와 분리된 브라우저 세션에서 준비된 시작 화면을 확인한 뒤 진행하세요. 이전 실행의 경로·결과를 사용하지 마세요. 준비가 안 되었으면 실행하지 말고 부족한 항목을 알려주세요.\n\n페르소나 원문:\n${JSON.stringify(persona.source,null,2)}\n\n연구자가 별도로 부여한 실험 조건:\n${JSON.stringify(persona.experimentalConditions,null,2)}\n\n역할: ${task.role}\n목표: ${task.goal.replace('{referenceTime}',referenceTime||'미확정')}\n제한(파일럿 제안, 실행 전 확정 필요): ${task.limit}\n\n허용 조작: 클릭, 입력, 스크롤, 링크 열기, 뒤로가기 등 정상 브라우저 조작. 관찰 가능한 행동과 화면 근거만 기록하고 내부 사고 과정은 기록하지 마세요. 비밀번호·쿠키·토큰·초대 링크 원문은 결과에 저장하지 마세요. 시간은 인간의 사용 시간이 아닌 AI 경과 시간입니다. 성공 여부는 종료 후 검증자가 독립적으로 확인합니다.\n종료 후 질문: 이번 목표를 수행하는 과정은 얼마나 쉬웠나요? 1점 매우 어려움 ~ 5점 매우 쉬움. 실제 화면이나 행동을 근거로 짧게 설명해주세요.`;
}
export const CSV_HEADER='run_id,persona_id,task_id,version,repeat,status,success,elapsed_sec,model_tool_wait_sec,external_wait_sec,action_count,unnecessary_action_count,ai_ease_score,failure_category,evidence_path';
export function csvExport(results) {
 const cell=v=>v==null?'':`"${String(v).replaceAll('"','""')}"`;
 const sec=v=>v==null?null:v/1000;
 return CSV_HEADER+'\n'+results.map(r=>[r.runId,r.personaId,r.taskId,r.version,r.repeat,r.status,r.success,sec(r.timing.elapsedMs),sec(r.timing.modelAndToolWaitMs),sec(r.timing.externalWaitMs),r.behavior.actionCount,r.behavior.unnecessaryActionCount,r.aiEvaluation.easeScore,r.failureCategory,`${r.storagePath||`runs/${r.repeat}회차/${r.taskId}/${r.version}/${r.personaId}`}/`].map(cell).join(',')).join('\n');
}
// Average within each persona before averaging between personas. Null is never zero.
export function personaMean(rows,value) {
 const groups=new Map(); for(const r of rows) { const n=value(r); if(n==null)continue; const a=groups.get(r.personaId)||[];a.push(n);groups.set(r.personaId,a); }
 const means=[...groups.values()].map(a=>a.reduce((s,n)=>s+n,0)/a.length);
 return {value:means.length?means.reduce((s,n)=>s+n,0)/means.length:null,personas:means.length,samples:[...groups.values()].reduce((s,a)=>s+a.length,0)};
}
export function aggregate(rows) {
 const valid=rows.filter(r=>['completed','failed'].includes(r.status)), success=valid.filter(r=>r.success);
 const paired=[];
 for(const b of success.filter(r=>r.version==='B')) {const a=success.find(r=>r.version==='A'&&r.personaId===b.personaId&&r.taskId===b.taskId&&r.repeat===b.repeat);if(a && a.timing.elapsedMs!==null && b.timing.elapsedMs!==null)paired.push({...b,delta:b.timing.elapsedMs-a.timing.elapsedMs});}
 return {attempts:rows.length,valid:valid.length,invalid:rows.filter(r=>r.status==='invalid').length,success:success.length,successRate:personaMean(valid,r=>r.success?1:0),time:personaMean(success,r=>r.timing.elapsedMs),actions:personaMean(valid,r=>r.behavior.actionCount),unnecessary:personaMean(valid,r=>r.behavior.unnecessaryActionCount),ease:personaMean(valid,r=>r.aiEvaluation.easeScore),paired:personaMean(paired,r=>r.delta)};
}

export function createQueuedRuns(source, data, previousQueue = [], existing = []) {
  validatePersonas(source);
  ensure(Array.isArray(data.personaIds)&&data.personaIds.length&&Array.isArray(data.taskIds)&&data.taskIds.length,'페르소나와 TASK를 선택해주세요.');
  ensure(data.taskIds.every(id=>TASKS.some(t=>t.id===id)),'실험 대상 TASK는 T01, T02, T04입니다. T03은 제외되었습니다.');
  ensure(['current','A','B'].includes(data.version),'버전 오류');
  ensure(Number.isInteger(data.repeat)&&data.repeat>=1&&data.repeat<=10,'반복 차수는 1~10입니다.');
  ensure(typeof data.serviceCommit==='string'&&data.serviceCommit.length<=100,'커밋 입력 오류');
  if(data.taskIds.includes('T01'))ensure(typeof data.referenceTime==='string'&&/([+-]\d{2}:\d{2}|Z)$/.test(data.referenceTime)&&Number.isFinite(Date.parse(data.referenceTime)),'T01의 오프셋 포함 기준 시각을 입력해주세요.');
  validateSelectedPersonas(source,data.personaIds);
  const q=[...previousQueue];
  let added=0;
  for(const pid of new Set(data.personaIds))for(const tid of new Set(data.taskIds)){
   const p=source.personas.find(p=>p.personaId===pid),t=TASKS.find(t=>t.id===tid);ensure(p&&t,'존재하지 않는 페르소나 또는 TASK입니다.');
   ensure(![...q.filter(x=>!existing.some(r=>r.runId===x.runId&&r.status==='invalid')),...existing.filter(r=>r.status!=='invalid')].some(r=>r.personaId===pid&&r.taskId===tid&&r.version===data.version&&r.repeat===data.repeat),'동일 조건이 이미 있습니다. 기존 대기를 확인해주세요. 유효한 반복은 다음 차수를 사용하고 실험 오류 재실행은 동일 차수로 생성할 수 있습니다.');
   const runId=`ut-${Date.now()}-${globalThis.crypto.randomUUID().slice(0,8)}`;
   q.push({runId,personaId:pid,taskId:tid,version:data.version,repeat:data.repeat,serviceCommit:data.serviceCommit||null,referenceTime:data.referenceTime||null,createdAt:new Date().toISOString(),promptDelivered:makePrompt(p,t,data.referenceTime)});added++;
  }
  return {queue:q, added};
}
