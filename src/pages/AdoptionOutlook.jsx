import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, supabaseDR } from '../supabaseClient';
import PageHeader from '../components/PageHeader';
import useTabParam from '../utils/useTabParam';
import useIsMobile from '../utils/useIsMobile';
import { RATE_COMPONENTS, fmtBaht } from '../utils/costSaving';

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
      linesAll, linesWithCc, empActive, checkinLogs,
      /* ตัวหาร/ตัวตั้งที่ต้องนับจากหน้าต่างเดียวกัน (ไม่ใช่ทั้งฐาน) */
      sessWin: ids.length, sessWithNg, dtUnplannedRows: dts.filter(d => d.dr_downtime_types?.category !== 'planned').length,
    },
    loss: { unplannedMin, plannedMin, ngQty, sessWin: ids.length, from, to: today },
    rates,
  };
}

/* ── UI atoms ─────────────────────────────────────────────────────────────────────────── */
const cardSt = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 14 };
const Badge = ({ tone, children }) => {
  const c = tone === 'real' ? '#22c55e' : tone === 'guess' ? '#f59e0b' : 'var(--muted)';
  return <span style={{
    fontSize: 10.5, fontWeight: 700, color: c, whiteSpace: 'nowrap',
    border: `1px ${tone === 'guess' ? 'dashed' : 'solid'} ${c}`, borderRadius: 4, padding: '1px 6px',
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

/* ── แท็บ 1: ก่อน-หลัง รายแผนก ─────────────────────────────────────────────────────────── */
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
function RoiTab({ c, loss, rates, navigate, isMobile }) {
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
          <Fact label="ของเสียคิดเป็นเงิน" value={noNgCost ? 'ยังคิดไม่ได้' : '—'} unit={noNgCost ? '' : 'บาท'}
            sub={noNgCost ? `พาร์ท ${fmtNum(c.partsAll)} รายการยังไม่มีต้นทุน/ชิ้น` : ''} />
        </div>
        {noNgCost && (
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
export default function AdoptionOutlook() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [tab, setTab] = useTabParam(['dept', 'roi'], 'dept');
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    loadAll().then(r => { if (alive) setD(r); })
      .catch(e => { if (alive) setErr(e?.message || 'โหลดข้อมูลไม่สำเร็จ'); });
    return () => { alive = false; };
  }, []);

  if (err) return (
    <div style={{ padding: 16 }}>
      <PageHeader title="ภาพเมื่อทุกแผนกใช้ครบ" icon="🔮" />
      <div style={{ ...cardSt, borderLeft: '4px solid #ef4444', fontSize: 13 }}>โหลดข้อมูลไม่สำเร็จ: {err}</div>
    </div>
  );
  if (!d) return (
    <div style={{ padding: 16 }}>
      <PageHeader title="ภาพเมื่อทุกแผนกใช้ครบ" icon="🔮" />
      <div style={{ fontSize: 13, color: 'var(--muted)' }}>กำลังนับข้อมูลจากฐานจริง…</div>
    </div>
  );

  return (
    <div style={{ padding: isMobile ? 12 : 16, maxWidth: 1400, margin: '0 auto' }}>
      <PageHeader
        title="ภาพเมื่อทุกแผนกใช้ครบ" icon="🔮"
        sub={`ข้อมูล ณ ${d.loss.to} · ฐานข้อมูลจริงทั้งหมด ไม่มีตัวเลขสมมติในฝั่ง "วันนี้"`}
        tabs={[{ key: 'dept', label: '🏭 ก่อน-หลัง รายแผนก' }, { key: 'roi', label: '💰 เงินที่ประหยัดได้' }]}
        tab={tab} onTab={setTab}
      />

      {/* แถบอธิบายว่าอะไรจริง อะไรคาดการณ์ — ห้ามถอด (กันผู้บริหารเข้าใจผิดว่าตัวเลขอนาคตคือของจริง) */}
      <div style={{
        ...cardSt, borderLeft: '4px solid var(--accent2)', marginBottom: 12, fontSize: 12.5, lineHeight: 1.65,
      }}>
        <b>อ่านหน้านี้ยังไง:</b> ทุกตัวเลขที่ติดป้าย <Badge tone="real">วัดจริง</Badge> นับสดจากฐานข้อมูลตอนเปิดหน้า ·
        ส่วนที่ติดป้าย <Badge tone="guess">ภาพคาดการณ์ / สมมติฐาน</Badge> คือสิ่งที่<b>ยังไม่เกิด</b> —
        เป็นความสามารถที่จะปลดล็อกเมื่อข้อมูลครบ และตัวเลขที่ปรับเองได้ <b>ระบบไม่ได้รับประกัน</b>
        <div style={{ marginTop: 6, color: 'var(--muted)' }}>
          หน้านี้อ่านอย่างเดียว ไม่แก้ไขข้อมูลใดๆ · ทุกปุ่มคือทางลัดไปหน้าที่ทำงานจริง
        </div>
      </div>

      {tab === 'dept'
        ? <DeptTab c={d.c} navigate={navigate} isMobile={isMobile} />
        : <RoiTab c={d.c} loss={d.loss} rates={d.rates} navigate={navigate} isMobile={isMobile} />}
    </div>
  );
}
