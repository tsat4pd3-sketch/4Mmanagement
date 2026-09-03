import { useState, useEffect, useMemo, useContext } from 'react';
import { supabase } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from '../components/Toast';
import PageHeader from '../components/PageHeader';
import useTabParam from '../utils/useTabParam';
import { useOrgSections } from '../utils/useOrgSections';
import { inSectionScope } from '../utils/sectionScope';
import { getLineFamilyNames } from '../utils/lineHierarchy';
import { stdCapacityOf } from '../utils/stdManpower';
import { fetchAllPages } from '../utils/fetchByIds';
import { positionLabel, loadPositions } from '../utils/positions';
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, ReferenceLine, Tooltip, Legend, Cell,
} from 'recharts';

/* ═══════════════════════════════════════════════════════════════════════════════════════
   📈 กำลังคน & Turnover — /workforce-insight (2026-09-02 · คำขอ user)

   "อยากระบบที่บอก insight turn over ของพนักงาน และสรุปกำลังคนแต่ละวันเป็นกราฟ"
   + "สรุปการเปลี่ยนตำแหน่งงานในแต่ละวัน"

   3 แท็บ อ่านอย่างเดียว ไม่มีปุ่มเขียนข้อมูล (ไม่มี resource:action ใหม่ — ดู migration):
     📊 กำลังคนรายวัน   — daily_production_logs (เช็คชื่อ/PPE/ลา)
     🔀 เปลี่ยนจุดงาน    — station_assignment_logs (คนละแถวต่อการมอบหมาย 1 ครั้ง)
     📉 Turnover        — employees.is_active + audit_log (เมื่อไหร่คนออก) + start_date (เมื่อไหร่เข้า)

   ⚠️ กฎที่ยึดตาม CLAUDE.md/ENGINEERING-PRINCIPLES.md:
   - scope มาตรฐาน: leader = ครอบครัวไลน์ตัวเอง (employees.line_id) · role อื่น = ตาม sections
     (pattern เดียวกับ Report.jsx — ใช้ useOrgSections/inSectionScope/getLineFamilyNames ตัวเดียวกัน)
   - "ไม่รู้ ≠ ไม่มี" — turnover วัดได้เชื่อถือได้เฉพาะช่วงที่มี audit trail (audit trigger ของ employees
     เพิ่งเริ่มมี 2026-08-07) คนที่ inactive ก่อนหน้านั้นไม่มีวันที่ออกให้ดู → แยกเป็นก้อน "ไม่ทราบวันที่ออก"
     เสมอ ห้ามเดา/ห้ามซ่อน (ตรวจข้อมูลจริง 2026-09-02: inactive 66 คน รู้วันที่ออกแค่ 11 · ไม่รู้ 55)
   - start_date พบบั๊กข้อมูลจริง: 35 คนถูกกรอกปี พ.ศ. ลงช่อง ค.ศ. (เช่น 2569 แทน 2026 — ห่างกัน 543 ปีพอดี)
     → กรองทิ้งจากกราฟเข้าใหม่/อายุงาน (ห้ามให้ 1 แถวลากแกนเวลาไปปี 2569) + ขึ้นแถบเตือนให้ไปแก้ที่ /operator
     **ไม่แก้ข้อมูลให้เงียบๆ** (ENGINEERING-PRINCIPLES.md §2 — ตัดสินใจแก้ข้อมูลเป็นของ HR ไม่ใช่ของระบบ)
   - จุดตัดสิน "การย้ายจุดงาน" (ไม่ใช่แค่การมอบหมายครั้งแรกของกะ): แถวที่ 2+ ของ (คน, วันงาน, กะ)
     ที่ station_name ต่างจากแถวก่อนหน้า — ตรวจข้อมูลจริงแล้ว 509 แถวเป็นแถวถัดจากแถวแรก 411 เปลี่ยนจุดจริง
     98 แถวชื่อจุดเดิม (คีย์ซ้ำ/แก้ข้อมูล ไม่ใช่การย้าย) — ไม่นับ 98 แถวนี้เป็น "ย้าย"
   - ปริมาณ (จำนวนคน/ครั้ง) = แท่ง · เทียบเป้า/มาตรฐาน = เส้นประ (ตาม convention เดียวกับ KpiMonthly)
   - โหลดครั้งเดียวตอนกด "โหลด" หรือเปลี่ยนตัวกรอง ไม่ poll (กฎ egress — นี่คือรายงานย้อนหลัง ไม่ใช่จอสด)
   ═══════════════════════════════════════════════════════════════════════════════════════ */

function toLocalDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function getWorkDate() {
  const now = new Date();
  if (now.getHours() < 8) now.setDate(now.getDate() - 1);
  return toLocalDateStr(now); // ห้าม toISOString() — UTC จะลบวันซ้ำอีกชั้นช่วง 00:00-06:59
}
function daysAgoStr(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toLocalDateStr(d);
}
function monthsAgoStr(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  d.setDate(1);
  return toLocalDateStr(d);
}
const monthKey = (dateStr) => (dateStr || '').slice(0, 7); // YYYY-MM
const monthLabel = (ym) => {
  const [y, m] = (ym || '').split('-');
  if (!y || !m) return ym;
  const TH_M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  return `${TH_M[Number(m) - 1] || m} ${String(Number(y) + 543).slice(-2)}`;
};
function downloadCSV(filename, headers, rows) {
  const escape = v => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))];
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

const selSt = { width: 'auto', padding: '7px 10px', borderRadius: 7, fontSize: 13, background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)', cursor: 'pointer' };
const cardSt = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 18px', minWidth: 130, flex: 1 };

function Kpi({ label, value, sub, color }) {
  return (
    <div style={cardSt}>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 900, color: color || 'var(--text)', lineHeight: 1 }}>{value ?? '—'}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function ChartTip({ active, payload, label, fmt }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 4, color: 'var(--text)' }}>{label}</div>
      {payload.map(p => (
        <div key={p.dataKey} style={{ color: p.color }}>{p.name}: {fmt ? fmt(p.value) : p.value?.toLocaleString?.() ?? p.value}</div>
      ))}
    </div>
  );
}

/* ══ scope กลาง — leader = ครอบครัวไลน์ตัวเอง (ผ่าน employees.line_id) · role อื่น = ตาม sections
   pattern เดียวกับ Report.jsx StationLogTab/PerEmployeeTab — ห้ามเขียน logic scope ใหม่แยกต่างหาก ══ */
function useEmployeeScope(lines) {
  const { role, lineId: userLineId, sections: scopeSecs = [] } = useContext(UserContext);
  const familyLineIds = useMemo(() => {
    if (!(role === 'leader' && userLineId) || !lines.length) return null;
    const fam = new Set(getLineFamilyNames(lines, Number(userLineId)));
    const ids = new Set(lines.filter(l => fam.has(l.name)).map(l => l.id));
    return ids.size ? ids : new Set([Number(userLineId)]);
  }, [role, userLineId, lines]);

  const inScope = useMemo(() => (emp) => {
    if (!emp) return false;
    if (familyLineIds) return familyLineIds.has(emp.line_id);
    if (scopeSecs.length) return inSectionScope(scopeSecs, emp.section);
    return true;
  }, [familyLineIds, scopeSecs]);

  const isScoped = !!familyLineIds || scopeSecs.length > 0;
  return { inScope, isScoped, role, userLineId, scopeSecs };
}

/* ══════════════════════════════ 📊 กำลังคนรายวัน ══════════════════════════════ */
function ManpowerTab({ employees, empById, lines, sectionsList, secFilter, setSecFilter, inScope }) {
  const [from, setFrom] = useState(daysAgoStr(29));
  const [to, setTo] = useState(getWorkDate());
  const [shift, setShift] = useState('all');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [partial, setPartial] = useState(false);

  const load = async () => {
    setLoading(true);
    const { rows: data, error, truncated } = await fetchAllPages(
      () => supabase.from('daily_production_logs')
        .select('work_date, employee_id, is_present, leave_type, has_ot, shift')
        .gte('work_date', from).lte('work_date', to),
      { orderBy: ['work_date', 'id'] },
    );
    if (error) toast.error('โหลดข้อมูลไม่ครบ: ' + error);
    setPartial(!!error || truncated);
    setRows(data || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [from, to]);

  const filteredRows = useMemo(() => rows.filter(r => {
    const emp = empById[r.employee_id];
    if (!inScope(emp)) return false;
    if (secFilter && emp?.section !== secFilter) return false;
    if (shift !== 'all') {
      const s = r.shift;
      if (s) { if (s !== shift) return false; }
      else if (shift === 'night' && emp?.team === 'C') return false; // Team C กะเช้าตลอด
    }
    return true;
  }), [rows, empById, inScope, secFilter, shift]);

  const daily = useMemo(() => {
    const m = {};
    filteredRows.forEach(r => {
      const d = r.work_date;
      if (!m[d]) m[d] = { date: d, present: 0, leave: 0, absent: 0, ot: 0, total: 0 };
      m[d].total++;
      if (r.is_present) { m[d].present++; if (r.has_ot) m[d].ot++; }
      else if (r.leave_type) m[d].leave++;
      else m[d].absent++;
    });
    return Object.values(m).sort((a, b) => a.date.localeCompare(b.date));
  }, [filteredRows]);

  // กำลังคนมาตรฐานของ scope นี้ (Σ stdCapacityOf บนไลน์ในขอบเขต — ห้ามบวกซ้ำแม่-ลูก) — เส้นอ้างอิงเท่านั้น
  const stdTotal = useMemo(() => {
    if (!lines.length || shift === 'all') return null;
    const secLines = secFilter ? lines.filter(l => l.section === secFilter) : lines;
    return secLines.reduce((s, l) => s + stdCapacityOf(secLines, l.name, shift), 0) || null;
  }, [lines, secFilter, shift]);

  const avgPresent = daily.length ? Math.round(daily.reduce((s, d) => s + d.present, 0) / daily.length) : null;
  const latest = daily[daily.length - 1];
  const prevAvg = daily.length > 1 ? Math.round(daily.slice(0, -1).reduce((s, d) => s + d.present, 0) / (daily.length - 1)) : null;
  const delta = latest && prevAvg != null ? latest.present - prevAvg : null;
  const attendanceRate = daily.length
    ? (daily.reduce((s, d) => s + d.present, 0) / Math.max(1, daily.reduce((s, d) => s + d.total, 0)) * 100)
    : null;
  const totalLeave = daily.reduce((s, d) => s + d.leave, 0);
  const totalAbsentNoReason = daily.reduce((s, d) => s + d.absent, 0);

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={secFilter} onChange={e => setSecFilter(e.target.value)} style={selSt}>
          <option value="">ทุกส่วนงาน</option>
          {sectionsList.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={shift} onChange={e => setShift(e.target.value)} style={selSt}>
          <option value="all">ทุกกะ</option>
          <option value="day">☀️ กะเช้า</option>
          <option value="night">🌙 กะดึก</option>
        </select>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ width: 140, padding: '7px 10px', borderRadius: 7, fontSize: 13 }} />
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>—</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ width: 140, padding: '7px 10px', borderRadius: 7, fontSize: 13 }} />
        <button onClick={() => downloadCSV(`manpower_${from}_${to}.csv`,
          ['วันที่', 'มาทำงาน', 'ลา', 'ขาด(ไม่ระบุเหตุ)', 'OT', 'รวมเช็คชื่อ'],
          daily.map(d => [d.date, d.present, d.leave, d.absent, d.ot, d.total]))}
          style={{ padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: 'rgba(77,159,255,0.12)', color: 'var(--blue)', border: '1px solid rgba(77,159,255,0.35)' }}>
          ⬇️ CSV
        </button>
      </div>

      {partial && (
        <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 8, background: 'rgba(224,92,74,0.1)', border: '1px solid rgba(224,92,74,0.3)', fontSize: 12, color: 'var(--red)' }}>
          ⚠ โหลดข้อมูลบางส่วนไม่สำเร็จ — ตัวเลขด้านล่างอาจไม่ครบ
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <Kpi label="มาทำงานล่าสุด" value={latest ? latest.present : '—'}
          sub={delta != null ? `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)} เทียบเฉลี่ยก่อนหน้า` : null}
          color={delta != null ? (delta >= 0 ? 'var(--accent)' : 'var(--red)') : null} />
        <Kpi label="เฉลี่ยมาทำงาน/วัน" value={avgPresent} sub={`${daily.length} วันในช่วงนี้`} />
        <Kpi label="อัตรามาทำงาน" value={attendanceRate != null ? `${attendanceRate.toFixed(1)}%` : '—'} sub="มา ÷ เช็คชื่อทั้งหมด" />
        <Kpi label="ลารวมช่วงนี้" value={totalLeave} color="var(--amber)" sub="คน-วัน" />
        <Kpi label="ขาด (ไม่ระบุเหตุ)" value={totalAbsentNoReason} color={totalAbsentNoReason > 0 ? 'var(--red)' : null} sub="คน-วัน — ควรตรวจสอบ" />
      </div>

      {loading ? <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>กำลังโหลด…</div> : (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={daily} margin={{ top: 10, left: 0, right: 12, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text2)' }} tickFormatter={d => d.slice(5)} />
              <YAxis tick={{ fontSize: 11.5, fill: 'var(--text2)' }} width={40} allowDecimals={false} />
              <Tooltip content={<ChartTip />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {stdTotal != null && (
                <ReferenceLine y={stdTotal} stroke="var(--amber)" strokeDasharray="6 4"
                  label={{ value: `มาตรฐาน ${stdTotal} คน`, position: 'insideTopRight', fill: 'var(--amber)', fontSize: 11, fontWeight: 800 }} />
              )}
              <Bar dataKey="present" name="มาทำงาน" fill="var(--accent)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="leave" name="ลา" fill="var(--amber)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="absent" name="ขาด" fill="var(--red)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
            นับจากการเช็คชื่อรายวัน (daily_production_logs){shift !== 'all' && stdTotal == null ? ' · ยังไม่ตั้งกำลังคนมาตรฐานของขอบเขตนี้ (ตั้งที่ LineSetup)' : ''}
          </div>
        </div>
      )}

      <div className="card table-sticky" style={{ overflowX: 'auto' }}>
        <table style={{ minWidth: 480 }}>
          <thead><tr><th>วันที่</th><th>มาทำงาน</th><th>ลา</th><th>ขาด</th><th>OT</th><th>รวมเช็คชื่อ</th></tr></thead>
          <tbody>
            {daily.length === 0 ? <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)', padding: 20 }}>ไม่มีข้อมูล</td></tr>
              : [...daily].reverse().map(d => (
                <tr key={d.date}>
                  <td style={{ fontWeight: 600 }}>{d.date}</td>
                  <td style={{ color: 'var(--accent)', fontWeight: 700 }}>{d.present}</td>
                  <td style={{ color: 'var(--amber)' }}>{d.leave}</td>
                  <td style={{ color: d.absent > 0 ? 'var(--red)' : 'var(--muted)' }}>{d.absent}</td>
                  <td>{d.ot}</td>
                  <td style={{ color: 'var(--muted)' }}>{d.total}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ══════════════════════════════ 🔀 เปลี่ยนจุดงานรายวัน ══════════════════════════════ */
function MovesTab({ empById, sectionsList, secFilter, setSecFilter, inScope }) {
  const [from, setFrom] = useState(daysAgoStr(29));
  const [to, setTo] = useState(getWorkDate());
  const [raw, setRaw] = useState([]);
  const [loading, setLoading] = useState(false);
  const [partial, setPartial] = useState(false);

  const load = async () => {
    setLoading(true);
    const { rows: data, error, truncated } = await fetchAllPages(
      () => supabase.from('station_assignment_logs')
        .select('employee_id, station_name, line_name, work_date, shift, started_at, assigned_by_name')
        .gte('work_date', from).lte('work_date', to),
      { orderBy: ['employee_id', 'work_date', 'started_at'] },
    );
    if (error) toast.error('โหลดข้อมูลไม่ครบ: ' + error);
    setPartial(!!error || truncated);
    setRaw(data || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [from, to]);

  // จุดตัดสิน "ย้ายจริง" = แถวที่ 2+ ของ (คน, วันงาน, กะ) ที่ station_name ต่างจากแถวก่อนหน้า (ดูหมายเหตุหัวไฟล์)
  const moves = useMemo(() => {
    const groups = {};
    raw.forEach(r => {
      const emp = empById[r.employee_id];
      if (!inScope(emp)) return;
      if (secFilter && emp?.section !== secFilter) return;
      const k = `${r.employee_id}|${r.work_date}|${r.shift}`;
      (groups[k] ||= []).push(r);
    });
    const out = [];
    Object.values(groups).forEach(list => {
      list.sort((a, b) => new Date(a.started_at) - new Date(b.started_at));
      for (let i = 1; i < list.length; i++) {
        if (list[i].station_name !== list[i - 1].station_name) {
          out.push({
            employee_id: list[i].employee_id, work_date: list[i].work_date, shift: list[i].shift,
            from: list[i - 1].station_name, to: list[i].station_name, line_name: list[i].line_name,
            at: list[i].started_at, by: list[i].assigned_by_name,
          });
        }
      }
    });
    return out.sort((a, b) => new Date(b.at) - new Date(a.at));
  }, [raw, empById, inScope, secFilter]);

  const daily = useMemo(() => {
    const m = {};
    moves.forEach(mv => {
      const d = mv.work_date;
      if (!m[d]) m[d] = { date: d, moves: 0, people: new Set() };
      m[d].moves++;
      m[d].people.add(mv.employee_id);
    });
    return Object.values(m).map(d => ({ date: d.date, moves: d.moves, people: d.people.size })).sort((a, b) => a.date.localeCompare(b.date));
  }, [moves]);

  const topMovers = useMemo(() => {
    const c = {};
    moves.forEach(mv => { c[mv.employee_id] = (c[mv.employee_id] || 0) + 1; });
    return Object.entries(c).map(([id, n]) => ({ id, n, emp: empById[id] }))
      .sort((a, b) => b.n - a.n).slice(0, 10);
  }, [moves, empById]);

  const totalDistinctPeople = new Set(moves.map(m => m.employee_id)).size;

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={secFilter} onChange={e => setSecFilter(e.target.value)} style={selSt}>
          <option value="">ทุกส่วนงาน</option>
          {sectionsList.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ width: 140, padding: '7px 10px', borderRadius: 7, fontSize: 13 }} />
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>—</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ width: 140, padding: '7px 10px', borderRadius: 7, fontSize: 13 }} />
        <button onClick={() => downloadCSV(`station_moves_${from}_${to}.csv`,
          ['วันที่', 'กะ', 'รหัส', 'ชื่อ', 'ไลน์', 'จุดเดิม', 'จุดใหม่', 'เวลา', 'ผู้มอบหมาย'],
          moves.map(mv => [mv.work_date, mv.shift, empById[mv.employee_id]?.employee_id_code, empById[mv.employee_id]?.name, mv.line_name, mv.from, mv.to, mv.at, mv.by]))}
          style={{ padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: 'rgba(77,159,255,0.12)', color: 'var(--blue)', border: '1px solid rgba(77,159,255,0.35)' }}>
          ⬇️ CSV
        </button>
      </div>

      {partial && (
        <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 8, background: 'rgba(224,92,74,0.1)', border: '1px solid rgba(224,92,74,0.3)', fontSize: 12, color: 'var(--red)' }}>
          ⚠ โหลดข้อมูลบางส่วนไม่สำเร็จ — ตัวเลขด้านล่างอาจไม่ครบ
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <Kpi label="ครั้งที่ย้ายจุดงาน" value={moves.length} sub={`ในช่วง ${daily.length} วัน`} />
        <Kpi label="คนที่ถูกย้าย" value={totalDistinctPeople} sub="คนไม่ซ้ำ" />
        <Kpi label="เฉลี่ย/วัน" value={daily.length ? (moves.length / daily.length).toFixed(1) : '—'} sub="ครั้ง/วัน" />
      </div>

      {loading ? <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>กำลังโหลด…</div> : (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={daily} margin={{ top: 10, left: 0, right: 12, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text2)' }} tickFormatter={d => d.slice(5)} />
              <YAxis tick={{ fontSize: 11.5, fill: 'var(--text2)' }} width={40} allowDecimals={false} />
              <Tooltip content={<ChartTip />} />
              <Bar dataKey="moves" name="ครั้งที่ย้าย" fill="var(--blue)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
            นับเฉพาะการ "เปลี่ยน" จุดงานกลางกะ (ไม่นับการมอบหมายจุดงานครั้งแรกของกะ)
          </div>
        </div>
      )}

      {topMovers.length > 0 && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>🔝 คนที่ถูกย้ายจุดงานบ่อยสุด (ช่วงนี้)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {topMovers.map(t => (
              <div key={t.id} style={{ display: 'flex', gap: 8, fontSize: 12.5, alignItems: 'center' }}>
                <span style={{ color: 'var(--blue)', fontWeight: 700, minWidth: 24, textAlign: 'right' }}>{t.n}×</span>
                <span style={{ fontWeight: 600 }}>{t.emp?.name || '(ไม่พบชื่อ)'}</span>
                <span style={{ color: 'var(--muted)' }}>{t.emp?.employee_id_code} · {t.emp?.section || '—'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card table-sticky" style={{ overflowX: 'auto' }}>
        <table style={{ minWidth: 640 }}>
          <thead><tr><th>วันที่</th><th>กะ</th><th>ชื่อ</th><th>ไลน์</th><th>จุดเดิม → จุดใหม่</th><th>เวลา</th><th>ผู้มอบหมาย</th></tr></thead>
          <tbody>
            {moves.length === 0 ? <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--muted)', padding: 20 }}>ไม่มีการย้ายจุดงานในช่วงนี้</td></tr>
              : moves.slice(0, 300).map((mv, i) => {
                const emp = empById[mv.employee_id];
                return (
                  <tr key={i}>
                    <td style={{ fontWeight: 600, fontSize: 12 }}>{mv.work_date}</td>
                    <td style={{ fontSize: 12 }}>{mv.shift === 'night' ? '🌙' : '☀️'}</td>
                    <td>{emp?.name || '—'} <span style={{ color: 'var(--muted)', fontSize: 11 }}>{emp?.employee_id_code}</span></td>
                    <td style={{ fontSize: 12, color: 'var(--text2)' }}>{mv.line_name}</td>
                    <td style={{ fontSize: 12 }}>{mv.from} → <b>{mv.to}</b></td>
                    <td style={{ fontSize: 11, color: 'var(--muted)' }}>{new Date(mv.at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</td>
                    <td style={{ fontSize: 11, color: 'var(--muted)' }}>{mv.by || '—'}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
        {moves.length > 300 && <div style={{ padding: 10, textAlign: 'center', fontSize: 12, color: 'var(--muted)' }}>แสดง 300 รายการล่าสุด จากทั้งหมด {moves.length} รายการ — ดาวน์โหลด CSV เพื่อดูครบ</div>}
      </div>
    </div>
  );
}

/* ══════════════════════════════ 📉 Turnover พนักงาน ══════════════════════════════ */
// ปี พ.ศ. ที่หลุดเข้าช่อง ค.ศ. (ห่างกัน 543 ปีพอดี) — start_date ในอนาคตแปลว่าเป็นบั๊กนี้เสมอ
// (ไม่มีทางที่ปีเกิดจริงในอนาคตจะดูเหมือน "วันเริ่มงานที่ผ่านมาแล้ว" ได้ — กรองด้วย > วันนี้ ปลอดภัย)
const isValidStartDate = (s, today) => !!s && s <= today;

function TurnoverTab({ employees, sectionsList, secFilter, setSecFilter, inScope }) {
  const [monthsBack, setMonthsBack] = useState(6);
  const [exits, setExits] = useState(null); // null = ยังไม่โหลด
  const [loading, setLoading] = useState(false);
  const [partial, setPartial] = useState(false);
  const today = getWorkDate();

  const load = async () => {
    setLoading(true);
    // เฉพาะแถวที่เป็นการ "แก้ is_active" ของตาราง employees — กรองฝั่ง server ให้แคบสุดก่อน
    const { rows: data, error, truncated } = await fetchAllPages(
      () => supabase.from('audit_log')
        .select('row_pk, changed_at, old_data, new_data')
        .eq('table_name', 'employees')
        .contains('changed_fields', ['is_active']),
      { orderBy: ['changed_at'] },
    );
    if (error) toast.error('โหลดประวัติการออกงานไม่ครบ: ' + error);
    setPartial(!!error || truncated);
    // ยึด "ครั้งล่าสุด" ที่พลิกจาก true→false ต่อคน (ทนกรณี toggle ไป-กลับ)
    const lastDeactivate = {};
    (data || []).forEach(r => {
      if (r.old_data?.is_active === true && r.new_data?.is_active === false) {
        const t = r.changed_at;
        if (!lastDeactivate[r.row_pk] || t > lastDeactivate[r.row_pk]) lastDeactivate[r.row_pk] = t;
      }
    });
    setExits(lastDeactivate);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const scopedActive = useMemo(() => employees.filter(e => inScope(e) && (!secFilter || e.section === secFilter)), [employees, inScope, secFilter]);
  const scopedInactive = useMemo(() => scopedActive.filter(e => e.is_active === false), [scopedActive]);
  const scopedAllInactive = useMemo(() => employees.filter(e => e.is_active === false && (!secFilter || e.section === secFilter) && inScope(e)), [employees, inScope, secFilter]);

  const anomalousStart = useMemo(() => employees.filter(e => e.start_date && e.start_date > today), [employees, today]);
  const anomalousInScope = useMemo(() => anomalousStart.filter(e => inScope(e) && (!secFilter || e.section === secFilter)), [anomalousStart, inScope, secFilter]);

  const exitList = useMemo(() => {
    if (!exits) return [];
    return scopedAllInactive
      .map(e => ({ emp: e, exitAt: exits[e.id] || null }))
      .sort((a, b) => (b.exitAt || '').localeCompare(a.exitAt || ''));
  }, [scopedAllInactive, exits]);

  const knownExits = exitList.filter(x => x.exitAt);
  const unknownExits = exitList.filter(x => !x.exitAt);

  const monthWindowStart = monthsAgoStr(monthsBack - 1);
  const monthKeys = useMemo(() => {
    const out = [];
    for (let i = monthsBack - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
      out.push(toLocalDateStr(d).slice(0, 7));
    }
    return out;
  }, [monthsBack]);

  const monthly = useMemo(() => {
    const hiresByMonth = {}, exitsByMonth = {};
    scopedActive.forEach(e => {
      if (isValidStartDate(e.start_date, today) && e.start_date >= monthWindowStart) {
        const k = monthKey(e.start_date);
        hiresByMonth[k] = (hiresByMonth[k] || 0) + 1;
      }
    });
    knownExits.forEach(x => {
      const k = monthKey(x.exitAt);
      if (k >= monthKeys[0]) exitsByMonth[k] = (exitsByMonth[k] || 0) + 1;
    });
    return monthKeys.map(k => ({ month: k, label: monthLabel(k), hires: hiresByMonth[k] || 0, exits: exitsByMonth[k] || 0 }));
  }, [scopedActive, knownExits, monthKeys, monthWindowStart, today]);

  const exitsInWindow = knownExits.filter(x => monthKey(x.exitAt) >= monthKeys[0]).length;
  const avgMonthlyExits = monthsBack ? exitsInWindow / monthsBack : 0;
  const currentHeadcount = scopedActive.filter(e => e.is_active).length;
  const turnoverRate = currentHeadcount > 0 ? (avgMonthlyExits / currentHeadcount * 100) : null;

  const tenureSamples = knownExits
    .filter(x => isValidStartDate(x.emp.start_date, today))
    .map(x => ({ ...x, days: Math.round((new Date(x.exitAt) - new Date(x.emp.start_date)) / 86400000) }))
    .filter(x => x.days >= 0);
  const avgTenureDays = tenureSamples.length ? Math.round(tenureSamples.reduce((s, x) => s + x.days, 0) / tenureSamples.length) : null;
  const earlyLeavers = tenureSamples.filter(x => x.days <= 90).length;

  // Pareto ส่วนงานที่ออกมากสุด (เฉพาะกลุ่มที่รู้วันที่ออกจริง — N เล็ก แต่ไม่เดา)
  const bySection = useMemo(() => {
    const c = {};
    knownExits.forEach(x => { const s = x.emp.section || 'ไม่ระบุส่วนงาน'; c[s] = (c[s] || 0) + 1; });
    return Object.entries(c).map(([section, n]) => ({ section, n })).sort((a, b) => b.n - a.n);
  }, [knownExits]);

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={secFilter} onChange={e => setSecFilter(e.target.value)} style={selSt}>
          <option value="">ทุกส่วนงาน</option>
          {sectionsList.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={monthsBack} onChange={e => setMonthsBack(Number(e.target.value))} style={selSt}>
          <option value={3}>3 เดือนล่าสุด</option>
          <option value={6}>6 เดือนล่าสุด</option>
          <option value={12}>12 เดือนล่าสุด</option>
        </select>
        {(loading) && <span style={{ fontSize: 12, color: 'var(--muted)' }}>กำลังโหลดประวัติการออกงาน…</span>}
      </div>

      {partial && (
        <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 8, background: 'rgba(224,92,74,0.1)', border: '1px solid rgba(224,92,74,0.3)', fontSize: 12, color: 'var(--red)' }}>
          ⚠ โหลดประวัติการออกงานไม่ครบ — ตัวเลขในแท็บนี้อาจไม่ครบ
        </div>
      )}

      <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, background: 'rgba(245,154,63,0.08)', border: '1px solid rgba(245,154,63,0.3)', fontSize: 12, color: 'var(--text2)', lineHeight: 1.7 }}>
        ⚠️ <b>ระบบเริ่มบันทึกวันที่ "ออกงาน" อัตโนมัติตั้งแต่ 2026-08-07</b> — พนักงานที่ inactive ก่อนหน้านั้นจะ<b>ไม่มีวันที่ออกให้ดู</b> (ไม่ใช่ว่าไม่เคยออก)
        {' · '}ในขอบเขตที่เลือกตอนนี้: รู้วันที่ออก <b style={{ color: 'var(--text)' }}>{knownExits.length}</b> คน · ไม่ทราบวันที่ออก <b style={{ color: 'var(--text)' }}>{unknownExits.length}</b> คน
        {anomalousInScope.length > 0 && <><br />⚠️ พบพนักงาน <b style={{ color: 'var(--red)' }}>{anomalousInScope.length}</b> คนที่วันที่เริ่มงานผิดปกติ (เช่น กรอกปี พ.ศ. ลงช่องปี ค.ศ.) — ไม่รวมในกราฟ/อายุงานด้านล่าง ไปแก้ที่หน้า <a href="/operator" style={{ color: 'var(--blue)' }}>ฐานข้อมูลพนักงาน</a></>}
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <Kpi label="ลาออก (ที่รู้วันที่)" value={exitsInWindow} sub={`ใน ${monthsBack} เดือนล่าสุด`} color="var(--red)" />
        <Kpi label="อัตราออกเฉลี่ย/เดือน" value={turnoverRate != null ? `${turnoverRate.toFixed(2)}%` : '—'} sub={`เทียบกำลังคนปัจจุบัน ${currentHeadcount} คน (ประมาณ)`} />
        <Kpi label="อายุงานเฉลี่ยก่อนออก" value={avgTenureDays != null ? `${avgTenureDays.toLocaleString()} วัน` : '—'} sub={`จาก ${tenureSamples.length} คนที่มีข้อมูลครบ`} />
        <Kpi label="ออกภายใน 90 วันแรก" value={tenureSamples.length ? `${earlyLeavers}/${tenureSamples.length}` : '—'} color={earlyLeavers > 0 ? 'var(--amber)' : null} sub="early attrition" />
        <Kpi label="ไม่ทราบวันที่ออก" value={unknownExits.length} color={unknownExits.length > 0 ? 'var(--amber)' : null} sub="ก่อนเริ่มมี audit log" />
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={monthly} margin={{ top: 10, left: 0, right: 12, bottom: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11.5, fill: 'var(--text2)' }} />
            <YAxis tick={{ fontSize: 11.5, fill: 'var(--text2)' }} width={40} allowDecimals={false} />
            <Tooltip content={<ChartTip />} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="hires" name="เข้าใหม่" fill="var(--accent)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="exits" name="ออก" fill="var(--red)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
          "เข้าใหม่" นับจาก start_date ที่ถูกต้อง (ตัดค่าผิดปกติแล้ว) · "ออก" นับเฉพาะที่มีวันที่ออกจริงในระบบ — ไม่ใช่ยอดคงเหลือสะสม
        </div>
      </div>

      {bySection.length > 0 && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>📊 ส่วนงานที่มีคนออกมากสุด (เฉพาะที่รู้วันที่ออก · N={knownExits.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {bySection.map(s => (
              <div key={s.section} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                <span style={{ width: 110, flexShrink: 0 }}>{s.section}</span>
                <div style={{ flex: 1, background: 'var(--bg3)', borderRadius: 4, height: 14, overflow: 'hidden' }}>
                  <div style={{ width: `${(s.n / bySection[0].n) * 100}%`, height: '100%', background: 'var(--red)' }} />
                </div>
                <span style={{ fontWeight: 700, minWidth: 20, textAlign: 'right' }}>{s.n}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card table-sticky" style={{ overflowX: 'auto', marginBottom: 16 }}>
        <div style={{ padding: '10px 14px', fontWeight: 700, fontSize: 13, borderBottom: '1px solid var(--border)' }}>📋 รายชื่อที่ inactive — รู้วันที่ออก</div>
        <table style={{ minWidth: 640 }}>
          <thead><tr><th>รหัส</th><th>ชื่อ</th><th>ส่วนงาน</th><th>แผนก</th><th>ตำแหน่ง</th><th>เริ่มงาน</th><th>ออกงาน</th><th>อายุงาน</th></tr></thead>
          <tbody>
            {knownExits.length === 0 ? <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--muted)', padding: 20 }}>ไม่มีข้อมูล</td></tr>
              : knownExits.map(x => {
                const tenure = isValidStartDate(x.emp.start_date, today) ? Math.round((new Date(x.exitAt) - new Date(x.emp.start_date)) / 86400000) : null;
                return (
                  <tr key={x.emp.id}>
                    <td style={{ color: 'var(--blue)', fontWeight: 700 }}>{x.emp.employee_id_code}</td>
                    <td style={{ fontWeight: 600 }}>{x.emp.name}</td>
                    <td>{x.emp.section || '—'}</td>
                    <td style={{ color: 'var(--muted)', fontSize: 12 }}>{x.emp.department || '—'}</td>
                    <td style={{ fontSize: 12 }}>{positionLabel(x.emp.position)}</td>
                    <td style={{ fontSize: 12 }}>{isValidStartDate(x.emp.start_date, today) ? x.emp.start_date : (x.emp.start_date ? '⚠ ผิดปกติ' : '—')}</td>
                    <td style={{ fontSize: 12, color: 'var(--red)' }}>{x.exitAt.slice(0, 10)}</td>
                    <td style={{ fontSize: 12 }}>{tenure != null ? `${tenure.toLocaleString()} วัน` : '—'}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {unknownExits.length > 0 && (
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>❔ inactive แต่ไม่ทราบวันที่ออก ({unknownExits.length} คน)</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 10 }}>คนกลุ่มนี้อาจออกก่อน 2026-08-07 (ก่อนระบบเริ่มบันทึก) — แสดงไว้เพื่อไม่ให้ตกหล่น ไม่ใช่ข้อมูลใหม่</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {unknownExits.map(x => (
              <span key={x.emp.id} style={{ fontSize: 11.5, padding: '3px 8px', borderRadius: 6, background: 'var(--bg3)', color: 'var(--text2)' }}>
                {x.emp.name} <span style={{ color: 'var(--muted)' }}>{x.emp.employee_id_code}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════ หน้าหลัก ══════════════════════════════ */
export default function WorkforceInsight() {
  const { role, lineId: userLineId, sections: scopeSecs = [] } = useContext(UserContext);
  const [tab, setTab] = useTabParam(['manpower', 'moves', 'turnover'], 'manpower');
  const [lines, setLines] = useState([]);
  const [employees, setEmployees] = useState([]);
  const orgSectionList = useOrgSections();
  const [secFilter, setSecFilter] = useState('');

  useEffect(() => {
    supabase.from('production_lines').select('id, name, parent_line_name, section, is_active, std_day_shift, std_night_shift')
      .then(({ data }) => setLines(data || []));
    supabase.from('employees')
      .select('id, name, employee_id_code, section, department, team, line_id, is_active, start_date, position')
      .then(({ data }) => setEmployees(data || []));
    loadPositions();
  }, []);

  const { inScope, role: _r, userLineId: _l } = useEmployeeScope(lines);

  const sectionsList = useMemo(() => {
    if (role === 'leader' && userLineId) {
      const myLine = lines.find(l => String(l.id) === String(userLineId));
      return myLine?.section ? [myLine.section] : [];
    }
    const all = orgSectionList.length ? orgSectionList : [...new Set(lines.map(l => l.section).filter(Boolean))].sort();
    return scopeSecs.length ? all.filter(s => inSectionScope(scopeSecs, s)) : all;
  }, [lines, orgSectionList, role, userLineId, scopeSecs]);

  const empById = useMemo(() => Object.fromEntries(employees.map(e => [e.id, e])), [employees]);

  return (
    <div>
      <PageHeader
        title="กำลังคน & Turnover" icon="📈"
        sub="เช็คชื่อรายวัน · การเปลี่ยนจุดงาน · อัตราการเข้า-ออกของพนักงาน — อ่านอย่างเดียว"
        tabs={[
          { key: 'manpower', label: '📊 กำลังคนรายวัน' },
          { key: 'moves', label: '🔀 เปลี่ยนจุดงานรายวัน' },
          { key: 'turnover', label: '📉 Turnover' },
        ]}
        tab={tab} onTab={setTab}
      />
      {tab === 'manpower' && (
        <ManpowerTab employees={employees} empById={empById} lines={lines} sectionsList={sectionsList}
          secFilter={secFilter} setSecFilter={setSecFilter} inScope={inScope} />
      )}
      {tab === 'moves' && (
        <MovesTab empById={empById} sectionsList={sectionsList}
          secFilter={secFilter} setSecFilter={setSecFilter} inScope={inScope} />
      )}
      {tab === 'turnover' && (
        <TurnoverTab employees={employees} sectionsList={sectionsList}
          secFilter={secFilter} setSecFilter={setSecFilter} inScope={inScope} />
      )}
    </div>
  );
}
