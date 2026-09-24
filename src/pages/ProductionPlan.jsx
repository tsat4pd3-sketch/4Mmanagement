import { useState, useEffect, useContext, useMemo, useCallback } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { inSectionScope } from '../utils/sectionScope';
import { getLineFamilyNames } from '../utils/lineHierarchy';
import { hasNightShift } from '../utils/stdManpower';
import useIsMobile from '../utils/useIsMobile';
import { fmtDate } from '../utils/dateFormat';
import { fetchByIds, fetchAllPages } from '../utils/fetchByIds';
import { dedupeForecastRows } from '../utils/demandSupply';
import { toast } from '../components/Toast';
import PageHeader from '../components/PageHeader';
import Page from '../components/Page';
import FilterBar from '../components/FilterBar';
import Segmented from '../components/Segmented';
import { ALL } from '../utils/filterLabels';
import useTabParam from '../utils/useTabParam';
import CapacityBoard from '../components/CapacityBoard';
import {
  estimateCapacity, planCapacity, median, HISTORY_DAYS, DEFAULT_SHIFT_MIN, DEFAULT_OEE,
  netShiftMin, FALLBACK_SHIFT_BREAK_MIN, buildDayPlan,
} from '../utils/capacityModel';
import { policyBreakForShift } from '../utils/oee';
import { pairLoadTotal } from '../utils/pairTotals';
import { buildBomIndex, explodeBom } from '../utils/bomTree';
import { explodeDemand, netOffBuffer } from '../utils/demandExplode';
import { scheduleBackward, makePrevWorkDay } from '../utils/backwardPlan';

/* ═══ วางแผนการผลิต (Active Planner) — 🗓️ /production-plan ══════════════════
   จากยอดลูกค้า (order รายวัน + forecast รายเดือน) เทียบกับกำลังผลิต "ที่ทำได้จริง"
   (median throughput 60 วันล่าสุด) → บอกว่าต้องเปิดกี่กะ กี่วัน วันไหนเปิด OT/กะดึก
   วันไหนไม่ต้อง เพื่อให้ทันดิว · เฟส 1 อ่านอย่างเดียว (ไม่เขียน DB)
   ══════════════════════════════════════════════════════════════════════════ */

const getWorkDate = () => {
  const now = new Date();
  if (now.getHours() < 8) now.setDate(now.getDate() - 1);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
const dstr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (s, n) => { const d = new Date(`${s}T12:00:00`); d.setDate(d.getDate() + n); return dstr(d); };
const monthKey = (s) => String(s).slice(0, 7);
const normMat = (s) => String(s || '').replace(/[\s-]/g, '').toUpperCase();

const DAILY_HORIZON = 21;   // วางแผนรายวันล่วงหน้ากี่วัน
const MONTHLY_HORIZON = 6;   // รายเดือนล่วงหน้ากี่เดือน
const CAPACITY_HORIZON = 12; // แท็บ 📊 Capacity มองไกลกว่า — สไลด์ของโรงงานดู 12 เดือนเสมอ
const OT_SHIFT_FRAC = 0.25;  // OT ต่อท้ายกะเช้า ≈ 25% ของกะ (2-3 ชม.)

const PLAN_META = {
  day:          { label: 'กะเช้า', color: '#22c55e' },
  night:        { label: '+กะดึก', color: '#8b5cf6' },
  ot:           { label: '+OT', color: '#f59e0b' },
  // ม.75: กำลังไม่พอ → "ยกเลิกหยุด 75%" (เรียกมาทำงาน = ค่าแรงปกติ) ก่อนไปเปิด OT วันหยุดจริง (คำสั่ง user 2026-07-21)
  recall75:     { label: '⚡ ยกเลิกหยุด75% มาทำงาน', color: '#a78bfa' },
  holiday_work: { label: '⚠ ทำวันหยุด OT', color: '#ef4444' },
};

export default function ProductionPlan() {
  const { role, lineId: userLineId, sections: scopeSecs = [] } = useContext(UserContext);
  const isMobile = useIsMobile();
  const [tab, setTab] = useTabParam(['daily', 'monthly', 'capacity'], 'daily');
  const [capMode, setCapMode] = useState('median'); // 'median' | 'safe'
  const [loading, setLoading] = useState(true);
  const [planWarn, setPlanWarn] = useState('');   // โหลดไม่ครบ → เตือน (แผนอาจต่ำกว่าจริง)
  const [allLines, setAllLines] = useState([]);
  const [orgSections, setOrgSections] = useState([]); // ส่วนงานจากผังองค์กร (source of truth) — ไม่เดาจาก production_lines
  const [secFilter, setSecFilter] = useState('');
  const [calMap, setCalMap] = useState({});      // date → day_type
  const [prodByMat, setProdByMat] = useState({}); // mat_no → { line, ct }
  const [pnoToMat, setPnoToMat] = useState({});   // normalize(p_no) → mat_no (map เลขลูกค้า → SAP เหมือนหน้า Planner&Sales)
  const [capByMat, setCapByMat] = useState({});   // mat_no → estimateCapacity result
  const [shiftNet, setShiftNet] = useState(null); // { netMin, brkMin, fallback } — นาทีทำงานสุทธิต่อกะ (หักพักตามนโยบาย)
  const [bomIx, setBomIx] = useState(null);       // ดัชนี BOM (buildBomIndex) — null = ยังไม่มี/โหลดไม่ได้
  const [bomErr, setBomErr] = useState(false);
  const [useBom, setUseBom] = useState(true);     // รวมความต้องการที่ระเบิดจาก BOM เข้าไปในแผนไหม
  const [storeStock, setStoreStock] = useState({}); // mat → ยอดคงเหลือที่ STORE (buffer ของพาร์ทลูก)
  const [useBuffer, setUseBuffer] = useState(true); // หัก buffer ที่ STORE ก่อนสั่งผลิตซ้ำไหม
  const [orders, setOrders] = useState([]);
  const [overdueOrders, setOverdueOrders] = useState([]);       // open shipping orders (future)
  const [forecasts, setForecasts] = useState([]); // future monthly forecast
  const [lineOee, setLineOee] = useState({});     // ไลน์ → OEE จริง median 60 วัน (0-1) · null = ยังไม่มีประวัติ

  const today = getWorkDate();

  /* ── scope ── */
  const scopedLines = useMemo(() => {
    if (role === 'leader' && userLineId) {
      const fam = new Set(getLineFamilyNames(allLines, userLineId));
      return allLines.filter(l => fam.has(l.name));
    }
    if (scopeSecs.length) return allLines.filter(l => inSectionScope(scopeSecs, l.section));
    return allLines;
  }, [allLines, role, userLineId, scopeSecs]);
  // ส่วนงานในตัวเลือก: ยึดผังองค์กรก่อน (กรองตาม scope) → fallback เดาจาก production_lines เมื่อผังยังว่าง
  const sectionOpts = useMemo(() => {
    const fromLines = [...new Set(scopedLines.map(l => l.section).filter(Boolean))];
    const base = orgSections.length ? orgSections : fromLines;
    const scoped = scopeSecs.length ? base.filter(s => inSectionScope(scopeSecs, s)) : base;
    return [...new Set(scoped)].sort();
  }, [scopedLines, orgSections, scopeSecs]);
  const viewLines = useMemo(() => (secFilter ? scopedLines.filter(l => l.section === secFilter) : scopedLines), [scopedLines, secFilter]);
  const lineNameSet = useMemo(() => new Set(viewLines.map(l => l.name)), [viewLines]);
  // ทะเบียนไลน์ทั้งหมด (ไม่กรอง scope) — ใช้แยก "หลุดตัวกรอง" ออกจาก "ไลน์ไม่มีในทะเบียน"
  const allLineNameSet = useMemo(() => new Set(allLines.map(l => l.name)), [allLines]);
  const calOf = useCallback((d) => calMap[d] || 'working', [calMap]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('production_lines')
        .select('id, name, section, parent_line_name, std_day_shift, std_night_shift').order('name');
      setAllLines(data || []);
      // ส่วนงานจากผังองค์กร (org_nodes kind='section') — ลิสต์/ลำดับตามผัง ไม่เดาจาก production_lines.section
      const { data: og } = await supabase.from('org_nodes').select('code, name').eq('kind', 'section').eq('is_active', true).order('name');
      setOrgSections((og || []).map(n => n.code || n.name));
    })();
  }, []);

  /* ── โหลดข้อมูลหลัก ── */
  useEffect(() => {
    (async () => {
      setLoading(true);
      const histStart = addDays(today, -HISTORY_DAYS);
      /* ⚠️ `.limit(N>1000)` ใช้ไม่ได้ — PostgREST clamp ที่ 1000 เสมอ (audit 2026-09-02)
         วัดฐานจริง: `customer_forecasts` ตั้งแต่เดือนนี้ = **1,363 แถว** ⇒ เดิมตัดทิ้ง ~360 แถว
         และเพราะไม่มี `.order()` คู่กับ limit จึงได้ **คนละชุดทุกครั้งที่โหลด**
         ⇒ แท็บรายเดือน: shiftsNeeded ต่ำกว่าจริง → verdict ขึ้น "กะเช้าพอ" ทั้งที่ต้องเปิด OT/กะดึก
            และพาร์ทบางตัวหายไปจากแผนทั้งตัว · sessions/orders ยังไม่ทะลุวันนี้แต่โตได้เหมือนกัน */
      const [{ data: cal }, { data: prods }, { data: bomRows, error: bomQErr }, { data: stockRows }, brkRes, sessRes, ordRes, fcRes, pastRes] = await Promise.all([
        supabase.from('company_calendar').select('work_date, day_type')
          .gte('work_date', addDays(today, -2)).lte('work_date', addDays(today, DAILY_HORIZON + 200)),
        /* ⚠️ `pair_mat_no` ห้ามลืม — ขาดคอลัมน์นี้ = คู่ RH/LH จับกันไม่ติด แล้วโหลดถูกนับ 2 เท่าเงียบๆ
           (กฎเหล็ก "ชิ้น ≠ shot" ใน CLAUDE.md · บั๊กที่ audit 22/09 จับได้) */
        supabaseDR.from('dr_products').select('id, mat_no, line_name, cycle_time_sec, p_no, pair_mat_no, customer').eq('is_active', true).not('mat_no', 'is', null),
        // 🌳 BOM ทุกแถว (ฐานจริง ~600 แถว) — ใช้ระเบิดความต้องการลงพาร์ทลูก ดู utils/demandExplode.js
        supabaseDR.from('bom_items').select('id, product_id, parent_mat, mat_no, qty_per_unit, uom, item_no'),
        /* 📦 buffer stock ของพาร์ทลูกที่ **STORE** — เอาไปหักความต้องการก่อนสั่งผลิตซ้ำ
           🔴 หักเฉพาะแถว STORE เท่านั้น **ห้ามหักยอดที่ไลน์ (mini-store)** — กฎเหล็ก demand-flow-tower:
              backflush ไม่ทำงาน (issue 5,908 : consume 40) ⇒ ยอดคงเหลือที่ไลน์ **สูงกว่าความจริงเสมอ**
              เอาไปหัก = สั่งผลิตน้อยกว่าที่ต้องใช้ = ของขาด (ทิศอันตราย) */
        supabaseDR.from('line_stock_summary').select('mat_no, qty_on_hand').eq('line_name', 'STORE'),
        // เวลาพักตามนโยบาย — ใช้แปลงเวลากะดิบเป็น "นาทีทำงานสุทธิ" ก่อนคิดกำลังทางทฤษฎี
        supabaseDR.from('break_policies').select('shift, start_time, duration_min, process_type, ot_scope').eq('is_active', true),
        fetchAllPages(() => supabaseDR.from('production_sessions').select('id, line_name, shift, oee')
          .eq('status', 'closed').gte('work_date', histStart)),
        fetchAllPages(() => supabaseDR.from('customer_shipping_orders').select('id, mat_no, part_name, customer, qty, due_date, status')
          .neq('status', 'shipped').gte('due_date', today).lte('due_date', addDays(today, DAILY_HORIZON))),
        fetchAllPages(() => supabaseDR.from('customer_forecasts').select('id, mat_no, part_name, customer, qty, period_month, source')
          .gte('period_month', `${monthKey(today)}-01`)),
        // ⚠️ ออเดอร์ค้างส่งที่เลยดิว (pending วันเก่า ย้อน 30 วัน) — เดิมถูกตัดทิ้งทั้งก้อน
        //    แผนรายวันเริ่ม backlog=0 แล้วบอก "กะเช้าพอ" ทั้งที่มีของค้างส่งจริง (QC flow-audit D1 · red)
        fetchAllPages(() => supabaseDR.from('customer_shipping_orders').select('id, mat_no, qty, due_date')
          .neq('status', 'shipped').gte('due_date', addDays(today, -30)).lt('due_date', today)),
      ]);
      const sess = sessRes.rows, ord = ordRes.rows, fc = fcRes.rows, past = pastRes.rows;
      /* ── นาทีทำงานสุทธิต่อกะ = เวลาดิบ − พักตามนโยบาย (กฎเหล็กใน capacityModel.js) ──
         อ่านตารางไม่ได้ = ใช้ค่าสำรอง แต่ต้องขึ้นจอบอก ห้ามคิดด้วยเวลาดิบเงียบๆ (= กำลังเฟ้อ 16%) */
      const brkRows = brkRes.data || [];
      const brkMin = brkRows.length
        ? policyBreakForShift({ policies: brkRows, shift: 'day', shiftMin: DEFAULT_SHIFT_MIN, workDate: today })
        : FALLBACK_SHIFT_BREAK_MIN;
      const netMin = netShiftMin(DEFAULT_SHIFT_MIN, brkMin);
      setShiftNet({ netMin, brkMin, fallback: !brkRows.length });
      // โหลดไม่ครบ = แผนกำลังผลิต/ความต้องการ ต่ำกว่าจริง → verdict อาจบอก "พอ" ผิด ห้ามเงียบ
      setPlanWarn([sessRes, ordRes, fcRes, pastRes].some(r => r.error || r.truncated)
        ? 'โหลดข้อมูลไม่ครบ — แผนที่คำนวณอาจต่ำกว่าความจริง (ลองโหลดใหม่)' : '');
      setCalMap(Object.fromEntries((cal || []).map(c => [c.work_date, c.day_type])));
      setOrders(ord || []);
      setOverdueOrders(past || []);
      // dedupe ข้าม source (edi ชนะ manual ต่อ mat×เดือน) — กัน shiftsNeeded เฟ้อ 2 เท่า (T2-2/QC flow-audit D1)
      setForecasts(dedupeForecastRows(fc || []));

      const pmap = {};
      const pnoMap = {};
      (prods || []).forEach(p => {
        if (p.mat_no) pmap[p.mat_no] = { line: p.line_name, ct: p.cycle_time_sec || 0, pair: p.pair_mat_no || null, customer: p.customer || '' };
        if (p.p_no && p.mat_no) { const k = normMat(p.p_no); if (k && !pnoMap[k]) pnoMap[k] = p.mat_no; } // เลขลูกค้า (p_no) → SAP
      });
      setProdByMat(pmap);
      setPnoToMat(pnoMap);
      /* 🌳 ดัชนี BOM — **ต้องผ่าน buildBomIndex เท่านั้น** (กฎเหล็ก CLAUDE.md · มีด่านสแกน)
         matOf = product_id → mat_no ของใบนั้น · ไม่มี BOM = แผนถอยไปเท่าเดิม (ไม่พัง) แต่ต้องบอกบนจอ */
      const matOfProduct = {};
      (prods || []).forEach(p => { if (p.id && p.mat_no) matOfProduct[p.id] = p.mat_no; });
      setBomIx(bomQErr ? null : buildBomIndex(bomRows || [], matOfProduct));
      setBomErr(!!bomQErr);
      const stk = {};
      (stockRows || []).forEach(r => { const q = Number(r.qty_on_hand) || 0; if (r.mat_no && q > 0) stk[r.mat_no] = (stk[r.mat_no] || 0) + q; });
      setStoreStock(stk);

      // ── กำลังจริงต่อกะ: sum qty ต่อ (session, mat) จากใบปิด แล้ว median ต่อ (mat) ──
      const sessMeta = {}; (sess || []).forEach(s => { sessMeta[s.id] = s; });
      const oeeByLine = {};
      (sess || []).forEach(s => { if (s.oee != null) (oeeByLine[s.line_name] = oeeByLine[s.line_name] || []).push(Number(s.oee)); });
      // OEE จริง (median 60 วัน) ต่อไลน์ — แท็บ 📊 Capacity เอาไปเทียบกับเส้นเป้า A×P×Q
      setLineOee(Object.fromEntries(Object.entries(oeeByLine).map(([ln, arr]) => [ln, arr.length ? median(arr) / 100 : null])));
      const sessIds = (sess || []).map(s => s.id);
      // ⚠️ ต้องผ่าน fetchByIds (กฎ CLAUDE.md) — เดิมแบ่งก้อนเอง 300 id แต่ **ไม่แบ่งหน้า**
      //    300 กะ × ใบปิด ~5 ใบ = ~1,500 แถว > เพดาน 1000 ⇒ ถูกตัดเกือบทุกก้อน แบบเงียบสนิท
      //    ผล: median กำลังผลิตต่ำกว่าจริง → หน้านี้บอกให้เปิด OT/กะดึก/มี backlog เกินความจำเป็น
      const poRes = await fetchByIds(sessIds, (c) => supabaseDR.from('prod_orders')
        .select('session_id, mat_no, qty_ok, qty, opened_at, confirmed_at')
        .eq('status', 'confirmed').in('session_id', c));
      const orderRows = poRes.rows;
      if (poRes.error || poRes.truncated) {
        toast.error('โหลดใบผลิตย้อนหลังไม่ครบ — กำลังผลิตที่คำนวณได้อาจต่ำกว่าจริง (แผน OT/กะดึกจะเกินจำเป็น)');
      }
      // sum ต่อ (session, mat) = ยอด + เวลาวิ่งรวม (นาที) ของ mat นั้นในกะนั้น
      const perSessMat = {};
      orderRows.forEach(o => {
        if (!o.mat_no) return;
        const k = `${o.session_id}|${o.mat_no}`;
        const e = perSessMat[k] || (perSessMat[k] = { qty: 0, runMin: 0 });
        e.qty += o.qty_ok ?? o.qty ?? 0;
        if (o.opened_at && o.confirmed_at) {
          const mn = (new Date(o.confirmed_at) - new Date(o.opened_at)) / 60000;
          if (mn > 0) e.runMin += mn;
        }
      });
      // ── normalize กะที่ "แชร์ไลน์" (วิ่งไม่เต็มกะ) เป็น full-shift equivalent ──
      // เดิม median ยอด/กะ รวมกะที่พาร์ทวิ่งครึ่งกะ (แชร์กับพาร์ทอื่น) → ยอดต่ำ → กำลังต่ำเกิน →
      //   OT/backlog เกินจริง (บั๊ก audit 2026-07-21) · แก้: กะวิ่ง 50–90% ของกะ → คูณกลับเป็นเต็มกะ
      //   แต่ cap ด้วยกำลังทฤษฎีเต็มกะ (shift×60÷CT) กัน over-scale (overstate = วางแผนน้อยไป อันตราย)
      //   กะวิ่ง <50% = สัญญาณน้อยเกิน extrapolate → ตัดทิ้ง · ไม่มี timestamp = ใช้ค่าดิบเดิม (backward-compat)
      /* ⚠️ 2 ตัวเลขนี้ต่างกันโดยเจตนา **ห้ามยุบเป็นตัวเดียว**:
         · `SHIFT_MIN` (เวลาดิบ 570) ใช้เทียบ **นาฬิกาแขวน** — `rm` มาจาก opened_at→confirmed_at
           ซึ่งกินเวลาพักไปด้วย ⇒ อัตราขยายกลับเป็นเต็มกะต้องเทียบกับเวลาดิบ
         · `netMin` (หักพักแล้ว) ใช้เป็น **เพดานกำลังทางทฤษฎี** — ของจริงผลิตได้แค่ช่วงที่ไม่ใช่เวลาพัก
           (เดิมใช้เวลาดิบทั้ง 2 ที่ ⇒ เพดานหลวมไป 16% ตาม audit 22/09) */
      const SHIFT_MIN = DEFAULT_SHIFT_MIN;
      const outputsByMat = {};
      Object.entries(perSessMat).forEach(([k, e]) => {
        const mat = k.split('|')[1];
        if (e.qty <= 0) return;
        const rm = Math.min(e.runMin, SHIFT_MIN);
        let out = e.qty;
        if (e.runMin > 0 && rm < SHIFT_MIN * 0.5) return;                     // แชร์หนัก — ตัดทิ้ง
        if (rm >= SHIFT_MIN * 0.5 && rm < SHIFT_MIN * 0.9) {
          out = e.qty * (SHIFT_MIN / rm);                                     // scale ≤ 2×
          const ct = pmap[mat]?.ct || 0;
          if (ct > 0) out = Math.min(out, (netMin * 60) / ct);               // ห้ามเกินกำลังทฤษฎีเต็มกะ (เวลาสุทธิ)
        }
        (outputsByMat[mat] = outputsByMat[mat] || []).push(out);
      });
      const cap = {};
      Object.keys(pmap).forEach(mat => {
        const line = pmap[mat].line;
        const lineOee = oeeByLine[line]?.length ? median(oeeByLine[line]) / 100 : DEFAULT_OEE;
        cap[mat] = estimateCapacity(outputsByMat[mat] || [], { ctSec: pmap[mat].ct, shiftMin: netMin, lineOee });
      });
      setCapByMat(cap);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today]);

  /* ── resolve เลขที่ order/forecast อ้าง → mat_no ภายใน (SAP): ตรง → normalize → p_no (เลขลูกค้า) ──
     เดิม map ผ่าน mat_no อย่างเดียว → order/forecast ที่อ้างเลขลูกค้าถูกทิ้งเงียบ (แก้ 2026-07-21) */
  const resolveMat = useCallback((x) => {
    if (!x) return null;
    if (prodByMat[x]) return x;
    const nm = normMat(x);
    const hit = Object.keys(prodByMat).find(m => normMat(m) === nm);
    if (hit) return hit;
    return pnoToMat[nm] || null;
  }, [prodByMat, pnoToMat]);
  /* ── หากำลังต่อกะ (ชิ้น) ของ mat + line ที่ผลิต ── */
  const lineOfMat = useCallback((mat) => {
    const rid = resolveMat(mat);
    const line = rid ? prodByMat[rid]?.line : null;
    return line && lineNameSet.has(line) ? line : null;
  }, [resolveMat, prodByMat, lineNameSet]);
  const capOfMat = useCallback((mat) => {
    const rid = resolveMat(mat);
    const est = rid ? capByMat[rid] : undefined;
    return { est, perShift: planCapacity(est, capMode) };
  }, [resolveMat, capByMat, capMode]);
  /* ── งานคู่ RH/LH: ปั๊มทีเดียวได้ 2 ข้าง ⇒ **ภาระเวลาไม่บวกกัน** (กฎเหล็ก "ชิ้น ≠ shot") ──
     ยอดชิ้น (duePcs) ยังบวกตามปกติ เพราะ RH/LH ส่งลูกค้าแยกใบ เป็นชิ้นจริงทั้งคู่ */
  const pairOf = useCallback((mat) => prodByMat[mat]?.pair || null, [prodByMat]);
  // CT ดิบ (วินาที/shot) — แท็บ 📊 Capacity คิดภาระงานจาก "เวลามาตรฐาน" ไม่ใช่กำลังผลิตจริง
  // (ใช้ของจริงแล้วหารด้วย OEE อีก = คิด OEE ซ้ำสองรอบ)
  const ctOf = useCallback((mat) => Number(prodByMat[mat]?.ct) || 0, [prodByMat]);
  const capMonths = useMemo(() => Array.from({ length: CAPACITY_HORIZON }, (_, i) => {
    const d = new Date(`${today.slice(0, 7)}-01T12:00:00`); d.setMonth(d.getMonth() + i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }), [today]);

  /* ⏮️ กำลังผลิต "ต่อวัน" ของพาร์ทหนึ่ง = กำลังต่อกะ × จำนวนกะที่ไลน์นั้นเปิดได้
     ใช้เป็น **lead time ที่คิดจากของจริง** ตอนไล่ย้อนวัน (ของ 100 ชิ้นกับ 100,000 ชิ้นใช้เวลาไม่เท่ากัน)
     ⚠️ ใช้ `allLines` ไม่ใช่ `viewLines` — กำลังของไลน์ไม่ได้เปลี่ยนตามตัวกรองส่วนงานบนจอ */
  const capPerDayOf = useCallback((mat) => {
    const { perShift } = capOfMat(mat);
    if (!(perShift > 0)) return 0;
    const line = prodByMat[resolveMat(mat) || mat]?.line;
    return perShift * (line && hasNightShift(allLines, line) ? 2 : 1);
  }, [capOfMat, prodByMat, resolveMat, allLines]);

  // ถอยวันโดยข้ามวันหยุดตามปฏิทินบริษัท (วันหยุดทุกชนิดรวม ม.75 = ไม่ใช่วันทำงาน)
  const prevWorkDay = useMemo(() => makePrevWorkDay(calOf, addDays), [calOf]);
  /* ── order/forecast ที่ map ไม่เจอ (ยังไม่ตั้ง SAP/p_no) — ต้องเตือน ไม่ทิ้งเงียบ ── */
  const unmapped = useMemo(() => {
    if (loading) return { orders: 0, parts: new Set(), fcParts: new Set() };
    const parts = new Set(), fcParts = new Set();
    let ordCnt = 0;
    orders.forEach(o => { if (!resolveMat(o.mat_no)) { ordCnt++; parts.add(o.mat_no); } });
    forecasts.forEach(f => { if (!resolveMat(f.mat_no)) fcParts.add(f.mat_no); });
    return { orders: ordCnt, parts, fcParts };
  }, [loading, orders, forecasts, resolveMat]);

  /* ── 🔍 ความต้องการที่ map เลข SAP ได้ แต่ **ยังไม่ถูกนับในแผน** (audit 22/09) ──
     เดิม `lineOfMat()` คืน null แล้วแถวถูกข้ามไปเงียบๆ ทั้ง 2 กรณี ซึ่งคนละเรื่องกัน:
       · หลุดตัวกรองส่วนงาน = ปกติ (แค่บอกให้รู้ว่าซ่อนอยู่เท่าไหร่)
       · พาร์ทไม่มีไลน์ผลิต / ไลน์ไม่มีในทะเบียน = **ข้อมูลขาด** ต้องเตือนให้ไปตั้ง
     ตัวนับ `unmapped` เดิมดูแค่ `resolveMat` จึงมองไม่เห็นทั้ง 2 กรณีนี้เลย */
  const demandGaps = useMemo(() => {
    if (loading) return { outScope: 0, noLine: 0, noLineParts: new Set() };
    let outScope = 0, noLine = 0;
    const noLineParts = new Set();
    const check = (row) => {
      const rid = resolveMat(row.mat_no);
      if (!rid) return;                                   // นับที่ `unmapped` อยู่แล้ว
      const line = prodByMat[rid]?.line;
      if (!line || !allLineNameSet.has(line)) { noLine++; noLineParts.add(rid); return; }
      if (!lineNameSet.has(line)) outScope++;
    };
    orders.forEach(check); forecasts.forEach(check);
    return { outScope, noLine, noLineParts };
  }, [loading, orders, forecasts, resolveMat, prodByMat, allLineNameSet, lineNameSet]);

  /* ── คู่ RH/LH ที่ "มี demand ครบทั้ง 2 ข้าง" = คู่ที่ระบบยุบภาระเวลาให้ ──
     ต้องขึ้นจอ ไม่งั้นคนที่บวกเลขมือเองจะงงว่าทำไมโหลดน้อยกว่าที่คิด (และคิดว่าระบบตกหล่น) */
  const pairsCollapsed = useMemo(() => {
    if (loading) return [];
    const have = new Set();
    [...orders, ...forecasts].forEach(r => { const m = resolveMat(r.mat_no); if (m) have.add(m); });
    const out = [];
    have.forEach(m => {
      const pm = pairOf(m);
      if (pm && pm !== m && have.has(pm) && m < pm) out.push([m, pm]);
    });
    return out;
  }, [loading, orders, forecasts, resolveMat, pairOf]);

  /* ═══ รายวัน: เดินปฏิทิน จัดสรร shift-load ต่อไลน์ ═══ */
  /* ═══ 🌳 ความต้องการระดับ mat = "ลูกค้าสั่งตรง" + "ระเบิดจาก BOM" (2026-09-22 · คำสั่ง user) ═══
     ก่อนหน้านี้แผนเห็นเฉพาะพาร์ทที่ลูกค้าสั่งตรง ⇒ ไลน์ปั๊ม/เลเซอร์ที่ทำพาร์ทลูกป้อนไลน์ประกอบ
     **ไม่เคยมีงานในแผนเลย** · ตัวระเบิดอยู่ที่ `src/utils/demandExplode.js` (pure + มีเทส)
     🔴 ต้องบวกกัน ห้ามแทนกัน — ของจริง 22/09 ลูกค้าสั่งพาร์ท 2xxxxxxx ตรงๆ อยู่แล้ว 687 แถว/18 mat
     ⏱️ **แท็บรายวันไล่ย้อนวันให้แล้ว** (`scheduleBackward` ด้านล่าง — lead time จากกำลังผลิตจริง)
     · ส่วน**รายเดือน**ยังรวมเป็นก้อนเดือนเดียวกับดิวของแม่ ซึ่งพอสำหรับหน่วย "เดือน" (lead time
       ส่วนใหญ่สั้นกว่าเดือน) — ถ้าจะทำให้ข้ามเดือน ต้องไล่ย้อนแบบรายวันแล้วค่อยยุบเป็นเดือน */
  const demandPcs = useMemo(() => {
    if (loading) return { byDate: {}, byMonth: {}, carry: {}, bom: null, buffer: null, sched: null };
    const bomStat = { flatDupes: [], cycles: 0, rootsWithBom: 0, rootsNoBom: 0, childPcs: 0 };
    const explodeInto = (rowsIn) => {
      if (!useBom || !bomIx) return {};
      const r = explodeDemand(rowsIn, bomIx, explodeBom);
      bomStat.flatDupes.push(...r.flatDupes);
      bomStat.cycles += r.cycles.length;
      bomStat.rootsWithBom += r.rootsWithBom;
      bomStat.rootsNoBom += r.rootsNoBom.length;
      return r.needByMat;
    };

    // ① รวมความต้องการตั้งต้นเป็น (bucket → mat → qty) ด้วยเลข SAP
    const bucketize = (rows, keyOf) => {
      const out = {};
      rows.forEach(r => {
        const mat = resolveMat(r.mat_no);
        const qty = Number(r.qty) || 0;
        const k = keyOf(r);
        if (!mat || !k || qty <= 0) return;
        const bag = out[k] || (out[k] = {});
        bag[mat] = (bag[mat] || 0) + qty;
      });
      return out;
    };
    const directByMonth = bucketize(forecasts, f => monthKey(f.period_month));

    // ② ระเบิด BOM ต่อ bucket แล้วบวกทับของตรง
    const withBom = (buckets) => {
      const out = {};
      Object.entries(buckets).forEach(([k, matQty]) => {
        const bag = { ...matQty };
        const need = explodeInto(Object.entries(matQty).map(([mat_no, qty]) => ({ mat_no, qty })));
        Object.values(need).forEach(e => {
          bag[e.mat_no] = (bag[e.mat_no] || 0) + e.qty;
          bomStat.childPcs += e.qty;
        });
        out[k] = bag;
      });
      return out;
    };
    const grossMonth = withBom(directByMonth);

    /* ③ 📦 หัก buffer ที่ STORE — ของที่มีอยู่แล้วไม่ต้องผลิตซ้ำ (คำถาม user 22/09)
       🔴 รายวันกับรายเดือนเป็น **คนละมุมมองของช่วงเวลาเดียวกัน** ⇒ แต่ละแท็บหักจาก buffer
          ชุดของตัวเอง (ไม่ใช่หักต่อกัน) ไม่งั้นแท็บที่คำนวณทีหลังจะเหลือ buffer 0 เสมอ */
    const stock = useBuffer ? storeStock : {};
    const mNet = netOffBuffer(Object.keys(grossMonth).sort().map(m => [m, grossMonth[m]]), stock);

    /* ④ ⏮️ แท็บรายวัน = **ไล่ย้อนจากวันส่ง (backward scheduling)** ไม่ใช่กองรวมวันเดียวกับดิวแม่
       (คำสั่ง user 22/09: *"reverse calculate — ย้อนกลับ capacity ไลน์ปั๊ม เช็คงานลูกต้องมีของก่อนวันไหน"*)
       · lead time ของแต่ละชั้นคิดจาก **กำลังผลิตจริงของไลน์นั้น** ไม่ใช่ค่าคงที่
       · ถอยวันข้ามวันหยุดตามปฏิทินบริษัท · หัก buffer ระหว่างทาง (ของพอ = ตัดทั้งกิ่ง ไม่เบิกลูก)
       · ของค้างส่ง (เลยดิว) ถือว่าต้องส่ง **วันนี้** แล้วไล่ย้อนจากวันนี้
       🔴 งานที่ย้อนแล้วตกไปก่อนวันนี้ = **สายแล้ว** — ยกมาเป็น backlog ตั้งต้น (carry) ของวันแรก
          พร้อมนับไว้ใน `sched.late` ให้ขึ้นจอ ห้ามปัดเข้าวันนี้เงียบๆ */
    const demandRows = [
      ...overdueOrders.map(o => ({ mat_no: resolveMat(o.mat_no) || o.mat_no, qty: Number(o.qty) || 0, due_date: today })),
      ...orders.map(o => ({ mat_no: resolveMat(o.mat_no) || o.mat_no, qty: Number(o.qty) || 0, due_date: o.due_date })),
    ];
    const sched = scheduleBackward({
      demandRows, ix: useBom ? bomIx : null, explode: explodeBom,
      capPerDayOf, stock, prevWorkDay, today, transferDays: 1,
    });
    const carry = {}, byDate = {};
    Object.entries(sched.byDate).forEach(([d, matQty]) => {
      const bag = d < today ? carry : (byDate[d] = byDate[d] || {});
      Object.entries(matQty).forEach(([m, q]) => { bag[m] = (bag[m] || 0) + q; });
    });

    // คู่ (mat) ที่ซ้ำกันข้าม bucket ไม่ต้องยุบ — แต่ละ bucket คือคนละวัน/เดือน
    const dupes = [...new Map([...bomStat.flatDupes, ...sched.flatDupes]
      .map(f => [`${f.root}|${f.mat_no}`, f])).values()];
    return {
      byDate, byMonth: mNet.buckets, carry,
      bom: { ...bomStat, flatDupes: dupes, cycles: bomStat.cycles + sched.cycles, childPcs: bomStat.childPcs + sched.childPcs },
      buffer: { dailyAbsorbed: sched.absorbed, monthlyAbsorbed: mNet.absorbed, mats: Object.keys(stock).length },
      sched: { late: sched.late, noCapMats: sched.noCapMats, maxLevel: sched.maxLevel },
    };
  }, [loading, orders, forecasts, overdueOrders, resolveMat, bomIx, useBom, storeStock, useBuffer, capPerDayOf, prevWorkDay, today]);

  const daily = useMemo(() => {
    if (loading) return [];
    const dates = Array.from({ length: DAILY_HORIZON + 1 }, (_, i) => addDays(today, i));
    // ⚠️ ห้ามกรองเหลือเฉพาะไลน์ลูก (leaf-only) — `lineOfMat` map 1 พาร์ท → 1 ไลน์ตาม dr_products.line_name
    // เท่านั้น ไลน์แม่จึงได้ order เฉพาะพาร์ทที่ลงทะเบียนที่ตัวแม่เอง ไม่มีทางนับซ้ำกับไลน์ลูก
    // เดิมกรอง leaf ทิ้ง → HYDROFORM ที่มีสินค้าผูกกับตัวแม่ 5 พาร์ท หายจากแผนผลิตทั้งหมด (แก้ 2026-08-05)
    return viewLines.map(line => {
      /* ความต้องการของไลน์นี้ต่อวัน (ชิ้น → shift-load) — มาจาก `demandPcs` ซึ่งรวม
         "ลูกค้าสั่งตรง + ระเบิดจาก BOM" ให้แล้ว · คีย์เป็นเลข SAP เสมอ
         ⚠️ สะสมโหลด **แยกราย mat ก่อน** แล้วค่อยรวมด้วย pairLoadTotal ตอนท้าย
            บวกรวมทันทีแบบเดิม = คู่ RH/LH ถูกนับ 2 เท่า (ยุบทีหลังไม่ได้) */
      const loadMatByDate = {}, pcsByDate = {}, matSet = new Set();
      let unknownCap = 0;
      const takeBucket = (matQty, onLoad, onPcs) => {
        Object.entries(matQty || {}).forEach(([mat, qty]) => {
          if (lineOfMat(mat) !== line.name || !(qty > 0)) return;   // ไม่ใช่งานของไลน์นี้ (หรือไม่มีไลน์เลย)
          matSet.add(mat);
          onPcs(qty);
          const { perShift } = capOfMat(mat);
          if (perShift > 0) onLoad(mat, qty / perShift); else unknownCap += qty;
        });
      };
      Object.entries(demandPcs.byDate).forEach(([date, matQty]) => {
        takeBucket(matQty,
          (mat, load) => { const b = loadMatByDate[date] || (loadMatByDate[date] = {}); b[mat] = (b[mat] || 0) + load; },
          (qty) => { pcsByDate[date] = (pcsByDate[date] || 0) + qty; });
      });
      const loadByDate = Object.fromEntries(
        Object.entries(loadMatByDate).map(([d, byMat]) => [d, pairLoadTotal(byMat, pairOf)]));
      const hasNight = hasNightShift(viewLines, line.name);
      // ยอดค้างส่งที่เลยดิวของไลน์นี้ = backlog ตั้งต้นวันแรก (convention เดียวกับ Rundown "ค้างเก่ารวมเข้าวันนี้")
      let carryPcs = 0;
      const carryByMat = {};
      takeBucket(demandPcs.carry,
        (mat, load) => { carryByMat[mat] = (carryByMat[mat] || 0) + load; },
        (qty) => { carryPcs += qty; });
      const carryLoad = pairLoadTotal(carryByMat, pairOf);   // ค้างส่งก็ยุบคู่เหมือนกัน
      /* เดินปฏิทิน: กะเช้า → กะดึก (ถ้ามี) → OT · วัน ม.75 ใช้เต็มกำลังก่อน OT วันหยุดจริง
         🔴 ตรรกะอยู่ที่ `buildDayPlan()` ใน utils/capacityModel.js ที่เดียว **ห้ามเขียน walk ซ้ำที่นี่**
            (เดิมเขียนซ้ำ ⇒ ตัวกลางกลายเป็นโค้ดตายที่ล้าสมัย — audit 22/09) */
      const days = buildDayPlan({
        dates, loadByDate, carryLoad, hasNight, otFactor: OT_SHIFT_FRAC, dayTypeOf: calOf,
      }).map(d => ({ ...d, duePcs: pcsByDate[d.date] || 0 }));
      const otDays = days.filter(d => d.plan.includes('ot')).length;
      const nightDays = days.filter(d => d.plan.includes('night')).length;
      const recall75Days = days.filter(d => d.plan.includes('recall75')).length;
      const holidayDays = days.filter(d => d.plan.includes('holiday_work')).length;
      const endBacklog = days[days.length - 1]?.backlog || 0;
      // มาตรการ ม.75 รายไลน์: วัน shutdown75 ในช่วง — ไลน์นี้หยุดได้กี่วัน / ต้องเรียกมากี่วัน
      const sd75Total = days.filter(d => d.sd75).length;
      const sd75Stoppable = days.filter(d => d.sd75 && !d.plan.includes('recall75')).length;
      return { line, days, otDays, nightDays, recall75Days, holidayDays, endBacklog, sd75Total, sd75Stoppable, unknownCap, matCount: matSet.size, orderCount: matSet.size, carryPcs };
    }).filter(r => r.orderCount > 0 || r.unknownCap > 0 || r.carryPcs > 0);
  }, [loading, viewLines, demandPcs, today, capOfMat, lineOfMat, calOf, pairOf]);

  /* ── 🌑 ไลน์ที่ "มีพาร์ทลงทะเบียน แต่ไม่มีความต้องการในระบบเลย" ──
     เดิมถูกกรองทิ้งทั้งไลน์ ⇒ จอว่างเปล่าอ่านได้ว่า "ไลน์นี้ว่าง" ทั้งที่ความจริงคือ
     "ยังไม่มีทางรับ order ของลูกค้าเจ้านั้นเข้าระบบ" (วัดจริง 22/09: 10 จาก 22 ไลน์)
     ⇒ ต้องขึ้นจอเป็นแถบเทา พร้อมบอกว่าเป็นของลูกค้าไหน — ห้ามหายเงียบ */
  const silentLines = useMemo(() => {
    if (loading) return [];
    const withDemand = new Set(daily.map(r => r.line.name));
    const byLine = {};
    Object.values(prodByMat).forEach(p => {
      if (!p.line || !lineNameSet.has(p.line) || withDemand.has(p.line)) return;
      const e = byLine[p.line] || (byLine[p.line] = { line: p.line, parts: 0, customers: new Set() });
      e.parts++; if (p.customer) e.customers.add(p.customer);
    });
    return Object.values(byLine).sort((a, b) => b.parts - a.parts);
  }, [loading, daily, prodByMat, lineNameSet]);

  /* ═══ รายเดือน: forecast → shift ที่ต้องการ vs วันทำงานที่มี ═══ */
  const monthly = useMemo(() => {
    if (loading) return [];
    const months = Array.from({ length: MONTHLY_HORIZON }, (_, i) => {
      const d = new Date(`${today.slice(0, 7)}-01T12:00:00`); d.setMonth(d.getMonth() + i);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
    // วันทำงานต่อเดือน (จากปฏิทิน — ไม่มีข้อมูล = ประมาณ 26 วัน/เดือน)
    // วันทำงาน/เดือน: จ-ศ ที่ไม่ถูกมาร์คเป็นวันหยุด + เสาร์/อาทิตย์ที่มาร์ค working
    // (เดิมนับเฉพาะวันที่มาร์ค 'working' ชัดๆ — จ-ศ ปกติไม่มีแถวใน DB เลยนับขาด — บั๊กแก้ 2026-07-21)
    const workDaysOf = (mk) => {
      const [yy, mm] = mk.split('-').map(Number);
      const nDays = new Date(yy, mm, 0).getDate();
      let wd = 0;
      for (let d = 1; d <= nDays; d++) {
        const key = `${mk}-${String(d).padStart(2, '0')}`;
        const t = calMap[key];
        const dow = new Date(yy, mm - 1, d).getDay();
        if (t) { if (t === 'working') wd++; continue; }
        if (dow >= 1 && dow <= 5) wd++;
      }
      return wd || 26;
    };
    // วันหยุดจ่าย 75% (ม.75) ในเดือน — กำลังสำรองที่เรียกมาได้ด้วยค่าแรงปกติ ก่อนคิด OT วันหยุด
    const sd75DaysOf = (mk) => Object.entries(calMap).filter(([d, t]) => d.startsWith(mk) && t === 'shutdown75').length;
    return viewLines.map(line => {
      // กะดึกตกทอดจากไลน์แม่ (GOR/LWR BAR ตั้ง std ไว้ที่แม่ ลูกเป็น 0 → เดิม hasNight=false ทั้งกลุ่ม
      // แผนเลยไม่เคยเปิดกะดึกให้ 2 กลุ่มนี้ ทั้งที่ไลน์เดินกะดึกจริง)
      const hasNight = hasNightShift(viewLines, line.name);
      const rows = months.map(mk => {
        // ความต้องการเดือนนี้ของไลน์นี้ (ชิ้น) — รวมที่ระเบิดจาก BOM มาแล้ว
        const matQty = demandPcs.byMonth[mk] || {};
        let pcs = 0, unknownCap = 0, matCnt = 0;
        const loadByMat = {};                 // ยุบคู่ RH/LH ทีหลัง — บวกทันทีคือนับเวลา 2 เท่า
        Object.entries(matQty).forEach(([mat, qty]) => {
          if (lineOfMat(mat) !== line.name || !(qty > 0)) return;
          pcs += qty; matCnt++;
          const { perShift } = capOfMat(mat);
          if (perShift > 0) loadByMat[mat] = (loadByMat[mat] || 0) + qty / perShift;
          else unknownCap += qty;
        });
        const shiftsNeeded = pairLoadTotal(loadByMat, pairOf);
        const wd = workDaysOf(mk);
        const sd75 = sd75DaysOf(mk);
        const dayShifts = wd;                 // 1 กะเช้า/วันทำงาน
        const capShifts = wd * (hasNight ? 2 : 1);
        const fullCap = capShifts * (1 + OT_SHIFT_FRAC);
        const sd75Shifts = sd75 * (hasNight ? 2 : 1);   // กำลังจากยกเลิกหยุด ม.75 (ค่าแรงปกติ)
        // ตัดสิน: ปกติพอ / OT / กะดึก / กะดึก+OT / ยกเลิกหยุด 75% (ก่อน OT วันหยุดเสมอ) / เกินกำลัง
        let verdict, color;
        if (!matCnt) { verdict = '—'; color = 'var(--muted)'; }
        else if (shiftsNeeded <= dayShifts) { verdict = 'กะเช้าพอ'; color = '#22c55e'; }
        else if (shiftsNeeded <= dayShifts * (1 + OT_SHIFT_FRAC)) { verdict = `ต้องเปิด OT ~${Math.ceil((shiftsNeeded - dayShifts) / OT_SHIFT_FRAC)} วัน`; color = '#f59e0b'; }
        else if (hasNight && shiftsNeeded <= capShifts) { verdict = `ต้องเปิดกะดึก ~${Math.ceil(shiftsNeeded - dayShifts)} วัน`; color = '#8b5cf6'; }
        else if (hasNight && shiftsNeeded <= fullCap) { verdict = 'กะดึก + OT เต็มเดือน'; color = '#ef4444'; }
        else if (sd75Shifts > 0 && shiftsNeeded <= fullCap + sd75Shifts) { verdict = `⚡ ยกเลิกหยุด 75% มาทำงาน ~${Math.ceil((shiftsNeeded - fullCap) / (hasNight ? 2 : 1))} วัน (ค่าแรงปกติ)`; color = '#a78bfa'; }
        else { verdict = '🚨 เกินกำลัง — ต้องเพิ่มไลน์/คน' + (sd75 ? ' (รวมยกเลิกหยุด 75% แล้ว)' : ''); color = '#ef4444'; }
        return { mk, pcs, shiftsNeeded, dayShifts, capShifts, verdict, color, unknownCap, fcCount: matCnt };
      });
      return { line, rows };
    }).filter(r => r.rows.some(x => x.fcCount > 0));
  }, [loading, viewLines, demandPcs, calMap, today, capOfMat, lineOfMat, pairOf]);

  /* ── styles ── */
  const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 };
  const chip = (color, bg) => ({ fontSize: 11, fontWeight: 800, color, background: bg || `${color}1f`, border: `1px solid ${color}55`, borderRadius: 6, padding: '2px 7px', whiteSpace: 'nowrap' });
  const th = { padding: '5px 8px', borderBottom: '1px solid var(--border)', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', textAlign: 'right' };
  const td = { padding: '5px 8px', fontSize: 12, whiteSpace: 'nowrap', textAlign: 'right' };
  const confChip = (c) => c === 'high' ? null : <span style={chip(c === 'med' ? '#f59e0b' : '#ef4444')}>{c === 'med' ? 'ข้อมูลปานกลาง' : 'ข้อมูลน้อย'}</span>;

  return (
    <Page style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <PageHeader
        title="วางแผนการผลิต" icon="🗓️"
        tabs={[
          { key: 'daily', label: '📅 รายวัน (ออเดอร์)' },
          { key: 'monthly', label: '📆 รายเดือน (Forecast)' },
          { key: 'capacity', label: '📊 Capacity (แบบสไลด์โรงงาน)' },
        ]}
        tab={tab} onTab={setTab}
      />
      {/* UI-STANDARD 2026-09-24 — ตัวกรอง/ตัวเลือกแผนย้ายจาก actions ของหัวเพจมาเป็นแถบกรองเดียว */}
      <FilterBar style={{ marginBottom: 0 }}>
        {sectionOpts.length > 1 && (
          <select value={secFilter} onChange={e => setSecFilter(e.target.value)}>
            <option value="">{ALL.section}</option>
            {sectionOpts.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text2)', cursor: 'pointer' }}
          title="ระเบิด BOM ของพาร์ทที่ลูกค้าสั่ง เพื่อให้ไลน์ที่ทำพาร์ทลูกเห็นงานของตัวเองในแผนด้วย">
          <input type="checkbox" checked={useBom} onChange={e => setUseBom(e.target.checked)} style={{ width: 'auto' }} />
          🌳 รวมงานจาก BOM
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text2)', cursor: 'pointer' }}
          title="หักของที่มีอยู่แล้วใน STORE ออกจากความต้องการก่อน (ของกองเดียวใช้ได้ครั้งเดียว เรียงตามวัน)">
          <input type="checkbox" checked={useBuffer} onChange={e => setUseBuffer(e.target.checked)} style={{ width: 'auto' }} />
          📦 หักสต็อก STORE
        </label>
        <span className="spacer" />
        <span className="filter-label">วางแผนที่กำลัง:</span>
        <Segmented value={capMode} onChange={setCapMode} label="วางแผนที่กำลัง" options={[
          { value: 'median', label: 'ปกติ (median)', title: 'ใช้ median ของยอดที่เคยทำได้จริง (สมจริง)' },
          { value: 'safe', label: 'ปลอดภัย (P25)', title: 'ใช้ P25 — เผื่อวันที่ทำได้น้อย (ปลอดภัยไว้ก่อน)' },
        ]} />
      </FilterBar>

      {/* ⚠️ โหลดไม่ครบ = ทั้งกำลังผลิตและความต้องการต่ำกว่าจริง → verdict อาจบอก "กะเช้าพอ" ผิด */}
      {planWarn && (
        <div style={{
          margin: '0 0 12px', padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700,
          background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', color: '#ef4444',
        }}>⚠ {planWarn}</div>
      )}
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
        กำลังผลิตคำนวณจาก <b>median ยอดดีจริงต่อกะ</b> ใน {HISTORY_DAYS} วันล่าสุด (ตัดค่าโดดอัตโนมัติ) · พาร์ทที่ไม่มีประวัติ fallback เป็น cycle time × OEE
        {shiftNet && <> บนฐาน <b>เวลาทำงานสุทธิ {shiftNet.netMin} นาที/กะ</b> (เวลากะ {DEFAULT_SHIFT_MIN} − พักตามนโยบาย {Math.round(shiftNet.brkMin)})
          {shiftNet.fallback && <span style={{ color: '#f59e0b', fontWeight: 700 }}> ⚠ ใช้ค่าพักสำรอง (อ่านตารางเวลาพักไม่ได้)</span>}</>}
        {pairsCollapsed.length > 0 && (
          <> · 🔗 <b>งานคู่ {pairsCollapsed.length} คู่</b> ปั๊มทีเดียวได้ 2 ข้าง — ยอด<b>ชิ้น</b>บวกทั้งคู่ แต่<b>ภาระเวลา</b>นับครั้งเดียว
            <span style={{ marginLeft: 4 }}>({pairsCollapsed.slice(0, 3).map(([a, b]) => `${a}↔${b}`).join(' · ')}{pairsCollapsed.length > 3 ? ' …' : ''})</span></>
        )}
      </div>

      {/* 🔍 ความต้องการที่เลข SAP ถูกต้องแล้ว แต่ยังไม่ถูกนับในแผน — คนละเรื่องกับ "จับคู่ SAP ไม่ได้" */}
      {/* 🌳 ที่มาของงานในแผน — ต้องบอกว่าตัวเลขรวมอะไรไว้บ้าง ไม่งั้นคนอ่านจะเทียบกับ order ลูกค้าแล้วงง */}
      {!loading && (
        <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
          {bomErr ? (
            <span style={{ color: '#f59e0b', fontWeight: 700 }}>⚠ อ่าน BOM ไม่ได้ — แผนนับเฉพาะพาร์ทที่ลูกค้าสั่งตรง (ไลน์ที่ทำพาร์ทลูกจะดูเหมือนไม่มีงาน)</span>
          ) : !useBom ? (
            <span>🌳 ปิดการรวมงานจาก BOM อยู่ — แผนนับเฉพาะพาร์ทที่ลูกค้าสั่งตรง</span>
          ) : demandPcs.bom ? (
            <>🌳 รวมงานที่ระเบิดจาก BOM แล้ว: <b>{Math.round(demandPcs.bom.childPcs).toLocaleString()} ชิ้น</b> จากพาร์ทที่มี BOM {demandPcs.bom.rootsWithBom} ตัว
              {demandPcs.bom.rootsNoBom > 0 && <span> · ยังไม่มี BOM {demandPcs.bom.rootsNoBom} ตัว (ลูกของพาร์ทเหล่านี้ยังไม่เข้าแผน)</span>}
              {' · '}⏮️ <b>ไล่ย้อนวันจากดิวลูกค้าแล้ว</b> — lead time ของแต่ละชั้นคิดจากกำลังผลิตจริงของไลน์นั้น
              (ถอยวันข้ามวันหยุดตามปฏิทิน + เผื่อขนย้าย 1 วันทำงานต่อชั้น){demandPcs.sched?.maxLevel > 1 ? ` · ลึกสุด ${demandPcs.sched.maxLevel} ชั้น` : ''}
            </>
          ) : null}
          {demandPcs.sched?.noCapMats?.length > 0 && (
            <div style={{ marginTop: 2 }}>
              ⏱️ พาร์ทที่ <b>ยังไม่รู้กำลังผลิต {demandPcs.sched.noCapMats.length} ตัว</b> — ไล่ย้อนวันให้ที่ 1 วันไว้ก่อน (อาจสั้นกว่าจริง)
            </div>
          )}
          {demandPcs.buffer && (
            <div style={{ marginTop: 2 }}>
              📦 {useBuffer
                ? <>หักของที่มีใน <b>STORE</b> แล้ว <b>{Math.round(demandPcs.buffer.dailyAbsorbed).toLocaleString()} ชิ้น</b> (รายวัน) ·
                    <b> {Math.round(demandPcs.buffer.monthlyAbsorbed).toLocaleString()} ชิ้น</b> (รายเดือน) จาก {demandPcs.buffer.mats} พาร์ทที่มีของคงเหลือ
                    {' · '}<span title="backflush ยังไม่ทำงานครบ (issue 5,908 : consume 40) ⇒ ยอดคงเหลือที่ไลน์สูงกว่าความจริง เอามาหักแล้วจะสั่งผลิตน้อยเกินไป">
                      ⚠️ ไม่หักยอดที่ค้างอยู่ "ที่ไลน์" (เชื่อถือไม่ได้)</span></>
                : <>ไม่หักสต็อก STORE — ตัวเลขคือความต้องการดิบ (ยังไม่ดูของที่มีอยู่)</>}
            </div>
          )}
        </div>
      )}

      {/* 🚨 ไล่ย้อนแล้วหลุดไปก่อนวันนี้ = ต้องเริ่มตั้งแต่เมื่อวาน — ห้ามปัดเข้าวันนี้เงียบๆ */}
      {!loading && demandPcs.sched?.late?.length > 0 && (() => {
        const late = demandPcs.sched.late;
        const mine = late.filter(l => lineOfMat(l.mat_no));      // เฉพาะที่เป็นงานของไลน์ใน scope
        const show = (mine.length ? mine : late).slice(0, 6);
        return (
          <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, color: 'var(--text)' }}>
            🚨 <b style={{ color: '#ef4444' }}>สายแล้ว {late.length} รายการ</b> — ไล่ย้อนจากวันส่งแล้ว ต้องเริ่มผลิตตั้งแต่ก่อนวันนี้
            <div style={{ marginTop: 4, color: 'var(--muted)', fontSize: 11.5, display: 'grid', gap: 2 }}>
              {show.map((l, i) => (
                <div key={`${l.mat_no}-${l.needBy}-${i}`}>
                  <b style={{ color: 'var(--text2)' }}>{l.mat_no}</b> {Math.round(l.qty).toLocaleString()} ชิ้น ·
                  ต้องเริ่ม <b style={{ color: '#ef4444' }}>{fmtDate(l.needBy)}</b> เพื่อให้ทันดิว {fmtDate(l.dueOfParent)}
                  {l.days > 1 && <span> · ใช้เวลาผลิต ~{l.days} วัน{l.capped ? ' (ตัดที่เพดาน 60 วัน — กำลังผลิตที่ระบบรู้ต่ำผิดปกติ ตรวจ CT/ประวัติพาร์ทนี้)' : ''}</span>}
                  {l.root !== l.mat_no && <span> (ของใบ {l.root})</span>}
                </div>
              ))}
              {late.length > show.length && <div>… อีก {late.length - show.length} รายการ</div>}
            </div>
            <div style={{ marginTop: 3, color: 'var(--muted)', fontSize: 11.5 }}>
              → งานพวกนี้ถูกยกมาเป็นยอดค้างของวันแรกในแผนแล้ว (ไม่ได้หายไป) — ต้องเร่ง/เพิ่มกะ หรือเลื่อนดิวกับลูกค้า
            </div>
          </div>
        );
      })()}

      {/* 🧹 worklist ให้ PE/Planning — ระบบไม่แก้ข้อมูลให้เอง (กฎของ bomTree.js) */}
      {!loading && useBom && demandPcs.bom?.flatDupes?.length > 0 && (
        <div style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, color: 'var(--text)' }}>
          🧹 <b>BOM แบนซ้ำ {demandPcs.bom.flatDupes.length} จุด</b> — ชิ้นเดียวกันถูกใส่ไว้ทั้งชั้น 1 และในชั้นลึกของใบเดียวกัน
          <div style={{ marginTop: 3, color: 'var(--muted)', fontSize: 11.5 }}>
            แผนนี้ <b>ต่อโซ่แบบ SAP</b> (นับครั้งเดียว ไม่นับแถวชั้น 1 ที่ซ้ำ) — ตัวเลขจึงถูกแล้ว
            แต่ข้อมูลยังซ้ำอยู่ ⇒ ให้ PE/Planning ไปเก็บที่ <b>/products แท็บ BOM</b>
          </div>
          <div style={{ marginTop: 4, color: 'var(--muted)', fontSize: 11.5, wordBreak: 'break-word' }}>
            {demandPcs.bom.flatDupes.slice(0, 6).map(f => `${f.root} → ${f.mat_no}`).join(' · ')}
            {demandPcs.bom.flatDupes.length > 6 ? ` … อีก ${demandPcs.bom.flatDupes.length - 6} จุด` : ''}
          </div>
        </div>
      )}
      {!loading && useBom && demandPcs.bom?.cycles > 0 && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, color: '#ef4444', fontWeight: 700 }}>
          ⛔ BOM วนลูป {demandPcs.bom.cycles} จุด — ระบบตัดการไล่ชั้นทิ้งเพื่อไม่ให้ค้าง ⇒ ความต้องการของกิ่งนั้นอาจขาด (ไปแก้ที่ /products แท็บ BOM)
        </div>
      )}

      {!loading && demandGaps.noLine > 0 && (
        <div style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, color: 'var(--text)' }}>
          ⚠️ <b>{demandGaps.noLine} รายการความต้องการยังไม่ถูกนับในแผน</b> — พาร์ท {demandGaps.noLineParts.size} ตัวนี้<b>ยังไม่ได้ผูกไลน์ผลิต</b> (หรือชื่อไลน์ไม่มีในทะเบียนไลน์)
          <div style={{ marginTop: 4, color: 'var(--muted)', fontSize: 11.5, wordBreak: 'break-word' }}>
            {[...demandGaps.noLineParts].slice(0, 8).join(' · ')}{demandGaps.noLineParts.size > 8 ? ' …' : ''}
          </div>
          <div style={{ marginTop: 3, color: 'var(--muted)', fontSize: 11.5 }}>→ ตั้งไลน์ผลิตให้พาร์ทที่หน้า Product Master (ช่อง “ไลน์”)</div>
        </div>
      )}
      {!loading && demandGaps.outScope > 0 && (
        <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
          ℹ️ ซ่อนไว้ตามตัวกรองส่วนงาน: {demandGaps.outScope} รายการความต้องการอยู่ไลน์นอกขอบเขตที่เลือก
        </div>
      )}

      {!loading && (unmapped.orders > 0 || unmapped.fcParts.size > 0) && (
        <div style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, color: 'var(--text)' }}>
          ⚠️ <b>ยังจับคู่เลข SAP ไม่ได้ {unmapped.orders} ออเดอร์ · {unmapped.parts.size} พาร์ท{unmapped.fcParts.size > 0 ? ` · forecast ${unmapped.fcParts.size} พาร์ท` : ''}</b> — พาร์ทเหล่านี้**ไม่ถูกนับในแผน** (ยังไม่ได้ตั้ง `p_no`/SAP ใน Product Master ให้ตรงเลขลูกค้า)
          {unmapped.parts.size > 0 && <div style={{ marginTop: 4, color: 'var(--muted)', fontSize: 11.5, wordBreak: 'break-word' }}>ตัวอย่าง: {[...unmapped.parts].slice(0, 8).join(' · ')}{unmapped.parts.size > 8 ? ' …' : ''}</div>}
          <div style={{ marginTop: 3, color: 'var(--muted)', fontSize: 11.5 }}>→ ไปตั้ง p_no ที่หน้า Product Master หรือใช้ปุ่ม 🔗 จับคู่เลข SAP ในหน้า Planner &amp; Sales</div>
        </div>
      )}

      {/* 🌑 ไลน์ที่ไม่มีความต้องการในระบบเลย — เดิมถูกกรองทิ้งทั้งไลน์ ⇒ จอว่างอ่านได้ว่า "ไลน์ว่าง"
           ทั้งที่ความจริงคือ "ยังไม่มีทางรับ order ของลูกค้าเจ้านั้นเข้าระบบ" (วัดจริง 22/09: 10 จาก 22 ไลน์) */}
      {!loading && tab === 'daily' && silentLines.length > 0 && (
        <div style={{ background: 'var(--bg3)', border: '1px dashed var(--border2)', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, color: 'var(--text2)' }}>
          🌑 <b>{silentLines.length} ไลน์ยังไม่มีข้อมูลความต้องการ</b> — ไม่ใช่ "ไลน์ว่าง" แต่คือยังไม่มี order/forecast ของพาร์ทในไลน์นี้เข้าระบบ
          <div style={{ marginTop: 5, display: 'flex', flexWrap: 'wrap', gap: '4px 10px', fontSize: 11.5 }}>
            {silentLines.slice(0, 12).map(l => (
              <span key={l.line} style={{ color: 'var(--muted)' }}>
                <b style={{ color: 'var(--text2)' }}>{l.line}</b> · {l.parts} พาร์ท{l.customers.size ? ` · ${[...l.customers].slice(0, 3).join('/')}` : ''}
              </span>
            ))}
            {silentLines.length > 12 && <span style={{ color: 'var(--muted)' }}>… อีก {silentLines.length - 12} ไลน์</span>}
          </div>
          <div style={{ marginTop: 4, color: 'var(--muted)', fontSize: 11.5 }}>→ ลูกค้าที่ยังไม่มีทางเข้า order (ไม่ได้ส่ง EDI 830/862 หรือ e-SMART) ต้องนำเข้าด้วยวิธีอื่นก่อน แผนถึงจะครบทั้งโรงงาน</div>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>กำลังวิเคราะห์กำลังผลิต…</div>
      ) : tab === 'capacity' ? (
        <CapacityBoard
          role={role} scope={{ role, lineId: userLineId, sections: scopeSecs }}
          lines={viewLines} months={capMonths} calMap={calMap}
          demandByMonth={demandPcs.byMonth} ctOf={ctOf} lineOfMat={lineOfMat} pairOf={pairOf}
          lineOee={lineOee}
        />
      ) : tab === 'daily' ? (
        daily.length === 0 ? <div style={{ ...card, color: 'var(--muted)', fontSize: 13 }}>ไม่มีออเดอร์ค้างส่งในช่วง {DAILY_HORIZON} วันข้างหน้า สำหรับไลน์ใน scope{silentLines.length > 0 ? ` (และ ${silentLines.length} ไลน์ยังไม่มีข้อมูลความต้องการ — ดูแถบด้านบน)` : ''}</div> : <>
        {/* สรุปมาตรการ ม.75: ไลน์ไหนหยุดได้ / ไลน์ไหน order ไม่ลงต้องเรียกมา (คำสั่ง user 2026-07-21) */}
        {daily.some(r => r.sd75Total > 0) && (() => {
          const stoppable = daily.filter(r => r.sd75Total > 0 && r.recall75Days === 0);
          const mustWork = daily.filter(r => r.recall75Days > 0);
          return (
            <div style={{ ...card, borderColor: '#a78bfa66' }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#a78bfa', marginBottom: 6 }}>⚖️ มาตรการหยุดจ่าย 75% (ม.75) — ช่วง {DAILY_HORIZON} วันข้างหน้า</div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12 }}>
                <div style={{ flex: '1 1 260px' }}>
                  <div style={{ color: '#22c55e', fontWeight: 700, marginBottom: 4 }}>🛑 หยุดตามมาตรการได้ ({stoppable.length} ไลน์)</div>
                  {stoppable.length === 0 ? <div style={{ color: 'var(--muted)' }}>— ไม่มี —</div>
                    : stoppable.map(r => <div key={r.line.id} style={{ color: 'var(--text2)' }}>{r.line.name} <span style={{ color: 'var(--muted)' }}>· หยุดได้ทั้ง {r.sd75Total} วัน</span></div>)}
                </div>
                <div style={{ flex: '1 1 260px' }}>
                  <div style={{ color: '#a78bfa', fontWeight: 700, marginBottom: 4 }}>⚡ หยุดไม่ได้ — order ไม่ลด ต้องเรียกมาทำ ({mustWork.length} ไลน์)</div>
                  {mustWork.length === 0 ? <div style={{ color: 'var(--muted)' }}>— ไม่มี —</div>
                    : mustWork.map(r => <div key={r.line.id} style={{ color: 'var(--text2)' }}>{r.line.name} <span style={{ color: '#a78bfa', fontWeight: 700 }}>· เรียกมา {r.recall75Days}/{r.sd75Total} วัน</span>{r.sd75Stoppable > 0 && <span style={{ color: 'var(--muted)' }}> (อีก {r.sd75Stoppable} วันหยุดได้)</span>}</div>)}
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>ตัดสินจาก order ค้างส่งจริง ณ ตอนนี้ + กำลังผลิตของแต่ละไลน์ — มาทำงานวัน ม.75 = ค่าแรงปกติ (ไม่ใช่ OT วันหยุด) · ดูวันไหนต้องมาที่แถบปฏิทินของไลน์ด้านล่าง (⚡)</div>
            </div>
          );
        })()}
        {daily.map(({ line, days, otDays, nightDays, recall75Days, holidayDays, endBacklog, sd75Total, sd75Stoppable, unknownCap, orderCount, carryPcs }) => (
          <div key={line.id} style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{line.name}</span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{line.section} · {orderCount} ออเดอร์</span>
              {/* สรุปทั้งช่วง */}
              {endBacklog > 0.05
                ? <span style={chip('#ef4444')}>🚨 ต่อให้เปิดเต็มที่ยังไม่ทัน — ค้าง ~{endBacklog.toFixed(1)} กะ ณ สิ้นช่วง</span>
                : (otDays + nightDays + recall75Days + holidayDays === 0
                  ? <span style={chip('#22c55e')}>✅ กะเช้าปกติพอ ไม่ต้องเปิด OT</span>
                  : <span style={chip('#f59e0b')}>ต้องเปิด: {nightDays ? `กะดึก ${nightDays} วัน · ` : ''}{otDays ? `OT ${otDays} วัน · ` : ''}{recall75Days ? `ยกเลิกหยุด75% ${recall75Days} วัน · ` : ''}{holidayDays ? `ทำวันหยุด OT ${holidayDays} วัน` : ''}</span>)}
              {sd75Total > 0 && (recall75Days > 0
                ? <span style={chip('#a78bfa')} title="วัน ม.75 ที่มี order ชน/งานค้าง — ต้องเรียกพนักงานมาทำงาน (ค่าแรงปกติ)">⚡ ม.75: หยุดได้ {sd75Stoppable}/{sd75Total} วัน — ต้องเรียกมาทำ {recall75Days} วัน</span>
                : <span style={chip('#22c55e')} title="ทุกวัน ม.75 ในช่วงนี้ ไลน์นี้ไม่มี order ชน — หยุดตามมาตรการได้">🛑 ม.75: หยุดได้ทั้ง {sd75Total} วัน (order ไม่ชน)</span>)}
              {carryPcs > 0 && <span style={chip('#f59e0b')} title="ออเดอร์ pending ที่วันส่งผ่านมาแล้ว (ย้อน 30 วัน) — รวมเป็นงานค้างตั้งต้นของแผน (convention เดียวกับ Rundown: ค้างเก่ารวมเข้าวันนี้)">⏰ ยกมาจากค้างส่งเก่า {Math.round(carryPcs).toLocaleString()} ชิ้น</span>}
              {unknownCap > 0 && <span style={chip('#94a3b8')} title="พาร์ทที่ยังไม่มีประวัติกำลังผลิต/ไม่รู้จักไลน์">{unknownCap.toLocaleString()} ชิ้นไม่รู้กำลัง</span>}
            </div>
            {/* แถบปฏิทินวันต่อวัน */}
            <div style={{ display: 'flex', gap: 3, overflowX: 'auto', paddingBottom: 4 }}>
              {days.map(d => {
                const top = d.plan.includes('holiday_work') ? PLAN_META.holiday_work : d.plan.includes('recall75') ? PLAN_META.recall75 : d.plan.includes('night') ? PLAN_META.night : d.plan.includes('ot') ? PLAN_META.ot : d.plan.includes('day') ? PLAN_META.day : null;
                const dd = new Date(`${d.date}T12:00:00`);
                return (
                  <div key={d.date} title={`${fmtDate(d.date)}${d.sd75 ? ' (หยุดจ่าย 75% — ม.75)' : d.holiday ? ' (วันหยุด)' : ''}\nดิววันนี้ ${Math.round(d.duePcs).toLocaleString()} ชิ้น (${d.dueLoad.toFixed(2)} กะ)\nแผน: ${d.plan.map(p => PLAN_META[p]?.label || p).join(' ') || (d.holiday ? 'หยุด' : 'ว่าง')}\nค้างยกไป ${d.backlog.toFixed(2)} กะ`}
                    style={{ flexShrink: 0, width: 40, textAlign: 'center' }}>
                    <div style={{ fontSize: 11, color: d.sd75 ? '#a78bfa' : d.holiday ? '#ef4444' : 'var(--muted)' }}>{['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'][dd.getDay()]}</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)' }}>{dd.getDate()}</div>
                    <div style={{ height: 26, marginTop: 2, borderRadius: 5, background: top ? `${top.color}33` : (d.holiday ? 'var(--bg3)' : 'var(--bg2)'), border: `1px solid ${top ? top.color : 'var(--border2)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>
                      {top === PLAN_META.holiday_work ? '⚠' : top === PLAN_META.recall75 ? '⚡' : top === PLAN_META.night ? '🌙' : top === PLAN_META.ot ? '⏰' : top === PLAN_META.day ? '☀' : (d.holiday ? '·' : '')}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap', fontSize: 11, color: 'var(--muted)' }}>
              <span>☀ กะเช้าพอ</span><span>⏰ ต้องเปิด OT</span><span>🌙 ต้องเปิดกะดึก</span><span style={{ color: '#a78bfa' }}>⚡ ยกเลิกหยุด 75% (ค่าแรงปกติ)</span><span style={{ color: '#ef4444' }}>⚠ ทำวันหยุด OT (×1.5/×2)</span>
            </div>
          </div>
        ))}
        </>
      ) : (
        monthly.length === 0 ? <div style={{ ...card, color: 'var(--muted)', fontSize: 13 }}>ไม่มี forecast สำหรับไลน์ใน scope</div> :
        monthly.map(({ line, rows }) => (
          <div key={line.id} style={card}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', marginBottom: 6 }}>{line.name} <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>{line.section}{hasNightShift(viewLines, line.name) ? ' · มีกะดึก' : ' · กะเช้าอย่างเดียว'}</span></div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
                <thead><tr>
                  <th style={{ ...th, textAlign: 'left' }}>เดือน</th>
                  <th style={th}>ยอดต้องการ (ชิ้น)</th>
                  <th style={th}>กะที่ต้องใช้</th>
                  <th style={th}>กะเช้าที่มี</th>
                  <th style={{ ...th, textAlign: 'left' }}>สรุปแผน</th>
                </tr></thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.mk} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ ...td, textAlign: 'left', fontWeight: 700 }}>{r.mk}</td>
                      <td style={td}>{r.fcCount ? Math.round(r.pcs).toLocaleString() : '—'}</td>
                      <td style={td}>{r.fcCount ? r.shiftsNeeded.toFixed(1) : '—'}</td>
                      <td style={td}>{r.dayShifts}{hasNightShift(viewLines, line.name) ? ` (+ดึก ${r.dayShifts})` : ''}</td>
                      <td style={{ ...td, textAlign: 'left' }}><span style={chip(r.color)}>{r.verdict}</span>{r.unknownCap > 0 && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--muted)' }}>({r.unknownCap.toLocaleString()} ชิ้นไม่รู้กำลัง)</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </Page>
  );
}
