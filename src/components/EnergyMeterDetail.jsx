/* 🔍 หน้ารายตู้ — /energy?tab=live&meter=<ชื่อตู้> (2026-11-10 · คำสั่ง user "คลิกการ์ดเข้าหน้าตู้แบบ Node-RED")
   ทำจากข้อมูลที่ ESM มี (user เลือก): สรุปรายนาที 24 ชม. · ยอดรายวัน 30 วัน · เหตุการณ์ · เครื่องที่ตู้จ่าย · สัดส่วนโหลด
   ⚠️ ไม่มีค่าแยก 3 เฟส/รายวินาทีในฐาน — จอต้องบอกตรงๆ ห้ามแต่งค่า (ค่าละเอียดดูที่ Node-RED)
   ⚠️ สถานะ/ลิมิต/ยอดของตู้มาจาก buildLiveBoard() ที่หน้าแม่ส่งมา (prop `m`) — ห้ามคิดซ้ำในหน้านี้
   ⚠️ egress: เลือกเฉพาะคอลัมน์ · กราฟโหลด 24 ชม. ครั้งเดียว แล้วรอบต่อไปดึงเฉพาะนาทีที่ใหม่กว่า */
import { useState, useCallback, useMemo, useRef } from 'react';
import { ResponsiveContainer, LineChart, BarChart, Line, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from 'recharts';
import { supabaseDR } from '../supabaseClient';
import { usePolling } from '../utils/usePolling';
import { RATE } from '../utils/refreshRates';
import { addDaysStr, bkkDateStr } from '../utils/workDate';
import { meterDetailSeries, loadShare } from '../utils/energy';
import { tooltipProps, axisTick, alignedYWidth, fmtAxis, CHART_MARGIN } from '../utils/chartAxis';
import NoticeBar from './NoticeBar';
import useIsMobile from '../utils/useIsMobile';

import { tr } from '../utils/i18n';
const GOOD = 'var(--green)', WARN = 'var(--amber)', BAD = 'var(--red)', IDLE = 'var(--muted)', ACC = 'var(--accent2)', INFO = 'var(--blue)';
const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 14, boxShadow: 'var(--shadow-sm)' };
const PAGE = 1000;
const WINDOW_H = 24;
const DAYS = 30;
const EVENTS_SHOW = 50;

const fmt = (v, d = 1) => (v == null || !Number.isFinite(Number(v)) ? '—'
  : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const hhmm = (ms) => new Date(ms).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });
const dayLabel = (ms) => (!Number.isFinite(Number(ms)) ? '—' : new Date(Number(ms)).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }));

/** แถวรายนาทีของตู้เดียว ตั้งแต่ from — วนทีละ 1000 แถว · error = throw (ห้ามกลืนเป็นกราฟว่าง) */
async function fetchMeterReadings(scopeKind, scopeName, from, inclusive) {
  const out = [];
  for (let off = 0; off < 10 * PAGE; off += PAGE) {
    const { data, error } = await supabaseDR.from('energy_readings')
      .select('bucket_at, kw, a, v')
      .eq('scope_kind', scopeKind).eq('scope_name', scopeName)
      .filter('bucket_at', inclusive ? 'gte' : 'gt', from).order('bucket_at').range(off, off + PAGE - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export default function EnergyMeterDetail({ m, machines, boardMeters, totalTodayKwh, onBack }) {
  const [rows, setRows] = useState([]);
  const [daily, setDaily] = useState(null);       // null = อ่านไม่ได้
  const [events, setEvents] = useState(null);     // null = อ่านไม่ได้
  const [err, setErr] = useState('');
  const [loaded, setLoaded] = useState(false);
  const last = useRef(null);                      // นาทีล่าสุดที่มีแล้ว
  const evLast = useRef(null);
  const reqId = useRef(0);
  const isMobile = useIsMobile();
  const [kind, name] = m.key.split('|');

  const load = useCallback(async () => {
    const id = ++reqId.current;
    const now = Date.now();
    const winFrom = new Date(now - WINDOW_H * 3600000).toISOString();
    const first = !last.current;
    try {
      const r = await fetchMeterReadings(kind, name, first ? winFrom : last.current, first);
      const today = bkkDateStr(now);
      const d = await supabaseDR.from('energy_daily').select('day, kwh, peak_kw, resets')
        .eq('scope_kind', kind).eq('scope_name', name).gte('day', addDaysStr(today, -(DAYS - 1))).order('day');
      const evQ = supabaseDR.from('energy_events').select('source_id, ev_time, level, kind, message, duration_s')
        .eq('scope_kind', kind).eq('scope_name', name);
      const ev = evLast.current
        ? await evQ.gt('ev_time', evLast.current).order('ev_time', { ascending: false }).limit(EVENTS_SHOW)
        : await evQ.order('ev_time', { ascending: false }).limit(EVENTS_SHOW);
      if (id !== reqId.current) return;     // มีรอบใหม่กว่าแล้ว — ทิ้งผลเก่า
      setErr('');
      const cut = now - WINDOW_H * 3600000;
      setRows(prev => [...(first ? [] : prev), ...r].filter(x => Date.parse(x.bucket_at) >= cut));
      if (r.length) last.current = r[r.length - 1].bucket_at;
      else if (first) last.current = winFrom;
      setDaily(d.error ? (prev => prev) : (d.data || []));
      if (!ev.error) {
        if (ev.data?.length) evLast.current = ev.data[0].ev_time;
        setEvents(prev => {
          const seen = new Set((ev.data || []).map(x => x.source_id));
          return [...(ev.data || []), ...(prev || []).filter(x => !seen.has(x.source_id))].slice(0, EVENTS_SHOW);
        });
      }
    } catch (ex) {
      if (id === reqId.current) setErr(ex?.message || String(ex));
    } finally {
      if (id === reqId.current) setLoaded(true);
    }
  }, [kind, name]);
  usePolling(load, RATE.METER);

  const series = useMemo(() => meterDetailSeries(rows), [rows]);
  const share = useMemo(() => loadShare(boardMeters), [boardMeters]);
  const byLine = useMemo(() => {
    const g = new Map();
    for (const x of machines) { const l = x.line || '—'; if (!g.has(l)) g.set(l, []); g.get(l).push(x.no); }
    return [...g].map(([line, nos]) => [line, nos.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))])
      .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
  }, [machines]);
  const dailyBars = useMemo(() => (daily || []).map(d => ({ day: d.day, kwh: d.kwh == null ? null : Number(d.kwh), peak: d.peak_kw == null ? null : Number(d.peak_kw) })), [daily]);

  const st = m.status === 'never' ? { label: 'ยังไม่เคยได้รับค่า', color: IDLE }
    : m.status === 'offline' ? { label: `ขาดการติดต่อ ${m.ageMin} นาที`, color: WARN }
      : (m.overKw || m.overA) ? { label: 'เกินลิมิต', color: BAD } : { label: 'ออนไลน์', color: GOOD };
  const kwVals = series.map(p => p.kw).filter(v => v != null);
  const aVals = series.map(p => p.a).filter(v => v != null);
  const yW = alignedYWidth([...kwVals, ...aVals, m.limitKw, m.limitA].filter(v => v != null).map(v => fmtAxis(Math.ceil(v))));
  const xDomain = series.length ? [series[0].t, series[series.length - 1].t] : ['auto', 'auto'];
  const todayPct = m.todayKwh != null && totalTodayKwh ? (m.todayKwh / totalTodayKwh) * 100 : null;
  const avgDay = m.monthKwh != null && m.monthDays ? m.monthKwh / m.monthDays : null;

  return (
    <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button type="button" onClick={onBack} className="pg-btn" style={{ whiteSpace: 'nowrap' }}>{tr('← กลับบอร์ดรวม')}</button>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)' }}>{m.name} <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--muted)' }}>{tr('· ตู้')} {m.panel}</span></div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{m.subtitle}</div>
        </div>
        <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: st.color, border: `1px solid ${st.color}`, borderRadius: 999, padding: '3px 12px', whiteSpace: 'nowrap' }}>● {tr(st.label)}</span>
      </div>

      {err && <NoticeBar tone="bad">{tr('โหลดข้อมูลตู้ไม่สำเร็จ:')} {err} {tr('— กราฟเป็นของรอบก่อนหน้า')}</NoticeBar>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, alignContent: 'start' }}>
        <Kpi color={m.overKw ? BAD : GOOD} label={tr('กำลังไฟ (สูงสุดในนาทีล่าสุด)')} value={fmt(m.kw, 2)} unit="kW"
          sub={`สูงสุดวันนี้ ${fmt(m.peakKw)} kW · ลิมิต ${m.limitKw ?? '—'} kW`} />
        <Kpi color={INFO} label={tr('ใช้ไฟวันนี้')} value={fmt(m.todayKwh)} unit="kWh"
          sub={todayPct != null ? `${fmt(todayPct, 0)}% ของไฟทุกตู้วันนี้` : 'ตั้งแต่ 00:00 น.'} />
        <Kpi color={INFO} label={tr('ใช้ไฟเดือนนี้')} value={fmt(m.monthKwh, 0)} unit="kWh"
          sub={avgDay != null ? `เฉลี่ยวันละ ${fmt(avgDay)} kWh (${m.monthDays} วันที่มีข้อมูล)` : 'ยังไม่มีข้อมูลของเดือนนี้'} />
        <Kpi color={INFO} label={tr('เลขมิเตอร์สะสม')} value={fmt(m.kwhTotal, 0)} unit="kWh" sub={tr('อ่านตรงจากมิเตอร์ (Active Energy)')} />
        <Kpi color={m.overA ? BAD : ACC} label={tr('แรงดัน · กระแส')} value={<><span style={{ color: INFO }}>{fmt(m.v, 0)}</span><small style={{ fontSize: 13, color: 'var(--muted)' }}> V </small><span style={{ color: m.overA ? BAD : ACC }}>{fmt(m.a)}</span></>} unit="A"
          sub={`V เฉลี่ย 3 เฟส · A เฟสที่สูงสุด · ลิมิต ${m.limitA ?? '—'} A`} />
        <Kpi color={st.color} label={tr('สถานะมิเตอร์')} value={st.label} unit=""
          sub={m.ageMin == null ? 'ยังไม่เคยได้รับข้อมูล' : m.ageMin < 1 ? 'ข้อมูลล่าสุดเมื่อสักครู่' : `ข้อมูลล่าสุด ${m.ageMin} นาทีที่แล้ว`} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'minmax(0, 2fr) minmax(260px, 1fr)', gap: 12, alignContent: 'start' }}>
        <div style={{ ...card, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{tr('กราฟ 24 ชม. ล่าสุด ·')} {m.name}</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
            1 จุด = 1 นาที (kW = สูงสุดของนาที · A = เฟสที่สูงสุด) · เส้นประแดง = ลิมิต · ช่วงที่มิเตอร์หลุดเกิน 5 นาทีเส้นขาด
          </div>
          {!loaded ? <div style={{ color: 'var(--muted)', padding: 20 }}>{tr('กำลังโหลด…')}</div>
            : series.length < 2 ? <div style={{ color: 'var(--muted)', padding: 20, fontSize: 12.5 }}>{tr('ยังไม่มีค่ารายนาทีใน 24 ชม. ล่าสุด')}</div>
              : (<>
                <div style={{ fontSize: 12, fontWeight: 700, color: GOOD, marginTop: 8 }}>{tr('กำลังไฟ (kW)')}</div>
                <ResponsiveContainer width="100%" height={170}>
                  <LineChart data={series} syncId={`meter-${m.key}`} margin={CHART_MARGIN}>
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="t" type="number" domain={xDomain} scale="time" tick={false} height={4} />
                    <YAxis width={yW} tick={axisTick()} tickFormatter={fmtAxis} domain={[0, (max) => Math.max(max, m.limitKw || 0) * 1.05]} />
                    <Tooltip {...tooltipProps()} labelFormatter={dayLabel} formatter={(v) => [`${fmt(v, 2)} kW`, 'กำลังไฟ']} />
                    {m.limitKw != null && <ReferenceLine y={m.limitKw} stroke={BAD} strokeDasharray="6 4" />}
                    <Line type="linear" dataKey="kw" stroke={GOOD} dot={false} strokeWidth={1.5} isAnimationActive={false} connectNulls={false} />
                  </LineChart>
                </ResponsiveContainer>
                <div style={{ fontSize: 12, fontWeight: 700, color: ACC, marginTop: 6 }}>{tr('กระแส เฟสที่สูงสุด (A)')}</div>
                <ResponsiveContainer width="100%" height={170}>
                  <LineChart data={series} syncId={`meter-${m.key}`} margin={CHART_MARGIN}>
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="t" type="number" domain={xDomain} scale="time" tickFormatter={hhmm} tick={axisTick()} minTickGap={40} />
                    <YAxis width={yW} tick={axisTick()} tickFormatter={fmtAxis} domain={[0, (max) => Math.max(max, m.limitA || 0) * 1.05]} />
                    <Tooltip {...tooltipProps()} labelFormatter={dayLabel} formatter={(v) => [`${fmt(v, 1)} A`, 'กระแส']} />
                    {m.limitA != null && <ReferenceLine y={m.limitA} stroke={BAD} strokeDasharray="6 4" />}
                    <Line type="linear" dataKey="a" stroke={ACC} dot={false} strokeWidth={1.5} isAnimationActive={false} connectNulls={false} />
                  </LineChart>
                </ResponsiveContainer>
              </>)}
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>
            ℹ️ ESM เก็บค่าสรุปรายนาที (ย้อนหลัง 7 วัน) — ค่าแยก 3 เฟส (L1/L2/L3) และกราฟรายวินาที ยังดูได้ที่ Node-RED
          </div>
        </div>

        <div style={{ ...card, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{tr('สัดส่วนโหลดตอนนี้')}</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 8 }}>
            kW ของตู้ ÷ รวมทุกตู้ที่ออนไลน์ ({fmt(share.total)} kW)
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {share.rows.map(r => (
              <div key={r.key}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, fontWeight: r.key === m.key ? 800 : 500, color: r.key === m.key ? 'var(--text)' : 'var(--text2)' }}>
                  <span>{r.name}</span><span>{r.pct == null ? 'ไม่ออนไลน์' : `${fmt(r.pct, 0)}% · ${fmt(r.kw)} kW`}</span>
                </div>
                <div style={{ height: 8, background: 'var(--bg2)', borderRadius: 4, overflow: 'hidden' }}>
                  {r.pct != null && <div style={{ width: `${r.pct}%`, height: '100%', background: r.key === m.key ? ACC : IDLE }} />}
                </div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', marginTop: 16 }}>{tr('เครื่องที่ตู้นี้จ่ายไฟ')}</div>
          {!byLine.length ? <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{tr('ยังไม่ได้ผูกเครื่องกับตู้นี้')}</div>
            : byLine.map(([line, nos]) => (
              <div key={line} style={{ fontSize: 12.5, color: 'var(--text2)', marginTop: 6 }}>
                <b style={{ color: 'var(--text)' }}>{line}</b> ({nos.length}) — {nos.join(', ')}
              </div>
            ))}
          {byLine.length > 1 && <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>{tr('ตู้จ่ายหลายไลน์ — ค่าไฟเป็นยอดรวมทั้งตู้ ไม่ได้แบ่งรายไลน์')}</div>}
        </div>
      </div>

      <div style={{ ...card, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{tr('ใช้ไฟรายวัน')} {DAYS} {tr('วันล่าสุด (kWh)')}</div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>จากเลขมิเตอร์ต้น-ท้ายวัน · วันที่ไม่มีแท่ง = ไม่มีข้อมูล (ไม่ใช่ 0)</div>
        {daily == null ? <div style={{ color: 'var(--muted)', padding: 16, fontSize: 12.5 }}>{loaded ? tr('อ่านยอดรายวันไม่ได้') : tr('กำลังโหลด…')}</div>
          : !dailyBars.length ? <div style={{ color: 'var(--muted)', padding: 16, fontSize: 12.5 }}>{tr('ยังไม่มียอดรายวัน')}</div>
            : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={dailyBars} margin={CHART_MARGIN}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="day" tick={axisTick()} tickFormatter={(d) => `${Number(d.slice(8))}/${Number(d.slice(5, 7))}`} minTickGap={8} />
                  <YAxis width="auto" tick={axisTick()} tickFormatter={fmtAxis} />
                  <Tooltip {...tooltipProps()} labelFormatter={(d) => new Date(`${d}T00:00:00+07:00`).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', weekday: 'short', day: 'numeric', month: 'short' })}
                    formatter={(v, k, p) => [`${fmt(v)} kWh${p?.payload?.peak != null ? ` · สูงสุด ${fmt(p.payload.peak)} kW` : ''}`, 'ใช้ไฟ']} />
                  <Bar dataKey="kwh" fill={INFO} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            )}
      </div>

      <div style={{ ...card }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{tr('เหตุการณ์ของ')} {m.name}</div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 8 }}>{tr('จาก Node-RED (เกณฑ์ตั้งที่ Node-RED) ·')} {EVENTS_SHOW} {tr('รายการล่าสุด · ใหม่อยู่บน')}</div>
        {events == null ? <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{loaded ? tr('อ่านเหตุการณ์ไม่ได้') : tr('กำลังโหลด…')}</div>
          : !events.length ? <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{tr('ยังไม่มีเหตุการณ์ของตู้นี้')}</div>
            : (
              <div style={{ maxHeight: 320, overflowY: 'auto', display: 'grid', gap: 2 }}>
                {events.map(e => {
                  const ok = e.kind === 'CLEAR' || e.level === 'ok';
                  const c = ok ? GOOD : (e.level === 'crit' || e.level === 'alarm') ? BAD : e.level === 'info' ? INFO : WARN;
                  return (
                    <div key={e.source_id} style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8, fontSize: 12.5, padding: '5px 6px', borderLeft: `3px solid ${c}`, background: 'var(--bg2)', borderRadius: 4 }}>
                      <span style={{ color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>{dayLabel(Date.parse(e.ev_time))}</span>
                      <span style={{ color: 'var(--text2)', minWidth: 0, overflowWrap: 'anywhere' }}>{e.message}</span>
                    </div>
                  );
                })}
              </div>
            )}
      </div>
    </div>
  );
}

function Kpi({ color, label, value, unit, sub }) {
  return (
    <div style={{ ...card, borderLeft: `4px solid ${color}` }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text2)' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text)', lineHeight: 1.2, marginTop: 4 }}>
        {value} <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--muted)' }}>{unit}</span>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>{sub}</div>
    </div>
  );
}
