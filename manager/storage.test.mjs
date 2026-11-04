import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readRuns,migrateRuns,runPath,findRunDirectory,destinationForImport} from './storage.mjs';
import {csvExport} from './domain.mjs';

test('기존 기록을 정리해도 결과·행동·캡처 내용 및 CSV·조회 연결을 보존한다',async t=>{
 const root=await mkdtemp(join(tmpdir(),'chongchong-layout-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 // 양식의 메모리 복제본으로 임시 폴더만 검사한다. 실제 runs에는 쓰지 않는다.
 const result=JSON.parse(await readFile(new URL('../templates/result.json',import.meta.url),'utf8'));
 Object.assign(result,{runId:'unit-layout',personaId:'unit',repeat:1,taskId:'T02',version:'current',status:'failed',success:false,terminationReason:'gave_up'});
 const old=join(root,'runs',result.runId);await mkdir(old,{recursive:true});
 const contents=JSON.stringify(result,null,2);
 await writeFile(join(old,'result.json'),contents);
 await writeFile(join(old,'actions.json'),'[]\n');
 await writeFile(join(old,'capture.png'),Buffer.from([1,2,3]));
 assert.equal((await readRuns(root)).rows[0].storagePath,`runs/${result.runId}`);
 assert.equal(await findRunDirectory(root,result.runId),old);
 await symlink(old,join(root,'runs','ignored-link'));
 assert.equal((await readRuns(root)).rows.length,1);
 assert.equal((await migrateRuns(root)).length,1);
 const target=join(root,runPath(result));
 assert.equal(await readFile(join(target,'result.json'),'utf8'),contents);
 assert.equal(await readFile(join(target,'actions.json'),'utf8'),'[]\n');
 assert.deepEqual(await readFile(join(target,'capture.png')),Buffer.from([1,2,3]));
 assert.equal(await findRunDirectory(root,result.runId),target);
 const after=await readRuns(root);assert.equal(after.rows.length,1);assert.deepEqual(after.warnings,[]);
 assert.ok(csvExport(after.rows).includes(runPath(result)+'/'));
 assert.equal((await migrateRuns(root)).length,0);
});

test('저장 경로는 회차·TASK·버전·페르소나로 분리하며 경로 조작을 거부한다',()=>{
 const r={repeat:1,taskId:'T02',version:'current',personaId:'P01',runId:'unit'};
 assert.equal(runPath(r),'runs/1회차/T02/current/P01');
 assert.notEqual(runPath(r),runPath({...r,version:'A'}));
 assert.throws(()=>runPath({...r,personaId:'../escape'}));
});


test('재시도 때에만 직접 저장한 기록을 시도-01로 보존하고 시도-02를 준비한다',async t=>{
 const root=await mkdtemp(join(tmpdir(),'chongchong-retry-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const result=JSON.parse(await readFile(new URL('../templates/result.json',import.meta.url),'utf8'));
 Object.assign(result,{runId:'unit-first',personaId:'unit',repeat:1,taskId:'T02',version:'current',status:'invalid',success:null,terminationReason:'infra_error'});
 const base=join(root,runPath(result));await mkdir(base,{recursive:true});
 const text=JSON.stringify(result);await writeFile(join(base,'result.json'),text);
 await writeFile(join(base,'actions.json'),'[]');
 const retry={...result,runId:'unit-second'};
 const next=await destinationForImport(root,retry);
 assert.equal(next,join(base,'시도-02'));
 assert.equal(await readFile(join(base,'시도-01','result.json'),'utf8'),text);
 await mkdir(next);await writeFile(join(next,'result.json'),JSON.stringify(retry));
 assert.equal((await readRuns(root)).rows.length,2);
 assert.equal(await findRunDirectory(root,result.runId),join(base,'시도-01'));
 assert.equal((await migrateRuns(root)).length,0);
});
