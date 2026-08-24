/*
  Monthly Performance Review — Export .pptx (TSG corporate template **R01**)
  ==========================================================================
  สร้างไฟล์ PowerPoint "Monthly Performance Review" อัตโนมัติจากข้อมูลจริงในระบบ
  (production_sessions / prod_orders / downtime_logs / defect_logs / mtn_orders)

  ⚠️ ธีมอ้างอิง "Presentation_template_VX_R01.pptx" (user ส่งให้ 2026-08-24) — แกะสเปคจากไฟล์จริง:
    - พื้นขาวทุกสไลด์ (เลิกพื้นเขียวเข้มของ R00) · ฟอนต์ Tahoma ล้วน
    - เขียวหลักข้อความ/หัวเรื่อง/footer = #068734 (RGB 6/135/52 — annotation ในไฟล์ระบุเอง)
    - เขียวเข้ม #0D3D14 เหลือใช้เฉพาะ "Headline box" (กล่องหัวข้อพื้นเข้มตัวขาว) + หัวตาราง + เส้นขอบกราฟ
    - ส้ม accent = #D95323 (จาก prompt palette ในสไลด์ checklist ของ template)
    - column chart = ส้มไล่เฉด F6CCBE→AE5A21 · ป้ายตัวเลข/แกน = เขียว 068734 Tahoma 11
    - ตำแหน่งตายตัว: หัวเรื่อง (0.28,0.28) 36 Bold · subtitle (0.42,1.05) 20 Bold ·
      footer โลโก้ (0.273,7.052 0.26×0.26) + "THAI SUMMIT GROUP" (0.505,6.948) Tahoma 20 Bold ·
      เลขหน้า (10.28,7.12) Tahoma 12 ขวา — ห้ามขยับข้ามหน้า (กฎ check list ในไฟล์)
    - สไลด์ divider: รูปโรงงานฝั่งขวา + ขอบเฉียงขาว + "Agenda : xxx" 40 Bold เขียวฝั่งซ้าย
    - โลโก้ใหม่ (ตัว T เขียว + S ส้ม โค้งมน) — asset `src/assets/tsg/ts-logo-r01.png`
      (doc_forms.logo_url ยัง override ได้ตามกฎทะเบียนเอกสาร)

  ⚠️ บั๊กที่เคยทำ "Top Downtime + การแก้ไข" ว่างทั้งเด็ค (JULY 2026):
    เดิม select `dr_downtime_types(name, category)` แต่คอลัมน์จริงชื่อ **name_th**
    → query ล้ม 42703 ทุกก้อนแบบเงียบ → DT = 0h ทุกส่วนงาน + "No unplanned downtime"
    ทั้งที่เดือนนั้นมี downtime หลักพันแถว — ตอนนี้ใช้ name_th แล้ว และ error ใดๆ
    ถูกส่งกลับใน data.dataWarn ให้ modal โชว์ toast (ห้ามเงียบ)

  รายละเอียดที่หัวหน้างานลงในระบบ ถูกดึงเข้าเด็คแล้ว:
    - downtime_logs.fix_action / followup_result (วิธีแก้ + ผลตรวจติดตาม — migration 20260819)
    - defect_logs.fix_action / followup_result → สไลด์ QUALITY DETAIL ต่อส่วนงาน (เมื่อมี NG)
    - mtn_orders.solution ผ่าน source_downtime_id (ของเดิม)
    select แบบ tolerant: คอลัมน์ fix ยังไม่ apply → ถอยไป select ชุดเดิม + ติดธง slim บอกบนสไลด์

  การใช้: import แบบ dynamic จาก MonthlyReviewExport.jsx เท่านั้น (โค้ดหนัก — lazy chunk)
  pptxgenjs ก็ dynamic import ในนี้อีกชั้น เพื่อไม่ปนเข้า bundle หลัก
  ไฟล์นี้จงใจ "ไม่ import รูป asset เอง" — modal ส่ง dataURL เข้ามาทาง opts
  (ทำให้ extract ฟังก์ชันวาดไปรัน QA ใน harness ได้โดยไม่ติด import.meta.env)

  Doc control: doc_key 'monthly_review' ใน doc_forms (โลโก้/เลขฟอร์ม override ได้จาก /doc-forms)
*/
import { supabase, supabaseDR } from '../supabaseClient';
import { pairAwareTotal, collapseOps } from '../utils/pairTotals';
import { loadOpInfo, opInfoSync } from '../utils/opItems';
import { wavg, wLoad, wRun, wProd, isTrialDefect } from '../utils/oee';
import { fetchByIds } from '../utils/fetchByIds';

/* ── TSG R01 palette (hex ไม่มี # — ตาม pptxgenjs) ── */
const C = {
  green: '068734',      // เขียวหลัก R01 — หัวเรื่อง/ข้อความ/ป้าย/footer
  greenDark: '0D3D14',  // Headline box + หัวตาราง + เส้นขอบกราฟ (คงจาก R00 ตาม template)
  orange: 'D95323',     // ส้ม accent R01 (ตัวเลข stat + สถานะ OPEN)
  barOrange: 'E2772E',  // แท่งกราฟ (กลางช่วง ramp ของ template)
  amber: 'C88A00',      // สถานะ ON GOING (ศัพท์สถานะ TSG: watch)
  tint: 'F2F2F2',       // แถวสลับตาราง (อยู่ใน prompt palette ทางการ)
  border: 'D9D9D9',
  grey: '555555',
  white: 'FFFFFF',
};
const FONT = 'Tahoma';

const r1 = v => (v == null || Number.isNaN(v) ? null : Math.round(v * 10) / 10);
const pct = v => (v == null ? '—' : `${Number(v).toFixed(1)}%`);
const num = v => (v == null ? '—' : Number(v).toLocaleString('en-US'));
const hr1 = min => Math.round((min / 60) * 10) / 10;
const cut = (s, n) => { const t = String(s || '').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

const MONTH_EN = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
const monthLabel = (monthKey) => { // '2026-05' → 'MAY 2026'
  const [y, m] = monthKey.split('-').map(Number);
  return `${MONTH_EN[m - 1]} ${y}`;
};
const nextMonthLabel = (monthKey) => {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(y, m, 1); // เดือนถัดไป
  return `${MONTH_EN[d.getMonth()][0]}${MONTH_EN[d.getMonth()].slice(1).toLowerCase()}`;
};

/* ── ดึงข้อมูลเกินเพดาน 1000 แถว — วนหน้า (pattern เดียวกับ Report.jsx) ── */
async function fetchAll(builder) {
  const out = [];
  const PAGE = 1000;
  for (let i = 0; i < 30; i++) {
    const { data, error } = await builder.range(i * PAGE, (i + 1) * PAGE - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}
const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };

/* select แบบ tolerant: คอลัมน์ fix_action/followup_result อาจยังไม่ apply บางเครื่อง
   → ลอง FULL ก่อน เจอ 42703/column ค่อยถอย SLIM แล้วติดธง slim (บอกบนสไลด์ ไม่เงียบ) */
async function fetchByIdsTolerant(ids, mk, full, slim) {
  let res = await fetchByIds(ids, c => mk(full, c));
  if (res.error && /column|42703/i.test(String(res.error?.message || res.error))) {
    res = await fetchByIds(ids, c => mk(slim, c));
    return { ...res, slim: true };
  }
  return { ...res, slim: false };
}

/* ═══════════════════════════════════════════════════════════════════
   1) รวบรวม + aggregate ข้อมูลรายเดือน
   sections = [{ code, lines: [lineName...] }] — ไลน์ leaf ใน scope ที่เลือกแล้ว
   (hierarchy picker ใน modal เลือกเจาะถึงระดับไลน์ได้ — lines คือผลการติ๊ก)
═══════════════════════════════════════════════════════════════════ */
export async function buildMonthlyReviewData({ monthKey, sections }) {
  const [y, m] = monthKey.split('-').map(Number);
  const from = `${monthKey}-01`;
  const to = `${monthKey}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;

  const allLineNames = sections.flatMap(s => s.lines);
  if (!allLineNames.length) throw new Error('ไม่มีไลน์ใน scope ที่เลือก');

  // กะที่ปิดแล้วของเดือน (ค่า OEE stamp ตอนปิดกะ — ห้ามคำนวณซ้ำ)
  const sessions = await fetchAll(
    supabaseDR.from('production_sessions')
      .select('id, line_name, work_date, shift, oee, oee_a, oee_p, oee_q, shift_min, actual_qty, qty_ok')
      .gte('work_date', from).lte('work_date', to)
      .in('line_name', allLineNames)
      .in('status', ['closed'])
      .order('work_date').order('id'),   // ⚠️ ต้องมีตัวตัดสินท้ายที่ unique ไม่งั้นแถววันเดียวกันสลับข้ามหน้า
  );
  const sessIds = sessions.map(s => s.id);
  const sessById = Object.fromEntries(sessions.map(s => [s.id, s]));

  // downtime / defect / orders — fetchByIds (แบ่งก้อน id + แบ่งหน้า + เช็ค error)
  // ⚠️ dr_downtime_types/dr_defect_types คอลัมน์ชื่อ **name_th** ไม่ใช่ name
  //    (เคยเขียน name → query ล้มเงียบทั้งเด็ค DT=0h — ต้นเหตุรายงาน JULY 2026 ว่าง)
  const DT_FULL = 'id, session_id, machine_no, description, duration_min, fix_action, fix_by, followup_result, followup_by, dr_downtime_types(name_th, category)';
  const DT_SLIM = 'id, session_id, machine_no, description, duration_min, dr_downtime_types(name_th, category)';
  const DEF_FULL = 'session_id, qty_ng, qty_suspect, description, is_trial, fix_action, fix_by, followup_result, dr_defect_types(name_th, excl_from_q)';
  const DEF_SLIM = 'session_id, qty_ng, qty_suspect, description, dr_defect_types(name_th)';
  const [dtRes, defRes, ordRes] = await Promise.all([
    fetchByIdsTolerant(sessIds, (sel, c) => supabaseDR.from('downtime_logs').select(sel).in('session_id', c), DT_FULL, DT_SLIM),
    fetchByIdsTolerant(sessIds, (sel, c) => supabaseDR.from('defect_logs').select(sel).in('session_id', c), DEF_FULL, DEF_SLIM),
    fetchByIds(sessIds, c => supabaseDR.from('prod_orders')
      .select('session_id, mat_no, qty, qty_ok, qty_actual, status').in('session_id', c)),
  ]);
  const downtimes = dtRes.rows, defects = defRes.rows, orders = ordRes.rows;
  const fixSlim = dtRes.slim || defRes.slim; // คอลัมน์วิธีแก้ยังไม่ apply — บอกบนสไลด์
  const dataWarn = [dtRes, defRes, ordRes].find(r => r.error)?.error || null;

  // pair map สำหรับนับ output แบบ 1 คู่/stroke (กฎ pairAwareTotal)
  await loadOpInfo(); // map รายการขั้นตอน (OP งานขับนัท) — output เด็คไม่นับซ้ำ
  const mats = [...new Set(orders.map(o => o.mat_no).filter(Boolean))];
  const pairMap = {};
  for (const ms of chunk(mats, 200)) {
    const { data } = await supabaseDR.from('dr_products').select('mat_no, pair_mat_no').in('mat_no', ms);
    (data || []).forEach(p => { if (p.pair_mat_no) pairMap[p.mat_no] = p.pair_mat_no; });
  }

  // การแก้ไขจากใบซ่อม MO ที่เปิดจาก downtime (best-effort)
  const moByDt = {};
  try {
    for (const ids of chunk(downtimes.map(d => d.id), 120)) {
      const { data } = await supabaseDR.from('mtn_orders')
        .select('source_downtime_id, mo_no, root_cause, solution, mtn_dept, status')
        .in('source_downtime_id', ids);
      (data || []).forEach(o => { moByDt[o.source_downtime_id] = o; });
    }
  } catch { /* ตาราง/สิทธิ์ไม่พร้อม — ข้าม */ }

  // NG ต่อกะ (ยึด defect_logs · นับ suspect เป็นของเสียตามกฎ Q) — ใช้ถ่วงน้ำหนัก Q
  // ⚠️ line-mode ตามกฎ utils/oee §7: งานทดลอง (is_trial / excl_from_q) ไม่นับใน Q/PPM
  //    (ให้ตรงกับ oee_q ที่ stamp ตอนปิดกะ + FTT/PPM ใน /qa) — แต่ยังแสดงในลิสต์ defect เสมอ ติดชิป 🧪
  const ngBySession = {};
  defects.forEach(d => {
    if (isTrialDefect(d)) return;
    ngBySession[d.session_id] = (ngBySession[d.session_id] || 0) + (Number(d.qty_ng) || 0) + (Number(d.qty_suspect) || 0);
  });

  /* ── ข้อมูลที่ user ลงในระบบนอกเหนือ downtime/defect — ดึงมาตอบ Issue & Action (best-effort ทุกก้อน) ── */
  const todayStr = (() => { const dd = new Date(); return `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}-${String(dd.getDate()).padStart(2, '0')}`; })();
  let moOpenAll = [], actAll = [], fourMAll = [], impsAll = [];
  try { // ใบซ่อม MO ที่ยังค้าง ณ ตอนสร้างรายงาน (คิวงาน MTN ที่ผู้แจ้ง/ช่างลงไว้)
    const { data } = await supabaseDR.from('mtn_orders')
      .select('id, mo_no, machine_no, line_name, status, report_at, created_at')
      .in('line_name', allLineNames)
      .not('status', 'in', '("closed","rejected")');
    moOpenAll = data || [];
  } catch { /* ข้าม */ }
  try { // Action item จากประชุมแถวเช้า (Main) — สิ่งที่ทีมรับปากไว้แล้วยังไม่ปิด
    const { data } = await supabase.from('meeting_action_items')
      .select('id, line_name, section, problem, assignee, due_date, status')
      .in('status', ['open', 'doing']);
    actAll = data || [];
  } catch { /* ข้าม */ }
  try { // 4M changing points ของเดือน (Main) — บริบทการเปลี่ยนแปลงที่คนลงไว้
    const { data } = await supabase.from('four_m_logs')
      .select('id, line_name, category, status')
      .gte('work_date', from).lte('work_date', to)
      .in('line_name', allLineNames);
    fourMAll = data || [];
  } catch { /* ข้าม */ }
  try { // โปรเจคปรับปรุง (Kaizen) ที่กำลังติดตามผล — action ระยะยาวที่เปิดไว้แล้ว
    const { data } = await supabaseDR.from('improvements')
      .select('id, title, problem_label, line_name, status')
      .eq('status', 'monitoring')
      .in('line_name', allLineNames);
    impsAll = data || [];
  } catch { /* ข้าม */ }

  /* ── aggregate ต่อกลุ่มไลน์ ── */
  // เฉลี่ยถ่วงน้ำหนักตามกฎ OEE (util กลาง oee.js): A/OEE ถ่วงเวลารับภาระ · P ถ่วงเวลาเดินเครื่อง · Q ถ่วงจำนวนผลิต
  const plannedMinOf = (sid) => downtimes
    .filter(d => d.session_id === sid && d.dr_downtime_types?.category === 'planned')
    .reduce((a, d) => a + (Number(d.duration_min) || 0), 0);
  const aggSessions = (ss) => {
    const rows = ss.map(s => ({
      oee: s.oee == null ? null : Number(s.oee), oee_a: s.oee_a == null ? null : Number(s.oee_a),
      oee_p: s.oee_p == null ? null : Number(s.oee_p), oee_q: s.oee_q == null ? null : Number(s.oee_q),
      shift_min: s.shift_min, plannedMin: plannedMinOf(s.id),
      actual_qty: s.actual_qty, qty_ng: ngBySession[s.id] || 0,
    }));
    return {
      oee: wavg(rows, r => r.oee, wLoad), a: wavg(rows, r => r.oee_a, wLoad),
      p: wavg(rows, r => r.oee_p, wRun), q: wavg(rows, r => r.oee_q, wProd),
      nSess: ss.length,
      // เวลารับภาระรวม (ชม.) — ใช้แปลง gap ของ A/P เป็น "ชั่วโมงที่หายไป" บนสไลด์ Issue
      loadHr: hr1(rows.reduce((a, r) => a + Math.max(0, (Number(r.shift_min) || 0) - (r.plannedMin || 0)), 0)),
    };
  };
  const outputOf = (ss) => {
    const ids = new Set(ss.map(s => s.id));
    const perMat = {}; let nullMat = 0;
    orders.filter(o => ids.has(o.session_id)).forEach(o => {
      let qty = 0;
      if (o.status === 'confirmed') qty = Number(o.qty_ok ?? o.qty) || 0;
      else if (o.status === 'carry_over') qty = Number(o.qty_actual) || 0; // ผลิตจริงส่วนที่ยกยอด (กฎ 2026-07-23)
      else return;
      // ⚠️ pairAwareTotal คืน { target, produced } — ใช้ชื่อฟิลด์อื่นจะได้ undefined → NaN ทั้งเด็ค
      if (o.mat_no) perMat[o.mat_no] = { mat_no: o.mat_no, target: 0, produced: (perMat[o.mat_no]?.produced || 0) + qty };
      else nullMat += qty;
    });
    return pairAwareTotal(collapseOps(Object.values(perMat), opInfoSync()), mt => pairMap[mt] || null).produced + nullMat;
  };
  const dtStats = (ss) => {
    const ids = new Set(ss.map(s => s.id));
    const dts = downtimes.filter(d => ids.has(d.session_id));
    const unplanned = dts.filter(d => d.dr_downtime_types?.category !== 'planned');
    return {
      dtHr: hr1(unplanned.reduce((a, d) => a + (Number(d.duration_min) || 0), 0)),
      unplanned,
    };
  };
  const ppmOf = (ss, output) => { // line-mode: ไม่รวมงานทดลอง (ตรงกับ FTT/PPM ใน /qa)
    const ids = new Set(ss.map(s => s.id));
    const ng = defects.filter(d => ids.has(d.session_id) && !isTrialDefect(d))
      .reduce((a, d) => a + (Number(d.qty_ng) || 0) + (Number(d.qty_suspect) || 0), 0);
    const base = output + ng;
    return base > 0 ? Math.round((ng / base) * 1e6) : 0;
  };
  const trialQtyOf = (ss) => { // ของเสียงานทดลอง — โชว์แยก ห้ามหายเงียบ (กฎ §7)
    const ids = new Set(ss.map(s => s.id));
    return defects.filter(d => ids.has(d.session_id) && isTrialDefect(d))
      .reduce((a, d) => a + (Number(d.qty_ng) || 0) + (Number(d.qty_suspect) || 0), 0);
  };

  // ข้อความ "การแก้ไข" ต่อรายการ: หัวหน้างานลงในระบบ (fix_action/followup + ชื่อคนลง) ก่อน → ใบซ่อม MO (root cause + solution) ตาม
  const fixTextOf = (d, mo) => {
    const parts = [];
    if (d.fix_action) parts.push(`แก้ไข: ${cut(d.fix_action, 70)}${d.fix_by ? ` (${cut(d.fix_by, 18)})` : ''}`);
    if (d.followup_result) parts.push(`ติดตาม: ${cut(d.followup_result, 50)}${d.followup_by ? ` (${cut(d.followup_by, 18)})` : ''}`);
    if (mo?.root_cause) parts.push(`สาเหตุ: ${cut(mo.root_cause, 50)}`);
    if (mo?.solution) parts.push(`MO${mo.mo_no ? ` ${mo.mo_no}` : ''}: ${cut(mo.solution, 60)}`);
    else if (mo?.mo_no) parts.push(`MO ${mo.mo_no}`);
    return parts.join(' · ');
  };

  // จัดกลุ่ม downtime ตามประเภท + รายละเอียดรายครั้ง (สำหรับสไลด์ loss detail)
  const dtGroupsOf = (unplanned) => {
    const g = {};
    unplanned.forEach(d => {
      const k = d.dr_downtime_types?.name_th || 'อื่น ๆ';
      g[k] = g[k] || { name: k, min: 0, count: 0, fixed: 0, items: [] };
      g[k].min += Number(d.duration_min) || 0;
      g[k].count += 1;
      if (d.fix_action || moByDt[d.id]?.solution) g[k].fixed += 1;
      g[k].items.push(d);
    });
    return Object.values(g).sort((a, b) => b.min - a.min).map(grp => ({
      ...grp,
      min: Math.round(grp.min),
      items: grp.items.sort((a, b) => (Number(b.duration_min) || 0) - (Number(a.duration_min) || 0)).slice(0, 3)
        .map(d => {
          const s = sessById[d.session_id];
          return {
            date: s?.work_date || '', machine: d.machine_no || '', desc: cut(d.description, 60),
            min: Math.round(Number(d.duration_min) || 0),
            fix: fixTextOf(d, moByDt[d.id]),
          };
        }),
    }));
  };

  // จัดกลุ่มของเสียตามประเภท (สไลด์ quality detail — โชว์เมื่อมี NG)
  const defGroupsOf = (ss) => {
    const ids = new Set(ss.map(s => s.id));
    const g = {};
    defects.filter(d => ids.has(d.session_id)).forEach(d => {
      const qty = (Number(d.qty_ng) || 0) + (Number(d.qty_suspect) || 0);
      if (!qty) return;
      const k = d.dr_defect_types?.name_th || 'ไม่ระบุประเภท';
      g[k] = g[k] || { name: k, qty: 0, count: 0, items: [] };
      g[k].qty += qty; g[k].count += 1;
      // 🧪 = งานทดลอง — โชว์ในลิสต์เสมอ (แค่ไม่นับใน PPM) ตามกฎ §7 ห้ามกรองทิ้ง
      g[k].items.push({ qty, desc: `${isTrialDefect(d) ? '🧪 ' : ''}${cut(d.description, 55)}`, fix: fixTextOf(d, null) });
    });
    return Object.values(g).sort((a, b) => b.qty - a.qty).map(grp => ({
      ...grp,
      items: grp.items.sort((a, b) => b.qty - a.qty).slice(0, 2),
    }));
  };

  // อัตราการลงวิธีแก้ของหัวหน้างาน (accountability — โชว์บนสไลด์ loss)
  const fixCoverage = (unplanned) => {
    const n = unplanned.length;
    const fixed = unplanned.filter(d => d.fix_action || moByDt[d.id]?.solution).length;
    return { fixed, total: n };
  };

  // เครื่องที่หยุดซ้ำ (chronic) — จัดกลุ่ม unplanned ตามหมายเลขเครื่อง สำหรับสไลด์ Issue & Action
  const machineStatsOf = (unplanned) => {
    const g = {};
    unplanned.forEach(d => {
      const k = (d.machine_no || '').trim();
      if (!k) return;
      g[k] = g[k] || { machine: k, count: 0, min: 0, fixes: [] };
      g[k].count += 1; g[k].min += Number(d.duration_min) || 0;
      const f = fixTextOf(d, moByDt[d.id]);
      if (f) g[k].fixes.push(f);
    });
    return Object.values(g).sort((a, b) => b.min - a.min).slice(0, 5)
      .map(m => ({ ...m, min: Math.round(m.min) }));
  };

  const depts = sections.map(sec => {
    const ss = sessions.filter(s => sec.lines.includes(s.line_name));
    const agg = aggSessions(ss);
    const output = outputOf(ss);
    const { dtHr, unplanned } = dtStats(ss);
    const lines = [...new Set(ss.map(s => s.line_name))].sort().map(ln => {
      const ls = ss.filter(s => s.line_name === ln);
      const la = aggSessions(ls);
      const lo = outputOf(ls);
      const ld = dtStats(ls);
      return { name: ln, ...la, output: lo, dtHr: ld.dtHr, ppm: ppmOf(ls, lo), dtGroups: dtGroupsOf(ld.unplanned) };
    }).filter(l => l.nSess > 0);
    /* ── ข้อมูลที่ user ลงในโมดูลอื่น ผูกเข้าส่วนงานนี้ ── */
    const inLines = (ln) => sec.lines.includes(ln);
    const secKey = sec.code.trim().toLowerCase();
    // ใบซ่อม MO ค้าง — pending ล้วน = ยังไม่มีใครรับงาน (OPEN)
    const mos = moOpenAll.filter(o => inLines(o.line_name));
    const dayOf = (t) => t ? Math.max(0, Math.round((Date.now() - new Date(t).getTime()) / 864e5)) : null;
    const oldestMo = mos.slice().sort((a, b) => new Date(a.report_at || a.created_at || 0) - new Date(b.report_at || b.created_at || 0))[0];
    const moOpen = mos.length ? {
      count: mos.length,
      oldestDays: oldestMo ? dayOf(oldestMo.report_at || oldestMo.created_at) : null,
      sample: oldestMo ? { mo_no: oldestMo.mo_no, machine_no: oldestMo.machine_no } : null,
      allPending: mos.every(o => o.status === 'pending'),
    } : null;
    // action item ประชุมเช้า — จับทั้งราย line และราย section
    const acts = actAll.filter(a => inLines(a.line_name) || (a.section || '').trim().toLowerCase() === secKey);
    const overdue = acts.filter(a => a.due_date && a.due_date < todayStr);
    const act = acts.length ? { open: acts.length, overdue: overdue.length, sample: overdue[0] || acts[0] } : null;
    // 4M changing points ของเดือน
    const fms = fourMAll.filter(f => inLines(f.line_name));
    const byCat = {};
    fms.forEach(f => { byCat[f.category] = (byCat[f.category] || 0) + 1; });
    const fourM = fms.length ? { total: fms.length, byCat, pending: fms.filter(f => ['pending', 'pending_qa'].includes(f.status)).length } : null;
    // โปรเจค Kaizen ที่กำลังติดตามผล
    const imps = impsAll.filter(i => inLines(i.line_name)).map(i => ({ title: i.title || i.problem_label || '' }));
    return {
      code: sec.code, ...agg, output, dtHr, ppm: ppmOf(ss, output), trialQty: trialQtyOf(ss),
      lines, dtGroups: dtGroupsOf(unplanned), defGroups: defGroupsOf(ss),
      fixCov: fixCoverage(unplanned), machineTop: machineStatsOf(unplanned),
      moOpen, act, fourM, imps,
    };
  }).filter(d => d.nSess > 0);

  if (!depts.length) throw new Error('เดือนนี้ไม่มีกะที่ปิดแล้วใน scope ที่เลือก');
  return { monthKey, from, to, depts, dataWarn, fixSlim };
}

/* ═══════════════════════════════════════════════════════════════════
   2) rule-based story — สร้างประโยค readout จากตัวเลขจริง
═══════════════════════════════════════════════════════════════════ */
function lowestDriver(d) { // ตัวไหนฉุด OEE: เทียบ gap จากเป้ามาตรฐาน A90 P90 Q99
  const gaps = [['A', (d.a ?? 100) - 90], ['P', (d.p ?? 100) - 90], ['Q', (d.q ?? 100) - 99]];
  gaps.sort((x, y) => x[1] - y[1]);
  return gaps[0][0];
}
// "ชั่วโมงที่หายไป" ต่อ lever — แปลง gap ของ A/P เป็นเวลาจริงจากเวลารับภาระ (โปร่งใส อธิบายได้)
//   A loss ≈ dtHr ตรงๆ (เวลาหยุดนอกแผน) · P loss ≈ เวลาเดินเครื่อง × (1 − P) = load × A × (1−P)
function lostHrP(d) {
  if (d.loadHr == null || d.a == null || d.p == null) return null;
  return r1(d.loadHr * (d.a / 100) * (1 - d.p / 100));
}
function execStory(depts) {
  const out = [];
  const qStable = depts.every(d => (d.q ?? 0) >= 99);
  const dtSum = r1(depts.reduce((a, d) => a + (d.dtHr || 0), 0));
  const pSum = r1(depts.reduce((a, d) => a + (lostHrP(d) || 0), 0));
  if (qStable) out.push(`Quality stable (all depts ≥ 99%) — OEE loss sits in Availability ${dtSum}h unplanned stops + Performance ~${pSum}h slow-cycle/minor-stop equivalent.`);
  else out.push(`Quality below 99% on ${depts.filter(d => (d.q ?? 0) < 99).map(d => d.code).join('/')} — defect detail per dept follows.`);
  if (depts.length >= 2) {
    const sorted = [...depts].sort((a, b) => (b.oee ?? 0) - (a.oee ?? 0));
    const gap = r1((sorted[0].oee ?? 0) - (sorted[1].oee ?? 0));
    if (gap >= 0.5) out.push(`${sorted[0].code} leads ${sorted[1].code} by +${gap} pts OEE — gap is ${lowestDriver(sorted[1])} on ${sorted[1].code} (top loss: ${sorted[1].dtGroups[0]?.name || '—'}).`);
  }
  const cov = depts.reduce((a, d) => ({ fixed: a.fixed + d.fixCov.fixed, total: a.total + d.fixCov.total }), { fixed: 0, total: 0 });
  if (cov.total) out.push(`Countermeasures recorded on ${cov.fixed}/${cov.total} unplanned stops — remaining ${cov.total - cov.fixed} items need owners (see Issue & Action summary).`);
  return out;
}
function deptStory(d) {
  const out = [];
  const drv = lowestDriver(d);
  if (drv === 'A') out.push(`${d.code}: Availability ${pct(d.a)} is the lever — ${d.dtHr}h unplanned stops on ~${d.loadHr ?? '—'}h loading time (top: ${d.dtGroups[0]?.name || '—'}).`);
  else if (drv === 'P') out.push(`${d.code}: Performance ${pct(d.p)} is the lever — ~${lostHrP(d) ?? '—'}h equivalent lost to slow cycles/minor stops on ~${d.loadHr ?? '—'}h loading time.`);
  else out.push(`${d.code}: Quality ${pct(d.q)} is the lever — PPM ${num(d.ppm)} (top defect: ${d.defGroups[0]?.name || '—'}).`);
  if (d.lines.length >= 2) {
    const sorted = [...d.lines].sort((a, b) => (b.oee ?? 0) - (a.oee ?? 0));
    const best = sorted[0]; const worst = sorted[sorted.length - 1];
    const gap = r1((best.oee ?? 0) - (worst.oee ?? 0));
    if (gap >= 0.5) out.push(`${worst.name} trails ${best.name} by ${gap} pts OEE — benchmark ${best.name}; ${worst.name} loss = ${worst.dtGroups[0] ? `${worst.dtGroups[0].name} ${hr1(worst.dtGroups[0].min)}h` : `${lowestDriver(worst)} gap`}.`);
  }
  // 4M changing points — บริบทการเปลี่ยนแปลงที่คนลงไว้ ใช้เทียบกับ loss ข้างบน
  if (d.fourM?.total) {
    const cats = ['Man', 'Machine', 'Material', 'Method'].map(c => d.fourM.byCat[c] ? `${c} ${d.fourM.byCat[c]}` : null).filter(Boolean).join(' · ');
    out.push(`Changing points (4M): ${d.fourM.total} logged this month${cats ? ` (${cats})` : ''}${d.fourM.pending ? ` — ${d.fourM.pending} pending approval` : ''}.`);
  }
  const topDt = d.dtGroups[0];
  if (topDt) out.push(`Top downtime: ${topDt.name} ${hr1(topDt.min)}h (${topDt.count} events, ${topDt.fixed}/${topDt.count} with countermeasure) — owner confirms closure in daily meeting.`);
  return out;
}
function lineReadout(l) {
  const drv = lowestDriver(l);
  return drv === 'A' ? 'Availability' : drv === 'P' ? 'Performance' : 'Quality';
}
/* ── Issue & Action engine — ทุกแถวต้องชี้กลับข้อมูลจริงได้ (ตัวเลข/เครื่อง/วิธีแก้ที่หัวหน้างานลง)
   status: CLOSED = ทุกรายการในกลุ่มมีวิธีแก้แล้ว · ON GOING = มีบางส่วน · OPEN = ยังไม่มีใครลงเลย ── */
function issueRowsOf(d, NEXT) {
  const rows = [];
  const drv = lowestDriver(d);
  if (drv === 'A') {
    rows.push({
      issue: `Availability ${pct(d.a)} — หยุดนอกแผน ${d.dtHr}h จากเวลารับภาระ ~${d.loadHr ?? '—'}h`,
      action: d.dtGroups[0] ? `โฟกัส ${d.dtGroups[0].name} (${hr1(d.dtGroups[0].min)}h) เป็นตัวแรกใน ${NEXT}` : `คุมรอบ PM/การรอคอยใน ${NEXT}`,
      status: 'ON GOING',
    });
  } else if (drv === 'P') {
    const lost = lostHrP(d);
    rows.push({
      issue: `Performance ${pct(d.p)}${lost != null ? ` — เทียบเท่าเวลาหาย ~${lost}h (cycle ช้า/หยุดสั้น)` : ''}`,
      action: `เก็บ micro-stop รายเครื่อง + เทียบ CT จริงกับมาตรฐานใน ${NEXT}`,
      status: 'ON GOING',
    });
  } else {
    rows.push({
      issue: `Quality ${pct(d.q)} — PPM ${num(d.ppm)}`,
      action: d.defGroups[0]?.items?.find(i => i.fix)?.fix || `ทวนมาตรการกับ QA ก่อนปิด ${NEXT}`,
      status: 'ON GOING',
    });
  }
  d.dtGroups.slice(0, 2).forEach(g => {
    const withFix = g.items.find(it => it.fix);
    const issue = `${g.name} ${hr1(g.min)}h / ${g.count} ครั้ง`;
    if (withFix) rows.push({ issue, action: `${withFix.fix}${g.fixed > 1 ? ` (+อีก ${g.fixed - 1} รายการลงวิธีแก้แล้ว)` : ''}`, status: g.fixed >= g.count ? 'CLOSED' : 'ON GOING' });
    else rows.push({ issue, action: 'ยังไม่ลงวิธีแก้ในระบบ — มอบหมายเจ้าของใน daily meeting', status: 'OPEN' });
  });
  const chronic = (d.machineTop || []).find(mch => mch.count >= 3);
  if (chronic) {
    rows.push({
      issue: `${chronic.machine} หยุดซ้ำ ${chronic.count} ครั้ง (${hr1(chronic.min)}h)`,
      action: chronic.fixes[0]
        ? `${chronic.fixes[0]}${chronic.fixes.length < chronic.count ? ` — ยังซ้ำ เปิดโปรเจคปรับปรุง (/improvements)` : ''}`
        : 'ซ้ำหลายครั้งแต่ยังไม่มีวิธีแก้ในระบบ — เปิดโปรเจคปรับปรุง (/improvements)',
      status: chronic.fixes.length ? 'ON GOING' : 'OPEN',  // มี action แล้วห้ามขึ้น OPEN (ขัดกันเอง)
    });
  }
  const td = d.defGroups[0];
  if (td) {
    rows.push({
      issue: `${td.name} ${num(td.qty)} ชิ้น / ${td.count} ครั้ง`,
      action: td.items.find(i => i.fix)?.fix || 'ยังไม่ลงวิธีแก้ในระบบ — QA/ไลน์ตามปิด',
      status: td.items.some(i => i.fix) ? 'ON GOING' : 'OPEN',
    });
  }
  // ใบซ่อม MO ค้าง — คิวงานที่ผู้แจ้ง/ช่างลงไว้แล้วยังไม่ปิด (pending ล้วน = ยังไม่มีคนรับงาน)
  if (d.moOpen?.count) {
    const smp = d.moOpen.sample ? ` — ${[d.moOpen.sample.mo_no, d.moOpen.sample.machine_no].filter(Boolean).join(' ')}` : '';
    rows.push({
      issue: `ใบซ่อม MO ค้าง ${d.moOpen.count} ใบ${d.moOpen.oldestDays != null ? ` (เก่าสุด ${d.moOpen.oldestDays} วัน${smp})` : ''}`,
      action: d.moOpen.allPending ? 'ยังไม่มีช่างรับงานสักใบ — MTN รับ/จ่ายงานใน daily meeting' : `MTN อัพเดทสถานะ/ปิดใบก่อนประชุม ${NEXT}`,
      status: d.moOpen.allPending ? 'OPEN' : 'ON GOING',
    });
  }
  // action item จากประชุมแถวเช้า — สิ่งที่ทีมรับปากไว้เอง
  if (d.act?.open) {
    rows.push({
      issue: `Action ประชุมเช้าค้าง ${d.act.open} รายการ${d.act.overdue ? ` (เกินกำหนด ${d.act.overdue})` : ''}`,
      action: d.act.sample ? `${cut(d.act.sample.problem, 90)}${d.act.sample.assignee ? ` — ผู้รับผิดชอบ: ${d.act.sample.assignee}` : ''}` : `ทวนในประชุมเช้า ${NEXT}`,
      status: d.act.overdue ? 'OPEN' : 'ON GOING',
    });
  }
  if (d.fixCov.total && d.fixCov.fixed < d.fixCov.total) {
    rows.push({
      issue: `ลงวิธีแก้แล้ว ${d.fixCov.fixed}/${d.fixCov.total} รายการหยุดนอกแผน`,
      action: `ตามเก็บ ${d.fixCov.total - d.fixCov.fixed} รายการค้างก่อนประชุม ${NEXT}`,
      status: 'ON GOING',
    });
  }
  // โปรเจค Kaizen ที่เปิดไว้ = action ระยะยาวที่เดินอยู่แล้ว (ข่าวดี — ให้ห้องประชุมเห็นว่ามีเจ้าภาพ)
  if (d.imps?.length) {
    rows.push({
      issue: `โปรเจคปรับปรุง (Kaizen) กำลังติดตามผล ${d.imps.length} โปรเจค`,
      action: d.imps.slice(0, 2).map(i => cut(i.title, 60)).filter(Boolean).join(' · ') || 'ดูผลก่อน/หลังใน /improvements',
      status: 'ON GOING',
    });
  }
  return rows;
}

/* ═══════════════════════════════════════════════════════════════════
   3) วาดสไลด์ pptxgenjs ตาม template TSG R01
   opts.photos = { strip: [dataUrl×4 — แถบรูปท้ายสไลด์ปก], dividers: [dataUrl...] }
   modal เป็นคนโหลด asset แล้วส่ง dataURL เข้ามา (ไฟล์นี้ห้าม import รูปเอง)
═══════════════════════════════════════════════════════════════════ */
export async function generateMonthlyReviewPptx(data, { logoDataUrl, photos, presenter, position, orgLine, docForm }) {
  const { default: PptxGen } = await import('pptxgenjs');
  const pres = new PptxGen();
  pres.layout = 'LAYOUT_WIDE'; // 13.33 × 7.5 in
  const MON = monthLabel(data.monthKey);
  const NEXT = nextMonthLabel(data.monthKey);
  let pageNo = 0;

  const T = (t, o) => ({ text: t, options: o });
  // สถานะ Issue & Action — ศัพท์/สีตามชุดสถานะ TSG (เขียว=จบ · amber=กำลังทำ · ส้ม=ยังไม่มีเจ้าของ)
  const STATUS_CELL = {
    'CLOSED': { t: 'CLOSED', color: C.green, bold: true },
    'ON GOING': { t: 'ON GOING', color: C.amber, bold: true },
    'OPEN': { t: 'OPEN', color: C.orange, bold: true },
  };

  /* ── ตำแหน่งตายตัวตาม template R01 (กฎ: ห้ามขยับข้ามหน้า) ── */
  const footer = (s) => {
    if (logoDataUrl) s.addImage({ data: logoDataUrl, x: 0.273, y: 7.052, w: 0.26, h: 0.26 });
    // x จริงของ template = 0.505 แต่กล่องนั้นมี inset ภายใน — เราตั้ง margin 0 จึงขยับ x ให้เท่า "จุดที่ตัวอักษรเริ่มจริง" (ไม่งั้นทับโลโก้)
    s.addText('THAI SUMMIT GROUP', { x: 0.62, y: 6.948, w: 3.55, h: 0.438, fontFace: FONT, fontSize: 20, bold: true, color: C.green, align: 'left', valign: 'middle', margin: 0 });
    s.addText(String(pageNo), { x: 10.28, y: 7.12, w: 2.75, h: 0.32, fontFace: FONT, fontSize: 12, color: C.green, align: 'right', valign: 'top', margin: 0 });
  };
  const head = (s, title, subtitle) => {
    s.addText(title, { x: 0.28, y: 0.28, w: 12.5, h: 0.71, fontFace: FONT, fontSize: 36, bold: true, color: C.green, align: 'left', valign: 'top', margin: 0, fit: 'shrink' });
    if (subtitle) s.addText(subtitle, { x: 0.42, y: 1.05, w: 12.3, h: 0.44, fontFace: FONT, fontSize: 20, bold: true, color: C.green, align: 'left', valign: 'top', margin: 0, fit: 'shrink' });
  };
  // Headline box ตาม template: พื้นเขียวเข้ม 0D3D14 ตัวขาว Tahoma 20 Bold
  const headline = (s, text, x, y, w = 2.6) => {
    s.addShape('rect', { x, y, w, h: 0.44, fill: { color: C.greenDark } });
    s.addText(text, { x, y, w, h: 0.44, fontFace: FONT, fontSize: 20, bold: true, color: C.white, align: 'center', valign: 'middle', margin: 0, fit: 'shrink' });
  };
  const stat = (s, x, y, valueTxt, label, w = 2.6) => {
    s.addText(valueTxt, { x, y, w, h: 0.62, fontFace: FONT, fontSize: 30, bold: true, color: C.orange, align: 'center', margin: 0 });
    s.addText(label, { x, y: y + 0.58, w, h: 0.32, fontFace: FONT, fontSize: 11, color: C.green, align: 'center', margin: 0 });
  };
  const bullets = (s, items, x, y, w, fs = 13) => {
    s.addText(items.map((t, i) => T(t, { bullet: { code: '2022' }, breakLine: i < items.length - 1, paraSpaceAfter: 6 })),
      { x, y, w, h: 0.42 * items.length + 0.2, fontFace: FONT, fontSize: fs, color: C.green, align: 'left', valign: 'top', margin: 0 });
  };
  // ตาราง R01: หัวเขียวเข้มตัวขาว · body เขียว 068734 · แถวสลับเทาอ่อน F2F2F2
  // เซลล์เป็น object { t, color, bold } ได้ — ใช้กับคอลัมน์สถานะ Issue & Action (OPEN ส้ม / ON GOING amber / CLOSED เขียว)
  const tsgTable = (s, headRow, rows, opts = {}) => {
    const normCell = (cell) => (cell && typeof cell === 'object' && 't' in cell) ? cell : { t: cell };
    const tableRows = [
      headRow.map(h => ({ text: h, options: { fontFace: FONT, fontSize: 11.5, bold: true, color: C.white, fill: { color: C.greenDark }, align: 'center', valign: 'middle' } })),
      ...rows.map((row, ri) => row.map((cell, ci) => {
        const c0 = normCell(cell);
        return {
          text: String(c0.t ?? '—'),
          options: {
            fontFace: FONT, fontSize: opts.fontSize || 11.5, color: c0.color || C.green, bold: c0.bold ?? (ci === 0),
            fill: { color: ri % 2 === 0 ? C.tint : C.white },
            align: ci === 0 || opts.leftCols?.includes(ci) ? 'left' : 'center', valign: 'middle',
          },
        };
      })),
    ];
    const rowH = opts.headRowH != null ? [opts.headRowH, ...rows.map(() => opts.rowH ?? 0.34)] : (opts.rowH ?? 0.34);
    s.addTable(tableRows, { x: opts.x ?? 0.5, y: opts.y ?? 2.0, w: opts.w ?? 12.3, colW: opts.colW, border: { type: 'solid', color: C.border, pt: 0.75 }, rowH, autoPage: false });
  };
  // สไลด์ divider ตาม template: รูปเต็มฝั่งขวา + ระนาบขาวขอบเฉียง + หัวข้อเขียว 40 Bold ฝั่งซ้าย (ไม่มี footer)
  const divider = (s, title, photo) => {
    if (photo) s.addImage({ data: photo, x: 5.92, y: 0, w: 7.41, h: 7.5, sizing: { type: 'cover', w: 7.41, h: 7.5 } });
    s.addShape('rect', { x: -0.05, y: 0, w: 6.1, h: 7.5, fill: { color: C.white } });
    s.addShape('rtTriangle', { x: 6.05, y: 0, w: 1.31, h: 7.5, flipV: true, fill: { color: C.white } });
    // กล่องแคบกว่า template เล็กน้อย (6.3 แทน 7.27) — หัวข้อของเรายาวกว่า "Agenda : xxx" ต้องไม่ชนขอบเฉียง
    s.addText(title, { x: 0.1, y: 2.98, w: 6.3, h: 0.77, fontFace: FONT, fontSize: 36, bold: true, color: C.green, align: 'center', valign: 'middle', margin: 0, fit: 'shrink' });
  };
  const newSlide = () => { pageNo += 1; return pres.addSlide(); };

  /* ── Slide 1: Title (R01 — พื้นขาว โลโก้บนกลาง แถบรูปท้ายสไลด์) ── */
  {
    const s = newSlide();
    if (logoDataUrl) s.addImage({ data: logoDataUrl, x: 5.92, y: 0.28, w: 1.25, h: 1.25 });
    s.addText(`MONTHLY PERFORMANCE REVIEW ${MON}`, { x: 0.6, y: 1.72, w: 12.13, h: 0.77, fontFace: FONT, fontSize: 40, bold: true, color: C.green, align: 'center', valign: 'middle', margin: 0, fit: 'shrink' });
    const who = [presenter, position].filter(Boolean).join(', ');
    s.addText([
      ...(who ? [T(who, { breakLine: true })] : []),
      T([orgLine, MON].filter(Boolean).join(', '), {}),
    ], { x: 3.03, y: 2.76, w: 7.27, h: 0.95, fontFace: FONT, fontSize: 18, color: C.green, align: 'center', valign: 'top', margin: 0 });
    s.addText('My Quality Declaration', { x: 5.07, y: 4.33, w: 3.16, h: 0.4, fontFace: FONT, fontSize: 18, bold: true, italic: true, color: C.green, align: 'center', margin: 0 });
    s.addText('“I will not accept, produce and deliver non-quality work”', { x: 2.30, y: 5.10, w: 9.12, h: 0.4, fontFace: FONT, fontSize: 18, color: C.green, align: 'center', margin: 0 });
    s.addText('“ผมจะไม่รับ, ไม่ทำและไม่ส่งมอบงานที่ไม่มีคุณภาพ”', { x: 3.78, y: 5.64, w: 5.78, h: 0.4, fontFace: FONT, fontSize: 18, color: C.green, align: 'center', margin: 0, fit: 'shrink' });
    // แถบรูปท้ายสไลด์ปก — ตำแหน่งตรง template (ใบสุดท้ายบลีดออกขอบขวาตามต้นฉบับ)
    const strip = photos?.strip || [];
    const POSN = [
      { x: 4.85, y: 6.10, w: 2.10, h: 1.27 }, { x: 7.08, y: 6.10, w: 2.03, h: 1.26 },
      { x: 9.23, y: 6.07, w: 2.02, h: 1.30 }, { x: 12.69, y: 6.35, w: 2.02, h: 1.27 },
    ];
    POSN.forEach((p, i) => { if (strip[i]) s.addImage({ data: strip[i], ...p, sizing: { type: 'cover', w: p.w, h: p.h } }); });
  }

  /* ── Slide 2: Agenda (R01 — ลิสต์เลขสีเขียว ไม่มีวงกลมส้มแล้ว) ── */
  {
    const s = newSlide();
    head(s, `MONTHLY PERFORMANCE REVIEW ${MON}`, 'Agenda');
    const items = [
      `EXECUTIVE SUMMARY : ${data.depts.map(d => d.code).join(' <> ')} OEE / A / P / Q`,
      'OEE ACTUAL BY LINE',
      ...data.depts.map(d => `${d.code} REVIEW : Overall → ${d.lines.map(l => l.name).join(' / ')} → Issue & Action`),
      `ISSUE & ACTION SUMMARY : ${NEXT.toUpperCase()} FOCUS`,
    ];
    s.addText(items.map((t, i) => T(`${i + 1}.   ${t}`, { breakLine: i < items.length - 1, paraSpaceAfter: 10 })),
      { x: 1.56, y: 1.93, w: 11.0, h: 0.42 * items.length + 0.3, fontFace: FONT, fontSize: 16, color: C.green, align: 'left', valign: 'top', margin: 0 });
    footer(s);
  }

  /* ── Slide 3: Executive summary ── */
  {
    const s = newSlide();
    head(s, `EXECUTIVE SUMMARY : ${data.depts.map(d => d.code).join(' <> ')} OEE / A / P / Q`, `${MON} PERFORMANCE STORY`);
    const n = data.depts.length;
    const statW = Math.min(2.9, 12.3 / (n * 2));
    data.depts.forEach((d, i) => {
      stat(s, 0.6 + i * statW, 1.75, pct(d.oee), `${d.code} OEE`, statW - 0.15);
      stat(s, 0.6 + (n + i) * statW, 1.75, `${d.dtHr}h`, `${d.code} DT`, statW - 0.15);
      s.addText(`A ${pct(d.a)} | P ${pct(d.p)} | Q ${pct(d.q)}`, { x: 0.6 + i * statW, y: 2.72, w: statW - 0.15, h: 0.3, fontFace: FONT, fontSize: 10.5, color: C.green, align: 'center', margin: 0 });
    });
    tsgTable(s,
      ['Dept / Line', 'OEE', 'A', 'P', 'Q', 'Output', 'PPM', 'DT Hr'],
      data.depts.map(d => [`${d.code} Overall`, pct(d.oee), pct(d.a), pct(d.p), pct(d.q), num(d.output), num(d.ppm), d.dtHr]),
      { y: 3.3, rowH: 0.4 });
    const storyY = Math.min(3.5 + (data.depts.length + 1) * 0.42 + 0.35, 5.7);
    bullets(s, execStory(data.depts).slice(0, 3), 0.6, storyY, 12.1, 12.5);
    footer(s);
  }

  /* ── Slide 4: OEE ACTUAL BY LINE — column chart ตาม template (แท่งส้ม + ป้ายเขียว Tahoma 11) ── */
  {
    const s = newSlide();
    head(s, 'OEE ACTUAL BY LINE', `${MON} — CLOSED SHIFTS ONLY`);
    const lines = data.depts.flatMap(d => d.lines.map(l => ({ ...l, dept: d.code })));
    headline(s, `OEE % — ${MON}`, 5.37, 1.62, 2.6);
    const labels = lines.map(l => l.name);
    const values = lines.map(l => r1(l.oee) ?? 0);
    s.addChart(pres.ChartType.bar, [{ name: 'OEE %', labels, values }], {
      x: 0.5, y: 2.2, w: 12.33, h: 4.3, barDir: 'col', barGapWidthPct: 60,
      chartColors: [C.barOrange],
      showValue: true, dataLabelPosition: 'outEnd', dataLabelColor: C.green, dataLabelFontFace: FONT, dataLabelFontSize: lines.length > 12 ? 9 : 11, dataLabelFormatCode: '0.0',
      catAxisLabelColor: C.green, catAxisLabelFontFace: FONT, catAxisLabelFontSize: lines.length > 12 ? 9 : 11,
      valAxisHidden: true, valAxisMaxVal: 110, valAxisMinVal: 0,
      valGridLine: { style: 'none' }, catGridLine: { style: 'none' },
      showLegend: false, showTitle: false,
    });
    footer(s);
  }

  /* ── Slide 5: OEE breakdown all areas ── */
  {
    const s = newSlide();
    head(s, 'OEE BREAKDOWN : WHY OEE MOVED', 'A / P / Q COMPARISON');
    const rows = [];
    data.depts.forEach(d => {
      rows.push([`${d.code} Overall`, pct(d.oee), pct(d.a), pct(d.p), pct(d.q), `OEE constrained by ${lowestDriver(d)}`, lowestDriver(d) === 'A' ? 'Recover downtime' : 'Cycle stability']);
      d.lines.forEach(l => {
        rows.push([l.name, pct(l.oee), pct(l.a), pct(l.p), pct(l.q), `${lineReadout(l)} focus`, l.dtGroups[0] ? `${l.dtGroups[0].name}` : 'Hold standard']);
      });
    });
    tsgTable(s, ['Area', 'OEE', 'Availability', 'Performance', 'Quality', 'Primary readout', 'Focus'], rows.slice(0, 12),
      { y: 1.85, rowH: 0.38, colW: [2.1, 1.2, 1.4, 1.5, 1.2, 2.7, 2.2], fontSize: 11 });
    if (rows.length > 12) { // ตัดแถวเกินหน้า — ต้องบอก ห้ามหายเงียบ
      s.addText(`+ อีก ${rows.length - 12} ไลน์ — ดูรายไลน์ครบในสไลด์ REVIEW ของแต่ละส่วนงาน`,
        { x: 0.5, y: 1.85 + 13 * 0.38 + 0.1, w: 12.3, h: 0.3, fontFace: FONT, fontSize: 10.5, italic: true, color: C.grey, align: 'left', margin: 0 });
    }
    footer(s);
  }

  /* ── per dept: divider + overview + loss detail + quality detail ── */
  data.depts.forEach((d, di) => {
    // Divider (R01) — รูปโรงงานสลับกันต่อส่วนงาน · ไม่มี footer ตาม template
    {
      const s = newSlide();
      const dv = photos?.dividers?.length ? photos.dividers[di % photos.dividers.length] : null;
      divider(s, `Agenda : ${d.code} REVIEW`, dv);
    }
    // Overview
    {
      const s = newSlide();
      head(s, `${d.code} REVIEW : OVERALL OEE / A / P / Q`, `${d.code} OVERVIEW`);
      [['OEE', d.oee], ['A', d.a], ['P', d.p], ['Q', d.q]].forEach(([lb, v], i) => {
        stat(s, 0.6 + i * 3.05, 1.7, pct(v), lb === 'OEE' ? `Overall ${d.code}` : lb === 'A' ? 'Availability' : lb === 'P' ? 'Performance' : 'Quality', 2.9);
      });
      // กันชนขอบล่าง: ไลน์เยอะ → ตัดแถวโชว์ 6 + story ตามพื้นที่ที่เหลือจริง (เคยล้นทับ footer)
      const showLines = d.lines.slice(0, 6);
      tsgTable(s,
        ['Line', 'OEE', 'A', 'P', 'Q', 'Output', 'PPM', 'DT Hr'],
        showLines.map(l => [l.name, pct(l.oee), pct(l.a), pct(l.p), pct(l.q), num(l.output), num(l.ppm), l.dtHr]),
        { y: 2.95, rowH: 0.36 });
      const tableEnd = 2.95 + (showLines.length + 1) * 0.38 + 0.2;
      const room = 6.8 - tableEnd;
      const nB = Math.max(1, Math.min(3, Math.floor(room / 0.4)));
      bullets(s, deptStory(d).slice(0, nB), 0.6, tableEnd, 12.1, 11.5);
      footer(s);
    }
    // Loss detail (top downtime + การแก้ไขที่หัวหน้างานลงในระบบ + ใบซ่อม MO)
    {
      const s = newSlide();
      head(s, `${d.code} LOSS DETAIL : TOP DOWNTIME`, `FROM OEE LOSS TO ACTION — ${MON}`);
      const rows = [];
      d.dtGroups.slice(0, 3).forEach(g => {
        const detail = g.items.map((it, i) =>
          `(${i + 1}) ${it.date.slice(8, 10)}/${it.date.slice(5, 7)} ${it.machine ? it.machine + ' ' : ''}${it.desc || '-'} (${it.min} min)${it.fix ? `\n     → ${it.fix}` : ''}`).join('\n');
        rows.push([`${g.name}\n${hr1(g.min)}h / ${g.count} ครั้ง`, detail || '—', `${g.fixed}/${g.count}`]);
      });
      if (!rows.length) rows.push(['—', 'No unplanned downtime recorded this month', '—']);
      tsgTable(s, ['Loss / เวลาสูญเสีย', 'รายละเอียดปัญหา + การแก้ไข (จากหน้างาน + ใบซ่อม MO)', 'ลงวิธีแก้'], rows,
        { y: 1.72, rowH: 1.42, headRowH: 0.32, colW: [2.3, 8.9, 1.1], fontSize: 9.5, leftCols: [1] });
      const cov = d.fixCov;
      bullets(s, [
        cov.total
          ? `${d.code}: countermeasures logged on ${cov.fixed}/${cov.total} unplanned stops${data.fixSlim ? ' (fix columns not yet migrated on this DB)' : ''} — unresolved items carry to ${NEXT}.`
          : `${d.code}: no unplanned downtime recorded this month.`,
        'Use daily line meeting to confirm top stop category and owner — escalate repeats until closure.',
      ], 0.6, 6.2, 12.1, 11);
      footer(s);
    }
    // Quality detail — โชว์เมื่อมีของเสีย (ดึง fix_action ของหัวหน้างานฝั่ง defect ด้วย)
    if (d.defGroups.length) {
      const s = newSlide();
      head(s, `${d.code} QUALITY DETAIL : TOP DEFECTS`, `NG + SUSPECT — ${MON} (PPM ${num(d.ppm)})`);
      const rows = d.defGroups.slice(0, 4).map(g => {
        const detail = g.items.map((it, i) =>
          `(${i + 1}) ${it.desc || '-'} (${num(it.qty)} ชิ้น)${it.fix ? `\n     → ${it.fix}` : ''}`).join('\n');
        return [`${g.name}\n${num(g.qty)} ชิ้น / ${g.count} ครั้ง`, detail || '—'];
      });
      tsgTable(s, ['Defect / จำนวน', 'ตัวอย่างปัญหา + การแก้ไข (จากหน้างาน)'], rows,
        { y: 1.72, rowH: 1.05, headRowH: 0.32, colW: [2.9, 9.4], fontSize: 9.5, leftCols: [1] });
      bullets(s, [
        `Quality holds ${pct(d.q)} — verify countermeasures above prevented recurrence before closing in ${NEXT}.`,
        ...(d.trialQty ? [`🧪 Try-out defects ${num(d.trialQty)} ชิ้น — แสดงในรายการแต่ไม่นับใน PPM ตามกฎ Q (ไลน์ไม่ถูกลงโทษจากงานทดลอง)`] : []),
      ], 0.6, 6.2, 12.1, 11);
      footer(s);
    }
    // ISSUE & ACTION ต่อส่วนงาน — ผลวิเคราะห์ทุกตัว (lever/top DT/เครื่องเรื้อรัง/defect/coverage)
    // ตกลงเป็นแถว Issue → Action → Status · Action มาจากที่หัวหน้างานลงจริง ไม่มี = OPEN ห้ามแต่งแทน
    {
      const s = newSlide();
      head(s, `${d.code} ISSUE & ACTION`, `ANSWERED FROM CENTRALIZED SHOPFLOOR DATA — ${MON}`);
      const allRows = issueRowsOf(d, NEXT);
      const rows = allRows.slice(0, 7).map(rw => [
        rw.issue, cut(rw.action, 150), STATUS_CELL[rw.status] || rw.status,
      ]);
      tsgTable(s, ['Issue (จากการวิเคราะห์ข้อมูล)', 'Action (จากหน้างาน + MO + ประชุมเช้า + Kaizen)', 'Status'], rows,
        { y: 1.72, rowH: 0.62, headRowH: 0.32, colW: [4.6, 6.5, 1.2], fontSize: 9.5, leftCols: [1] });
      s.addText(`Issue คำนวณจากบันทึกจริงทั้งเดือน · Action คือข้อความที่หัวหน้างาน/ช่างลงในระบบ — แถว OPEN = ยังไม่มีใครลงวิธีแก้ ต้องมอบหมายในที่ประชุมนี้${allRows.length > rows.length ? ` · +อีก ${allRows.length - rows.length} ประเด็นดูในระบบ` : ''}`,
        { x: 0.6, y: 1.72 + 0.32 + rows.length * 0.62 + 0.15, w: 12.1, h: 0.35, fontFace: FONT, fontSize: 10, italic: true, color: C.grey, align: 'left', margin: 0 });
      footer(s);
    }
  });

  /* ── ISSUE & ACTION SUMMARY — ทุกส่วนงาน + จุดโฟกัสเดือนถัดไป ── */
  {
    const s = newSlide();
    head(s, `ISSUE & ACTION SUMMARY : ${NEXT.toUpperCase()} FOCUS`, 'TOP ISSUES ACROSS DEPTS — WHO CONFIRMED, WHAT IS STILL OPEN');
    const allGroups = {};
    data.depts.forEach(d => d.dtGroups.forEach(g => {
      allGroups[g.name] = allGroups[g.name] || { name: g.name, min: 0, count: 0 };
      allGroups[g.name].min += g.min; allGroups[g.name].count += g.count;
    }));
    const top = Object.values(allGroups).sort((a, b) => b.min - a.min).slice(0, 3);
    top.forEach((g, i) => stat(s, 0.6 + i * 4.1, 1.62, `${hr1(g.min)}h`, `${g.name} (${g.count} ครั้ง)`, 3.9));
    // แถวสรุป: หยิบ 2 issue แรกของแต่ละส่วนงาน (lever + top DT) — เกิน 6 แถวตัด แล้วชี้ไปสไลด์รายส่วน
    const sumRows = data.depts.flatMap(d => issueRowsOf(d, NEXT).slice(0, 2).map(rw => [
      d.code, rw.issue, cut(rw.action, 120), STATUS_CELL[rw.status] || rw.status,
    ])).slice(0, 6);
    tsgTable(s, ['Dept', 'Issue', 'Action', 'Status'], sumRows,
      { y: 2.78, rowH: 0.55, headRowH: 0.3, colW: [0.9, 4.7, 5.5, 1.2], fontSize: 9.5, leftCols: [1, 2] });
    const worstLine = data.depts.flatMap(d => d.lines).sort((a, b) => (a.oee ?? 0) - (b.oee ?? 0))[0];
    const tblEnd = 2.78 + 0.3 + sumRows.length * 0.55;
    if (worstLine) bullets(s, [
      `${NEXT} priority: ${worstLine.name} OEE ${pct(worstLine.oee)} — attack ${worstLine.dtGroups[0]?.name || lowestDriver(worstLine) + ' loss'} first, report as A/P/Q movement next month.`,
    ], 0.6, Math.min(tblEnd + 0.15, 6.15), 12.1, 12);
    // 🎯 จุดขาย: ทั้งเด็คตอบจากข้อมูลกลางชุดเดียว — บันทึกหน้างานครั้งเดียว ไหลถึงห้องประชุมเอง
    s.addText('All issues & actions in this deck are answered from ESM centralized shopfloor records — downtime · countermeasures · MO work orders · defects · morning-meeting actions · 4M changing points · kaizen projects — entered once at the line, no manual collation.',
      { x: 0.6, y: 6.55, w: 12.1, h: 0.3, fontFace: FONT, fontSize: 10, italic: true, color: C.grey, align: 'left', margin: 0 });
    footer(s);
  }

  /* ── Closing (R01 — พื้นขาว คำขวัญเขียว 36 Bold + footer) ── */
  {
    const s = newSlide();
    s.addText('Before We Build Parts, We Build People', { x: 0.9, y: 3.04, w: 11.54, h: 0.71, fontFace: FONT, fontSize: 36, bold: true, color: C.green, align: 'center', valign: 'middle', margin: 0 });
    if (docForm?.form_code) s.addText([docForm.form_code, docForm.rev].filter(Boolean).join(' '), { x: 10.6, y: 6.6, w: 2.45, h: 0.3, fontFace: FONT, fontSize: 9, color: C.grey, align: 'right', margin: 0 });
    footer(s);
  }

  const fname = `Monthly_Performance_Review_${MON.replace(' ', '_')}.pptx`;
  await pres.writeFile({ fileName: fname });
  return fname;
}
