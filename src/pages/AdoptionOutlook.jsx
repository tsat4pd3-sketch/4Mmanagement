import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, supabaseDR } from '../supabaseClient';
import PageHeader from '../components/PageHeader';
import useTabParam from '../utils/useTabParam';
import useIsMobile from '../utils/useIsMobile';
import { RATE_COMPONENTS, fmtBaht } from '../utils/costSaving';
import { rnd, rint, pick } from '../utils/seededRandom';

/* ══ 🔮 ภาพเมื่อทุกแผนกใช้ครบ (Full-Adoption Outlook) · 2026-08-13 ═══════════════════════
   ทำอะไร: ตอบผู้บริหารว่า "ถ้าทุกแผนกใช้ระบบเต็มรูปแบบ จะได้อะไร" ด้วย 2 มุม
     1) ก่อน-หลัง รายแผนก — วัด "ความครบของข้อมูล" จากฐานจริง แล้วบอกว่าอะไรปลดล็อกเมื่อครบ
     2) เงินที่ประหยัดได้ (ROI) — แปลงเวลา/ของเสียที่ "วัดได้จริง" เป็นบาท

   ใครใช้: ผู้บริหาร/ผู้จัดการ (seed admin/manager) — เปิดในห้องประชุมแทนสไลด์

   กฎที่ยึด (ดู docs/ENGINEERING-PRINCIPLES.md):
   • **อ่านอย่างเดียว** ไม่เขียน DB · ทุก action = ลิงก์ไปหน้าที่ทำงานจริง
   • **ตัวเลขฝั่ง "วันนี้" มาจาก count จริงทั้งหมด ห้าม hardcode** — เปิดวันไหนก็ตรงวันนั้น
   • **แยก "ข้อเท็จจริง" ออกจาก "สมมติฐาน" ให้ขาด** — ป้ายเขียว "วัดจริง" vs ส้ม "สมมติฐาน"
     ฝั่ง "เมื่อใช้ครบ" จงใจเป็น *ความสามารถที่ปลดล็อก* ไม่ใช่ตัวเลขปั้น (ห้ามใส่เลขลอยๆ)
   • **ROI ไม่เดาแทนผู้ใช้** — rate บาท/ชม. ดึงจาก `cost_center_rates` ถ้ามี (ป้ายเขียว)
     ยังไม่มี = ให้กรอกสมมติฐานเอง + ชี้ไป /org-setup (ป้ายส้ม) · %ที่ลดได้ = ผู้ใช้ปรับเอง
   • **ห้ามเงียบ** — query ที่ error คืน null แล้วขึ้น "โหลดไม่ได้" ไม่ใช่โชว์ 0 (0 = คนละความหมาย)
   • **ไม่ scope ตาม section/line โดยตั้งใจ** — จอภาพรวมผู้บริหาร (precedent /factory-map,
     /group-overview) คุมด้วยสิทธิ์เข้าหน้าแทน

   ข้อจำกัดที่รู้ตัว: หน้านี้วัด "ความครบของข้อมูล" ไม่ได้วัด "คุณภาพของข้อมูล"
   (ลงครบแต่ลงมั่วก็ขึ้นเขียว) — การตรวจคุณภาพข้อมูลอยู่ที่หน้างานของแต่ละแผนก
   ═════════════════════════════════════════════════════════════════════════════════════════ */

const WINDOW_DAYS = 30;                 // หน้าต่างวัด loss — 1 เดือนเต็ม เทียบกับ "บาท/เดือน" ตรงๆ
const DEFAULT_RATE = 500;               // บาท/ชม. สมมติฐานตั้งต้นเมื่อยังไม่มี rate จริงในระบบ
const DEFAULT_CUT_PCT = 20;             // % ที่คาดว่าจะลดได้ — ผู้ใช้ปรับเอง (ไม่ใช่ตัวเลขที่ระบบยืนยัน)
const IN_CHUNK = 120;                   // จำนวน id ต่อ .in() — กัน URL ยาวเกินจนโดน proxy ตัด

function getWorkDate() {
  const d = new Date();
  if (d.getHours() < 8) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const dayAdd = (s, n) => { const d = new Date(`${s}T00:00:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fmtNum = (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));
const pct = (a, b) => (b > 0 ? Math.min(100, (a / b) * 100) : null);
/* นาทีของ downtime 1 แถว — รองรับทั้งโหมดกรอกนาที และโหมดมีเวลาเริ่ม-จบ (กฎเดียวกับ DeptDashboard) */
const dtMinOf = (d) => d.duration_min != null ? (Number(d.duration_min) || 0)
  : (d.started_at && d.ended_at ? Math.max(0, (new Date(d.ended_at) - new Date(d.started_at)) / 60000) : 0);

/* นับแถวแบบไม่ดึงข้อมูล (head:true) — ไม่ติดเพดาน 1000 แถว และถูกกว่า select ทั้งตาราง
   error → คืน null เพื่อให้จอแยก "โหลดไม่ได้" ออกจาก "มี 0 รายการ" ได้ */
async function cnt(client, table, build) {
  try {
    let q = client.from(table).select('*', { count: 'exact', head: true });
    if (build) q = build(q);
    const { count, error } = await q;
    if (error) { console.warn(`[adoption] count ${table}:`, error.message); return null; }
    return count ?? 0;
  } catch (e) { console.warn(`[adoption] count ${table}:`, e?.message); return null; }
}

/* ยิง .in() เป็นก้อนแล้วรวมผล — id ทั้งเดือนมีหลายร้อยตัว ใส่ทีเดียว URL ยาวเกิน */
async function inChunks(ids, run) {
  const out = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data, error } = await run(ids.slice(i, i + IN_CHUNK));
    if (error) { console.warn('[adoption] chunk:', error.message); continue; }
    out.push(...(data || []));
  }
  return out;
}

/* ── ความครบของข้อมูลรายแผนก ──────────────────────────────────────────────────────────
   signals(c) คืนรายการตัวชี้วัด: now/total = นับจริง · gap = ข้อความบอกว่าขาดอะไร
   unlocks   = ความสามารถที่ปลดล็อกเมื่อข้อมูลครบ (เชิงคุณภาพ — ไม่ใช่ตัวเลขปั้น)
   เพิ่มแผนกใหม่ = เพิ่ม entry ที่นี่ที่เดียว การ์ด/แถบสรุป/อันดับตามให้เอง */
const DEPTS = [
  {
    key: 'production', icon: '🏭', label: 'ฝ่ายผลิต', to: '/dept-dashboard?dept=production',
    signals: (c) => [
      { label: 'กะที่ปิดครบ', now: c.sessClosed, total: c.sess, unit: 'กะ' },
      { label: 'ใบผลิตที่ปิด', now: c.ordConfirmed, total: c.ord, unit: 'ใบ' },
      { label: 'ชิ้นงานที่ตั้ง CT (รอบเวลา)', now: c.prodWithCt, total: c.prodAll, unit: 'พาร์ท', gapTo: '/products' },
      {
        label: 'กะที่บันทึกของเสีย', now: c.sessWithNg, total: c.sess, unit: 'กะ',
        gap: 'กะที่เหลือไม่มีข้อมูลของเสียเลย — %Q ที่เห็นจึงสูงกว่าความจริง', gapTo: '/daily-report',
      },
    ],
    unlocks: [
      'ของเสียถูกบันทึกทุกกะ → %Q และ OEE เชื่อถือได้จริง ไม่ใช่ดูดีเพราะไม่มีใครลง',
      'เป้ากะมาจากออเดอร์ลูกค้าจริง แทนการตั้งเป้าด้วยมือ',
      'ยอดที่จะส่งต่อกะหน้าเห็นตั้งแต่ระหว่างกะ ไม่ต้องรอปิดกะ',
    ],
  },
  {
    key: 'maintenance', icon: '🔧', label: 'ซ่อมบำรุง', to: '/dept-dashboard?dept=maintenance',
    signals: (c) => [
      {
        label: 'เหตุเครื่องหยุดที่เปิดใบซ่อม', now: c.mo, total: c.dtUnplannedRows, unit: 'ใบ',
        gap: 'เครื่องหยุดถูกบันทึกครบ แต่แทบไม่มีใบซ่อมตามมา = ไม่มีใครตามแก้ต้นเหตุ', gapTo: '/mtn-repair',
      },
      { label: 'เครื่องจักรที่มีแผน PM', now: c.pmPlans, total: c.machinesProd, unit: 'เครื่อง', gapTo: '/pm-setup' },
      { label: 'ประวัติการตรวจที่บันทึก', now: c.inspections, total: null, unit: 'ครั้ง', gapTo: '/pm-check' },
      { label: 'อะไหล่ในคลัง', now: c.spare, total: null, unit: 'รายการ', gap: 'ยังไม่ได้ย้ายจากไฟล์ Excel เข้าระบบ', gapTo: '/mtn-repair?tab=spare' },
      { label: 'แม่พิมพ์/จิ๊กที่ลงทะเบียนตรวจ', now: c.jigsReal, total: c.dies, unit: 'ตัว', gapTo: '/die-registry' },
    ],
    unlocks: [
      'เครื่องที่หยุดซ้ำถูกชี้เป้าอัตโนมัติ → เปิดใบซ่อมก่อนพัง ไม่ใช่ตามซ่อมทีหลัง',
      'MTBF / MTTR รายเครื่อง — รู้ว่าเครื่องไหนควรซ่อม เครื่องไหนควรเปลี่ยน',
      'เบิกอะไหล่ตัดสต็อกจริง → ไม่มีเคส "ของหมดตอนต้องใช้"',
      'สอบกลับได้ว่าของล็อตที่มีปัญหา ผลิตด้วยเครื่องที่ค้าง PM อยู่หรือเปล่า',
    ],
  },
  {
    key: 'store', icon: '📦', label: 'สโตร์ / จัดส่ง', to: '/dept-dashboard?dept=store',
    signals: (c) => [
      {
        label: 'รอบส่งที่กดยืนยัน "ส่งแล้ว"', now: c.shipped, total: c.shipOrders, unit: 'รอบ',
        gap: 'ไม่กดส่ง = สต็อกไม่ถูกหัก ยอดคงเหลือในระบบสูงกว่าของจริงเรื่อยๆ', gapTo: '/customer-demand',
      },
      { label: 'รายการตัดสต็อกขาออก', now: c.stockConsume, total: c.stockAll, unit: 'แถว', gapTo: '/line-stock' },
      { label: 'พาร์ทที่ลงต้นทุนต่อชิ้น', now: c.partsWithCost, total: c.partsAll, unit: 'พาร์ท', gap: 'ไม่มีต้นทุน = คิดเงินของเสียเป็นบาทไม่ได้', gapTo: '/products' },
      { label: 'ไลน์ที่ผูก cost center', now: c.linesWithCc, total: c.linesAll, unit: 'ไลน์', gapTo: '/linesetup' },
    ],
    unlocks: [
      'ยอดคงเหลือตรงกับของจริง → เลิกนับสต็อกซ้ำเพื่อเช็คว่าระบบถูกไหม',
      'สอบกลับได้ครบสาย: วัตถุดิบ → ใบผลิต → รอบส่ง → ลูกค้า',
      'เตือนของจะขาดก่อนถึงกำหนดส่ง แทนการรู้ตอนของหมดแล้ว',
    ],
  },
  {
    key: 'qa', icon: '✅', label: 'QA / คุณภาพ', to: '/dept-dashboard?dept=qa',
    signals: (c) => [
      { label: 'ใบตรวจคุณภาพ (Check Sheet)', now: c.qaSheets, total: null, unit: 'ใบ', gapTo: '/qa' },
      { label: 'พาร์ทที่ตั้งมาตรฐานการตรวจ', now: c.qaParts, total: c.prodAll, unit: 'พาร์ท', gapTo: '/qa-setup' },
      { label: 'ค่าที่วัดเข้า SPC', now: c.qaMeas, total: null, unit: 'ค่า', gap: 'ยังไม่มีข้อมูลพอคำนวณ Cp/Cpk', gapTo: '/qa' },
      { label: 'ใบ NCR (ของไม่เป็นไปตามข้อกำหนด)', now: c.qaNcr, total: null, unit: 'ใบ', gapTo: '/qa' },
      { label: 'การตรวจ LPA', now: c.lpaAudits, total: null, unit: 'ครั้ง', good: true },
    ],
    unlocks: [
      'ของเสียทุกชิ้นมีที่มา — รู้ว่าหลุดที่จุดตรวจไหน เครื่องไหน กะไหน',
      'Cp/Cpk รายจุดวัด → คุยกับลูกค้าด้วยข้อมูล ไม่ใช่ความรู้สึก',
      'NCR → CAPA ปิดลูปได้ในระบบเดียว ไม่ต้องตามเอกสารกระดาษ',
      'พร้อมให้ลูกค้า/ผู้ตรวจ audit ย้อนหลังได้ทันที (CQI-15 / IATF)',
    ],
  },
];

/* ── 4 ระดับความสามารถของข้อมูล (analytics maturity) ───────────────────────────────────
   ระดับสูงขึ้นไม่ได้มาจาก "ซอฟต์แวร์เก่งขึ้น" แต่มาจาก "ข้อมูลครบขึ้นและเชื่อมกัน"
   — เป็นแกนเดียวที่ใช้ตอบทุกคำถามในแท็บมิติ ห้ามนิยามระดับซ้ำที่อื่น */
const LEVELS = [
  { n: 1, icon: '📋', name: 'เห็นย้อนหลัง', en: 'Descriptive', desc: 'ตอบได้ว่า "เกิดอะไรขึ้น" — ต้องมีการบันทึกครบก่อน' },
  { n: 2, icon: '🔍', name: 'รู้สาเหตุ', en: 'Diagnostic', desc: 'ตอบได้ว่า "ทำไมถึงเกิด" — ต้องเชื่อมข้อมูลข้ามแผนกได้' },
  { n: 3, icon: '🔮', name: 'รู้ล่วงหน้า', en: 'Predictive', desc: 'เตือนก่อนเกิด — ต้องมีข้อมูลย้อนหลังมากพอจะเห็นแนวโน้ม' },
  { n: 4, icon: '🎯', name: 'บอกว่าต้องทำอะไร', en: 'Prescriptive', desc: 'เสนอทางแก้ที่ทำได้จริง — ต้องรู้ทั้งปัญหา ทรัพยากร และผลกระทบ' },
];
const lv = (n) => LEVELS.find(l => l.n === n);

/* ── โหมดสาธิต: ตัวช่วยปั้น "ตัวอย่างคำตอบ" ─────────────────────────────────────────────
   ใช้ **ชื่อจริง** (ไลน์/เครื่อง/สินค้า/ลูกค้าจาก DB) + **ตัวเลข seeded** (นิ่ง ไม่ดิ้นตอนรีเฟรช)
   → ตัวอย่างดูเป็นโรงงานเรา ไม่ใช่ demo ลอยๆ แต่ยังเป็นตัวเลขสมมติ 100%
   ⚠️ ทุกที่ที่แสดงผลจากตัวนี้ ต้องติดป้าย 🧪 จำลอง เสมอ */
function makeDemo(ents, day) {
  const P = (s) => `${day}|${s}`;
  const prodOf = (s) => pick(ents.products, P(`p${s}`), null) || { mat_no: '10100401', name: 'APRON ASSY LH', line_name: 'LINE APRON ASSY' };
  return {
    line: (s) => pick(ents.lines, P(`l${s}`), 'LINE APRON ASSY'),
    mach: (s) => pick(ents.machines, P(`m${s}`), 'HDF-01'),
    prod: prodOf,
    pname: (s) => { const p = prodOf(s); return `${p.mat_no}${p.name ? ` · ${p.name}` : ''}`; },
    cust: (s) => pick(ents.customers, P(`c${s}`), 'FORD'),
    dt: (s) => pick(ents.dtTypes, P(`d${s}`), 'เครื่องเสีย'),
    def: (s) => pick(ents.defTypes, P(`f${s}`), 'รอยขีดข่วน'),
    n: (s, lo, hi) => rint(P(`n${s}`), lo, hi),
    f: (s, lo, hi, dec = 1) => +(lo + rnd(P(`f${s}`)) * (hi - lo)).toFixed(dec),
    money: (s, lo, hi) => Math.round((lo + rnd(P(`b${s}`)) * (hi - lo)) / 1000) * 1000,
  };
}

/* ── มิติที่มองเห็นได้เมื่อข้อมูลเชื่อมกัน ─────────────────────────────────────────────────
   แต่ละคำถาม = คำถามที่ผู้บริหารถามจริง แล้วบอกว่า "ต้องต่อข้อมูลจากแผนกไหนบ้าง"
   chain[].have(c) = เช็คจาก count จริง → ชิปเขียว/เทา บอกว่าสายข้อมูลขาดตรงไหน (ไม่ใช่คำโฆษณา)
   now/full = ระดับที่ตอบได้วันนี้ / เมื่อข้อมูลครบ
   ⚠️ full ต้องเป็นสิ่งที่ทำได้ด้วยข้อมูลที่ระบบเก็บอยู่แล้วจริงๆ — ห้ามใส่ความสามารถที่ต้องซื้อของใหม่
      (ยกเว้นระบุชัดว่าต้องมี SCADA/เซ็นเซอร์ — ดู docs/SCADA_REALTIME_DESIGN.md) */
const DIMENSIONS = [
  {
    key: 'quality', icon: '✅', label: 'คุณภาพ',
    qs: [
      {
        q: 'ลูกค้าเคลมของล็อตหนึ่ง — ย้อนกลับได้ถึงไหน?',
        chain: [
          { d: 'สโตร์', l: 'รอบส่ง/ลูกค้า', have: c => c.shipped > 0 },
          { d: 'ผลิต', l: 'ใบผลิต + กะ', have: c => c.ordConfirmed > 0 },
          { d: 'ผลิต', l: 'เครื่องที่ใช้', have: c => c.dtUnplannedRows > 0 },
          { d: 'คน', l: 'คนที่ยืนจุดงาน + สกิล', have: c => c.skills > 0 },
          { d: 'ผลิต', l: '4M ที่เปลี่ยนวันนั้น', have: c => c.fourM > 0 },
          { d: 'ซ่อมบำรุง', l: 'เครื่องค้าง PM ไหม', have: c => c.inspections > 0 },
          { d: 'สโตร์', l: 'ล็อตวัตถุดิบ supplier', have: () => false },
        ],
        now: 2, full: 2, to: '/order-trace',
        nowTxt: 'ย้อนได้แล้วถึง ใบผลิต → เครื่อง → คนที่จุดงาน → 4M → สถานะ PM ของวันนั้น',
        fullTxt: 'ต่อได้ถึงล็อตวัตถุดิบของ supplier และแม่พิมพ์ตัวที่ใช้จริง = ปิดสายครบตั้งแต่เหล็กม้วนถึงมือลูกค้า',
        need: ['บันทึกเลขล็อต/heat no. ของ supplier ตอนรับวัตถุดิบเข้า', 'ผูกใบผลิตกับแม่พิมพ์ตัวที่ใช้ (สแกน QR ตอนขึ้นงาน)'],
        demo: D => ({
          head: `ย้อนกลับได้ครบ 7 ชั้น ใน 3 วินาที — จากกล่องที่ลูกค้าเคลม ถึงเหล็กม้วนที่ใช้`,
          tone: 'ok',
          lines: [
            `📦 ล็อตที่เคลม: ${D.pname('t1')} · ส่ง ${D.cust('t1')} รอบ ${D.n('t2', 8, 16)}:00 วันที่ ${D.n('t3', 1, 28)}`,
            `🏭 ผลิตที่ ${D.line('t1')} กะดึก · ใบ MANUAL-${D.n('t4', 100000, 999999)}`,
            `⚙️ เครื่อง ${D.mach('t1')} · แม่พิมพ์ DIE-TDM-${D.n('t5', 100, 999)} (shot สะสม ${(D.n('t6', 400, 900) * 1000).toLocaleString()})`,
            `👷 ${D.n('t7', 4, 9)} คนที่จุดงาน · สกิลเฉลี่ย ${D.n('t8', 68, 88)} · มี 1 คนเพิ่งย้ายเข้าจุด OP2 วันนั้น`,
            `📝 4M วันนั้น: เปลี่ยนคนที่จุด OP2 (อนุมัติแล้ว)`,
            `🔧 PM: เครื่องนี้ค้างตรวจ ${D.n('t9', 3, 12)} วัน ณ เวลาที่ผลิต`,
            `🧱 วัตถุดิบ: ล็อต SUP-A/${D.n('ta', 2200, 2699)}-${D.n('tb', 100, 199)} (เหล็ก ${D.f('tc', 1.6, 3.2, 1)} mm)`,
          ],
          note: `ระบบชี้ผู้ต้องสงสัยให้เลย: PM ค้าง ${D.n('t9', 3, 12)} วัน + คนใหม่ที่จุด OP2 — ไม่ต้องนั่งไล่เอกสารข้ามแผนกเป็นวัน`,
        }),
      },
      {
        q: 'จะรู้ตัวก่อนมั้ย ว่าคุณภาพกำลังจะหลุดควบคุม?',
        chain: [
          { d: 'QA', l: 'มาตรฐาน/จุดวัด', have: c => c.qaParts > 0 },
          { d: 'QA', l: 'ใบตรวจตามรอบ', have: c => c.qaSheets > 0 },
          { d: 'QA', l: 'ค่าที่วัดจริง (SPC)', have: c => c.qaMeas > 0 },
          { d: 'ผลิต', l: 'ของเสียรายกะ', have: c => c.sessWithNg > 0 },
        ],
        now: 1, full: 3, to: '/qa',
        nowTxt: 'ตอบไม่ได้ — ยังไม่มีค่าวัดเข้า SPC เลย รู้ได้แค่ "เสียไปแล้วกี่ชิ้น" หลังเกิดเหตุ',
        fullTxt: 'Cp/Cpk รายจุดวัด + เห็นค่าค่อยๆ เลื่อนออกจากกึ่งกลางสเปค → เตือนตั้งแต่ยังไม่มีของเสียสักชิ้น',
        need: ['ตั้งมาตรฐาน+จุดวัดให้ครบทุกพาร์ท', 'ลงค่าวัดจริงตามรอบ (ไม่ใช่แค่ผ่าน/ไม่ผ่าน)'],
        demo: D => ({
          head: `⚠️ เตือนล่วงหน้า ~2 กะ ก่อนของเสียชิ้นแรกจะเกิด`,
          tone: 'warn',
          lines: [
            `จุดวัด D-${D.n('q1', 10, 30)} ของ ${D.pname('q1')} · Cpk ${D.f('q2', 1.3, 1.5, 2)} → ${D.f('q3', 1.0, 1.2, 2)} → ${D.f('q4', 0.85, 0.99, 2)} ใน 3 กะติด`,
            `ค่าเฉลี่ยเลื่อนออกจากกึ่งกลางสเปค +${D.f('q5', 0.008, 0.035, 3)} mm ต่อเนื่อง (ยังอยู่ในสเปค)`,
            `แนวโน้มนี้จะชน UCL ประมาณ ${D.n('q6', 1, 3)} กะข้างหน้า`,
            `🔗 เชื่อมกับเครื่อง: ${D.mach('q1')} เพิ่งครบรอบเปลี่ยนชิ้นส่วนสึกเมื่อ ${D.n('q7', 5, 20)} วันก่อน`,
          ],
          note: `วันนี้เรารู้ตอน "เสียไปแล้ว ${D.n('q8', 40, 200)} ชิ้น" — เมื่อมี SPC เราจะรู้ตอนยังไม่เสียสักชิ้น นี่คือความต่างระหว่างตรวจจับกับป้องกัน`,
        }),
      },
      {
        q: 'ของเสียตัวนี้เกิดจากอะไร — คน เครื่อง วัตถุดิบ หรือวิธีทำ?',
        chain: [
          { d: 'ผลิต', l: 'ของเสีย + หมายเหตุ', have: c => c.sessWithNg > 0 },
          { d: 'ผลิต', l: '4M ที่เปลี่ยน', have: c => c.fourM > 0 },
          { d: 'คน', l: 'สกิลคนที่ยืนจุดนั้น', have: c => c.skills > 0 },
          { d: 'ซ่อมบำรุง', l: 'สภาพเครื่อง/PM', have: c => c.inspections > 0 },
          { d: 'QA', l: 'ใบ NCR / CAPA', have: c => c.qaNcr > 0 },
        ],
        now: 2, full: 3, to: '/qa',
        nowTxt: 'ชี้ได้บางส่วน (4M + คน + เครื่อง) แต่ของเสียถูกบันทึกแค่บางกะ ทำให้ยังหา pattern ไม่ได้',
        fullTxt: 'จับ pattern ได้ว่า "ของเสียชนิดนี้มักเกิดตอนเปลี่ยนคน/หลังเปลี่ยนแม่พิมพ์/กับเครื่องตัวนี้" → กันไว้ก่อน',
        need: ['บันทึกของเสียให้ครบทุกกะ', 'เปิด NCR เมื่อเจอของเสียซ้ำ เพื่อปิดลูปหาสาเหตุ'],
        demo: D => ({
          head: `จับ pattern ได้: "${D.def('r1')}" เกาะกลุ่มที่ 1 เครื่อง + 1 ช่วงเวลา ไม่ใช่ที่คน`,
          tone: 'ok',
          lines: [
            `${D.n('r2', 55, 78)}% ของของเสียชนิดนี้เกิดที่เครื่อง ${D.mach('r1')} เครื่องเดียว`,
            `${D.n('r3', 9, 14)} จาก ${D.n('r4', 14, 18)} ครั้ง เกิดภายใน 2 ชม. หลังเปลี่ยนแม่พิมพ์`,
            `กระจายทั่วทุกคนที่เข้าจุดงาน (สกิล ${D.n('r5', 62, 92)}) → คนไม่ใช่ตัวแปร`,
            `4M ที่เกี่ยวข้อง: ไม่มีการเปลี่ยนวัสดุ/วิธีในช่วงนั้น`,
          ],
          note: `สรุปให้เอง: ปัญหาอยู่ที่ขั้นตอน setup แม่พิมพ์ ไม่ใช่ที่ฝีมือคน → แก้ที่ WI การ setup ไม่ใช่ไปอบรมพนักงานเพิ่ม`,
        }),
      },
    ],
  },
  {
    key: 'machine', icon: '⚙️', label: 'เครื่องจักร',
    qs: [
      {
        q: 'เครื่องเริ่มเบี่ยงเบนหรือยัง — ก่อนที่จะพังจริง?',
        chain: [
          { d: 'ผลิต', l: 'เครื่องหยุด/หยุดสั้น', have: c => c.dtUnplannedRows > 0 },
          { d: 'ผลิต', l: '%P ต่อกะ (ความเร็วตก)', have: c => c.sessClosed > 0 },
          { d: 'ผลิต', l: 'ของเสียของเครื่องนั้น', have: c => c.sessWithNg > 0 },
          { d: 'ซ่อมบำรุง', l: 'ใบซ่อมที่ผ่านมา', have: c => c.mo > 0 },
          { d: 'ซ่อมบำรุง', l: 'ประวัติการตรวจ', have: c => c.inspections > 0 },
        ],
        now: 1, full: 3, to: '/dept-dashboard?dept=maintenance',
        nowTxt: 'มีข้อมูลเครื่องหยุดครบแล้ว แต่ยังไม่มีใครเปิดใบซ่อมตาม จึงเห็นแค่ "หยุดไปแล้ว" ไม่รู้ว่ากำลังจะหยุดอีก',
        fullTxt: 'สัญญาณเตือน 3 ทางพร้อมกัน: หยุดสั้นถี่ขึ้น + ความเร็วค่อยๆ ตก + ของเสียเพิ่ม = เครื่องกำลังเสื่อม ทั้งที่ยังไม่พัง',
        need: ['เปิดใบซ่อมทุกครั้งที่เครื่องหยุดผิดปกติ', 'บันทึกผลตรวจ PM ตามรอบ'],
        demo: D => ({
          head: `⚠️ ${D.mach('v1')} ส่งสัญญาณเสื่อม 3 ทางพร้อมกัน — ยังไม่พัง แต่กำลังจะพัง`,
          tone: 'warn',
          lines: [
            `หยุดสั้น (<5 นาที): ${D.n('v2', 3, 6)} → ${D.n('v3', 7, 11)} → ${D.n('v4', 14, 22)} ครั้ง/กะ ใน 3 สัปดาห์`,
            `%P (ความเร็วเทียบมาตรฐาน): ${D.n('v5', 90, 95)} → ${D.n('v6', 83, 88)} → ${D.n('v7', 74, 81)}`,
            `ของเสียของเครื่องนี้: ${D.f('v8', 0.2, 0.6, 1)}% → ${D.f('v9', 1.4, 2.6, 1)}%`,
            `🔗 เทียบกับประวัติ: เครื่องรุ่นเดียวกันเคยมี pattern นี้ ${D.n('va', 2, 4)} ครั้ง — พังใน 8-16 วันทุกครั้ง`,
          ],
          note: `3 สัญญาณนี้มาจาก 3 แหล่งคนละแผนก (ผลิต/ผลิต/QA) — แยกกันดูไม่เห็นอะไร รวมกันถึงเห็นว่าเครื่องกำลังเสื่อม`,
        }),
      },
      {
        q: 'เครื่องนี้ควรซ่อมเมื่อไหร่ ใช้อะไหล่อะไร ใครทำ กระทบแผนผลิตแค่ไหน?',
        chain: [
          { d: 'ซ่อมบำรุง', l: 'แผน PM + รอบ', have: c => c.pmPlans > 0 },
          { d: 'ผลิต', l: 'ยอดผลิตสะสม (shot)', have: c => c.ordConfirmed > 0 },
          { d: 'ซ่อมบำรุง', l: 'อะไหล่คงคลัง', have: c => c.spare > 0 },
          { d: 'ซ่อมบำรุง', l: 'ทีมช่าง/คิวงาน', have: c => c.mo > 0 },
          { d: 'สโตร์', l: 'ออเดอร์ที่รอไลน์นี้', have: c => c.shipOrders > 0 },
        ],
        now: 1, full: 4, to: '/pm-forecast',
        nowTxt: 'บอกได้แค่ว่า "ครบรอบแล้ว" — ยังไม่รู้ว่าควรทำวันไหนถึงกระทบผลิตน้อยที่สุด และของพร้อมหรือเปล่า',
        fullTxt: 'นี่คือ Prescriptive Maintenance เต็มรูป: ระบบเสนอ "ทำวันพฤหัส กะดึก · ใช้อะไหล่ 3 ตัวมีของครบ · ทีม MTN ว่าง · กระทบออเดอร์ลูกค้า 0 ใบ เพราะผลิตล่วงหน้าไว้แล้ว"',
        need: ['ลงข้อมูลอะไหล่คงคลัง', 'เปิดใบซ่อม/บันทึก PM ให้เป็นนิสัย', 'ผูกแผน PM กับยอดผลิตสะสม'],
        demo: D => ({
          head: `🎯 ข้อเสนอของระบบ: ทำ PM ${D.mach('w1')} คืนวันพฤหัสที่ ${D.n('w2', 15, 27)} · กะดึก`,
          tone: 'ok',
          lines: [
            `เหตุผล: shot สะสม ${(D.n('w3', 460, 495) * 1000).toLocaleString()} / 500,000 → ครบรอบใน ${D.n('w4', 4, 9)} วัน`,
            `อะไหล่ที่ต้องใช้ 3 รายการ — มีของครบในคลัง (ชั้น A-0${D.n('w5', 1, 4)}-${D.n('w6', 1, 5)})`,
            `ทีมช่าง: MTN ว่างคืนนั้น · งานใช้เวลา ${D.n('w7', 3, 6)} ชม.`,
            `กระทบแผนผลิต: 0 ออเดอร์ — ${D.line('w1')} ผลิตล่วงหน้าไว้แล้ว ${D.f('w8', 1.1, 2.4, 1)} วัน`,
            `⚠️ ถ้าเลื่อนไปสัปดาห์หน้า: เสี่ยงพังกลางกะ · กระทบ ${D.n('w9', 2, 4)} ออเดอร์ ลูกค้า ${D.cust('w1')}`,
          ],
          note: `นี่คือ Prescriptive เต็มรูป — ไม่ใช่แค่บอกว่า "ถึงรอบแล้ว" แต่บอกว่าทำวันไหน ใครทำ ของพร้อมไหม และถ้าไม่ทำจะเสียอะไร`,
        }),
      },
      {
        q: 'เครื่องไหนควรซ่อมต่อ เครื่องไหนควรเปลี่ยนทิ้ง?',
        chain: [
          { d: 'ซ่อมบำรุง', l: 'ใบซ่อม + ค่าแรง/อะไหล่', have: c => c.mo > 0 },
          { d: 'ผลิต', l: 'เวลาที่เครื่องทำให้เสีย', have: c => c.dtUnplannedRows > 0 },
          { d: 'บัญชี', l: 'ต้นทุนเวลาเดินไลน์', have: c => (c.linesWithCc || 0) > 0 },
        ],
        now: 1, full: 4, to: '/mtn-repair',
        nowTxt: 'ตัดสินด้วยความรู้สึกและประสบการณ์ช่าง ยังไม่มีตัวเลขรองรับ',
        fullTxt: 'เทียบ "ค่าซ่อมสะสม + เวลาที่เสียไปคิดเป็นเงิน" กับ "ราคาเครื่องใหม่" ต่อเครื่อง → ของบลงทุนด้วยตัวเลข ไม่ใช่ความรู้สึก',
        need: ['บันทึกค่าแรง/ค่าอะไหล่ทุกใบซ่อม', 'กรอก Activity Rate ต่อ cost center'],
        demo: D => ({
          head: `เครื่อง ${D.n('x1', 2, 4)} ตัวเข้าเกณฑ์ "ควรเปลี่ยนมากกว่าซ่อมต่อ"`,
          tone: 'warn',
          lines: [
            `${D.mach('x1')} — ค่าซ่อม 12 เดือน ${D.money('x2', 120000, 260000).toLocaleString()} บาท`,
            `+ เวลาที่เครื่องนี้ทำให้เสีย ${D.n('x3', 70, 130)} ชม. = ${D.money('x4', 300000, 600000).toLocaleString()} บาท`,
            `รวมต้นทุนการถือครอง ${D.money('x5', 450000, 800000).toLocaleString()} บาท/ปี · เครื่องใหม่ ${D.f('x6', 1.4, 2.6, 1)} ล้าน`,
            `→ คืนทุน ${D.f('x7', 2.1, 3.6, 1)} ปี · อายุเครื่องปัจจุบัน ${D.n('x8', 12, 22)} ปี`,
          ],
          note: `ของบลงทุนด้วยตัวเลขที่สืบย้อนได้ถึงใบซ่อมรายใบ ไม่ใช่ "ช่างบอกว่ามันเก่าแล้ว"`,
        }),
      },
    ],
  },
  {
    key: 'delivery', icon: '🚚', label: 'การจัดส่ง',
    qs: [
      {
        q: 'เครื่องเสียตอนนี้ — จะกระทบรอบส่งไหน ลูกค้ารายไหน?',
        chain: [
          { d: 'ผลิต', l: 'เครื่องที่หยุดอยู่', have: c => c.dtUnplannedRows > 0 },
          { d: 'ผลิต', l: 'ไลน์นั้นผลิตพาร์ทอะไร', have: c => c.prodWithCt > 0 },
          { d: 'สโตร์', l: 'ออเดอร์ที่รอพาร์ทนั้น', have: c => c.shipOrders > 0 },
          { d: 'สโตร์', l: 'สต็อกที่มีอยู่จริง', have: c => c.stockConsume > 0 },
        ],
        now: 1, full: 3, to: '/customer-demand',
        nowTxt: 'ข้อมูลทุกชิ้นมีอยู่ในระบบแล้ว แต่ยังไม่มีหน้าไหนต่อสายให้เห็นพร้อมกัน — ต้องเปิด 3 หน้ามาเทียบเอง',
        fullTxt: 'เครื่องหยุดปุ๊บ ระบบบอกทันที "กระทบออเดอร์ 4 ใบ ลูกค้า Ford รอบบ่ายพรุ่งนี้ · สต็อกพอถึง 14:00" → ตัดสินใจย้ายไลน์/เร่ง OT ได้ทันที',
        need: ['กดยืนยัน "ส่งแล้ว" ทุกรอบ เพื่อให้สต็อกตรงของจริง'],
        demo: D => ({
          head: `🔴 ${D.mach('y1')} หยุดอยู่ ${D.n('y2', 25, 70)} นาที → กระทบ ${D.n('y3', 2, 5)} ออเดอร์ · ${D.n('y4', 1, 3)} ลูกค้า`,
          tone: 'bad',
          lines: [
            `${D.line('y1')} ผลิต ${D.pname('y1')} · ค้างสะสมแล้ว ${D.n('y5', 300, 900)} ชิ้น`,
            `ออเดอร์ที่รอ: ${D.cust('y1')} รอบ ${D.n('y6', 8, 17)}:00 พรุ่งนี้ (${(D.n('y7', 8, 20) * 100).toLocaleString()} ชิ้น)`,
            `สต็อกสำเร็จรูปพอส่งถึง ${D.n('y8', 9, 15)}:${D.n('y9', 0, 5)}0 — หลังจากนั้นส่งไม่ทัน`,
            `ทางเลือกที่ระบบเห็น: ย้ายไป ${D.line('y2')} (ว่าง ${D.n('ya', 2, 5)} ชม.) หรือเปิด OT ${D.n('yb', 2, 4)} ชม. คืนนี้`,
          ],
          note: `⭐ คำถามนี้ข้อมูลครบแล้ววันนี้ — ขาดแค่หน้าที่ต่อสายให้เห็นพร้อมกัน ทำได้เลยไม่ต้องลงข้อมูลเพิ่ม`,
        }),
      },
      {
        q: 'เดือนหน้าจะส่งลูกค้าทันมั้ย ต้องเปิด OT หรือกะดึกกี่วัน?',
        chain: [
          { d: 'ขาย', l: 'Forecast ลูกค้า', have: c => c.forecasts > 0 },
          { d: 'ผลิต', l: 'กำลังผลิตจริงที่ทำได้', have: c => c.ordConfirmed > 0 },
          { d: 'ซ่อมบำรุง', l: 'PM ที่จะครบเดือนหน้า', have: c => c.pmPlans > 0 },
          { d: 'คน', l: 'กำลังคน + วันหยุด', have: c => c.checkinLogs > 0 },
        ],
        now: 2, full: 3, to: '/production-plan',
        nowTxt: 'คำนวณได้แล้วจากกำลังผลิตจริงย้อนหลัง (ไม่ใช่ตัวเลขทฤษฎี) แต่ยังไม่ได้หักวันที่เครื่องต้องหยุดทำ PM',
        fullTxt: 'รวมทุกข้อจำกัดในภาพเดียว: ออเดอร์ + กำลังคนจริง + วันที่เครื่องต้องหยุด PM + วันหยุดบริษัท → บอกล่วงหน้าเป็นเดือนว่าวันไหนต้องเปิด OT',
        need: ['ผูกแผน PM เข้ากับแผนผลิต'],
        demo: D => ({
          head: `เดือนหน้า: ต้องเปิด OT ${D.n('z1', 3, 6)} วัน · กะดึกเพิ่ม ${D.n('z2', 1, 3)} วัน ถึงจะส่งทัน`,
          tone: 'warn',
          lines: [
            `Forecast ลูกค้ารวม ${(D.n('z3', 110, 145) * 1000).toLocaleString()} ชิ้น · กำลังผลิตปกติ ${(D.n('z4', 100, 122) * 1000).toLocaleString()} ชิ้น`,
            `หักวันที่เครื่องต้องหยุดทำ PM: ${D.n('z5', 2, 5)} เครื่อง รวม ${D.n('z6', 12, 26)} ชม.`,
            `หักวันหยุดบริษัท ${D.n('z7', 1, 3)} วัน (จากปฏิทินจริง)`,
            `วันที่ต้องเปิด OT: ${[...Array(4)].map((_, i) => D.n(`z8${i}`, 1, 28)).sort((a, b) => a - b).join(', ')} ก.ย.`,
          ],
          note: `รวม 4 ข้อจำกัดที่อยู่คนละแผนกไว้ในภาพเดียว (ขาย + ผลิต + ซ่อมบำรุง + HR) — รู้ล่วงหน้าเป็นเดือน ไม่ใช่รู้ตอนของไม่ทัน`,
        }),
      },
      {
        q: 'สต็อกที่เห็นในระบบ ตรงกับของจริงในคลังมั้ย?',
        chain: [
          { d: 'ผลิต', l: 'ปิดออเดอร์ → เข้าคลัง', have: c => c.ordConfirmed > 0 },
          { d: 'สโตร์', l: 'จ่ายเข้าไลน์', have: c => c.stockAll > 0 },
          { d: 'สโตร์', l: 'กดส่ง → ตัดสต็อก', have: c => c.shipped > 0 && c.stockConsume > 5 },
        ],
        now: 1, full: 2, to: '/line-stock',
        nowTxt: 'ขาเข้าบันทึกอัตโนมัติแล้ว แต่ขาออกแทบไม่ถูกกด ยอดคงเหลือจึงสูงกว่าของจริงเรื่อยๆ',
        fullTxt: 'ยอดในระบบ = ของบนชั้นจริง → เลิกนับสต็อกซ้ำเพื่อเช็คว่าระบบถูกไหม และเชื่อยอดไปวางแผนผลิตได้',
        need: ['กดยืนยันส่งทุกรอบ', 'ตั้งเลขพาร์ทลูกค้า ↔ เลข SAP ให้ครบ'],
        demo: D => ({
          head: `สต็อกในระบบ = ของบนชั้นจริง (ต่างกัน ${D.f('s1', 0.1, 0.8, 1)}%)`,
          tone: 'ok',
          lines: [
            `ขาเข้าเดือนนี้ ${(D.n('s2', 40, 55) * 1000).toLocaleString()} ชิ้น · ขาออก ${(D.n('s3', 38, 52) * 1000).toLocaleString()} ชิ้น`,
            `ตรวจนับจริงครั้งล่าสุด ต่างจากระบบ ${D.n('s4', 3, 25)} ชิ้น`,
            `ทุกรายการตัดสต็อกผูกกลับไปที่ "รอบส่งใบไหน ลูกค้าใคร" ได้ 100%`,
            `ประหยัดเวลานับสต็อกซ้ำ ~${D.n('s5', 4, 9)} คน-วัน/เดือน`,
          ],
          note: `พอสต็อกเชื่อถือได้ ฝ่ายวางแผนก็เอาไปวางแผนผลิตต่อได้ทันที ไม่ต้องเผื่อความไม่แน่นอนอีกชั้น`,
        }),
      },
    ],
  },
  {
    key: 'cost', icon: '💰', label: 'ต้นทุน & คน',
    qs: [
      {
        q: 'เวลาที่เสียไปกับของเสีย คิดเป็นเงินเท่าไหร่?',
        chain: [
          { d: 'ผลิต', l: 'เวลาหยุด + ของเสีย', have: c => c.dtUnplannedRows > 0 },
          { d: 'บัญชี', l: 'Activity Rate (บาท/ชม.)', have: c => c.rateRows > 0 },
          { d: 'บัญชี', l: 'ต้นทุนต่อชิ้น', have: c => c.partsWithCost > 0 },
        ],
        now: 1, full: 2, to: '/org-setup',
        nowTxt: 'วัดเป็น "นาที" และ "ชิ้น" ได้แม่นแล้ว แต่แปลงเป็นบาทไม่ได้ เพราะยังไม่มีใครกรอกค่าแรง/ต้นทุน',
        fullTxt: 'ทุกความสูญเสียขึ้นเป็นบาทอัตโนมัติ → คุยกับผู้บริหารและบัญชีด้วยภาษาเดียวกัน',
        need: ['กรอก Activity Rate ต่อ cost center', 'กรอกต้นทุนต่อชิ้นใน Parts Master'],
        demo: D => ({
          head: `ความสูญเสียเดือนนี้ = ${D.money('c1', 900000, 1600000).toLocaleString()} บาท (แยกได้ว่ามาจากไหน)`,
          tone: 'bad',
          lines: [
            `⏱ เวลาหยุดนอกแผน ${D.n('c2', 200, 330)} ชม. = ${D.money('c3', 500000, 900000).toLocaleString()} บาท`,
            `🚫 ของเสีย ${D.n('c4', 800, 2400)} ชิ้น = ${D.money('c5', 180000, 420000).toLocaleString()} บาท`,
            `🔧 ค่าซ่อม + อะไหล่ = ${D.money('c6', 90000, 220000).toLocaleString()} บาท`,
            `🏭 เจาะได้ถึงระดับไลน์/เครื่อง/กะ ว่าเงินหายที่ไหนมากที่สุด`,
          ],
          note: `ตัวเลขนี้คุยกับบัญชีได้ เพราะมาจาก Activity Rate ชุดเดียวกับที่บัญชีใช้ ไม่ใช่ตัวเลขที่ฝ่ายผลิตคิดเอง`,
        }),
      },
      {
        q: 'คนคนนี้ยืนจุดนี้ได้มั้ย — ถ้าวันนี้ขาด ใครแทนได้?',
        chain: [
          { d: 'คน', l: 'สกิลรายคน', have: c => c.skills > 0 },
          { d: 'คน', l: 'ทักษะที่จุดงานต้องการ', have: c => c.empActive > 0 },
          { d: 'คน', l: 'เช็คชื่อวันนี้', have: c => c.checkinLogs > 0 },
          { d: 'คน', l: 'ประวัติอบรม OJT', have: c => (c.ojt || 0) > 0 },
        ],
        now: 2, full: 3, to: '/operator',
        nowTxt: 'จับคู่คน ↔ จุดงานด้วยคะแนนทักษะได้แล้ว และเห็นว่าใครขาดวันนี้',
        fullTxt: 'เตือนล่วงหน้าว่า "จุดงานนี้มีคนทำได้คนเดียวทั้งโรงงาน" → วางแผนอบรมก่อนที่คนคนนั้นจะลาออก/ลาป่วย',
        need: ['บันทึกการอบรม OJT ทุกครั้งที่สอนงาน'],
        demo: D => ({
          head: `⚠️ ${D.n('k1', 2, 5)} จุดงานมีคนทำได้ "คนเดียวทั้งโรงงาน" — ความเสี่ยงที่มองไม่เห็น`,
          tone: 'warn',
          lines: [
            `${D.line('k1')} จุด OP${D.n('k2', 2, 6)} — มีคนผ่านเกณฑ์คนเดียว (สกิล ${D.n('k3', 76, 92)})`,
            `ถ้าคนนี้ลา/ลาออก → ไลน์เดินไม่ได้ทันที ไม่มีใครแทน`,
            `คนที่ใกล้เคียงที่สุด สกิล ${D.n('k4', 45, 65)} — ขาดอีก ${D.n('k5', 12, 30)} คะแนน`,
            `ระบบเสนอ: อบรม ${D.n('k6', 2, 3)} คน ใช้เวลาประมาณ ${D.n('k7', 3, 8)} สัปดาห์`,
          ],
          note: `ป้องกันก่อนเกิด — ไม่ใช่รู้ตอนคนลาแล้วไลน์หยุด · ข้อมูลนี้มาจากสกิล + จุดงาน + เช็คชื่อ ที่มีอยู่แล้ว`,
        }),
      },
      {
        q: 'การปรับปรุงที่ลงแรงไป คุ้มมั้ย?',
        chain: [
          { d: 'ผลิต', l: 'โปรเจคปรับปรุง', have: c => c.improvements > 0 },
          { d: 'ผลิต', l: 'ตัวเลขก่อน-หลัง', have: c => c.dtUnplannedRows > 0 },
          { d: 'บัญชี', l: 'อัตราค่าใช้จ่าย', have: c => c.rateRows > 0 },
        ],
        now: 1, full: 2, to: '/improvements',
        nowTxt: 'ยังไม่มีโปรเจคในระบบเลย ผลการปรับปรุงจึงยังไม่ถูกวัด',
        fullTxt: 'ทุกโปรเจคมีตัวเลขก่อน-หลังที่ระบบดึงจากข้อมูลจริงเอง + คิดเป็นบาท/เดือน และระยะคืนทุน — ไม่ต้องกรอกผลเอง',
        need: ['เปิดโปรเจคปรับปรุงผูกกับปัญหาจริง', 'กรอก Activity Rate'],
        demo: D => ({
          head: `${D.n('i1', 8, 16)} โปรเจคปีนี้ · ประหยัดจริง ${D.f('i2', 2.4, 4.8, 2)} ล้านบาท/ปี`,
          tone: 'ok',
          lines: [
            `อันดับ 1: ลดเวลา setup ${D.line('i1')} จาก ${D.n('i3', 15, 25)} → ${D.n('i4', 5, 10)} นาที = ${D.f('i5', 0.7, 1.3, 2)} ล้าน/ปี`,
            `อันดับ 2: ลด "${D.def('i1')}" ที่ ${D.mach('i1')} ลง ${D.n('i6', 40, 75)}% = ${D.f('i7', 0.4, 0.9, 2)} ล้าน/ปี`,
            `ระยะคืนทุนเฉลี่ย ${D.f('i8', 1.5, 4.0, 1)} เดือน`,
            `⚠️ ${D.n('i9', 1, 3)} โปรเจคผลไม่ถึงเป้า — ระบบชี้ให้เห็นด้วย ไม่ใช่โชว์แต่ที่สำเร็จ`,
          ],
          note: `ตัวเลขก่อน-หลังระบบดึงจากข้อมูลจริงเอง (downtime/ของเสียช่วงก่อนและหลังวันเริ่มโปรเจค) — ไม่ใช่ให้คนทำโปรเจคกรอกผลตัวเอง`,
        }),
      },
    ],
  },
];

/* ── โหลดข้อมูลทั้งหมด (นับจริงทุกตัว) ────────────────────────────────────────────────── */
async function loadAll() {
  const today = getWorkDate();
  const from = dayAdd(today, -(WINDOW_DAYS - 1));

  const [
    sess, sessClosed, ord, ordConfirmed, mo, pmPlans, inspections, spare, improvements,
    shipOrders, shipped, stockAll, stockConsume, machinesProd, dies, jigsReal, prodAll, prodWithCt,
    partsAll, partsWithCost,
    fourM, lpaAudits, qaSheets, qaMeas, qaNcr, qaParts, linesAll, linesWithCc, empActive, checkinLogs,
  ] = await Promise.all([
    cnt(supabaseDR, 'production_sessions'),
    cnt(supabaseDR, 'production_sessions', q => q.eq('status', 'closed')),
    cnt(supabaseDR, 'prod_orders'),
    cnt(supabaseDR, 'prod_orders', q => q.eq('status', 'confirmed')),
    cnt(supabaseDR, 'mtn_orders'),
    cnt(supabaseDR, 'pm_plans'),
    cnt(supabaseDR, 'inspections'),
    cnt(supabaseDR, 'mtn_spare_parts'),
    cnt(supabaseDR, 'improvements'),
    cnt(supabaseDR, 'customer_shipping_orders'),
    cnt(supabaseDR, 'customer_shipping_orders', q => q.eq('status', 'shipped')),
    cnt(supabaseDR, 'line_stock_transactions'),
    cnt(supabaseDR, 'line_stock_transactions', q => q.eq('type', 'consume')),
    cnt(supabaseDR, 'machines', q => q.eq('is_active', true).eq('equipment_kind', 'machine')),
    cnt(supabaseDR, 'machines', q => q.eq('is_active', true).eq('equipment_kind', 'die')),
    cnt(supabaseDR, 'jigs', q => q.is('machine_id', null)),
    cnt(supabaseDR, 'dr_products'),
    cnt(supabaseDR, 'dr_products', q => q.gt('cycle_time_sec', 0)),
    cnt(supabaseDR, 'parts_master'),
    cnt(supabaseDR, 'parts_master', q => q.or('standard_cost.gt.0,material_cost.gt.0')),
    cnt(supabase, 'four_m_logs'),
    cnt(supabase, 'lpa_audits'),
    cnt(supabase, 'qa_inspection_sheets'),
    cnt(supabase, 'qa_measurements'),
    cnt(supabase, 'qa_ncr'),
    cnt(supabase, 'qa_parts'),
    cnt(supabase, 'production_lines'),
    cnt(supabase, 'production_lines', q => q.not('cost_center', 'is', null).neq('cost_center', '')),
    cnt(supabase, 'employees', q => q.eq('is_active', true)),
    cnt(supabase, 'daily_production_logs'),
  ]);
  /* 2 ตัวนี้ใช้เฉพาะแท็บ "มิติที่มองเห็นได้" (สายข้อมูลพยากรณ์/คน) — แยกออกมาให้อ่านง่าย */
  const [forecasts, skills, ojt] = await Promise.all([
    cnt(supabaseDR, 'customer_forecasts'),
    cnt(supabase, 'employee_skills'),
    cnt(supabase, 'ojt_trainings'),
  ]);

  /* ── ชื่อจริงสำหรับ "โหมดสาธิต" ────────────────────────────────────────────────────
     จำลองเฉพาะ *ตัวเลข* แต่ใช้ **ชื่อไลน์/เครื่อง/สินค้า/ลูกค้าของจริง** เพื่อให้ตัวอย่าง
     ที่โชว์หัวหน้าดูเป็นโรงงานเรา ไม่ใช่ demo ลอยๆ ของ vendor
     ⚠️ ล้มเหลวต้องไม่ทำหน้าพัง → .catch คืน [] แล้วตัวจำลองใช้ค่า fallback แทน */
  const arr = (p, f) => p.then(r => (r.data || []).map(f).filter(Boolean)).catch(() => []);
  const [eLines, eMachines, eProducts, eCustomers, eDt, eDef] = await Promise.all([
    arr(supabase.from('production_lines').select('name').limit(40), x => x.name),
    arr(supabaseDR.from('machines').select('machine_no').eq('is_active', true).eq('equipment_kind', 'machine').limit(60), x => x.machine_no),
    supabaseDR.from('dr_products').select('mat_no, name, line_name').limit(40).then(r => r.data || []).catch(() => []),
    arr(supabaseDR.from('customer_shipping_orders').select('customer').not('customer', 'is', null).limit(300), x => x.customer)
      .then(v => [...new Set(v)]),
    arr(supabaseDR.from('dr_downtime_types').select('name_th').eq('is_active', true).limit(40), x => x.name_th),
    arr(supabaseDR.from('dr_defect_types').select('name_th').eq('is_active', true).limit(40), x => x.name_th),
  ]);
  const ents = { lines: eLines, machines: eMachines, products: eProducts, customers: eCustomers, dtTypes: eDt, defTypes: eDef };

  /* ── loss ที่วัดได้จริงในหน้าต่าง 30 วัน (ใช้คิดเงินในแท็บ ROI) ── */
  const { data: winSess } = await supabaseDR.from('production_sessions')
    .select('id, work_date').gte('work_date', from).lte('work_date', today);
  const ids = (winSess || []).map(s => s.id);

  const [dts, defs, rates] = await Promise.all([
    ids.length ? inChunks(ids, c => supabaseDR.from('downtime_logs')
      .select('session_id, duration_min, started_at, ended_at, dr_downtime_types(category)').in('session_id', c)) : [],
    ids.length ? inChunks(ids, c => supabaseDR.from('defect_logs')
      .select('session_id, qty_ng, qty_suspect').in('session_id', c)) : [],
    supabase.from('cost_center_rates').select('cost_center, dl_rate, oh_rate, dp_rate, effective_from')
      .then(r => r.data || []).catch(() => []),
  ]);

  let unplannedMin = 0, plannedMin = 0;
  dts.forEach(d => {
    const m = dtMinOf(d);
    if (d.dr_downtime_types?.category === 'planned') plannedMin += m; else unplannedMin += m;
  });
  const ngQty = defs.reduce((a, d) => a + (+d.qty_ng || 0) + (+d.qty_suspect || 0), 0);
  const sessWithNg = new Set(defs.map(d => d.session_id)).size;

  return {
    c: {
      sess, sessClosed, ord, ordConfirmed, mo, pmPlans, inspections, spare, improvements,
      shipOrders, shipped, stockAll, stockConsume, machinesProd, dies, jigsReal, prodAll, prodWithCt,
      partsAll, partsWithCost, fourM, lpaAudits, qaSheets, qaMeas, qaNcr, qaParts,
      linesAll, linesWithCc, empActive, checkinLogs, forecasts, skills, ojt,
      rateRows: rates?.length || 0,   // มี Activity Rate กี่ cost center — สายข้อมูล "คิดเป็นเงิน" ขาดตรงนี้
      /* ตัวหาร/ตัวตั้งที่ต้องนับจากหน้าต่างเดียวกัน (ไม่ใช่ทั้งฐาน) */
      sessWin: ids.length, sessWithNg, dtUnplannedRows: dts.filter(d => d.dr_downtime_types?.category !== 'planned').length,
    },
    loss: { unplannedMin, plannedMin, ngQty, sessWin: ids.length, from, to: today },
    rates, ents,
  };
}

/* ══ 🔬 เจาะปัญหา 1 กะจริง — OEE → 4M → ย้อนกลับหาเอกสารออกแบบ ═══════════════════════════
   ทำไมต้องมี: 3 แท็บแรกตอบ "ภาพรวมมองเห็นอะไรได้" แต่ผู้บริหารมักถามต่อว่า
   "แล้วมันช่วยแก้ของจริงยังไง" → แท็บนี้เดินให้ดูทีละชั้นบน **กะที่แย่ที่สุดที่เกิดขึ้นจริง**

   ชั้น 1 กะนี้เสียหายเท่าไหร่ (A/P/Q)  → ชั้น 2 เสียไปกับ 4M ตัวไหน
   → ชั้น 3 ย้อนกลับไปถามเอกสารออกแบบ (PFC → FMEA → Control Plan) ว่า "เคยคาดไว้มั้ย"
   → ชั้น 4 สรุปว่าต้องไปแก้ที่ไหน

   กฎที่ยึด:
   • **ไม่ hardcode กะตัวอย่าง** — เลือกกะแย่สุดใน 45 วันล่าสุดสดทุกครั้งที่เปิด
     (hardcode ไว้ = พอข้อมูลเดินหน้า ตัวอย่างจะเน่าและกลายเป็นข้อมูลเท็จ)
   • **ชั้น 1-2 = ของจริงล้วน** ป้ายเขียว · ชั้น 3 อ่านจากโมดูล PE Core Tools (`/pe-docs`)
     **เช็คแบบผูกกับพาร์ท/ไลน์ของกะนั้น ห้ามนับรวมทั้งระบบ** — ทั้งระบบมี FMEA แล้วก็จริง
     แต่ถ้าเป็นของคนละพาร์ท การขึ้นว่า "มีข้อมูลแล้ว" คือตอบผิดคำถาม
     (พาร์ทนี้ยังไม่มี → บอกตรงๆ + ชี้ทางไปลง · โหมดสาธิตค่อยเติมตัวอย่างคำตอบ พร้อมป้ายม่วง)
   • **โหลดตอนเปิดแท็บเท่านั้น** (lazy) — ไม่ถ่วงหน้าแรกที่คนส่วนใหญ่เปิดดู
   ═══════════════════════════════════════════════════════════════════════════════════════ */
const DEEP_DAYS = 45;            // หน้าต่างหากะตัวอย่าง — กว้างพอให้เจอกะที่มีทั้ง DT และของเสีย

const FOUR_M = [
  { key: 'machine', icon: '⚙️', label: 'Machine', th: 'เครื่องจักร', color: '#ef4444' },
  { key: 'method', icon: '📋', label: 'Method', th: 'วิธีทำงาน', color: '#f59e0b' },
  { key: 'material', icon: '🧱', label: 'Material', th: 'วัตถุดิบ', color: '#3b82f6' },
  { key: 'man', icon: '👷', label: 'Man', th: 'คน', color: '#a78bfa' },
];

/* ⚠️ ระบบ**ยังไม่มีแกน 4M** ที่ master ของ downtime/defect (มีแต่ six_big_loss / waste_type)
   → ต้องเดาจากข้อความที่พนักงานพิมพ์ · เรียงจากเจาะจงไปกว้าง ตัวแรกที่ match ชนะ
   หน้าจอจึงต้อง (ก) ติดป้ายว่าเป็นการจัดกลุ่มจากข้อความ (ข) โชว์ข้อความจริงใต้ทุกกลุ่มให้คนตรวจได้
   (ค) โชว์รายการที่จัดไม่ได้ ห้ามยัดมั่วเข้ากลุ่มใดกลุ่มหนึ่ง */
const FOUR_M_WORDS = [
  { k: 'man', w: ['ขาดคน', 'คนไม่พอ', 'พนักงานลา', 'รอคน', 'อบรม', 'สกิล', 'พนักงาน'] },
  { k: 'material', w: ['material', 'วัตถุดิบ', 'รอของ', 'ของหมด', 'พาร์ท', 'ชิ้นส่วน', 'เหล็ก', 'คอยล์'] },
  { k: 'method', w: ['qa', 'ตรวจสอบ', 'เปลี่ยนรุ่น', 'setup', 'เซ็ต', 'ปรับตั้ง', 'ประชุม', '5ส', 'นับสต', 'ไม่มีแผน', 'เอกสาร', 'รออนุมัติ'] },
  { k: 'machine', w: ['robot', 'โรบอท', 'plc', 'เครื่อง', 'แม่พิมพ์', 'die', 'jig', 'จิ๊ก', 'ไฟฟ้า', 'ลมรั่ว', 'สายลม', 'ไฮดรอ', 'มอเตอร์', 'เซนเซอร์', 'alarm', 'error', 'สายไฟ', 'กิ๊บ', 'ชำรุด', 'หัก', 'รั่ว'] },
];

/* กลุ่มคำเรียกอุปกรณ์เดียวกันที่คนพิมพ์ต่างกัน (ไทย/อังกฤษ/รหัส) — ใช้จับว่า
   "ของเสีย" กับ "เครื่องที่เสีย" ในกะเดียวกัน พูดถึงอุปกรณ์ตัวเดียวกันหรือเปล่า
   ⚠️ เป็นการจับคู่จาก **ข้อความ** ไม่ใช่ความสัมพันธ์ที่ระบบยืนยัน → จอต้องเขียนกำกับเสมอ */
const EQUIP_SYN = [
  { name: 'โรบอท', w: ['robot', 'โรบอท', 'หุ่นยนต์', 'rb_', 'rb-'] },
  { name: 'แม่พิมพ์', w: ['แม่พิมพ์', 'die-', 'die '] },
  { name: 'จิ๊ก', w: ['jig', 'จิ๊ก'] },
  { name: 'PLC / ระบบควบคุม', w: ['plc', 'ระบบควบคุม'] },
  { name: 'เซนเซอร์', w: ['sensor', 'เซนเซอร์'] },
  { name: 'มอเตอร์', w: ['motor', 'มอเตอร์'] },
];

/* คืน key ของ 4M · 'quality' = เป็นการสูญเสียฝั่งคุณภาพ (ไปรวมกับของเสีย) · null = จัดไม่ได้ */
function fourMOf(row) {
  const sbl = row.six_big_loss || null;
  if (sbl === 'defect' || sbl === 'startup') return 'quality';
  const txt = `${row.dt_type || ''} ${row.description || ''}`.toLowerCase();
  for (const g of FOUR_M_WORDS) if (g.w.some(w => txt.includes(w))) return g.k;
  /* master ที่หัวหน้าตั้งไว้เอง เชื่อถือได้กว่าการเดาคำ — ใช้เป็นตาข่ายรับท้าย */
  if (sbl === 'breakdown') return 'machine';
  if (sbl === 'setup') return 'method';
  return null;
}

/* หา "กะที่ควรเอามาเจาะ" = OEE ต่ำสุด แต่ต้องมีเนื้อให้เจาะจริง (มี DT หลายรายการ + มีของเสีย)
   กะที่ OEE 0 เพราะลง DT ก้อนเดียวทั้งกะ ไม่มีอะไรให้เรียนรู้ → ให้คะแนนต่ำกว่า */
function pickDeepSession(cands, dtBy, defBy) {
  return [...cands].map(s => {
    const dt = dtBy[s.id] || [], df = defBy[s.id] || [];
    const kinds = new Set(dt.map(d => fourMOf(d)).filter(Boolean)).size;
    return { s, dt, df, score: (dt.length >= 3 ? 4 : 0) + (df.length > 0 ? 3 : 0) + kinds };
  }).sort((a, b) => b.score - a.score || (+a.s.oee) - (+b.s.oee))[0];
}

async function loadDeepDive() {
  const today = getWorkDate();
  const from = dayAdd(today, -DEEP_DAYS);

  const { data: cands, error } = await supabaseDR.from('production_sessions')
    .select('id, line_name, work_date, shift, shift_min, oee, oee_a, oee_p, oee_q, actual_qty, target_qty')
    .eq('status', 'closed').not('oee', 'is', null)
    .gte('work_date', from).lte('work_date', today)
    .order('oee', { ascending: true }).limit(25);
  if (error) throw new Error(error.message);
  if (!cands?.length) return { empty: true, from, to: today };

  const ids = cands.map(s => s.id);
  const [dtRaw, defRaw] = await Promise.all([
    inChunks(ids, c => supabaseDR.from('downtime_logs')
      .select('session_id, duration_min, started_at, ended_at, machine_no, description, dr_downtime_types(name_th, category, six_big_loss, waste_type)')
      .in('session_id', c)),
    inChunks(ids, c => supabaseDR.from('defect_logs')
      .select('session_id, qty_ng, qty_suspect, description, dr_defect_types(name_th, six_big_loss)')
      .in('session_id', c)),
  ]);

  /* แบนโครงสร้าง nested ให้ fourMOf อ่านง่าย + คิดนาทีด้วยกฎเดียวกับที่อื่น */
  const dtBy = {}, defBy = {};
  dtRaw.forEach(d => {
    const t = d.dr_downtime_types || {};
    (dtBy[d.session_id] ||= []).push({
      min: dtMinOf(d), machine_no: d.machine_no, description: d.description,
      dt_type: t.name_th, category: t.category, six_big_loss: t.six_big_loss, waste_type: t.waste_type,
    });
  });
  defRaw.forEach(f => {
    const t = f.dr_defect_types || {};
    (defBy[f.session_id] ||= []).push({
      qty: (+f.qty_ng || 0) + (+f.qty_suspect || 0), description: f.description,
      def_type: t.name_th, six_big_loss: t.six_big_loss,
    });
  });

  const best = pickDeepSession(cands, dtBy, defBy);
  const S = best.s;

  /* ใบผลิต + CT ของสินค้าที่วิ่งในกะนั้น (ใช้บอกว่า "ควรได้เท่าไหร่")
     dr_products ไม่มี FK กับ prod_orders → ต้องดึงแยกแล้ว map ด้วย mat_no เอง */
  const { data: ords } = await supabaseDR.from('prod_orders')
    .select('prod_no, mat_no, qty, qty_target, qty_ok, qty_actual, status, machine_no')
    .eq('session_id', S.id);
  const mats = [...new Set((ords || []).map(o => o.mat_no).filter(Boolean))];
  const { data: prods } = mats.length
    ? await supabaseDR.from('dr_products').select('mat_no, name, cycle_time_sec, line_name').in('mat_no', mats)
    : { data: [] };
  const pByMat = Object.fromEntries((prods || []).map(p => [p.mat_no, p]));

  /* ── สถานะเอกสารออกแบบของ "พาร์ทที่ผลิตในกะนี้" (โมดูล PE Core Tools · Main) ──
     ⚠️ ต้องเช็คแบบ **ผูกกับพาร์ท/ไลน์ของกะนี้** ห้ามนับรวมทั้งระบบ —
     ทั้งระบบมี FMEA อยู่แล้วก็จริง แต่ถ้าเป็นของคนละพาร์ท การขึ้นว่า "มีข้อมูลแล้ว"
     คือการตอบผิดคำถาม (คำถามคือ "อาการของกะ *นี้* เคยคาดไว้มั้ย")
     จับคู่ด้วย mat_no ก่อน (ตรงตัวที่สุด) แล้วค่อย fallback ไปชื่อไลน์ — pe_doc_sets.mat_no
     ยังว่างได้ในข้อมูลจริง จึงพึ่ง mat_no อย่างเดียวไม่ได้ */
  const { data: allSets } = await supabase.from('pe_doc_sets')
    .select('id, part_no, mat_no, part_name, line_name, status').limit(500);
  const norm = (x) => (x || '').trim().toLowerCase();
  const matSet = new Set(mats.map(norm));
  const mySet = (allSets || []).find(s => s.mat_no && matSet.has(norm(s.mat_no)))
    || (allSets || []).find(s => norm(s.line_name) === norm(S.line_name))
    || null;

  let peScoped = { proc: 0, fmea: 0, cp: 0 };
  if (mySet) {
    const { data: procs } = await supabase.from('pe_processes').select('id').eq('set_id', mySet.id);
    const pids = (procs || []).map(p => p.id);
    const [f, c] = pids.length
      ? await Promise.all([
        cnt(supabase, 'pe_fmea_items', q => q.in('process_id', pids)),
        cnt(supabase, 'pe_cp_items', q => q.in('process_id', pids)),
      ])
      : [0, 0];
    peScoped = { proc: pids.length, fmea: f, cp: c };
  }

  return {
    empty: false, from, to: today,
    sess: S, dt: best.dt, def: best.df,
    orders: (ords || []).map(o => ({ ...o, prod: pByMat[o.mat_no] || null })),
    /* set = ชุดเอกสารของพาร์ทนี้ (null = ยังไม่มี) · totalSets = ทั้งระบบมีกี่พาร์ทแล้ว (ใช้บอกบริบท) */
    pe: { set: mySet, totalSets: (allSets || []).length, ...peScoped },
  };
}

/* ── UI atoms ─────────────────────────────────────────────────────────────────────────── */
const cardSt = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 14 };
const Badge = ({ tone, children }) => {
  const c = tone === 'real' ? '#22c55e' : tone === 'guess' ? '#f59e0b' : tone === 'sim' ? '#a78bfa' : 'var(--muted)';
  const dashed = tone === 'guess' || tone === 'sim';   // ของที่ "ยังไม่จริง" ใช้เส้นประเสมอ
  return <span style={{
    fontSize: 10.5, fontWeight: 700, color: c, whiteSpace: 'nowrap',
    border: `1px ${dashed ? 'dashed' : 'solid'} ${c}`, borderRadius: 4, padding: '1px 6px',
  }}>{children}</span>;
};

/* แถบความครบ 1 ตัวชี้วัด — ไม่มีตัวหาร (total=null) ก็ยังบอกจำนวนได้ ห้ามซ่อน */
function SignalRow({ s, navigate }) {
  const p = s.total ? pct(s.now ?? 0, s.total) : null;
  const failed = s.now == null;
  const col = failed ? 'var(--muted)' : p == null ? 'var(--text2)' : p >= 90 ? '#22c55e' : p >= 40 ? '#f59e0b' : '#ef4444';
  return (
    <div style={{ padding: '7px 0', borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={{ flex: 1, minWidth: 140, fontSize: 12.5 }}>{s.label}</span>
        <span style={{ fontSize: 13.5, fontWeight: 800, color: col, fontVariantNumeric: 'tabular-nums' }}>
          {failed ? 'โหลดไม่ได้' : fmtNum(s.now)}{s.total ? <span style={{ color: 'var(--muted)', fontWeight: 600 }}> / {fmtNum(s.total)}</span> : null}
          <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}> {s.unit}</span>
        </span>
        {p != null && <span style={{ fontSize: 12, fontWeight: 800, color: col, minWidth: 42, textAlign: 'right' }}>{p.toFixed(0)}%</span>}
      </div>
      {p != null && (
        <div style={{ height: 5, background: 'var(--bg3)', borderRadius: 999, overflow: 'hidden', marginTop: 4 }}>
          <div style={{ width: `${p}%`, height: '100%', background: col, borderRadius: 999 }} />
        </div>
      )}
      {s.gap && !failed && (
        <div style={{ fontSize: 11.5, color: '#f59e0b', marginTop: 4 }}>
          ⚠ {s.gap}
          {s.gapTo && <button onClick={() => navigate(s.gapTo)} style={{
            marginLeft: 6, background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            color: 'var(--accent)', fontSize: 11.5, fontWeight: 700, textDecoration: 'underline',
          }}>ไปจัดการ →</button>}
        </div>
      )}
    </div>
  );
}

/* ป้ายระดับความสามารถ — ใช้ทั้งแท็บมิติและแท็บบันได ห้ามวาดเองซ้ำ */
function LevelPill({ n, dim }) {
  const L = lv(n);
  const col = ['#94a3b8', '#38bdf8', '#a78bfa', '#22c55e'][n - 1] || 'var(--muted)';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700,
      color: dim ? 'var(--muted)' : col, border: `1px solid ${dim ? 'var(--border2)' : col}`,
      borderRadius: 999, padding: '2px 9px', whiteSpace: 'nowrap', opacity: dim ? 0.75 : 1,
    }}>{L.icon} {L.name}</span>
  );
}

/* ── แท็บ: มิติที่มองเห็นได้เมื่อข้อมูลเชื่อมกัน ─────────────────────────────────────────── */
function DimensionTab({ c, ents, demoOn, day, navigate, isMobile }) {
  const [only, setOnly] = useState('all');
  const dims = only === 'all' ? DIMENSIONS : DIMENSIONS.filter(d => d.key === only);
  const D = useMemo(() => makeDemo(ents || {}, day), [ents, day]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        {[{ key: 'all', icon: '🔗', label: 'ทุกมิติ' }, ...DIMENSIONS].map(d => {
          const on = only === d.key;
          return (
            <button key={d.key} onClick={() => setOnly(d.key)} style={{
              fontSize: 13, fontWeight: 700, padding: '6px 13px', borderRadius: 999, cursor: 'pointer',
              background: on ? 'var(--accent)' : 'var(--bg3)', color: on ? '#08120a' : 'var(--text)',
              border: `1px solid ${on ? 'var(--accent)' : 'var(--border2)'}`,
            }}>{d.icon} {d.label}</button>
          );
        })}
      </div>

      {dims.map(dim => (
        <div key={dim.key} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 15.5, fontWeight: 800, marginTop: 2 }}>{dim.icon} {dim.label}</div>
          {dim.qs.map((q, qi) => {
            const missing = q.chain.filter(s => !s.have(c)).length;
            const gained = q.full > q.now;
            return (
              <div key={qi} style={{ ...cardSt, borderLeft: `4px solid ${gained ? 'var(--accent2)' : 'var(--accent)'}` }}>
                <div style={{ fontSize: 14.5, fontWeight: 700, lineHeight: 1.45, marginBottom: 9 }}>“{q.q}”</div>

                {/* สายข้อมูล — หัวใจของหน้านี้: ให้เห็นว่าคำตอบต้องต่อจากหลายแผนก และขาดตรงไหน */}
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 5 }}>
                  ต้องต่อข้อมูลจาก {q.chain.length} จุด{missing > 0 && <b style={{ color: '#f59e0b' }}> · ยังขาด {missing}</b>}
                </div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center', marginBottom: 11 }}>
                  {q.chain.map((s, si) => {
                    const ok = s.have(c);
                    /* โหมดสาธิต: จุดที่ยังไม่มีข้อมูลจริง แสดงเป็น "ต่อติดแบบจำลอง" (ม่วง)
                       — ห้ามทำให้ดูเหมือนเขียวของจริง ไม่งั้นคนดูแยกไม่ออกว่าอันไหนมีจริง */
                    const sim = !ok && demoOn;
                    const col = ok ? '#22c55e' : sim ? '#a78bfa' : 'var(--muted)';
                    return (
                      <span key={si} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        {si > 0 && <span style={{ color: 'var(--muted)', fontSize: 12 }}>→</span>}
                        <span title={`ข้อมูลจาก: ${s.d}${sim ? ' (จำลองในโหมดสาธิต)' : ''}`} style={{
                          fontSize: 11.5, fontWeight: 600, borderRadius: 7, padding: '3px 8px', whiteSpace: 'nowrap',
                          color: col,
                          background: ok ? 'rgba(34,197,94,0.10)' : sim ? 'rgba(167,139,250,0.12)' : 'transparent',
                          border: `1px ${ok ? 'solid' : 'dashed'} ${ok ? 'rgba(34,197,94,0.5)' : sim ? '#a78bfa' : 'var(--border2)'}`,
                        }}>
                          {ok ? '✓' : sim ? '🧪' : '○'} {s.l}
                          <span style={{ opacity: 0.65, marginLeft: 4 }}>· {s.d}</span>
                        </span>
                      </span>
                    );
                  })}
                </div>

                <div style={{ display: 'grid', gap: 12, gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', alignContent: 'start' }}>
                  <div style={{ background: 'var(--bg3)', borderRadius: 8, padding: '9px 11px' }}>
                    <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap', marginBottom: 5 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700 }}>วันนี้</span>
                      <LevelPill n={q.now} /><Badge tone="real">วัดจริง</Badge>
                    </div>
                    <div style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--text2)' }}>{q.nowTxt}</div>
                  </div>
                  <div style={{ background: 'var(--bg3)', borderRadius: 8, padding: '9px 11px' }}>
                    <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap', marginBottom: 5 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700 }}>เมื่อข้อมูลเชื่อมครบ</span>
                      <LevelPill n={q.full} /><Badge tone="guess">คาดการณ์</Badge>
                    </div>
                    <div style={{ fontSize: 12.5, lineHeight: 1.55 }}>{q.fullTxt}</div>
                  </div>
                </div>

                {/* ── ตัวอย่างคำตอบ (โหมดสาธิต) — ม่วง+ขอบประ ให้แยกออกจากของจริงทันทีที่เห็น ── */}
                {demoOn && q.demo && (() => {
                  const dm = q.demo(D);
                  const tc = dm.tone === 'bad' ? '#ef4444' : dm.tone === 'warn' ? '#f59e0b' : '#22c55e';
                  return (
                    <div style={{
                      marginTop: 11, borderRadius: 9, padding: '10px 12px',
                      background: 'rgba(167,139,250,0.07)', border: '1px dashed #a78bfa',
                    }}>
                      <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap', marginBottom: 7 }}>
                        <span style={{ fontSize: 12, fontWeight: 800, color: '#a78bfa' }}>🧪 ตัวอย่างคำตอบเมื่อข้อมูลครบ</span>
                        <span style={{
                          fontSize: 10.5, fontWeight: 700, color: '#a78bfa',
                          border: '1px dashed #a78bfa', borderRadius: 4, padding: '1px 6px',
                        }}>ตัวเลขจำลอง · ชื่อไลน์/เครื่อง/ลูกค้าเป็นของจริง</span>
                      </div>
                      <div style={{ fontSize: 13.5, fontWeight: 800, color: tc, lineHeight: 1.45, marginBottom: 7 }}>{dm.head}</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {dm.lines.map((t, li) => (
                          <div key={li} style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--text2)' }}>{t}</div>
                        ))}
                      </div>
                      {dm.note && (
                        <div style={{
                          marginTop: 8, paddingTop: 7, borderTop: '1px solid var(--border)',
                          fontSize: 12, lineHeight: 1.55, fontStyle: 'italic',
                        }}>💡 {dm.note}</div>
                      )}
                    </div>
                  );
                })()}

                {q.need?.length > 0 && (
                  <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>
                    <b style={{ color: '#f59e0b' }}>ต้องเติมอะไรถึงจะไปถึง:</b> {q.need.join(' · ')}
                    <button onClick={() => navigate(q.to)} style={{
                      marginLeft: 8, background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                      color: 'var(--accent)', fontSize: 12, fontWeight: 700, textDecoration: 'underline',
                    }}>เปิดหน้าที่เกี่ยวข้อง →</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/* ── แท็บ: 4 ระดับความสามารถ ────────────────────────────────────────────────────────────
   ตอบคำถาม "predictive / prescriptive ต้องมีอะไรก่อน" ด้วยการนับคำถามจริงในแท็บมิติ */
function LadderTab({ c, navigate, isMobile }) {
  const all = DIMENSIONS.flatMap(d => d.qs.map(q => ({ ...q, dim: d })));
  const col = ['#94a3b8', '#38bdf8', '#a78bfa', '#22c55e'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ ...cardSt, fontSize: 12.5, lineHeight: 1.65 }}>
        ระดับที่สูงขึ้น <b>ไม่ได้มาจากซอฟต์แวร์เก่งขึ้น</b> แต่มาจาก <b>ข้อมูลครบขึ้นและเชื่อมกัน</b> ·
        ตัวเลขด้านล่างนับจาก {all.length} คำถามในแท็บ “มิติที่มองเห็นได้”
      </div>

      {LEVELS.map(L => {
        const nowAt = all.filter(q => q.now === L.n);
        const fullAt = all.filter(q => q.full === L.n);
        const c0 = col[L.n - 1];
        return (
          <div key={L.n} style={{ ...cardSt, borderLeft: `4px solid ${c0}` }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 3 }}>
              <span style={{ fontSize: 22 }}>{L.icon}</span>
              <span style={{ fontSize: 16, fontWeight: 800 }}>ระดับ {L.n} · {L.name}</span>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{L.en}</span>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text2)', marginBottom: 10 }}>{L.desc}</div>

            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', alignContent: 'start' }}>
              <div style={{ background: 'var(--bg3)', borderRadius: 8, padding: '9px 11px' }}>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 5 }}>
                  วันนี้อยู่ระดับนี้ <span style={{ color: c0, fontSize: 15 }}>{nowAt.length}</span> คำถาม <Badge tone="real">วัดจริง</Badge>
                </div>
                {nowAt.length
                  ? <ul style={{ margin: 0, paddingLeft: 17, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {nowAt.map((q, i) => <li key={i} style={{ fontSize: 11.5, lineHeight: 1.5 }}>{q.dim.icon} {q.q}</li>)}
                  </ul>
                  : <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>— ยังไม่มีคำถามไหนอยู่ระดับนี้</div>}
              </div>
              <div style={{ background: 'var(--bg3)', borderRadius: 8, padding: '9px 11px' }}>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 5 }}>
                  จะขึ้นมาอยู่ระดับนี้ <span style={{ color: c0, fontSize: 15 }}>{fullAt.length}</span> คำถาม <Badge tone="guess">เมื่อข้อมูลครบ</Badge>
                </div>
                {fullAt.length
                  ? <ul style={{ margin: 0, paddingLeft: 17, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {fullAt.map((q, i) => <li key={i} style={{ fontSize: 11.5, lineHeight: 1.5 }}>{q.dim.icon} {q.q}</li>)}
                  </ul>
                  : <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>—</div>}
              </div>
            </div>
          </div>
        );
      })}

      {/* กุญแจที่ปลดล็อกได้เยอะที่สุด — นับว่าข้อมูลชิ้นไหนถูกใช้ในหลายคำถามที่สุด แล้วยังไม่มี */}
      <div style={{ ...cardSt, borderLeft: '4px solid #ef4444' }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 3 }}>🔑 ข้อมูลชิ้นไหนปลดล็อกได้เยอะที่สุด</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
          นับจากสายข้อมูลของทุกคำถาม — ชิ้นที่ยังไม่มี และถูกใช้ในหลายคำถามที่สุด ควรทำก่อน
        </div>
        {(() => {
          const tally = {};
          all.forEach(q => q.chain.forEach(s => {
            if (s.have(c)) return;
            const k = `${s.l}|${s.d}`;
            (tally[k] ||= { l: s.l, d: s.d, n: 0 }).n++;
          }));
          const list = Object.values(tally).sort((a, b) => b.n - a.n);
          if (!list.length) return <div style={{ fontSize: 13, color: '#22c55e' }}>✅ สายข้อมูลครบทุกจุดแล้ว</div>;
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {list.map((x, i) => (
                <div key={i} style={{
                  display: 'flex', gap: 9, alignItems: 'center',
                  background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8, padding: '7px 11px',
                }}>
                  <span style={{
                    fontSize: 13, fontWeight: 800, color: x.n >= 3 ? '#ef4444' : x.n === 2 ? '#f59e0b' : 'var(--muted)',
                    minWidth: 58, whiteSpace: 'nowrap',
                  }}>{x.n} คำถาม</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5 }}>
                    <b>{x.l}</b><span style={{ color: 'var(--muted)' }}> · {x.d}</span>
                  </span>
                </div>
              ))}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

/* ── แท็บ: ก่อน-หลัง รายแผนก ───────────────────────────────────────────────────────────── */
function DeptTab({ c, navigate, isMobile }) {
  const rows = DEPTS.map(d => {
    const sigs = d.signals(c);
    const scored = sigs.filter(s => s.total && s.now != null);
    const ready = scored.length ? scored.reduce((a, s) => a + (pct(s.now, s.total) || 0), 0) / scored.length : null;
    return { ...d, sigs, ready };
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* สรุปความพร้อมรวม — เรียงแผนกที่ห่างเป้าที่สุดขึ้นก่อน (ชี้เป้าให้ลงมือ) */}
      <div style={{ ...cardSt }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 9 }}>📊 ความครบของข้อมูล — เทียบกันทุกแผนก</div>
        <div style={{ display: 'grid', gap: 9, gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(min(220px,100%),1fr))', alignContent: 'start' }}>
          {[...rows].sort((a, b) => (a.ready ?? 999) - (b.ready ?? 999)).map(r => {
            const col = r.ready == null ? 'var(--muted)' : r.ready >= 80 ? '#22c55e' : r.ready >= 40 ? '#f59e0b' : '#ef4444';
            return (
              <button key={r.key} onClick={() => navigate(r.to)} style={{
                textAlign: 'left', cursor: 'pointer', background: 'var(--bg3)',
                border: `1px solid var(--border2)`, borderLeft: `4px solid ${col}`, borderRadius: 8, padding: '9px 11px', color: 'var(--text)',
              }}>
                <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{r.icon} {r.label}</div>
                <div style={{ fontSize: 25, fontWeight: 800, color: col, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' }}>
                  {r.ready == null ? '—' : `${r.ready.toFixed(0)}%`}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>ข้อมูลที่ระบบต้องใช้ ครบแล้วเท่านี้</div>
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 9 }}>
          % = ค่าเฉลี่ยของตัวชี้วัดที่มีตัวหารชัดเจนในแผนกนั้น · <b>วัดความครบของข้อมูล ไม่ได้วัดคุณภาพของข้อมูล</b>
        </div>
      </div>

      {/* การ์ดรายแผนก: ซ้าย = วันนี้ (วัดจริง) · ขวา = เมื่อใช้ครบ (ภาพคาดการณ์) */}
      {rows.map(r => (
        <div key={r.key} style={cardSt}>
          <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
            <span style={{ fontSize: 15.5, fontWeight: 700 }}>{r.icon} {r.label}</span>
            <button onClick={() => navigate(r.to)} style={{
              fontSize: 11.5, fontWeight: 700, padding: '3px 10px', borderRadius: 999, cursor: 'pointer',
              background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)',
            }}>เปิด Dashboard →</button>
          </div>
          <div style={{ display: 'grid', gap: 14, gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', alignContent: 'start' }}>
            <div>
              <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginBottom: 2 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>วันนี้</span><Badge tone="real">วัดจริงจากฐานข้อมูล</Badge>
              </div>
              {r.sigs.map((s, i) => <SignalRow key={i} s={s} navigate={navigate} />)}
            </div>
            <div>
              <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>เมื่อใช้ครบทั้งแผนก</span><Badge tone="guess">ภาพคาดการณ์</Badge>
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {r.unlocks.map((u, i) => <li key={i} style={{ fontSize: 12.5, lineHeight: 1.5 }}>{u}</li>)}
              </ul>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── แท็บ 2: เงินที่ประหยัดได้ ──────────────────────────────────────────────────────────── */
function RoiTab({ c, loss, rates, demoOn, day, navigate, isMobile }) {
  /* rate จริงจากระบบถ้ามี (เฉลี่ยทุก cost center) — ไม่มีค่อยให้กรอกสมมติฐาน */
  const realRate = useMemo(() => {
    if (!rates?.length) return null;
    const per = rates.map(r => RATE_COMPONENTS.reduce((a, k) => a + (Number(r[k.field]) || 0), 0)).filter(v => v > 0);
    return per.length ? per.reduce((a, b) => a + b, 0) / per.length : null;
  }, [rates]);

  const [rate, setRate] = useState(DEFAULT_RATE);
  const [cut, setCut] = useState(DEFAULT_CUT_PCT);
  useEffect(() => { if (realRate) setRate(Math.round(realRate)); }, [realRate]);

  const dtHours = loss.unplannedMin / 60;
  const dtBaht = dtHours * rate;
  const cutBaht = dtBaht * (cut / 100);
  const noNgCost = !c.partsWithCost;          // ไม่มีต้นทุน/ชิ้น = คิดเงินของเสียไม่ได้

  const Fact = ({ label, value, unit, sub }) => (
    <div style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontSize: 23, fontWeight: 800, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' }}>
        {value}{unit && <span style={{ fontSize: 13, fontWeight: 700 }}> {unit}</span>}
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 1) ข้อเท็จจริงที่วัดได้ */}
      <div style={cardSt}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 3 }}>
          <span style={{ fontSize: 14.5, fontWeight: 700 }}>① ความสูญเสียที่ระบบวัดได้แล้ว</span>
          <Badge tone="real">วัดจริง</Badge>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 10 }}>
          {WINDOW_DAYS} วันล่าสุด ({loss.from} → {loss.to}) · {fmtNum(loss.sessWin)} กะ
        </div>
        <div style={{ display: 'grid', gap: 9, gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(auto-fit, minmax(min(190px,100%),1fr))', alignContent: 'start' }}>
          <Fact label="เครื่องหยุด นอกแผน" value={fmtNum(dtHours)} unit="ชม." sub={`${fmtNum(loss.unplannedMin)} นาที`} />
          <Fact label="หยุดตามแผน" value={fmtNum(loss.plannedMin / 60)} unit="ชม." sub="ไม่นับเป็นความสูญเสีย" />
          <Fact label="ของเสีย + สงสัย" value={fmtNum(loss.ngQty)} unit="ชิ้น" sub={`จาก ${fmtNum(c.sessWithNg)} กะที่มีการบันทึก`} />
          <Fact label="ใบซ่อมที่เปิดตามมา" value={fmtNum(c.mo)} unit="ใบ" sub="ทั้งระบบตั้งแต่เริ่มใช้" />
        </div>
      </div>

      {/* 2) สมมติฐานที่ผู้ใช้ปรับเอง — ต้องแยกให้ขาดจากข้อเท็จจริงข้างบน */}
      <div style={{ ...cardSt, borderLeft: '4px solid #f59e0b' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <span style={{ fontSize: 14.5, fontWeight: 700 }}>② สมมติฐาน — ปรับได้</span>
          {realRate ? <Badge tone="real">rate จากระบบ</Badge> : <Badge tone="guess">ยังไม่มี rate จริงในระบบ</Badge>}
        </div>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', alignContent: 'start' }}>
          <label style={{ fontSize: 12.5 }}>
            ต้นทุนเวลาเดินไลน์ (บาท/ชม.)
            <input type="number" min={0} value={rate} onChange={e => setRate(Math.max(0, +e.target.value || 0))}
              style={{ width: 130, marginLeft: 8, padding: '4px 8px', fontSize: 13 }} />
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>
              {realRate
                ? <>ค่าเฉลี่ยจาก <b>cost_center_rates</b> ในระบบ (DL+OH+DP)</>
                : <>ยังไม่มีใครกรอก Activity Rate — ตัวเลขนี้จึงเป็น<b style={{ color: '#f59e0b' }}>สมมติฐาน</b> ·{' '}
                  <button onClick={() => navigate('/org-setup')} style={{
                    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                    color: 'var(--accent)', fontSize: 11.5, fontWeight: 700, textDecoration: 'underline',
                  }}>กรอกค่าจริงที่ผังองค์กร →</button> แล้วตัวเลขนี้จะกลายเป็นของจริงทันที</>}
            </div>
          </label>
          <label style={{ fontSize: 12.5 }}>
            คาดว่าจะลดเวลาหยุดได้ <b>{cut}%</b>
            <input type="range" min={0} max={60} value={cut} onChange={e => setCut(+e.target.value)}
              style={{ width: '100%', marginTop: 6 }} />
            <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
              ระบบ<b>ไม่รับประกัน</b>ตัวเลขนี้ — เลื่อนเพื่อดูว่าถ้าลดได้เท่านี้ จะเป็นเงินเท่าไหร่
            </div>
          </label>
        </div>
      </div>

      {/* 3) ผลลัพธ์ */}
      <div style={{ ...cardSt, borderLeft: '4px solid var(--accent)' }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 10 }}>③ เป็นเงินเท่าไหร่</div>
        <div style={{ display: 'grid', gap: 9, gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(min(210px,100%),1fr))', alignContent: 'start' }}>
          <Fact label={`มูลค่าเวลาที่หยุดนอกแผน / ${WINDOW_DAYS} วัน`} value={fmtBaht(dtBaht)} unit="บาท" sub={`${fmtNum(dtHours)} ชม. × ${fmtNum(rate)} บาท`} />
          <Fact label={`ถ้าลดได้ ${cut}%`} value={fmtBaht(cutBaht)} unit="บาท/เดือน" sub={`≈ ${fmtBaht(cutBaht * 12)} บาท/ปี`} />
          {/* โหมดสาธิต: สมมติต้นทุน/ชิ้น เพื่อให้เห็นว่าช่องนี้จะตอบอะไรเมื่อกรอกต้นทุนแล้ว */}
          {noNgCost && demoOn ? (
            <div style={{ background: 'rgba(167,139,250,0.10)', border: '1px dashed #a78bfa', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontSize: 12, color: '#a78bfa', fontWeight: 700 }}>🧪 ของเสียคิดเป็นเงิน (จำลอง)</div>
              <div style={{ fontSize: 23, fontWeight: 800, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' }}>
                {fmtBaht(loss.ngQty * (60 + rnd(`${day}|ngcost`) * 120))}<span style={{ fontSize: 13, fontWeight: 700 }}> บาท</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                สมมติต้นทุน ~{Math.round(60 + rnd(`${day}|ngcost`) * 120)} บาท/ชิ้น × {fmtNum(loss.ngQty)} ชิ้น
              </div>
            </div>
          ) : (
            <Fact label="ของเสียคิดเป็นเงิน" value={noNgCost ? 'ยังคิดไม่ได้' : '—'} unit={noNgCost ? '' : 'บาท'}
              sub={noNgCost ? `พาร์ท ${fmtNum(c.partsAll)} รายการยังไม่มีต้นทุน/ชิ้น` : ''} />
          )}
        </div>
        {noNgCost && !demoOn && (
          <div style={{ fontSize: 12, color: '#f59e0b', marginTop: 10 }}>
            ⚠ ของเสีย {fmtNum(loss.ngQty)} ชิ้นแปลงเป็นบาทไม่ได้ เพราะยังไม่มีต้นทุนต่อชิ้นใน Parts Master ·{' '}
            <button onClick={() => navigate('/products')} style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              color: 'var(--accent)', fontSize: 12, fontWeight: 700, textDecoration: 'underline',
            }}>ไปกรอกต้นทุน →</button>
          </div>
        )}
      </div>

      {/* 4) ทำไมวันนี้ยังไม่ได้เงินก้อนนี้ — ผูกกลับไปที่ช่องว่างที่วัดได้ */}
      <div style={{ ...cardSt, borderLeft: '4px solid #ef4444' }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 3 }}>④ ทำไมวันนี้ยังไม่ได้เงินก้อนนี้</div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10 }}>
          ระบบ<b style={{ color: 'var(--text)' }}>วัดความสูญเสียได้แล้ว</b> แต่ขั้นตอนที่จะแปลงเป็นการแก้จริงยังขาด
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {[
            { icon: '🔧', t: `เครื่องหยุดนอกแผน ${fmtNum(loss.unplannedMin / 60)} ชม. แต่มีใบซ่อมทั้งระบบ ${fmtNum(c.mo)} ใบ`, d: 'ไม่มีใบซ่อม = ไม่มีใครถูกมอบหมายให้แก้ต้นเหตุ', to: '/mtn-repair' },
            { icon: '💡', t: `โปรเจคปรับปรุง (Kaizen) ${fmtNum(c.improvements)} โปรเจค`, d: 'ไม่มีโปรเจค = ไม่มีการวัดผลก่อน-หลัง จึงพิสูจน์เงินที่ประหยัดไม่ได้', to: '/improvements' },
            { icon: '💰', t: `Activity Rate ${fmtNum(rates?.length || 0)} cost center`, d: 'ไม่มี rate = ทุกตัวเลขบาทในระบบเป็นสมมติฐาน', to: '/org-setup' },
            { icon: '🚫', t: `บันทึกของเสีย ${fmtNum(c.sessWithNg)} จาก ${fmtNum(loss.sessWin)} กะ`, d: 'ของเสียที่ไม่ถูกบันทึก = ต้นทุนที่มองไม่เห็น', to: '/daily-report' },
          ].map((x, i) => (
            <button key={i} onClick={() => navigate(x.to)} style={{
              display: 'flex', gap: 9, alignItems: 'flex-start', textAlign: 'left', cursor: 'pointer', width: '100%',
              background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8, padding: '8px 11px', color: 'var(--text)',
            }}>
              <span style={{ fontSize: 15 }}>{x.icon}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{x.t}</span>
                <span style={{ display: 'block', fontSize: 11.5, color: 'var(--muted)' }}>{x.d}</span>
              </span>
              <span style={{ fontSize: 12, color: 'var(--accent)', whiteSpace: 'nowrap' }}>→</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── หน้าหลัก ─────────────────────────────────────────────────────────────────────────── */
/* ── 🔬 เจาะปัญหา 1 กะจริง ─────────────────────────────────────────────────────────────── */
const StepHead = ({ n, icon, title, sub, tone }) => (
  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 10 }}>
    <div style={{
      width: 28, height: 28, borderRadius: 999, flexShrink: 0, display: 'grid', placeItems: 'center',
      background: tone || 'var(--accent)', color: '#08120a', fontWeight: 800, fontSize: 13,
    }}>{n}</div>
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 15, fontWeight: 800 }}>{icon} {title}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, lineHeight: 1.55 }}>{sub}</div>}
    </div>
  </div>
);

/* แถบ A/P/Q — ตัวที่ต่ำสุดคือตัวฉุด ต้องเห็นทันทีว่าควรไปแก้ฝั่งไหน */
const ApqBar = ({ label, val, hint, worst }) => {
  const v = val == null ? null : +val;
  const col = v == null ? 'var(--muted)' : v >= 85 ? '#22c55e' : v >= 60 ? '#f59e0b' : '#ef4444';
  return (
    <div style={{
      background: 'var(--bg3)', borderRadius: 8, padding: '9px 11px',
      border: worst ? '1px solid #ef4444' : '1px solid var(--border)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700 }}>{label}</span>
        <span style={{ fontSize: 17, fontWeight: 800, color: col }}>{v == null ? '—' : `${v.toFixed(0)}%`}</span>
      </div>
      <div style={{ height: 5, background: 'var(--bg2)', borderRadius: 999, overflow: 'hidden', margin: '5px 0 4px' }}>
        <div style={{ width: `${v == null ? 0 : Math.max(0, Math.min(100, v))}%`, height: '100%', background: col }} />
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.45 }}>{hint}</div>
      {worst && <div style={{ fontSize: 10.5, fontWeight: 800, color: '#ef4444', marginTop: 3 }}>◀ ตัวฉุดหลักของกะนี้</div>}
    </div>
  );
};

function DeepDiveTab({ dd, err, demoOn, navigate, isMobile }) {
  if (err) return <div style={{ ...cardSt, borderLeft: '4px solid #ef4444', fontSize: 13 }}>โหลดข้อมูลกะไม่สำเร็จ: {err}</div>;
  if (!dd) return <div style={{ fontSize: 13, color: 'var(--muted)' }}>กำลังหากะที่ควรเอามาเจาะ…</div>;
  if (dd.empty) return (
    <div style={{ ...cardSt, fontSize: 13, lineHeight: 1.7 }}>
      ยังไม่มีกะที่ปิดแล้วในช่วง {dd.from} – {dd.to} จึงยังไม่มีอะไรให้เจาะ
      <div style={{ color: 'var(--muted)', marginTop: 4 }}>แท็บนี้จะมีข้อมูลเองเมื่อมีการปิดกะพร้อมค่า OEE</div>
    </div>
  );

  const S = dd.sess;
  const seed = `${S.id}`;
  const D = { n: (s, lo, hi) => rint(`${seed}|${s}`, lo, hi), p: (s, arr) => pick(arr, `${seed}|${s}`, arr[0]) };

  /* ── ชั้น 1: กะนี้เสียหายเท่าไหร่ ── */
  const apq = [
    { k: 'A', v: S.oee_a, label: 'A · เดินเครื่องได้', hint: 'เวลาที่ตั้งใจเดิน เดินจริงกี่ %' },
    { k: 'P', v: S.oee_p, label: 'P · ความเร็ว', hint: 'เดินแล้วเร็วตามมาตรฐานมั้ย' },
    { k: 'Q', v: S.oee_q, label: 'Q · ของดี', hint: 'ที่ผลิตออกมา เป็นของดีกี่ %' },
  ];
  const worstK = apq.filter(x => x.v != null).sort((a, b) => +a.v - +b.v)[0]?.k;

  const tgt = dd.orders.reduce((a, o) => a + (+o.qty_target || +o.qty || 0), 0);
  const act = dd.orders.reduce((a, o) => a + (o.status === 'confirmed' ? (+o.qty_ok || +o.qty || 0) : (+o.qty_actual || 0)), 0);
  const ct = dd.orders.find(o => o.prod?.cycle_time_sec)?.prod?.cycle_time_sec || null;

  /* ── ชั้น 2: เสียไปกับ 4M ตัวไหน ── */
  const dtUnplanned = dd.dt.filter(d => d.category !== 'planned');
  const dtPlanned = dd.dt.filter(d => d.category === 'planned');
  const dtMinAll = dd.dt.reduce((a, d) => a + d.min, 0);
  const ngTotal = dd.def.reduce((a, f) => a + f.qty, 0);

  const byM = {}; const unclassified = [];
  dd.dt.forEach(d => { const k = fourMOf(d); if (!k) unclassified.push(d); else (byM[k] ||= []).push(d); });
  const groups = FOUR_M.map(m => {
    const rows = byM[m.key] || [];
    return { ...m, rows, min: rows.reduce((a, r) => a + r.min, 0) };
  }).sort((a, b) => b.min - a.min);
  const qualityDt = byM.quality || [];

  /* เครื่องที่ "เสีย" ซ้ำในกะเดียว = สัญญาณว่าเป็นเรื่องสภาพเครื่อง ไม่ใช่อุบัติเหตุรายครั้ง
     ⚠️ นับเฉพาะแถวที่เป็น Machine จริงๆ — ถ้านับ unplanned ทั้งหมด "รอ Material" จะถูกเหมาว่าเครื่องเสียด้วย */
  const machRows = byM.machine || [];
  const machCount = {};
  machRows.forEach(d => { if (d.machine_no) machCount[d.machine_no] = (machCount[d.machine_no] || 0) + 1; });
  const topFails = [...dtUnplanned].sort((a, b) => b.min - a.min).slice(0, 3);
  const topDef = [...dd.def].sort((a, b) => b.qty - a.qty)[0] || null;

  /* ของเสีย ↔ เครื่องที่เสีย: ข้อความพูดถึงอุปกรณ์ตัวเดียวกันมั้ย
     (เจอบ่อยว่า A-loss กับ Q-loss มาจากต้นเหตุเดียวกัน แต่ถูกบันทึกแยกคนละที่จนไม่มีใครเห็น) */
  const machTxt = machRows.map(r => `${r.dt_type || ''} ${r.description || ''}`.toLowerCase()).join(' ');
  const machEquip = EQUIP_SYN.filter(g => g.w.some(w => machTxt.includes(w)));
  const linkedDefs = dd.def.map(f => {
    const t = `${f.def_type || ''} ${f.description || ''}`.toLowerCase();
    const g = machEquip.find(g => g.w.some(w => t.includes(w)));
    return g ? { f, equip: g.name } : null;
  }).filter(Boolean);

  const shiftTh = S.shift === 'night' ? 'กะดึก' : 'กะเช้า';
  const gcol = (n) => ({ display: 'grid', gap: 10, gridTemplateColumns: isMobile ? '1fr' : `repeat(${n}, 1fr)` });

  /* ── ชั้น 3: เอกสารออกแบบของ "พาร์ทนี้" — มีชุดแล้วหรือยัง ── */
  const peSet = dd.pe.set;
  const peReady = !!peSet && (dd.pe.fmea || 0) > 0;
  const peLink = peSet ? `/pe-docs?set=${peSet.id}&tab=fmea` : '/pe-docs';
  const DOCS = [
    {
      icon: '📄', name: 'Process Flow (PFC)', n: dd.pe.proc,
      q: 'ขั้นตอนที่เกิดปัญหา อยู่ในผังกระบวนการมั้ย · เครื่องตัวนี้อยู่ OP ไหน',
      demo: () => ({
        verdict: 'ok', head: `อยู่ในผัง — OP${D.n('op', 20, 60)} ${D.p('pn', ['ขึ้นรูป Hydroform', 'เชื่อมประกอบ', 'เจาะรู'])}`,
        lines: [`เครื่องที่ใช้: ${topFails[0]?.machine_no || S.line_name} · special characteristic: ${D.p('sc', ['SC', '—'])}`],
      }),
    },
    {
      icon: '⚠️', name: 'FMEA', n: dd.pe.fmea,
      q: 'อาการที่เกิดวันนี้ เคยถูกคาดไว้มั้ย · ถ้าเคย ทำไมยังหลุด',
      demo: () => ({
        verdict: 'warn',
        head: `2 ใน 3 อาการเคยคาดไว้ — แต่ค่า Detection สูง (ตรวจไม่เจอจนกว่าเครื่องจะหยุด)`,
        lines: [
          topFails[0] ? `✅ “${topFails[0].dt_type}” มีใน FMEA · S=${D.n('s1', 6, 8)} O=${D.n('o1', 3, 5)} D=${D.n('d1', 7, 9)} → RPN ${D.n('r1', 150, 280)} (เกินเกณฑ์ 100)` : null,
          topDef ? `✅ “${topDef.def_type}” มีใน FMEA · แต่ action ที่เขียนไว้ยัง “ยังไม่ดำเนินการ”` : null,
          topFails[2] ? `🆕 “${topFails[2].dt_type}” ${'—'} ไม่มีใน FMEA เลย = ต้อง revise เพิ่ม failure mode ใหม่` : null,
        ].filter(Boolean),
      }),
    },
    {
      icon: '🛡️', name: 'Control Plan', n: dd.pe.cp,
      q: 'มีอะไรดักไว้ · ความถี่พอมั้ย · เกิดแล้วให้ทำอะไร (reaction plan)',
      demo: () => ({
        verdict: 'bad',
        head: `control ที่เขียนไว้ “ตรวจด้วยสายตาทุก ${D.n('f1', 50, 200)} ชิ้น” — ดักอาการนี้ไม่ทัน`,
        lines: [
          `หน้างานจริงกะนี้: หยุดรอ QA ${dtPlanned.length} ครั้ง รวม ${fmtNum(dtPlanned.reduce((a, d) => a + d.min, 0))} นาที = ตรวจถี่กว่าที่ CP เขียน`,
          `reaction plan ปัจจุบัน: “แจ้งหัวหน้า” — ไม่ได้ระบุว่าต้องกันของที่ผลิตไปแล้วกี่ชิ้น`,
        ],
      }),
    },
  ];

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {/* ── กะที่ถูกเลือก ── */}
      <div style={{ ...cardSt, borderLeft: '4px solid #ef4444' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>
              🔬 {S.line_name} · {S.work_date} · {shiftTh}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3, lineHeight: 1.6 }}>
              กะที่ <b>OEE ต่ำสุดและมีเนื้อให้เจาะ</b> ในช่วง {dd.from} – {dd.to} —
              ระบบเลือกให้เองทุกครั้งที่เปิดหน้า ไม่ได้ล็อกไว้
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Badge tone="real">วัดจริง</Badge>
            <div style={{ fontSize: 30, fontWeight: 800, color: '#ef4444', lineHeight: 1 }}>
              {S.oee == null ? '—' : `${(+S.oee).toFixed(0)}%`}
            </div>
          </div>
        </div>
      </div>

      {/* ── ชั้น 1 ── */}
      <div style={cardSt}>
        <StepHead n="1" icon="📉" title="กะนี้เสียหายไปเท่าไหร่"
          sub="OEE ตัวเดียวบอกแค่ว่าแย่ — ต้องแตกเป็น A/P/Q ก่อนถึงจะรู้ว่าไปแก้ฝั่งไหน" />
        <div style={gcol(3)}>
          {apq.map(x => <ApqBar key={x.k} label={x.label} val={x.v} hint={x.hint} worst={x.k === worstK} />)}
        </div>
        <div style={{ ...gcol(3), marginTop: 10 }}>
          {[
            { l: 'เป้าจากใบผลิต', v: tgt ? `${fmtNum(tgt)} ชิ้น` : '—' },
            { l: 'ทำได้จริง', v: `${fmtNum(act || S.actual_qty)} ชิ้น`, c: tgt && act < tgt ? '#ef4444' : undefined },
            { l: 'เวลาหยุดรวม', v: `${fmtNum(dtMinAll)} นาที`, s: `นอกแผน ${fmtNum(dtUnplanned.reduce((a, d) => a + d.min, 0))} · ตามแผน ${fmtNum(dtPlanned.reduce((a, d) => a + d.min, 0))}` },
          ].map((x, i) => (
            <div key={i} style={{ background: 'var(--bg3)', borderRadius: 8, padding: '9px 11px' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{x.l}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: x.c }}>{x.v}</div>
              {x.s && <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>{x.s}</div>}
            </div>
          ))}
        </div>
        {tgt > 0 && act < tgt && (
          <div style={{ marginTop: 9, fontSize: 12.5, lineHeight: 1.6 }}>
            👉 ขาดเป้า <b style={{ color: '#ef4444' }}>{fmtNum(tgt - act)} ชิ้น</b>
            {ct ? <> · ที่ CT {ct} วิ/ชิ้น = เวลาที่หายไปราว <b>{fmtNum((tgt - act) * ct / 60)} นาที</b></> : null}
          </div>
        )}
      </div>

      {/* ── ชั้น 2 ── */}
      <div style={cardSt}>
        <StepHead n="2" icon="🧩" title="เวลาที่หายไป ไปอยู่กับ 4M ตัวไหน" tone="#f59e0b"
          sub="จัดกลุ่มจากข้อความที่พนักงานพิมพ์จริง — ข้อความต้นฉบับแสดงใต้ทุกกลุ่มให้ตรวจสอบได้" />

        <div style={{
          fontSize: 11.5, lineHeight: 1.6, color: 'var(--muted)', background: 'var(--bg3)',
          borderRadius: 8, padding: '8px 10px', marginBottom: 10,
        }}>
          ⚠️ <b>ระบบยังไม่มีแกน 4M ที่ตัว master</b> (มีแต่ 6 Big Losses / 8 Wastes) — การจัดกลุ่มนี้จึง
          <b> เดาจากข้อความ</b> ไม่ใช่ค่าที่หัวหน้าตั้งไว้ · ถ้าอยากให้แม่น 100% ต้องเพิ่มช่อง 4M
          ที่ประเภท Downtime แล้วให้คนเลือกเอง
        </div>

        <div style={gcol(isMobile ? 1 : 2)}>
          {groups.filter(g => g.rows.length).map(g => (
            <div key={g.key} style={{ background: 'var(--bg3)', borderRadius: 8, padding: '10px 11px', borderLeft: `3px solid ${g.color}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 800 }}>{g.icon} {g.label} <span style={{ color: 'var(--muted)', fontWeight: 600 }}>· {g.th}</span></span>
                <span style={{ fontSize: 15, fontWeight: 800, color: g.color }}>{fmtNum(g.min)} นาที</span>
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--muted)', margin: '2px 0 6px' }}>
                {g.rows.length} รายการ · {dtMinAll ? Math.round(g.min / dtMinAll * 100) : 0}% ของเวลาหยุดทั้งกะ
              </div>
              <div style={{ display: 'grid', gap: 3 }}>
                {g.rows.sort((a, b) => b.min - a.min).map((r, i) => (
                  <div key={i} style={{ fontSize: 11.5, lineHeight: 1.5, display: 'flex', gap: 6 }}>
                    <span style={{ color: g.color, fontWeight: 700, minWidth: 46 }}>{fmtNum(r.min)} น.</span>
                    <span style={{ minWidth: 0 }}>
                      {r.dt_type}{r.machine_no ? <span style={{ color: 'var(--muted)' }}> · {r.machine_no}</span> : null}
                      {r.description ? <span style={{ color: 'var(--text2)' }}> — “{r.description.trim()}”</span> : null}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* ฝั่งคุณภาพ — ของเสีย + DT ที่ master ตั้งว่าเป็น defect */}
          {(dd.def.length > 0 || qualityDt.length > 0) && (
            <div style={{ background: 'var(--bg3)', borderRadius: 8, padding: '10px 11px', borderLeft: '3px solid #ec4899' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 800 }}>🚫 คุณภาพ <span style={{ color: 'var(--muted)', fontWeight: 600 }}>· ของเสีย</span></span>
                <span style={{ fontSize: 15, fontWeight: 800, color: '#ec4899' }}>{fmtNum(ngTotal)} ชิ้น</span>
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--muted)', margin: '2px 0 6px' }}>
                {dd.def.length} ประเภท{qualityDt.length ? ` · + เวลาแก้งาน ${fmtNum(qualityDt.reduce((a, d) => a + d.min, 0))} นาที` : ''}
              </div>
              <div style={{ display: 'grid', gap: 3 }}>
                {dd.def.map((f, i) => (
                  <div key={i} style={{ fontSize: 11.5, lineHeight: 1.5, display: 'flex', gap: 6 }}>
                    <span style={{ color: '#ec4899', fontWeight: 700, minWidth: 46 }}>{fmtNum(f.qty)} ชิ้น</span>
                    <span style={{ minWidth: 0 }}>
                      {f.def_type}
                      {f.description ? <span style={{ color: 'var(--text2)' }}> — “{f.description.trim()}”</span> : null}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* จัดไม่ได้ — ห้ามซ่อน */}
        {unclassified.length > 0 && (
          <div style={{ marginTop: 9, fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.6 }}>
            ⚪ จัดเข้า 4M ไม่ได้ {unclassified.length} รายการ ({fmtNum(unclassified.reduce((a, d) => a + d.min, 0))} นาที):{' '}
            {unclassified.map(d => `“${d.dt_type}”`).join(' · ')} — ข้อความกว้างเกินกว่าจะระบุได้
          </div>
        )}

        {/* จุดที่ข้อมูลจริงมักผูกกันเอง — เครื่องเดียวเสียซ้ำ */}
        {Object.entries(machCount).filter(([, n]) => n >= 2).map(([m, n]) => (
          <div key={m} style={{
            marginTop: 9, fontSize: 12.5, lineHeight: 1.6, background: 'rgba(239,68,68,0.08)',
            border: '1px solid #ef4444', borderRadius: 8, padding: '8px 10px',
          }}>
            🔎 <b>{m} เสีย {n} ครั้งในกะเดียว</b> — คนละอาการกัน ({machRows.filter(d => d.machine_no === m).map(d => d.description?.trim() || d.dt_type).join(' / ')})
            <div style={{ color: 'var(--muted)', marginTop: 3 }}>
              เสียหลายจุดในกะเดียว = มักเป็นเรื่องสภาพเครื่องโดยรวม ไม่ใช่อุบัติเหตุรายครั้ง —
              นี่คือจุดที่ควรถามต่อว่า “เคยคาดไว้ใน FMEA มั้ย”
            </div>
          </div>
        ))}

        {/* A-loss กับ Q-loss ชี้ไปที่อุปกรณ์ตัวเดียวกัน — ปกติถูกบันทึกคนละที่จนไม่มีใครเห็นพร้อมกัน */}
        {linkedDefs.map(({ f, equip }, i) => (
          <div key={i} style={{
            marginTop: 9, fontSize: 12.5, lineHeight: 1.6, background: 'rgba(236,72,153,0.08)',
            border: '1px solid #ec4899', borderRadius: 8, padding: '8px 10px',
          }}>
            🔗 <b>เวลาที่หาย กับ ของเสีย ชี้ไปที่ “{equip}” ตัวเดียวกัน</b>
            <div style={{ marginTop: 3 }}>
              ฝั่งเครื่องหยุด: “{machRows.map(r => r.description?.trim()).filter(Boolean)[0] || machRows[0]?.dt_type}” ·
              ฝั่งของเสีย: “{(f.description || f.def_type || '').trim()}” ({fmtNum(f.qty)} ชิ้น)
            </div>
            <div style={{ color: 'var(--muted)', marginTop: 3 }}>
              จับคู่จาก<b>ข้อความที่พนักงานพิมพ์</b> ไม่ใช่ความสัมพันธ์ที่ระบบยืนยัน — แต่ถ้าจริง
              แปลว่า A กับ Q ของกะนี้มี<b>ต้นเหตุเดียวกัน</b> แก้จุดเดียวได้ทั้งสองฝั่ง
              (ปกติสองเรื่องนี้ถูกบันทึกคนละหน้าจน ไม่มีใครเห็นพร้อมกัน)
            </div>
          </div>
        ))}
      </div>

      {/* ── ชั้น 3 ── */}
      <div style={cardSt}>
        <StepHead n="3" icon="📐" title="ย้อนกลับไปถามเอกสารออกแบบ — เคยคาดไว้มั้ย" tone="#a78bfa"
          sub="รู้ว่าเกิดอะไรแล้ว คำถามถัดไปคือ ตอนออกแบบกระบวนการ เราเคยคาดอาการนี้ไว้หรือเปล่า และที่ดักไว้มันพอมั้ย" />

        {/* สถานะเอกสารของพาร์ทนี้ — แยก "ยังไม่มีของพาร์ทนี้" ออกจาก "ทั้งระบบยังไม่มีอะไรเลย" */}
        {peSet ? (
          <div style={{
            ...cardSt, background: 'var(--bg3)', borderLeft: '4px solid #22c55e', marginBottom: 10, fontSize: 12.5, lineHeight: 1.7,
          }}>
            <b style={{ color: '#22c55e' }}>พาร์ทนี้มีชุดเอกสารแล้ว</b> — {peSet.part_no}
            {peSet.part_name ? ` · ${peSet.part_name}` : ''} ({peSet.line_name || '—'})
            <button onClick={() => navigate(peLink)} style={{
              marginLeft: 8, fontSize: 11.5, fontWeight: 700, padding: '3px 10px', borderRadius: 999,
              cursor: 'pointer', background: 'var(--accent)', color: '#08120a', border: 'none',
            }}>เปิดดู →</button>
          </div>
        ) : !demoOn && (
          <div style={{
            ...cardSt, background: 'var(--bg3)', borderLeft: '4px solid #f59e0b', marginBottom: 10, fontSize: 12.5, lineHeight: 1.7,
          }}>
            <b style={{ color: '#f59e0b' }}>พาร์ทที่ผลิตในกะนี้ยังไม่มีชุดเอกสาร</b> — จึงยังย้อนกลับไปถามไม่ได้ว่า
            อาการที่เกิดวันนี้ <b>เคยถูกคาดไว้ตอนออกแบบกระบวนการหรือเปล่า</b>
            <div style={{ marginTop: 6, color: 'var(--muted)' }}>
              โมดูล Flow / PFMEA / Control Plan <b>มีหน้าจอให้กรอกแล้ว</b> และตอนนี้ลงไปแล้ว {fmtNum(dd.pe.totalSets)} พาร์ท —
              ยังไม่ครอบคลุมพาร์ทนี้ · ตราบใดที่ยังไม่ลง เราจะ<b>วัดความสูญเสียได้ละเอียด แต่เทียบกลับไปที่เจตนาการออกแบบไม่ได้</b>
              คือตอบไม่ได้ว่า “เคยรู้อยู่แล้วแต่ปล่อย” หรือ “ไม่เคยคิดถึงเลย”
            </div>
            <button onClick={() => navigate('/pe-docs')} style={{
              marginTop: 8, fontSize: 11.5, fontWeight: 700, padding: '5px 12px', borderRadius: 999,
              cursor: 'pointer', background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border2)',
            }}>📐 ไปลงเอกสารพาร์ทนี้</button>
          </div>
        )}

        <div style={gcol(3)}>
          {DOCS.map(d => {
            const has = (d.n || 0) > 0;
            const sim = !has && demoOn ? d.demo() : null;
            const vc = sim ? (sim.verdict === 'ok' ? '#22c55e' : sim.verdict === 'warn' ? '#f59e0b' : '#ef4444') : null;
            return (
              <div key={d.name} style={{
                background: 'var(--bg3)', borderRadius: 8, padding: '10px 11px',
                border: sim ? '1px dashed #a78bfa' : '1px solid var(--border)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 13, fontWeight: 800 }}>{d.icon} {d.name}</span>
                  {d.n == null ? <Badge>โหลดไม่ได้</Badge>
                    : has ? <Badge tone="real">{fmtNum(d.n)} แถว</Badge>
                      : sim ? <Badge tone="sim">🧪 จำลอง</Badge> : <Badge tone="guess">0 แถว</Badge>}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', margin: '5px 0 7px', lineHeight: 1.55 }}>{d.q}</div>

                {sim ? (
                  <>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: vc, lineHeight: 1.55 }}>{sim.head}</div>
                    <div style={{ display: 'grid', gap: 3, marginTop: 5 }}>
                      {sim.lines.map((l, i) => (
                        <div key={i} style={{ fontSize: 11.5, lineHeight: 1.55, color: 'var(--text2)' }}>{l}</div>
                      ))}
                    </div>
                  </>
                ) : has ? (
                  <button onClick={() => navigate(peLink)} style={{
                    fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none',
                    padding: 0, cursor: 'pointer', textAlign: 'left', fontWeight: 700,
                  }}>เปิดดูรายตัวของพาร์ทนี้ →</button>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {peSet ? 'ชุดนี้ยังไม่ได้ลงหัวข้อนี้' : 'พาร์ทนี้ยังไม่มีเอกสาร'} — ตอบคำถามนี้ไม่ได้
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {demoOn && !peReady && (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
            🧪 ทั้ง 3 การ์ดข้างบนเป็น<b>ตัวอย่างคำตอบ</b> — ชื่อเครื่อง/อาการ/ประเภทของเสีย
            เป็นของจริงจากกะนี้ แต่ค่า S-O-D · RPN · ความถี่ใน Control Plan เป็น<b>ตัวเลขสมมติ</b>
          </div>
        )}
      </div>

      {/* ── ชั้น 4 ── */}
      <div style={{ ...cardSt, borderLeft: '4px solid var(--accent)' }}>
        <StepHead n="4" icon="🎯" title="สรุป — กะนี้บอกอะไร และต้องไปทำอะไรต่อ" />
        <div style={{ display: 'grid', gap: 7, fontSize: 12.5, lineHeight: 1.65 }}>
          <div>
            <b>ตัวฉุดหลัก:</b> {worstK ? `${worstK} (${(+apq.find(a => a.k === worstK).v).toFixed(0)}%)` : '—'}
            {groups[0]?.rows.length ? <> · เวลาหายไปกับ <b>{groups[0].icon} {groups[0].label}</b> มากที่สุด ({fmtNum(groups[0].min)} นาที)</> : null}
          </div>
          {ngTotal > 0 && <div><b>ฝั่งคุณภาพ:</b> ของเสีย {fmtNum(ngTotal)} ชิ้น — {dd.def.map(f => f.def_type).join(' · ')}</div>}
          <div style={{ color: 'var(--muted)' }}>
            ทั้งหมดข้างบนนี้ระบบ<b>ตอบได้แล้ววันนี้</b> จากข้อมูลที่หน้างานกรอกเองทุกกะ
          </div>
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 7 }}>
            <b>ที่ยังตอบไม่ได้</b> คือชั้น 3 — ต้องมี 2 อย่าง:
            <div style={{ marginTop: 4, display: 'grid', gap: 3, color: 'var(--text2)' }}>
              <div>① เพิ่ม<b>ช่อง 4M ที่ประเภท Downtime</b> เพื่อเลิกเดาจากข้อความ (แก้ที่ Daily Report → ⚙️ ตั้งค่า)</div>
              <div>
                ② ลง<b>เอกสาร Flow / PFMEA / Control Plan</b> ให้ครอบคลุมพาร์ทที่ผลิตจริง —
                หน้าจอมีแล้วที่ <b>/pe-docs</b> ตอนนี้ลงไป {fmtNum(dd.pe.totalSets)} พาร์ท
                {peSet ? ' (รวมพาร์ทของกะนี้แล้ว)' : ' แต่ยังไม่มีพาร์ทของกะนี้'}
              </div>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 11 }}>
          {[
            { l: '🔎 เปิดกะนี้ใน Daily Report', to: '/daily-report' },
            { l: '📊 ดู OEE ย้อนหลังไลน์นี้', to: '/oee-analytics' },
            { l: '🧠 วิเคราะห์สาเหตุ (Lean)', to: '/oee-analytics?tab=insight' },
            { l: '📐 Flow / PFMEA / Control Plan', to: peLink },
            { l: '🔧 ใบแจ้งซ่อม', to: '/mtn-repair' },
          ].map(b => (
            <button key={b.to} onClick={() => navigate(b.to)} style={{
              fontSize: 12, fontWeight: 700, padding: '7px 12px', borderRadius: 999, cursor: 'pointer',
              background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border2)',
            }}>{b.l}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function AdoptionOutlook() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  /* default = 'dim' — คำถามที่ผู้บริหารถามจริง ควรเป็นสิ่งแรกที่เห็น
     (ก่อน-หลัง/ROI เป็นรายละเอียดที่ค่อยกดเข้าไปดู) */
  const [tab, setTab] = useTabParam(['dim', 'deep', 'ladder', 'dept', 'roi'], 'dim');
  /* โหมดสาธิตอยู่ใน URL (?demo=on) เพื่อให้ refresh กลางที่ประชุมแล้วยังอยู่โหมดเดิม
     + ส่งลิงก์ให้คนอื่นเปิดดูโหมดเดียวกันได้ · ปิดเป็นค่าเริ่มต้นเสมอ (ของจริงต้องมาก่อน) */
  const [demoRaw, setDemoRaw] = useTabParam(['on', 'off'], 'off', 'demo');
  const demoOn = demoRaw === 'on';
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  /* แท็บเจาะปัญหาโหลดแยกตอนเปิดแท็บเท่านั้น — ไม่ถ่วงหน้าแรก และโหลดครั้งเดียวต่อการเปิดหน้า */
  const [dd, setDd] = useState(null);
  const [ddErr, setDdErr] = useState('');

  useEffect(() => {
    let alive = true;
    loadAll().then(r => { if (alive) setD(r); })
      .catch(e => { if (alive) setErr(e?.message || 'โหลดข้อมูลไม่สำเร็จ'); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (tab !== 'deep' || dd || ddErr) return;
    let alive = true;
    loadDeepDive().then(r => { if (alive) setDd(r); })
      .catch(e => { if (alive) setDdErr(e?.message || 'โหลดข้อมูลกะไม่สำเร็จ'); });
    return () => { alive = false; };
  }, [tab, dd, ddErr]);

  if (err) return (
    <div style={{ padding: 16 }}>
      <PageHeader title="ภาพเมื่อข้อมูลเชื่อมกันทั้งองค์กร" icon="🔮" />
      <div style={{ ...cardSt, borderLeft: '4px solid #ef4444', fontSize: 13 }}>โหลดข้อมูลไม่สำเร็จ: {err}</div>
    </div>
  );
  if (!d) return (
    <div style={{ padding: 16 }}>
      <PageHeader title="ภาพเมื่อข้อมูลเชื่อมกันทั้งองค์กร" icon="🔮" />
      <div style={{ fontSize: 13, color: 'var(--muted)' }}>กำลังนับข้อมูลจากฐานจริง…</div>
    </div>
  );

  return (
    <div style={{ padding: isMobile ? 12 : 16, maxWidth: 1400, margin: '0 auto' }}>
      <PageHeader
        title="ภาพเมื่อข้อมูลเชื่อมกันทั้งองค์กร" icon="🔮"
        sub={`ข้อมูล ณ ${d.loss.to} · ฝั่ง "วันนี้" นับสดจากฐานจริงทั้งหมด ไม่มีตัวเลขสมมติ`}
        tabs={[
          { key: 'dim', label: '🔍 มิติที่มองเห็นได้' },
          { key: 'deep', label: '🔬 เจาะ 1 กะจริง' },
          { key: 'ladder', label: '📈 4 ระดับ (ถึง Prescriptive)' },
          { key: 'dept', label: '🏭 ก่อน-หลัง รายแผนก' },
          { key: 'roi', label: '💰 เงินที่ประหยัดได้' },
        ]}
        tab={tab} onTab={setTab}
        actions={
          <button onClick={() => setDemoRaw(demoOn ? 'off' : 'on')} title="เติมข้อมูลที่ยังไม่มีด้วยตัวเลขจำลอง เพื่อสาธิตให้เห็นหน้าตาคำตอบ" style={{
            fontSize: 13, fontWeight: 700, padding: '7px 14px', borderRadius: 999, cursor: 'pointer',
            background: demoOn ? '#a78bfa' : 'var(--bg3)', color: demoOn ? '#12081f' : 'var(--text)',
            border: `1px ${demoOn ? 'solid' : 'dashed'} ${demoOn ? '#a78bfa' : 'var(--border2)'}`,
          }}>🧪 โหมดสาธิต {demoOn ? 'เปิดอยู่' : 'ปิด'}</button>
        }
      />

      {/* แถบอธิบายว่าอะไรจริง อะไรคาดการณ์ — ห้ามถอด (กันผู้บริหารเข้าใจผิดว่าตัวเลขอนาคตคือของจริง) */}
      <div style={{
        ...cardSt, borderLeft: '4px solid var(--accent2)', marginBottom: 12, fontSize: 12.5, lineHeight: 1.65,
      }}>
        <b>คำถามของหน้านี้:</b> เมื่อทุกแผนกใช้ระบบจริงและข้อมูลมองเห็นกันหมด —
        เราจะ<b>ตอบคำถามอะไรได้บ้างที่วันนี้ตอบไม่ได้</b> (สอบกลับ · คุมคุณภาพ · เห็นเครื่องเบี่ยงเบน ·
        รู้ผลกระทบต่อการจัดส่ง · พยากรณ์ข้ามแผนก · prescriptive maintenance)
        <div style={{ marginTop: 6 }}>
          ป้าย <Badge tone="real">วัดจริง</Badge> = นับสดจากฐานข้อมูลตอนเปิดหน้า ·
          ป้าย <Badge tone="guess">คาดการณ์</Badge> = สิ่งที่<b>ยังไม่เกิด</b> จะเป็นไปได้เมื่อข้อมูลครบ
        </div>
        <div style={{ marginTop: 6, color: 'var(--muted)' }}>
          หน้านี้อ่านอย่างเดียว ไม่แก้ไขข้อมูลใดๆ · ทุกปุ่มคือทางลัดไปหน้าที่ทำงานจริง ·
          <b> ทุกความสามารถในหน้านี้ใช้ข้อมูลที่ระบบเก็บอยู่แล้ว ไม่ต้องซื้อระบบเพิ่ม</b>
        </div>
      </div>

      {/* แถบเตือนโหมดสาธิต — ต้องเด่นและอยู่เหนือเนื้อหาเสมอ กันคนเปิดค้างแล้วเข้าใจว่าเป็นของจริง */}
      {demoOn && (
        <div style={{
          ...cardSt, borderLeft: '4px solid #a78bfa', background: 'rgba(167,139,250,0.08)',
          marginBottom: 12, fontSize: 12.5, lineHeight: 1.6,
        }}>
          <b style={{ color: '#a78bfa' }}>🧪 โหมดสาธิตเปิดอยู่</b> — ส่วนที่ข้อมูลจริงยังไม่มี ถูกเติมด้วย
          <b> ตัวเลขจำลอง</b> เพื่อให้เห็นว่า “หน้าตาคำตอบ” เป็นยังไงเมื่อทุกแผนกใช้ครบ
          <div style={{ marginTop: 5, color: 'var(--muted)' }}>
            ชื่อไลน์ · เครื่องจักร · สินค้า · ลูกค้า = <b>ของจริงจากฐานข้อมูล</b> ·
            ตัวเลขทั้งหมด = <b>สมมติ</b> (นิ่งไม่ดิ้นตอนรีเฟรช เพื่อให้สาธิตซ้ำได้เหมือนเดิม) ·
            ชิปสีม่วง 🧪 = จุดข้อมูลที่ยังไม่มีจริง · <b>ปิดโหมดนี้เพื่อกลับไปดูสถานะจริง</b>
            <br />แท็บ <b>“ก่อน-หลัง รายแผนก”</b> แสดงสถานะจริงเสมอ ไม่ถูกจำลอง (เป็นตัววัดว่าต้องไปลงข้อมูลตรงไหน)
          </div>
        </div>
      )}

      {tab === 'dim' && <DimensionTab c={d.c} ents={d.ents} demoOn={demoOn} day={d.loss.to} navigate={navigate} isMobile={isMobile} />}
      {tab === 'deep' && <DeepDiveTab dd={dd} err={ddErr} demoOn={demoOn} navigate={navigate} isMobile={isMobile} />}
      {tab === 'ladder' && <LadderTab c={d.c} navigate={navigate} isMobile={isMobile} />}
      {tab === 'dept' && <DeptTab c={d.c} navigate={navigate} isMobile={isMobile} />}
      {tab === 'roi' && <RoiTab c={d.c} loss={d.loss} rates={d.rates} demoOn={demoOn} day={d.loss.to} navigate={navigate} isMobile={isMobile} />}
    </div>
  );
}
