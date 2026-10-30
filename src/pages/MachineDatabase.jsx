import { useState, useEffect, useCallback, useMemo, useContext } from 'react';
import ReadOnlyNote from '../components/ReadOnlyNote';
import { supabase, supabaseDR } from '../supabaseClient';
import { loadLinesRes } from '../utils/useProductionLines';
/* 🔀 จำนวนเลนของไลน์เครื่องขนาน — source of truth เดียวกับสูตร OEE (ห้ามอ่าน parallel_stations เอง) */
import { parallelUnitsOf, isParallelLine } from '../utils/lineTypes';
import { invalidateAffectsLanes } from '../utils/affectsLanes';
import { UserContext } from '../App';
import { invalidateTable } from '../utils/masterInvalidate';
import { toast } from '../components/Toast';
import { can, canDelete as canDeleteUtil } from '../utils/permissions';
import { EQUIPMENT_KINDS, kindOf, kindLabel, kindIcon } from '../utils/equipmentKinds';   // แม่พิมพ์/จิ๊กไม่ใช่เครื่องจักร — กรองแยกกัน
import { inSectionScope } from '../utils/sectionScope';
import { getAncestorNames, getLineFamilyNames, lineNameCompare } from '../utils/lineHierarchy';
import { loadMachineTraits, activeAutomationLevels, activeOperationModes, automationDisplay, operationDisplay } from '../utils/machineTraits';
import EmojiPicker from '../components/EmojiPicker';
import { pickUnusedColor } from '../utils/colorPick';
import { checkWrite, checkWriteRows } from '../utils/dbWrite';
import { normalizeBrand, suggestBrand, brandProposals } from '../utils/machineBrand';
import LineSelect from '../components/LineSelect';
import Page from '../components/Page';
import PageHeader from '../components/PageHeader';
import FilterBar from '../components/FilterBar';
import SearchInput from '../components/SearchInput';
import { ALL, allOf } from '../utils/filterLabels';
import { DeleteButton } from '../components/IconButton';
import MachineRepairHistory from '../components/MachineRepairHistory';
import { showsShutHeight } from '../utils/pressMachine';
import { useNavigate } from 'react-router-dom';

/* ─── shared little UI bits ─────────────────────────────────── */
function Field({ label, hint, children }) {
  return (
    <div>
      <label style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 4 }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

/* ช่องตัวเลขที่ "ว่าง = ไม่รู้" — ห้ามแปลงเป็น 0 (0 คือคำตอบ null คือไม่มีคำตอบ) */
const numOrNull = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));

const inputStyle = {
  width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--bg)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box',
};
const saveBtnStyle = {
  background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8,
  padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
};
const cancelBtnStyle = {
  background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border)',
  borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer',
};

const emptyMachine = { id: null, line_name: '', machine_no: '', machine_name: '', machine_type_id: '', sort_order: 0, is_active: true, equipment_category: 'production', equipment_kind: 'machine', automation_level: '', operation_mode: '', gang_count: '', shut_height_min_mm: '', shut_height_max_mm: '', io_no: '', affects_lanes: '', stops_whole_line: false };
// หมวดอุปกรณ์ในฐานเครื่องจักร — Facility/Utility ไม่ผูกไลน์ผลิต (ระบบน้ำ/ลม/High Pressure ฯลฯ)
// รวม Facility + Utility เป็นหมวดเดียว (ทีมช่างดูแลทีมเดียวกัน + แยกยาก · คำสั่ง user 2026-07-24)
// ค่าใน DB ใช้ 'facility' เป็นตัวแทน · 'utility' เดิม migrate มาเป็น facility แล้ว (โค้ดที่เหลือเช็ค !== 'production' อยู่แล้ว)
const EQUIP_CATS = [
  { v: 'production', t: '🏭 ไลน์ผลิต' },
  { v: 'facility',   t: '🔧 Facility / Utility' },
];
// utility เดิม (ก่อน apply migration รวมหมวด) → นับเป็น facility ทุกที่ · ค่าว่าง = production
const normCat = (c) => (c === 'utility' ? 'facility' : (c || 'production'));
const emptyType    = { id: null, label: '', color: '#4d9fff', icon: '', sort_order: 0, is_active: true };
const TYPE_COLORS  = ['#4d9fff', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#ec4899', '#06b6d4', '#84cc16', '#6b7280'];

/* ═══════════════════════════════════════════════════════════════
   MAIN PAGE
═══════════════════════════════════════════════════════════════ */
export default function MachineDatabase() {
  const { role, lineId: userLineId, sections: scopeSecs } = useContext(UserContext);
  const canCreate = can('machines', 'create', role);
  const canEdit   = can('machines', 'edit', role);
  /* 🖥️🔴 ต้องผ่าน `canDelete()` ของกลาง (utils/permissions.js) — เดิมประกาศตัวแปรชื่อ `canDelete`
     ทับ util แล้วเรียกแค่ `can(...)` ⇒ อ่านโค้ดเหมือนมีด่าน แต่ **ด่าน "บัญชีกลางห้ามลบ" ไม่ทำงาน**
     (ออดิท 13/10 เจอแบบนี้ 5 หน้า) · เปลี่ยนชื่อตัวแปรเป็น `mayDelete` + เรียก util ผ่าน alias
     ⚠️ ห้ามตั้งชื่อตัวแปรท้องถิ่นว่า `canDelete` อีก — มีด่าน `no-shadow-candelete` */
  const mayDelete = canDeleteUtil('machines', 'create', role);

  const [machines, setMachines]     = useState([]);
  const [lines, setLines]           = useState([]);
  const [types, setTypes]           = useState([]);
  const [loading, setLoading]       = useState(true);

  const [search, setSearch]         = useState('');
  const [filterCat, setFilterCat]   = useState('');   // '' = ทุกหมวด | production | facility | utility
  // ⚠️ ชนิดอุปกรณ์ — default 'machine' เพราะหน้านี้คือ "ฐานข้อมูลเครื่องจักร"
  //    ข้อมูลจริง 2026-08-10: 262/505 แถวเป็น "แม่พิมพ์" ที่ถูกลงผิดที่ (ดู utils/equipmentKinds.js)
  //    ถ้าไม่กรอง แม่พิมพ์จะปนใน dropdown เลือกเครื่อง + นับเป็นเครื่องจักรในสถิติ
  const [filterKind, setFilterKind] = useState('machine');
  const [filterLine, setFilterLine] = useState('');
  const [filterType, setFilterType] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  // §139 ย่อ/ขยายกลุ่มไลน์ — จำ override ของ user ใน localStorage (default = กาง)
  const [collapsedGroups, setCollapsedGroups] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('md_group_collapse') || '[]')); } catch { return new Set(); }
  });
  const toggleGroup = (name) => setCollapsedGroups(prev => {
    const next = new Set(prev); next.has(name) ? next.delete(name) : next.add(name);
    try { localStorage.setItem('md_group_collapse', JSON.stringify([...next])); } catch { /* ignore */ }
    return next;
  });

  const [editing, setEditing]       = useState(null); // machine form object, or null
  const [histNo, setHistNo]         = useState(null); // 📜 ประวัติการซ่อมของเครื่อง (19/10)
  const navigate = useNavigate();
  const [saving, setSaving]         = useState(false);
  const [facilityAreas, setFacilityAreas] = useState([]); // ชื่อโซน facility (จาก pm_facility_areas) — ตัวเลือก/suggest
  const [newArea, setNewArea] = useState(null);           // null = ปิดช่อง · string = กำลังพิมพ์ชื่อโซนใหม่ (2026-09-07)
  const [areaSaving, setAreaSaving] = useState(false);
  const [supplyLines, setSupplyLines] = useState([]);     // Supply route: facility/utility นี้จ่ายให้ไลน์ไหนบ้าง (ในฟอร์มแก้ไข)
  const [supplyByMachine, setSupplyByMachine] = useState({}); // machine_id → [line_name] (โชว์ในลิสต์)

  // โหลด supply route ของ facility/utility ที่กำลังแก้ (utility นี้จ่ายไลน์ไหน)
  useEffect(() => {
    const isFac = editing?.equipment_category && editing.equipment_category !== 'production';
    if (!editing?.id || !isFac) { setSupplyLines([]); return; }
    supabaseDR.from('facility_supply_links').select('line_name').eq('machine_id', editing.id)
      .then(({ data }) => setSupplyLines((data || []).map(r => r.line_name))).catch(() => setSupplyLines([]));
  }, [editing?.id, editing?.equipment_category]);
  const [showTypeManager, setShowTypeManager] = useState(false);
  const [showBrandReview, setShowBrandReview] = useState(false);
  const [traitsVer, setTraitsVer] = useState(0); // bump เมื่อโหลด traits เสร็จ (re-render dropdown)

  useEffect(() => { loadMachineTraits().then(() => setTraitsVer(v => v + 1)); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    /* 🔴 2026-09-15 — หน้านี้เป็น "ตัวแก้ทะเบียน" โดยตรง: ทุก save/delete เรียก load() ต่อทันที
       ⇒ ล้าง cache master ที่นี่จุดเดียว = ครอบคลุมทุกปุ่มบันทึกในหน้า ไม่ต้องไล่แปะทีละจุด
       (ไล่แปะทีละจุดคือวิธีที่ทำให้ `invalidateProducts()` เดิมตกหล่นจนไม่มีใครเรียกเลยสักหน้า)
       ดูทะเบียน "ตาราง → คีย์" ที่ src/utils/masterInvalidate.js */
    invalidateTable('machines');
    /* 🔀 cache "ตัวนี้ครอบกี่เลน" ไม่ได้ผ่าน cachedMaster ⇒ invalidateTable ไม่ล้างให้ (ล้างที่นี่) */
    invalidateAffectsLanes();
    const [{ data: mc }, lnRes, { data: mt }, fa] = await Promise.all([
      // equipment_die(die_height_mm) — แม่พิมพ์กรอกความสูงได้จากฟอร์มนี้ด้วย (19/10 · ตัวจริงเก็บ 1:1 ที่ equipment_die)
      supabaseDR.from('machines').select('*, machine_types(id, label, color, icon), equipment_die(die_height_mm)').order('line_name').order('sort_order'),
      loadLinesRes(),
      supabaseDR.from('machine_types').select('*').order('sort_order'),
      supabaseDR.from('pm_facility_areas').select('name').order('sort_order').then(r => r).catch(() => ({ data: [] })),
    ]);
  /* 🔴 30/10 — เดิมแกะแค่ `{ data }` ⇒ ทะเบียนไลน์โหลดไม่สำเร็จแล้วได้ลิสต์ว่าง **เงียบ**
     (หน้างาน PD1 แจ้ง "MO ไม่มีให้เลือกไลน์" ทั้งที่ฐานข้อมูลมีครบ) · เก็บผลทั้งก้อนไว้อ่าน error ได้ */
  const ln = lnRes?.error ? null : lnRes.data;
    setMachines(mc || []);
    setLines(ln || []);
    setTypes(mt || []);
    setFacilityAreas((fa?.data || []).map(a => a.name).filter(Boolean));
    // supply route map (facility/utility → ไลน์ที่จ่าย) — best-effort ถ้าตารางยังไม่ apply
    supabaseDR.from('facility_supply_links').select('machine_id, line_name')
      .then(({ data }) => { const m = {}; (data || []).forEach(r => { (m[r.machine_id] ||= []).push(r.line_name); }); setSupplyByMachine(m); })
      .catch(() => setSupplyByMachine({}));
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  /* + เพิ่มโซน facility ใหม่ → insert pm_facility_areas (DR) ก่อน แล้วค่อยเลือก (2026-09-07)
     ห้ามพิมพ์ชื่อโซนลง machines.line_name ตรงๆ — MtnMachineLayout/Energy จับคู่โซนด้วยชื่อ พิมพ์ต่างตัวเดียว = โซนซ้ำ */
  const addFacilityArea = async () => {
    if (!canEdit) { toast.error('เพิ่มโซน facility ต้องมีสิทธิ์ machines:edit'); return; }
    const name = String(newArea || '').trim();
    if (!name) { toast.error('พิมพ์ชื่อโซน/ระบบก่อน'); return; }
    const dup = facilityAreas.find(a => a.trim().toLowerCase() === name.toLowerCase());
    if (dup) { setEditing(f => ({ ...f, line_name: dup })); setNewArea(null); toast.info(`มีโซน "${dup}" อยู่แล้ว — เลือกให้แล้ว`); return; }
    setAreaSaving(true);
    const ok = checkWrite(await supabaseDR.from('pm_facility_areas').insert({ name, sort_order: facilityAreas.length + 1 }), 'เพิ่มโซน facility');
    setAreaSaving(false);
    if (!ok) return;
    setFacilityAreas(a => [...a, name]);
    setEditing(f => ({ ...f, line_name: name }));
    setNewArea(null);
    toast.success(`เพิ่มโซน "${name}" แล้ว`);
  };

  // mandatory scope filter (คำสั่ง user 2026-07-12) — leader = family ไลน์ตัวเอง, มี sections = เฉพาะ section ตัวเอง
  // user ไม่มี scope เห็นหมดเหมือนเดิม · กรองก่อน filter อิสระเสมอ (pattern มาตรฐาน CLAUDE.md)
  const scopedLines = useMemo(() => {
    if (role === 'leader' && userLineId) {
      // เทียบ id ด้วย String() — lineId จาก profile อาจเป็นคนละ type กับ production_lines.id (pattern เดียวกับ EventLog)
      const myLine = lines.find(l => String(l.id) === String(userLineId));
      const fam = new Set(myLine ? getLineFamilyNames(lines, myLine.name) : []);
      return fam.size ? lines.filter(l => fam.has(l.name)) : lines;
    }
    if (scopeSecs?.length) return lines.filter(l => inSectionScope(scopeSecs, l.section));
    return lines;
  }, [lines, role, userLineId, scopeSecs]);
  const scopedLineNames = useMemo(() => new Set(scopedLines.map(l => l.name)), [scopedLines]);
  const scopeActive = scopedLines.length !== lines.length;

  const parentChildrenMap = useMemo(() => {
    const pcm = {};
    scopedLines.forEach(l => {
      if (l.parent_line_name) {
        if (!pcm[l.parent_line_name]) pcm[l.parent_line_name] = [];
        pcm[l.parent_line_name].push(l.name);
      }
    });
    return pcm;
  }, [scopedLines]);

  // ตัวเลือก dropdown "ไลน์/ระบบ" ปรับตามหมวด — production(หรือทุกหมวด) = ไลน์ผลิต · facility = ชื่อระบบ/พื้นที่ (line_name ของเครื่องหมวดนั้น ที่ไม่มีใน production_lines)
  // normCat: utility เดิม (ก่อน apply migration รวมหมวด) นับเป็น facility เพื่อให้กรองเจอ
  const catLineNames = useMemo(() => {
    if (filterCat !== 'facility') return null; // ใช้ dropdown ไลน์ผลิตเดิม
    const set = new Set();
    machines.forEach(m => { if (normCat(m.equipment_category) === filterCat && m.line_name) set.add(m.line_name); });
    return [...set].sort(lineNameCompare);
  }, [machines, filterCat]);

  const filtered = useMemo(() => {
    // เลือกไลน์หลัก (parent) = เห็นเครื่องของไลน์ย่อยทั้งกลุ่มด้วย (ไม่งั้นได้ 0 เพราะเครื่องอยู่ที่ไลน์ย่อย)
    const kids = parentChildrenMap[filterLine];
    const inLine = (m) => !filterLine || m.line_name === filterLine || (kids && kids.includes(m.line_name));
    return machines
      .filter(m => !scopeActive || scopedLineNames.has(m.line_name)) // mandatory scope ก่อน filter อิสระเสมอ
      .filter(m => !filterKind || kindOf(m.equipment_kind) === filterKind)      // ชนิดอุปกรณ์ (เครื่องจักร/แม่พิมพ์/จิ๊ก/facility)
      .filter(m => !filterCat || normCat(m.equipment_category) === filterCat) // หมวดอุปกรณ์ (ผลิต/facility — utility เดิมนับเป็น facility)
      .filter(m => showInactive || m.is_active)
      .filter(inLine)
      .filter(m => !filterType || m.machine_type_id === filterType)
      .filter(m => !search.trim() || [m.machine_no, m.machine_name].some(v => (v || '').toLowerCase().includes(search.trim().toLowerCase())));
  }, [machines, scopeActive, scopedLineNames, filterCat, showInactive, filterLine, filterType, search, parentChildrenMap]);

  const grouped = useMemo(() => {
    const map = {};
    filtered.forEach(m => { (map[m.line_name] ||= []).push(m); });
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  /* ── machine CRUD ── */
  /* 🏷️ ยี่ห้อ (20/10) — คอลัมน์มาจาก migration `20261020_machine_brand_mo_item_type_dr.sql`
     ยังไม่รัน = แถวไม่มีคีย์ `brand` ⇒ ซ่อนปุ่ม/ปิดช่อง (ห้ามส่งคอลัมน์ที่ไม่มี = บันทึกทั้งใบล้ม) */
  const hasBrandCol = useMemo(() => machines.some(m => Object.prototype.hasOwnProperty.call(m, 'brand')), [machines]);
  const knownBrands = useMemo(() => [...new Set(machines.map(m => normalizeBrand(m.brand)).filter(Boolean))].sort(), [machines]);
  const brandTodo = useMemo(() => brandProposals(machines.filter(m => m.is_active && kindOf(m.equipment_kind) !== 'die'), knownBrands), [machines, knownBrands]);

  const openEdit = (item = null) => {
    setEditing(item
      /* ⚠️ ต้องคัดลอก equipment_kind มาด้วยเสมอ — ตกไปแล้ว kindOf(undefined)='machine'
         ⇒ เปิดแก้แม่พิมพ์/จิ๊กแล้วกด save = ชนิดถูกเขียนทับเป็น "เครื่องจักร" เงียบๆ (audit 2026-09-08) */
      ? { id: item.id, equipment_kind: kindOf(item.equipment_kind), line_name: item.line_name, machine_no: item.machine_no, machine_name: item.machine_name || '', machine_type_id: item.machine_type_id || '', sort_order: item.sort_order ?? 0, is_active: item.is_active, equipment_category: item.equipment_category === 'utility' ? 'facility' : (item.equipment_category || 'production'), automation_level: item.automation_level || '', operation_mode: item.operation_mode || '', gang_count: item.gang_count != null ? String(item.gang_count) : '',
        affects_lanes: item.affects_lanes != null ? String(item.affects_lanes) : '',
        stops_whole_line: item.stops_whole_line === true,
          shut_height_min_mm: item.shut_height_min_mm != null ? String(item.shut_height_min_mm) : '',
          shut_height_max_mm: item.shut_height_max_mm != null ? String(item.shut_height_max_mm) : '',
          io_no: item.io_no || '',
          brand: item.brand || '',
          // equipment_die เป็น 1:1 → PostgREST คืน object (บางกรณี array) — อ่านได้ทั้ง 2 แบบ
          die_height_mm: (() => { const e = Array.isArray(item.equipment_die) ? item.equipment_die[0] : item.equipment_die; return e?.die_height_mm != null ? String(e.die_height_mm) : ''; })(),
          _die_height_orig: (() => { const e = Array.isArray(item.equipment_die) ? item.equipment_die[0] : item.equipment_die; return e?.die_height_mm ?? null; })(),
          _show_shut: false }
      : { ...emptyMachine, line_name: filterLine || '', sort_order: machines.length + 1 });
  };

  const handleSave = async () => {
    const isFac = editing.equipment_category && editing.equipment_category !== 'production';
    if (!editing.line_name)  { toast.error(isFac ? 'กรอกชื่อระบบ/พื้นที่ facility' : 'เลือกไลน์'); return; }
    if (!editing.machine_no.trim()) { toast.error('กรอกหมายเลขเครื่อง'); return; }
    setSaving(true);
    /* "เครื่องที่เดินเอง" = ชนิด machine + อยู่ไลน์ผลิต — เกณฑ์เดียวที่ใช้ทั้งฟอร์มและตอนบันทึก */
    const isRunningMachine = kindOf(editing.equipment_kind) === 'machine'
      && (editing.equipment_category || 'production') === 'production';
    const payload = {
      line_name:        editing.line_name,
      machine_no:        editing.machine_no.trim().toUpperCase(),
      machine_name:      editing.machine_name || null,
      // 💳 เลข I/O ประจำเครื่อง (14/10 · MTN REQUEST) — ใบ MO เติมช่อง I/O ให้เองตอนเลือกเครื่อง
      io_no:             (editing.io_no || '').trim().toUpperCase() || null,
      // 🏷️ ยี่ห้อ = คุณสมบัติของเครื่อง (20/10) — ส่งเฉพาะตอน migration มีคอลัมน์แล้ว (ไม่งั้นทั้งใบบันทึกไม่ได้)
      ...(hasBrandCol ? { brand: kindOf(editing.equipment_kind) === 'die' ? null : normalizeBrand(editing.brand) } : {}),
      // แม่พิมพ์ไม่มี "ประเภทเครื่องจักร" (ประเภทของมันอยู่ที่ทะเบียนแม่พิมพ์ — ชุด/ลำดับ OP)
      machine_type_id:   kindOf(editing.equipment_kind) === 'die' ? null : (editing.machine_type_id || null),
      equipment_category: editing.equipment_category || 'production',
      equipment_kind:    kindOf(editing.equipment_kind),   // ชนิดอุปกรณ์ (เครื่องจักร/แม่พิมพ์/จิ๊ก/facility)
      /* ลักษณะเครื่องจักร (data-driven) — **เฉพาะ "เครื่องจักร" ที่อยู่ไลน์ผลิต** (2026-09-14 · user ทัก)
         แม่พิมพ์/จิ๊กไม่ใช่ของที่ "เดินเอง" จะมีระดับอัตโนมัติ/โหมดทำงานไม่ได้ — เดิมกรองแค่หมวด
         ⇒ แม่พิมพ์ 254 จาก 266 ตัวถูกติด manual/standalone ไว้ แล้ว FactoryMap เอาไปนับ
         "ไลน์ที่คนโหลดเอง" จนไลน์ปั๊ม A/B/C ถูกตีเป็นไลน์มือทั้งที่เครื่องจริงเป็น auto ล้วน */
      automation_level:  isRunningMachine ? (editing.automation_level || null) : null,
      operation_mode:    isRunningMachine ? (editing.operation_mode || null) : null,
      gang_count:        editing.operation_mode === 'gang' && parseInt(editing.gang_count) > 0 ? parseInt(editing.gang_count) : null,
      /* ⏱️ ช่วง shut height ที่เครื่องรับได้ (มม.) — ใช้เช็คว่าแม่พิมพ์ขึ้นเครื่องนี้ได้ไหม
         + เป็นฐานของเวลาเปลี่ยนรุ่นงานปั๊ม (src/utils/pressSetup.js)
         ว่าง = null = "ไม่รู้" — fitsPress() จะคืน null ไม่ใช่ false (ห้ามตัดตัวเลือกคนวางแผน) */
      shut_height_min_mm: isRunningMachine ? numOrNull(editing.shut_height_min_mm) : null,
      shut_height_max_mm: isRunningMachine ? numOrNull(editing.shut_height_max_mm) : null,
      /* 🔀 "ตัวนี้หยุดแล้วกระทบกี่เลน" — เฉพาะไลน์เครื่องขนาน · ว่าง/1 = null = พฤติกรรมเดิม
         (คอนเวเยอร์ที่เลี้ยงทั้งไลน์ = จำนวนเลน · โรบอทที่ป้อน 2 เครื่อง = 2 · เลเซอร์แต่ละตัว = ว่าง)
         เก็บ null เมื่อ ≤ 1 เพื่อไม่ให้ทะเบียนเต็มไปด้วยเลข 1 ที่ไม่มีความหมาย */
      affects_lanes:     parseInt(editing.affects_lanes) > 1 ? parseInt(editing.affects_lanes) : null,
      /* 🏭 ของกลางของสาย — เก็บ `null` เมื่อไม่ติ๊ก (ไม่ใช่ false) ทะเบียนจะได้ไม่เต็มไปด้วยค่าที่ไม่มีความหมาย */
      stops_whole_line:  editing.stops_whole_line === true ? true : null,
      sort_order:        parseInt(editing.sort_order) || 0,
      is_active:         editing.is_active,
      updated_at:        new Date().toISOString(),
    };
    const doSave = (p) => editing.id
      ? supabaseDR.from('machines').update(p).eq('id', editing.id).select('id')
      : supabaseDR.from('machines').insert(p).select('id');
    let { data: savedRows, error } = await doSave(payload);
    // ทน migration ยังไม่ apply: ถ้าไม่มีคอลัมน์ใหม่ → ตัดออกแล้วบันทึกแบบเดิม
    let strippedCat = false;
    let strippedKind = false;
    if (error && /equipment_category|equipment_kind|automation_level|operation_mode|gang_count|shut_height_|affects_lanes|stops_whole_line/.test(error.message || '')) {
      strippedCat = /equipment_category/.test(error.message || '');
      strippedKind = /equipment_kind/.test(error.message || '');
      const { equipment_category, equipment_kind, automation_level, operation_mode, gang_count,
        shut_height_min_mm, shut_height_max_mm, affects_lanes, stops_whole_line, ...rest } = payload;
      void equipment_category; void equipment_kind; void automation_level; void operation_mode; void gang_count;
      void shut_height_min_mm; void shut_height_max_mm; void affects_lanes; void stops_whole_line;
      ({ data: savedRows, error } = await doSave(rest));
    }
    if (error) { setSaving(false); toast.error(error.message); return; }
    // ⚠️ ชนิดอุปกรณ์บันทึกไม่ติด (migration ยังไม่ apply) → เตือน ห้ามเงียบ (บทเรียนจาก equipment_category)
    if (strippedKind && kindOf(editing.equipment_kind) !== 'machine') {
      setSaving(false);
      toast.error('⚠️ ยังไม่ได้ apply migration "equipment_kind" — บันทึกเป็นเครื่องจักรชั่วคราว · apply แล้วมาแก้ชนิดอีกครั้ง');
      setEditing(null); load(); return;
    }
    // ⚠️ บันทึกหมวด Facility/Utility ไม่ติดเพราะยังไม่ได้ apply migration equipment_category → เตือนแทนที่จะเงียบ
    if (strippedCat && isFac) {
      setSaving(false);
      toast.error('⚠️ ยังไม่ได้ apply migration "machines_equipment_category" — เครื่องถูกบันทึกเป็น "ไลน์ผลิต" ชั่วคราว · apply migration แล้วแก้หมวดเป็น Facility อีกครั้ง');
      setEditing(null); load(); return;
    }
    /* 🔨 ความสูงแม่พิมพ์ (die height) — เก็บที่ equipment_die (1:1 · ตัวเดียวกับ /equipment?tab=die) (19/10)
       upsert เฉพาะคอลัมน์ die_height_mm ⇒ OP/ตัน/shot/regrind ของแถวเดิมไม่ถูกแตะ · ไม่เปลี่ยนค่า = ไม่เขียน
       ล้ม = เครื่องถูกบันทึกแล้ว แต่ต้องบอกว่าความสูงไม่ติด (ห้ามเงียบ) */
    const mid = editing.id || savedRows?.[0]?.id;
    if (kindOf(editing.equipment_kind) === 'die' && mid) {
      const h = numOrNull(editing.die_height_mm);
      if (h !== (editing._die_height_orig ?? null)) {
        const ok = checkWrite(await supabaseDR.from('equipment_die').upsert({ machine_id: mid, die_height_mm: h }, { onConflict: 'machine_id' }), 'บันทึกความสูงแม่พิมพ์');
        if (!ok) { setSaving(false); setEditing(null); load(); return; }
      }
    }
    // Supply route: sync ไลน์ที่ facility/utility นี้จ่าย (เฉพาะเครื่องที่มี id แล้ว) — best-effort
    if (editing.id && (editing.equipment_category || 'production') !== 'production') {
      try {
        const { error: wErr233 } = await supabaseDR.from('facility_supply_links').delete().eq('machine_id', editing.id);
        if (wErr233) { setSaving(false); toast.error('ล้างการเชื่อม facility เดิม (ยังไม่เขียนชุดใหม่ กันซ้ำ)ไม่สำเร็จ: ' + wErr233.message); return; }
        if (supplyLines.length) checkWrite(await supabaseDR.from('facility_supply_links').insert(supplyLines.map(ln => ({ machine_id: editing.id, line_name: ln }))), 'บันทึกไลน์ที่ facility นี้จ่าย');
      } catch { /* supabase-js ไม่ throw — catch นี้ไม่มีวันทำงาน คงไว้กันโค้ดข้างบนโยนเอง */ }
    }
    setSaving(false);
    toast.success('บันทึกสำเร็จ');
    setEditing(null);
    load();
  };

  const handleDelete = async (item) => {
    if (!window.confirm(`ปิดใช้งานเครื่องจักร "${item.machine_no}" ?\n\nจุดบนผังไลน์และประวัติ Downtime ที่อ้างอิงเครื่องนี้จะยังอยู่ แต่จะเลือกเครื่องนี้ใหม่ไม่ได้ (เปิดใช้กลับได้ภายหลัง)`)) return;
    const { error } = await supabaseDR.from('machines').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', item.id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  if (loading) return <Page><div style={{ color: 'var(--muted)', textAlign: 'center', padding: 40 }}>กำลังโหลด...</div></Page>;

  return (
    <Page>
      <ReadOnlyNote show={!canEdit && !canCreate} role={role} what="แก้ทะเบียนเครื่องจักร"
        permKey="machines:edit, machines:create" />
      {/* 🧩 เป็นแท็บของ `/equipment` — PageHeader ใน <Hub> ไม่วาดชื่อหน้าซ้ำ เหลือคำอธิบาย + ปุ่ม (UI-STANDARD 2026-09-24)
          (เดิมวาด <h1> เองด้วย ⇒ แท็บเครื่องจักรมีหัวเรื่อง 2 ชั้นและไม่มี breadcrumb · ภาพ user 22/09) */}
      <PageHeader title="ฐานข้อมูลเครื่องจักร" icon="🏭"
        sub={`รายการเครื่องจักรทุกไลน์ · ${machines.filter(m => m.is_active).length} เครื่องที่ใช้งานอยู่`}
        actions={(canEdit || canCreate) ? (
          <>
            {canEdit && <button onClick={() => setShowTypeManager(true)} style={cancelBtnStyle}>🏷️ จัดการประเภทเครื่องจักร</button>}
            {canEdit && hasBrandCol && brandTodo.length > 0 && <button onClick={() => setShowBrandReview(true)} style={cancelBtnStyle}>🏷️ แยกยี่ห้อจากชื่อ ({brandTodo.length})</button>}
            {canCreate && <button onClick={() => openEdit()} style={saveBtnStyle}>+ เพิ่มเครื่องจักร</button>}
          </>
        ) : null} />

      {/* Filters — ขอบเขต (ชนิด/หมวด/ไลน์) → ตัวกรองอื่น → ค้นหา → จำนวน */}
      <FilterBar>
        {/* ชนิดอุปกรณ์ — แยกเครื่องจักรออกจากแม่พิมพ์/จิ๊ก (แกนคนละแกนกับ "หมวด" ผลิต/facility) */}
        <select value={filterKind} onChange={e => { setFilterKind(e.target.value); setFilterLine(''); }}
          title="ชนิดอุปกรณ์ — แม่พิมพ์กับจิ๊กไม่ใช่เครื่องจักร จึงแยกกันคนละลิสต์"
          style={{ borderColor: filterKind === 'machine' ? undefined : 'var(--accent2)' }}>
          <option value="">{ALL.kind}</option>
          {EQUIPMENT_KINDS.map(k => <option key={k.key} value={k.key}>{k.icon} {k.label}</option>)}
        </select>
        {/* หมวดอุปกรณ์ — เปลี่ยนหมวดแล้วล้างไลน์ที่เลือกค้าง (§5.3 cascade) */}
        <select value={filterCat} onChange={e => { setFilterCat(e.target.value); setFilterLine(''); }}>
          <option value="">{ALL.category}</option>
          {EQUIP_CATS.map(c => <option key={c.v} value={c.v}>{c.t}</option>)}
        </select>
        {catLineNames ? (
          <select value={filterLine} onChange={e => setFilterLine(e.target.value)}>
            <option value="">{allOf('ระบบ/พื้นที่')}</option>
            {catLineNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        ) : (
          /* 2026-09-07: ไลน์ผลิตผ่าน <LineSelect> (ลำดับชั้น + scope มาตรฐาน leader/sections) แทน optgroup ที่ประกอบเอง
             เลือกไลน์แม่ = เห็นเครื่องทั้งกลุ่ม (logic kids ใน `filtered` เดิม) */
          <LineSelect lines={lines} value={filterLine} onChange={setFilterLine} placeholder={ALL.line}
            role={role} lineId={userLineId} sections={scopeSecs} />
        )}
        <select value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="">{ALL.type}</option>
          {types.map(t => <option key={t.id} value={t.id}>{t.icon || ''} {t.label}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text2)', cursor: 'pointer' }}>
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
          แสดงที่ปิดใช้งาน
        </label>
        <SearchInput value={search} onChange={setSearch} fields="หมายเลข/ชื่อเครื่อง" />
        <span className="spacer" />
        {grouped.length > 1 && (
          <button type="button" className="ctl-btn" onClick={() => {
            const allCollapsed = grouped.every(([n]) => collapsedGroups.has(n));
            const next = allCollapsed ? new Set() : new Set(grouped.map(([n]) => n));
            setCollapsedGroups(next);
            try { localStorage.setItem('md_group_collapse', JSON.stringify([...next])); } catch { /* ignore */ }
          }} style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', cursor: 'pointer', fontSize: 12, padding: '0 12px' }}>
            {grouped.every(([n]) => collapsedGroups.has(n)) ? '▼ กางทั้งหมด' : '▶ ย่อทั้งหมด'}
          </button>
        )}
        <div className="filter-count" style={{ textAlign: 'right' }}>
          {filtered.length} รายการ
          {/* ห้ามซ่อนเงียบ — บอกเสมอว่าชนิดอื่นถูกกรองออกไปกี่ตัว พร้อมทางไปดู */}
          {(() => {
            if (!filterKind) return null;
            const others = machines.filter(m => (showInactive || m.is_active) && kindOf(m.equipment_kind) !== filterKind);
            if (!others.length) return null;
            const by = {};
            others.forEach(m => { const k = kindOf(m.equipment_kind); by[k] = (by[k] || 0) + 1; });
            return (
              <div style={{ fontSize: 11, color: 'var(--accent2)', marginTop: 2 }}>
                ซ่อนชนิดอื่น {Object.entries(by).map(([k, n]) => `${kindIcon(k)} ${kindLabel(k)} ${n}`).join(' · ')}
              </div>
            );
          })()}
        </div>
      </FilterBar>

      {/* UI-STANDARD 2026-09-24 (UI-CONVENTIONS §6.8): เลิกกล่องเลื่อนแนวตั้งซ้อน (maxHeight calc(100vh-230px))
          — รายการย่อ/กางตามกลุ่มไลน์ได้อยู่แล้ว เลื่อนซ้อน 2 ชั้นทำให้ล้อเมาส์ติดกล่องใน */}
      <div style={{ overflowX: 'auto' }}>
      {grouped.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)', fontSize: 13 }}>ไม่พบเครื่องจักร</div>
      )}

      {grouped.map(([lineName, items]) => {
        const isCollapsed = collapsedGroups.has(lineName);
        return (
        <div key={lineName} style={{ marginBottom: 18, border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          <button type="button" onClick={() => toggleGroup(lineName)}
            style={{ width: '100%', textAlign: 'left', padding: '10px 16px', background: 'var(--bg2)', borderBottom: isCollapsed ? 'none' : '1px solid var(--border)', borderTop: 'none', borderLeft: 'none', borderRight: 'none', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', color: 'var(--text)' }}>
            <span style={{ fontSize: 11, color: 'var(--muted)', width: 12 }}>{isCollapsed ? '▶' : '▼'}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>⚙️ {lineName}</span>
            <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>{items.length} เครื่อง</span>
          </button>
          {!isCollapsed && (
          <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {items.map(item => (
              <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, opacity: item.is_active ? 1 : 0.5 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 14, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text)' }}>{item.machine_no}</span>
                    {item.machine_name && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{item.machine_name}</span>}
                    {item.brand && <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 20, background: 'var(--bg2)', color: 'var(--text2)', fontWeight: 700 }} title="ยี่ห้อ">🏷️ {item.brand}</span>}
                    {item.io_no && <span style={{ fontSize: 11, color: 'var(--text2)', fontFamily: 'monospace' }}>I/O {item.io_no}</span>}
                    {item.machine_types && (
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: `${item.machine_types.color}22`, color: item.machine_types.color, fontWeight: 700 }}>
                        {item.machine_types.icon || ''} {item.machine_types.label}
                      </span>
                    )}
                    {item.automation_level && <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 20, background: 'var(--bg2)', color: 'var(--text2)', fontWeight: 700 }}>{automationDisplay(item.automation_level)}</span>}
                    {item.operation_mode && <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 20, background: 'var(--bg2)', color: 'var(--text2)', fontWeight: 700 }}>{operationDisplay(item.operation_mode)}{item.operation_mode === 'gang' && item.gang_count ? ` ×${item.gang_count}` : ''}</span>}
                    {item.equipment_category && item.equipment_category !== 'production' && <span style={{ fontSize: 11, color: '#f59a3f' }}>🔧 Facility / Utility</span>}
                    {!item.machine_type_id && item.equipment_category === 'production' && <span style={{ fontSize: 11, color: '#f59e0b' }}>ยังไม่ระบุประเภท</span>}
                    {(supplyByMachine[item.id]?.length > 0) && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: 'rgba(74,144,224,0.15)', color: '#4a90e0', fontWeight: 700 }} title={`จ่ายให้: ${supplyByMachine[item.id].join(', ')}`}>🔗 จ่าย {supplyByMachine[item.id].length} ไลน์</span>}
                    {!item.is_active && <span style={{ fontSize: 11, color: '#ef4444' }}>(ปิดใช้)</span>}
                  </div>
                </div>
                {(canEdit || mayDelete) && (
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button className="tbtn" onClick={() => setHistNo(item.machine_no)} title="ใบแจ้งซ่อมทุกใบของเครื่องนี้" style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer', color: 'var(--text)' }}>📜 ประวัติซ่อม</button>
                    {canEdit && <button className="tbtn" onClick={() => openEdit(item)} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: 'pointer', color: 'var(--text)' }}>แก้ไข</button>}
                    {mayDelete && <button className="tbtn" onClick={() => handleDelete(item)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 15 }}>✕</button>}
                  </div>
                )}
              </div>
            ))}
          </div>
          )}
        </div>
        );
      })}
      </div>

      {/* Add/Edit machine modal */}
      {editing && (
        <div className="overlay" style={{ zIndex: 2000 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 14, padding: 24, width: 'min(95vw,420px)' }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 20, color: 'var(--text)' }}>
              {editing.id ? `แก้ไข${kindLabel(editing.equipment_kind)}` : '+ เพิ่มอุปกรณ์'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* ชนิดอุปกรณ์ — แกนคนละแกนกับ "หมวด" (ผลิต/facility) · แม่พิมพ์ไม่ใช่เครื่องจักร */}
              <Field label="ชนิดอุปกรณ์">
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {EQUIPMENT_KINDS.map(k => {
                    const on = kindOf(editing.equipment_kind) === k.key;
                    return <button key={k.key} type="button" title={k.desc}
                      onClick={() => setEditing(f => ({ ...f, equipment_kind: k.key }))}
                      style={{ flex: '1 1 110px', padding: '7px 6px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                        border: `1px solid ${on ? 'var(--accent)' : 'var(--border2)'}`, background: on ? 'var(--accent)' : 'var(--bg2)', color: on ? 'var(--accent-ink)' : 'var(--text2)' }}>
                      {k.icon} {k.label}</button>;
                  })}
                </div>
                {kindOf(editing.equipment_kind) === 'die' && (
                  <div style={{ fontSize: 11, color: 'var(--accent2)', marginTop: 5, lineHeight: 1.5 }}>
                    🔨 แม่พิมพ์มีรายละเอียดเพิ่ม (ชุด · ลำดับ OP · นับ shot · ลับคม) — ตั้งที่หน้า <b>ทะเบียนแม่พิมพ์</b>
                  </div>
                )}
              </Field>
              <Field label="หมวดอุปกรณ์">
                <div style={{ display: 'flex', gap: 6 }}>
                  {EQUIP_CATS.map(c => {
                    const on = (editing.equipment_category || 'production') === c.v;
                    return <button key={c.v} type="button" onClick={() => setEditing(f => ({ ...f, equipment_category: c.v, line_name: '' }))}
                      style={{ flex: 1, padding: '7px 6px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                        border: `1px solid ${on ? 'var(--accent)' : 'var(--border2)'}`, background: on ? 'var(--accent)' : 'var(--bg2)', color: on ? 'var(--accent-ink)' : 'var(--text2)' }}>{c.t}</button>;
                  })}
                </div>
              </Field>
              {(editing.equipment_category || 'production') === 'production' ? (
                <Field label="ไลน์การผลิต *">
                  {/* 2026-09-07: <LineSelect> (ลำดับชั้น + scope) — ไลน์แม่ยังเลือกได้ (บางโรงงานวางเครื่องบนผังไลน์ใหญ่ เช่น HYDROFORM)
                      ไลน์ปลดระวางไม่โผล่ แต่ค่าที่ตั้งไว้แล้วยังเห็นพร้อมป้าย ⏸ */}
                  <LineSelect lines={lines} value={editing.line_name} onChange={v => setEditing(f => ({ ...f, line_name: v }))}
                    role={role} lineId={userLineId} sections={scopeSecs} style={inputStyle} />
                </Field>
              ) : (
                <Field label="ระบบ / พื้นที่ facility *">
                  {/* 2026-09-07: เลือกจากทะเบียนโซน pm_facility_areas (DR) — MtnMachineLayout/Energy จับคู่โซนด้วย "ชื่อ"
                      พิมพ์เองสะกดต่างตัวเดียว = โซนซ้ำ · โซนใหม่ต้อง insert เข้าทะเบียนก่อน (ปุ่ม + เพิ่มโซนใหม่) */}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <select value={editing.line_name} onChange={e => setEditing(f => ({ ...f, line_name: e.target.value }))} style={inputStyle}>
                      <option value="">— เลือกโซน / ระบบ —</option>
                      {/* ค่าเก่าที่ไม่มีในทะเบียน ต้องยังโชว์ (ห้ามหายเงียบ) พร้อมป้ายให้ไปจัดข้อมูล */}
                      {editing.line_name && !facilityAreas.includes(editing.line_name) && (
                        <option value={editing.line_name}>{editing.line_name} ⚠ ไม่มีในทะเบียนโซน</option>
                      )}
                      {facilityAreas.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                    <button type="button" onClick={() => setNewArea(v => (v == null ? '' : null))}
                      style={{ ...cancelBtnStyle, padding: '8px 12px', whiteSpace: 'nowrap' }}>
                      + เพิ่มโซนใหม่
                    </button>
                  </div>
                  {newArea != null && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                      <input autoFocus value={newArea} onChange={e => setNewArea(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addFacilityArea(); } }}
                        placeholder="ชื่อโซน/ระบบใหม่ เช่น ระบบน้ำ 1, High Pressure" style={inputStyle} />
                      <button type="button" onClick={addFacilityArea} disabled={areaSaving}
                        style={{ ...saveBtnStyle, padding: '8px 12px', whiteSpace: 'nowrap', opacity: areaSaving ? 0.6 : 1 }}>
                        {areaSaving ? '...' : 'บันทึกโซน'}
                      </button>
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>ไม่ต้องผูกไลน์ผลิต · โซนชุดเดียวกับผัง facility ของ MTN และจอพลังงาน — ไม่มีในลิสต์ให้กด “+ เพิ่มโซนใหม่”</div>
                </Field>
              )}
              <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label="หมายเลขเครื่อง *">
                  <input autoFocus value={editing.machine_no} onChange={e => setEditing(f => ({ ...f, machine_no: e.target.value.toUpperCase() }))} placeholder="เช่น HDF-01" style={{ ...inputStyle, fontFamily: 'monospace', fontWeight: 700 }} />
                </Field>
                <Field label="ชื่อเครื่อง / รุ่น">
                  <input value={editing.machine_name} onChange={e => setEditing(f => ({ ...f, machine_name: e.target.value }))} placeholder="เช่น CO2 Welder" style={inputStyle} />
                </Field>
              </div>
              {kindOf(editing.equipment_kind) !== 'die' && (() => {
                const sug = !normalizeBrand(editing.brand) ? suggestBrand(editing.machine_name, knownBrands) : null;
                return (
                  <Field label="ยี่ห้อ (Brand)" hint={hasBrandCol ? 'ยี่ห้อเป็นของเครื่อง ไม่ต้องใส่ในชื่อชนิดอุปกรณ์ของใบ MO' : '⚠ รอรัน migration "machine_brand" ก่อน — ช่องนี้ยังบันทึกไม่ได้'}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input value={editing.brand || ''} disabled={!hasBrandCol} list="machine-brand-list"
                        onChange={e => setEditing(f => ({ ...f, brand: e.target.value.toUpperCase() }))} placeholder="เช่น ABB / YASKAWA" style={{ ...inputStyle, flex: 1 }} />
                      {hasBrandCol && sug && <button type="button" onClick={() => setEditing(f => ({ ...f, brand: sug }))} style={{ ...cancelBtnStyle, padding: '6px 10px', fontSize: 12, whiteSpace: 'nowrap' }} title="จากคำขึ้นต้นของชื่อเครื่อง">ใช้ {sug}</button>}
                    </div>
                    <datalist id="machine-brand-list">{knownBrands.map(b => <option key={b} value={b} />)}</datalist>
                  </Field>
                );
              })()}
              <Field label="เลข I/O (Internal Order) — ใบแจ้งซ่อม MO เติมให้อัตโนมัติ">
                <input value={editing.io_no} onChange={e => setEditing(f => ({ ...f, io_no: e.target.value.toUpperCase() }))} maxLength={20} placeholder="เช่น 11A1234567" style={{ ...inputStyle, fontFamily: 'monospace' }} />
              </Field>
              {kindOf(editing.equipment_kind) === 'die' && (
                <Field label="ความสูงแม่พิมพ์ — Die height (มม.)" hint="ว่าง = ยังไม่รู้ · ใช้คิดเวลาเปลี่ยนรุ่น + เช็คว่าขึ้นเครื่องปั๊มไหนได้">
                  <input type="number" step="0.1" min={0} value={editing.die_height_mm ?? ''}
                    onChange={e => setEditing(f => ({ ...f, die_height_mm: e.target.value }))} placeholder="เช่น 350" style={inputStyle} />
                </Field>
              )}
              {/* แม่พิมพ์ไม่มีประเภทเครื่องจักร — ประเภท/ชุด/ลำดับ OP ของแม่พิมพ์อยู่ที่ทะเบียนแม่พิมพ์ (user 2026-09-14) */}
              {kindOf(editing.equipment_kind) !== 'die' && (
              <Field label="ประเภทเครื่องจักร">
                <div style={{ display: 'flex', gap: 8 }}>
                  <select value={editing.machine_type_id} onChange={e => setEditing(f => ({ ...f, machine_type_id: e.target.value }))} style={inputStyle}>
                    <option value="">— ไม่ระบุ —</option>
                    {types.map(t => <option key={t.id} value={t.id}>{t.icon || ''} {t.label}</option>)}
                  </select>
                  <button type="button" onClick={() => setShowTypeManager(true)}
                    style={{ ...cancelBtnStyle, padding: '8px 12px', whiteSpace: 'nowrap' }}>
                    + ประเภทใหม่
                  </button>
                </div>
              </Field>
              )}
              {/* ลักษณะเครื่องจักร (data-driven · คนละแกนกับประเภท/กระบวนการ)
                  — เฉพาะ **เครื่องจักรที่เดินเอง** ในไลน์ผลิต · แม่พิมพ์/จิ๊กไม่มีแกนนี้ (2026-09-14) */}
              {kindOf(editing.equipment_kind) === 'machine' && (editing.equipment_category || 'production') === 'production' && (() => {
                void traitsVer; // อ้างถึงเพื่อ re-render เมื่อ traits โหลดเสร็จ
                return (
                  <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <Field label="Automation level">
                      <select value={editing.automation_level} onChange={e => setEditing(f => ({ ...f, automation_level: e.target.value }))} style={inputStyle}>
                        <option value="">— not set —</option>
                        {activeAutomationLevels().map(a => <option key={a.key} value={a.key}>{a.icon || ''} {a.label}</option>)}
                      </select>
                    </Field>
                    <Field label="Operation mode">
                      <select value={editing.operation_mode} onChange={e => setEditing(f => ({ ...f, operation_mode: e.target.value, gang_count: e.target.value === 'gang' ? f.gang_count : '' }))} style={inputStyle}>
                        <option value="">— not set —</option>
                        {activeOperationModes().map(o => <option key={o.key} value={o.key}>{o.icon || ''} {o.label}</option>)}
                      </select>
                    </Field>
                    {/* ⏱️ ช่วง shut height — ตัวแปรเวลาเปลี่ยนรุ่นงานปั๊ม (user 2026-09-24)
                        ว่างไว้ได้ = "ยังไม่รู้" ระบบจะไม่สรุปว่าแม่พิมพ์ขึ้นเครื่องนี้ไม่ได้
                        🔨 19/10: โชว์เฉพาะเครื่องปั๊ม (showsShutHeight — utils/pressMachine.js) · หุ่นยนต์/เชื่อมไม่มีค่านี้
                           มีค่ากรอกไว้แล้วโชว์เสมอ · ประเภทชื่ออื่นกดปุ่มเปิดเองได้ */}
                    {!(editing._show_shut || showsShutHeight({ typeLabel: types.find(t => t.id === editing.machine_type_id)?.label, min: editing.shut_height_min_mm, max: editing.shut_height_max_mm })) ? (
                      <div style={{ gridColumn: '1 / -1', fontSize: 11.5, color: 'var(--muted)' }}>
                        Shut height ใช้เฉพาะเครื่องปั๊ม (ประเภท Metal Forming / Press) ·{' '}
                        <button type="button" onClick={() => setEditing(f => ({ ...f, _show_shut: true }))}
                          style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 11.5, padding: 0, textDecoration: 'underline' }}>
                          เครื่องนี้เป็นเครื่องปั๊ม — กรอก shut height</button>
                      </div>
                    ) : (<>
                    <Field label="Shut height ต่ำสุด (มม.)" hint="ว่าง = ยังไม่รู้">
                      <input type="number" step="0.1" min={0} value={editing.shut_height_min_mm ?? ''}
                        onChange={e => setEditing(f => ({ ...f, shut_height_min_mm: e.target.value }))} placeholder="เช่น 200" style={inputStyle} />
                    </Field>
                    <Field label="Shut height สูงสุด (มม.)" hint="ใช้เช็คว่าแม่พิมพ์ขึ้นเครื่องนี้ได้ไหม">
                      <input type="number" step="0.1" min={0} value={editing.shut_height_max_mm ?? ''}
                        onChange={e => setEditing(f => ({ ...f, shut_height_max_mm: e.target.value }))} placeholder="เช่น 450" style={inputStyle} />
                    </Field>
                    </>)}
                    {editing.operation_mode === 'gang' && (
                      <Field label="Gang count (pieces / stroke)">
                        <input type="number" min={1} value={editing.gang_count} onChange={e => setEditing(f => ({ ...f, gang_count: e.target.value }))} placeholder="e.g. 4" style={inputStyle} />
                      </Field>
                    )}
                    {/* 🔀 ไลน์เครื่องขนาน — "ตัวนี้หยุดแล้วกระทบกี่เลน" (2026-10-28 · คำสั่ง user)
                        🏭 โชว์ 2 กรณี: (ก) เครื่องอยู่บนไลน์ที่ตั้งเลนไว้ > 1 → กรอกเลขได้
                           (ข) อุปกรณ์อยู่ที่ **ไลน์แม่** ของไลน์ขนาน → ติ๊ก "ของกลางของสาย" ได้อย่างเดียว
                        user 28/10: *"conveyor อยู่ไลน์แม่ เป็นเหมือนส่วนกลางที่ใช้ทั้ง hdf1,hdf2,laser345,laser789"*
                        ⇒ ของกลางที่ใช้หลายไลน์ซึ่งเลนไม่เท่ากัน "กระทบกี่เลน" ไม่มีคำตอบเป็นเลขเดียว
                        🔴 กรอกเฉพาะ "ตัวยกเว้น" — ว่าง = 1 เลน = พฤติกรรมเดิมเป๊ะ (ทยอยกรอกได้ ไม่ต้อง cut-over) */}
                    {(() => {
                      const lineRow = lines.find(l => l.name === editing.line_name);
                      /* เกตเดียวกับที่สูตรใช้จริง (parallelNBySession → parallelUnitsOf ไม่มี fallback) */
                      const laneN = parallelUnitsOf(lineRow);
                      /* ไลน์นี้เป็น "แม่" ของไลน์ขนานตัวไหนบ้าง — ของกลางของสายลงทะเบียนไว้ที่ไลน์แม่ */
                      const kids = editing.line_name
                        ? lines.filter(l => parallelUnitsOf(l) > 1
                            && getAncestorNames(lines, l.name).includes(editing.line_name)).map(l => l.name)
                        : [];
                      if (!(laneN > 1) && !kids.length) {
                        if (!isParallelLine(lineRow?.flow_mode)) return null;
                        return (
                          <Field label="🔀 หยุดแล้วกระทบกี่เลน">
                            <div style={{ fontSize: 11, color: 'var(--amber)', lineHeight: 1.6 }}>
                              ไลน์นี้เป็น <b>เครื่องขนาน</b> แต่ยังไม่ได้ตั้ง <b>จำนวนเลน</b> ที่ทะเบียนไลน์
                              ⇒ สูตร OEE ยังไม่หารเลน · กรอกช่องนี้จะไม่มีผล
                              <div style={{ marginTop: 2 }}>ไปตั้ง &quot;เครื่องขนานกี่เลน&quot; ที่ <b>ทะเบียนไลน์ผลิต</b> ก่อน แล้วกลับมากรอก</div>
                            </div>
                          </Field>
                        );
                      }
                      return (
                        <Field label={laneN > 1 ? `🔀 หยุดแล้วกระทบกี่เลน (ไลน์นี้มี ${laneN} เลน)` : '🏭 ของกลางของสาย'}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', marginBottom: laneN > 1 ? 6 : 0 }}>
                            <input type="checkbox" checked={editing.stops_whole_line === true}
                              onChange={e => setEditing(f => ({ ...f, stops_whole_line: e.target.checked }))} />
                            ของกลางของสาย — หยุดแล้ว<b>หยุดทั้งไลน์</b>ที่ใช้มัน
                          </label>
                          {laneN > 1 && !editing.stops_whole_line && (
                            <input type="number" min={1} max={laneN} value={editing.affects_lanes ?? ''}
                              onChange={e => setEditing(f => ({ ...f, affects_lanes: e.target.value }))}
                              placeholder={`ว่าง = 1 เลน  ·  สูงสุด ${laneN}`} style={inputStyle} />
                          )}
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, lineHeight: 1.6 }}>
                            {kids.length > 0 ? (
                              <>อุปกรณ์ที่อยู่ที่ <b>ไลน์แม่</b> และใช้ร่วมกันหลายไลน์ (คอนเวเยอร์ · ระบบลม · ตู้ไฟ)
                                — ติ๊กช่องนี้แล้วจะไม่ถูกหารเลนในทุกไลน์ที่ใช้มัน
                                <div style={{ marginTop: 2 }}>ไลน์ขนานที่อยู่ใต้ไลน์นี้: <b>{kids.join(' · ')}</b></div></>
                            ) : (
                              <>กรอกเฉพาะ<b>ตัวยกเว้น</b> — คอนเวเยอร์/ระบบที่เลี้ยงทั้งไลน์ = ติ๊กช่องบน ·
                                โรบอทที่ป้อน 2 เครื่อง = ใส่ <b>2</b> · เครื่องที่เดินเองไม่เกี่ยวกับตัวอื่น = <b>เว้นว่างทั้งคู่</b></>
                            )}
                            <div style={{ marginTop: 2 }}>ใช้แปลงนาที downtime เป็น <b>&quot;นาทีที่ไลน์หยุด&quot;</b> — ฐานเวลาของ %A และตัวหารของ %P</div>
                          </div>
                        </Field>
                      );
                    })()}
                  </div>
                );
              })()}
              {(editing.equipment_category || 'production') !== 'production' && (
                <Field label="🔗 จ่ายให้ไลน์ (Supply Route)">
                  {!editing.id ? (
                    <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>บันทึกเครื่องก่อน แล้วเปิดแก้ไขอีกครั้งเพื่อตั้งไลน์ที่จ่าย</div>
                  ) : (
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>อุปกรณ์นี้จ่ายให้ไลน์ไหนบ้าง — ถ้าตัดไฟ/มีปัญหาจะรู้ว่ากระทบไลน์ไหน</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 130, overflowY: 'auto', padding: 4, border: '1px solid var(--border)', borderRadius: 8 }}>
                        {scopedLines.filter(l => !parentChildrenMap[l.name]).map(l => {
                          const on = supplyLines.includes(l.name);
                          return <button key={l.id} type="button" onClick={() => setSupplyLines(p => on ? p.filter(x => x !== l.name) : [...p, l.name])}
                            style={{ padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                              border: `1px solid ${on ? 'var(--accent)' : 'var(--border2)'}`, background: on ? 'var(--accent)' : 'var(--bg2)', color: on ? 'var(--accent-ink)' : 'var(--text2)' }}>{on ? '✓ ' : ''}{l.name}</button>;
                        })}
                      </div>
                      {supplyLines.length > 0 && <div style={{ fontSize: 11.5, color: 'var(--accent2)', marginTop: 4 }}>กระทบ {supplyLines.length} ไลน์เมื่ออุปกรณ์นี้หยุด</div>}
                    </div>
                  )}
                </Field>
              )}
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={editing.is_active} onChange={e => setEditing(f => ({ ...f, is_active: e.target.checked }))} />
                <span style={{ fontSize: 13, color: 'var(--text)' }}>ใช้งานอยู่</span>
              </label>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
              <button onClick={() => setEditing(null)} style={cancelBtnStyle}>ยกเลิก</button>
              <button onClick={handleSave} disabled={saving} style={{ ...saveBtnStyle, opacity: saving ? 0.6 : 1 }}>{saving ? '...' : 'บันทึก'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Machine type manager modal */}
      {showTypeManager && (
        <MachineTypeManager
          types={types}
          canEdit={canEdit}
          onClose={() => setShowTypeManager(false)}
          onChange={load}
        />
      )}
      {showBrandReview && <BrandReviewModal proposals={brandTodo} onClose={() => setShowBrandReview(false)} onDone={() => { setShowBrandReview(false); load(); }} />}
      {histNo && <MachineRepairHistory machineNo={histNo} onClose={() => setHistNo(null)}
        onOpenOrder={(o) => navigate(`/mtn-repair?mo=${o.id}`)} />}
    </Page>
  );
}

/* ═══ 🏷️ แยกยี่ห้อจากชื่อเครื่อง — ระบบเสนอ คนตรวจ แล้วค่อยบันทึก (20/10 · คำสั่ง user ข้อ 7) ═══
   กฎเสนอ = `suggestBrand()` (utils/machineBrand.js · คำขึ้นต้นชื่อเท่านั้น ห้ามเดาจากรุ่น)
   · ติ๊กออก/แก้ยี่ห้อได้ก่อนกด · บันทึกเป็นกลุ่มต่อยี่ห้อ · นับแถวที่เขียนติดจริง (checkWriteRows) */
function BrandReviewModal({ proposals, onClose, onDone }) {
  const [rows, setRows] = useState(() => proposals.map(({ m, brand }) => ({ id: m.id, no: m.machine_no, name: m.machine_name, line: m.line_name, brand, on: true })));
  const [busy, setBusy] = useState(false);
  const picked = rows.filter(r => r.on && normalizeBrand(r.brand));
  const save = async () => {
    setBusy(true);
    let n = 0;
    try {
      const groups = {};
      picked.forEach(r => { const b = normalizeBrand(r.brand); (groups[b] || (groups[b] = [])).push(r.id); });
      for (const [b, ids] of Object.entries(groups)) {
        const res = await supabaseDR.from('machines').update({ brand: b, updated_at: new Date().toISOString() }).in('id', ids).select('id');
        if (!checkWriteRows(res, `บันทึกยี่ห้อ ${b}`)) break;
        n += (res.data || []).length;
      }
    } finally { setBusy(false); }
    if (n) toast.success(`บันทึกยี่ห้อแล้ว ${n} เครื่อง`);
    onDone();
  };
  return (
    <div className="overlay" style={{ zIndex: 2100 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 14, padding: 20, width: 'min(95vw,640px)', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>🏷️ แยกยี่ห้อจากชื่อเครื่อง</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.6 }}>
          ระบบอ่านจาก <b>คำแรกของชื่อเครื่อง</b> เท่านั้น (ไม่เดาจากชื่อรุ่น) · ตรวจแล้วติ๊กออก/แก้ยี่ห้อได้ก่อนบันทึก ·
          เครื่องที่ระบบอ่านไม่ออกไม่อยู่ในลิสต์นี้ — กรอกเองในฟอร์มเครื่อง
        </div>
        <div style={{ flex: 1, overflowY: 'auto', marginBottom: 10 }}>
          {rows.map((r, i) => (
            <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12.5, color: 'var(--text)' }}>
              <input type="checkbox" checked={r.on} onChange={e => setRows(x => x.map((y, j) => j === i ? { ...y, on: e.target.checked } : y))} />
              <b style={{ fontFamily: 'monospace', minWidth: 90 }}>{r.no}</b>
              <span style={{ flex: 1, minWidth: 0, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name} · {r.line}</span>
              <input value={r.brand} onChange={e => setRows(x => x.map((y, j) => j === i ? { ...y, brand: e.target.value.toUpperCase() } : y))} style={{ ...inputStyle, width: 130, fontWeight: 700 }} />
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={cancelBtnStyle}>ยกเลิก</button>
          <button onClick={save} disabled={busy || !picked.length} style={{ ...saveBtnStyle, opacity: busy || !picked.length ? 0.6 : 1 }}>{busy ? 'กำลังบันทึก…' : `บันทึกยี่ห้อ ${picked.length} เครื่อง`}</button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MACHINE TYPE MANAGER — user-defined taxonomy, no hardcoded enum
═══════════════════════════════════════════════════════════════ */
function MachineTypeManager({ types, canEdit, onClose, onChange }) {
  const [form, setForm] = useState(emptyType);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  /* 🔗 ชนิดอุปกรณ์ในใบแจ้งซ่อม (20/10 · ข้อ 6) — เลือก MC No. ในใบ MO แล้วระบบเติมชนิดนี้ให้ (utils/mtnItemSuggest.js)
     คอลัมน์ `mo_item_type` มาจาก migration — ยังไม่รัน = ไม่โชว์ช่อง (ส่งคอลัมน์ที่ไม่มี = บันทึกล้มทั้งแถว) */
  const hasMoCol = types.some(t => Object.prototype.hasOwnProperty.call(t, 'mo_item_type'));
  const [itemNames, setItemNames] = useState([]);
  useEffect(() => {
    if (!hasMoCol) return undefined;
    let alive = true;
    supabaseDR.from('mtn_item_types').select('name, team').eq('is_active', true).order('sort_order')
      .then(({ data, error }) => { if (!alive) return; if (error) toast.error(`โหลดชนิดอุปกรณ์ไม่สำเร็จ: ${error.message}`); setItemNames((data || []).filter(r => !/^DIE\b/i.test(r.name || '')).map(r => r.name)); });
    return () => { alive = false; };
  }, [hasMoCol]);

  // สร้างใหม่ default สีที่ยังไม่ซ้ำกับประเภทที่มี (ผู้ใช้เปลี่ยนทับได้)
  const startAdd = () => { setForm({ ...emptyType, color: pickUnusedColor(types.map(t => t.color)), sort_order: types.length + 1 }); setEditingId('new'); };
  const startEdit = (t) => { setForm({ id: t.id, label: t.label, color: t.color, icon: t.icon || '', sort_order: t.sort_order, is_active: t.is_active, mo_item_type: t.mo_item_type || '' }); setEditingId(t.id); };
  const cancelEdit = () => { setEditingId(null); setForm(emptyType); };

  const handleSave = async () => {
    /* ด่านชั้น 2 — ทะเบียนนี้เป็น "ของกลางทั้งโรงงาน" (ไม่มีเจ้าของรายหน่วย) ⇒ ด่าน = คีย์สิทธิ์
       ซ่อนปุ่มไม่ใช่ด่าน: โมดัลเปิดค้างตอนสิทธิ์เปลี่ยน / เรียกตรงได้ (QC audit §7.4 · 20/10) */
    if (!canEdit) { toast.error('แก้ทะเบียนประเภทเครื่องจักรต้องมีสิทธิ์ machines:edit'); return; }
    if (!form.label.trim()) { toast.error('กรอกชื่อประเภท'); return; }
    setSaving(true);
    const payload = { label: form.label.trim(), color: form.color, icon: form.icon.trim() || null, sort_order: parseInt(form.sort_order) || 0, is_active: form.is_active,
      ...(hasMoCol ? { mo_item_type: (form.mo_item_type || '').trim() || null } : {}) };
    const { error } = editingId === 'new'
      ? await supabaseDR.from('machine_types').insert(payload)
      : await supabaseDR.from('machine_types').update(payload).eq('id', editingId);
    setSaving(false);
    if (error) { toast.error(error.message.includes('duplicate') ? 'มีชื่อประเภทนี้อยู่แล้ว' : error.message); return; }
    toast.success('บันทึกสำเร็จ');
    cancelEdit();
    onChange();
  };

  const handleDelete = async (t) => {
    if (!canEdit) { toast.error('ลบประเภทเครื่องจักรต้องมีสิทธิ์ machines:edit'); return; }
    if (!window.confirm(`ลบประเภท "${t.label}" ?\n\nเครื่องจักรที่ใช้ประเภทนี้จะกลายเป็น "ไม่ระบุประเภท"`)) return;
    // นับแถวที่ลบจริง (กฎเขียน DB ข้อ 2) — 0 แถวแล้วปิดเงียบ = ทะเบียนยังอยู่แต่จอบอกว่าลบแล้ว
    if (!checkWriteRows(await supabaseDR.from('machine_types').delete().eq('id', t.id).select('id'), 'ลบประเภทเครื่องจักร')) return;
    onChange();
  };

  return (
    <div className="overlay" style={{ zIndex: 2100 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 14, padding: 24, width: 'min(95vw,460px)', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>🏷️ ประเภทเครื่องจักร</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>
          สร้างประเภทเองได้ไม่จำกัด เช่น แยก "Robot" ออกเป็น "Robot - Arc Welding" / "Robot - Handling"
        </div>

        <div style={{ flex: 1, overflowY: 'auto', marginBottom: 12 }}>
          {types.map(t => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ width: 12, height: 12, borderRadius: 4, background: t.color, flexShrink: 0 }} />
              <span style={{ fontSize: 13, color: 'var(--text)', flex: 1 }}>{t.icon || ''} {t.label}
                {hasMoCol && <span style={{ fontSize: 11, color: t.mo_item_type ? 'var(--text2)' : 'var(--muted)', marginLeft: 6 }}>{t.mo_item_type ? `→ ใบ MO: ${t.mo_item_type}` : '· ยังไม่ผูกชนิดในใบ MO'}</span>}</span>
              {canEdit && (
                <>
                  <button className="tbtn" onClick={() => startEdit(t)} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 9px', fontSize: 11, cursor: 'pointer', color: 'var(--text)' }}>แก้ไข</button>
                  <DeleteButton onClick={() => handleDelete(t)} title="ลบรายการนี้" />
                </>
              )}
            </div>
          ))}
          {types.length === 0 && <div style={{ textAlign: 'center', padding: '12px 0', color: 'var(--muted)', fontSize: 12 }}>ยังไม่มีประเภทเครื่องจักร</div>}
        </div>

        {canEdit && (
          editingId ? (
            <div style={{ background: 'var(--bg2)', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input autoFocus placeholder="ชื่อประเภท เช่น Robot - Arc Welding" value={form.label}
                onChange={e => setForm(f => ({ ...f, label: e.target.value }))} style={inputStyle} />
              {hasMoCol && (
                <label style={{ fontSize: 11, color: 'var(--muted)' }}>ชนิดอุปกรณ์ในใบแจ้งซ่อม (เลือก MC No. แล้วระบบเติมให้)
                  <select value={form.mo_item_type || ''} onChange={e => setForm(f => ({ ...f, mo_item_type: e.target.value }))} style={{ ...inputStyle, marginTop: 3 }}>
                    <option value="">— ไม่ผูก (ให้ผู้แจ้งเลือกเอง) —</option>
                    {form.mo_item_type && !itemNames.includes(form.mo_item_type) && <option value={form.mo_item_type}>{form.mo_item_type} (ปิดใช้แล้ว)</option>}
                    {itemNames.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
              )}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ width: 150 }}>
                  <EmojiPicker value={form.icon} onChange={v => setForm(f => ({ ...f, icon: v }))} style={inputStyle} />
                </div>
                <div style={{ display: 'flex', gap: 5 }}>
                  {/* สีที่สุ่มมาอาจอยู่นอก swatch ตายตัว — prepend ให้เห็น/เลือกกลับได้เสมอ */}
                  {[...new Set([form.color, ...TYPE_COLORS])].map(c => (
                    <button key={c} type="button" onClick={() => setForm(f => ({ ...f, color: c }))}
                      style={{ width: 20, height: 20, borderRadius: 5, background: c, border: form.color === c ? '2px solid var(--text)' : '2px solid transparent', cursor: 'pointer' }} />
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={handleSave} disabled={saving} style={{ ...saveBtnStyle, flex: 1, opacity: saving ? 0.6 : 1 }}>{saving ? '...' : 'บันทึก'}</button>
                <button onClick={cancelEdit} style={cancelBtnStyle}>ยกเลิก</button>
              </div>
            </div>
          ) : (
            <button onClick={startAdd} style={{ ...saveBtnStyle, width: '100%' }}>+ เพิ่มประเภทใหม่</button>
          )
        )}
      </div>
    </div>
  );
}
