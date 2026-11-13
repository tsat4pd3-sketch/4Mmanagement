/* 🏭 แท็บ "รายเครื่อง/จิ๊ก" ของ /oee-analytics (?tab=machine) — OEE จากข้อมูลเครื่อง (Node-RED) · สูตร ESM (2026-11-13)
   📄 docs/modules/integration-hub.md §OEE รายจิ๊ก
   2 มุมมอง (`?mview=`): shift = ภาพรวมกะ + ดูลึกรายจิ๊ก (`?jig=`) · report = รายงานช่วงวันที่ + Pareto + เทียบเครื่อง + รายกะ + CSV
   🔴 เลขชุดนี้ = OEE รายจิ๊กจากเครื่อง แยกจาก OEE ไลน์ที่ประทับตอนปิดกะ (แท็บอื่นของหน้านี้) — จอเขียนกำกับเสมอ
   🔴 อ่านไม่ได้ = เขียนบอก · ไม่มีจิ๊กต่อ Node-RED = บอกว่าต้องไปผูกที่ /integrations */
import { useCallback, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
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
import { axisTick, tooltipProps, CHART_MARGIN } from '../utils/chartAxis';
import { pct1, stopPareto } from '../utils/machineOee';
import { lineNameCompare } from '../utils/lineHierarchy';
import { loadJigShift, loadJigReport, combineJigRows } from '../lib/jigOeeData';
import { JigOeeCard, JigDrilldown, JigKpiRow, KindLegend, StopParetoChart, ShiftTrendChart, LossWaterfall } from './JigOee';

const TARGET = 0.85;
const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 14, boxShadow: 'var(--shadow-sm)', minWidth: 0 };
const fmtPct = (v) => (v == null ? '–' : `${pct1(v).toFixed(1)}%`);
const tone = (v, t = TARGET) => (v == null ? 'var(--muted)' : v >= t ? 'var(--green)' : v >= t * 0.85 ? 'var(--amber)' : 'var(--red)');
const SHIFT_OPTS = [{ value: 'day', label: 'กะเช้า' }, { value: 'night', label: 'กะดึก' }];
const VIEW_OPTS = [{ value: 'shift', label: 'ภาพรวมกะ' }, { value: 'report', label: 'รายงาน & Pareto' }];
const sumWaterfall = (rows) => {
  const keys = ['plannedSec', 'fault', 'unplanned', 'idle', 'operatingSec', 'minorSec', 'speedSec', 'netSec', 'ngSec', 'fullySec'];
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
        <Segmented value={view} onChange={v => setParam('mview', v === 'shift' ? '' : v)} options={VIEW_OPTS} label="มุมมอง" />
      </FilterBar>
      <NoticeBar tone="info">
        🏭 OEE <b>รายจิ๊ก/เครื่อง จากข้อมูลเครื่อง</b> (Node-RED ผ่านศูนย์เชื่อมต่อ) — สูตรของ ESM · CT จากพาร์ทในใบผลิตบนจิ๊ก · %Q จาก NG ที่คน/QA ตัดสิน
        · คนละชุดกับ OEE ไลน์ที่ประทับตอนปิดกะ (แท็บอื่น)
      </NoticeBar>
      {view === 'shift' ? <ShiftView sp={sp} setParam={setParam} /> : <ReportView />}
    </div>
  );
}

function ShiftView({ sp, setParam }) {
  const wd = /^\d{4}-\d{2}-\d{2}$/.test(sp.get('wd') || '') ? sp.get('wd') : getWorkDate();
  const sh = ['day', 'night'].includes(sp.get('sh')) ? sp.get('sh') : getCurrentShift();
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
        <input type="date" value={wd} onChange={e => setParam('wd', e.target.value)} aria-label="วันทำงาน" />
        <Segmented value={sh} onChange={v => setParam('sh', v)} options={SHIFT_OPTS} label="กะ" />
        <button type="button" className="pg-btn" onClick={load}>🔄 โหลดใหม่</button>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>อัปเดตทุก 1 นาที{data?.at ? ` · ล่าสุด ${new Date(data.at).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok' })}` : ''}</span>
      </FilterBar>
      {data?.errors?.length > 0 && <NoticeBar tone="bad">อ่านไม่สำเร็จ: {data.errors.join(' · ')} — ตัวเลขด้านล่างอาจไม่ครบ</NoticeBar>}
      {data == null ? <div style={{ color: 'var(--muted)' }}>กำลังโหลด…</div>
        : !data.jigs.length ? (
          <NoticeBar tone="warn">ยังไม่มีจิ๊ก/เครื่องที่ผูกกับ Node-RED — ไปผูกที่ <Link to="/integrations">ตั้งค่า › การเชื่อมต่อ Node-RED / เครื่องจักร</Link></NoticeBar>
        ) : (<>
          {all && (
            <JigKpiRow items={[
              { label: `OEE รวม ${data.jigs.length} จิ๊ก`, value: fmtPct(all.oee), color: tone(all.oee), sub: 'ถ่วงตามเวลา (ไม่เฉลี่ย %)' },
              { label: 'Availability', value: fmtPct(all.A), color: tone(all.A) },
              { label: 'Performance', value: fmtPct(all.P), color: tone(all.P), sub: all.partialP ? 'บางจิ๊กไม่รู้ CT — ไม่นับในตัวนี้' : null },
              { label: 'Quality', value: fmtPct(all.Q), color: tone(all.Q, 0.99), sub: all.partialQ ? 'บางจิ๊กไม่มีใบ — ยังไม่รู้ NG ที่คนตัดสิน' : null },
              { label: 'ชิ้นจากเครื่อง', value: all.pieces.toLocaleString(), sub: `NG หน้าเครื่อง ${all.ngMachine}` },
              { label: 'MTTR / MTBF', value: all.mttrMin == null ? '–' : `${all.mttrMin.toFixed(1)} น.`, sub: all.mtbfMin == null ? 'ไม่มี Alarm' : `MTBF ${all.mtbfMin.toFixed(1)} น. · Alarm ${all.faultN} ครั้ง` },
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
              {sel.machineNo} <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--muted)' }}>{sel.lineName} · {wd} · {sh === 'day' ? 'กะเช้า' : 'กะดึก'}</span>
            </div>
            <JigDrilldown j={sel} trendRows={trend} target={TARGET} />
          </>) : <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>กดการ์ดจิ๊กเพื่อดูลึก (แถบสถานะ · รายชั่วโมง · Loss · Pareto · การหยุด · ใบผลิต · แนวโน้ม)</div>}
        </>)}
    </div>
  );
}

function ReportView() {
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
    return p.sort((a, b) => b.min - a.min);
  }, [data, pick, rows]);
  const byJig = useMemo(() => {
    const m = new Map();
    for (const r of data?.rows || []) { const k = `${r.sourceId}|${r.tag}`; if (!m.has(k)) m.set(k, { j: r, rows: [] }); m.get(k).rows.push(r); }
    return [...m.values()].map(x => ({ j: x.j, c: combineJigRows(x.rows) }));
  }, [data]);
  const daily = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      const d = m.get(r.workDate) || { d: r.workDate, good: 0, ng: 0, cap: 0, capKnown: true };
      d.good += Math.max(0, (r.oee.pieces || 0) - (r.oee.ngMachine || 0)); d.ng += r.oee.ngMachine || 0;
      if (r.oee.ct > 0) d.cap += Math.floor(r.oee.plannedSec / r.oee.ct); else if (r.oee.plannedSec > 0) d.capKnown = false;
      m.set(r.workDate, d);
    }
    return [...m.values()].sort((a, b) => (a.d < b.d ? -1 : 1)).map(d => ({ ...d, label: `${d.d.slice(8, 10)}/${d.d.slice(5, 7)}`, cap: d.capKnown ? d.cap : null }));
  }, [rows]);

  const exportCsv = async () => {
    await loadDocForms().catch(() => null);
    const headers = ['วันที่', 'กะ', 'ไลน์', 'เครื่อง', 'MAT', 'CT(s)', 'แผน(นาที)', 'เดินเครื่อง(นาที)', 'ชิ้นจากเครื่อง', 'NG หน้าเครื่อง', 'NG คนตัดสิน', 'A%', 'P%', 'Q%', 'OEE%', 'Alarm(ครั้ง)', 'หมายเหตุ'];
    const body = rows.map(r => [
      r.workDate, r.shift === 'day' ? 'เช้า' : 'ดึก', r.lineName || '', r.machineNo, (r.ctInfo?.mats || []).join(' '), r.oee.ct ? Math.round(r.oee.ct * 10) / 10 : '',
      Math.round(r.oee.plannedSec / 60), Math.round(r.oee.operatingSec / 60), r.oee.pieces ?? '', r.oee.ngMachine, r.oee.ngPeople ?? '',
      pct1(r.oee.A) ?? '', pct1(r.oee.P) ?? '', pct1(r.oee.Q) ?? '', pct1(r.oee.oee) ?? '', r.oee.counts.alarm + r.oee.counts.alarmMinor,
      [r.open ? 'กะยังไม่จบ' : '', ...(r.oee.why || [])].filter(Boolean).join(' / '),
    ]);
    downloadCsvDoc('csv_jig_oee_shift', `jig-oee_${from}_${to}.csv`, csvText(headers, body));
    toast.success(`ส่งออก ${body.length} แถว`);
  };

  const th = { textAlign: 'left', padding: '6px 8px', fontSize: 12, color: 'var(--muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };
  const td = { padding: '6px 8px', fontSize: 12.5, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };
  return (
    <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
      <TimeRangeBar scale={tr.scale} from={from} to={to} today={tr.today} finest="day"
        onScale={tr.setScale} onFrom={tr.setFrom} onTo={tr.setTo} onPreset={tr.setPreset} onView={tr.setView} onReload={load} loading={!!data?.loading}>
        {/* จิ๊กที่ต่อ Node-RED มีไม่กี่ตัว ⇒ ชิปกดเลือก (ตัวกรองการดู ไม่ใช่ช่องกรอกเลขเครื่อง) */}
        <div role="radiogroup" aria-label="จิ๊ก/เครื่อง" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[{ k: '', label: 'ทุกจิ๊ก' }, ...(data?.jigs || []).map(j => ({ k: `${j.sourceId}|${j.tag}`, label: j.machineNo }))].map(o => (
            <button key={o.k || 'all'} type="button" role="radio" aria-checked={pick === o.k} className={`pg-btn${pick === o.k ? ' primary' : ''}`} onClick={() => setPick(o.k)}>{o.label}</button>
          ))}
        </div>
        <button type="button" className="pg-btn" onClick={exportCsv} disabled={!rows.length}>⬇ Export CSV</button>
      </TimeRangeBar>
      {data?.errors?.length > 0 && <NoticeBar tone="bad">อ่านไม่สำเร็จ: {data.errors.join(' · ')} — ตัวเลขอาจไม่ครบ</NoticeBar>}
      {data == null ? <div style={{ color: 'var(--muted)' }}>กำลังโหลด…</div> : !data.jigs.length ? (
        <NoticeBar tone="warn">ยังไม่มีจิ๊ก/เครื่องที่ผูกกับ Node-RED — ไปผูกที่ <Link to="/integrations">การเชื่อมต่อ Node-RED / เครื่องจักร</Link></NoticeBar>
      ) : !rows.length ? <NoticeBar tone="warn">ไม่มีข้อมูลจากเครื่องในช่วงนี้</NoticeBar> : (<>
        <JigKpiRow items={[
          { label: 'OEE ช่วงที่เลือก', value: fmtPct(all.oee), color: tone(all.oee), sub: `${rows.length} กะ-จิ๊ก · ถ่วงตามเวลา` },
          { label: 'Availability', value: fmtPct(all.A), color: tone(all.A) },
          { label: 'Performance', value: fmtPct(all.P), color: tone(all.P), sub: all.partialP ? 'บางกะไม่รู้ CT — ไม่นับ' : null },
          { label: 'Quality', value: fmtPct(all.Q), color: tone(all.Q, 0.99), sub: all.partialQ ? 'บางกะไม่มีใบ — ไม่รู้ NG ที่คนตัดสิน' : null },
          { label: 'ชิ้นจากเครื่อง', value: all.pieces.toLocaleString(), sub: `NG หน้าเครื่อง ${all.ngMachine}` },
          { label: 'MTTR / MTBF', value: all.mttrMin == null ? '–' : `${all.mttrMin.toFixed(1)} น.`, sub: all.mtbfMin == null ? 'ไม่มี Alarm' : `MTBF ${all.mtbfMin.toFixed(1)} น. · Alarm ${all.faultN} ครั้ง` },
        ]} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 12, alignItems: 'start' }}>
          <div style={card}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>Pareto สาเหตุการหยุด</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>นาทีที่เสีย (Alarm / Idle / หยุดนอกแผน ≥ 2 นาที + หยุดสั้นรวม)</div>
            {data.pErr ? <NoticeBar tone="bad">อ่านช่วงหยุดรายสาเหตุไม่สำเร็จ</NoticeBar> : <StopParetoChart pareto={paretoRows} />}
          </div>
          <div style={card}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>OEE Loss ช่วงที่เลือก</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>เวลาแผนหายไปไหน (รวมทุกกะ)</div>
            <LossWaterfall o={wf} />
          </div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>ยอดผลิตรายวัน เทียบกำลังผลิตตามแผน</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>ชิ้นดี/NG จากเครื่อง · กำลังผลิต = เวลาแผน ÷ CT พาร์ทในใบ (ว่าง = มีกะที่ไม่รู้ CT)</div>
          <div style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={daily} margin={CHART_MARGIN}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" tick={axisTick()} />
                <YAxis width="auto" tick={axisTick()} allowDecimals={false} />
                <Tooltip {...tooltipProps()} />
                <Bar dataKey="cap" name="กำลังผลิตตามแผน" fill="var(--border2)" isAnimationActive={false} />
                <Bar dataKey="good" name="ชิ้นดี (เครื่อง)" stackId="q" fill="var(--green)" isAnimationActive={false} />
                <Bar dataKey="ng" name="NG (หน้าเครื่อง)" stackId="q" fill="var(--red)" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>แนวโน้มรายกะ</div>
          <ShiftTrendChart rows={pick ? rows : []} target={TARGET} />
          {!pick && <div style={{ fontSize: 12, color: 'var(--muted)' }}>เลือกจิ๊กเดียวด้านบนเพื่อดูแนวโน้มรายกะ</div>}
        </div>
        <div style={card}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>เทียบเครื่อง</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['เครื่อง', 'ไลน์', 'ชิ้น', 'NG หน้าเครื่อง', 'A', 'P', 'Q', 'OEE', 'MTTR', 'MTBF'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{byJig.map(({ j, c }) => (
                <tr key={`${j.sourceId}|${j.tag}`}>
                  <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>{j.machineNo}</td><td style={td}>{j.lineName}</td>
                  <td style={td}>{c.pieces.toLocaleString()}</td><td style={td}>{c.ngMachine}</td>
                  <td style={{ ...td, color: tone(c.A) }}>{fmtPct(c.A)}</td><td style={{ ...td, color: tone(c.P) }}>{fmtPct(c.P)}</td>
                  <td style={{ ...td, color: tone(c.Q, 0.99) }}>{fmtPct(c.Q)}</td><td style={{ ...td, color: tone(c.oee), fontWeight: 800 }}>{fmtPct(c.oee)}</td>
                  <td style={td}>{c.mttrMin == null ? '–' : `${c.mttrMin.toFixed(1)} น.`}</td><td style={td}>{c.mtbfMin == null ? '–' : `${c.mtbfMin.toFixed(1)} น.`}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>รายกะ</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>{rows.length} แถว · ตารางเดียวกับที่ Export CSV · "–" = คิดไม่ได้ (ดูหมายเหตุ)</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['วันที่', 'กะ', 'เครื่อง', 'MAT', 'แผน (นาที)', 'ชิ้น', 'NG คน/เครื่อง', 'A', 'P', 'Q', 'OEE', 'หมายเหตุ'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{rows.map(r => (
                <tr key={`${r.sourceId}|${r.tag}|${r.workDate}|${r.shift}`}>
                  <td style={td}>{r.workDate}</td><td style={td}>{r.shift === 'day' ? 'เช้า' : 'ดึก'}{r.open ? ' (ยังไม่จบ)' : ''}</td>
                  <td style={{ ...td, fontFamily: 'ui-monospace, monospace' }}>{r.machineNo}</td><td style={td}>{(r.ctInfo?.mats || []).join(', ') || '–'}</td>
                  <td style={td}>{Math.round(r.oee.plannedSec / 60)}</td><td style={td}>{r.oee.pieces ?? '–'}</td>
                  <td style={td}>{r.oee.ngPeople ?? '–'} / {r.oee.ngMachine}</td>
                  <td style={td}>{fmtPct(r.oee.A)}</td><td style={td}>{fmtPct(r.oee.P)}</td><td style={td}>{fmtPct(r.oee.Q)}</td>
                  <td style={{ ...td, fontWeight: 800, color: tone(r.oee.oee) }}>{fmtPct(r.oee.oee)}</td>
                  <td style={{ ...td, color: 'var(--muted)', whiteSpace: 'normal', minWidth: 180 }}>{(r.oee.why || []).includes('no_order') ? 'ไม่มีใบผลิตบนจิ๊ก' : (r.oee.why || []).includes('no_ct') ? 'ไม่รู้ CT' : ''}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      </>)}
    </div>
  );
}

