/* ══ 📋 แผนสั่งงานรายล็อต — ทีมวางแผนจัดคิวให้ฝ่ายผลิต (2026-09-30 · คำสั่ง user) ═══════════
   *"เราต้องการหน้าที่เอาไว้ให้หน่วยงานวางแผน จัดแผนการผลิตให้กับฝ่ายผลิต สำหรับพวกงาน lot size
     ที่ไม่ได้ผลิตตาม KANBAN แบบ first come first serve ต้องมีการวิเคราะห์และจัดการโดยทีมวางแผน"*

   ต่างจาก 3 แท็บเดิมของหน้านี้ตรงที่ **แท็บนี้เขียน DB** — อีก 3 แท็บวิเคราะห์อย่างเดียว
     📅 รายวัน   ตอบ "ต้องเปิดกี่กะ"        ← ยังไม่บอกว่า *ทำอะไรก่อนหลัง*
     📋 แท็บนี้  ตอบ "ทำอะไร เท่าไหร่ ลำดับไหน เครื่องไหน แม่พิมพ์ตัวไหน"  ⇒ หน้างานกด "เริ่ม" แล้วจบ

   🔴 กติกาที่ห้ามละเมิด (ตัวเลขทุกตัวมาจาก `utils/planLots.js` **ห้ามคิดเองในไฟล์นี้**):
     · **เกินกำลัง = เตือน ห้ามบล็อก** — วางแผนอาจตั้งใจอัดแล้วไปแก้ด้วย OT/คนเพิ่ม
     · **ประเมินไม่ได้ต้องเขียนว่าไม่รู้ ห้ามโชว์ 0** (ไม่มี CT · ไม่รู้ความสูงแม่พิมพ์)
     · **ใบที่หน้างานเปิดเองนอกแผน ต้องโผล่ให้เห็น** — ไม่ใช่ความผิด แต่วางแผนต้องรู้ว่าแผนถูกข้าม
     · **ยกเลิกล็อต = `cancelled` + เหตุผล ห้าม delete แถว** (สอบกลับไม่ได้)
     · สิทธิ์ผ่าน `can('production_plan','write')` **ห้าม hardcode role array**
     · 🔗 **แผน = คิวต่อเนื่อง ไม่ใช่ "ของกะใดกะหนึ่ง"** (30/09 · คำสั่ง user
       *"วางได้ทีเดียวทั้ง 2 กะต่อกัน · เกินกะล้นไปกะดึก · เกิน 1 วันล้นไปอีกวัน"*)
       ⇒ `work_date`/`shift` ของล็อตเป็น **ผลลัพธ์ที่ระบบคำนวณว่างานตกกะไหน** ไม่ใช่ช่องที่คนเลือก
       (หน้างานยังอ่านเหมือนเดิม — `PlannedLotQueue` กรองด้วย work_date+shift ของกะตัวเอง)
       · 🔴 **ล็อตที่เวลาเชื่อไม่ได้ (ไม่มี CT / มีใบไม่มี CT อยู่ก่อน) ห้ามย้ายกะให้** (`sure=false`)
         เดาแทนคนแล้วงานจะไปโผล่ผิดกะบนจอหน้างาน — คงกะเดิมไว้แล้วเขียนบนจอว่าจัดให้ไม่ได้
   ══════════════════════════════════════════════════════════════════════════════════════════ */
import { useState, useEffect, useMemo, useCallback, useContext, useRef } from 'react';
import { supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { canSeeded } from '../utils/permissions';
import { checkWrite } from '../utils/dbWrite';
import { toast } from '../components/Toast';
import { snapMachineNo } from '../utils/machineNo';
import { resolveSetupRule } from '../utils/pressSetup';
import {
  planSummary, matchPlanToActual, sortBySeq, resequence, moveLot, suggestSequence, lotRunMin, qtyText,
} from '../utils/planLots';
import { breakIntervalsIn } from '../utils/oee';
import { buildHorizon, assignShifts, horizonSummary, orderAcrossHorizon, SEG_HOURS, SHIFT_LABEL } from '../utils/planHorizon';
import { layoutLots } from '../utils/planTimeline';
import PlanTimeline from './PlanTimeline';
import FilterBar from './FilterBar';
import Segmented from './Segmented';
import MatLabel from './MatLabel';
import MachineSelect from './MachineSelect';

const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, boxShadow: 'var(--shadow-sm)' };
const th = { padding: '5px 8px', borderBottom: '1px solid var(--border)', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' };
const td = { padding: '5px 8px', fontSize: 12, whiteSpace: 'nowrap' };
const fmtMin = (m) => m == null ? '—' : m < 60 ? `${Math.round(m)} น.` : `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')} ชม.`;
/* ข้ามวัน = เวลาเปล่าๆ ไม่พอ ("22:34" ของวันไหน?) */
const fmtDayTime = (ms) => {
  const d = new Date(ms);
  return `${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export default function ProdLotPlanner({
  lines = [], demandByDate = {}, carry = {}, ctOf = () => 0, pairOf = () => null,
  lineOfMat = () => null, nameOfMat = () => '', customerOf = () => null, netMin = null,
  calOf = null,
}) {
  const { role, fullName } = useContext(UserContext);
  /* ยังไม่ seed สิทธิ์ = โหมดอ่านอย่างเดียว (deploy-safe — จอไม่พัง คนแค่แก้ไม่ได้) */
  const mayWrite = canSeeded('production_plan', 'write', role);

  const [lineName, setLineName] = useState('');
  const [date, setDate]   = useState(todayStr);
  const [shift, setShift] = useState('day');          // กะที่**เริ่ม**วางแผน (ไม่ใช่ขอบเขตทั้งหมด)
  /* กี่กะที่ยอมให้คิวไหลต่อไป — 4 กะ = 2 วัน (ปุ่มยืดได้ ไม่ใช่ค่าตายตัวในโค้ด) */
  const [segCount, setSegCount] = useState(4);
  /* 🔴 วันหยุดแบบ OT (ot15/ot2) เปิดทำได้ แต่**ต้องคนสั่ง** ระบบไม่เดาให้ (กฎ "วันหยุด 2 ความหมาย") */
  const [useOtHoliday, setUseOtHoliday] = useState(false);
  const [lots, setLots]   = useState([]);
  const [orders, setOrders] = useState([]);
  const [dies, setDies]   = useState([]);          // die_sets + ความสูงจาก equipment_die
  const [rules, setRules] = useState([]);
  const [breakPolicies, setBreakPolicies] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [dirty, setDirty]     = useState(false);

  useEffect(() => { if (!lineName && lines.length) setLineName(lines[0].name); }, [lines, lineName]);

  /* ── 🗓️ ขอบเขต: กะเช้า → กะดึก → วันถัดไป ต่อกันเป็นเส้นเดียว ─────────────────────
     🔴 กติกาทั้งหมด (กะยาวเท่าไหร่ · วันไหนโรงงานไม่เดิน · ข้ามวันหยุดยังไง) อยู่ใน
        `utils/planHorizon.js` **ห้ามคิดเองในไฟล์นี้** — บอร์ดอื่นจะได้ตอบเลขเดียวกัน */
  const horizon = useMemo(() => buildHorizon({
    startDate: date, startShift: shift, maxSegments: segCount,
    dayTypeOf: calOf || (() => null), includeOtHoliday: useOtHoliday, calendarLoaded: !!calOf,
  }), [date, shift, segCount, calOf, useOtHoliday]);
  const lastDate = horizon.segments.length
    ? horizon.segments[horizon.segments.length - 1].workDate : date;
  /* ref ไม่ใช่ dep — `load` ต้องยิงใหม่เมื่อ "ช่วงวันที่" เปลี่ยน ไม่ใช่ทุกครั้งที่ขอบเขตถูกคิดใหม่
     (ใส่ segments เป็น dep = สลับติ๊กวันหยุด OT แล้วยิงคิวรีซ้ำฟรีๆ · กฎ db-write ข้อ 9) */
  const segRef = useRef(horizon.segments);
  segRef.current = horizon.segments;

  /* ── โหลดข้อมูลของไลน์ตลอดขอบเขต (ทุกกะ ไม่ใช่กะเดียว) ──────────────────────────
     🔴 guard `alive` — จอนี้ยิงคิวรีตาม state (ไลน์/วัน/ขอบเขต) ⇒ สลับเร็วกว่าคำตอบเก่ากลับ
        = คำตอบเก่าเขียนทับจอใหม่ (กฎเหล็ก db-write-rules ข้อ 4 · เคยเกิดจริงที่ Daily Report) */
  const load = useCallback(async (alive = () => true) => {
    if (!lineName || !date) return;
    setLoading(true);
    const [lotRes, dieRes, ruleRes, sessRes, brkRes] = await Promise.all([
      supabaseDR.from('production_plan_lots')
        .select('id, work_date, shift, line_name, seq, mat_no, part_name, qty_plan, machine_no, die_no, status, prod_order_id, due_date, source, setup_min_est, note, cancel_reason, planned_by')
        .gte('work_date', date).lte('work_date', lastDate).eq('line_name', lineName),
      supabaseDR.from('die_sets').select('id, set_code, mat_no, part_name, line_name, equipment_die(die_height_mm)').eq('is_active', true),
      supabaseDR.from('press_setup_rules').select('*').eq('is_active', true),
      supabaseDR.from('production_sessions').select('id').gte('work_date', date).lte('work_date', lastDate).eq('line_name', lineName),
      supabaseDR.from('break_policies').select('*').eq('is_active', true),
    ]);
    if (!alive()) return;                       // สลับไลน์/วันก่อนคำตอบกลับ = ทิ้งคำตอบเก่า
    if (lotRes.error) toast.error(`โหลดแผนไม่สำเร็จ: ${lotRes.error.message}`);
    /* 🔴 `seq` เป็นลำดับ**ภายในกะ** ⇒ โหลดหลายกะแล้วเรียงด้วย seq เฉยๆ จะได้ 1,1,2,2,3
       = งานกะดึกแทรกกลางกะเช้า · ต้องเรียงตามลำดับกะในขอบเขตก่อนเสมอ */
    setLots(orderAcrossHorizon(lotRes.data || [], segRef.current));
    setDies(dieRes.data || []);                 // กรองตามพาร์ทตอนเลือกใน dieOptsForMat (ไลน์เดียวกันอาจใช้แม่พิมพ์ข้ามไลน์)
    setRules(ruleRes.data || []);
    setBreakPolicies(brkRes.data || []);
    const sids = (sessRes.data || []).map(s => s.id);
    if (sids.length) {
      const { data: ord } = await supabaseDR.from('prod_orders')
        .select('id, mat_no, prod_no, qty, qty_ok, qty_actual, status, is_manual, opened_at')
        .in('session_id', sids);
      if (alive()) setOrders(ord || []);
    } else if (alive()) setOrders([]);
    if (alive()) { setLoading(false); setDirty(false); }
  }, [lineName, date, lastDate]);

  /* 🔴 guard stale-response (กฎเหล็ก db-write-rules ข้อ 4) — จอนี้ยิงคิวรีตาม state
     ถ้า user สลับไลน์/วัน/กะ เร็วกว่าคำตอบเก่ากลับ คำตอบเก่าจะเขียนทับจอใหม่ */
  useEffect(() => { let on = true; load(() => on); return () => { on = false; }; }, [load]);

  /* ── แม่พิมพ์: รหัส → { id, die_height_mm } (ป้อน pressSetup) ──────────────────── */
  const dieByCode = useMemo(() => {
    const m = {};
    dies.forEach(d => {
      if (!d.set_code) return;
      const h = (d.equipment_die || []).map(e => e?.die_height_mm).find(v => v != null);
      m[d.set_code] = { id: d.set_code, die_height_mm: h ?? null, mat_no: d.mat_no, part_name: d.part_name };
    });
    return m;
  }, [dies]);
  const dieOf = useCallback((lot) => (lot?.die_no ? dieByCode[lot.die_no] || null : null), [dieByCode]);
  const dieOptsForMat = useCallback((mat) => dies.filter(d => !mat || d.mat_no === mat), [dies]);
  /* กฎเวลาเปลี่ยนรุ่น — เครื่อง ชนะ ไลน์ ชนะ global (ตัวเลือกกฎอยู่ที่ pressSetup ที่เดียว) */
  const rule = useMemo(() => resolveSetupRule(rules, { lineName }), [rules, lineName]);

  /* ── กรอบเวลาของกะ + ช่วงพัก ─────────────────────────────────────────────────────
     🔴 ช่วงพักต้องมาจาก `breakIntervalsIn()` (`utils/oee.js`) ที่เดียว **ห้ามสร้างช่วงพักเอง**
        (กติกาพักทั้งหมด — กรองกะ/กระบวนการ/ot_scope/กะดึกข้ามวัน — อยู่ที่นั่น) */
  const frame = { startMs: horizon.startMs, endMs: horizon.endMs };
  /* 🔴 เวลาพักต้องคิด **ทีละกะ** แล้วค่อยต่อกัน — `breakIntervalsIn` รับกรอบกะเดียว
     (มันต้องรู้ว่ากะไหน/วันไหน ถึงจะกรอง shift + ot_scope + พักกะดึกหลังเที่ยงคืนได้ถูก)
     ยิงทีเดียวด้วยกรอบ 48 ชม. = ได้พักผิดทั้งยวง */
  const breaks = useMemo(() => horizon.segments.flatMap(sg => breakIntervalsIn({
    policies: breakPolicies, startMs: sg.startMs, endMs: sg.endMs, workDate: sg.workDate, shift: sg.shift,
  })), [breakPolicies, horizon.segments]);

  const summary = useMemo(() => planSummary({
    lots, orders, ctOf, pairOf, dieOf, rule, netShiftMin: netMin,
  }), [lots, orders, ctOf, pairOf, dieOf, rule, netMin]);

  /* ── 🔗 วางคิวลงบนขอบเขตจริง แล้วดูว่าล็อตไหน "ตกกะไหน" ────────────────────────────
     🔴 คำนวณที่นี่ **ที่เดียว** แล้วส่งต่อให้ทั้งหัวสรุป · ตาราง · ปุ่มบันทึก
        (ให้ไทม์ไลน์คิดเองอีกรอบ = 2 จอตอบคนละเลข — บทเรียนเดิมของโมดูลนี้) */
  const lay = useMemo(() => layoutLots({
    lots, ctOf, pairOf, dieOf, rule,
    startMs: horizon.startMs, endMs: horizon.endMs, breaks, closed: horizon.closed,
    rowSpanMs: SEG_HOURS * 3600000,          // 1 บรรทัดที่คนมอง = 1 กะ (ดู planTimeline §ช่องนามธรรม)
  }), [lots, ctOf, pairOf, dieOf, rule, horizon, breaks]);
  const landing = useMemo(() => assignShifts(lay.boxes, horizon.segments), [lay.boxes, horizon.segments]);
  const landingOf = useMemo(() => Object.fromEntries(landing.map(a => [a.id, a])), [landing]);
  const hz = useMemo(() => horizonSummary({
    boxes: lay.boxes, segments: horizon.segments, endMs: lay.endMs, unknownCount: lay.unknownCount,
  }), [lay, horizon.segments]);
  /* ล็อตที่ระบบยังจัดกะให้ไม่ได้ / ล้นเลยขอบเขต — 2 กองคนละเรื่อง ห้ามยุบรวม */
  const unsureCount = landing.filter(a => !a.sure).length;
  const overflowCount = landing.filter(a => a.overflow).length;
  /* 🧩 Layer 1 ↔ Layer 2 — จับคู่จากยอดรวมต่อพาร์ท (ไม่ใช่ 1 ล็อต = 1 ใบ · ดู planLots.js) */
  const rec = useMemo(() => matchPlanToActual(lots, orders), [lots, orders]);

  /* ── ความต้องการของไลน์นี้ที่ยังไม่ได้วางแผน (ของค้างส่งมาก่อนเสมอ) ───────────── */
  const unplanned = useMemo(() => {
    const planned = new Set(lots.filter(l => l.status !== 'cancelled').map(l => l.mat_no));
    const want = {};
    Object.entries(carry || {}).forEach(([mat, q]) => { if (q > 0) want[mat] = (want[mat] || 0) + q; });
    Object.entries(demandByDate || {}).forEach(([d, byMat]) => {
      /* 🔗 ขอบเขตยาวหลายวัน ⇒ ความต้องการที่ถึงกำหนด**ภายในขอบเขต**ก็ต้องเห็น
         (เดิมตัดที่วันเดียว — วางแผน 3 วันแต่เห็นงานแค่วันแรก) */
      if (d > lastDate) return;
      Object.entries(byMat || {}).forEach(([mat, q]) => { if (q > 0) want[mat] = (want[mat] || 0) + q; });
    });
    return Object.entries(want)
      .filter(([mat]) => lineOfMat(mat) === lineName && !planned.has(mat))
      .map(([mat, qty]) => ({ mat, qty: Math.round(qty) }))
      .sort((a, b) => b.qty - a.qty);
  }, [carry, demandByDate, lastDate, lots, lineOfMat, lineName]);

  /* ── แก้แผนในหน่วยความจำก่อน แล้วค่อยกดบันทึกทีเดียว ────────────────────────── */
  const patch = (id, upd) => { setLots(ls => ls.map(l => (l.id === id ? { ...l, ...upd } : l))); setDirty(true); };
  const addLot = (mat, qty) => {
    const die = dies.find(d => d.mat_no === mat);
    setLots(ls => resequence([...ls, {
      id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, _new: true,
      work_date: date, shift, line_name: lineName, seq: ls.length + 1,
      mat_no: mat, part_name: nameOfMat(mat) || null, qty_plan: qty || 1,
      machine_no: null, die_no: die?.set_code || null, status: 'planned', source: 'manual',
    }]));
    setDirty(true);
  };
  const cancelLot = (l) => {
    const why = window.prompt(`ยกเลิกล็อต ${l.mat_no} (${l.qty_plan} ชิ้น) เพราะอะไร?\n(เก็บไว้เป็นประวัติ ไม่ได้ลบทิ้ง)`);
    if (!why) return;
    patch(l.id, { status: 'cancelled', cancel_reason: why });
  };

  const save = async () => {
    if (!mayWrite) return;
    setSaving(true);
    const seqd = resequence(lots);
    /* เวลาเปลี่ยนรุ่น ณ ตอนวางแผน — เก็บไว้ดูย้อนหลังว่าตอนนั้นระบบประเมินได้เท่าไหร่
       🔴 ประเมินไม่ได้ = null (ห้าม 0) · กฎเดียวกับ pressSetup */
    const rows = seqd.map((l, i) => {
      const prev = i > 0 ? dieOf(seqd[i - 1]) : null;
      const cur = dieOf(l);
      let est = null;
      if (prev && cur && rule) {
        const s = planSummary({ lots: [seqd[i - 1], l], orders: [], ctOf, pairOf, dieOf, rule, netShiftMin: netMin });
        est = s.setupMin;
      }
      const { id, _new, ...rest } = l;
      /* 🔗 กะ/วันที่ของล็อต = **ผลลัพธ์ที่คำนวณได้** ไม่ใช่ช่องที่คนเลือก (คิวไหลข้ามกะ/ข้ามวัน)
         🔴 แต่ล็อตที่เวลาเชื่อไม่ได้ (`sure=false` — ไม่มี CT หรือมีใบไม่มี CT อยู่ก่อน) หรือ
            ล้นเลยขอบเขต **ต้องคงกะเดิมไว้** — ย้ายให้ = เดาแทนคน แล้วงานไปโผล่ผิดกะบนจอหน้างาน */
      const at = landingOf[id];
      const moved = at && at.sure && !at.overflow && at.workDate
        ? { work_date: at.workDate, shift: at.shift } : {};
      return { ...(_new ? {} : { id }), ...rest, ...moved, setup_min_est: est, planned_by: fullName || null };
    });
    /* ลำดับนับใหม่ **ภายในกะที่ไปลงจริง** (1 = ทำก่อน) — หน้างานเรียงด้วย seq ในกะตัวเอง
       ถ้าเอาเลขรวมทั้งขอบเขตไปใส่ กะดึกจะขึ้นต้นที่ #7 ซึ่งอ่านแล้วงง */
    const perShift = {};
    rows.forEach(r => {
      const k = `${r.work_date}|${r.shift}`;
      perShift[k] = (perShift[k] || 0) + 1;
      r.seq = perShift[k];
    });
    const news = rows.filter(r => !r.id);
    const olds = rows.filter(r => r.id);
    let ok = true;
    if (news.length) ok = await checkWrite(await supabaseDR.from('production_plan_lots').insert(news).select('id'), 'บันทึกล็อตใหม่') && ok;
    for (const r of olds) {
      const { id, ...upd } = r;
      ok = await checkWrite(await supabaseDR.from('production_plan_lots').update(upd).eq('id', id).select('id'), 'อัพเดทล็อต') && ok;
    }
    setSaving(false);
    if (ok) {
      const shifts = new Set(rows.map(r => `${r.work_date}|${r.shift}`)).size;
      toast.success(`บันทึกแผน ${rows.length} ล็อต · ${shifts} กะ ✓`);
      await load();
    }
  };

  const noHeight = Object.values(dieByCode).filter(d => d.die_height_mm == null).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <FilterBar style={{ marginBottom: 0 }}>
        <select value={lineName} onChange={e => setLineName(e.target.value)}>
          {lines.map(l => <option key={l.id || l.name} value={l.name}>{l.name}</option>)}
        </select>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} />
        {/* 🔗 ไม่ใช่ "ดูกะไหน" อีกต่อไป — คิวไหลข้ามกะเอง ช่องนี้แค่บอกว่า**เริ่มวาง**ที่กะไหน */}
        <Segmented value={shift} onChange={setShift} label="เริ่มที่" options={[
          { value: 'day', label: '☀️ กะเช้า' }, { value: 'night', label: '🌙 กะดึก' },
        ]} />
        <label style={{ fontSize: 12, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 5 }}
          title="คิวจะไหลต่อไปได้กี่กะ — ไม่พอก็ยืดเพิ่ม (งานที่ล้นเลยขอบเขตจะขึ้นเตือน ไม่ถูกยัดลงกะสุดท้าย)">
          ไหลต่อได้
          <select value={segCount} onChange={e => setSegCount(Number(e.target.value))}>
            <option value={2}>1 วัน (2 กะ)</option>
            <option value={4}>2 วัน (4 กะ)</option>
            <option value={6}>3 วัน (6 กะ)</option>
            <option value={10}>5 วัน (10 กะ)</option>
            <option value={14}>7 วัน (14 กะ)</option>
          </select>
        </label>
        {/* 🔴 วันหยุด OT เปิดทำได้ แต่ต้องคนสั่ง — ระบบไม่เดาว่าจะเรียกคนมาทำวันหยุด */}
        <label style={{ fontSize: 12, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 5 }}
          title="วันหยุดแบบ OT (×1.5 / ×2) เรียกคนมาทำได้ — ติ๊กแล้วคิวจะไหลลงวันหยุดพวกนั้นด้วย · วันหยุด ม.75 ไม่เข้าข่าย">
          <input type="checkbox" checked={useOtHoliday} onChange={e => setUseOtHoliday(e.target.checked)} />
          ใช้วันหยุด OT
        </label>
        <span className="spacer" />
        {mayWrite && (
          <>
            <button onClick={() => { setLots(suggestSequence(lots, dieOf)); setDirty(true); }}
              title="เรียงตามความสูงแม่พิมพ์ให้เสียเวลาเปลี่ยนรุ่นน้อยสุด — เป็นข้อเสนอ แก้ทับได้">
              💡 เสนอลำดับ
            </button>
            <button onClick={save} disabled={saving || !dirty}
              style={{ background: dirty ? 'var(--accent)' : undefined, color: dirty ? '#04210f' : undefined, fontWeight: 800 }}>
              {saving ? 'กำลังบันทึก…' : dirty ? '💾 บันทึกแผน' : 'บันทึกแล้ว'}
            </button>
          </>
        )}
      </FilterBar>

      {!mayWrite && (
        <div style={{ ...card, borderColor: '#f59e0b66', fontSize: 12.5, color: 'var(--text2)' }}>
          👁️ <b>โหมดดูอย่างเดียว</b> — role ของคุณยังไม่มีสิทธิ์ <code>production_plan:write</code> (ปรับได้ที่หน้า /permissions)
        </div>
      )}

      {/* ── สรุปหัวแผง ──────────────────────────────────────────────────────────────
          🔴 คำถามที่คนวางแผนถามจริงคือ **"งานกองนี้จบเมื่อไหร่ กินกี่กะ"** ไม่ใช่ "ใช้กี่ % ของกะ"
             (จอเดิมขึ้น "ใช้ 158% ของกะ" ซึ่งไม่ได้บอกว่าอีก 58% ไปตกที่ไหน — user แจ้ง 30/09) */}
      <div style={{ ...card, display: 'flex', flexWrap: 'wrap', gap: '6px 18px', alignItems: 'baseline' }}>
        <span style={{ fontSize: 13, fontWeight: 800 }}>{summary.lotCount} ล็อต · {qtyText(summary.qtyPlan)} ชิ้น</span>
        <span style={{ fontSize: 12.5, color: 'var(--text2)' }}>⏱️ เวลาผลิต <b>{fmtMin(summary.runMin)}</b></span>
        <span style={{ fontSize: 12.5, color: 'var(--text2)' }}
          title={summary.setupNoDie ? 'ยังไม่ได้ระบุแม่พิมพ์ในล็อตไหนเลย — ประเมินเวลาเปลี่ยนรุ่นไม่ได้ (ไม่ใช่ "ไม่ต้องเปลี่ยน")' : ''}>
          🔧 เปลี่ยนรุ่น <b>{summary.setupMin == null ? '—' : fmtMin(summary.setupMin)}</b>
          <span style={{ color: 'var(--muted)' }}> ({summary.setupNoDie ? 'ยังไม่ระบุแม่พิมพ์' : `${summary.changeCount} ครั้ง`})</span>
        </span>
        <span style={{ fontSize: 13, fontWeight: 800, color: overflowCount > 0 ? '#ef4444' : 'var(--text)' }}>
          🏁 คาดจบ <b>{hz.finishMs == null ? '—' : fmtDayTime(hz.finishMs)}</b>
          {hz.shiftsUsed != null && <span style={{ fontWeight: 600, color: 'var(--text2)' }}> · กิน {hz.shiftsUsed} กะ
            {hz.lastSegment && ` (ยาวถึง ${SHIFT_LABEL[hz.lastSegment.shift]} ${hz.lastSegment.workDate.slice(8)}/${hz.lastSegment.workDate.slice(5, 7)})`}</span>}
        </span>
        {netMin && <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>เวลาทำงานสุทธิ {netMin} นาที/กะ</span>}
        {summary.started > 0 && <span style={{ fontSize: 12, color: 'var(--accent)' }}>▶ เริ่มแล้ว {summary.started} · ปิดแล้ว {summary.closed}</span>}
      </div>

      {/* 🔴 งานที่ยังหาที่ลงไม่ได้ / ยังจัดกะให้ไม่ได้ — 2 เรื่องคนละสาเหตุ ห้ามยุบรวม ห้ามซ่อน */}
      {(overflowCount > 0 || unsureCount > 0) && (
        <div style={{ ...card, borderColor: overflowCount > 0 ? '#ef444466' : '#f59e0b66', fontSize: 12, color: 'var(--text2)', display: 'grid', gap: 3 }}>
          {overflowCount > 0 && (
            <div>🚨 <b style={{ color: '#ef4444' }}>{overflowCount} ล็อตล้นเลยขอบเขต {horizon.segments.length} กะ</b> —
              งานยังไม่มีที่ลงจริง · ยืด "ไหลต่อได้" ให้ยาวขึ้น หรือลดงาน/เพิ่มกำลังผลิต
              <b> ระบบไม่ยัดลงกะสุดท้ายให้</b></div>
          )}
          {unsureCount > 0 && (
            <div>⚠️ <b>{unsureCount} ล็อตยังจัดกะให้ไม่ได้</b> — เวลาเชื่อไม่ได้ (ไม่มี cycle time
              หรือมีล็อตที่ไม่มี CT อยู่ก่อนหน้า) · <b>ล็อตพวกนี้จะคงกะเดิมไว้ตอนบันทึก ไม่ถูกย้าย</b></div>
          )}
        </div>
      )}

      {/* 🔴 ความซื่อสัตย์: อะไรที่ประเมินไม่ได้ ต้องเขียนบนจอ ห้ามปล่อยให้ตัวเลขดูสวย */}
      {(summary.noCtMats.length > 0 || summary.setupUnknown || noHeight > 0) && (
        <div style={{ ...card, borderColor: '#f59e0b66', fontSize: 12, color: 'var(--text2)', display: 'grid', gap: 3 }}>
          {summary.noCtMats.length > 0 && (
            <div>⚠️ <b>{summary.noCtMats.length} พาร์ทยังไม่มี cycle time</b> ({summary.noCtMats.slice(0, 4).join(' · ')}{summary.noCtMats.length > 4 ? ' …' : ''})
              — เวลาผลิตข้างบน<b>ต่ำกว่าจริง</b> · ไปกรอกที่ Product Master</div>
          )}
          {summary.setupUnknown && (
            <div>⚠️ <b>ยังตอบเวลาเปลี่ยนรุ่นรวมไม่ได้</b> — {
              summary.setupNoDie ? 'ยังไม่ได้ระบุแม่พิมพ์ในล็อตไหนเลย (ช่อง "แม่พิมพ์" ในตารางด้านล่าง)'
                : rule ? 'ยังไม่ได้กรอกเวลาฐานยก-ลงแม่พิมพ์' : 'ยังไม่มีกฎเวลาเปลี่ยนรุ่นของไลน์นี้'}
              {' '}(ตั้งที่ <code>/equipment?tab=die</code>) · <b>"—" แปลว่าไม่รู้ ไม่ใช่ 0</b></div>
          )}
          {noHeight > 0 && (
            <div>📏 <b>แม่พิมพ์ {noHeight} ตัวยังไม่ได้กรอกความสูง</b> — ระบบจึงเรียงลำดับให้ประหยัดเวลาเปลี่ยนรุ่นไม่ได้
              (ตัวที่ไม่รู้ความสูงถูกต่อท้ายลำดับ <b>ไม่ได้ตัดทิ้ง</b>)</div>
          )}
        </div>
      )}

      {/* ── 🧲 ไทม์ไลน์จัดแผน (ลากสลับก่อนหลัง) ── */}
      {rec.rows.length > 0 && frame.startMs && (
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>
            🧲 ไทม์ไลน์ — 1 บรรทัด = 1 กะ <span style={{ color: 'var(--muted)', fontWeight: 600, fontSize: 11.5 }}>
              (ความยาวกล่อง = เวลาที่ต้องใช้จริง · งานล้นกะไหลลงบรรทัดถัดไปเอง · ลากเพื่อสลับลำดับ)</span>
          </div>
          <PlanTimeline
            lots={lots} ctOf={ctOf} pairOf={pairOf} dieOf={dieOf} rule={rule}
            startMs={frame.startMs} endMs={frame.endMs} breaks={breaks}
            closed={horizon.closed} segments={horizon.segments} skipped={horizon.skipped}
            editable={mayWrite} nameOfMat={nameOfMat}
            onReorder={(next) => { setLots(next); setDirty(true); }}
          />
          {/* 🔴 ปฏิทินยังไม่โหลด = ยังไม่ได้เช็ควันหยุด ต้องเขียนบนจอ ห้ามเงียบ */}
          {horizon.calendarUnknown && (
            <div style={{ fontSize: 11.5, color: '#f59e0b', marginTop: 5 }}>
              ⚠️ ยังไม่ได้เช็คปฏิทินบริษัท — ขอบเขตนี้ใช้กติกา จ-ศ ไปก่อน <b>วันหยุดพิเศษอาจยังไม่ถูกข้าม</b>
            </div>
          )}
        </div>
      )}

      {/* ── ตารางแผน ── */}
      <div style={{ ...card, overflowX: 'auto' }}>
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>
          📋 คิวงาน <span style={{ color: 'var(--muted)', fontWeight: 600, fontSize: 11.5 }}>
            (คอลัมน์ "ลงกะ" = กะที่ระบบคำนวณว่างานใบนี้ตกไปอยู่ — บันทึกแล้วหน้างานกะนั้นจะเห็น)</span>
        </div>
        {loading ? <div style={{ color: 'var(--muted)', fontSize: 12.5, padding: 12 }}>กำลังโหลด…</div>
          : rec.rows.length === 0 ? <div style={{ color: 'var(--muted)', fontSize: 12.5, padding: 12 }}>ยังไม่มีแผนของกะนี้ — เพิ่มจากรายการความต้องการด้านล่าง</div>
          : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={{ ...th, textAlign: 'center' }}>ลำดับ</th>
              <th style={{ ...th, textAlign: 'left' }}>พาร์ท</th>
              <th style={{ ...th, textAlign: 'right' }}>จำนวน</th>
              <th style={{ ...th, textAlign: 'right' }}>เวลาผลิต</th>
              <th style={{ ...th, textAlign: 'left' }}>ลงกะ</th>
              <th style={{ ...th, textAlign: 'left' }}>เครื่อง</th>
              <th style={{ ...th, textAlign: 'left' }}>แม่พิมพ์</th>
              <th style={{ ...th, textAlign: 'left' }}>สถานะ</th>
              {mayWrite && <th style={{ ...th, textAlign: 'center' }}>จัดการ</th>}
            </tr></thead>
            <tbody>
              {rec.rows.map((r, i) => {
                const l = r.lot;
                const die = dieOf(l);
                return (
                  <tr key={l.id} style={{ borderTop: '1px solid var(--border)', opacity: l.status === 'cancelled' ? 0.45 : 1 }}>
                    <td style={{ ...td, textAlign: 'center', fontWeight: 800 }}>{l.seq}</td>
                    <td style={td}>
                      <MatLabel mat={l.mat_no} size={12} />
                      {customerOf(l.mat_no) && <span style={{ color: 'var(--muted)', fontSize: 11 }}> · {customerOf(l.mat_no)}</span>}
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      {mayWrite && l.status === 'planned' ? (
                        <input type="number" min="1" value={l.qty_plan}
                          onChange={e => patch(l.id, { qty_plan: Math.max(1, Number(e.target.value) || 1) })}
                          style={{ width: 84, textAlign: 'right' }} />
                      ) : <b>{qtyText(l.qty_plan)}</b>}
                      {/* 🧩 ยอดจริงมาจาก **ผลรวมใบคัมบังของพาร์ทนั้น** ไม่ใช่ใบเดียว (ดู planLots.js) */}
                      {r.state !== 'pending' && (
                        <div style={{ fontSize: 11, color: r.state === 'done' ? 'var(--accent)' : '#f59e0b' }}>
                          ทำได้ {qtyText(r.donePcs)}{r.pct != null ? ` · ${r.pct}%` : ''}
                          {r.fromOrders > 0 && <span style={{ color: 'var(--muted)' }}> (จาก {r.fromOrders} ใบ)</span>}
                        </div>
                      )}
                    </td>
                    <td style={{ ...td, textAlign: 'right', color: 'var(--text2)' }}>{fmtMin(lotRunMin(l, ctOf))}</td>
                    {/* 🔗 กะที่งานใบนี้ตกไปอยู่ — "—" = ยังตอบไม่ได้ **ไม่ใช่กะแรก** */}
                    <td style={td}>{(() => {
                      const at = landingOf[l.id];
                      if (!at || at.overflow) return <span style={{ color: '#ef4444' }} title="งานล้นเลยขอบเขตที่วางแผนไว้ — ยังไม่มีที่ลง">🚨 ล้นขอบเขต</span>;
                      if (!at.sure) return <span style={{ color: '#f59e0b' }} title="เวลาเชื่อไม่ได้ (ไม่มี CT หรือมีล็อตที่ไม่มี CT อยู่ก่อนหน้า) — บันทึกแล้วจะคงกะเดิมไว้">⚠ ยังจัดไม่ได้</span>;
                      const same = at.workDate === l.work_date && at.shift === l.shift;
                      return (
                        <span style={{ color: same ? 'var(--text2)' : 'var(--accent)' }}
                          title={same ? 'ตรงกับที่บันทึกไว้' : `จะถูกย้ายจาก ${l.shift === 'night' ? 'กะดึก' : 'กะเช้า'} ${l.work_date} ตอนกดบันทึก`}>
                          {SHIFT_LABEL[at.shift]} {at.workDate.slice(8)}/{at.workDate.slice(5, 7)}{same ? '' : ' ✧'}
                        </span>
                      );
                    })()}</td>
                    <td style={td}>
                      {mayWrite && l.status === 'planned' ? (
                        <MachineSelect value={l.machine_no || ''} lines={[lineName]}
                          onChange={(v) => patch(l.id, { machine_no: v ? snapMachineNo(v) : null })}
                          inputStyle={{ width: 150, fontSize: 12 }} />
                      ) : (l.machine_no || <span style={{ color: 'var(--muted)' }}>—</span>)}
                    </td>
                    <td style={td}>
                      {mayWrite && l.status === 'planned' ? (
                        <select value={l.die_no || ''} onChange={e => patch(l.id, { die_no: e.target.value || null })} style={{ fontSize: 12, maxWidth: 170 }}>
                          <option value="">— ไม่ระบุ —</option>
                          {dieOptsForMat(l.mat_no).map(d => <option key={d.id} value={d.set_code}>{d.set_code}</option>)}
                        </select>
                      ) : (l.die_no || <span style={{ color: 'var(--muted)' }}>—</span>)}
                      {die && <div style={{ fontSize: 10.5, color: die.die_height_mm == null ? '#f59e0b' : 'var(--muted)' }}>
                        {die.die_height_mm == null ? '⚠ ไม่รู้ความสูง' : `สูง ${die.die_height_mm} มม.`}</div>}
                    </td>
                    <td style={td}>
                      {l.status === 'cancelled' ? <span style={{ color: '#ef4444' }}>✕ ยกเลิก</span>
                        : r.state === 'done' ? <span style={{ color: 'var(--accent)' }}>✓ ครบตามกรอบ</span>
                        : r.state === 'partial' ? <span style={{ color: '#4d9fff' }}>▶ กำลังทำ</span>
                        : <span style={{ color: 'var(--muted)' }}>ยังไม่เริ่ม</span>}
                      {l.cancel_reason && <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{l.cancel_reason}</div>}
                    </td>
                    {mayWrite && (
                      <td style={{ ...td, textAlign: 'center' }}>
                        {l.status === 'planned' && (
                          <>
                            <button onClick={() => { setLots(moveLot(lots, l.id, -1)); setDirty(true); }} disabled={i === 0} title="เลื่อนขึ้น">↑</button>
                            <button onClick={() => { setLots(moveLot(lots, l.id, 1)); setDirty(true); }} disabled={i === rec.rows.length - 1} title="เลื่อนลง">↓</button>
                            <button onClick={() => cancelLot(l)} title="ยกเลิกล็อตนี้ (เก็บเป็นประวัติ)">✕</button>
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── ของจริงที่อยู่นอกกรอบแผน — ต้องเห็น ห้ามกลืน (Layer 2 ไม่ได้ผิด แค่ต่างจากกรอบ) ── */}
      {(rec.offPlan.length > 0 || rec.over.length > 0) && (
        <div style={{ ...card, borderColor: '#f59e0b66' }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#f59e0b', marginBottom: 5 }}>
            ⚠️ ของจริงที่อยู่นอกกรอบแผน
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 12 }}>
            {[...rec.over.map(o => ({ ...o, kind: 'over' })), ...rec.offPlan.map(o => ({ ...o, kind: 'off' }))].slice(0, 15).map(o => (
              <span key={`${o.kind}-${o.mat_no}`} style={{ color: 'var(--text2)' }}>
                {o.kind === 'over' ? '➕' : '🆕'} <MatLabel mat={o.mat_no} size={11.5} />{' '}
                <span style={{ color: 'var(--muted)' }}>
                  {qtyText(o.pcs)} ชิ้น · {o.orders} ใบ{o.kind === 'over' ? ' (เกินกรอบ)' : ' (ไม่มีในแผน)'}
                </span>
              </span>
            ))}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            ➕ ทำเกินยอดที่วางไว้ · 🆕 พาร์ทที่ผลิตจริงแต่ไม่มีในแผน — <b>ไม่ใช่ความผิดของหน้างาน</b> แต่วางแผนต้องรู้
          </div>
        </div>
      )}

      {/* ── ความต้องการที่ยังไม่ได้วางแผน ── */}
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>
          📥 ความต้องการของไลน์นี้ที่ยังไม่ได้วางแผน <span style={{ color: 'var(--muted)', fontWeight: 600, fontSize: 11.5 }}>(ค้างส่ง + ถึงกำหนดภายใน {lastDate})</span>
        </div>
        {unplanned.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>— วางแผนครบทุกพาร์ทที่มีความต้องการแล้ว —</div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {unplanned.slice(0, 24).map(u => (
              <div key={u.mat} style={{ border: '1px solid var(--border2)', borderRadius: 6, padding: '5px 9px', display: 'flex', alignItems: 'baseline', gap: 7 }}>
                <MatLabel mat={u.mat} size={12} />
                <b style={{ fontSize: 12 }}>{u.qty.toLocaleString()}</b>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>ชิ้น</span>
                {mayWrite && <button onClick={() => addLot(u.mat, u.qty)} style={{ fontSize: 11 }}>+ เข้าแผน</button>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
