/* ═══════════════════════════════════════════════════════════════════════════
   🧭 3 ระดับการบำรุงรักษา — Preventive → Predictive → Prescriptive  (แท็บใน /pm · 2026-09-23)

   คำสั่ง user: "เรื่อง preventive - predictive - prescriptive maintenance" → เลือก "ทำจอ 3 ระดับ"
   ใครใช้: หัวหน้าช่าง / MTN / planner — เปิดเช้าเพื่อดูว่า "วันนี้ควรทำ PM ตัวไหนก่อน เพราะอะไร"

   ① Preventive  = แผน PM บอกว่าถึงเวลาหรือยัง (pm_plans + checklists + ผลตรวจ — กติกาเดียวกับแท็บแผน PM)
   ② Predictive  = downtime จริงบอกว่าเครื่องกำลังแย่ลงไหม (30 วันล่าสุด เทียบ 60 วันก่อน ต่อชั่วโมงเดิน)
   ③ Prescriptive = ควรทำอะไร ภายในเมื่อไหร่ เพราะอะไร (กฎที่อ่านออก — RULES ใน utils/maintenanceLevels.js)

   ⚠️ อ่านอย่างเดียว — ไม่เขียน DB · ไม่เลื่อนแผนให้เอง (การตัดสินใจเป็นของช่าง) · ปุ่มทุกปุ่ม = พาไปหน้าที่ลงมือ
   ⚠️ สูตรทั้งหมดอยู่ใน `src/utils/maintenanceLevels.js` (+ `mtnMetrics.js` สำหรับ MTBF/MTTR) — ห้ามคิดเลขในไฟล์นี้
   ⚠️ หน้าต่างเวลาคงที่ 30+60 วัน (เป็นนิยามของการเทียบแนวโน้ม) ⇒ ไม่มี TimeRangeBar โดยตั้งใจ (UI §6.16)
   ⚠️ downtime 90 วัน > 8,000 แถว → fetchAllRows เท่านั้น (กับดัก 1000 แถว) · เลือกเฉพาะคอลัมน์ที่ใช้ (กฎ egress ข้อ 11)
   ⚠️ แท็บย่อยใช้ `?view=` ไม่ใช่ `?tab=` (หน้าแม่ /pm ใช้ ?tab= อยู่ — UI §6.8 ข้อ 2.4)
   ═══════════════════════════════════════════════════════════════════════════ */
import { useState, useEffect, useMemo, useContext, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from '../components/Toast';
import LineSelect from '../components/LineSelect';
import fetchAllRows from '../utils/fetchAllRows';
import useProductionLines from '../utils/useProductionLines';
import useTabParam from '../utils/useTabParam';
import { getLineFamilyNames } from '../utils/lineHierarchy';
import { inSectionScope } from '../utils/sectionScope';
import { getWorkDate } from '../utils/workDate';
import { EQUIPMENT_KINDS, KIND_META } from '../utils/equipmentKinds';
import { fmtDur } from '../utils/mtnMetrics';
import { STATUS_META } from '../lib/pmSchedule';
import {
  buildMaintenanceLevels, summarizeItems, actionsOf, splitWindows,
  PRIORITY, TREND_META, THRESH, WINDOW,
} from '../utils/maintenanceLevels';

const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 };
const inp = { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' };
const th = { padding: '9px 10px', textAlign: 'left', fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap', color: 'var(--muted)' };
const td = { padding: '8px 10px', fontSize: 12.5, borderTop: '1px solid var(--border)', verticalAlign: 'top' };
const PAGE = 60;

const KIND_CHIPS = [
  { key: 'all', icon: '📦', label: 'ทั้งหมด' },
  ...EQUIPMENT_KINDS.map(k => ({ key: k.key, icon: k.icon, label: k.label })),
  { key: '_unknown', icon: '❔', label: 'ไม่อยู่ในทะเบียน' },
];
const PV_EXTRA = { none: { label: 'ไม่มีแผน PM', color: '#9aa3a0' } };
const pvMeta = (s) => STATUS_META[s] || PV_EXTRA[s] || { label: s, color: '#9aa3a0' };

const fmtYmd = (ymd) => {
  if (!ymd) return '—';
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('th-TH', { timeZone: 'UTC', day: 'numeric', month: 'short' });
};
const fmtMs = (ms) => (ms ? new Date(ms).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short' }) : '—');
const n1 = (v) => (v == null ? '—' : Number(v).toLocaleString('th-TH', { maximumFractionDigits: 1 }));

function Chip({ color, children, title }) {
  return (
    <span title={title} style={{
      display: 'inline-block', padding: '2px 9px', borderRadius: 12, fontSize: 11.5, fontWeight: 800,
      color, border: `1px solid ${color}66`, background: `${color}1a`, whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

function Stat({ label, value, color, sub }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline', fontSize: 13 }}>
      <span style={{ color: 'var(--text2)' }}>{label}{sub && <span style={{ color: 'var(--muted)', fontSize: 11.5 }}> {sub}</span>}</span>
      <b style={{ fontSize: 16, color: color || 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{value}</b>
    </div>
  );
}

function LevelCard({ step, title, en, question, color, children, foot }) {
  return (
    <div style={{ ...card, borderTop: `4px solid ${color}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 26, height: 26, borderRadius: '50%', background: color, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 900, fontSize: 13, flexShrink: 0 }}>{step}</span>
        <div>
          <div style={{ fontWeight: 900, fontSize: 15, color: 'var(--text)' }}>{title}</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{en}</div>
        </div>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--text2)', fontStyle: 'italic' }}>“{question}”</div>
      <div style={{ display: 'grid', gap: 5 }}>{children}</div>
      {foot && <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.5, borderTop: '1px dashed var(--border)', paddingTop: 6, marginTop: 'auto' }}>{foot}</div>}
    </div>
  );
}

function EquipCell({ it }) {
  const k = it.kind && KIND_META[it.kind];
  return (
    <div style={{ minWidth: 150 }}>
      <b style={{ color: 'var(--text)' }}>{k ? `${k.icon} ` : ''}{it.machineNo || '—'}</b>
      {!it.inMaster && <span style={{ marginLeft: 6 }}><Chip color="#9aa3a0" title="เลขที่คนกรอก ไม่ตรงกับทะเบียนเครื่อง — แก้ที่ทะเบียน/สอนการกรอก">นอกทะเบียน</Chip></span>}
      <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{[it.machineName, it.lineName].filter(Boolean).join(' · ') || '—'}</div>
    </div>
  );
}

export default function MaintenanceLevels() {
  const { role, lineId, sections } = useContext(UserContext);
  const navigate = useNavigate();
  const lines = useProductionLines();
  const [view, setView] = useTabParam(['todo', 'equip'], 'todo', 'view');
  const [line, setLine] = useState('');
  const [kind, setKind] = useState('all');
  const [prio, setPrio] = useState(0);            // 0 = ทุกความด่วน
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [raw, setRaw] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  const todayStr = getWorkDate();

  /* โหลดทุกอย่างครั้งเดียว (ไม่ผูกกับตัวกรอง — กรองในเครื่อง) · guard `alive` กันคำตอบเก่าทับ (กฎ DB ข้อ 4) */
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setLoadErr('');
      const { baseFrom } = splitWindows({ todayStr });
      // ต้นวันทำงานแรก (08:00 ไทย) — ขอบล่างของ downtime · ขอบบนไม่ต้อง (ถึงปัจจุบัน)
      const sinceIso = new Date(`${baseFrom}T08:00:00+07:00`).toISOString();
      const res = await Promise.all([
        fetchAllRows(supabaseDR, 'machines', 'id, line_name, machine_no, machine_name, equipment_kind, is_active',
          qq => qq.eq('is_active', true).order('sort_order').order('id')),
        /* เฉพาะแถวที่ระบุเครื่อง — จอนี้เป็น "รายอุปกรณ์" (downtime ไม่ระบุเครื่องดูได้ที่ KPI ช่าง) */
        fetchAllRows(supabaseDR, 'downtime_logs',
          'id, session_id, machine_no, started_at, ended_at, duration_min, call_mtn_ack_at, fix_at, dr_downtime_types(name_th, category)',
          qq => qq.gte('started_at', sinceIso).not('machine_no', 'is', null).neq('machine_no', '').order('started_at').order('id')),
        fetchAllRows(supabaseDR, 'production_sessions', 'id, line_name, work_date, shift, shift_min, start_time, end_time',
          qq => qq.gte('work_date', baseFrom).lte('work_date', todayStr).order('work_date').order('id')),
        fetchAllRows(supabaseDR, 'break_policies', 'shift, process_type, start_time, duration_min, ot_scope',
          qq => qq.eq('is_active', true).order('start_time')),
        fetchAllRows(supabaseDR, 'checklists', 'id, equipment_id, frequency, name, department',
          qq => qq.eq('module', 'mtn').order('id')),
        fetchAllRows(supabaseDR, 'jigs', 'id, name, jig_no, machine_id, machine_no, line_name, equipment_type',
          qq => qq.order('id')),
        fetchAllRows(supabaseDR, 'pm_plans', 'id, checklist_id, plan_type, interval_days, next_due_date, last_done_at, deferred_to, deferred_at, is_active',
          qq => qq.eq('is_active', true).order('id')),
        fetchAllRows(supabaseDR, 'inspections', 'checklist_id, inspected_at',
          qq => qq.neq('approval_status', 'rejected').order('inspected_at', { ascending: false }).order('id')),
      ]);
      if (!alive) return;
      const NAMES = ['ทะเบียนเครื่อง', 'downtime', 'กะการผลิต', 'นโยบายพัก', 'ใบตรวจ PM', 'อุปกรณ์ PM', 'แผน PM', 'ผลตรวจ'];
      const errs = res.map((r, i) => (r.error ? NAMES[i] : null)).filter(Boolean);
      if (errs.length) {
        setLoadErr(`โหลดไม่สำเร็จ: ${errs.join(' · ')} — ตัวเลขบนจอไม่ครบ`);
        toast.error(`โหลดข้อมูลไม่ครบ: ${errs.join(' · ')}`);
      }
      const [mc, dt, ss, bp, cl, jg, pl, ins] = res.map(r => r.data || []);
      const lastInsp = {};
      for (const i of ins) if (!lastInsp[i.checklist_id]) lastInsp[i.checklist_id] = i.inspected_at;
      setRaw({ machines: mc, downtimes: dt, sessions: ss, breakPolicies: bp, checklists: cl, jigs: jg, plans: pl, lastInsp });
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [todayStr, reloadKey]);

  const lineFamilyOf = useCallback((n) => (lines.length ? getLineFamilyNames(lines, n) : [n]), [lines]);

  const built = useMemo(() => {
    if (!raw) return null;
    const sesLine = new Map(raw.sessions.map(s => [s.id, s.line_name]));
    return buildMaintenanceLevels({
      checklists: raw.checklists, jigs: raw.jigs, plans: raw.plans, lastInspByChecklist: raw.lastInsp,
      machines: raw.machines, downtimes: raw.downtimes, sessions: raw.sessions, breakPolicies: raw.breakPolicies,
      lineFamilyOf, sessionLineOf: (id) => sesLine.get(id) || '',
      todayStr, nowMs: Date.now(),
    });
  }, [raw, lineFamilyOf, todayStr]);

  /* ขอบเขตไลน์ — เกณฑ์เดียวกับ /mtn-analysis และ /mtn-repair (ต้องแก้พร้อมกันทั้ง 3 ที่) */
  const scopeLines = useMemo(() => {
    if (role === 'admin') return null;
    if (role === 'leader' && lineId) { const self = lines.find(l => String(l.id) === String(lineId)); return self ? new Set(getLineFamilyNames(lines, self.name)) : new Set(); }
    if (sections?.length) return new Set(lines.filter(l => inSectionScope(sections, l.section)).map(l => l.name));
    return null;
  }, [lines, role, lineId, sections]);
  const scopedLineObjs = useMemo(() => (scopeLines ? lines.filter(l => scopeLines.has(l.name)) : lines), [lines, scopeLines]);
  const famOfSel = useMemo(() => (line ? new Set(lineFamilyOf(line)) : null), [line, lineFamilyOf]);

  // กรองระดับอุปกรณ์ (ขอบเขต → ไลน์ → ชนิด → คำค้น) — การ์ดหัว 3 ระดับคิดจากชุดนี้
  const scoped = useMemo(() => {
    if (!built) return [];
    const kw = q.trim().toLowerCase();
    return built.items.filter(it => {
      if (scopeLines && it.lineName && !scopeLines.has(it.lineName)) return false;
      if (famOfSel && !(it.lineName && famOfSel.has(it.lineName))) return false;
      if (kind === '_unknown' && it.inMaster) return false;
      if (kind !== 'all' && kind !== '_unknown' && (!it.inMaster || (it.kind || 'machine') !== kind)) return false;
      if (kw && !`${it.machineNo} ${it.machineName} ${it.lineName}`.toLowerCase().includes(kw)) return false;
      return true;
    });
  }, [built, scopeLines, famOfSel, kind, q]);

  const sum = useMemo(() => summarizeItems(scoped), [scoped]);
  const acts = useMemo(() => actionsOf(scoped).filter(a => !prio || a.priority === prio), [scoped, prio]);
  const shownRows = view === 'todo' ? acts : scoped;

  useEffect(() => { setLimit(PAGE); }, [view, line, kind, prio, q]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>กำลังวิเคราะห์แผน PM + downtime 90 วัน…</div>;
  const cov = built?.coverage;

  return (
    <div style={{ padding: 'clamp(12px,3vw,24px)', display: 'grid', gap: 14, maxWidth: 'min(98vw, 2400px)', margin: '0 auto' }}>
      {loadErr && <div style={{ ...card, borderColor: '#ef4444', color: '#ef4444', fontSize: 13, fontWeight: 700 }}>⚠️ {loadErr}</div>}

      {/* ── บันได 3 ขั้น ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, alignContent: 'start' }}>
        <LevelCard step="1" title="Preventive — ป้องกันตามแผน" en="Time-based PM" color="#4a90e0"
          question="แผนบอกว่าถึงเวลาหรือยัง"
          foot={sum.preventive.failingNoPlan > 0
            ? `ช่องว่าง: ${sum.preventive.failingNoPlan} อุปกรณ์เสีย ≥${THRESH.minStops} ครั้ง/30 วัน แต่ยังไม่มีแผน PM ที่มีรอบ`
            : 'แผนที่เป็น "ตามรอบ" ไม่มีวันครบกำหนด = ระบบเตือนล่วงหน้าไม่ได้'}>
          <Stat label="มีแผน PM" value={sum.preventive.withPlan} sub={`(มีรอบจริง ${sum.preventive.withCycle})`} />
          <Stat label="เลยกำหนด" value={sum.preventive.overdue} color={sum.preventive.overdue ? '#ef4444' : undefined} />
          <Stat label="ใกล้ครบกำหนด" value={sum.preventive.dueSoon} color={sum.preventive.dueSoon ? '#f59a3f' : undefined} />
          <Stat label="มีรอบแต่ยังไม่เคยตรวจ" value={sum.preventive.never} />
        </LevelCard>

        <LevelCard step="2" title="Predictive — ดูจากข้อมูลจริง" en="Reliability-based (downtime)" color="#a855f7"
          question="เครื่องกำลังเสียบ่อยขึ้นไหม · จะเสียอีกเมื่อไหร่"
          foot={`เทียบ ${WINDOW.recentDays} วันล่าสุด (ตั้งแต่ ${fmtYmd(cov?.recentFrom)}) กับ ${WINDOW.baseDays} วันก่อนหน้า · ต่อชั่วโมงเดินเครื่องจริง (หักพักแล้ว)`}>
          <Stat label="วิเคราะห์ได้" value={sum.predictive.analysed} sub={sum.predictive.nodata ? `(ไม่รู้ชั่วโมงเดิน ${sum.predictive.nodata})` : ''} />
          <Stat label="แนวโน้มแย่ลง" value={sum.predictive.worse} color={sum.predictive.worse ? '#ef4444' : undefined} />
          <Stat label={`คาดเสียภายใน ${THRESH.soonDays} วัน`} value={sum.predictive.etaSoon} color={sum.predictive.etaSoon ? '#f59a3f' : undefined} />
          <Stat label="ดีขึ้น" value={sum.predictive.better} color={sum.predictive.better ? '#3dd65c' : undefined} />
          <Stat label="เวลาหยุดที่คาด 30 วันข้างหน้า" value={fmtDur(sum.predictive.riskMin30)} />
        </LevelCard>

        <LevelCard step="3" title="Prescriptive — บอกว่าควรทำอะไร" en="Recommended actions" color="#3dd65c"
          question="ควรทำอะไร ภายในเมื่อไหร่ เพราะอะไร"
          foot="กฎที่อ่านออกได้ ไม่ใช่ AI — ทุกข้อบอกเหตุผลเป็นตัวเลข · ระบบไม่เลื่อนแผนให้เอง ช่างเป็นคนตัดสิน">
          <Stat label="คำแนะนำทั้งหมด" value={sum.prescriptive.total} sub={`(${sum.prescriptive.equip} อุปกรณ์)`} />
          <Stat label={PRIORITY[1].label} value={sum.prescriptive.p1} color={sum.prescriptive.p1 ? PRIORITY[1].color : undefined} />
          <Stat label={PRIORITY[2].label} value={sum.prescriptive.p2} color={sum.prescriptive.p2 ? PRIORITY[2].color : undefined} />
          <Stat label={PRIORITY[3].label} value={sum.prescriptive.p3} color={sum.prescriptive.p3 ? PRIORITY[3].color : undefined} />
        </LevelCard>
      </div>

      {/* ── ตัวกรอง ── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          {[['todo', `🎯 สิ่งที่ควรทำ (${actionsOf(scoped).length})`], ['equip', `📋 รายอุปกรณ์ (${scoped.length})`]].map(([k, label]) => (
            <button key={k} onClick={() => setView(k)} style={{
              padding: '7px 14px', fontSize: 13, fontWeight: 800, cursor: 'pointer', border: 'none',
              background: view === k ? 'var(--accent)' : 'var(--bg3)', color: view === k ? '#fff' : 'var(--text2)',
            }}>{label}</button>
          ))}
        </div>
        <LineSelect lines={scopedLineObjs} value={line} onChange={setLine} placeholder="ทุกไลน์" style={{ ...inp, width: 200 }} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔎 ค้นเลขเครื่อง / ชื่อ / ไลน์"
          aria-label="ค้นหาอุปกรณ์" style={{ ...inp, width: 220 }} />
        <button onClick={() => setReloadKey(k => k + 1)} style={{ ...inp, width: 'auto', cursor: 'pointer', fontWeight: 700 }}>🔄 รีเฟรช</button>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {KIND_CHIPS.map(c => {
          const on = kind === c.key;
          return (
            <button key={c.key} onClick={() => setKind(c.key)} style={{
              padding: '5px 12px', borderRadius: 16, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              border: `1.5px solid ${on ? 'var(--accent)' : 'var(--border2)'}`,
              background: on ? 'var(--accent-dim)' : 'var(--bg3)', color: on ? 'var(--accent)' : 'var(--muted)',
            }}>{c.icon} {c.label}</button>
          );
        })}
        {view === 'todo' && [0, 1, 2, 3].map(p => {
          const on = prio === p;
          const c = p ? PRIORITY[p].color : 'var(--accent)';
          return (
            <button key={`p${p}`} onClick={() => setPrio(p)} style={{
              padding: '5px 12px', borderRadius: 16, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              border: `1.5px solid ${on ? c : 'var(--border2)'}`, background: on ? `${p ? c : '#3dd65c'}1a` : 'var(--bg3)',
              color: on ? c : 'var(--muted)', marginLeft: p === 0 ? 8 : 0,
            }}>{p ? PRIORITY[p].label : 'ทุกความด่วน'}</button>
          );
        })}
      </div>

      {/* ── ตาราง ── */}
      {!shownRows.length ? (
        <div style={{ ...card, textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: 30 }}>
          {view === 'todo' ? 'ไม่มีคำแนะนำในตัวกรองนี้ ✅' : 'ไม่มีอุปกรณ์ในตัวกรองนี้ (อุปกรณ์ที่ไม่มีแผน PM และไม่เคยเสียใน 90 วัน ไม่ขึ้นรายการ)'}
        </div>
      ) : view === 'todo' ? (
        <div className="table-sticky" style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead><tr style={{ background: 'var(--bg3)' }}>
              {['ความด่วน', 'อุปกรณ์', 'ควรทำ', 'เพราะอะไร (ข้อมูลจริง)', 'ภายใน', ''].map(h => <th key={h} style={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {acts.slice(0, limit).map(a => (
                <tr key={a.key}>
                  <td style={td}><Chip color={PRIORITY[a.priority].color} title={PRIORITY[a.priority].hint}>{PRIORITY[a.priority].label}</Chip></td>
                  <td style={td}><EquipCell it={a.item} /></td>
                  <td style={{ ...td, fontWeight: 800, color: 'var(--text)', minWidth: 160 }}>{a.action}</td>
                  <td style={{ ...td, color: 'var(--text2)', lineHeight: 1.55, minWidth: 280 }}>{a.why}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap', fontWeight: 700 }}>{a.byYmd === todayStr ? 'วันนี้' : fmtYmd(a.byYmd)}</td>
                  <td style={td}>
                    <button onClick={() => navigate(a.link)} style={{ background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '5px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      {a.linkLabel} →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="table-sticky" style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
            <thead><tr style={{ background: 'var(--bg3)' }}>
              {['อุปกรณ์', '① แผน PM', '② เสีย 30 วัน', 'ต่อ 100 ชม.เดิน', 'แนวโน้ม', 'MTBF', 'คาดเสียครั้งถัดไป', 'เวลาหยุดที่คาด 30 วัน', '③ คำแนะนำ'].map(h => <th key={h} style={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {scoped.slice(0, limit).map(it => {
                const pm = pvMeta(it.pv.status);
                const tr = TREND_META[it.pd.trend];
                const top = it.actions.length ? Math.min(...it.actions.map(a => a.priority)) : null;
                return (
                  <tr key={it.key}>
                    <td style={td}><EquipCell it={it} /></td>
                    <td style={td}>
                      <Chip color={pm.color}>{pm.label}</Chip>
                      {it.pv.dueYmd && <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3 }}>ครบ {fmtYmd(it.pv.dueYmd)}</div>}
                    </td>
                    <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>
                      <b>{it.pd.stopsR}</b> ครั้ง
                      <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>หยุด {fmtDur(it.pd.dtMinR)} · ช่วงก่อน {it.pd.stopsB} ครั้ง/60 วัน</div>
                    </td>
                    <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>
                      {n1(it.pd.rateR)}
                      <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>ก่อน {n1(it.pd.rateB)}</div>
                    </td>
                    <td style={td}><Chip color={tr.color}>{tr.icon} {tr.label}{it.pd.ratio != null && (it.pd.trend === 'worse' || it.pd.trend === 'better') ? ` ×${n1(it.pd.ratio)}` : ''}</Chip></td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      {fmtDur(it.pd.mtbfMin)}
                      {it.pd.mtbfDays != null && <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>≈ {n1(it.pd.mtbfDays)} วันปฏิทิน</div>}
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap', color: it.pd.etaDays != null && it.pd.etaDays <= THRESH.soonDays ? '#f59a3f' : 'var(--text)' }}>
                      {it.pd.etaMs == null ? <span style={{ color: 'var(--muted)' }}>—</span>
                        : <>{fmtMs(it.pd.etaMs)}<div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{it.pd.etaDays < 0 ? `เลยรอบเฉลี่ยมา ${-it.pd.etaDays} วัน` : `อีก ${it.pd.etaDays} วัน`}</div></>}
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDur(it.pd.riskMin30)}</td>
                    <td style={td}>
                      {top ? <Chip color={PRIORITY[top].color}>{it.actions.length} ข้อ · {PRIORITY[top].label}</Chip> : <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {shownRows.length > limit && (
        <button onClick={() => setLimit(l => l + PAGE)} style={{ ...inp, width: 'auto', justifySelf: 'center', cursor: 'pointer', fontWeight: 700 }}>
          แสดงอีก {Math.min(PAGE, shownRows.length - limit)} รายการ (เหลือ {shownRows.length - limit})
        </button>
      )}

      {/* ── วิธีคิด + ข้อจำกัดของข้อมูล (ห้ามถอด — กฎความซื่อสัตย์ของจอ) ── */}
      <div style={{ ...card, fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
        <b style={{ color: 'var(--text2)' }}>วิธีคิด</b> ·
        ① สถานะแผน PM ใช้กติกาเดียวกับแท็บ "แผน PM" ·
        ② นับ "เครื่องเสีย" จาก downtime ที่ระบุเครื่อง (ไม่นับหยุดตามแผน) หารด้วยชั่วโมงเดินเครื่องของไลน์ (หักพักตามนโยบายแล้ว) ·
        MTBF/MTTR สูตรเดียวกับแท็บ KPI ช่าง · MTTR นับจากไลน์หยุดถึงเดินต่อ (รวมเวลารอช่าง) ·
        "คาดเสียครั้งถัดไป" = เสียล่าสุด + MTBF เฉลี่ย — <b>เป็นค่าเฉลี่ย ไม่ใช่คำทำนายแม่นยำ</b> ·
        ③ แนวโน้มต้องเสีย ≥{THRESH.minStops} ครั้งจึงนับ (น้อยกว่านั้นอาจบังเอิญ)
        <br />
        <b style={{ color: 'var(--text2)' }}>ข้อจำกัดตอนนี้</b> ·
        แม่พิมพ์/จิ๊ก ใช้ชั่วโมงเดินของไลน์แทนเวลาที่ถูกใช้จริง (อัตราเสียต่ำกว่าจริง) ·
        ยังไม่มีผลวัดค่า SPC จากใบตรวจ ⇒ ยังทำ predictive จากสภาพเครื่อง (condition-based) ไม่ได้ ·
        {cov?.unmatched ? ` เลขเครื่องที่กรอกแต่ไม่อยู่ในทะเบียน ${cov.unmatched} เลข (ติดป้าย "นอกทะเบียน") ·` : ''}
        {cov?.unknownShifts ? ` กะที่หาชั่วโมงไม่ได้ ${cov.unknownShifts} กะ (ชั่วโมงเดินต่ำกว่าจริง) ·` : ''}
        {cov && !cov.hasBreakPolicy ? ' ⚠️ ไม่พบนโยบายเวลาพัก — ชั่วโมงเดินสูงกว่าจริง ·' : ''}
        {cov?.checklistNoEquip ? ` ใบตรวจ PM ที่หาอุปกรณ์ไม่เจอ ${cov.checklistNoEquip} ใบ ·` : ''}
        {' '}อุปกรณ์ที่ไม่มีแผน PM และไม่เสียเลยใน 90 วันไม่ขึ้นรายการ
      </div>
    </div>
  );
}
