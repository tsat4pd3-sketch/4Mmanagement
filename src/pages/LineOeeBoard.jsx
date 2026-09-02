import { useState, useEffect, useMemo, useCallback, useContext } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { wavg, wLoad, wRun, wProd, buildCtMap, computeLiveOee, isTrialDefect, defectQty } from '../utils/oee';
import { parallelUnitsOf, flowModeOf } from '../utils/lineTypes';
import { isOpenDT, isPlannedDT } from '../utils/downtimeRules';
import { getLineFamilyNames } from '../utils/lineHierarchy';
import { scopedLineNames } from '../utils/sectionScope';
import { cachedMaster } from '../utils/masterCache';
import { fetchByIds } from '../utils/fetchByIds';
import { usePolling } from '../utils/usePolling';
import RATE from '../utils/refreshRates';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, ReferenceLine, LabelList, Cell,
} from 'recharts';

/* ═══ 📟 OEE บอร์ดหน้าไลน์ — /line-oee (2026-08-25 · คำสั่ง user "เพิ่มหน้า OEE หน้าไลน์แบบนี้") ═══
   จอ TV ประจำไลน์ผลิต 1 จอ = 1 ไลน์ (deep-link ?line=<ชื่อกลุ่มไลน์>) — โครงตามภาพอ้างอิง
   OEE SUMMARY WEEKLY ของ vendor: Overall vs Target/Variance · เทรนด์รายวัน · การ์ด A/P/Q
   พร้อมที่มาตัวเลข · Alarm Top 6 · Defect Top 6 · Alarm History · แถบสถานะปัจจุบัน

   ⚠️ เตรียมรับ SCADA ตาม docs/SCADA_REALTIME_DESIGN.md:
   หน้านี้อ่านจากตารางของเราเท่านั้น (production_sessions/prod_orders/downtime_logs/defect_logs)
   วัน SCADA มาจริง → raw data (stroke/เวลาหยุด) ไหลเข้าตารางชุดเดิม จอนี้ไม่ต้องแก้อะไร
   **ห้ามต่อ SQL ของ SCADA ตรงเข้าหน้านี้ / ห้ามเอา OEE ที่ SCADA คำนวณมาโชว์** — ESM เป็นเจ้าของสูตร
   (มี OEE 2 ชุดเมื่อไหร่ = เถียงกันว่าเชื่อจอไหน) · SCADA ไม่มีทางรู้ NG → Q มาจากคนเสมอ

   กติกาที่ยึด (สูตรชุดเดียวกับทุกจอ — ห้าม drift):
   - กะปิดแล้ว = ค่า stamp · กะเปิด = computeLiveOee (ประเมินไม่ได้ = null + เหตุผล ห้ามเป็น 0)
   - เฉลี่ยข้ามกะ/รายวัน = wavg ถ่วง wLoad/wRun/wProd — ห้าม mean-of-percentages
   - NG = defect_logs (qty_ng+qty_suspect) line-mode ไม่รวมงานทดลอง · Pareto ของเสียโชว์ทุกรายการ (รวม 🧪)
   - Pareto Downtime นับเฉพาะนอกแผน (planned ไม่ใช่ loss)
   - Target = oee_targets ของกรุ๊ป (A×P×Q — target_oee เป็น vestigial ห้ามใช้) · ไม่ตั้ง = 90×90×99
   - ดึงแถวลูกผ่าน fetchByIds + query พลาด = ขึ้น "ข้อมูลไม่ครบ" ห้ามโชว์ 0 เงียบ
   - จอ TV: ฟอนต์ ≥ 11px · กระพริบเฉพาะแดง (DT ค้างนอกแผน) · usePolling(RATE.BOARD) ไม่ยิงตอนแท็บซ่อน
   - ไม่มี PageHeader โดยตั้งใจ (ข้อยกเว้นบอร์ดจอ TV เหมือน Dashboard/Management) */

const DAYS_TREND = 14;   // เทรนด์ย้อนหลัง
const DAYS_KPI = 7;      // หน้าต่างตัวเลข Overall/A/P/Q/Pareto (weekly)
const DEFAULT_TARGET = 90 * 90 * 99 / 1e4; // 80.19 — ค่ามาตรฐานเมื่อกรุ๊ปไม่ตั้ง target (กฎ oee_targets)
const shiftDate = (s, d) => { const x = new Date(`${s}T00:00:00`); x.setDate(x.getDate() + d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
// work date ไทยตัด 08:00 (กะดึกข้ามวัน) — ห้าม toISOString (UTC เพี้ยน · กฎ Date/Time)
const getWorkDate = () => {
  const d = new Date();
  if (d.getHours() < 8) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const ddmm = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
const hrs = (min) => (min / 60).toLocaleString(undefined, { maximumFractionDigits: 1 });
const nf = (v, d = 0) => (v == null || !Number.isFinite(v) ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: d }));

export default function LineOeeBoard() {
  const { role, lineId, sections } = useContext(UserContext);
  const [sp, setSp] = useSearchParams();
  const [lines, setLines] = useState([]);
  const [data, setData] = useState(null);   // ก้อนข้อมูลดิบต่อรอบโหลด
  const [partial, setPartial] = useState(false); // query ลูกพลาดบางส่วน — ต้องบอก ห้ามเงียบ
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []); // นาฬิกา local ไม่ยิง DB

  /* ── ไลน์ + scope (pattern มาตรฐาน: leader = family ตัวเอง · อื่นตาม sections) ── */
  useEffect(() => {
    (async () => {
      // tolerant: flow_mode/parallel_stations อาจยังไม่ apply ในบาง env → ถอย select ชุดพื้นฐาน
      let { data: d, error } = await supabase.from('production_lines')
        .select('id, name, section, parent_line_name, is_active, flow_mode, parallel_stations').order('name');
      if (error) ({ data: d } = await supabase.from('production_lines').select('id, name, section, parent_line_name, is_active').order('name'));
      setLines(d || []);
    })();
  }, []);
  /* ⚠️ 2026-08-25 บั๊กที่ user จับได้: dropdown ดึงทุกแถวจาก production_lines ตรงๆ ไม่กรองอะไรเลย
     → "Office PD4" / "Rework - PD1" / "test" (is_active=false) โผล่ปนกับไลน์ผลิตจริง เพราะไม่ได้
     เช็ค is_active และไม่มีทางรู้ว่าแถวไหน "ไม่เคยผลิตอะไรเลย" — ตรวจ DB จริงแล้ว 3 แถวนี้ไม่มี
     production_sessions สักแถวเดียวตลอดกาล (ต่างจาก GOR/HYDROFORM ที่มีประวัติจริงแค่ไม่ได้เดินเมื่อเร็วๆ นี้)
     → เพิ่ม (1) is_active (2) "ทั้งครอบครัวไลน์เคยมีกะจริงไหม" — หลักเดียวกับ TEEP ที่ไม่นับไลน์ที่ไม่เคยเปิดกะ
     cache 4 ชม. (payload เล็ก แค่คอลัมน์ line_name ของ session ทั้งหมด ~1,000 แถว) */
  const [everLines, setEverLines] = useState(null); // null = ยังโหลดไม่เสร็จ — อย่าเพิ่งกรองด้วยเงื่อนไขนี้
  useEffect(() => {
    (async () => {
      const rows = await cachedMaster('production_sessions:line_names_ever', async () =>
        (await supabaseDR.from('production_sessions').select('line_name')).data || []);
      setEverLines(new Set((rows || []).map(r => r.line_name).filter(Boolean)));
    })();
  }, []);
  const scopeNames = useMemo(() => scopedLineNames({ role, lineId, sections, lines }), [role, lineId, sections, lines]);
  const topOptions = useMemo(() => {
    const tops = lines
      .filter(l => !l.parent_line_name && l.is_active !== false)
      .filter(l => !everLines || getLineFamilyNames(lines, l.name).some(n => everLines.has(n)))
      .map(l => l.name);
    if (!scopeNames) return tops;
    const sc = new Set(scopeNames);
    return tops.filter(t => getLineFamilyNames(lines, t).some(n => sc.has(n)));
  }, [lines, scopeNames, everLines]);
  // deep-link ?line= — นอก scope/สะกดผิด = ตกไปตัวแรกที่เข้าได้ (pattern เดียวกับ Management)
  const line = useMemo(() => {
    const q = sp.get('line');
    return q && topOptions.includes(q) ? q : (topOptions[0] || '');
  }, [sp, topOptions]);
  const setLine = (v) => { const n = new URLSearchParams(sp); n.set('line', v); setSp(n, { replace: true }); };

  /* ── โหลดข้อมูลทั้งหน้าต่าง (ไลน์เดียว 14 วัน — payload เล็ก) · poll RATE.BOARD ── */
  const load = useCallback(async () => {
    if (!line || !lines.length) return;
    const today = getWorkDate();
    const fam = getLineFamilyNames(lines, line);
    const from = shiftDate(today, -(DAYS_TREND - 1));
    let bad = false;

    const { data: sess, error: e1 } = await supabaseDR.from('production_sessions')
      .select('id, line_name, work_date, shift, status, oee, oee_a, oee_p, oee_q, shift_min, actual_qty, start_time')
      .gte('work_date', from).lte('work_date', today).in('line_name', fam.length ? fam : [line])
      .order('id').limit(1000);
    if (e1) { setData(null); setPartial(true); return; }
    const sessions = sess || [];
    const ids = sessions.map(s => s.id);

    const [dtR, defR, prods, kstds] = await Promise.all([
      fetchByIds(ids, c => supabaseDR.from('downtime_logs')
        .select('id, session_id, duration_min, started_at, ended_at, machine_no, description, call_mtn, dr_downtime_types(name_th, category)')
        .in('session_id', c)),
      fetchByIds(ids, c => supabaseDR.from('defect_logs')
        .select('id, session_id, qty_ng, qty_suspect, is_trial, dr_defect_types(name_th, excl_from_q)')
        .in('session_id', c)),
      // master ผ่าน cache กลาง — key เดียวกับ FactoryMap = แชร์กัน ไม่ดึงซ้ำ (กฎ egress)
      cachedMaster('dr_products:ct', async () =>
        (await supabaseDR.from('dr_products').select('mat_no, cycle_time_sec, pair_mat_no, process_type')).data || []),
      cachedMaster('kanban_standards:ct', async () =>
        (await supabaseDR.from('kanban_standards').select('mat_no, dr_products(cycle_time_sec)').eq('is_active', true)).data || []),
    ]);
    if (dtR.error || dtR.truncated || defR.error || defR.truncated) bad = true;

    // orders เฉพาะกะที่ยังเปิดของวันนี้ (สำหรับ OEE สด + ยอดระหว่างกะ)
    const openToday = sessions.filter(s => s.status === 'open' && s.work_date === today);
    let orders = [];
    if (openToday.length) {
      const oR = await fetchByIds(openToday.map(s => s.id), c => supabaseDR.from('prod_orders')
        .select('id, session_id, status, qty, qty_ok, qty_actual, qty_target, mat_no, opened_at').in('session_id', c));
      if (oR.error) bad = true;
      orders = oR.rows;
    }

    // เป้า OEE ของกรุ๊ป (Main) — A×P×Q เสมอ
    const { data: tg } = await supabase.from('oee_targets')
      .select('group_name, target_a, target_p, target_q').eq('group_name', line).maybeSingle();

    // ── OEE สดของกะเปิดวันนี้ — util กลางตัวเดียวกับ FactoryMap/OEE Analytics ──
    const ctMap = buildCtMap({ kanbanStds: kstds || [], products: prods || [] });
    const dtBySess = {}; dtR.rows.forEach(d2 => (dtBySess[d2.session_id] ||= []).push(d2));
    const ngBySess = {}; defR.rows.forEach(d2 => { if (isTrialDefect(d2)) return; ngBySess[d2.session_id] = (ngBySess[d2.session_id] || 0) + defectQty(d2); });
    const lineCfg = Object.fromEntries(lines.map(l => [l.name, l]));
    const ordBySess = {}; orders.forEach(o => (ordBySess[o.session_id] ||= []).push(o));
    const liveBySess = {};
    openToday.forEach(s => {
      liveBySess[s.id] = computeLiveOee({
        session: s, orders: ordBySess[s.id] || [], downtimes: dtBySess[s.id] || [], ctMap,
        workDate: today, nowMs: Date.now(), ngQty: ngBySess[s.id] || 0,
        parallelN: parallelUnitsOf(lineCfg[s.line_name]),
        parallelCap: flowModeOf(lineCfg[s.line_name]?.flow_mode) === 'parallel_machine' ? parallelUnitsOf(lineCfg[s.line_name]) : 1,
      });
    });

    setPartial(bad);
    setData({ today, sessions, dts: dtR.rows, defs: defR.rows, ordBySess, dtBySess, ngBySess, liveBySess, target: tg || null });
  }, [line, lines]);
  usePolling(load, RATE.BOARD); // immediate=true + re-run เมื่อเปลี่ยนไลน์ (fn identity เปลี่ยน) — ไม่ต้อง useEffect ซ้ำ

  /* ── คำนวณทุกอย่างจากก้อนดิบ ── */
  const C = useMemo(() => {
    if (!data) return null;
    const { today, sessions, dts, defs, ordBySess, dtBySess, ngBySess, liveBySess, target } = data;
    const kpiFrom = shiftDate(today, -(DAYS_KPI - 1));

    // planned/unplanned นาทีต่อกะ
    const plannedBy = {}, unplannedBy = {};
    dts.forEach(d2 => {
      const m = Number(d2.duration_min) || 0;
      if (d2.dr_downtime_types?.category === 'planned') plannedBy[d2.session_id] = (plannedBy[d2.session_id] || 0) + m;
      else unplannedBy[d2.session_id] = (unplannedBy[d2.session_id] || 0) + m;
    });

    // แถวต่อกะสำหรับ wavg — ปิดแล้วใช้ stamp · เปิดใช้ค่าสด (null = ไม่นับ ไม่ใช่ 0)
    const rowOf = (s) => {
      const lv = s.status === 'open' ? liveBySess[s.id] : null;
      const produced = s.status === 'open'
        ? (ordBySess[s.id] || []).reduce((a, o) => a + (o.status === 'confirmed' ? (Number(o.qty_ok ?? o.qty) || 0) : (Number(o.qty_actual) || 0)), 0)
        : Number(s.actual_qty) || 0;
      // ⚠️ computeLiveOee คืน key ตัวใหญ่ A/P/Q (ไม่ใช่ a/p/q)
      const aVal = s.status === 'open' ? (lv?.A ?? null) : (s.oee_a != null ? Number(s.oee_a) : null);
      return {
        work_date: s.work_date, live: s.status === 'open',
        oee: s.status === 'open' ? (lv?.oee ?? null) : (s.oee != null ? Number(s.oee) : null),
        a: aVal,
        p: s.status === 'open' ? (lv?.P ?? null) : (s.oee_p != null ? Number(s.oee_p) : null),
        q: s.status === 'open' ? (lv?.Q ?? null) : (s.oee_q != null ? Number(s.oee_q) : null),
        shift_min: Number(s.shift_min) || 570, plannedMin: plannedBy[s.id] || 0,
        unplannedMin: unplannedBy[s.id] || 0, produced, ngQty: ngBySess[s.id] || 0,
        calcA: aVal, totalQty: produced,
      };
    };
    const rows = sessions.map(rowOf);
    const kpiRows = rows.filter(r => r.work_date >= kpiFrom);

    // เทรนด์รายวัน (แกนวันต่อเนื่อง — วันไม่มีข้อมูล = null ให้กราฟเว้น ไม่ข้ามวัน)
    const trend = [];
    for (let i = DAYS_TREND - 1; i >= 0; i--) {
      const d2 = shiftDate(today, -i);
      const dayRows = rows.filter(r => r.work_date === d2);
      trend.push({ d: ddmm(d2), oee: dayRows.length ? wavg(dayRows, x => x.oee, wLoad) : null, isToday: d2 === today });
    }

    const overall = wavg(kpiRows, r => r.oee, wLoad);
    const A = wavg(kpiRows, r => r.a, wLoad);
    const P = wavg(kpiRows, r => r.p, wRun);
    const Q = wavg(kpiRows, r => r.q, wProd);
    const tgt = target ? ((Number(target.target_a) || 90) * (Number(target.target_p) || 90) * (Number(target.target_q) || 99)) / 1e4 : DEFAULT_TARGET;

    // ที่มาตัวเลข (breakdown สัปดาห์)
    const loadMin = kpiRows.reduce((a, r) => a + Math.max(0, r.shift_min - r.plannedMin), 0);
    const unplMin = kpiRows.reduce((a, r) => a + r.unplannedMin, 0);
    const plMin = kpiRows.reduce((a, r) => a + r.plannedMin, 0);
    const runMin = Math.max(0, loadMin - unplMin);
    const produced = kpiRows.reduce((a, r) => a + r.produced, 0);
    const ngTotal = kpiRows.reduce((a, r) => a + r.ngQty, 0);

    // Pareto (หน้าต่างสัปดาห์เดียวกับ KPI)
    const kpiSessIds = new Set(sessions.filter(s => s.work_date >= kpiFrom).map(s => s.id));
    const dtTop = {}, defTop = {};
    dts.forEach(d2 => {
      if (!kpiSessIds.has(d2.session_id) || d2.dr_downtime_types?.category === 'planned') return; // Pareto นับเฉพาะนอกแผน
      const k = d2.dr_downtime_types?.name_th || 'ไม่ระบุประเภท';
      dtTop[k] = (dtTop[k] || 0) + (Number(d2.duration_min) || 0);
    });
    defs.forEach(d2 => {
      if (!kpiSessIds.has(d2.session_id)) return;
      const k = (d2.dr_defect_types?.name_th || 'ไม่ระบุประเภท') + (isTrialDefect(d2) ? ' 🧪' : '');
      defTop[k] = (defTop[k] || 0) + (Number(d2.qty_ng) || 0) + (Number(d2.qty_suspect) || 0); // ลิสต์ของเสียโชว์ทุกรายการรวมงานทดลอง (ตัดเฉพาะ %Q)
    });
    const top6 = (o) => Object.entries(o).map(([name, v]) => ({ name, v })).sort((a, b) => b.v - a.v).slice(0, 6);

    // Alarm history — ล่าสุดก่อน · active (นอกแผน) = กระพริบ
    const history = [...dts].filter(d2 => kpiSessIds.has(d2.session_id))
      .sort((a, b) => String(b.started_at || '').localeCompare(String(a.started_at || ''))).slice(0, 8);

    // สถานะปัจจุบัน (footer)
    const openNow = sessions.filter(s => s.status === 'open' && s.work_date === today);
    const activeDt = dts.filter(d2 => openNow.some(s => s.id === d2.session_id) && isOpenDT(d2) && !isPlannedDT(d2));
    const liveNow = openNow.length ? liveBySess[openNow[0].id] : null;

    return {
      trend, overall, A, P, Q, tgt, variance: overall != null ? +(overall - tgt).toFixed(1) : null,
      loadMin, runMin, unplMin, plMin, produced, ngTotal,
      dtTop6: top6(dtTop), defTop6: top6(defTop), history,
      hasOpen: !!openNow.length, activeDt, liveNow, kpiN: kpiRows.length,
      liveInWindow: kpiRows.some(r => r.live && r.oee != null),
    };
  }, [data]);

  /* ── สไตล์ (จอ TV — ฟอนต์ ≥ 11px ตาม convention) ── */
  const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 16px' };
  const capSt = { fontSize: 11.5, fontWeight: 800, color: 'var(--muted)', letterSpacing: 0.5, textTransform: 'uppercase' };
  const rowKV = (k, v, color) => (
    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12, lineHeight: 1.75 }}>
      <span style={{ color: 'var(--muted)' }}>{k}</span><b style={{ color: color || 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{v}</b>
    </div>
  );
  const apqCard = (label, badge, val, color, kvs) => (
    <div style={{ ...card, flex: 1, minWidth: 250, borderTop: `3px solid ${color}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 26, height: 26, borderRadius: '50%', background: `${color}22`, border: `2px solid ${color}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12.5, fontWeight: 900, color }}>{badge}</span>
        <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>{label}</span>
        <span style={{ marginLeft: 'auto', fontSize: 26, fontWeight: 900, color, fontVariantNumeric: 'tabular-nums' }}>{val == null ? '—' : `${val.toFixed(1)}%`}</span>
      </div>
      <div style={{ marginTop: 6, borderTop: '1px dashed var(--border2)', paddingTop: 6 }}>{kvs.map(([k, v, c2]) => rowKV(k, v, c2))}</div>
    </div>
  );
  const barChart = (title, items, color, unit) => (
    <div style={{ ...card, flex: 1, minWidth: 300 }}>
      <div style={capSt}>{title}</div>
      {!items.length ? <div style={{ fontSize: 12.5, color: 'var(--muted)', padding: '26px 0', textAlign: 'center' }}>ไม่มีข้อมูลในช่วง {DAYS_KPI} วัน</div> : (
        <ResponsiveContainer width="100%" height={190}>
          <BarChart data={items} margin={{ top: 20, left: 0, right: 6, bottom: 4 }}>
            <XAxis dataKey="name" tick={{ fontSize: 10.5, fill: 'var(--text2)' }} interval={0}
              tickFormatter={n => n.length > 9 ? n.slice(0, 8) + '…' : n} angle={-25} height={48} textAnchor="end" />
            <YAxis hide />
            <Bar dataKey="v" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              <LabelList dataKey="v" position="top" style={{ fontSize: 11, fontWeight: 800, fill: 'var(--text)' }} />
              {items.map((_, i) => <Cell key={i} fill={color} fillOpacity={1 - i * 0.11} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
      <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{unit}</div>
    </div>
  );

  const varUp = C?.variance != null && C.variance >= 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 2px' }}>
      {/* header — ไม่ใช้ PageHeader (บอร์ดจอ TV — ข้อยกเว้นเดียวกับ Dashboard/Management) */}
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '10px 16px' }}>
        <span style={{ fontSize: 17, fontWeight: 900, color: 'var(--text)' }}>📟 OEE รายไลน์ (Weekly)</span>
        {/* width กัน index.css select width:100% */}
        <select value={line} onChange={e => setLine(e.target.value)}
          style={{ width: 230, padding: '6px 10px', fontSize: 14, fontWeight: 700, borderRadius: 8, background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)' }}>
          {topOptions.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>หน้าต่าง {DAYS_KPI} วันล่าสุด{C?.liveInWindow ? ' · รวมกะที่กำลังเปิด (สด)' : ''}</span>
        <span style={{ marginLeft: 'auto', fontSize: 20, fontWeight: 900, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
          {now.toLocaleTimeString('th-TH', { hour12: false })}
          <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)', marginLeft: 8 }}>{now.toLocaleDateString('th-TH')}</span>
        </span>
      </div>

      {partial && (
        <div style={{ ...card, borderColor: '#f59e0b', color: '#f59e0b', fontSize: 12.5, padding: '8px 14px' }}>
          ⚠ โหลดข้อมูลได้ไม่ครบ — ตัวเลขบางส่วนอาจต่ำกว่าจริง (ลองรีเฟรช/เช็คเครือข่าย)
        </div>
      )}

      {!C ? (
        <div style={{ ...card, textAlign: 'center', color: 'var(--muted)', padding: 40 }}>กำลังโหลดข้อมูล...</div>
      ) : (
        <>
          {/* แถว 1: Overall + เทรนด์ */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ ...card, flex: '0 0 250px', display: 'flex', flexDirection: 'column' }}>
              <div style={capSt}>Overall OEE ({DAYS_KPI} วัน)</div>
              <div style={{ fontSize: 'clamp(44px,4.5vw,62px)', fontWeight: 900, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums',
                color: C.overall == null ? 'var(--muted)' : C.overall >= C.tgt ? '#22c55e' : C.overall >= C.tgt - 10 ? '#f59e0b' : '#ef4444' }}>
                {C.overall == null ? '—' : `${C.overall.toFixed(1)}%`}
              </div>
              {C.overall == null && <div style={{ fontSize: 12, color: 'var(--muted)' }}>ยังไม่มีกะปิด/ข้อมูลสดในช่วงนี้</div>}
              <div style={{ display: 'flex', gap: 18, marginTop: 'auto', paddingTop: 8, borderTop: '1px dashed var(--border2)' }}>
                <div><div style={capSt}>Target</div><b style={{ fontSize: 18, color: '#f59e0b' }}>{C.tgt.toFixed(1)}%</b></div>
                <div><div style={capSt}>Variance</div>
                  <b style={{ fontSize: 18, color: C.variance == null ? 'var(--muted)' : varUp ? '#22c55e' : '#ef4444' }}>
                    {C.variance == null ? '—' : `${varUp ? '▲ +' : '▼ '}${C.variance}`}</b>
                </div>
              </div>
              {!data?.target && <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 4 }}>เป้ามาตรฐาน (ยังไม่ตั้ง 🎯 ที่ /oee-analytics)</div>}
            </div>
            {/* ⚠️ 2026-08-25 บั๊กที่ user ทัก "ปัจจุบันล่ะ มีแต่ย้อนหลัง 7 วันหรอ" — สถานะสดเดิมมีอยู่
                แค่ซ่อนอยู่แถบเล็กท้ายจอ ตัวเลขใหญ่สุดบนจอ (72.0%) คือค่าเฉลี่ย 7 วัน ไม่ใช่ตอนนี้
                → เพิ่มการ์ด "ตอนนี้ (Live)" ให้เห็นคู่กันชัดๆ ตั้งแต่แถวบนสุด (แถบท้ายจอเดิมยังอยู่
                เป็นรายละเอียด/เหตุผลกำกับ) — ที่มาข้อมูลเหมือนเดิมทุกอย่าง (C.activeDt/C.hasOpen/C.liveNow) */}
            <div style={{ ...card, flex: '0 0 220px', display: 'flex', flexDirection: 'column' }}>
              <div style={capSt}>ตอนนี้ (Live)</div>
              {C.activeDt.length ? (
                <>
                  <div style={{ fontSize: 'clamp(30px,3vw,40px)', fontWeight: 900, lineHeight: 1.15, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="dt-alarm-icon">🔴</span> หยุด
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>
                    {C.activeDt.map(d2 => d2.dr_downtime_types?.name_th || 'ไม่ระบุ').join(' · ')}
                  </div>
                </>
              ) : C.hasOpen ? (
                <>
                  <div style={{ fontSize: 'clamp(36px,3.8vw,50px)', fontWeight: 900, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums',
                    color: C.liveNow?.oee == null ? 'var(--muted)' : '#22c55e' }}>
                    {C.liveNow?.oee != null ? `${Math.round(C.liveNow.oee)}%` : '—'}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>
                    {C.liveNow?.oee != null ? '🟢 กำลังผลิต · OEE กะนี้' : C.liveNow?.noCt ? '⚠ ยังไม่ตั้ง CT — คำนวณไม่ได้' : '🟢 กำลังผลิต · ยังประเมินไม่ได้'}
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 'clamp(30px,3vw,40px)', fontWeight: 900, color: 'var(--muted)' }}>⏸</div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>ยังไม่เปิดกะ</div>
                </>
              )}
            </div>
            <div style={{ ...card, flex: 1, minWidth: 380 }}>
              <div style={capSt}>OEE Trend รายวัน ({DAYS_TREND} วัน · เฉลี่ยถ่วงเวลารับภาระ)</div>
              <ResponsiveContainer width="100%" height={168}>
                <AreaChart data={C.trend} margin={{ top: 8, left: -14, right: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="oeeG" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2dd4bf" stopOpacity={0.55} /><stop offset="100%" stopColor="#2dd4bf" stopOpacity={0.06} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="d" tick={{ fontSize: 11, fill: 'var(--text2)' }} />
                  <YAxis domain={[0, 100]} ticks={[0, 50, 100]} tick={{ fontSize: 11, fill: 'var(--text2)' }} tickFormatter={v => `${v}%`} />
                  <ReferenceLine y={C.tgt} stroke="#f59e0b" strokeDasharray="6 4"
                    label={{ value: `target ${C.tgt.toFixed(0)}%`, position: 'insideTopRight', fill: '#f59e0b', fontSize: 11, fontWeight: 800 }} />
                  <Area type="monotone" dataKey="oee" stroke="#2dd4bf" strokeWidth={2.2} fill="url(#oeeG)" connectNulls={false} isAnimationActive={false} dot={{ r: 2.5 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* แถว 2: A / P / Q + ที่มาตัวเลข (กางให้เห็นตามกฎ "ตัวเลขต้องกางที่มา") */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {apqCard('Availability', 'A', C.A, '#22c55e', [
              ['เวลารับภาระ (กะ − หยุดในแผน)', `${hrs(C.loadMin)} ชม.`],
              ['เวลาเดินเครื่อง', `${hrs(C.runMin)} ชม.`],
              ['หยุดนอกแผน', `${hrs(C.unplMin)} ชม.`, C.unplMin > 0 ? '#ef4444' : undefined],
              ['หยุดตามแผน/พัก', `${hrs(C.plMin)} ชม.`],
            ])}
            {apqCard('Performance', 'P', C.P, '#4d9fff', [
              ['ผลิตจริง', `${nf(C.produced)} ชิ้น`],
              ['อัตราจริง', C.runMin > 0 ? `${nf(C.produced / (C.runMin / 60), 1)} ชิ้น/ชม.` : '—'],
              ['เทียบมาตรฐาน (CT)', C.P == null ? 'ยังคำนวณไม่ได้' : `${C.P.toFixed(1)}% ของความเร็วมาตรฐาน`],
            ])}
            {apqCard('Quality', 'Q', C.Q, '#a855f7', [
              ['ผลิตทั้งหมด (ดี+เสีย)', `${nf(C.produced + C.ngTotal)} ชิ้น`],
              ['ของดี (ยอดสแกน)', `${nf(C.produced)} ชิ้น`],
              ['ของเสีย (ไม่รวมงานทดลอง)', `${nf(C.ngTotal)} ชิ้น`, C.ngTotal > 0 ? '#ef4444' : undefined],
            ])}
          </div>

          {/* แถว 3: Pareto + Alarm history */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {barChart(`Alarm Top 6 (นาที · ${DAYS_KPI} วัน)`, C.dtTop6, '#f97316', 'เฉพาะหยุดนอกแผน — หยุดตามแผนไม่ใช่ loss')}
            {barChart(`Defect Top 6 (ชิ้น · ${DAYS_KPI} วัน)`, C.defTop6, '#ef4444', 'รวมทุกรายการ (🧪 = งานทดลอง ไม่ถูกนับใน %Q)')}
            <div style={{ ...card, flex: 1.2, minWidth: 340 }}>
              <div style={capSt}>Alarm History (ล่าสุด)</div>
              {!C.history.length ? <div style={{ fontSize: 12.5, color: 'var(--muted)', padding: '26px 0', textAlign: 'center' }}>ไม่มีรายการหยุดในช่วงนี้</div> : (
                <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 4 }}>
                  <thead><tr>{['เวลา', 'รายการ', 'เครื่อง', 'นาที', 'สถานะ'].map(h => (
                    <th key={h} style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'left', padding: '3px 6px', borderBottom: '1px solid var(--border2)' }}>{h}</th>))}
                  </tr></thead>
                  <tbody>{C.history.map(d2 => {
                    const active = isOpenDT(d2), planned = isPlannedDT(d2);
                    return (
                      <tr key={d2.id} className={active && !planned ? 'dt-alarm-blink' : undefined}>
                        <td style={{ fontSize: 11.5, color: 'var(--text2)', padding: '3px 6px', whiteSpace: 'nowrap' }}>
                          {d2.started_at ? new Date(d2.started_at).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                        </td>
                        <td style={{ fontSize: 11.5, color: 'var(--text)', padding: '3px 6px' }}>
                          {d2.dr_downtime_types?.name_th || '—'}{d2.description ? <span style={{ color: 'var(--muted)' }}> · {d2.description}</span> : ''}
                        </td>
                        <td style={{ fontSize: 11.5, color: 'var(--text2)', padding: '3px 6px' }}>{d2.machine_no || '—'}</td>
                        <td style={{ fontSize: 11.5, color: 'var(--text2)', padding: '3px 6px', fontVariantNumeric: 'tabular-nums' }}>{d2.duration_min ?? '—'}</td>
                        <td style={{ fontSize: 11.5, padding: '3px 6px', whiteSpace: 'nowrap' }}>
                          {/* ⚠️ 2026-08-25 บั๊กที่ user จับได้: shake ทั้งคำ "🔴 Active" (ไม่ใช่แค่ไอคอน) ดูรก/แปลก
                              — .dt-alarm-icon ทุกจุดอื่นในระบบ (FactoryMap/Dashboard/DailyPM) ใช้กับ "ไอคอนตัวเดียว"
                              เท่านั้น จุดนี้ผิดเงื่อนไขเดิม + คำว่า Active ก็ไม่เข้าพวกกับศัพท์ไทยที่เหลือในตาราง
                              (คู่กับ "✓ กลับมาแล้ว") → แยกไอคอนออกมา shake เดี่ยว ข้อความเป็นภาษาไทยล้วน */}
                          {active
                            ? <b style={{ color: planned ? 'var(--muted)' : '#ef4444' }}>
                                {planned ? '🗓️ ตามแผน' : <><span className="dt-alarm-icon">🔴</span> ยังหยุดอยู่</>}
                              </b>
                            : <span style={{ color: '#22c55e' }}>✓ กลับมาแล้ว</span>}
                          {d2.call_mtn && <span style={{ color: '#f59e0b' }}> 📞</span>}
                        </td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              )}
            </div>
          </div>

          {/* footer สถานะปัจจุบัน — กระพริบเฉพาะแดง (DT นอกแผนค้าง) ตาม Andon */}
          <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 14, padding: '8px 16px' }}>
            {C.activeDt.length ? (
              // shake เฉพาะไอคอน 🔴 — ห้าม shake ทั้งประโยค (กฎเดียวกับที่แก้ในตาราง Alarm History ข้างบน)
              <b style={{ color: '#ef4444', fontSize: 14 }}>
                <span className="dt-alarm-icon">🔴</span> {line} หยุดอยู่: {C.activeDt.map(d2 => d2.dr_downtime_types?.name_th || 'ไม่ระบุ').join(' · ')}
              </b>
            ) : C.hasOpen ? (
              <b style={{ color: '#22c55e', fontSize: 14 }}>▶ {line} กำลังผลิต{C.liveNow?.oee != null ? ` · OEE กะนี้ (สด) ${Math.round(C.liveNow.oee)}%` : C.liveNow?.noCt ? ' · ⚠ ยังไม่ตั้ง CT — คำนวณ P ไม่ได้' : ''}</b>
            ) : (
              <b style={{ color: 'var(--muted)', fontSize: 14 }}>⏸ {line} ยังไม่เปิดกะ</b>
            )}
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)' }}>
              จาก {C.kpiN} กะ · สูตรชุดเดียวกับ Daily Report/OEE Analytics · อัพเดตทุก {Math.round(RATE.BOARD / 60000)} นาที
            </span>
          </div>
        </>
      )}
    </div>
  );
}
