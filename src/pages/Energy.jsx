/* ⚡ พลังงานไฟฟ้า + 🌱 คาร์บอน (เฟส 1 + C1)
   ที่มา: ทีมสรุปว่า "show ค่า kWh บริเวณ Line บนผังก่อน · Phase แรกขอ Input รายเดือน"
   → หน้านี้ = "ป้อนข้อมูล + วิเคราะห์" ส่วนภาพพรีเซนต์อยู่ที่ /factory-map (metric ⚡ พลังงาน)

   ── ปรับใหญ่ 2026-08-19 ตาม feedback user ────────────────────────────────
   (1) "หน้ากรอกต้องแยกส่วน · ตอนนี้ยังไม่มีมิเตอร์รายไลน์ · ส่วนใหญ่ดูจาก main ที่ utility
        แล้วค่อย total ทั้งโรงงานเป็น sum cumulate ขึ้นมา"
       → แยก 3 ชั้น: ทั้งโรงงาน(บิล) / จุดที่มีมิเตอร์(กรอกจริง) / จุดที่ยังไม่มีมิเตอร์(พับไว้)
       → "ผลรวมที่วัดได้" คำนวณขึ้นมาจากจุดที่มีมิเตอร์ · ส่วนต่างจากบิล = ที่ยังไม่ได้แยกมิเตอร์
         **ไม่ใช่ error** (ของเดิมเตือน -85.1% ทั้งที่กรอกครบทุกจุดที่วัดได้แล้ว = เตือนผิดที่)
   (2) "หน้าสรุปอ่อนมาก ไม่มีกราฟเปรียบเทียบ" → แท็บสรุปทำใหม่ทั้งหมด (ดู §สรุป ด้านล่าง)
   (3) C1 คาร์บอน — kWh → tCO2e ผ่าน EF ที่ตั้งได้เอง (Scope 2)

   ⚠️ ไฟฟ้าอย่างเดียว · ค่ากรอกมือต้องติดป้ายที่มาเสมอ
   ⚠️ สูตรทั้งหมดอยู่ src/utils/energy.js — ห้ามคำนวณเองในไฟล์นี้ */
import { useState, useEffect, useMemo, useContext, useCallback } from 'react';
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, Cell, ReferenceLine,
} from 'recharts';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from '../components/Toast';
import { can } from '../utils/permissions';
import { inSectionScope } from '../utils/sectionScope';
import { getLineFamilyNames } from '../utils/lineHierarchy';
import PageHeader from '../components/PageHeader';
import useTabParam from '../utils/useTabParam';
import {
  monthKeyOf, shiftMonth, monthLabel, fmtKwh, fmtBaht, deltaPct,
  bahtPerUnit, RATE_SANE_MIN, RATE_SANE_MAX, sumRows,
  efFor, co2eKg, fmtTco2e, monthRange, changeContribution, meteredCoverage,
  secOf, co2ePerPiece, PIECE_BASIS_LABEL,
} from '../utils/energy';
import { collapseOps } from '../utils/pairTotals';
import { loadOpInfo, opInfoSync } from '../utils/opItems';

const inp = { width: '100%', padding: '7px 9px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' };
const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 };
const th = { textAlign: 'left', fontSize: 11.5, color: 'var(--muted)', fontWeight: 700, padding: '7px 8px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };
const td = { padding: '5px 8px', borderBottom: '1px solid var(--border)', fontSize: 12.5 };
const secTitle = { fontSize: 13, fontWeight: 800, color: 'var(--text)', margin: '0 0 8px' };

const TREND_MONTHS = 12;
const GOOD = '#22c55e', BAD = '#ef4444', NEUTRAL = '#6b7f8c', ACCENT = '#38bdf8';

export default function Energy() {
  const { role, lineId, sections: scopeSecs } = useContext(UserContext);
  const canEdit = can('energy', 'record', role);
  const [tab, setTab] = useTabParam(['input', 'summary', 'setup'], 'input');
  const [month, setMonth] = useState(() => monthKeyOf());
  const [lines, setLines] = useState([]);
  const [zones, setZones] = useState([]);
  const [pointCfg, setPointCfg] = useState([]);   // energy_points (is_metered)
  const [supply, setSupply] = useState({});       // zone → [ไลน์ที่ utility นี้จ่ายให้]
  const [hist, setHist] = useState([]);           // energy_monthly ย้อนหลัง TREND_MONTHS เดือน
  const [factors, setFactors] = useState([]);     // energy_emission_factors
  const [loading, setLoading] = useState(true);
  const [cfgMissing, setCfgMissing] = useState(false);  // ยังไม่ apply migration C1
  const [showUnmetered, setShowUnmetered] = useState(false);
  const [prod, setProd] = useState(null);   // month → ชิ้นที่ผลิตได้ทั้งโรงงาน (null = ยังไม่โหลด)
  const [prodErr, setProdErr] = useState('');

  /* ── scope มาตรฐาน: leader = family ไลน์ตัวเอง · role อื่น = ตาม sections ── */
  const scopedLines = useMemo(() => {
    if (role === 'leader' && lineId) {
      const me = lines.find(l => l.id === lineId);
      const fam = me ? getLineFamilyNames(lines, me.name) : null;
      return fam ? lines.filter(l => fam.includes(l.name)) : lines;
    }
    if (scopeSecs?.length) return lines.filter(l => inSectionScope(scopeSecs, l.section));
    return lines;
  }, [lines, role, lineId, scopeSecs]);

  // จุดที่กรอกได้ = ไลน์บนสุด (พลังงานวัดกันระดับกลุ่ม) + โซน facility
  const points = useMemo(() => ([
    ...scopedLines.filter(l => !l.parent_line_name).map(l => ({ kind: 'line', name: l.name, section: l.section })),
    ...zones.map(z => ({ kind: 'zone', name: z, section: null })),
  ]), [scopedLines, zones]);

  const load = useCallback(async () => {
    setLoading(true);
    const months = monthRange(month, TREND_MONTHS);
    const [{ data: ln }, { data: areas }, { data: facMc }, { data: h }] = await Promise.all([
      supabase.from('production_lines').select('id, name, section, parent_line_name').order('name'),
      supabaseDR.from('pm_facility_areas').select('name').order('name'),
      supabaseDR.from('machines').select('id, line_name').eq('equipment_category', 'facility').eq('is_active', true),
      supabaseDR.from('energy_monthly').select('*').eq('utility', 'electric')
        .gte('month_key', months[0]).lte('month_key', months[months.length - 1]),
    ]);
    setLines(ln || []);
    const zs = new Set([...(areas || []).map(a => a.name), ...(facMc || []).map(m => m.line_name)].filter(Boolean));
    setZones([...zs].sort());
    setHist(h || []);

    // ⚠️ ตาราง C1 อาจยังไม่ apply — โหลดแยก best-effort ห้ามให้ทั้งหน้าพัง
    const [{ data: pc, error: pcErr }, { data: ef }] = await Promise.all([
      supabaseDR.from('energy_points').select('*'),
      supabaseDR.from('energy_emission_factors').select('*').order('effective_from'),
    ]);
    setCfgMissing(!!pcErr);
    setPointCfg(pc || []);
    setFactors(ef || []);

    // "utility นี้จ่ายให้ไลน์ไหน" — ของจริงอยู่ facility_supply_links (ห้ามเก็บซ้ำที่อื่น)
    const { data: sl } = await supabaseDR.from('facility_supply_links').select('machine_id, line_name');
    const zoneOfMachine = Object.fromEntries((facMc || []).map(m => [m.id, m.line_name]));
    const sup = {};
    (sl || []).forEach(l => {
      const z = zoneOfMachine[l.machine_id];
      if (!z || !l.line_name) return;
      (sup[z] ||= new Set()).add(l.line_name);
    });
    setSupply(Object.fromEntries(Object.entries(sup).map(([k, v]) => [k, [...v].sort()])));
    setLoading(false);
  }, [month]);
  useEffect(() => { load(); }, [load]);

  /* ── ยอดผลิตทั้งโรงงาน รายเดือน (สำหรับ SEC / kgCO2e ต่อชิ้น) ──────────────
     ⚠️ โหลดเฉพาะตอนเปิดแท็บสรุป — ใบงาน 12 เดือนเป็นหลักพันแถว ไม่ควรดึงตอนคนแค่มากรอกหน่วยไฟ
        (กฎ egress: จอที่ไม่ได้ใช้ข้อมูลนี้ ห้ามจ่ายค่าดึง)
     ⚠️ `prod_orders` **ไม่มีคอลัมน์ work_date/line_name** — ต้อง embed production_sessions!inner
        และเช็ค error เสมอ (select ตรงจะได้ 42703 แล้วเงียบถ้าดึงแค่ data)
     ⚠️ ต้อง paginate — Supabase ตัดที่ 1000 แถว ไม่ตัดแบบมี error (หายเงียบ = SEC สูงเกินจริง)
     ⚠️ **ไม่ scope ตามไลน์โดยตั้งใจ** — ตัวหารต้องครอบเท่ากับตัวตั้ง (บิลทั้งโรงงาน)
        เอาไฟทั้งโรงงานหารด้วยชิ้นของบางไลน์ = ตัวเลขขยะ · จอติดป้าย "ทั้งโรงงาน" กำกับไว้ */
  const loadProduction = useCallback(async () => {
    setProdErr('');
    const ms = monthRange(month, TREND_MONTHS);
    const from = `${ms[0]}-01`;
    const [ey, em] = ms[ms.length - 1].split('-').map(Number);
    const to = `${ms[ms.length - 1]}-${String(new Date(ey, em, 0).getDate()).padStart(2, '0')}`;
    await loadOpInfo();
    const PAGE = 1000;
    const all = [];
    for (let page = 0; page < 20; page++) {
      const { data, error } = await supabaseDR.from('prod_orders')
        .select('mat_no, qty, qty_ok, qty_actual, status, production_sessions!inner(work_date)')
        .gte('production_sessions.work_date', from).lte('production_sessions.work_date', to)
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) { setProdErr(error.message); setProd({}); return }
      all.push(...(data || []));
      if ((data || []).length < PAGE) break;
      if (page === 19) setProdErr('ใบงานเกิน 20,000 แถว — ตัวเลขอาจไม่ครบ');  // ห้ามตัดเงียบ
    }
    // ต่อเดือน: รวมยอดต่อ MAT → collapseOps (ยุบขั้นตอน) → บวกดิบ = **ชิ้นจริง** (ไม่ผ่าน pairAware)
    const opMap = opInfoSync();
    const perMonth = {};
    for (const o of all) {
      const wd = o.production_sessions?.work_date;
      if (!wd) continue;
      const mk = String(wd).slice(0, 7);
      // "ผลิตได้" สูตรมาตรฐานของระบบ: ปิดใบแล้ว = qty_ok ?? qty · ยังเปิด = qty_actual ?? 0
      const v = o.status === 'confirmed' ? Number(o.qty_ok ?? o.qty ?? 0) : Number(o.qty_actual ?? 0);
      if (!v) continue;
      const bucket = (perMonth[mk] ||= {});
      const k = o.mat_no ?? '__null__';
      (bucket[k] ||= { mat_no: o.mat_no ?? null, target: 0, produced: 0 }).produced += v;
    }
    const out = {};
    for (const [mk, bucket] of Object.entries(perMonth)) {
      out[mk] = collapseOps(Object.values(bucket), opMap)
        .reduce((s, r) => s + (Number(r.produced) || 0), 0);
    }
    setProd(out);
  }, [month]);
  useEffect(() => { if (tab === 'summary' && prod == null) loadProduction(); }, [tab, prod, loadProduction]);
  useEffect(() => { setProd(null); }, [month]);   // เปลี่ยนเดือน = ช่วงเปลี่ยน ต้องโหลดใหม่

  /* ── index ข้อมูลย้อนหลัง: month → key → row ── */
  const keyOf = (p) => `${p.kind}::${p.name}`;
  const byMonth = useMemo(() => {
    const m = {};
    for (const r of hist) (m[r.month_key] ||= {})[`${r.scope_kind}::${r.scope_name}`] = r;
    return m;
  }, [hist]);
  const prevMonth = shiftMonth(month, -1);
  const yoyMonth = shiftMonth(month, -12);
  const byKey = byMonth[month] || {};
  const prevByKey = byMonth[prevMonth] || {};

  /* ── ชั้นของจุด: มีมิเตอร์ / ยังไม่มี (energy_points.is_metered) ── */
  const meteredSet = useMemo(() => new Set(
    (pointCfg || []).filter(c => c.is_metered).map(c => `${c.scope_kind}::${c.scope_name}`)
  ), [pointCfg]);
  const meteredPts = useMemo(() => points.filter(p => meteredSet.has(`${p.kind}::${p.name}`)), [points, meteredSet]);
  const otherPts = useMemo(() => points.filter(p => !meteredSet.has(`${p.kind}::${p.name}`)), [points, meteredSet]);

  /* ── ยอดรวม: "ที่วัดได้" = sum ของจุดที่มีมิเตอร์ (cumulate ขึ้นมา) ── */
  const sumOf = (pts, mk) => sumRows(pts.map(p => (byMonth[mk] || {})[keyOf(p)]).filter(Boolean));
  const metered = sumOf(meteredPts, month);
  const meteredPrev = sumOf(meteredPts, prevMonth);
  const bill = byKey['plant::PLANT'];
  const billPrev = prevByKey['plant::PLANT'];
  const billYoy = (byMonth[yoyMonth] || {})['plant::PLANT'];
  const cover = meteredCoverage(metered.qty, bill?.qty);

  /* ── คาร์บอน (C1) — Scope 2 จากไฟฟ้า ── */
  const ef = efFor('electric', month, factors);
  const efPrev = efFor('electric', prevMonth, factors);
  // ยึด "ยอดบิลทั้งโรงงาน" เป็นฐาน CFO — ครอบทั้งโรงงานจริง (ผลรวมรายจุดยังไม่ครบ)
  const co2Base = bill?.qty ?? metered.qty;
  const co2BasePrev = billPrev?.qty ?? meteredPrev.qty;
  const co2 = co2eKg(co2Base, ef);
  const co2Prev = co2eKg(co2BasePrev, efPrev);
  const usingBill = bill?.qty != null;

  /* ── SEC (kWh/ชิ้น) + carbon intensity — ผูกพลังงานกับยอดผลิต
     ⚠️ ตัวหารเป็น "ชิ้นจริง" (งานคู่ LH/RH = 2) ต่างจากจอผลิตที่นับ stroke → ต้องติดป้ายกำกับเสมอ */
  const pieces = prod?.[month] ?? null;
  const piecesPrev = prod?.[prevMonth] ?? null;
  const sec = secOf(co2Base, pieces);
  const secPrev = secOf(co2BasePrev, piecesPrev);
  const secDelta = deltaPct(sec, secPrev);
  const kgPerPiece = co2ePerPiece(co2, pieces);

  /* บันทึกทีละช่อง (upsert) — กรอกแล้วเซฟเลย เหมือนหน้ากรอกอื่นในระบบ */
  const saveCell = async (p, patch) => {
    if (!canEdit) return;
    const k = keyOf(p), old = byKey[k];
    const payload = {
      scope_kind: p.kind, scope_name: p.name, month_key: month, utility: 'electric',
      qty: old?.qty ?? null, cost: old?.cost ?? null, source: old?.source || 'manual', note: old?.note ?? null,
      ...patch,
    };
    if (payload.qty == null && payload.cost == null && !payload.note) {
      if (old?.id) { await supabaseDR.from('energy_monthly').delete().eq('id', old.id); load(); }
      return;
    }
    const { error } = await supabaseDR.from('energy_monthly')
      .upsert(payload, { onConflict: 'scope_kind,scope_name,month_key,utility' });
    if (error) return toast.error(error.message);
    load();
  };
  const numOrNull = (v) => (String(v).trim() === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));

  /* ติ๊กว่าจุดนี้มีมิเตอร์ — เปลี่ยนชั้นของจุด (ไม่แตะค่าที่กรอกไว้) */
  const toggleMeter = async (p, on) => {
    if (!canEdit) return;
    const { error } = await supabaseDR.from('energy_points')
      .upsert({ scope_kind: p.kind, scope_name: p.name, is_metered: on }, { onConflict: 'scope_kind,scope_name' });
    // ห้ามเงียบ: ยังไม่ apply migration ต้องบอกให้ชัดว่าทำไมกดแล้วไม่เปลี่ยน
    if (error) return toast.error(error.code === '42P01'
      ? 'ยังตั้งชั้นจุดวัดไม่ได้ — ยังไม่ได้ apply migration 20260819_energy_carbon_c1 (แจ้ง admin)'
      : error.message);
    load();
  };

  /* ═══ ข้อมูลสำหรับแท็บสรุป ═══ */
  const months = useMemo(() => monthRange(month, TREND_MONTHS), [month]);

  /** เทรนด์รายเดือน: บิลทั้งโรงงาน · ผลรวมที่วัดได้ · tCO2e · เทียบปีก่อนเดือนเดียวกัน */
  const trend = useMemo(() => months.map(mk => {
    const mm = byMonth[mk] || {};
    const b = mm['plant::PLANT']?.qty ?? null;
    const met = sumRows(meteredPts.map(p => mm[keyOf(p)]).filter(Boolean)).qty;
    const base = b ?? met;
    const e = efFor('electric', mk, factors);
    const ly = (byMonth[shiftMonth(mk, -12)] || {})['plant::PLANT']?.qty ?? null;
    return {
      mk, label: monthLabel(mk).replace(/ 25/, ' '),
      bill: b, metered: met,
      tco2e: co2eKg(base, e) == null ? null : Math.round(co2eKg(base, e) / 100) / 10,
      lastYear: ly,
      pieces: prod?.[mk] ?? null,
      sec: secOf(base, prod?.[mk]),
    };
  }), [months, byMonth, meteredPts, factors, prod]);
  const hasTrend = trend.some(t => t.bill != null || t.metered != null);
  const hasYoy = trend.some(t => t.lastYear != null);

  /** "อะไรทำให้เดือนนี้เปลี่ยน" — แตกส่วนต่างลงรายจุด (กราฟเรียงยอดตอบข้อนี้ไม่ได้) */
  const contrib = useMemo(() => changeContribution(
    points.map(p => ({
      key: keyOf(p), label: p.name,
      cur: byKey[keyOf(p)]?.qty ?? null, prev: prevByKey[keyOf(p)]?.qty ?? null,
    }))
  ), [points, byKey, prevByKey]);
  const contribRows = contrib.rows.filter(r => r.delta !== 0).slice(0, 10);

  /** สัดส่วนการใช้รายจุด 6 เดือนล่าสุด — เห็นโครงสร้างเปลี่ยน ไม่ใช่แค่ยอดรวมเปลี่ยน */
  const compPts = useMemo(() => {
    const tot = {};
    for (const p of points) {
      const s = months.reduce((a, mk) => a + Number((byMonth[mk] || {})[keyOf(p)]?.qty || 0), 0);
      if (s > 0) tot[keyOf(p)] = { p, s };
    }
    return Object.values(tot).sort((a, b) => b.s - a.s).slice(0, 6).map(x => x.p);
  }, [points, months, byMonth]);
  const compData = useMemo(() => months.slice(-6).map(mk => {
    const mm = byMonth[mk] || {};
    const d = { label: monthLabel(mk).replace(/ 25/, ' ') };
    compPts.forEach(p => { d[p.name] = mm[keyOf(p)]?.qty ?? 0; });
    return d;
  }), [months, byMonth, compPts]);

  const Kpi = ({ label, value, sub, tone, warn }) => (
    <div style={{ ...card, flex: '1 1 190px', minWidth: 170, borderColor: warn ? '#f59e0b' : 'var(--border)' }}>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: tone || 'var(--text)', marginTop: 3 }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
  const deltaChip = (d) => d == null ? <span style={{ color: 'var(--muted)' }}>—</span>
    : <span style={{ color: d <= -5 ? GOOD : d > 10 ? BAD : 'var(--text2)', fontWeight: 700 }}>{d > 0 ? '+' : ''}{d}%</span>;
  const tipStyle = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 };

  /* ── แถวกรอก 1 จุด (ใช้ทั้ง 3 ชั้น)
     ⚠️ ห่อด้วย useCallback ไม่พอ — component ที่นิยามในตัว render จะถูก **remount ทุกครั้งที่ parent render**
        (identity ของ function เปลี่ยน) ทำให้ช่อง input ที่กำลังพิมพ์อยู่ถูกรีเซ็ตกลางคัน
        จึงเรียกเป็นฟังก์ชันธรรมดา `{row(...)}` ไม่ใช่ JSX element `<Row/>` — React มองเป็น element
        ของ parent ตรงๆ ไม่มีการ mount/unmount subtree ใหม่ */
  const row = ({ p, label, isPlant }) => {
    const k = isPlant ? 'plant::PLANT' : keyOf(p);
    const r = byKey[k], pr = prevByKey[k];
    const d = deltaPct(r?.qty, pr?.qty);
    const rate = bahtPerUnit(r?.cost, r?.qty);
    const rateOdd = rate != null && (rate < RATE_SANE_MIN || rate > RATE_SANE_MAX);
    const feeds = !isPlant && p.kind === 'zone' ? supply[p.name] : null;
    const target = isPlant ? { kind: 'plant', name: 'PLANT' } : p;
    return (
      <tr key={k} style={isPlant ? { background: 'var(--bg3)' } : null}>
        <td style={{ ...td, fontWeight: isPlant ? 800 : 600 }}>
          {label}
          {p?.section && <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 11 }}> · {p.section}</span>}
          {/* "utility นี้จ่ายให้ไลน์ไหน" — อ่านจาก Supply route ที่ตั้งไว้ในฐานข้อมูลเครื่องจักร
              ยังไม่ได้ตั้ง = บอกให้รู้ ห้ามแสดงเป็นช่องว่างเฉยๆ (คนจะนึกว่าไม่มีความสัมพันธ์) */}
          {!isPlant && p.kind === 'zone' && (
            feeds?.length > 0 ? (
              <div style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 400, marginTop: 2 }}
                title="จาก Supply route (ฐานข้อมูลเครื่องจักร → เครื่อง facility → 🔗 Supply route)">
                จ่ายให้: {feeds.slice(0, 4).join(', ')}{feeds.length > 4 ? ` +${feeds.length - 4}` : ''}
              </div>
            ) : (
              <div style={{ fontSize: 10.5, color: '#f59e0b', fontWeight: 400, marginTop: 2 }}
                title="ตั้งที่ /machine-database → แก้เครื่อง facility → แผง 🔗 Supply route">
                ⚠ ยังไม่ได้ตั้งว่าจ่ายให้ไลน์ไหน
              </div>
            )
          )}
        </td>
        <td style={td}><input type="number" defaultValue={r?.qty ?? ''} readOnly={!canEdit} placeholder="—"
          onBlur={e => { const v = numOrNull(e.target.value); if (v !== (r?.qty ?? null)) saveCell(target, { qty: v }); }}
          style={{ ...inp, width: 108, ...(canEdit ? null : { background: 'var(--bg2)' }) }} /></td>
        <td style={td}><input type="number" defaultValue={r?.cost ?? ''} readOnly={!canEdit} placeholder="—"
          onBlur={e => { const v = numOrNull(e.target.value); if (v !== (r?.cost ?? null)) saveCell(target, { cost: v }); }}
          style={{ ...inp, width: 108, ...(canEdit ? null : { background: 'var(--bg2)' }) }} /></td>
        <td style={{ ...td, color: rateOdd ? '#f59e0b' : 'var(--text2)', fontWeight: rateOdd ? 700 : 400 }}
          title={rateOdd ? 'ผิดปกติ — ปกติ 3.5-5 บาท/kWh ลองตรวจว่ากรอกผิดหลักไหม' : ''}>
          {rate ?? '—'}{rateOdd ? ' ⚠' : ''}</td>
        <td style={td}>{deltaChip(d)}</td>
        <td style={td}>
          <select value={r?.source || 'manual'} disabled={!canEdit || !r}
            onChange={e => saveCell(target, { source: e.target.value })} style={{ ...inp, width: 112 }}>
            <option value="manual">✍️ กรอกมือ</option>
            <option value="meter">🔌 จากมิเตอร์</option>
            <option value="estimated">≈ ประมาณการ</option>
          </select></td>
        <td style={td}><input defaultValue={r?.note ?? ''} readOnly={!canEdit} placeholder="—"
          onBlur={e => { const v = e.target.value.trim() || null; if (v !== (r?.note ?? null)) saveCell(target, { note: v }); }}
          style={{ ...inp, minWidth: 130, ...(canEdit ? null : { background: 'var(--bg2)' }) }} /></td>
        {!isPlant && (
          <td style={{ ...td, textAlign: 'center' }}>
            <button onClick={() => toggleMeter(p, !meteredSet.has(keyOf(p)))} disabled={!canEdit}
              title={meteredSet.has(keyOf(p)) ? 'มีมิเตอร์ — นับเข้าผลรวมที่วัดได้' : 'ยังไม่มีมิเตอร์ — กดเพื่อย้ายไปกลุ่มที่วัดได้'}
              style={{ padding: '4px 9px', borderRadius: 6, fontSize: 11.5, fontWeight: 700, cursor: canEdit ? 'pointer' : 'default',
                border: '1px solid var(--border2)', background: 'var(--bg3)', color: meteredSet.has(keyOf(p)) ? GOOD : 'var(--muted)' }}>
              {meteredSet.has(keyOf(p)) ? '🔌 มีมิเตอร์' : '+ มีมิเตอร์'}
            </button>
          </td>
        )}
      </tr>
    );
  };
  const head = (withMeter) => (
    <thead><tr>
      <th style={th}>พื้นที่</th><th style={th}>หน่วย (kWh)</th><th style={th}>ค่าไฟ (บาท)</th>
      <th style={th}>บาท/หน่วย</th><th style={th}>เทียบเดือนก่อน</th><th style={th}>ที่มา</th><th style={th}>หมายเหตุ</th>
      {withMeter && <th style={{ ...th, textAlign: 'center' }}>มิเตอร์</th>}
    </tr></thead>
  );

  return (
    <div style={{ padding: 16, maxWidth: 1400, margin: '0 auto' }}>
      <PageHeader title="พลังงานไฟฟ้า" icon="⚡" sub={`${monthLabel(month)} · เฟส 1 กรอกรายเดือน`}
        tabs={[{ key: 'input', label: '📝 กรอกรายเดือน' }, { key: 'summary', label: '📊 สรุป & วิเคราะห์' }, { key: 'setup', label: '⚙️ ค่าการปล่อย' }]}
        tab={tab} onTab={setTab}
        actions={
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button onClick={() => setMonth(m => shiftMonth(m, -1))} style={{ ...inp, width: 36, cursor: 'pointer' }}>◀</button>
            <input type="month" value={month} max={monthKeyOf()} onChange={e => e.target.value && setMonth(e.target.value)} style={{ ...inp, width: 150 }} />
            <button onClick={() => setMonth(m => shiftMonth(m, 1))} disabled={month >= monthKeyOf()}
              style={{ ...inp, width: 36, cursor: month >= monthKeyOf() ? 'not-allowed' : 'pointer', opacity: month >= monthKeyOf() ? 0.4 : 1 }}>▶</button>
          </div>}
      />

      <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid #f59e0b', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 12.5, color: 'var(--text2)' }}>
        ✍️ <b>เฟส 1 — ตัวเลขมาจากการกรอกมือ</b> ยังไม่ได้ต่อมิเตอร์อัตโนมัติ · ใช้ดูแนวโน้มและเทียบเดือนได้
        แต่ยังไม่ใช่ค่าที่วัดแบบ realtime · ค่าที่กรอกไปแสดงบนผังรวมโรงงาน (metric <b>⚡ พลังงาน</b>)
      </div>

      {cfgMissing && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 12.5 }}>
          ⚠️ <b>ยังไม่ได้ apply migration <code>20260819_energy_carbon_c1</code></b> — ยังตั้งชั้นจุดวัด (มีมิเตอร์/ยังไม่มี)
          และคำนวณ CO2e ไม่ได้ · ส่วนการกรอกหน่วยไฟยังใช้ได้ปกติ (แจ้ง admin ให้รัน migration)
        </div>
      )}

      {/* ── KPI ── */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <Kpi label="ยอดบิลทั้งโรงงาน (kWh)" value={fmtKwh(bill?.qty)}
          sub={<>เทียบเดือนก่อน {deltaChip(deltaPct(bill?.qty, billPrev?.qty))}
            {billYoy?.qty != null && <> · ปีก่อน {deltaChip(deltaPct(bill?.qty, billYoy.qty))}</>}</>} />
        <Kpi label="ผลรวมที่วัดได้ (kWh)" value={fmtKwh(metered.qty)}
          sub={cover.coverPct != null
            ? <>{cover.coverPct}% ของบิล · {metered.filled}/{meteredPts.length} จุดที่มีมิเตอร์</>
            : `${metered.filled}/${meteredPts.length} จุดที่มีมิเตอร์`} />
        <Kpi label="🌱 คาร์บอน (tCO2e)" value={ef ? fmtTco2e(co2) : '—'}
          tone={ef ? '#22c55e' : 'var(--muted)'} warn={!ef}
          sub={ef
            ? <>Scope 2 · {usingBill ? 'จากบิล' : 'จากผลรวมที่วัดได้'} · เทียบเดือนก่อน {deltaChip(deltaPct(co2, co2Prev))}</>
            : <span style={{ color: '#f59e0b' }}>ยังไม่ได้ตั้งค่าการปล่อย → แท็บ ⚙️</span>} />
        <Kpi label="ค่าไฟรวม (บาท)" value={fmtBaht(bill?.cost ?? metered.cost)}
          sub={`บาท/หน่วย ${bahtPerUnit(bill?.cost ?? metered.cost, bill?.qty ?? metered.qty) ?? '—'} (ปกติ 3.5–5)`} />
        {/* ⭐ SEC — ตัวเดียวที่แยก "ผลิตเยอะขึ้น" ออกจาก "ใช้ไฟเปลืองขึ้น" (ยอด kWh ขึ้น ≠ แย่ลง) */}
        <Kpi label="⚙️ kWh ต่อชิ้น (SEC)"
          value={sec == null ? '—' : sec}
          tone={secDelta == null ? undefined : secDelta <= -3 ? GOOD : secDelta > 3 ? BAD : undefined}
          sub={sec == null
            ? (tab === 'summary' ? <span style={{ color: 'var(--muted)' }}>ต้องมียอดผลิต + หน่วยไฟของเดือนนั้น</span>
                                 : <span style={{ color: 'var(--muted)' }}>เปิดแท็บ 📊 เพื่อคำนวณ</span>)
            : <>ผลิต {Math.round(pieces).toLocaleString()} ชิ้น · เทียบเดือนก่อน {deltaChip(secDelta)}</>} />
      </div>

      {/* ⚠️ เตือนเฉพาะ "ผิดจริง" — ผลรวมมากกว่าบิลเป็นไปไม่ได้ · น้อยกว่าบิลคือเรื่องปกติที่ยังไม่ได้ติดมิเตอร์ */}
      {cover.over && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 12.5 }}>
          🔴 <b>ผลรวมรายจุด ({fmtKwh(cover.metered)}) มากกว่ายอดบิล ({fmtKwh(cover.bill)})</b> — เป็นไปไม่ได้
          ตรวจว่ามีจุดที่นับซ้ำ (มิเตอร์แม่กับมิเตอร์ลูกติ๊กว่ามีมิเตอร์ทั้งคู่) หรือกรอกผิดหลัก
        </div>
      )}

      {loading ? <div style={{ color: 'var(--muted)', padding: 20 }}>กำลังโหลด…</div>
        : tab === 'input' ? (
          <>
            {/* ① ทั้งโรงงาน — บิล vs ผลรวมที่วัดได้ vs ส่วนที่ยังไม่ได้แยกมิเตอร์ */}
            <h3 style={secTitle}>🏢 ทั้งโรงงาน</h3>
            <div style={{ ...card, padding: 0, overflowX: 'auto', marginBottom: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
                {head()}
                <tbody>{row({ isPlant: true, label: '🏢 ยอดจากบิลค่าไฟ (PEA)' })}</tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20, fontSize: 12.5 }}>
              <div style={{ ...card, flex: '1 1 220px', padding: 10 }}>
                <div style={{ color: 'var(--muted)', fontSize: 11.5, fontWeight: 700 }}>ผลรวมจากจุดที่มีมิเตอร์</div>
                <div style={{ fontSize: 18, fontWeight: 800 }}>{fmtKwh(metered.qty)} <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--muted)' }}>kWh</span></div>
              </div>
              <div style={{ ...card, flex: '1 1 220px', padding: 10 }}>
                <div style={{ color: 'var(--muted)', fontSize: 11.5, fontWeight: 700 }}>ยังไม่ได้แยกมิเตอร์</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text2)' }}>
                  {cover.unmetered == null ? '—' : fmtKwh(cover.unmetered)}
                  {cover.coverPct != null && <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--muted)' }}> · {Math.round(100 - cover.coverPct)}% ของบิล</span>}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>
                  สำนักงาน · แสงสว่าง · ส่วนกลาง · จุดที่ยังไม่มีมิเตอร์ — <b>ไม่ใช่ข้อผิดพลาด</b>
                </div>
              </div>
            </div>

            {/* ② จุดที่มีมิเตอร์ — ที่กรอกจริง */}
            <h3 style={secTitle}>🔌 จุดที่มีมิเตอร์ ({meteredPts.length}) <span style={{ fontWeight: 400, fontSize: 11.5, color: 'var(--muted)' }}>— รวมขึ้นไปเป็นยอดที่วัดได้</span></h3>
            <div style={{ ...card, padding: 0, overflowX: 'auto', marginBottom: 20 }}>
              {meteredPts.length === 0 ? (
                <div style={{ padding: 14, fontSize: 12.5, color: 'var(--muted)' }}>
                  ยังไม่ได้ระบุว่าจุดไหนมีมิเตอร์ — กดปุ่ม <b>+ มีมิเตอร์</b> ที่แถวของจุดนั้นในตารางด้านล่าง
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
                  {head(true)}
                  <tbody>{meteredPts.map(p => row({ p, label: `${p.kind === 'zone' ? '🔧' : '🏭'} ${p.name}` }))}</tbody>
                </table>
              )}
            </div>

            {/* ③ จุดที่ยังไม่มีมิเตอร์ — พับไว้ ไม่ให้ 13 แถวเปล่ากลบของที่กรอกจริง */}
            <h3 style={{ ...secTitle, display: 'flex', alignItems: 'center', gap: 8 }}>
              🏭 จุดที่ยังไม่มีมิเตอร์ ({otherPts.length})
              <button onClick={() => setShowUnmetered(v => !v)}
                style={{ padding: '3px 10px', borderRadius: 6, fontSize: 11.5, fontWeight: 700, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text2)', cursor: 'pointer' }}>
                {showUnmetered ? '▲ ซ่อน' : '▼ แสดง'}
              </button>
              <span style={{ fontWeight: 400, fontSize: 11.5, color: 'var(--muted)' }}>— กรอกได้ถ้ามีตัวเลข แต่ยังไม่นับเข้าผลรวมที่วัดได้</span>
            </h3>
            {showUnmetered && (
              <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
                  {head(true)}
                  <tbody>{otherPts.map(p => row({ p, label: `${p.kind === 'zone' ? '🔧' : '🏭'} ${p.name}` }))}</tbody>
                </table>
              </div>
            )}
            {!canEdit && <div style={{ padding: 10, fontSize: 12, color: 'var(--muted)' }}>🔒 ไม่มีสิทธิ์กรอก — ดูอย่างเดียว</div>}
          </>
        ) : tab === 'summary' ? (
          <>
            {/* ① เทรนด์ 12 เดือน + เทียบปีก่อน */}
            <div style={{ ...card, marginBottom: 14 }}>
              <div style={secTitle}>📈 แนวโน้ม {TREND_MONTHS} เดือน {hasYoy && <span style={{ fontWeight: 400, fontSize: 11.5, color: 'var(--muted)' }}>— เส้นประ = เดือนเดียวกันปีก่อน</span>}</div>
              {!hasTrend ? <div style={{ color: 'var(--muted)', fontSize: 13 }}>ยังไม่มีข้อมูลในช่วงนี้ — ไปกรอกที่แท็บ 📝</div> : (
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={trend} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                    <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} tickFormatter={fmtKwh} />
                    <Tooltip contentStyle={tipStyle} formatter={(v, n) => [v == null ? '—' : Math.round(v).toLocaleString(), n]} />
                    <Legend wrapperStyle={{ fontSize: 11.5 }} />
                    <Bar dataKey="bill" name="บิลทั้งโรงงาน" fill={ACCENT} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="metered" name="ที่วัดได้จากมิเตอร์" fill={GOOD} radius={[3, 3, 0, 0]} />
                    {hasYoy && <Line type="monotone" dataKey="lastYear" name="ปีก่อน (เดือนเดียวกัน)" stroke="#f59e0b" strokeDasharray="5 4" dot={false} strokeWidth={2} />}
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* ② พลังงานเทียบยอดผลิต (SEC) — "ยอดไฟขึ้น" ต่างจาก "ใช้ไฟเปลืองขึ้น" */}
            <div style={{ ...card, marginBottom: 14 }}>
              <div style={secTitle}>⚙️ พลังงานเทียบยอดผลิต · kWh ต่อชิ้น (SEC)</div>
              {prod == null ? <div style={{ color: 'var(--muted)', fontSize: 13 }}>กำลังรวมยอดผลิต…</div>
                : !trend.some(t => t.sec != null) ? (
                  <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                    ยังคำนวณไม่ได้ — ต้องมีทั้ง <b>หน่วยไฟ</b> และ <b>ยอดผลิต</b> ของเดือนเดียวกัน
                    {prodErr && <div style={{ color: '#f59e0b', marginTop: 4 }}>⚠ ดึงยอดผลิตมีปัญหา: {prodErr}</div>}
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 12.5, color: 'var(--text2)', marginBottom: 8 }}>
                      <b>ยอดไฟขึ้น ≠ แย่ลง</b> — อาจแค่ผลิตเยอะขึ้น · SEC เป็นตัวเดียวที่แยก 2 เรื่องนี้ออกจากกัน:
                      <span style={{ color: GOOD }}> ยอดขึ้น + SEC ลง = ดี</span> ·
                      <span style={{ color: BAD }}> ยอดเท่าเดิม + SEC ขึ้น = มีของรั่ว/เครื่องเสื่อม</span>
                    </div>
                    <ResponsiveContainer width="100%" height={240}>
                      <ComposedChart data={trend} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                        <YAxis yAxisId="l" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickFormatter={v => Math.round(v / 1000) + 'k'} />
                        <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11, fill: '#f59e0b' }} />
                        <Tooltip contentStyle={tipStyle}
                          formatter={(v, n) => [v == null ? '—' : (n === 'kWh ต่อชิ้น (SEC)' ? v : Math.round(v).toLocaleString()), n]} />
                        <Legend wrapperStyle={{ fontSize: 11.5 }} />
                        <Bar yAxisId="l" dataKey="pieces" name="ผลิตได้ (ชิ้น)" fill={NEUTRAL} radius={[3, 3, 0, 0]} />
                        <Line yAxisId="r" type="monotone" dataKey="sec" name="kWh ต่อชิ้น (SEC)" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
                      <span>📏 <b>{PIECE_BASIS_LABEL}</b> — ต่างจากจอผลิตที่นับเป็น stroke (1 ปั๊ม = 1)</span>
                      {kgPerPiece != null && <span>🌱 คาร์บอนต่อชิ้น <b>{kgPerPiece}</b> kgCO2e (ช่วง gate-to-gate เท่านั้น ยังไม่รวมวัสดุที่ซื้อเข้ามา)</span>}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>
                      ⚠️ ระดับ<b>ทั้งโรงงาน</b>เท่านั้น (ไฟทั้งโรงงาน ÷ ชิ้นทั้งโรงงาน) — แยกรายไลน์/รายพาร์ทต้องรอมิเตอร์รายไลน์
                    </div>
                  </>
                )}
            </div>

            {/* ③ อะไรทำให้เดือนนี้เปลี่ยน — คำถามที่กราฟเรียงยอดตอบไม่ได้ */}
            <div style={{ ...card, marginBottom: 14 }}>
              <div style={secTitle}>
                🔍 อะไรทำให้เดือนนี้เปลี่ยน · {monthLabel(month)} เทียบ {monthLabel(prevMonth)}
              </div>
              {!contribRows.length ? (
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>ยังไม่มีเดือนก่อนให้เทียบ หรือไม่มีจุดไหนเปลี่ยน</div>
              ) : (
                <>
                  <div style={{ fontSize: 12.5, color: 'var(--text2)', marginBottom: 8 }}>
                    <b>เฉพาะจุดที่มีตัวเลข</b> เปลี่ยนรวม <b style={{ color: contrib.total.delta > 0 ? BAD : GOOD }}>
                      {contrib.total.delta > 0 ? '+' : ''}{Math.round(contrib.total.delta).toLocaleString()} kWh
                    </b> ({deltaChip(contrib.total.pct)})
                    {bill?.qty != null && billPrev?.qty != null && (
                      <> · ขณะที่ <b>บิลทั้งโรงงาน</b> เปลี่ยน <b>{(bill.qty - billPrev.qty) > 0 ? '+' : ''}{Math.round(bill.qty - billPrev.qty).toLocaleString()} kWh</b> ({deltaChip(deltaPct(bill.qty, billPrev.qty))})</>
                    )}
                    <div style={{ color: 'var(--muted)', marginTop: 3 }}>
                      เรียงตาม<b>ขนาดผลกระทบ</b> ไม่ใช่ยอดใช้ — จุดที่ใช้ไฟเยอะที่สุด ไม่จำเป็นต้องเป็นตัวที่ทำให้บิลขึ้น
                      {cover.coverPct != null && cover.coverPct < 90 && <> · ส่วนที่ยังไม่ได้แยกมิเตอร์ ({Math.round(100 - cover.coverPct)}% ของบิล) <b>อธิบายด้วยตารางนี้ไม่ได้</b></>}
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={Math.max(140, contribRows.length * 30 + 30)}>
                    <BarChart data={contribRows} layout="vertical" margin={{ top: 4, right: 60, left: 8, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickFormatter={v => Math.round(v).toLocaleString()} />
                      <YAxis type="category" dataKey="label" width={130} tick={{ fontSize: 11, fill: 'var(--text2)' }} />
                      <Tooltip contentStyle={tipStyle}
                        formatter={(v, n, o) => [`${v > 0 ? '+' : ''}${Math.round(v).toLocaleString()} kWh (${o.payload.pct == null ? 'จุดใหม่' : `${o.payload.pct > 0 ? '+' : ''}${o.payload.pct}%`})`, 'ส่วนต่าง']} />
                      <ReferenceLine x={0} stroke="var(--border2)" />
                      <Bar dataKey="delta" radius={[0, 3, 3, 0]}>
                        {contribRows.map((r, i) => <Cell key={i} fill={r.isNew || r.isGone ? NEUTRAL : r.delta > 0 ? BAD : GOOD} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  {contribRows.some(r => r.isNew || r.isGone) && (
                    <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>
                      ⬤ เทา = จุดที่เพิ่งเริ่มกรอก หรือเดือนนี้ยังไม่กรอก — <b>ไม่ใช่การใช้ไฟที่เปลี่ยนจริง</b> อย่าเอาไปสรุป
                    </div>
                  )}
                </>
              )}
            </div>

            {/* ④ สัดส่วนการใช้ — โครงสร้างเปลี่ยนหรือแค่ยอดรวมเปลี่ยน */}
            {compPts.length > 0 && (
              <div style={{ ...card, marginBottom: 14 }}>
                <div style={secTitle}>🧩 สัดส่วนการใช้รายจุด · 6 เดือนล่าสุด</div>
                <ResponsiveContainer width="100%" height={230}>
                  <BarChart data={compData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                    <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} tickFormatter={fmtKwh} />
                    <Tooltip contentStyle={tipStyle} formatter={v => Math.round(v).toLocaleString()} />
                    <Legend wrapperStyle={{ fontSize: 11.5 }} />
                    {compPts.map((p, i) => (
                      <Bar key={keyOf(p)} dataKey={p.name} stackId="a"
                        fill={['#38bdf8', '#22c55e', '#f59e0b', '#a78bfa', '#f472b6', '#2dd4bf'][i % 6]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* ⑤ ตารางรายจุด 6 เดือน — จับจุดที่ค่อยๆ ไต่ขึ้นทีละนิด */}
            <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
              <div style={{ ...secTitle, padding: '12px 14px 0' }}>📋 รายจุด · 6 เดือนล่าสุด (kWh)</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                <thead><tr>
                  <th style={th}>จุด</th>
                  {months.slice(-6).map(mk => <th key={mk} style={{ ...th, textAlign: 'right' }}>{monthLabel(mk).replace(/ 25/, ' ')}</th>)}
                  <th style={{ ...th, textAlign: 'right' }}>เทียบเดือนก่อน</th>
                </tr></thead>
                <tbody>
                  {points.filter(p => months.some(mk => (byMonth[mk] || {})[keyOf(p)]?.qty != null)).map(p => {
                    const d = deltaPct(byKey[keyOf(p)]?.qty, prevByKey[keyOf(p)]?.qty);
                    return (
                      <tr key={keyOf(p)}>
                        <td style={{ ...td, fontWeight: 600 }}>
                          {p.kind === 'zone' ? '🔧' : '🏭'} {p.name}
                          {meteredSet.has(keyOf(p)) && <span title="มีมิเตอร์" style={{ marginLeft: 5, fontSize: 10.5, color: GOOD }}>🔌</span>}
                        </td>
                        {months.slice(-6).map(mk => (
                          <td key={mk} style={{ ...td, textAlign: 'right', color: 'var(--text2)' }}>
                            {fmtKwh((byMonth[mk] || {})[keyOf(p)]?.qty)}
                          </td>
                        ))}
                        <td style={{ ...td, textAlign: 'right' }}>{deltaChip(d)}</td>
                      </tr>);
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          /* ⚙️ ค่าการปล่อย (EF) */
          <EfSetup factors={factors} canEdit={canEdit} cfgMissing={cfgMissing} onSaved={load} month={month} />
        )}
    </div>
  );
}

/* ── ⚙️ ค่าการปล่อยก๊าซเรือนกระจก ────────────────────────────────────────
   ⚠️ เก็บเป็นประวัติแยกตามช่วงเวลา **ห้ามแก้ทับของเก่า** — EF เปลี่ยนเกือบทุกปี
      แก้ทับเมื่อไหร่ ตัวเลขที่เคยรายงานลูกค้าไปแล้วจะเปลี่ยนเองเงียบๆ
   ⚠️ บังคับกรอก "ที่มา" — ผู้ทวนสอบถามข้อแรกเสมอว่าเลขนี้มาจากไหน */
function EfSetup({ factors, canEdit, cfgMissing, onSaved, month }) {
  const [kg, setKg] = useState('');
  const [from, setFrom] = useState(`${month}-01`);
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  const cur = efFor('electric', month, factors);

  const add = async () => {
    const v = Number(kg);
    if (!Number.isFinite(v) || v <= 0) return toast.error('กรอกค่าการปล่อย (kgCO2e ต่อ 1 kWh) ให้ถูกต้อง');
    if (!ref.trim()) return toast.error('ต้องระบุที่มาของค่า (เช่น ประกาศ TGO ฉบับไหน) — ไม่มีที่มา = ใช้อ้างอิงกับลูกค้าไม่ได้');
    setBusy(true);
    const { error } = await supabaseDR.from('energy_emission_factors')
      .upsert({ utility_key: 'electric', kg_co2e: v, effective_from: from, source_ref: ref.trim() },
        { onConflict: 'utility_key,effective_from' });
    setBusy(false);
    if (error) return toast.error(error.code === '42P01'
      ? 'ยังไม่ได้ apply migration 20260819_energy_carbon_c1 (แจ้ง admin)' : error.message);
    setKg(''); setRef(''); onSaved();
  };

  return (
    <div style={{ ...card }}>
      <div style={secTitle}>🌱 ค่าการปล่อยก๊าซเรือนกระจก (Emission Factor)</div>
      <div style={{ fontSize: 12.5, color: 'var(--text2)', marginBottom: 12, lineHeight: 1.6 }}>
        ใช้แปลง <b>kWh → kgCO2e</b> (Scope 2) · ค่านี้ประกาศโดย <b>TGO</b> และ<b>เปลี่ยนเกือบทุกปี</b><br />
        ระบบ<b>ไม่ใส่ค่าเริ่มต้นให้โดยตั้งใจ</b> — ต้องเอาตัวเลขจากประกาศจริงมากรอก พร้อมระบุที่มา
        (ใส่เลขมั่วไว้ก่อน = ตัวเลขคาร์บอนผิดที่ดูเหมือนถูก ซึ่งอันตรายกว่าไม่มีตัวเลข)<br />
        <span style={{ color: '#f59e0b' }}>⚠️ เพิ่มแถวใหม่เมื่อ EF เปลี่ยน — <b>ห้ามแก้ทับของเก่า</b> ไม่งั้นตัวเลขที่รายงานไปแล้วจะเปลี่ยนตาม</span>
      </div>

      <div style={{ ...card, background: 'var(--bg3)', marginBottom: 14 }}>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 700 }}>ค่าที่ใช้อยู่กับ {monthLabel(month)}</div>
        {cur ? (
          <div style={{ fontSize: 16, fontWeight: 800, marginTop: 2 }}>
            {cur.kg_co2e} <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--muted)' }}>kgCO2e/kWh</span>
            <div style={{ fontSize: 11.5, fontWeight: 400, color: 'var(--muted)', marginTop: 2 }}>
              มีผลตั้งแต่ {cur.effective_from} · ที่มา: {cur.source_ref}
            </div>
          </div>
        ) : <div style={{ fontSize: 13, color: '#f59e0b', marginTop: 3 }}>ยังไม่มีค่าที่ครอบเดือนนี้ — tCO2e จะขึ้นเป็น “—” จนกว่าจะกรอก</div>}
      </div>

      {canEdit && !cfgMissing && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
          <label style={{ fontSize: 11.5, color: 'var(--muted)' }}>kgCO2e / kWh<br />
            <input type="number" step="0.0001" value={kg} onChange={e => setKg(e.target.value)} placeholder="เช่น 0.4999" style={{ ...inp, width: 130 }} /></label>
          <label style={{ fontSize: 11.5, color: 'var(--muted)' }}>มีผลตั้งแต่<br />
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ ...inp, width: 150 }} /></label>
          <label style={{ fontSize: 11.5, color: 'var(--muted)', flex: '1 1 240px' }}>ที่มา (บังคับ)<br />
            <input value={ref} onChange={e => setRef(e.target.value)} placeholder="เช่น TGO Emission Factor ฉบับ … 25xx" style={inp} /></label>
          <button onClick={add} disabled={busy}
            style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            {busy ? '⏳' : '+ เพิ่มค่า'}
          </button>
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={th}>มีผลตั้งแต่</th><th style={th}>kgCO2e/kWh</th><th style={th}>ที่มา</th></tr></thead>
        <tbody>
          {factors.length === 0 && <tr><td style={{ ...td, color: 'var(--muted)' }} colSpan={3}>ยังไม่มีค่าที่ตั้งไว้</td></tr>}
          {[...factors].sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from))).map(f => (
            <tr key={f.id}>
              <td style={td}>{f.effective_from}</td>
              <td style={{ ...td, fontWeight: 700 }}>{f.kg_co2e}</td>
              <td style={{ ...td, color: 'var(--text2)' }}>{f.source_ref}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 14, lineHeight: 1.6 }}>
        <b>ขอบเขตที่ทำอยู่:</b> Scope 2 (ไฟฟ้าที่ซื้อ) — ตอบคำถาม “บริษัทปล่อยเท่าไหร่ (CFO)” ได้ครบ<br />
        ยังไม่รวม Scope 1 (น้ำมันรถยก/เครื่องปั่นไฟ) และ<b>ไม่ประเมิน Scope 3</b> ตามขอบเขตที่ตกลงไว้ ·
        คาร์บอนของวัสดุที่ซื้อเข้ามา ต้อง<b>ขอจาก supplier</b> ไม่ใช่ประเมินเอง
      </div>
    </div>
  );
}
