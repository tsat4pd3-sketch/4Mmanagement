/* 📈 ประวัติการใช้ไฟ & Excel — /energy?tab=history (2026-11-20 · คำสั่ง user "เอาแบบ Node-RED ต่างแค่สีคุมโทนเรา")
   ต้นแบบ: หน้า "ประวัติการใช้ไฟ & รายงาน" ของ Node-RED (TSS Smart Energy)
   · เลือกตู้ (?hm=<ตู้>) หรือ "เทียบทุกตู้" (?hm=*) · ช่วงเวลา/ความละเอียด = <TimeRangeBar> มาตรฐาน (ห้ามวาดปุ่มสเกลเอง)
   · ข้อมูล: energy_readings รายนาที (เก็บ 7 วัน) — ใช้เมื่อช่วงอยู่ในนั้นและไม่เกิน MINUTE_MAX_DAYS วัน · energy_daily รายวัน (ยาว)
   · สูตรทั้งหมด = energyHistory() / minuteKwh() ใน utils/energy.js — ไฟล์นี้วาดอย่างเดียว
   · ไม่รู้ = "—" ห้ามโชว์ 0 · ไม่มีรายนาที = เขียนบอกว่ากราฟ V/A/kW ดูได้ช่วงไหน
   · ส่งออก = CSV (เปิดใน Excel ได้) ผ่านทะเบียนเอกสาร `csv_energy_history` (/doc-forms) */
import { useCallback, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ResponsiveContainer, LineChart, BarChart, Line, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { chartAnim } from '../utils/motion';
import { supabaseDR } from '../supabaseClient';
import { usePolling } from '../utils/usePolling';
import { RATE } from '../utils/refreshRates';
import useTimeRange from '../utils/useTimeRange';
import { rangeDays, addDays } from '../utils/timeRange';
import { fetchAllRows } from '../utils/fetchAllRows';
import { energyHistory, minuteKwh, runMinutes } from '../utils/energy';
import { downloadCsvDoc, csvText } from '../utils/csvDoc';
import { loadDocForms } from '../utils/docForms';
import { tooltipProps, axisTick, fmtAxis, CHART_MARGIN, alignedYWidth } from '../utils/chartAxis';
import TimeRangeBar from './TimeRangeBar';
import NoticeBar from './NoticeBar';
import { toast } from './Toast';
import { tr, dateLocale } from '../utils/i18n';
import useIsMobile from '../utils/useIsMobile';
import Segmented from './Segmented';
import { bkkHourKey } from '../utils/timeRange';

const GOOD = 'var(--green)', WARN = 'var(--amber)', BAD = 'var(--red)', ACC = 'var(--accent2)', INFO = 'var(--blue)', IDLE = 'var(--muted)';
const SERIES = [ACC, INFO, GOOD, WARN, 'var(--blue-line)', IDLE];
const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 14, boxShadow: 'var(--shadow-sm)', minWidth: 0 };
const KEEP_DAYS = 7;              // energy_readings เก็บ 7 วัน (ingest-energy READINGS_KEEP_DAYS)
const MINUTE_MAX_DAYS = 3;        // เกินนี้ไม่ดึงรายนาที (egress) — ใช้ยอดรายวันแทน
const EVENTS_MAX = 1000;
const fmt = (v, d = 1) => (v == null || !Number.isFinite(Number(v)) ? '—'
  : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
/* ⏱️ ดูเฉพาะ N ชม. ล่าสุด (25/11 คำสั่ง user · แบบ Node-RED 1/6/24 ชม.) — `?hw=` · ใช้ได้เมื่อช่วงจบที่วันนี้ */
const HOUR_WINDOWS = [{ value: 'all', label: 'ทั้งช่วง' }, { value: '1', label: '1 ชม.' }, { value: '6', label: '6 ชม.' }, { value: '24', label: '24 ชม.' }];
const workDateOf = (ms) => (bkkHourKey(ms - 8 * 3600000) || '').slice(0, 10);   // วันทำงาน (ก่อน 08:00 = วันก่อน)
const tLabel = (ms) => new Date(ms).toLocaleString(dateLocale(), { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function EnergyHistory() {
  const [sp, setSp] = useSearchParams();
  const range = useTimeRange({ defaultScale: 'hour', defaultDays: 1, finest: 'hour' });
  const { from, to, scale } = range;
  const [meters, setMeters] = useState(null);
  const [data, setData] = useState(null);
  const [evFilter, setEvFilter] = useState('all');
  const req = useRef(0);
  const isMobile = useIsMobile();

  const hm = sp.get('hm') || '';
  const compare = hm === '*';
  const names = useMemo(() => {
    const all = (meters || []).map(m => m.scope_name);
    if (compare) return all;
    return all.includes(hm) ? [hm] : all.slice(0, 1);
  }, [meters, hm, compare]);
  const namesKey = names.join('|');
  const pick = (v) => setSp(p => { const n = new URLSearchParams(p); if (v) n.set('hm', v); else n.delete('hm'); return n; }, { replace: true });

  /* รายนาทีใช้ได้เมื่อช่วงทั้งหมดอยู่ใน 7 วันล่าสุด และไม่เกิน 3 วัน */
  const today = range.today;
  const minuteWanted = rangeDays(from, to) <= MINUTE_MAX_DAYS && from >= addDays(today, -(KEEP_DAYS - 1));
  const winOk = to === today;                                  // "N ชม. ล่าสุด" มีความหมายเมื่อช่วงจบที่วันนี้
  const hw = winOk && ['1', '6', '24'].includes(sp.get('hw')) ? sp.get('hw') : 'all';
  const pickHw = (v) => setSp(p => { const n = new URLSearchParams(p); if (v === 'all') n.delete('hw'); else n.set('hw', v); return n; }, { replace: true });

  const load = useCallback(async () => {
    const id = ++req.current;
    setData(d => (d ? { ...d, loading: true } : d));
    let reg = meters;
    if (!reg) {
      const m = await supabaseDR.from('energy_live_meters').select('scope_kind, scope_name, panel, parent_name, subtitle, idle_kw, sort_order').eq('is_active', true).order('sort_order').order('scope_name');
      if (id !== req.current) return;
      if (m.error) { setData({ err: 'อ่านทะเบียนตู้ไม่ได้' }); return; }
      reg = m.data || [];
      setMeters(reg);
    }
    const all = reg.map(m => m.scope_name);
    const ns = compare ? all : (all.includes(hm) ? [hm] : all.slice(0, 1));
    if (!ns.length) { setData({ empty: true }); return; }
    const nowMs = Date.now();
    const hwN = hw === 'all' ? 0 : Number(hw);
    const win = hwN ? { a: nowMs - hwN * 3600000, b: nowMs + 60000 } : null;
    // มีช่วงชั่วโมง = ดึงเฉพาะช่วงนั้น (+5 นาทีก่อนหน้าเป็นฐานส่วนต่างเลขมิเตอร์)
    const a = new Date(win ? win.a - 5 * 60000 : Date.parse(`${from}T08:00:00+07:00`)).toISOString();
    const b = new Date(win ? win.b : Date.parse(`${to}T08:00:00+07:00`) + 86400000).toISOString();
    const [rd, dy, ev] = await Promise.all([
      (minuteWanted || win) ? fetchAllRows(supabaseDR, 'energy_readings', 'scope_name, bucket_at, kw, kw_max, kwh_total, v, a, a_max, v1, v2, v3',
        q => q.eq('scope_kind', 'zone').in('scope_name', ns).gte('bucket_at', a).lt('bucket_at', b).order('bucket_at').order('scope_name'))
        : Promise.resolve({ data: [], error: null }),
      fetchAllRows(supabaseDR, 'energy_daily', 'scope_name, day, kwh, peak_kw, peak_at',
        q => q.eq('scope_kind', 'zone').in('scope_name', ns).gte('day', from).lte('day', to).order('day').order('scope_name')),
      supabaseDR.from('energy_events').select('source_id, scope_name, ev_time, level, kind, message')
        .eq('scope_kind', 'zone').in('scope_name', ns).gte('ev_time', a).lt('ev_time', b).order('ev_time', { ascending: false }).limit(EVENTS_MAX),
    ]);
    if (id !== req.current) return;
    setData({
      names: ns, readings: rd.data || [], daily: dy.data || [], events: ev.data || [],
      errors: [rd.error && 'ค่ารายนาที', dy.error && 'ยอดรายวัน', ev.error && 'เหตุการณ์'].filter(Boolean),
      evCapped: (ev.data || []).length >= EVENTS_MAX, at: nowMs, win,
    });
  }, [from, to, hm, compare, minuteWanted, meters, hw]); // eslint-disable-line react-hooks/exhaustive-deps
  usePolling(load, RATE.ANALYTIC);

  const h = useMemo(() => (data?.names ? energyHistory({
    readings: data.readings, daily: data.daily, names: data.names, scale, nowMs: data.at, win: data.win,
    from: data.win ? workDateOf(data.win.a) : from, to,
  }) : null), [data, scale, from, to]);
  const inWin = (t) => !data?.win || (t >= data.win.a && t < data.win.b);

  /* กราฟเส้นรายนาที — 1 แถวต่อนาที รวมทุกตู้ (คีย์ = ชื่อตู้) */
  const minuteRows = useMemo(() => {
    if (!data?.readings?.length) return [];
    const by = new Map();
    for (const r of data.readings) {
      const t = Date.parse(r.bucket_at);
      if (!inWin(t)) continue;
      if (!by.has(t)) by.set(t, { t });
      const o = by.get(t);
      o[`kw:${r.scope_name}`] = r.kw == null ? null : Number(r.kw);
      o[`kwmax:${r.scope_name}`] = r.kw_max == null ? null : Number(r.kw_max);
      o[`v:${r.scope_name}`] = r.v == null ? null : Number(r.v);
      o[`a:${r.scope_name}`] = r.a == null ? null : Number(r.a);
      // 🔌 แรงดันรายเฟส (ingest v11 · 27/11 — เก็บตั้งแต่วันนั้น ก่อนหน้านี้ = ว่าง)
      for (const f of ['v1', 'v2', 'v3']) o[`${f}:${r.scope_name}`] = r[f] == null ? null : Number(r[f]);
    }
    return [...by.values()].sort((x, y) => x.t - y.t);
  }, [data]);
  const kwhRows = useMemo(() => (h ? h.axis.map(x => ({ label: x.label, ...Object.fromEntries((data?.names || []).map(n => [n, h.kwh[n]?.[x.key] ?? null])) })) : []), [h, data]);
  const events = useMemo(() => (data?.events || []).filter(e => inWin(Date.parse(e.ev_time))).filter(e => {
    const ok = e.kind === 'CLEAR' || e.level === 'ok';
    return evFilter === 'all' || (evFilter === 'warn' ? !ok : ok);
  }), [data, evFilter]);
  const evCount = useMemo(() => {
    const all = (data?.events || []).filter(e => inWin(Date.parse(e.ev_time)));
    const ok = all.filter(e => e.kind === 'CLEAR' || e.level === 'ok').length;
    return { all: all.length, warn: all.length - ok, ok };
  }, [data]);

  const exportCsv = async () => {
    if (!h) return;
    await loadDocForms().catch(() => null);
    const ns = data.names;
    const headers = ['ช่วง', ...ns.map(n => `${n} (kWh)`)];
    const body = h.axis.map(x => [x.label, ...ns.map(n => (h.kwh[n]?.[x.key] == null ? '' : Math.round(h.kwh[n][x.key] * 1000) / 1000))]);
    const rows = data.readings.filter(r => inWin(Date.parse(r.bucket_at)));
    if (rows.length) {
      body.push([], ['รายนาที', 'ตู้', 'kW', 'V', 'A', 'เลขมิเตอร์ (kWh)']);
      for (const r of rows) body.push([tLabel(Date.parse(r.bucket_at)), r.scope_name, r.kw ?? '', r.v ?? '', r.a ?? '', r.kwh_total ?? '']);
    }
    downloadCsvDoc('csv_energy_history', `energy-history_${compare ? 'all' : ns[0]}_${from}_${to}.csv`, csvText(headers, body));
    toast.success(`${tr("ส่งออก")} ${body.length} ${tr("แถว")}`);
  };

  const single = !compare && data?.names?.length === 1;
  const meterRow = single ? (meters || []).find(m => m.scope_name === data.names[0]) : null;
  const idleKw = meterRow?.idle_kw == null || meterRow.idle_kw === '' ? null : Number(meterRow.idle_kw);
  /* ⏱️ ชั่วโมงทำงาน (27/11) — นาทีที่ kW ≥ เกณฑ์รอ · สูตร runMinutes() · เกณฑ์ว่าง = บอก ห้ามเดา */
  const runInfo = useMemo(() => (single && data?.readings?.length
    ? runMinutes(data.readings.filter(r => r.scope_name === data.names[0] && inWin(Date.parse(r.bucket_at))), idleKw) : null), [data, single, idleKw]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasPhaseV = single && minuteRows.some(r => ['v1', 'v2', 'v3'].some(f => r[`${f}:${data.names[0]}`] != null));
  /* 📊 kWh ต่อนาที (27/11) — ส่วนต่างเลขมิเตอร์รายนาที (minuteKwh) · ตู้เดียว */
  const perMin = useMemo(() => (single && data?.readings?.length
    ? minuteKwh(data.readings).filter(x => x.name === data.names[0] && inWin(x.t)).map(x => ({ t: x.t, kwh: x.kwh })) : []), [data, single]); // eslint-disable-line react-hooks/exhaustive-deps
  const perMinMax = perMin.reduce((a, b) => (a == null || b.kwh > a.kwh ? b : a), null);
  const perMinSum = perMin.reduce((s2, x) => s2 + x.kwh, 0);
  const hasKwMax = minuteRows.some(r => Object.keys(r).some(k => k.startsWith('kwmax:') && r[k] != null));
  const yW = alignedYWidth(minuteRows.flatMap(r => Object.entries(r).filter(([k]) => k !== 't').map(([, v]) => v)).filter(v => v != null).map(v => fmtAxis(Math.ceil(v))));
  const lineChart = (prefix, unit, title, color) => (
    <div style={card}>
      <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{title}</div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 6 }}>{tr('แกน Y:')} {unit} · {tr('1 จุด = 1 นาที · ชี้เพื่อดูค่า')}</div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={minuteRows} margin={CHART_MARGIN} syncId="energy-history">
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={tLabel} tick={axisTick()} minTickGap={60} />
          <YAxis width={yW} tick={axisTick()} tickFormatter={fmtAxis} domain={['auto', 'auto']} />
          <Tooltip {...tooltipProps()} labelFormatter={tLabel} formatter={(v, k) => [`${fmt(v, 1)} ${unit}`, String(k).startsWith(tr('สูงสุดในนาที')) ? `${tr('สูงสุดในนาที')} · ${String(k).split(':')[1]}` : String(k).split(':')[1]]} />
          {(data?.names || []).length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} formatter={(k) => String(k).split(':')[1]} />}
          {(data?.names || []).map((n, i) => (
            <Line key={n} type="monotone" dataKey={`${prefix}:${n}`} name={`${prefix}:${n}`} stroke={single ? color : SERIES[i % SERIES.length]} dot={false} strokeWidth={1.6} {...chartAnim()} connectNulls={false} />
          ))}
          {/* 📈 เส้นประ = สูงสุดในนาที (kw_max · ingest v10 + flow ใหม่ 23/11) — ตู้เดียว และมีค่าเท่านั้น */}
          {prefix === 'kw' && single && hasKwMax && (
            <Line type="monotone" dataKey={`kwmax:${data.names[0]}`} name={`${tr('สูงสุดในนาที')}:${data.names[0]}`} stroke={color} strokeDasharray="5 4" strokeOpacity={0.7}
              dot={false} strokeWidth={1.2} {...chartAnim()} connectNulls={false} />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );

  /* 🔌 แรงดัน 3 เฟส (ระหว่างสาย L1-L2 / L2-L3 / L3-L1) — สีเดียว แยกด้วยลายเส้น · แกนเดียว */
  const phaseChart = () => (
    <div style={card}>
      <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{tr('แรงดัน 3 เฟส (V)')}</div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 6 }}>{tr('แกน Y:')} V · {tr('1 จุด = 1 นาที · ชี้เพื่อดูค่า')} · {tr('เส้นทึบ L1-L2 · ประยาว L2-L3 · ประสั้น L3-L1')}</div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={minuteRows} margin={CHART_MARGIN} syncId="energy-history">
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={tLabel} tick={axisTick()} minTickGap={60} />
          <YAxis width={yW} tick={axisTick()} tickFormatter={fmtAxis} domain={['auto', 'auto']} />
          <Tooltip {...tooltipProps()} labelFormatter={tLabel} formatter={(v, k) => [`${fmt(v, 1)} V`, k]} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {[['v1', 'L1-L2', undefined], ['v2', 'L2-L3', '6 4'], ['v3', 'L3-L1', '2 3']].map(([f, lbl, dash]) => (
            <Line key={f} type="monotone" dataKey={`${f}:${data.names[0]}`} name={lbl} stroke={INFO} strokeDasharray={dash} dot={false} strokeWidth={1.6} {...chartAnim()} connectNulls={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );

  return (
    <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
      <TimeRangeBar scale={scale} from={from} to={to} today={today} finest="hour"
        onScale={range.setScale} onFrom={range.setFrom} onTo={range.setTo} onPreset={range.setPreset} onView={range.setView} onReload={load} loading={!!data?.loading}>
        <div role="radiogroup" aria-label={tr('เลือกตู้')} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(meters || []).map(m => {
            const on = !compare && names[0] === m.scope_name;
            return <button key={m.scope_name} type="button" role="radio" aria-checked={on} className={`pg-btn${on ? ' primary' : ''}`} onClick={() => pick(m.scope_name)}>{m.scope_name}</button>;
          })}
          {(meters || []).length > 1 && (
            <button type="button" role="radio" aria-checked={compare} className={`pg-btn${compare ? ' primary' : ''}`} onClick={() => pick('*')}>⇆ {tr('เทียบทุกตู้')}</button>
          )}
        </div>
        {winOk && <Segmented value={hw} onChange={pickHw} options={HOUR_WINDOWS} label={tr('ช่วงชั่วโมงล่าสุด')} />}
        <button type="button" className="pg-btn" onClick={exportCsv} disabled={!h}>⬇ {tr('Excel (CSV)')}</button>
      </TimeRangeBar>
      {data?.win && (
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          {tr('ดูเฉพาะ')} {hw} {tr('ชม. ล่าสุด')} ({tLabel(data.win.a)} → {tr('ตอนนี้')}) · {tr('ทุกตัวเลข กราฟ เหตุการณ์ และไฟล์ Excel คิดเฉพาะช่วงนี้')}
        </div>
      )}

      {data?.err && <NoticeBar tone="bad">{data.err}</NoticeBar>}
      {data?.empty && <NoticeBar tone="warn">{tr('ยังไม่มีตู้ในทะเบียนบอร์ดสด')}</NoticeBar>}
      {data?.errors?.length > 0 && <NoticeBar tone="bad">{tr('อ่านไม่สำเร็จ:')} {data.errors.join(' · ')} — {tr('ตัวเลขอาจไม่ครบ')}</NoticeBar>}
      {data == null ? <div style={{ color: 'var(--muted)', padding: 16 }}>{tr('กำลังโหลด…')}</div> : h && (<>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
          <Tile color={ACC} label={tr('ไฟที่ใช้ในช่วงนี้')} value={fmt(h.totalKwh)} unit="kWh"
            sub={`${compare ? tr('ทุกตู้รวมกัน') : data.names[0]} · ${from}${to !== from ? ` → ${to}` : ''}`} />
          <Tile color={GOOD} label={tr('กำลังไฟ เฉลี่ย / สูงสุด')} value={fmt(h.kpi.avgKw)} unit={`/ ${fmt(h.kpi.peakKw)} kW`}
            sub={h.kpi.peakAt ? `${tr('พีค')} ${tLabel(h.kpi.peakAt)}` : tr('ยังไม่มีค่าพีค')} />
          <Tile color={INFO} label={tr('แรงดันเฉลี่ย · กระแสสูงสุด')} value={fmt(h.kpi.vAvg, 0)} unit={`V · ${fmt(h.kpi.aMax, 0)} A`}
            sub={h.minuteOk ? tr('ทั้งช่วงเวลาที่เลือก') : tr('ต้องใช้ข้อมูลรายนาที (7 วันล่าสุด ไม่เกิน 3 วัน)')} />
          <Tile color={h.kpi.coverage == null ? IDLE : h.kpi.coverage >= 0.95 ? GOOD : WARN} label={tr('ความครบของข้อมูล')}
            value={h.kpi.coverage == null ? '—' : `${fmt(h.kpi.coverage * 100, 0)}`} unit={h.kpi.coverage == null ? '' : '%'}
            sub={tr('นาทีที่มีค่า ÷ นาทีที่ควรมี (ตัดที่ตอนนี้)')} />
          {single && (
            <Tile color={runInfo?.pct == null ? IDLE : GOOD} label={tr('ชั่วโมงทำงาน')}
              value={runInfo?.pct == null ? '—' : fmt(runInfo.runMin / 60, 1)} unit={runInfo?.pct == null ? '' : `${tr('ชม.')} (${fmt(runInfo.pct * 100, 0)}%)`}
              sub={!h.minuteOk ? tr('ต้องใช้ข้อมูลรายนาที (7 วันล่าสุด ไม่เกิน 3 วัน)')
                : idleKw == null ? <span style={{ color: WARN }}>{tr('ยังไม่ได้ตั้งเกณฑ์รอ (แท็บตั้งค่าตู้)')}</span>
                : `${tr('นาทีที่ kW ≥')} ${fmt(idleKw, 1)} kW ÷ ${runInfo?.dataMin ?? 0} ${tr('นาทีที่มีค่า')}`} />
          )}
        </div>

        {!h.minuteOk && (
          <NoticeBar tone="info">
            {data.win ? `${tr('ยังไม่มีค่ารายนาทีใน')} ${hw} ${tr('ชม. ล่าสุด')}`
              : tr('กราฟแรงดัน / กระแส / กำลังไฟรายนาที ดูได้เมื่อช่วงอยู่ใน 7 วันล่าสุดและไม่เกิน 3 วัน — ช่วงนี้แสดงยอดหน่วยไฟจากยอดรายวัน')}
          </NoticeBar>
        )}
        {h.minuteOk && lineChart('kw', 'kW', single && hasKwMax ? tr('กำลังไฟ (kW) — เส้นทึบ = ค่าที่มิเตอร์ส่งมาในนาที · เส้นประ = สูงสุดในนาที') : tr('กำลังไฟ (kW)'), GOOD)}
        {h.minuteOk && single && (hasPhaseV ? phaseChart() : <>
          {lineChart('v', 'V', tr('แรงดัน (V) — เฉลี่ย 3 เฟส'), INFO)}
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: -6 }}>{tr('ยังไม่มีแรงดันรายเฟสในช่วงนี้ — เริ่มเก็บประวัติรายเฟสตั้งแต่ 27/11/2026 (ตู้ที่ส่ง v1-v3 มา)')}</div>
        </>)}
        {h.minuteOk && single && lineChart('a', 'A', tr('กระแส (A)'), ACC)}
        {h.minuteOk && single && perMin.length > 0 && (
          <div style={card}>
            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{tr('หน่วยไฟต่อนาที (kWh)')}</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 6 }}>
              {tr('แกน Y:')} kWh · {tr('1 แท่ง = 1 นาที (ส่วนต่างเลขมิเตอร์ · ถอยหลัง/ขาดช่วง = ไม่นับ)')} · {tr('รวม')} {fmt(perMinSum, 2)} kWh · {tr('เฉลี่ย')} {fmt(perMinSum / perMin.length, 3)} · {tr('สูงสุด')} {fmt(perMinMax?.kwh, 3)} ({tLabel(perMinMax?.t)})
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={perMin} margin={CHART_MARGIN} barCategoryGap={0}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={tLabel} tick={axisTick()} minTickGap={60} />
                <YAxis width="auto" tick={axisTick()} tickFormatter={fmtAxis} />
                <Tooltip {...tooltipProps()} labelFormatter={tLabel} formatter={(v) => [`${fmt(v, 3)} kWh`, tr('หน่วยไฟในนาที')]} />
                <Bar dataKey="kwh" fill="var(--accent2)" {...chartAnim()} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        <div style={card}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{tr('หน่วยไฟที่ใช้ (kWh)')}</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 6 }}>
            {scale === 'hour' ? tr('ส่วนต่างเลขมิเตอร์รายนาที รวมเป็นรายชั่วโมง (มิเตอร์ถอยหลัง = ไม่นับ)') : tr('จากยอดรายวันของมิเตอร์')} · {tr('แท่งว่าง = ไม่มีข้อมูล (ไม่ใช่ 0)')}
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={kwhRows} margin={CHART_MARGIN}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={axisTick()} minTickGap={6} />
              <YAxis width="auto" tick={axisTick()} tickFormatter={fmtAxis} />
              <Tooltip {...tooltipProps()} formatter={(v, k) => [`${fmt(v, 2)} kWh`, k]} />
              {(data.names || []).length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
              {(data.names || []).map((n, i) => <Bar key={n} dataKey={n} fill={single ? 'var(--accent2)' : SERIES[i % SERIES.length]} {...chartAnim()} />)}
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{tr('ประวัติเหตุการณ์')} ({compare ? tr('ทุกตู้') : data.names[0]})</div>
            <div role="radiogroup" aria-label={tr('กรองเหตุการณ์')} style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              {[['all', 'ทั้งหมด', evCount.all], ['warn', 'เตือน', evCount.warn], ['ok', 'ปกติแล้ว', evCount.ok]].map(([k, l, n]) => (
                <button key={k} type="button" role="radio" aria-checked={evFilter === k} className={`pg-btn${evFilter === k ? ' primary' : ''}`} onClick={() => setEvFilter(k)}>{tr(l)} {n}</button>
              ))}
            </div>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 6 }}>
            {tr('จาก Node-RED · เก็บย้อนหลัง 30 วัน')}{data.evCapped ? ` · ${tr('แสดง')} ${EVENTS_MAX.toLocaleString()} ${tr('รายการล่าสุด')}` : ''}
          </div>
          {!events.length ? <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{tr('ไม่มีเหตุการณ์ในช่วงนี้')}</div> : (
            <div style={{ maxHeight: 420, overflowY: 'auto', display: 'grid', gap: 2 }}>
              {events.map(e => {
                const ok = e.kind === 'CLEAR' || e.level === 'ok';
                const c = ok ? GOOD : (e.level === 'crit' || e.level === 'alarm') ? BAD : WARN;
                return (
                  <div key={e.source_id} style={{ display: 'grid', gridTemplateColumns: isMobile ? 'auto 1fr' : '150px 110px 80px 1fr', gap: isMobile ? 4 : 8, fontSize: 12.5, padding: '6px 8px', borderLeft: `3px solid ${c}`, background: 'var(--bg2)', borderRadius: 4, alignItems: 'center' }}>
                    <span style={{ color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>{tLabel(Date.parse(e.ev_time))}</span>
                    <b style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.scope_name}</b>
                    <span style={{ color: c, fontWeight: 700 }}>{ok ? tr('ปกติแล้ว') : tr('เตือน')}</span>
                    <span style={{ color: 'var(--text2)', minWidth: 0, overflowWrap: 'anywhere' }}>{e.message}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </>)}
    </div>
  );
}

function Tile({ color, label, value, unit, sub }) {
  return (
    <div style={{ ...card, borderTop: `3px solid ${color}` }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text2)' }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color, lineHeight: 1.2, marginTop: 4 }}>
        {value} <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--muted)' }}>{unit}</span>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>{sub}</div>
    </div>
  );
}
