import { useState, useEffect, useContext, useMemo, useCallback } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { inSectionScope } from '../utils/sectionScope';
import { getLineFamilyNames } from '../utils/lineHierarchy';
import useIsMobile from '../utils/useIsMobile';
import { fmtDate } from '../utils/dateFormat';
import {
  estimateCapacity, planCapacity, median, HISTORY_DAYS, DEFAULT_SHIFT_MIN, DEFAULT_OEE,
} from '../utils/capacityModel';

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
  const [tab, setTab] = useState('daily');       // 'daily' | 'monthly'
  const [capMode, setCapMode] = useState('median'); // 'median' | 'safe'
  const [loading, setLoading] = useState(true);
  const [allLines, setAllLines] = useState([]);
  const [secFilter, setSecFilter] = useState('');
  const [calMap, setCalMap] = useState({});      // date → day_type
  const [prodByMat, setProdByMat] = useState({}); // mat_no → { line, ct }
  const [capByMat, setCapByMat] = useState({});   // mat_no → estimateCapacity result
  const [orders, setOrders] = useState([]);       // open shipping orders (future)
  const [forecasts, setForecasts] = useState([]); // future monthly forecast

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
  const sectionOpts = useMemo(() => [...new Set(scopedLines.map(l => l.section).filter(Boolean))].sort(), [scopedLines]);
  const viewLines = useMemo(() => (secFilter ? scopedLines.filter(l => l.section === secFilter) : scopedLines), [scopedLines, secFilter]);
  const lineNameSet = useMemo(() => new Set(viewLines.map(l => l.name)), [viewLines]);
  const calOf = useCallback((d) => calMap[d] || 'working', [calMap]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('production_lines')
        .select('id, name, section, parent_line_name, std_day_shift, std_night_shift').order('name');
      setAllLines(data || []);
    })();
  }, []);

  /* ── โหลดข้อมูลหลัก ── */
  useEffect(() => {
    (async () => {
      setLoading(true);
      const histStart = addDays(today, -HISTORY_DAYS);
      const [{ data: cal }, { data: prods }, { data: sess }, { data: ord }, { data: fc }] = await Promise.all([
        supabase.from('company_calendar').select('work_date, day_type')
          .gte('work_date', addDays(today, -2)).lte('work_date', addDays(today, DAILY_HORIZON + 200)),
        supabaseDR.from('dr_products').select('mat_no, line_name, cycle_time_sec').eq('is_active', true).not('mat_no', 'is', null),
        supabaseDR.from('production_sessions').select('id, line_name, shift, oee').eq('status', 'closed').gte('work_date', histStart).limit(2000),
        supabaseDR.from('customer_shipping_orders').select('mat_no, part_name, customer, qty, due_date, status')
          .neq('status', 'shipped').gte('due_date', today).lte('due_date', addDays(today, DAILY_HORIZON)).limit(2000),
        supabaseDR.from('customer_forecasts').select('mat_no, part_name, customer, qty, period_month')
          .gte('period_month', `${monthKey(today)}-01`).limit(4000),
      ]);
      setCalMap(Object.fromEntries((cal || []).map(c => [c.work_date, c.day_type])));
      setOrders(ord || []);
      setForecasts(fc || []);

      const pmap = {};
      (prods || []).forEach(p => { if (p.mat_no) pmap[p.mat_no] = { line: p.line_name, ct: p.cycle_time_sec || 0 }; });
      setProdByMat(pmap);

      // ── กำลังจริงต่อกะ: sum qty ต่อ (session, mat) จากใบปิด แล้ว median ต่อ (mat) ──
      const sessMeta = {}; (sess || []).forEach(s => { sessMeta[s.id] = s; });
      const oeeByLine = {};
      (sess || []).forEach(s => { if (s.oee != null) (oeeByLine[s.line_name] = oeeByLine[s.line_name] || []).push(Number(s.oee)); });
      const sessIds = (sess || []).map(s => s.id);
      const orderRows = [];
      for (let i = 0; i < sessIds.length; i += 300) {
        const { data: po } = await supabaseDR.from('prod_orders')
          .select('session_id, mat_no, qty_ok, qty').eq('status', 'confirmed').in('session_id', sessIds.slice(i, i + 300));
        if (po) orderRows.push(...po);
      }
      // sum ต่อ (session, mat) = ยอดของ mat นั้นในกะนั้น
      const perSessMat = {};
      orderRows.forEach(o => {
        if (!o.mat_no) return;
        const k = `${o.session_id}|${o.mat_no}`;
        perSessMat[k] = (perSessMat[k] || 0) + (o.qty_ok ?? o.qty ?? 0);
      });
      const outputsByMat = {};
      Object.entries(perSessMat).forEach(([k, qty]) => {
        const mat = k.split('|')[1];
        (outputsByMat[mat] = outputsByMat[mat] || []).push(qty);
      });
      const cap = {};
      Object.keys(pmap).forEach(mat => {
        const line = pmap[mat].line;
        const lineOee = oeeByLine[line]?.length ? median(oeeByLine[line]) / 100 : DEFAULT_OEE;
        cap[mat] = estimateCapacity(outputsByMat[mat] || [], { ctSec: pmap[mat].ct, shiftMin: DEFAULT_SHIFT_MIN, lineOee });
      });
      setCapByMat(cap);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today]);

  /* ── หากำลังต่อกะ (ชิ้น) ของ mat + line ที่ผลิต ── */
  const lineOfMat = useCallback((mat) => {
    const direct = prodByMat[mat]?.line;
    if (direct && lineNameSet.has(direct)) return direct;
    // normalize เทียบ mat ที่ต่างขีด/ช่องว่าง
    const nm = normMat(mat);
    const hit = Object.keys(prodByMat).find(m => normMat(m) === nm);
    return hit && lineNameSet.has(prodByMat[hit].line) ? prodByMat[hit].line : null;
  }, [prodByMat, lineNameSet]);
  const capOfMat = useCallback((mat) => {
    const est = capByMat[mat] || capByMat[Object.keys(capByMat).find(m => normMat(m) === normMat(mat)) || ''];
    return { est, perShift: planCapacity(est, capMode) };
  }, [capByMat, capMode]);

  /* ═══ รายวัน: เดินปฏิทิน จัดสรร shift-load ต่อไลน์ ═══ */
  const daily = useMemo(() => {
    if (loading) return [];
    const dates = Array.from({ length: DAILY_HORIZON + 1 }, (_, i) => addDays(today, i));
    return viewLines.filter(l => !viewLines.some(o => o.parent_line_name === l.name)).map(line => {
      // ความต้องการของไลน์นี้ต่อวัน (แปลงเป็น shift-load: qty ÷ กำลังต่อกะ)
      const lineOrders = orders.filter(o => lineOfMat(o.mat_no) === line.name);
      const loadByDate = {}, pcsByDate = {}, matSet = new Set();
      let unknownCap = 0;
      lineOrders.forEach(o => {
        const { perShift } = capOfMat(o.mat_no);
        const qty = Number(o.qty) || 0;
        pcsByDate[o.due_date] = (pcsByDate[o.due_date] || 0) + qty;
        matSet.add(o.mat_no);
        if (perShift > 0) loadByDate[o.due_date] = (loadByDate[o.due_date] || 0) + qty / perShift;
        else unknownCap += qty;
      });
      const hasNight = (line.std_night_shift || 0) > 0;
      // เดินวัน: กะเช้า 1 shift → กะดึก (ถ้ามี) → OT · วันหยุดทำเฉพาะเมื่อ backlog
      let backlog = 0;
      const days = dates.map(date => {
        const dtype = calOf(date);
        const holiday = dtype !== 'working';
        const sd75 = dtype === 'shutdown75';
        const due = loadByDate[date] || 0;
        let need = backlog + due;
        const plan = [];
        if (!holiday) {
          if (need > 0) { need -= Math.min(need, 1); plan.push('day'); }
          if (need > 0 && hasNight) { need -= Math.min(need, 1); plan.push('night'); }
          if (need > 0) { need -= Math.min(need, OT_SHIFT_FRAC); if (!plan.includes('ot')) plan.push('ot'); }
        } else if (sd75) {
          // ม.75: ยกเลิกหยุด (เรียกมาทำงาน ค่าแรงปกติ) — ใช้ได้เต็มกำลังเหมือนวันทำงาน ก่อนคิด OT วันหยุดจริง
          if (need > 0) { need -= Math.min(need, 1); plan.push('recall75'); }
          if (need > 0 && hasNight) { need -= Math.min(need, 1); plan.push('night'); }
          if (need > 0) { need -= Math.min(need, OT_SHIFT_FRAC); if (!plan.includes('ot')) plan.push('ot'); }
        } else if (need > 0) { need -= Math.min(need, 1); plan.push('holiday_work'); }
        backlog = Math.max(0, need);
        return { date, holiday, sd75, dueLoad: due, duePcs: pcsByDate[date] || 0, plan, backlog };
      });
      const otDays = days.filter(d => d.plan.includes('ot')).length;
      const nightDays = days.filter(d => d.plan.includes('night')).length;
      const recall75Days = days.filter(d => d.plan.includes('recall75')).length;
      const holidayDays = days.filter(d => d.plan.includes('holiday_work')).length;
      const endBacklog = days[days.length - 1]?.backlog || 0;
      return { line, days, otDays, nightDays, recall75Days, holidayDays, endBacklog, unknownCap, matCount: matSet.size, orderCount: lineOrders.length };
    }).filter(r => r.orderCount > 0 || r.unknownCap > 0);
  }, [loading, viewLines, orders, today, capOfMat, lineOfMat, calOf]);

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
    return viewLines.filter(l => !viewLines.some(o => o.parent_line_name === l.name)).map(line => {
      const hasNight = (line.std_night_shift || 0) > 0;
      const rows = months.map(mk => {
        const fcs = forecasts.filter(f => monthKey(f.period_month) === mk && lineOfMat(f.mat_no) === line.name);
        let shiftsNeeded = 0, pcs = 0, unknownCap = 0;
        fcs.forEach(f => {
          const { perShift } = capOfMat(f.mat_no);
          const qty = Number(f.qty) || 0; pcs += qty;
          if (perShift > 0) shiftsNeeded += qty / perShift; else unknownCap += qty;
        });
        const wd = workDaysOf(mk);
        const sd75 = sd75DaysOf(mk);
        const dayShifts = wd;                 // 1 กะเช้า/วันทำงาน
        const capShifts = wd * (hasNight ? 2 : 1);
        const fullCap = capShifts * (1 + OT_SHIFT_FRAC);
        const sd75Shifts = sd75 * (hasNight ? 2 : 1);   // กำลังจากยกเลิกหยุด ม.75 (ค่าแรงปกติ)
        // ตัดสิน: ปกติพอ / OT / กะดึก / กะดึก+OT / ยกเลิกหยุด 75% (ก่อน OT วันหยุดเสมอ) / เกินกำลัง
        let verdict, color;
        if (!fcs.length) { verdict = '—'; color = 'var(--muted)'; }
        else if (shiftsNeeded <= dayShifts) { verdict = 'กะเช้าพอ'; color = '#22c55e'; }
        else if (shiftsNeeded <= dayShifts * (1 + OT_SHIFT_FRAC)) { verdict = `ต้องเปิด OT ~${Math.ceil((shiftsNeeded - dayShifts) / OT_SHIFT_FRAC)} วัน`; color = '#f59e0b'; }
        else if (hasNight && shiftsNeeded <= capShifts) { verdict = `ต้องเปิดกะดึก ~${Math.ceil(shiftsNeeded - dayShifts)} วัน`; color = '#8b5cf6'; }
        else if (hasNight && shiftsNeeded <= fullCap) { verdict = 'กะดึก + OT เต็มเดือน'; color = '#ef4444'; }
        else if (sd75Shifts > 0 && shiftsNeeded <= fullCap + sd75Shifts) { verdict = `⚡ ยกเลิกหยุด 75% มาทำงาน ~${Math.ceil((shiftsNeeded - fullCap) / (hasNight ? 2 : 1))} วัน (ค่าแรงปกติ)`; color = '#a78bfa'; }
        else { verdict = '🚨 เกินกำลัง — ต้องเพิ่มไลน์/คน' + (sd75 ? ' (รวมยกเลิกหยุด 75% แล้ว)' : ''); color = '#ef4444'; }
        return { mk, pcs, shiftsNeeded, dayShifts, capShifts, verdict, color, unknownCap, fcCount: fcs.length };
      });
      return { line, rows };
    }).filter(r => r.rows.some(x => x.fcCount > 0));
  }, [loading, viewLines, forecasts, calMap, today, capOfMat, lineOfMat]);

  /* ── styles ── */
  const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 };
  const chip = (color, bg) => ({ fontSize: 11, fontWeight: 800, color, background: bg || `${color}1f`, border: `1px solid ${color}55`, borderRadius: 6, padding: '2px 7px', whiteSpace: 'nowrap' });
  const th = { padding: '5px 8px', borderBottom: '1px solid var(--border)', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', textAlign: 'right' };
  const td = { padding: '5px 8px', fontSize: 12, whiteSpace: 'nowrap', textAlign: 'right' };
  const btnSt = (active) => ({ padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', border: `1px solid ${active ? 'var(--accent)' : 'var(--border2)'}`, background: active ? 'var(--accent-dim)' : 'var(--bg2)', color: active ? 'var(--accent)' : 'var(--text2)' });
  const confChip = (c) => c === 'high' ? null : <span style={chip(c === 'med' ? '#f59e0b' : '#ef4444')}>{c === 'med' ? 'ข้อมูลปานกลาง' : 'ข้อมูลน้อย'}</span>;

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingRight: 52 }}>
        <h1 style={{ margin: 0, fontSize: 'clamp(17px, 2.2vw, 22px)', fontWeight: 900, fontFamily: 'var(--font-display)', color: 'var(--text)' }}>🗓️ วางแผนการผลิต</h1>
        <button onClick={() => setTab('daily')} style={btnSt(tab === 'daily')}>📅 รายวัน (ออเดอร์)</button>
        <button onClick={() => setTab('monthly')} style={btnSt(tab === 'monthly')}>📆 รายเดือน (Forecast)</button>
        {sectionOpts.length > 1 && (
          <select value={secFilter} onChange={e => setSecFilter(e.target.value)} style={{ width: 'auto', minWidth: 110, padding: '6px 10px', borderRadius: 7, fontSize: 13 }}>
            <option value="">ทุกส่วนงาน</option>
            {sectionOpts.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>วางแผนที่กำลัง:</span>
          <button onClick={() => setCapMode('median')} style={btnSt(capMode === 'median')} title="ใช้ median ของยอดที่เคยทำได้จริง (สมจริง)">ปกติ (median)</button>
          <button onClick={() => setCapMode('safe')} style={btnSt(capMode === 'safe')} title="ใช้ P25 — เผื่อวันที่ทำได้น้อย (ปลอดภัยไว้ก่อน)">ปลอดภัย (P25)</button>
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
        กำลังผลิตคำนวณจาก <b>median ยอดดีจริงต่อกะ</b> ใน {HISTORY_DAYS} วันล่าสุด (ตัดค่าโดดอัตโนมัติ) · พาร์ทที่ไม่มีประวัติ fallback เป็น cycle time × OEE
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>กำลังวิเคราะห์กำลังผลิต…</div>
      ) : tab === 'daily' ? (
        daily.length === 0 ? <div style={{ ...card, color: 'var(--muted)', fontSize: 13 }}>ไม่มีออเดอร์ค้างส่งในช่วง {DAILY_HORIZON} วันข้างหน้า สำหรับไลน์ใน scope</div> :
        daily.map(({ line, days, otDays, nightDays, recall75Days, holidayDays, endBacklog, unknownCap, orderCount }) => (
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
                    <div style={{ fontSize: 10, color: d.sd75 ? '#a78bfa' : d.holiday ? '#ef4444' : 'var(--muted)' }}>{['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'][dd.getDay()]}</div>
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
        ))
      ) : (
        monthly.length === 0 ? <div style={{ ...card, color: 'var(--muted)', fontSize: 13 }}>ไม่มี forecast สำหรับไลน์ใน scope</div> :
        monthly.map(({ line, rows }) => (
          <div key={line.id} style={card}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', marginBottom: 6 }}>{line.name} <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>{line.section}{(line.std_night_shift || 0) > 0 ? ' · มีกะดึก' : ' · กะเช้าอย่างเดียว'}</span></div>
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
                      <td style={td}>{r.dayShifts}{(line.std_night_shift || 0) > 0 ? ` (+ดึก ${r.dayShifts})` : ''}</td>
                      <td style={{ ...td, textAlign: 'left' }}><span style={chip(r.color)}>{r.verdict}</span>{r.unknownCap > 0 && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--muted)' }}>({r.unknownCap.toLocaleString()} ชิ้นไม่รู้กำลัง)</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
