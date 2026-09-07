import { useState, useEffect, useMemo, useCallback, useContext, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { usePerms } from '../utils/usePerms';
import { wavg, wLoad, sumDefectQty } from '../utils/oee';
import { orderTotal } from '../utils/pairTotals';
import { loadOpInfo, opInfoSync } from '../utils/opItems';
import { fetchByIds, fetchAllPages } from '../utils/fetchByIds';
import { scopedLineNames } from '../utils/sectionScope';
import { canAccessPage } from '../utils/permissions';
import usePolling from '../utils/usePolling';
import { RATE } from '../utils/refreshRates';
import useIsMobile from '../utils/useIsMobile';
import PageHeader from '../components/PageHeader';
import ReadOnlyNote from '../components/ReadOnlyNote';
import SafetyEventModal from '../components/SafetyEventModal';
import {
  ST, stMeta, worstStatus, statusVsTarget, statusVsBaseline,
  safetyKind, isInjury, safetyStatus, daysWithoutLti, ymd, dayAdd, dayAxis, sumByDay, avgOfDays,
} from '../utils/obeya';

/* ══ 📋 OBEYA — บอร์ด KPI ส่วนงาน · 2026-08-27 · จัดโครงตามบอร์ดจริง 2026-09-01 ═════
   แทนกระดาษ "OBEYA KPI monitoring" ที่แปะผนังห้องประชุมหน้างาน (คำสั่งนายใหญ่ผ่าน user)
   user เคาะ 3 ข้อ: ① แยกรายส่วนงาน ② ตัวไหนวิ่งทุกกะให้อัพเดทรายวัน ③ มีแกน Safety

   ═══ โครงจริงของบอร์ด (user ถ่ายรูป OBEYA HYDROFORM มาให้ 2026-09-01) ═══════════
     [Key Performance PD3] [LINE HYDROFORM 1&2] [LINE APRON ASSY & SUP APRON] [ENGNEER PD3]
      ตาราง KPI ส่วนงาน     cost 2140662101/102   cost 2140662201/202          แผน/กิจกรรม

   **คอลัมน์ = กลุ่มไลน์ (ไลน์แม่) + เลข cost center กำกับ** · แต่ละคอลัมน์มี 8 หัวข้อ
   เดียวกันเป๊ะพร้อมป้ายสถานะ G/Y/R → หน้านี้จึงเป็น "กริดคอลัมน์×8 แถว" ไม่ใช่การ์ด SQCDM
   (SQCDM ยังอยู่ แต่ย้ายลงล่างเป็น "ภาพรวมส่วนงาน" — เป็นของแถมที่กระดาษไม่มี)

   ═══ ทำไมเป็นหน้าใหม่ ไม่ใช่แท็บใน /dept-dashboard ═══════════════════════════
   `/dept-dashboard` แบ่งด้วย `?dept=` = **หน้าที่/ฝ่าย** (ผลิต·ซ่อมบำรุง·สโตร์·QA)
   แต่ Obeya แบ่งด้วย **ส่วนงาน (PD1..PD4)** และ *ข้ามฝ่ายโดยนิยาม* — บอร์ดใบเดียวมีทั้ง
   คุณภาพ(QA) · เครื่องหยุด(ซ่อมบำรุง) · คน(HR) · ความปลอดภัย → ยัดใต้ `?dept=production`
   จะผิดความหมายของแกนนั้นทันที · อีกอย่างคือมันเป็น "บอร์ดติดผนังห้อง" ที่ต้อง bookmark
   ต่อจอ (`?section=PD3`) เหมือน `/factory-map` · จึงแยกหน้าและอยู่หมวด "ภาพรวม"

   ═══ กฎที่ยึด ═══════════════════════════════════════════════════════════════
   • **อ่านอย่างเดียว** ยกเว้นปุ่มบันทึกเหตุการณ์ความปลอดภัย (ระบบยังไม่มีที่เก็บมาก่อน)
     ทุกการ์ดกดแล้วเด้งไป "หน้าที่ทำงานจริง" — ห้าม re-implement บอร์ด/กราฟของหน้าอื่นมาไว้ที่นี่
   • **สูตรห้ามเขียนเอง** — OEE ผ่าน wavg/wLoad · NG ผ่าน sumDefectQty('line') ·
     ยอดผลิตนับคู่ RH/LH + ยุบชั้น OP ผ่าน orderTotal · สถานะ/วันปลอดอุบัติเหตุผ่าน utils/obeya
   • **ไม่มีเป้า ≠ ผ่าน** — ตัวที่ยังไม่มีเป้าในระบบ เทียบ "ค่าเฉลี่ยตัวเอง 14 วัน" แล้ว
     เขียนบนการ์ดว่าเทียบกับอะไร (กฎ ③ ใน utils/obeya)
   • **โหลดไม่ครบต้องพูด** — ทุกคิวรีเช็ค error → แถบส้ม "ตัวเลขบางส่วนโหลดไม่ครบ"
     ห้ามแสดง 0 เหมือนไม่มีข้อมูลจริง (บทเรียน `.in()` ยาวเกินจน query ล้มเงียบ)
   • egress: usePolling(RATE.BOARD) — แท็บซ่อน = หยุดยิง DB · `.in()` ผ่าน fetchByIds เสมอ
   ═══════════════════════════════════════════════════════════════════════════ */

const TREND_DAYS = 14;
const DEFAULT_APQ = { a: 90, p: 90, q: 99 };   // ค่ามาตรฐานเมื่อกรุ๊ปยังไม่ตั้งเป้า (กฎ oee_targets)

/* ── 8 หัวข้อบนบอร์ดจริง (ถอดจากป้ายเหลืองในรูปที่ user ถ่ายมา) ────────────────────
   ⚠️ `name` ต้องตรงกับชื่อใน `kpi_catalog` ที่ seed ไว้ (migration 20260901_kpi_line_group · แถวปี 2026: 20260907_kpi_catalog_2026_rm_dloh)
      จับคู่แบบ normSearch → เปลี่ยนตัวพิมพ์/ช่องว่างในทะเบียนแล้วยังหาเจอ
   `auto` = ระบบคำนวณให้เอง อัพเดททุกวัน (ตอบข้อ ② ของ user)
   `auto: null` = ต้องกรอกที่ 📑 KPI รายเดือน — ระบบไม่มีข้อมูลตั้งต้น (ยอดขาย/ค่าโสหุ้ยจริง)
   ⚠️ ห้ามเดาค่าให้แถว manual — ไม่มีค่า = "ยังไม่กรอก" ไม่ใช่ 0 */
const ROWS_COMMON = [
  { key: 'inv',   name: 'Inventory Balance',     auto: null },
  { key: 'csat',  name: 'Customer Satisfaction', auto: null },
  { key: 'oee',   name: 'OEE',                   auto: 'oee',    unit: '%',   dir: 'up' },
  { key: 'ppm',   name: 'PPM',                   auto: 'ppm',    unit: 'PPM', dir: 'down' },
  { key: 'safe',  name: 'Safety',                auto: 'safety', unit: 'ครั้ง', dir: 'down' },
  { key: 'train', name: 'Training',              auto: null },
];
/* หมวด Financial เปลี่ยนโครงตามปี (user 2026-09-07: "ปีนี้จะมีเพิ่ม %RM เข้ามาเป็นข้อที่ 1 และ DL กับ OH จะรวมกันเป็นข้อเดียว"
   — รูปบอร์ด/ไฟล์ตัวอย่างที่ได้มาเป็นโครงปี 2024) · ชื่อเก่าในทะเบียนไม่ rename (ตัวตน KPI ข้ามปีต้องคงเดิม)
   แต่ปิดใช้งานไว้ · เปิดบอร์ดย้อนปี ≤ 2025 ยังได้แถว DL/OH แยกเหมือนกระดาษเดิม */
const ROWS_FIN_2026 = [
  { key: 'rm',    name: '%RM (Raw Material)',    auto: null },
  { key: 'dloh',  name: 'DL+OH (Direct Labor + Overhead)', auto: null },
];
const ROWS_FIN_LEGACY = [
  { key: 'dl',    name: 'Direct Labor',          auto: null },
  { key: 'oh',    name: 'Overhead',              auto: null },
];
export const boardRowsFor = year => [...(Number(year) >= 2026 ? ROWS_FIN_2026 : ROWS_FIN_LEGACY), ...ROWS_COMMON];
const normName = x => String(x ?? '').toLowerCase().replace(/[\s\-_./()]+/g, '');

/* วันงาน — ตัด 08:00 ตามกฎ Date/Time (ห้าม toISOString) */
function workDateNow() {
  const d = new Date();
  if (d.getHours() < 8) d.setDate(d.getDate() - 1);
  return ymd(d);
}
const nf = (v, d = 0) => (v == null || !Number.isFinite(Number(v)) ? '—'
  : Number(v).toLocaleString('en-US', { maximumFractionDigits: d }));

/* ── สปาร์คไลน์ 14 วัน (inline SVG — 6 การ์ด ลาก Recharts มาทุกใบไม่คุ้ม) ───────────
   แกนวันต่อเนื่องเสมอ · วันไม่มีข้อมูล = เว้นช่อง ห้ามข้ามวัน (กฎกราฟเทรนด์ทั้งระบบ) */
function Spark({ days, map, color, dir }) {
  const W = 240, H = 34, PAD = 3;
  const vals = days.map(d => (map?.[d] == null ? null : Number(map[d])));
  const nums = vals.filter(v => v != null && Number.isFinite(v));
  if (!nums.length) return <div style={{ height: H, fontSize: 10.5, color: 'var(--muted)', display: 'flex', alignItems: 'center' }}>ยังไม่มีข้อมูลใน {days.length} วันนี้</div>;
  const hi = Math.max(...nums, 0), lo = Math.min(...nums, 0);
  const span = (hi - lo) || 1;
  const step = W / days.length;
  const y = v => H - PAD - ((v - lo) / span) * (H - PAD * 2);
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block' }} aria-hidden>
      {vals.map((v, i) => (v == null ? null : (
        <rect key={i} x={i * step + 1} y={y(v)} width={Math.max(1.5, step - 2)}
          height={Math.max(1.5, H - PAD - y(v))} rx="1.5"
          fill={color} fillOpacity={i === vals.length - 1 ? 1 : 0.42} />
      )))}
    </svg>
  );
}

/* ── 1 เซลล์บนบอร์ด (1 หัวข้อ × 1 กลุ่มไลน์) ────────────────────────────────────
   หน้าตาตามกระดาษ: ป้ายสถานะกลม G/Y/R ซ้าย + ชื่อหัวข้อ + ตัวเลข
   ⚠️ ป้าย ⚡ บอกว่าระบบคำนวณให้ · ✍️ บอกว่าต้องมีคนกรอก — ห้ามทำให้ดูเหมือนกัน */
function BoardCell({ row, onOpen }) {
  const m = stMeta(row.st);
  const badge = row.st === ST.good ? 'G' : row.st === ST.warn ? 'Y' : row.st === ST.bad ? 'R' : '–';
  const val = row.value == null ? '—'
    : `${nf(row.value, row.key === 'ppm' ? 0 : 2)}${row.unit ? ` ${row.unit}` : ''}`;
  return (
    <div onClick={onOpen}
      style={{
        display: 'flex', gap: 8, alignItems: 'center', padding: '6px 8px', borderRadius: 8,
        background: 'var(--bg2)', border: `1px solid ${row.st === ST.unknown ? 'var(--border)' : m.color}`,
        cursor: onOpen ? 'pointer' : 'default',
      }}
      title={`${row.name} — ${row.why}`}>
      {/* ป้ายสถานะกลมแบบเดียวกับสติกเกอร์บนบอร์ดกระดาษ · แดงไม่กระพริบ (เป็น KPI ไม่ใช่ alarm เครื่องหยุด) */}
      <span style={{
        flex: '0 0 auto', width: 26, height: 26, borderRadius: '50%', display: 'flex',
        alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 13,
        background: row.st === ST.unknown ? 'var(--bg3)' : m.color,
        color: row.st === ST.unknown ? 'var(--muted)' : '#0b1410',
      }}>{badge}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text2)', display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</span>
          <span style={{ flex: '0 0 auto', fontSize: 9.5, color: 'var(--muted)' }}>{row.auto ? '⚡' : '✍️'}</span>
        </div>
        <div style={{ fontSize: 15, fontWeight: 900, color: row.value == null ? 'var(--muted)' : 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
          {val}
          {/* เป้า 0 (อุบัติเหตุ) ไม่ต้องโชว์ "/ 0" — อ่านแล้วงง เป้าอยู่ใน tooltip อยู่แล้ว */}
          {row.target ? (
            <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--muted)', marginLeft: 5 }}>/ {nf(row.target, 2)}</span>
          ) : null}
        </div>
      </div>
      {row.series && Object.keys(row.series).length > 1 && (
        <div style={{ flex: '0 0 auto' }}><Spark days={Object.keys(row.series).sort()} map={row.series} color={m.color} dir={row.dir} /></div>
      )}
    </div>
  );
}

/* ── แผง "Key Performance <ส่วนงาน>" = คอลัมน์ซ้ายสุดบนบอร์ดกระดาษ ─────────────
   บนกระดาษเป็นตาราง KPI ระดับส่วนงาน + แผง Core Activity Plan (100P/LEAN/QCC/Kaizen/5S)
   ในระบบ = `kpi_definitions` ที่ line_group เป็น null → ตั้งอะไรไว้ก็ขึ้นตรงนี้
   ⚠️ ไม่ hardcode รายชื่อกิจกรรม — แต่ละส่วนงานทำกิจกรรมไม่เหมือนกัน ให้ตั้งเองที่ KPI รายเดือน */
function SectionPanel({ section, rows, onOpenKpi }) {
  const st = worstStatus(rows.map(r => r.st));
  const m = stMeta(st);
  return (
    <div style={{ background: 'var(--card)', border: `1px solid ${st === ST.unknown ? 'var(--border)' : m.color}`, borderRadius: 12, padding: 10 }}>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--text)' }}>Key Performance {section}</div>
        <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>ระดับส่วนงาน · รวมแผนกิจกรรม (100P/LEAN/QCC/Kaizen/5S)</div>
      </div>
      {!rows.length ? (
        <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.7 }}>
          ยังไม่ได้ตั้ง KPI ระดับส่วนงาน<br />
          <span style={{ color: '#f59e0b' }}>ตั้งที่ 📑 KPI รายเดือน โดยเว้นช่อง "กลุ่มไลน์" ไว้</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {rows.map(r => <BoardCell key={r.key} row={r} onOpen={() => onOpenKpi(r)} />)}
        </div>
      )}
    </div>
  );
}

/* ── 1 คอลัมน์ = 1 กลุ่มไลน์ (ตรงกับ 1 แผงบนบอร์ดกระดาษ) ────────────────────── */
function BoardColumn({ col, onOpenGroup, onOpenKpi }) {
  const m = stMeta(col.st);
  return (
    <div style={{ background: 'var(--card)', border: `1px solid ${col.st === ST.unknown ? 'var(--border)' : m.color}`, borderRadius: 12, padding: 10 }}>
      <div onClick={onOpenGroup} style={{ marginBottom: 8, cursor: onOpenGroup ? 'pointer' : 'default' }}>
        <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--text)' }}>{col.group}</div>
        <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>
          {col.ccs.length ? `Cost: ${col.ccs.join(' · ')}` : '⚠ ยังไม่ตั้ง cost center'}
          {col.sessCount ? ` · ${col.sessCount} กะเดือนนี้` : ' · ยังไม่มีกะปิดเดือนนี้'}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {col.rows.map(r => <BoardCell key={r.key} row={r} onOpen={() => onOpenKpi(col, r)} />)}
      </div>
    </div>
  );
}

/* ── การ์ด 1 แกนของ SQCDM ─────────────────────────────────────────────────────── */
function AxisCard({ axis, onOpen, isMobile }) {
  const m = stMeta(axis.status);
  return (
    <div
      onClick={axis.to ? onOpen : undefined}
      title={axis.to ? 'กดเพื่อเปิดหน้าที่ทำงานจริง' : undefined}
      style={{
        background: 'var(--card)', border: `1px solid ${axis.status === ST.unknown ? 'var(--border)' : m.color}`,
        borderLeft: `5px solid ${m.color}`, borderRadius: 12, padding: '12px 14px',
        display: 'flex', flexDirection: 'column', gap: 6, minHeight: 172,
        cursor: axis.to ? 'pointer' : 'default',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{
          fontSize: 11, fontWeight: 900, color: m.color, border: `1.5px solid ${m.color}`,
          borderRadius: 6, width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>{axis.letter}</span>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text)' }}>{axis.icon} {axis.title}</span>
        <span style={{ marginLeft: 'auto', fontSize: 13 }} title={m.label}>{m.dot}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: isMobile ? 26 : 30, fontWeight: 900, color: 'var(--text)', lineHeight: 1.05, fontVariantNumeric: 'tabular-nums' }}>
          {axis.value}
        </span>
        {axis.unit && <span style={{ fontSize: 12, color: 'var(--text2)' }}>{axis.unit}</span>}
      </div>

      {/* เทียบกับอะไร — ต้องเขียนเสมอ ห้ามโชว์สีเฉยๆ แล้วให้เดา */}
      <div style={{ fontSize: 11.5, color: axis.status === ST.bad ? m.color : 'var(--text2)', lineHeight: 1.5, minHeight: 32 }}>
        {axis.compare}
      </div>

      <Spark days={axis.days} map={axis.trend} color={m.color} dir={axis.dir} />
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 10.5, color: 'var(--muted)' }}>
        <span>{TREND_DAYS} วันล่าสุด</span>
        {axis.monthText && <span style={{ marginLeft: 'auto', color: 'var(--text2)' }}>{axis.monthText}</span>}
      </div>
    </div>
  );
}

export default function Obeya() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { role, lineId, sections } = useContext(UserContext);
  const { can } = usePerms();
  const canRecord = can('safety', 'record');
  const [sp, setSp] = useSearchParams();

  const [lines, setLines] = useState([]);
  const [orgSections, setOrgSections] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [showSafety, setShowSafety] = useState(null);   // null | {} | event
  const [full, setFull] = useState(false);
  const rootRef = useRef(null);
  const reqRef = useRef(0);                             // กันผลโหลดเก่าทับผลใหม่

  /* วัน + ส่วนงาน อยู่ใน URL → จอ TV bookmark ได้ (?section=PD3) */
  const today = workDateNow();
  const date = sp.get('date') || today;
  const section = sp.get('section') || '';
  const setParam = useCallback((k, v) => {
    setSp(prev => {
      const n = new URLSearchParams(prev);
      if (v) n.set(k, v); else n.delete(k);
      return n;
    }, { replace: true });
  }, [setSp]);

  useEffect(() => {
    supabase.from('production_lines').select('id, name, section, parent_line_name, cost_center')
      .then(({ data: d }) => setLines(d || []));
    supabase.from('org_nodes').select('code, name, sort_order').eq('kind', 'section').order('sort_order')
      .then(({ data: d, error }) => setOrgSections(error ? [] : (d || [])));
    loadOpInfo().catch(() => {});
  }, []);

  /* scope มาตรฐาน — helper กลางคืน null = ไม่จำกัด (ห้ามคืน [] ไม่งั้น .in() ว่าง = ไม่เห็นอะไร) */
  const scopeSet = useMemo(() => {
    const names = scopedLineNames({ role, lineId, sections, lines });
    return names ? new Set(names) : null;
  }, [role, lineId, sections, lines]);

  /* ตัวเลือกส่วนงาน — ยึด org_nodes ตามกฎ · fallback เดาจาก production_lines เมื่อผังว่าง */
  const sectionOpts = useMemo(() => {
    const inScope = new Set(lines.filter(l => !scopeSet || scopeSet.has(l.name)).map(l => l.section).filter(Boolean));
    const fromOrg = (orgSections || []).map(s => s.code || s.name).filter(s => inScope.has(s));
    return fromOrg.length ? fromOrg : [...inScope].sort();
  }, [orgSections, lines, scopeSet]);

  /* ยังไม่เลือก = ส่วนงานของ user เอง ถ้าอยู่ในลิสต์ ไม่งั้นตัวแรก */
  useEffect(() => {
    if (section || !sectionOpts.length) return;
    const mine = (sections || []).find(s => sectionOpts.includes(s));
    setParam('section', mine || sectionOpts[0]);
  }, [section, sectionOpts, sections, setParam]);

  const lineNames = useMemo(() => lines
    .filter(l => (!scopeSet || scopeSet.has(l.name)) && (!section || (l.section || '') === section))
    .map(l => l.name), [lines, scopeSet, section]);

  const days = useMemo(() => dayAxis(date, TREND_DAYS), [date]);
  const monthStart = `${date.slice(0, 7)}-01`;
  const from = days[0] < monthStart ? days[0] : monthStart;   // ชุดเดียวครอบทั้งเทรนด์ + เดือนนี้

  /* ── โหลด ───────────────────────────────────────────────────────────────────
     ทุกก้อนเช็ค error → warn[] เพื่อขึ้นแถบ "โหลดไม่ครบ" ห้ามเงียบ            */
  const load = useCallback(async () => {
    if (!lines.length || !section) return;
    const seq = ++reqRef.current;
    setLoading(true); setErr(null);
    const warn = [];
    try {
      if (!lineNames.length) {
        if (seq === reqRef.current) { setData({ empty: true }); setLoading(false); }
        return;
      }
      // 1) กะของไลน์ในส่วนงาน (ปิดแล้ว = มีตัวเลขจริง · เปิดค้าง = นับแยกไว้บอกว่ายังไม่ครบ)
      const sess = await fetchAllPages(() => supabaseDR.from('production_sessions')
        .select('id, line_name, work_date, shift, status, shift_min, oee, actual_qty')
        .gte('work_date', from).lte('work_date', date).in('line_name', lineNames));
      if (sess.error) warn.push('กะการผลิต');
      const closed = sess.rows.filter(s => s.status === 'closed');
      const ids = closed.map(s => s.id);

      // 2) downtime → planned (ตัวถ่วง wLoad) + นอกแผน (แกน C)
      const dt = await fetchByIds(ids, part => supabaseDR.from('downtime_logs')
        .select('session_id, duration_min, dr_downtime_types(category)').in('session_id', part));
      if (dt.error) warn.push('Downtime');

      // 3) ของเสีย (line-mode — ต้อง select excl_from_q ไม่งั้นตกหล่นเงียบ)
      const df = await fetchByIds(ids, part => supabaseDR.from('defect_logs')
        .select('session_id, qty_ng, qty_suspect, is_trial, dr_defect_types(excl_from_q)').in('session_id', part));
      if (df.error) warn.push('ของเสีย');

      // 4) ใบผลิต → แกน D (ทำได้ตามเป้ากี่ %)
      const po = await fetchByIds(ids, part => supabaseDR.from('prod_orders')
        .select('session_id, mat_no, qty, qty_target, qty_ok, qty_actual, status').in('session_id', part));
      if (po.error) warn.push('ใบผลิต');

      // 5) เป้า OEE + คู่ RH/LH
      const [tg, pr] = await Promise.all([
        supabase.from('oee_targets').select('group_name, target_a, target_p, target_q'),
        supabaseDR.from('dr_products').select('mat_no, pair_mat_no'),
      ]);
      if (tg.error) warn.push('เป้า OEE');
      if (pr.error) warn.push('คู่ RH/LH');

      // 6) ความปลอดภัย — ดึงทั้งหมดของส่วนงาน (streak ต้องมองย้อนไกลกว่าหน้าต่างเทรนด์)
      const sf = await supabase.from('safety_events')
        .select('*').eq('is_active', true).lte('event_date', date)
        .order('event_date', { ascending: false }).limit(500);
      const safetyMissing = (sf.error?.code || '') === '42P01';
      if (sf.error && !safetyMissing) warn.push('เหตุการณ์ความปลอดภัย');
      const safety = (sf.data || []).filter(e => !section || (e.section || '') === section);

      // 7) คนมาทำงาน — daily_production_logs ผูกไลน์ผ่าน employees.line_id
      const empRes = await supabase.from('employees').select('id, line_id').eq('is_active', true);
      if (empRes.error) warn.push('ทะเบียนพนักงาน');
      const lineById = Object.fromEntries(lines.map(l => [String(l.id), l.name]));
      const inSec = new Set(lineNames);
      const empIds = (empRes.data || []).filter(e => inSec.has(lineById[String(e.line_id)])).map(e => e.id);
      let att = { rows: [], error: null };
      if (empIds.length) {
        att = await fetchByIds(empIds, part => supabase.from('daily_production_logs')
          .select('work_date, employee_id, is_present, has_helmet, has_boots, has_gloves')
          .gte('work_date', days[0]).lte('work_date', date).in('employee_id', part));
        if (att.error) warn.push('เช็คชื่อ');
      }

      // 8) งานที่ต้องตามแก้จากประชุมเช้า — "บอร์ดที่มีแต่กราฟ ไม่มี action = ไม่ใช่ Obeya"
      let acts = { data: [], error: null };
      acts = await supabase.from('meeting_action_items')
        .select('id, meeting_date, section, line_name, problem, assignee, due_date, status')
        .in('status', ['open', 'doing']).order('due_date', { ascending: true, nullsFirst: false }).limit(60);
      const actsMissing = (acts.error?.code || '') === '42P01';
      if (acts.error && !actsMissing) warn.push('งานติดตามจากประชุมเช้า');
      const actions = (acts.data || []).filter(a => !section || (a.section || '') === section);

      // 9) KPI กรอกมือของปีนั้น — แถวที่ระบบคำนวณให้ไม่ได้ (DL/OH/Inventory/CSAT/Training)
      //    scope: line_group = คอลัมน์บนบอร์ด · null = ระดับส่วนงาน
      const year = Number(date.slice(0, 4));
      let kdRes = await supabase.from('kpi_definitions')
        .select('*, kpi_catalog(name, unit, direction)')
        .eq('year', year).eq('is_active', true);
      if (kdRes.error && (kdRes.error.code || '') !== '42P01') {
        // ยังไม่ apply migration ทะเบียน → ถอยไป select ชุดเดิม (ห้ามทำให้บอร์ดพังทั้งใบ)
        kdRes = await supabase.from('kpi_definitions').select('*').eq('year', year).eq('is_active', true);
      }
      const kpiMissing = (kdRes.error?.code || '') === '42P01';
      if (kdRes.error && !kpiMissing) warn.push('นิยาม KPI');
      const kdefs = (kdRes.data || []).filter(d => !d.section || d.section === section);
      let kentries = [];
      if (kdefs.length) {
        const ke = await fetchByIds(kdefs.map(d => d.id), part => supabase
          .from('kpi_manual_entries').select('kpi_id, month, value').in('kpi_id', part));
        if (ke.error) warn.push('ค่า KPI รายเดือน');
        kentries = ke.rows;
      }

      if (seq !== reqRef.current) return;                 // มีคำขอใหม่แล้ว — ทิ้งผลเก่า
      setData({
        actions, actsMissing, kdefs, kentries, kpiMissing, year,
        sessions: sess.rows, closed, dt: dt.rows, df: df.rows, po: po.rows,
        targets: tg.data || [], pairs: pr.data || [], safety, safetyMissing,
        att: att.rows, headcount: empIds.length, warn,
        openSess: sess.rows.filter(s => s.status !== 'closed' && s.work_date === date).length,
      });
    } catch (e) {
      if (seq === reqRef.current) { setErr(e?.message || 'โหลดข้อมูลไม่สำเร็จ'); setData(null); }
    } finally {
      if (seq === reqRef.current) setLoading(false);
    }
  }, [lines, lineNames, section, from, date, days]);

  useEffect(() => { load(); }, [load]);
  usePolling(load, RATE.BOARD);

  /* ── คำนวณ 6 แกน ───────────────────────────────────────────────────────────── */
  const axes = useMemo(() => {
    if (!data || data.empty) return null;
    const { closed, dt, df, po, targets, pairs, safety, att } = data;
    const opMap = opInfoSync();
    const pairOf = (() => { const m = Object.fromEntries((pairs || []).map(p => [p.mat_no, p.pair_mat_no])); return x => m[x] || null; })();

    // จัดกลุ่มรายกะ
    const plannedBy = {}, unplannedBy = {};
    (dt || []).forEach(r => {
      const m = Number(r.duration_min) || 0;
      const t = r.dr_downtime_types?.category === 'planned' ? plannedBy : unplannedBy;
      t[r.session_id] = (t[r.session_id] || 0) + m;
    });
    const defBy = {};
    (df || []).forEach(r => (defBy[r.session_id] = defBy[r.session_id] || []).push(r));
    const poBy = {};
    (po || []).forEach(r => (poBy[r.session_id] = poBy[r.session_id] || []).push(r));

    const sessOf = d => closed.filter(s => s.work_date === d);
    const inMonth = closed.filter(s => s.work_date >= monthStart);

    /* ── ตัวช่วยรวมค่าแบบ "ต่อวัน" ── */
    const oeeOf = ss => wavg(ss.map(s => ({ oee: s.oee != null ? Number(s.oee) : null, shift_min: s.shift_min, plannedMin: plannedBy[s.id] || 0 })), x => x.oee, wLoad);
    const ngOf = ss => ss.reduce((a, s) => a + sumDefectQty(defBy[s.id] || [], 'line'), 0);
    const qtyOf = ss => ss.reduce((a, s) => a + (Number(s.actual_qty) || 0), 0);
    const dtOf = ss => ss.reduce((a, s) => a + (unplannedBy[s.id] || 0), 0);
    const planOf = (ss) => {
      const orders = ss.flatMap(s => poBy[s.id] || []);
      const tgt = orderTotal(orders, o => (o.qty_target ?? o.qty), pairOf, opMap);
      const got = orderTotal(orders, o => (o.status === 'confirmed' ? (o.qty_ok ?? o.qty) : (o.qty_actual ?? 0)), pairOf, opMap);
      return { tgt, got, pct: tgt > 0 ? (got / tgt) * 100 : null };
    };

    // เทรนด์รายวัน
    const tOee = {}, tNg = {}, tDt = {}, tPlan = {}, tAtt = {}, tSafe = {};
    days.forEach(d => {
      const ss = sessOf(d);
      if (ss.length) {
        const o = oeeOf(ss); if (o != null) tOee[d] = o;
        const q = qtyOf(ss), n = ngOf(ss);
        tNg[d] = (q + n) > 0 ? (n / (q + n)) * 1e6 : 0;
        tDt[d] = dtOf(ss);
        const p = planOf(ss); if (p.pct != null) tPlan[d] = p.pct;
      }
    });
    const attByDay = {};
    (att || []).forEach(r => {
      const b = attByDay[r.work_date] = attByDay[r.work_date] || { present: 0, ppeNg: 0, n: 0 };
      b.n += 1;
      if (r.is_present) {
        b.present += 1;
        if (!(r.has_helmet && r.has_boots && r.has_gloves)) b.ppeNg += 1;
      }
    });
    days.forEach(d => { const b = attByDay[d]; if (b && b.n) tAtt[d] = (b.present / b.n) * 100; });
    Object.assign(tSafe, sumByDay((safety || []).filter(e => days.includes(e.event_date)), e => e.event_date));
    days.forEach(d => { if (tSafe[d] == null && closed.some(s => s.work_date === d)) tSafe[d] = 0; });

    /* ── เป้า OEE ของส่วนงาน = เฉลี่ยของกรุ๊ปในส่วนงาน (กฎ oee_targets: ระดับ section ไม่เก็บใน DB) ── */
    const tops = new Set(lines.filter(l => lineNames.includes(l.name)).map(l => l.parent_line_name || l.name));
    const tByG = Object.fromEntries((targets || []).map(t => [t.group_name, t]));
    const tVals = [...tops].map(g => {
      const t = tByG[g] || {};
      return (Number(t.target_a) || DEFAULT_APQ.a) * (Number(t.target_p) || DEFAULT_APQ.p) * (Number(t.target_q) || DEFAULT_APQ.q) / 10000;
    });
    const oeeTarget = tVals.length ? tVals.reduce((s, v) => s + v, 0) / tVals.length : null;

    const todaySess = sessOf(date);
    const prevDays = days.slice(0, -1);   // ค่าเฉลี่ยย้อนหลัง = ไม่รวมวันที่กำลังดู (ห้ามเทียบกับตัวเอง)

    /* ── S · Safety ────────────────────────────────────────────────────────── */
    const streak = daysWithoutLti(safety, date);
    const sfMonth = (safety || []).filter(e => e.event_date >= monthStart);
    const sfInjM = sfMonth.filter(isInjury).length;
    const sfToday = (safety || []).filter(e => e.event_date === date);
    /* ⚠️ "ไม่มีบันทึก" ห้ามขึ้นเขียว — ดูกฎเหล็กใน utils/obeya.safetyStatus */
    const sfNone = !(safety || []).length;
    const sfStatus = safetyStatus(safety, { todayEvents: sfToday, monthInjuries: sfInjM, tableMissing: data.safetyMissing });

    /* ── M · คน ─────────────────────────────────────────────────────────────── */
    const aToday = attByDay[date];
    const attPct = aToday && aToday.n ? (aToday.present / aToday.n) * 100 : null;
    const attBase = avgOfDays(tAtt, prevDays);
    const attCmp = statusVsBaseline(attPct, attBase, 'up');

    /* ── Q · คุณภาพ ─────────────────────────────────────────────────────────── */
    const qToday = qtyOf(todaySess), ngToday = ngOf(todaySess);
    const ppmToday = (qToday + ngToday) > 0 ? (ngToday / (qToday + ngToday)) * 1e6 : null;
    const ppmBase = avgOfDays(tNg, prevDays);
    const ppmCmp = statusVsBaseline(ppmToday, ppmBase, 'down');
    const ngMonth = ngOf(inMonth), qMonth = qtyOf(inMonth);

    /* ── C · ต้นทุน (เวลาที่เสียไป) ──────────────────────────────────────────── */
    const dtToday = todaySess.length ? dtOf(todaySess) : null;
    const dtBase = avgOfDays(tDt, prevDays);
    const dtCmp = statusVsBaseline(dtToday, dtBase, 'down');

    /* ── D · ทำได้ตามเป้า ───────────────────────────────────────────────────── */
    const planT = planOf(todaySess);
    const planCmp = statusVsTarget(planT.pct, 100, 'up', 0.1);

    /* ── P · OEE ────────────────────────────────────────────────────────────── */
    const oeeToday = todaySess.length ? oeeOf(todaySess) : null;
    const oeeMonth = oeeOf(inMonth);
    const oeeStatus = statusVsTarget(oeeToday, oeeTarget, 'up');

    const baseNote = (cmp, unit, dirWord) => {
      if (cmp.base == null) return 'ยังไม่มีค่าเฉลี่ยย้อนหลังให้เทียบ';
      const up = (cmp.deltaPct ?? 0) >= 0;
      return `เทียบค่าเฉลี่ย ${TREND_DAYS - 1} วันก่อน (${nf(cmp.base, 0)}${unit}) — ${up ? '▲' : '▼'} ${nf(Math.abs(cmp.deltaPct), 0)}% · ${dirWord}`;
    };

    return [
      {
        key: 'S', letter: 'S', icon: '🛡️', title: 'ความปลอดภัย', status: sfStatus, dir: 'down',
        value: data.safetyMissing ? '—' : (streak.unknown ? '—' : nf(streak.days)),
        unit: data.safetyMissing ? '' : (streak.unknown ? '' : 'วัน'),
        compare: data.safetyMissing
          ? '⚠ ยังไม่ได้ apply migration safety_events — แจ้ง admin'
          : sfNone
            ? 'ยังไม่มีใครบันทึกเหตุการณ์ความปลอดภัยของส่วนงานนี้เลย — ประเมินสถานะยังไม่ได้ (0 ที่บันทึกไว้ ≠ 0 ที่เกิดจริง)'
            : streak.unknown
              ? 'มีบันทึกแล้วแต่ยังไม่เคยมีอุบัติเหตุถึงขั้นหยุดงาน — ถ้าเคยเกิดก่อนใช้ระบบ ให้บันทึกครั้งล่าสุดเพื่อเริ่มนับ'
              : `ปลอดอุบัติเหตุถึงขั้นหยุดงาน (ล่าสุด ${streak.since}) · เป้าเดือนนี้ 0 ครั้ง`,
        monthText: data.safetyMissing ? '' : `เดือนนี้ บาดเจ็บ ${sfInjM} · แจ้งทั้งหมด ${sfMonth.length}`,
        days, trend: tSafe, to: null,
      },
      {
        key: 'Q', letter: 'Q', icon: '✅', title: 'คุณภาพ', status: ppmCmp.status, dir: 'down',
        value: ppmToday == null ? '—' : nf(ppmToday), unit: 'PPM',
        compare: ppmToday == null ? 'วันนี้ยังไม่มีกะที่ปิดแล้ว' : baseNote(ppmCmp, '', ppmCmp.status === ST.good ? 'ดีขึ้น/เท่าเดิม' : 'แย่ลง'),
        monthText: `เดือนนี้ ของเสีย ${nf(ngMonth)} ชิ้น`,
        days, trend: tNg, to: '/qa',
      },
      {
        key: 'C', letter: 'C', icon: '💰', title: 'ต้นทุน — เวลาที่เสียไป', status: dtCmp.status, dir: 'down',
        value: dtToday == null ? '—' : nf(dtToday), unit: 'นาที (นอกแผน)',
        compare: dtToday == null ? 'วันนี้ยังไม่มีกะที่ปิดแล้ว' : baseNote(dtCmp, ' น.', dtCmp.status === ST.good ? 'ดีขึ้น/เท่าเดิม' : 'แย่ลง'),
        monthText: `เดือนนี้ ${nf(dtOf(inMonth))} นาที`,
        days, trend: tDt, to: '/oee-analytics',
      },
      {
        key: 'D', letter: 'D', icon: '🚚', title: 'ส่งมอบ — ทำได้ตามเป้า', status: planCmp, dir: 'up',
        value: planT.pct == null ? '—' : nf(planT.pct), unit: '%',
        compare: planT.pct == null
          ? 'วันนี้ยังไม่มีใบผลิตที่ตั้งเป้าไว้'
          : `ทำได้ ${nf(planT.got)} / เป้า ${nf(planT.tgt)} ชิ้น (นับคู่ RH/LH เป็น 1) · เป้า 100%`,
        monthText: (() => { const p = planOf(inMonth); return p.pct == null ? '' : `เดือนนี้ ${nf(p.pct)}%`; })(),
        days, trend: tPlan, to: '/daily-report',
      },
      {
        key: 'M', letter: 'M', icon: '👷', title: 'กำลังคน', status: attCmp.status, dir: 'up',
        value: attPct == null ? '—' : nf(attPct), unit: '% มาทำงาน',
        compare: attPct == null
          ? 'วันนี้ยังไม่มีการเช็คชื่อ'
          : `มา ${aToday.present} / ${aToday.n} คน${aToday.ppeNg ? ` · ⚠ PPE ไม่ครบ ${aToday.ppeNg} คน` : ''}`,
        monthText: data.headcount ? `ทะเบียน ${data.headcount} คน` : '',
        days, trend: tAtt, to: '/checkin',
      },
      {
        key: 'P', letter: 'P', icon: '⚙️', title: 'ประสิทธิภาพ (OEE)', status: oeeStatus, dir: 'up',
        value: oeeToday == null ? '—' : nf(oeeToday, 1), unit: '%',
        compare: oeeToday == null
          ? 'วันนี้ยังไม่มีกะที่ปิดแล้ว'
          : oeeTarget == null ? 'ยังไม่ได้ตั้งเป้า OEE ของกลุ่มไลน์ในส่วนงานนี้'
            : `เป้า ≥ ${nf(oeeTarget, 1)}% (เฉลี่ยเป้าของกลุ่มไลน์ในส่วนงาน)`,
        monthText: oeeMonth == null ? '' : `เดือนนี้ ${nf(oeeMonth, 1)}%`,
        days, trend: tOee, to: '/oee-analytics',
      },
    ];
  }, [data, days, date, monthStart, lines, lineNames]);

  /* ── กริดบอร์ดตามกระดาษ: คอลัมน์ = กลุ่มไลน์ × 8 แถว ─────────────────────────
     ⚠️ แยก "auto" กับ "manual" ให้เห็นบนจอเสมอ — auto อัพเดทเอง manual ต้องมีคนกรอก
     ⚠️ ไม่มีเป้า ≠ ผ่าน → สถานะเทา "ยังไม่ตั้งเป้า" (Safety เป็นข้อยกเว้น เป้า = 0 เสมอ)  */
  const board = useMemo(() => {
    if (!data || data.empty) return null;
    const { closed, dt, df, safety, kdefs, kentries, targets } = data;
    const month = date.slice(0, 7);
    const monthNo = Number(date.slice(5, 7));
    /* ⚠️ แถวที่วันที่หาย (query ถอย select / ข้อมูลเพี้ยน) ต้อง "ไม่ถูกนับ" ไม่ใช่ "ทำบอร์ดพัง"
       — เคยพังจริงตอนเรนเดอร์: e.event_date undefined → .slice ระเบิดทั้งหน้า */
    const ym = x => String(x ?? '').slice(0, 7);

    /* คอลัมน์ = ไลน์แม่ในส่วนงาน (parent_line_name IS NULL) — ตรงกับหัวคอลัมน์บนกระดาษ */
    const groups = lines
      .filter(l => (l.section || '') === section && !l.parent_line_name && (!scopeSet || scopeSet.has(l.name)))
      .map(l => l.name).sort();

    const plannedBy = {}, unplannedBy = {};
    (dt || []).forEach(r => {
      const m = Number(r.duration_min) || 0;
      const t = r.dr_downtime_types?.category === 'planned' ? plannedBy : unplannedBy;
      t[r.session_id] = (t[r.session_id] || 0) + m;
    });
    const defBy = {};
    (df || []).forEach(r => (defBy[r.session_id] = defBy[r.session_id] || []).push(r));

    /* ค่า KPI กรอกมือ: (line_group, ชื่อ KPI) → { def, ค่าเดือนนี้ } */
    const entByKpi = {};
    (kentries || []).forEach(e => (entByKpi[e.kpi_id] = entByKpi[e.kpi_id] || {})[e.month] = e.value);
    /* เป้าของแถวอัตโนมัติ — ตั้งที่ 📑 KPI รายเดือน (ปุ่ม 🎯) เก็บเป็น source='auto:<key>'
       ⚠️ แหล่งเดียวกับตาราง KPI รายเดือน ห้ามให้ 2 จอตั้งเป้าคนละที่แล้วได้คนละเลข */
    const autoDefOf = (grp, srcKey) => (kdefs || []).find(d =>
      d.source === `auto:${srcKey}` && (d.line_group || '') === (grp || '')) || null;

    const manualOf = (grp, rowName) => {
      const nn = normName(rowName);
      const d = (kdefs || []).find(x =>
        normName(x.kpi_catalog?.name || x.name) === nn && (x.line_group || '') === (grp || ''));
      if (!d) return null;
      const v = entByKpi[d.id]?.[monthNo];
      return {
        def: d,
        value: v == null ? null : Number(v),
        unit: d.kpi_catalog?.unit || '',
        target: d.target_value == null ? null : Number(d.target_value),
        dir: d.direction || d.kpi_catalog?.direction || null,
      };
    };

    const tByG = Object.fromEntries((targets || []).map(t => [t.group_name, t]));
    const cells = [];   // เก็บสถานะทุกเซลล์ไว้คิดไฟรวม

    const cols = groups.map(g => {
      const members = lines.filter(l => l.name === g || l.parent_line_name === g);
      const memberNames = new Set(members.map(l => l.name));
      /* บอร์ดพิมพ์ cost center ของ "ไลน์ลูก" กำกับหัวคอลัมน์ (ไลน์แม่เป็น cc ระดับส่วน) */
      const ccs = [...new Set(members.filter(l => l.parent_line_name && l.cost_center).map(l => l.cost_center))].sort();

      const ss = closed.filter(x => memberNames.has(x.line_name));
      const mSess = ss.filter(x => ym(x.work_date) === month);
      const dSess = ss.filter(x => x.work_date === date);

      const oeeOf = list => wavg(list.map(x => ({
        oee: x.oee != null ? Number(x.oee) : null, shift_min: x.shift_min, plannedMin: plannedBy[x.id] || 0,
      })), x => x.oee, wLoad);
      const ppmOf = list => {
        const q = list.reduce((a, x) => a + (Number(x.actual_qty) || 0), 0);
        const n = list.reduce((a, x) => a + sumDefectQty(defBy[x.id] || [], 'line'), 0);
        return (q + n) > 0 ? (n / (q + n)) * 1e6 : null;
      };
      /* Safety ราย "กลุ่มไลน์" = เหตุการณ์ที่ระบุ line_name อยู่ในกลุ่ม
         ⚠️ เหตุที่ไม่ได้ระบุไลน์ (ระดับส่วนงาน) ไม่ถูกนับในคอลัมน์ไหนเลย — บอกบนจอ */
      const sfM = (safety || []).filter(e => ym(e.event_date) === month && e.line_name && memberNames.has(e.line_name));
      const sfInj = sfM.filter(isInjury).length;

      const tgt = tByG[g] || {};
      const oeeTarget = (Number(tgt.target_a) || DEFAULT_APQ.a) * (Number(tgt.target_p) || DEFAULT_APQ.p)
        * (Number(tgt.target_q) || DEFAULT_APQ.q) / 10000;

      const rows = boardRowsFor(date.slice(0, 4)).map(r => {
        const man = manualOf(g, r.name);
        let value = null, target = null, unit = r.unit || man?.unit || '', dir = r.dir || man?.dir || null;
        let today = null, series = null, note = '', fromDept = false;

        if (r.auto === 'oee') {
          value = oeeOf(mSess); today = oeeOf(dSess); target = oeeTarget;
          series = {}; days.forEach(d => { const v = oeeOf(ss.filter(x => x.work_date === d)); if (v != null) series[d] = v; });
          note = tByG[g] ? 'เป้าจากทะเบียนเป้า OEE' : 'ยังไม่ตั้งเป้า OEE — ใช้ค่ามาตรฐาน 90×90×99';
        } else if (r.auto === 'ppm') {
          value = ppmOf(mSess); today = ppmOf(dSess);
          const ad = autoDefOf(g, 'ppm');
          target = ad?.target_value == null ? (man?.target ?? null) : Number(ad.target_value);
          dir = ad?.direction || dir;
          series = {}; days.forEach(d => { const v = ppmOf(ss.filter(x => x.work_date === d)); if (v != null) series[d] = v; });
        } else if (r.auto === 'safety') {
          /* ค่า KPI Safety รายเดือน = "สรุปจากหน่วยงานความปลอดภัย" (กรอกมือ — คำตอบ user 2026-09-07)
             · มีนิยาม Safety + ค่าเดือนนี้ (ระดับกลุ่มไลน์ก่อน → ระดับส่วนงาน) = ใช้ค่านั้นตัดสินสี ป้ายเปลี่ยนเป็น ✍️
             · ยังไม่มีใครกรอก = ถอยไปใช้บันทึกหน้างาน safety_events เหมือนเดิม (กฎ "ไม่มีบันทึก ≠ เขียว")
             · ห้ามเอา 2 แหล่งมาบวกกัน — หน้างานบันทึกเป็นข้อมูลประกอบ เขียนกำกับใน note เสมอ */
          const manSec = man?.value != null ? null : manualOf('', r.name);
          const manSafe = man?.value != null ? man : (manSec?.value != null ? manSec : null);
          if (manSafe) {
            value = manSafe.value; today = null;
            target = manSafe.target; unit = manSafe.unit || r.unit; dir = manSafe.dir || dir;
            fromDept = true;
            note = `สรุปจากหน่วยงานความปลอดภัย${manSafe === man ? '' : ' (ค่าระดับส่วนงาน)'} · หน้างานบันทึกบาดเจ็บเดือนนี้ ${sfInj} ครั้ง`;
          } else {
            value = sfInj; today = (safety || []).filter(e => e.event_date === date && e.line_name && memberNames.has(e.line_name) && isInjury(e)).length;
            target = 0;   // เป้าอุบัติเหตุ = 0 เสมอ ไม่ต้องตั้ง
            if (!(safety || []).length) { value = null; note = 'ยังไม่มีใครบันทึกเหตุการณ์'; }
          }
        } else {
          value = man?.value ?? null; target = man?.target ?? null;
        }

        /* สถานะ: มีเป้า → เทียบเป้า · ไม่มีเป้า → เทา (กฎ "ไม่มีเป้า ≠ ผ่าน") */
        let st = ST.unknown, why = '';
        if (value == null) {
          why = r.auto ? (note || 'ยังไม่มีข้อมูล') : (man ? 'ยังไม่กรอกค่าเดือนนี้' : 'ยังไม่ได้ตั้ง KPI ตัวนี้');
        } else if (target != null && dir) {
          st = statusVsTarget(value, target, dir);
          why = `เทียบเป้า ${nf(target, 2)}${unit ? ' ' + unit : ''}`;
        } else {
          why = r.auto
            ? 'ยังไม่ตั้งเป้า — ตั้งที่ 📑 KPI รายเดือน ปุ่ม 🎯 ท้ายแถว'
            : 'ยังไม่ตั้งเป้า — ตั้งที่ 📑 KPI รายเดือน ตอนแก้นิยาม KPI';
        }
        if (fromDept) why = `${note}${why ? ' · ' + why : ''}`;
        cells.push(st);
        return { ...r, auto: fromDept ? null : r.auto, value, today, target, unit, dir, series, st, why, manual: fromDept || !r.auto, hasDef: !!man };
      });

      return { group: g, ccs, rows, sessCount: mSess.length, st: worstStatus(rows.map(x => x.st)) };
    });

    /* แถวของแผง Key Performance = นิยาม KPI ที่ไม่ผูกกลุ่มไลน์ (เรียงตามหมวด/ลำดับที่ตั้งไว้) */
    const secRows = (kdefs || [])
      .filter(d => !d.line_group)
      .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
      .map(d => {
        const value = entByKpi[d.id]?.[monthNo];
        const v = value == null ? null : Number(value);
        const target = d.target_value == null ? null : Number(d.target_value);
        const dir = d.direction || d.kpi_catalog?.direction || null;
        let st = ST.unknown, why = '';
        if (v == null) why = 'ยังไม่กรอกค่าเดือนนี้';
        else if (target != null && dir) { st = statusVsTarget(v, target, dir); why = `เทียบเป้า ${nf(target, 2)}`; }
        else why = 'ยังไม่ตั้งเป้า — ตั้งได้ที่ 📑 KPI รายเดือน';
        cells.push(st);
        return {
          key: `s-${d.id}`, name: d.kpi_catalog?.name || d.name || '(ไม่มีชื่อ)', auto: null,
          value: v, target, unit: d.kpi_catalog?.unit || '', dir, series: null, st, why, manual: true, hasDef: true,
        };
      });

    const orphanSafety = (safety || []).filter(e => ym(e.event_date) === month && !e.line_name).length;
    /* ⚠️ ไฟเขียวที่มาจาก "ช่องเดียวที่ประเมินได้" = คำตอบที่หลอกคนอ่าน (บทเรียนเดียวกับ safetyStatus)
       → คืน known/total ให้จอเขียนกำกับเสมอ ห้ามโชว์ไฟรวมลอยๆ */
    const known = cells.filter(x => x !== ST.unknown).length;
    return { cols, secRows, orphanSafety, worst: worstStatus(cells), known, total: cells.length };
  }, [data, lines, section, scopeSet, date, days]);

  const overall = useMemo(() => {
    const parts = [...(axes ? axes.map(a => a.status) : []), ...(board ? [board.worst] : [])];
    return parts.length ? worstStatus(parts) : ST.unknown;
  }, [axes, board]);

  const openAxis = a => {
    if (!a.to) return;
    if (!canAccessPage(a.to, role)) return;   // ไม่มีสิทธิ์ = ไม่พาไปแล้วโดนเด้ง (กฎ telemetry)
    navigate(a.to);
  };

  const toggleFull = () => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) { document.exitFullscreen?.(); setFull(false); }
    else { el.requestFullscreen?.().then(() => setFull(true)).catch(() => {}); }
  };
  useEffect(() => {
    const h = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);

  const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px' };
  const sel = w => ({ width: w, padding: '6px 9px', fontSize: 13.5, borderRadius: 8, background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)' });
  const btn = { padding: '6px 13px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text)', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' };

  const recent = (data?.safety || []).slice(0, 6);

  /* งานค้างที่ต้องตามแก้ — รวม action item จากประชุมเช้า + เหตุการณ์ความปลอดภัยที่ยังไม่ปิด
     เรียง "เกินกำหนดก่อน แล้วเก่าก่อน" — บอร์ด Obeya ต้องพาไปถึงสิ่งที่ต้องลงมือ ไม่ใช่แค่โชว์สี */
  const todo = useMemo(() => {
    if (!data) return [];
    const acts = (data.actions || []).map(a => ({
      id: `a-${a.id}`, icon: '📋', kind: 'action',
      title: a.problem || '(ไม่ได้ระบุปัญหา)',
      meta: [a.line_name, a.assignee ? `ผู้รับผิดชอบ ${a.assignee}` : null, a.meeting_date ? `ประชุม ${a.meeting_date}` : null]
        .filter(Boolean).join(' · '),
      due: a.due_date || null, color: '#3b82f6', to: '/morning-meeting',
    }));
    const sf = (data.safety || []).filter(e => e.status === 'open').map(e => {
      const k = safetyKind(e.kind);
      return {
        id: `s-${e.id}`, icon: k.icon, kind: 'safety', ev: e,
        title: `${k.short} — ${e.description}`,
        meta: [e.line_name, e.employee_name].filter(Boolean).join(' · ') || 'ยังไม่ปิดเคส',
        due: null, color: k.color, to: null,
        warn: !e.countermeasure ? 'ยังไม่ได้ลงมาตรการแก้ไข' : null,
      };
    });
    const over = x => (x.due && x.due < date ? 0 : 1);
    return [...sf, ...acts].sort((a, b) => (over(a) - over(b)) || String(a.due || '9999').localeCompare(String(b.due || '9999')));
  }, [data, date]);

  return (
    <div ref={rootRef} style={{ maxWidth: 'min(97vw, 1800px)', margin: '0 auto', background: full ? 'var(--bg)' : undefined, padding: full ? 14 : 0 }}>
      <PageHeader
        title="OBEYA — บอร์ด KPI ส่วนงาน" icon="📋"
        sub={`ตามบอร์ดหน้างาน · วันงาน ${date}${section ? ` · ${section}` : ''}`}
        actions={<>
          {canRecord && (
            <button onClick={() => setShowSafety({})} style={{ ...btn, background: '#ef4444', color: '#fff', borderColor: '#ef4444' }}>
              ＋ บันทึกเหตุการณ์ความปลอดภัย
            </button>
          )}
          <button onClick={toggleFull} style={btn}>{full ? '⛶ ออกจากเต็มจอ' : '⛶ เต็มจอ'}</button>
        </>}
      />

      {/* แถบควบคุม + ไฟรวม */}
      <div style={{ ...card, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <select value={section} onChange={e => setParam('section', e.target.value)} style={sel(190)}>
          {!sectionOpts.length && <option value="">— ไม่มีส่วนงานในขอบเขต —</option>}
          {sectionOpts.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button onClick={() => setParam('date', dayAdd(date, -1))} style={{ ...btn, padding: '6px 10px' }}>◀</button>
          {/* width กัน index.css input{width:100%} ดันปุ่มแตกแถว */}
          <input type="date" value={date} max={today} onChange={e => e.target.value && setParam('date', e.target.value)} style={{ ...sel(150) }} />
          <button onClick={() => setParam('date', dayAdd(date, 1))} disabled={date >= today}
            style={{ ...btn, padding: '6px 10px', opacity: date >= today ? 0.4 : 1 }}>▶</button>
          {date !== today && <button onClick={() => setParam('date', '')} style={{ ...btn, padding: '6px 10px' }}>วันนี้</button>}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ textAlign: 'right', lineHeight: 1.3 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>สถานะรวม</div>
            {/* ⚠️ ต้องบอกเสมอว่าไฟนี้ตัดสินจากกี่ช่อง — เขียวจากช่องเดียวใน 100 ช่อง = คำตอบที่หลอกคน */}
            {board && (
              <div style={{ fontSize: 10.5, color: board.known < board.total / 2 ? '#f59e0b' : 'var(--muted)' }}>
                ประเมินได้ {board.known}/{board.total} ช่อง
              </div>
            )}
          </div>
          <span style={{
            fontSize: 13.5, fontWeight: 900, color: stMeta(overall).color,
            border: `1.5px solid ${stMeta(overall).color}`, borderRadius: 8, padding: '4px 12px',
          }}>{stMeta(overall).dot} {stMeta(overall).label}</span>
        </div>
      </div>

      {loading && !data && <div style={{ ...card, textAlign: 'center', color: 'var(--muted)' }}>กำลังโหลด...</div>}
      {err && <div style={{ ...card, borderColor: '#ef4444', color: '#ef4444', marginBottom: 12 }}>
        โหลดไม่สำเร็จ: {err} <button onClick={load} style={{ ...btn, marginLeft: 8 }}>ลองใหม่</button>
      </div>}

      {/* โหลดไม่ครบต้องพูด — ห้ามแสดง 0 เหมือนไม่มีข้อมูลจริง */}
      {!!data?.warn?.length && (
        <div style={{ ...card, borderColor: '#f59e0b', color: '#f59e0b', fontSize: 12.5, marginBottom: 12 }}>
          ⚠ ตัวเลขบางส่วนโหลดไม่ครบ ({data.warn.join(' · ')}) — ค่าที่เห็นอาจต่ำกว่าความจริง
        </div>
      )}
      {data?.empty && (
        <div style={{ ...card, borderColor: '#f59e0b', color: '#f59e0b', fontSize: 12.5, marginBottom: 12 }}>
          ส่วนงาน {section} ยังไม่มีไลน์ผลิตในทะเบียน — ตั้งได้ที่ ⚙️ ตั้งค่าไลน์
        </div>
      )}
      {data && !data.empty && data.openSess > 0 && (
        <div style={{ ...card, borderColor: '#f59e0b', color: '#f59e0b', fontSize: 12.5, marginBottom: 12 }}>
          ⏳ วันนี้ยังมี {data.openSess} กะที่ยังไม่ปิด — ตัวเลขของวันนี้ยังไม่ครบทั้งวัน
        </div>
      )}

      {/* ═══ บอร์ดหลัก — กริดตามกระดาษ (คอลัมน์ = กลุ่มไลน์ × 8 หัวข้อ) ═══════════ */}
      {board && !!board.cols.length && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
            <b style={{ fontSize: 13, color: 'var(--text)' }}>📋 บอร์ด {section} — {board.cols.length} กลุ่มไลน์</b>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>
              ตัวเลข = สะสมเดือน {date.slice(0, 7)} · ⚡ ระบบคำนวณให้ · ✍️ ต้องกรอกที่ 📑 KPI รายเดือน
            </span>
            {canAccessPage('/dept-dashboard', role) && (
              <button onClick={() => navigate(`/dept-dashboard?view=kpi${section ? `&section=${encodeURIComponent(section)}` : ''}`)}
                style={{ ...btn, marginLeft: 'auto', padding: '4px 10px', fontSize: 12 }}>
                📑 KPI รายเดือน / ตั้งเป้า
              </button>
            )}
          </div>
          <div style={{
            display: 'grid', gap: 10, alignContent: 'start',
            gridTemplateColumns: isMobile ? '1fr' : `repeat(auto-fit, minmax(260px, 1fr))`,
          }}>
            <SectionPanel section={section} rows={board.secRows}
              onOpenKpi={() => {
                const to = '/dept-dashboard';
                if (canAccessPage(to, role)) navigate(`${to}?view=kpi${section ? `&section=${encodeURIComponent(section)}` : ''}`);
              }} />
            {board.cols.map(c => (
              <BoardColumn key={c.group} col={c}
                onOpenGroup={canAccessPage('/dashboard', role) ? () => navigate(`/dashboard?line=${encodeURIComponent(c.group)}`) : undefined}
                onOpenKpi={(col, r) => {
                  /* ⚠️ ปลายทางต้องผ่าน canAccessPage เสมอ — ไม่มีสิทธิ์ = ไม่พาไปแล้วโดนเด้ง */
                  const to = r.auto === 'safety' ? null
                    : r.auto ? '/oee-analytics'
                      : `/dept-dashboard?view=kpi${section ? `&section=${encodeURIComponent(section)}` : ''}`;
                  if (r.auto === 'safety' && canRecord) { setShowSafety({ section, line_name: col.group }); return; }
                  if (to && canAccessPage(to.split('?')[0], role)) navigate(to);
                }} />
            ))}
          </div>
          {/* ห้ามให้เหตุการณ์ความปลอดภัยหายไปจากสายตาเพราะไม่ได้ระบุไลน์ */}
          {board.orphanSafety > 0 && (
            <div style={{ fontSize: 11.5, color: '#f59e0b', marginTop: 6 }}>
              ⚠ เดือนนี้มีเหตุการณ์ความปลอดภัย {board.orphanSafety} รายการที่ไม่ได้ระบุไลน์ — ไม่ถูกนับในคอลัมน์ไหนเลย (ดูรวมที่การ์ด Safety ด้านล่าง)
            </div>
          )}
          {board.known < board.total && (
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>
              ⓘ ยังประเมินไม่ได้ {board.total - board.known} ช่อง — ช่อง ✍️ ต้องมีคนกรอกค่า และทุกช่องต้องตั้ง "เป้าตัวเลข + ทิศทาง"
              ก่อนถึงจะขึ้นไฟ G/Y/R (ไม่มีเป้า = เทา ไม่ใช่ผ่าน)
            </div>
          )}
          {data?.kpiMissing && (
            <div style={{ fontSize: 11.5, color: '#f59e0b', marginTop: 6 }}>
              ⚠ ยังไม่ได้ apply migration ตาราง KPI กรอกมือ — แถว ✍️ ทั้งหมดจะว่างจนกว่าจะ apply (แจ้ง admin)
            </div>
          )}
        </div>
      )}
      {board && !board.cols.length && !data?.empty && (
        <div style={{ ...card, borderColor: '#f59e0b', color: '#f59e0b', fontSize: 12.5, marginBottom: 12 }}>
          ส่วนงาน {section} ยังไม่มี "ไลน์แม่" ในทะเบียน — บอร์ดแบ่งคอลัมน์ตามกลุ่มไลน์ ตั้งได้ที่ ⚙️ ตั้งค่าไลน์
        </div>
      )}

      {axes && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
            <b style={{ fontSize: 13, color: 'var(--text)' }}>📊 ภาพรวมส่วนงาน (SQCDM)</b>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>
              รวมทั้ง {section} รายวัน — ของแถมที่บอร์ดกระดาษไม่มี (บอร์ดกระดาษเป็นรายกลุ่มไลน์ รายเดือน)
            </span>
          </div>
          <div style={{
            display: 'grid', gap: 12,
            gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(280px, 1fr))', alignContent: 'start',
          }}>
            {axes.map(a => <AxisCard key={a.key} axis={a} isMobile={isMobile} onOpen={() => openAxis(a)} />)}
          </div>
        </div>
      )}

      {/* 🚨 งานที่ต้องตามแก้ — หัวใจของ Obeya: ทุกตัวแดงต้องมีคนถืองานอยู่ */}
      {data && !data.empty && (
        <div style={{ ...card, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <b style={{ fontSize: 13, color: 'var(--text)' }}>🚨 งานที่ต้องตามแก้ ({todo.length})</b>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>
              จากประชุมเช้า + เหตุการณ์ความปลอดภัยที่ยังไม่ปิด · เกินกำหนดขึ้นก่อน
            </span>
            {canAccessPage('/morning-meeting', role) && (
              <button onClick={() => navigate('/morning-meeting')} style={{ ...btn, marginLeft: 'auto', padding: '4px 10px', fontSize: 12 }}>
                📋 ประชุมแถวเช้า
              </button>
            )}
          </div>
          {!todo.length ? (
            <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
              ✅ ไม่มีงานค้างในส่วนงานนี้
              {data.actsMissing ? ' (⚠ ตาราง meeting_action_items ยังไม่มี — แจ้ง admin)' : ''}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {todo.slice(0, 8).map(t => {
                const overdue = t.due && t.due < date;
                return (
                  <div key={t.id}
                    onClick={t.kind === 'safety' && canRecord ? () => setShowSafety(t.ev) : (t.to && canAccessPage(t.to, role) ? () => navigate(t.to) : undefined)}
                    style={{
                      display: 'flex', gap: 9, alignItems: 'flex-start', padding: '7px 9px', borderRadius: 8,
                      background: 'var(--bg2)', borderLeft: `4px solid ${overdue ? '#ef4444' : t.color}`,
                      cursor: (t.kind === 'safety' && canRecord) || (t.to && canAccessPage(t.to, role)) ? 'pointer' : 'default',
                    }}>
                    <span style={{ fontSize: 15 }}>{t.icon}</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 12.5, color: 'var(--text)' }}>{t.title}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                        {t.meta}
                        {t.due && <span style={{ color: overdue ? '#ef4444' : 'var(--muted)', fontWeight: overdue ? 800 : 400 }}>
                          {t.meta ? ' · ' : ''}{overdue ? '⏰ เกินกำหนด ' : 'กำหนด '}{t.due}
                        </span>}
                      </div>
                      {t.warn && <div style={{ fontSize: 10.5, color: '#f59e0b' }}>⚠ {t.warn}</div>}
                    </div>
                  </div>
                );
              })}
              {todo.length > 8 && (
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>+ อีก {todo.length - 8} รายการ</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* เหตุการณ์ความปลอดภัยล่าสุด (รวมที่ปิดแล้ว) */}
      {data && !data.safetyMissing && (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <b style={{ fontSize: 13, color: 'var(--text)' }}>🛡️ เหตุการณ์ความปลอดภัยล่าสุด — {section || 'ทุกส่วนงาน'}</b>
            {canRecord && <button onClick={() => setShowSafety({})} style={{ ...btn, padding: '4px 10px', fontSize: 12 }}>＋ บันทึก</button>}
          </div>
          <ReadOnlyNote show={!canRecord} role={role} compact what="บันทึกเหตุการณ์ความปลอดภัย" permKey="safety:record" />
          {!recent.length ? (
            <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
              ยังไม่มีการบันทึกเหตุการณ์ในส่วนงานนี้
              {canRecord ? ' — เริ่มจากบันทึกอุบัติเหตุครั้งล่าสุด (ถ้ามี) เพื่อให้ระบบนับวันปลอดอุบัติเหตุได้' : ''}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {recent.map(e => {
                const k = safetyKind(e.kind);
                return (
                  <div key={e.id} onClick={canRecord ? () => setShowSafety(e) : undefined}
                    style={{
                      display: 'flex', gap: 9, alignItems: 'flex-start', padding: '7px 9px', borderRadius: 8,
                      background: 'var(--bg2)', borderLeft: `4px solid ${k.color}`, cursor: canRecord ? 'pointer' : 'default',
                    }}>
                    <span style={{ fontSize: 15 }}>{k.icon}</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 12.5, color: 'var(--text)' }}>
                        <b style={{ color: k.color }}>{k.short}</b>
                        {k.unknown && <span style={{ color: '#f59e0b', fontSize: 10.5 }}> (ชนิดไม่รู้จัก)</span>}
                        <span style={{ color: 'var(--muted)' }}> · {e.event_date}{e.line_name ? ` · ${e.line_name}` : ''}</span>
                        {e.status === 'open' && <span style={{ marginLeft: 6, fontSize: 10.5, color: '#f59e0b', fontWeight: 800 }}>ยังไม่ปิด</span>}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--text2)' }}>{e.description}</div>
                      {!e.countermeasure && e.status === 'open' && (
                        <div style={{ fontSize: 10.5, color: '#f59e0b' }}>⚠ ยังไม่ได้ลงมาตรการแก้ไข</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10, lineHeight: 1.7 }}>
        ตัวเลขรายวันนับเฉพาะ<b>กะที่ปิดแล้ว</b> · OEE = ค่าที่ stamp ตอนปิดกะ ถ่วงน้ำหนักเวลารับภาระ ·
        PPM = ของเสีย ÷ ยอดที่ผลิตทั้งหมด (สแกนดี + เสีย) × 10⁶ ไม่รวมงานทดลอง · Downtime นับเฉพาะนอกแผน ·
        แกนที่ยังไม่มีเป้าในระบบจะเทียบกับ<b>ค่าเฉลี่ยตัวเอง {TREND_DAYS - 1} วันก่อน</b> (เขียนกำกับบนการ์ด)
      </div>

      {showSafety && (
        <SafetyEventModal
          init={showSafety} section={section} date={date}
          lineOpts={lineNames} sectionOpts={sectionOpts}
          onClose={() => setShowSafety(null)}
          onSaved={() => { setShowSafety(null); load(); }}
        />
      )}
    </div>
  );
}
