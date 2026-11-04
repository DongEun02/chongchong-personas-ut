import http from 'node:http';
import {readFile,writeFile,mkdir,readdir,rename,rm} from 'node:fs/promises';
import {resolve,join,dirname,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {readRuns,destinationForImport,findRunDirectory} from './storage.mjs';
import {TASKS,ensure,safeId,validatePersonas,createQueuedRuns,validateResult,csvExport} from './domain.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const publicDir=join(root,'manager/public'), stateDir=join(root,'.ai-ut');
const port=Number(process.env.PORT||4310), host='127.0.0.1';
const jsonFile=async path=>JSON.parse(await readFile(path,'utf8'));
async function queue(){try{return await jsonFile(join(stateDir,'queue.json'));}catch(e){if(e.code==='ENOENT')return [];throw e;}}
async function saveQueue(q){await mkdir(stateDir,{recursive:true});const temp=join(stateDir,`queue-${randomUUID()}.tmp`);await writeFile(temp,JSON.stringify(q,null,2)+'\n');await rename(temp,join(stateDir,'queue.json'));}
async function results(){return readRuns(root);}
function send(res,status,data,type='application/json; charset=utf-8'){res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",'Referrer-Policy':'no-referrer'});res.end(type.startsWith('application/json')?JSON.stringify(data):data);}
async function body(req){let size=0,chunks=[];for await(const c of req){size+=c.length;ensure(size<=24*1024*1024,'요청은 24MB 이하여야 합니다.');chunks.push(c);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
let mutation=Promise.resolve();
async function handle(req,res){try{
 // Only this exact local origin may read/write through the browser; reject DNS rebinding.
 ensure(req.headers.host===`${host}:${port}` || req.headers.host===`localhost:${port}`,'허용하지 않은 호스트입니다.');
 const origin=req.headers.origin;if(origin)ensure([`http://${host}:${port}`,`http://localhost:${port}`].includes(origin),'다른 사이트의 요청은 허용하지 않습니다.');
 const url=new URL(req.url,`http://${host}:${port}`), path=url.pathname;
 if(req.method==='GET'){
  if(path==='/api/actions'){const id=url.searchParams.get('runId');ensure(safeId(id),'runId 오류');return send(res,200,await jsonFile(join(await findRunDirectory(root,id),'actions.json')));}
  if(path==='/api/template')return send(res,200,await jsonFile(join(root,'templates/result.json')));
  if(path==='/api/state'){const r=await results();return send(res,200,{personas:await jsonFile(join(root,'personas.json')),tasks:TASKS,queue:(await queue()).filter(q=>TASKS.some(t=>t.id===q.taskId)),results:r.rows,warnings:r.warnings});}
  if(path==='/api/summary.csv'){const {rows}=await results();return send(res,200,csvExport(rows),'text/csv; charset=utf-8');}
  if(path==='/api/docs'){ensure(['README.md','tasks.md'].includes(url.searchParams.get('file')),'문서 경로 오류');return send(res,200,await readFile(join(root,url.searchParams.get('file')),'utf8'),'text/plain; charset=utf-8');}
  if(path==='/domain.mjs')return send(res,200,await readFile(join(root,'manager/domain.mjs')),'text/javascript; charset=utf-8');
  if(path.startsWith('/evidence/')){
   const parts=decodeURIComponent(path).split('/').slice(2);ensure(parts.length===2&&safeId(parts[0])&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,120}\.(png|jpg|jpeg|webp)$/i.test(parts[1]),'캡처 경로 오류');
   const bytes=await readFile(join(await findRunDirectory(root,parts[0]),parts[1]));return send(res,200,bytes,{'png':'image/png','jpg':'image/jpeg','jpeg':'image/jpeg','webp':'image/webp'}[extname(parts[1]).slice(1).toLowerCase()]);
  }
  const assets={'/':'index.html','/app.js':'app.js','/styles.css':'styles.css'};
  if(assets[path])return send(res,200,await readFile(join(publicDir,assets[path])),path.endsWith('.js')?'text/javascript; charset=utf-8':path.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');
  return send(res,404,{error:'파일을 찾을 수 없습니다.'});
 }
 ensure(req.method==='POST','지원하지 않는 요청입니다.');
 ensure(req.headers['content-type']?.startsWith('application/json'),'JSON 요청이 필요합니다.');
 const data=await body(req);
 if(path==='/api/personas'){
  validatePersonas(data);await mkdir(stateDir,{recursive:true});
  // Keep a local backup before replacing the user's source file.
  await writeFile(join(stateDir,`personas-backup-${Date.now()}.json`),await readFile(join(root,'personas.json')));
  await writeFile(join(root,'personas.json'),JSON.stringify(data,null,2)+'\n');return send(res,200,{ok:true});
 }
 if(path==='/api/queue'){
  const {queue:q,added}=createQueuedRuns(await jsonFile(join(root,'personas.json')),data,await queue(),(await results()).rows);
  await saveQueue(q);return send(res,200,{added});
 }
 if(path==='/api/queue/remove'){
  ensure(safeId(data.runId),'runId 오류');ensure(!(await results()).rows.some(r=>r.runId===data.runId),'기록된 결과는 대기 목록에서 삭제하지 않습니다.');await saveQueue((await queue()).filter(r=>r.runId!==data.runId));return send(res,200,{ok:true});
 }
 if(path==='/api/import'){
  const r=validateResult(data.result);
  ensure(TASKS.some(t=>t.id===r.taskId),'실험 대상에서 제외된 TASK의 결과는 새로 가져올 수 없습니다.');
  ensure(!(await results()).rows.some(x=>x.status!=='invalid' && r.status!=='invalid' && ['personaId','taskId','version','repeat'].every(k=>x[k]===r[k])),'동일 조건의 유효 결과가 이미 있습니다. 반복 차수 또는 원본을 확인해주세요.');
  const q=await queue();const planned=q.find(x=>x.runId===r.runId);
  if(planned)for(const key of ['personaId','taskId','version','repeat'])ensure(planned[key]===r[key],`대기 목록과 ${key}가 다릅니다.`);
  ensure(data.actions && data.actions.runId===r.runId && Array.isArray(data.actions.actions),'동일 runId의 actions.json이 필요합니다.');
  for(const [index,a] of data.actions.actions.entries()){
   ensure(a && a.step===index+1 && typeof a.timestamp==='string' && Number.isFinite(Date.parse(a.timestamp)),'행동 step은 1부터 연속이며 유효한 timestamp가 필요합니다.');
   ensure(a.elapsedFromStartMs===null || (Number.isFinite(a.elapsedFromStartMs)&&a.elapsedFromStartMs>=0),'행동 경과 시간 오류');
   ensure(a.action && ['type','target','inputRedacted'].every(k=>Object.hasOwn(a.action,k)) && ['pageBefore','observationAfter','screenshot','review'].every(k=>Object.hasOwn(a,k)),'행동 기록의 필수 필드가 빠졌습니다.');
   ensure(a.review && [null,true,false].includes(a.review.isUnnecessary) && ['category','reason','reviewedBy'].every(k=>Object.hasOwn(a.review,k)),'review 판정 필드가 필요합니다.');
  }
  if(r.behavior.unnecessaryActionCount!==null)ensure(data.actions.actions.every(a=>a.review.isUnnecessary!==null) && r.behavior.unnecessaryActionCount===data.actions.actions.filter(a=>a.review.isUnnecessary).length,'불필요 행동 수는 전체 검토 후 true 수와 같아야 합니다.');
  ensure(Array.isArray(data.captures)&&data.captures.length<=30,'캡처는 최대 30개입니다.');
  const names=new Set();const captures=data.captures.map(c=>{
   ensure(typeof c.name==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,120}\.(png|jpg|jpeg|webp)$/i.test(c.name)&&!names.has(c.name),'캡처 파일명은 중복 없는 영문·숫자 이름이어야 합니다.');names.add(c.name);
   ensure(typeof c.base64==='string'&&/^[A-Za-z0-9+/]*={0,2}$/.test(c.base64),'이미지 인코딩 오류');const bytes=Buffer.from(c.base64,'base64');
   const ext=extname(c.name).toLowerCase();const valid=ext==='.png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):['.jpg','.jpeg'].includes(ext)?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
   ensure(valid&&bytes.length<=5*1024*1024,'올바른 PNG/JPEG/WebP 이미지(개당 5MB 이하)가 필요합니다.');return {...c,bytes};
  });
  for(const file of r.verification.evidenceFiles)ensure(names.has(file),'evidenceFiles는 함께 선택한 캡처의 파일명이어야 합니다.');
  ensure(r.behavior.actionCount===null||r.behavior.actionCount===data.actions.actions.length,'actionCount와 actions 길이가 다릅니다.');
  ensure(!(await results()).directories.has(r.runId),'이미 기록된 runId입니다. 기존 결과를 덮어쓰지 않습니다.');
  const stage=join(stateDir,`import-${randomUUID()}`);await mkdir(stage,{recursive:true});
  try{await writeFile(join(stage,'result.json'),JSON.stringify(r,null,2)+'\n');await writeFile(join(stage,'actions.json'),JSON.stringify(data.actions,null,2)+'\n');for(const c of captures)await writeFile(join(stage,c.name),c.bytes);const runDir=await destinationForImport(root,r);await mkdir(dirname(runDir),{recursive:true});await rename(stage,runDir);}catch(e){await rm(stage,{recursive:true,force:true});throw e;}
  return send(res,200,{ok:true});
 }
 return send(res,404,{error:'지원하지 않는 API입니다.'});
 }catch(e){send(res,e.code==='ENOENT'?404:400,{error:e.message});}}
http.createServer((req,res)=>{if(req.method==='GET')handle(req,res);else{mutation=mutation.then(()=>handle(req,res)).catch(()=>send(res,500,{error:'저장 오류'}));}}).listen(port,host,()=>console.log(`Chongchong UT · http://${host}:${port}\n로컬 전용 · AI 실행 및 외부 API 연결 없음`));
