import {readFile,readdir,mkdir,rename,lstat,rmdir} from 'node:fs/promises';
import {join,dirname,relative} from 'node:path';
import {ensure,safeId,validateResult,TASKS,RETIRED_TASK_IDS} from './domain.mjs';

export function runPath(r) {
 ensure(Number.isInteger(r.repeat)&&r.repeat>0,'잘못된 반복 차수');
 ensure((TASKS.some(t=>t.id===r.taskId)||RETIRED_TASK_IDS.includes(r.taskId))&&['current','A','B'].includes(r.version),'잘못된 TASK 또는 버전');
 ensure(safeId(r.personaId)&&safeId(r.runId),'잘못된 실행 식별자');
 return `runs/${r.repeat}회차/${r.taskId}/${r.version}/${r.personaId}`;
}

// Read both the former flat layout and the grouped layout. Never follow symlinks.
export async function readRuns(root) {
 const rows=[],warnings=[],directories=new Map();
 async function visit(dir,depth) {
  let entries;try{entries=await readdir(dir,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return;throw e;}
  if(entries.some(e=>e.isFile()&&e.name==='result.json')) {
   try {
    const r=validateResult(JSON.parse(await readFile(join(dir,'result.json'),'utf8')));
    ensure(!directories.has(r.runId),`중복 runId: ${r.runId}`);
    directories.set(r.runId,dir);
    rows.push({...r,storagePath:relative(root,dir).split('\\').join('/')});
   } catch(e) {warnings.push(`${relative(root,dir)}: ${e.message}`);}
   return;
  }
  if(depth<5)for(const entry of entries)if(entry.isDirectory())await visit(join(dir,entry.name),depth+1);
 }
 await visit(join(root,'runs'),0);
 return {rows,warnings,directories};
}

export async function findRunDirectory(root,id) {
 ensure(safeId(id),'runId 오류');
 const {directories}=await readRuns(root);
 ensure(directories.has(id),'실행 기록을 찾을 수 없습니다.');
 return directories.get(id);
}

async function exists(path) {
 try {await lstat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}
}

async function moveRecord(from,to) {
 const entries=await readdir(from);
 // Check every file before moving, including when flattening into the parent.
 for(const name of entries)ensure(!await exists(join(to,name)),`대상 파일이 이미 존재합니다: ${join(to,name)}`);
 await mkdir(to,{recursive:true});
 for(const name of entries)await rename(join(from,name),join(to,name));
 // For direct → 시도-01, the original directory now contains the attempt directory.
 if(!to.startsWith(from+'/'))await rmdir(from);
}

export async function migrateRuns(root) {
 const records=await readRuns(root);
 ensure(!records.warnings.length,`기록 확인이 필요합니다: ${records.warnings.join('; ')}`);
 const groups=new Map();
 for(const r of records.rows){const key=runPath(r);const group=groups.get(key)||[];group.push(r);groups.set(key,group);}
 const moves=[];
 for(const [base,group] of groups) {
  group.sort((a,b)=>(a.executedAt||a.runId).localeCompare(b.executedAt||b.runId));
  const used=new Set(group.map(r=>relative(join(root,base),records.directories.get(r.runId))).filter(n=>/^시도-\d+$/.test(n)));
  let nextAttempt=1;
  for(const r of group) {
   const from=records.directories.get(r.runId);
   if(used.has(relative(join(root,base),from)))continue;
   while(used.has(`시도-${String(nextAttempt).padStart(2,'0')}`))nextAttempt++;
   const attempt=group.length===1&&!used.size?'':`시도-${String(nextAttempt++).padStart(2,'0')}`;
   if(attempt)used.add(attempt);
   const to=join(root,base,attempt);
   if(from!==to)moves.push({from,to,runId:r.runId});
  }
 }
 for(const move of moves)for(const name of await readdir(move.from))ensure(!await exists(join(move.to,name)),`대상 파일 충돌: ${join(move.to,name)}`);
 for(const move of moves)await moveRecord(move.from,move.to);
 return moves;
}

// Called only after an import has been staged and validated.
export async function destinationForImport(root,result) {
 // Import only touches its destination; reorganizing existing records is explicit.
 const base=join(root,runPath(result));
 if(await exists(join(base,'result.json')))await moveRecord(base,join(base,'시도-01'));
 let number=1;
 if(await exists(base)) {
  const entries=await readdir(base);
  const attempts=entries.filter(n=>/^시도-\d+$/.test(n));
  if(attempts.length){number=Math.max(...attempts.map(n=>Number(n.slice(3))))+1;return join(base,`시도-${String(number).padStart(2,'0')}`);}
 }
 return base;
}
