import { useState, useEffect, useRef, useContext, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from '../components/Toast';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Tooltip,
} from 'recharts';
import { fmtDate, fmtDateTime } from '../utils/dateFormat';
import { hasPermission, can } from '../utils/permissions';
import { loadCompanyCalendar, getDayType, DAY_TYPE_META } from '../utils/companyCalendar';
import { otPeriodMeta, WEEKDAY_OT_TIME } from '../utils/otPeriods';
import { getLineFamilyNames, getLineFamilyIds } from '../utils/lineHierarchy';
import { inSectionScope } from '../utils/sectionScope';
import tsLogoUrl from '../assets/TS logo.png';
import { CHECKLIST_ITEMS, CATEGORY_COLOR, matchChecklistItem } from '../lib/changePointChecklist';

let tsLogoDataUrlPromise = null;
function getTsLogoDataUrl() {
  if (!tsLogoDataUrlPromise) tsLogoDataUrlPromise = urlToDataUrl(tsLogoUrl);
  return tsLogoDataUrlPromise;
}

function useWidth() {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const fn = () => setW(window.innerWidth);
    window.addEventListener('resize', fn);
    return () => window.removeEventListener('resize', fn);
  }, []);
  return w;
}

function resizeImage(file, maxPx = 1280, quality = 0.85) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const { width: w, height: h } = img;
      const scale = Math.min(1, maxPx / Math.max(w, h));
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => resolve(new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' })), 'image/jpeg', quality);
    };
    img.src = url;
  });
}

function toLocalDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getWorkDate() {
  const now = new Date();
  if (now.getHours() < 8) now.setDate(now.getDate() - 1);
  return toLocalDateStr(now); // ห้าม toISOString() — UTC จะลบวันซ้ำอีกชั้นช่วง 00:00-06:59
}

/* ── Signature URL to DataURL helper ── */
async function urlToDataUrl(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/* ── CSV export utility ── */
function downloadCSV(filename, headers, rows) {
  const escape = v => {
    const s = v == null ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))];
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function CsvBtn({ onClick, style = {} }) {
  const { role } = useContext(UserContext);
  if (!can('report', 'export', role)) return null;
  return (
    <button onClick={onClick} style={{
      padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer',
      background: 'rgba(34,197,94,0.12)', color: '#22c55e',
      border: '1px solid rgba(34,197,94,0.35)', display: 'flex', alignItems: 'center', gap: 5,
      ...style,
    }}>
      ⬇️ CSV
    </button>
  );
}

const CAT_META = {
  Man:      { color: '#4d9fff', bg: 'rgba(77,159,255,0.12)',  label: 'Man',      icon: '👷' },
  Machine:  { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', label: 'Machine',  icon: '⚙️' },
  Material: { color: '#22c55e', bg: 'rgba(34,197,94,0.12)',  label: 'Material', icon: '📦' },
  Method:   { color: '#c084fc', bg: 'rgba(139,92,246,0.12)', label: 'Method',   icon: '📋' },
};

const TABS = ['รายวัน', 'รายพนักงาน', '📍 Log จุดงาน', 'สรุปช่วงเวลา', '🚨 4M Changes', '📊 Skill Matrix', '💰 ค่าฝีมือ', '📋 ใบบันทึก', '🏅 Multi-Skill Form', '🚐 จองรถ OT พรุ่งนี้'];

const SKILL_LEVELS = [
  { min: 100, label: 'ผู้เชี่ยวชาญ',   color: '#a855f7', bg: 'rgba(168,85,247,0.15)' },
  { min: 75,  label: 'แก้ปัญหาได้',    color: '#22c55e', bg: 'rgba(34,197,94,0.15)'  },
  { min: 50,  label: 'มาตรฐาน',        color: '#84cc16', bg: 'rgba(132,204,18,0.15)' },
  { min: 25,  label: 'ต้องดูแล',       color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  { min: 0,   label: 'ยังไม่ผ่าน OJT', color: '#ef4444', bg: 'rgba(239,68,68,0.15)'  },
];
const getLevel = (score) => SKILL_LEVELS.find(l => score >= l.min) ?? SKILL_LEVELS[4];

const SKILL_CAT_META = {
  hard_skill:    { label: 'Hard Skill',    color: '#ef4444', icon: '🔧', desc: 'ทักษะการทำงานรูปแบบต่างๆ' },
  machine_skill: { label: 'Machine Skill', color: '#f97316', icon: '⚙️', desc: 'ใช้ ปรับตั้ง ควบคุมเครื่องจักร' },
  product_skill: { label: 'Product Skill', color: '#3b82f6', icon: '📦', desc: 'คุณภาพกระบวนการผลิต' },
  soft_skill:    { label: 'Soft Skill',    color: '#a855f7', icon: '🧠', desc: 'หลักการคิด ระบบการทำงาน' },
};
// Group skillDefs by category, preserving sort_order within each group
const groupSkillsByCategory = (defs) =>
  Object.entries(SKILL_CAT_META)
    .map(([k, m]) => ({ key: k, ...m, skills: defs.filter(s => (s.category || 'hard_skill') === k) }))
    .filter(g => g.skills.length > 0);

const lbSt = { fontSize: 11, fontWeight: 600, color: 'var(--text2)', marginBottom: 4, display: 'block' };

function useOrgSections() {
  const [orgSections, setOrgSections] = useState([]);
  useEffect(() => {
    supabase.from('org_nodes').select('code, name').eq('kind', 'section').eq('is_active', true).order('name')
      .then(({ data }) => setOrgSections((data || []).map(n => n.code || n.name).sort()));
  }, []);
  return orgSections;
}

function useOrgDepts() {
  const [orgDepts, setOrgDepts] = useState([]);
  useEffect(() => {
    supabase.from('org_nodes').select('code, name').eq('kind', 'department').eq('is_active', true).order('name')
      .then(({ data }) => setOrgDepts((data || []).map(n => n.code || n.name).sort()));
  }, []);
  return orgDepts;
}

export default function Report() {
  const location = useLocation();
  const initialParams = new URLSearchParams(location.search);
  const initialTab = Number(initialParams.get('tab'));
  const [activeTab, setActiveTab] = useState(
    Number.isInteger(initialTab) && initialTab >= 0 && initialTab < TABS.length ? initialTab : 0
  );
  const autoOpenMaster = initialParams.get('master') === '1';

  return (
    <div className="page-content">
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'clamp(16px,3vw,22px)', color: 'var(--text)' }}>
          📋 รายงาน
        </h2>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, overflowX: 'auto', flexShrink: 0 }}>
        {TABS.map((t, i) => (
          <button key={i} onClick={() => setActiveTab(i)} style={{
            padding: '7px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap',
            background: activeTab === i ? 'var(--accent)' : 'var(--bg3)',
            color: activeTab === i ? '#fff' : 'var(--text2)',
            fontWeight: activeTab === i ? 700 : 400,
          }}>{t}</button>
        ))}
      </div>
      {activeTab === 0 && <DailyTab />}
      {activeTab === 1 && <PerEmployeeTab />}
      {activeTab === 2 && <StationLogTab />}
      {activeTab === 3 && <RangeTab />}
      {activeTab === 4 && <FourMTab />}
      {activeTab === 5 && <SkillMatrixTab />}
      {activeTab === 6 && <SkillAllowanceTab />}
      {activeTab === 7 && <AttendanceFormTab />}
      {activeTab === 8 && <MultiSkillFormTab />}
      {activeTab === 9 && <OtTransportBookingTab autoOpenMaster={autoOpenMaster} />}
    </div>
  );
}

function OtTransportBookingTab({ autoOpenMaster }) {
  const { role, lineId: userLineId, sections: scopeSecs = [] } = useContext(UserContext);
  const canManageMaster = hasPermission('manage_master_data', role);
  const canExport = can('report', 'export', role);
  const orgSectionList = useOrgSections();
  const orgDeptList    = useOrgDepts();

  const todayStr = getWorkDate();

  const [date, setDate] = useState(todayStr);
  const [shiftFilter, setShiftFilter] = useState('all'); // 'all' | 'day' | 'night'
  const [rows, setRows] = useState([]);
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(false);
  const [section, setSection] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [showMaster, setShowMaster] = useState(!!autoOpenMaster && canManageMaster);
  const [calReady, setCalReady] = useState(false);

  useEffect(() => {
    supabase.from('production_lines').select('id, name, section').then(({ data }) => setLines(data || []));
    loadCompanyCalendar().then(() => setCalReady(true));
  }, []);

  useEffect(() => { load(); }, [date]);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('ot_night_bookings')
      .select(`id, employee_id, shift, ot_period, created_at,
        employees(name, employee_id_code, line_id, section, department, bus_routes(code, name)),
        ot_task_types(name)`)
      .eq('work_date', date)
      .order('created_at');
    setRows(data || []);
    setLoading(false);
  };

  const dayType = calReady ? getDayType(date) : 'working';
  const isHoliday = dayType !== 'working';

  const lineName = (lineId) => lines.find(l => String(l.id) === String(lineId))?.name || '';
  const busRouteLabel = (r) => r.employees?.bus_routes ? `${r.employees.bus_routes.code} ${r.employees.bus_routes.name}` : '—';
  const taskLabel = (r) => r.ot_task_types?.name || '—';
  const shiftLabel = (s) => s === 'day' ? '☀️ เช้า' : s === 'night' ? '🌙 ดึก' : '—';
  /* ช่วงเวลา OT: วันหยุด → ตามรูปแบบที่จองไว้ (8/10 ชม.) · วันทำงานปกติ → ช่วงต่อท้ายกะมาตรฐาน
     จองวันหยุดที่ไม่มี ot_period (จองเก่าก่อนมีฟีเจอร์) → คืน '' ให้แสดง "ไม่ระบุ" เตือนธุรการ */
  const otTimeLabel = (r) => {
    const m = otPeriodMeta(r.ot_period);
    if (m) return `${m.time} · ${m.hours} ชม.`;
    if (isHoliday) return '';
    return WEEKDAY_OT_TIME[r.shift] || '—';
  };

  // mandatory scope ก่อน (leader → ไลน์ตัวเอง, role ที่ถูกจำกัด sections → เฉพาะส่วนงานใน scope) แล้วค่อย filter อิสระทับ
  const filteredRows = rows
    .filter(r => {
      if (role === 'leader' && userLineId) return String(r.employees?.line_id) === String(userLineId);
      if (scopeSecs.length) return inSectionScope(scopeSecs, r.employees?.section);
      return true;
    })
    .filter(r => !section    || r.employees?.section    === section)
    .filter(r => !deptFilter || r.employees?.department === deptFilter)
    .filter(r => shiftFilter === 'all' || r.shift === shiftFilter);

  const allSections = orgSectionList.length ? orgSectionList : [...new Set(lines.map(l => l.section).filter(Boolean))].sort();
  const sections = (role === 'leader' && userLineId)
    ? [...new Set(lines.filter(l => String(l.id) === String(userLineId)).map(l => l.section).filter(Boolean))]
    : scopeSecs.length ? allSections.filter(s => inSectionScope(scopeSecs, s)) : allSections;

  const handleExportCsv = () => {
    downloadCSV(
      `จองรถ_OT_${date}.csv`,
      ['ลำดับ', 'รหัสพนักงาน', 'ชื่อ-สกุล', 'ไลน์/แผนก', 'กะ', 'ช่วงเวลา OT', 'สายรถ', 'งานที่ทำ'],
      filteredRows.map((r, i) => [
        i + 1,
        r.employees?.employee_id_code || '',
        r.employees?.name || '',
        lineName(r.employees?.line_id) || r.employees?.section || r.employees?.department || '',
        shiftLabel(r.shift),
        otTimeLabel(r) || 'ไม่ระบุ',
        busRouteLabel(r),
        taskLabel(r),
      ])
    );
  };

  const handlePrint = () => {
    const printedAt = new Date().toLocaleDateString('th-TH', { dateStyle: 'long' });
    const rowsHtml = filteredRows.map((r, i) => `<tr>
      <td style="border:1px solid #ccc;padding:3px 6px;text-align:center">${i + 1}</td>
      <td style="border:1px solid #ccc;padding:3px 6px">${r.employees?.employee_id_code || ''}</td>
      <td style="border:1px solid #ccc;padding:3px 6px">${r.employees?.name || ''}</td>
      <td style="border:1px solid #ccc;padding:3px 6px">${lineName(r.employees?.line_id) || r.employees?.section || r.employees?.department || ''}</td>
      <td style="border:1px solid #ccc;padding:3px 6px;text-align:center">${shiftLabel(r.shift)}</td>
      <td style="border:1px solid #ccc;padding:3px 6px;text-align:center">${otTimeLabel(r) || 'ไม่ระบุ'}</td>
      <td style="border:1px solid #ccc;padding:3px 6px">${busRouteLabel(r)}</td>
      <td style="border:1px solid #ccc;padding:3px 6px">${taskLabel(r)}</td>
    </tr>`).join('');
    const html = `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"/><title>จองรถ OT ${date}</title>
<style>@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap');
body{font-family:'Sarabun',sans-serif;font-size:11px;color:#000;background:#fff}
table{border-collapse:collapse;width:100%}
@media print{@page{size:A4 portrait;margin:10mm}body{-webkit-print-color-adjust:exact}}</style>
</head><body style="padding:10mm">
<h2 style="margin:0 0 4px;font-size:16px">รายชื่อพนักงานจองมาทำ OT (สำหรับจองรถรับส่ง)</h2>
<p style="color:#666;margin:0 0 12px;font-size:10px">วันที่ทำ OT: ${date} (${DAY_TYPE_META[dayType].label}) · พิมพ์วันที่: ${printedAt} · รวม ${filteredRows.length} คน</p>
<table><thead><tr style="background:#f3f4f6">
<th style="border:1px solid #ccc;padding:4px">#</th>
<th style="border:1px solid #ccc;padding:4px">รหัส</th>
<th style="border:1px solid #ccc;padding:4px">ชื่อ</th>
<th style="border:1px solid #ccc;padding:4px">ไลน์/แผนก</th>
<th style="border:1px solid #ccc;padding:4px">กะ</th>
<th style="border:1px solid #ccc;padding:4px">ช่วงเวลา OT</th>
<th style="border:1px solid #ccc;padding:4px">สายรถ</th>
<th style="border:1px solid #ccc;padding:4px">งานที่ทำ</th>
</tr></thead><tbody>${rowsHtml}</tbody></table>
<script>window.onload = () => window.print();</script></body></html>`;
    const w = window.open('', '_blank'); w.document.write(html); w.document.close();
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <label style={lbSt}>วันที่ทำ OT</label>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ padding: '6px 10px', borderRadius: 7, fontSize: 13 }} />
        {calReady && (
          <span style={{
            fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 999, whiteSpace: 'nowrap',
            color: isHoliday ? DAY_TYPE_META[dayType].color : 'var(--text2)',
            background: isHoliday ? 'rgba(245,158,11,0.12)' : 'var(--bg3)',
            border: `1px solid ${isHoliday ? 'rgba(245,158,11,0.4)' : 'var(--border)'}`,
          }}>
            {isHoliday ? '🔶 ' : ''}{DAY_TYPE_META[dayType].label}
          </span>
        )}
        <select value={shiftFilter} onChange={e => setShiftFilter(e.target.value)} style={{ padding: '6px 10px', borderRadius: 7, fontSize: 13 }}>
          <option value="all">— ทุกกะ —</option>
          <option value="day">☀️ กะเช้า</option>
          <option value="night">🌙 กะดึก</option>
        </select>
        <select value={section} onChange={e => setSection(e.target.value)} style={{ padding: '6px 10px', borderRadius: 7, fontSize: 13 }}>
          <option value="">— ทุกส่วนงาน —</option>
          {sections.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} style={{ padding: '6px 10px', borderRadius: 7, fontSize: 13 }}>
          <option value="">— ทุกแผนก —</option>
          {orgDeptList.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {canManageMaster && (
            <button onClick={() => setShowMaster(v => !v)} style={{
              padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              background: showMaster ? 'rgba(245,158,11,0.18)' : 'rgba(245,158,11,0.1)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.35)',
            }}>⚙️ จัดการสายรถ/งาน OT</button>
          )}
          <CsvBtn onClick={handleExportCsv} />
          {canExport && (
            <button onClick={handlePrint} style={{
              padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              background: 'rgba(77,159,255,0.12)', color: '#4d9fff', border: '1px solid rgba(77,159,255,0.35)',
            }}>🖨️ พิมพ์</button>
          )}
        </div>
      </div>

      {showMaster && canManageMaster && <OtMasterDataPanel />}

      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
        รายชื่อพนักงานที่จองว่าจะมาทำ OT วันที่ {date} (จากหน้าเช็คชื่อ ทั้งกะเช้า/กะดึก) — ใช้สำหรับธุรการจองรถรับส่ง · รวม <strong style={{ color: 'var(--text)' }}>{filteredRows.length}</strong> คน
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th style={{ minWidth: 40 }}>#</th>
              <th style={{ minWidth: 100 }}>รหัส</th>
              <th style={{ minWidth: 180 }}>ชื่อ-สกุล</th>
              <th style={{ minWidth: 140 }}>ไลน์/แผนก</th>
              <th style={{ minWidth: 70, textAlign: 'center' }}>กะ</th>
              <th style={{ minWidth: 130, textAlign: 'center' }}>ช่วงเวลา OT</th>
              <th style={{ minWidth: 160 }}>สายรถ</th>
              <th style={{ minWidth: 160 }}>งานที่ทำ</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((r, i) => (
              <tr key={r.id}>
                <td>{i + 1}</td>
                <td>{r.employees?.employee_id_code}</td>
                <td>{r.employees?.name}</td>
                <td>{lineName(r.employees?.line_id) || r.employees?.section || r.employees?.department || '—'}</td>
                <td style={{ textAlign: 'center' }}>{shiftLabel(r.shift)}</td>
                <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                  {otTimeLabel(r) || <span style={{ color: '#f59e0b', fontWeight: 700 }}>⚠️ ไม่ระบุ</span>}
                </td>
                <td>{busRouteLabel(r)}</td>
                <td>{taskLabel(r)}</td>
              </tr>
            ))}
            {!loading && filteredRows.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--muted)', padding: 24, fontSize: 13 }}>ไม่มีพนักงานจอง OT สำหรับวันนี้</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OtMasterDataPanel() {
  const [busRoutes, setBusRoutes] = useState([]);
  const [taskTypes, setTaskTypes] = useState([]);
  const [newRouteCode, setNewRouteCode] = useState('');
  const [newRouteName, setNewRouteName] = useState('');
  const [newTaskName, setNewTaskName] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: rd }, { data: td }] = await Promise.all([
      supabase.from('bus_routes').select('id, code, name, is_active, sort_order').order('sort_order'),
      supabase.from('ot_task_types').select('id, name, is_active, sort_order').order('sort_order'),
    ]);
    setBusRoutes(rd || []);
    setTaskTypes(td || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const addRoute = async () => {
    if (!newRouteCode.trim() || !newRouteName.trim()) return;
    const { error } = await supabase.from('bus_routes').insert([{
      code: newRouteCode.trim(), name: newRouteName.trim(), sort_order: busRoutes.length,
    }]);
    if (error) { toast.error('เกิดข้อผิดพลาด: ' + error.message); return; }
    setNewRouteCode(''); setNewRouteName('');
    load();
  };

  const addTask = async () => {
    if (!newTaskName.trim()) return;
    const { error } = await supabase.from('ot_task_types').insert([{
      name: newTaskName.trim(), sort_order: taskTypes.length,
    }]);
    if (error) { toast.error('เกิดข้อผิดพลาด: ' + error.message); return; }
    setNewTaskName('');
    load();
  };

  const toggleRouteActive = async (r) => {
    await supabase.from('bus_routes').update({ is_active: !r.is_active }).eq('id', r.id);
    load();
  };

  const toggleTaskActive = async (t) => {
    await supabase.from('ot_task_types').update({ is_active: !t.is_active }).eq('id', t.id);
    load();
  };

  const removeRoute = async (r) => {
    if (!window.confirm(`ลบสายรถ "${r.code} ${r.name}"?`)) return;
    await supabase.from('bus_routes').delete().eq('id', r.id);
    load();
  };

  const removeTask = async (t) => {
    if (!window.confirm(`ลบงาน "${t.name}"?`)) return;
    await supabase.from('ot_task_types').delete().eq('id', t.id);
    load();
  };

  return (
    <div className="card" style={{ padding: 16, marginBottom: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>🚐 สายรถรับส่ง</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <input placeholder="รหัส เช่น A17" value={newRouteCode} onChange={e => setNewRouteCode(e.target.value)} style={{ width: 70, padding: '6px 8px', borderRadius: 6, fontSize: 12 }} />
          <input placeholder="ชื่อสาย เช่น มาบยางพร-ปลวกแดง" value={newRouteName} onChange={e => setNewRouteName(e.target.value)} style={{ flex: 1, padding: '6px 8px', borderRadius: 6, fontSize: 12 }} />
          <button onClick={addRoute} style={{ padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: 'var(--accent)', color: '#fff', border: 'none' }}>+ เพิ่ม</button>
        </div>
        <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {busRoutes.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 6px', borderRadius: 6, background: r.is_active ? 'transparent' : 'var(--bg2)', opacity: r.is_active ? 1 : 0.5 }}>
              <span style={{ flex: 1 }}>{r.code} {r.name}</span>
              <button onClick={() => toggleRouteActive(r)} style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, cursor: 'pointer', background: 'transparent', border: '1px solid var(--border)' }}>{r.is_active ? 'ปิดใช้' : 'เปิดใช้'}</button>
              <button onClick={() => removeRoute(r)} style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, cursor: 'pointer', background: 'transparent', border: '1px solid rgba(239,68,68,0.4)', color: '#ef4444' }}>ลบ</button>
            </div>
          ))}
          {!loading && busRoutes.length === 0 && <div style={{ fontSize: 12, color: 'var(--muted)' }}>ยังไม่มีสายรถ</div>}
        </div>
      </div>

      <div>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>🛠️ งานที่ทำ OT</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <input placeholder="ชื่องาน เช่น ผลิตตามแผน" value={newTaskName} onChange={e => setNewTaskName(e.target.value)} style={{ flex: 1, padding: '6px 8px', borderRadius: 6, fontSize: 12 }} />
          <button onClick={addTask} style={{ padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: 'var(--accent)', color: '#fff', border: 'none' }}>+ เพิ่ม</button>
        </div>
        <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {taskTypes.map(t => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 6px', borderRadius: 6, background: t.is_active ? 'transparent' : 'var(--bg2)', opacity: t.is_active ? 1 : 0.5 }}>
              <span style={{ flex: 1 }}>{t.name}</span>
              <button onClick={() => toggleTaskActive(t)} style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, cursor: 'pointer', background: 'transparent', border: '1px solid var(--border)' }}>{t.is_active ? 'ปิดใช้' : 'เปิดใช้'}</button>
              <button onClick={() => removeTask(t)} style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, cursor: 'pointer', background: 'transparent', border: '1px solid rgba(239,68,68,0.4)', color: '#ef4444' }}>ลบ</button>
            </div>
          ))}
          {!loading && taskTypes.length === 0 && <div style={{ fontSize: 12, color: 'var(--muted)' }}>ยังไม่มีงาน</div>}
        </div>
      </div>
    </div>
  );
}

function DailyTab() {
  const { role, lineId: userLineId, sections: scopeSecs = [] } = useContext(UserContext);
  const canExport = can('report', 'export', role);
  const now = new Date();
  const isDay = (now.getHours() * 60 + now.getMinutes()) >= 480 && (now.getHours() * 60 + now.getMinutes()) < 1200;
  const orgSectionList = useOrgSections();
  const orgDeptList    = useOrgDepts();
  const [date, setDate]   = useState(getWorkDate());
  const [shift, setShift] = useState(isDay ? 'day' : 'night');
  const [logs, setLogs]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [stationMap, setStationMap] = useState({});
  const [lines, setLines] = useState([]);
  const [dailySection, setDailySection] = useState('');
  const [dailyLine, setDailyLine] = useState('');
  const [dailyTeam, setDailyTeam] = useState('');
  const [dailyDept, setDailyDept] = useState('');
  const [calLoaded, setCalLoaded] = useState(false);

  useEffect(() => {
    supabase.from('workstations').select('id, station_name').then(({ data }) => {
      const m = {};
      (data || []).forEach(w => { m[String(w.id)] = w.station_name; });
      setStationMap(m);
    });
    supabase.from('production_lines').select('id, name, section').order('name').then(({ data }) => setLines(data || []));
    loadCompanyCalendar().then(() => setCalLoaded(true));
  }, []);

  useEffect(() => { load(); }, [date, shift]);

  const dayTypeLabel = calLoaded ? DAY_TYPE_META[getDayType(date)].label : '';

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('daily_production_logs')
      .select('*, employees(name, employee_id_code, image_url, department, team, section, line_id)')
      .eq('work_date', date).eq('is_present', true).order('updated_at');

    // filter by shift: use shift column if present, fallback to employee.team
    const filtered = (data || []).filter(l => {
      if (shift === 'all') return true;
      const s = l.shift;
      const team = l.employees?.team;
      if (s) return s === shift;
      if (shift === 'day')   return team === 'A' || team === 'C' || !team;
      if (shift === 'night') return team === 'B' || team === 'C' || !team;
      return true;
    });
    // mandatory scope: leader → ไลน์ตัวเอง, role ที่ถูกจำกัด sections → เฉพาะส่วนงานใน scope (CLAUDE.md "Section/Line/Team Scoping")
    const scoped = filtered.filter(l => {
      if (role === 'leader' && userLineId) return String(l.employees?.line_id) === String(userLineId);
      if (scopeSecs.length) return inSectionScope(scopeSecs, l.employees?.section);
      return true;
    });
    setLogs(scoped);
    setLoading(false);
  };

  // dropdown ไลน์/ส่วนงาน เหลือเฉพาะใน scope เท่านั้น
  const linesInScope = useMemo(() => {
    if (role === 'leader' && userLineId) return lines.filter(l => String(l.id) === String(userLineId));
    if (scopeSecs.length) return lines.filter(l => inSectionScope(scopeSecs, l.section));
    return lines;
  }, [lines, role, userLineId, scopeSecs]);
  const dailySections = useMemo(() => {
    if (role === 'leader' && userLineId) return [...new Set(linesInScope.map(l => l.section).filter(Boolean))].sort();
    const all = orgSectionList.length ? orgSectionList : [...new Set(lines.map(l => l.section).filter(Boolean))].sort();
    return scopeSecs.length ? all.filter(s => inSectionScope(scopeSecs, s)) : all;
  }, [lines, linesInScope, orgSectionList, role, userLineId, scopeSecs]);
  const dailyVisibleLines = dailySection ? linesInScope.filter(l => l.section === dailySection) : linesInScope;

  const filteredLogs = useMemo(() => logs.filter(l => {
    if (dailySection && l.employees?.section !== dailySection) return false;
    if (dailyDept && l.employees?.department !== dailyDept) return false;
    if (dailyLine) {
      const lineObj = lines.find(ln => String(ln.id) === String(dailyLine));
      if (lineObj && String(l.employees?.line_id) !== String(lineObj.id)) return false;
    }
    if (dailyTeam && l.employees?.team !== dailyTeam) return false;
    return true;
  }), [logs, dailySection, dailyDept, dailyLine, dailyTeam, lines]);

  const shiftBtnStyle = (val) => ({
    padding: '5px 12px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
    background: shift === val
      ? val === 'day' ? 'rgba(245,158,11,0.2)' : val === 'night' ? 'rgba(77,159,255,0.2)' : 'rgba(255,255,255,0.1)'
      : 'transparent',
    color: shift === val
      ? val === 'day' ? '#f59e0b' : val === 'night' ? '#4d9fff' : 'var(--text2)'
      : 'var(--muted)',
  });

  const handlePrintDaily = () => {
    const todayStr = new Date().toLocaleDateString('th-TH', { dateStyle: 'long' });
    const rowsHtml = filteredLogs.map((l, i) => `<tr>
      <td style="border:1px solid #ccc;padding:3px 6px;text-align:center">${i+1}</td>
      <td style="border:1px solid #ccc;padding:3px 6px">${l.employees?.employee_id_code || ''}</td>
      <td style="border:1px solid #ccc;padding:3px 6px">${l.employees?.name || ''}</td>
      <td style="border:1px solid #ccc;padding:3px 6px">${l.employees?.department || ''}</td>
      <td style="border:1px solid #ccc;padding:3px 6px;text-align:center">${l.employees?.team || ''}</td>
      <td style="border:1px solid #ccc;padding:3px 6px;text-align:center">${l.is_present ? '✓' : '✗'}</td>
      <td style="border:1px solid #ccc;padding:3px 6px;text-align:center">${l.has_helmet ? '✓' : '✗'}</td>
      <td style="border:1px solid #ccc;padding:3px 6px;text-align:center">${l.has_boots ? '✓' : '✗'}</td>
      <td style="border:1px solid #ccc;padding:3px 6px;text-align:center">${l.has_gloves ? '✓' : '✗'}</td>
      <td style="border:1px solid #ccc;padding:3px 6px;text-align:center">${l.has_ot ? '✓' : ''}</td>
      <td style="border:1px solid #ccc;padding:3px 6px;text-align:center">${l.assigned_line ? (stationMap[String(l.assigned_line)] || l.assigned_line) : '—'}</td>
    </tr>`).join('');
    const html = `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"/><title>รายวัน ${date}</title>
<style>@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap');
body{font-family:'Sarabun',sans-serif;font-size:11px;color:#000;background:#fff}
table{border-collapse:collapse;width:100%}
@media print{@page{size:A4 landscape;margin:10mm}body{-webkit-print-color-adjust:exact}}</style>
</head><body style="padding:10mm">
<h2 style="margin:0 0 4px;font-size:16px">รายงานเช็คชื่อประจำวัน</h2>
<p style="color:#666;margin:0 0 12px;font-size:10px">วันที่: ${date} (${dayTypeLabel}) · กะ: ${shift === 'day' ? 'เช้า' : shift === 'night' ? 'ดึก' : 'ทั้งหมด'} · พิมพ์วันที่: ${todayStr} · รวม ${filteredLogs.length} คน</p>
<table><thead><tr style="background:#f3f4f6">
<th style="border:1px solid #ccc;padding:4px">#</th>
<th style="border:1px solid #ccc;padding:4px">รหัส</th>
<th style="border:1px solid #ccc;padding:4px">ชื่อ</th>
<th style="border:1px solid #ccc;padding:4px">แผนก</th>
<th style="border:1px solid #ccc;padding:4px">ทีม</th>
<th style="border:1px solid #ccc;padding:4px">มาทำงาน</th>
<th style="border:1px solid #ccc;padding:4px">หมวก</th>
<th style="border:1px solid #ccc;padding:4px">รองเท้า</th>
<th style="border:1px solid #ccc;padding:4px">ถุงมือ</th>
<th style="border:1px solid #ccc;padding:4px">OT</th>
<th style="border:1px solid #ccc;padding:4px">จุดงาน</th>
</tr></thead><tbody>${rowsHtml}</tbody></table>
<script>window.onload = () => window.print();</script></body></html>`;
    const w = window.open('', '_blank'); w.document.write(html); w.document.close();
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ padding: '7px 10px', borderRadius: 7, fontSize: 13 }} />
        {/* Shift toggle */}
        <div style={{ display: 'flex', background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 10, padding: 3, gap: 2 }}>
          <button style={shiftBtnStyle('day')}   onClick={() => setShift('day')}>☀️ กะเช้า</button>
          <button style={shiftBtnStyle('night')} onClick={() => setShift('night')}>🌙 กะดึก</button>
          <button style={shiftBtnStyle('all')}   onClick={() => setShift('all')}>ทั้งหมด</button>
        </div>
        <select value={dailySection} onChange={e => { setDailySection(e.target.value); setDailyLine(''); }} style={selSt}>
          <option value="">ทุกส่วนงาน</option>
          {dailySections.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={dailyDept} onChange={e => setDailyDept(e.target.value)} style={selSt}>
          <option value="">ทุกแผนก</option>
          {orgDeptList.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={dailyLine} onChange={e => setDailyLine(e.target.value)} style={selSt}>
          <option value="">ทุกไลน์</option>
          {dailyVisibleLines.map(l => <option key={l.id} value={String(l.id)}>{l.name}</option>)}
        </select>
        <select value={dailyTeam} onChange={e => setDailyTeam(e.target.value)} style={selSt}>
          <option value="">ทุก Team</option>
          <option value="A">Team A</option>
          <option value="B">Team B</option>
          <option value="C">Team C</option>
        </select>
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>รวม {filteredLogs.length} คน</span>
        {calLoaded && (
          <span style={{ fontSize: 12, fontWeight: 700, color: DAY_TYPE_META[getDayType(date)].color }}>
            {DAY_TYPE_META[getDayType(date)].label}
          </span>
        )}
        {canExport && (
          <button onClick={handlePrintDaily} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: 'rgba(77,159,255,0.12)', color: '#4d9fff', border: '1px solid rgba(77,159,255,0.35)', display: 'flex', alignItems: 'center', gap: 5 }}>
            🖨️ PDF
          </button>
        )}
        <CsvBtn onClick={() => downloadCSV(
          `daily_${date}_${shift}.csv`,
          ['วันที่', 'ประเภทวัน', 'กะ', 'รหัสพนักงาน', 'ชื่อ', 'แผนก', 'ทีม', 'หมวก', 'รองเท้า', 'ถุงมือ', 'OT'],
          filteredLogs.map(l => [date, DAY_TYPE_META[getDayType(date)].label, l.shift || (l.employees?.team === 'A' ? 'day' : l.employees?.team === 'B' ? 'night' : ''), l.employees?.employee_id_code, l.employees?.name, l.employees?.department || '', l.employees?.team || '', l.has_helmet ? '✓' : '✗', l.has_boots ? '✓' : '✗', l.has_gloves ? '✓' : '✗', l.has_ot ? '✓' : ''])
        )} />
      </div>
      {loading ? <Loader /> : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table style={{ minWidth: 500 }}>
            <thead><tr><th>โปรไฟล์</th><th>ID</th><th>ชื่อ</th><th>แผนก</th><th>PPE</th><th>จุดงาน</th></tr></thead>
            <tbody>
              {filteredLogs.length === 0 ? <EmptyRow cols={6} /> : filteredLogs.map(l => (
                <tr key={l.id}>
                  <td><Thumb src={l.employees?.image_url} /></td>
                  <td style={{ color: 'var(--blue)', fontWeight: 700 }}>{l.employees?.employee_id_code}</td>
                  <td style={{ fontWeight: 600 }}>{l.employees?.name}</td>
                  <td style={{ color: 'var(--muted)', fontSize: 12 }}>{l.employees?.department || '—'}</td>
                  <td>
                    <StatusBadge ok={l.has_helmet} label="หมวก" />
                    <StatusBadge ok={l.has_boots} label="รองเท้า" />
                    <StatusBadge ok={l.has_gloves} label="ถุงมือ" />
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text2)' }}>{l.assigned_line ? (stationMap[String(l.assigned_line)] || l.assigned_line) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PerEmployeeTab() {
  const { role, lineId: userLineId, sections: scopeSecs = [] } = useContext(UserContext);
  const canExport = can('report', 'export', role);
  const orgSectionList = useOrgSections();
  const orgDeptList    = useOrgDepts();
  const [employees, setEmployees] = useState([]);
  const [selected, setSelected] = useState('');
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [month, setMonth] = useState(toLocalDateStr(new Date()).slice(0, 7));
  const [stationMap, setStationMap] = useState({});
  const [empSection, setEmpSection] = useState('');
  const [empDept,    setEmpDept]    = useState('');
  const [empTeam, setEmpTeam] = useState('');
  const [calLoaded, setCalLoaded] = useState(false);

  useEffect(() => {
    supabase.from('workstations').select('id, station_name').then(({ data }) => {
      const m = {};
      (data || []).forEach(w => { m[String(w.id)] = w.station_name; });
      setStationMap(m);
    });
    // mandatory scope: leader → ไลน์ตัวเอง, role ที่ถูกจำกัด sections → เฉพาะส่วนงานใน scope
    let empQ = supabase.from('employees').select('id, name, employee_id_code, section, department, team').eq('is_active', true);
    if (role === 'leader' && userLineId) empQ = empQ.eq('line_id', userLineId);
    else if (scopeSecs.length)           empQ = empQ.in('section', scopeSecs);
    empQ.order('name').then(({ data }) => {
      setEmployees(data || []);
      if (data?.length) setSelected(data[0].id);
    });
    loadCompanyCalendar().then(() => setCalLoaded(true));
  }, []);

  useEffect(() => { if (selected) load(); }, [selected, month]);

  const load = async () => {
    setLoading(true);
    const from = month + '-01';
    const to = month + '-31';
    const { data } = await supabase.from('daily_production_logs')
      .select('work_date, is_present, has_helmet, has_boots, has_gloves, assigned_line')
      .eq('employee_id', selected).gte('work_date', from).lte('work_date', to)
      .order('work_date', { ascending: false });
    setLogs(data || []);
    setLoading(false);
  };

  // dropdown ส่วนงาน เหลือเฉพาะใน scope (leader → เฉพาะส่วนงานของพนักงานในไลน์ตัวเองซึ่งถูก scope แล้ว)
  const empSections = useMemo(() => {
    if (role === 'leader' && userLineId) return [...new Set(employees.map(e => e.section).filter(Boolean))].sort();
    const all = orgSectionList.length ? orgSectionList : [...new Set(employees.map(e => e.section).filter(Boolean))].sort();
    return scopeSecs.length ? all.filter(s => inSectionScope(scopeSecs, s)) : all;
  }, [employees, orgSectionList, role, userLineId, scopeSecs]);
  const filteredEmployees = useMemo(() => employees.filter(e => {
    if (empSection && e.section    !== empSection) return false;
    if (empDept    && e.department !== empDept)    return false;
    if (empTeam    && e.team       !== empTeam)    return false;
    return true;
  }), [employees, empSection, empDept, empTeam]);

  // Reset selected employee when filter changes and current selection is no longer in the list
  useEffect(() => {
    if (filteredEmployees.length === 0) { setSelected(''); return; }
    if (!filteredEmployees.find(e => e.id === selected)) {
      setSelected(filteredEmployees[0].id);
    }
  }, [filteredEmployees]);

  const handlePrintPerEmp = () => {
    const emp = employees.find(e => e.id === selected);
    const todayStr = new Date().toLocaleDateString('th-TH', { dateStyle: 'long' });
    const rowsHtml = logs.map((l, i) => {
      const dt = DAY_TYPE_META[getDayType(l.work_date)];
      return `<tr style="${dt.label !== DAY_TYPE_META.working.label ? `background:${dt.color}22` : ''}">
      <td style="border:1px solid #ccc;padding:3px 6px">${fmtDate(l.work_date)}</td>
      <td style="border:1px solid #ccc;padding:3px 6px;text-align:center;color:${dt.color}">${dt.label}</td>
      <td style="border:1px solid #ccc;padding:3px 6px;text-align:center">${l.is_present ? '✓' : '✗'}</td>
      <td style="border:1px solid #ccc;padding:3px 6px;text-align:center">${l.has_helmet ? '✓' : '✗'}</td>
      <td style="border:1px solid #ccc;padding:3px 6px;text-align:center">${l.has_boots ? '✓' : '✗'}</td>
      <td style="border:1px solid #ccc;padding:3px 6px;text-align:center">${l.has_gloves ? '✓' : '✗'}</td>
      <td style="border:1px solid #ccc;padding:3px 6px">${l.assigned_line ? (stationMap[String(l.assigned_line)] || l.assigned_line) : '—'}</td>
    </tr>`;
    }).join('');
    const html = `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"/><title>รายพนักงาน ${emp?.name || ''}</title>
<style>@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap');
body{font-family:'Sarabun',sans-serif;font-size:11px;color:#000;background:#fff}
table{border-collapse:collapse;width:100%}
@media print{@page{size:A4 portrait;margin:10mm}body{-webkit-print-color-adjust:exact}}</style>
</head><body style="padding:10mm">
<h2 style="margin:0 0 4px;font-size:16px">รายงานรายพนักงาน</h2>
<p style="color:#666;margin:0 0 12px;font-size:10px">${emp?.employee_id_code || ''} — ${emp?.name || ''} · เดือน: ${month} · พิมพ์วันที่: ${todayStr}</p>
<table><thead><tr style="background:#f3f4f6">
<th style="border:1px solid #ccc;padding:4px">วันที่</th>
<th style="border:1px solid #ccc;padding:4px">ประเภทวัน</th>
<th style="border:1px solid #ccc;padding:4px">มาทำงาน</th>
<th style="border:1px solid #ccc;padding:4px">หมวก</th>
<th style="border:1px solid #ccc;padding:4px">รองเท้า</th>
<th style="border:1px solid #ccc;padding:4px">ถุงมือ</th>
<th style="border:1px solid #ccc;padding:4px">จุดงาน</th>
</tr></thead><tbody>${rowsHtml}</tbody></table>
<script>window.onload = () => window.print();</script></body></html>`;
    const w = window.open('', '_blank'); w.document.write(html); w.document.close();
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={empSection} onChange={e => setEmpSection(e.target.value)} style={selSt}>
          <option value="">ทุกส่วนงาน</option>
          {empSections.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={empDept} onChange={e => setEmpDept(e.target.value)} style={selSt}>
          <option value="">ทุกแผนก</option>
          {orgDeptList.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={empTeam} onChange={e => setEmpTeam(e.target.value)} style={selSt}>
          <option value="">ทุก Team</option>
          <option value="A">Team A</option>
          <option value="B">Team B</option>
          <option value="C">Team C</option>
        </select>
        <select value={selected} onChange={e => setSelected(e.target.value)} style={{ padding: '7px 10px', borderRadius: 7, fontSize: 13 }}>
          {filteredEmployees.map(e => <option key={e.id} value={e.id}>{e.employee_id_code} — {e.name}</option>)}
        </select>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ padding: '7px 10px', borderRadius: 7, fontSize: 13 }} />
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>มา {logs.filter(l => l.is_present).length} วัน</span>
        {canExport && (
          <button onClick={handlePrintPerEmp} disabled={logs.length === 0} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: 'rgba(77,159,255,0.12)', color: '#4d9fff', border: '1px solid rgba(77,159,255,0.35)', display: 'flex', alignItems: 'center', gap: 5, opacity: logs.length === 0 ? 0.5 : 1 }}>
            🖨️ PDF
          </button>
        )}
        <CsvBtn onClick={() => {
          const emp = employees.find(e => e.id === selected);
          downloadCSV(
            `employee_${emp?.employee_id_code || selected}_${month}.csv`,
            ['วันที่', 'ประเภทวัน', 'มาทำงาน', 'หมวก', 'รองเท้า', 'ถุงมือ', 'จุดงาน'],
            logs.map(l => [l.work_date, DAY_TYPE_META[getDayType(l.work_date)].label, l.is_present ? '✓' : '✗', l.has_helmet ? '✓' : '✗', l.has_boots ? '✓' : '✗', l.has_gloves ? '✓' : '✗', l.assigned_line || ''])
          );
        }} />
      </div>
      {loading ? <Loader /> : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table style={{ minWidth: 400 }}>
            <thead><tr><th>วันที่</th><th>PPE</th><th>จุดงาน</th></tr></thead>
            <tbody>
              {logs.length === 0 ? <EmptyRow cols={3} /> : logs.map((l, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>{fmtDate(l.work_date)}</td>
                  <td>
                    <StatusBadge ok={l.has_helmet} label="หมวก" />
                    <StatusBadge ok={l.has_boots} label="รองเท้า" />
                    <StatusBadge ok={l.has_gloves} label="ถุงมือ" />
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text2)' }}>{l.assigned_line ? (stationMap[String(l.assigned_line)] || l.assigned_line) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StationLogTab() {
  const { role, lineId: userLineId, sections: scopeSecs = [] } = useContext(UserContext);
  const canExport = can('report', 'export', role);
  const today = getWorkDate();
  const [stations, setStations] = useState([]);
  const [lines, setLines] = useState([]);
  const [selectedStation, setSelectedStation] = useState('');
  const [from, setFrom] = useState(() => { const d = new Date(); if (d.getHours() < 8) d.setDate(d.getDate() - 1); d.setDate(d.getDate() - 6); return toLocalDateStr(d); });
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [stationTeam, setStationTeam] = useState('');
  const [stationShift, setStationShift] = useState('');
  const [calLoaded, setCalLoaded] = useState(false);

  useEffect(() => {
    supabase.from('workstations').select('id, station_name, line_name').order('line_name').order('station_name').then(({ data }) => {
      setStations(data || []);
    });
    supabase.from('production_lines').select('id, name, section').then(({ data }) => setLines(data || []));
    loadCompanyCalendar().then(() => setCalLoaded(true));
  }, []);

  // mandatory scope: leader → สถานีในไลน์ตัวเอง, role ที่ถูกจำกัด sections → สถานีของไลน์ในส่วนงานที่อยู่ใน scope
  // ระหว่างที่ lines ยังไม่โหลด (แต่ user ถูก scope) คืน [] ไปก่อน — fail-closed ไม่ให้ข้อมูลนอก scope หลุดชั่วคราว
  const scopedStations = useMemo(() => {
    const isScoped = (role === 'leader' && userLineId) || scopeSecs.length > 0;
    if (!isScoped) return stations;
    if (!lines.length) return [];
    if (role === 'leader' && userLineId) {
      const myLine = lines.find(l => String(l.id) === String(userLineId));
      return myLine ? stations.filter(s => s.line_name === myLine.name) : [];
    }
    const secByLineName = Object.fromEntries(lines.map(l => [l.name, l.section]));
    return stations.filter(s => inSectionScope(scopeSecs, secByLineName[s.line_name]));
  }, [stations, lines, role, userLineId, scopeSecs]);

  // เลือกสถานีแรกใน scope อัตโนมัติ / เคลียร์ถ้าสถานีที่เลือกหลุด scope
  useEffect(() => {
    if (!scopedStations.length) {
      if (selectedStation) { setSelectedStation(''); setRows([]); }
      return;
    }
    if (!scopedStations.find(s => String(s.id) === selectedStation)) {
      setSelectedStation(String(scopedStations[0].id));
    }
  }, [scopedStations]);

  useEffect(() => { if (selectedStation) load(); }, [selectedStation, from, to]);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('daily_production_logs')
      .select('work_date, is_present, has_helmet, has_boots, has_gloves, shift, employees(name, employee_id_code, image_url, team, section)')
      .eq('assigned_line', selectedStation)
      .gte('work_date', from).lte('work_date', to)
      .order('work_date', { ascending: false })
      .limit(10000);
    setRows(data || []);
    setLoading(false);
  };

  const station = stations.find(s => String(s.id) === selectedStation);

  // group by line for optgroup — เฉพาะสถานีใน scope
  const byLine = scopedStations.reduce((acc, s) => {
    if (!acc[s.line_name]) acc[s.line_name] = [];
    acc[s.line_name].push(s);
    return acc;
  }, {});

  const filteredRows = useMemo(() => rows.filter(r => {
    if (stationTeam && r.employees?.team !== stationTeam) return false;
    if (stationShift) {
      const s = r.shift;
      const team = r.employees?.team;
      if (s) { if (s !== stationShift) return false; }
      else {
        if (stationShift === 'day'   && !(team === 'A' || team === 'C' || !team)) return false;
        if (stationShift === 'night' && !(team === 'B' || team === 'C' || !team)) return false;
      }
    }
    return true;
  }), [rows, stationTeam, stationShift]);

  const handlePrintStation = () => {
    const todayStr = new Date().toLocaleDateString('th-TH', { dateStyle: 'long' });
    const rowsHtml = filteredRows.map((r, i) => {
      const dt = DAY_TYPE_META[getDayType(r.work_date)];
      return `<tr style="${dt.label !== DAY_TYPE_META.working.label ? `background:${dt.color}22` : ''}">
      <td style="border:1px solid #ccc;padding:3px 6px;text-align:center">${i+1}</td>
      <td style="border:1px solid #ccc;padding:3px 6px">${fmtDate(r.work_date)}</td>
      <td style="border:1px solid #ccc;padding:3px 6px;text-align:center;color:${dt.color}">${dt.label}</td>
      <td style="border:1px solid #ccc;padding:3px 6px">${r.employees?.employee_id_code || ''}</td>
      <td style="border:1px solid #ccc;padding:3px 6px">${r.employees?.name || ''}</td>
      <td style="border:1px solid #ccc;padding:3px 6px;text-align:center">${r.employees?.team || ''}</td>
      <td style="border:1px solid #ccc;padding:3px 6px">${r.shift || ''}</td>
      <td style="border:1px solid #ccc;padding:3px 6px;text-align:center">${r.is_present ? '✓' : '✗'}</td>
      <td style="border:1px solid #ccc;padding:3px 6px;text-align:center">${(r.has_helmet && r.has_boots && r.has_gloves) ? '✓' : '✗'}</td>
    </tr>`;
    }).join('');
    const html = `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"/><title>Log จุดงาน ${station?.station_name || ''}</title>
<style>@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap');
body{font-family:'Sarabun',sans-serif;font-size:11px;color:#000;background:#fff}
table{border-collapse:collapse;width:100%}
@media print{@page{size:A4 landscape;margin:10mm}body{-webkit-print-color-adjust:exact}}</style>
</head><body style="padding:10mm">
<h2 style="margin:0 0 4px;font-size:16px">Log จุดงาน: ${station?.station_name || ''}</h2>
<p style="color:#666;margin:0 0 12px;font-size:10px">ไลน์: ${station?.line_name || ''} · ${from} — ${to} · พิมพ์วันที่: ${todayStr} · รวม ${filteredRows.length} รายการ</p>
<table><thead><tr style="background:#f3f4f6">
<th style="border:1px solid #ccc;padding:4px">#</th>
<th style="border:1px solid #ccc;padding:4px">วันที่</th>
<th style="border:1px solid #ccc;padding:4px">ประเภทวัน</th>
<th style="border:1px solid #ccc;padding:4px">รหัส</th>
<th style="border:1px solid #ccc;padding:4px">ชื่อ</th>
<th style="border:1px solid #ccc;padding:4px">ทีม</th>
<th style="border:1px solid #ccc;padding:4px">กะ</th>
<th style="border:1px solid #ccc;padding:4px">มาทำงาน</th>
<th style="border:1px solid #ccc;padding:4px">PPE ครบ</th>
</tr></thead><tbody>${rowsHtml}</tbody></table>
<script>window.onload = () => window.print();</script></body></html>`;
    const w = window.open('', '_blank'); w.document.write(html); w.document.close();
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={selectedStation} onChange={e => setSelectedStation(e.target.value)}
          style={{ padding: '7px 10px', borderRadius: 7, fontSize: 13, minWidth: 200 }}>
          {Object.entries(byLine).map(([line, sts]) => (
            <optgroup key={line} label={line}>
              {sts.map(s => <option key={s.id} value={String(s.id)}>{s.station_name}</option>)}
            </optgroup>
          ))}
        </select>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ padding: '7px 10px', borderRadius: 7, fontSize: 13 }} />
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>—</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ padding: '7px 10px', borderRadius: 7, fontSize: 13 }} />
        <select value={stationTeam} onChange={e => setStationTeam(e.target.value)} style={selSt}>
          <option value="">ทุก Team</option>
          <option value="A">Team A</option>
          <option value="B">Team B</option>
          <option value="C">Team C</option>
        </select>
        <select value={stationShift} onChange={e => setStationShift(e.target.value)} style={selSt}>
          <option value="">ทุกกะ</option>
          <option value="day">☀️ กะเช้า</option>
          <option value="night">🌙 กะดึก</option>
        </select>
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>{filteredRows.length} รายการ</span>
        {canExport && (
          <button onClick={handlePrintStation} disabled={filteredRows.length === 0} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: 'rgba(77,159,255,0.12)', color: '#4d9fff', border: '1px solid rgba(77,159,255,0.35)', display: 'flex', alignItems: 'center', gap: 5, opacity: filteredRows.length === 0 ? 0.5 : 1 }}>
            🖨️ PDF
          </button>
        )}
        <CsvBtn onClick={() => downloadCSV(
          `station_${station?.station_name || selectedStation}_${from}_${to}.csv`,
          ['วันที่', 'ประเภทวัน', 'รหัส', 'ชื่อ', 'ทีม', 'กะ', 'สังกัด', 'มาทำงาน', 'PPE ครบ'],
          filteredRows.map(r => [r.work_date, DAY_TYPE_META[getDayType(r.work_date)].label, r.employees?.employee_id_code, r.employees?.name, r.employees?.team || '', r.shift || '', r.employees?.section || '', r.is_present ? '✓' : '✗', (r.has_helmet && r.has_boots && r.has_gloves) ? '✓' : '✗'])
        )} />
      </div>

      {station && (
        <div style={{ marginBottom: 12, padding: '8px 14px', borderRadius: 8, background: 'var(--accent-dim)', border: '1px solid rgba(61,214,92,0.2)', display: 'inline-flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>📍 {station.station_name}</span>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{station.line_name}</span>
        </div>
      )}

      {loading ? <Loader /> : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table style={{ minWidth: 520 }}>
            <thead>
              <tr>
                <th>วันที่</th>
                <th>โปรไฟล์</th>
                <th>รหัส</th>
                <th>ชื่อ</th>
                <th>ทีม</th>
                <th>PPE</th>
                <th>สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? <EmptyRow cols={7} /> : filteredRows.map((r, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600, fontSize: 12 }}>{fmtDate(r.work_date)}</td>
                  <td><Thumb src={r.employees?.image_url} /></td>
                  <td style={{ color: 'var(--blue)', fontWeight: 700 }}>{r.employees?.employee_id_code}</td>
                  <td style={{ fontWeight: 600 }}>{r.employees?.name}</td>
                  <td style={{ fontSize: 12 }}>
                    {r.employees?.team && <span style={{ background: 'rgba(77,159,255,0.15)', color: '#4d9fff', borderRadius: 4, padding: '1px 6px', fontSize: 11, fontWeight: 700 }}>Team {r.employees.team}</span>}
                  </td>
                  <td>
                    <StatusBadge ok={r.has_helmet} label="หมวก" />
                    <StatusBadge ok={r.has_boots} label="รองเท้า" />
                    <StatusBadge ok={r.has_gloves} label="ถุงมือ" />
                  </td>
                  <td>
                    <span style={{ fontSize: 12, fontWeight: 700, color: r.is_present ? 'var(--green)' : 'var(--red)' }}>
                      {r.is_present ? '✓ มา' : '✗ ขาด'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RangeTab() {
  const { role, lineId: userLineId, sections: scopeSecs = [] } = useContext(UserContext);
  const canExport = can('report', 'export', role);
  const today = getWorkDate();
  const [from, setFrom] = useState(() => { const d = new Date(); if (d.getHours() < 8) d.setDate(d.getDate() - 1); d.setDate(d.getDate() - 6); return toLocalDateStr(d); });
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lines, setLines] = useState([]);
  const [rangeSection, setRangeSection] = useState('');
  const [rangeLine, setRangeLine] = useState('');
  const [rangeTeam, setRangeTeam] = useState('');

  useEffect(() => {
    supabase.from('production_lines').select('id, name, section').order('name').then(({ data }) => setLines(data || []));
  }, []);

  useEffect(() => { load(); }, [from, to]);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('daily_production_logs')
      .select('work_date, is_present, employee_id, employees(name, employee_id_code, section, team, line_id)')
      .gte('work_date', from).lte('work_date', to).limit(10000);
    // mandatory scope: leader → ไลน์ตัวเอง, role ที่ถูกจำกัด sections → เฉพาะส่วนงานใน scope
    const scoped = (data || []).filter(l => {
      if (role === 'leader' && userLineId) return String(l.employees?.line_id) === String(userLineId);
      if (scopeSecs.length) return inSectionScope(scopeSecs, l.employees?.section);
      return true;
    });
    const map = {};
    scoped.forEach(l => {
      const key = l.employee_id;
      if (!map[key]) map[key] = { name: l.employees?.name, code: l.employees?.employee_id_code, section: l.employees?.section, team: l.employees?.team, lineId: l.employees?.line_id, total: 0, present: 0 };
      map[key].total++;
      if (l.is_present) map[key].present++;
    });
    setRows(Object.values(map).sort((a, b) => (a.name || '').localeCompare(b.name || '')));
    setLoading(false);
  };

  // dropdown ไลน์/ส่วนงาน เหลือเฉพาะใน scope เท่านั้น
  const rangeLinesInScope = useMemo(() => {
    if (role === 'leader' && userLineId) return lines.filter(l => String(l.id) === String(userLineId));
    if (scopeSecs.length) return lines.filter(l => inSectionScope(scopeSecs, l.section));
    return lines;
  }, [lines, role, userLineId, scopeSecs]);
  const rangeSections = useMemo(() => [...new Set(rangeLinesInScope.map(l => l.section).filter(Boolean))].sort(), [rangeLinesInScope]);
  const rangeVisibleLines = rangeSection ? rangeLinesInScope.filter(l => l.section === rangeSection) : rangeLinesInScope;

  const filteredRows = useMemo(() => rows.filter(r => {
    if (rangeSection && r.section !== rangeSection) return false;
    if (rangeLine) {
      const lineObj = lines.find(ln => String(ln.id) === String(rangeLine));
      if (lineObj && String(r.lineId) !== String(lineObj.id)) return false;
    }
    if (rangeTeam && r.team !== rangeTeam) return false;
    return true;
  }), [rows, rangeSection, rangeLine, rangeTeam, lines]);

  const handlePrintRange = () => {
    const todayStr = new Date().toLocaleDateString('th-TH', { dateStyle: 'long' });
    const rowsHtml = filteredRows.map((r, i) => `<tr>
      <td style="border:1px solid #ccc;padding:3px 6px;text-align:center">${i+1}</td>
      <td style="border:1px solid #ccc;padding:3px 6px">${r.code || ''}</td>
      <td style="border:1px solid #ccc;padding:3px 6px">${r.name || ''}</td>
      <td style="border:1px solid #ccc;padding:3px 6px;text-align:center">${r.section || ''}</td>
      <td style="border:1px solid #ccc;padding:3px 6px;text-align:center">${r.team || ''}</td>
      <td style="border:1px solid #ccc;padding:3px 6px;text-align:center">${r.present}</td>
      <td style="border:1px solid #ccc;padding:3px 6px;text-align:center">${r.total}</td>
      <td style="border:1px solid #ccc;padding:3px 6px;text-align:center">${r.total ? Math.round(r.present / r.total * 100) : 0}%</td>
    </tr>`).join('');
    const html = `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"/><title>สรุปช่วงเวลา ${from} — ${to}</title>
<style>@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap');
body{font-family:'Sarabun',sans-serif;font-size:11px;color:#000;background:#fff}
table{border-collapse:collapse;width:100%}
@media print{@page{size:A4 portrait;margin:10mm}body{-webkit-print-color-adjust:exact}}</style>
</head><body style="padding:10mm">
<h2 style="margin:0 0 4px;font-size:16px">สรุปการมาทำงานช่วงเวลา</h2>
<p style="color:#666;margin:0 0 12px;font-size:10px">${from} — ${to} · พิมพ์วันที่: ${todayStr} · รวม ${filteredRows.length} คน</p>
<table><thead><tr style="background:#f3f4f6">
<th style="border:1px solid #ccc;padding:4px">#</th>
<th style="border:1px solid #ccc;padding:4px">รหัส</th>
<th style="border:1px solid #ccc;padding:4px">ชื่อ</th>
<th style="border:1px solid #ccc;padding:4px">ส่วนงาน</th>
<th style="border:1px solid #ccc;padding:4px">Team</th>
<th style="border:1px solid #ccc;padding:4px">มาทำงาน</th>
<th style="border:1px solid #ccc;padding:4px">วันทั้งหมด</th>
<th style="border:1px solid #ccc;padding:4px">%การมาทำงาน</th>
</tr></thead><tbody>${rowsHtml}</tbody></table>
<script>window.onload = () => window.print();</script></body></html>`;
    const w = window.open('', '_blank'); w.document.write(html); w.document.close();
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <span style={{ color: 'var(--muted)' }}>จาก</span>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ padding: '7px 10px', borderRadius: 7, fontSize: 13 }} />
          <span style={{ color: 'var(--muted)' }}>ถึง</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ padding: '7px 10px', borderRadius: 7, fontSize: 13 }} />
        </div>
        <select value={rangeSection} onChange={e => { setRangeSection(e.target.value); setRangeLine(''); }} style={selSt}>
          <option value="">ทุกส่วนงาน</option>
          {rangeSections.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={rangeLine} onChange={e => setRangeLine(e.target.value)} style={selSt}>
          <option value="">ทุกไลน์</option>
          {rangeVisibleLines.map(l => <option key={l.id} value={String(l.id)}>{l.name}</option>)}
        </select>
        <select value={rangeTeam} onChange={e => setRangeTeam(e.target.value)} style={selSt}>
          <option value="">ทุก Team</option>
          <option value="A">Team A</option>
          <option value="B">Team B</option>
          <option value="C">Team C</option>
        </select>
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>{filteredRows.length} คน</span>
        {canExport && (
          <button onClick={handlePrintRange} disabled={filteredRows.length === 0} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: 'rgba(77,159,255,0.12)', color: '#4d9fff', border: '1px solid rgba(77,159,255,0.35)', display: 'flex', alignItems: 'center', gap: 5, opacity: filteredRows.length === 0 ? 0.5 : 1 }}>
            🖨️ PDF
          </button>
        )}
        <CsvBtn onClick={() => downloadCSV(
          `summary_${from}_${to}.csv`,
          ['รหัสพนักงาน', 'ชื่อ', 'วันที่มา', 'วันทั้งหมด', '%การมาทำงาน'],
          filteredRows.map(r => [r.code, r.name, r.present, r.total, r.total ? Math.round(r.present / r.total * 100) + '%' : '0%'])
        )} />
      </div>
      {loading ? <Loader /> : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table style={{ minWidth: 420 }}>
            <thead><tr><th>ID</th><th>ชื่อ</th><th>มาทำงาน</th><th>%</th></tr></thead>
            <tbody>
              {filteredRows.length === 0 ? <EmptyRow cols={4} /> : filteredRows.map((r, i) => (
                <tr key={i}>
                  <td style={{ color: 'var(--blue)', fontWeight: 700 }}>{r.code}</td>
                  <td style={{ fontWeight: 600 }}>{r.name}</td>
                  <td><KpiSmall value={r.present} label={`/ ${r.total} วัน`} /></td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ flex: 1, height: 6, background: 'var(--bg3)', borderRadius: 3, minWidth: 60 }}>
                        <div style={{ width: `${r.total ? (r.present / r.total * 100) : 0}%`, height: '100%', background: 'var(--green)', borderRadius: 3, transition: 'width 0.5s' }} />
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--text2)', minWidth: 30 }}>{r.total ? Math.round(r.present / r.total * 100) : 0}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const STATUS_META = {
  pending:     { label: '⏳ รอ SV Approve',  color: '#f59e0b', bg: 'rgba(245,158,11,0.12)'  },
  pending_qa:  { label: '🔍 รอ QA Approve',  color: '#a855f7', bg: 'rgba(168,85,247,0.12)'  },
  approved:    { label: '✅ Approved',        color: '#22c55e', bg: 'rgba(34,197,94,0.12)'   },
  rejected:    { label: '❌ Rejected',        color: '#ef4444', bg: 'rgba(239,68,68,0.12)'   },
};

function FourMTab() {
  const { role, lineId: userLineId, sections: scopeSecs = [] } = useContext(UserContext);
  const orgSectionList = useOrgSections();

  // Determine if the current user can act on this log at its current stage
  // supervisor/leader อนุมัติได้เฉพาะ log ของไลน์/ส่วนงานตัวเอง — กันอนุมัติข้ามไลน์ที่ตัวเองไม่ได้ดูแล
  const canApproveLog = (log) => {
    // QA step — action gate ผ่านตาราง permission (admin/manager/qa ไม่ scope เหมือนเดิม)
    if (log.status === 'pending_qa') return can('four_m', 'approve_qa', role);
    if (log.status !== 'pending') return false;
    // SV step — สิทธิ์ action มาจาก can() ส่วน scoping ยังเป็นตาม role เดิมทุกประการ
    if (!can('four_m', 'approve_sv', role)) return false;
    if (role === 'admin') return true;
    if (role === 'leader') {
      const myLine = lines.find(l => l.id === userLineId);
      if (!myLine) return false;
      // ครอบครัวไลน์ (ตัวเอง + ไลน์หลัก + ไลน์ย่อย) — leader ไลน์ย่อยต้องอนุมัติ log ที่เกิดจาก
      // การจัดคนลงจุดของไลน์หลัก (พื้นที่เดียวกัน) ได้ด้วย ไม่ใช่แค่สายลงอย่างเดียว
      return lineFamilyOf(myLine.name).includes(log.line_name);
    }
    // role ที่ถูกจำกัดขอบเขตส่วนงาน (supervisor เดิม + manager/qa ที่กำหนด sections) — อนุมัติได้เฉพาะใน scope
    if (scopeSecs.length) {
      const logLine = lines.find(l => l.name === log.line_name);
      return inSectionScope(scopeSecs, logLine?.section);
    }
    if (role === 'manager') return true; // manager ไม่กำหนด scope = ไม่จำกัด เหมือนเดิม
    return false; // supervisor ที่ไม่มี section = fail-closed เหมือนเดิม
  };

  const today = getWorkDate();
  const [from,        setFrom]        = useState(() => { const d = new Date(); if (d.getHours() < 8) d.setDate(d.getDate() - 1); d.setDate(d.getDate() - 6); return toLocalDateStr(d); });
  const [to,          setTo]          = useState(today);
  const [line,        setLine]        = useState('');
  const [cat,         setCat]         = useState('');
  const [statusFilter,setStatusFilter]= useState('');
  const [logs,        setLogs]        = useState([]);
  const [lines,       setLines]       = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [fourMSection, setFourMSection] = useState('');
  const [rejectModal,  setRejectModal]  = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [profileMap,   setProfileMap]   = useState({});
  const [qaApproveModal,  setQaApproveModal]  = useState(null); // log waiting for QA image
  const [qaImageFile,     setQaImageFile]     = useState(null);
  const [qaImagePreview,  setQaImagePreview]  = useState(null);
  const [isApprovingSaving, setIsApprovingSaving] = useState(false);
  const [cpcMonth, setCpcMonth] = useState(today.slice(0, 7)); // YYYY-MM สำหรับ Export Changing Point Control
  const [cpcExporting, setCpcExporting] = useState(false);
  const [imageViewModal, setImageViewModal] = useState(null); // { url, title }
  const [showDocPanel, setShowDocPanel] = useState(false);
  const canManageDoc = can('four_m', 'manage_docs', role);
  const canExport = can('report', 'export', role);

  const normSection = (s) => (s || '').trim().toLowerCase();
  // ครอบครัวไลน์ตามลำดับชั้น (ตัวเอง + สายบน + สายล่าง) — fallback เป็นชื่อเดิมถ้า lines ยังไม่โหลด
  const lineFamilyOf = (lineName) => {
    const fam = getLineFamilyNames(lines, lineName);
    return fam.length ? fam : [lineName];
  };

  // supervisor/leader เห็น 4M log เฉพาะไลน์/ส่วนงานตัวเอง (เดิมเห็นข้ามไลน์ได้หมด)
  const allowedLineNames = useMemo(() => {
    if (role === 'leader' && userLineId) {
      const myLine = lines.find(l => l.id === userLineId);
      return myLine ? getLineFamilyNames(lines, myLine.name) : [];
    }
    if (scopeSecs.length) {
      return lines.filter(l => inSectionScope(scopeSecs, l.section)).map(l => l.name);
    }
    return null;
  }, [role, scopeSecs, userLineId, lines]);

  useEffect(() => {
    supabase.from('production_lines').select('id, name, section, parent_line_name').order('name').then(({ data }) => setLines(data || []));
    loadCompanyCalendar();
  }, []);

  useEffect(() => { load(); }, [from, to, line, cat, statusFilter, allowedLineNames]);

  const load = async () => {
    setLoading(true);
    let q = supabase.from('four_m_logs')
      .select('id, work_date, line_name, category, description, created_at, status, sv_approved_by, sv_approved_at, approved_by, approved_at, reject_reason, requires_qa, change_subtype, created_by, request_image_url, qa_image_url')
      .gte('work_date', from).lte('work_date', to)
      .order('work_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(5000);
    if (line)         q = q.in('line_name', lineFamilyOf(line)); // เลือกไลน์ = เห็นทั้งครอบครัวไลน์ (หลัก↔ย่อย)
    if (cat)          q = q.eq('category', cat);
    if (statusFilter) q = q.eq('status', statusFilter);
    if (allowedLineNames) q = q.in('line_name', allowedLineNames.length ? allowedLineNames : ['__none__']);
    const { data } = await q;
    setLogs(data || []);

    const allIds = [...new Set((data || []).flatMap(l => [l.sv_approved_by, l.approved_by].filter(Boolean)))];
    if (allIds.length) {
      const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', allIds);
      const map = {};
      (profiles || []).forEach(p => { map[p.id] = p.full_name || 'ไม่ระบุ'; });
      setProfileMap(map);
    }
    setLoading(false);
  };

  const handleApprove = async (log) => {
    // QA step requires image confirmation — open modal instead
    if (log.status === 'pending_qa') {
      setQaApproveModal(log);
      setQaImageFile(null);
      setQaImagePreview(null);
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    const now = new Date().toISOString();
    let update;
    let nextStatus;

    if (log.requires_qa !== false) {
      update = { status: 'pending_qa', sv_approved_by: user.id, sv_approved_at: now };
      nextStatus = 'pending_qa';
    } else {
      update = { status: 'approved', sv_approved_by: user.id, sv_approved_at: now, approved_by: user.id, approved_at: now, reject_reason: null };
      nextStatus = 'approved';
    }

    const { error } = await supabase.from('four_m_logs').update(update).eq('id', log.id);
    if (error) { toast.error('เกิดข้อผิดพลาด: ' + error.message); return; }
    toast.success(nextStatus === 'pending_qa' ? 'SV Approved → รอ QA' : 'Approved เรียบร้อย');
    supabase.functions.invoke('send-notification', { body: { event: 'status_change', log: { ...log, ...update, status: nextStatus } } }).catch(() => {});
    load();
  };

  const handleQaApproveSubmit = async () => {
    setIsApprovingSaving(true);
    const { data: { user } } = await supabase.auth.getUser();

    let qa_image_url = null;
    if (qaImageFile) {
      const resized = await resizeImage(qaImageFile);
      const path = `qa/${Date.now()}_${user?.id ?? 'anon'}.jpg`;
      const { error: upErr } = await supabase.storage.from('four-m-images').upload(path, resized, { upsert: false, contentType: 'image/jpeg' });
      if (upErr) { toast.error('อัปโหลดรูปไม่สำเร็จ: ' + upErr.message); setIsApprovingSaving(false); return; }
      qa_image_url = supabase.storage.from('four-m-images').getPublicUrl(path).data.publicUrl;
    }

    const now = new Date().toISOString();
    const update = { status: 'approved', approved_by: user.id, approved_at: now, reject_reason: null, ...(qa_image_url ? { qa_image_url } : {}) };
    const { error } = await supabase.from('four_m_logs').update(update).eq('id', qaApproveModal.id);
    setIsApprovingSaving(false);
    if (error) { toast.error('เกิดข้อผิดพลาด: ' + error.message); return; }
    toast.success('QA Approved เรียบร้อย');
    supabase.functions.invoke('send-notification', { body: { event: 'status_change', log: { ...qaApproveModal, ...update, status: 'approved' } } }).catch(() => {});
    setQaApproveModal(null); setQaImageFile(null); setQaImagePreview(null);
    load();
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) { toast.error('กรุณาระบุเหตุผล'); return; }
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('four_m_logs').update({
      status: 'rejected', approved_by: user.id, approved_at: new Date().toISOString(), reject_reason: rejectReason.trim(),
    }).eq('id', rejectModal);
    if (error) { toast.error('เกิดข้อผิดพลาด: ' + error.message); return; }
    toast.success('Rejected แล้ว');
    const log = logs.find(l => l.id === rejectModal);
    if (log) supabase.functions.invoke('send-notification', { body: { event: 'status_change', log: { ...log, status: 'rejected', reject_reason: rejectReason.trim() } } }).catch(() => {});
    setRejectModal(null); setRejectReason('');
    load();
  };


  // ── Export "Changing Point Control Record" — ปฏิทินรายเดือน 11 หัวข้อ Man/Machine/Method/Material ──
  const handleExportChangePointPdf = async () => {
    if (!line) { toast.error('เลือกไลน์ก่อน'); return; }
    setCpcExporting(true);
    const [yStr, mStr] = cpcMonth.split('-');
    const y = parseInt(yStr), m = parseInt(mStr); // m: 1-12
    const daysInMonth = new Date(y, m, 0).getDate();
    const monthStart = `${cpcMonth}-01`;
    const monthEnd   = `${cpcMonth}-${String(daysInMonth).padStart(2, '0')}`;

    const { data: monthLogs } = await supabase.from('four_m_logs')
      .select('id, work_date, line_name, category, description, status, created_at, created_by, sv_approved_by, approved_by')
      .in('line_name', lineFamilyOf(line)).eq('status', 'approved')
      .gte('work_date', monthStart).lte('work_date', monthEnd)
      .limit(5000);

    // กะถูก derive จากเวลาที่บันทึก (created_at) — ใช้กฎเดียวกับ getCurrentShift(): 08:00-19:59 = กะเช้า
    // บังคับ timezone เป็น Asia/Bangkok เสมอ ไม่พึ่ง getHours() (ขึ้นกับ timezone ของเครื่อง ผิดได้ถ้าเครื่องตั้งเวลาไม่ตรง)
    const shiftOf = (l) => {
      if (!l.created_at) return 'day';
      const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', hour: 'numeric', hourCycle: 'h23' }).format(new Date(l.created_at)));
      return (h >= 8 && h < 20) ? 'day' : 'night';
    };

    // จัด log แต่ละตัวเข้า checklist item (keyword match) แล้วทำ map: itemId -> { day: { day: [...], night: [...] } }
    const dayMap = {}; // itemId -> { [day]: { day: [logs], night: [logs] } }
    for (const l of (monthLogs || [])) {
      const item = matchChecklistItem(l);
      if (!item) continue;
      const day = parseInt(l.work_date.slice(8, 10));
      const shift = shiftOf(l);
      (dayMap[item.id] ||= {});
      (dayMap[item.id][day] ||= { day: [], night: [] });
      dayMap[item.id][day][shift].push(l);
    }

    // เอกสารควบคุม (เลขฟอร์ม/revision/effective date/legend/ผู้ออกเอกสาร) — มาจาก document_controls
    // ถ้ายังไม่มีตาราง/ยังไม่ตั้งค่า ให้ fallback เป็นค่าว่าง ไม่ให้ export ล้ม
    let docCtrl = null;
    try {
      const { data } = await supabase.from('document_controls')
        .select('doc_no, revision, effective_date, legend, issued:issued_by(full_name, signature_url)')
        .eq('doc_key', 'changing_point_control').maybeSingle();
      docCtrl = data;
    } catch { /* ตาราง document_controls อาจยังไม่ถูกสร้าง */ }
    const issuedSig = docCtrl?.issued?.signature_url ? await urlToDataUrl(docCtrl.issued.signature_url) : null;
    const logoDataUrl = await getTsLogoDataUrl();

    // ประวัติการแก้ไขเอกสาร (ตาราง Production Department ด้านบนซ้ายของฟอร์มจริง)
    const { data: revisionRows } = await supabase.from('document_control_revisions')
      .select('seq, record_date, rev, issued_date, description, responsible, approved_name')
      .eq('doc_key', 'changing_point_control').order('seq');

    const lineSection = lines.find(li => li.name === line)?.section || '';

    const thaiMonths = ['', 'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
    const todayDate = parseInt(today.slice(8, 10));
    const isCurrentMonth = today.slice(0, 7) === cpcMonth;
    const isFutureMonth = cpcMonth > today.slice(0, 7);

    const dayHeaderCells = Array.from({ length: daysInMonth }, (_, i) => {
      const d = i + 1;
      const dow = new Date(y, m - 1, d).getDay();
      const weekend = dow === 0 || dow === 6;
      return `<th style="border:1px solid #999;padding:2px;font-size:8px;min-width:15px;${weekend ? 'background:#ddd' : ''}">${d}</th>`;
    }).join('');

    // แยก Night/Day เป็นแถว (ไม่ใช่คอลัมน์) — แต่ละ checklist item จะมี 2 แถว: N (กะดึก) / D (กะเช้า) ตามฟอร์มจริง
    const gridRowsHtml = CHECKLIST_ITEMS.flatMap((item, idx) => {
      const color = CATEGORY_COLOR[item.category];
      const isFirstOfCat = idx === 0 || CHECKLIST_ITEMS[idx - 1].category !== item.category;
      const catRowSpan = CHECKLIST_ITEMS.filter(it => it.category === item.category).length * 2;
      return ['night', 'day'].map((shift, shiftIdx) => {
        const cells = Array.from({ length: daysInMonth }, (_, i) => {
          const d = i + 1;
          const dow = new Date(y, m - 1, d).getDay();
          const weekend = dow === 0 || dow === 6;
          const isFuture = isFutureMonth || (isCurrentMonth && d > todayDate);
          const hit = dayMap[item.id]?.[d]?.[shift]?.length > 0;
          const mark = isFuture ? '' : (hit ? 'X' : 'O');
          return `<td style="border:1px solid #999;text-align:center;font-size:9px;font-weight:700;${weekend ? 'background:#eee' : ''};${hit ? 'color:#d11;background:#fde2e2' : 'color:#333'}">${mark}</td>`;
        }).join('');
        return `<tr>
          ${(isFirstOfCat && shiftIdx === 0) ? `<td rowspan="${catRowSpan}" style="border:1px solid #999;background:${color};color:#fff;font-weight:700;text-align:center;font-size:10px;writing-mode:vertical-rl;padding:4px 2px">${item.category}</td>` : ''}
          ${shiftIdx === 0 ? `<td rowspan="2" style="border:1px solid #999;padding:3px 6px;font-size:9px;white-space:nowrap">${item.label}</td>` : ''}
          <td style="border:1px solid #999;padding:2px 5px;font-size:9px;font-weight:700;text-align:center;background:#f8f8f8" title="${shift === 'day' ? 'กะเช้า (Day)' : 'กะดึก (Night)'}">${shift === 'day' ? 'D' : 'N'}</td>
          ${cells}
        </tr>`;
      });
    }).join('');

    // ใช้ปี ค.ศ. (Gregorian) เหมือนกับ fmtDate ที่ใช้ทั่วทั้งระบบ + บังคับ timezone Asia/Bangkok เพื่อไม่ให้วันที่คลาดเคลื่อนตาม timezone เครื่อง
    const nowParts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date());
    const nowMap = Object.fromEntries(nowParts.map(p => [p.type, p.value]));
    const todayStr = `${nowMap.day} ${thaiMonths[Number(nowMap.month)]} ${nowMap.year}`;
    const docNo = docCtrl?.doc_no || '-';
    const revision = docCtrl?.revision || '0';
    const effectiveDateStr = docCtrl?.effective_date ? fmtDate(docCtrl.effective_date) : '-';
    const legendText = docCtrl?.legend || 'X = ในกรณีที่เปลี่ยนแปลงในวันนั้น\nO = ไม่ในกรณีที่เปลี่ยนแปลงในวันนั้น';

    const revHistoryRowsHtml = (revisionRows && revisionRows.length ? revisionRows : [{}]).map((r, i) => `<tr>
      <td style="border:1px solid #000;padding:2px 4px;text-align:center;font-size:8px">${r.seq ?? (i + 1)}</td>
      <td style="border:1px solid #000;padding:2px 4px;font-size:8px;white-space:nowrap">${r.record_date ? fmtDate(r.record_date) : ''}</td>
      <td style="border:1px solid #000;padding:2px 4px;text-align:center;font-size:8px">${r.rev || ''}</td>
      <td style="border:1px solid #000;padding:2px 4px;font-size:8px;white-space:nowrap">${r.issued_date ? fmtDate(r.issued_date) : ''}</td>
      <td style="border:1px solid #000;padding:2px 4px;font-size:8px">${r.description || ''}</td>
      <td style="border:1px solid #000;padding:2px 4px;text-align:center;font-size:8px">${r.responsible || ''}</td>
      <td style="border:1px solid #000;padding:2px 4px;text-align:center;font-size:8px">${r.approved_name || ''}</td>
    </tr>`).join('');

    const html = `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"/><title>Changing Point Control Record</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap');
  body{font-family:'Sarabun',sans-serif;font-size:11px;color:#000;background:#fff}
  table{border-collapse:collapse;width:100%}
  @media print{@page{size:A3 landscape;margin:8mm}body{-webkit-print-color-adjust:exact}}
</style></head><body style="padding:8mm">
  <table style="margin-bottom:6px"><tr>
    <td style="width:55%;vertical-align:top;padding:0 4px 0 0">
      <div style="font-size:9px;font-weight:700;margin-bottom:2px">${docNo} Rev.${revision}</div>
      <div style="font-size:8px;line-height:1.4;margin-bottom:4px">${legendText.split('\n').map(l => `<div>${l}</div>`).join('')}</div>
      <table>
        <thead><tr style="background:#f3f4f6">
          <th style="border:1px solid #000;padding:2px;font-size:8px">ลำดับที่</th>
          <th style="border:1px solid #000;padding:2px;font-size:8px">วันที่บันทึก</th>
          <th style="border:1px solid #000;padding:2px;font-size:8px">Rev</th>
          <th style="border:1px solid #000;padding:2px;font-size:8px">Issued date</th>
          <th style="border:1px solid #000;padding:2px;font-size:8px">Description of Change (New Issued)</th>
          <th style="border:1px solid #000;padding:2px;font-size:8px">Responsible (PD2)</th>
          <th style="border:1px solid #000;padding:2px;font-size:8px">Approved</th>
        </tr></thead>
        <tbody>${revHistoryRowsHtml}</tbody>
      </table>
      <table style="margin-top:4px"><tr>
        <td style="border:1px solid #000;padding:4px;font-size:8px;width:60%">Effective Date: <b>${effectiveDateStr}</b></td>
        <td style="border:1px solid #000;padding:4px;font-size:8px;text-align:center">
          <div>Issued</div>
          ${issuedSig ? `<img src="${issuedSig}" style="max-height:26px;max-width:60px;object-fit:contain"/>` : '<div style="height:26px"></div>'}
          <div>${docCtrl?.issued?.full_name || ''}</div>
        </td>
      </tr></table>
    </td>
    <td style="width:45%;vertical-align:top">
      <table><tr>
        <td style="width:90px;border:1px solid #000;padding:4px;text-align:center;vertical-align:middle">
          ${logoDataUrl ? `<img src="${logoDataUrl}" style="max-width:80px;max-height:50px;object-fit:contain"/>` : ''}
        </td>
        <td style="background:#fde047;padding:8px;text-align:center;font-weight:700;font-size:14px;border:1px solid #000">
          ใบบันทึกการเปลี่ยนแปลง<br/><span style="font-size:11px">Changing Point Control Record</span>
        </td>
        <td style="width:170px;border:1px solid #000;padding:4px;font-size:10px">
          <div>ส่วน (Section): <b>${lineSection}</b></div>
          <div>แผนก (Department): <b>${lineSection}</b></div>
          <div>ไลน์ (Line): <b>${line}</b></div>
        </td>
        <td style="width:140px;border:1px solid #000;padding:4px;font-size:10px">
          <div>เดือน: <b>${thaiMonths[m]} ${y}</b></div>
          <div>พิมพ์วันที่: ${todayStr}</div>
        </td>
      </tr></table>
    </td>
  </tr></table>

  <table>
    <thead>
      <tr style="background:#f3f4f6">
        <th style="border:1px solid #999"></th>
        <th style="border:1px solid #999;padding:3px;font-size:9px">Detail (รายละเอียด)</th>
        <th style="border:1px solid #999;padding:3px;font-size:8px">N/D</th>
        ${dayHeaderCells}
      </tr>
    </thead>
    <tbody>${gridRowsHtml}</tbody>
  </table>
<script>window.onload = () => window.print();</script>
</body></html>`;

    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
    setCpcExporting(false);
  };

  // Filter logs by section: cross-reference line_name to lines array to get section
  const fourMFilteredLogs = useMemo(() => {
    if (!fourMSection) return logs;
    const sectionLineNames = new Set(lines.filter(l => l.section === fourMSection).map(l => l.name));
    return logs.filter(l => sectionLineNames.has(l.line_name));
  }, [logs, fourMSection, lines]);

  const kpi = Object.fromEntries(Object.keys(CAT_META).map(k => [k, fourMFilteredLogs.filter(l => l.category === k).length]));
  const actionableCount = fourMFilteredLogs.filter(l => ['pending','pending_qa'].includes(l.status)).length;

  return (
    <div>
      {/* Reject modal */}
      {rejectModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--card)', borderRadius: 14, padding: '24px 24px 20px', width: 'min(420px,94vw)', boxShadow: 'var(--shadow-lg)' }}>
            <h3 style={{ margin: '0 0 14px', color: '#ef4444', fontFamily: 'var(--font-display)' }}>❌ ระบุเหตุผลที่ Reject</h3>
            <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)}
              placeholder="เหตุผลที่ไม่อนุมัติ..." rows={3}
              style={{ width: '100%', borderRadius: 8, padding: '8px 10px', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button onClick={handleReject}
                style={{ flex: 2, padding: 11, background: '#ef4444', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>
                ยืนยัน Reject
              </button>
              <button onClick={() => { setRejectModal(null); setRejectReason(''); }}
                style={{ flex: 1, padding: 11, background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border2)', borderRadius: 8, cursor: 'pointer' }}>
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QA Approve Modal */}
      {qaApproveModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--card)', borderRadius: 14, padding: '24px 24px 20px', width: 'min(460px,94vw)', boxShadow: 'var(--shadow-lg)' }}>
            <h3 style={{ margin: '0 0 4px', color: '#a855f7', fontFamily: 'var(--font-display)' }}>🔍 QA ยืนยันคุณภาพงาน</h3>
            <p style={{ margin: '0 0 14px', color: 'var(--muted)', fontSize: 13 }}>
              {qaApproveModal.line_name} · {qaApproveModal.category} · {qaApproveModal.description}
            </p>
            {/* Request image preview */}
            {qaApproveModal.request_image_url && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>📎 รูปจากผู้แจ้ง</div>
                <img src={qaApproveModal.request_image_url} style={{ maxHeight: 130, maxWidth: '100%', borderRadius: 8, objectFit: 'contain', border: '1px solid var(--border2)', cursor: 'pointer' }}
                  onClick={() => setImageViewModal({ url: qaApproveModal.request_image_url, title: 'รูปจากผู้แจ้ง' })} />
              </div>
            )}
            <div style={{ fontSize: 12, color: '#a855f7', fontWeight: 600, marginBottom: 6 }}>📷 แนบรูปยืนยันคุณภาพ <span style={{ color: 'var(--muted)' }}>(ไม่บังคับ)</span></div>
            <div style={{ border: `2px dashed ${qaImageFile ? '#a855f7' : 'var(--border2)'}`, borderRadius: 8, padding: '10px 12px', background: qaImageFile ? 'rgba(168,85,247,0.06)' : 'var(--bg2)', cursor: 'pointer', textAlign: 'center' }}
              onClick={() => document.getElementById('qa-img-input').click()}>
              <input id="qa-img-input" type="file" accept="image/*" style={{ display: 'none' }}
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  setQaImageFile(f);
                  const reader = new FileReader();
                  reader.onload = ev => setQaImagePreview(ev.target.result);
                  reader.readAsDataURL(f);
                }} />
              {qaImagePreview
                ? <img src={qaImagePreview} style={{ maxHeight: 140, maxWidth: '100%', borderRadius: 6, objectFit: 'contain' }} />
                : <div style={{ color: 'var(--muted)', fontSize: 13 }}>📷 แตะเพื่อเลือกรูปยืนยัน</div>}
            </div>
            {qaImageFile && (
              <button type="button" onClick={() => { setQaImageFile(null); setQaImagePreview(null); }}
                style={{ marginTop: 4, fontSize: 11, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                ✕ ลบรูป
              </button>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button onClick={handleQaApproveSubmit} disabled={isApprovingSaving}
                style={{ flex: 2, padding: 11, background: '#a855f7', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: isApprovingSaving ? 'not-allowed' : 'pointer', opacity: isApprovingSaving ? 0.6 : 1 }}>
                {isApprovingSaving ? 'กำลังบันทึก...' : '✅ QA Approve'}
              </button>
              <button onClick={() => { setQaApproveModal(null); setQaImageFile(null); setQaImagePreview(null); }} disabled={isApprovingSaving}
                style={{ flex: 1, padding: 11, background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border2)', borderRadius: 8, cursor: 'pointer' }}>
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Image viewer modal */}
      {imageViewModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 4000, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 13, color: '#fff', marginBottom: 8, fontWeight: 600 }}>{imageViewModal.title}</div>
            <img src={imageViewModal.url} style={{ maxWidth: '88vw', maxHeight: '80vh', borderRadius: 10, objectFit: 'contain', display: 'block' }} />
            <button onClick={() => setImageViewModal(null)}
              style={{ position: 'absolute', top: -10, right: -10, background: '#ef4444', color: '#fff', border: 'none', borderRadius: '50%', width: 28, height: 28, fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              ×
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10, marginBottom: 16 }}>
        {Object.entries(CAT_META).map(([k, m]) => (
          <div key={k} onClick={() => setCat(c => c === k ? '' : k)} style={{
            background: cat === k ? m.bg : 'var(--card)', border: `1px solid ${cat === k ? m.color : 'var(--border)'}`,
            borderRadius: 10, padding: '12px 14px', cursor: 'pointer', transition: 'all 0.15s'
          }}>
            <div style={{ fontSize: 20 }}>{m.icon}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{m.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: m.color, fontFamily: 'var(--font-display)' }}>{kpi[k] || 0}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ padding: '7px 10px', borderRadius: 7, fontSize: 12 }} />
        <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ padding: '7px 10px', borderRadius: 7, fontSize: 12 }} />
        {(() => {
          const scopedLines = allowedLineNames ? lines.filter(l => allowedLineNames.includes(l.name)) : lines;
          const fourMSections = allowedLineNames
            ? [...new Set(scopedLines.map(l => l.section).filter(Boolean))].sort()
            : (orgSectionList.length ? orgSectionList : [...new Set(lines.map(l => l.section).filter(Boolean))].sort());
          const fourMVisibleLines = fourMSection ? scopedLines.filter(l => l.section === fourMSection) : scopedLines;
          return (<>
            <select value={fourMSection} onChange={e => { setFourMSection(e.target.value); setLine(''); }} style={{ padding: '7px 10px', borderRadius: 7, fontSize: 12 }}>
              <option value="">ทุกส่วนงาน</option>
              {fourMSections.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={line} onChange={e => setLine(e.target.value)} style={{ padding: '7px 10px', borderRadius: 7, fontSize: 12 }}>
              <option value="">ทุกไลน์</option>
              {fourMVisibleLines.map(l => <option key={l.name} value={l.name}>{l.name}</option>)}
            </select>
          </>);
        })()}
        <select value={cat} onChange={e => setCat(e.target.value)} style={{ padding: '7px 10px', borderRadius: 7, fontSize: 12 }}>
          <option value="">ทุกประเภท</option>
          {Object.keys(CAT_META).map(k => <option key={k} value={k}>{k}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ padding: '7px 10px', borderRadius: 7, fontSize: 12 }}>
          <option value="">ทุกสถานะ</option>
          <option value="pending">⏳ รอ SV Approve</option>
          <option value="pending_qa">🔍 รอ QA Approve</option>
          <option value="approved">✅ Approved</option>
          <option value="rejected">❌ Rejected</option>
        </select>
        {actionableCount > 0 && (
          <span style={{ fontSize: 11, fontWeight: 700, background: 'rgba(245,158,11,0.15)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 6, padding: '3px 8px' }}>
            ⏳ รอดำเนินการ {actionableCount} รายการ
          </span>
        )}
        <CsvBtn onClick={() => downloadCSV(
          `4m_changes_${from}_${to}.csv`,
          ['วันที่', 'ประเภทวัน', 'ไลน์', 'ประเภท', 'ประเภทย่อย', 'รายละเอียด', 'สถานะ', 'เวลาสร้าง'],
          logs.map(l => [l.work_date, DAY_TYPE_META[getDayType(l.work_date)].label, l.line_name, l.category, l.change_subtype || '', l.description, l.status, l.created_at ? fmtDateTime(l.created_at) : ''])
        )} />
        {canExport && (
          <>
            <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--border)', margin: '0 2px' }} />
            <input type="month" value={cpcMonth} onChange={e => setCpcMonth(e.target.value)} style={{ padding: '6px 8px', borderRadius: 7, fontSize: 12 }} />
            <button onClick={handleExportChangePointPdf} disabled={cpcExporting || !line}
              title={!line ? 'เลือกไลน์ก่อน' : 'Export ใบบันทึกการเปลี่ยนแปลง (Changing Point Control Record)'}
              style={{ padding: '6px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                background: 'rgba(234,179,8,0.15)', color: '#ca8a04', border: '1px solid rgba(234,179,8,0.4)',
                opacity: (cpcExporting || !line) ? 0.5 : 1 }}>
              {cpcExporting ? 'กำลังสร้าง...' : '📅 Export Changing Point'}
            </button>
          </>
        )}
        {canManageDoc && (
          <button onClick={() => setShowDocPanel(v => !v)} style={{
            padding: '6px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer',
            background: showDocPanel ? 'rgba(245,158,11,0.18)' : 'rgba(245,158,11,0.1)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.35)',
          }}>⚙️ จัดการเอกสาร</button>
        )}
      </div>

      {showDocPanel && canManageDoc && <DocumentControlPanel />}

      {loading ? <Loader /> : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th>วันที่</th><th>ไลน์</th><th>ประเภท</th><th>รายละเอียด</th>
                <th style={{ textAlign: 'center' }}>สถานะ</th>
                <th style={{ textAlign: 'center', minWidth: 90 }}>ระดับ</th>
                <th style={{ textAlign: 'center', minWidth: 160 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {fourMFilteredLogs.length === 0 ? <EmptyRow cols={7} /> : fourMFilteredLogs.map(l => {
                const m  = CAT_META[l.category] || {};
                const sm = STATUS_META[l.status] || STATUS_META.pending;
                const svName  = l.sv_approved_by ? (profileMap[l.sv_approved_by] || '...') : null;
                const qaName  = l.approved_by    ? (profileMap[l.approved_by]    || '...') : null;
                const needsQA = l.requires_qa !== false;
                const userCanAct = canApproveLog(l);
                const isActionable = ['pending','pending_qa'].includes(l.status);
                return (
                  <tr key={l.id}>
                    <td style={{ fontWeight: 600, whiteSpace: 'nowrap', fontSize: 12 }}>{fmtDate(l.work_date)}</td>
                    <td style={{ fontSize: 12, color: 'var(--text2)' }}>{l.line_name}</td>
                    <td><span style={{ background: m.bg, color: m.color, borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>{m.icon} {l.category}</span></td>
                    <td style={{ fontSize: 13 }}>
                      {l.description}
                      {l.change_subtype && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                        {{ replace: '🔄 Replace', change: '⚠️ Change', same_ok: '🟢 ไลน์เดิม/ผ่านเกณฑ์', cross_skill_ok: '🟡 ข้ามไลน์/skill OK', cross_needs_ojt: '🔴 ข้ามไลน์/ต้อง OJT' }[l.change_subtype] ?? l.change_subtype}
                      </div>}
                      {l.reject_reason && <div style={{ fontSize: 11, color: '#ef4444', marginTop: 3 }}>เหตุผล: {l.reject_reason}</div>}
                      <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                        {l.request_image_url && (
                          <button onClick={() => setImageViewModal({ url: l.request_image_url, title: '📎 รูปจากผู้แจ้ง' })}
                            style={{ fontSize: 11, padding: '2px 7px', borderRadius: 5, cursor: 'pointer', background: 'rgba(168,85,247,0.12)', color: '#a855f7', border: '1px solid rgba(168,85,247,0.3)', fontWeight: 600 }}>
                            📎 รูปแจ้ง
                          </button>
                        )}
                        {l.qa_image_url && (
                          <button onClick={() => setImageViewModal({ url: l.qa_image_url, title: '🔍 รูป QA ยืนยัน' })}
                            style={{ fontSize: 11, padding: '2px 7px', borderRadius: 5, cursor: 'pointer', background: 'rgba(34,197,94,0.1)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)', fontWeight: 600 }}>
                            🔍 รูป QA
                          </button>
                        )}
                      </div>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                        <span style={{ background: sm.bg, color: sm.color, borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>{sm.label}</span>
                        {svName && <span style={{ fontSize: 11, color: 'var(--muted)' }}>SV: {svName}</span>}
                        {qaName && <span style={{ fontSize: 11, color: 'var(--muted)' }}>QA: {qaName}</span>}
                        {l.approved_at && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{new Date(l.approved_at).toLocaleDateString('th-TH')}</span>}
                      </div>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 5,
                        background: needsQA ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
                        color: needsQA ? '#ef4444' : '#22c55e' }}>
                        {needsQA ? '🔴 QA' : '🟢 SV'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {isActionable ? (
                        userCanAct ? (
                          <div style={{ display: 'flex', gap: 5, justifyContent: 'center' }}>
                            <button onClick={() => handleApprove(l)}
                              style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: 'rgba(34,197,94,0.12)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)' }}>
                              ✅ {l.status === 'pending_qa' ? 'QA Approve' : 'SV Approve'}
                            </button>
                            <button onClick={() => { setRejectModal(l.id); setRejectReason(''); }}
                              style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}>
                              ❌ Reject
                            </button>
                          </div>
                        ) : (
                          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                            {l.status === 'pending_qa' ? 'รอ QA' : needsQA ? 'รอ SV → QA' : 'รอหัวหน้า'}
                          </span>
                        )
                      ) : (
                        can('four_m', 'reset', role) && (
                          <button onClick={() => supabase.from('four_m_logs').update({ status: 'pending', sv_approved_by: null, sv_approved_at: null, approved_by: null, approved_at: null, reject_reason: null }).eq('id', l.id).then(load)}
                            style={{ padding: '3px 8px', borderRadius: 5, fontSize: 11, cursor: 'pointer', background: 'var(--bg3)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                            Reset
                          </button>
                        )
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DocumentControlPanel() {
  const DOC_KEY = 'changing_point_control';
  const [docNo, setDocNo] = useState('');
  const [revision, setRevision] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [legend, setLegend] = useState('');
  const [issuedBy, setIssuedBy] = useState('');
  const [profiles, setProfiles] = useState([]);
  const [revisions, setRevisions] = useState([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [newRev, setNewRev] = useState({ record_date: '', rev: '', issued_date: '', description: '', responsible: '', approved_name: '' });

  const load = async () => {
    setLoading(true);
    const [{ data: doc }, { data: profs }, { data: revs }] = await Promise.all([
      supabase.from('document_controls').select('doc_no, revision, effective_date, legend, issued_by').eq('doc_key', DOC_KEY).maybeSingle(),
      supabase.from('profiles').select('id, full_name').order('full_name'),
      supabase.from('document_control_revisions').select('id, seq, record_date, rev, issued_date, description, responsible, approved_name').eq('doc_key', DOC_KEY).order('seq'),
    ]);
    setDocNo(doc?.doc_no || '');
    setRevision(doc?.revision || '');
    setEffectiveDate(doc?.effective_date || '');
    setLegend(doc?.legend || '');
    setIssuedBy(doc?.issued_by || '');
    setProfiles(profs || []);
    setRevisions(revs || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const saveDoc = async () => {
    setSaving(true);
    const { error } = await supabase.from('document_controls').upsert({
      doc_key: DOC_KEY,
      doc_no: docNo.trim() || null,
      revision: revision.trim() || null,
      effective_date: effectiveDate || null,
      legend: legend || null,
      issued_by: issuedBy || null,
    }, { onConflict: 'doc_key' });
    setSaving(false);
    if (error) { toast.error('เกิดข้อผิดพลาด: ' + error.message); return; }
    toast.success('บันทึกข้อมูลเอกสารสำเร็จ');
    load();
  };

  const addRevision = async () => {
    if (!newRev.rev.trim()) { toast.error('กรุณาระบุ Rev'); return; }
    const { error } = await supabase.from('document_control_revisions').insert([{
      doc_key: DOC_KEY, seq: revisions.length + 1,
      record_date: newRev.record_date || null,
      rev: newRev.rev.trim(),
      issued_date: newRev.issued_date || null,
      description: newRev.description.trim() || null,
      responsible: newRev.responsible.trim() || null,
      approved_name: newRev.approved_name.trim() || null,
    }]);
    if (error) { toast.error('เกิดข้อผิดพลาด: ' + error.message); return; }
    setNewRev({ record_date: '', rev: '', issued_date: '', description: '', responsible: '', approved_name: '' });
    load();
  };

  const removeRevision = async (r) => {
    if (!window.confirm(`ลบ Rev "${r.rev}"?`)) return;
    await supabase.from('document_control_revisions').delete().eq('id', r.id);
    load();
  };

  const inSt = { padding: '6px 8px', borderRadius: 6, fontSize: 12, width: '100%', boxSizing: 'border-box' };

  return (
    <div className="card" style={{ padding: 16, marginBottom: 14 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>⚙️ จัดการเอกสาร — Changing Point Control Record</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 10 }}>
        <div>
          <label style={{ fontSize: 11, color: 'var(--muted)' }}>เลขฟอร์ม (doc_no)</label>
          <input value={docNo} onChange={e => setDocNo(e.target.value)} placeholder="เช่น FM-PD-037" style={inSt} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: 'var(--muted)' }}>Revision</label>
          <input value={revision} onChange={e => setRevision(e.target.value)} placeholder="เช่น 00" style={inSt} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: 'var(--muted)' }}>Effective Date</label>
          <input type="date" value={effectiveDate || ''} onChange={e => setEffectiveDate(e.target.value)} style={inSt} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: 'var(--muted)' }}>ผู้ออกเอกสาร (Issued)</label>
          <select value={issuedBy} onChange={e => setIssuedBy(e.target.value)} style={inSt}>
            <option value="">— เลือก —</option>
            {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </div>
      </div>

      <div style={{ marginBottom: 10 }}>
        <label style={{ fontSize: 11, color: 'var(--muted)' }}>Legend (2 บรรทัด)</label>
        <textarea value={legend} onChange={e => setLegend(e.target.value)} rows={2} style={{ ...inSt, resize: 'vertical' }} />
      </div>

      <button onClick={saveDoc} disabled={saving} style={{
        padding: '7px 16px', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer',
        background: 'var(--accent)', color: '#fff', border: 'none', opacity: saving ? 0.6 : 1, marginBottom: 18,
      }}>{saving ? 'กำลังบันทึก...' : '💾 บันทึกข้อมูลเอกสาร'}</button>

      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>📜 ประวัติการแก้ไขเอกสาร (Revision History)</div>
      <div style={{ overflowX: 'auto', marginBottom: 10 }}>
        <table style={{ minWidth: 720 }}>
          <thead>
            <tr>
              <th style={{ fontSize: 11 }}>#</th>
              <th style={{ fontSize: 11 }}>วันที่บันทึก</th>
              <th style={{ fontSize: 11 }}>Rev</th>
              <th style={{ fontSize: 11 }}>Issued date</th>
              <th style={{ fontSize: 11 }}>Description</th>
              <th style={{ fontSize: 11 }}>Responsible</th>
              <th style={{ fontSize: 11 }}>Approved</th>
              <th style={{ fontSize: 11 }}></th>
            </tr>
          </thead>
          <tbody>
            {revisions.map((r, i) => (
              <tr key={r.id}>
                <td style={{ fontSize: 12 }}>{r.seq ?? i + 1}</td>
                <td style={{ fontSize: 12 }}>{r.record_date || '—'}</td>
                <td style={{ fontSize: 12 }}>{r.rev}</td>
                <td style={{ fontSize: 12 }}>{r.issued_date || '—'}</td>
                <td style={{ fontSize: 12 }}>{r.description || '—'}</td>
                <td style={{ fontSize: 12 }}>{r.responsible || '—'}</td>
                <td style={{ fontSize: 12 }}>{r.approved_name || '—'}</td>
                <td>
                  <button onClick={() => removeRevision(r)} style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, cursor: 'pointer', background: 'transparent', border: '1px solid rgba(239,68,68,0.4)', color: '#ef4444' }}>ลบ</button>
                </td>
              </tr>
            ))}
            {!loading && revisions.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--muted)', padding: 14, fontSize: 12 }}>ยังไม่มีประวัติการแก้ไข</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 6, alignItems: 'end' }}>
        <input type="date" value={newRev.record_date} onChange={e => setNewRev(v => ({ ...v, record_date: e.target.value }))} style={inSt} title="วันที่บันทึก" />
        <input value={newRev.rev} onChange={e => setNewRev(v => ({ ...v, rev: e.target.value }))} placeholder="Rev" style={inSt} />
        <input type="date" value={newRev.issued_date} onChange={e => setNewRev(v => ({ ...v, issued_date: e.target.value }))} style={inSt} title="Issued date" />
        <input value={newRev.description} onChange={e => setNewRev(v => ({ ...v, description: e.target.value }))} placeholder="Description" style={inSt} />
        <input value={newRev.responsible} onChange={e => setNewRev(v => ({ ...v, responsible: e.target.value }))} placeholder="Responsible" style={inSt} />
        <input value={newRev.approved_name} onChange={e => setNewRev(v => ({ ...v, approved_name: e.target.value }))} placeholder="Approved" style={inSt} />
        <button onClick={addRevision} style={{ padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: 'var(--accent)', color: '#fff', border: 'none' }}>+ เพิ่ม</button>
      </div>
    </div>
  );
}

/* ── Radar tooltip ── */
function RadarTooltipContent({ active, payload }) {
  if (!active || !payload?.length) return null;
  const { subject, value } = payload[0].payload;
  const lv = getLevel(value);
  return (
    <div style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8, padding: '7px 12px', fontSize: 12 }}>
      <div style={{ fontWeight: 700, color: 'var(--text)' }}>{subject}</div>
      <div style={{ color: lv.color, fontWeight: 800, fontSize: 15 }}>{value}<span style={{ fontSize: 11, fontWeight: 400, marginLeft: 2 }}>/ 100</span></div>
      <div style={{ fontSize: 11, color: lv.color }}>{lv.label}</div>
    </div>
  );
}

/* ── Radar Panel ── */
function OperatorRadarPanel({ emp, skillDefs, onClose }) {
  const skillMap = {};
  (emp.employee_skills || []).forEach(s => { skillMap[s.skill_name] = s.score; });

  const catGroups = groupSkillsByCategory(skillDefs);

  const radarData = skillDefs
    .map(s => ({ subject: s.label, value: skillMap[s.name] ?? 0, color: s.color || '#4d9fff', fullMark: 100 }))
    .filter(d => d.value > 0);

  const definedScores = skillDefs.map(s => skillMap[s.name]).filter(s => s !== undefined && s > 0);
  const avg = definedScores.length ? Math.round(definedScores.reduce((a, b) => a + b, 0) / definedScores.length) : 0;
  const overall = getLevel(avg);

  /* dynamic gradient based on avg */
  const glowColor = avg >= 80 ? '#22c55e' : avg >= 60 ? '#84cc16' : avg >= 40 ? '#f59e0b' : '#ef4444';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2100,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(6px)',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 'min(460px, 94vw)',
        background: 'var(--bg2)',
        border: `1px solid ${glowColor}55`,
        borderRadius: 20,
        boxShadow: `0 0 40px ${glowColor}33, 0 20px 60px rgba(0,0,0,0.8)`,
        overflow: 'hidden',
        animation: 'smSlideUp 0.28s cubic-bezier(0.16,1,0.3,1)',
      }}>
        <style>{`
          @keyframes smSlideUp {
            from { opacity:0; transform:translateY(30px) scale(0.96); }
            to   { opacity:1; transform:translateY(0) scale(1); }
          }
        `}</style>

        {/* Header stripe */}
        <div style={{ height: 4, background: `linear-gradient(90deg, ${glowColor}, transparent)` }} />

        {/* Profile section */}
        <div style={{ padding: '20px 24px 12px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <img
              src={emp.image_url || ''}
              alt=""
              onError={e => { e.target.style.display = 'none'; }}
              style={{ width: 72, height: 72, borderRadius: 14, objectFit: 'cover', border: `2px solid ${glowColor}88`, display: emp.image_url ? 'block' : 'none' }}
            />
            {!emp.image_url && (
              <div style={{
                width: 72, height: 72, borderRadius: 14,
                background: `linear-gradient(135deg, ${glowColor}44, ${glowColor}22)`,
                border: `2px solid ${glowColor}88`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 26, fontWeight: 800, color: glowColor,
              }}>
                {(emp.name || '?')[0]}
              </div>
            )}
            {/* Overall ring */}
            <div style={{
              position: 'absolute', bottom: -6, right: -6,
              background: glowColor, color: '#fff',
              borderRadius: 8, padding: '1px 6px', fontSize: 11, fontWeight: 800,
              border: '2px solid var(--bg2)',
            }}>{avg}</div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 17, color: 'var(--text)', lineHeight: 1.2 }}>{emp.name}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{emp.employee_id_code}</div>
            <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {emp.group_name && <span style={{ fontSize: 11, background: 'var(--bg3)', color: 'var(--text2)', borderRadius: 5, padding: '2px 7px', border: '1px solid var(--border2)' }}>{emp.group_name}</span>}
              <span style={{ fontSize: 11, background: `${glowColor}22`, color: glowColor, borderRadius: 5, padding: '2px 7px', border: `1px solid ${glowColor}44`, fontWeight: 700 }}>
                {overall.label}
              </span>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer', padding: 4, alignSelf: 'flex-start' }}>✕</button>
        </div>

        {/* Stat bars row — top 4 non-zero skills */}
        {radarData.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(radarData.length, 4)}, 1fr)`, gap: 6, padding: '0 24px 12px' }}>
          {radarData.slice(0, 4).map(d => {
            const lv = getLevel(d.value);
            return (
              <div key={d.subject} style={{ background: 'var(--bg3)', borderRadius: 8, padding: '8px 10px', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.subject}</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: lv.color, fontFamily: 'var(--font-display)' }}>{d.value}</div>
                <div style={{ height: 3, background: 'var(--border2)', borderRadius: 2, marginTop: 4 }}>
                  <div style={{ height: '100%', width: `${d.value}%`, background: lv.color, borderRadius: 2, transition: 'width 0.6s ease' }} />
                </div>
              </div>
            );
          })}
        </div>
        )}

        {/* Radar Chart */}
        <div style={{ padding: '0 12px 16px' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Skill Radar</div>
          <ResponsiveContainer width="100%" height={240}>
            <RadarChart data={radarData} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
              <PolarGrid stroke="var(--border2)" />
              <PolarAngleAxis
                dataKey="subject"
                tick={{ fill: 'var(--text2)', fontSize: 11, fontFamily: 'var(--font-body)' }}
              />
              <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
              <Radar
                dataKey="value"
                stroke={glowColor}
                fill={glowColor}
                fillOpacity={0.25}
                strokeWidth={2}
                dot={{ r: 4, fill: glowColor, strokeWidth: 0 }}
              />
              <Tooltip content={<RadarTooltipContent />} />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        {/* All skill bars grouped by category */}
        <div style={{ padding: '0 24px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {catGroups.map(g => {
            const gSkills = g.skills.map(s => ({ subject: s.label, value: skillMap[s.name] ?? 0 })).filter(d => d.value > 0);
            if (gSkills.length === 0) return null;
            return (
              <div key={g.key}>
                <div style={{ marginBottom: 6, borderBottom: `1px solid ${g.color}33`, paddingBottom: 3 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: g.color, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{g.icon} {g.label}</span>
                  {g.desc && <span style={{ fontSize: 11, color: g.color, opacity: 0.7, marginLeft: 6 }}>{g.desc}</span>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {gSkills.map(d => {
                    const lv = getLevel(d.value);
                    return (
                      <div key={d.subject} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ fontSize: 11, color: 'var(--text2)', width: 90, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.subject}</div>
                        <div style={{ flex: 1, height: 6, background: 'var(--border2)', borderRadius: 3 }}>
                          <div style={{ height: '100%', width: `${d.value}%`, background: lv.color, borderRadius: 3 }} />
                        </div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: lv.color, width: 28, textAlign: 'right' }}>{d.value}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Shared Filter Bar for employee tabs ── */
const selSt = { padding: '7px 10px', borderRadius: 7, fontSize: 13, background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)', cursor: 'pointer', minWidth: 120 };

function FilterBar({ lines, filterSection, setFilterSection, filterLine, setFilterLine, filterTeam, setFilterTeam, filterDept, setFilterDept }) {
  const orgSectionList = useOrgSections();
  const orgDeptList    = useOrgDepts();
  const sections = useMemo(() => orgSectionList.length ? orgSectionList : [...new Set(lines.map(l => l.section).filter(Boolean))].sort(), [lines, orgSectionList]);
  const visibleLines = filterSection ? lines.filter(l => l.section === filterSection) : lines;
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <select value={filterSection} onChange={e => { setFilterSection(e.target.value); setFilterLine(''); }} style={selSt}>
        <option value="">ทุกส่วนงาน</option>
        {sections.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      {setFilterDept && (
        <select value={filterDept || ''} onChange={e => setFilterDept(e.target.value)} style={selSt}>
          <option value="">ทุกแผนก</option>
          {orgDeptList.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      )}
      <select value={filterLine} onChange={e => setFilterLine(e.target.value)} style={selSt}>
        <option value="">ทุกไลน์</option>
        {visibleLines.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
      <select value={filterTeam} onChange={e => setFilterTeam(e.target.value)} style={selSt}>
        <option value="">ทุก Team</option>
        <option value="A">Team A</option>
        <option value="B">Team B</option>
        <option value="C">Team C</option>
      </select>
    </div>
  );
}

function SkillMatrixTab() {
  const { role, lineId: userLineId, sections: scopeSecs = [] } = useContext(UserContext);
  const canExport = can('report', 'export', role);
  const vw = useWidth();
  const [skillDefs,      setSkillDefs]      = useState([]);
  const [employees,      setEmployees]      = useState([]);
  const [loading,        setLoading]        = useState(false);
  const [filterLine,     setFilterLine]     = useState('');
  const [filterSection,  setFilterSection]  = useState('');
  const [filterTeam,     setFilterTeam]     = useState('');
  const [filterDept,     setFilterDept]     = useState('');
  const [lines,          setLines]          = useState([]);
  const [selectedEmp,    setSelectedEmp]    = useState(null);

  useEffect(() => {
    supabase.from('production_lines').select('id, name, section, parent_line_name').order('name').then(({ data }) => setLines(data || []));
    load();
  }, []);

  // lines อยู่ใน deps ด้วย — scope ครอบครัวไลน์ของ leader ต้อง re-apply หลัง lines โหลดเสร็จ
  useEffect(() => { load(); }, [filterLine, filterSection, filterTeam, filterDept, lines]);

  // กรองด้วยไลน์ = ทั้งครอบครัวไลน์ (ตัวเอง + ไลน์หลัก + ไลน์ย่อย) — fallback id เดิมถ้า lines ยังไม่โหลด
  const lineFamilyIdsOf = (lineId) => {
    const ids = getLineFamilyIds(lines, Number(lineId));
    return ids.size ? [...ids] : [lineId];
  };

  const load = async () => {
    setLoading(true);
    const baseSelect = 'id, name, employee_id_code, image_url, group_name, line_id, section, department, team, employee_skills(skill_name, score)';
    let q = supabase.from('employees').select(baseSelect).eq('is_active', true);
    // leader/supervisor เห็นเฉพาะไลน์/ส่วนงานตัวเองเสมอ ไม่ว่า filter ที่เลือกไว้จะเป็นอะไร —
    // บังคับ scope นี้เพิ่มเติมจาก filter อิสระ กันดูข้ามไลน์/ส่วนงานที่ตัวเองไม่ได้ดูแล
    if (role === 'leader' && userLineId) q = q.in('line_id', lineFamilyIdsOf(userLineId));
    else if (scopeSecs.length) q = q.in('section', scopeSecs);
    if (filterLine) q = q.in('line_id', lineFamilyIdsOf(filterLine));
    else if (filterSection) q = q.eq('section', filterSection);
    if (filterTeam) q = q.eq('team', filterTeam);
    if (filterDept) q = q.eq('department', filterDept);
    q = q.order('name');
    const [{ data: defs }, { data: emps }] = await Promise.all([
      supabase.from('skill_definitions').select('*').order('sort_order'),
      q,
    ]);
    setSkillDefs(defs || []);
    setEmployees(emps || []);
    setLoading(false);
  };

  return (
    <div>
      {selectedEmp && (
        <OperatorRadarPanel
          emp={selectedEmp}
          skillDefs={skillDefs}
          onClose={() => setSelectedEmp(null)}
        />
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <FilterBar lines={lines} filterSection={filterSection} setFilterSection={setFilterSection} filterLine={filterLine} setFilterLine={setFilterLine} filterTeam={filterTeam} setFilterTeam={setFilterTeam} filterDept={filterDept} setFilterDept={setFilterDept} />
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>{employees.length} คน · {skillDefs.length} สกิล</span>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>· คลิกที่พนักงานเพื่อดู Radar Chart</span>
        {canExport && (
        <button onClick={() => {
          const groups = groupSkillsByCategory(skillDefs);
          const ordered = groups.flatMap(g => g.skills);
          const todayStr = new Date().toLocaleDateString('th-TH', { dateStyle: 'long' });
          const headerCells = ordered.map(s => `<th style="border:1px solid #ccc;padding:3px 2px;font-size:9px;text-align:center;writing-mode:vertical-rl;transform:rotate(180deg);height:80px;white-space:nowrap">${s.label}</th>`).join('');
          const rowsHtml = employees.map((emp, i) => {
            const sm = Object.fromEntries((emp.employee_skills || []).map(s => [s.skill_name, s.score]));
            const scores = ordered.map(s => sm[s.name]);
            const defined = scores.filter(v => v !== undefined);
            const avg = defined.length ? Math.round(defined.reduce((a,b)=>a+b,0)/defined.length) : null;
            const cells = ordered.map((s, si) => {
              const v = sm[s.name];
              return `<td style="border:1px solid #ccc;text-align:center;padding:2px">${v !== undefined ? v : '—'}</td>`;
            }).join('');
            return `<tr><td style="border:1px solid #ccc;text-align:center;padding:2px">${i+1}</td><td style="border:1px solid #ccc;padding:2px 4px">${emp.employee_id_code || ''}</td><td style="border:1px solid #ccc;padding:2px 4px">${emp.name || ''}</td><td style="border:1px solid #ccc;padding:2px 4px">${emp.section || ''}</td><td style="border:1px solid #ccc;padding:2px 4px;text-align:center">${emp.team || ''}</td>${cells}<td style="border:1px solid #ccc;text-align:center;font-weight:700;padding:2px">${avg !== null ? avg : '—'}</td></tr>`;
          }).join('');
          const catHeaderCells = groups.map(g => `<th colspan="${g.skills.length}" style="border:1px solid #ccc;background:${g.color}18;color:${g.color};padding:3px 2px;font-size:9px;font-weight:800;text-align:center">${g.icon} ${g.label}</th>`).join('');
          const html = `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"/><title>Skill Matrix</title>
<style>@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap');
body{font-family:'Sarabun',sans-serif;font-size:10px;color:#000;background:#fff}
table{border-collapse:collapse;width:100%}
@media print{@page{size:A3 landscape;margin:8mm}body{-webkit-print-color-adjust:exact}}</style>
</head><body style="padding:8mm">
<h2 style="margin:0 0 4px;font-size:14px">Skill Matrix</h2>
<p style="color:#666;margin:0 0 8px;font-size:9px">พิมพ์วันที่: ${todayStr} · รวม ${employees.length} คน</p>
<table><thead>
<tr style="background:#f3f4f6">
<th rowspan="2" style="border:1px solid #ccc;padding:3px">#</th>
<th rowspan="2" style="border:1px solid #ccc;padding:3px">รหัส</th>
<th rowspan="2" style="border:1px solid #ccc;padding:3px">ชื่อ</th>
<th rowspan="2" style="border:1px solid #ccc;padding:3px">ส่วนงาน</th>
<th rowspan="2" style="border:1px solid #ccc;padding:3px">Team</th>
${catHeaderCells}
<th rowspan="2" style="border:1px solid #ccc;padding:3px;background:#d1fae5;color:#16a34a">เฉลี่ย</th>
</tr>
<tr style="background:#e5e7eb">${headerCells}</tr>
</thead><tbody>${rowsHtml}</tbody></table>
<script>window.onload = () => window.print();</script></body></html>`;
          const w = window.open('', '_blank'); w.document.write(html); w.document.close();
        }} disabled={employees.length === 0} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: 'rgba(77,159,255,0.12)', color: '#4d9fff', border: '1px solid rgba(77,159,255,0.35)', display: 'flex', alignItems: 'center', gap: 5, opacity: employees.length === 0 ? 0.5 : 1 }}>
          🖨️ PDF
        </button>
        )}
        <CsvBtn onClick={() => {
          const groups = groupSkillsByCategory(skillDefs);
          const ordered = groups.flatMap(g => g.skills);
          downloadCSV(
            `skill_matrix_${toLocalDateStr(new Date())}.csv`,
            ['รหัส', 'ชื่อ', 'ส่วนงาน', 'Team', ...ordered.map(s => s.label), 'เฉลี่ย'],
            employees.map(emp => {
              const sm = Object.fromEntries((emp.employee_skills || []).map(s => [s.skill_name, s.score]));
              const scores = ordered.map(s => sm[s.name] ?? '');
              const defined = ordered.map(s => sm[s.name]).filter(v => v !== undefined);
              const avg = defined.length ? Math.round(defined.reduce((a,b)=>a+b,0)/defined.length) : '';
              return [emp.employee_id_code, emp.name, emp.section || '', emp.team || '', ...scores, avg];
            })
          );
        }} />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {SKILL_LEVELS.filter(lv => lv.min > 0).map(lv => (
          <span key={lv.label} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: lv.bg, color: lv.color, border: `1px solid ${lv.color}40` }}>
            {lv.label} ≥{lv.min}
          </span>
        ))}
        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'var(--bg3)', color: 'var(--muted)', border: '1px solid var(--border)' }}>— ยังไม่ประเมิน</span>
      </div>

      {loading ? <Loader /> : (() => {
        const groups = groupSkillsByCategory(skillDefs);
        const orderedDefs = groups.flatMap(g => g.skills);

        // Only show columns where at least one employee has a skill record
        const visibleDefs = orderedDefs.filter(s =>
          employees.some(emp => {
            const sm = {};
            (emp.employee_skills || []).forEach(sk => { sm[sk.skill_name] = sk.score; });
            return sm[s.name] !== undefined;
          })
        );
        const visibleGroups = groups
          .map(g => ({ ...g, skills: g.skills.filter(s => visibleDefs.find(v => v.name === s.name)) }))
          .filter(g => g.skills.length > 0);

        // Mobile card view
        if (vw < 768) {
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {employees.map(emp => {
                const skillMap = {};
                (emp.employee_skills || []).forEach(s => { skillMap[s.skill_name] = s.score; });
                const mySkills = visibleDefs.filter(s => skillMap[s.name] !== undefined && skillMap[s.name] > 0);
                if (mySkills.length === 0) return null;
                return (
                  <div key={emp.id} className="card" style={{ padding: '10px 12px', cursor: 'pointer' }} onClick={() => setSelectedEmp(emp)}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
                      {emp.image_url
                        ? <img src={emp.image_url} alt="" style={{ width: 40, height: 40, borderRadius: 10, objectFit: 'cover' }} />
                        : <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 16 }}>{(emp.name || '?')[0]}</div>
                      }
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{emp.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{emp.employee_id_code}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {mySkills.map(s => {
                        const score = skillMap[s.name];
                        const lv = getLevel(score);
                        return (
                          <span key={s.name} style={{ fontSize: 11, padding: '2px 7px', borderRadius: 5, background: lv.bg, color: lv.color, border: `1px solid ${lv.color}33` }}>
                            {s.label} {score}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        }

        return (
          <div className="card" style={{ overflowX: 'auto', position: 'relative' }}>
            <table style={{ minWidth: 220 + visibleDefs.length * 44 }}>
              <thead>
                {/* Category group row */}
                <tr>
                  <th colSpan={2} style={{ borderBottom: 'none', background: 'var(--card)', position: 'sticky', left: 0, zIndex: 4 }} />
                  {visibleGroups.map(g => (
                    <th key={g.key} colSpan={g.skills.length}
                      style={{ textAlign: 'center', color: g.color,
                        background: `${g.color}10`, borderBottom: `2px solid ${g.color}44`,
                        padding: '5px 4px', borderLeft: `2px solid ${g.color}33` }}>
                      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em' }}>{g.icon} {g.label}</div>
                      {g.desc && <div style={{ fontSize: 11, fontWeight: 400, opacity: 0.75, marginTop: 1 }}>{g.desc}</div>}
                    </th>
                  ))}
                </tr>
                {/* Skill name row */}
                <tr>
                  <th style={{ minWidth: 44, textAlign: 'center', position: 'sticky', left: 0, zIndex: 3, background: 'var(--card)' }}>รูป</th>
                  <th style={{ minWidth: 130, textAlign: 'left', position: 'sticky', left: 52, zIndex: 3, background: 'var(--card)' }}>พนักงาน</th>
                  {visibleGroups.map(g => g.skills.map((s, si) => (
                    <th key={s.name} style={{
                      minWidth: 56,
                      maxWidth: 70,
                      textAlign: 'center',
                      fontSize: 11,
                      verticalAlign: 'bottom',
                      padding: '4px 3px 6px',
                      borderLeft: si === 0 ? `2px solid ${g.color}33` : undefined,
                    }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                        <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: s.color || g.color, flexShrink: 0 }} />
                        <span style={{ wordBreak: 'break-word', lineHeight: 1.3, whiteSpace: 'normal' }}>{s.label}</span>
                      </div>
                    </th>
                  )))}
                </tr>
              </thead>
              <tbody>
                {employees.length === 0 ? <EmptyRow cols={2 + visibleDefs.length} /> : employees.map(emp => {
                  const skillMap = {};
                  (emp.employee_skills || []).forEach(s => { skillMap[s.skill_name] = s.score; });
                  const assignedScores = visibleDefs.map(s => skillMap[s.name]).filter(s => s !== undefined && s > 0);
                  const avg = assignedScores.length ? Math.round(assignedScores.reduce((a, b) => a + b, 0) / assignedScores.length) : null;
                  const avgLv = avg !== null ? getLevel(avg) : { color: 'var(--border2)', bg: 'var(--bg3)', label: '' };

                  return (
                    <tr key={emp.id} onClick={() => setSelectedEmp(emp)}
                      style={{ cursor: 'pointer', transition: 'background 0.15s' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                      onMouseLeave={e => e.currentTarget.style.background = ''}>
                      <td style={{ textAlign: 'center', padding: '8px 6px', position: 'sticky', left: 0, zIndex: 2, background: 'var(--bg)' }}>
                        {emp.image_url
                          ? <img src={emp.image_url} alt="" style={{ width: 38, height: 38, borderRadius: 10, objectFit: 'cover', border: `2px solid ${avgLv.color}66`, display: 'block', margin: '0 auto' }} />
                          : <div style={{ width: 38, height: 38, borderRadius: 10, margin: '0 auto', background: `${avgLv.color}22`, border: `2px solid ${avgLv.color}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 800, color: avgLv.color }}>{(emp.name || '?')[0]}</div>
                        }
                      </td>
                      <td style={{ position: 'sticky', left: 52, zIndex: 2, background: 'var(--bg)' }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{emp.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{emp.employee_id_code}</div>
                        {avg !== null && (
                          <div style={{ marginTop: 3, display: 'inline-block', fontSize: 11, fontWeight: 700, color: avgLv.color, background: avgLv.bg, borderRadius: 4, padding: '1px 5px' }}>
                            avg {avg}
                          </div>
                        )}
                      </td>
                      {visibleGroups.map(g => g.skills.map((s, si) => {
                        const score = skillMap[s.name];
                        if (score === undefined || score === 0) return (
                          <td key={s.name} style={{ textAlign: 'center', borderLeft: si === 0 ? `2px solid ${g.color}22` : undefined }}>
                            <span style={{ color: 'var(--muted)', fontSize: 11 }}>—</span>
                          </td>
                        );
                        const lv = getLevel(score);
                        return (
                          <td key={s.name} style={{ textAlign: 'center', padding: '6px 4px', borderLeft: si === 0 ? `2px solid ${g.color}22` : undefined }}>
                            <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', background: lv.bg, borderRadius: 4, padding: '3px 4px', minWidth: 36 }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: lv.color }}>{score}</span>
                              <span style={{ fontSize: 11, color: lv.color }}>{lv.label}</span>
                            </div>
                          </td>
                        );
                      }))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })()}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   🏅 MultiSkillFormTab — MULTI SKILL OF OPERATORS export
   ══════════════════════════════════════════════════════════════ */

const MS_LEVELS = [
  { level: 4, pct: '100%',   label: 'สามารถสอนงานผู้อื่นได้',                          color: '#166534', bg: '#bbf7d0', border: '#16a34a' },
  { level: 3, pct: '75-99%', label: 'สามารถแก้ปัญหาและตัดสินใจในการทำงานได้',          color: '#1e3a5f', bg: '#bfdbfe', border: '#3b82f6' },
  { level: 2, pct: '50-74%', label: 'ปฏิบัติงานได้โดยไม่ต้องมีผู้แนะนำ',              color: '#713f12', bg: '#fef9c3', border: '#eab308' },
  { level: 1, pct: '25-49%', label: 'ผ่านการอบรม(OJT)และปฏิบัติงานได้โดยมีผู้แนะนำ', color: '#7c2d12', bg: '#fed7aa', border: '#f97316' },
  { level: 0, pct: '0-24%',  label: 'อยู่ระหว่างการฝึกอบรม',                           color: '#7f1d1d', bg: '#fecaca', border: '#ef4444' },
];

function scoreToLevel(score) {
  if (score === undefined || score === null) return 0;
  if (score >= 100) return 4;
  if (score >= 75)  return 3;
  if (score >= 50)  return 2;
  if (score >= 25)  return 1;
  return 0;
}

const msStyle = (lv) => MS_LEVELS.find(l => l.level === lv) || { bg: '#fff', color: '#999', border: '#ccc' };

/* ── SVG Skill Gauge — circle quartered like factory skill matrix form ── */
/* Fill order clockwise: bottom-left → bottom-right → top-right → top-left  */
const GAUGE_FILL = ['none', '#f97316', '#eab308', '#3b82f6', '#22c55e'];
const GAUGE_STROKE = ['#9ca3af', '#f97316', '#ca8a04', '#2563eb', '#16a34a'];

/* SVG arc paths for each quadrant (cx=17, cy=17, r=15, clockwise fill)
   L1=bottom-left  L2=+bottom-right  L3=+top-right  L4=+top-left        */
const Q_PATHS = [
  'M17,17 L2,17 A15,15 0 0,1 17,32 Z',   // bottom-left
  'M17,17 L17,32 A15,15 0 0,1 32,17 Z',  // bottom-right
  'M17,17 L32,17 A15,15 0 0,1 17,2 Z',   // top-right
  'M17,17 L17,2 A15,15 0 0,1 2,17 Z',    // top-left
];

function SkillGauge({ level, size = 34 }) {
  const fill   = GAUGE_FILL[level]   || 'none';
  const stroke = GAUGE_STROKE[level] || '#9ca3af';
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', margin: 'auto' }}>
      <circle cx="17" cy="17" r="15" fill="none" stroke={stroke} strokeWidth="1.5"/>
      {Q_PATHS.slice(0, level).map((d, i) => <path key={i} d={d} fill={fill} opacity="0.85"/>)}
      <line x1="17" y1="2"  x2="17" y2="32" stroke={stroke} strokeWidth="1"/>
      <line x1="2"  y1="17" x2="32" y2="17" stroke={stroke} strokeWidth="1"/>
      <circle cx="17" cy="17" r="15" fill="none" stroke={stroke} strokeWidth="1.5"/>
    </svg>
  );
}

/* inline SVG string for PDF export */
function skillGaugeSvgStr(lv) {
  const fill   = GAUGE_FILL[lv]   || 'none';
  const stroke = GAUGE_STROKE[lv] || '#9ca3af';
  const sectors = Q_PATHS.slice(0, lv)
    .map(d => `<path d="${d}" fill="${fill}" opacity="0.85"/>`)
    .join('');
  return `<svg width="26" height="26" viewBox="0 0 34 34" xmlns="http://www.w3.org/2000/svg">
    <circle cx="17" cy="17" r="15" fill="none" stroke="${stroke}" stroke-width="1.5"/>
    ${sectors}
    <line x1="17" y1="2" x2="17" y2="32" stroke="${stroke}" stroke-width="1"/>
    <line x1="2" y1="17" x2="32" y2="17" stroke="${stroke}" stroke-width="1"/>
    <circle cx="17" cy="17" r="15" fill="none" stroke="${stroke}" stroke-width="1.5"/>
  </svg>`;
}

function calcServiceDuration(startDate) {
  if (!startDate) return '';
  const start = new Date(startDate);
  const now = new Date();
  let years = now.getFullYear() - start.getFullYear();
  let months = now.getMonth() - start.getMonth();
  if (months < 0) { years--; months += 12; }
  const parts = [];
  if (years > 0) parts.push(`${years}ปี`);
  if (months > 0) parts.push(`${months}เดือน`);
  return parts.length ? parts.join(' ') : '< 1 เดือน';
}

function buildMultiSkillHtml({ empRows, levelCounts, skillDefs, dept, section, department, headName, maker, checker, approver, totalEmps, makerSigUrl, checkerSigUrl, approverSigUrl }) {
  const today = new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });

  const levelCell = (lv) =>
    `<td style="text-align:center;border:1px solid #999;padding:2px">${skillGaugeSvgStr(lv)}</td>`;

  const catGroups = groupSkillsByCategory(skillDefs);
  const orderedDefs = catGroups.flatMap(g => g.skills);

  // category header row for main skill table
  const catHeaderCells = catGroups.map(g =>
    `<th colspan="${g.skills.length}" style="border:1px solid #666;background:${g.color}18;color:${g.color};padding:3px 2px;font-size:8px;font-weight:800;text-align:center;letter-spacing:0.05em">${g.icon} ${g.label}</th>`
  ).join('');

  const skillHeaderCells = orderedDefs.map(s =>
    `<th style="border:1px solid #666;background:#e5e7eb;padding:3px 2px;font-size:9px;text-align:center;writing-mode:vertical-rl;transform:rotate(180deg);height:90px;white-space:nowrap">${s.label}</th>`
  ).join('');

  const empRowsHtml = empRows.map(({ emp, levels, overall, index }) => `
    <tr>
      <td style="text-align:center;border:1px solid #999;white-space:nowrap">${index}</td>
      <td style="border:1px solid #999;padding:0 3px;white-space:nowrap;font-size:9px">${emp.employee_id_code || ''}</td>
      <td style="border:1px solid #999;padding:0 3px;font-size:9px">${emp.name || ''}</td>
      <td style="border:1px solid #999;padding:0 3px;font-size:9px">${emp.position || ''}</td>
      <td style="border:1px solid #999;padding:0 3px;font-size:9px;white-space:nowrap">${calcServiceDuration(emp.start_date)}</td>
      ${levels.map(levelCell).join('')}${levelCell(overall)}
    </tr>`).join('');

  const summaryRowsHtml = MS_LEVELS.map((lv, li) => {
    const fillHex = GAUGE_FILL[lv.level] === 'none' ? '' : `background:${lv.bg + "33"};`;
    return `<tr>
      <td style="border:1px solid #999;padding:2px;text-align:center;vertical-align:middle">${skillGaugeSvgStr(lv.level)}</td>
      <td style="border:1px solid #999;padding:2px 4px;font-size:9px">${lv.pct} — ${lv.label}</td>
      ${levelCounts[li].map(cnt =>
        `<td style="text-align:center;border:1px solid #999;font-size:9px;font-weight:700;${cnt > 0 ? fillHex : ''}">${cnt || ''}</td>`
      ).join('')}
    </tr>`;
  }).join('');

  const legendHtml = MS_LEVELS.map(lv => {
    const s = msStyle(lv.level);
    return `<tr>
      <td style="padding:2px 4px;text-align:center;border:1px solid #ccc;vertical-align:middle">${skillGaugeSvgStr(lv.level)}</td>
      <td style="padding:1px 6px;font-size:8px">${lv.pct} — ${lv.label}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"/>
<title>MULTI SKILL OF OPERATORS</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}body{font-family:'Sarabun',sans-serif;font-size:10px;background:#fff;color:#000}
  .page{padding:8mm}table{border-collapse:collapse;font-size:10px}
  @media print{@page{size:A3 landscape;margin:6mm}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><div class="page">
  <table style="width:100%;margin-bottom:4px"><tr>
    <td style="vertical-align:top;width:22%">
      <div style="font-size:9px;line-height:2">
        <div>ฝ่าย : <strong>${dept}</strong></div>
        <div>ส่วน : <strong>${section}</strong></div>
        <div>แผนก : <strong>${department}</strong></div>
        <div>หัวหน้าแผนก : <strong>${headName}</strong></div>
      </div>
    </td>
    <td style="vertical-align:top;text-align:center;width:50%">
      <div style="font-size:14px;font-weight:800;margin-bottom:6px">MULTI SKILL OF OPERATORS</div>
      <table style="margin:0 auto;font-size:8px">${legendHtml}</table>
    </td>
    <td style="vertical-align:top;width:28%">
      <table style="width:100%;font-size:8px;border-collapse:collapse">
        <tr>
          <th style="border:1px solid #666;background:#f3f4f6;padding:2px;text-align:center">จัดทำโดย</th>
          <th style="border:1px solid #666;background:#f3f4f6;padding:2px;text-align:center">ตรวจสอบโดย</th>
          <th style="border:1px solid #666;background:#f3f4f6;padding:2px;text-align:center">อนุมัติโดย</th>
        </tr>
        <tr style="height:40px">
          <td style="border:1px solid #666;text-align:center;vertical-align:middle">${makerSigUrl ? `<img src="${makerSigUrl}" style="max-height:36px;max-width:90px;object-fit:contain"/>` : ''}</td>
          <td style="border:1px solid #666;text-align:center;vertical-align:middle">${checkerSigUrl ? `<img src="${checkerSigUrl}" style="max-height:36px;max-width:90px;object-fit:contain"/>` : ''}</td>
          <td style="border:1px solid #666;text-align:center;vertical-align:middle">${approverSigUrl ? `<img src="${approverSigUrl}" style="max-height:36px;max-width:90px;object-fit:contain"/>` : ''}</td>
        </tr>
        <tr>
          <td style="border:1px solid #666;padding:2px;text-align:center">(${maker || '......................'})</td>
          <td style="border:1px solid #666;padding:2px;text-align:center">(${checker || '......................'})</td>
          <td style="border:1px solid #666;padding:2px;text-align:center">(${approver || '......................'})</td>
        </tr>
        <tr>
          <td style="border:1px solid #666;padding:1px;text-align:center;font-size:7px">หัวหน้าแผนก</td>
          <td style="border:1px solid #666;padding:1px;text-align:center;font-size:7px">วิศวกร/หัวหน้าส่วน</td>
          <td style="border:1px solid #666;padding:1px;text-align:center;font-size:7px">ผู้จัดการส่วนผลิต</td>
        </tr>
        <tr>
          <td style="border:1px solid #666;padding:1px;text-align:center;font-size:7px">วันที่ .................</td>
          <td style="border:1px solid #666;padding:1px;text-align:center;font-size:7px">วันที่ .................</td>
          <td style="border:1px solid #666;padding:1px;text-align:center;font-size:7px">วันที่ .................</td>
        </tr>
      </table>
    </td>
  </tr></table>
  <table style="width:100%"><thead>
    <tr style="background:#d1d5db">
      <th style="border:1px solid #666;padding:3px;text-align:center;width:24px" rowspan="3">ลำดับ</th>
      <th style="border:1px solid #666;padding:3px;text-align:center;width:70px" rowspan="3">เลขที่บัตร</th>
      <th style="border:1px solid #666;padding:3px;text-align:center;min-width:110px" rowspan="3">ชื่อ-นามสกุล</th>
      <th style="border:1px solid #666;padding:3px;text-align:center;min-width:80px" rowspan="3">ตำแหน่ง</th>
      <th style="border:1px solid #666;padding:3px;text-align:center;min-width:60px" rowspan="3">อายุงาน</th>
      <th style="border:1px solid #666;padding:3px;text-align:center" colspan="${orderedDefs.length + 1}">ทักษะความสามารถการปฏิบัติงานของพนักงาน</th>
    </tr>
    <tr style="background:#f9fafb">${catHeaderCells}
      <th style="border:1px solid #666;background:#d1fae5;padding:3px 2px;font-size:8px;text-align:center" rowspan="2">ทักษะโดยรวม</th>
    </tr>
    <tr style="background:#e5e7eb">${skillHeaderCells}
    </tr>
  </thead><tbody>${empRowsHtml}</tbody></table>
  <div style="margin-top:10px">
    <table style="width:100%"><thead>
      <tr style="background:#d1d5db">
        <th style="border:1px solid #666;padding:3px;font-size:9px;text-align:center" colspan="2" rowspan="2">ระดับความสามารถ</th>
        ${catGroups.map(g => `<th colspan="${g.skills.length}" style="border:1px solid #666;background:${g.color}18;color:${g.color};padding:3px 2px;font-size:8px;font-weight:800;text-align:center">${g.icon} ${g.label}</th>`).join('')}
        <th style="border:1px solid #666;background:#d1fae5;padding:3px 2px;font-size:9px;text-align:center" rowspan="2">ทักษะโดยรวม</th>
      </tr>
      <tr style="background:#e5e7eb">
        ${orderedDefs.map(s => `<th style="border:1px solid #666;background:#e5e7eb;padding:3px 2px;font-size:9px;text-align:center;writing-mode:vertical-rl;transform:rotate(180deg);height:70px;white-space:nowrap">${s.label}</th>`).join('')}
      </tr>
    </thead><tbody>
      ${summaryRowsHtml}
      <tr style="background:#f3f4f6;font-weight:700">
        <td colspan="2" style="border:1px solid #999;text-align:center;padding:2px;font-size:9px">รวมพนักงานทั้งหมด</td>
        ${orderedDefs.map(() => `<td style="text-align:center;border:1px solid #999;font-size:9px">${totalEmps}</td>`).join('')}
        <td style="text-align:center;border:1px solid #999;font-size:9px">${totalEmps}</td>
      </tr>
    </tbody></table>
  </div>
  <div style="margin-top:6px;font-size:8px;color:#555">พิมพ์วันที่ ${today} · จำนวนพนักงาน ${totalEmps} คน</div>
</div>
<script>window.onload = () => { window.print(); }</script></body></html>`;
}

function MultiSkillFormTab() {
  const vw = useWidth();
  const { role, lineId: userLineId, sections: scopeSecs = [], signatureUrl: ctxSigUrl, fullName: ctxFullName } = useContext(UserContext);
  const canExport = can('report', 'export', role);

  const [skillDefs,     setSkillDefs]     = useState([]);
  const [employees,     setEmployees]     = useState([]);
  const [lines,         setLines]         = useState([]);
  const [loading,       setLoading]       = useState(false);
  const [filterLine,    setFilterLine]    = useState('');
  const [filterSection, setFilterSection] = useState('');
  const [filterTeam,    setFilterTeam]    = useState('');
  const [filterDept,    setFilterDept]    = useState('');

  // Header info inputs
  const [dept,       setDept]       = useState('Production');
  const [section,    setSection]    = useState('');
  const [department, setDepartment] = useState('');
  const [headName,   setHeadName]   = useState('');
  const [maker,      setMaker]      = useState('');
  const [checker,    setChecker]    = useState('');
  const [approver,   setApprover]   = useState('');

  // Signature URLs per role slot
  const [makerSig,    setMakerSig]    = useState(null);
  const [checkerSig,  setCheckerSig]  = useState(null);
  const [approverSig, setApproverSig] = useState(null);

  // Auto-fill current user's name + signature into the matching slot on load
  useEffect(() => {
    if (!ctxFullName && !ctxSigUrl) return;
    if (['leader'].includes(role)) {
      if (ctxFullName) setMaker(n => n || ctxFullName);
      if (ctxSigUrl)  setMakerSig(ctxSigUrl);
    } else if (['supervisor'].includes(role)) {
      if (ctxFullName) setChecker(n => n || ctxFullName);
      if (ctxSigUrl)   setCheckerSig(ctxSigUrl);
    } else if (['manager', 'admin'].includes(role)) {
      if (ctxFullName) setApprover(n => n || ctxFullName);
      if (ctxSigUrl)   setApproverSig(ctxSigUrl);
    }
  }, [role, ctxFullName, ctxSigUrl]);

  useEffect(() => {
    supabase.from('production_lines').select('id, name, section, parent_line_name').order('name')
      .then(({ data }) => setLines(data || []));
    supabase.from('skill_definitions').select('*').order('sort_order')
      .then(({ data }) => setSkillDefs(data || []));
  }, []);

  useEffect(() => {
    if (!filterLine) return;
    const lineData = lines.find(l => String(l.id) === String(filterLine));
    if (lineData) {
      setSection(lineData.section || '');
      setDepartment(lineData.name || '');
    }
    supabase.from('profiles')
      .select('role, full_name, signature_url')
      .eq('line_id', filterLine)
      .in('role', ['supervisor', 'leader', 'manager'])
      .then(({ data }) => {
        if (!data) return;
        const sv  = data.find(p => p.role === 'supervisor');
        const ldr = data.find(p => p.role === 'leader');
        const mgr = data.find(p => p.role === 'manager');
        if (ldr) { setMaker(ldr.full_name || ''); setMakerSig(ldr.signature_url || null); }
        if (sv)  { setChecker(sv.full_name || ''); setCheckerSig(sv.signature_url || null); setHeadName(sv.full_name || ''); }
        if (mgr) { setApprover(mgr.full_name || ''); setApproverSig(mgr.signature_url || null); }
      });
  }, [filterLine, lines]);

  // กรองด้วยไลน์ = ทั้งครอบครัวไลน์ (ตัวเอง + ไลน์หลัก + ไลน์ย่อย) — fallback id เดิมถ้า lines ยังไม่โหลด
  const lineFamilyIdsOf = (lineId) => {
    const ids = getLineFamilyIds(lines, Number(lineId));
    return ids.size ? [...ids] : [lineId];
  };

  const load = async () => {
    setLoading(true);
    const sel = 'id, name, employee_id_code, position, section, department, team, start_date, employee_skills(skill_name, score)';
    let q = supabase.from('employees').select(sel).eq('is_active', true);
    // leader/supervisor เห็นเฉพาะไลน์/ส่วนงานตัวเองเสมอ ไม่ว่า filter ที่เลือกไว้จะเป็นอะไร
    if (role === 'leader' && userLineId) q = q.in('line_id', lineFamilyIdsOf(userLineId));
    else if (scopeSecs.length) q = q.in('section', scopeSecs);
    if (filterLine) q = q.in('line_id', lineFamilyIdsOf(filterLine));
    else if (filterSection) q = q.eq('section', filterSection);
    if (filterTeam) q = q.eq('team', filterTeam);
    if (filterDept) q = q.eq('department', filterDept);
    q = q.order('name');
    const { data } = await q;
    setEmployees(data || []);
    setLoading(false);
  };

  const handlePrint = async () => {
    const ordered = groupSkillsByCategory(skillDefs).flatMap(g => g.skills);
    const empRows = employees.map((emp, i) => {
      const sm = Object.fromEntries((emp.employee_skills || []).map(s => [s.skill_name, s.score]));
      const levels = ordered.map(s => scoreToLevel(sm[s.name]));
      const validLevels = levels.filter(l => l > 0);
      const overall = validLevels.length
        ? Math.round(validLevels.reduce((a, b) => a + b, 0) / validLevels.length)
        : 0;
      return { emp, levels, overall, index: i + 1 };
    });
    const levelCounts = MS_LEVELS.map(lv => [
      ...ordered.map((_, si) => empRows.filter(r => r.levels[si] === lv.level).length),
      empRows.filter(r => r.overall === lv.level).length,
    ]);
    const [mSig, cSig, aSig] = await Promise.all([
      makerSig    ? urlToDataUrl(makerSig)    : Promise.resolve(null),
      checkerSig  ? urlToDataUrl(checkerSig)  : Promise.resolve(null),
      approverSig ? urlToDataUrl(approverSig) : Promise.resolve(null),
    ]);
    const html = buildMultiSkillHtml({ empRows, levelCounts, skillDefs, dept, section, department, headName, maker, checker, approver, totalEmps: empRows.length, makerSigUrl: mSig, checkerSigUrl: cSig, approverSigUrl: aSig });
    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
  };

  const msLevelColor = (lv) => {
    const m = msStyle(lv);
    return { bg: m.bg || 'var(--bg3)', color: m.color || 'var(--muted)' };
  };

  const msCatGroups  = useMemo(() => groupSkillsByCategory(skillDefs), [skillDefs]);
  const msOrderedDefs = useMemo(() => msCatGroups.flatMap(g => g.skills), [msCatGroups]);

  // Filter to only skills where at least one employee has a record
  const msVisibleDefs = useMemo(() => msOrderedDefs.filter(s =>
    employees.some(emp => {
      const sm = {};
      (emp.employee_skills || []).forEach(sk => { sm[sk.skill_name] = sk.score; });
      return sm[s.name] !== undefined;
    })
  ), [msOrderedDefs, employees]);

  const msVisibleGroups = useMemo(() => msCatGroups
    .map(g => ({ ...g, skills: g.skills.filter(s => msVisibleDefs.find(v => v.name === s.name)) }))
    .filter(g => g.skills.length > 0),
  [msCatGroups, msVisibleDefs]);

  // Precompute per-employee levels once (avoids O(n*skills) recalculation on every render)
  const empLevelRows = useMemo(() => employees.map(emp => {
    const sm = Object.fromEntries((emp.employee_skills || []).map(s => [s.skill_name, s.score]));
    // null = N/A (no record or score=0), number = valid level
    const levels = msVisibleDefs.map(s => {
      const score = sm[s.name];
      if (score === undefined || score === 0) return null;
      return scoreToLevel(score);
    });
    const validLevels = levels.filter(l => l !== null && l > 0);
    const overall = validLevels.length
      ? Math.round(validLevels.reduce((a, b) => a + b, 0) / validLevels.length)
      : 0;
    return { emp, levels, overall };
  }), [employees, msVisibleDefs]);

  // Precompute summary counts (avoids O(levels*skills*employees) inline in JSX)
  const summaryCounts = useMemo(() => MS_LEVELS.map(lv => ({
    lv,
    counts: msVisibleDefs.map((_, si) => empLevelRows.filter(r => r.levels[si] !== null && r.levels[si] === lv.level).length),
    total:  empLevelRows.filter(r => r.overall === lv.level).length,
  })), [empLevelRows, msVisibleDefs]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Filters + header inputs */}
      <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
        <div>
          <span style={lbSt}>ตัวกรอง</span>
          <FilterBar lines={lines} filterSection={filterSection} setFilterSection={setFilterSection} filterLine={filterLine} setFilterLine={setFilterLine} filterTeam={filterTeam} setFilterTeam={setFilterTeam} filterDept={filterDept} setFilterDept={setFilterDept} />
        </div>
        <button onClick={load} disabled={loading}
          style={{ padding: '8px 20px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer', opacity: loading ? 0.6 : 1 }}>
          {loading ? 'กำลังโหลด...' : '🔍 ดึงข้อมูล'}
        </button>
        {employees.length > 0 && (
          <CsvBtn onClick={() => {
            const ordered = msCatGroups.flatMap(g => g.skills);
            downloadCSV(
              `multi_skill_${toLocalDateStr(new Date())}.csv`,
              ['รหัส', 'ชื่อ', 'ตำแหน่ง', 'ส่วนงาน', 'Team', 'อายุงาน', ...ordered.map(s => s.label), 'ทักษะโดยรวม'],
              empLevelRows.map(({ emp, levels, overall }) => [
                emp.employee_id_code || '',
                emp.name || '',
                emp.position || '',
                emp.section || '',
                emp.team || '',
                calcServiceDuration(emp.start_date),
                ...levels,
                overall,
              ])
            );
          }} />
        )}
      </div>

      {employees.length > 0 && (
        <>
          {/* Document header inputs */}
          <div className="card">
            <div style={{ fontWeight: 700, marginBottom: 12, color: 'var(--text2)', fontSize: 13 }}>ข้อมูลหัวเอกสาร</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
              {[
                { label: 'ฝ่าย', val: dept,       set: setDept },
                { label: 'ส่วน', val: section,    set: setSection },
                { label: 'แผนก', val: department, set: setDepartment },
                { label: 'หัวหน้าแผนก', val: headName, set: setHeadName },
              ].map(({ label, val, set }) => (
                <div key={label}>
                  <span style={lbSt}>{label}</span>
                  <input value={val} onChange={e => set(e.target.value)} style={{ width: '100%', padding: '6px 10px', borderRadius: 7, fontSize: 13, background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)' }} />
                </div>
              ))}
            </div>

            {/* Signature slots */}
            <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
              {[
                { label: 'จัดทำโดย', name: maker, setName: setMaker, sig: makerSig, setSig: setMakerSig, autoRole: 'leader' },
                { label: 'ตรวจสอบโดย', name: checker, setName: setChecker, sig: checkerSig, setSig: setCheckerSig, autoRole: 'supervisor' },
                { label: 'อนุมัติโดย', name: approver, setName: setApprover, sig: approverSig, setSig: setApproverSig, autoRole: 'manager/admin' },
              ].map(({ label, name, setName, sig, setSig, autoRole }) => (
                <div key={label} style={{ border: '1px solid var(--border2)', borderRadius: 8, padding: 10, background: 'var(--bg2)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={lbSt}>{label}</span>
                    <span style={{ fontSize: 11, color: 'var(--muted)', background: 'var(--bg3)', borderRadius: 4, padding: '1px 5px' }}>{autoRole}</span>
                  </div>
                  <input value={name} onChange={e => setName(e.target.value)}
                    placeholder="ชื่อ-นามสกุล"
                    style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)', marginBottom: 6 }} />
                  {sig ? (
                    <div style={{ position: 'relative' }}>
                      <img src={sig} alt="sig" style={{ width: '100%', height: 48, objectFit: 'contain', borderRadius: 4, background: '#fff', border: '1px solid var(--border2)' }} />
                      <button onClick={() => setSig(null)}
                        style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,0.5)', border: 'none', color: '#fff', borderRadius: 4, fontSize: 11, cursor: 'pointer', padding: '1px 5px' }}>✕</button>
                    </div>
                  ) : (
                    <label style={{ display: 'block', cursor: 'pointer' }}>
                      <div style={{ height: 48, border: '1px dashed var(--border2)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--muted)' }}>
                        📎 อัปโหลดลายเซ็น
                      </div>
                      <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => {
                        const file = e.target.files[0];
                        if (file) setSig(URL.createObjectURL(file));
                      }} />
                    </label>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Preview */}
          <div className="card" style={{ overflowX: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <span style={{ fontWeight: 700, fontSize: 15 }}>MULTI SKILL OF OPERATORS</span>
                <span style={{ color: 'var(--muted)', fontSize: 12, marginLeft: 10 }}>{employees.length} คน · {skillDefs.length} ทักษะ</span>
              </div>
              {canExport && (
                <button onClick={handlePrint} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: 'rgba(77,159,255,0.12)', color: '#4d9fff', border: '1px solid rgba(77,159,255,0.35)', display: 'flex', alignItems: 'center', gap: 5 }}>
                  🖨️ Export PDF
                </button>
              )}
            </div>

            {/* Legend */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              {MS_LEVELS.map(lv => (
                <div key={lv.level} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 8, background: lv.level > 0 ? lv.bg + "33" : 'var(--bg3)', border: `1px solid ${lv.level > 0 ? lv.border : 'var(--border)'}` }}>
                  <SkillGauge level={lv.level} size={20} />
                  <span style={{ fontSize: 11, color: lv.level > 0 ? lv.color : 'var(--muted)', fontWeight: lv.level > 0 ? 700 : 400 }}>
                    {lv.pct} · {lv.label}
                  </span>
                </div>
              ))}
            </div>

            {vw < 768 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {empLevelRows.map(({ emp, levels, overall }, i) => {
                  const mySkills = msVisibleDefs.filter((_, si) => levels[si] > 0);
                  if (mySkills.length === 0) return null;
                  return (
                    <div key={emp.id} className="card" style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
                        <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 16 }}>{(emp.name || '?')[0]}</div>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 14 }}>{emp.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{emp.employee_id_code} · {emp.position || ''}</div>
                        </div>
                        <div style={{ marginLeft: 'auto' }}><SkillGauge level={overall} size={32} /></div>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {mySkills.map((s, idx) => {
                          const si = msVisibleDefs.indexOf(s);
                          const lv = levels[si];
                          const m = msStyle(lv);
                          return (
                            <span key={s.name} style={{ fontSize: 11, padding: '2px 7px', borderRadius: 5, background: m.bg + '55', color: m.color, border: `1px solid ${m.border}55` }}>
                              {s.label} L{lv}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
            <div style={{ overflowX: 'auto', position: 'relative' }}>
            <table style={{ minWidth: 220 + msVisibleDefs.length * 44, borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th rowSpan={2} style={{ border: '1px solid var(--border2)', padding: '4px 6px', background: 'var(--bg3)', width: 30, textAlign: 'center', position: 'sticky', left: 0, zIndex: 3 }}>#</th>
                  <th rowSpan={2} style={{ border: '1px solid var(--border2)', padding: '4px 6px', background: 'var(--bg3)', minWidth: 120, position: 'sticky', left: 30, zIndex: 3 }}>ชื่อ-สกุล</th>
                  <th rowSpan={2} style={{ border: '1px solid var(--border2)', padding: '4px 6px', background: 'var(--bg3)', minWidth: 80, position: 'sticky', left: 150, zIndex: 3 }}>ตำแหน่ง</th>
                  {msVisibleGroups.map(g => (
                    <th key={g.key} colSpan={g.skills.length} style={{ border: '1px solid var(--border2)', padding: '4px 6px', background: `${g.color}15`, color: g.color, textAlign: 'center' }}>
                      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.04em' }}>{g.icon} {g.label}</div>
                      {g.desc && <div style={{ fontSize: 11, fontWeight: 400, color: g.color, opacity: 0.75, marginTop: 1 }}>{g.desc}</div>}
                    </th>
                  ))}
                  <th rowSpan={2} style={{ border: '1px solid var(--border2)', padding: '4px 3px', background: 'rgba(34,197,94,0.12)', color: '#22c55e', width: 44, textAlign: 'center', fontSize: 11, verticalAlign: 'bottom' }}>ทักษะโดยรวม</th>
                </tr>
                <tr>
                  {msVisibleDefs.map((s, si) => {
                    const g = msVisibleGroups.find(g => g.skills.find(sk => sk.name === s.name));
                    const firstInGroup = g && g.skills[0].name === s.name;
                    return (
                      <th key={s.name} style={{
                        minWidth: 56, maxWidth: 70, textAlign: 'center', fontSize: 11, verticalAlign: 'bottom',
                        padding: '4px 3px 6px', border: '1px solid var(--border2)', background: 'var(--bg3)',
                        borderLeft: firstInGroup ? `2px solid ${g.color}44` : undefined,
                      }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                          <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: s.color || (g?.color || '#888'), flexShrink: 0 }} />
                          <span style={{ wordBreak: 'break-word', lineHeight: 1.3, whiteSpace: 'normal' }}>{s.label}</span>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {empLevelRows.map(({ emp, levels, overall }, i) => (
                  <tr key={emp.id}>
                    <td style={{ border: '1px solid var(--border2)', textAlign: 'center', color: 'var(--muted)', fontSize: 11, position: 'sticky', left: 0, zIndex: 2, background: 'var(--bg)' }}>{i+1}</td>
                    <td style={{ border: '1px solid var(--border2)', padding: '3px 5px', fontWeight: 500, position: 'sticky', left: 30, zIndex: 2, background: 'var(--bg)' }}>{emp.name}</td>
                    <td style={{ border: '1px solid var(--border2)', padding: '3px 5px', fontSize: 11, color: 'var(--text2)', position: 'sticky', left: 150, zIndex: 2, background: 'var(--bg)' }}>{emp.position || ''}</td>
                    {levels.map((lv, si) => {
                      const s = msVisibleDefs[si];
                      const g = msVisibleGroups.find(g => g.skills.find(sk => sk.name === s.name));
                      const firstInGroup = g && g.skills[0].name === s.name;
                      return (
                        <td key={si} style={{ border: '1px solid var(--border2)', textAlign: 'center', padding: '4px 2px', borderLeft: firstInGroup ? `2px solid ${g.color}22` : undefined }}>
                          {lv === null
                            ? <span style={{ color: 'var(--border2)', fontSize: 11 }}>—</span>
                            : <SkillGauge level={lv} size={30} />}
                        </td>
                      );
                    })}
                    <td style={{ border: '1px solid var(--border2)', textAlign: 'center', padding: '4px 2px', background: overall > 0 ? msStyle(overall).bg + "22" : '' }}>
                      <SkillGauge level={overall} size={30} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            )}

            {/* Summary count table */}
            <div style={{ marginTop: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: 'var(--text2)' }}>สรุปจำนวนพนักงานแยกตามระดับ</div>
              <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    <th rowSpan={2} style={{ border: '1px solid var(--border2)', padding: '4px 8px', background: 'var(--bg3)', minWidth: 60 }}>ระดับ</th>
                    <th rowSpan={2} style={{ border: '1px solid var(--border2)', padding: '4px 8px', background: 'var(--bg3)', minWidth: 120 }}>ความหมาย</th>
                    {msVisibleGroups.map(g => (
                      <th key={g.key} colSpan={g.skills.length} style={{ border: '1px solid var(--border2)', padding: '3px 4px', background: `${g.color}15`, color: g.color, textAlign: 'center', fontSize: 11, fontWeight: 800 }}>
                        {g.icon} {g.label}
                      </th>
                    ))}
                    <th rowSpan={2} style={{ border: '1px solid var(--border2)', padding: '4px 3px', background: 'rgba(34,197,94,0.12)', color: '#22c55e', width: 68, textAlign: 'center', fontSize: 11 }}>รวม</th>
                  </tr>
                  <tr>
                    {msVisibleDefs.map(s => (
                      <th key={s.name} style={{ border: '1px solid var(--border2)', padding: '4px 3px', background: 'var(--bg3)', width: 44, textAlign: 'center', fontSize: 11 }}>{s.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {summaryCounts.map(({ lv, counts, total }) => {
                    const c = msLevelColor(lv.level);
                    return (
                      <tr key={lv.level}>
                        <td style={{ border: '1px solid var(--border2)', textAlign: 'center', padding: '4px 6px', background: lv.level > 0 ? lv.bg + "33" : '' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                            <SkillGauge level={lv.level} size={22} />
                            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{lv.pct}</span>
                          </div>
                        </td>
                        <td style={{ border: '1px solid var(--border2)', padding: '3px 8px', fontSize: 11, color: 'var(--text2)' }}>{lv.label}</td>
                        {counts.map((cnt, i) => (
                          <td key={i} style={{ border: '1px solid var(--border2)', textAlign: 'center', fontWeight: cnt > 0 ? 700 : 400, color: cnt > 0 ? (lv.level > 0 ? c.color : 'var(--muted)') : 'var(--muted)' }}>
                            {cnt || ''}
                          </td>
                        ))}
                        <td style={{ border: '1px solid var(--border2)', textAlign: 'center', fontWeight: 700, color: total > 0 ? '#22c55e' : 'var(--muted)' }}>{total || ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </div>
          </div>
        </>
      )}

      {!loading && employees.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
          เลือกไลน์และกด "ดึงข้อมูล" เพื่อแสดง Multi-Skill Matrix
        </div>
      )}
    </div>
  );
}

// ─── Export Tab ─────────────────────────────────────────────
const SUMCOLS = ['ส', 'ป', 'ก', 'พง', 'กธ', 'บป', 'ข', 'มต'];
const TH_MONTHS = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];

function AttendancePrint({ employees, days, logsMap, dept, thMonthStr, startDay, endDay }) {
  const bdr  = '0.5px solid #555';
  const tdSt = (ex = {}) => ({ border: bdr, fontSize: 6.5, textAlign: 'center', padding: '0 1px', lineHeight: 1.3, verticalAlign: 'middle', ...ex });
  const thSt = (ex = {}) => ({ ...tdSt(), background: '#dde8ff', fontWeight: 700, ...ex });

  return (
    <div style={{ fontFamily: '"Sarabun","TH Sarabun New",Arial,sans-serif', background: '#fff', color: '#000', padding: 6, minWidth: 900 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 3 }}>
        <tbody>
          <tr>
            <td style={{ width: '35%', textAlign: 'center', fontWeight: 800, fontSize: 10 }}>
              บริษัท ไทยซัมมิท โอโตโมทีฟ จำกัด
            </td>
            <td style={{ width: '20%', border: bdr, textAlign: 'center', fontSize: 8, padding: '3px 6px' }}>
              เดือน <strong>{thMonthStr}</strong>
            </td>
            <td style={{ width: '22%', border: bdr, textAlign: 'center', fontSize: 8, padding: '3px 6px' }}>
              งวด วันที่ {startDay}–{endDay}
            </td>
            <td style={{ width: '23%', border: bdr, textAlign: 'center', fontSize: 8, padding: '3px 6px' }}>
              จำนวนพนักงาน <strong>{employees.length}</strong> คน
            </td>
          </tr>
        </tbody>
      </table>

      <div style={{ textAlign: 'center', fontSize: 9.5, fontWeight: 700, marginBottom: 3 }}>
        ใบบันทึกการมาทำงาน - การหยุดงานของพนักงาน
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 3 }}>
        <tbody>
          <tr>
            <td style={{ fontSize: 7.5, padding: '1px 0' }}>หัวหน้าแผนก ___________________</td>
            <td style={{ fontSize: 7.5, textAlign: 'center' }}>หัวหน้าส่วน ___________________</td>
            <td style={{ fontSize: 7.5, textAlign: 'right' }}>ผู้จัดการ ___________________</td>
          </tr>
        </tbody>
      </table>

      {dept && (
        <div style={{ fontWeight: 700, fontSize: 8, marginBottom: 3, background: '#eef2ff', display: 'inline-block', padding: '1px 6px' }}>
          {dept}
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: 6.5 }}>
        <colgroup>
          <col style={{ width: 18 }} />
          <col style={{ width: 80 }} />
          <col style={{ width: 46 }} />
          {days.flatMap(d => [
            <col key={`ca${d}`} style={{ width: 9 }} />,
            <col key={`cb${d}`} style={{ width: 9 }} />,
            <col key={`cc${d}`} style={{ width: 9 }} />,
          ])}
          {SUMCOLS.map(s => <col key={`cs${s}`} style={{ width: 12 }} />)}
          <col style={{ width: 15 }} />
        </colgroup>
        <thead>
          <tr>
            <th rowSpan={2} style={thSt({ fontSize: 5.5 })}>ลำดับ</th>
            <th rowSpan={2} style={thSt({ textAlign: 'left', paddingLeft: 3 })}>ชื่อ - สกุล</th>
            <th rowSpan={2} style={thSt()}>เลขที่บัตร</th>
            {days.map(d => <th key={d} colSpan={3} style={thSt()}>{d}</th>)}
            {SUMCOLS.map(s => <th key={s} rowSpan={2} style={thSt({ fontSize: 5.5 })}>{s}</th>)}
            <th rowSpan={2} style={thSt({ fontSize: 5.5 })}>OT<br/>ชม.</th>
          </tr>
          <tr>
            {days.flatMap(d => [
              <th key={`${d}c`} style={thSt({ fontSize: 5 })}>ช</th>,
              <th key={`${d}b`} style={thSt({ fontSize: 5 })}>บ</th>,
              <th key={`${d}o`} style={thSt({ fontSize: 5 })}>อ</th>,
            ])}
          </tr>
        </thead>
        <tbody>
          {employees.map((emp, idx) => {
            const log = logsMap[emp.id] || {};
            const absentCount = days.filter(d => log[d] === false).length;

            const mainCells = days.flatMap(d => {
              const status = log[d];
              return [
                <td key={`${d}c`} style={tdSt({ background: status === false ? '#ffe4e1' : status === true ? '#f0fff4' : '#fff', fontSize: 6 })}>
                  {status === false ? 'ข' : status === true ? '✓' : ''}
                </td>,
                <td key={`${d}b`} style={tdSt({ background: '#fff' })}></td>,
                <td key={`${d}o`} style={tdSt({ background: '#fff' })}></td>,
              ];
            });

            const otCells = days.flatMap(d => [
              <td key={`${d}c2`} style={tdSt({ height: 10 })}></td>,
              <td key={`${d}b2`} style={tdSt()}></td>,
              <td key={`${d}o2`} style={tdSt()}></td>,
            ]);

            return [
              <tr key={`${emp.id}a`} style={{ height: 14 }}>
                <td rowSpan={2} style={tdSt({ textAlign: 'center', fontWeight: 600 })}>{idx + 1}</td>
                <td rowSpan={2} style={tdSt({ textAlign: 'left', paddingLeft: 3 })}>{emp.name}</td>
                <td rowSpan={2} style={tdSt({ fontSize: 6 })}>{emp.employee_id_code}</td>
                {mainCells}
                {SUMCOLS.map(s => (
                  <td key={s} style={tdSt()}>{s === 'ข' && absentCount > 0 ? absentCount : ''}</td>
                ))}
                <td style={tdSt()}></td>
              </tr>,
              <tr key={`${emp.id}b`} style={{ height: 10 }}>
                {otCells}
                {SUMCOLS.map(s => <td key={s} style={tdSt()}></td>)}
                <td style={tdSt()}></td>
              </tr>,
            ];
          })}
        </tbody>
      </table>

      <div style={{ marginTop: 5, fontSize: 6, lineHeight: 1.8, color: '#444' }}>
        <div><strong>หมายเหตุ:</strong> ส=มาสาย &nbsp; ป=ลาป่วย &nbsp; ก=กาคิง &nbsp; พง=ลาพักผ่อนประจำปี &nbsp; กธ=ลากิจธุระอันจำเป็น &nbsp; บป=ลาอุปสมบท &nbsp; ข=ขาดงาน &nbsp; มต=ไม่มา Meeting</div>
        <div>★ ช = ช่วงเช้า, บ = ช่วงบ่าย, อ = ช่วงโอที &nbsp; ★ ลา 12 ชั่วโมง = 0.2, ลาครึ่งวัน = 0.5</div>
      </div>
    </div>
  );
}

function OTPrint({ employees, dept, thMonthStr }) {
  const bdr  = '0.5px solid #444';
  const tdSt = (ex = {}) => ({ border: bdr, fontSize: 8, padding: '2px 3px', verticalAlign: 'middle', ...ex });
  const thSt = (ex = {}) => ({ ...tdSt(), background: '#c8e6c9', fontWeight: 700, textAlign: 'center', ...ex });

  const half   = Math.ceil(employees.length / 2);
  const groups = [employees.slice(0, half), employees.slice(half)];
  const cols   = [
    { label: 'สำดับ', w: 22 }, { label: 'เลขที่บัตร', w: 56 }, { label: 'ชื่อ-สกุล', w: 110 },
    { label: 'งานที่ทำ', w: 90 }, { label: 'สายรอง', w: 60 },
    { label: 'เวลาเริ่ม', w: 40 }, { label: 'ลายมือชื่อ ล.1', w: 48 },
    { label: 'เวลาเลิก', w: 40 }, { label: 'ชั่วโมง', w: 28 }, { label: 'ลายมือชื่อ ล.2', w: 48 },
  ];

  const renderGroup = (grp, offset) => (
    <table key={offset} style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8, tableLayout: 'fixed', fontSize: 8 }}>
      <colgroup>{cols.map((c, i) => <col key={i} style={{ width: c.w }} />)}</colgroup>
      <thead>
        <tr>{cols.map((c, i) => <th key={i} style={thSt()}>{c.label}</th>)}</tr>
      </thead>
      <tbody>
        {grp.map((emp, i) => (
          <tr key={emp.id} style={{ height: 20 }}>
            <td style={tdSt({ textAlign: 'center' })}>{offset + i + 1}</td>
            <td style={tdSt()}>{emp.employee_id_code}</td>
            <td style={tdSt()}>{emp.name}</td>
            {Array(7).fill(0).map((_, j) => <td key={j} style={tdSt()}></td>)}
          </tr>
        ))}
        {Array.from({ length: Math.max(0, 5 - grp.length) }).map((_, i) => (
          <tr key={`p${i}`} style={{ height: 20 }}>
            {cols.map((_, j) => <td key={j} style={tdSt()}></td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div style={{ fontFamily: '"Sarabun","TH Sarabun New",Arial,sans-serif', background: '#fff', color: '#000', padding: 10, minWidth: 700, fontSize: 9 }}>
      <div style={{ textAlign: 'right', marginBottom: 6, fontSize: 8 }}>□ วันธรรมดา &nbsp;&nbsp; □ วันหยุด</div>
      <div style={{ textAlign: 'center', fontSize: 11, fontWeight: 800, marginBottom: 6 }}>
        แบบฟอร์มใบสั่งงานและรายงานการทำงานล่วงเวลา (ใบ ล.1 และ ล.2)
      </div>
      <div style={{ marginBottom: 6, fontSize: 8, lineHeight: 1.8 }}>
        <div>บริษัท: บริษัทไทยซัมมิท โอโตโมทีฟ จำกัด (สาขา 1) &nbsp;&nbsp;&nbsp; วันที่: ___________</div>
        <div>ฝ่าย: Production &nbsp;&nbsp; ส่วน: {dept || '___________'} &nbsp;&nbsp; Cost: ___________</div>
      </div>
      <div style={{ fontWeight: 700, fontSize: 8.5, marginBottom: 4, borderBottom: '1px solid #555', paddingBottom: 2 }}>
        รายชื่อพนักงานที่ทำงานล่วงเวลา
      </div>
      {groups.map((grp, i) => grp.length > 0 && renderGroup(grp, i === 0 ? 0 : groups[0].length))}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10, fontSize: 8 }}>
        {['ผู้บันทึกและผู้อนุมัติ ล.1', 'ผู้บันทึกและผู้อนุมัติ ล.2'].map((label, i) => (
          <div key={i} style={{ border: bdr, padding: '8px 12px' }}>
            <div style={{ fontWeight: 700, marginBottom: 12 }}>{label}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <span>ผู้บันทึก _________________</span><span>(หัวหน้างาน)</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span>( _________________ )</span><span>(ระดับจัดการ)</span>
            </div>
            <div style={{ fontSize: 7, color: '#888', marginTop: 4 }}>คุณภูลยทารสคน ลาตธนสารสมบัติ</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 8, fontSize: 7, lineHeight: 1.7, color: '#666', borderTop: '0.5px solid #ccc', paddingTop: 4 }}>
        <strong>ระเบียบปฏิบัติ</strong><br/>
        1. หน่วยงานต้องบันทึกข้อมูลการทำงานล่วงเวลาภายใน 15.00 น. เพื่อส่งข้อมูลให้ฝ่าย HRM จัดรอรับล่า โดยฝ่าย HRM จะแจ้งสายรองภายใน 16.00 น.<br/>
        2. ผู้ที่ทำงานล่วงเวลาต้องลายมือชื่อทั้งก่อนเริ่มงาน (ล.1) และหลังเวลาเลิกงาน (ล.2) โดยให้ส่งแบบฟอร์มนี้ที่ฝ่าย HRM ภายในเวลา 10.00 น. ของวันอังคารไป<br/>
        * รายการขอ OT ข้ามวัน, ** รายการขอ OT ย้อนหลัง
      </div>
    </div>
  );
}

const Loader = () => (
  <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--muted)', fontSize: 13 }}>กำลังโหลด...</div>
);

const EmptyRow = ({ cols }) => (
  <tr><td colSpan={cols} style={{ textAlign: 'center', padding: '20px 0', color: 'var(--muted)', fontSize: 12 }}>ไม่มีข้อมูล</td></tr>
);

const Thumb = ({ src }) => (
  <img src={src || 'https://via.placeholder.com/40'} alt="" style={{ width: 38, height: 38, borderRadius: 8, objectFit: 'cover', border: '1px solid var(--border2)' }} />
);

const StatusBadge = ({ ok, label }) => (
  <span style={{
    display: 'inline-block', fontSize: 11, borderRadius: 4, padding: '1px 5px', marginRight: 3,
    background: ok ? 'rgba(34,197,94,0.15)' : 'rgba(231,76,60,0.15)',
    color: ok ? 'var(--green)' : 'var(--red)',
    border: `1px solid ${ok ? 'rgba(34,197,94,0.3)' : 'rgba(231,76,60,0.3)'}`,
  }}>{ok ? '✓' : '✗'} {label}</span>
);

const KpiSmall = ({ value, label }) => (
  <span style={{ fontWeight: 700, color: 'var(--green)' }}>
    {value}<span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 11 }}> {label}</span>
  </span>
);

/* ══════════════════════════════════════════════════════════════
   💰 SkillAllowanceTab — ใบสรุปค่าฝีมือ
   ══════════════════════════════════════════════════════════════ */
const THAI_MONTHS = ['', 'มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
  'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];

const SHIFT_DEFS = [
  { key: 'day',   label: '01' },
  { key: 'night', label: '02' },
];

function SkillAllowanceTab() {
  const { role, lineId: userLineId, sections: scopeSecs = [] } = useContext(UserContext);
  const canExport = can('report', 'export', role);
  const today = new Date();
  const [year,   setYear]   = useState(today.getFullYear());
  const [month,  setMonth]  = useState(today.getMonth() + 1);
  const [period, setPeriod] = useState(1); // 1=วันที่ 1-15, 2=วันที่ 16-31
  const [line,   setLine]   = useState('');
  const [section, setSection] = useState('');
  const [team,   setTeam]   = useState('');
  const [lines,     setLines]     = useState([]);
  const [skillDefs, setSkillDefs] = useState([]);
  const [rows,   setRows]   = useState([]); // [{emp, shifts:{day:{},night:{}}}]
  const [loading, setLoading] = useState(false);

  const workTypes = useMemo(() => [...new Set(skillDefs.filter(sd => sd.category === 'allowance_skill' && sd.allowance_type).map(sd => sd.allowance_type))].sort(), [skillDefs]);
  const [workType,   setWorkType]   = useState('');
  const [costCenter, setCostCenter] = useState('');
  const [rightsDay,   setRightsDay]   = useState('');
  const [rightsNight, setRightsNight] = useState('');
  const [signerHead,    setSignerHead]    = useState('');
  const [signerManager, setSignerManager] = useState('');
  const [signerTA,       setSignerTA]      = useState('');
  const [signerHRM,      setSignerHRM]     = useState('');

  useEffect(() => {
    supabase.from('production_lines').select('id, name, section, cost_center, head_name, parent_line_name').order('name')
      .then(({ data }) => setLines(data || []));
    supabase.from('skill_definitions').select('category, allowance_type').eq('category', 'allowance_skill')
      .then(({ data }) => setSkillDefs(data || []));
  }, []);

  // ดึง Cost Center และหัวหน้างาน จากไลน์ที่เลือกอัตโนมัติ (ยังแก้ไขเองได้ถ้าต้องการ)
  useEffect(() => {
    const lineObj = lines.find(l => l.name === line);
    setCostCenter(lineObj?.cost_center || '');
    setSignerHead(lineObj?.head_name || '');
  }, [line, lines]);

  // ดึงชื่อผู้อนุมัติ ประจำส่วนงานอัตโนมัติ (ยังแก้ไขเองได้ถ้าต้องการ)
  useEffect(() => {
    const lineObj = lines.find(l => l.name === line);
    const sec = lineObj?.section;
    if (!sec) {
      setSignerManager(''); setSignerTA(''); setSignerHRM('');
      return;
    }
    supabase.from('section_signers').select('*').eq('section', sec).maybeSingle()
      .then(({ data }) => {
        setSignerManager(data?.manager_name || '');
        setSignerTA(data?.ta_name || '');
        setSignerHRM(data?.hrm_name || '');
      });
  }, [line, lines]);

  // ช่วงวันตามงวด
  const periodDays = () => {
    const daysInMonth = new Date(year, month, 0).getDate();
    if (period === 1) return Array.from({ length: 15 }, (_, i) => i + 1);       // 1-15
    return Array.from({ length: daysInMonth - 15 }, (_, i) => i + 16);           // 16-end
  };

  // mandatory scope: null = ไม่จำกัด · leader → ครอบครัวไลน์ตัวเอง · role ที่ถูกจำกัด sections → ไลน์ในส่วนงานที่อยู่ใน scope
  const scopedLineNames = useMemo(() => {
    if (role === 'leader' && userLineId) {
      const myLine = lines.find(l => String(l.id) === String(userLineId));
      return myLine ? getLineFamilyNames(lines, myLine.name) : [];
    }
    if (scopeSecs.length) return lines.filter(l => inSectionScope(scopeSecs, l.section)).map(l => l.name);
    return null;
  }, [role, userLineId, scopeSecs, lines]);

  const load = async () => {
    setLoading(true);
    const days = periodDays();
    const startDate = `${year}-${String(month).padStart(2,'0')}-${String(days[0]).padStart(2,'0')}`;
    const endDate   = `${year}-${String(month).padStart(2,'0')}-${String(days[days.length-1]).padStart(2,'0')}`;

    // หา station ที่มี skill_allowance=true และตรงกับประเภทค่าฝีมือที่เลือก
    let stQ = supabase.from('workstations').select('id, station_name, line_name')
      .eq('skill_allowance', true)
      .eq('skill_allowance_type', workType);
    // mandatory scope ก่อน — จำกัดสถานีให้อยู่ในไลน์ที่ user ดูแลเท่านั้น (fail-closed ถ้า scope ว่าง)
    if (scopedLineNames) stQ = stQ.in('line_name', scopedLineNames.length ? scopedLineNames : ['__none__']);
    // เลือกไลน์ = ทั้งครอบครัวไลน์ (หลัก↔ย่อย) — สถานีค่าฝีมืออาจถูก set ไว้ที่ไลน์ย่อยของไลน์ที่เลือก
    if (line) {
      const fam = getLineFamilyNames(lines, line);
      stQ = stQ.in('line_name', fam.length ? fam : [line]);
    }
    const { data: stations } = await stQ;
    if (!stations?.length) { setRows([]); setLoading(false); return; }

    const stationIds = stations.map(s => String(s.id));

    // หาใบเซอร์ค่าฝีมือที่ผูกกับประเภทงานนี้ และพนักงานที่มีใบเซอร์นั้น (score > 0 = มี)
    const { data: certSkills } = await supabase
      .from('skill_definitions')
      .select('name')
      .eq('category', 'allowance_skill')
      .eq('allowance_type', workType);
    const certNames = (certSkills || []).map(s => s.name);

    let certifiedEmpIds = null; // null = ไม่มีใบเซอร์ผูกไว้ → ไม่กรอง (รองรับข้อมูลก่อนมีระบบใบเซอร์)
    if (certNames.length > 0) {
      const { data: certHolders } = await supabase
        .from('employee_skills')
        .select('employee_id')
        .in('skill_name', certNames)
        .gt('score', 0);
      certifiedEmpIds = new Set((certHolders || []).map(c => c.employee_id));
    }

    // logs ที่ qualify
    const { data: logs } = await supabase
      .from('daily_production_logs')
      .select('work_date, employee_id, assigned_line, shift, employees(employee_id_code, name, section, team)')
      .gte('work_date', startDate)
      .lte('work_date', endDate)
      .eq('is_present', true)
      .eq('has_helmet', true)
      .eq('has_boots', true)
      .eq('has_gloves', true)
      .in('assigned_line', stationIds)
      .limit(10000);

    // group by employee, แยกตามกะ (day=กะ01 / night=กะ02)
    const empMap = {};
    (logs || []).forEach(log => {
      const empId = log.employee_id;
      const day   = parseInt(log.work_date.split('-')[2]);
      const shift = log.shift === 'night' ? 'night' : 'day';
      if (!empMap[empId]) empMap[empId] = { emp: log.employees, shifts: { day: {}, night: {} } };
      empMap[empId].shifts[shift][day] = true;
    });

    const result = Object.entries(empMap)
      .filter(([empId]) => certifiedEmpIds === null || certifiedEmpIds.has(empId))
      .map(([, r]) => r)
      .filter(r => section ? r.emp?.section === section : true)
      .filter(r => team ? r.emp?.team === team : true)
      .sort((a, b) => (a.emp?.name || '').localeCompare(b.emp?.name || '', 'th'));

    setRows(result);
    setLoading(false);
  };

  const handlePrint = async () => {
    const days = periodDays();
    const dStr = `${days[0]}-${days[days.length-1]}`;
    const sectionLabel = section || (line ? `ไลน์ ${line}` : 'ทุกไลน์');
    const logoDataUrl = await getTsLogoDataUrl();

    // จำนวนแถวทั้งหมด เทียบกับความสูงที่ 1 หน้า A4 แนวนอนรับได้
    // ถ้าเกินไม่มาก (<=25%) ให้ย่อขนาดตัวอักษร/ระยะห่างเพื่อให้พอดี 1 หน้า
    // ถ้าเกินมากกว่า 25% ปล่อยให้ไหลไปหน้า 2 ตามธรรมชาติ (thead/tfoot จะพิมพ์ซ้ำทุกหน้า)
    const rowCount = rows.length * SHIFT_DEFS.length + SHIFT_DEFS.length;
    const baseRows = 30;
    let scale = 1;
    if (rowCount > baseRows) {
      const overflowRatio = rowCount / baseRows;
      scale = overflowRatio <= 1.25 ? baseRows / rowCount : 0.8;
    }
    const fz   = (px) => `${Math.round(px * scale * 10) / 10}px`;
    const padV = (px) => `${Math.round(px * scale * 10) / 10}px`;

    const totalCols = 9 + days.length;
    const fixedColPct = { no: 3, idCard: 7, name: 14, shift: 3, total: 4, sigEmp: 8, taCheck: 9, sigTA: 7, note: 6 };
    const dayColPct = (100 - Object.values(fixedColPct).reduce((a,b)=>a+b,0)) / days.length;

    const colgroup = `
      <col style="width:${fixedColPct.no}%"/>
      <col style="width:${fixedColPct.idCard}%"/>
      <col style="width:${fixedColPct.name}%"/>
      <col style="width:${fixedColPct.shift}%"/>
      ${days.map(() => `<col style="width:${dayColPct}%"/>`).join('')}
      <col style="width:${fixedColPct.total}%"/>
      <col style="width:${fixedColPct.sigEmp}%"/>
      <col style="width:${fixedColPct.taCheck}%"/>
      <col style="width:${fixedColPct.sigTA}%"/>
      <col style="width:${fixedColPct.note}%"/>`;

    const tableRows = rows.map((r, i) => SHIFT_DEFS.map((sd, si) => {
      const dayCells = days.map(d =>
        `<td style="text-align:center;border:1px solid #333;font-size:${fz(11)};padding:${padV(2)} 2px">${r.shifts[sd.key][d] ? '1' : ''}</td>`
      ).join('');
      const total = Object.keys(r.shifts[sd.key]).length;
      return `
        <tr>
          ${si === 0 ? `
          <td rowspan="2" style="text-align:center;border:1px solid #333;font-size:${fz(11)};padding:${padV(2)} 2px">${i+1}</td>
          <td rowspan="2" style="border:1px solid #333;white-space:nowrap;padding:${padV(2)} 4px;font-size:${fz(11)}">${r.emp?.employee_id_code || ''}</td>
          <td rowspan="2" style="border:1px solid #333;padding:${padV(2)} 4px;font-size:${fz(11)};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.emp?.name || ''}</td>` : ''}
          <td style="text-align:center;border:1px solid #333;font-size:${fz(11)};padding:${padV(2)} 2px">${sd.label}</td>
          ${dayCells}
          <td style="text-align:center;border:1px solid #333;font-weight:bold;font-size:${fz(11)};padding:${padV(2)} 2px">${total}</td>
          ${si === 0 ? `
          <td rowspan="2" style="border:1px solid #333"></td>
          <td rowspan="2" style="border:1px solid #333"></td>
          <td rowspan="2" style="border:1px solid #333"></td>
          <td rowspan="2" style="border:1px solid #333"></td>` : ''}
        </tr>`;
    }).join('')).join('');

    const sumRows = SHIFT_DEFS.map((sd, si) => {
      const daySumRow = days.map(d => {
        const cnt = rows.filter(r => r.shifts[sd.key][d]).length;
        return `<td style="text-align:center;border:1px solid #333;font-size:${fz(11)};padding:${padV(2)} 2px">${cnt || 0}</td>`;
      }).join('');
      const total = rows.reduce((s,r) => s + Object.keys(r.shifts[sd.key]).length, 0);
      return `
        <tr style="background:#f0f0f0;font-weight:bold">
          ${si === 0 ? `<td rowspan="2" colspan="3" style="text-align:center;border:1px solid #333;font-size:${fz(11)};padding:${padV(2)} 2px">รวม</td>` : ''}
          <td style="text-align:center;border:1px solid #333;font-size:${fz(11)};padding:${padV(2)} 2px">${sd.label}</td>
          ${daySumRow}
          <td style="text-align:center;border:1px solid #333;font-size:${fz(11)};padding:${padV(2)} 2px">${total}</td>
        </tr>`;
    }).join('');

    const headerBlock = `
      <div style="text-align:right;font-size:${fz(12)};margin-bottom:2px">ฟอร์ม 2</div>
      <table style="border:none;margin-bottom:${padV(6)};width:100%">
        <tr>
          <td style="border:1px solid #333;width:230px;padding:${padV(6)};vertical-align:middle">
            <div style="display:flex;align-items:center;gap:8px">
              <div style="width:${Math.round(44*scale)}px;flex-shrink:0">${logoDataUrl ? `<img src="${logoDataUrl}" style="width:${Math.round(40*scale)}px;height:auto"/>` : ''}</div>
              <div style="font-size:${fz(12)};font-weight:bold">บริษัทไทยซัมมิทโอโตโมทีฟ จำกัด</div>
            </div>
          </td>
          <td style="border:none;text-align:center">
            <div style="font-size:${fz(16)};font-weight:bold">ใบสรุปการปฏิบัติงานค่าฝีมือประเภท${workType}</div>
          </td>
        </tr>
      </table>
      <div style="margin-bottom:2px;text-align:center;font-size:${fz(13)}">ประจำงวด วันที่ ${dStr} เดือน ${THAI_MONTHS[month]} ปี ${year + 543}</div>
      <div style="margin-bottom:${padV(8)};text-align:center;font-size:${fz(13)}">ส่วนงาน ${sectionLabel} Cost Center ${costCenter}</div>
      <div style="margin-bottom:${padV(8)};font-size:${fz(12)};line-height:1.6">
        สิทธิ์ที่ได้รับ &nbsp; กะ 01 &nbsp;&nbsp; ${rightsDay || '   '} &nbsp;&nbsp; คน<br/>
        &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; กะ 02 &nbsp;&nbsp; ${rightsNight || '   '} &nbsp;&nbsp; คน
      </div>`;

    const footerBlock = `
      <div style="margin-top:${padV(10)};font-size:${fz(11)};line-height:1.6">
        <strong>หมายเหตุ :</strong><br/>
        1. วันที่ 1-15 จะจ่ายในงวดวันที่ 22 ของทุกเดือน<br/>
        2. วันที่ 16-31 จะจ่ายในงวดวันที่ 7 ของทุกเดือน<br/>
        3. กรณีใบ Certification ขาดอายุจะถูกระงับการจ่ายค่าฝีมือ<br/>
        4. พนักงานมีสิทธิ์ได้รับค่าฝีมือต้องปฏิบัติงานครบ 8 ชั่วโมง / วัน<br/>
        5. หลักเกณฑ์การจ่ายค่าฝีมือ ตามประกาศที่ SVP.051/2566
      </div>
      <table style="margin-top:${padV(16)};width:100%">
        <tr>
          ${[
            ['หัวหน้างาน', signerHead],
            ['ผู้จัดการต้นสังกัด', signerManager],
            ['เจ้าหน้าที่ TA', signerTA],
            ['ผู้จัดการส่วน HRM', signerHRM],
          ].map(([label, name]) => `
            <td style="border:1px solid #333;width:25%;text-align:center;padding:${padV(8)} 4px;vertical-align:bottom">
              <div style="font-size:${fz(11)};margin-bottom:2px">บันทึกโดย</div>
              <div style="border-bottom:1px dotted #333;height:${Math.round(24*scale)}px;margin-bottom:4px"></div>
              <div style="font-size:${fz(11)}">${name ? `(${name})` : '( &nbsp; )'}</div>
              <div style="font-size:${fz(10)};color:#555">${label}</div>
            </td>`).join('')}
        </tr>
      </table>`;

    const html = `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8"/>
<title>ใบสรุปค่าฝีมือ ${THAI_MONTHS[month]} ${year + 543}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Sarabun', sans-serif; font-size: ${fz(13)}; background: #fff; color: #000; }
  table.main { border-collapse: collapse; width: 100%; table-layout: fixed; }
  th { border: 1px solid #333; background: #f0f0f0; text-align: center; padding: ${padV(3)} 2px; font-size: ${fz(11)}; }
  @media print {
    @page { size: A4 landscape; margin: 6mm; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
<table class="main">
  <colgroup>${colgroup}</colgroup>
  <thead>
    <tr><th colspan="${totalCols}" style="border:none;background:#fff;padding:0;text-align:left">${headerBlock}</th></tr>
    <tr>
      <th rowspan="2">ลำดับ</th>
      <th rowspan="2">เลขที่บัตรพนักงาน</th>
      <th rowspan="2">ชื่อ - สกุล</th>
      <th rowspan="2">กะ</th>
      <th colspan="${days.length}">เดือน ${THAI_MONTHS[month]}</th>
      <th rowspan="2">รวม</th>
      <th rowspan="2">ลายเซ็นพนักงาน</th>
      <th rowspan="2">TA ตรวจสอบการทำงาน</th>
      <th rowspan="2">ลายเซ็น TA</th>
      <th rowspan="2">หมายเหตุ</th>
    </tr>
    <tr>
      ${days.map(d => `<th>${d}</th>`).join('')}
    </tr>
  </thead>
  <tfoot>
    <tr><td colspan="${totalCols}" style="border:none;padding:0">${footerBlock}</td></tr>
  </tfoot>
  <tbody>
    ${tableRows}
    ${sumRows}
  </tbody>
</table>
<script>window.onload = () => { window.print(); }</script>
</body>
</html>`;

    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
  };

  const days = periodDays();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Filters */}
      <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>ปี</div>
          <select value={year} onChange={e => setYear(Number(e.target.value))} style={{ padding: '6px 10px', borderRadius: 7, fontSize: 13 }}>
            {[today.getFullYear()-1, today.getFullYear(), today.getFullYear()+1].map(y => (
              <option key={y} value={y}>{y + 543}</option>
            ))}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>เดือน</div>
          <select value={month} onChange={e => setMonth(Number(e.target.value))} style={{ padding: '6px 10px', borderRadius: 7, fontSize: 13 }}>
            {THAI_MONTHS.slice(1).map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>งวด</div>
          <select value={period} onChange={e => setPeriod(Number(e.target.value))} style={{ padding: '6px 10px', borderRadius: 7, fontSize: 13 }}>
            <option value={1}>งวด 1 (วันที่ 1-15)</option>
            <option value={2}>งวด 2 (วันที่ 16-สิ้นเดือน)</option>
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>ไลน์ผลิต</div>
          <select value={line} onChange={e => setLine(e.target.value)} style={{ padding: '6px 10px', borderRadius: 7, fontSize: 13 }}>
            <option value="">ทุกไลน์</option>
            {(scopedLineNames ? lines.filter(l => scopedLineNames.includes(l.name)) : lines).map(l => <option key={l.name} value={l.name}>{l.name}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Team</div>
          <select value={team} onChange={e => setTeam(e.target.value)} style={{ padding: '6px 10px', borderRadius: 7, fontSize: 13 }}>
            <option value="">ทุก Team</option>
            <option value="A">Team A</option>
            <option value="B">Team B</option>
            <option value="C">Team C</option>
          </select>
        </div>
        <button onClick={load} disabled={loading}
          style={{ padding: '8px 20px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer', opacity: loading ? 0.6 : 1 }}>
          {loading ? 'กำลังโหลด...' : '🔍 ดึงข้อมูล'}
        </button>
        {rows.length > 0 && (
          <span style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic', alignSelf: 'center' }}>🖨️ กด Export ด้านล่างเพื่อพิมพ์</span>
        )}
        {rows.length > 0 && (
          <CsvBtn onClick={() => {
            const daysArr = periodDays();
            const csvRows = [];
            rows.forEach(r => {
              SHIFT_DEFS.forEach(sd => {
                csvRows.push([
                  r.emp?.employee_id_code || '',
                  r.emp?.name || '',
                  r.emp?.section || '',
                  r.emp?.team || '',
                  sd.label,
                  ...daysArr.map(d => r.shifts[sd.key][d] ? '1' : ''),
                  Object.keys(r.shifts[sd.key]).length,
                ]);
              });
            });
            downloadCSV(
              `skill_allowance_${year}_${String(month).padStart(2,'0')}_p${period}.csv`,
              ['รหัสพนักงาน', 'ชื่อ', 'ส่วนงาน', 'Team', 'กะ', ...daysArr.map(d => String(d)), 'รวมวัน'],
              csvRows
            );
          }} />
        )}
      </div>

      {/* รายละเอียดเอกสาร */}
      <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>ประเภทงาน</div>
          <select value={workType} onChange={e => setWorkType(e.target.value)} style={{ padding: '6px 10px', borderRadius: 7, fontSize: 13 }}>
            <option value="">— เลือกประเภท —</option>
            {workTypes.map(w => <option key={w} value={w}>{w}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Cost Center</div>
          <input value={costCenter} onChange={e => setCostCenter(e.target.value)} placeholder="เช่น 2140662201"
            style={{ padding: '6px 10px', borderRadius: 7, fontSize: 13, width: 130 }} />
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>สิทธิ์ที่ได้รับ กะ 01 (คน)</div>
          <input value={rightsDay} onChange={e => setRightsDay(e.target.value)} placeholder="-"
            style={{ padding: '6px 10px', borderRadius: 7, fontSize: 13, width: 70 }} />
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>สิทธิ์ที่ได้รับ กะ 02 (คน)</div>
          <input value={rightsNight} onChange={e => setRightsNight(e.target.value)} placeholder="-"
            style={{ padding: '6px 10px', borderRadius: 7, fontSize: 13, width: 70 }} />
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>บันทึกโดย (หัวหน้างาน)</div>
          <input value={signerHead} onChange={e => setSignerHead(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 7, fontSize: 13, width: 140 }} />
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>บันทึกโดย (ผู้จัดการต้นสังกัด)</div>
          <input value={signerManager} onChange={e => setSignerManager(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 7, fontSize: 13, width: 140 }} />
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>บันทึกโดย (เจ้าหน้าที่ TA)</div>
          <input value={signerTA} onChange={e => setSignerTA(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 7, fontSize: 13, width: 140 }} />
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>บันทึกโดย (ผู้จัดการส่วน HRM)</div>
          <input value={signerHRM} onChange={e => setSignerHRM(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 7, fontSize: 13, width: 140 }} />
        </div>
      </div>

      {/* Preview table */}
      {rows.length > 0 && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <div style={{ marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <span style={{ fontWeight: 700, fontSize: 15 }}>ใบสรุปค่าฝีมือ</span>
              <span style={{ color: 'var(--muted)', fontSize: 12, marginLeft: 10 }}>
                งวดวันที่ {days[0]}-{days[days.length-1]} {THAI_MONTHS[month]} {year + 543}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e', borderRadius: 6, padding: '3px 10px', fontSize: 12, fontWeight: 700 }}>
                {rows.length} คน
              </span>
              {canExport && (
                <button onClick={handlePrint} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: 'rgba(77,159,255,0.12)', color: '#4d9fff', border: '1px solid rgba(77,159,255,0.35)', display: 'flex', alignItems: 'center', gap: 5 }}>
                  🖨️ Export PDF
                </button>
              )}
            </div>
          </div>
          <table style={{ minWidth: 600, borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ border: '1px solid var(--border2)', padding: '4px 6px', background: 'var(--bg3)', whiteSpace: 'nowrap' }}>ลำดับ</th>
                <th style={{ border: '1px solid var(--border2)', padding: '4px 6px', background: 'var(--bg3)', whiteSpace: 'nowrap' }}>รหัส</th>
                <th style={{ border: '1px solid var(--border2)', padding: '4px 6px', background: 'var(--bg3)', minWidth: 120 }}>ชื่อ - สกุล</th>
                <th style={{ border: '1px solid var(--border2)', padding: '4px 6px', background: 'var(--bg3)' }}>กะ</th>
                {days.map(d => (
                  <th key={d} style={{ border: '1px solid var(--border2)', padding: '4px 3px', background: 'var(--bg3)', width: 24, textAlign: 'center', fontSize: 11 }}>{d}</th>
                ))}
                <th style={{ border: '1px solid var(--border2)', padding: '4px 6px', background: 'var(--bg3)', textAlign: 'center' }}>รวม</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => SHIFT_DEFS.map((sd, si) => (
                <tr key={`${i}-${sd.key}`}>
                  {si === 0 && <td rowSpan={2} style={{ border: '1px solid var(--border2)', padding: '3px 6px', textAlign: 'center' }}>{i+1}</td>}
                  {si === 0 && <td rowSpan={2} style={{ border: '1px solid var(--border2)', padding: '3px 6px', whiteSpace: 'nowrap' }}>{r.emp?.employee_id_code}</td>}
                  {si === 0 && <td rowSpan={2} style={{ border: '1px solid var(--border2)', padding: '3px 6px' }}>{r.emp?.name}</td>}
                  <td style={{ border: '1px solid var(--border2)', padding: '3px 6px', textAlign: 'center' }}>{sd.label}</td>
                  {days.map(d => (
                    <td key={d} style={{ border: '1px solid var(--border2)', textAlign: 'center', color: '#22c55e', fontWeight: 700 }}>
                      {r.shifts[sd.key][d] ? '1' : ''}
                    </td>
                  ))}
                  <td style={{ border: '1px solid var(--border2)', textAlign: 'center', fontWeight: 700, color: 'var(--accent)' }}>
                    {Object.keys(r.shifts[sd.key]).length}
                  </td>
                </tr>
              )))}
              {SHIFT_DEFS.map((sd, si) => (
                <tr key={`sum-${sd.key}`} style={{ background: 'var(--bg3)', fontWeight: 700 }}>
                  {si === 0 && <td rowSpan={2} colSpan={3} style={{ border: '1px solid var(--border2)', textAlign: 'center', padding: '3px 6px' }}>รวม</td>}
                  <td style={{ border: '1px solid var(--border2)', textAlign: 'center' }}>{sd.label}</td>
                  {days.map(d => (
                    <td key={d} style={{ border: '1px solid var(--border2)', textAlign: 'center', fontSize: 11 }}>
                      {rows.filter(r => r.shifts[sd.key][d]).length || ''}
                    </td>
                  ))}
                  <td style={{ border: '1px solid var(--border2)', textAlign: 'center' }}>
                    {rows.reduce((s,r) => s + Object.keys(r.shifts[sd.key]).length, 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!loading && rows.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
          เลือกเงื่อนไขและกด "ดึงข้อมูล" เพื่อแสดงข้อมูลค่าฝีมือ
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   📋 AttendanceFormTab — ใบบันทึกการมาทำงาน
   ══════════════════════════════════════════════════════════════ */
function AttendanceFormTab() {
  const { role, lineId: userLineId, sections: scopeSecs = [] } = useContext(UserContext);
  const canExport = can('report', 'export', role);
  const today   = new Date();
  const orgSectionList = useOrgSections();
  const orgDeptList    = useOrgDepts();
  const [year,    setYear]    = useState(today.getFullYear());
  const [month,   setMonth]   = useState(today.getMonth() + 1);
  const [period,  setPeriod]  = useState(2); // 1=1-15, 2=16-end
  const [line,    setLine]    = useState('');
  const [dept,    setDept]    = useState('');
  const [empDept, setEmpDept] = useState('');
  const [team,    setTeam]    = useState('');
  const [formNo,  setFormNo]  = useState('F-HR-001');
  const [lines,   setLines]   = useState([]);
  const [empRows, setEmpRows] = useState([]); // [{emp, byDay:{d:{present,ot,leave}}}]
  const [loading, setLoading] = useState(false);
  const [calLoaded, setCalLoaded] = useState(false);

  useEffect(() => {
    supabase.from('production_lines').select('id, name, section, parent_line_name').order('name')
      .then(({ data }) => setLines(data || []));
    loadCompanyCalendar().then(() => setCalLoaded(true));
  }, []);

  const periodDays = () => {
    const dim = new Date(year, month, 0).getDate();
    if (period === 1) return Array.from({ length: 15 }, (_, i) => i + 1);
    return Array.from({ length: dim - 15 }, (_, i) => i + 16);
  };

  const dayDateStr = (day) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  // ถือว่าเป็น "วันหยุด" (เน้นสี) เมื่อ company_calendar ระบุ ot15/ot2 หรือเป็นวันอาทิตย์ (กรณียังไม่ตั้งค่าปฏิทิน)
  const isSunday = (day) => {
    if (calLoaded) return getDayType(dayDateStr(day)) !== 'working';
    return new Date(year, month - 1, day).getDay() === 0;
  };

  // ชั่วโมง OT จริงต่อวัน (ไม่ใช่การนับจำนวนวัน)
  // - วันทำงานปกติ: คิดเฉพาะช่วงเลย OT ต่อจากเวลางานปกติ — กะดึก 2 ชม. เสมอ, กะเช้า 2 ชม. (+3 ถ้ามี extended OT = 5)
  // - วันหยุด (company_calendar = ot15/ot2): มาทำงานทั้งวัน = OT ทั้งกะ 8 ชม. (หรือ 10.5 ชม. ถ้าทำ extended OT ต่อ)
  const otHoursForDay = (info, day) => {
    if (!info) return 0;
    const holiday = calLoaded && getDayType(dayDateStr(day)) !== 'working';
    if (holiday) {
      if (!info.present) return 0;
      return info.extOt ? 10.5 : 8;
    }
    if (!info.ot) return 0;
    const isNight = info.shift === 'night';
    return isNight ? 2 : (info.extOt ? 5 : 2);
  };
  // ชั่วโมง OT รวมทั้งช่วง สำหรับพนักงาน 1 คน
  const sumOtHours = (r, daysArr) => daysArr.reduce((sum, d) => sum + otHoursForDay(r.byDay[d], d), 0);

  const load = async () => {
    setLoading(true);
    const days = periodDays();
    const pad = (n) => String(n).padStart(2, '0');
    const startDate = `${year}-${pad(month)}-${pad(days[0])}`;
    const endDate   = `${year}-${pad(month)}-${pad(days[days.length - 1])}`;

    // Step 1: get employees matching current filters from employees table (server-side)
    // เลือกไลน์ = ทั้งครอบครัวไลน์ (หลัก↔ย่อย) — พนักงานอาจผูกกับไลน์หลักแต่ทำงานไลน์ย่อย หรือกลับกัน
    const familyIds = line ? [...getLineFamilyIds(lines, line)] : [];
    let empQ = supabase.from('employees')
      .select('id, name, employee_id_code, section, department, team, line_id');
    // mandatory scope ก่อน (leader → ไลน์ตัวเอง, role ที่ถูกจำกัด sections → เฉพาะส่วนงานใน scope) แล้วค่อย filter อิสระทับ
    if (role === 'leader' && userLineId) empQ = empQ.eq('line_id', userLineId);
    else if (scopeSecs.length)           empQ = empQ.in('section', scopeSecs);
    if (line && familyIds.length) empQ = empQ.in('line_id', familyIds);
    if (dept)           empQ = empQ.eq('section', dept);
    if (empDept)        empQ = empQ.eq('department', empDept);
    if (team)           empQ = empQ.eq('team', team);
    const { data: filteredEmps } = await empQ;
    if (!filteredEmps?.length) { setEmpRows([]); setLoading(false); return; }

    const empMetaById = Object.fromEntries((filteredEmps || []).map(e => [e.id, e]));
    const empIds = filteredEmps.map(e => e.id);

    // Step 2: fetch logs in batches of 50 (50 emps × 15 days = 750 rows, safe under 1000 limit)
    const BATCH = 50;
    const allLogs = [];
    for (let i = 0; i < empIds.length; i += BATCH) {
      const { data: batchLogs } = await supabase
        .from('daily_production_logs')
        .select('work_date, employee_id, is_present, has_ot, has_extended_ot, shift, leave_type, leave_duration, leave_period')
        .gte('work_date', startDate)
        .lte('work_date', endDate)
        .in('employee_id', empIds.slice(i, i + BATCH));
      allLogs.push(...(batchLogs || []));
    }

    const empMap = {};
    allLogs.forEach(log => {
      const id  = log.employee_id;
      const emp = empMetaById[id];
      if (!emp) return;
      const day = parseInt(log.work_date.split('-')[2]);
      if (!empMap[id]) empMap[id] = { emp, byDay: {} };
      empMap[id].byDay[day] = {
        present:     log.is_present,
        ot:          log.has_ot,
        extOt:       log.has_extended_ot,
        shift:       log.shift || 'day',
        leave:       log.leave_type || null,
        leaveDur:    log.leave_duration || null,
        leavePeriod: log.leave_period || null,
      };
    });

    const result = Object.values(empMap)
      .sort((a, b) => (a.emp.name || '').localeCompare(b.emp.name || '', 'th'));
    setEmpRows(result);
    setLoading(false);
  };

  const handlePrint = async () => {
    const days    = periodDays();
    const dStr    = `${days[0]}-${days[days.length-1]}`;
    const deptLabel = dept || line || 'ทุกแผนก';
    const totalEmp  = empRows.length;

    const { data: { user } } = await supabase.auth.getUser();
    const { data: prof } = await supabase.from('profiles').select('signature_url').eq('id', user.id).single();
    const sigDataUrl = prof?.signature_url ? await urlToDataUrl(prof.signature_url) : null;
    const logoDataUrl = await getTsLogoDataUrl();

    const thStyle = 'border:1px solid #000;background:#e8e8e8;text-align:center;font-size:8px;padding:1px 0;';
    const tdStyle = 'border:1px solid #000;text-align:center;font-size:9px;padding:0;height:14px;';
    const tdOTStyle = 'border:1px solid #000;text-align:center;font-size:8px;padding:0;height:12px;';

    const leaveCode = {'ลากิจ':'ก', 'ลาป่วย':'ป', 'ลาพักร้อน':'พ'};
    const slash = `<span style="font-size:12px;line-height:1">╱</span>`;

    // ช = first 4 hrs  (day 08:00-12:00 / night 22:30-02:30)
    // บ = second 4 hrs (day 13:00-17:30 / night 03:30-08:00)
    // อ = OT           (day 18:00-20:00 / night 20:00-22:00)
    //
    // leave_period: 'morning' = took leave in morning half (ช missing)
    //               'afternoon' = took leave in afternoon half (บ missing)
    //               null = full day leave or full day present
    const makeDayRow1 = (d, r) => {
      const sun  = isSunday(d);
      const sunBg = sun ? 'background:#fff8d0;' : '';
      const info  = r.byDay[d];
      if (!info) return `<td style="${tdStyle}${sunBg}"></td><td style="${tdStyle}${sunBg}"></td><td style="${tdStyle}${sunBg}"></td>`;

      const lc = info.leave ? (leaveCode[info.leave] || info.leave) : null;
      const leaveMark = lc ? `<span style="font-size:8px;color:#b00;font-weight:bold">${lc}</span>` : '';

      let markCh = '', markB = '', markO = '';

      if (info.present) {
        // Full present — both halves get slash
        // If half-day leave, one half gets leave code instead
        if (info.leave && info.leaveDur <= 0.5) {
          if (info.leavePeriod === 'morning') {
            markCh = leaveMark;   // morning half: on leave
            markB  = slash;       // afternoon half: worked
          } else if (info.leavePeriod === 'afternoon') {
            markCh = slash;       // morning half: worked
            markB  = leaveMark;   // afternoon half: on leave
          } else {
            markCh = slash; markB = slash;
          }
        } else {
          markCh = slash; markB = slash;
        }
      } else if (info.leave) {
        // Full-day absence with leave code
        markCh = leaveMark; markB = leaveMark;
      }
      // OT mark
      if (info.ot) markO = slash;

      return `<td style="${tdStyle}${sunBg}">${markCh}</td><td style="${tdStyle}${sunBg}">${markB}</td><td style="${tdStyle}${sunBg}">${markO}</td>`;
    };

    // Row 2: show actual OT hours (otHoursForDay — กะดึก 2 ชม. เสมอ / กะเช้า 2 ชม. หรือ 5 ชม.ถ้ามี extended OT)
    const makeDayRow2 = (d, r) => {
      const sun   = isSunday(d);
      const sunBg = sun ? 'background:#fff8d0;' : '';
      const info  = r.byDay[d];
      const hrs   = otHoursForDay(info, d);
      return `<td style="${tdOTStyle}${sunBg}"></td><td style="${tdOTStyle}${sunBg}"></td><td style="${tdOTStyle}${sunBg}">${hrs > 0 ? hrs : ''}</td>`;
    };

    const dayHeaderRow1 = days.map(d => {
      const sun = isSunday(d);
      const bg = sun ? 'background:#f5c842;' : '';
      return `<th colspan="3" style="${thStyle}${bg}">${d}</th>`;
    }).join('');

    const dayHeaderRow2 = days.map(d => {
      const sun = isSunday(d);
      const bg = sun ? 'background:#fff8d0;' : '';
      return `<th style="${thStyle}${bg}width:7px">ช</th><th style="${thStyle}${bg}width:7px">บ</th><th style="${thStyle}${bg}width:7px">อ</th>`;
    }).join('');

    const dayCols = days.map(() => `<col style="width:7px"/><col style="width:7px"/><col style="width:7px"/>`).join('');

    const empHtml = empRows.map((r, i) => {
      const cntSick     = days.filter(d => r.byDay[d]?.leave === 'ลาป่วย').length;
      const cntPersonal = days.filter(d => r.byDay[d]?.leave === 'ลากิจ').length;
      const cntVacation = days.filter(d => r.byDay[d]?.leave === 'ลาพักร้อน').length;
      const cntAbsent   = days.filter(d => { const b=r.byDay[d]; return b && !b.present && !b.leave; }).length;
      const totalOTHrs = sumOtHours(r, days);
      const fmt = v => v > 0 ? String(v) : '';

      return `
        <tr>
          <td rowspan="2" style="border:1px solid #000;text-align:center;font-size:9px;vertical-align:middle;padding:0">${i+1}</td>
          <td rowspan="2" style="border:1px solid #000;font-size:9px;padding:0 3px;vertical-align:middle">${r.emp.name || ''}</td>
          <td rowspan="2" style="border:1px solid #000;text-align:center;font-size:9px;padding:0;vertical-align:middle;white-space:nowrap">${r.emp.employee_id_code || ''}</td>
          ${days.map(d => makeDayRow1(d, r)).join('')}
          <td style="${tdStyle}">${fmt(0)}</td>
          <td style="${tdStyle}">${fmt(cntSick)}</td>
          <td style="${tdStyle}">${fmt(cntPersonal)}</td>
          <td style="${tdStyle}">${fmt(cntVacation)}</td>
          <td style="${tdStyle}">${fmt(0)}</td>
          <td style="${tdStyle}">${fmt(0)}</td>
          <td style="${tdStyle}">${fmt(cntAbsent)}</td>
          <td style="${tdStyle}">${fmt(0)}</td>
          <td style="${tdStyle}">${totalOTHrs > 0 ? totalOTHrs : ''}</td>
        </tr>
        <tr>
          <td colspan="3" style="border:1px solid #000;font-size:8px;text-align:left;padding:0 3px;height:12px">→ จำนวน ช.ม ที่ทำ OT</td>
          ${days.slice(1).map(d => makeDayRow2(d, r)).join('')}
          <td style="${tdOTStyle}">${totalOTHrs > 0 ? totalOTHrs : ''}</td>
          <td style="${tdOTStyle}"></td>
          <td style="${tdOTStyle}"></td>
          <td style="${tdOTStyle}"></td>
          <td style="${tdOTStyle}"></td>
          <td style="${tdOTStyle}"></td>
          <td style="${tdOTStyle}"></td>
          <td style="${tdOTStyle}"></td>
          <td style="${tdOTStyle}"></td>
        </tr>`;
    }).join('');

    const formNoStr = formNo || '';
    const html = `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8"/>
<title>ใบบันทึกการมาทำงาน ${THAI_MONTHS[month]} ${year+543}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Sarabun',sans-serif;font-size:10px;background:#fff;color:#000}
  table{border-collapse:collapse;width:100%}
  @media print{@page{size:A3 landscape;margin:5mm}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>
</head>
<body style="padding:5mm">

<!-- HEADER TABLE -->
<table style="width:100%;border-collapse:collapse;margin-bottom:3px">
  <tr>
    <td style="width:60px;vertical-align:middle;padding:2px 4px;text-align:center">
      ${logoDataUrl ? `<img src="${logoDataUrl}" style="width:42px;height:auto;display:block;margin:0 auto"/>` : ''}
    </td>
    <td style="vertical-align:middle;padding:2px 8px">
      <div style="font-size:11px;font-weight:bold;text-align:center">บริษัท ไทยซัมมิท โอโตโมทีฟ จำกัด</div>
      <div style="font-size:10px;font-weight:bold;text-align:center;margin-top:2px">ใบบันทึกการมาทำงาน - การหยุดงานของพนักงาน</div>
      <div style="font-size:10px;text-align:center;margin-top:2px">${deptLabel}</div>
    </td>
    <td style="width:48%;vertical-align:top;padding:0">
      <table style="width:100%;border-collapse:collapse;font-size:9px">
        <tr>
          <td colspan="3" style="border:1px solid #000;padding:1px 6px;text-align:right;font-size:8px;font-weight:bold">
            เลขที่เอกสาร: ${formNoStr}
          </td>
        </tr>
        <tr>
          <td style="border:1px solid #000;padding:2px 6px;text-align:center">เดือน ${THAI_MONTHS[month]} ${year+543}</td>
          <td style="border:1px solid #000;padding:2px 6px;text-align:center">งวด วันที่ ${dStr}</td>
          <td style="border:1px solid #000;padding:2px 6px;text-align:center">จำนวนพนักงาน <b>${totalEmp}</b> คน</td>
        </tr>
        <tr>
          <td style="border:1px solid #000;height:52px;text-align:center;vertical-align:bottom;padding-bottom:2px;font-size:7px">
            ${sigDataUrl ? `<img src="${sigDataUrl}" style="max-height:36px;max-width:70px;object-fit:contain;display:block;margin:0 auto 2px"/>` : '<div style="height:36px"></div>'}
            หัวหน้าแผนก
          </td>
          <td style="border:1px solid #000;height:52px;text-align:center;vertical-align:bottom;padding-bottom:2px;font-size:7px">หัวหน้าส่วน</td>
          <td style="border:1px solid #000;height:52px;text-align:center;vertical-align:bottom;padding-bottom:2px;font-size:7px">ผู้จัดการ</td>
        </tr>
      </table>
    </td>
  </tr>
</table>

<!-- MAIN TABLE -->
<table style="width:100%;border-collapse:collapse;table-layout:fixed">
  <colgroup>
    <col style="width:16px"/>
    <col style="width:88px"/>
    <col style="width:52px"/>
    ${dayCols}
    <col style="width:13px"/>
    <col style="width:13px"/>
    <col style="width:13px"/>
    <col style="width:14px"/>
    <col style="width:14px"/>
    <col style="width:14px"/>
    <col style="width:13px"/>
    <col style="width:14px"/>
    <col style="width:16px"/>
  </colgroup>
  <thead>
    <tr>
      <th rowspan="2" style="${thStyle}">ลำดับ</th>
      <th rowspan="2" style="${thStyle}">ชื่อ - สกุล</th>
      <th rowspan="2" style="${thStyle}">เลขที่บัตร</th>
      ${dayHeaderRow1}
      <th rowspan="2" style="${thStyle}width:13px">ส</th>
      <th rowspan="2" style="${thStyle}width:13px">ป</th>
      <th rowspan="2" style="${thStyle}width:13px">ก</th>
      <th rowspan="2" style="${thStyle}width:14px">พ</th>
      <th rowspan="2" style="${thStyle}width:14px">กธ</th>
      <th rowspan="2" style="${thStyle}width:14px">บ</th>
      <th rowspan="2" style="${thStyle}width:13px">ข</th>
      <th rowspan="2" style="${thStyle}width:14px">พง</th>
      <th rowspan="2" style="${thStyle}width:16px">OT</th>
    </tr>
    <tr>
      ${dayHeaderRow2}
    </tr>
  </thead>
  <tbody>
    ${empHtml}
  </tbody>
</table>

<!-- FOOTER -->
<div style="margin-top:4px;font-size:8px;line-height:1.7;border-top:1px solid #666;padding-top:3px">
  หมายเหตุ * ส=มาสาย &nbsp; ป=ลาป่วย &nbsp; ก=ลากิจ &nbsp; พ=พักผ่อนประจำปี &nbsp; กธ=ลากิจธุระอันจำเป็น &nbsp; บ=ลาอุปสมบท &nbsp; ข=ขาดงาน &nbsp; พง=พักงาน<br/>
  * ช = ช่วงเช้า, บ = ช่วงบ่าย, อ = ช่วงโอที, มด = ไม่มา Meeting<br/>
  * ลา 2 ชั่วโมง = 0.2, ลาครึ่งวัน = 0.5
</div>

<script>window.onload = () => window.print();</script>
</body></html>`;

    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
  };

  const days = periodDays();
  // dropdown ไลน์/ส่วนงาน เหลือเฉพาะใน scope เท่านั้น
  const attLinesInScope = (role === 'leader' && userLineId)
    ? lines.filter(l => String(l.id) === String(userLineId))
    : scopeSecs.length ? lines.filter(l => inSectionScope(scopeSecs, l.section)) : lines;
  const attAllSections = orgSectionList.length ? orgSectionList : [...new Set(lines.map(l => l.section).filter(Boolean))].sort();
  const attSections = (role === 'leader' && userLineId)
    ? [...new Set(attLinesInScope.map(l => l.section).filter(Boolean))].sort()
    : scopeSecs.length ? attAllSections.filter(s => inSectionScope(scopeSecs, s)) : attAllSections;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Filters */}
      <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>ปี</div>
          <select value={year} onChange={e => setYear(Number(e.target.value))} style={{ padding: '6px 10px', borderRadius: 7, fontSize: 13 }}>
            {[today.getFullYear()-1, today.getFullYear(), today.getFullYear()+1].map(y => (
              <option key={y} value={y}>{y+543}</option>
            ))}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>เดือน</div>
          <select value={month} onChange={e => setMonth(Number(e.target.value))} style={{ padding: '6px 10px', borderRadius: 7, fontSize: 13 }}>
            {THAI_MONTHS.slice(1).map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>งวด</div>
          <select value={period} onChange={e => setPeriod(Number(e.target.value))} style={{ padding: '6px 10px', borderRadius: 7, fontSize: 13 }}>
            <option value={1}>งวด 1 (วันที่ 1-15)</option>
            <option value={2}>งวด 2 (วันที่ 16-สิ้นเดือน)</option>
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>ไลน์</div>
          <select value={line} onChange={e => setLine(e.target.value)} style={{ padding: '6px 10px', borderRadius: 7, fontSize: 13 }}>
            <option value="">ทุกไลน์</option>
            {attLinesInScope.map(l => <option key={l.name} value={l.name}>{l.name}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>ส่วนงาน</div>
          <select value={dept} onChange={e => setDept(e.target.value)} style={{ padding: '6px 10px', borderRadius: 7, fontSize: 13 }}>
            <option value="">ทุกส่วนงาน</option>
            {attSections.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>แผนก</div>
          <select value={empDept} onChange={e => setEmpDept(e.target.value)} style={{ padding: '6px 10px', borderRadius: 7, fontSize: 13 }}>
            <option value="">ทุกแผนก</option>
            {orgDeptList.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Team</div>
          <select value={team} onChange={e => setTeam(e.target.value)} style={{ padding: '6px 10px', borderRadius: 7, fontSize: 13 }}>
            <option value="">ทุก Team</option>
            <option value="A">Team A</option>
            <option value="B">Team B</option>
            <option value="C">Team C</option>
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>เลขที่เอกสาร</div>
          <input
            type="text"
            value={formNo}
            onChange={e => setFormNo(e.target.value)}
            placeholder="เช่น F-HR-001"
            style={{ padding: '6px 10px', borderRadius: 7, fontSize: 13, width: 110 }}
          />
        </div>
        <button onClick={load} disabled={loading}
          style={{ padding: '8px 20px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer', opacity: loading ? 0.6 : 1 }}>
          {loading ? 'กำลังโหลด...' : '🔍 ดึงข้อมูล'}
        </button>
        {empRows.length > 0 && (
          <span style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic', alignSelf: 'center' }}>🖨️ กด Export ด้านล่างเพื่อพิมพ์</span>
        )}
        {empRows.length > 0 && (
          <CsvBtn onClick={() => {
            const daysArr = periodDays();
            downloadCSV(
              `attendance_${year}_${String(month).padStart(2,'0')}_p${period}.csv`,
              ['รหัสพนักงาน', 'ชื่อ', 'ส่วนงาน', 'Team', ...daysArr.map(d => isSunday(d) ? `${d}(หยุด)` : String(d)), 'รวมวัน', 'OT (ชม.)'],
              empRows.map(r => {
                const totalP  = daysArr.filter(d => r.byDay[d]?.present).length;
                const totalOT = sumOtHours(r, daysArr);
                return [
                  r.emp.employee_id_code || '',
                  r.emp.name || '',
                  r.emp.section || '',
                  r.emp.team || '',
                  ...daysArr.map(d => {
                    const info = r.byDay[d];
                    if (!info) return '';
                    if (info.leave) return info.leave;
                    return info.present ? '✓' : 'ข';
                  }),
                  totalP,
                  totalOT || '',
                ];
              })
            );
          }} />
        )}
      </div>

      {/* Preview */}
      {empRows.length > 0 && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <div style={{ marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontWeight: 700 }}>ใบบันทึกการมาทำงาน</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                งวดวันที่ {days[0]}-{days[days.length-1]} {THAI_MONTHS[month]} {year+543} · {empRows.length} คน
              </span>
              {canExport && (
                <button onClick={handlePrint} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: 'rgba(77,159,255,0.12)', color: '#4d9fff', border: '1px solid rgba(77,159,255,0.35)', display: 'flex', alignItems: 'center', gap: 5 }}>
                  🖨️ Export PDF
                </button>
              )}
            </div>
          </div>
          <table style={{ borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr>
                <th style={{ border: '1px solid var(--border2)', padding: '4px 6px', background: 'var(--bg3)', whiteSpace: 'nowrap' }}>#</th>
                <th style={{ border: '1px solid var(--border2)', padding: '4px 6px', background: 'var(--bg3)', minWidth: 100 }}>ชื่อ - สกุล</th>
                <th style={{ border: '1px solid var(--border2)', padding: '4px 6px', background: 'var(--bg3)' }}>รหัส</th>
                {days.map(d => (
                  <th key={d} style={{ border: '1px solid var(--border2)', padding: '4px 3px', background: isSunday(d) ? 'rgba(245,200,50,0.35)' : 'var(--bg3)', width: 22, textAlign: 'center', fontSize: 11 }}>{d}</th>
                ))}
                <th style={{ border: '1px solid var(--border2)', padding: '4px 6px', background: 'var(--bg3)', textAlign: 'center' }}>รวม</th>
                <th style={{ border: '1px solid var(--border2)', padding: '4px 6px', background: 'rgba(255,150,50,0.15)', textAlign: 'center', color: '#c05000' }}>OT (ชม.)</th>
              </tr>
            </thead>
            <tbody>
              {empRows.map((r, i) => {
                const totalP = days.filter(d => r.byDay[d]?.present).length;
                const totalOT = sumOtHours(r, days);
                return (
                  <tr key={i}>
                    <td style={{ border: '1px solid var(--border2)', textAlign: 'center', padding: '3px 4px' }}>{i+1}</td>
                    <td style={{ border: '1px solid var(--border2)', padding: '3px 6px', whiteSpace: 'nowrap' }}>{r.emp.name}</td>
                    <td style={{ border: '1px solid var(--border2)', padding: '3px 6px', whiteSpace: 'nowrap' }}>{r.emp.employee_id_code}</td>
                    {days.map(d => {
                      const info = r.byDay[d];
                      const sunBg = isSunday(d) ? 'rgba(245,200,50,0.2)' : 'transparent';
                      return (
                        <td key={d} style={{ border: '1px solid var(--border2)', textAlign: 'center', background: sunBg }}>
                          {info?.present ? <span style={{ color: '#22c55e', fontWeight: 700 }}>✓</span>
                            : info?.leave ? <span style={{ color: '#f59e0b', fontSize: 11 }}>{info.leave}</span>
                            : ''}
                          {info?.ot ? <span style={{ color: '#c05000', fontSize: 11, display: 'block' }}>OT</span> : ''}
                        </td>
                      );
                    })}
                    <td style={{ border: '1px solid var(--border2)', textAlign: 'center', fontWeight: 700, color: '#22c55e' }}>{totalP}</td>
                    <td style={{ border: '1px solid var(--border2)', textAlign: 'center', fontWeight: 700, color: '#c05000' }}>{totalOT || ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!loading && empRows.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
          เลือกเงื่อนไขและกด "ดึงข้อมูล" เพื่อแสดงใบบันทึกการมาทำงาน
        </div>
      )}
    </div>
  );
}
