/* ⚡ บอร์ดค่าไฟสด — /energy แท็บ "ค่าไฟสด" (2026-11-09 · คำสั่ง user "จัดเต็ม")
   ต้นแบบหน้าตา: dashboard Node-RED ของ Die Shop (TSS Smart Energy) — ย้ายมาอยู่ใน ESM
   ตัวส่ง: Node-RED อ่าน MySQL energy_sec → POST edge `ingest-energy` ทุก 1 นาที
   แบบเต็ม: docs/ENERGY_MONITORING_DESIGN.md §15

   ⚠️ สูตรสถานะ/ยอดตู้/แจ้งเตือน = buildLiveBoard() + liveSeries() ใน utils/energy.js เท่านั้น
   ⚠️ ไม่รู้ = "—" ห้ามโชว์ 0 · "ไม่เคยได้รับค่า" ≠ "ขาดการติดต่อ" ≠ "ค่าเป็น 0"
   ⚠️ egress: กราฟเส้นโหลดทั้งวันครั้งเดียว แล้วรอบถัดไปดึงเฉพาะนาทีที่ใหม่กว่า (RATE.METER)
   🔍 คลิกการ์ด/กล่องในผังจ่ายไฟ = หน้ารายตู้ `?meter=<ชื่อตู้>` (EnergyMeterDetail · คนละ param กับ `?tab=`) */
import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabaseDR } from '../supabaseClient';
import { usePolling } from '../utils/usePolling';
import { RATE } from '../utils/refreshRates';
import { bkkDateStr, addDaysStr } from '../utils/workDate';
import { buildLiveBoard, liveSeries, METER_OFFLINE_MIN, demandWindows, DEMAND_WINDOW_MIN, demandKwFromKwh, efFor, co2eKg, fmtTco2e, windowAvgKw, baselineCompare } from '../utils/energy';
import NoticeBar from './NoticeBar';
import useIsMobile from '../utils/useIsMobile';
import { fetchReadingsSince } from '../lib/energyReadings';
import EnergyMeterDetail from './EnergyMeterDetail';

import { tr, dateLocale } from '../utils/i18n';
/* สีผ่าน token เท่านั้น (ด่าน colorRatchet · พาเลต ≤5 สี) */
const GOOD = 'var(--green)', WARN = 'var(--amber)', BAD = 'var(--red)', IDLE = 'var(--muted)', ACC = 'var(--accent2)', INFO = 'var(--blue)';
const EVENTS_SHOW = 50;
const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 14, boxShadow: 'var(--shadow-sm)' };

const fmt = (v, d = 1) => (v == null || !Number.isFinite(Number(v)) ? '—'
  : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const timeTh = (ms) => (ms == null ? '—'
  : new Date(ms).toLocaleTimeString(dateLocale(), { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }));
const statusMeta = (m) => (
  m.status === 'never' ? { label: 'ยังไม่เคยได้รับค่า', color: IDLE }
    : m.status === 'offline' ? { label: `${tr("ขาดการติดต่อ")} ${m.ageMin} ${tr("นาที")}`, color: WARN }
      : (m.overKw || m.overA) ? { label: 'เกินลิมิต', color: BAD }
        // ⏸️ ทำงาน/รอ (27/11) — เฉพาะมิเตอร์ที่ตั้งเกณฑ์ (idle_kw) · ไม่ตั้ง = "ออนไลน์" ตามเดิม
        : m.runState === 'idle' ? { label: `${tr('รอ')} (< ${fmt(m.idleKw, 1)} kW)`, color: WARN }
          : m.runState === 'run' ? { label: 'ทำงาน', color: GOOD }
            : { label: 'ออนไลน์', color: GOOD });

export default function EnergyLiveBoard() {
  const [meters, setMeters] = useState([]);
  const [live, setLive] = useState([]);
  const [daily, setDaily] = useState([]);
  const [readings, setReadings] = useState([]);
  const [events, setEvents] = useState(null);          // 🔔 เหตุการณ์จาก Node-RED (ใหม่อยู่บน · เก็บ 50 แถว) · null = อ่านไม่ได้/ยังไม่มีตาราง
  const evLast = useRef(null);                         // ev_time ล่าสุดที่มีแล้ว — รอบ poll ดึงเฉพาะที่ใหม่กว่า (กฎ egress)
  const [machinesOf, setMachinesOf] = useState({});   // key ตู้ → [{ no, line }] (energy_meter_machines · ไม่มีตาราง = ว่าง)
  const [err, setErr] = useState('');
  const [missing, setMissing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [panelCfg, setPanelCfg] = useState(null);
  const [openAlerts, setOpenAlerts] = useState(null);   // 🔔 แจ้งเตือนที่ยังไม่หาย (fn_energy_open_alerts · 27/11) · null = ยังโหลด · { err } · { rows }
  const [factors, setFactors] = useState(null);     // energy_emission_factors · null = ยังโหลด · { err } = อ่านไม่ได้   // { [panel]: { demand_target_kw } } · { err:true } = อ่านไม่ได้
  const [nowMs, setNowMs] = useState(() => Date.now());
  const cursor = useRef({ day: null, last: null });   // กราฟ: วันที่โหลดอยู่ + นาทีล่าสุดที่มีแล้ว
  const reqId = useRef(0);
  const [params, setParams] = useSearchParams();
  const meterParam = params.get('meter') || '';
  const openMeter = useCallback((name) => {
    setParams(prev => { const n = new URLSearchParams(prev); if (name) n.set('meter', name); else n.delete('meter'); return n; });
    try { window.scrollTo({ top: 0 }); } catch { /* ไม่มี window (เทส) */ }
  }, [setParams]);
  /* 📈 หน้าประวัติ & Excel = แท็บ history ของ /energy (`?hm=<ตู้>` · คนละ param กับ ?meter=) */
  const openHistory = useCallback((name) => {
    setParams(prev => { const n = new URLSearchParams(prev); n.set('tab', 'history'); n.delete('meter'); if (name) n.set('hm', name); else n.delete('hm'); return n; });
    try { window.scrollTo({ top: 0 }); } catch { /* ไม่มี window (เทส) */ }
  }, [setParams]);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    const now = Date.now();
    const today = bkkDateStr(now);
    const monthStart = `${today.slice(0, 7)}-01`;
    const newDay = cursor.current.day !== today;
    const from = newDay ? `${today}T00:00:00+07:00` : cursor.current.last;
    try {
      const [m, l, d, r] = await Promise.all([
        supabaseDR.from('energy_live_meters')
          .select('scope_kind, scope_name, display_name, panel, parent_name, subtitle, limit_kw, limit_a, gauge_max_kw, idle_kw, sort_order')
          .eq('is_active', true),
        supabaseDR.from('energy_live').select('scope_kind, scope_name, field, value, received_at'),
        supabaseDR.from('energy_daily')
          .select('scope_kind, scope_name, day, kwh, peak_kw, peak_at, resets').gte('day', monthStart),
        fetchReadingsSince(from, newDay, { kwh: true }),
      ]);
      /* 🌱 EF ไฟฟ้า (ทะเบียนเดียวกับแท็บ "ค่าการปล่อย" · 25/11) — best-effort: อ่านไม่ได้ = การ์ด CO₂ เขียนบอก */
      const fx = await supabaseDR.from('energy_emission_factors').select('utility_key, kg_co2e, effective_from, source_ref').eq('utility_key', 'electric');
      if (id === reqId.current) setFactors(fx.error ? { err: true } : (fx.data || []));
      /* 🎯 เป้า Demand 15 นาทีต่อตู้ (energy_panel_settings · 25/11) — best-effort: อ่านไม่ได้ = การ์ดเขียนว่าอ่านเป้าไม่ได้ */
      const ps = await supabaseDR.from('energy_panel_settings').select('panel, demand_target_kw, baseline_start, baseline_end');
      if (id === reqId.current) setPanelCfg(ps.error ? { err: true } : Object.fromEntries((ps.data || []).map(x => [x.panel, x])));
      /* 🔔 แจ้งเตือนที่ยังค้าง = START ที่ยังไม่มี CLEAR ตามหลัง + ขาดการติดต่อที่ยังไม่กลับ (ฝั่ง DB คิดคู่ให้ · 30 วัน)
         อ่านไม่ได้ = การ์ดเขียนบอก ห้ามโชว์ 0 */
      const oa = await supabaseDR.rpc('fn_energy_open_alerts', { p_days: 30 });
      if (id === reqId.current) setOpenAlerts(oa.error ? { err: oa.error.message } : { rows: oa.data || [] });
      // เครื่องใต้ตู้ — best-effort: ตารางยังไม่ apply / อ่านไม่ได้ = การ์ดไม่มีรายชื่อเครื่อง (ตัวเลขยังขึ้นปกติ)
      const mm = await supabaseDR.from('energy_meter_machines').select('scope_kind, scope_name, machines(machine_no, line_name)');
      if (id === reqId.current && !mm.error) {
        const by = {};
        for (const x of mm.data || []) {
          if (!x.machines) continue;
          (by[`${x.scope_kind}|${x.scope_name}`] ||= []).push({ no: x.machines.machine_no, line: x.machines.line_name });
        }
        setMachinesOf(by);
      }
      /* 🔔 เหตุการณ์ (energy_events) — ครั้งแรก 50 แถวล่าสุด · รอบต่อไปเฉพาะที่ใหม่กว่า · อ่านไม่ได้ = ซ่อนแผง (ตัวเลขยังขึ้น) */
      const evQ = supabaseDR.from('energy_events')
        .select('source_id, scope_name, ev_time, level, code, kind, message, duration_s');
      const ev = evLast.current
        ? await evQ.gt('ev_time', evLast.current).order('ev_time', { ascending: false }).limit(EVENTS_SHOW)
        : await evQ.order('ev_time', { ascending: false }).limit(EVENTS_SHOW);
      if (id === reqId.current) {
        if (ev.error) setEvents(prev => (prev && prev.length ? prev : null));
        else {
          if (ev.data?.length) evLast.current = ev.data[0].ev_time;
          setEvents(prev => {
            const seen = new Set((ev.data || []).map(x => x.source_id));
            return [...(ev.data || []), ...(prev || []).filter(x => !seen.has(x.source_id))].slice(0, EVENTS_SHOW);
          });
        }
      }
      if (id !== reqId.current) return;   // มีรอบใหม่กว่าแล้ว — ทิ้งผลเก่า
      const e = m.error || l.error || d.error;
      if (e) {
        const isMissing = e.code === '42P01' || e.code === 'PGRST205';
        setMissing(isMissing);
        setErr(isMissing ? '' : e.message);
        return;
      }
      setMissing(false); setErr('');
      setMeters(m.data || []); setLive(l.data || []); setDaily(d.data || []);
      setReadings(prev => (newDay ? r : [...prev, ...r]));
      const last = r.length ? r[r.length - 1].bucket_at : null;
      cursor.current = { day: today, last: last || (newDay ? `${today}T00:00:00+07:00` : cursor.current.last) };
      setNowMs(now);
    } catch (ex) {
      if (id !== reqId.current) return;
      if (ex?.code === '42P01' || ex?.code === 'PGRST205') setMissing(true);
      else setErr(ex?.message || String(ex));
    } finally {
      if (id === reqId.current) setLoaded(true);
    }
  }, []);
  usePolling(load, RATE.METER);

  const today = bkkDateStr(nowMs);
  const ef = Array.isArray(factors) ? efFor('electric', today.slice(0, 7), factors) : null;
  const board = useMemo(() => buildLiveBoard({ meters, live, daily, today, nowMs }), [meters, live, daily, today, nowMs]);
  const byKey = useMemo(() => new Map(board.meters.map(m => [m.key, m])), [board.meters]);
  const panelParam = params.get('panel') || '';
  const shownPanel = board.panels.find(p => p.panel === panelParam) || board.panels[0] || null;
  const pickPanel = useCallback((name) => {
    setParams(prev => { const n = new URLSearchParams(prev); n.set('panel', name); return n; }, { replace: true });
  }, [setParams]);
  const series = useMemo(() => liveSeries(readings, meters), [readings, meters]);
  const panelPeaks = useMemo(() => {
    const out = {};
    for (const p of board.panels) {
      // 🌳 peak ตู้ = ผลรวมชั้นบนสุดของตู้ (ลูกอยู่ในยอดแม่แล้ว) — ไม่มีผังแม่-ลูก = เหมือนเดิม
      const rootNames = new Set(p.roots.map(m => m.name));
      out[p.panel] = liveSeries(readings, meters.filter(m => rootNames.has(m.scope_name))).panelPeak;
    }
    return out;
  }, [board.panels, readings, meters]);

  if (missing) return (
    <NoticeBar tone="bad">{tr('ยังไม่ได้ apply migration')} <code>20261109_energy_live_board</code> {tr('(DR) — แจ้ง admin')}</NoticeBar>
  );
  if (!loaded) return <div style={{ color: 'var(--muted)', padding: 20 }}>{tr('กำลังโหลด…')}</div>;

  /* 🔍 หน้ารายตู้ — ชื่อใน URL ไม่ตรงทะเบียน = บอกตรงๆ + ปุ่มกลับ (ห้ามเด้งกลับเงียบ) */
  if (meterParam) {
    const dm = board.meters.find(x => x.name === meterParam);
    if (!dm) return (
      <div style={{ display: 'grid', gap: 10 }}>
        <NoticeBar tone="warn">{tr('ไม่พบตู้')} <b>{meterParam}</b> {tr('ในทะเบียนบอร์ดสด (อาจถูกปิดใช้/เปลี่ยนชื่อ)')}</NoticeBar>
        <div><button type="button" className="pg-btn" onClick={() => openMeter(null)}>{tr('← กลับบอร์ดรวม')}</button></div>
      </div>
    );
    return <EnergyMeterDetail key={dm.key} m={dm} machines={machinesOf[dm.key] || []} boardMeters={board.meters}
      totalTodayKwh={board.totals.todayKwh} onBack={() => openMeter(null)} onOpenMeter={openMeter} onHistory={openHistory} />;
  }

  const t = board.totals;
  const labelOf = (name) => board.meters.find(x => x.name === name)?.label || name;
  const runCount = board.meters.reduce((c, m) => {
    if (m.idleKw != null) c.set++;
    if (m.runState === 'run') c.run++; else if (m.runState === 'idle') c.idle++;
    return c;
  }, { set: 0, run: 0, idle: 0 });
  const lastRecv = board.meters.map(m => m.receivedAt).filter(Boolean).sort().pop();
  const allPeak = Object.values(panelPeaks).filter(Boolean);

  return (
    <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
      {err && <NoticeBar tone="bad">{tr('โหลดค่ามิเตอร์ไม่สำเร็จ:')} {err} {tr('— ตัวเลขบนจอเป็นของรอบก่อนหน้า')}</NoticeBar>}
      {!board.meters.length && (
        <NoticeBar tone="warn">{tr('ยังไม่มีมิเตอร์ในทะเบียนบอร์ดสด (')}<code>energy_live_meters</code>)</NoticeBar>
      )}
      {board.meters.length > 0 && t.never === t.total && (
        <NoticeBar tone="warn">
          <b>{tr('ยังไม่เคยได้รับค่าจากมิเตอร์เลย')}</b> — {tr("ตัวส่ง (Node-RED) ต้อง POST ชื่อ topic ให้ตรงกับที่ผูกไว้ใน ตั้งค่า › การเชื่อมต่อ Node-RED / เครื่องจักร (/integrations) เช่น")} <code>dieshop/DB-ROBOT/kw</code> · {tr("ช่องทั้งหมดจึงขึ้น \"—\" (ไม่ใช่")} 0)
        </NoticeBar>
      )}
      {t.resets > 0 && (
        <NoticeBar tone="warn">{tr('เลขมิเตอร์ถอยหลังวันนี้')} {t.resets} {tr('ครั้ง (reset / เปลี่ยนมิเตอร์) — ช่วงนั้นไม่ถูกนับเป็นหน่วยไฟ ยอดวันนี้อาจต่ำกว่าจริง')}</NoticeBar>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 12.5, color: 'var(--text2)' }}>
          {tr("ค่าจากมิเตอร์ทุกเครื่อง · ตัวส่งยิงทุก 1 นาที · จอดึงใหม่ทุก 1 นาที · ไม่มีค่าใหม่เกิน")} {METER_OFFLINE_MIN} {tr("นาที = ขาดการติดต่อ")}
        </div>
        <button type="button" className="pg-btn" style={{ marginLeft: 'auto' }} onClick={() => openHistory(null)}>📈 {tr('ประวัติ & Excel')}</button>
        <div style={{ ...card, padding: '6px 12px', fontSize: 12.5, color: 'var(--text2)' }}>
          {tr("รับข้อมูลล่าสุด")} {lastRecv ? new Date(lastRecv).toLocaleString(dateLocale(), { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
        </div>
      </div>

      {/* ── KPI ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10, alignContent: 'start' }}>
        <Kpi color={ACC} label={tr('กำลังไฟรวมขณะนี้')} value={fmt(t.kw)} unit="kW"
          sub={<>{tr('ออนไลน์')} {t.online}/{t.total} {tr('เครื่อง')}{allPeak.length > 0 && <> {tr('· สูงสุดวันนี้')} {fmt(Math.max(...allPeak.map(p => p.kw)))} kW ({timeTh(allPeak.reduce((a, b) => (b.kw > a.kw ? b : a)).at)})</>}</>} />
        <Kpi color={INFO} label={tr('ใช้ไฟวันนี้')} value={fmt(t.todayKwh)} unit="kWh" sub={tr('นับจากเลขมิเตอร์ ตั้งแต่ 00:00 น.')} />
        <Kpi color={INFO} label={tr('ใช้ไฟเดือนนี้')} value={fmt(t.monthKwh, 0)} unit="kWh"
          sub={t.avgPerDay != null ? `${tr("เฉลี่ยวันละ")} ${fmt(t.avgPerDay)} kWh (${t.monthDays} ${tr("วันที่มีข้อมูล")})` : tr("ยังไม่มีข้อมูลของเดือนนี้")} />
        {/* 🌱 CO₂ วันนี้/เดือนนี้ (25/11 · คำสั่ง user) — kWh จากมิเตอร์ชั้นบนสุด × EF ของเดือนนี้ (efFor/co2eKg ที่เดียวกับแท็บรายเดือน)
            ไม่มี EF / อ่านไม่ได้ = เขียนบอก ห้ามโชว์ 0 · แท็บรายเดือนใช้ยอดบิลเมื่อมี ⇒ ตัวเลขอาจต่างกัน (บอกบนการ์ด) */}
        <Kpi color={GOOD} label={tr('CO₂ ที่ปล่อยวันนี้')} value={ef ? fmtTco2e(co2eKg(t.todayKwh, ef)) : '—'} unit="tCO₂e"
          sub={factors?.err ? <span style={{ color: WARN }}>{tr('อ่านค่าการปล่อย (EF) ไม่ได้')}</span>
            : !ef ? (factors == null ? '…' : <span style={{ color: WARN }}>{tr('ยังไม่ได้ตั้งค่าการปล่อย (EF) — แท็บค่าการปล่อย')}</span>)
            : <>{tr('เดือนนี้')} <b>{fmtTco2e(co2eKg(t.monthKwh, ef))}</b> tCO₂e · EF {Number(ef.kg_co2e)} kgCO₂e/kWh
                {/* แยกรายตู้ (25/11 · user เลือก "รวมทั้งโรงงาน + แยกรายตู้") — แต่ละตู้มาจากต้นทาง/ทีมต่างกัน เทียบจอ Node-RED ของทีมนั้นได้ */}
                {board.panels.length > 1 && board.panels.map(p => (
                  <div key={p.panel}>{tr('ตู้')} {p.panel}: {fmtTco2e(co2eKg(p.todayKwh, ef))} / {fmtTco2e(co2eKg(p.monthKwh, ef))} t <span style={{ color: 'var(--muted)' }}>({tr('วันนี้ / เดือนนี้')})</span></div>
                ))}
                <span style={{ color: 'var(--muted)' }}>{tr('รวมทุกตู้บนบอร์ด (Scope 2) · แท็บรายเดือนใช้ยอดบิลเมื่อมี')}</span></>} />
        <Kpi color={t.offline || t.never ? WARN : GOOD} label={tr('สถานะมิเตอร์')} value={t.online} unit={`/ ${t.total} ${tr("ออนไลน์")}`}
          sub={<><span style={{ color: WARN }}>{tr('ขาดการติดต่อ')} {t.offline}</span> · <span style={{ color: 'var(--muted)' }}>{tr('ยังไม่เคยส่ง')} {t.never}</span>
            {/* ⏸️ ทำงาน/รอ — นับเฉพาะมิเตอร์ที่ตั้งเกณฑ์แล้ว · ไม่มีเลย = บอกว่ายังไม่ได้ตั้ง */}
            <div>{runCount.set
              ? <>{tr('ทำงาน')} {runCount.run} · <span style={{ color: WARN }}>{tr('รอ')} {runCount.idle}</span> <span style={{ color: 'var(--muted)' }}>({tr('ตั้งเกณฑ์แล้ว')} {runCount.set}/{t.total})</span></>
              : <span style={{ color: 'var(--muted)' }}>{tr('ยังไม่ได้ตั้งเกณฑ์รอ — แท็บตั้งค่าตู้')}</span>}</div></>} />
        <Kpi color={t.alerts.length ? BAD : GOOD} label={tr('เกินลิมิตตอนนี้')} value={t.alerts.length} unit={tr("เครื่อง")}
          sub={t.alerts.length ? `${tr("ที่")} ${t.alerts.map(m => m.label).join(', ')}` : tr("ทุกเครื่องอยู่ในลิมิต (นับเฉพาะเครื่องที่ออนไลน์)")} />
        {/* 🔔 แจ้งเตือนที่ยังค้าง (27/11) — จากเหตุการณ์ Node-RED: เริ่มแล้วยังไม่หาย · คนละตัวกับ "เกินลิมิตตอนนี้" (ค่าสดที่จอตัดสิน) */}
        <Kpi color={openAlerts?.rows?.length ? BAD : openAlerts?.err ? WARN : GOOD} label={tr('แจ้งเตือนที่ยังค้าง')}
          value={openAlerts?.rows ? openAlerts.rows.length : '—'} unit={tr('รายการ')}
          sub={openAlerts == null ? '…' : openAlerts.err ? <span style={{ color: WARN }}>{tr('อ่านแจ้งเตือนไม่ได้')}</span>
            : !openAlerts.rows.length ? tr('ไม่มีแจ้งเตือนค้าง (30 วันล่าสุด)')
            : <>{openAlerts.rows.slice(0, 3).map((a, i) => <div key={i}>{labelOf(a.scope_name)}: {a.message || a.code} <span style={{ color: 'var(--muted)' }}>({tr('ตั้งแต่')} {new Date(a.ev_time).toLocaleString(dateLocale(), { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })})</span></div>)}
                {openAlerts.rows.length > 3 && <span style={{ color: 'var(--muted)' }}>{tr('และอีก')} {openAlerts.rows.length - 3} {tr('รายการ')}</span>}</>} />
      </div>

      {/* ── เส้นทางจ่ายไฟ ── */}
      {(board.warnings.orphans.length > 0 || board.warnings.cycles.length > 0) && (
        <NoticeBar tone="warn">
          {tr("ผังจ่ายไฟ")}: {board.warnings.orphans.map(o => `${o.name} ${tr("ชี้แม่")} "${o.parent}" ${tr("ที่ไม่มีในทะเบียน")}`).join(' · ')}
          {board.warnings.cycles.length > 0 && ` · ${tr("ตั้งแม่วนกัน")}: ${board.warnings.cycles.join(', ')}`} — {tr("แสดงเป็นชั้นบนสุดของตู้ไว้ก่อน (แก้ parent_name ในทะเบียน")})
        </NoticeBar>
      )}
      {/* 🗂️ เลือกดูทีละตู้ (23/11 · คำสั่ง user "10 ตู้ จอล้นลงไปยาว ไม่เอา") — `?panel=` (คนละ param กับ ?tab=/?meter=)
          ตู้ที่ไม่ได้เลือกต้องยังเห็นว่ามีเครื่องเกินลิมิต/ขาดการติดต่อ — ปุ่มเปลี่ยนสีตาม ห้ามซ่อนเงียบ */}
      {board.panels.length > 1 && (
        <div role="tablist" aria-label={tr('เลือกตู้')} style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {board.panels.map(p => {
            const on = p.panel === shownPanel?.panel;
            const alert = p.meters.some(m => m.overKw || m.overA);
            const tone = alert ? BAD : p.partial ? WARN : GOOD;
            return (
              <button key={p.panel} type="button" role="tab" aria-selected={on} onClick={() => pickPanel(p.panel)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 'var(--r-md)', cursor: 'pointer',
                  border: `1px solid ${on ? ACC : 'var(--border)'}`, background: on ? 'var(--accent-dim)' : 'var(--card)', color: 'var(--text)', fontSize: 13 }}>
                <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: tone, flexShrink: 0 }} />
                <b style={{ whiteSpace: 'nowrap' }}>{tr('ตู้')} {p.panel}</b>
                <span style={{ color: tone, fontWeight: 700, whiteSpace: 'nowrap' }}>{fmt(p.kw)} kW</span>
                <span style={{ color: 'var(--muted)', fontSize: 12, whiteSpace: 'nowrap' }}>{p.online}/{p.total}{alert ? ` · ${tr('เกินลิมิต')}` : ''}</span>
              </button>
            );
          })}
        </div>
      )}
      {shownPanel && <DemandCard panel={shownPanel} readings={readings} nowMs={nowMs} today={today} cfg={panelCfg} />}
      {shownPanel && <BaselineCard panel={shownPanel} readings={readings} nowMs={nowMs} today={today} cfg={panelCfg} />}
      {shownPanel && <TreeFlow key={shownPanel.panel} panel={shownPanel} byKey={byKey} onOpen={openMeter} />}

      {/* ── การ์ดรายเครื่อง ── */}
      {board.meters.length > 0 && (
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>{tr('เครื่องจักรทั้งหมด')} <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--muted)' }}>{tr('· คลิกการ์ดเพื่อเปิดหน้ารายตู้')}</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12, alignContent: 'start' }}>
            {board.meters.map(m => <MeterCard key={m.key} m={m} pts={series.byScope.get(m.key) || []} machines={machinesOf[m.key] || []} onOpen={openMeter} />)}
          </div>
        </div>
      )}

      {/* ลำดับแบบ Node-RED: KPI → ผังจ่ายไฟ → การ์ดรายเครื่อง → เหตุการณ์ */}
      {events && <EventsPanel events={events} />}
    </div>
  );
}

/** 🔔 เหตุการณ์ล่าสุดจาก Node-RED — Node-RED เป็นคนตัดสิน (ลิมิต/เกณฑ์อยู่ฝั่งนั้น) ESM แค่แสดง */
function EventsPanel({ events }) {
  const lvl = (e) => (e.kind === 'CLEAR' || e.level === 'ok'
    ? { label: 'ปกติแล้ว', color: GOOD } : { label: 'เตือน', color: e.level === 'alarm' || e.level === 'crit' ? BAD : WARN });
  return (
    <div style={{ ...card }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{tr('เหตุการณ์ล่าสุด')}</div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 8 }}>
        {tr("จากระบบไฟ Node-RED (เกณฑ์/ลิมิตตั้งที่")} Node-RED) · {EVENTS_SHOW} {tr("รายการล่าสุด · ใหม่อยู่บน · เก็บย้อนหลัง 30 วัน")}
      </div>
      {!events.length ? (
        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{tr('ยังไม่มีเหตุการณ์ที่ส่งมา')}</div>
      ) : (
        <div style={{ maxHeight: 280, overflowY: 'auto', display: 'grid', gap: 2 }}>
          {events.map(e => {
            const L = lvl(e);
            return (
              <div key={e.source_id} style={{ display: 'grid', gridTemplateColumns: '64px 92px 76px 1fr', gap: 8, alignItems: 'center', fontSize: 12.5, padding: '5px 6px', borderLeft: `3px solid ${L.color}`, background: 'var(--bg2)', borderRadius: 4 }}>
                <span style={{ color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
                  {new Date(e.ev_time).toLocaleTimeString(dateLocale(), { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <b style={{ color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.scope_name}</b>
                <span style={{ color: L.color, fontWeight: 700, fontSize: 11.5 }}>{tr(L.label)}</span>
                <span style={{ color: 'var(--text2)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.message}>{e.message}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Kpi({ color, label, value, unit, sub }) {
  return (
    <div style={{ ...card, borderLeft: `4px solid ${color}` }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text2)' }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text)', lineHeight: 1.2, marginTop: 4 }}>
        {value} <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--muted)' }}>{unit}</span>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>{sub}</div>
    </div>
  );
}

/** 🌳 ผังจ่ายไฟหลายชั้น (20/11 · คำสั่ง user "เอาผังวาดให้สมบูรณ์") — ใช้เมื่อตู้มีมิเตอร์ที่ตั้งแม่ (parent_name)
 *  ข้อมูล/ยอด/ไฟไม่มีมิเตอร์วัด มาจาก buildLiveBoard() เท่านั้น — ไฟล์นี้วาดอย่างเดียว
 *  ตู้ที่มีรากหลายตัว = กล่องตู้ (ผลรวมราก) เป็นชั้นแรก · รากตัวเดียว = กล่องมิเตอร์รากเป็นชั้นแรก (ค่าที่วัดจริงที่ตู้) */
const TREE = { colW: 280, boxW: 210, boxH: 72, rowH: 88, top: 16, left: 16 };
function treeOfPanel(panel, byKey) {
  const node = (m) => {
    const kids = m.children.map(k => node(byKey.get(k)));
    if (m.children.length) kids.push({ kind: 'unmetered', key: `${m.key}#u`, u: m.unmetered });
    return { kind: 'meter', key: m.key, m, kids };
  };
  const roots = panel.roots.map(node);
  return roots.length === 1 ? roots[0] : { kind: 'panel', key: `panel|${panel.panel}`, panel, kids: roots };
}
function layoutTree(root) {
  let row = 0, maxD = 0;
  const all = [], pre = [];                     // pre = แม่ก่อนลูก (ลิสต์มือถือ)
  const walk = (n, d) => {
    n.d = d; maxD = Math.max(maxD, d); pre.push(n);
    if (!n.kids?.length) { n.y = TREE.top + row * TREE.rowH + TREE.boxH / 2; row++; }
    else { n.kids.forEach(k => walk(k, d + 1)); n.y = (n.kids[0].y + n.kids[n.kids.length - 1].y) / 2; }
    n.x = TREE.left + d * TREE.colW;
    all.push(n);
  };
  walk(root, 0);
  return { all, pre, W: TREE.left * 2 + maxD * TREE.colW + TREE.boxW, H: TREE.top * 2 + row * TREE.rowH - (TREE.rowH - TREE.boxH) };
}
function flowDur(m) {
  const live = m && m.status === 'online' && m.kw != null && m.kw > 0;
  if (!live) return null;
  const ratio = m.gaugeMax ? Math.min(1, m.kw / m.gaugeMax) : 0;
  return (2.4 - 1.9 * ratio).toFixed(2);
}
function TreeFlow({ panel, byKey, onOpen }) {
  const isMobile = useIsMobile();
  const root = useMemo(() => treeOfPanel(panel, byKey), [panel, byKey]);
  const { all, pre, W, H } = useMemo(() => layoutTree(root), [root]);
  const uText = (u) => (!u || u.kw == null ? '—' : `${fmt(Math.max(0, u.kw))} kW`);
  const uNote = (u) => (!u || u.state === 'unknown' ? 'รู้เมื่อแม่+ลูกออนไลน์ครบ' : u.state === 'negative' ? 'ลูกรวมเกินแม่ — ตรวจผัง/มิเตอร์' : 'แม่ − ผลรวมลูก');
  const open = (n) => (n.kind === 'meter' ? () => onOpen(n.m.name) : undefined);
  return (
    <div style={{ ...card }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{tr('เส้นทางจ่ายไฟจากตู้')} {panel.panel}</div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
        {tr("ความเร็วเส้นแปรตามกำลังไฟที่ใช้ · ยอดตู้ = ชั้นบนสุดที่ออนไลน์")} ({panel.online}/{panel.total}{panel.partial ? tr(" · ยอดไม่ครบ") : ''}) · {tr("ลูกอยู่ในยอดแม่แล้ว ไม่นับซ้ำ · กรอบประ = ไฟที่ไม่มีมิเตอร์วัด")}
      </div>
      {isMobile ? (
        <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
          {pre.map(n => {
            if (n.kind === 'panel') return <div key={n.key} style={{ fontSize: 20, fontWeight: 800, color: ACC }}>{tr('ตู้')} {panel.panel} · {fmt(panel.kw)} kW</div>;
            if (n.kind === 'unmetered') return (
              <div key={n.key} style={{ paddingLeft: 8 + n.d * 14, fontSize: 12.5, color: n.u?.state === 'negative' ? BAD : 'var(--muted)' }}>┗ {tr("ไม่มีมิเตอร์วัด")} {uText(n.u)} · {uNote(n.u)}</div>
            );
            const sm = statusMeta(n.m);
            return (
              <div key={n.key} role="button" tabIndex={0} onClick={open(n)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(n.m.name); }}
                style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, borderLeft: `3px solid ${sm.color}`, paddingLeft: 8, marginLeft: n.d * 14, cursor: 'pointer' }}>
                <span style={{ fontWeight: 700, color: 'var(--text)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.m.label}</span>
                <span style={{ color: sm.color, whiteSpace: 'nowrap' }}>{fmt(n.m.kw)} kW · {fmt(n.m.a)} A</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W, minWidth: Math.min(W, 700), height: 'auto', display: 'block', marginTop: 6 }} role="img"
            aria-label={`${tr("ผังจ่ายไฟตู้")} ${panel.panel}`}>
            {all.filter(n => n.kids?.length).map(n => {
              const busX = n.x + TREE.boxW + (TREE.colW - TREE.boxW) / 2;
              const ys = n.kids.map(k => k.y);
              return (
                <g key={`e-${n.key}`}>
                  <line x1={n.x + TREE.boxW} y1={n.y} x2={busX} y2={n.y} stroke={ACC} strokeWidth="4" />
                  <line x1={busX} y1={Math.min(...ys)} x2={busX} y2={Math.max(...ys)} stroke={ACC} strokeWidth="4" />
                  {n.kids.map(k => {
                    const dur = k.kind === 'meter' ? flowDur(k.m) : null;
                    return (
                      <g key={`l-${k.key}`}>
                        <line x1={busX} y1={k.y} x2={k.x} y2={k.y} stroke="var(--border)" strokeWidth="4" />
                        <line x1={busX} y1={k.y} x2={k.x} y2={k.y} stroke={dur ? ACC : IDLE} strokeWidth="4" strokeDasharray={k.kind === 'unmetered' ? '4 6' : '14 8'}
                          className={dur ? 'energy-flow' : undefined} style={dur ? { animationDuration: `${dur}s` } : undefined} />
                      </g>
                    );
                  })}
                </g>
              );
            })}
            {all.map(n => {
              const top = n.y - TREE.boxH / 2;
              if (n.kind === 'panel') return (
                <g key={n.key}>
                  <rect x={n.x} y={top} width={TREE.boxW} height={TREE.boxH} rx="12" fill={ACC} opacity="0.9" />
                  <text x={n.x + TREE.boxW / 2} y={top + 24} textAnchor="middle" fill="var(--bg)" fontSize="15" fontWeight="700">{tr('ตู้')} {panel.panel}</text>
                  <text x={n.x + TREE.boxW / 2} y={top + 54} textAnchor="middle" fill="var(--bg)" fontSize="24" fontWeight="800">{fmt(panel.kw)} kW</text>
                </g>
              );
              if (n.kind === 'unmetered') {
                const bad = n.u?.state === 'negative';
                return (
                  <g key={n.key}>
                    <title>{tr("ไฟที่ไม่มีมิเตอร์วัด = แม่ − ผลรวมลูก")}</title>
                    <rect x={n.x} y={top} width={TREE.boxW} height={TREE.boxH} rx="10" fill="var(--card)" stroke={bad ? BAD : IDLE} strokeWidth="2" strokeDasharray="6 5" />
                    <text x={n.x + 14} y={top + 24} fill="var(--muted)" fontSize="14" fontWeight="700">{tr("ไม่มีมิเตอร์วัด")}</text>
                    <text x={n.x + 14} y={top + 46} fill={bad ? BAD : 'var(--text)'} fontSize="18" fontWeight="800">{uText(n.u)}</text>
                    <text x={n.x + 14} y={top + 64} fill={bad ? BAD : 'var(--muted)'} fontSize="12">{uNote(n.u)}</text>
                  </g>
                );
              }
              const m = n.m, sm = statusMeta(m), isTop = n.d === 0;
              return (
                <g key={n.key} role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={open(n)}
                  onKeyDown={(e) => { if (e.key === 'Enter') onOpen(m.name); }}>
                  <title>{tr('เปิดหน้ารายตู้')} {m.label}</title>
                  <rect x={n.x} y={top} width={TREE.boxW} height={TREE.boxH} rx="10" fill={isTop ? ACC : 'var(--card)'} opacity={isTop ? 0.9 : 1} stroke={sm.color} strokeWidth="3" />
                  <circle cx={n.x + 16} cy={top + 19} r="6" fill={sm.color} />
                  <text x={n.x + 30} y={top + 25} fill={isTop ? 'var(--bg)' : 'var(--text)'} fontSize="16" fontWeight="800">
                    <title>{m.label}</title>{m.label.length > 18 ? `${m.label.slice(0, 17)}…` : m.label}
                  </text>
                  <text x={n.x + 14} y={top + 48} fill={isTop ? 'var(--bg)' : sm.color} fontSize="18" fontWeight="800">{fmt(m.kw)} kW · {fmt(m.a)} A</text>
                  <text x={n.x + 14} y={top + 65} fill={isTop ? 'var(--bg)' : sm.color} fontSize="12" fontWeight="700">{tr(sm.label)}</text>
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </div>
  );
}

function MeterCard({ m, pts, machines, onOpen }) {
  const sm = statusMeta(m);
  return (
    <div role="button" tabIndex={0} title={`${tr("เปิดหน้ารายตู้")} ${m.label}`} onClick={() => onOpen(m.name)}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(m.name); }}
      style={{ ...card, borderColor: sm.color === GOOD ? 'var(--border)' : sm.color, cursor: 'pointer' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>{m.label}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{m.subtitle}</div>
          {machines.length > 0 && (
            <div style={{ fontSize: 11.5, color: 'var(--text2)' }} title={machines.map(x => `${x.no} (${x.line})`).join(', ')}>
              {tr("จ่ายให้")} {machines.length} {tr('เครื่อง:')} {machines.map(x => x.no).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join(', ')}
            </div>
          )}
          <div style={{ fontSize: 12, color: 'var(--text2)' }}>
            {tr("ลิมิต")} <b style={{ color: GOOD }}>{m.limitKw ?? '—'} kW</b> · <b style={{ color: ACC }}>{m.limitA ?? '—'} A</b>
          </div>
        </div>
        <span style={{ alignSelf: 'flex-start', fontSize: 11.5, fontWeight: 700, color: sm.color, border: `1px solid ${sm.color}`, borderRadius: 999, padding: '2px 10px', whiteSpace: 'nowrap' }}>
          ● {sm.label}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 10, marginTop: 10, alignItems: 'center' }}>
        <Gauge kw={m.kw} max={m.gaugeMax} color={m.status !== 'online' ? IDLE : m.overKw ? BAD : GOOD} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <Stat label={tr('แรงดัน (เฉลี่ย 3 เฟส)')} value={fmt(m.v, 0)} unit="V" color={INFO} />
          <Stat label={tr('กระแส (เฟสสูงสุด)')} value={fmt(m.a)} unit="A" color={m.overA ? BAD : ACC} />
          <Stat label={tr('ใช้วันนี้')} value={fmt(m.todayKwh)} unit="kWh" color={INFO} />
          <Stat label={tr('เลขมิเตอร์')} value={fmt(m.kwhTotal, 0)} unit="kWh" color={INFO} />
        </div>
      </div>

      <Spark pts={pts} limit={m.limitKw} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--muted)', marginTop: 4, gap: 8 }}>
        <span>{m.ageMin == null ? tr("ยังไม่เคยได้รับค่า") : m.ageMin < 1 ? tr("อัปเดตเมื่อสักครู่") : `${tr("อัปเดต")} ${m.ageMin} ${tr("นาทีที่แล้ว")}`}</span>
        <span>{m.peakKw != null ? `${tr("สูงสุดวันนี้")} ${fmt(m.peakKw)} kW (${timeTh(Date.parse(m.peakAt))})` : ''}</span>
      </div>
    </div>
  );
}

function Stat({ label, value, unit, color }) {
  return (
    <div style={{ background: 'var(--bg2-surf)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 8px' }}>
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 800, color }}>{value} <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 500 }}>{unit}</span></div>
    </div>
  );
}

/** เกจครึ่งวงล่างเปิด (270°) — ไม่รู้สเกล/ไม่รู้ค่า = วงเทาว่าง ไม่วาดเข็มที่ 0 */
function Gauge({ kw, max, color }) {
  const R = 46, C = 60, sweep = 270, start = 135;
  const pt = (deg) => [C + R * Math.cos((deg * Math.PI) / 180), C + R * Math.sin((deg * Math.PI) / 180)];
  const arc = (a0, a1) => {
    const [x0, y0] = pt(a0), [x1, y1] = pt(a1);
    return `M ${x0} ${y0} A ${R} ${R} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
  };
  const ratio = kw != null && max ? Math.max(0, Math.min(1, kw / max)) : null;
  return (
    <svg viewBox="0 0 120 120" style={{ width: 120, height: 120 }} role="img" aria-label={`${fmt(kw)} kW`}>
      <path d={arc(start, start + sweep)} stroke="var(--border)" strokeWidth="10" fill="none" strokeLinecap="round" />
      {ratio != null && ratio > 0 && (
        <path d={arc(start, start + sweep * ratio)} stroke={color} strokeWidth="10" fill="none" strokeLinecap="round" />
      )}
      <text x="60" y="62" textAnchor="middle" fill={color} fontSize="24" fontWeight="800">{fmt(kw)}</text>
      <text x="60" y="80" textAnchor="middle" fill="var(--muted)" fontSize="12">kW</text>
      <text x="60" y="112" textAnchor="middle" fill="var(--muted)" fontSize="11">{tr('สเกล 0–')}{max != null ? Math.round(max) : '?'}</text>
    </svg>
  );
}

/** กราฟเส้น kW วันนี้ (รายนาที) · เส้นประ = ลิมิต · ช่วงที่ขาดเกิน 5 นาทีไม่ลากเส้นต่อ */
function Spark({ pts, limit }) {
  if (pts.length < 2) {
    return <div style={{ height: 56, marginTop: 10, display: 'grid', placeItems: 'center', fontSize: 11.5, color: 'var(--muted)', border: '1px dashed var(--border)', borderRadius: 8 }}>
      {tr("ยังไม่มีค่ารายนาทีของวันนี้")}
    </div>;
  }
  const W = 600, H = 56;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const maxY = Math.max(...pts.map(p => p.kw), limit || 0) * 1.1 || 1;
  const x = (t) => (t1 === t0 ? 0 : ((t - t0) / (t1 - t0)) * W);
  const y = (v) => H - (v / maxY) * H;
  let d = '';
  pts.forEach((p, i) => {
    const gap = i > 0 && p.t - pts[i - 1].t > 5 * 60000;
    d += `${i === 0 || gap ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.kw).toFixed(1)} `;
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 56, display: 'block', marginTop: 10 }}
      role="img" aria-label={tr('กราฟกำลังไฟวันนี้')}>
      {limit != null && <line x1="0" x2={W} y1={y(limit)} y2={y(limit)} stroke={BAD} strokeDasharray="6 6" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
      <path d={d} fill="none" stroke={GOOD} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** ⚡ Demand 15 นาที ของตู้ที่เลือก (25/11 · คำสั่ง user · แบบการ์ด Node-RED) — ตัวเลขทั้งหมดจาก demandWindows() ไฟล์นี้วาดอย่างเดียว
 *  เป้า = energy_panel_settings.demand_target_kw (ตั้งที่แท็บ "ตั้งค่าตู้") · ไม่มีเป้า = เขียนบอก ไม่ตัดสินสี */
const DEMAND_BARS = 24;   // 6 ชม. ล่าสุด
function DemandCard({ panel, readings, nowMs, today, cfg }) {
  const names = useMemo(() => panel.roots.map(m => m.name), [panel]);
  const d = useMemo(() => demandWindows({
    readings, names, nowMs, dayStartMs: Date.parse(`${today}T00:00:00+07:00`),
    kwNow: panel.partial ? null : panel.kw,           // ตู้ออนไลน์ไม่ครบ = kW ตอนนี้ต่ำกว่าจริง ⇒ ไม่คาดการณ์
  }), [readings, names, nowMs, today, panel]);
  /* 📅 สูงสุดเดือนนี้ (25/11) — รายนาทีเก็บแค่ 7 วัน ⇒ อ่านจาก energy_demand_15m (trigger เติมทุกนาที) ผ่าน RPC
     โหลดเมื่อเปลี่ยนตู้/เดือน + ทุก 15 นาที · อ่านไม่ได้ = เขียนบอก ห้ามโชว์ค่าว่างเหมือนไม่มี */
  const namesKey = names.join('|');
  const monthKey = today.slice(0, 7);
  const [mon, setMon] = useState(null);           // null = ยังโหลด · { err } · { kw, at, first, n }
  const monReq = useRef(0);
  const loadMonth = useCallback(async () => {
    const id = ++monReq.current;
    const [y, m] = monthKey.split('-').map(Number);
    const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}`;
    const { data, error } = await supabaseDR.rpc('fn_energy_demand_month', {
      p_names: namesKey.split('|'), p_from: `${monthKey}-01T00:00:00+07:00`, p_to: `${next}-01T00:00:00+07:00`,
    });
    if (id !== monReq.current) return;
    const r = Array.isArray(data) ? data[0] : data;
    setMon(error ? { err: error.message } : {
      kw: demandKwFromKwh(r?.kwh), at: r?.window_start ? Date.parse(r.window_start) : null,
      first: r?.first_window ? Date.parse(r.first_window) : null, n: r?.windows_n ?? 0,
    });
  }, [namesKey, monthKey]);
  usePolling(loadMonth, RATE.BOARD);
  if (!d) return null;
  const target = cfg?.err ? null : (cfg?.[panel.panel]?.demand_target_kw != null ? Number(cfg[panel.panel].demand_target_kw) : null);
  const c = d.current;
  const over = (v) => target != null && v != null && v > target;
  const bars = d.windows.slice(-DEMAND_BARS);
  const top = Math.max(target || 0, ...bars.map(b => b.kw || 0), c.avgKw || 0, 1);
  const hm = (ms) => timeTh(ms);
  const dShort = (ms) => new Date(ms).toLocaleDateString(dateLocale(), { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short' });
  return (
    <div style={{ ...card, borderLeft: `4px solid ${over(c.avgKw) ? BAD : GOOD}` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>Demand {DEMAND_WINDOW_MIN} {tr('นาที')} · {tr('ตู้')} {panel.panel}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>({hm(c.start)}–{hm(c.end)})</div>
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 6 }}>
        <div style={{ minWidth: 220, flex: '1 1 260px' }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: over(c.avgKw) ? BAD : 'var(--text)', lineHeight: 1.1 }}>
            {fmt(c.avgKw)} <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--muted)' }}>kW {tr('เฉลี่ยตั้งแต่ต้นช่วง')}</span>
          </div>
          <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, margin: '8px 0 6px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${c.elapsedMin == null ? 0 : (c.elapsedMin / DEMAND_WINDOW_MIN) * 100}%`, background: GOOD }} />
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.6 }}>
            {tr('ผ่านไป')} {c.elapsedMin == null ? '—' : c.elapsedMin} / {DEMAND_WINDOW_MIN} {tr('นาที')} · {tr('คาดการณ์จบช่วง')}{' '}
            <b style={{ color: over(c.projectedKw) ? WARN : 'var(--text)' }}>{fmt(c.projectedKw)} kW</b>
            {over(c.projectedKw) && !over(c.avgKw) && <span style={{ color: WARN }}> · {tr('คาดว่าจะเกินเป้า')}</span>}
            {' · '}{tr('เป้า')} {target == null ? <span style={{ color: 'var(--muted)' }}>{cfg?.err ? tr('อ่านเป้าไม่ได้') : tr('ยังไม่ได้ตั้งเป้า (แท็บตั้งค่าตู้)')}</span> : `${fmt(target, 0)} kW`}
            <br />
            {tr('ช่วงก่อน')} {fmt(d.prev?.kw)} kW · {tr('สูงสุดวันนี้')} {fmt(d.todayMax?.kw)} kW{d.todayMax ? ` (${hm(d.todayMax.start)})` : ''}
            {' · '}{tr('สูงสุดเดือนนี้')}{' '}
            {mon == null ? '…' : mon.err ? <span style={{ color: WARN }}>{tr('อ่านไม่ได้')}</span>
              : <><b style={{ color: over(mon.kw) ? BAD : 'var(--text)' }}>{fmt(mon.kw)} kW</b>{mon.at ? ` (${dShort(mon.at)} ${hm(mon.at)})` : ''}</>}
            {mon?.first != null && mon.first > Date.parse(`${monthKey}-01T00:15:00+07:00`) && (
              <span style={{ color: 'var(--muted)' }}> · {tr('ข้อมูลเริ่ม')} {dShort(mon.first)} ({mon.n} {tr('ช่วงที่ครบ')})</span>
            )}
            {panel.partial && <span style={{ color: WARN }}> · {tr('มิเตอร์ชั้นบนสุดออนไลน์ไม่ครบ — ไม่คาดการณ์')}</span>}
            {d.missing.length > 0 && <><br /><span style={{ color: WARN }}>{tr('ยังไม่มีเลขมิเตอร์ (kWh) ของ')} {d.missing.join(', ')} — {tr('คิด Demand ของตู้นี้ไม่ได้')}</span></>}
          </div>
        </div>
        <div style={{ flex: '2 1 320px', minWidth: 0 }}>
          <div style={{ position: 'relative', height: 56, display: 'flex', alignItems: 'flex-end', gap: 2 }}>
            {target != null && <div style={{ position: 'absolute', left: 0, right: 0, bottom: `${(target / top) * 100}%`, borderTop: `1px dashed ${BAD}` }} />}
            {bars.map(b => (
              <div key={b.start} title={`${hm(b.start)}–${hm(b.start + DEMAND_WINDOW_MIN * 60000)} · ${b.kw == null ? tr('ไม่มีข้อมูล') : `${fmt(b.kw)} kW`}`}
                style={{ flex: 1, minWidth: 0, height: b.kw == null ? '100%' : `${Math.max(2, (b.kw / top) * 100)}%`,
                  background: b.kw == null ? 'transparent' : over(b.kw) ? BAD : GOOD, opacity: b.kw == null ? 1 : 0.85,
                  border: b.kw == null ? '1px dashed var(--border)' : 'none', borderRadius: 2 }} />
            ))}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            {tr('แท่งละ 15 นาที · 6 ชม. ล่าสุดของวันนี้ · กรอบประ = ไม่มีข้อมูล')}{target != null ? ` · ${tr('เส้นประแดง = เป้า')}` : ''}
          </div>
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
        {tr('คิดจากส่วนต่างเลขมิเตอร์ (kWh) ของมิเตอร์ชั้นบนสุดของตู้ — บิลการไฟฟ้าคิดจากมิเตอร์ของการไฟฟ้า ตัวเลขอาจต่างเล็กน้อย')}
      </div>
    </div>
  );
}

/** 🍱 Baseline ช่วงพัก ของตู้ที่เลือก (26/11 · คำสั่ง user · แบบการ์ด "Baseline พักเที่ยง" ของ Node-RED)
 *  ช่วงเวลา = energy_panel_settings.baseline_start/end · ตัวเลขจาก windowAvgKw()/baselineCompare() — ไฟล์นี้วาดอย่างเดียว
 *  วันนี้ใช้รายนาทีที่บอร์ดโหลดอยู่แล้ว · 3 วันก่อนดึงเฉพาะ "จุดขอบช่วง" (4 นาทีก่อนเริ่ม/ก่อนจบ) — egress น้อย
 *  🔴 ไม่ตัดสินสีดี/เสีย (ยังไม่มีเกณฑ์ % ในทะเบียน — ห้ามเดา) · วันก่อนที่ขาดข้อมูลไม่นับ + บอกว่าเฉลี่ยกี่วัน */
const BASELINE_DAYS = 3;
function BaselineCard({ panel, readings, nowMs, today, cfg }) {
  const c = cfg && !cfg.err ? cfg[panel.panel] : null;
  const start = c?.baseline_start ? String(c.baseline_start).slice(0, 5) : null;
  const end = c?.baseline_end ? String(c.baseline_end).slice(0, 5) : null;
  const roots = useMemo(() => panel.roots.map(m => m.name), [panel]);
  const all = useMemo(() => panel.meters.map(m => m.name), [panel]);
  const allKey = all.join('|');
  const msOf = (day, hm) => Date.parse(`${day}T${hm}:00+07:00`);
  const days = useMemo(() => Array.from({ length: BASELINE_DAYS }, (_, i) => addDaysStr(today, -(i + 1))).filter(Boolean), [today]);
  const daysKey = days.join('|');
  /* 3 วันก่อน — ดึงจุดขอบช่วงครั้งเดียวต่อ ตู้/วัน/ช่วง (ข้อมูลอดีตไม่เปลี่ยน) */
  const [prev, setPrev] = useState(null);           // null = ยังโหลด · { err } · { rows }
  useEffect(() => {
    if (!start || !end || !allKey) return undefined;
    let alive = true;
    setPrev(null);
    const ranges = daysKey.split('|').flatMap(d => [msOf(d, start), msOf(d, end)])
      .map(t => `and(bucket_at.gte.${new Date(t - 4 * 60000).toISOString()},bucket_at.lt.${new Date(t).toISOString()})`);
    supabaseDR.from('energy_readings').select('scope_name, bucket_at, kwh_total')
      .eq('scope_kind', 'zone').in('scope_name', allKey.split('|')).or(ranges.join(',')).limit(1000)
      .then(({ data, error }) => { if (alive) setPrev(error ? { err: error.message } : { rows: data || [] }); });
    return () => { alive = false; };
  }, [allKey, daysKey, start, end]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!c || !start || !end) {
    return (
      <div style={{ ...card, fontSize: 12.5, color: 'var(--muted)' }}>
        <b style={{ color: 'var(--text)' }}>Baseline · {tr('ตู้')} {panel.panel}</b> — {cfg?.err ? tr('อ่านค่าตั้งของตู้ไม่ได้') : tr('ยังไม่ได้ตั้งช่วง baseline (แท็บตั้งค่าตู้)')}
      </div>
    );
  }
  const s0 = msOf(today, start);
  const before = nowMs < s0;
  const calc = (rd, names, day) => windowAvgKw({ readings: rd, names, startMs: msOf(day, start), endMs: msOf(day, end) });
  const prevFor = (names) => (prev?.rows ? days.map(d => calc(prev.rows, names, d).kw) : []);
  const tot = before ? null : calc(readings, roots, today);
  const totCmp = baselineCompare(tot?.kw ?? null, prevFor(roots));
  const pctTxt = (p) => (p == null ? '' : ` (${p >= 0 ? '+' : ''}${fmt(p, 0)}%)`);
  return (
    <div style={{ ...card, borderLeft: `4px solid ${INFO}` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>Baseline {tr('ช่วงพัก')} · {tr('ตู้')} {panel.panel}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>({start}–{end})</div>
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start', marginTop: 6 }}>
        <div style={{ minWidth: 220, flex: '1 1 260px' }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text)', lineHeight: 1.1 }}>
            {fmt(tot?.kw)} <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--muted)' }}>kW {tr('วันนี้')}{tot?.partial ? ` · ${tr('ยังไม่จบช่วง')} (${tot.minutes} ${tr('นาที')})` : ''}</span>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.6, marginTop: 4 }}>
            {before && <span style={{ color: 'var(--muted)' }}>{tr('วันนี้ยังไม่ถึงช่วง')} · </span>}
            {tot?.missing?.length > 0 && <span style={{ color: WARN }}>{tr('ไม่มีเลขมิเตอร์ของ')} {tot.missing.join(', ')} · </span>}
            {tr('เฉลี่ย')} {BASELINE_DAYS} {tr('วันก่อน')}{' '}
            {prev == null ? '…' : prev.err ? <span style={{ color: WARN }}>{tr('อ่านไม่ได้')}</span>
              : <><b>{fmt(totCmp.avg)} kW</b>{pctTxt(totCmp.pct)}{totCmp.n < BASELINE_DAYS ? ` · ${tr('คิดได้')} ${totCmp.n}/${BASELINE_DAYS} ${tr('วัน')}` : ''}</>}
          </div>
        </div>
        {all.length > 1 && (
          <div style={{ flex: '2 1 320px', minWidth: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', gap: '2px 12px', fontSize: 12.5, alignContent: 'start' }}>
            <span style={{ color: 'var(--muted)' }}>{tr('มิเตอร์')}</span><span style={{ color: 'var(--muted)', textAlign: 'right' }}>{tr('วันนี้')}</span><span style={{ color: 'var(--muted)', textAlign: 'right' }}>{tr('เฉลี่ย')} {BASELINE_DAYS} {tr('วันก่อน')}</span>
            {panel.meters.map(m => {
              const t = before ? null : calc(readings, [m.name], today);
              const cmp = baselineCompare(t?.kw ?? null, prevFor([m.name]));
              return (
                <div key={m.key} style={{ display: 'contents' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)', paddingLeft: m.parent ? 12 : 0 }}>{m.parent ? '└ ' : ''}{m.label}</span>
                  <span style={{ textAlign: 'right', color: 'var(--text)' }}>{fmt(t?.kw)}</span>
                  <span style={{ textAlign: 'right', color: 'var(--text2)' }}>{prev?.rows ? `${fmt(cmp.avg)}${pctTxt(cmp.pct)}` : '—'}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
        {tr('กำลังไฟเฉลี่ยช่วงพัก จากส่วนต่างเลขมิเตอร์ (kWh) · ยอดตู้ = มิเตอร์ชั้นบนสุด · ช่วงเวลาแก้ที่แท็บตั้งค่าตู้ · วันก่อนที่ขาดข้อมูลไม่นับ')}
      </div>
    </div>
  );
}
