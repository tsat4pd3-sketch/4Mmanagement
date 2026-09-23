import { useState, useEffect, useMemo, useCallback, useContext } from 'react';
import { supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import PageHeader from '../components/PageHeader';
import ParetoAbcChart from '../components/ParetoAbcChart';
import { splitUnclassified, unclassifiedNote } from '../utils/unclassified';
import { buildCategoryIndex, fillCategories } from '../utils/autoCategory';
import { deptNameOf, visibleToTeam } from '../utils/mtnTeams';
import MtnKpiPanel from '../components/MtnKpiPanel';
import useTabParam from '../utils/useTabParam';
import useProductionLines from '../utils/useProductionLines';
import fetchAllRows from '../utils/fetchAllRows';
import { toast } from '../components/Toast';
import TimeRangeBar from '../components/TimeRangeBar';
import useTimeRange from '../utils/useTimeRange';
import { rangeDays, addDays, bucketAxis, bucketKey, bucketLabel, bkkHourKey, scaleOf } from '../utils/timeRange';
import { getWorkDate } from '../utils/workDate';
import { inSectionScope } from '../utils/sectionScope';
import { getLineFamilyNames } from '../utils/lineHierarchy';
import { ASSET_CLASSES, assetClassOf } from '../utils/qc7';
import { Panel, NotEnough, Histogram, ControlChart, ScatterPlot, Fishbone, CheckSheet, Stratify, RunChart } from '../components/Qc7Charts';

/* ══ 🔍 วิเคราะห์ปัญหา (ซ่อมบำรุง) — QC 7 Tools แยกตามชนิดสินทรัพย์ ══════════  2026-09-22

   ที่มา (คำสั่ง user): *"หมวด mtn ยังไม่มีพวก dashboard ปัญหา เครื่องจักร/แม่พิมพ์/jig fixture
   เลย สรุปปัญหา ระบบวิเคราะห์ qc7tools ยังไม่เห็น"*

   ทำไมเป็นหน้าใหม่ ไม่ใช่แท็บที่ 6 ของ `/mtn-repair`:
     · `/mtn-repair` = **หน้าทำงาน** (เปิดใบ/เดินขั้น/คลังอะไหล่) · หน้านี้ = **หน้าวิเคราะห์** อ่านอย่างเดียว
     · chunk ของ MtnRepair 347 KB อยู่แล้ว — ยัดกราฟเข้าไปอีกคือทุกคนที่แค่จะเปิดใบต้องโหลดตาม
     · user พูดถึง "หมวด mtn" (เมนู) ไม่ใช่ "หน้าแจ้งซ่อม" ⇒ ต้องมีรายการเมนูของตัวเอง

   🔴 แกนชนิดสินทรัพย์ **ห้ามใช้ `mtn_orders.mtn_dept`** — วัดจริง 22/09: 422 จาก 473 ใบเป็นทีม
      `production` (ช่างประจำไลน์) ซึ่งซ่อมทั้งเครื่อง/จิ๊ก/แม่พิมพ์ปนกัน ⇒ แยกด้วยทีม = แท็บแม่พิมพ์
      กับ JIG ว่างทั้งที่มีงานจริง · ตัวแยกคือ `machines.equipment_kind` (ดู `assetClassOf` ใน utils/qc7.js)

   🔴 กฎความซื่อสัตย์ของจอ: ทุกกราฟที่ข้อมูลไม่พอ **ต้องเขียนบนจอว่าไม่พอพร้อมเหตุผล**
      ห้ามโชว์ 0 ห้ามซ่อนแผง · แท็บที่ไม่มีข้อมูลก็ยังต้องอยู่ (กดเข้าไปแล้วเห็นว่า "ยังไม่มีใบ")

   📊 **2 แท็บใหญ่ (2026-09-22 รอบ 2 · คำสั่ง user "ฟังก์ชันของช่างกระจายหลายหน้า")**
     `?tab=kpi`  = KPI ช่าง (MTTA/MTTR/MDT · ความพึงพอใจ · ความน่าเชื่อถือรายอุปกรณ์)
                   — **ย้ายมาจาก `/mtn-repair?tab=kpi`** ซึ่ง redirect มาที่นี่แล้ว
     `?tab=qc7`  = QC 7 Tools แยกชนิดสินทรัพย์ (ชนิดอยู่ `?asset=` **ไม่ใช่ `?tab=`** — แท็บซ้อนแท็บ
                   ต้องคนละ param ตาม UI-CONVENTIONS §6.8)
   🔴 พาเรโตมีที่เดียวคือแท็บ `qc7` — เดิมซ้ำกับแท็บ KPI ของ `/mtn-repair` (ถอดออกแล้ว)
      **ห้ามเอากลับไปใส่ในแผง KPI อีก** จอเดียวกัน 2 พาเรโตคนละฐาน = คนอ่านเถียงกันว่าเชื่อใบไหน

   ⚠️ egress: หน้านี้ **ไม่ poll ไม่ subscribe** — โหลดตอนเปิด/กดรีเฟรช/เปลี่ยนช่วงเวลาเท่านั้น
      และ `select` เฉพาะคอลัมน์ที่ใช้จริง (`mtn_orders` มี 116 คอลัมน์ — `select('*')` = 1.59 MB/ครั้ง)
   ═════════════════════════════════════════════════════════════════════════════════════════ */

/* คอลัมน์ที่หน้านี้ใช้จริงเท่านั้น — เพิ่มฟิลด์ใหม่ต้องเติมที่นี่ (กฎเพดาน egress CLAUDE.md ข้อ 11) */
const MO_COLS = [
  'id', 'mo_no', 'status', 'report_at', 'accept_at', 'repair_done_at',
  'machine_no', 'item_type', 'line_name', 'mtn_dept',
  'problem_group', 'problem_characteristic', 'report_note',
  'cause_category', 'cause_other', 'root_cause', 'solution',
  'labor_cost', 'parts_cost', 'repair_type',
  // แผง KPI ช่าง (MtnKpiPanel): ความพึงพอใจ + ช่วงที่อยู่กับ supplier (techRepairMin หักออกจาก MTTR)
  'satisfaction', 'vendor_sent_at', 'vendor_back_at',
].join(',');
const DT_COLS = 'id, machine_no, description, duration_min, started_at, fix_action, fix_by, call_mtn_team';

/* ⏱️ ช่วงย้อนหลังย้ายไปแถบกลาง `<TimeRangeBar>` (ปุ่ม 30/60/90/120 + เลือกช่วงเองได้) — UI §6.16 */

const SOURCES = [
  /* 🔴 หน้านี้เป็นโมดูล **ซ่อมบำรุง** ⇒ นับเฉพาะงานที่ "มีการติดต่อช่าง" (user 23/09)
     วัดจริง 90 วัน: ดาวน์ไทม์ 9,600 ครั้ง แต่ **เรียกช่างแค่ 308 (3.2%)**
     ⇒ เดิมลากงานที่ไม่เกี่ยวกับช่างมา 96.8% — พาเรโตของจอซ่อมบำรุงเลยไม่ใช่ปัญหาของช่าง
     ชุดข้อมูล = ใบ MO ทั้งหมด **+** ดาวน์ไทม์ที่เรียกช่างแล้วแต่ยังไม่ได้เปิดใบ (เหลือ 19 ครั้ง)
     ⇒ ไม่นับซ้ำ เพราะดาวน์ไทม์ที่เปิดใบแล้วถูกนับผ่านใบ MO อยู่แล้ว (`source_downtime_id`) */
  { key: 'mo', label: '🛠️ ใบซ่อม MO', unit: 'ใบ', note: 'งานที่เปิดใบแจ้งซ่อมจริง — มีสาเหตุ/วิธีแก้/ค่าใช้จ่าย' },
];

const fmt = (n, d = 0) => (n == null ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: d }));
const minBetween = (a, b) => {
  if (!a || !b) return null;
  const m = (new Date(b) - new Date(a)) / 60000;
  return Number.isFinite(m) && m >= 0 ? m : null;
};
/* 🪜 คีย์ถังของ "เหตุการณ์ 1 ใบ" ตามขนาดแท่งที่ผู้ใช้เลือก (บันไดกลาง `utils/timeRange`)
   เดิมตรึงเป็นรายสัปดาห์ตายตัว ทั้งที่แถบเวลามีปุ่มสเกลอยู่ — **ปุ่มนั้นไม่เคยถูกใช้เลย**
   (กติกาข้อ 3 ของ TimeRangeBar: ปุ่มตายแย่กว่าไม่มีปุ่ม) · ตอนนี้กราฟ ⑥⑦ ตามสเกลจริงแล้ว
   🔴 ขั้น "ชั่วโมง" ต้องอ่านจาก timestamp จริง (`bkkHourKey` = เวลาไทย)
   🔴 ขั้นอื่นต้องแปลงเป็น **วันทำงาน** ก่อน (`getWorkDate` ตัด 08:00) ไม่ใช่วันปฏิทิน
      ไม่งั้นกะดึกถูกผ่าครึ่งไปอยู่คนละถัง */
const evKey = (iso, scale) => {
  if (!iso) return '';
  if (scale === 'hour') return bkkHourKey(iso) || '';
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? (bucketKey(getWorkDate(d), scale) || '') : '';
};

const KPI = ({ label, value, unit, sub, warn }) => (
  <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '9px 11px', minWidth: 0 }}>
    <div style={{ fontSize: 11.5, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
    <div style={{ fontSize: 19, fontWeight: 800, color: value == null ? 'var(--muted)' : warn ? '#f59e0b' : 'var(--text)', lineHeight: 1.25 }}>
      {value == null ? '—' : value}{value != null && unit ? <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}> {unit}</span> : null}
    </div>
    {/* ค่า null = "ยังวัดไม่ได้" ต้องเขียนบอก ไม่ใช่โชว์ 0 ให้คนอ่านว่าดีเยี่ยม */}
    <div style={{ fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.45 }}>{value == null ? 'ยังไม่มีข้อมูลพอ' : sub}</div>
  </div>
);

const MAIN_TABS = [
  { key: 'kpi', label: '📊 KPI ช่าง' },
  { key: 'qc7', label: '🧪 QC 7 Tools (แยกชนิดอุปกรณ์)' },
];

export default function MtnAnalysis() {
  const { role, lineId, sections } = useContext(UserContext);
  const [tab, setTab] = useTabParam(MAIN_TABS.map(t => t.key), 'kpi');
  // ⚠️ ชนิดสินทรัพย์ใช้ `?asset=` — แท็บซ้อนแท็บห้ามใช้ `?tab=` ซ้ำ (UI-CONVENTIONS §6.8)
  const [asset, setAsset] = useTabParam(ASSET_CLASSES.map(a => a.key), 'machine', 'asset');
  /* ⏱️ แถบเวลามาตรฐาน — เดิมเป็น dropdown "ย้อนหลัง N วัน" อย่างเดียว เลือกช่วงเองไม่ได้
     ⇒ ดูเดือนที่แล้วย้อนหลังไม่ได้เลย ต้องเลือกช่วงกว้างแล้วกวาดตาหาเอง (UI §6.16) */
  const tr = useTimeRange({ defaultScale: 'week', defaultDays: 90 });
  const days = rangeDays(tr.from, tr.to) || 90;
  const [src] = useState('mo');   // คงไว้เพื่อ unit/ป้ายข้อความ — ไม่มี UI สลับแล้ว
  const [team, setTeam] = useState('all');   // แผนกช่าง (แทน dropdown แหล่งข้อมูลเดิม)
  const [orders, setOrders] = useState([]);
  const [dts, setDts] = useState([]);
  const [kindByMc, setKindByMc] = useState({});
  const [taxo, setTaxo] = useState([]);      // ทะเบียนอาการ + ทะเบียนดาวน์ไทม์ → พจนานุกรมเดาหมวด
  const [machines, setMachines] = useState([]);   // แถวเต็ม — แผง KPI ส่งต่อให้ MachineReliability
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    /* ⚠️ ต้องมีขอบบนด้วย — ของเดิมมีแต่ `gte(since)` ⇒ เลือกช่วงในอดีตไม่ได้เลย (ลากถึงวันนี้เสมอ)
       ขอบบน = สิ้นวันของ `to` (บวก 1 วันแล้วใช้ `lt`) เพื่อกินทั้งวันสุดท้ายรวมกะดึก */
    const since = new Date(`${tr.from}T00:00:00`).toISOString();
    const until = new Date(`${addDays(tr.to, 1)}T00:00:00`).toISOString();
    try {
      /* ทะเบียนเครื่อง = ตัวตัดสินชนิดสินทรัพย์ · เลขเครื่องซ้ำได้ในทะเบียน → ตัวแรกชนะ
         (ไม่ใช่การตัดสินใจเชิงธุรกิจ แค่ต้องคงที่ ไม่ให้แท็บเปลี่ยนไปมาระหว่างโหลด) */
      /* 🔴 `fetchAllRows` คืน **`{ data, error }`** ไม่ใช่อาร์เรย์ — ต้อง destructure เสมอ
         (เคยพลาดจริง 22/09: เอาไปใช้เป็นอาร์เรย์ตรงๆ ⇒ `.forEach is not a function`
          แล้วถูก try/catch กลืนเป็น "โหลดข้อมูลไม่สำเร็จ" ทั้งหน้า · build/lint/crashsweep ผ่านหมด)
         และต้องอ่าน `error` ด้วย — supabase-js ไม่ throw (กฎเหล็ก DB ข้อ 1) */
      const [mcs, mo, dt, pt, dtt] = await Promise.all([
        fetchAllRows(supabaseDR, 'machines', 'id, line_name, machine_no, machine_name, equipment_kind', q => q.eq('is_active', true).order('sort_order')),
        fetchAllRows(supabaseDR, 'mtn_orders', MO_COLS, q => q.gte('report_at', since).lt('report_at', until).order('report_at', { ascending: false })),
        fetchAllRows(supabaseDR, 'downtime_logs', DT_COLS, q => q.gte('started_at', since).lt('started_at', until).order('started_at', { ascending: false })),
        /* ทะเบียน taxonomy = พจนานุกรมของตัวเดาหมวด (utils/autoCategory) — ตารางเล็กทั้งคู่
           🔴 พจนานุกรมต้องมาจากทะเบียนที่โรงงานเขียนเอง ห้าม hardcode คำในโค้ด (CLAUDE.md) */
        fetchAllRows(supabaseDR, 'mtn_problem_types', 'team, group_name, characteristic, shared_teams'),
        fetchAllRows(supabaseDR, 'dr_downtime_types', 'name_th, mo_problem_group'),
      ]);
      /* ⚠️ ทะเบียน taxonomy เป็น **ของเสริม** (ใช้เดาหมวดเท่านั้น) — ล้มแล้วห้ามทำทั้งหน้าพัง
         ⇒ ไม่เอา pt/dtt เข้า firstErr · จอยังอ่านได้ปกติ แค่เดาหมวดได้น้อยลง */
      const firstErr = [mcs, mo, dt].map(r => r?.error).find(Boolean);
      if (firstErr) throw new Error(firstErr.message || String(firstErr));
      const mcRows = mcs?.data || [], moRows = mo?.data || [], dtRows = dt?.data || [];
      const map = {};
      mcRows.forEach(m => {
        const k = String(m?.machine_no || '').trim().toUpperCase();
        if (k && !map[k]) map[k] = m.equipment_kind;
      });
      setKindByMc(map); setMachines(mcRows); setOrders(moRows); setDts(dtRows);
      setTaxo([
        ...(pt?.data || []).map(r => ({ label: r.characteristic, group: r.group_name, team: r.team, shared_teams: r.shared_teams })),
        ...(dtt?.data || []).map(r => ({ label: r.name_th, group: r.mo_problem_group })),
      ]);
    } catch (e) {
      setErr(e?.message || String(e));
      toast.error('โหลดข้อมูลวิเคราะห์ไม่สำเร็จ: ' + (e?.message || e));
    } finally { setLoading(false); }
  }, [tr.from, tr.to]);

  useEffect(() => { let alive = true; (async () => { await load(); if (!alive) return; })(); return () => { alive = false; }; }, [load]);

  /* ── แปลงเป็น "แถวเหตุการณ์" รูปแบบเดียว แล้วค่อยแยกแท็บ ─────────────────────
     ทำแบบนี้เพื่อให้กราฟทุกตัวกินข้อมูลชุดเดียวกัน ไม่ต้องรู้ว่ามาจาก MO หรือ downtime */
  const events = useMemo(() => {
    {
      const moDtIds = new Set((orders || []).map(o => o.source_downtime_id).filter(Boolean));
      /* ดาวน์ไทม์ที่ **เรียกช่างแล้ว** แต่ยังไม่ได้เปิดใบ MO — ยังเป็นงานของช่าง ต้องนับ
         ⚠️ `call_mtn_team` แทบไม่มีใครกรอก (307/308 ว่าง) ⇒ ทีมของแถวพวกนี้เป็น "(ไม่ระบุทีม)"
            อย่าเอาไปสรุปว่าทีมนั้นไม่มีงาน — แผนกช่างที่เชื่อถือได้มาจากใบ MO (`mtn_dept`) */
      const dtNoMo = (dts || []).filter(d =>
        !moDtIds.has(d.id) &&
        (d.call_mtn === true || d.call_mtn_at || String(d.call_mtn_team || '').trim()));
      const moEv = (orders || []).map(o => {
        const { cls, known } = assetClassOf(o, kindByMc);
        const ttr = minBetween(o.accept_at, o.repair_done_at);
        const cost = [o.labor_cost, o.parts_cost].some(v => v != null && v !== '')
          ? (Number(o.labor_cost) || 0) + (Number(o.parts_cost) || 0) : null;
        return {
          id: o.id, from: 'mo', cls, clsKnown: known, at: o.report_at,
          asset: (o.machine_no || '').trim() || (o.item_type || '').trim() || '(ไม่ระบุอุปกรณ์)',
          label: o.mo_no || '(ยังไม่ออกเลข)',
          group: (o.problem_group || '').trim() || 'ไม่ระบุกลุ่ม',
          symptom: (o.problem_characteristic || '').trim() || 'ไม่ระบุอาการ',
          cause_category: o.cause_category,
          causeText: [o.root_cause, o.cause_other, o.problem_characteristic, o.report_note].filter(Boolean).join(' '),
          line: (o.line_name || '').trim() || '(ไม่ระบุไลน์)',
          team: (o.mtn_dept || '').trim() || '(ไม่ระบุทีม)',
          minutes: ttr, cost, raw: o,
        };
      });
      const dtEv = dtNoMo.map(d => {
      const { cls, known } = assetClassOf(d, kindByMc);
      const m = d.duration_min == null ? null : Number(d.duration_min);
      return {
        id: d.id, from: 'dt', cls, clsKnown: known, at: d.started_at,
        asset: (d.machine_no || '').trim() || '(ไม่ระบุเครื่อง)',
        label: (d.machine_no || '').trim() || '—',
        group: (d.description || '').trim().slice(0, 40) || 'ไม่ระบุอาการ',
        symptom: (d.description || '').trim() || 'ไม่ระบุอาการ',
        cause_category: null,
        causeText: [d.description, d.fix_action].filter(Boolean).join(' '),
        line: '(ไม่ระบุไลน์)',
        team: (d.call_mtn_team || '').trim() || '(ไม่ระบุทีม)',
        minutes: Number.isFinite(m) ? m : null, cost: null, raw: d,
      };
      });
      return [...moEv, ...dtEv];
    }
  }, [orders, dts, kindByMc]);

  /* ── 🔎 เดาหมวดจากคำที่พนักงานพิมพ์ ก่อนปล่อยให้ตกถัง "อื่นๆ" (user 23/09) ────────
     *"อื่นๆ ยังมาอันดับ 1 — ต้องหาคำอื่นเพื่อจับหมวดให้ได้ก่อน อื่นๆ ต้องเป็นของที่ลงไม่ได้จริงๆ"*
     พจนานุกรมมาจาก**ข้อมูลของโรงงานเอง 2 แหล่ง ไม่มีคำ hardcode ในโค้ด**:
       1. ทะเบียน taxonomy (`mtn_problem_types` + `dr_downtime_types.mo_problem_group`)
       2. ใบที่ช่าง**จัดกลุ่มไปแล้ว** + ข้อความอิสระของใบนั้น — ที่มาของศัพท์หน้างานจริง
          ("observeline" · "พาเลทไม่ไหล" · "หัวทิปตัน") ซึ่งไม่มีวันอยู่ในทะเบียน
     ⇒ โรงงานกรอกมากขึ้น/เพิ่มทะเบียน = เดาเก่งขึ้นเอง ไม่ต้องแก้โค้ด
     ⚠️ **ไม่เขียนกลับฐาน** — เป็นแค่การอ่านของจอ · ใบไหนถูกเดาดูได้ที่มิติ 🔎 ในพาเรโต */
  const catIndex = useMemo(() => buildCategoryIndex([
    ...taxo.map(t => ({ ...t, kind: 'registry' })),
    /* เรียนจาก **ใบ MO เท่านั้น** — แถวดาวน์ไทม์ที่ยังไม่มีใบใช้ข้อความดิบเป็นชื่อกลุ่ม
       (ไม่ใช่กลุ่มจริงในทะเบียน) เอามาสอนจะได้ "กลุ่ม" ปลอมเต็มพจนานุกรม */
    ...events.filter(e => e.from === 'mo')
      .map(e => ({ label: `${e.symptom} ${e.causeText}`, group: e.group, team: e.team, kind: 'seen' })),
  ]), [taxo, events]);

  const typed = useMemo(() => fillCategories(events, catIndex, {
    labelOf: e => e.group,
    textOf: e => `${e.symptom} ${e.causeText}`,
    teamOf: e => (e.team && e.team !== '(ไม่ระบุทีม)' ? e.team : null),
    scopeOf: visibleToTeam,
  }), [events, catIndex]);
  const typedEvents = typed.rows;

  /* ── แผนกช่าง: dropdown เดิม (MO/Downtime) เปลี่ยนเป็นตัวนี้ (user 23/09) ──────
     "ตรงแท็บคือแยกตามอุปกรณ์ใช่มั้ย · dropdown เดิม…เป็นเลือกแผนกช่างดีกว่า"
     ⇒ แท็บ = ชนิดอุปกรณ์ · dropdown = แผนกช่าง · 2 แกนไม่ซ้อนกัน */
  const teamOpts = useMemo(() => {
    const c = {};
    typedEvents.forEach(e => { c[e.team] = (c[e.team] || 0) + 1; });
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [typedEvents]);
  const scopedEvents = useMemo(
    () => (team === 'all' ? typedEvents : typedEvents.filter(e => e.team === team)),
    [typedEvents, team],
  );

  const byClass = useMemo(() => {
    const m = Object.fromEntries(ASSET_CLASSES.map(a => [a.key, []]));
    scopedEvents.forEach(e => { (m[e.cls] || m.other).push(e); });
    return m;
  }, [scopedEvents]);

  /* ขอบเขตไลน์ของผู้ใช้ — **เกณฑ์เดียวกับ `/mtn-repair`** (คัดลอกมาโดยตั้งใจให้เหมือนกันเป๊ะ
     ถ้าจะแก้ ต้องแก้ทั้ง 2 ที่พร้อมกัน ไม่งั้น KPI 2 จอตอบคนละเลขให้คนคนเดียวกัน) */
  const lines = useProductionLines();
  const scopeLines = useMemo(() => {
    if (role === 'admin') return null;
    if (role === 'leader' && lineId) { const self = lines.find(l => String(l.id) === String(lineId)); return self ? new Set(getLineFamilyNames(lines, self.name)) : new Set(); }
    if (sections?.length) return new Set(lines.filter(l => inSectionScope(sections, l.section)).map(l => l.name));
    return null;
  }, [lines, role, lineId, sections]);
  const scopedLineObjs = useMemo(() => (scopeLines ? lines.filter(l => scopeLines.has(l.name)) : lines), [lines, scopeLines]);

  const rows = byClass[asset] || [];
  const srcMeta = SOURCES.find(s => s.key === src);
  const unit = srcMeta.unit;
  /* แกนเต็มของช่วง (รวมถังที่เงียบ) — ส่งเฉพาะถังที่มีข้อมูล = ช่วงเงียบหายจากกราฟ
     แล้วเส้นแนวโน้มลากข้ามไปเหมือนไม่เคยมีช่วงเงียบ */
  const wKeys = useMemo(() => bucketAxis(tr.from, tr.to, tr.scale), [tr.from, tr.to, tr.scale]);
  const bucketWord = scaleOf(tr.scale)?.short || 'ช่วง';

  /* สรุปหัวจอ — ทุกตัวคืน null เมื่อ "ยังวัดไม่ได้" (ห้ามตีเป็น 0) */
  const sum = useMemo(() => {
    const mins = rows.map(r => r.minutes).filter(v => v != null);
    const costs = rows.map(r => r.cost).filter(v => v != null);
    const assets = new Set(rows.map(r => r.asset));
    const sorted = [...mins].sort((a, b) => a - b);
    return {
      n: rows.length,
      assets: assets.size,
      totalMin: mins.length ? mins.reduce((a, b) => a + b, 0) : null,
      avgMin: mins.length ? mins.reduce((a, b) => a + b, 0) / mins.length : null,
      medMin: sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null,
      noMin: rows.length - mins.length,
      cost: costs.length ? costs.reduce((a, b) => a + b, 0) : null,
      noCost: rows.length - costs.length,
      guessed: rows.filter(r => !r.clsKnown).length,
    };
  }, [rows]);

  /* อุปกรณ์ = 1 จุดในผังกระจาย (ซ่อมกี่ครั้ง ↔ เสียเวลารวมเท่าไหร่) */
  const perAsset = useMemo(() => {
    const m = {};
    rows.forEach(r => {
      const g = m[r.asset] || (m[r.asset] = { asset: r.asset, times: 0, minutes: 0, hasMin: 0 });
      g.times++;
      if (r.minutes != null) { g.minutes += r.minutes; g.hasMin++; }
    });
    // อุปกรณ์ที่ไม่มีเวลาสักครั้งเดียว = ตีเป็น 0 นาทีไม่ได้ ⇒ ตัดออกจากผังกระจาย (แต่ยังนับใน KPI)
    return Object.values(m).filter(g => g.hasMin > 0);
  }, [rows]);

  /* 🔴 พาเรโต "ปัญหา" ต้องไม่นับ **งานตามแผน (PM)** (user ตัดสิน 23/09 "แยกออก ไม่ใช่ปัญหา")
     เปลี่ยนของตามรอบ = งานที่ตั้งใจทำ ไม่ใช่ของเสีย/ของพัง — นับรวมแล้วพาเรโตชี้เป้าผิด
     ⚠️ **แยกออก ≠ ซ่อน** — ต้องบอกบนจอว่ากันออกไปกี่ใบ (กฎความซื่อสัตย์ของจอ) */
  const paretoSplit = useMemo(
    () => splitUnclassified(rows, { labelOf: r => r.group, textOf: r => r.causeText }),
    [rows],
  );
  const paretoRecords = useMemo(() => [...paretoSplit.ok, ...paretoSplit.vagueWithText, ...paretoSplit.blank]
    .map(r => ({
      cat: r.group, value: 1, sub: r.symptom, machine: r.asset, line: r.line, team: r.team, note: r.causeText,
      /* 🔎 ที่มาของหมวด — ใบที่ระบบเดาให้ ต้องตรวจสอบย้อนได้ว่าเดาจากคำไหน
         (กฎความซื่อสัตย์ของจอ: เดาแล้วต้องบอกว่าเดา ห้ามกลืนเป็นข้อมูลที่คนกรอก) */
      why: r.autoFrom ? `🔎 ระบบเดาจากคำ: ${r.autoFrom.terms.join(' · ')}` : '👷 ช่างเลือกเอง',
    })), [paretoSplit]);
  const paretoNote = useMemo(() => unclassifiedNote(paretoSplit, { unit: 'ใบ' }), [paretoSplit]);

  /* มิติเจาะลึกของ ParetoAbcChart = **ชื่อคีย์ในแถวดิบ** (component อ่าน `r[dim.key]` เอง)
     ⚠️ ห้ามใส่ฟังก์ชัน `of` — มันไม่ถูกเรียก แล้วจะได้ช่องว่างเงียบๆ */
  const PARETO_DIMS = useMemo(() => ([
    { key: 'sub', label: '🛑 อาการย่อย' },
    { key: 'machine', label: '⚙️ อุปกรณ์' },
    { key: 'line', label: '🏭 ไลน์' },
    { key: 'team', label: '👷 ทีมช่าง' },
    { key: 'note', label: '💬 อาการที่แจ้ง (จับกลุ่มคำ)', cluster: true },
    { key: 'why', label: '🔎 ที่มาของหมวด' },
  ]), []);

  const assetTabs = ASSET_CLASSES.map(a => ({
    key: a.key,
    label: `${a.icon} ${a.label}${loading ? '' : ` (${(byClass[a.key] || []).length})`}`,
  }));

  return (
    <div style={{ padding: '14px 16px 40px' }}>
      <PageHeader
        title="วิเคราะห์ปัญหา (ซ่อมบำรุง)" icon="🔍"
        sub={tab === 'kpi'
          ? 'KPI ทีมช่าง — MTTA / MTTR / MDT · ความพึงพอใจ · ความน่าเชื่อถือรายอุปกรณ์'
          : `QC 7 Tools แยกตามชนิดสินทรัพย์ · ${srcMeta.note}`}
        tabs={MAIN_TABS} tab={tab} onTab={setTab}
        actions={
          /* ตัวกรองแหล่งข้อมูล/ช่วงเวลา เป็นของแท็บ QC7 เท่านั้น — แผง KPI มีตัวกรองของตัวเอง
             โชว์ทั้งคู่พร้อมกัน = คนกดแล้วไม่เห็นอะไรเปลี่ยน แล้วคิดว่าจอค้าง */
          tab === 'qc7' ? (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {/* dropdown = **แผนกช่าง** (เดิมเป็นเลือกแหล่งข้อมูล MO/Downtime — user เปลี่ยน 23/09)
                  แท็บด้านล่าง = ชนิดอุปกรณ์ · 2 แกนนี้ตัดกันได้ ไม่ซ้อนกัน */}
              <select value={team} onChange={e => setTeam(e.target.value)} title="แผนกช่างที่รับงาน"
                style={{ width: 200, padding: '6px 8px', borderRadius: 8, background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border)', fontSize: 12.5 }}>
                <option value="all">👷 ทุกแผนกช่าง ({events.length})</option>
                {teamOpts.map(([t, n]) => (
                  <option key={t} value={t}>{deptNameOf(t) || t} ({n})</option>
                ))}
              </select>
            </div>
          ) : (
            <button onClick={load} disabled={loading} style={{ padding: '6px 12px', borderRadius: 8, background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border2)', fontSize: 12.5, cursor: loading ? 'default' : 'pointer' }}>
              {loading ? 'กำลังโหลด…' : '↻ รีเฟรช'}
            </button>
          )
        }
      />

      {/* ⏱️ แถบกรองเวลามาตรฐาน (UI §6.16) — วางเป็นแถวของตัวเองใต้หัวเพจ
          ช่อง `actions` ของ PageHeader แคบเกินไปสำหรับแถบเต็ม (สเกล + ปุ่มย้อนหลัง + ช่วงวัน)
          ⚠️ แท็บ KPI มีตัวกรองของตัวเองในแผง — โชว์ทั้งคู่ = คนกดแล้วไม่เห็นอะไรเปลี่ยน */}
      {tab === 'qc7' && (
        <TimeRangeBar
          scale={tr.scale} from={tr.from} to={tr.to} today={tr.today} finest="hour"
          onScale={tr.setScale} onFrom={tr.setFrom} onTo={tr.setTo} onPreset={tr.setPreset}
          onView={tr.setView} onReload={load} loading={loading} style={{ marginBottom: 12 }}
        />
      )}

      {err && (
        <div style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid #ef4444', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, color: '#ef4444', marginBottom: 12 }}>
          โหลดข้อมูลไม่สำเร็จ — {err} · กด ↻ รีเฟรช อีกครั้ง (ยังไม่ได้แสดงตัวเลขใดๆ เพื่อไม่ให้อ่านผิด)
        </div>
      )}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>⏳ กำลังโหลดข้อมูล {days} วันย้อนหลัง…</div>
      ) : tab === 'kpi' ? (
        /* 📊 KPI ช่าง — ย้ายมาจาก `/mtn-repair?tab=kpi` (ลิงก์เก่า redirect มาที่นี่)
           ใช้ `orders` ชุดเดียวกับแท็บ QC7 ⇒ ไม่ยิงคิวรีเพิ่ม */
        <MtnKpiPanel orders={orders} scopeLines={scopeLines} lineObjs={scopedLineObjs}
          machines={machines} onGoQc7={() => setTab('qc7')} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* ── แถบชนิดสินทรัพย์ (แท็บชั้นที่ 2 · `?asset=`) ─────────────────────
                 🔴 ทุกชนิดต้องอยู่ครบเสมอ แม้จำนวนเป็น 0 — กดเข้าไปแล้วเห็นว่า "ช่วงนี้ไม่มีงาน"
                    ต่างจากการซ่อนแท็บทิ้งซึ่งอ่านว่า "ระบบไม่รองรับของชนิดนี้" */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {assetTabs.map(t => (
              <button key={t.key} type="button" onClick={() => setAsset(t.key)} className="tbtn"
                style={{
                  padding: '6px 12px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                  background: asset === t.key ? 'var(--bg3)' : 'transparent',
                  color: asset === t.key ? 'var(--text)' : 'var(--muted)',
                  border: `1px solid ${asset === t.key ? 'var(--accent)' : 'var(--border)'}`,
                }}>{t.label}</button>
            ))}
          </div>

          {/* ── สรุปปัญหา ─────────────────────────────────────────────── */}
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, alignContent: 'start' }}>
            <KPI label={`เหตุการณ์ (${days} วัน)`} value={sum.n ? fmt(sum.n) : null} unit={unit} sub={`${sum.assets} อุปกรณ์`} />
            <KPI label="เวลาสูญเสียรวม" value={sum.totalMin == null ? null : fmt(sum.totalMin)} unit="นาที"
              sub={sum.noMin ? `⚠️ ${sum.noMin} รายการยังไม่มีเวลา — ไม่ถูกนับ` : 'ครบทุกรายการ'} warn={!!sum.noMin} />
            <KPI label={src === 'mo' ? 'เวลาซ่อมเฉลี่ย' : 'หยุดเฉลี่ยต่อครั้ง'} value={sum.avgMin == null ? null : fmt(sum.avgMin, 1)} unit="นาที"
              sub={sum.medMin == null ? '' : `มัธยฐาน ${fmt(sum.medMin, 1)} นาที`} />
            <KPI label="ค่าใช้จ่ายรวม" value={sum.cost == null ? null : fmt(sum.cost)} unit="บาท"
              sub={sum.noCost ? `⚠️ ${sum.noCost} รายการยังไม่ลงค่าใช้จ่าย` : 'ครบทุกรายการ'} warn={!!sum.noCost} />
            <KPI label="แยกชนิดจากทะเบียน" value={sum.n ? fmt(sum.n - sum.guessed) : null} unit={`/ ${sum.n}`}
              sub={sum.guessed ? `⚠️ ${sum.guessed} รายการระบบเดาชนิดให้` : 'ยืนยันจากทะเบียนเครื่องทุกรายการ'} warn={!!sum.guessed} />
          </div>

          {rows.length === 0 ? (
            <Panel title={`ยังไม่มีเหตุการณ์ในกลุ่ม “${ASSET_CLASSES.find(a => a.key === asset)?.label}”`}
              sub="แท็บนี้ยังอยู่เสมอ ไม่ได้ถูกซ่อน — ว่างแปลว่า “ช่วงนี้ไม่มีงานที่ผูกกับสินทรัพย์กลุ่มนี้” ไม่ใช่จอพัง">
              <NotEnough
                reason={`ไม่พบ${srcMeta.label}ของกลุ่มนี้ในช่วง ${days} วันย้อนหลัง`}
                hint="ลองขยายช่วงเวลา หรือสลับแหล่งข้อมูล · ถ้าแน่ใจว่ามีงานจริง มักเป็นเพราะเลขเครื่องในใบไม่ตรงกับทะเบียน (ไปแก้ที่ทะเบียนเครื่องจักร)" />
            </Panel>
          ) : (
            <>
              {/* ② พาเรโต — component กลางเดิม ไม่ทำใหม่ */}
              {/* กันงานตามแผน + บอกส่วนที่ยังชี้เป้าไม่ได้ — ห้ามเงียบ (utils/unclassified.js) */}
              {(paretoSplit.planned.length > 0 || paretoNote || typed.filled > 0) && (
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 12, marginBottom: 8 }}>
                  {paretoSplit.planned.length > 0 && (
                    <span style={{ color: 'var(--muted)' }}>
                      🗓️ กัน <b style={{ color: 'var(--text2)' }}>{paretoSplit.planned.length} ใบ</b> ที่เป็น “งานตามแผน (PM)” ออกจากพาเรโตปัญหาแล้ว
                    </span>
                  )}
                  {typed.filled > 0 && (
                    <span style={{ color: 'var(--muted)' }} title="พจนานุกรมมาจากทะเบียนอาการของโรงงาน + ใบที่ช่างจัดกลุ่มไว้แล้ว — เจาะดูคำที่ใช้เดาได้ที่มิติ 🔎">
                      🔎 เดาหมวดให้ <b style={{ color: 'var(--text2)' }}>{typed.filled} ใบ</b> จากคำที่พนักงานพิมพ์ (เดิมเป็น “อื่นๆ”) — เจาะดูที่มาได้ในมิติ 🔎
                    </span>
                  )}
                  {paretoNote && (
                    <span style={{ color: paretoNote.level === 'warn' ? '#f59e0b' : 'var(--muted)', fontWeight: paretoNote.level === 'warn' ? 700 : 400 }}>
                      ⚠️ {paretoNote.text}
                    </span>
                  )}
                </div>
              )}
              <ParetoAbcChart
                title={`② พาเรโต — ปัญหาไหนกินสัดส่วนมากที่สุด (${unit})`}
                records={paretoRecords} dims={PARETO_DIMS} unit={unit}
                emptyText="ไม่มีข้อมูลในช่วงนี้"
                sectionStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}
                titleStyle={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }} />

              {/* ③ ก้างปลา */}
              <Panel title="③ ผังก้างปลา — สาเหตุกองอยู่แกนไหน (4M)"
                sub="จัดรายการเข้าแกน คน/เครื่อง/วัสดุ/วิธี/การวัด/สภาพแวดล้อม — ใช้หมวดที่ช่างเลือกไว้ก่อน ไม่มีจึงเดาจากข้อความสาเหตุ">
                <Fishbone records={rows} categoryOf={r => r.cause_category} textOf={r => r.causeText} labelOf={r => r.label}
                  effect={`${ASSET_CLASSES.find(a => a.key === asset)?.label} หยุด/เสียหาย`} />
              </Panel>

              <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: 12, alignContent: 'start' }}>
                {/* ④ ฮิสโตแกรม */}
                <Panel title={`④ ฮิสโตแกรม — ${src === 'mo' ? 'เวลาซ่อม' : 'เวลาหยุด'}กระจายยังไง`}
                  sub="ดูว่างานส่วนใหญ่ใช้เวลาช่วงไหน และมีหางยาวแค่ไหน (หางยาว = งานที่ต้องรออะไหล่/รอ supplier)">
                  <Histogram values={rows} valOf={r => r.minutes} unit="นาที" />
                </Panel>

                {/* ⑥ กราฟควบคุม */}
                <Panel title={`⑥ กราฟควบคุม (XmR) — ${bucketWord}นี้ผิดปกติหรือเปล่า`}
                  sub="เส้นกลาง = ระดับปกติของงานนี้ · จุดแดง = มีสาเหตุเฉพาะให้ไปตามหา ไม่ใช่ความผันแปรธรรมดา">
                  <ControlChart
                    points={(() => {
                      const agg = {};
                      rows.forEach(r => { const k = evKey(r.at, tr.scale); if (k) agg[k] = (agg[k] || 0) + 1; });
                      return wKeys.map(k => ({ label: bucketLabel(k, tr.scale), value: agg[k] || 0 }));
                    })()}
                    unit={unit} />
                </Panel>

                {/* ⑤ ผังกระจาย */}
                <Panel title="⑤ ผังกระจาย — ซ่อมบ่อย ↔ เสียเวลามาก ไปด้วยกันไหม"
                  sub="1 จุด = 1 อุปกรณ์ · มุมขวาบน = ทั้งบ่อยทั้งนาน คือเป้าหมายแรกของการปรับปรุง">
                  <ScatterPlot records={perAsset} xOf={a => a.times} yOf={a => a.minutes} labelOf={a => a.asset}
                    xLabel={`จำนวนครั้ง (${unit})`} yLabel="เวลารวม (นาที)" />
                </Panel>

                {/* ⑦ แนวโน้ม */}
                <Panel title={`⑦ แนวโน้มราย${bucketWord}`} sub="ดูว่าดีขึ้นหรือแย่ลง — ใช้คู่กับกราฟควบคุม (แนวโน้มบอกทิศ · กราฟควบคุมบอกว่าผิดปกติไหม)">
                  <RunChart records={rows} keyOf={r => evKey(r.at, tr.scale)} keys={wKeys} unit={unit} />
                </Panel>
              </div>

              {/* ⑦ แบ่งชั้น */}
              <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: 12, alignContent: 'start' }}>
                <Panel title="⑦ แบ่งชั้น — อุปกรณ์ที่มีปัญหามากที่สุด" sub="เรียงตามจำนวนครั้ง">
                  <Stratify records={rows} keyOf={r => r.asset} unit={unit} top={10} />
                </Panel>
                <Panel title="⑦ แบ่งชั้น — เวลาสูญเสียรวมรายอุปกรณ์" sub="เรียงตามนาที (รายการที่ยังไม่มีเวลาไม่ถูกนับ ไม่ได้ตีเป็น 0)">
                  <Stratify records={rows.filter(r => r.minutes != null)} keyOf={r => r.asset} valOf={r => r.minutes} unit="นาที" top={10} />
                </Panel>
              </div>

              {/* ① ใบตรวจสอบ */}
              <Panel title="① ใบตรวจสอบ — นับไขว้ อุปกรณ์ × กลุ่มปัญหา"
                sub="ตารางนับแบบใบเช็กชีตกระดาษ · ช่องเข้มแดง = จุดที่ซ้ำบ่อยที่สุด ให้เริ่มแก้ตรงนั้น">
                <CheckSheet records={rows} rowOf={r => r.asset} colOf={r => r.group} rowLabel="อุปกรณ์" colLabel="กลุ่มปัญหา" />
              </Panel>
            </>
          )}

          <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.8 }}>
            📌 แหล่งข้อมูล: {src === 'mo' ? 'mtn_orders (ใบแจ้งซ่อม)' : 'downtime_logs (บันทึกเครื่องหยุดจาก Daily Report)'} ·
            ชนิดสินทรัพย์ตัดสินจากทะเบียนเครื่องจักร (`machines.equipment_kind`) ไม่ใช่ทีมช่างที่รับงาน ·
            หน้านี้อ่านอย่างเดียว ไม่แก้ข้อมูล และไม่ดึงซ้ำอัตโนมัติ (กด ↻ เมื่อต้องการข้อมูลล่าสุด)
          </div>
        </div>
      )}
    </div>
  );
}
