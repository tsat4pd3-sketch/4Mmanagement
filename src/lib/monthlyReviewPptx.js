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

  ⚠️ กฎ layout (บทเรียน 2026-09-08 — user ส่งเด็ค AUGUST 2026 กลับมาว่า "ภาพตก · ตัวหนังสือล้นตกบรรทัด"):
    1. **ห้ามพึ่ง `fit: 'shrink'`** — pptxgenjs ปล่อยแค่ `<a:normAutofit/>` ไม่มี fontScale
       PowerPoint จึงไม่ย่อให้จนกว่าจะมีคนคลิกแก้ข้อความ → เปิดมาเห็นล้นเสมอ
       ⇒ คำนวณขนาดฟอนต์เองด้วย `fitOneLine`/`fitBox` (`src/lib/pptxFit.js`) ก่อนวาด
    2. **`rowH` ของตาราง = ความสูงขั้นต่ำ ไม่ใช่ความสูงจริง** — เนื้อหายาว = แถวโตเอง = ตารางยาวเกิน
       ⇒ วาดตารางผ่าน `drawTable()` ซึ่งคืน "ก้นตารางจริง" แล้ววาง element ถัดไปจากค่านั้น
       ⇒ ทุกสไลด์มีเพดาน `SAFE_BOTTOM` (6.85") — ห้ามมีอะไรเลยเส้นนี้ (footer เริ่ม 6.948)
    3. **ห้ามวาง element ด้วยเลขคงที่ที่คำนวณจากจำนวนแถว "ที่คิดว่าจะมี"** — จำนวนส่วนงาน/ไลน์
       เปลี่ยนตามที่ user ติ๊ก (1-4 ส่วนงาน · 1-26 ไลน์) เลขคงที่พังทันทีที่เลือกเยอะกว่าตอนเทส
    4. **ตัดแถว/ตัดไลน์ได้ แต่ห้ามหายเงียบ** — ต้องพิมพ์ "+ อีก N …" ทุกครั้ง

  Doc control: doc_key 'monthly_review' ใน doc_forms (โลโก้/เลขฟอร์ม override ได้จาก /doc-forms)
*/
import { supabase, supabaseDR } from '../supabaseClient';
import { pairAwareTotal, collapseOps } from '../utils/pairTotals';
import { loadOpInfo, opInfoSync } from '../utils/opItems';
import { wavg, wLoad, wRun, wProd, isTrialDefect } from '../utils/oee';
import { fetchByIds } from '../utils/fetchByIds';
import { fitOneLine, layoutTable, textHeightIn, lineHeightIn } from './pptxFit';

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
const monthShort = (monthKey) => { // '2026-05' → 'MAY'
  const m = Number(String(monthKey).split('-')[1]);
  return MONTH_EN[m - 1] ? MONTH_EN[m - 1].slice(0, 3) : String(monthKey);
};
const nextMonthLabel = (monthKey) => {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(y, m, 1); // เดือนถัดไป
  return `${MONTH_EN[d.getMonth()][0]}${MONTH_EN[d.getMonth()].slice(1).toLowerCase()}`;
};

/* ── ดึงข้อมูลเกินเพดาน 1000 แถว — วนหน้า (pattern เดียวกับ Report.jsx) ── */
async function fetchAll(builder, maxPages = 30) {
  const out = [];
  const PAGE = 1000;
  for (let i = 0; i < maxPages; i++) {
    const { data, error } = await builder.range(i * PAGE, (i + 1) * PAGE - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < PAGE) return out;
  }
  // ครบเพดานหน้าแล้วยังเต็มทุกหน้า = ข้อมูลถูกตัด — ห้ามคืนเงียบๆ (ตัวเลขจะต่ำกว่าจริง)
  out.truncated = true;
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
   0) สูตรรวมค่ารายเดือน — pure, ใช้ร่วมกันทั้ง "เดือนรายงาน" และ "เดือนย้อนหลัง (trend)"
   ⚠️ ห้ามเขียนสูตรซ้ำในตัว trend — ตัวเลขเดือนก่อนต้องคิดด้วยกฎเดียวกับเดือนรายงาน
      ไม่งั้นกราฟ progression จะ "ขึ้น/ลง" เพราะวิธีคิดต่างกัน ไม่ใช่เพราะโรงงานดีขึ้นจริง
═══════════════════════════════════════════════════════════════════ */
const monthKeyOf = (workDate) => String(workDate || '').slice(0, 7);
const monthEndOf = (mk) => { const [y, m] = mk.split('-').map(Number); return `${mk}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`; };
/** เดือนย้อนหลัง n เดือนก่อน monthKey (เก่า→ใหม่ ไม่รวม monthKey เอง) */
function prevMonthKeys(monthKey, n) {
  const [y, m] = monthKey.split('-').map(Number);
  const out = [];
  for (let i = n; i >= 1; i--) {
    const d = new Date(y, m - 1 - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

/** เฉลี่ยถ่วงน้ำหนักตามกฎ utils/oee: A/OEE ถ่วงเวลารับภาระ · P ถ่วงเวลาเดินเครื่อง · Q ถ่วงจำนวนผลิต */
function aggregateSessions(ss, plannedMinOf, ngOf) {
  const rows = ss.map(s => ({
    oee: s.oee == null ? null : Number(s.oee), oee_a: s.oee_a == null ? null : Number(s.oee_a),
    oee_p: s.oee_p == null ? null : Number(s.oee_p), oee_q: s.oee_q == null ? null : Number(s.oee_q),
    shift_min: s.shift_min, plannedMin: plannedMinOf(s.id),
    actual_qty: s.actual_qty, qty_ng: ngOf(s.id),
  }));
  return {
    oee: wavg(rows, r => r.oee, wLoad), a: wavg(rows, r => r.oee_a, wLoad),
    p: wavg(rows, r => r.oee_p, wRun), q: wavg(rows, r => r.oee_q, wProd),
    nSess: ss.length,
    loadHr: hr1(rows.reduce((a, r) => a + Math.max(0, (Number(r.shift_min) || 0) - (r.plannedMin || 0)), 0)),
  };
}

/** ยอดผลิตแบบ pair-aware + รวมขั้นตอน OP (กฎ pairAwareTotal/collapseOps) */
function outputOfSessions(ss, orders, pairMap) {
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
}

/** PPM line-mode: ไม่รวมงานทดลอง (ให้ตรงกับ FTT/PPM ใน /qa และ oee_q ที่ stamp ตอนปิดกะ) */
function ppmOfSessions(ss, defects, output) {
  const ids = new Set(ss.map(s => s.id));
  const ng = defects.filter(d => ids.has(d.session_id) && !isTrialDefect(d))
    .reduce((a, d) => a + (Number(d.qty_ng) || 0) + (Number(d.qty_suspect) || 0), 0);
  const base = output + ng;
  return base > 0 ? Math.round((ng / base) * 1e6) : 0;
}

/** ชั่วโมงหยุดนอกแผน + ประเภทที่หยุดนานสุด (ใช้จับ "ปัญหาซ้ำหลายเดือน") */
function dtOfSessions(ss, downtimes) {
  const ids = new Set(ss.map(s => s.id));
  const unplanned = downtimes.filter(d => ids.has(d.session_id) && d.dr_downtime_types?.category !== 'planned');
  const g = {};
  unplanned.forEach(d => { const k = d.dr_downtime_types?.name_th || 'อื่น ๆ'; g[k] = (g[k] || 0) + (Number(d.duration_min) || 0); });
  const top = Object.entries(g).sort((a, b) => b[1] - a[1])[0];
  return { dtHr: hr1(unplanned.reduce((a, d) => a + (Number(d.duration_min) || 0), 0)), topDt: top ? top[0] : null, unplanned };
}

/* ═══════════════════════════════════════════════════════════════════
   1) รวบรวม + aggregate ข้อมูลรายเดือน
   sections = [{ code, lines: [lineName...] }] — ไลน์ leaf ใน scope ที่เลือกแล้ว
   (hierarchy picker ใน modal เลือกเจาะถึงระดับไลน์ได้ — lines คือผลการติ๊ก)
═══════════════════════════════════════════════════════════════════ */
/* ── ย้อนหลังหลายเดือน (progression) ────────────────────────────────
   คำขอ user 2026-09-08: "รายละเอียดยังขาด progression เพราะเราเลือกได้เดือนเดียว"
   ดึงทั้งช่วง **ครั้งเดียว** (ไม่ใช่วนคิวรีทีละเดือน) แล้วแบ่งกลุ่มตาม work_date
   select แบบผอม (ไม่เอา fix/followup/รูป/MO/LPA — พวกนั้นใช้เฉพาะเดือนรายงาน)
   ล้มเหลว = คืน warn ไม่ throw — เด็คต้องออกได้เสมอ แค่ไม่มีกราฟเทรนด์ (ห้ามเงียบ)
─────────────────────────────────────────────────────────────────── */
async function buildTrendMonths({ monthKeys, sections, allLineNames }) {
  if (!monthKeys.length) return { series: {}, warn: null };
  const from = `${monthKeys[0]}-01`;
  const to = monthEndOf(monthKeys[monthKeys.length - 1]);
  try {
    const sessions = await fetchAll(
      supabaseDR.from('production_sessions')
        .select('id, line_name, work_date, oee, oee_a, oee_p, oee_q, shift_min, actual_qty')
        .gte('work_date', from).lte('work_date', to)
        .in('line_name', allLineNames).in('status', ['closed'])
        .order('work_date').order('id'),
      80, // ช่วง 12 เดือน × หลายสิบไลน์ = กะหลายหมื่นแถว — เพดาน 30 หน้าเดิมไม่พอ
    );
    if (!sessions.length) return { series: {}, warn: null };
    if (sessions.truncated) return { series: {}, warn: 'กะย้อนหลังเกินเพดานที่ดึงได้ — ลดช่วงเดือนหรือลดจำนวนไลน์' };
    const ids = sessions.map(x => x.id);
    const [dtR, defR, ordR] = await Promise.all([
      fetchByIds(ids, c => supabaseDR.from('downtime_logs').select('session_id, duration_min, dr_downtime_types(name_th, category)').in('session_id', c)),
      fetchByIdsTolerant(ids,
        (sel, c) => supabaseDR.from('defect_logs').select(sel).in('session_id', c),
        'session_id, qty_ng, qty_suspect, is_trial, dr_defect_types(excl_from_q)',
        'session_id, qty_ng, qty_suspect'),
      fetchByIds(ids, c => supabaseDR.from('prod_orders').select('session_id, mat_no, qty, qty_ok, qty_actual, status').in('session_id', c)),
    ]);
    const err = [dtR, defR, ordR].find(r => r.error)?.error;
    if (err) return { series: {}, warn: 'โหลดข้อมูลย้อนหลังไม่ครบ' };
    const downtimes = dtR.rows, defects = defR.rows, orders = ordR.rows;

    // pair map (เดือนย้อนหลังอาจมี mat ที่เดือนรายงานไม่มี)
    const mats = [...new Set(orders.map(o => o.mat_no).filter(Boolean))];
    const pairMap = {};
    let pairWarn = null;
    for (const ms of chunk(mats, 200)) {
      const { data, error } = await supabaseDR.from('dr_products').select('mat_no, pair_mat_no').in('mat_no', ms);
      // pair map หายไป = ยอด output งานคู่ถูกนับซ้ำ 2 เท่า เทียบเดือนไม่ได้ — ต้องบอก ห้ามเงียบ
      if (error) { pairWarn = 'โหลดคู่ MAT (pair) ย้อนหลังไม่ครบ — ยอด Output เดือนก่อนอาจสูงกว่าจริง'; break; }
      (data || []).forEach(pr => { if (pr.pair_mat_no) pairMap[pr.mat_no] = pr.pair_mat_no; });
    }
    const plannedBySess = {};
    downtimes.forEach(d => {
      if (d.dr_downtime_types?.category !== 'planned') return;
      plannedBySess[d.session_id] = (plannedBySess[d.session_id] || 0) + (Number(d.duration_min) || 0);
    });
    const ngBySess = {};
    defects.forEach(d => {
      if (isTrialDefect(d)) return;
      ngBySess[d.session_id] = (ngBySess[d.session_id] || 0) + (Number(d.qty_ng) || 0) + (Number(d.qty_suspect) || 0);
    });
    const series = {};
    sections.forEach(sec => {
      series[sec.code] = monthKeys.map(mk => {
        const ss = sessions.filter(x => monthKeyOf(x.work_date) === mk && sec.lines.includes(x.line_name));
        if (!ss.length) return { monthKey: mk, nSess: 0 };
        const agg = aggregateSessions(ss, (id) => plannedBySess[id] || 0, (id) => ngBySess[id] || 0);
        const output = outputOfSessions(ss, orders, pairMap);
        const { dtHr, topDt } = dtOfSessions(ss, downtimes);
        return { monthKey: mk, ...agg, output, dtHr, topDt, ppm: ppmOfSessions(ss, defects, output) };
      });
    });
    return { series, warn: pairWarn };
  } catch (e) {
    return { series: {}, warn: e?.message || 'โหลดข้อมูลย้อนหลังไม่สำเร็จ' };
  }
}

export async function buildMonthlyReviewData({ monthKey, sections, trendMonths = 1 }) {
  const [y, m] = monthKey.split('-').map(Number);
  const from = `${monthKey}-01`;
  const to = `${monthKey}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;

  const allLineNames = sections.flatMap(s => s.lines);
  if (!allLineNames.length) throw new Error('ไม่มีไลน์ใน scope ที่เลือก');
  // ชื่อไลน์แม่ (กลุ่ม) จาก modal — ข้อมูลเสริมหลายตัวผูกกับชื่อไลน์แม่ ไม่ใช่ไลน์ลูกที่เปิดกะ
  // (LPA ตั้งแผนที่ระดับกลุ่ม · เครื่อง PM ลงทะเบียนใต้ไลน์แม่ · MO/4M บางใบอ้างไลน์แม่)
  // sections.groups เป็น optional — caller เก่าที่ไม่ส่งมา = พฤติกรรมเดิม (จับเฉพาะไลน์ leaf)
  const matchNames = [...new Set([...allLineNames, ...sections.flatMap(s => s.groups || [])])];

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
        .select('source_downtime_id, mo_no, root_cause, solution, mtn_dept, status, before_img, after_img')
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
      .in('line_name', matchNames)
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
      .in('line_name', matchNames);
    fourMAll = data || [];
  } catch { /* ข้าม */ }
  try { // โปรเจคปรับปรุง (Kaizen) ที่กำลังติดตามผล — action ระยะยาวที่เปิดไว้แล้ว (+รูปก่อน/หลัง)
    const { data } = await supabaseDR.from('improvements')
      .select('id, title, problem_label, line_name, status, image_before_url, image_after_url')
      .eq('status', 'monitoring')
      .in('line_name', matchNames);
    impsAll = data || [];
  } catch { /* ข้าม */ }
  // 💬 หมายเหตุปิดกะ — หัวหน้ากะอธิบายเอง (close_request_note) + remark ผู้อนุมัติ (close_approve_note)
  //    คอลัมน์ additive อาจยังไม่ apply → แยกก้อน best-effort ห้ามพ่วงใน select หลัก (42703 = sessions ล่มทั้งเด็ค)
  let closeNotes = [];
  try {
    const r = await fetchByIds(sessIds, c => supabaseDR.from('production_sessions')
      .select('id, line_name, work_date, shift, close_request_note, close_approve_note').in('id', c));
    closeNotes = (r.rows || []).filter(s => String(s.close_request_note || '').trim() || String(s.close_approve_note || '').trim());
  } catch { /* ข้าม */ }
  // 📋 LPA (Main) — ครั้งตรวจของเดือน + ข้อที่ตอบ N/T (note = รายละเอียดปัญหา บังคับกรอกตอนตรวจ)
  let lpaAll = [];
  try {
    const { data } = await supabase.from('lpa_audits')
      .select('id, audit_date, line_name, shift, layer, station, lpa_audit_answers(question_text, answer, note)')
      .gte('audit_date', from).lte('audit_date', to)
      .in('line_name', matchNames);
    lpaAll = data || [];
  } catch { /* ข้าม */ }
  // 🛠 ตรวจ PM/AM ที่พบผิดปกติ (inspections.status เทียบตรงตัว fail/warning ตามกฎ — ห้าม regex)
  //    เครื่อง (jigs) มักลงทะเบียนใต้ไลน์แม่ → ใช้ matchNames
  let pmFailAll = []; const pmJigById = {};
  try {
    const { data: jigRows } = await supabaseDR.from('jigs').select('id, name, line_name').in('line_name', matchNames);
    (jigRows || []).forEach(j => { pmJigById[j.id] = j; });
    const jigIds = (jigRows || []).map(j => j.id);
    if (jigIds.length) {
      const r = await fetchByIds(jigIds, c => supabaseDR.from('inspections')
        .select('id, jig_id, status, inspected_at, notes')
        .in('jig_id', c).in('status', ['fail', 'warning'])
        .gte('inspected_at', from).lte('inspected_at', `${to}T23:59:59`));
      pmFailAll = r.rows || [];
    }
  } catch { /* ข้าม */ }

  /* ── aggregate ต่อกลุ่มไลน์ ── */
  // เฉลี่ยถ่วงน้ำหนักตามกฎ OEE (util กลาง oee.js): A/OEE ถ่วงเวลารับภาระ · P ถ่วงเวลาเดินเครื่อง · Q ถ่วงจำนวนผลิต
  const plannedMinOf = (sid) => downtimes
    .filter(d => d.session_id === sid && d.dr_downtime_types?.category === 'planned')
    .reduce((a, d) => a + (Number(d.duration_min) || 0), 0);
  // ทั้ง 4 ตัวนี้เรียกสูตรกลาง (§0) — เดือนย้อนหลังใน trend ใช้สูตรเดียวกันเป๊ะ
  const aggSessions = (ss) => aggregateSessions(ss, plannedMinOf, (id) => ngBySession[id] || 0);
  const outputOf = (ss) => outputOfSessions(ss, orders, pairMap);
  const dtStats = (ss) => dtOfSessions(ss, downtimes);
  const ppmOf = (ss, output) => ppmOfSessions(ss, defects, output);
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
  // ⚠️ 2026-08-25 บั๊กที่ user จับได้จริง: item เดิมไม่มี date/line เลย (ต่างจาก dtGroupsOf ที่มีทั้งคู่)
  //    → สไลด์ TOP DEFECTS บอกได้แค่ "ประเภท + จำนวน" แต่ตอบไม่ได้ว่าเกิดวันไหน/ไลน์ไหน
  //    หัวหน้ากลุ่มไล่หาย้อนหลังในระบบไม่เจอ ต้องกลับมาถามในแชท — เติม date/line ให้เหมือน dtGroupsOf
  const defGroupsOf = (ss) => {
    const ids = new Set(ss.map(s => s.id));
    const g = {};
    defects.filter(d => ids.has(d.session_id)).forEach(d => {
      const qty = (Number(d.qty_ng) || 0) + (Number(d.qty_suspect) || 0);
      if (!qty) return;
      const k = d.dr_defect_types?.name_th || 'ไม่ระบุประเภท';
      g[k] = g[k] || { name: k, qty: 0, count: 0, items: [] };
      g[k].qty += qty; g[k].count += 1;
      const s2 = sessById[d.session_id];
      // 🧪 = งานทดลอง — โชว์ในลิสต์เสมอ (แค่ไม่นับใน PPM) ตามกฎ §7 ห้ามกรองทิ้ง
      g[k].items.push({
        qty, date: s2?.work_date || '', line: s2?.line_name || '',
        desc: `${isTrialDefect(d) ? '🧪 ' : ''}${cut(d.description, 55)}`, fix: fixTextOf(d, null),
      });
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
    // จับทั้งชื่อไลน์ leaf และชื่อไลน์แม่ (กลุ่ม) — ข้อมูลเสริมหลายตัวอ้างไลน์แม่
    const secNameSet = new Set([...sec.lines, ...(sec.groups || [])]);
    const inLines = (ln) => secNameSet.has(ln);
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
    // 💬 หมายเหตุปิดกะ — คำอธิบายจริงจากหัวหน้ากะว่าทำไมยอด/เวลาเป็นแบบนี้ (กะเป็นของไลน์ leaf เสมอ)
    const cns = closeNotes.filter(s => sec.lines.includes(s.line_name))
      .sort((a, b) => String(a.work_date || '').localeCompare(String(b.work_date || '')));
    const shiftNotes = cns.length ? {
      count: cns.length,
      items: cns.slice(-3).map(s => ({
        date: s.work_date, line: s.line_name, shift: s.shift,
        req: cut(s.close_request_note, 80), appr: cut(s.close_approve_note, 60),
      })),
    } : null;
    // 📋 LPA — ครั้งตรวจ + ข้อ N/T (ไม่มีครั้งตรวจเลย = null ไม่ใช่ "ผ่านหมด")
    const lpAud = lpaAll.filter(a => inLines(a.line_name));
    const lpaNt = lpAud.flatMap(a => (a.lpa_audit_answers || [])
      .filter(x => x.answer === 'N' || x.answer === 'T')
      .map(x => ({ date: a.audit_date, line: a.line_name, layer: a.layer, station: a.station,
                   q: cut(x.question_text, 60), note: cut(x.note, 60), answer: x.answer })));
    const lpa = lpAud.length ? { audits: lpAud.length, nt: lpaNt.length, items: lpaNt.slice(0, 3) } : null;
    // 🛠 ตรวจ PM/AM พบผิดปกติ (fail/warning)
    const pfs = pmFailAll.filter(i => inLines(pmJigById[i.jig_id]?.line_name));
    const pmFail = pfs.length ? {
      count: pfs.length,
      equips: [...new Set(pfs.map(i => pmJigById[i.jig_id]?.name).filter(Boolean))].slice(0, 3),
      sample: pfs.map(i => i.notes).find(Boolean) || null,
    } : null;
    // โปรเจค Kaizen ที่กำลังติดตามผล (+รูปก่อน/หลัง)
    const imps = impsAll.filter(i => inLines(i.line_name)).map(i => ({
      title: i.title || i.problem_label || '', before: i.image_before_url, after: i.image_after_url,
    }));
    // 📷 รูปหลักฐาน ก่อน → หลัง ที่หน้างานแนบไว้ (ใบซ่อม MO เรียงตามนาทีหยุดมากสุด + Kaizen) — cap 3 คู่/ส่วนงาน
    const seenMo = new Set();
    const photoPairs = [];
    ss.length && unplanned.slice().sort((a, b) => (Number(b.duration_min) || 0) - (Number(a.duration_min) || 0)).forEach(dd => {
      const mo = moByDt[dd.id];
      if (!mo || (!mo.before_img && !mo.after_img)) return;
      const key = mo.mo_no || `dt${dd.id}`;
      if (seenMo.has(key)) return;
      seenMo.add(key);
      photoPairs.push({ label: [mo.mo_no, dd.machine_no].filter(Boolean).join(' · ') || 'ใบซ่อม MO', before: mo.before_img, after: mo.after_img });
    });
    imps.forEach(i => { if (i.before || i.after) photoPairs.push({ label: `Kaizen: ${i.title}`.slice(0, 40), before: i.before, after: i.after }); });
    return {
      code: sec.code, ...agg, output, dtHr, ppm: ppmOf(ss, output), trialQty: trialQtyOf(ss),
      lines, dtGroups: dtGroupsOf(unplanned), defGroups: defGroupsOf(ss),
      fixCov: fixCoverage(unplanned), machineTop: machineStatsOf(unplanned),
      moOpen, act, fourM, imps, photoPairs: photoPairs.slice(0, 3),
      shiftNotes, lpa, pmFail,
    };
  }).filter(d => d.nSess > 0);

  if (!depts.length) throw new Error('เดือนนี้ไม่มีกะที่ปิดแล้วใน scope ที่เลือก');

  /* ── เทรนด์ย้อนหลัง (progression) ──
     เดือนรายงานใช้ตัวเลข authoritative จาก depts ข้างบนเสมอ (ห้ามคำนวณซ้ำแล้วได้คนละค่า)
     เดือนก่อนหน้าคิดด้วยสูตรกลางชุดเดียวกัน (§0) — เดือนที่ไม่มีกะปิดเลย = ช่องว่าง ไม่ใช่ 0 */
  let trend = null;
  const backKeys = prevMonthKeys(monthKey, Math.max(0, (Number(trendMonths) || 1) - 1));
  if (backKeys.length) {
    const { series, warn: tWarn } = await buildTrendMonths({ monthKeys: backKeys, sections, allLineNames });
    const byDept = {};
    depts.forEach(d => {
      const past = (series[d.code] || backKeys.map(mk => ({ monthKey: mk, nSess: 0 })));
      byDept[d.code] = [
        ...past,
        { monthKey, oee: d.oee, a: d.a, p: d.p, q: d.q, dtHr: d.dtHr, output: d.output, ppm: d.ppm, topDt: d.dtGroups[0]?.name || null, nSess: d.nSess },
      ];
    });
    const months = [...backKeys, monthKey];
    // เดือนที่ไม่มีกะปิดเลยสักส่วนงาน = ไม่มีข้อมูลจริง ตัดออกจากกราฟ (ไม่ลากเส้นผ่านศูนย์)
    const usable = months.filter(mk => depts.some(d => (byDept[d.code].find(r => r.monthKey === mk)?.nSess || 0) > 0));
    trend = usable.length > 1
      ? { months: usable, byDept, warn: tWarn, missing: months.filter(mk => !usable.includes(mk)) }
      : { months: [], byDept: {}, warn: tWarn, missing: months.filter(mk => !usable.includes(mk)) };
  }

  return { monthKey, from, to, depts, dataWarn, fixSlim, trend };
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
/* ── progression helpers (rule-based เหมือนเดิม — พูดจากตัวเลขจริง ห้ามแต่ง) ── */
const trendRows = (trend, code) => (trend?.months?.length > 1 ? (trend.byDept?.[code] || []).filter(r => trend.months.includes(r.monthKey)) : []);
/** ผลต่างเทียบเดือนก่อนหน้าที่ "มีข้อมูลจริง" (ข้ามเดือนที่ไม่มีกะปิด) */
function momDelta(trend, code, key) {
  const rows = trendRows(trend, code);
  if (rows.length < 2) return null;
  const cur = rows[rows.length - 1];
  const prev = [...rows.slice(0, -1)].reverse().find(r => r[key] != null && (r.nSess || 0) > 0);
  if (!prev || cur[key] == null) return null;
  return { delta: r1(Number(cur[key]) - Number(prev[key])), prevKey: prev.monthKey, prev: prev[key], cur: cur[key] };
}
/** ประเภทการหยุดอันดับ 1 ที่ซ้ำต่อเนื่องกี่เดือนติด (นับจากเดือนล่าสุดย้อนกลับ) */
function recurringTopDt(trend, code) {
  const rows = trendRows(trend, code).filter(r => (r.nSess || 0) > 0);
  const last = rows[rows.length - 1];
  if (!last?.topDt) return 0;
  let n = 0;
  for (let i = rows.length - 1; i >= 0; i--) { if (rows[i].topDt === last.topDt) n += 1; else break; }
  return n;
}

function execStory(depts, trend) {
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
  // progression — พูดต่อเมื่อมีเดือนก่อนหน้าจริง (ไม่มีข้อมูล = ไม่พูด ห้ามเดาทิศทาง)
  if (trend?.months?.length > 1) {
    const parts = depts.map(d => {
      const m = momDelta(trend, d.code, 'oee');
      if (!m) return null;
      const dir = m.delta > 0 ? '▲' : m.delta < 0 ? '▼' : '=';
      return `${d.code} ${dir}${m.delta > 0 ? '+' : ''}${m.delta} pts vs ${monthShort(m.prevKey)}`;
    }).filter(Boolean);
    if (parts.length) out.push(`Month-on-month OEE: ${parts.join(' · ')} — ${trend.months.length}-month progression on the trend slide.`);
  }
  return out;
}
function deptStory(d, trend) {
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
  // LPA — มีครั้งตรวจถึงพูด (ไม่มีเลย = ไม่อ้างว่าผ่าน)
  if (d.lpa) out.push(d.lpa.nt
    ? `LPA: ${d.lpa.audits} audits — ${d.lpa.nt} N/T findings (top: ${d.lpa.items[0]?.q || '—'}).`
    : `LPA: ${d.lpa.audits} audits this month — no N/T findings.`);
  // progression รายส่วนงาน — เดือนก่อนหน้าเป็นอย่างไร + ปัญหาเดิมซ้ำกี่เดือน
  if (trend?.months?.length > 1) {
    const mo = momDelta(trend, d.code, 'oee');
    const md = momDelta(trend, d.code, 'dtHr');
    const bits = [];
    if (mo) bits.push(`OEE ${mo.delta > 0 ? '▲ +' : mo.delta < 0 ? '▼ ' : '= '}${mo.delta} pts vs ${monthShort(mo.prevKey)} (${pct(mo.prev)} → ${pct(mo.cur)})`);
    if (md) bits.push(`unplanned DT ${md.delta > 0 ? '+' : ''}${md.delta}h`);
    if (bits.length) out.push(`Progression: ${bits.join(' · ')}.`);
    const rec = recurringTopDt(trend, d.code);
    if (rec >= 2) out.push(`Repeat offender: «${trendRows(trend, d.code).slice(-1)[0]?.topDt}» has been the #1 stop for ${rec} months running — countermeasure so far has not changed the ranking.`);
  }
  // หมายเหตุปิดกะ — เสียงจริงจากหัวหน้ากะ (กะล่าสุดก่อน)
  if (d.shiftNotes) {
    const last = d.shiftNotes.items[d.shiftNotes.items.length - 1];
    out.push(`Shift-close notes: ${d.shiftNotes.count} shifts flagged by leaders — latest: «${last?.req || last?.appr || '—'}» (${last?.line || ''} ${String(last?.date || '').slice(5)}).`);
  }
  return out;
}
function lineReadout(l) {
  const drv = lowestDriver(l);
  return drv === 'A' ? 'Availability' : drv === 'P' ? 'Performance' : 'Quality';
}
/* ── Issue & Action engine — ทุกแถวต้องชี้กลับข้อมูลจริงได้ (ตัวเลข/เครื่อง/วิธีแก้ที่หัวหน้างานลง)
   status: CLOSED = ทุกรายการในกลุ่มมีวิธีแก้แล้ว · ON GOING = มีบางส่วน · OPEN = ยังไม่มีใครลงเลย ── */
function issueRowsOf(d, NEXT, trend) {
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
  // ลำดับแถว = หนึ่งแถวต่อแหล่งข้อมูลก่อน (breadth) แล้วค่อยแถวเสริม — สไลด์โชว์ 8 แถวแรก ที่เหลือขึ้น "+อีก N"
  const recN = recurringTopDt(trend, d.code);
  const recTop = trendRows(trend, d.code).slice(-1)[0]?.topDt;
  const dtRowOf = (g) => {
    const withFix = g.items.find(it => it.fix);
    // ซ้ำเป็นอันดับ 1 หลายเดือนติด = ข้อมูลที่ห้องประชุมต้องรู้ (มาตรการเดิมยังไม่ได้ผล)
    const rec = (recN >= 2 && g.name === recTop) ? ` · ซ้ำอันดับ 1 มา ${recN} เดือนติด` : '';
    const issue = `${g.name} ${hr1(g.min)}h / ${g.count} ครั้ง${rec}`;
    return withFix
      ? { issue, action: `${withFix.fix}${g.fixed > 1 ? ` (+อีก ${g.fixed - 1} รายการลงวิธีแก้แล้ว)` : ''}`, status: g.fixed >= g.count ? 'CLOSED' : 'ON GOING' }
      : { issue, action: 'ยังไม่ลงวิธีแก้ในระบบ — มอบหมายเจ้าของใน daily meeting', status: 'OPEN' };
  };
  if (d.dtGroups[0]) rows.push(dtRowOf(d.dtGroups[0]));
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
  // 📋 LPA พบข้อไม่สอดคล้อง — note คือรายละเอียดปัญหาที่ผู้ตรวจลงไว้ (LPA ไม่มีช่องวิธีแก้ → OPEN เสมอ)
  if (d.lpa?.nt) {
    const it = d.lpa.items[0];
    rows.push({
      issue: `LPA พบ N/T ${d.lpa.nt} ข้อ จาก ${d.lpa.audits} ครั้งตรวจ${it ? ` — ${it.q}${it.note ? ` (${it.note})` : ''}` : ''}`,
      action: 'ยังไม่มีบันทึกการแก้ในระบบ — หัวหน้าไลน์ตามปิด + ทวนใน LPA รอบถัดไป',
      status: 'OPEN',
    });
  }
  // 🛠 ตรวจ PM/AM พบผิดปกติ (fail/warning) — เครื่องที่ผู้ตรวจติ๊กไม่ผ่านเอง
  if (d.pmFail?.count) {
    rows.push({
      issue: `ตรวจ PM/AM พบผิดปกติ ${d.pmFail.count} รายการ${d.pmFail.equips.length ? ` (${d.pmFail.equips.join(', ')})` : ''}${d.pmFail.sample ? ` — ${cut(d.pmFail.sample, 50)}` : ''}`,
      action: 'ออกใบซ่อม MO / แก้ให้จบแล้วตรวจซ้ำ',
      status: 'OPEN',
    });
  }
  // 💬 หมายเหตุปิดกะ — issue = ข้อความหัวหน้ากะ · action = remark ผู้อนุมัติ (ข้อความจริงทั้งคู่ ไม่แต่งแทน)
  if (d.shiftNotes?.count) {
    const last = d.shiftNotes.items[d.shiftNotes.items.length - 1];
    rows.push({
      issue: `หัวหน้ากะลงหมายเหตุปิดกะ ${d.shiftNotes.count} กะ — «${last?.req || last?.appr || '—'}» (${last?.line || ''} ${String(last?.date || '').slice(5)})`,
      action: last?.appr ? `SV: ${last.appr}` : 'ทวนสาเหตุในประชุมเช้า + ผูกเป็น action item',
      status: last?.appr ? 'ON GOING' : 'OPEN',
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
  // แถวเสริม (second tier): DT อันดับ 2 · fix coverage · Kaizen — โผล่เมื่อสไลด์ยังมีที่
  if (d.dtGroups[1]) rows.push(dtRowOf(d.dtGroups[1]));
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

  /* 📷 โหลดรูปหลักฐาน (MO ก่อน/หลังซ่อม + Kaizen) เป็น dataURL — best-effort: โหลดไม่ได้ = ข้ามรูปนั้น เด็คห้ามพัง */
  const imgData = async (url) => {
    if (!url) return null;
    if (url.startsWith('data:')) return url;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const buf = new Uint8Array(await res.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      const b64 = typeof btoa !== 'undefined' ? btoa(bin) : globalThis.Buffer.from(buf).toString('base64');
      return `data:${res.headers.get('content-type') || 'image/jpeg'};base64,${b64}`;
    } catch { return null; }
  };
  const photoUrlMap = {}; // url → dataURL (โหลดครั้งเดียวข้ามทุกส่วนงาน)
  {
    const urls = [...new Set(data.depts.flatMap(d => (d.photoPairs || []).flatMap(p => [p.before, p.after])).filter(Boolean))];
    const loaded = await Promise.all(urls.map(u => imgData(u)));
    urls.forEach((u, i) => { if (loaded[i]) photoUrlMap[u] = loaded[i]; });
  }
  const MON = monthLabel(data.monthKey);
  const NEXT = nextMonthLabel(data.monthKey);
  let pageNo = 0;

  /* เพดานล่างของเนื้อหาทุกสไลด์ — footer เริ่ม 6.948 ห้ามมีอะไรเลยเส้นนี้ (กฎ layout ข้อ 2) */
  const SAFE_BOTTOM = 6.85;

  const T = (t, o) => ({ text: t, options: o });
  // สถานะ Issue & Action — ศัพท์/สีตามชุดสถานะ TSG (เขียว=จบ · amber=กำลังทำ · ส้ม=ยังไม่มีเจ้าของ)
  const STATUS_CELL = {
    'CLOSED': { t: 'CLOSED', color: C.green, bold: true },
    'ON GOING': { t: 'ON GOING', color: C.amber, bold: true },
    'OPEN': { t: 'OPEN', color: C.orange, bold: true },
  };

  /* ป้ายเทียบเดือนก่อน (progression) — คืน null เมื่อไม่มีข้อมูลเดือนก่อนจริง (ห้ามโชว์ 0 หลอกว่า "เท่าเดิม")
     สีตามทิศทางที่ "ดีขึ้น" ของตัวชี้วัดนั้น: OEE/A/P/Q ยิ่งมากยิ่งดี · DT/PPM ยิ่งน้อยยิ่งดี */
  const deltaChip = (code, key, { lowerIsBetter = false, unit = '' } = {}) => {
    const m = momDelta(data.trend, code, key);
    if (!m || m.delta == null) return null;
    const good = m.delta === 0 ? null : (lowerIsBetter ? m.delta < 0 : m.delta > 0);
    const arrow = m.delta > 0 ? '▲' : m.delta < 0 ? '▼' : '=';
    return {
      text: `${arrow} ${m.delta > 0 ? '+' : ''}${m.delta}${unit || (key === 'oee' || ['a', 'p', 'q'].includes(key) ? ' pts' : '')} vs ${monthShort(m.prevKey)}`,
      color: good === null ? C.grey : good ? C.green : C.orange,
    };
  };

  /* ── ตำแหน่งตายตัวตาม template R01 (กฎ: ห้ามขยับข้ามหน้า) ── */
  const footer = (s) => {
    if (logoDataUrl) s.addImage({ data: logoDataUrl, x: 0.273, y: 7.052, w: 0.26, h: 0.26 });
    // x จริงของ template = 0.505 แต่กล่องนั้นมี inset ภายใน — เราตั้ง margin 0 จึงขยับ x ให้เท่า "จุดที่ตัวอักษรเริ่มจริง" (ไม่งั้นทับโลโก้)
    s.addText('THAI SUMMIT GROUP', { x: 0.62, y: 6.948, w: 3.55, h: 0.438, fontFace: FONT, fontSize: 20, bold: true, color: C.green, align: 'left', valign: 'middle', margin: 0 });
    s.addText(String(pageNo), { x: 10.28, y: 7.12, w: 2.75, h: 0.32, fontFace: FONT, fontSize: 12, color: C.green, align: 'right', valign: 'top', margin: 0 });
  };
  // หัวเรื่อง/หัวข้อย่อย — ย่อขนาดฟอนต์เองให้จบบรรทัดเดียวเสมอ (fit:'shrink' ใช้ไม่ได้จริง ดูกฎ layout ข้อ 1)
  const head = (s, title, subtitle) => {
    s.addText(title, { x: 0.28, y: 0.28, w: 12.5, h: 0.71, fontFace: FONT, fontSize: fitOneLine(title, 12.5, 36, 18), bold: true, color: C.green, align: 'left', valign: 'top', margin: 0 });
    if (subtitle) s.addText(subtitle, { x: 0.42, y: 1.05, w: 12.3, h: 0.44, fontFace: FONT, fontSize: fitOneLine(subtitle, 12.3, 20, 11), bold: true, color: C.green, align: 'left', valign: 'top', margin: 0 });
  };
  // Headline box ตาม template: พื้นเขียวเข้ม 0D3D14 ตัวขาว Tahoma 20 Bold
  const headline = (s, text, x, y, w = 2.6) => {
    s.addShape('rect', { x, y, w, h: 0.44, fill: { color: C.greenDark } });
    s.addText(text, { x, y, w, h: 0.44, fontFace: FONT, fontSize: fitOneLine(text, w - 0.16, 20, 10), bold: true, color: C.white, align: 'center', valign: 'middle', margin: 0 });
  };
  // การ์ดตัวเลข — ทั้งตัวเลขและป้ายย่อเองตามความกว้างที่ได้จริง (การ์ดแคบลงเมื่อเลือกหลายส่วนงาน)
  // sub = บรรทัดเทียบเดือนก่อน (progression) — ไม่มีก็ไม่กินที่
  const stat = (s, x, y, valueTxt, label, w = 2.6, sub = null) => {
    s.addText(valueTxt, { x, y, w, h: 0.62, fontFace: FONT, fontSize: fitOneLine(valueTxt, w - 0.08, 30, 13), bold: true, color: C.orange, align: 'center', valign: 'middle', margin: 0 });
    s.addText(label, { x, y: y + 0.58, w, h: 0.32, fontFace: FONT, fontSize: fitOneLine(label, w - 0.06, 11, 7.5), color: C.green, align: 'center', valign: 'top', margin: 0 });
    if (sub) s.addText(sub.text, { x, y: y + 0.86, w, h: 0.24, fontFace: FONT, fontSize: fitOneLine(sub.text, w - 0.06, 10, 7), bold: true, color: sub.color || C.grey, align: 'center', valign: 'top', margin: 0 });
  };
  /* bullet list ที่ "รู้เพดานตัวเอง" — ย่อฟอนต์ก่อน ถ้ายังไม่พอค่อยตัดหัวข้อท้าย (แล้วบอกว่าตัดกี่ข้อ)
     เดิมกล่องสูง 0.42×จำนวนข้อ ตายตัว → ข้อความไทยยาวห่อ 2-3 บรรทัดเมื่อไหร่ = ทะลุทับ footer */
  const bullets = (s, items, x, y, w, fs = 13, bottom = SAFE_BOTTOM) => {
    const list = (items || []).filter(Boolean);
    if (!list.length || y >= bottom) return y;
    const room = bottom - y;
    const heightAt = (arr, size) => arr.reduce((a, t) => a + textHeightIn(t, w - 0.25, size) + 0.06, 0.04);
    let size = fs, show = list;
    for (let sz = fs; sz >= 8; sz -= 0.5) { if (heightAt(list, sz) <= room) { size = sz; break; } size = 8; }
    if (heightAt(show, size) > room) {
      while (show.length > 1 && heightAt(show, size) > room) show = show.slice(0, -1);
      const cutN = list.length - show.length;
      if (cutN > 0 && show.length > 1) show = [...show.slice(0, -1), `${show[show.length - 1]} (+ อีก ${cutN} ประเด็น — ดูในระบบ)`];
    }
    const h = Math.min(room, heightAt(show, size));
    s.addText(show.map((t, i) => T(t, { bullet: { code: '2022' }, breakLine: i < show.length - 1, paraSpaceAfter: 4 })),
      { x, y, w, h, fontFace: FONT, fontSize: size, color: C.green, align: 'left', valign: 'top', margin: 0 });
    return y + h;
  };
  /* ตาราง R01: หัวเขียวเข้มตัวขาว · body เขียว 068734 · แถวสลับเทาอ่อน F2F2F2
     เซลล์เป็น object { t, color, bold } ได้ — ใช้กับคอลัมน์สถานะ Issue & Action

     ⚠️ คืนค่าเป็น { bottom, hidden, fontSize } เสมอ — caller **ต้อง** เอา bottom ไปวาง element ถัดไป
        ห้ามคำนวณเองจาก rowH × จำนวนแถว (rowH เป็นแค่ขั้นต่ำ · แถวโตเองได้ ดูกฎ layout ข้อ 2)
        hidden > 0 = ตัดแถวไปเพราะไม่พอ — caller ต้องพิมพ์ "+ อีก N" (กฎ layout ข้อ 4) */
  const tsgTable = (s, headRow, rows, opts = {}) => {
    const normCell = (cell) => (cell && typeof cell === 'object' && 't' in cell) ? cell : { t: cell };
    const x = opts.x ?? 0.5, y = opts.y ?? 2.0, w = opts.w ?? 12.3;
    const colW = opts.colW || headRow.map(() => w / headRow.length);
    const maxH = Math.max(0.6, (opts.bottom ?? SAFE_BOTTOM) - y);
    const plain = rows.map(r => r.map(c => normCell(c).t));
    const L = layoutTable({
      head: headRow, rows: plain, colW,
      fontSize: opts.fontSize || 11.5, minFontSize: opts.minFontSize ?? 8,
      headFontSize: 11.5, minRowH: opts.rowH ?? 0.34, headMinH: opts.headRowH ?? 0.34, maxH,
    });
    const shown = rows.slice(0, L.rows.length);
    const tableRows = [
      headRow.map(h => ({ text: h, options: { fontFace: FONT, fontSize: L.headFontSize, bold: true, color: C.white, fill: { color: C.greenDark }, align: 'center', valign: 'middle' } })),
      ...shown.map((row, ri) => row.map((cell, ci) => {
        const c0 = normCell(cell);
        return {
          text: String(c0.t ?? '—'),
          options: {
            fontFace: FONT, fontSize: L.fontSize, color: c0.color || C.green, bold: c0.bold ?? (ci === 0),
            fill: { color: ri % 2 === 0 ? C.tint : C.white },
            align: ci === 0 || opts.leftCols?.includes(ci) ? 'left' : 'center', valign: 'middle',
          },
        };
      })),
    ];
    s.addTable(tableRows, { x, y, w, colW, border: { type: 'solid', color: C.border, pt: 0.75 }, rowH: [L.headRowH, ...L.rowHs], autoPage: false });
    return { bottom: y + L.height, hidden: L.hidden, fontSize: L.fontSize };
  };
  /* บรรทัดหมายเหตุใต้ตาราง — วางจาก "ก้นตารางจริง" และไม่ยอมข้าม SAFE_BOTTOM */
  const noteLine = (s, text, y, { x = 0.6, w = 12.1, size = 10, italic = true, color = C.grey, bottom = SAFE_BOTTOM } = {}) => {
    if (!text || y >= bottom) return y;
    const fs = fitOneLine(text, w, size, 7.5);
    const h = Math.min(bottom - y, lineHeightIn(fs) + 0.06);
    s.addText(text, { x, y, w, h, fontFace: FONT, fontSize: fs, italic, color, align: 'left', valign: 'top', margin: 0 });
    return y + h;
  };
  // สไลด์ divider ตาม template: รูปเต็มฝั่งขวา + ระนาบขาวขอบเฉียง + หัวข้อเขียว 40 Bold ฝั่งซ้าย (ไม่มี footer)
  const divider = (s, title, photo) => {
    if (photo) s.addImage({ data: photo, x: 5.92, y: 0, w: 7.41, h: 7.5, sizing: { type: 'cover', w: 7.41, h: 7.5 } });
    s.addShape('rect', { x: -0.05, y: 0, w: 6.1, h: 7.5, fill: { color: C.white } });
    s.addShape('rtTriangle', { x: 6.05, y: 0, w: 1.31, h: 7.5, flipV: true, fill: { color: C.white } });
    // กล่องแคบกว่า template เล็กน้อย (6.3 แทน 7.27) — หัวข้อของเรายาวกว่า "Agenda : xxx" ต้องไม่ชนขอบเฉียง
    s.addText(title, { x: 0.1, y: 2.98, w: 6.3, h: 0.77, fontFace: FONT, fontSize: fitOneLine(title, 6.2, 36, 16), bold: true, color: C.green, align: 'center', valign: 'middle', margin: 0 });
  };
  const newSlide = () => { pageNo += 1; return pres.addSlide(); };

  /* ── Slide 1: Title (R01 — พื้นขาว โลโก้บนกลาง แถบรูปท้ายสไลด์) ── */
  {
    const s = newSlide();
    if (logoDataUrl) s.addImage({ data: logoDataUrl, x: 5.92, y: 0.28, w: 1.25, h: 1.25 });
    const coverTitle = `MONTHLY PERFORMANCE REVIEW ${MON}`;
    s.addText(coverTitle, { x: 0.6, y: 1.72, w: 12.13, h: 0.77, fontFace: FONT, fontSize: fitOneLine(coverTitle, 12.13, 40, 22), bold: true, color: C.green, align: 'center', valign: 'middle', margin: 0 });
    const who = [presenter, position].filter(Boolean).join(', ');
    s.addText([
      ...(who ? [T(who, { breakLine: true })] : []),
      T([orgLine, MON].filter(Boolean).join(', '), {}),
    ], { x: 3.03, y: 2.76, w: 7.27, h: 0.95, fontFace: FONT, fontSize: 18, color: C.green, align: 'center', valign: 'top', margin: 0 });
    s.addText('My Quality Declaration', { x: 5.07, y: 4.33, w: 3.16, h: 0.4, fontFace: FONT, fontSize: 18, bold: true, italic: true, color: C.green, align: 'center', margin: 0 });
    s.addText('“I will not accept, produce and deliver non-quality work”', { x: 2.30, y: 5.10, w: 9.12, h: 0.4, fontFace: FONT, fontSize: 18, color: C.green, align: 'center', margin: 0 });
    const declTh = '“ผมจะไม่รับ, ไม่ทำและไม่ส่งมอบงานที่ไม่มีคุณภาพ”';
    s.addText(declTh, { x: 3.78, y: 5.64, w: 5.78, h: 0.4, fontFace: FONT, fontSize: fitOneLine(declTh, 5.7, 18, 11), color: C.green, align: 'center', margin: 0 });
    /* แถบรูปท้ายสไลด์ปก
       ⚠️ 2026-09-08 (user: "ภาพตก"): ใบที่ 4 เคยอยู่ x=12.69 กว้าง 2.02 → ขอบขวา 14.71
          บนสไลด์กว้าง 13.33 = **โผล่ให้เห็นแค่ 0.64" หายไปนอกจอ 68%** และห่างจากใบที่ 3
          ถึง 1.44" ทั้งที่ใบ 1→2→3 ห่างกัน ~2.2" เท่ากัน (เลขหลุดตอนถอดสเปคจาก template)
          ⇒ วางเป็นระยะเท่ากันจากใบที่ 3 แล้วบลีดพ้นขอบแค่เล็กน้อยตามต้นฉบับ */
    const strip = photos?.strip || [];
    const POSN = [
      { x: 4.85, y: 6.10, w: 2.10, h: 1.27 }, { x: 7.08, y: 6.10, w: 2.03, h: 1.26 },
      { x: 9.23, y: 6.07, w: 2.02, h: 1.30 }, { x: 11.38, y: 6.10, w: 2.02, h: 1.27 },
    ];
    POSN.forEach((p, i) => { if (strip[i]) s.addImage({ data: strip[i], ...p, sizing: { type: 'cover', w: p.w, h: p.h } }); });
  }

  /* ── Slide 2: Agenda (R01 — ลิสต์เลขสีเขียว ไม่มีวงกลมส้มแล้ว) ── */
  {
    const s = newSlide();
    head(s, `MONTHLY PERFORMANCE REVIEW ${MON}`, 'Agenda');
    // ชื่อไลน์ในวาระ: ยาวเกิน 6 ไลน์ ให้ย่อเป็น "+อีก N ไลน์" (เลือกทั้งโรงงาน = 26 ไลน์ ไม่งั้นล้นหน้า)
    const lineBrief = (d) => {
      const nm = d.lines.map(l => l.name);
      return nm.length > 6 ? `${nm.slice(0, 6).join(' / ')} + อีก ${nm.length - 6} ไลน์` : nm.join(' / ');
    };
    const items = [
      `EXECUTIVE SUMMARY : ${data.depts.map(d => d.code).join(' <> ')} OEE / A / P / Q`,
      'OEE ACTUAL BY LINE',
      ...(data.trend?.months?.length > 1 ? [`PERFORMANCE TREND : ${data.trend.months.length} MONTHS PROGRESSION`] : []),
      ...data.depts.map(d => `${d.code} REVIEW : Overall → ${lineBrief(d)} → Issue & Action`),
      `ISSUE & ACTION SUMMARY : ${NEXT.toUpperCase()} FOCUS`,
    ];
    // ย่อฟอนต์ตามจำนวน/ความยาววาระจริง — ส่วนงานเยอะ (4 ส่วน) วาระยาวขึ้นเองอัตโนมัติ
    const agendaW = 11.0, agendaTop = 1.93, agendaRoom = SAFE_BOTTOM - agendaTop;
    let agendaFs = 16;
    for (let sz = 16; sz >= 9; sz -= 0.5) {
      const hh = items.reduce((a, t, i) => a + textHeightIn(`${i + 1}.   ${t}`, agendaW, sz) + 0.14, 0);
      agendaFs = sz; if (hh <= agendaRoom) break;
    }
    const agendaH = Math.min(agendaRoom, items.reduce((a, t, i) => a + textHeightIn(`${i + 1}.   ${t}`, agendaW, agendaFs) + 0.14, 0));
    s.addText(items.map((t, i) => T(`${i + 1}.   ${t}`, { breakLine: i < items.length - 1, paraSpaceAfter: 10 })),
      { x: 1.56, y: agendaTop, w: agendaW, h: agendaH, fontFace: FONT, fontSize: agendaFs, color: C.green, align: 'left', valign: 'top', margin: 0 });
    footer(s);
  }

  /* ── Slide 3: Executive summary ── */
  {
    const s = newSlide();
    head(s, `EXECUTIVE SUMMARY : ${data.depts.map(d => d.code).join(' <> ')} OEE / A / P / Q`, `${MON} PERFORMANCE STORY`);
    const n = data.depts.length;
    const statW = Math.min(2.9, 12.3 / (n * 2));
    data.depts.forEach((d, i) => {
      // ▲▼ เทียบเดือนก่อน (progression) — ไม่มีข้อมูลเดือนก่อน = ไม่ขึ้นบรรทัดนี้ ห้ามเดา
      stat(s, 0.6 + i * statW, 1.75, pct(d.oee), `${d.code} OEE`, statW - 0.15, deltaChip(d.code, 'oee'));
      stat(s, 0.6 + (n + i) * statW, 1.75, `${d.dtHr}h`, `${d.code} DT`, statW - 0.15, deltaChip(d.code, 'dtHr', { lowerIsBetter: true, unit: 'h' }));
      const apq = `A ${pct(d.a)} | P ${pct(d.p)} | Q ${pct(d.q)}`;
      s.addText(apq, { x: 0.6 + i * statW, y: 3.02, w: statW - 0.15, h: 0.3, fontFace: FONT, fontSize: fitOneLine(apq, statW - 0.2, 10.5, 6.5), color: C.green, align: 'center', valign: 'top', margin: 0 });
    });
    const t3 = tsgTable(s,
      ['Dept / Line', 'OEE', 'A', 'P', 'Q', 'Output', 'PPM', 'DT Hr'],
      data.depts.map(d => [`${d.code} Overall`, pct(d.oee), pct(d.a), pct(d.p), pct(d.q), num(d.output), num(d.ppm), d.dtHr]),
      { y: 3.42, rowH: 0.4, bottom: 5.6 });
    bullets(s, execStory(data.depts, data.trend), 0.6, t3.bottom + 0.14, 12.1, 12.5);
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
    // ป้ายแกน: 13-18 ไลน์ = 8pt · เกิน 18 ไลน์ = เอียง 45° ไม่งั้นชื่อไลน์ทับกันจนอ่านไม่ออก
    const nL = lines.length;
    const lblSize = nL > 18 ? 7 : nL > 12 ? 8 : nL > 8 ? 9.5 : 11;
    s.addChart(pres.ChartType.bar, [{ name: 'OEE %', labels, values }], {
      x: 0.5, y: 2.2, w: 12.33, h: 4.3, barDir: 'col', barGapWidthPct: nL > 18 ? 30 : 60,
      chartColors: [C.barOrange],
      showValue: true, dataLabelPosition: 'outEnd', dataLabelColor: C.green, dataLabelFontFace: FONT, dataLabelFontSize: lblSize, dataLabelFormatCode: '0.0',
      catAxisLabelColor: C.green, catAxisLabelFontFace: FONT, catAxisLabelFontSize: lblSize,
      ...(nL > 18 ? { catAxisLabelRotate: 45 } : {}),
      valAxisHidden: true, valAxisMaxVal: 110, valAxisMinVal: 0,
      valGridLine: { style: 'none' }, catGridLine: { style: 'none' },
      showLegend: false, showTitle: false,
    });
    footer(s);
  }

  /* ── Slide: PERFORMANCE TREND (progression หลายเดือน) ──
     โผล่เฉพาะเมื่อ user เลือกช่วงย้อนหลัง ≥ 2 เดือนที่มีข้อมูลจริง — เลือกเดือนเดียว = เด็คหน้าตาเดิมเป๊ะ */
  if (data.trend?.months?.length > 1) {
    const s = newSlide();
    const mks = data.trend.months;
    const labels = mks.map(monthShort);
    head(s, `PERFORMANCE TREND : ${mks.length} MONTHS`, `${monthShort(mks[0])} → ${MON} — OEE / DOWNTIME PROGRESSION`);
    // กราฟเส้น OEE รายส่วนงาน (เส้นละส่วนงาน) — ตอบ "ดีขึ้นหรือแย่ลง" ในภาพเดียว
    const palette = [C.barOrange, C.green, C.amber, C.greenDark, C.orange];
    const seriesOee = data.depts.map(d => ({
      name: `${d.code} OEE`,
      labels,
      values: mks.map(mk => {
        const r = (data.trend.byDept[d.code] || []).find(x => x.monthKey === mk);
        return (r && r.nSess > 0 && r.oee != null) ? r1(r.oee) : null;
      }),
    }));
    // ส่วนงานเยอะ = ตารางด้านล่างต้องการที่มากขึ้น → กราฟเตี้ยลง (ยังอ่านทิศทางได้)
    const chartH = data.depts.length >= 3 ? 2.05 : 2.5;
    s.addChart(pres.ChartType.line, seriesOee, {
      x: 0.5, y: 1.62, w: 12.33, h: chartH, chartColors: palette.slice(0, seriesOee.length),
      lineSize: 3, lineDataSymbolSize: 8, showValue: true,
      dataLabelColor: C.green, dataLabelFontFace: FONT, dataLabelFontSize: 9, dataLabelFormatCode: '0.0',
      catAxisLabelColor: C.green, catAxisLabelFontFace: FONT, catAxisLabelFontSize: 11,
      valAxisLabelColor: C.green, valAxisLabelFontFace: FONT, valAxisLabelFontSize: 10, valAxisMaxVal: 100, valAxisMinVal: 0,
      valGridLine: { style: 'solid', color: C.border, size: 0.5 }, catGridLine: { style: 'none' },
      showLegend: seriesOee.length > 1, legendPos: 'b', legendColor: C.green, legendFontFace: FONT, legendFontSize: 10,
      showTitle: false,
    });
    // ตารางตัวเลขต่อเดือน + Δ เดือนล่าสุดเทียบเดือนก่อน — ห้องประชุมอ่านทิศทางได้โดยไม่ต้องเพ่งกราฟ
    const ALL_METRICS = [
      { key: 'oee', label: 'OEE %', fmt: pct, lower: false },
      { key: 'dtHr', label: 'Unplanned DT (h)', fmt: v => (v == null ? '—' : `${v}`), lower: true },
      { key: 'ppm', label: 'PPM', fmt: num, lower: true },
      { key: 'output', label: 'Output', fmt: num, lower: false },
    ];
    /* เลือกจำนวนตัวชี้วัดตามที่ "พื้นที่จริงรับได้" (ส่วนงาน × ตัวชี้วัด = จำนวนแถว)
       เดิมยัด 4 ตัวชี้วัดเสมอ → 4 ส่วนงาน = 16 แถว ไม่พอ ตารางย่อฟอนต์ถึง 7.5 แล้วยังตัดทิ้ง 10 แถว
       ⇒ เลือกตามลำดับความสำคัญ OEE → DT → PPM → Output แล้วบอกตัวที่ไม่ได้ลงในหมายเหตุ */
    const tableY = 1.62 + chartH + 0.12;
    const ROW_H = 0.3;
    const roomRows = Math.max(1, Math.floor(((SAFE_BOTTOM - 0.3) - tableY) / ROW_H) - 1);
    const nMetric = Math.max(1, Math.min(ALL_METRICS.length, Math.floor(roomRows / data.depts.length)));
    const METRICS = ALL_METRICS.slice(0, nMetric);
    const skipped = ALL_METRICS.slice(nMetric).map(m => m.label);
    const trRows = [];
    data.depts.forEach(d => METRICS.forEach(mt => {
      const cells = mks.map(mk => {
        const r = (data.trend.byDept[d.code] || []).find(x => x.monthKey === mk);
        return (r && r.nSess > 0) ? mt.fmt(r[mt.key]) : '—';
      });
      const m = momDelta(data.trend, d.code, mt.key);
      const good = !m || m.delta === 0 ? null : (mt.lower ? m.delta < 0 : m.delta > 0);
      trRows.push([
        d.code, mt.label, ...cells,
        m ? { t: `${m.delta > 0 ? '+' : ''}${m.delta}`, color: good === null ? C.grey : good ? C.green : C.orange, bold: true } : { t: '—', color: C.grey },
      ]);
    }));
    const firstW = 0.9, labW = 2.0, dW = 0.95;
    const monW = Math.max(0.7, (12.3 - firstW - labW - dW) / mks.length);
    const tt = tsgTable(s, ['Dept', 'Metric', ...labels, `Δ vs ${monthShort(mks[mks.length - 2])}`], trRows, {
      y: tableY, rowH: ROW_H, headRowH: 0.3, fontSize: 10, minFontSize: 8,
      colW: [firstW, labW, ...mks.map(() => monW), dW], leftCols: [1], bottom: SAFE_BOTTOM - 0.28,
    });
    let yT = tt.bottom + 0.06;
    if (tt.hidden) yT = noteLine(s, `+ อีก ${tt.hidden} แถว — ดูครบใน /oee-analytics แท็บแนวโน้ม`, yT, { size: 9 }) + 0.02;
    const misses = data.trend.missing?.length ? ` · เดือนที่ไม่มีกะปิดเลย ตัดออกจากกราฟ: ${data.trend.missing.map(monthShort).join(', ')}` : '';
    const skipTxt = skipped.length ? ` · ไม่พอที่ในหน้านี้: ${skipped.join(' / ')} (ดูใน /oee-analytics แท็บแนวโน้ม)` : '';
    noteLine(s, `ทุกเดือนคำนวณด้วยสูตรเดียวกับเดือนรายงาน (กะที่ปิดแล้วเท่านั้น · DT นับเฉพาะนอกแผน · PPM ไม่รวมงานทดลอง)${misses}${skipTxt}${data.trend.warn ? ` · ⚠ ${data.trend.warn}` : ''}`,
      yT, { size: 9 });
    footer(s);
  }

  /* ── Slide 5: OEE breakdown all areas ──
     ⚠️ เดิมตัดที่ 12 แถวตายตัว: เลือกทั้งโรงงาน (26 ไลน์ + 4 ส่วนงาน = 30 แถว) = **หายไป 18 แถว**
        และหมายเหตุที่วางด้วยเลข 13×0.38 ตายตัวก็ไปทับ footer (user: "รายละเอียดยังขาด")
     ⇒ แบ่งหน้าแทนการตัด — ทุกไลน์ที่ user ติ๊กต้องอยู่ในเด็คเสมอ */
  {
    const rows = [];
    data.depts.forEach(d => {
      rows.push([`${d.code} Overall`, pct(d.oee), pct(d.a), pct(d.p), pct(d.q), `OEE constrained by ${lowestDriver(d)}`, lowestDriver(d) === 'A' ? 'Recover downtime' : 'Cycle stability']);
      d.lines.forEach(l => {
        rows.push([l.name, pct(l.oee), pct(l.a), pct(l.p), pct(l.q), `${lineReadout(l)} focus`, l.dtGroups[0] ? `${l.dtGroups[0].name}` : 'Hold standard']);
      });
    });
    const HEAD5 = ['Area', 'OEE', 'Availability', 'Performance', 'Quality', 'Primary readout', 'Focus'];
    // headRowH ต้องตรงกับที่ใช้ตอนนับหน้าล่วงหน้าเป๊ะ ไม่งั้นเลข "2/3" บนหัวสไลด์เพี้ยนจากจำนวนหน้าจริง
    const OPT5 = { y: 1.85, rowH: 0.38, headRowH: 0.38, colW: [2.1, 1.2, 1.4, 1.5, 1.2, 2.7, 2.2], fontSize: 11, bottom: SAFE_BOTTOM - 0.05 };
    let rest = rows, page = 0;
    const nPage = (() => { // ลองวางล่วงหน้าเพื่อรู้จำนวนหน้าก่อน (หัวสไลด์ต้องบอก "2/3" ตั้งแต่หน้าแรก)
      let left = rows.length, pages = 0;
      while (left > 0 && pages < 12) {
        const fit = layoutTable({ head: HEAD5, rows: rows.slice(rows.length - left).map(r => r), colW: OPT5.colW, fontSize: 11, minRowH: 0.38, headMinH: 0.38, maxH: OPT5.bottom - OPT5.y });
        const take = Math.max(1, fit.rows.length);
        left -= take; pages += 1;
      }
      return Math.max(1, pages);
    })();
    while (rest.length && page < 12) {
      page += 1;
      const s = newSlide();
      head(s, `OEE BREAKDOWN : WHY OEE MOVED${nPage > 1 ? ` (${page}/${nPage})` : ''}`, 'A / P / Q COMPARISON');
      const t5 = tsgTable(s, HEAD5, rest, OPT5);
      rest = rest.slice(rest.length - t5.hidden);
      if (rest.length) noteLine(s, `→ อีก ${rest.length} แถวอยู่หน้าถัดไป (ทุกไลน์ที่เลือกอยู่ในเด็คครบ)`, t5.bottom + 0.06, { x: 0.5, w: 12.3, size: 10 });
      footer(s);
    }
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
        stat(s, 0.6 + i * 3.05, 1.7, pct(v), lb === 'OEE' ? `Overall ${d.code}` : lb === 'A' ? 'Availability' : lb === 'P' ? 'Performance' : 'Quality', 2.9,
          deltaChip(d.code, lb === 'OEE' ? 'oee' : lb.toLowerCase()));
      });
      /* ⚠️ เดิมตัดไลน์เหลือ 6 แถว **แบบเงียบ** (slice(0,6) ไม่มีหมายเหตุ) — ส่วนงานที่มี 11 ไลน์
         หายไป 5 ไลน์โดยไม่มีใครรู้ (user: "รายละเอียดยังขาด") · ตอนนี้ให้ตารางกินพื้นที่เท่าที่มี
         แล้ว "+ อีก N ไลน์" เสมอเมื่อตัด (กฎ layout ข้อ 4) */
      const tl = tsgTable(s,
        ['Line', 'OEE', 'A', 'P', 'Q', 'Output', 'PPM', 'DT Hr'],
        d.lines.map(l => [l.name, pct(l.oee), pct(l.a), pct(l.p), pct(l.q), num(l.output), num(l.ppm), l.dtHr]),
        { y: 2.95, rowH: 0.36, bottom: 5.6 });
      let yy = tl.bottom + 0.08;
      if (tl.hidden) yy = noteLine(s, `+ อีก ${tl.hidden} ไลน์ที่ไม่พอในหน้านี้ — ดูครบในสไลด์ OEE BREAKDOWN / หน้า /oee-analytics`, yy, { size: 10 }) + 0.04;
      bullets(s, deptStory(d, data.trend), 0.6, yy, 12.1, 11.5);
      footer(s);
    }
    // Loss detail (top downtime + การแก้ไขที่หัวหน้างานลงในระบบ + ใบซ่อม MO)
    // มีรูปหลักฐาน = ตาราง 2 กลุ่ม + แถบรูป ก่อน→หลัง · ไม่มีรูป = 3 กลุ่มเต็มเหมือนเดิม
    {
      const s = newSlide();
      head(s, `${d.code} LOSS DETAIL : TOP DOWNTIME`, `FROM OEE LOSS TO ACTION — ${MON}`);
      const pairs = (d.photoPairs || [])
        .map(p => ({ ...p, beforeData: photoUrlMap[p.before] || null, afterData: photoUrlMap[p.after] || null }))
        .filter(p => p.beforeData || p.afterData);
      const nGroups = pairs.length ? 2 : 3;
      const rows = [];
      d.dtGroups.slice(0, nGroups).forEach(g => {
        const detail = g.items.map((it, i) =>
          `(${i + 1}) ${it.date.slice(8, 10)}/${it.date.slice(5, 7)} ${it.machine ? it.machine + ' ' : ''}${it.desc || '-'} (${it.min} min)${it.fix ? `\n     → ${it.fix}` : ''}`).join('\n');
        rows.push([`${g.name}\n${hr1(g.min)}h / ${g.count} ครั้ง`, detail || '—', `${g.fixed}/${g.count}`]);
      });
      if (!rows.length) rows.push(['—', 'No unplanned downtime recorded this month', '—']);
      // มีแถบรูป = ตารางต้องจบก่อน 4.95 (แถบรูปสูง ~1.55 + หัวข้อ) · ไม่มีรูป = ใช้พื้นที่ถึง 6.0
      const tabBottom = pairs.length ? 4.95 : 6.0;
      const tLoss = tsgTable(s, ['Loss / เวลาสูญเสีย', 'รายละเอียดปัญหา + การแก้ไข (จากหน้างาน + ใบซ่อม MO)', 'ลงวิธีแก้'], rows,
        { y: 1.72, rowH: pairs.length ? 1.2 : 1.42, headRowH: 0.32, colW: [2.3, 8.9, 1.1], fontSize: 9.5, minFontSize: 8, leftCols: [1], bottom: tabBottom });
      const cov = d.fixCov;
      if (tLoss.hidden) noteLine(s, `+ อีก ${tLoss.hidden} ประเภทการหยุด — ดูครบใน /oee-analytics`, tLoss.bottom + 0.04, { size: 9.5 });
      if (pairs.length) {
        // 📷 แถบหลักฐาน ก่อน → หลัง (รูปที่ช่าง/หัวหน้างานแนบในใบซ่อม MO / Kaizen)
        // ⚠️ ต้องวางจาก "ก้นตารางจริง" ไม่ใช่ rowH × จำนวนแถว — ไม่งั้นรูปทับตารางเมื่อแถวโตเอง
        const stripY = Math.min(tLoss.bottom + (tLoss.hidden ? 0.28 : 0.15), SAFE_BOTTOM - 1.55);
        s.addText(`หลักฐานการแก้ไข ก่อน → หลัง (รูปจากใบซ่อม MO / Kaizen ที่หน้างานแนบ) · countermeasures ${cov.fixed}/${cov.total} รายการ`,
          { x: 0.6, y: stripY, w: 12.1, h: 0.26, fontFace: FONT, fontSize: 10.5, bold: true, color: C.green, align: 'left', margin: 0 });
        pairs.slice(0, 3).forEach((p, i) => {
          const px = 0.6 + i * 4.15;
          const py = stripY + 0.3;
          s.addText(cut(p.label, 34), { x: px, y: py, w: 3.9, h: 0.2, fontFace: FONT, fontSize: 9, bold: true, color: C.green, align: 'left', margin: 0 });
          if (p.beforeData) s.addImage({ data: p.beforeData, x: px, y: py + 0.22, w: 1.72, h: 1.02, sizing: { type: 'cover', w: 1.72, h: 1.02 } });
          else s.addText('ไม่มีรูปก่อน', { x: px, y: py + 0.22, w: 1.72, h: 1.02, fontFace: FONT, fontSize: 8, color: C.grey, align: 'center', valign: 'middle', margin: 0 });
          s.addText('→', { x: px + 1.74, y: py + 0.22, w: 0.4, h: 1.02, fontFace: FONT, fontSize: 18, bold: true, color: C.orange, align: 'center', valign: 'middle', margin: 0 });
          if (p.afterData) s.addImage({ data: p.afterData, x: px + 2.16, y: py + 0.22, w: 1.72, h: 1.02, sizing: { type: 'cover', w: 1.72, h: 1.02 } });
          else s.addText('ไม่มีรูปหลัง', { x: px + 2.16, y: py + 0.22, w: 1.72, h: 1.02, fontFace: FONT, fontSize: 8, color: C.grey, align: 'center', valign: 'middle', margin: 0 });
        });
      } else {
        bullets(s, [
          cov.total
            ? `${d.code}: countermeasures logged on ${cov.fixed}/${cov.total} unplanned stops${data.fixSlim ? ' (fix columns not yet migrated on this DB)' : ''} — unresolved items carry to ${NEXT}.`
            : `${d.code}: no unplanned downtime recorded this month.`,
          'Use daily line meeting to confirm top stop category and owner — escalate repeats until closure.',
        ], 0.6, Math.max(tLoss.bottom + 0.15, 6.0), 12.1, 11);
      }
      footer(s);
    }
    // Quality detail — โชว์เมื่อมีของเสีย (ดึง fix_action ของหัวหน้างานฝั่ง defect ด้วย)
    if (d.defGroups.length) {
      const s = newSlide();
      head(s, `${d.code} QUALITY DETAIL : TOP DEFECTS`, `NG + SUSPECT — ${MON} (PPM ${num(d.ppm)})`);
      const rows = d.defGroups.slice(0, 4).map(g => {
        // วัน+ไลน์ต้องขึ้นก่อนตัวอาการเสมอ — ไม่งั้นหัวหน้ากลุ่มไล่หาย้อนหลังในระบบไม่เจอว่าเกิดวันไหน
        const detail = g.items.map((it, i) =>
          `(${i + 1}) ${it.date ? `${it.date.slice(8, 10)}/${it.date.slice(5, 7)} ` : ''}${it.line ? `${it.line} ` : ''}${it.desc || '-'} (${num(it.qty)} ชิ้น)${it.fix ? `\n     → ${it.fix}` : ''}`).join('\n');
        return [`${g.name}\n${num(g.qty)} ชิ้น / ${g.count} ครั้ง`, detail || '—'];
      });
      // เดิมวาง bullet ที่ y=6.2 ตายตัว ทั้งที่ตาราง 4 แถว × 1.05 จบที่ 6.24 → ทับกันทุกครั้งที่มี 4 ประเภท
      const tq = tsgTable(s, ['Defect / จำนวน', 'ตัวอย่างปัญหา + การแก้ไข (จากหน้างาน)'], rows,
        { y: 1.72, rowH: 1.0, headRowH: 0.32, colW: [2.9, 9.4], fontSize: 9.5, leftCols: [1], bottom: 5.9 });
      let yq = tq.bottom + 0.1;
      if (tq.hidden) yq = noteLine(s, `+ อีก ${tq.hidden} ประเภทของเสีย — ดูครบใน /qa`, yq, { size: 9.5 }) + 0.02;
      bullets(s, [
        `Quality holds ${pct(d.q)} — verify countermeasures above prevented recurrence before closing in ${NEXT}.`,
        ...(d.trialQty ? [`🧪 Try-out defects ${num(d.trialQty)} ชิ้น — แสดงในรายการแต่ไม่นับใน PPM ตามกฎ Q (ไลน์ไม่ถูกลงโทษจากงานทดลอง)`] : []),
      ], 0.6, yq, 12.1, 11);
      footer(s);
    }
    // ISSUE & ACTION ต่อส่วนงาน — ผลวิเคราะห์ทุกตัว (lever/top DT/เครื่องเรื้อรัง/defect/coverage)
    // ตกลงเป็นแถว Issue → Action → Status · Action มาจากที่หัวหน้างานลงจริง ไม่มี = OPEN ห้ามแต่งแทน
    {
      const s = newSlide();
      head(s, `${d.code} ISSUE & ACTION`, `ANSWERED FROM CENTRALIZED SHOPFLOOR DATA — ${MON}`);
      const allRows = issueRowsOf(d, NEXT, data.trend);
      // เดิม 8 แถว × 0.56 + หมายเหตุที่ y คำนวณจาก rowH ตายตัว → ก้นตารางจริง 6.52 + หมายเหตุ = 6.99
      // ทับ footer (6.948) ทุกใบ · ตอนนี้ตารางบอกก้นจริง แล้วหมายเหตุวางต่อจากนั้น
      const rows = allRows.slice(0, 9).map(rw => [
        rw.issue, cut(rw.action, 150), STATUS_CELL[rw.status] || rw.status,
      ]);
      const ti = tsgTable(s, ['Issue (จากการวิเคราะห์ข้อมูล)', 'Action (จากหน้างาน + MO + ประชุมเช้า + Kaizen)', 'Status'], rows,
        { y: 1.72, rowH: 0.5, headRowH: 0.32, colW: [4.6, 6.5, 1.2], fontSize: 9.5, leftCols: [1], bottom: SAFE_BOTTOM - 0.3 });
      const restN = allRows.length - (rows.length - ti.hidden);
      noteLine(s, `Issue คำนวณจากบันทึกจริงทั้งเดือน · Action คือข้อความที่หัวหน้างาน/ช่างลงในระบบ — แถว OPEN = ยังไม่มีใครลงวิธีแก้ ต้องมอบหมายในที่ประชุมนี้${restN > 0 ? ` · + อีก ${restN} ประเด็นดูในระบบ` : ''}`,
        ti.bottom + 0.1, { size: 10 });
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
    // แถวสรุป: หยิบ 2 issue แรกของแต่ละส่วนงาน (lever + top DT) — เกิน 8 แถวตัด แล้วชี้ไปสไลด์รายส่วน
    const sumAll = data.depts.flatMap(d => issueRowsOf(d, NEXT, data.trend).slice(0, 2).map(rw => [
      d.code, rw.issue, cut(rw.action, 120), STATUS_CELL[rw.status] || rw.status,
    ]));
    const CAP = 8;
    const ts = tsgTable(s, ['Dept', 'Issue', 'Action', 'Status'], sumAll.slice(0, CAP),
      { y: 2.78, rowH: 0.5, headRowH: 0.3, colW: [0.9, 4.7, 5.5, 1.2], fontSize: 9.5, leftCols: [1, 2], bottom: 5.9 });
    const hiddenSum = sumAll.length - (Math.min(CAP, sumAll.length) - ts.hidden);
    let ys = ts.bottom + 0.1;
    if (hiddenSum > 0) ys = noteLine(s, `+ อีก ${hiddenSum} ประเด็นของส่วนงานอื่น — ดูสไลด์ ISSUE & ACTION ของแต่ละส่วนงาน`, ys, { size: 10 }) + 0.02;
    const worstLine = data.depts.flatMap(d => d.lines).sort((a, b) => (a.oee ?? 0) - (b.oee ?? 0))[0];
    // 🎯 จุดขาย: ทั้งเด็คตอบจากข้อมูลกลางชุดเดียว — บันทึกหน้างานครั้งเดียว ไหลถึงห้องประชุมเอง
    const claim = 'All issues & actions in this deck are answered from ESM centralized shopfloor records — downtime · countermeasures · MO work orders · defects · morning-meeting actions · 4M changing points · kaizen projects · shift-close notes · LPA audits · PM/AM inspections — entered once at the line, no manual collation.';
    const claimH = textHeightIn(claim, 12.1, 10) + 0.06;
    if (worstLine) bullets(s, [
      `${NEXT} priority: ${worstLine.name} OEE ${pct(worstLine.oee)} — attack ${worstLine.dtGroups[0]?.name || lowestDriver(worstLine) + ' loss'} first, report as A/P/Q movement next month.`,
    ], 0.6, ys, 12.1, 12, SAFE_BOTTOM - claimH - 0.05);
    s.addText(claim, { x: 0.6, y: SAFE_BOTTOM - claimH, w: 12.1, h: claimH, fontFace: FONT, fontSize: 10, italic: true, color: C.grey, align: 'left', valign: 'top', margin: 0 });
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
