import {fileURLToPath} from 'node:url';
import {migrateRuns} from './storage.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const moves=await migrateRuns(root);
for(const move of moves)console.log(`${move.runId} → ${move.to}`);
console.log(`${moves.length}개 실행 폴더 정리 완료 (파일 내용 변경 없음)`);
