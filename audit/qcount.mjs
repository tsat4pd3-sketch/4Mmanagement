/* ── audit/qcount.mjs — "ใครยิงคิวรีซ้ำ" วัดในฮาร์เนส ไม่ต้องแตะโค้ดใน src/ (2026-10-08) ──────
   ที่มา: log ของ Supabase บอกได้แค่ว่า *มี* คิวรีซ้ำ แต่บอกไม่ได้ว่า **เพราะอะไร** —
   ทั้งโรงงานอยู่หลัง NAT ตัวเดียว (1 IP = 73% ของ request) ⇒ แยก "คนละคนเปิดพร้อมกัน"
   ออกจาก "โหลดซ้ำฟรี" จากฝั่ง log ไม่ได้ · และ "ต่อเครื่อง" ก็หารไม่ได้เพราะนับเครื่องไม่ได้

   ตัวนับอยู่ใน `audit/mockSupabase.js` (`window.__qlog`) — ประตูเดียวที่ทุกคิวรีผ่าน
   ⇒ ได้ทั้ง "กี่ครั้ง" และ "ยิงจากบรรทัดไหน" + เวลาเป็น ms นับจากโหลดหน้า

   ใช้:  npx vite --config audit/vite.audit.mjs   (ค้างไว้)
         node audit/qcount.mjs                    # default: DailyReport (หน่วง 0)
         LAT=150 node audit/qcount.mjs            # ⭐ หน่วงเหมือนเน็ตจริง — ใช้จับ "โหลดซ้ำ"
         P=Obeya WAIT=12000 node audit/qcount.mjs # เลือกหน้า/เวลารอเอง
   อ่าน: แถว `ซ้ำ ≤2 วิ` จับกลุ่มด้วย **ตาราง + จุดที่เรียก** (นับแค่ชื่อตารางจะ over-report —
         `prod_orders` ยิง 4 ครั้งใน 1 วิจาก 4 จุดต่างกัน = คนละคิวรี ไม่ใช่ของเสียเปล่า)       */
import { chromium } from 'playwright';

const P = process.env.P || 'DailyReport';
const WAIT = Number(process.env.WAIT || 9000);
const url = `http://localhost:5199/audit/index.html?p=${P}&role=admin`;

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pg = await b.newPage({ viewport: { width: 1500, height: 1000 } });
const errs = [];
pg.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
// ⏱️ หน่วงคำตอบเหมือนเน็ตจริง — ของจริงหน่วง 100-500 ms · mock ที่ตอบ 0 ms ยุบทุก state
// update เป็น commit เดียว ⇒ บั๊ก "โหลดซ้ำเพราะ state มาเป็นระลอก" ไม่เคย reproduce
const LAT = Number(process.env.LAT || 0);
await pg.addInitScript((ms) => { window.__lat = ms; }, LAT);
await pg.goto(url, { waitUntil: 'networkidle' });
await pg.waitForTimeout(WAIT);

const out = await pg.evaluate((tables) => ({
  count: window.__qlog?.count?.() ?? null,
  dups: window.__qlog?.dups?.() ?? [],
  detail: Object.fromEntries(tables.map((t) => [t, window.__qlog?.table?.(t) ?? []])),
}), (process.env.T || 'child_lot_requests,v_demand_flow_blocks,line_part_levels,prod_orders').split(','));

if (!out.count) { console.error('❌ ไม่พบ window.__qlog — ตัวนับใน audit/mockSupabase.js หายไปแล้ว?'); process.exit(1); }
console.log(`หน้า ${P} · รอ ${WAIT} ms · หน่วง ${LAT} ms · pageerror: ${errs.length ? errs.join(' | ') : 'ไม่มี'}`);
console.log('\n🔴 ยิงซ้ำภายใน 2 วิ  [ตาราง, ทั้งหมด, ซ้ำ]');
console.log(out.dups.length
  ? out.dups.map((r) => `   ${r.table}  ${r.hits} ครั้ง · ซ้ำ ${r.dup}\n      ${r.from}`).join('\n')
  : '   (ไม่มี — ทุกจุดที่เรียก ยิงครั้งเดียว)');
for (const [t, rows] of Object.entries(out.detail)) {
  if (!rows.length) continue;
  console.log(`\n── ${t} (${rows.length} ครั้ง) ──`);
  rows.forEach((r) => console.log(`   +${String(r.at).padStart(5)} ms  ${r.from}`));
}
console.log('\n── 12 ตารางที่ถูกยิงมากสุด ──');
console.log(out.count.slice(0, 12).map(([t, n]) => `   ${String(n).padStart(3)}  ${t}`).join('\n'));
await b.close();
