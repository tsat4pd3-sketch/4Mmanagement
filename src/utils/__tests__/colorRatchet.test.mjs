/* ══ 🎨 ด่าน "สีดิบห้ามเพิ่ม" (ratchet) — UI-CONVENTIONS §6.17 · 2026-11-04 · คำสั่ง user ═══════════════
   *"ทั้งโปรเจคควรจะแพทเทิร์นสีไม่เกิน 5 สี ถ้าไม่ใช้กราฟ … เน้นปรับเฉดสีเอา"*
   วัด 04/11: hex ดิบ 169 ค่า / 4,239 จุด ใน pages+components — sweep รวดเดียวไม่ได้ (คำสั่ง 22/09)
   ⇒ ด่านนี้ล็อก "จำนวนสีดิบต่อไฟล์" ไว้ที่ baseline แล้วให้ลงได้อย่างเดียว:
     · ไฟล์เดิม: นับได้มากกว่า baseline = ตก   · ไฟล์ใหม่: ต้องเป็น 0 (ยกเว้นไฟล์กราฟ/ผัง)
     · ลดลงแล้ว: รัน `node scripts/color-baseline.mjs` เพื่อล็อกค่าใหม่ (ในคอมมิทเดียวกัน)
   สีที่ถูกต้อง = token ใน index.css: var(--green|--amber|--red|--blue) + -dim/-line · เทาผ่าน --text/--muted/--border
   ยกเว้น: กราฟ/ผังที่ต้องการสีแยกชุด (ลิสต์ CHART_FILES) · src/lib (ใบพิมพ์/PPTX) ไม่ถูกสแกนอยู่แล้ว */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scan } from '../../../scripts/color-baseline.mjs';

const CHART_FILES = new Set([
  'src/components/ParetoChart.jsx', 'src/components/ParetoAbcChart.jsx', 'src/components/Qc7Charts.jsx',
  'src/components/CapacityLoadChart.jsx', 'src/components/DowntimeTimeline.jsx', 'src/components/PlanTimeline.jsx',
  'src/components/StoreTimeChart.jsx', 'src/components/PeFlowChart.jsx', 'src/components/VsmCanvas.jsx',
]);
const base = JSON.parse(readFileSync(new URL('./fixtures/colorBaseline.json', import.meta.url), 'utf8')).files;

test('🎨 สีดิบ (hex/rgba) ต่อไฟล์ต้องไม่เพิ่มจาก baseline · ไฟล์ใหม่ = 0 (ยกเว้นกราฟ)', () => {
  const now = scan();
  const bad = [];
  for (const [f, n] of Object.entries(now)) {
    if (CHART_FILES.has(f)) continue;
    const b = base[f];
    if (b == null) { if (n > 0) bad.push(`${f}: ไฟล์ใหม่มีสีดิบ ${n} จุด (ต้องเป็น 0 — ใช้ token)`); }
    else if (n > b) bad.push(`${f}: ${b} → ${n} (+${n - b})`);
  }
  assert.deepEqual(bad, [], '\n\n❌ สีดิบเพิ่มขึ้น:\n  ' + bad.join('\n  ')
    + '\n   แก้: ใช้ var(--green|--amber|--red|--blue) / -dim / -line หรือ toneVar()/toneDim()/toneLine() (utils/statusTone.js)'
    + '\n   ลดลงแล้วค่อยรัน node scripts/color-baseline.mjs เพื่อล็อกค่าใหม่ — ห้ามรันเพื่อให้ผ่านหลังเพิ่มสี\n');
});
