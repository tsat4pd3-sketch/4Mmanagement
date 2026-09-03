import { useState, useEffect, useRef, useMemo, useContext } from 'react';
import { toDecodableImage } from '../utils/heicToJpeg';
import imageCompression from 'browser-image-compression';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { can, canDelete } from '../utils/permissions';
import { inSectionScope } from '../utils/sectionScope';
import { LINE_TYPES, FLOW_MODES } from '../utils/lineTypes';
import useUndoHistory, { undoBtnStyle } from '../utils/useUndoHistory';
import { markerScale } from '../utils/markerScale';
import useIsMobile from '../utils/useIsMobile';
import { toast } from '../components/Toast';
import ToggleDot from '../components/ToggleDot';
import useTabParam from '../utils/useTabParam';
import LineFlowPanel from '../components/LineFlowPanel';
import DeliveryPointPanel from '../components/DeliveryPointPanel';
import { matDigit, matClassOf, matMatches, isSapMat } from '../utils/matPrefix';
import { mergeMatRegistry, buildWipMatOptions, filterWipMatByCat, wipCatOptions, wipCatValue, wipCatLabel, wipPointCat, WIP_CAT_OP } from '../utils/wipMatOptions';
import { getLineFamilyNames } from '../utils/lineHierarchy';
import { loadOpInfo } from '../utils/opItems';
import SearchSelect from '../components/SearchSelect';
import { invalidateProductionLines } from '../utils/useProductionLines';
import { notifyEvent } from '../utils/notifyEvent';

// ลำดับแท็บมาตรฐานทั้งระบบ: คน → เครื่องจักร → WIP (ตามลำดับ 4M: Man, Machine, Material)
// ให้ตรงกับปุ่ม filter MAN/MACHINE/WIP ที่หน้า Management — UI-CONVENTIONS §1
const TABS = [
  { key: 'stations', label: '📍 จุดงาน' },
  { key: 'machines', label: '⚙️ เครื่องจักร' },
  { key: 'wip',      label: '📦 จุด WIP' },
];


const SKILL_CAT_META = {
  hard_skill:    { label: 'Hard Skill',    color: '#ef4444', icon: '🔧', desc: 'ทักษะการทำงานรูปแบบต่างๆ' },
  machine_skill: { label: 'Machine Skill', color: '#f97316', icon: '⚙️', desc: 'ใช้ ปรับตั้ง ควบคุมเครื่องจักร' },
  product_skill: { label: 'Product Skill', color: '#3b82f6', icon: '📦', desc: 'คุณภาพกระบวนการผลิต' },
  soft_skill:    { label: 'Soft Skill',    color: '#a855f7', icon: '🧠', desc: 'หลักการคิด ระบบการทำงาน' },
};

// กล่องตำแหน่งในหน้า setup นี้เป็นแค่ "หมุด" บอกตำแหน่งจริงบนผัง ไม่ใช่ขนาดการ์ดที่ใช้แสดงผลจริง
// การ์ดพนักงานขนาดเต็ม (104x92) จะถูกจัดการเรื่องเว้นระยะ/ทับกันแยกในหน้า Management.jsx เอง
const CARD_W = 70;
const CARD_H = 58;

// จุด WIP / เครื่องจักร ไม่ต้องเท่ากับ card พนักงาน — ใช้กล่องเล็กลง (~50%)
const POINT_W = 54;
const POINT_H = 46;

export default function LineSetup({ embedded = false } = {}) {
  // embedded=true เมื่อฝังในแท็บ "ผลิต" ของ /layout-setup — ปรับ height/padding ให้พอดีในกรอบแท็บ (ไม่ใช้ 100vh)
  // สิทธิ์แก้ไข — role ที่ไม่มี line_setup:edit เห็นหน้าแบบอ่านอย่างเดียว (ดูผัง/รายการได้ แก้ไม่ได้)
  const { role, sections: scopeSecs = [], fullName } = useContext(UserContext);
  const canEdit = can('line_setup', 'edit', role);
  const canDel  = canDelete('line_setup', 'edit', role);  // สิทธิ์ลบไลน์/จุดงาน แยกจากแก้ไข (fallback = edit ถ้ายังไม่ seed)
  const [lines, setLines] = useState([]);
  const [selectedLine, setSelectedLine] = useState('');
  const [newLineName, setNewLineName] = useState('');
  const [newLineSection, setNewLineSection] = useState('');
  const [newLineParent, setNewLineParent] = useState('');
  const [isAddingLine, setIsAddingLine] = useState(false);
  const [editingLineId, setEditingLineId] = useState(null);
  const [editingLineName, setEditingLineName] = useState('');
  const [layoutImage, setLayoutImage] = useState(null);
  const [usingParentLayout, setUsingParentLayout] = useState(false); // true = ยืมรูปผังจากไลน์หลักมาแสดง (ยังไม่มีรูปของตัวเอง)
  const [stations, setStations] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [tempPos, setTempPos] = useState(null);
  const [formData, setFormData] = useState({ id: null, name: '', requirements: {}, skill_allowance: false, skill_allowance_type: '' });
  const isMobile = useIsMobile();
  const [collisionWarn, setCollisionWarn] = useState(null); // string message หรือ null
  const [showManpower, setShowManpower] = useState(false);
  const [skillDefs, setSkillDefs] = useState([]);
  const [sectionOpts, setSectionOpts] = useState([]);
  // ⚠️ ใช้ param `sub` ไม่ใช่ `tab` — หน้านี้ถูกฝังในแท็บ 'ผลิต' ของ /layout-setup ซึ่งจอง ?tab= ไปแล้ว
  const [activeTab, setActiveTab] = useTabParam(TABS.map(t => t.key), 'stations', 'sub');
  // UX แถบขวา: ค้นหา + พับรายการ (ข้อมูลเยอะ เลื่อนหายาก — 2026-07-24)
  const [lineSearch, setLineSearch] = useState('');
  const [lineListOpen, setLineListOpen] = useState(() => { try { return localStorage.getItem('ls_lineList_open') !== '0'; } catch { return true; } });
  const [pointSearch, setPointSearch] = useState('');
  const toggleLineList = () => setLineListOpen(o => { const n = !o; try { localStorage.setItem('ls_lineList_open', n ? '1' : '0'); } catch { /* private */ } return n; });
  // พับ/กางไลน์ย่อยราย "ไลน์แม่" (ปุ่ม ▼/▶ หน้าไลน์แม่) — เก็บชื่อไลน์แม่ที่พับอยู่ · จำใน localStorage
  const [collapsedParents, setCollapsedParents] = useState(() => { try { return new Set(JSON.parse(localStorage.getItem('ls_collapsed_parents') || '[]')); } catch { return new Set(); } });
  const toggleParent = (name) => setCollapsedParents(s => {
    const n = new Set(s); if (n.has(name)) n.delete(name); else n.add(name);
    try { localStorage.setItem('ls_collapsed_parents', JSON.stringify([...n])); } catch { /* private */ }
    return n;
  });
  // ป้ายชื่อบนผัง: โชว์/ซ่อน อย่างเดียว เหมือนหน้า Management เป๊ะ (WYSIWYG)
  const [showPills, setShowPills] = useState(true);

  // ลากย้ายจุดที่มีอยู่แล้วได้ (ไม่ต้องลบสร้างใหม่) — drag เกินระยะนิดเดียวถือเป็นการลาก ไม่ใช่คลิกแก้ไข
  const imgRef = useRef(null);
  const [dragInfo, setDragInfo] = useState(null); // { kind: 'station'|'wip'|'machine', id }
  const [dragPos, setDragPos] = useState(null);   // { top, left } พรีวิวระหว่างลาก
  const dragMovedRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const dragPosRef = useRef(null);

  // กรอบของ "ตัวรูปจริง" หลังหักแถบว่าง letterbox จาก object-fit: contain
  // พิกัด pos_top/pos_left ทุกจุดเก็บเป็น % ของตัวรูปจริง (ไม่ใช่ % ของกล่อง container)
  // เพื่อให้ตำแหน่งตรงกันทุกหน้า (Management / Dashboard) และไม่เพี้ยนเมื่อจอ/sidebar เปลี่ยนขนาด
  const [imgBox, setImgBox] = useState(null); // { ox, oy, rw, rh }

  // จุด WIP buffer (min/max ต่อจุด — แผนกที่เกี่ยวข้องเห็นเมื่อของต่ำกว่า min)
  // 2 ประเภท: material (เรียกงานจากสโตร์ ผูกกับ mat no. จาก Product Master) และ
  // packaging (เรียกภาชนะเปล่าจาก Tact Center — rack/box/basket แยกด้วย packaging no.)
  const [wipPoints, setWipPoints] = useState([]);
  const [wipTempPos, setWipTempPos] = useState(null);
  const [drProducts, setDrProducts] = useState([]);   // ทะเบียน mat ทั้งหมด + ไลน์ที่ผลิต (ใช้จัดลำดับ picker จุด WIP)
  const [upstreamLines, setUpstreamLines] = useState(new Set());
  const [wipMatAllCat, setWipMatAllCat] = useState(false); // กด "ดูทุกประเภท" ในช่องเลือกวัสดุของจุด WIP
  const [containerTypes, setContainerTypes] = useState([]);
  const emptyWipForm = { id: null, point_type: 'material', point_name: '', mat_no: '', material_category: '', packaging_no: '', packaging_type: '', min_qty: 0, max_qty: 0, current_qty: 0 };
  const [wipForm, setWipForm] = useState(emptyWipForm);

  // จุดเครื่องจักรบนผัง (ผูกกับตาราง machines ของ Daily Report โปรเจกต์ ด้วย machine_no)
  const [machinePoints, setMachinePoints] = useState([]);
  const [machineTempPos, setMachineTempPos] = useState(null);
  const [machineForm, setMachineForm] = useState({ id: null, machine_no: '', redundancy_group: '' });
  const [placedMachineNos, setPlacedMachineNos] = useState(new Set());
  const [drMachines, setDrMachines] = useState([]);
  const [machineTypes, setMachineTypes] = useState([]);

  // เส้นทางการผลิตแบบต่อเนื่อง (sequential flow) ระหว่างจุดเครื่องจักร — ใช้บอกว่า
  // เครื่องไหนหยุดแล้วทำให้สายงานหยุดทั้งสาย (ตรงข้ามกับเครื่อง parallel ที่หยุดแค่ตัวเอง)
  const [flowLinks, setFlowLinks] = useState([]);
  const [connectMode, setConnectMode] = useState(false);
  const [connectFrom, setConnectFrom] = useState(null);

  // Standard manpower
  const [stdDay,   setStdDay]   = useState(0);
  const [stdNight, setStdNight] = useState(0);
  const [costCenter, setCostCenter] = useState('');
  const [lineType, setLineType] = useState('');
  const hasLineTypeCol = useRef(true); // false = DB ยังไม่มีคอลัมน์ line_type (migration 20260722 ยังไม่ apply)
  const [flowMode, setFlowMode] = useState('one_piece_flow');
  const [parallelStations, setParallelStations] = useState('');
  const hasFlowModeCol = useRef(true); // false = DB ยังไม่มีคอลัมน์ flow_mode (migration 20260723 ยังไม่ apply)
  const [mpSaving, setMpSaving] = useState(false);

  // หัวหน้างานประจำไลน์ (head_name) — ใช้ในใบค่าฝีมือ · ผู้เซ็นราย section ย้ายไปตั้งที่ผังองค์กร (OrgSetup)
  const [signerHead,    setSignerHead]    = useState('');


  // ─── Undo/Redo — จุดบนผังไลน์ (จุดงาน+ทักษะ / WIP / เครื่องจักร / เส้น flow) ───
  // snapshot ทั้ง 4 ชุดของไลน์ที่เลือก · restore = diff แล้วเขียนย้อนลง DB · สลับไลน์ = ล้าง history
  const mapRef = useRef({ stations: [], wipPoints: [], machinePoints: [], flowLinks: [] });
  useEffect(() => { mapRef.current = { stations, wipPoints, machinePoints, flowLinks }; }, [stations, wipPoints, machinePoints, flowLinks]);
  const ST_F = ['line_name', 'station_name', 'pos_top', 'pos_left', 'skill_allowance', 'skill_allowance_type'];
  const SR_F = ['station_id', 'skill_name', 'min_score'];
  const WIP_F = ['line_name', 'point_name', 'point_type', 'mat_no', 'material_category', 'packaging_no', 'packaging_type', 'pos_top', 'pos_left', 'min_qty', 'max_qty', 'current_qty'];
  const MP_F = ['line_name', 'machine_no', 'pos_top', 'pos_left', 'redundancy_group'];
  const FL_F = ['line_name', 'from_machine_point_id', 'to_machine_point_id'];
  const pickF = (row, fields) => Object.fromEntries(fields.map(f => [f, row[f] ?? null]));
  const mapSnap = () => ({
    line: selectedLine,
    stations: mapRef.current.stations.map(s => ({ ...s, station_requirements: (s.station_requirements || []).map(r => ({ ...r })) })),
    wipPoints: mapRef.current.wipPoints.map(p => ({ ...p })),
    machinePoints: mapRef.current.machinePoints.map(p => ({ ...p })),
    flowLinks: mapRef.current.flowLinks.map(l => ({ ...l })),
  });
  const diffSets = (snapRows, curRows, fields) => {
    const sM = new Map(snapRows.map(r => [r.id, r])), cM = new Map(curRows.map(r => [r.id, r]));
    return {
      del: curRows.filter(r => !sM.has(r.id)).map(r => r.id),
      ins: snapRows.filter(r => !cM.has(r.id)).map(r => ({ id: r.id, ...pickF(r, fields) })),
      upd: snapRows.filter(r => { const c = cM.get(r.id); return c && fields.some(f => (c[f] ?? null) !== (r[f] ?? null)); }),
    };
  };
  const applyMapSnapshot = async (snap) => {
    if (snap.line !== selectedLine) return false;   // สลับไลน์แล้ว (history ถูก clear ตอนสลับอยู่แล้ว — กันเผื่อ)
    const cur = mapRef.current;
    const curSr = cur.stations.flatMap(s => s.station_requirements || []);
    const snapSr = snap.stations.flatMap(s => s.station_requirements || []);
    const st = diffSets(snap.stations, cur.stations, ST_F);
    const sr = diffSets(snapSr, curSr, SR_F);
    const wp = diffSets(snap.wipPoints, cur.wipPoints, WIP_F);
    const mp = diffSets(snap.machinePoints, cur.machinePoints, MP_F);
    const fl = diffSets(snap.flowLinks, cur.flowLinks, FL_F);
    try {
      // ลำดับตาม FK: ลบ ลูก→แม่ (links/requirements ก่อน points/stations) · คืน แม่→ลูก
      for (const [tbl, ids] of [['machine_flow_links', fl.del], ['station_requirements', sr.del], ['machine_points', mp.del], ['wip_buffer_points', wp.del], ['workstations', st.del]]) {
        if (ids.length) { const { error } = await supabase.from(tbl).delete().in('id', ids); if (error) throw error; }
      }
      for (const [tbl, rows] of [['workstations', st.ins], ['station_requirements', sr.ins], ['machine_points', mp.ins], ['wip_buffer_points', wp.ins], ['machine_flow_links', fl.ins]]) {
        if (rows.length) { const { error } = await supabase.from(tbl).insert(rows); if (error) throw error; }
      }
      for (const [tbl, rows, fields] of [['workstations', st.upd, ST_F], ['station_requirements', sr.upd, SR_F], ['machine_points', mp.upd, MP_F], ['wip_buffer_points', wp.upd, WIP_F], ['machine_flow_links', fl.upd, FL_F]]) {
        for (const r of rows) { const { error } = await supabase.from(tbl).update(pickF(r, fields)).eq('id', r.id); if (error) throw error; }
      }
    } catch (err) { toast.error('ย้อนไม่สำเร็จ: ' + err.message); await fetchLineData(); return false; }
    await fetchLineData();
    return true;
  };
  const hist = useUndoHistory({ snapOf: mapSnap, applySnapshot: applyMapSnapshot, enabled: canEdit });
  useEffect(() => { hist.clear(); }, [selectedLine]); // eslint-disable-line react-hooks/exhaustive-deps

  // เครื่องที่เลือกวางได้ = ยัง active + ยังไม่ถูกวางบนผังไลน์ใดในครอบครัว (+ ตัวที่กำลังแก้ไขอยู่)
  const selectableMachines = useMemo(() => drMachines.filter(m =>
    m.is_active && (m.machine_no === machineForm.machine_no || !placedMachineNos.has(m.machine_no))
  ), [drMachines, placedMachineNos, machineForm.machine_no]);

  const skillAllowanceTypes = useMemo(() => [...new Set(skillDefs.filter(sd => sd.category === 'allowance_skill' && sd.allowance_type).map(sd => sd.allowance_type))].sort(), [skillDefs]);

  /* ตัวเลือกวัสดุของจุด WIP — สูตร/ลำดับกลุ่มอยู่ใน src/utils/wipMatOptions.js ที่เดียว
     (เสนอลำดับ ไม่ตัดอะไรทิ้ง · กรองตามประเภทได้แต่ต้องบอกว่าซ่อนไปกี่รายการ) */
  const wipMatOptions = useMemo(
    () => buildWipMatOptions(drProducts, { line: selectedLine, lines, upstreamLines }),
    [drProducts, lines, selectedLine, upstreamLines],
  );
  const wipMatCat = wipCatValue(wipForm.material_category);
  const { rows: wipMatShown, hidden: wipMatHidden, keptUnjudged: wipMatKept } = useMemo(
    () => filterWipMatByCat(wipMatOptions, wipMatCat, wipMatAllCat),
    [wipMatOptions, wipMatCat, wipMatAllCat],
  );
  const wipMatSel = wipMatOptions.find(o => o.id === wipForm.mat_no) || null;
  const wipMatIsOp = wipMatSel?.isOp;
  // ประเภทที่ระบบอ่านได้เองจากเลข mat (ใช้บอกว่าไม่ต้องเลือกซ้ำ)
  const wipMatDerived = wipPointCat('', wipForm.mat_no, wipMatIsOp);

  // ตัวเลือก Section จำกัดตามขอบเขตส่วนงานของ user (scope ว่าง = เลือกได้ทุกส่วน)
  const sectionOptsInScope = scopeSecs.length ? sectionOpts.filter(s => inSectionScope(scopeSecs, s)) : sectionOpts;

  /* ── ลำดับชั้นของข้อมูลในแผง Standard Manpower (2026-08-05) ──
     แผงนี้เคยยัด field 3 ระดับความหมายไว้ในกล่องเดียวโดยไม่บอกว่าอันไหนอยู่ระดับไหน
     → ข้อมูลจริงเลยมี 3 convention ปนกัน (ก็อปทับ / แม่≠ผลรวมลูก / แม่อย่างเดียว) และแต่ละหน้าเดากันเอง
     ตอนนี้แยกชัด: "ข้อมูลของกลุ่ม" (กำลังคน/cost center/หัวหน้า — ลูกตกทอดจากแม่ กฎเดียวกับ shift_schedules)
     กับ "ข้อมูลเฉพาะไลน์นี้" (ประเภทไลน์/โหมดไหลงาน/เครื่องขนาน — เป็นคุณสมบัติเครื่องจริง ไม่ตกทอด) */
  const selLineObj    = lines.find(l => l.name === selectedLine) || null;
  const parentLineObj = selLineObj?.parent_line_name ? (lines.find(l => l.name === selLineObj.parent_line_name) || null) : null;
  const childLines    = lines.filter(l => l.parent_line_name === selectedLine);

  const fetchLines = async () => {
    const BASE = 'id, name, section, std_day_shift, std_night_shift, cost_center, head_name, parent_line_name, is_active';
    let { data, error } = await supabase.from('production_lines').select(`${BASE}, line_type, flow_mode, parallel_stations`).order('name');
    if (error) {
      // คอลัมน์เสริมยังไม่ apply (migration 20260722 line_type / 20260723 flow_mode)
      // ⚠️ ต้อง probe ทีละคอลัมน์แยกกัน — เดิม query รวมพังทีเดียวแล้วปิดทั้งคู่
      //    ทำให้ line_type ที่ไม่มีจริง ลาก flow_mode/parallel_stations (ที่มีอยู่จริง) ปิดตามไปด้วย
      //    → แผงตั้งเครื่องขนานเซฟไม่ติดทั้งที่ DB พร้อม (บั๊กเงียบ แก้ 2026-08-05)
      const probe = async (col) => !(await supabase.from('production_lines').select(`id, ${col}`).limit(1)).error;
      hasLineTypeCol.current = await probe('line_type');
      hasFlowModeCol.current = await probe('flow_mode, parallel_stations');
      const cols = [BASE,
        hasLineTypeCol.current ? 'line_type' : null,
        hasFlowModeCol.current ? 'flow_mode, parallel_stations' : null,
      ].filter(Boolean).join(', ');
      data = (await supabase.from('production_lines').select(cols).order('name')).data;
    }
    // mandatory scope filter — role ที่ถูกจำกัดขอบเขตส่วนงาน (supervisor/manager ที่ตั้ง sections)
    // เห็น/แก้ได้เฉพาะไลน์ในส่วนงานตัวเอง — หน้านี้เป็นหน้า edit master data ห้ามเห็นข้ามส่วนงาน
    const visible = scopeSecs.length ? (data || []).filter(l => inSectionScope(scopeSecs, l.section)) : (data || []);
    setLines(visible);
    if (visible.length > 0 && !selectedLine) setSelectedLine(visible[0].name);
  };

  useEffect(() => {
    fetchLines();
    supabase.from('skill_definitions').select('*').order('sort_order').then(({ data }) => setSkillDefs(data || []));
    supabase.from('org_nodes').select('code, name').eq('kind', 'section').eq('is_active', true).order('sort_order')
      .then(({ data }) => setSectionOpts((data || []).map(n => n.code || n.name)));
  }, []);

  useEffect(() => {
    if (selectedLine) fetchLineData();
  }, [selectedLine]);

  const fetchLineData = async () => {
    const lineObj0 = lines.find(l => l.name === selectedLine);
    const { data: layoutData } = await supabase.from('line_layouts').select('*').eq('line_name', selectedLine).maybeSingle();
    if (layoutData?.image_url) {
      setLayoutImage(layoutData.image_url);
      setUsingParentLayout(false);
    } else if (lineObj0?.parent_line_name) {
      // ไลน์ย่อย (เช่น HDF1) ไม่มีรูปผังของตัวเอง — ใช้รูปเดียวกับไลน์หลัก (HYDROFORM) แทน
      // เพราะจริงๆ อยู่พื้นที่เดียวกันในโรงงาน ไม่ต้องอัปโหลดรูปซ้ำ
      const { data: parentLayout } = await supabase.from('line_layouts').select('image_url').eq('line_name', lineObj0.parent_line_name).maybeSingle();
      setLayoutImage(parentLayout?.image_url || null);
      setUsingParentLayout(!!parentLayout?.image_url);
    } else {
      setLayoutImage(null);
      setUsingParentLayout(false);
    }
    const { data: stationData } = await supabase.from('workstations').select('*, station_requirements(*)').eq('line_name', selectedLine);
    setStations(stationData || []);
    const { data: wipData } = await supabase.from('wip_buffer_points').select('*').eq('line_name', selectedLine).order('point_name');
    setWipPoints(wipData || []);
    const { data: mpData } = await supabase.from('machine_points').select('*').eq('line_name', selectedLine);
    setMachinePoints(mpData || []);
    const { data: flData } = await supabase.from('machine_flow_links').select('*').eq('line_name', selectedLine);
    setFlowLinks(flData || []);
    // ไลน์ใหญ่ (parent) ใช้ผังจริงวางเครื่องของทั้ง family → picker/รายการเครื่องต้องเห็นเครื่องของไลน์ลูกด้วย
    // ไลน์ย่อย/standalone → family = ตัวเอง (พฤติกรรมเดิม)
    const familyLines = [selectedLine, ...lines.filter(l => l.parent_line_name === selectedLine).map(l => l.name)];
    const { data: drMc } = await supabaseDR.from('machines').select('*, machine_types(id, label, color, icon)').in('line_name', familyLines).order('sort_order');
    setDrMachines(drMc || []);
    // เครื่องที่ถูกวางบนผังไปแล้ว (ทุกไลน์ในครอบครัว ไม่ใช่แค่ไลน์ที่เปิดอยู่) — ซ่อนจาก dropdown กันวางซ้ำ
    // (ไลน์แม่/ลูกใช้คนละผังได้ ถ้าเช็คแค่ไลน์ปัจจุบันจะเห็นเครื่องที่วางบนผังไลน์พี่น้องไปแล้ว)
    const { data: placedMp } = await supabase.from('machine_points').select('machine_no').in('line_name', familyLines);
    setPlacedMachineNos(new Set((placedMp || []).map(p => p.machine_no).filter(Boolean)));
    const { data: drMt } = await supabaseDR.from('machine_types').select('*').order('sort_order');
    setMachineTypes(drMt || []);
    /* ⚠️⚠️ พาร์ทของจุด WIP ต้องมาจาก "ทะเบียนกลาง parts_master" ไม่ใช่ dr_products ของไลน์นี้
       เดิม: dr_products .eq('line_name', selectedLine) → ลิสต์เหลือไม่กี่ตัว (feedback "พาร์ทโชว์ไม่ครบ")
       ผิด 3 ชั้นซ้อนกัน:
        (ก) `dr_products` = **มุมการผลิต** เก็บเฉพาะของที่ผลิตในไลน์ → พาร์ทซื้อนอก (3xx) และ
            วัตถุดิบ (5xx) ไม่มีทางโผล่เลย ทั้งที่จุด WIP เก็บของพวกนี้ได้ และ placeholder ก็เขียนว่า
            "ค้นจาก Product Master" ซึ่งทะเบียนจริงคือ parts_master (กฎ: parts_master = ทะเบียนกลางของทุก mat)
        (ข) กรอง line_name **ตรงเป๊ะ** = บั๊ก class เดียวกับ picker เครื่องจักร/ชิ้นงานที่แก้ไปแล้ว 3 รอบ
            (dtMatOptions · machineOpts /improvements · dtMachineOptions) — ของที่ลงทะเบียนไว้ที่ไลน์แม่
            หรือไลน์พี่น้องหายหมด · สังเกตว่าคิวรี machines เหนือบรรทัดนี้ใช้ familyLines อยู่แล้ว ตกหล่นแค่ตัวนี้
        (ค) จุด WIP ยิ่งชัดกว่านั้น: ของในบัฟเฟอร์มาจาก **ไลน์ต้นน้ำ** ไม่ใช่ไลน์ที่ตั้งจุด
            (HDF1 ปั๊ม → บัฟเฟอร์ → LASER-345 กิน) → ต่อให้กางครอบครัวไลน์ก็ยังไม่พอ
       → โหลดทะเบียนทั้งหมด แล้วใช้ dr_products/line_flow_links แค่ **จัดลำดับ** ห้ามตัดอะไรทิ้ง */
    const [{ data: pmRows }, { data: drPd }, { data: flRows }, opMap] = await Promise.all([
      supabaseDR.from('parts_master').select('mat_no, part_name').eq('is_active', true).not('mat_no', 'is', null).order('mat_no'),
      // ⚠️ dr_products ใช้คอลัมน์ `name` · parts_master ใช้ `part_name` (คนละชื่อ — select ผิดได้ 42703 เงียบ)
      supabaseDR.from('dr_products').select('mat_no, name, line_name').eq('is_active', true).not('mat_no', 'is', null),
      supabaseDR.from('line_flow_links').select('from_line, to_line').eq('is_active', true),
      // รายการขั้นตอน (OP) — ผ่าน util กลาง (cache ระดับ module · best-effort) เพื่อ "ติดป้าย" ไม่ใช่กรองทิ้ง
      loadOpInfo(),
    ]);
    setDrProducts(mergeMatRegistry(pmRows || [], drPd || [], opMap));
    /* ไลน์ต้นน้ำที่ป้อนงานให้ไลน์นี้ (โหลดไม่ได้ = ไม่มีกลุ่ม "ต้นน้ำ" เฉยๆ ลิสต์ยังครบ)
       ⚠️ เทียบทั้งครอบครัวไลน์ ไม่ใช่ `familyLines` ของ machines (นั่นคือ ตัวเอง+ลูก สำหรับวางเครื่องบนผัง)
       — ป้อนงานให้ไลน์แม่ = ป้อนให้งานที่ไลน์ลูกทำด้วย */
    const famAll = new Set(getLineFamilyNames(lines, selectedLine));
    famAll.add(selectedLine);
    setUpstreamLines(new Set((flRows || []).filter(l => famAll.has(l.to_line)).map(l => l.from_line)));
    // ภาชนะ — ดึงจาก container_types (supabaseDR) ตารางกลางเดียวกับ Packaging/Rack Center
    const { data: ctData } = await supabaseDR.from('container_types').select('code, name, category').eq('is_active', true).order('code');
    setContainerTypes(ctData || []);
    const lineObj = lines.find(l => l.name === selectedLine);
    if (lineObj) {
      setStdDay(lineObj.std_day_shift ?? 0);
      setStdNight(lineObj.std_night_shift ?? 0);
      setCostCenter(lineObj.cost_center ?? '');
      setLineType(lineObj.line_type ?? '');
      setFlowMode(lineObj.flow_mode ?? 'one_piece_flow');
      setParallelStations(lineObj.parallel_stations != null ? String(lineObj.parallel_stations) : '');
      setSignerHead(lineObj.head_name ?? '');
    }
  };

  /** ปลดระวาง/คืนสถานะไลน์ — บันทึกทันทีแยกจากปุ่ม 💾 (เป็น action ไม่ใช่ค่าในฟอร์ม) */
  const handleToggleRetire = async (retire) => {
    const lineObj = lines.find(l => l.name === selectedLine);
    if (!lineObj) return;
    if (retire && !window.confirm(`ปลดระวางไลน์ "${lineObj.name}" ?\n\nไลน์จะไม่โผล่ใน dropdown ให้เลือกใหม่ทุกหน้า\nแต่ข้อมูลเก่าที่อ้างชื่อไลน์นี้ยังอ่านได้ครบ (ไม่ใช่การลบ)`)) return;
    const { data, error } = await supabase.from('production_lines')
      .update({ is_active: !retire }).eq('id', lineObj.id).select('id');
    if (error) {
      toast.error(/is_active/.test(error.message || '')
        ? 'ยังไม่ได้ apply migration 20260821_production_lines_is_active — แจ้ง admin'
        : error.message);
      return;
    }
    // ⚠️ RLS ปฏิเสธ UPDATE = สำเร็จ 0 แถว ไม่ error → ต้องนับแถวเสมอ (กฎ CLAUDE.md)
    if (!data?.length) { toast.error('ไม่มีแถวถูกแก้ — ตรวจสิทธิ์การแก้ทะเบียนไลน์'); return; }
    toast.success(retire ? `⏸ ปลดระวาง ${lineObj.name} แล้ว` : `▶ คืนสถานะ ${lineObj.name} แล้ว`);
    invalidateProductionLines();   // ให้หน้าอื่นเห็นทันที ไม่ต้องรอ cache หมดอายุ
    fetchLines();
  };

  const handleSaveStdManpower = async () => {
    const lineObj = lines.find(l => l.name === selectedLine);
    if (!lineObj) return;
    setMpSaving(true);
    const { error } = await supabase
      .from('production_lines')
      .update({
        std_day_shift: parseInt(stdDay) || 0, std_night_shift: parseInt(stdNight) || 0,
        cost_center: costCenter || null, head_name: signerHead || null,
        ...(hasLineTypeCol.current ? { line_type: lineType || null } : {}),
        ...(hasFlowModeCol.current ? {
          flow_mode: flowMode || 'one_piece_flow',
          // parallel_stations แยกจาก flow_mode (2026-08-05): ไลน์งานคู่ LH/RH เช่น LASER-345/789
          // เป็น one_piece_flow บนบอร์ด แต่ตั้ง N เครื่องขนานเพื่อหัก DT 1/N ใน OEE ได้
          parallel_stations: parseInt(parallelStations) > 0 ? parseInt(parallelStations) : null,
        } : {}),
      })
      .eq('id', lineObj.id);
    if (error) {
      // คอลัมน์ flow_mode ยังไม่ apply — retry โดยตัด field ออก (ไม่ให้ save พังทั้งแผง)
      // ⚠️ ต้องเตือนให้ชัดว่า "ค่าที่กรอกไม่ถูกบันทึก" ห้ามขึ้น "บันทึกสำเร็จ" เฉยๆ
      //    (บทเรียนเดียวกับ MachineDatabase หมวด Facility ที่เคยตัด field ทิ้งเงียบแล้วข้อมูลผิดทั้งชุด)
      if (/flow_mode|parallel_stations/.test(error.message || '')) {
        hasFlowModeCol.current = false;
        const { error: e2 } = await supabase.from('production_lines').update({
          std_day_shift: parseInt(stdDay) || 0, std_night_shift: parseInt(stdNight) || 0,
          cost_center: costCenter || null, head_name: signerHead || null,
          ...(hasLineTypeCol.current ? { line_type: lineType || null } : {}),
        }).eq('id', lineObj.id);
        if (e2) toast.error('Error: ' + e2.message);
        else { toast.error('⚠️ บันทึกแล้วบางส่วน — "รูปแบบการไหลงาน/จำนวนเครื่องขนาน" ยังไม่ถูกบันทึก (DB ยังไม่ apply migration 20260723_line_flow_mode.sql)'); await fetchLines(); }
      } else if (/line_type/.test(error.message || '')) {
        hasLineTypeCol.current = false;
        toast.error('⚠️ "ประเภทไลน์" ยังไม่ถูกบันทึก (DB ยังไม่ apply migration 20260722_production_lines_line_type.sql) — กดบันทึกอีกครั้งเพื่อเก็บค่าที่เหลือ');
      } else toast.error('Error: ' + error.message);
    }
    else { toast.success('บันทึกแล้ว'); await fetchLines(); }
    setMpSaving(false);
  };

  const handleUpdateParent = async (line, parentName) => {
    // เปลี่ยนโครงสร้าง master (ไลน์แม่) — ยืนยันก่อน กันแตะ dropdown พลาด · ยกเลิก = revert หน้าจอ
    if (!confirm(`เปลี่ยน "ไลน์แม่" ของ ${line.name} เป็น "${parentName || '(ไม่มี — เป็นไลน์หลัก)'}" ?\n\nกระทบการรวมเครื่อง/ผัง/กำลังผลิตของทั้งกลุ่ม`)) { await fetchLines(); return; }
    await supabase.from('production_lines').update({ parent_line_name: parentName || null }).eq('id', line.id);
    await fetchLines();
  };

  const handleAddLine = async () => {
    const name = newLineName.trim();
    if (!name) return;
    // ไลน์ใหม่ของ user ที่ถูก scope ต้องอยู่ในส่วนงานตัวเองเท่านั้น (ไม่งั้นสร้างเสร็จตัวเองก็มองไม่เห็น)
    if (scopeSecs.length && !inSectionScope(scopeSecs, newLineSection)) {
      toast.error(`ต้องเลือก Section ในขอบเขตส่วนงานของคุณ (${scopeSecs.join(', ')})`);
      return;
    }
    setIsAddingLine(true);
    const { error } = await supabase.from('production_lines').insert([{ name, section: newLineSection || null, parent_line_name: newLineParent || null }]);
    if (error) { toast.error('Error: ' + error.message); }
    else {
      setNewLineName('');
      setNewLineSection('');
      setNewLineParent('');
      await fetchLines();
      setSelectedLine(name);
    }
    setIsAddingLine(false);
  };

  const handleDeleteLine = async (line) => {
    const childCount = lines.filter(l => l.parent_line_name === line.name).length;
    const warn = childCount > 0 ? `\n\nไลน์นี้เป็นไลน์หลักของ ${childCount} ไลน์ลูก — ลูกจะถูกเปลี่ยนเป็น standalone อัตโนมัติ` : '';
    if (!window.confirm(`ลบไลน์ "${line.name}" ?\n\nจุดงานและผังไลน์ทั้งหมดในไลน์นี้จะถูกลบด้วย${warn}`)) return;
    // Clear parent ref from children first
    if (childCount > 0) {
      await supabase.from('production_lines').update({ parent_line_name: null }).eq('parent_line_name', line.name);
    }
    // อ่าน URL ผังก่อนลบ row — จะได้ลบไฟล์ใน storage ตามหลัง DB สำเร็จ (กติกา CLAUDE.md กันไฟล์กำพร้า)
    const { data: delLayout } = await supabase.from('line_layouts').select('image_url').eq('line_name', line.name).maybeSingle();
    // ลบลูกให้ครบและเรียงลำดับ FK ให้ถูก ไม่งั้น row กำพร้าค้าง / delete แม่ FK-error แล้วถูกกลืนเงียบ
    // (เดิมลบ workstations โดยไม่ลบ station_requirements ก่อน + ไม่ลบ wip/machine/flow เลย)
    const { data: staIds } = await supabase.from('workstations').select('id').eq('line_name', line.name);
    if (staIds?.length) {
      const { error: eReq } = await supabase.from('station_requirements').delete().in('station_id', staIds.map(s => s.id));
      if (eReq) { toast.error('ลบทักษะประจำสถานีไม่สำเร็จ: ' + eReq.message); return; }
    }
    // flow_links อ้าง machine_points (from/to) → ลบ links ก่อน points
    for (const tbl of ['machine_flow_links', 'machine_points', 'wip_buffer_points', 'workstations', 'line_layouts']) {
      const { error: eDel } = await supabase.from(tbl).delete().eq('line_name', line.name);
      if (eDel) { toast.error(`ลบ ${tbl} ไม่สำเร็จ: ` + eDel.message); return; }
    }
    // ลบเฉพาะไฟล์ของไลน์นี้เอง — ข้ามถ้าไลน์อื่น (เช่นไลน์แม่/ลูกที่ยืมผัง) ยังชี้ URL เดียวกันอยู่
    if (delLayout?.image_url?.includes('/employee-photos/layouts/')) {
      const { data: sharers } = await supabase.from('line_layouts').select('line_name').eq('image_url', delLayout.image_url).limit(1);
      if (!sharers?.length) {
        const oldName = decodeURIComponent(delLayout.image_url.split('/employee-photos/')[1] || '');
        if (oldName.startsWith('layouts/')) supabase.storage.from('employee-photos').remove([oldName]).catch(() => {});
      }
    }
    await supabase.from('employees').update({ line_id: null }).eq('line_id', line.id);
    const { error: eLine } = await supabase.from('production_lines').delete().eq('id', line.id);
    if (eLine) { toast.error('ลบไลน์ไม่สำเร็จ: ' + eLine.message); return; }
    const remaining = lines.filter(l => l.id !== line.id);
    setLines(remaining);
    if (selectedLine === line.name) {
      const next = remaining[0]?.name || '';
      setSelectedLine(next);
      if (!next) { setLayoutImage(null); setStations([]); }
    }
  };

  const handleUpdateSection = async (line, section) => {
    // เปลี่ยน Section ของไลน์ = กระทบ scope/สิทธิ์การมองเห็น — ยืนยันก่อน · ยกเลิก = revert หน้าจอ
    if (!confirm(`เปลี่ยน "Section" ของ ${line.name} เป็น "${section || '(ไม่มี)'}" ?\n\nกระทบขอบเขตการมองเห็น (scope) และการผูกใบค่าฝีมือ`)) { await fetchLines(); return; }
    await supabase.from('production_lines').update({ section: section || null }).eq('id', line.id);
    await fetchLines();
  };

  const handleRenameLine = async (line, newName) => {
    const name = newName.trim();
    if (!name || name === line.name) { setEditingLineId(null); return; }
    if (lines.some(l => l.id !== line.id && l.name === name)) {
      toast.error(`มีไลน์ชื่อ "${name}" อยู่แล้ว`); return;
    }
    const old = line.name;
    // Update production_lines (name + children's parent_line_name)
    await supabase.from('production_lines').update({ name }).eq('id', line.id);
    await supabase.from('production_lines').update({ parent_line_name: name }).eq('parent_line_name', old);

    // ── Cascade "ชื่อไลน์" (line_name snapshot) ทุกตารางทั้ง 2 project ────────────────────────────
    // ⚠️ กฎเหล็ก (2026-07-22): ไลน์ถูกอ้างด้วย "ชื่อ" เป็น text snapshot ในหลายตาราง ไม่ใช่ FK
    // เปลี่ยนชื่อแล้วไม่ตามไปแก้ทุกที่ = ข้อมูลชื่อเก่า "กำพร้า" ทันที
    // เคสจริง: เปลี่ยนชื่อไลน์ Laser → "กะที่เปิดค้าง" (production_sessions.line_name = ชื่อเก่า) หลุดจาก
    // รายการ "กะที่เปิดอยู่" ใน Daily Report เพราะระบบกรองด้วยชื่อไลน์ปัจจุบัน (session ยังเปิดใน DB
    // แค่ถูกกรองพ้นสายตา) · dr_products.line_name เก่า ทำให้เปิด order/สแกนของไลน์ที่เปลี่ยนชื่อไม่ได้ด้วย
    // best-effort: ยิงทีละตาราง ไม่ abort ถ้าตารางใด error (บาง deploy ยังไม่มีตาราง/คอลัมน์นั้น)
    const bump = async (client, table, col = 'line_name') => {
      try { await client.from(table).update({ [col]: name }).eq(col, old); } catch { /* best-effort */ }
    };
    // Main project (client supabase) — ผัง/จุดงาน + 4M + factory map + LPA + action items + poka-yoke + QA + คำขอ WIP + home position
    for (const t of ['workstations', 'line_layouts', 'wip_buffer_points', 'machine_points', 'machine_flow_links',
                     'four_m_logs', 'factory_line_regions', 'lpa_plans', 'lpa_audits', 'lpa_questions',
                     'meeting_action_items', 'station_assignment_logs',
                     'pokayoke_devices', 'wip_replenish_requests', 'employee_home_positions',
                     'qa_parts', 'qa_characteristics', 'qa_instruments', 'qa_ncr']) {
      await bump(supabase, t);
    }
    // lpa_questions.hidden_for_lines เป็น text[] — bump() (eq/update ธรรมดา) ใช้ไม่ได้ ต้องอ่าน-แก้-เขียนรายแถว
    try {
      const { data: hid } = await supabase.from('lpa_questions').select('id, hidden_for_lines').contains('hidden_for_lines', [old]);
      for (const q of hid || []) {
        const next = (q.hidden_for_lines || []).map(n => (n === old ? name : n));
        await supabase.from('lpa_questions').update({ hidden_for_lines: next }).eq('id', q.id);
      }
    } catch { /* best-effort — คอลัมน์ยังไม่ apply ก็ข้าม */ }
    // DR project (client supabaseDR) — production_sessions/dr_products สำคัญสุด (กะที่เปิด + product→line map)
    //   + supply route / PM ประสานงาน / delivery-round / rack (line_name)
    for (const t of ['machines', 'production_sessions', 'dr_products', 'line_stock_transactions',
                     'jigs', 'pm_daily_line_targets', 'pm_daily_alerts', 'mtn_orders', 'improvements', 'scrap_reports',
                     'facility_supply_links', 'pm_coordination_plans', 'kanban_delivery_rounds', 'kanban_deliveries',
                     'rack_requests', 'kanban_calc_params', 'transport_nodes',
                     'line_part_levels']) {   // min/max พาร์ทต่อไลน์ (ลูปเรียกของจากสโตร์)
      await bump(supabaseDR, t);
    }
    // คอลัมน์ที่ชื่อไม่ใช่ 'line_name' — ต้องระบุ col เอง
    await bump(supabaseDR, 'pm_plans', 'usage_source_line');
    // 🔗 สายการไหลระหว่างไลน์ — มี line_name 2 คอลัมน์ ต้อง bump ทั้งขาต้นน้ำและปลายน้ำ
    await bump(supabaseDR, 'line_flow_links', 'from_line');
    await bump(supabaseDR, 'line_flow_links', 'to_line');
    for (const t of ['bom_items', 'child_lot_requests', 'packaging_withdrawal_requests']) {
      await bump(supabaseDR, t, 'source_line');
    }
    // 🎯 จุดส่งงาน — line_names เป็น text[] (1 จุดหลายไลน์) → bump ธรรมดาใช้ไม่ได้ ต้องอ่าน-แก้-เขียนรายแถว
    //    (แบบเดียวกับ lpa_questions.hidden_for_lines) ไม่งั้นเปลี่ยนชื่อไลน์แล้วจุดส่ง+ป้าย QR ที่พิมพ์ไปแล้วกำพร้าเงียบ
    try {
      const { data: dps } = await supabaseDR.from('line_delivery_points').select('id, line_names').contains('line_names', [old]);
      for (const d of dps || []) {
        const next = (d.line_names || []).map(n => (n === old ? name : n));
        await supabaseDR.from('line_delivery_points').update({ line_names: next }).eq('id', d.id);
      }
    } catch { /* best-effort — ตารางยังไม่ apply ก็ข้าม */ }

    setEditingLineId(null);
    if (selectedLine === old) setSelectedLine(name);
    await fetchLines();
  };

  const handleUploadImage = async (e) => {
    let file = e.target.files[0];
    if (!file) return;
    try {
      setIsUploading(true);
      // HEIC/HEIF จากกล้องมือถือ → แปลงเป็น JPEG ก่อนทุกอย่าง เพื่อให้ ext/ชนิดที่ derive ต่อจากนี้ถูกต้องตาม
      file = await toDecodableImage(file);
      const fileExt = file.name.split('.').pop();
      const safeLineName = selectedLine.replace(/[^a-zA-Z0-9]/g, '_');
      const fileName = `layout_${safeLineName}_${Date.now()}.${fileExt}`;
      // บีบรูปผังก่อนอัปโหลด — ผังไลน์บีบเบา 2560px/2.5MB q0.9 (ดู CLAUDE.md "Storage & รูปภาพ") · GIF ส่งทั้งไฟล์คงการเคลื่อนไหว
      const isGif = file.type === 'image/gif' || /^gif$/i.test(fileExt);
      if (isGif && file.size > 2 * 1024 * 1024) {
        toast.error('ไฟล์ GIF ต้องไม่เกิน 2MB (กฎเดียวกับ ImageCropModal — GIF บีบไม่ได้)');
        setIsUploading(false);
        return;
      }
      // ผังไลน์มีจำนวนน้อยและต้องซูมอ่านรายละเอียด — บีบเบา (2560px/2.5MB q0.9) อย่าลดกลับไป 1600px/0.5MB เคยเบลอ
      const uploadBlob = isGif ? file : await imageCompression(file, { maxSizeMB: 2.5, maxWidthOrHeight: 2560, initialQuality: 0.9 });
      const { error: uploadError } = await supabase.storage.from('employee-photos').upload(`layouts/${fileName}`, uploadBlob);
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from('employee-photos').getPublicUrl(`layouts/${fileName}`);
      // ⚠️ ต้องเช็ค error ก่อนลบไฟล์เก่าเสมอ — supabase-js **คืน { error } ไม่ throw**
      // เดิมไม่เช็คแล้วลบไฟล์เก่าต่อทันที: upsert พลาด (RLS/เน็ตสะดุด) = DB ยังชี้ URL เก่า
      // แต่ไฟล์เก่าถูกลบไปแล้ว ⇒ **ผังไลน์นั้นกลายเป็นรูปเสียถาวร กู้ไม่ได้** และ toast ยังขึ้นว่าสำเร็จ
      const { error: dbErr } = await supabase.from('line_layouts')
        .upsert({ line_name: selectedLine, image_url: data.publicUrl }, { onConflict: 'line_name' });
      if (dbErr) throw dbErr;
      // ลบไฟล์ผังเดิมของไลน์นี้ทิ้ง กันไฟล์เก่ากองเป็นขยะใน storage
      // (เฉพาะผังของตัวเองเท่านั้น — ผังที่ยืมแสดงจากไลน์แม่ห้ามลบ เพราะไลน์แม่ยังใช้อยู่)
      if (!usingParentLayout && layoutImage?.includes('/employee-photos/layouts/')) {
        const oldName = decodeURIComponent(layoutImage.split('/employee-photos/')[1] || '');
        if (oldName.startsWith('layouts/')) supabase.storage.from('employee-photos').remove([oldName]).catch(() => {});
      }
      setLayoutImage(data.publicUrl);
      setUsingParentLayout(false);
    } catch (error) { toast.error('Error: ' + error.message); }
    finally { setIsUploading(false); }
  };

  // ลบรูปผังของไลน์นี้ (เคสเผลออัพรูปทับ) → ไลน์ลูกกลับไปยืมผังไลน์แม่อัตโนมัติ (fetchLineData fallback)
  const handleDeleteLayout = async () => {
    if (!layoutImage || usingParentLayout) return; // ผังที่ยืมแสดงจากไลน์แม่ ไม่ใช่ของเรา — ห้ามลบ
    const lineObj = lines.find(l => l.name === selectedLine);
    const backTo = lineObj?.parent_line_name
      ? `จะกลับไปใช้รูปผังของไลน์แม่ "${lineObj.parent_line_name}" แทน`
      : 'ไลน์นี้จะไม่มีรูปผัง (ไม่มีไลน์แม่ให้ยืม) — จุดงาน/เครื่อง/WIP ที่วางไว้ยังอยู่ครบ';
    if (!window.confirm(`ลบรูปผังของ "${selectedLine}" ?\n${backTo}`)) return;
    try {
      const { error } = await supabase.from('line_layouts').delete().eq('line_name', selectedLine);
      if (error) throw error;
      // ลบไฟล์จาก storage หลัง DB สำเร็จ (best-effort) — เฉพาะเมื่อไม่มีไลน์อื่นแชร์ URL เดียวกัน
      if (layoutImage.includes('/employee-photos/layouts/')) {
        const { data: sharers } = await supabase.from('line_layouts').select('line_name').eq('image_url', layoutImage).limit(1);
        if (!sharers?.length) {
          const oldName = decodeURIComponent(layoutImage.split('/employee-photos/')[1] || '');
          if (oldName.startsWith('layouts/')) supabase.storage.from('employee-photos').remove([oldName]).catch(() => {});
        }
      }
      toast.success('ลบรูปผังแล้ว');
      fetchLineData(); // โหลดใหม่ → ไลน์ลูกยืมผังไลน์แม่เอง
    } catch (err) { toast.error('ลบไม่สำเร็จ: ' + err.message); }
  };

  // object-fit: contain ทำให้มีพื้นที่ letterbox (แถบว่าง) รอบรูปจริง — ต้องคำนวณ
  // กรอบของรูปที่แสดงผลจริง เพื่อจำกัดไม่ให้วางจุดหรือลากจุดออกนอกรูปที่เห็น
  const getImageGeom = (img) => {
    if (!img) return null;
    const rect = img.getBoundingClientRect();
    const naturalW = img.naturalWidth || rect.width;
    const naturalH = img.naturalHeight || rect.height;
    const scale = Math.min(rect.width / naturalW, rect.height / naturalH);
    const renderedW = naturalW * scale;
    const renderedH = naturalH * scale;
    const offsetX = (rect.width - renderedW) / 2;
    const offsetY = (rect.height - renderedH) / 2;
    return { rect, offsetX, offsetY, renderedW, renderedH };
  };

  const recalcImgBox = () => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth) { setImgBox(null); return; }
    const geom = getImageGeom(img);
    if (!geom) { setImgBox(null); return; }
    setImgBox({ ox: geom.offsetX, oy: geom.offsetY, rw: geom.renderedW, rh: geom.renderedH });
  };

  // คำนวณกรอบรูปใหม่เมื่อรูปโหลด/ขนาดพื้นที่เปลี่ยน (ย่อ-ขยายหน้าต่าง, พับ sidebar)
  useEffect(() => {
    setImgBox(null);
    const img = imgRef.current;
    if (!img) return;
    const ro = new ResizeObserver(() => requestAnimationFrame(recalcImgBox));
    ro.observe(img);
    return () => ro.disconnect();
  }, [layoutImage]);

  const startDrag = (e, kind, id) => {
    if (!canEdit) return; // read-only: ห้ามลากย้าย และห้ามเปิด panel แก้ไขจากการคลิกหมุด
    e.preventDefault();
    e.stopPropagation();
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    dragMovedRef.current = false;
    dragPosRef.current = null;
    setDragPos(null);
    setDragInfo({ kind, id });
  };

  useEffect(() => {
    if (!dragInfo) return;
    const onMove = (e) => {
      const geom = getImageGeom(imgRef.current);
      if (!geom) return;
      const { rect, offsetX, offsetY, renderedW, renderedH } = geom;
      const boxW = dragInfo.kind === 'station' ? CARD_W : POINT_W;
      const boxH = dragInfo.kind === 'station' ? CARD_H : POINT_H;
      let x = e.clientX - rect.left;
      let y = e.clientY - rect.top;
      x = Math.min(Math.max(x, offsetX + boxW / 2), offsetX + renderedW - boxW / 2);
      y = Math.min(Math.max(y, offsetY + boxH / 2), offsetY + renderedH - boxH / 2);
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMovedRef.current = true;
      // เก็บเป็น % ของตัวรูปจริง (หัก letterbox) — ไม่ผูกกับขนาดกล่อง container
      const pos = { top: `${(((y - offsetY) / renderedH) * 100).toFixed(2)}%`, left: `${(((x - offsetX) / renderedW) * 100).toFixed(2)}%` };
      dragPosRef.current = pos;
      setDragPos(pos);
    };
    const onUp = async () => {
      const { kind, id } = dragInfo;
      if (dragMovedRef.current && dragPosRef.current) {
        hist.pushHistory();   // state ยังเป็นตำแหน่งก่อนลาก (ตอนลากแสดงผ่าน dragPos overlay) — snapshot คืนที่เดิมได้
        const table = kind === 'station' ? 'workstations' : kind === 'wip' ? 'wip_buffer_points' : 'machine_points';
        await supabase.from(table).update({ pos_top: dragPosRef.current.top, pos_left: dragPosRef.current.left }).eq('id', id);
        await fetchLineData();
      } else {
        if (kind === 'station') { const st = stations.find(s => s.id === id); if (st) editStation(st); }
        if (kind === 'wip') { const p = wipPoints.find(s => s.id === id); if (p) editWipPoint(p); }
        if (kind === 'machine') {
          if (connectMode) handleMachineConnectClick(id);
          else { const p = machinePoints.find(s => s.id === id); if (p) editMachinePoint(p); }
        }
      }
      setDragInfo(null);
      setDragPos(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragInfo]);

  const handleImageClick = (e) => {
    if (!canEdit) return; // read-only: คลิกบนผังไม่วางจุดใหม่
    const img = e.target;
    const geom = getImageGeom(img);
    const { rect, offsetX, offsetY, renderedW, renderedH } = geom;

    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    if (clickX < offsetX || clickX > offsetX + renderedW || clickY < offsetY || clickY > offsetY + renderedH) {
      setCollisionWarn('⚠️ จุดนี้อยู่นอกพื้นที่รูปผังไลน์ — คลิกในรูปเท่านั้น');
      setTimeout(() => setCollisionWarn(null), 2000);
      return;
    }

    // กล่อง marker มีขนาดจริง (CARD_W/H หรือ POINT_W/H) — ต้อง clamp จุดศูนย์กลาง
    // ไม่ให้กล่องล้นออกนอกขอบรูปที่แสดงผลจริง (ไม่ใช่แค่จุดคลิกอยู่ในรูป)
    const boxW = activeTab === 'stations' ? CARD_W : POINT_W;
    const boxH = activeTab === 'stations' ? CARD_H : POINT_H;
    const clampedX = Math.min(Math.max(clickX, offsetX + boxW / 2), offsetX + renderedW - boxW / 2);
    const clampedY = Math.min(Math.max(clickY, offsetY + boxH / 2), offsetY + renderedH - boxH / 2);

    // เก็บเป็น % ของตัวรูปจริง (หัก letterbox) — ให้ทุกหน้าอ่านค่าเดียวกันไม่เพี้ยนตามขนาดจอ
    const x = ((clampedX - offsetX) / renderedW) * 100;
    const y = ((clampedY - offsetY) / renderedH) * 100;
    const pos = { top: `${y.toFixed(2)}%`, left: `${x.toFixed(2)}%` };
    const newXpx = clampedX;
    const newYpx = clampedY;

    const checkCollision = (points, w, h) => {
      const PAD_X = w + 8;
      const PAD_Y = h + 8;
      return points.some(p => {
        const pX = offsetX + (parseFloat(p.pos_left) / 100) * renderedW;
        const pY = offsetY + (parseFloat(p.pos_top) / 100) * renderedH;
        return Math.abs(newXpx - pX) < PAD_X && Math.abs(newYpx - pY) < PAD_Y;
      });
    };

    if (activeTab === 'wip') {
      if (checkCollision(wipPoints, POINT_W, POINT_H)) {
        setCollisionWarn('⚠️ ใกล้กับจุดอื่นเกินไป — คลิกในพื้นที่ว่าง');
        setTimeout(() => setCollisionWarn(null), 2000);
        return;
      }
      setCollisionWarn(null);
      setWipTempPos(pos);
      setWipForm(emptyWipForm);
      return;
    }
    if (activeTab === 'machines') {
      if (checkCollision(machinePoints, POINT_W, POINT_H)) {
        setCollisionWarn('⚠️ ใกล้กับจุดอื่นเกินไป — คลิกในพื้นที่ว่าง');
        setTimeout(() => setCollisionWarn(null), 2000);
        return;
      }
      setCollisionWarn(null);
      setMachineTempPos(pos);
      setMachineForm({ id: null, machine_no: '', redundancy_group: '' });
      return;
    }

    if (checkCollision(stations, CARD_W, CARD_H)) {
      setCollisionWarn('⚠️ ใกล้กับจุดงานอื่นเกินไป — คลิกในพื้นที่ว่าง');
      setTimeout(() => setCollisionWarn(null), 2000);
      return;
    }

    setCollisionWarn(null);
    setTempPos(pos);
    setFormData({ id: null, name: '', requirements: {} });
  };

  const toggleSkillReq = (skillName) => {
    setFormData(prev => {
      const reqs = { ...prev.requirements };
      if (skillName in reqs) {
        delete reqs[skillName];
      } else {
        reqs[skillName] = 70;
      }
      return { ...prev, requirements: reqs };
    });
  };

  const setSkillScore = (skillName, score) => {
    setFormData(prev => ({
      ...prev,
      requirements: { ...prev.requirements, [skillName]: parseInt(score) || 0 },
    }));
  };

  const handleSaveStation = async () => {
    if (!formData.name) return toast.error('กรุณาระบุชื่อจุดงาน');
    hist.pushHistory();
    const existingStation = stations.find(s => s.id === formData.id);
    const payload = {
      line_name: selectedLine,
      station_name: formData.name,
      pos_top: tempPos ? tempPos.top : existingStation?.pos_top,
      pos_left: tempPos ? tempPos.left : existingStation?.pos_left,
      skill_allowance: formData.skill_allowance,
      skill_allowance_type: formData.skill_allowance ? (formData.skill_allowance_type || null) : null,
    };
    let stationId = formData.id;
    if (stationId) {
      const { error } = await supabase.from('workstations').update(payload).eq('id', stationId);
      if (error) return toast.error('Error: ' + error.message);
    } else {
      const { data, error } = await supabase.from('workstations').insert([payload]).select().single();
      if (error) return toast.error('Error: ' + error.message);
      stationId = data.id;
    }

    await supabase.from('station_requirements').delete().eq('station_id', stationId);
    const reqRows = Object.entries(formData.requirements).map(([skill_name, min_score]) => ({
      station_id: stationId,
      skill_name,
      min_score,
    }));
    if (reqRows.length > 0) {
      await supabase.from('station_requirements').insert(reqRows);
    }

    fetchLineData();
    setTempPos(null);
    setFormData({ id: null, name: '', requirements: {}, skill_allowance: false, skill_allowance_type: '' });
  };

  const deleteStation = async (id) => {
    if (!window.confirm('ยืนยันการลบจุดงานนี้?')) return;
    hist.pushHistory();
    await supabase.from('station_requirements').delete().eq('station_id', id);
    const { error } = await supabase.from('workstations').delete().eq('id', id);
    if (!error) fetchLineData();
  };

  const editStation = (st) => {
    setTempPos(null);
    const reqMap = {};
    (st.station_requirements || []).forEach(r => { reqMap[r.skill_name] = r.min_score; });
    setFormData({ id: st.id, name: st.station_name, requirements: reqMap, skill_allowance: st.skill_allowance || false, skill_allowance_type: st.skill_allowance_type || '' });
  };

  /* ── จุด WIP buffer ── */
  const editWipPoint = (p) => {
    setWipTempPos(null);
    setWipForm({
      id: p.id, point_type: p.point_type || 'material', point_name: p.point_name,
      mat_no: p.mat_no || '', material_category: p.material_category || '',
      packaging_no: p.packaging_no || '', packaging_type: p.packaging_type || '',
      min_qty: p.min_qty ?? 0, max_qty: p.max_qty ?? 0, current_qty: p.current_qty ?? 0,
    });
  };

  const handleSaveWip = async () => {
    if (!wipForm.point_name) return toast.error('กรุณาระบุชื่อจุด WIP');
    hist.pushHistory();
    const existing = wipPoints.find(p => p.id === wipForm.id);
    const isMaterial = wipForm.point_type === 'material';
    const payload = {
      line_name:         selectedLine,
      point_name:        wipForm.point_name,
      point_type:        wipForm.point_type,
      mat_no:             isMaterial ? (wipForm.mat_no || null) : null,
      material_category:  isMaterial ? (wipForm.material_category || null) : null,
      packaging_no:        !isMaterial ? (wipForm.packaging_no || null) : null,
      packaging_type:      !isMaterial ? (wipForm.packaging_type || null) : null,
      pos_top:     wipTempPos ? wipTempPos.top : existing?.pos_top,
      pos_left:    wipTempPos ? wipTempPos.left : existing?.pos_left,
      min_qty:     parseFloat(wipForm.min_qty) || 0,
      max_qty:     parseFloat(wipForm.max_qty) || 0,
      current_qty: parseFloat(wipForm.current_qty) || 0,
      updated_at:  new Date().toISOString(),
    };
    const { error } = wipForm.id
      ? await supabase.from('wip_buffer_points').update(payload).eq('id', wipForm.id)
      : await supabase.from('wip_buffer_points').insert([payload]);
    if (error) return toast.error('Error: ' + error.message);
    fetchLineData();
    setWipTempPos(null);
    setWipForm(emptyWipForm);
  };

  const deleteWipPoint = async (id) => {
    if (!window.confirm('ยืนยันการลบจุด WIP นี้?')) return;
    hist.pushHistory();
    const { error } = await supabase.from('wip_buffer_points').delete().eq('id', id);
    if (!error) fetchLineData();
  };

  // เรียกเติมจุด WIP ที่ต่ำกว่า min — สร้างการ์ดคำขอเข้าคิว (ไปโผล่ที่ Heijunka Kanban → ตู้รวม → WIP Point)
  const requestWipReplenish = async (p) => {
    const { data: existing } = await supabase.from('wip_replenish_requests')
      .select('id').eq('wip_point_id', p.id).in('status', ['pending', 'preparing']).limit(1);
    if (existing?.length) { toast.error('มีคำขอเติมจุดนี้ค้างอยู่แล้ว รอเจ้าหน้าที่ดำเนินการ'); return; }
    const qty = Math.max(0, (p.max_qty ?? 0) - (p.current_qty ?? 0)) || (p.min_qty ?? 0);
    const { error } = await supabase.from('wip_replenish_requests').insert({
      wip_point_id: p.id, line_name: selectedLine, point_name: p.point_name, point_type: p.point_type,
      mat_no: p.mat_no || null, material_category: p.material_category || null,
      packaging_type: p.packaging_type || null, packaging_no: p.packaging_no || null,
      request_qty: qty || 1,
    });
    if (error) { toast.error(error.message); return; }
    notifyEvent({
      event: 'wip_replenish', type: 'info', ref_table: 'wip_replenish_requests',
      line_name: selectedLine, actor: fullName,
      lines: [
        `🏭 ไลน์: ${selectedLine}`,
        `📍 จุด: ${p.point_name}${p.point_type ? ` (${p.point_type})` : ''}`,
        `🔩 ${p.mat_no || '—'} · ขอเติม ${qty || 1} ชิ้น`,
        `📊 คงเหลือ ${p.current_qty ?? 0} / min ${p.min_qty ?? 0} · max ${p.max_qty ?? 0}`,
      ],
    });
    toast.success(`🔔 เรียกเติม "${p.point_name}" แล้ว — ดูสถานะได้ที่ Heijunka Kanban → ตู้ Kanban รวม → 🔄 WIP Point`);
  };

  /* ── จุดเครื่องจักร ── */
  const editMachinePoint = (p) => {
    setMachineTempPos(null);
    setMachineForm({ id: p.id, machine_no: p.machine_no, redundancy_group: p.redundancy_group || '' });
  };

  const handleSaveMachine = async () => {
    if (!machineForm.machine_no) return toast.error('กรุณาเลือกเครื่องจักร');
    hist.pushHistory();
    const existing = machinePoints.find(p => p.id === machineForm.id);
    const payload = {
      line_name:   selectedLine,
      machine_no:  machineForm.machine_no,
      pos_top:     machineTempPos ? machineTempPos.top : existing?.pos_top,
      pos_left:    machineTempPos ? machineTempPos.left : existing?.pos_left,
      redundancy_group: machineForm.redundancy_group.trim() || null,
    };
    const { error } = machineForm.id
      ? await supabase.from('machine_points').update(payload).eq('id', machineForm.id)
      : await supabase.from('machine_points').insert([payload]);
    if (error) return toast.error('Error: ' + error.message);
    fetchLineData();
    setMachineTempPos(null);
    setMachineForm({ id: null, machine_no: '', redundancy_group: '' });
  };

  const deleteMachinePoint = async (id) => {
    if (!window.confirm('ยืนยันการลบจุดเครื่องจักรนี้?')) return;
    hist.pushHistory();
    const { error } = await supabase.from('machine_points').delete().eq('id', id);
    if (!error) fetchLineData();
  };

  /* ── เส้นทางการผลิต (sequential flow ระหว่างจุดเครื่องจักร) ── */
  const handleMachineConnectClick = async (id) => {
    if (!connectFrom) { setConnectFrom(id); return; }
    if (connectFrom === id) { setConnectFrom(null); return; }
    const exists = flowLinks.some(l =>
      (l.from_machine_point_id === connectFrom && l.to_machine_point_id === id) ||
      (l.from_machine_point_id === id && l.to_machine_point_id === connectFrom)
    );
    setConnectFrom(null);
    if (exists) return;
    hist.pushHistory();
    const { error } = await supabase.from('machine_flow_links').insert([{
      line_name: selectedLine, from_machine_point_id: connectFrom, to_machine_point_id: id,
    }]);
    if (error) return toast.error('Error: ' + error.message);
    fetchLineData();
  };

  const deleteFlowLink = async (id) => {
    if (!window.confirm('ยืนยันการลบเส้นเชื่อมต่อนี้?')) return;
    hist.pushHistory();
    const { error } = await supabase.from('machine_flow_links').delete().eq('id', id);
    if (!error) fetchLineData();
  };

  // ขนาดหมุดวงกลมบนผัง — ใช้สูตรกลาง markerScale (src/utils/markerScale.js) ตัวเดียวกับหน้าแสดงผล
  // เพื่อให้ WYSIWYG: ขนาดหมุด + พฤติกรรมป้ายชื่อตอนจัดผัง ตรงกับที่ Management/Dashboard แสดงจริงเป๊ะ
  // MK = จุดงานหลัก · SUB = หมุดรอง (เครื่องจักร/WIP) ย่อตามความแน่น
  // หมุดรองที่วาดบนผังจริงในแท็บที่เปิดอยู่ (เครื่องจักร/WIP วาดด้วย SUB ตัวเดียวกัน)
  // ⚠️ ต้องคิดความแน่นจากชุดที่แสดงจริง — ไม่งั้นแท็บ WIP ที่มีจุดกระจุก 20 จุดจะได้วงใหญ่สุด
  //    เพราะสูตรไปนับ machinePoints ที่มีแค่ 3 ตัว แล้วเบียดกัน (อาการเดียวกับที่เพิ่งแก้)
  const subPoints = activeTab === 'wip' ? wipPoints : machinePoints;
  const { MK, SUB, pillFont: PILL_FONT, subPillFont, badgeFont, pillMaxW, subPillMaxW } =
    markerScale(imgBox?.rw, { machineCount: subPoints.length, points: subPoints, mapHeight: imgBox?.rh });
  // ปุ่ม 🏷️ โชว์/ซ่อนป้ายทุกชนิดจุด (หมุดที่เลือก/แก้ไขโชว์ป้ายเสมอ)
  const pillsOn = showPills;
  const stationPillsOn = showPills;
  const pillSt = {
    background: 'rgba(0,0,0,0.78)', borderRadius: 4, padding: '1px 6px',
    fontWeight: 700, color: '#fff', whiteSpace: 'nowrap',
    overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: pillMaxW,
    fontSize: PILL_FONT, lineHeight: 1.35,
  };
  // ป้ายของหมุดรอง (เครื่องจักร/WIP) — ฟอนต์สเกลตามวง SUB · ความกว้างขั้นต่ำต้องอ่านชื่อออก (markerScale.subPillMaxW)
  const subPillSt = { ...pillSt, fontSize: subPillFont, maxWidth: subPillMaxW };
  // แถบป้ายใต้วงกลม — เกาะขอบล่างของวงกลม (อยู่ใน hit area เดียวกับหมุด: คลิก/ลากที่ป้ายได้)
  const pillStackSt = {
    position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
    marginTop: 3, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
  };
  const pinIconSz = Math.round(MK * 0.42);
  const subPinIconSz = Math.round(SUB * 0.5);

  return (
    <div style={{ padding: embedded ? 0 : '16px', display: 'flex', flexDirection: 'column', gap: 12, height: isMobile ? 'auto' : (embedded ? 'calc(100vh - 200px)' : 'calc(100vh - 40px)'), minHeight: embedded && !isMobile ? 520 : undefined }}>
      {selectedLine && (
        // paddingRight เว้นที่ให้กระดิ่งแจ้งเตือน (fixed มุมขวาบน) — ไม่งั้นปุ่ม 🏷️ ที่ชิดขวาสุดโดนกระดิ่งทับ
        <div style={{ display: 'flex', gap: 6, flexShrink: 0, paddingRight: 52 }}>
          {TABS.map(t => (
            <button key={t.key}
              onClick={() => { setActiveTab(t.key); setTempPos(null); setWipTempPos(null); setMachineTempPos(null); setConnectMode(false); setConnectFrom(null); }}
              style={{
                padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                border: `1px solid ${activeTab === t.key ? 'var(--accent)' : 'var(--border2)'}`,
                background: activeTab === t.key ? 'var(--accent-dim)' : 'var(--bg2)',
                color: activeTab === t.key ? 'var(--accent)' : 'var(--text2)',
              }}>
              {t.label}
            </button>
          ))}
          {canEdit && (
            <>
              <button onClick={hist.undo} disabled={!hist.canUndo || hist.busy} style={{ ...undoBtnStyle(hist.canUndo && !hist.busy), marginLeft: 'auto' }} title="ย้อนกลับ — จุดบนผังไลน์นี้ (Ctrl+Z)">↩️ Undo</button>
              <button onClick={hist.redo} disabled={!hist.canRedo || hist.busy} style={undoBtnStyle(hist.canRedo && !hist.busy)} title="ทำซ้ำ (Ctrl+Y)">↪️ Redo</button>
            </>
          )}
          <button
            onClick={() => setShowPills(v => !v)}
            title={'แสดง/ซ่อนป้ายชื่อทุกจุดบนผัง (เหมือนหน้าแสดงผลจริง)\nหมุดที่กำลังเลือก/แก้ไขโชว์ป้ายเสมอ'}
            style={{
              position: 'relative',
              padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
              marginLeft: canEdit ? 0 : 'auto',
              border: `1px solid ${showPills ? 'var(--accent)' : 'var(--border2)'}`,
              background: showPills ? 'var(--accent-dim)' : 'var(--bg2)',
              color: showPills ? 'var(--accent)' : 'var(--text2)',
            }}>
            {showPills ? '🏷️ ซ่อนป้าย' : '🏷️ โชว์ป้าย'}
            <ToggleDot on={showPills} />
          </button>
        </div>
      )}
    <div style={{
      display: 'flex',
      flexDirection: isMobile ? 'column' : 'row',
      gap: 16,
      flex: 1,
      minHeight: 0,
      overflow: isMobile ? 'auto' : 'hidden',
    }}>
      <div style={{
        flex: 1,
        background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14,
        position: 'relative', overflow: 'auto',
        display: layoutImage ? 'block' : 'flex',
        alignItems: layoutImage ? undefined : 'center',
        justifyContent: layoutImage ? undefined : 'center',
        minHeight: isMobile ? 340 : undefined,
        height: isMobile ? 340 : undefined,
      }}>
        {selectedLine ? (
          layoutImage ? (
            <div style={{
              position: 'relative',
              width: isMobile ? 800 : '100%',
              height: isMobile ? 500 : '100%',
              minWidth: isMobile ? 800 : undefined,
              minHeight: isMobile ? 500 : undefined,
            }}>
              {collisionWarn && (
                <div style={{
                  position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
                  background: 'rgba(245,158,11,0.95)', color: '#fff',
                  padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                  zIndex: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                  whiteSpace: 'nowrap', pointerEvents: 'none',
                }}>
                  {collisionWarn}
                </div>
              )}
              {usingParentLayout && (
                <div style={{
                  position: 'absolute', top: 8, left: 8,
                  background: 'rgba(77,159,255,0.92)', color: '#fff',
                  padding: '4px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700,
                  zIndex: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.3)', pointerEvents: 'none',
                }}>
                  🔗 ใช้รูปผังจากไลน์หลัก — อัปโหลดรูปใหม่เพื่อแยกเป็นของตัวเอง
                </div>
              )}
              <img
                ref={imgRef}
                src={layoutImage}
                onClick={handleImageClick}
                onLoad={recalcImgBox}
                draggable={false}
                style={{ width: '100%', height: '100%', objectFit: 'contain', cursor: canEdit ? 'crosshair' : 'default', display: 'block' }}
              />
              {/* overlay ยึดกับ "ตัวรูปจริง" — marker ทุกจุดวางเป็น % ของรูป จึงเกาะรูปตามทุกขนาดจอ */}
              {imgBox && <div style={{ position: 'absolute', left: imgBox.ox, top: imgBox.oy, width: imgBox.rw, height: imgBox.rh, pointerEvents: 'none' }}>
              {activeTab === 'stations' && stations.map(st => {
                const isSelected = formData.id === st.id;
                const isDragging = dragInfo?.kind === 'station' && dragInfo.id === st.id;
                const top = isDragging && dragPos ? dragPos.top : st.pos_top;
                const left = isDragging && dragPos ? dragPos.left : st.pos_left;
                return (
                  <div
                    key={st.id}
                    onMouseDown={(e) => startDrag(e, 'station', st.id)}
                    style={{
                      position: 'absolute', top, left, transform: 'translate(-50%, -50%)',
                      width: MK, height: MK, borderRadius: '50%',
                      border: isSelected ? '2px solid var(--green)' : '2px solid rgba(255,255,255,0.75)',
                      backgroundColor: isSelected ? 'rgba(34,197,94,0.18)' : 'rgba(0,0,0,0.82)',
                      boxShadow: isDragging ? '0 0 10px rgba(61,214,92,0.7)' : isSelected ? '0 0 8px rgba(34,197,94,0.5)' : '0 2px 6px rgba(0,0,0,0.6)',
                      cursor: isDragging ? 'grabbing' : 'grab', display: 'flex',
                      alignItems: 'center', justifyContent: 'center', pointerEvents: 'auto',
                      zIndex: isDragging ? 15 : 5, opacity: isDragging ? 0.85 : 1,
                    }}
                    title={canEdit ? 'คลิกเพื่อแก้ไข — ลากเพื่อย้ายตำแหน่ง' : st.station_name}
                  >
                    <span style={{ fontSize: pinIconSz, lineHeight: 1 }}>📍</span>
                    {(stationPillsOn || isSelected) && (
                    <div style={pillStackSt}>
                      <div style={{ ...pillSt, color: isSelected ? 'var(--green)' : '#fff' }}>
                        {st.station_name}
                      </div>
                      {st.skill_allowance && (
                        <div style={{ ...pillSt, fontSize: badgeFont, color: '#22c55e', fontWeight: 800 }}>
                          💰 {st.skill_allowance_type || ''}
                        </div>
                      )}
                    </div>
                    )}
                  </div>
                );
              })}
              {activeTab === 'stations' && tempPos && (
                <div style={{
                  position: 'absolute', top: tempPos.top, left: tempPos.left, transform: 'translate(-50%, -50%)',
                  width: MK, height: MK, borderRadius: '50%',
                  border: '1px dashed var(--accent)', backgroundColor: 'rgba(61,214,92,0.1)',
                  zIndex: 10, pointerEvents: 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <div style={{ color: 'var(--accent)', fontSize: 14 }}>+</div>
                </div>
              )}

              {activeTab === 'wip' && wipPoints.map(p => {
                const isSelected = wipForm.id === p.id;
                const isLow = (p.current_qty ?? 0) < (p.min_qty ?? 0);
                const isDragging = dragInfo?.kind === 'wip' && dragInfo.id === p.id;
                const top = isDragging && dragPos ? dragPos.top : p.pos_top;
                const left = isDragging && dragPos ? dragPos.left : p.pos_left;
                return (
                  <div
                    key={p.id}
                    onMouseDown={(e) => startDrag(e, 'wip', p.id)}
                    title={canEdit ? `${p.point_name} — คลิกเพื่อแก้ไข — ลากเพื่อย้ายตำแหน่ง` : p.point_name}
                    style={{
                      position: 'absolute', top, left, transform: 'translate(-50%, -50%)',
                      width: SUB, height: SUB, borderRadius: '50%',
                      border: isSelected ? '2px solid var(--green)' : isLow ? '2px solid #ef4444' : '2px solid rgba(255,255,255,0.75)',
                      backgroundColor: isLow ? 'rgba(239,68,68,0.25)' : 'rgba(0,0,0,0.82)',
                      boxShadow: isDragging ? '0 0 10px rgba(61,214,92,0.7)' : isLow ? '0 0 8px rgba(239,68,68,0.6)' : '0 2px 6px rgba(0,0,0,0.6)',
                      cursor: isDragging ? 'grabbing' : 'grab', display: 'flex',
                      alignItems: 'center', justifyContent: 'center', pointerEvents: 'auto',
                      zIndex: isDragging ? 15 : 5, opacity: isDragging ? 0.85 : 1,
                    }}
                  >
                    <span style={{ fontSize: subPinIconSz, lineHeight: 1 }}>📦</span>
                    {(pillsOn || isSelected || isLow) && (
                      <div style={pillStackSt}>
                        <div style={{ ...subPillSt, color: isLow ? '#fecaca' : '#fff' }}>
                          {p.point_name}
                        </div>
                        <div style={{ ...subPillSt, fontWeight: isLow ? 800 : 700, color: isLow ? '#fca5a5' : '#a3a3a3' }}>
                          {p.current_qty ?? 0}/{p.min_qty ?? 0}–{p.max_qty ?? 0}{isLow ? ' ⚠️ ต่ำ' : ''}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {activeTab === 'wip' && wipTempPos && (
                <div style={{
                  position: 'absolute', top: wipTempPos.top, left: wipTempPos.left, transform: 'translate(-50%, -50%)',
                  width: SUB, height: SUB, borderRadius: '50%',
                  border: '1px dashed var(--accent)', backgroundColor: 'rgba(61,214,92,0.1)',
                  zIndex: 10, pointerEvents: 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <div style={{ color: 'var(--accent)', fontSize: 12 }}>+</div>
                </div>
              )}

              {activeTab === 'machines' && (
                <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 4 }}
                  viewBox="0 0 100 100" preserveAspectRatio="none">
                  {flowLinks.map(link => {
                    const from = machinePoints.find(p => p.id === link.from_machine_point_id);
                    const to = machinePoints.find(p => p.id === link.to_machine_point_id);
                    if (!from || !to) return null;
                    const x1 = parseFloat(from.pos_left), y1 = parseFloat(from.pos_top);
                    const x2 = parseFloat(to.pos_left), y2 = parseFloat(to.pos_top);
                    return (
                      <g key={link.id}>
                        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#f97316" strokeWidth={0.4} />
                        <circle cx={x2} cy={y2} r={1} fill="#f97316" />
                      </g>
                    );
                  })}
                </svg>
              )}
              {activeTab === 'machines' && machinePoints.map(p => {
                const isSelected = machineForm.id === p.id;
                const mc = drMachines.find(m => m.machine_no === p.machine_no);
                const isDragging = dragInfo?.kind === 'machine' && dragInfo.id === p.id;
                const isConnectSource = connectMode && connectFrom === p.id;
                const top = isDragging && dragPos ? dragPos.top : p.pos_top;
                const left = isDragging && dragPos ? dragPos.left : p.pos_left;
                return (
                  <div
                    key={p.id}
                    onMouseDown={(e) => startDrag(e, 'machine', p.id)}
                    title={!canEdit ? p.machine_no : connectMode ? `${p.machine_no} — คลิกเพื่อเชื่อมต่อสายงาน` : `${p.machine_no} — คลิกเพื่อแก้ไข — ลากเพื่อย้ายตำแหน่ง`}
                    style={{
                      position: 'absolute', top, left, transform: 'translate(-50%, -50%)',
                      width: SUB, height: SUB, borderRadius: '50%',
                      border: isConnectSource ? '2px solid #f97316' : isSelected ? '2px solid var(--green)' : p.redundancy_group ? '2px dashed #a855f7' : '2px solid rgba(255,255,255,0.75)',
                      backgroundColor: isConnectSource ? 'rgba(249,115,22,0.22)' : isSelected ? 'rgba(34,197,94,0.18)' : p.redundancy_group ? 'rgba(168,85,247,0.15)' : 'rgba(0,0,0,0.82)',
                      boxShadow: isDragging ? '0 0 10px rgba(61,214,92,0.7)' : isConnectSource ? '0 0 8px rgba(249,115,22,0.7)' : isSelected ? '0 0 8px rgba(34,197,94,0.5)' : '0 2px 6px rgba(0,0,0,0.6)',
                      cursor: isDragging ? 'grabbing' : connectMode ? 'pointer' : 'grab', display: 'flex',
                      alignItems: 'center', justifyContent: 'center', pointerEvents: 'auto',
                      zIndex: isDragging ? 15 : 5, opacity: isDragging ? 0.85 : 1,
                    }}
                  >
                    <span style={{ fontSize: subPinIconSz, lineHeight: 1 }}>⚙️</span>
                    {(pillsOn || isSelected || isConnectSource) && (
                      <div style={pillStackSt}>
                        <div style={{ ...subPillSt, color: isConnectSource ? '#f97316' : isSelected ? 'var(--green)' : '#fff' }}>
                          {p.machine_no}
                        </div>
                        {mc?.machine_name && (
                          <div style={{ ...subPillSt, color: '#a3a3a3' }}>
                            {mc.machine_name}
                          </div>
                        )}
                        {p.redundancy_group && (
                          <div style={{ ...subPillSt, color: '#d8b4fe' }}>
                            🔀 {p.redundancy_group}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {activeTab === 'machines' && machineTempPos && (
                <div style={{
                  position: 'absolute', top: machineTempPos.top, left: machineTempPos.left, transform: 'translate(-50%, -50%)',
                  width: SUB, height: SUB, borderRadius: '50%',
                  border: '1px dashed var(--accent)', backgroundColor: 'rgba(61,214,92,0.1)',
                  zIndex: 10, pointerEvents: 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <div style={{ color: 'var(--accent)', fontSize: 12 }}>+</div>
                </div>
              )}
              </div>}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: 20 }}>
              <p style={{ color: 'var(--muted)', marginBottom: 12 }}>ยังไม่มีรูปผังไลน์ {selectedLine}</p>
              {canEdit && (
                <label style={uploadBtnSt}>
                  {isUploading ? 'อัปโหลด...' : '➕ อัปโหลดรูป'}
                  <input type="file" hidden onChange={handleUploadImage} disabled={isUploading} />
                </label>
              )}
            </div>
          )
        ) : (
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>เพิ่มไลน์ผลิตก่อน</p>
        )}
      </div>

      <div style={{
        width: isMobile ? '100%' : 400,
        background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14,
        padding: 18, overflowY: 'auto', display: 'flex', flexDirection: 'column', flexShrink: 0
      }}>
        <div style={{ marginBottom: 16 }}>
          {/* หัวหมวดพับได้ + ตัวนับ — คลิกเพื่อพับ/กางรายการไลน์ (ข้อมูลเยอะ พับเก็บได้) */}
          <button onClick={toggleLineList}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: 10, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            <span style={labelSt}>{lineListOpen ? '▼' : '▶'} ไลน์ผลิต ({lines.length})</span>
          </button>
          {lineListOpen && lines.length > 6 && (
            <input value={lineSearch} onChange={e => setLineSearch(e.target.value)} placeholder="🔍 ค้นหาไลน์..."
              style={{ width: '100%', padding: '6px 10px', borderRadius: 8, fontSize: 12.5, background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)', marginBottom: 8 }} />
          )}
          {lineListOpen && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
            {(() => {
              // Build ordered display: parents first, their children indented below
              const parentLines = lines.filter(l => !l.parent_line_name);
              const childLines  = lines.filter(l => l.parent_line_name);
              const orphans     = childLines.filter(c => !lines.find(p => p.name === c.parent_line_name));
              const ordered = [];
              parentLines.forEach(p => {
                ordered.push({ ...p, _isParent: childLines.some(c => c.parent_line_name === p.name) });
                childLines.filter(c => c.parent_line_name === p.name).forEach(c => ordered.push({ ...c, _isChild: true }));
              });
              orphans.forEach(c => ordered.push({ ...c, _isChild: true, _orphan: true }));
              // ค้นหา: โชว์ไลน์ที่ชื่อตรง + คงบริบทลำดับชั้น (ลูกตรง→โชว์แม่ด้วย, แม่ตรง→โชว์ลูกด้วย)
              const q = lineSearch.trim().toLowerCase();
              const hit = (n) => n && n.toLowerCase().includes(q);
              const shown = (!q ? ordered : ordered.filter(l =>
                hit(l.name) ||
                (l._isChild && hit(l.parent_line_name)) ||
                (l._isParent && childLines.some(c => c.parent_line_name === l.name && hit(c.name)))
              // พับไลน์แม่ = ซ่อนไลน์ย่อยของมัน (ยกเว้นตอนค้นหา — โชว์ผลลัพธ์เสมอ)
              )).filter(l => q || !(l._isChild && collapsedParents.has(l.parent_line_name)));
              if (!shown.length) return <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', padding: '8px 0' }}>ไม่พบไลน์ที่ค้นหา</div>;
              return shown.map(l => (
                <div key={l.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '7px 10px', borderRadius: 8, cursor: 'pointer',
                    marginLeft: l._isChild ? 12 : 0,
                    background: selectedLine === l.name ? 'var(--accent-dim)' : l._isChild ? 'var(--bg3)' : 'var(--bg2)',
                    border: `1px solid ${selectedLine === l.name ? 'var(--accent)' : l._isChild ? 'var(--border)' : 'var(--border)'}`,
                    transition: 'background 0.15s, border-color 0.15s',
                  }}
                  onClick={() => { setSelectedLine(l.name); setTempPos(null); setFormData({ id: null, name: '', requirements: {} }); }}
                >
                  {l._isChild && <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>└</span>}
                  {l._isParent && (() => {
                    const nKids = childLines.filter(c => c.parent_line_name === l.name).length;
                    const col = collapsedParents.has(l.name);
                    return (
                      <span onClick={e => { e.stopPropagation(); toggleParent(l.name); }}
                        title={col ? `กางไลน์ย่อย (${nKids})` : 'พับไลน์ย่อย'}
                        style={{ fontSize: 11, color: 'var(--accent)', flexShrink: 0, cursor: 'pointer', padding: '2px 4px', borderRadius: 4, userSelect: 'none' }}>
                        {col ? `▶ ${nKids}` : '▼'}
                      </span>
                    );
                  })()}
                  {editingLineId === l.id ? (
                    <input
                      autoFocus
                      value={editingLineName}
                      onChange={e => setEditingLineName(e.target.value)}
                      onClick={e => e.stopPropagation()}
                      onKeyDown={e => {
                        e.stopPropagation();
                        if (e.key === 'Enter') handleRenameLine(l, editingLineName);
                        if (e.key === 'Escape') setEditingLineId(null);
                      }}
                      style={{ flex: 1, fontSize: 12, padding: '2px 6px', borderRadius: 5, border: '1px solid var(--accent)', background: 'var(--bg)', color: 'var(--text)', minWidth: 0 }}
                    />
                  ) : (
                    <span style={{ fontSize: 13, flex: 1, color: selectedLine === l.name ? 'var(--accent)' : 'var(--text)', fontWeight: selectedLine === l.name ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {l.name}
                      {l._orphan && <span style={{ fontSize: 11, color: '#ef4444', marginLeft: 4 }}>!parent missing</span>}
                    </span>
                  )}
                  {editingLineId === l.id ? (
                    <>
                      <button onClick={e => { e.stopPropagation(); handleRenameLine(l, editingLineName); }}
                        style={{ background: 'var(--accent)', border: 'none', color: '#fff', fontSize: 11, padding: '2px 7px', borderRadius: 5, cursor: 'pointer', flexShrink: 0, fontWeight: 700 }}>✓</button>
                      <button onClick={e => { e.stopPropagation(); setEditingLineId(null); }}
                        style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text2)', fontSize: 11, padding: '2px 7px', borderRadius: 5, cursor: 'pointer', flexShrink: 0 }}>✕</button>
                    </>
                  ) : canEdit && (
                    <>
                      <button onClick={e => { e.stopPropagation(); setEditingLineId(l.id); setEditingLineName(l.name); }}
                        style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 12, padding: '0 2px', lineHeight: 1, flexShrink: 0, cursor: 'pointer' }}
                        title="เปลี่ยนชื่อ">✏️</button>
                      <select
                        value={l.section || ''}
                        onClick={e => e.stopPropagation()}
                        onChange={e => { e.stopPropagation(); handleUpdateSection(l, e.target.value); }}
                        style={{ fontSize: 11, padding: '1px 3px', borderRadius: 4, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text2)', cursor: 'pointer', flexShrink: 0, maxWidth: 68 }}
                      >
                        <option value="">Section</option>
                        {sectionOptsInScope.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                      {/* Parent line selector — can't assign parent to a line that already has children */}
                      {!l._isParent && (
                        <select
                          value={l.parent_line_name || ''}
                          onClick={e => e.stopPropagation()}
                          onChange={e => { e.stopPropagation(); handleUpdateParent(l, e.target.value); }}
                          title="ไลน์หลัก (parent)"
                          style={{ fontSize: 11, padding: '1px 3px', borderRadius: 4, border: '1px solid var(--border2)', background: 'var(--bg3)', color: l.parent_line_name ? 'var(--accent)' : 'var(--muted)', cursor: 'pointer', flexShrink: 0, maxWidth: 76 }}
                        >
                          <option value="">ไม่มีหลัก</option>
                          {lines.filter(p => p.name !== l.name && !p.parent_line_name).map(p => (
                            <option key={p.id} value={p.name}>{p.name}</option>
                          ))}
                        </select>
                      )}
                      {canDel && <button className="tbtn" onClick={(e) => { e.stopPropagation(); handleDeleteLine(l); }}
                        style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 13, padding: '0 2px', lineHeight: 1, flexShrink: 0 }}
                        title="ลบไลน์">🗑️</button>}
                    </>
                  )}
                </div>
              ));
            })()}
            {lines.length === 0 && (
              <div style={{ textAlign: 'center', padding: '12px 0', color: 'var(--muted)', fontSize: 12 }}>ยังไม่มีไลน์ผลิต</div>
            )}
          </div>
          )}
          {canEdit && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <input placeholder="ชื่อไลน์ใหม่ เช่น HDF3" value={newLineName}
                onChange={e => setNewLineName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddLine()}
                style={{ flex: 1, fontSize: 13, padding: '8px 10px' }} />
              <select value={newLineSection} onChange={e => setNewLineSection(e.target.value)}
                style={{ fontSize: 12, padding: '8px 8px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text2)', flexShrink: 0, width: 'auto' }}>
                <option value="">Section</option>
                {sectionOptsInScope.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <select value={newLineParent} onChange={e => setNewLineParent(e.target.value)}
              style={{ fontSize: 12, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg3)', color: newLineParent ? 'var(--accent)' : 'var(--text2)' }}>
              <option value="">ไม่มีไลน์หลัก (standalone)</option>
              {/* cascade: เลือก section แล้วเห็นเฉพาะไลน์แม่ของ section นั้น (2026-07-21) */}
              {lines.filter(l => !l.parent_line_name && (!newLineSection || l.section === newLineSection)).map(l => (
                <option key={l.id} value={l.name}>ลูกของ {l.name}</option>
              ))}
            </select>
            <button onClick={handleAddLine} disabled={isAddingLine || !newLineName.trim()}
              style={{ padding: '8px 12px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13 }}>
              {isAddingLine ? '...' : '+ เพิ่มไลน์'}
            </button>
          </div>
          )}
        </div>

        {selectedLine && <>
          {canEdit && layoutImage && (
            <div style={{ display: 'flex', gap: 14, justifyContent: 'flex-end', alignItems: 'center', marginBottom: 14 }}>
              {/* ลบได้เฉพาะผังของตัวเอง — ผังที่ยืมจากไลน์แม่ไม่มีปุ่ม (ของแม่ ไปลบที่ไลน์แม่) */}
              {!usingParentLayout && (
                <button onClick={handleDeleteLayout}
                  style={{ fontSize: 12, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'var(--font-body)' }}>
                  🗑 ลบรูปผังนี้{lines.find(l => l.name === selectedLine)?.parent_line_name ? ' (กลับไปใช้ผังไลน์แม่)' : ''}
                </button>
              )}
              <label style={{ fontSize: 12, color: 'var(--blue)', cursor: 'pointer' }}>
                {isUploading ? 'อัปโหลด...' : '🔄 เปลี่ยนรูปภาพ'}
                <input type="file" hidden onChange={handleUploadImage} disabled={isUploading} />
              </label>
            </div>
          )}
          {activeTab === 'stations' && <>
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginBottom: 10 }}>
            <h4 style={{ margin: '0 0 10px', color: 'var(--text)', fontSize: 14, fontFamily: 'var(--font-display)' }}>
              {formData.id ? '📝 แก้ไขจุดงาน' : '📍 เพิ่มจุดงาน'}
            </h4>
            {(tempPos || formData.id) ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--bg2)', padding: 14, borderRadius: 10 }}>
                <input placeholder="ชื่อจุด (OP10)" value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })} />
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>
                  สกิลที่ต้องการ: {Object.keys(formData.requirements).length > 0 && (
                    <span style={{ color: 'var(--blue)', fontWeight: 400 }}>({Object.keys(formData.requirements).length} สกิล)</span>
                  )}
                </label>
                {skillDefs.length === 0 ? (
                  <div style={{ fontSize: 11, color: 'var(--muted)', padding: '8px', background: 'var(--bg3)', borderRadius: 6 }}>
                    ยังไม่มีสกิล — กำหนดสกิลได้ที่หน้า Operator
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {Object.entries(SKILL_CAT_META).map(([catKey, catMeta]) => {
                      const catSkills = skillDefs.filter(s => (s.category || 'hard_skill') === catKey);
                      if (catSkills.length === 0) return null;
                      return (
                        <div key={catKey}>
                          <div style={{ marginBottom: 4, paddingBottom: 3, borderBottom: `1px solid ${catMeta.color}33`, display: 'flex', alignItems: 'baseline', gap: 7 }}>
                            <span style={{ fontSize: 11, fontWeight: 800, color: catMeta.color, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{catMeta.icon} {catMeta.label}</span>
                            {catMeta.desc && <span style={{ fontSize: 11, color: catMeta.color, opacity: 0.7 }}>{catMeta.desc}</span>}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {catSkills.map(skill => {
                              const checked = skill.name in formData.requirements;
                              return (
                                <div key={skill.name} style={{
                                  display: 'flex', alignItems: 'center', gap: 6,
                                  padding: '5px 8px', borderRadius: 6,
                                  background: checked ? `${catMeta.color}12` : 'var(--bg3)',
                                  border: `1px solid ${checked ? catMeta.color + '55' : 'var(--border)'}`,
                                }}>
                                  <input type="checkbox" style={{ width: 'auto', flexShrink: 0 }}
                                    checked={checked} onChange={() => toggleSkillReq(skill.name)} />
                                  <span style={{ fontSize: 11, color: 'var(--text2)', flex: 1 }}>
                                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: skill.color || catMeta.color, marginRight: 4 }} />
                                    {skill.label}
                                  </span>
                                  {checked && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                      <input type="number" min={0} max={100}
                                        value={formData.requirements[skill.name]}
                                        onChange={e => setSkillScore(skill.name, e.target.value)}
                                        style={{ width: 46, fontSize: 11, padding: '2px 4px', textAlign: 'center' }} />
                                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>%</span>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {/* skill allowance toggle */}
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                  background: formData.skill_allowance ? 'rgba(34,197,94,0.1)' : 'var(--bg3)',
                  border: `1.5px solid ${formData.skill_allowance ? 'rgba(34,197,94,0.4)' : 'var(--border2)'}` }}>
                  <input type="checkbox" checked={formData.skill_allowance}
                    onChange={e => setFormData({ ...formData, skill_allowance: e.target.checked })}
                    style={{ width: 16, height: 16, accentColor: '#22c55e' }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: formData.skill_allowance ? '#22c55e' : 'var(--text2)' }}>💰 จุดงานได้ค่าฝีมือ</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>พนักงานที่ถูก assign จุดนี้จะได้ค่าฝีมือรายวัน</div>
                  </div>
                </label>
                {formData.skill_allowance && (
                  <div style={{ marginTop: 8 }}>
                    <label style={labelSt}>ประเภทค่าฝีมือ</label>
                    <select value={formData.skill_allowance_type}
                      onChange={e => setFormData({ ...formData, skill_allowance_type: e.target.value })}
                      style={{ marginTop: 4, width: '100%' }}>
                      <option value="">-- เลือกประเภท --</option>
                      {skillAllowanceTypes.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button onClick={handleSaveStation} style={{ flex: 1, padding: '9px', background: 'var(--green)', color: '#fff', border: 'none', borderRadius: 7, fontWeight: 700 }}>
                    {formData.id ? 'บันทึก' : 'เพิ่ม'}
                  </button>
                  <button onClick={() => { setTempPos(null); setFormData({ id: null, name: '', requirements: {}, skill_allowance: false, skill_allowance_type: '' }); }}
                    style={{ padding: '9px 14px', background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border2)', borderRadius: 7 }}>
                    ยกเลิก
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '16px', border: '2px dashed var(--border)', color: 'var(--muted)', borderRadius: 10, fontSize: 12 }}>
                {canEdit ? <>คลิกบนรูปภาพเพื่อเพิ่มจุดงาน<br />หรือคลิกที่จุดเดิมเพื่อแก้ไข</> : '👁️ โหมดดูอย่างเดียว — ไม่มีสิทธิ์แก้ไข'}
              </div>
            )}
          </div>
          <div style={{ borderTop: '1px solid var(--border)', margin: '10px 0 10px' }} />
          <h4 style={{ margin: '0 0 10px', color: 'var(--text)', fontSize: 14, fontFamily: 'var(--font-display)' }}>
            รายการจุดงาน ({stations.length})
          </h4>
          {stations.length > 6 && (
            <input value={pointSearch} onChange={e => setPointSearch(e.target.value)} placeholder="🔍 ค้นหาจุดงาน..."
              style={{ width: '100%', padding: '6px 10px', borderRadius: 8, fontSize: 12.5, background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)', marginBottom: 8 }} />
          )}
          <div style={{ flex: 1, minHeight: showManpower ? 120 : 260, overflowY: 'auto' }}>
            {stations.filter(st => { const q = pointSearch.trim().toLowerCase(); return !q || (st.station_name || '').toLowerCase().includes(q); }).map(st => {
              const reqs = st.station_requirements || [];
              return (
                <div key={st.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div onClick={() => canEdit && editStation(st)} style={{ cursor: canEdit ? 'pointer' : 'default', flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 5 }}>
                      {st.station_name}
                      {st.skill_allowance && <span style={{ fontSize: 11, background: 'rgba(34,197,94,0.15)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>💰 ค่าฝีมือ{st.skill_allowance_type ? ` (${st.skill_allowance_type})` : ''}</span>}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                      {reqs.length > 0
                        ? reqs.map(r => {
                            const def = skillDefs.find(d => d.name === r.skill_name);
                            return `${def?.label || r.skill_name} ≥${r.min_score}%`;
                          }).join(', ')
                        : 'ไม่มีสกิลที่กำหนด'}
                    </div>
                  </div>
                  {canDel && <button className="tbtn" onClick={() => deleteStation(st.id)} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>🗑️</button>}
                </div>
              );
            })}
          </div>
          </>}

          {activeTab === 'wip' && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginBottom: 10 }}>
              <h4 style={{ margin: '0 0 10px', color: 'var(--text)', fontSize: 14, fontFamily: 'var(--font-display)' }}>
                {wipForm.id ? '📝 แก้ไขจุด WIP' : '📦 เพิ่มจุด WIP'}
              </h4>
              {(wipTempPos || wipForm.id) ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--bg2)', padding: 14, borderRadius: 10, marginBottom: 14 }}>
                  <input placeholder="ชื่อจุด WIP (เช่น บัฟเฟอร์ OP20)" value={wipForm.point_name}
                    onChange={e => setWipForm({ ...wipForm, point_name: e.target.value })} />

                  <div style={{ display: 'flex', gap: 6 }}>
                    {[{ key: 'material', label: '🧱 Material', desc: 'เรียกงานจากสโตร์' }, { key: 'packaging', label: '📦 Packaging', desc: 'เรียกภาชนะจาก Tact Center' }].map(t => (
                      <button key={t.key} onClick={() => setWipForm({ ...wipForm, point_type: t.key })}
                        title={t.desc}
                        style={{
                          flex: 1, padding: '8px 6px', borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                          background: wipForm.point_type === t.key ? 'rgba(61,214,92,0.18)' : 'var(--bg3)',
                          border: wipForm.point_type === t.key ? '1px solid var(--green)' : '1px solid var(--border2)',
                          color: wipForm.point_type === t.key ? 'var(--green)' : 'var(--text2)',
                        }}>
                        {t.label}
                      </button>
                    ))}
                  </div>

                  {wipForm.point_type === 'material' ? (
                    <>
                      {/* ⚠️ เดิม hardcode 200/300/500 — ขัดกฎ matPrefix.js ที่บอกว่าเลข SAP
                          รันทะลุช่วงเดิมไปแล้ว ต้องแยกด้วย "เลขตัวแรกตัวเดียว" เท่านั้น
                          (เบอร์ 1 = FG หายไปจากลิสต์เดิมด้วย ทั้งที่จุด WIP เก็บ FG ได้) */}
                      {/* ข้อมูลเก่าเก็บ '200'/'300'/'500' — normalize ด้วย wipCatValue ตอนแสดง
                          ค่าเดิมจึงไม่หายจากช่อง (จะถูกเขียนเป็นเลขตัวเดียวเมื่อบันทึกครั้งถัดไป)
                          ⚠️ "ขั้นตอนย่อย" เป็นตัวเลือกของตัวเอง ไม่ใช่เบอร์ 9 (ดู wipMatOptions.js) */}
                      <select value={wipMatCat}
                        onChange={e => setWipForm({ ...wipForm, material_category: e.target.value })}>
                        <option value="">-- ประเภทวัสดุ --</option>
                        {wipCatOptions().map(c => (
                          <option key={c.value} value={c.value}>{c.label}</option>
                        ))}
                      </select>
                      {/* ⚠️ ทะเบียนพาร์ทหลักร้อยรายการ — <datalist> ค้นได้แค่ "ขึ้นต้นตรง" ใช้กับชื่อไทยไม่ได้
                          ใช้ SearchSelect ตามกฎ UI-CONVENTIONS §5.1.1 (ลิสต์เกิน ~30 แถวห้ามเป็น select/datalist)
                          allowFree = พาร์ทที่ยังไม่เข้าทะเบียนยังพิมพ์เองได้ (ติดป้ายบอกว่าอยู่นอกทะเบียน) */}
                      <SearchSelect
                        value={wipMatSel ? wipForm.mat_no : ''}
                        text={wipForm.mat_no}
                        options={wipMatShown}
                        allowFree
                        freeHint="ยังไม่มีในทะเบียนพาร์ท"
                        placeholder="เลขที่วัสดุ (mat no.) — พิมพ์รหัส/ชื่อเพื่อค้น"
                        emptyText={wipMatCat && !wipMatAllCat ? `ไม่พบใน ${wipCatLabel(wipMatCat)} — ลองกด "ดูทุกประเภท"` : 'ไม่พบพาร์ทที่ค้นหา'}
                        wrapRows
                        onChange={({ id, text }) => setWipForm(f => ({ ...f, mat_no: id || text }))}
                      />
                      {/* ชื่อพาร์ทยาวกว่าความกว้างแถบข้าง — โชว์ใต้ช่องแบบตัดบรรทัด ให้อ่านครบ
                          (ในช่องเก็บแค่เลข mat ไม่งั้นถูกตัดกลางคำจนอ่านไม่ออก) */}
                      {wipMatSel?.sub && (
                        <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: -2, overflowWrap: 'anywhere' }}>
                          <span style={{ color: wipMatSel.badgeColor, fontWeight: 700 }}>{wipMatSel.badge}</span>
                          {' · '}{wipMatSel.sub}
                        </div>
                      )}
                      {/* ⚠️ ประเภทวัสดุ derive จากเลข mat ได้อยู่แล้ว — บอกให้รู้ว่าไม่ต้องเลือกซ้ำ
                          (ถ้าไม่บอก คนจะคิดว่าเว้นว่างแล้วระบบไม่รู้ว่าเป็นพาร์ทซื้อ) */}
                      {!wipMatCat && wipMatDerived.text && (
                        <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: -2 }}>
                          ระบบอ่านจากเลข mat ได้เองว่าเป็น <b style={{ color: 'var(--text2)' }}>{wipMatDerived.text}</b> — ไม่ต้องเลือกประเภทก็ได้
                          {' '}(เลือกไว้เพื่อกรองลิสต์ตอนค้นหาเท่านั้น)
                        </div>
                      )}
                      {/* ห้ามซ่อนเงียบ — บอกเสมอว่าตัวกรองประเภทซ่อนไปกี่รายการ + ทางออก */}
                      {wipMatCat !== '' && wipMatHidden > 0 && (
                        <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: -2 }}>
                          {/* ⚠️ โชว์ "ชื่อประเภท" ไม่ใช่เลขดิบ — "กรองด้วยประเภท 9" อ่านไม่รู้เรื่อง
                              และทำให้เข้าใจผิดว่ารายการขั้นตอนที่คงไว้เป็นเบอร์ 9 (feedback หน้างาน) */}
                          กรอง: {wipCatLabel(wipMatCat)} · ซ่อน {wipMatHidden} รายการ
                          {wipMatKept > 0 && ` · รวม 🔩 ขั้นตอนย่อย (Operation) ${wipMatKept} รายการไว้ด้วย — ไม่มีเลข MAT SAP จึงไม่แยกตามประเภทวัสดุ`}
                          <button type="button" onClick={() => setWipMatAllCat(v => !v)}
                            style={{ marginLeft: 6, background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 10.5, padding: 0, textDecoration: 'underline' }}>
                            {wipMatAllCat ? 'กรองตามประเภทอีกครั้ง' : 'ดูทุกประเภท'}
                          </button>
                        </div>
                      )}
                      {/* เลขที่เลือกไม่ตรงประเภทที่ติ๊กไว้ — เตือน ไม่แก้ให้เอง (คนตัดสิน)
                          ⚠️ เตือนเฉพาะเลข SAP 8 หลักที่ไม่ใช่ OP — อย่างอื่นตีความประเภทไม่ได้ จะเตือนผิดทุกครั้ง */}
                      {wipForm.mat_no && wipMatCat && wipMatCat !== WIP_CAT_OP && !wipMatIsOp && isSapMat(wipForm.mat_no) && !matMatches(wipForm.mat_no, wipMatCat) && (
                        <div style={{ fontSize: 10.5, color: 'var(--accent2)', marginTop: -2 }}>
                          ⚠ {wipForm.mat_no} เป็น {matClassOf(wipForm.mat_no)?.label || 'ประเภทที่ไม่รู้จัก'} ไม่ตรงกับที่เลือกไว้ ({wipCatLabel(wipMatCat)})
                        </div>
                      )}
                      {/* ไม่ใช่เลข MAT SAP (8 หลัก) และไม่ใช่ OP = อาจพิมพ์ผิด/เป็นเลขลูกค้า — บอกไว้ ไม่บล็อก */}
                      {wipForm.mat_no && !wipMatIsOp && !isSapMat(wipForm.mat_no) && (
                        <div style={{ fontSize: 10.5, color: 'var(--accent2)', marginTop: -2 }}>
                          ⚠ “{wipForm.mat_no}” ไม่ใช่เลข MAT SAP (ต้องเป็นตัวเลข 8 หลัก) — บันทึกได้
                          แต่ระบบตอบไม่ได้ว่าเป็นวัสดุประเภทไหน · ถ้าเป็นขั้นตอนการผลิต ให้ติ๊ก 🔩 รายการขั้นตอน ที่ Product Master
                          แล้วเลือกประเภทเป็น “🔩 ขั้นตอนย่อย (Operation)”
                        </div>
                      )}
                      {/* เลือก OP = ตั้งใจได้ (บัฟเฟอร์เก็บของหลังขั้นนั้นจริง) แต่ต้องรู้ว่ามันไม่ใช่พาร์ทในทะเบียน */}
                      {wipMatIsOp && (
                        <div style={{ fontSize: 10.5, color: 'var(--accent2)', marginTop: -2 }}>
                          🔩 ขั้นตอนย่อย (Operation) — ไม่ใช่พาร์ทในทะเบียน SAP · สโตร์ไม่มีของตัวนี้ให้เบิก
                          จุดนี้จึงเป็น <b>บัฟเฟอร์ระหว่างขั้นในไลน์</b> (Min/Max ใช้ดูจังหวะงาน ไม่ใช่จุดสั่งเติมจากสโตร์)
                          {wipMatCat !== WIP_CAT_OP && ' · แนะนำตั้งประเภทเป็น “🔩 ขั้นตอนย่อย (Operation)”'}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <select value={wipForm.packaging_type}
                        onChange={e => setWipForm({ ...wipForm, packaging_type: e.target.value })}>
                        <option value="">-- เลือกภาชนะ (Container Types) --</option>
                        {containerTypes.map(c => <option key={c.code} value={c.code}>{c.code} · {c.name}{c.category ? ` (${c.category})` : ''}</option>)}
                      </select>
                      {containerTypes.length === 0 && (
                        <div style={{ fontSize: 11, color: '#f59e0b' }}>ยังไม่มีภาชนะ — เพิ่มที่ Product Master → Packaging → จัดการภาชนะ</div>
                      )}
                      <input placeholder="packaging no." value={wipForm.packaging_no}
                        onChange={e => setWipForm({ ...wipForm, packaging_no: e.target.value })} />
                    </>
                  )}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <label style={labelSt}>Min</label>
                      <input type="number" value={wipForm.min_qty}
                        onChange={e => setWipForm({ ...wipForm, min_qty: e.target.value })}
                        style={{ marginTop: 4, textAlign: 'center' }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={labelSt}>Max</label>
                      <input type="number" value={wipForm.max_qty}
                        onChange={e => setWipForm({ ...wipForm, max_qty: e.target.value })}
                        style={{ marginTop: 4, textAlign: 'center' }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={labelSt}>ปัจจุบัน</label>
                      <input type="number" value={wipForm.current_qty}
                        onChange={e => setWipForm({ ...wipForm, current_qty: e.target.value })}
                        style={{ marginTop: 4, textAlign: 'center' }} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button onClick={handleSaveWip} style={{ flex: 1, padding: '9px', background: 'var(--green)', color: '#fff', border: 'none', borderRadius: 7, fontWeight: 700 }}>
                      {wipForm.id ? 'บันทึก' : 'เพิ่ม'}
                    </button>
                    <button onClick={() => { setWipTempPos(null); setWipForm(emptyWipForm); }}
                      style={{ padding: '9px 14px', background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border2)', borderRadius: 7 }}>
                      ยกเลิก
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '16px', border: '2px dashed var(--border)', color: 'var(--muted)', borderRadius: 10, fontSize: 12, marginBottom: 14 }}>
                  {canEdit ? <>คลิกบนรูปภาพเพื่อเพิ่มจุด WIP<br />หรือคลิกที่จุดเดิมเพื่อแก้ไข</> : '👁️ โหมดดูอย่างเดียว — ไม่มีสิทธิ์แก้ไข'}
                </div>
              )}
              <h4 style={{ margin: '0 0 10px', color: 'var(--text)', fontSize: 14, fontFamily: 'var(--font-display)' }}>
                รายการจุด WIP ({wipPoints.length})
              </h4>
              {wipPoints.length > 6 && (
                <input value={pointSearch} onChange={e => setPointSearch(e.target.value)} placeholder="🔍 ค้นหาจุด WIP..."
                  style={{ width: '100%', padding: '6px 10px', borderRadius: 8, fontSize: 12.5, background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)', marginBottom: 8 }} />
              )}
              <div style={{ flex: 1, minHeight: 260, overflowY: 'auto' }}>
                {wipPoints.filter(p => { const q = pointSearch.trim().toLowerCase(); return !q || (p.point_name || '').toLowerCase().includes(q); }).map(p => {
                  const isLow = (p.current_qty ?? 0) < (p.min_qty ?? 0);
                  return (
                    <div key={p.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div onClick={() => canEdit && editWipPoint(p)} style={{ cursor: canEdit ? 'pointer' : 'default', flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>
                          {p.point_type === 'packaging' ? '📦' : '🧱'} {p.point_name} {isLow && <span style={{ fontSize: 11, background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>⚠️ ต่ำกว่า min</span>}
                        </div>
                        {/* ⚠️ material_category เป็น "เลขประเภท"/'op' ไม่ใช่เลข MAT → ต้องใช้ wipCatLabel
                            (matClassOf เข้มขึ้นแล้ว: ไม่ใช่เลข SAP 8 หลัก คืน null · และห้ามโชว์เลขดิบ) */}
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                          {p.point_type === 'packaging'
                            ? `${p.packaging_type ? `${p.packaging_type} · ` : ''}${p.packaging_no ? `${p.packaging_no} · ` : ''}`
                            : `${wipPointCat(p.material_category, p.mat_no).text ? `${wipPointCat(p.material_category, p.mat_no).text} · ` : ''}${p.mat_no ? `${p.mat_no} · ` : ''}`}
                          คงเหลือ {p.current_qty ?? 0} (min {p.min_qty ?? 0} / max {p.max_qty ?? 0})
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {isLow && (
                          <button onClick={() => requestWipReplenish(p)} title="เรียกเติมของจุดนี้"
                            style={{ background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.4)', color: '#f59e0b', cursor: 'pointer', fontSize: 11, fontWeight: 700, borderRadius: 6, padding: '4px 8px', whiteSpace: 'nowrap' }}>
                            🔔 เรียกเติม
                          </button>
                        )}
                        {canDel && <button className="tbtn" onClick={() => deleteWipPoint(p.id)} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>🗑️</button>}
                      </div>
                    </div>
                  );
                })}
                {wipPoints.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '12px 0', color: 'var(--muted)', fontSize: 12 }}>ยังไม่มีจุด WIP</div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'machines' && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginBottom: 10 }}>
              {/* ทะเบียนเครื่องจักร (สร้าง/แก้ไข/กำหนดประเภท) ย้ายไปหน้าฐานข้อมูลเครื่องจักรแล้ว — ที่นี่แค่วางจุดบนผัง */}
              <a href="/machine-database" target="_blank" rel="noopener noreferrer"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, textDecoration: 'none',
                  background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>🏭 ฐานข้อมูลเครื่องจักร</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{drMachines.length} เครื่องในไลน์นี้ · เพิ่ม/แก้ไข/กำหนดประเภทเครื่องจักรที่นี่</div>
                </div>
                <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 700, flexShrink: 0 }}>เปิดหน้า ↗</span>
              </a>

              {/* ── วางจุดเครื่องจักรบนผัง ── */}
              <h4 style={{ margin: '0 0 10px', color: 'var(--text)', fontSize: 14, fontFamily: 'var(--font-display)' }}>
                {machineForm.id ? '📝 แก้ไขจุดเครื่องจักร' : '⚙️ เพิ่มจุดเครื่องจักร'}
              </h4>
              {(machineTempPos || machineForm.id) ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--bg2)', padding: 14, borderRadius: 10, marginBottom: 14 }}>
                  {/* ซ่อนเครื่องที่วางบนผังไปแล้ว (ทุกไลน์ในครอบครัว) — เหลือเฉพาะที่ยังไม่วาง + ตัวที่กำลังแก้ */}
                  <select value={machineForm.machine_no}
                    onChange={e => setMachineForm({ ...machineForm, machine_no: e.target.value })}>
                    <option value="">-- เลือกเครื่องจักร --</option>
                    {selectableMachines.filter(m => !m.machine_type_id).map(m => (
                      <option key={m.id} value={m.machine_no}>{m.machine_no} {m.machine_name ? `- ${m.machine_name}` : ''}</option>
                    ))}
                    {machineTypes.map(t => {
                      const items = selectableMachines.filter(m => m.machine_type_id === t.id);
                      if (!items.length) return null;
                      return (
                        <optgroup key={t.id} label={`${t.icon || ''} ${t.label}`}>
                          {items.map(m => (
                            <option key={m.id} value={m.machine_no}>{m.machine_no} {m.machine_name ? `- ${m.machine_name}` : ''}</option>
                          ))}
                        </optgroup>
                      );
                    })}
                  </select>
                  {drMachines.filter(m => m.is_active).length === 0 ? (
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>ยังไม่มีเครื่องจักรในทะเบียนของไลน์นี้ — เพิ่มได้ที่ 🏭 ฐานข้อมูลเครื่องจักร ด้านบน</div>
                  ) : selectableMachines.length === 0 && (
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>เครื่องจักรทุกเครื่องของไลน์นี้ถูกวางบนผังแล้ว — ลบจุดเดิมก่อนถ้าต้องการวางใหม่</div>
                  )}
                  <div>
                    <label style={{ ...labelSt, display: 'block', marginBottom: 4 }}>กลุ่มเครื่องคู่ขนาน (Redundancy Group) — ไม่บังคับ</label>
                    <input type="text" list="redundancy-group-options" value={machineForm.redundancy_group}
                      onChange={e => setMachineForm({ ...machineForm, redundancy_group: e.target.value })}
                      placeholder="เช่น Laser Group" />
                    <datalist id="redundancy-group-options">
                      {[...new Set(machinePoints.map(p => p.redundancy_group).filter(Boolean))].map(g => (
                        <option key={g} value={g} />
                      ))}
                    </datalist>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
                      ใส่ชื่อกลุ่มเดียวกันให้เครื่องที่ทำงานคู่ขนานแบบ balance cycle time (เช่น Laser1/2/3) — ถ้าตัวใดหยุด ระบบจะลดกำลังผลิตตามสัดส่วน (1/จำนวนเครื่องในกลุ่ม) ไม่ใช่หยุดทั้งไลน์
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button onClick={handleSaveMachine} style={{ flex: 1, padding: '9px', background: 'var(--green)', color: '#fff', border: 'none', borderRadius: 7, fontWeight: 700 }}>
                      {machineForm.id ? 'บันทึก' : 'เพิ่ม'}
                    </button>
                    <button onClick={() => { setMachineTempPos(null); setMachineForm({ id: null, machine_no: '', redundancy_group: '' }); }}
                      style={{ padding: '9px 14px', background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border2)', borderRadius: 7 }}>
                      ยกเลิก
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '16px', border: '2px dashed var(--border)', color: 'var(--muted)', borderRadius: 10, fontSize: 12, marginBottom: 14 }}>
                  {canEdit ? <>คลิกบนรูปภาพเพื่อเพิ่มจุดเครื่องจักร<br />หรือคลิกที่จุดเดิมเพื่อแก้ไข</> : '👁️ โหมดดูอย่างเดียว — ไม่มีสิทธิ์แก้ไข'}
                </div>
              )}
              <h4 style={{ margin: '0 0 10px', color: 'var(--text)', fontSize: 14, fontFamily: 'var(--font-display)' }}>
                รายการจุดเครื่องจักร ({machinePoints.length})
              </h4>
              {machinePoints.length > 6 && (
                <input value={pointSearch} onChange={e => setPointSearch(e.target.value)} placeholder="🔍 ค้นหาเครื่องจักร (เลข/ชื่อ)..."
                  style={{ width: '100%', padding: '6px 10px', borderRadius: 8, fontSize: 12.5, background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)', marginBottom: 8 }} />
              )}
              <div style={{ flex: 1, minHeight: 260, overflowY: 'auto' }}>
                {machinePoints.filter(p => { const q = pointSearch.trim().toLowerCase(); if (!q) return true; const mc = drMachines.find(m => m.machine_no === p.machine_no); return (p.machine_no || '').toLowerCase().includes(q) || (mc?.machine_name || '').toLowerCase().includes(q); }).map(p => {
                  const mc = drMachines.find(m => m.machine_no === p.machine_no);
                  return (
                    <div key={p.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div onClick={() => canEdit && editMachinePoint(p)} style={{ cursor: canEdit ? 'pointer' : 'default', flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>{p.machine_no}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{mc?.machine_name || ''}</div>
                        {p.redundancy_group && (
                          <div style={{ fontSize: 11, color: '#a855f7', fontWeight: 700, marginTop: 2 }}>🔀 {p.redundancy_group}</div>
                        )}
                      </div>
                      {canDel && <button className="tbtn" onClick={() => deleteMachinePoint(p.id)} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>🗑️</button>}
                    </div>
                  );
                })}
                {machinePoints.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '12px 0', color: 'var(--muted)', fontSize: 12 }}>ยังไม่มีจุดเครื่องจักร</div>
                )}
              </div>

              <div style={{ borderTop: '1px solid var(--border)', marginTop: 14, paddingTop: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <h4 style={{ margin: 0, color: 'var(--text)', fontSize: 14, fontFamily: 'var(--font-display)' }}>
                    🔗 เส้นทางการผลิต
                  </h4>
                  {canEdit && (
                  <button
                    onClick={() => { setConnectMode(v => !v); setConnectFrom(null); }}
                    style={{
                      position: 'relative',
                      padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                      border: `1px solid ${connectMode ? '#f97316' : 'var(--border2)'}`,
                      background: connectMode ? 'rgba(249,115,22,0.18)' : 'var(--bg2)',
                      color: connectMode ? '#f97316' : 'var(--text2)',
                    }}>
                    {connectMode ? '✓ กำลังเชื่อม' : '🔗 เชื่อมต่อ'}
                    <ToggleDot on={connectMode} />
                  </button>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.5 }}>
                  เชื่อมเครื่องจักรที่ทำงาน <b>ต่อเนื่องกัน (Sequential)</b> — ถ้าเครื่องหนึ่งหยุด อีกเครื่องในสายต้องหยุดด้วย<br />
                  เครื่องที่ <b>ไม่เชื่อม</b> ถือว่าทำงานแบบ Parallel — Downtime จะกระทบแค่เครื่องนั้นเครื่องเดียว
                </div>
                {connectMode && (
                  <div style={{ fontSize: 11, color: '#f97316', background: 'rgba(249,115,22,0.1)', padding: '8px 10px', borderRadius: 8, marginBottom: 10 }}>
                    {connectFrom
                      ? `คลิกเครื่องจักรเครื่องที่ 2 บนรูปเพื่อเชื่อมจาก ${machinePoints.find(p => p.id === connectFrom)?.machine_no || ''}`
                      : 'คลิกเครื่องจักรเครื่องแรกบนรูปเพื่อเริ่มเชื่อมสายงาน'}
                  </div>
                )}
                <div style={{ maxHeight: 160, overflowY: 'auto' }}>
                  {flowLinks.map(link => {
                    const from = machinePoints.find(p => p.id === link.from_machine_point_id);
                    const to = machinePoints.find(p => p.id === link.to_machine_point_id);
                    return (
                      <div key={link.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                        <span style={{ color: 'var(--text)' }}>⚙️ {from?.machine_no || '?'} → {to?.machine_no || '?'}</span>
                        {canDel && <button className="tbtn" onClick={() => deleteFlowLink(link.id)} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 14 }}>🗑️</button>}
                      </div>
                    );
                  })}
                  {flowLinks.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '8px 0', color: 'var(--muted)', fontSize: 11 }}>ยังไม่มีการเชื่อมต่อสายงาน</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Standard Manpower ─────────────────────────── */}
          <div style={{ borderTop: '1px solid var(--border)', margin: '14px 0 12px' }} />
          <button
            onClick={() => setShowManpower(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
              background: 'none', border: 'none', padding: 0, marginBottom: showManpower ? 10 : 0, cursor: 'pointer',
            }}
          >
            <h4 style={{ margin: 0, color: 'var(--text)', fontSize: 14, fontFamily: 'var(--font-display)' }}>
              {/* ชื่อแผงต้องครอบทุกอย่างที่อยู่ข้างใน — เดิมชื่อ "Standard Manpower" อย่างเดียว
                  แต่ข้างในมีคุณสมบัติไลน์ (ประเภท/โหมดไหลงาน/เครื่องขนาน) ด้วย user ทักว่าสับสน (2026-08-06) */}
              ⚙️ ตั้งค่าไลน์ <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--muted)' }}>· กำลังคน + คุณสมบัติไลน์</span>
            </h4>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{showManpower ? '▲ ซ่อน' : '▼ แสดง'}</span>
          </button>
          {showManpower && (
          <div style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 10, padding: 14 }}>
            {/* ══ ข้อมูลของกลุ่ม — ไลน์ย่อยที่ไม่ได้ตั้งเอง จะตกทอดค่าจากไลน์แม่ ══ */}
            <div style={groupHeadSt}>
              🏢 ข้อมูลของกลุ่ม <span style={{ fontWeight: 400, color: 'var(--muted)' }}>· ไลน์ย่อยที่ไม่ได้ตั้งเอง จะตามไลน์แม่</span>
            </div>
            {parentLineObj && (
              <div style={inheritNoteSt}>
                ไลน์นี้เป็น <strong style={{ color: 'var(--text)' }}>ไลน์ย่อย</strong> ของ <strong style={{ color: 'var(--text)' }}>{parentLineObj.name}</strong> —
                เว้นว่าง/ใส่ 0 = ใช้ค่าของไลน์แม่ · กรอกเมื่อไลน์นี้มีกำลังคน/ผู้รับผิดชอบแยกจริงเท่านั้น
              </div>
            )}
            {!parentLineObj && childLines.length > 0 && (
              <div style={inheritNoteSt}>
                ไลน์นี้เป็น <strong style={{ color: 'var(--text)' }}>ไลน์หลักของกลุ่ม</strong> (มีไลน์ย่อย {childLines.length} ไลน์) —
                ตัวเลขที่กรอกที่นี่คือกำลังคน <strong style={{ color: 'var(--text)' }}>ของทั้งกลุ่ม</strong> ระบบจะไม่บวกไลน์ย่อยซ้ำ
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, marginBottom: 6 }}>
              <div style={{ flex: 1 }}>
                <label style={labelSt}>☀️ กะเช้า (คน)</label>
                <input type="number" min={0} value={stdDay} disabled={!canEdit}
                  onChange={e => setStdDay(e.target.value)}
                  style={{ marginTop: 4, fontSize: 18, fontWeight: 700, textAlign: 'center' }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelSt}>🌙 กะดึก (คน)</label>
                <input type="number" min={0} value={stdNight} disabled={!canEdit}
                  onChange={e => setStdNight(e.target.value)}
                  style={{ marginTop: 4, fontSize: 18, fontWeight: 700, textAlign: 'center' }} />
              </div>
            </div>
            {parentLineObj && (
              <div style={{ ...inheritNoteSt, marginBottom: 12 }}>
                {(parentLineObj.std_day_shift || 0) > 0 || (parentLineObj.std_night_shift || 0) > 0 ? (
                  <>
                    ไลน์แม่ <strong style={{ color: 'var(--text)' }}>{parentLineObj.name}</strong> ตั้งกำลังคน
                    <strong style={{ color: 'var(--text)' }}> ของทั้งกลุ่ม</strong> ไว้แล้ว
                    (☀️ {parentLineObj.std_day_shift || 0} · 🌙 {parentLineObj.std_night_shift || 0} คน) —
                    ระบบใช้ตัวเลขนั้นเป็นยอดกลุ่ม ตัวเลขในช่องนี้จะ<strong style={{ color: 'var(--text)' }}>ไม่ถูกนับซ้ำ</strong>
                    {((parseInt(stdDay) || 0) > 0 || (parseInt(stdNight) || 0) > 0) &&
                      ' · ถ้าอยากให้นับแยกรายไลน์จริง ต้องล้างตัวเลขที่ไลน์แม่ให้เป็น 0 แล้วกรอกทุกไลน์ย่อยแทน'}
                  </>
                ) : (
                  <>ไลน์แม่ <strong style={{ color: 'var(--text)' }}>{parentLineObj.name}</strong> ไม่ได้ตั้งกำลังคนไว้ —
                    ระบบจะ<strong style={{ color: 'var(--text)' }}>รวมกำลังคนจากไลน์ย่อยแต่ละไลน์</strong> ตัวเลขที่กรอกที่นี่จึงถูกนับจริง</>
                )}
              </div>
            )}
            <div style={{ marginBottom: 12 }}>
              <label style={labelSt}>🏷️ Cost Center</label>
              <input type="text" value={costCenter} disabled={!canEdit}
                onChange={e => setCostCenter(e.target.value)}
                placeholder={parentLineObj?.cost_center ? `ตามไลน์แม่: ${parentLineObj.cost_center}` : 'เช่น 2140662201'}
                style={{ marginTop: 4, fontSize: 14, fontWeight: 600 }} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', margin: '-4px 0 12px' }}>
              รวมกำลังคน <strong style={{ color: 'var(--text)' }}>{(parseInt(stdDay) || 0) + (parseInt(stdNight) || 0)}</strong> คน (เช้า+ดึก)
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={labelSt}>👨‍🔧 หัวหน้างาน (ใช้ในใบค่าฝีมือ)</label>
              <input type="text" value={signerHead} disabled={!canEdit}
                onChange={e => setSignerHead(e.target.value)}
                placeholder={parentLineObj?.head_name ? `ตามไลน์แม่: ${parentLineObj.head_name}` : 'เช่น คุณสุวิทชัย ดีทั่ว'}
                style={{ marginTop: 4 }} />
            </div>

            {/* ══ ข้อมูลเฉพาะไลน์นี้ — คุณสมบัติเครื่อง/การไหลงานจริง ไม่ตกทอดถึงไลน์ย่อย ══
                แยกพื้นหลัง+เส้นคั่นให้เห็นชัดว่า "คนละเรื่องกับกำลังคนข้างบน" (user ทักว่าของปนกันในแผงเดียว) */}
            <div style={{ ...groupHeadSt, borderTop: '2px solid var(--border)', paddingTop: 12, marginTop: 4 }}>
              🏭 คุณสมบัติของไลน์นี้ <span style={{ fontWeight: 400, color: 'var(--muted)' }}>· ไม่ใช่เรื่องกำลังคน · ไม่ตกทอดถึงไลน์ย่อย ตั้งแยกทุกไลน์</span>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={labelSt}>🏭 ประเภทไลน์</label>
              <select value={lineType} disabled={!canEdit}
                onChange={e => setLineType(e.target.value)}
                style={{ marginTop: 4, fontSize: 13, fontWeight: 600 }}>
                <option value="">— ยังไม่ระบุ —</option>
                {LINE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={labelSt}>🔀 รูปแบบการไหลงาน (บอร์ด Heijunka)</label>
              <select value={flowMode} disabled={!canEdit}
                onChange={e => setFlowMode(e.target.value)}
                style={{ marginTop: 4, fontSize: 13, fontWeight: 600 }}>
                {FLOW_MODES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, lineHeight: 1.4 }}>
                {flowMode === 'parallel_machine'
                  ? 'เครื่อง stand-alone หลายตัววิ่งพร้อมกันคนละรายการ (เช่น SUB APRON) — บอร์ดแตกเลนขนานตามเครื่อง + เลือกเครื่องตอนเปิด Order'
                  : 'สายเดียวไหลทีละชิ้น — บอร์ดเรียงคิว 1 ใบต่อครั้ง (ดีฟอลต์ · งานคู่ LH/RH แยกเลนคู่ให้เองจาก pair_mat_no)'}
              </div>
              <div style={{ marginTop: 8 }}>
                <label style={{ ...labelSt, fontSize: 11 }}>
                  ⚙️ จำนวนเครื่องหลักวิ่งขนาน (N) — ใช้หัก Downtime ที่ระบุเครื่อง 1/N ในสูตร OEE
                </label>
                <input type="number" min="1" value={parallelStations} disabled={!canEdit}
                  onChange={e => setParallelStations(e.target.value)}
                  placeholder="เช่น 3" style={{ marginTop: 4, width: 120 }} />
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3, lineHeight: 1.4 }}>
                  = <strong style={{ color: 'var(--text)' }}>เครื่องหลักที่เดินพร้อมกันจริงตอนเต็มกำลัง</strong> (ไม่ใช่จำนวนเครื่องทั้งหมดในไลน์ และไม่ใช่จำนวนคน)
                  · ตั้งได้ทุกโหมดไหลงาน — เช่น LASER-345/789 (เลเซอร์ 3 ตัวขึ้นงานคู่ LH/RH) เป็น One-piece flow แต่ตั้ง N=3
                  · <strong style={{ color: 'var(--text)' }}>มีผล 2 ที่: หัก Downtime 1/N ในสูตร OEE และตัวเลข "ควรผลิตได้ตอนนี้" บนผังรวมโรงงาน</strong>
                </div>
                {flowMode === 'parallel_machine' && !(parseInt(parallelStations) > 0) && (
                  // ⚠️ ไลน์เครื่องขนานที่ไม่ตั้ง N = ผังรวมคำนวณกำลังผลิตไม่ได้ ต้องถอยไปสูตรอัตราตามเวลา — ห้ามปล่อยเงียบ
                  <div style={{ fontSize: 11, lineHeight: 1.45, color: '#f59e0b', background: '#f59e0b14', border: '1px solid #f59e0b44', borderRadius: 6, padding: '6px 8px', marginTop: 6 }}>
                    ⚠️ ไลน์นี้ตั้งเป็น "เครื่องขนาน" แต่ยังไม่ได้กรอก N — ระบบไม่รู้ว่าเดินกี่เครื่องพร้อมกัน
                    จึงคิด "ควรผลิตได้ตอนนี้" จากสัดส่วนเวลาที่ผ่านไปแทน (หยาบกว่า) และหัก Downtime เต็มเหมือนไลน์เครื่องเดียว
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              {/* ⏸ ปลดระวางไลน์ — ทางเลือกแทนการ "ลบไลน์" ซึ่งทำให้ชื่อไลน์ที่ถูกเก็บเป็น text
                  ในหลายสิบตาราง 2 project กำพร้าเงียบทันที (ดูกฎ rename cascade ใน CLAUDE.md)
                  ปลดระวาง = ไม่โผล่ใน dropdown ให้เลือกใหม่ แต่ข้อมูลเก่ายังอ่านออกครบ */}
              {canEdit && selLineObj && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: selLineObj.is_active === false ? '#f59e0b' : 'var(--muted)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={selLineObj.is_active === false} onChange={e => handleToggleRetire(e.target.checked)} />
                  <span>⏸ ปลดระวางไลน์นี้ {selLineObj.is_active === false
                    ? '(ไม่โผล่ให้เลือกใหม่แล้ว · ข้อมูลเก่ายังอ่านได้)'
                    : '— ใช้แทนการลบ เมื่อเลิกใช้ไลน์'}</span>
                </label>
              )}
              {canEdit && (
              <button onClick={handleSaveStdManpower} disabled={mpSaving}
                style={{ padding: '7px 18px', background: mpSaving ? 'var(--muted)' : 'var(--accent)', color: '#fff', border: 'none', borderRadius: 7, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                {mpSaving ? 'กำลังบันทึก...' : '💾 บันทึก'}
              </button>
              )}
            </div>
          </div>
          )}

          {/* 🔗 สายการไหลระหว่างไลน์ — ไลน์นี้ป้อนงานให้ใคร / รับของจากใคร (2026-08-19) */}
          <LineFlowPanel lineName={selectedLine} lines={lines} canEdit={canEdit} />

          {/* 🎯 จุดส่งงานหน้าไลน์ — ป้าย QR ที่สโตร์สแกนตอนวางของถึงไลน์ (ลูปสโตร์เฟส 4 · 2026-09-03) */}
          <DeliveryPointPanel lineName={selectedLine} lines={lines} />

          {/* ผู้เซ็นใบค่าฝีมือ ราย section ย้ายไปตั้งที่ผังองค์กร (OrgSetup) — เป็นข้อมูลราย section ไม่ใช่ราย line */}
          <div style={{ borderTop: '1px solid var(--border)', margin: '14px 0 12px' }} />
          <div style={{ fontSize: 12, color: 'var(--muted)', background: 'var(--bg3)', border: '1px dashed var(--border2)', borderRadius: 10, padding: '10px 14px' }}>
            ✍️ ผู้เซ็น/อนุมัติใบค่าฝีมือ (ราย section) ย้ายไปตั้งที่หน้า <a href="/org-setup" style={{ color: 'var(--accent)', fontWeight: 700 }}>ผังองค์กร</a> แล้ว — เพราะเป็นข้อมูลราย "ส่วนงาน" ใช้ร่วมกันทุกไลน์ในส่วนนั้น
          </div>

        </>}
      </div>
    </div>
    </div>
  );
}

const labelSt = {
  display: 'block', fontSize: 12, fontWeight: 600,
  color: 'var(--text2)', marginBottom: 0,
  letterSpacing: '0.04em', textTransform: 'uppercase'
};

/* หัวข้อกลุ่มในแผง Standard Manpower — บอกว่า field ใต้หัวข้อนี้อยู่ระดับ "กลุ่ม" หรือ "ไลน์นี้" */
const groupHeadSt = {
  fontSize: 12, fontWeight: 800, color: 'var(--text)',
  marginBottom: 8, fontFamily: 'var(--font-display)',
};

/* กล่องอธิบายการตกทอดค่าจากไลน์แม่ (ตัวเล็ก สีจาง ไม่แย่งสายตาจากช่องกรอก) */
const inheritNoteSt = {
  fontSize: 11, lineHeight: 1.45, color: 'var(--muted)',
  background: 'var(--bg2)', border: '1px solid var(--border2)',
  borderRadius: 6, padding: '6px 8px', marginBottom: 10,
};

const uploadBtnSt = {
  display: 'inline-block', padding: '10px 20px',
  background: 'var(--accent)', color: '#fff',
  borderRadius: 8, cursor: 'pointer', fontSize: 14
};
