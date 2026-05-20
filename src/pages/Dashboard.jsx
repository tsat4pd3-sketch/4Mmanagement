import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { motion, AnimatePresence } from 'framer-motion';

const FADE_UP = { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 } };
const stagger = (i) => ({ ...FADE_UP, transition: { delay: i * 0.06, duration: 0.35 } });

function useNow() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.innerWidth <= 768);
  useEffect(() => {
    const h = () => setMobile(window.innerWidth <= 768);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  return mobile;
}

function getShiftInfo(date) {
  const h = date.getHours();
  const m = date.getMinutes();
  const total = h * 60 + m;
  const isDay = total >= 480 && total < 1200;
  return { isDay, label: isDay ? 'กะเช้า' : 'กะดึก', icon: isDay ? '☀️' : '🌙' };
}

function RadialProgress({ pct, size = 80, stroke = 7, color = '#e31937' }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct / 100);
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke}
        style={{ stroke: 'var(--border2)' }} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color}
        strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={circ} strokeDashoffset={offset}
        style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
    </svg>
  );
}

function MiniBar({ value, max, color }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div style={{ height: 4, borderRadius: 3, background: 'var(--border2)', overflow: 'hidden', marginTop: 6 }}>
      <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width 0.7s ease' }} />
    </div>
  );
}

const CAT_META = {
  Man:      { color: '#4d9fff', icon: '👤', bg: 'rgba(77,159,255,0.12)' },
  Machine:  { color: '#f59e0b', icon: '⚙️', bg: 'rgba(245,158,11,0.12)' },
  Material: { color: '#a855f7', icon: '📦', bg: 'rgba(168,85,247,0.12)' },
  Method:   { color: '#22c55e', icon: '📋', bg: 'rgba(34,197,94,0.12)' },
};
const getCatMeta = (cat = '') => {
  const key = Object.keys(CAT_META).find(k => cat.includes(k));
  return key ? CAT_META[key] : { color: '#888', icon: '🔔', bg: 'rgba(128,128,128,0.1)' };
};

export default function Dashboard() {
  const now = useNow();
  const isMobile = useIsMobile();
  const shiftInfo = getShiftInfo(now);
  const todayStr = now.toISOString().split('T')[0];

  const [selectedDate,  setSelectedDate]  = useState(todayStr);
  const [selectedShift, setSelectedShift] = useState(shiftInfo.isDay ? 'day' : 'night');
  const [logs, setLogs]         = useState([]);
  const [fourMLogs, setFourMLogs] = useState([]);
  const [lines, setLines]       = useState([]);
  const [loading, setLoading]   = useState(true);

  const fetchAll = useCallback(async (date, shift) => {
    setLoading(true);
    let logQ = supabase.from('daily_production_logs')
      .select('id, is_present, has_helmet, has_boots, has_gloves, has_ot, shift, employees!inner(id, name, employee_id_code, line_id, is_active)')
      .eq('work_date', date)
      .eq('employees.is_active', true);
    if (shift !== 'all') logQ = logQ.eq('shift', shift);
    const [
      { data: logData },
      { data: fmData },
      { data: lineData },
    ] = await Promise.all([
      logQ,
      supabase.from('four_m_logs').select('*').eq('work_date', date).order('created_at', { ascending: false }),
      supabase.from('production_lines').select('id, name, section').order('name'),
    ]);
    setLogs(logData || []);
    setFourMLogs(fmData || []);
    setLines(lineData || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(selectedDate, selectedShift); }, [selectedDate, selectedShift]);

  const present = logs.filter(l => l.is_present);
  const absent  = logs.filter(l => !l.is_present);
  const ppeReady = present.filter(l => l.has_helmet && l.has_boots && l.has_gloves);
  const otCount  = present.filter(l => l.has_ot).length;
  const attendRate = logs.length > 0 ? Math.round((present.length / logs.length) * 100) : 0;
  const ppeRate    = present.length > 0 ? Math.round((ppeReady.length / present.length) * 100) : 0;

  const lineStats = lines.map(line => {
    const lineLogs = logs.filter(l => l.employees?.line_id === line.id);
    const linePresent = lineLogs.filter(l => l.is_present).length;
    const lineTotal   = lineLogs.length;
    const lineAlerts  = fourMLogs.filter(f => f.line_name === line.name).length;
    const rate = lineTotal > 0 ? Math.round((linePresent / lineTotal) * 100) : 0;
    return { ...line, linePresent, lineTotal, lineAlerts, rate };
  });

  const isToday = selectedDate === todayStr;

  return (
    <div className="page-content" style={{ maxWidth: 1400 }}>

      {/* ── Header ─────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28, gap: 16, flexWrap: 'wrap' }}>
        <motion.div {...stagger(0)}>
          <div style={{ fontSize: 'clamp(18px,3vw,24px)', fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--text)', letterSpacing: '-0.5px' }}>
            Production Overview
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
            {selectedShift !== 'all' && (
              <span style={{
                padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                background: selectedShift === 'day' ? 'rgba(245,158,11,0.15)' : 'rgba(77,159,255,0.15)',
                color: selectedShift === 'day' ? '#f59e0b' : '#4d9fff',
                border: `1px solid ${selectedShift === 'day' ? 'rgba(245,158,11,0.3)' : 'rgba(77,159,255,0.3)'}`,
              }}>
                {selectedShift === 'day' ? '☀️ กะเช้า' : '🌙 กะดึก'}
                {isToday && selectedShift === (shiftInfo.isDay ? 'day' : 'night') && ' · กะปัจจุบัน'}
              </span>
            )}
            <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--font-display)' }}>
              {isToday
                ? now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                : selectedDate}
            </span>
          </div>
        </motion.div>

        <motion.div {...stagger(1)} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Shift toggle */}
          <div style={{ display: 'flex', background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 10, padding: 3, gap: 2 }}>
            {[
              { val: 'day',   label: '☀️ กะเช้า', active: 'rgba(245,158,11,0.2)', color: '#f59e0b' },
              { val: 'night', label: '🌙 กะดึก',  active: 'rgba(77,159,255,0.2)', color: '#4d9fff' },
              { val: 'all',   label: 'ทั้งหมด',    active: 'rgba(255,255,255,0.1)', color: 'var(--text2)' },
            ].map(s => (
              <button key={s.val} onClick={() => setSelectedShift(s.val)}
                style={{
                  padding: '5px 12px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  background: selectedShift === s.val ? s.active : 'transparent',
                  color: selectedShift === s.val ? s.color : 'var(--muted)',
                  transition: 'all 0.15s',
                }}>
                {s.label}
              </button>
            ))}
          </div>
          {/* Date picker */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'var(--card)', border: '1px solid var(--border2)',
            padding: '8px 14px', borderRadius: 10,
          }}>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>📅</span>
            <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
              style={{ border: 'none', background: 'transparent', color: 'var(--accent)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, outline: 'none', padding: 0 }} />
          </div>
        </motion.div>
      </div>

      {/* ── KPI Row ─────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: isMobile ? 10 : 14, marginBottom: 24 }}>
        {[
          {
            label: 'พนักงานทั้งหมด', value: logs.length, unit: 'คน',
            sub: `เช็คชื่อแล้ว ${logs.length} รายการ`,
            accent: '#4d9fff', icon: '👥',
            radial: null,
          },
          {
            label: 'อัตราการมาทำงาน', value: attendRate, unit: '%',
            sub: `มา ${present.length} · ขาด ${absent.length}`,
            accent: attendRate >= 90 ? '#22c55e' : attendRate >= 75 ? '#f59e0b' : '#e74c3c',
            icon: '✅', radial: attendRate,
          },
          {
            label: 'PPE ครบถ้วน', value: ppeRate, unit: '%',
            sub: `${ppeReady.length} / ${present.length} คนที่มา`,
            accent: ppeRate >= 90 ? '#22c55e' : ppeRate >= 70 ? '#f59e0b' : '#e74c3c',
            icon: '🦺', radial: ppeRate,
          },
          {
            label: 'OT วันนี้', value: otCount, unit: 'คน',
            sub: present.length > 0 ? `${Math.round(otCount/present.length*100)}% ของคนที่มา` : 'ไม่มีข้อมูล',
            accent: '#f59e0b', icon: '⏰', radial: null,
          },
          {
            label: '4M Alerts', value: fourMLogs.length, unit: 'รายการ',
            sub: fourMLogs.length > 0 ? `${[...new Set(fourMLogs.map(f => f.line_name))].length} ไลน์ได้รับผลกระทบ` : 'ไม่มีการแจ้งเตือน',
            accent: fourMLogs.length > 0 ? '#e74c3c' : '#22c55e', icon: '🚨', radial: null,
          },
        ].map((kpi, i) => (
          <motion.div key={kpi.label} {...stagger(i + 2)}>
            <div style={{
              background: 'var(--card)', border: '1px solid var(--border2)',
              borderRadius: 14, padding: isMobile ? '14px 14px' : '18px 20px',
              boxShadow: 'var(--shadow-sm)',
              borderTop: `3px solid ${kpi.accent}`,
              display: 'flex', flexDirection: 'column', gap: 4,
              position: 'relative', overflow: 'hidden',
            }}>
              <div style={{ position: 'absolute', top: 14, right: 16, opacity: 0.12, fontSize: 42, lineHeight: 1, userSelect: 'none' }}>
                {kpi.icon}
              </div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                {kpi.label}
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginTop: 4 }}>
                {kpi.radial !== null ? (
                  <div style={{ position: 'relative', width: 60, height: 60, flexShrink: 0 }}>
                    <RadialProgress pct={kpi.radial} size={60} stroke={6} color={kpi.accent} />
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, color: kpi.accent, fontFamily: 'var(--font-display)' }}>
                      {kpi.value}
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 36, fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--text)', lineHeight: 1 }}>
                    {loading ? '—' : kpi.value}
                    <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text2)', marginLeft: 4 }}>{kpi.unit}</span>
                  </div>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{kpi.sub}</div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* ── Line Status Grid ─────────────────────────────── */}
      <motion.div {...stagger(7)} style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
          สถานะไลน์ผลิต
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: isMobile ? 10 : 12 }}>
          {lineStats.map((line, i) => {
            const healthy = line.rate >= 80 && line.lineAlerts === 0;
            const warn    = line.lineAlerts > 0 || (line.rate > 0 && line.rate < 80);
            const color   = healthy ? '#22c55e' : warn ? '#f59e0b' : '#555';
            return (
              <motion.div key={line.id} {...stagger(8 + i)}>
                <div style={{
                  background: 'var(--card)', border: '1px solid var(--border2)',
                  borderRadius: 12, padding: '14px 16px',
                  boxShadow: 'var(--shadow-sm)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{line.name}</div>
                      {line.section && (
                        <div style={{ fontSize: 10, color: '#4d9fff', marginTop: 2, fontWeight: 600 }}>{line.section}</div>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                      <div style={{
                        width: 8, height: 8, borderRadius: '50%', background: color,
                        boxShadow: `0 0 6px ${color}`,
                      }} />
                      {line.lineAlerts > 0 && (
                        <div style={{
                          fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 6,
                          background: 'rgba(231,76,60,0.15)', color: '#e74c3c',
                          border: '1px solid rgba(231,76,60,0.3)',
                        }}>
                          🚨 {line.lineAlerts}
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ fontSize: 24, fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--text)' }}>
                      {line.linePresent}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>/ {line.lineTotal} คน</span>
                  </div>

                  <MiniBar value={line.linePresent} max={line.lineTotal} color={color} />

                  <div style={{ marginTop: 8, fontSize: 10, fontWeight: 700, color }}>
                    {line.lineTotal === 0 ? 'ไม่มีข้อมูล' : `${line.rate}% Attendance ${healthy ? '· ✓ Normal' : line.lineAlerts > 0 ? '· ⚠ Risk' : ''}`}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </motion.div>

      {/* ── Bottom Grid ─────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0,2fr) minmax(0,1fr)', gap: 16 }}>

        {/* Attendance breakdown */}
        <motion.div {...stagger(12)}>
          <div className="card" style={{ padding: 20, height: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>
                Attendance Breakdown
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Pill label={`✓ ${present.length}`} color="var(--green)" />
                <Pill label={`✗ ${absent.length}`}  color="var(--red)" />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
              <AttendCol title="มาทำงาน" color="var(--green)" items={present} />
              <AttendCol title="ขาดงาน"  color="var(--red)"   items={absent} absent />
            </div>
          </div>
        </motion.div>

        {/* 4M Activity Feed */}
        <motion.div {...stagger(13)}>
          <div className="card" style={{ padding: 20, height: '100%' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-display)', marginBottom: 16 }}>
              4M Activity Feed
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 420, overflowY: 'auto' }}>
              <AnimatePresence>
                {fourMLogs.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '48px 20px' }}>
                    <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>
                    <div style={{ fontSize: 13, color: 'var(--muted)' }}>ไม่มีการแจ้งเตือน 4M</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, opacity: 0.6 }}>สถานะปกติ</div>
                  </div>
                ) : fourMLogs.map((log, i) => {
                  const meta = getCatMeta(log.category);
                  return (
                    <motion.div key={log.id} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}>
                      <div style={{
                        padding: '10px 12px', borderRadius: 10,
                        background: meta.bg,
                        border: `1px solid ${meta.color}22`,
                        display: 'flex', gap: 10, alignItems: 'flex-start',
                      }}>
                        <div style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{meta.icon}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: meta.color }}>{log.category}</span>
                            <span style={{ fontSize: 10, color: 'var(--muted)', flexShrink: 0 }}>{log.line_name}</span>
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text)', marginTop: 3, lineHeight: 1.4 }}>
                            {log.description}
                          </div>
                          {log.created_at && (
                            <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
                              {new Date(log.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

function Pill({ label, color }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 20,
      color, background: `${color}18`, border: `1px solid ${color}40`,
    }}>{label}</div>
  );
}

function AttendCol({ title, color, items, absent }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {title} ({items.length})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 300, overflowY: 'auto' }}>
        {items.map(l => (
          <div key={l.id} style={{
            padding: '6px 10px', borderRadius: 7,
            background: 'var(--bg3)',
            borderLeft: `3px solid ${color}`,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <div style={{
              width: 26, height: 26, borderRadius: '50%',
              background: `${color}20`, border: `1px solid ${color}40`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, fontWeight: 800, color, flexShrink: 0,
            }}>
              {(l.employees?.name || '?').charAt(0).toUpperCase()}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {l.employees?.name || '—'}
              </div>
              <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                {absent ? 'ขาดงาน' : (l.has_helmet && l.has_boots && l.has_gloves ? '🟢 PPE ครบ' : '🟡 PPE ไม่ครบ')}
              </div>
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', padding: '16px 0' }}>ไม่มีข้อมูล</div>
        )}
      </div>
    </div>
  );
}
