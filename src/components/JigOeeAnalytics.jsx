/* 🏭 แท็บ "รายเครื่อง/จิ๊ก" ของ /oee-analytics (?tab=machine) — OEE จากข้อมูลเครื่อง (Node-RED) · สูตร ESM (2026-11-13)
   📄 docs/modules/integration-hub.md §OEE รายจิ๊ก
   2 มุมมอง (`?mview=`): shift = ภาพรวมกะ + ดูลึกรายจิ๊ก (`?jig=`) · report = รายงานช่วงวันที่ + Pareto + เทียบเครื่อง + รายกะ + CSV
   🔴 เลขชุดนี้ = OEE รายจิ๊กจากเครื่อง แยกจาก OEE ไลน์ที่ประทับตอนปิดกะ (แท็บอื่นของหน้านี้) — จอเขียนกำกับเสมอ
   🔴 อ่านไม่ได้ = เขียนบอก · ไม่มีจิ๊กต่อ Node-RED = บอกว่าต้องไปผูกที่ /integrations */
import { useCallback, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import NoticeBar from './NoticeBar';
import Segmented from './Segmented';
import TimeRangeBar from './TimeRangeBar';
import FilterBar from './FilterBar';
import { toast } from './Toast';
import { supabaseDR } from '../supabaseClient';
import { usePolling } from '../utils/usePolling';
import { RATE } from '../utils/refreshRates';
import useTimeRange from '../utils/useTimeRange';
import { getWorkDate, getCurrentShift, addDaysStr } from '../utils/workDate';
import { fetchAllRows } from '../utils/fetchAllRows';
import { downloadCsvDoc, csvText } from '../utils/csvDoc';
import { loadDocForms } from '../utils/docForms';
import { pct1, stopPareto, dailyCapacityRows } from '../utils/machineOee';
import { lineNameCompare } from '../utils/lineHierarchy';
import { tr as trI18n, dateLocale } from '../utils/i18n';
import { loadJigShift, loadJigReport, combineJigRows } from '../lib/jigOeeData';
import { JigOeeCard, JigDrilldown, JigKpiRow, KindLegend, StopParetoChart, ShiftTrendChart, LossWaterfall, DailyCapacityChart, StopDrillPanel } from './JigOee';

const TARGET = 0.85;
const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 14, boxShadow: 'var(--shadow-sm)', minWidth: 0 };
const fmtPct = (v) => (v == null ? '–' : `${pct1(v).toFixed(1)}%`);
const tone = (v, t = TARGET) => (v == null ? 'var(--muted)' : v >= t ? 'var(--green)' : v >= t * 0.85 ? 'var(--amber)' : 'var(--red)');
const SHIFT_OPTS = [{ value: 'day', label: 'กะเช้า' }, { value: 'night', label: 'กะดึก' }, { value: 'all', label: 'ทั้งวัน' }];
const SHIFT_LABEL = { day: 'กะเช้า', night: 'กะดึก', all: 'ทั้งวัน (เช้า+ดึก)' };
const VIEW_OPTS = [{ value: 'shift', label: 'ภาพรวมกะ' }, { value: 'report', label: 'รายงาน & Pareto' }];
const sumWaterfall = (rows) => {
  const keys = ['plannedSec', 'fault', 'unplanned', 'idle', 'breakOver', 'operatingSec', 'minorSec', 'speedSec', 'netSec', 'ngSec', 'fullySec'];
  const w = Object.fromEntries(keys.map(k => [k, 0]));
  for (const r of rows) for (const k of keys) {
    const v = r.oee.waterfall[k];
    if (v == null) { if (['speedSec', 'netSec', 'ngSec', 'fullySec'].includes(k) && r.oee.operatingSec > 0) w[k] = null; }
    else if (w[k] != null) w[k] += v;
  }
  return { waterfall: w };
};

export default function JigOeeAnalytics() {
  const [sp, setSp] = useSearchParams();
  const view = sp.get('mview') === 'report' ? 'report' : 'shift';
  const setParam = (k, v) => setSp(p => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n; }, { replace: true });
  return (
    <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
      <FilterBar>
        <Segmented value={view} onChange={v => setParam('mview', v === 'shift' ? '' : v)} options={VIEW_OPTS} label={trI18n("มุมมอง")} />
      </FilterBar>
      <NoticeBar tone="info">
        🏭 OEE <b>{trI18n("รายจิ๊ก/เครื่อง จากข้อมูลเครื่อง")}</b> (Node-RED {trI18n("ผ่านศูนย์เชื่อมต่อ) — สูตรของ ESM · CT จากพาร์ทในใบผลิตบนจิ๊ก · %Q จาก NG ที่คน/QA ตัดสิน · คนละชุดกับ OEE ไลน์ที่ประทับตอนปิดกะ (แท็บอื่น")})
      </NoticeBar>
      {view === 'shift' ? <ShiftView sp={sp} setParam={setParam} /> : <ReportView setSp={setSp} />}
    </div>
  );
}

function ShiftView({ sp, setParam }) {
  const wd = /^\d{4}-\d{2}-\d{2}$/.test(sp.get('wd') || '') ? sp.get('wd') : getWorkDate();
  const sh = ['day', 'night', 'all'].includes(sp.get('sh')) ? sp.get('sh') : getCurrentShift();
  const jigKey = sp.get('jig') || '';
  const [data, setData] = useState(null);
  const [trend, setTrend] = useState(null);
  const req = useRef(0);

  const load = useCallback(async () => {
    const id = ++req.current;
    const r = await loadJigShift({ workDate: wd, shift: sh, nowMs: Date.now() });
    if (id !== req.current) return;
    setData({ ...r, at: Date.now() });
  }, [wd, sh]);
  usePolling(load, RATE.METER);

  const sel = data?.jigs?.find(j => `${j.sourceId}|${j.tag}` === jigKey) || null;
  const trReq = useRef(0);
  const loadTrend = useCallback(async () => {
    const id = ++trReq.current;
    if (!jigKey) { setTrend(null); return; }
    const [sid, tag] = jigKey.split('|');
    const from = addDaysStr(wd, -7);
    const r = await loadJigReport({ fromDate: from, toDate: wd });
    if (id !== trReq.current) return;
    setTrend(r.rows.filter(x => x.sourceId === sid && x.tag === tag).slice(0, 14));
  }, [jigKey, wd]);
  usePolling(loadTrend, RATE.BOARD);

  const all = useMemo(() => (data?.jigs?.length ? combineJigRows(data.jigs) : null), [data]);
  const byLine = useMemo(() => {
    const m = new Map();
    for (const j of data?.jigs || []) { const k = j.lineName || '(ไม่ระบุไลน์)'; if (!m.has(k)) m.set(k, []); m.get(k).push(j); }
    return [...m.entries()].sort((a, b) => lineNameCompare(a[0], b[0]));
  }, [data]);

  return (
    <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
      <FilterBar>
        <input type="date" value={wd} onChange={e => setParam('wd', e.target.value)} aria-label={trI18n("วันทำงาน")} />
        <Segmented value={sh} onChange={v => setParam('sh', v)} options={SHIFT_OPTS} label={trI18n("กะ")} />
        <button type="button" className="pg-btn" onClick={load}>🔄 {trI18n('โหลดใหม่')}</button>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{trI18n("อัปเดตทุก 1 นาที")}{data?.at ? ` · ${trI18n("ล่าสุด")} ${new Date(data.at).toLocaleTimeString(dateLocale(), { timeZone: 'Asia/Bangkok' })}` : ''}</span>
      </FilterBar>
      {data?.errors?.length > 0 && <NoticeBar tone="bad">{trI18n("อ่านไม่สำเร็จ")}: {data.errors.join(' · ')} — {trI18n("ตัวเลขด้านล่างอาจไม่ครบ")}</NoticeBar>}
      {data == null ? <div style={{ color: 'var(--muted)' }}>{trI18n("กำลังโหลด")}…</div>
        : !data.jigs.length ? (
          <NoticeBar tone="warn">{trI18n("ยังไม่มีจิ๊ก/เครื่องที่ผูกกับ Node-RED — ไปผูกที่")} <Link to="/integrations">{trI18n("ตั้งค่า › การเชื่อมต่อ Node-RED / เครื่องจักร")}</Link></NoticeBar>
        ) : (<>
          {all && (
            <JigKpiRow items={[
              { label: `OEE ${trI18n("รวม")} ${data.jigs.length} ${trI18n("จิ๊ก")}`, value: fmtPct(all.oee), color: tone(all.oee), sub: trI18n("ถ่วงตามเวลา (ไม่เฉลี่ย %)") },
              { label: 'Availability', value: fmtPct(all.A), color: tone(all.A) },
              { label: 'Performance', value: fmtPct(all.P), color: tone(all.P), sub: all.partialP ? 'บางจิ๊กไม่รู้ CT — ไม่นับในตัวนี้' : null },
              { label: 'Quality', value: fmtPct(all.Q), color: tone(all.Q, 0.99), sub: all.partialQ ? 'บางจิ๊กไม่มีใบ — ยังไม่รู้ NG ที่คนตัดสิน' : null },
              { label: trI18n("ชิ้นจากเครื่อง"), value: all.pieces.toLocaleString(), sub: `NG ${trI18n("หน้าเครื่อง")} ${all.ngMachine}` },
              { label: 'MTTR / MTBF', value: all.mttrMin == null ? '–' : `${all.mttrMin.toFixed(1)} น.`, sub: all.mtbfMin == null ? 'ไม่มี Alarm' : `MTBF ${all.mtbfMin.toFixed(1)} ${trI18n("น.")} · Alarm ${all.faultN} ${trI18n("ครั้ง")}` },
            ]} />
          )}
          <KindLegend />
          {byLine.map(([line, jigs]) => (
            <div key={line} style={{ display: 'grid', gap: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{line}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10, alignContent: 'start' }}>
                {jigs.map(j => (
                  <div key={`${j.sourceId}|${j.tag}`} style={{ outline: `${j.sourceId}|${j.tag}` === jigKey ? '2px solid var(--accent)' : 'none', borderRadius: 'var(--r-md)' }}>
                    <JigOeeCard j={j} target={TARGET} onOpen={() => setParam('jig', `${j.sourceId}|${j.tag}` === jigKey ? '' : `${j.sourceId}|${j.tag}`)} />
                  </div>
                ))}
              </div>
            </div>
          ))}
          {sel ? (<>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>
              {sel.machineNo} <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--muted)' }}>{sel.lineName} · {wd} · {SHIFT_LABEL[sh]}</span>
            </div>
            <JigDrilldown key={`${jigKey}|${wd}|${sh}`} j={sel} trendRows={trend} target={TARGET} />
          </>) : <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{trI18n("กดการ์ดจิ๊กเพื่อดูลึก (แถบสถานะ · รายชั่วโมง · Loss · Pareto · การหยุด · ใบผลิต · แนวโน้ม")})</div>}
        </>)}
    </div>
  );
}

function ReportView({ setSp }) {
  const tr = useTimeRange({ defaultScale: 'day', defaultDays: 7, finest: 'day' });
  const { from, to } = tr;
  const [data, setData] = useState(null);
  const [pick, setPick] = useState('');          // '' = ทุกจิ๊ก · ไม่งั้น sourceId|tag
  const req = useRef(0);
  const load = useCallback(async () => {
    const id = ++req.current;
    setData(d => (d ? { ...d, loading: true } : d));
    const r = await loadJigReport({ fromDate: from, toDate: to });
    if (id !== req.current) return;
    // Pareto ตามสาเหตุ: ดึงเฉพาะช่วงหยุดที่ "ไม่ใช่หยุดสั้น" (แถวน้อย) + หยุดสั้นนับจาก rollup
    let pareto = [], pErr = false;
    if (r.jigs.length) {
      const fromMs = Date.parse(`${from}T08:00:00+07:00`), toMs = Date.parse(`${to}T08:00:00+07:00`) + 86400000;
      const { data: evRows, error: evErr } = await fetchAllRows(supabaseDR, 'machine_state_events', 'source_id, machine_tag, started_at, ended_at, duration_sec, state, reason_code, reason_text, is_minor',
        q => q.in('source_id', [...new Set(r.jigs.map(j => j.sourceId))]).in('state', ['fault', 'unplanned', 'idle']).eq('is_minor', false)
          .gte('started_at', new Date(fromMs).toISOString()).lt('started_at', new Date(toMs).toISOString()).order('started_at').order('machine_tag'));
      if (id !== req.current) return;
      pErr = !!evErr;
      pareto = evRows || [];
    }
    setData({ ...r, pareto, pErr, loading: false });
  }, [from, to]);
  usePolling(load, RATE.ANALYTIC);

  const rows = useMemo(() => (data?.rows || []).filter(r => !pick || `${r.sourceId}|${r.tag}` === pick), [data, pick]);
  const all = useMemo(() => (rows.length ? combineJigRows(rows) : null), [rows]);
  const wf = useMemo(() => (rows.length ? sumWaterfall(rows) : null), [rows]);
  const paretoRows = useMemo(() => {
    const ev = (data?.pareto || []).filter(e => !pick || `${e.source_id}|${e.machine_tag}` === pick);
    const p = stopPareto(ev, { startMs: 0, endMs: 8.64e15 });
    const minorSec = rows.reduce((s, r) => s + (r.oee.minorSec || 0), 0);
    const minorN = rows.reduce((s, r) => s + (r.oee.counts.minor || 0), 0);
    if (minorSec > 0) p.push({ key: 'minor', state: 'minor', min: minorSec / 60, n: minorN });
    const overSec = rows.reduce((s, r) => s + (r.oee.loss?.breakOver || 0), 0);
    if (overSec > 0) p.push({ key: 'break_over', state: 'break_over', min: overSec / 60, n: rows.filter(r => r.oee.loss?.breakOver > 0).length });
    return p.sort((a, b) => b.min - a.min);
  }, [data, pick, rows]);
  const byJig = useMemo(() => {
    const m = new Map();
    for (const r of data?.rows || []) { const k = `${r.sourceId}|${r.tag}`; if (!m.has(k)) m.set(k, { j: r, rows: [] }); m.get(k).rows.push(r); }
    return [...m.values()].map(x => ({ j: x.j, c: combineJigRows(x.rows) }));
  }, [data]);
  const daily = useMemo(() => dailyCapacityRows(rows), [rows]);
  /* 🔎 กดแท่ง Pareto ⇒ รายครั้ง + ผูก ESM (ชุดเหตุการณ์เดียวกับที่นับในแท่ง) */
  const [drill, setDrill] = useState(null);
  const drillEvents = useMemo(() => (data?.pareto || []).filter(e => !pick || `${e.source_id}|${e.machine_tag}` === pick), [data, pick]);
  const drillOrders = useMemo(() => [...new Map(rows.flatMap(r => r.orders || []).map(o => [o.id, o])).values()], [rows]);
  const drillTagNo = useMemo(() => new Map((data?.jigs || []).map(j => [`${j.sourceId}|${j.tag}`, j.machineNo])), [data]);
  /* (ค) คลิกวัน ⇒ ไปมุมมองทั้งวันของวันนั้น (จิ๊กที่เลือกอยู่ ถ้าเลือก) */
  const openDay = (d) => setSp(p => { const n = new URLSearchParams(p); n.delete('mview'); n.set('wd', d); n.set('sh', 'all'); if (pick) n.set('jig', pick); else n.delete('jig'); return n; });

  const exportCsv = async () => {
    await loadDocForms().catch(() => null);
    const headers = ['วันที่', trI18n("กะ"), trI18n("ไลน์"), trI18n("เครื่อง"), 'MAT', 'CT(s)', 'แผน(นาที)', 'เดินเครื่อง(นาที)', 'ชิ้นจากเครื่อง', 'NG หน้าเครื่อง', 'NG คนตัดสิน', 'A%', 'P%', 'Q%', 'OEE%', 'Alarm(ครั้ง)', trI18n("หมายเหตุ")];
    const body = rows.map(r => [
      r.workDate, r.shift === 'day' ? 'เช้า' : 'ดึก', r.lineName || '', r.machineNo, (r.ctInfo?.mats || []).join(' '), r.oee.ct ? Math.round(r.oee.ct * 10) / 10 : '',
      Math.round(r.oee.plannedSec / 60), Math.round(r.oee.operatingSec / 60), r.oee.pieces ?? '', r.oee.ngMachine, r.oee.ngPeople ?? '',
      pct1(r.oee.A) ?? '', pct1(r.oee.P) ?? '', pct1(r.oee.Q) ?? '', pct1(r.oee.oee) ?? '', r.oee.counts.alarm + r.oee.counts.alarmMinor,
      [r.open ? 'กะยังไม่จบ' : '', ...(r.oee.why || [])].filter(Boolean).join(' / '),
    ]);
    downloadCsvDoc('csv_jig_oee_shift', `jig-oee_${from}_${to}.csv`, csvText(headers, body));
    toast.success(`${trI18n("ส่งออก")} ${body.length} ${trI18n("แถว")}`);
  };

  const th = { textAlign: 'left', padding: '6px 8px', fontSize: 12, color: 'var(--muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };
  const td = { padding: '6px 8px', fontSize: 12.5, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };
  return (
    <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
      <TimeRangeBar scale={tr.scale} from={from} to={to} today={tr.today} finest="day"
        onScale={tr.setScale} onFrom={tr.setFrom} onTo={tr.setTo} onPreset={tr.setPreset} onView={tr.setView} onReload={load} loading={!!data?.loading}>
        {/* จิ๊กที่ต่อ Node-RED มีไม่กี่ตัว ⇒ ชิปกดเลือก (ตัวกรองการดู ไม่ใช่ช่องกรอกเลขเครื่อง) */}
        <div role="radiogroup" aria-label={trI18n("จิ๊ก/เครื่อง")} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[{ k: '', label: 'ทุกจิ๊ก' }, ...(data?.jigs || []).map(j => ({ k: `${j.sourceId}|${j.tag}`, label: j.machineNo }))].map(o => (
            <button key={o.k || 'all'} type="button" role="radio" aria-checked={pick === o.k} className={`pg-btn${pick === o.k ? ' primary' : ''}`} onClick={() => setPick(o.k)}>{o.label}</button>
          ))}
        </div>
        <button type="button" className="pg-btn" onClick={exportCsv} disabled={!rows.length}>⬇ Export CSV</button>
      </TimeRangeBar>
      {data?.errors?.length > 0 && <NoticeBar tone="bad">{trI18n("อ่านไม่สำเร็จ")}: {data.errors.join(' · ')} — {trI18n("ตัวเลขอาจไม่ครบ")}</NoticeBar>}
      {data == null ? <div style={{ color: 'var(--muted)' }}>{trI18n("กำลังโหลด")}…</div> : !data.jigs.length ? (
        <NoticeBar tone="warn">{trI18n("ยังไม่มีจิ๊ก/เครื่องที่ผูกกับ Node-RED — ไปผูกที่")} <Link to="/integrations">{trI18n("การเชื่อมต่อ Node-RED / เครื่องจักร")}</Link></NoticeBar>
      ) : !rows.length ? <NoticeBar tone="warn">{trI18n("ไม่มีข้อมูลจากเครื่องในช่วงนี้")}</NoticeBar> : (<>
        <JigKpiRow items={[
          { label: trI18n("OEE ช่วงที่เลือก"), value: fmtPct(all.oee), color: tone(all.oee), sub: `${rows.length} ${trI18n("กะ-จิ๊ก · ถ่วงตามเวลา")}` },
          { label: 'Availability', value: fmtPct(all.A), color: tone(all.A) },
          { label: 'Performance', value: fmtPct(all.P), color: tone(all.P), sub: all.partialP ? 'บางกะไม่รู้ CT — ไม่นับ' : null },
          { label: 'Quality', value: fmtPct(all.Q), color: tone(all.Q, 0.99), sub: all.partialQ ? 'บางกะไม่มีใบ — ไม่รู้ NG ที่คนตัดสิน' : null },
          { label: trI18n("ชิ้นจากเครื่อง"), value: all.pieces.toLocaleString(), sub: `NG ${trI18n("หน้าเครื่อง")} ${all.ngMachine}` },
          { label: 'MTTR / MTBF', value: all.mttrMin == null ? '–' : `${all.mttrMin.toFixed(1)} น.`, sub: all.mtbfMin == null ? 'ไม่มี Alarm' : `MTBF ${all.mtbfMin.toFixed(1)} ${trI18n("น.")} · Alarm ${all.faultN} ${trI18n("ครั้ง")}` },
        ]} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 12, alignItems: 'start' }}>
          <div style={card}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>Pareto {trI18n("สาเหตุการหยุด")}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>{trI18n("นาทีที่เสีย (Alarm / Idle / หยุดนอกแผน ≥ 2 นาที + หยุดสั้นรวม")})</div>
            {data.pErr ? <NoticeBar tone="bad">{trI18n("อ่านช่วงหยุดรายสาเหตุไม่สำเร็จ")}</NoticeBar> : <StopParetoChart pareto={paretoRows} onPick={r => setDrill(p => (p?.key === r.key ? null : r))} />}
          </div>
          <div style={card}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>OEE Loss {trI18n("ช่วงที่เลือก")}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>{trI18n("เวลาแผนหายไปไหน (รวมทุกกะ")})</div>
            <LossWaterfall o={wf} />
          </div>
        </div>
        {drill && (
          <StopDrillPanel row={drill} events={drillEvents} orders={drillOrders} tagNo={drillTagNo}
            fromMs={Date.parse(`${from}T08:00:00+07:00`)} toMs={Date.parse(`${to}T08:00:00+07:00`) + 86400000} onClose={() => setDrill(null)} />
        )}
        <div style={card}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{trI18n("ยอดผลิตรายวัน & ชิ้นที่ควรทำได้")}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
            {pick ? trI18n("จิ๊กที่เลือก") : trI18n("ทุกจิ๊กรวมกัน")} · {trI18n("เทา = ยังขาดจากที่ควรทำได้ (เวลาแผน ÷ CT พาร์ทในใบ · ไม่มีเทา = มีกะที่ไม่รู้ CT) · ชี้เพื่อดูเวลารายสถานะ · คลิกวันเพื่อดูทั้งวันรายชั่วโมง")}
          </div>
          <DailyCapacityChart rows={daily} onPick={openDay} />
        </div>
        <div style={card}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{trI18n("แนวโน้มรายกะ")}</div>
          <ShiftTrendChart rows={pick ? rows : []} target={TARGET} />
          {!pick && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{trI18n("เลือกจิ๊กเดียวด้านบนเพื่อดูแนวโน้มรายกะ")}</div>}
        </div>
        <div style={card}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>{trI18n("เทียบเครื่อง")}</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{[trI18n("เครื่อง"), trI18n("ไลน์"), trI18n("ชิ้น"), trI18n("NG หน้าเครื่อง"), 'A', 'P', 'Q', 'OEE', 'MTTR', 'MTBF'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{byJig.map(({ j, c }) => (
                <tr key={`${j.sourceId}|${j.tag}`}>
                  <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>{j.machineNo}</td><td style={td}>{j.lineName}</td>
                  <td style={td}>{c.pieces.toLocaleString()}</td><td style={td}>{c.ngMachine}</td>
                  <td style={{ ...td, color: tone(c.A) }}>{fmtPct(c.A)}</td><td style={{ ...td, color: tone(c.P) }}>{fmtPct(c.P)}</td>
                  <td style={{ ...td, color: tone(c.Q, 0.99) }}>{fmtPct(c.Q)}</td><td style={{ ...td, color: tone(c.oee), fontWeight: 800 }}>{fmtPct(c.oee)}</td>
                  <td style={td}>{c.mttrMin == null ? '–' : `${c.mttrMin.toFixed(1)} ${trI18n("น.")}`}</td><td style={td}>{c.mtbfMin == null ? '–' : `${c.mtbfMin.toFixed(1)} ${trI18n("น.")}`}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{trI18n("รายกะ")}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>{rows.length} {trI18n("แถว · ตารางเดียวกับที่ Export CSV · \"–\" = คิดไม่ได้ (ดูหมายเหตุ")})</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{[trI18n("วันที่"), trI18n("กะ"), trI18n("เครื่อง"), 'MAT', trI18n("แผน (นาที)"), trI18n("ชิ้น"), trI18n("NG คน/เครื่อง"), 'A', 'P', 'Q', 'OEE', trI18n("หมายเหตุ")].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{rows.map(r => (
                <tr key={`${r.sourceId}|${r.tag}|${r.workDate}|${r.shift}`}>
                  <td style={td}>{r.workDate}</td><td style={td}>{r.shift === 'day' ? trI18n("เช้า") : trI18n("ดึก")}{r.open ? trI18n(" (ยังไม่จบ)") : ''}</td>
                  <td style={{ ...td, fontFamily: 'ui-monospace, monospace' }}>{r.machineNo}</td><td style={td}>{(r.ctInfo?.mats || []).join(', ') || '–'}</td>
                  <td style={td}>{Math.round(r.oee.plannedSec / 60)}</td><td style={td}>{r.oee.pieces ?? '–'}</td>
                  <td style={td}>{r.oee.ngPeople ?? '–'} / {r.oee.ngMachine}</td>
                  <td style={td}>{fmtPct(r.oee.A)}</td><td style={td}>{fmtPct(r.oee.P)}</td><td style={td}>{fmtPct(r.oee.Q)}</td>
                  <td style={{ ...td, fontWeight: 800, color: tone(r.oee.oee) }}>{fmtPct(r.oee.oee)}</td>
                  <td style={{ ...td, color: 'var(--muted)', whiteSpace: 'normal', minWidth: 180 }}>{(r.oee.why || []).includes('no_order') ? trI18n("ไม่มีใบผลิตบนจิ๊ก") : (r.oee.why || []).includes('no_ct') ? trI18n("ไม่รู้ CT") : ''}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      </>)}
    </div>
  );
}

