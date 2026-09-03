// ด่านกัน CLAUDE.md บวม — CLAUDE.md ถูกโหลดเข้า context ทุก session (2026-09-03 เคยถึง 1.45 MB = 550k tokens)
import { statSync } from 'node:fs';
const LIMIT_KB = 120;
const kb = statSync(new URL('../CLAUDE.md', import.meta.url)).size / 1024;
console.log(`CLAUDE.md = ${kb.toFixed(1)} KB (limit ${LIMIT_KB} KB)`);
if (kb > LIMIT_KB) {
  console.error(`❌ CLAUDE.md เกินเพดาน — ย้ายรายละเอียดโมดูล/ประวัติไป docs/modules/<module>.md ก่อน commit`);
  process.exit(1);
}
