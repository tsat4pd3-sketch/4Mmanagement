import { useState, useMemo, useEffect } from 'react';
import { orgNodeCompare } from '../utils/listOrder';
import { supabase } from '../supabaseClient';
import { toast } from '../components/Toast';
import { loadLinesRes } from '../utils/useProductionLines';
import { accessSummaryForRole } from '../App';
import { ROLE_OPTIONS, roleLabel, groupRolesByAxis } from '../utils/roleMeta';
import { positionOptions, positionOptionsWith, positionLabel, loadPositions, clearPositionsCache, levelOfPosition, maintenanceKindOfPosition, levelMeta, POSITION_LEVELS } from '../utils/positions';
import { can, loadPermissions } from '../utils/permissions';   // เช็คสิทธิ์ของ role ที่เลือก เพื่อเตือนเมื่อไม่ตรงกับระดับงาน
import { deptNameOf, teamKeyOf } from '../utils/mtnTeams';
import { pmTeamsSync, loadPmTeams } from '../utils/pmTeams';   // ทีมช่างซ่อมจากตาราง mtn_teams (data-driven) — เลิกวน MTN_TEAMS hardcode (2026-09-07)
import { checkWrite, checkWriteRows } from '../utils/dbWrite';
import LineSelect from '../components/LineSelect';
import { STAFF_KINDS, STAFF_SHOPFLOOR, STAFF_SUPPORT } from '../utils/staffKind';   // 👥 หน้าไลน์ vs สายสนับสนุน
import { normSearch } from '../components/SearchSelect';   // ตัว normalize คำค้นกลาง (ทนการสะกดไทย)
import { orphanDepts, deptOptionsFor, ORPHAN_SECTION, ORPHAN_SECTION_LABEL, sectionValueForSave,
  orgNodeIdFor, ORG_SRC_MANUAL, scopeIneffective } from '../utils/sectionScope';
import { SCOPE_DEPTHS, SCOPE_DEPTH_META, depthForLevel, needsScopeReview } from '../utils/scopeDepth';   // 🔭 เห็นกว้างแค่ไหน (คนละแกนกับ role)
import { buildOrgScope, SCOPE_KIND_META } from '../utils/orgScope';
/* 💰 ชั้นสิทธิ์ที่ 3 แกน Cost Center (16/10 · คำสั่ง user "เซ็ตได้ว่า user ไหน response กับ cost center
   ไหน ตามลำดับชั้น") — ทะเบียนรหัส/ลำดับชั้น/ข้อความบล็อก อยู่ใน `utils/ccScope.js` ที่เดียว */
import { attachCc, ccCoverage, unknownRespCcs } from '../utils/ccScope';

import InfoMore from '../components/InfoMore';
import PageHeader from '../components/PageHeader';
import Page from '../components/Page';
import FilterBar from '../components/FilterBar';
import { identityDiff, identityFallbacks, syncPatch, dualMeaningInfo } from '../utils/identitySync';
/* 🪪 "บัญชีไหนยังไม่รู้ว่าเป็นใคร" + ตัวเสนอคนในทะเบียน — กฎอยู่ใน utils/identityMatch.js (pure · มีเทส)
   🔴 ระบบ**ไม่เดา**ประเภทบัญชีให้ · ไฟล์นั้นแค่จัดคิว + เสนอตัวเลือก คนกดตัดสิน */
import { unlinkedTriage, routeHint } from '../utils/identityMatch';
import SearchInput from '../components/SearchInput';
import { ALL } from '../utils/filterLabels';
/* ทีมช่างซ่อม (profiles.mtn_teams) — เดิมมีหน้าที่เดียวคือ "แยกคิวใบแจ้งซ่อม MO ให้ถูกทีม"
   🔴 ตั้งแต่ 2026-10-04 ช่องนี้ยังเป็นตัวบอก **"อยู่ฝั่งช่าง หรือ ฝั่งผู้แจ้ง"** ของด่านล็อกช่องเซ็น
      ขั้น 6/7/8 ด้วย (`actorSideOf()` ใน `utils/mtnStepPerm.js`)

   ⚠️ เดิมซ่อนช่องนี้จาก `admin`/`manager` ด้วยเหตุผล "เห็นคิวทุกทีมอยู่แล้ว ไม่ต้องผูกทีม" —
      พอมีด่านฝั่ง เหตุผลนั้นใช้ไม่ได้อีก: **ผจก.ช่าง (role=manager) ที่ไม่ได้ผูกทีม จะถูกตีเป็น
      "ฝั่งผู้แจ้ง" ตาม sections แล้วกดช่อง "ผจก.ช่าง อนุมัติ" ไม่ได้ และไม่มีที่ให้แก้ในแอปเลย**
      (ตรวจเจอจริง 05/10: ศักดา กาละศรี role=manager · sections=[PD1] · mtn_teams ว่าง → wrong_side)
   ⇒ เปิดช่องให้ `manager`/`admin` ด้วย · ไม่ติ๊ก = ฝั่งผู้แจ้งตามเดิม (ไม่เปลี่ยนพฤติกรรมของคนที่ไม่ใช่ช่าง)
   ยังซ่อนจาก role หน้างาน (operator ฯลฯ) — คนกลุ่มนั้นไม่มีช่องเซ็นฝั่งช่างให้กดอยู่แล้ว */
const MTN_TEAM_ROLES = ['mtn', 'engineer', 'leader', 'supervisor', 'manager', 'admin'];
const isMtnTeamRole = (r) => MTN_TEAM_ROLES.includes(r);

// ชื่อ/สี/คำอธิบายชุดสิทธิ์ อ่านจาก src/utils/roleMeta.js ที่เดียว (ห้ามนิยามซ้ำในหน้า)
// desc = "ลักษณะ/ขอบเขตอำนาจ" ของ role เท่านั้น — ห้ามพิมพ์รายชื่อโมดูล/หน้า
// เพราะหน้าเข้าได้จริงเป็น data-driven จาก role_permissions (แสดงอัตโนมัติผ่าน accessSummaryForRole)
const ROLES = ROLE_OPTIONS.map(r => ({ ...r, label: `${r.icon} ${r.label} (${r.en})` }));
// จัดกลุ่ม role ตามแกน (ระดับสิทธิ์ / หน่วยงาน / อุปกรณ์) — ทำให้เห็นชัดว่า role ไม่ใช่ "ตำแหน่งงาน"
//   เคสจริงที่เคยสับสน: "ส่วนวิศวกรรม" เป็นหน่วยงาน ไม่ใช่ตำแหน่งวิศวกร (วิศวกรแผนกช่างใช้ role ซ่อมบำรุง)
const ROLE_GROUPS = groupRolesByAxis(ROLES);
// <optgroup> ของ role — ใช้ซ้ำทุก dropdown ที่เลือก role ในหน้านี้
const RoleOptGroups = ({ withDesc = false }) => ROLE_GROUPS.map(g => (
  <optgroup key={g.axis} label={g.label}>
    {g.roles.map(r => <option key={r.value} value={r.value}>{r.label}{withDesc ? ` — ${r.desc}` : ''}</option>)}
  </optgroup>
));
// sections = ขอบเขตส่วนงาน (เลือกได้หลายอัน ทุก role) — ว่าง = เห็นทุกส่วนงาน
// profiles.section (เดี่ยว) ยังถูกเขียนเป็นตัวแรกของ sections เสมอ เพื่อให้ rollback โค้ดกลับเวอร์ชันเก่าได้โดย supervisor ไม่หลุด scope
const emptyForm = { email: '', password: '', fullName: '', role: 'supervisor', position: '', sections: [], respCcs: [], mtnTeams: [], deptAdmin: false, lineId: '', team: '', notifyEmail: '', scopeDepth: 'unit',
  // ⚠️ บัญชีของคน ต้องผูกกับตัวตนใน `employees` — ทีม/ไลน์/ส่วนงาน อ่านจากที่นั่น ห้ามให้ admin กรอกเอง
  //    (เคสจริง: หัวหน้า 2 คนทีมสลับกัน เพราะ admin เดาตอนสร้างบัญชี → เช็คชื่อมองไม่เห็นกะตัวเอง)
  // บัญชีของหน่วยงาน/อุปกรณ์ (maintenance/warehouse1/Display) ไม่มีตัวตนใน employees และไม่ควรมี
  accountKind: 'person', employeeId: '' };

// flag "แอดมินหน่วยงาน" โผล่เฉพาะ role หน่วยงานสนับสนุน (indirect) — ไม่ใช่ admin (ได้ทุกอย่างแล้ว)
// / display (ดูอย่างเดียว) · role ฝ่ายผลิต (supervisor/leader) ก็ให้ตั้งได้ (หัวหน้าส่วน/ไลน์ = แอดมินของหน่วยตัวเอง)
const DEPT_ADMIN_ELIGIBLE = (r) => r && r !== 'admin' && r !== 'display';

// คำอธิบายกะของแต่ละทีม (ดู CLAUDE.md "Shift Logic") — ทีมอื่นที่ไม่รู้จักแสดงชื่อเฉยๆ
const TEAM_DESC = {
  A: '(ทำงานสลับกะกับ TEAM B)',
  B: '(ทำงานสลับกะกับ TEAM A)',
  C: '(เข้ากะเช้าตลอด ไม่สลับกะ)',
};

// ตำแหน่งงานจริงในโรงงาน (แสดงตัวตน/รายงาน/ลายเซ็น) — คนละมิติกับ role ซึ่งเป็น "ชุดสิทธิ์ใช้ระบบ"
// master list กลางใช้ร่วมทุกหน้า (src/utils/positions.js) — ห้าม hardcode ซ้ำ · ตำแหน่งใหม่เพิ่มเข้าตาราง positions ผ่านปุ่มในฟอร์ม (2026-09-07)
// ตัวเลือกตำแหน่ง — อ่านสดจาก cache ของ master (loadPositions() เรียกตอน mount) · [{value:key,label:ไทย,level}]
const posOpts = () => positionOptions();

/* ค้นพนักงาน = ใช้ตัว normalize กลางของ picker (`normSearch` — ทนการสะกดไทย/ช่องว่าง/ขีด)
   ห้ามเขียนตัวเทียบเอง: ที่นี่เคยเทียบตรงๆ แล้วหาชื่อไม่เจอเพราะ ์ ตัวเดียว (23/09) */
const nzThai = normSearch;

export default function AddUser() {
  const [users,         setUsers]         = useState([]);
  const [lines,         setLines]         = useState([]);
  const [sectionOpts,   setSectionOpts]   = useState([]);
  const [teamOpts,      setTeamOpts]      = useState([]);
  const [fetchingUsers, setFetchingUsers] = useState(true);
  const [authErr, setAuthErr] = useState(null);   // 🔴 อ่านอีเมล login ไม่ได้ (admin-only) = ต้องเขียนบนจอ ห้ามโชว์ช่องว่าง
  const [showModal,     setShowModal]     = useState(false);
  const [modalMode,     setModalMode]     = useState('create');
  const [editingId,     setEditingId]     = useState(null);
  const [form,          setForm]          = useState(emptyForm);
  // ค้นหา/กรอง/เรียง — default เรียง "สร้างล่าสุดก่อน" (user ใหม่ขึ้นบนสุด หาเจอทันที)
  const [q,             setQ]             = useState('');
  const [filterRole,    setFilterRole]    = useState('');
  const [filterSection, setFilterSection] = useState('');
  const [sort,          setSort]          = useState({ key: 'created_at', dir: 'desc' });
  const [newPos,        setNewPos]        = useState(null);  // { key, label_th, level } = กำลังเพิ่มตำแหน่งใหม่เข้าทะเบียน positions (2026-09-07)
  const [newPosSaving,  setNewPosSaving]  = useState(false);
  const [loading,       setLoading]       = useState(false);
  const [message,       setMessage]       = useState(null);
  const [error,         setError]         = useState(null);
  const [resetPw,       setResetPw]       = useState(''); // ช่องตั้งรหัสใหม่ใน modal แก้ไข
  const [resetPwBusy,   setResetPwBusy]   = useState(false);

  const [emps, setEmps] = useState([]);      // ฐานพนักงาน — ใช้เป็นตัวตนของบัญชีแบบ 'person'
  const [empSearch, setEmpSearch] = useState('');
  const [posVer, setPosVer] = useState(0);   // bump เมื่อ master ตำแหน่งโหลดเสร็จ → dropdown/ป้ายระดับ re-render
  const [deptOpts, setDeptOpts] = useState([]);   // แผนกจากผังองค์กร — ใช้ตอนเพิ่มคนเข้าฐานพนักงาน
  const [orphanDeptOpts, setOrphanDeptOpts] = useState([]);   // แผนกขึ้นตรงฝ่าย = ขอบเขตได้เหมือน section
  const [orgNodes, setOrgNodes] = useState({ sections: [], depts: [] });   // node ดิบ — ใช้ cascade ส่วนงาน→แผนกจากหน้านี้
  /* ผังทั้งต้น (ทุก kind) — ใช้สร้างทะเบียน Cost Center ของช่อง ④
     null = ยังโหลด 🔴 ต้องแยกจาก [] ให้ได้ ไม่งั้น "รหัสที่ตั้งไว้" จะดูเป็น "ผังไม่รู้จัก" ตอนเปิดจอ */
  const [orgAllNodes, setOrgAllNodes] = useState(null);
  /* ➕ เพิ่มคนเข้าฐานพนักงานจากหน้านี้เลย (2026-09-21 · เฟส 1 ของ docs/IDENTITY-NOTIFY-DESIGN.md)
     เดิม: คนที่ไม่มีในทะเบียน (QA/PE/ธุรการ/สโตร์) หาไม่เจอใน dropdown → admin กดได้ทางเดียวคือ
     "บัญชีหน่วยงาน" ⇒ 32 บัญชีของคนจริงถูกติดป้ายผิด · null = ยังไม่ได้กดปุ่ม */
  const [newEmp, setNewEmp] = useState(null);
  const [newEmpSaving, setNewEmpSaving] = useState(false);
  const [ccSearch, setCcSearch] = useState('');   // คำค้นในทะเบียน Cost Center (49 รหัส — ยาวเกินกวาดตา)

  useEffect(() => {
    // master ตำแหน่งงาน (positions) — ต้องโหลดก่อน positionLabel()/levelOfPosition() ถึงได้ค่าจาก DB
    // + mtn_teams (ทีมช่างซ่อม) โหลดพร้อมกัน — checkbox ทีมอ่านผ่าน pmTeamsSync() หลังโหลดเสร็จ
    Promise.all([loadPositions(), loadPermissions(), loadPmTeams()]).then(() => setPosVer(v => v + 1));
    // ⚠️ <LineSelect> ต้องการ parent_line_name (ลำดับชั้น) + section (กรอง scope) + is_active
    //    select แค่ id,name = ได้ลิสต์แบนไม่มีลำดับชั้น (กับดักที่เขียนไว้ในหัว LineSelect.jsx)
    loadLinesRes()
      .then(({ data }) => setLines(data || []));
    /* ⚠️ ต้อง select `parent_id` ด้วย — `orphanDepts()` ตัดสิน "แผนกขึ้นตรงฝ่าย" จาก `!parent_id`
       ไม่ดึงคอลัมน์มา = undefined ทุกแถว ⇒ **ทุกแผนกกลายเป็นขึ้นตรงฝ่ายหมด** (เกิดจริง 22/09:
       GOR · LWRBAR · BIG PRESS · HYDROFORM ติดป้าย 🏛️ ทั้งที่อยู่ใต้ส่วนงานผลิต) */
    /* ⚠️ ต้องมี `cost_center` + `ref_line_id` ด้วย — ช่อง ④ (CC ที่รับผิดชอบ) และ `buildOrgScope()`
       ใช้ 2 คอลัมน์นี้ผูกรหัส ↔ หน่วยงาน ↔ ไลน์ · ขาด = ทะเบียนรหัสว่างเปล่าแบบเงียบ */
    supabase.from('org_nodes').select('code, name, kind, parent_id, id, sort_order, cost_center, ref_line_id, division').eq('is_active', true)
      .then(({ data }) => {
        const nodes = [...(data || [])].sort(orgNodeCompare);   // ลำดับผังมาตรฐาน (listOrder.js)
        setSectionOpts(nodes.filter(n => n.kind === 'section').map(n => n.code || n.name));
        setTeamOpts([...new Set(nodes.filter(n => n.kind === 'team').map(n => n.code || n.name))]);
        setDeptOpts([...new Set(nodes.filter(n => n.kind === 'department').map(n => n.code || n.name))]);
        /* 🔴 ขอบเขตต้องเลือก "แผนกขึ้นตรงฝ่าย" ได้ด้วย (2026-09-21 · feedback "ทำไม section ไม่ขึ้น")
           ผังองค์กรมี section แค่ PD1-4 / Planning&Store / TEST · หน่วยงานสนับสนุน (QA · MTN ·
           JIG MTN · DIE MTN) เป็น department ที่ `parent_id is null` = ขึ้นตรงฝ่าย ไม่มี section
           ⇒ เดิมช่องติ๊กมีแต่ section ⇒ บัญชีที่ scope = 'JIG MTN' (6 ใบ) / 'QA' (6 ใบ)
             **เปิดโมดัลมาแล้วไม่มีอะไรติ๊ก** ทั้งที่ตั้งไว้แล้ว = อ่านหน้าจอแล้วเข้าใจผิดว่ายังไม่ได้ตั้ง */
        setOrphanDeptOpts(orphanDepts(nodes.filter(n => n.kind === 'department')).map(n => n.code || n.name));
        setOrgNodes({ sections: nodes.filter(n => n.kind === 'section'), depts: nodes.filter(n => n.kind === 'department') });
        setOrgAllNodes(nodes);
      });
    supabase.from('employees')
      .select('id, employee_id_code, name, team, line_id, section, department, position, staff_kind, org_node_id')
      .eq('is_active', true).order('name')
      .then(({ data }) => setEmps(data || []));
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setFetchingUsers(true);
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, role, position, line_id, section, sections, resp_cost_centers, team, notify_email, employee_id, account_kind, scope_depth, scope_depth_src, org_node_id');   // 🪪 org_node_id ต้องมา ไม่งั้น identityDiff() เทียบช่องนั้นไม่ได้แล้วเงียบ
    /* 🔴 get_auth_users() เป็น admin-only ฝั่ง DB (raise 'forbidden: admin only')
       ⇒ คนที่ /permissions ให้สิทธิ์เข้าหน้านี้แต่ไม่ใช่ role admin จะได้ลิสต์ที่ **ไม่มีอีเมลเลย**
       เดิมกลืน error ⇒ จอโกหกว่า "บัญชีพวกนี้ไม่มีอีเมล" · ต้องเขียนบนจอ (QC audit 08/10) */
    const { data: authUsers, error: eAuth } = await supabase.rpc('get_auth_users');
    setAuthErr(eAuth ? eAuth.message : null);

    const authMap = {};
    (authUsers || []).forEach(u => { authMap[u.id] = u; });

    // mtn_teams best-effort แยก query — คอลัมน์เพิ่งเพิ่ม (migration 20260722) ยังไม่ apply ก็ไม่พังลิสต์หลัก
    const mtnMap = {};
    const { data: mtnRows, error: mtnErr } = await supabase.from('profiles').select('id, mtn_teams');
    if (!mtnErr) (mtnRows || []).forEach(r => { mtnMap[r.id] = Array.isArray(r.mtn_teams) ? r.mtn_teams : []; });
    // is_dept_admin best-effort แยก query — คอลัมน์เพิ่งเพิ่ม (migration 20260803)
    const daMap = {};
    const { data: daRows, error: daErr } = await supabase.from('profiles').select('id, is_dept_admin');
    if (!daErr) (daRows || []).forEach(r => { daMap[r.id] = r.is_dept_admin === true; });

    setUsers((profiles || []).map(p => ({
      ...p,
      mtn_teams: mtnMap[p.id] || [],
      is_dept_admin: daMap[p.id] || false,
      email: authMap[p.id]?.email || '—',
      created_at: authMap[p.id]?.created_at || null,
    })));
    setFetchingUsers(false);
  };

  const setF = (key, val) => setForm(f => ({ ...f, [key]: val }));

  /* 💰 ดัชนีขอบเขต + ทะเบียน Cost Center — สร้างจากผัง/ไลน์ที่หน้านี้โหลดอยู่แล้ว **ไม่ยิงคิวรีเพิ่ม**
     ใช้ก้อนรวม `attachCc()` เพื่อกันการสลับดัชนี 2 ตัว (เหตุผลอยู่หัว `utils/ccScope.js`) */
  const ccReady = orgAllNodes !== null;
  const scopeIdx = useMemo(
    () => attachCc(buildOrgScope({ nodes: orgAllNodes || [], lines }), orgAllNodes || []),
    [orgAllNodes, lines],
  );
  /* เรียงแบบต้นไม้ (แม่ก่อนลูก) — ลำดับในแต่ละชั้นมาจาก sort_order ที่ /org-setup เพราะ `nodes`
     ถูก `.sort(orgNodeCompare)` ไว้ตอนโหลดแล้ว */
  const ccRows = useMemo(() => scopeIdx.cc.catalogTree(), [scopeIdx]);
  const ccCov = useMemo(() => ccCoverage(scopeIdx, form.respCcs), [scopeIdx, form.respCcs]);
  /* รหัสที่ตั้งไว้แต่ผังไม่รู้จัก — เช็คได้เฉพาะเมื่อผังโหลดเสร็จ (ว่าง = ทะเบียนว่าง = ตะโกนผิด) */
  const ccUnknown = ccReady ? unknownRespCcs(scopeIdx, form.respCcs) : [];
  /* CC ที่ "ระบบอ่านได้เอง" จากพนักงานที่ผูกไว้ — ช่วยคนตั้งค่าไม่ต้องเดารหัส */
  const ccFromEmp = useMemo(() => {
    const emp = emps.find(e => String(e.id) === String(form.employeeId));
    if (!emp?.org_node_id) return null;
    const r = scopeIdx.cc.ccOfNode(emp.org_node_id);
    return r.cc ? { cc: r.cc, from: r.from?.name || r.from?.code || '', inherited: r.inherited } : null;
  }, [emps, form.employeeId, scopeIdx]);
  const toggleCc = (cc) => setF('respCcs', form.respCcs.includes(cc)
    ? form.respCcs.filter(x => x !== cc) : [...form.respCcs, cc]);

  /* + เพิ่มตำแหน่งใหม่ → insert positions (Main) ก่อน แล้วเลือกให้ — แทนช่อง "อื่นๆ (พิมพ์เอง)" เดิม (2026-09-07)
     ค่าที่พิมพ์เองไม่มีใน master → levelOfPosition() คืน null = คำเตือน AM/PM ไม่ทำงานเงียบๆ (Register.jsx ไม่มีช่องหนีอยู่แล้ว) */
  const addPosition = async () => {
    const key = String(newPos?.key || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    const label = String(newPos?.label_th || '').trim();
    if (!key || !label) { setError('เพิ่มตำแหน่ง: กรอก key (a-z / ตัวเลข / _) และชื่อตำแหน่งภาษาไทย'); return; }
    if (!newPos?.level) { setError('เพิ่มตำแหน่ง: เลือกระดับงานของตำแหน่งนี้'); return; }
    if (posOpts().some(p => p.value === key)) { setF('position', key); setNewPos(null); return; }   // มีอยู่แล้ว = เลือกให้เลย
    setNewPosSaving(true);
    const ok = checkWrite(await supabase.from('positions').insert({ key, label_th: label, level: newPos.level, sort_order: 100 + posOpts().length }), 'เพิ่มตำแหน่ง');
    setNewPosSaving(false);
    if (!ok) return;
    clearPositionsCache();
    await loadPositions();       // ให้ positionLabel()/levelOfPosition() เห็นแถวใหม่ทันที
    setPosVer(v => v + 1);
    setError(null);
    setF('position', key);
    setNewPos(null);
  };
  /* ➕ เพิ่มคนนี้เข้าฐานพนักงาน แล้วผูกกับบัญชีทันที (เฟส 1 · 2026-09-21)
     ⚠️ สายสนับสนุน (QA/PE/ธุรการ/สโตร์) = `staff_kind: 'support'` + ไม่ต้องมีไลน์/ทีม
        → ไม่โผล่ในเช็คชื่อ/สกิล/กำลังคน (ตัวกรองอยู่ที่ src/utils/staffKind.js)
     ⚠️ `employee_id_code` เป็น not null — คนสายสนับสนุนที่ยังไม่มีรหัสจริงให้ออกรหัสชั่วคราวไปก่อน
        (แก้ทีหลังได้ที่ /operator) ห้ามปล่อยว่างเพราะ insert จะล้มเงียบๆ */
  const addEmployee = async () => {
    const name = String(newEmp?.name || '').trim();
    const code = String(newEmp?.employee_id_code || '').trim();
    if (!name) { setError('เพิ่มพนักงาน: กรอกชื่อ-นามสกุล'); return; }
    if (!code) { setError('เพิ่มพนักงาน: กรอกรหัสพนักงาน (ยังไม่มีรหัสจริงให้ใส่รหัสชั่วคราวไปก่อน)'); return; }
    /* รหัสซ้ำ = ระบบรู้อยู่แล้วว่าเป็นใคร ⇒ **ผูกให้เลย** ไม่ใช่บอกว่า "ซ้ำ" แล้วปล่อยคนงง
       (เกิดจริง 23/09: ค้นชื่อไม่เจอเพราะสะกดต่าง 1 ตัว → กดเพิ่ม → เจอ "รหัสซ้ำ" → ตัน) */
    const dup = emps.find(e => (e.employee_id_code || '').trim().toLowerCase() === code.toLowerCase());
    if (dup) {
      setForm(f => ({ ...f, employeeId: dup.id, fullName: dup.name || f.fullName }));
      setNewEmp(null);
      setError(null);
      setMessage(`รหัส ${code} มีอยู่แล้วในฐานพนักงาน — ผูกบัญชีนี้กับ "${dup.name}" ให้แล้ว (ตรวจชื่อให้ตรงก่อนบันทึก)`);
      return;
    }
    setNewEmpSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const row = {
      employee_id_code: code,
      name,
      department: newEmp.department || null,
      section: sectionValueForSave(newEmp.section),   // sentinel "ขึ้นตรงฝ่าย" → null (ตรงกับผังจริง)
      /* 🧭 แกนสังกัด — คนใหม่ต้องผูกโหนดในผังตั้งแต่แรก ไม่ต้องรอ backfill มาเดาทีหลัง
         (docs/ORG-AXES-DECISION.md §5.1 · ข้อความ section/department ข้างบน = สำเนาไว้โชว์) */
      org_node_id: orgNodeIdFor(newEmp.section, newEmp.department, orgNodes.sections, orgNodes.depts),
      org_node_src: ORG_SRC_MANUAL,
      staff_kind: newEmp.staff_kind || STAFF_SHOPFLOOR,
      position: form.position || null,
      created_by: userData?.user?.id || null,
    };
    const res = await supabase.from('employees').insert(row).select('id, employee_id_code, name, team, line_id, section, department, position').single();
    setNewEmpSaving(false);
    if (!checkWrite(res, 'เพิ่มพนักงานเข้าฐาน')) return;
    const created = res.data;
    setEmps(prev => [...prev, created].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'th')));
    setForm(f => ({ ...f, employeeId: created.id, fullName: created.name || f.fullName }));
    setNewEmp(null);
    setError(null);
    setMessage(`เพิ่ม "${created.name}" เข้าฐานพนักงานแล้ว และผูกกับบัญชีนี้ให้เรียบร้อย`);
  };

  const empById = useMemo(() => Object.fromEntries(emps.map(e => [e.id, e])), [emps]);
  /* 🩺 แถบ "งานค้างของทะเบียนบัญชี" — feedback user 19/10: *"กว่าจะเจอหน้าจอหลัก พวกแจ้งเตือนเต็มไปหมด"*
     5 แผงเดิมกางค้างไว้ทั้งหมด (29+6+15+1+10 รายการ) ⇒ ต้องเลื่อนยาวกว่าจะถึงตารางผู้ใช้
     🔴 **พับได้ แต่ห้ามหาย** — จำนวนทุกกองยังอยู่บนจอเป็นชิปเสมอ กดชิปแล้วกางกองนั้นตรงนั้น
        (กฎความซื่อสัตย์ของจอ: ข้อมูลไม่ครบ/มีงานค้าง ต้องเห็น ห้ามซ่อนเงียบ) */
  const [openWl, setOpenWl] = useState(null);   // คีย์กองที่กางอยู่ · null = พับหมด
  const wlCounts = useMemo(() => ({
    mismatch: users.filter(u => identityDiff(u, u.employee_id ? empById[u.employee_id] : null).length).length,
    fallback: users.filter(u => identityFallbacks(u, u.employee_id ? empById[u.employee_id] : null).length).length,
    dual:     users.filter(u => dualMeaningInfo(u, u.employee_id ? empById[u.employee_id] : null).length).length,
    unknown:  unlinkedTriage(users, emps).queue.length,
    ghost:    users.filter(scopeIneffective).length,
    review:   users.filter(needsScopeReview).length,
  }), [users, emps, empById]);
  /* ผลค้นพนักงาน — ถ้าคำค้นไม่ตรงใคร **ห้ามคืนลิสต์ว่าง** (ลิสต์ว่าง = คนอ่านสรุปว่า "ไม่มีคนนี้"
     แล้วไปสร้างซ้ำ — เกิดจริง 23/09) · คืนทุกคนแทน แล้วขึ้นป้ายบอกว่าไม่พบคำค้น */
  const empMatches = useMemo(() => {
    const q = nzThai(empSearch);
    if (!q) return emps;
    const hit = emps.filter(e => nzThai(e.name).includes(q) || nzThai(e.employee_id_code).includes(q));
    return hit.length ? hit : emps;
  }, [emps, empSearch]);
  const empSearchMissed = !!nzThai(empSearch) && !emps.some(e =>
    nzThai(e.name).includes(nzThai(empSearch)) || nzThai(e.employee_id_code).includes(nzThai(empSearch)));
  const lineName = (id) => lines.find(l => String(l.id) === String(id))?.name || '';
  /* 🪪 ค่าดิบในแถบ "ไม่ตรงกัน" ต้องอ่านออก — uuid ของผัง/คีย์ตำแหน่ง คนอ่านไม่รู้เรื่อง
     ไม่รู้จัก id = โชว์ค่าดิบไว้ ห้ามโชว์ "—" (คนจะนึกว่าว่าง ทั้งที่มีค่าแต่ชี้ไปที่ที่ลบไปแล้ว) */
  const idText = (key, v) => {
    if (v === null || v === undefined || v === '') return '—';
    if (key === 'line_id') return lineName(v) || `(ไลน์ id ${v})`;
    if (key === 'position') return positionLabel(v) || String(v);
    if (key === 'org_node_id') {
      const n = [...(orgNodes.sections || []), ...(orgNodes.depts || [])].find(x => String(x.id) === String(v));
      return n ? (n.code || n.name) : `(หน่วย id ${String(v).slice(0, 8)}…)`;
    }
    return String(v);
  };
  /** ดึงตัวตนจากฐานพนักงานมาทับบัญชี — **เฉพาะช่องที่ต้องตรงกันจริง** (ทีม/ไลน์/ส่วนงาน)
   *  🔴 `position` / `org_node_id` ไม่อยู่ใน `IDENTITY_FIELDS` แล้ว (13/10 · คำสั่ง user)
   *     2 ฝั่งตอบคนละคำถาม — ตำแหน่งตามบริษัท vs ตำแหน่งที่ปฏิบัติงาน ⇒ **ทับ = ข้อมูลหาย** */
  const syncFromEmployee = async (u) => {
    const e = empById[u.employee_id];
    if (!e) return;
    /* 🔴 ค่าที่เขียนมาจาก `syncPatch()` ที่เดียว — **ช่องที่ฐานพนักงานว่าง ต้องไม่ถูกแตะ** (14/10)
       สูตรจริงคือ `emp.<f> ?? profile.<f>` ⇒ ช่องที่ฐานพนักงานว่าง ระบบใช้ค่าในบัญชีอยู่
       เขียน null ทับ = ค่าที่ใช้งานอยู่หายถาวร (ไม่มี audit ของ UPDATE) */
    const { data, error } = await supabase.from('profiles')
      .update(syncPatch(e))
      .eq('id', u.id).select('id');
    // RLS ปฏิเสธ update = 0 แถว ไม่ error → ต้องนับแถว ห้ามขึ้นว่าสำเร็จลอยๆ
    // ⚠️ ปุ่มนี้อยู่บนตาราง (modal ปิดอยู่) — setError แสดงเฉพาะใน modal ⇒ ต้องเป็น toast ไม่งั้นล้มเงียบ (QC 05/10)
    if (error || !data?.length) { toast.error('อัปเดตไม่สำเร็จ: ' + (error?.message || 'ไม่มีสิทธิ์แก้บัญชีนี้')); return; }
    setMessage(`อัปเดต "${u.full_name}" ให้ตรงกับฐานพนักงานแล้ว`);
    fetchUsers();
  };

  /* 🔴 ขั้นย่อยหลังสร้าง/แก้บัญชี (QC 05/10) — **คืนข้อความ error (หรือ null) ให้ผู้เรียกรวบ** ห้าม setError เอง
     เดิม setError แล้วผู้เรียก setShowModal(false) + ข้อความเขียว "สำเร็จ" ⇒ error อยู่ใน modal ที่ปิดไปแล้ว = มองไม่เห็น
     ⇒ admin เข้าใจว่าผูกพนักงาน/ตั้งขอบเขต/แอดมินหน่วยงานแล้ว ทั้งที่ไม่ได้ตั้ง
     นับแถวด้วย — RLS ปฏิเสธ UPDATE = 0 แถว ไม่ error (กฎเขียน DB ข้อ 2) */
  const subStepErr = (label, { data, error }) => {
    if (error) return `${label}: ${error.message}`;
    if (!data?.length) return `${label}: ไม่มีแถวถูกแก้ (ไม่มีสิทธิ์?)`;
    return null;
  };
  // เขียน mtn_teams แยก (คอลัมน์เพิ่ม 20260722 · create-user edge ยังไม่รู้จัก field นี้)
  //   role ที่ไม่เกี่ยวงานซ่อม → เคลียร์เป็น null · 42703 (ยังไม่ apply migration) = ข้ามได้ ไม่ใช่ความล้มเหลว
  const saveMtnTeams = async (id) => {
    if (!id) return null;
    const val = isMtnTeamRole(form.role) && form.mtnTeams.length ? form.mtnTeams : null;
    const res = await supabase.from('profiles').update({ mtn_teams: val }).eq('id', id).select('id');
    if (res.error?.code === '42703') return null;
    return subStepErr('ทีมช่างซ่อม', res);
  };

  // เขียน employee_id / account_kind แยก best-effort (create-user edge ยังไม่รู้จัก field พวกนี้)
  //   บัญชีหน่วยงาน = ไม่ผูกพนักงาน (employee_id null) โดยตั้งใจ
  const saveEmpLink = async (id) => {
    if (!id) return;
    const kind = form.accountKind || null;
    const eid  = kind === 'person' ? (form.employeeId || null) : null;
    const res = await supabase.from('profiles')
      .update({ employee_id: eid, account_kind: kind }).eq('id', id).select('id');
    // ⚠️ ห้ามเงียบ — ยังไม่ apply migration แล้วบอกว่าสำเร็จ = คนเข้าใจผิดว่าผูกแล้ว
    return subStepErr('ผูกกับพนักงาน', res);
  };

  /* 🔭 ความกว้างของขอบเขต — เขียนตามหลังตอน "สร้างบัญชีใหม่"
     (edge function create-user ยังไม่รู้จักคอลัมน์นี้ ⇒ แถวใหม่จะได้ default `unit` ของคอลัมน์ไปก่อน
      ซึ่ง**แคบ** = ปลอดภัยตาม deny-by-default · แล้วค่อยอัพเป็นค่าที่ admin เลือก)
     ⚠️ ห้ามเงียบเมื่อล้ม — บอกว่าสร้างสำเร็จทั้งที่ขอบเขตไม่ได้ตั้ง = คนเข้าใจผิดว่าคุมแล้ว */
  const saveScopeDepth = async (id) => {
    if (!id) return null;
    const res = await supabase.from('profiles')
      .update({ scope_depth: form.scopeDepth || 'unit', scope_depth_src: 'manual' })
      .eq('id', id).select('id');
    return subStepErr('ขอบเขตการมองเห็น', res);
  };

  /* 💰 Cost Center ที่รับผิดชอบ (ชั้นสิทธิ์ที่ 3 แกน CC · migration 20261016) — เขียนแยกทั้ง "สร้าง"
     และ "แก้" โดยตั้งใจ: edge function `create-user` ยังไม่รู้จักคอลัมน์นี้ และถ้าเอาไปใส่ก้อน
     update หลัก แล้วคอลัมน์ยังไม่ apply (42703) จะพาการแก้บัญชี**ทั้งก้อน**ล้มไปด้วย
     🔴 ว่าง = ถอยไปใช้ `profiles.section` เหมือนเดิม (ไม่ใช่ "แก้อะไรไม่ได้") — ดู `respScopesOf()` */
  const saveRespCcs = async (id) => {
    if (!id) return null;
    const res = await supabase.from('profiles')
      .update({ resp_cost_centers: form.respCcs || [] }).eq('id', id).select('id');
    if (res.error?.code === '42703') return 'Cost Center ที่รับผิดชอบ: ยังไม่ได้ apply migration 20261016';
    return subStepErr('Cost Center ที่รับผิดชอบ', res);
  };

  // เขียน is_dept_admin แยก best-effort (คอลัมน์เพิ่งเพิ่ม 20260803 · create-user edge ยังไม่รู้จัก field นี้)
  //   role ที่ไม่เข้าเกณฑ์ (admin/display) → false เสมอ · error (ยังไม่ apply migration) = เงียบ
  const saveDeptAdmin = async (id) => {
    if (!id) return null;
    const val = DEPT_ADMIN_ELIGIBLE(form.role) ? !!form.deptAdmin : false;
    // supabase-js ไม่ throw — try/catch เดิมไม่มีวันจับ · migration 20260803 apply แล้ว ไม่มีเหตุให้เงียบอีก
    const res = await supabase.from('profiles').update({ is_dept_admin: val }).eq('id', id).select('id');
    return subStepErr('แอดมินหน่วยงาน', res);
  };
  /* ── 🪪 คิว "บัญชีที่ยังไม่รู้ว่าเป็นใคร" — ปุ่มลัด 2 ทางจากในแถบ worklist (19/10) ────────
     ทางที่ 3 (ยังไม่มีชื่อในทะเบียนพนักงาน) ใช้ปุ่ม "แก้ไข" เปิดโมดัลเดิมที่มีปุ่มเพิ่มคนเข้าฐานอยู่แล้ว
     🔴 ทั้ง 2 ปุ่มนับแถวที่เขียนจริง — RLS ปฏิเสธ UPDATE = "สำเร็จ 0 แถว ไม่มี error" (กฎเหล็ก DB ข้อ 2) */
  const [triBusy, setTriBusy] = useState(null);   // id ที่กำลังเขียน (กันกดซ้ำ)
  const linkEmployee = async (u, emp) => {
    if (!u?.id || !emp?.id) return;
    setTriBusy(u.id);
    const ok = checkWriteRows(await supabase.from('profiles')
      .update({ employee_id: emp.id, account_kind: 'person' })
      .eq('id', u.id).select('id'), 'ผูกบัญชีกับพนักงาน');
    setTriBusy(null);
    if (!ok) return;
    toast.success(`ผูก "${u.full_name || u.email}" กับ ${emp.name} แล้ว — ทีม/ไลน์/ส่วนงานจะอ่านจากฐานพนักงานต่อไป`);
    fetchUsers();
  };
  /** ติดป้าย "บัญชีกลาง" — ใช้ได้เฉพาะใบที่**ยังไม่ผูกตัวตน** (ผูกแล้วแปลว่าเป็นคน ต้องไปแก้ในโมดัล) */
  const markShared = async (u) => {
    if (!u?.id || u.employee_id) return;
    if (!window.confirm(`ตั้ง "${u.full_name || u.email}" เป็นบัญชีกลาง (จอ TV / ประจำเครื่อง) ?\n`
      + 'บัญชีกลางไม่ผูกตัวตนพนักงาน และจะไม่ขึ้นในคิวนี้อีก')) return;
    setTriBusy(u.id);
    const ok = checkWriteRows(await supabase.from('profiles')
      .update({ account_kind: 'shared' }).eq('id', u.id).select('id'), 'ตั้งเป็นบัญชีกลาง');
    setTriBusy(null);
    if (!ok) return;
    toast.success('ตั้งเป็นบัญชีกลางแล้ว');
    fetchUsers();
  };

  /** ผลรวมขั้นย่อย → ข้อความเขียวเฉพาะเมื่อครบทุกขั้น · ขาดขั้นไหน = toast แดงบอกรายขั้น (modal ปิดแล้วก็ยังเห็น) */
  const reportSubSteps = (okMsg, errs) => {
    const bad = errs.filter(Boolean);
    if (!bad.length) { setMessage(okMsg); return; }
    setMessage(null);
    toast.error(`${okMsg.replace('สำเร็จ', '')}แล้ว แต่บางส่วนตั้งไม่สำเร็จ — ${bad.join(' · ')} (เปิดแก้บัญชีนี้แล้วบันทึกซ้ำ)`);
  };

  // ป้องกันบั๊ก fail-open: ถ้า supervisor/leader ไม่มี section/line_id ทุกหน้าที่กรองข้อมูลตาม
  // section/line_id จะข้าม condition แล้วโชว์ข้อมูลทุกไลน์ทุกแผนกเหมือน admin โดยไม่มีอะไรเตือน
  /* 🔴 บัญชีของคนต้องมีตัวตนเสมอ (2026-09-23 · เกิดจริง: บัญชี jennipha ถูกบันทึกโดย
     `account_kind='person'` แต่ `employee_id` และ `full_name` เป็น null ทั้งคู่
     ⇒ ลิสต์ผู้ใช้ขึ้น "ไม่ระบุชื่อ" · ทุกจอที่โชว์ชื่อผู้ทำ/ผู้อนุมัติได้ค่าว่างตามไปด้วย)
     เดิมช่องพนักงานมีดอกจัน * แต่ไม่มีตัวตรวจจริง — ชื่อที่พิมพ์ในช่องค้นไม่ได้ถูกบันทึกที่ไหนเลย */
  const validateIdentity = () => {
    if (form.accountKind === 'person' && !form.employeeId)
      return 'บัญชีของคนต้องผูกกับพนักงานในฐานข้อมูล — ถ้ายังไม่มีชื่อเขาในฐาน ให้กดปุ่ม '
           + '"＋ ไม่มีชื่อในฐานพนักงาน — เพิ่มคนนี้เข้าฐาน" (ชื่อที่พิมพ์ในช่องค้นยังไม่ถูกบันทึก) '
           + '· ถ้านี่เป็นจอ TV หรือบัญชีประจำเครื่อง ให้เลือกประเภท "บัญชีกลาง (ไม่ใช่คน)" แทน';
    if (!form.accountKind)
      return 'เลือกประเภทบัญชีก่อน — บัญชีของคน (ต้องผูกตัวตน) หรือบัญชีกลาง (จอ TV / ประจำเครื่อง)';
    return null;
  };

  const validateScope = () => {
    if (form.role === 'supervisor' && !form.sections.length) return 'ชุดสิทธิ์ระดับส่วน ต้องกำหนด Section อย่างน้อย 1 ส่วนงาน ไม่งั้นจะเห็นข้อมูลทุกส่วนงานแบบไม่จำกัด';
    if (form.role === 'leader' && (!form.lineId || !form.team)) return 'ชุดสิทธิ์ระดับไลน์ ต้องกำหนดทั้งไลน์ผลิตและ Team ไม่งั้นจะเห็นข้อมูลทุกไลน์แบบไม่จำกัด';
    return null;
  };

  const openCreate = () => {
    setForm(emptyForm);
    setNewPos(null);
    setEditingId(null);
    setModalMode('create');
    setMessage(null);
    setError(null);
    setResetPw('');
    setShowModal(true);
  };

  const openEdit = (u) => {
    setForm({
      email:       u.email,
      password:    '',
      fullName:    u.full_name    || '',
      role:        u.role         || 'supervisor',
      position:    u.position     || '',
      sections:    (u.sections?.length ? u.sections : (u.section ? [u.section] : [])),
      respCcs:     Array.isArray(u.resp_cost_centers) ? u.resp_cost_centers : [],
      scopeDepth:  u.scope_depth || 'unit',
      mtnTeams:    Array.isArray(u.mtn_teams) ? u.mtn_teams : [],
      deptAdmin:   u.is_dept_admin === true,
      lineId:      u.line_id      ? String(u.line_id) : '',
      team:        u.team         || '',
      notifyEmail: u.notify_email || '',
      accountKind: u.account_kind || (u.employee_id ? 'person' : ''),
      employeeId:  u.employee_id  || '',
    });
    setNewPos(null);   // ตำแหน่งนอก master ของ user เก่ายังโชว์ใน select พร้อมป้าย ⚠ (positionOptionsWith) — ไม่ต้องเปิดช่องพิมพ์เอง
    setEditingId(u.id);
    setModalMode('edit');
    setMessage(null);
    setError(null);
    setResetPw('');
    setShowModal(true);
  };

  const handleCreate = async () => {
    if (!form.email || !form.password) return setError('กรุณากรอก Email และรหัสผ่าน');
    const idErr = validateIdentity();
    if (idErr) return setError(idErr);
    const scopeErr = validateScope();
    if (scopeErr) return setError(scopeErr);
    setLoading(true);
    setMessage(null);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-user`,
        {
          method: 'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${session.access_token}`,
            'apikey':        import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            email:        form.email,
            password:     form.password,
            role:         form.role,
            full_name:    form.fullName || null,
            position:     form.position || null,
            section:      form.sections[0] || null,
            sections:     form.sections,
            team:         form.team || null,
            line_id:      form.lineId ? Number(form.lineId) : null,
            notify_email: form.notifyEmail || null,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');
      // create-user v14 เขียนโปรไฟล์ครบทุก field ในจังหวะเดียวแล้ว (ไม่มีจังหวะสองให้พลาด)
      // mtn_teams เขียนตามหลัง best-effort (edge ยังไม่รู้จัก field นี้)
      const subErrs = [
        await saveMtnTeams(data.user?.id),
        await saveDeptAdmin(data.user?.id),
        await saveEmpLink(data.user?.id),
        await saveScopeDepth(data.user?.id),
        await saveRespCcs(data.user?.id),
      ];
      reportSubSteps(`สร้าง user "${form.email}" (${form.role}) สำเร็จ`, subErrs);
      setShowModal(false);
      fetchUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // admin ตั้งรหัสผ่านใหม่ให้ user (ลืมรหัส/login ไม่ได้) — ผ่าน Edge Function reset-user-password
  // (admin-only ฝั่ง server + ห้ามใช้กับบัญชี admin — เจ้าตัวเปลี่ยนเองผ่านเมนูเปลี่ยนรหัสผ่าน)
  const handleResetPassword = async () => {
    const who = form.fullName || form.email;
    if (resetPw.length < 6) return setError('รหัสผ่านใหม่ต้องยาวอย่างน้อย 6 ตัวอักษร');
    if (!window.confirm(`ตั้งรหัสผ่านใหม่ให้ "${who}" ?\n\nรหัสเดิมจะใช้ไม่ได้ทันที — อย่าลืมแจ้งรหัสใหม่ให้เจ้าตัว`)) return;
    setResetPwBusy(true); setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/reset-user-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ user_id: editingId, new_password: resetPw }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'รีเซ็ตรหัสผ่านไม่สำเร็จ');
      setResetPw('');
      setMessage(`ตั้งรหัสผ่านใหม่ให้ "${who}" แล้ว — แจ้งรหัสใหม่ให้เจ้าตัวด้วย`);
      setShowModal(false);
    } catch (err) { setError(err.message); }
    finally { setResetPwBusy(false); }
  };

  const handleDelete = async () => {
    const who = form.fullName || form.email;
    if (!window.confirm(`ลบผู้ใช้ "${who}" ถาวร?\n\nบัญชี login และสิทธิ์ทั้งหมดจะถูกลบ กู้คืนไม่ได้`)) return;
    setLoading(true); setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ user_id: editingId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'ลบไม่สำเร็จ');
      setMessage(`ลบผู้ใช้ "${who}" แล้ว`);
      setShowModal(false);
      fetchUsers();
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const handleUpdate = async () => {
    const idErr = validateIdentity();
    if (idErr) return setError(idErr);
    const scopeErr = validateScope();
    if (scopeErr) return setError(scopeErr);
    setLoading(true);
    setMessage(null);
    setError(null);
    try {
      const { data: updRows, error: err } = await supabase.from('profiles').update({
        full_name:    form.fullName    || null,
        role:         form.role,
        position:     form.position    || null,
        section:      form.sections[0] || null,
        sections:     form.sections.length ? form.sections : null,
        /* 🔭 ความกว้างที่ "คนเลือกเอง" — ต่างจาก legacy_open ที่ได้ all มาจากการเว้นว่าง
           (docs/ACCESS-CONTROL-STANDARDS.md §2 · ขอบเขตตัดสิทธิ์ให้แคบลงเท่านั้น ห้ามขยาย) */
        scope_depth:     form.scopeDepth || 'unit',
        scope_depth_src: 'manual',
        team:         form.team        || null,
        line_id:      form.lineId      ? Number(form.lineId) : null,
        notify_email: form.notifyEmail || null,
      }).eq('id', editingId).select('id');
      if (err) throw err;
      // RLS ปฏิเสธ = 0 แถว ไม่ error — ห้ามขึ้นเขียว (modal ยังเปิด ⇒ setError ผ่าน catch เห็นได้)
      if (!updRows?.length) throw new Error('บันทึกไม่สำเร็จ — ไม่มีสิทธิ์แก้บัญชีนี้ หรือบัญชีถูกลบไปแล้ว');
      const subErrs = [
        await saveMtnTeams(editingId),   // แยกเขียน กัน edit พังถ้ายังไม่ apply migration
        await saveDeptAdmin(editingId),  // (migration 20260803)
        await saveEmpLink(editingId),    // (migration 20260821)
        await saveRespCcs(editingId),    // (migration 20261016)
      ];
      reportSubSteps('อัปเดตข้อมูลผู้ใช้สำเร็จ', subErrs);
      setShowModal(false);
      fetchUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const norm = (v) => (v || '').toString().trim().toLowerCase();
  const toggleSort = (key) => setSort(prev => prev.key === key
    ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: key === 'created_at' ? 'desc' : 'asc' });

  const view = (() => {
    const kw = norm(q);
    let rows = users.filter(u => {
      if (filterRole && u.role !== filterRole) return false;
      if (filterSection) {
        const secs = u.sections?.length ? u.sections : (u.section ? [u.section] : []);
        if (!secs.includes(filterSection)) return false;
      }
      if (!kw) return true;
      return [u.full_name, u.email, u.position, u.section, ...(u.sections || [])].some(v => norm(v).includes(kw));
    });
    const val = (u) => {
      switch (sort.key) {
        case 'name':       return norm(u.full_name || u.email);
        case 'position':   return norm(u.position);
        case 'role':       return norm(u.role);
        case 'section':    return norm(u.sections?.length ? u.sections.join(',') : u.section);
        case 'line':       return norm(lines.find(l => l.id === u.line_id)?.name);
        case 'team':       return norm(u.team);
        case 'created_at': return u.created_at || '';
        default:           return '';
      }
    };
    rows.sort((a, b) => {
      const cmp = val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0;
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return rows;
  })();

  // หัวตารางกดเรียงได้ — ลูกศรบอกคอลัมน์+ทิศทางที่ใช้อยู่
  const Th = ({ label, sortKey, style }) => (
    <th onClick={() => toggleSort(sortKey)} title="คลิกเพื่อเรียง"
      style={{ ...style, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
      {label} <span style={{ fontSize: 11, opacity: sort.key === sortKey ? 1 : 0.35 }}>
        {sort.key === sortKey ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅'}
      </span>
    </th>
  );

  return (
    <Page>
      <PageHeader title="จัดการผู้ใช้งาน" icon="🔑" sub="กำหนดสิทธิ์และสังกัด Section / Group / Team ของแต่ละ user"
        actions={
          <button
            onClick={openCreate}
            style={{ padding: '10px 20px', background: 'var(--amber)', color: '#fff', border: 'none', borderRadius: 8, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
          >
            ➕ เพิ่มผู้ใช้ใหม่
          </button>
        } />

      {message && (
        <div style={{ marginBottom: 14, padding: '10px 14px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 8, color: 'var(--green)', fontSize: 13 }}>
          ✅ {message}
        </div>
      )}

      {/* Toolbar: ขอบเขต → ชุดสิทธิ์ → ค้นหา → ตัวนับ (UI-STANDARD 2026-09-24 · FilterBar คุมขนาดช่องเอง) */}
      <FilterBar style={{ marginBottom: 12 }}>
        <select value={filterSection} onChange={e => setFilterSection(e.target.value)}>
          <option value="">{ALL.section}</option>
          {sectionOpts.map(sec => <option key={sec} value={sec}>{sec}</option>)}
        </select>
        <select value={filterRole} onChange={e => setFilterRole(e.target.value)}>
          <option value="">{ALL.role}</option>
          <RoleOptGroups />
        </select>
        <SearchInput value={q} onChange={setQ} fields="ชื่อ / อีเมล / ตำแหน่ง" />
        {(q || filterRole || filterSection) && (
          <button onClick={() => { setQ(''); setFilterRole(''); setFilterSection(''); }}
            style={{ padding: '8px 12px', borderRadius: 8, fontSize: 12, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text2)', cursor: 'pointer' }}>
            ✕ ล้างตัวกรอง
          </button>
        )}
        <span className="spacer" />
        <span className="filter-count">
          {view.length === users.length ? `ทั้งหมด ${users.length} คน` : `แสดง ${view.length} จาก ${users.length} คน`}
          <span style={{ marginLeft: 6, opacity: 0.7 }}>· ไม่มีการจำกัดจำนวน user</span>
        </span>
      </FilterBar>

      {/* 🔴 อ่านอีเมล login ไม่ได้ = ช่องอีเมลว่างทุกแถว · ต้องบอกว่า "อ่านไม่ได้" ไม่ใช่ "ไม่มี" (08/10) */}
      {authErr && (
        <div style={{ fontSize: 12, fontWeight: 700, color: '#ef4444', padding: '8px 10px', marginBottom: 10,
          borderRadius: 8, border: '1px solid rgba(239,68,68,0.5)', background: 'var(--card)' }}>
          ⚠ อ่านอีเมล login ไม่ได้ — ช่องอีเมลในตารางจะว่างทั้งหมด (<b>ไม่ได้หมายความว่าบัญชีไม่มีอีเมล</b>)
          <div style={{ fontWeight: 400, color: 'var(--text2)', marginTop: 2 }}>
            อีเมลอยู่ที่ `auth.users` ซึ่งอ่านได้เฉพาะ role <b>admin</b> · เหตุผลจากระบบ: {authErr}
          </div>
        </div>
      )}

      {/* 🩺 แถบสรุปงานค้าง — คลิกชิปเพื่อกาง/พับกองนั้น (ค่าเริ่มต้น = พับหมด ตารางผู้ใช้จึงอยู่บนสุด) */}
      {(() => {
        const CHIPS = [
          ['mismatch', '⚠️ ตัวตนไม่ตรงฐานพนักงาน', '#f59e0b'],
          ['fallback', '🧩 ฐานพนักงานยังไม่ได้กรอก', '#f59e0b'],
          ['dual',     '🧭 ทำงานคนละตำแหน่งกับที่บรรจุ', 'var(--accent)'],
          ['unknown',  '🪪 ยังไม่รู้ว่าเป็นใคร', '#f59e0b'],
          ['ghost',    '🚩 ตั้งขอบเขตแล้วไม่มีผล', '#ef4444'],
          ['review',   '🔭 ยังไม่ได้ทบทวนขอบเขต', '#f59e0b'],
        ].filter(([k]) => wlCounts[k] > 0);
        if (!CHIPS.length) return null;
        return (
          <div className="card" style={{ marginBottom: 12, padding: '8px 10px', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <b style={{ fontSize: 12, color: 'var(--text2)' }}>🩺 งานค้างของทะเบียนบัญชี</b>
            {CHIPS.map(([k, label, color]) => (
              <button key={k} type="button" onClick={() => setOpenWl(o => (o === k ? null : k))}
                aria-expanded={openWl === k}
                style={{ width: 'auto', fontSize: 11.5, padding: '3px 10px', cursor: 'pointer', borderRadius: 999,
                  border: `1px solid ${openWl === k ? color : 'var(--border2)'}`,
                  background: openWl === k ? 'var(--accent-dim)' : 'var(--bg3)', color: 'var(--text2)' }}>
                {label} <b style={{ color }}>{wlCounts[k]}</b> {openWl === k ? '▴' : '▾'}
              </button>
            ))}
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>— กดเพื่อดูรายชื่อ + ปุ่มแก้</span>
          </div>
        );
      })()}

      {/* ── worklist: บัญชีที่ตัวตนไม่ตรงกับฐานพนักงาน / ยังไม่ระบุประเภท ──────────
          ⚠️ ห้ามซ่อนเงียบ — ข้อมูลไม่ตรงทำให้ "มองไม่เห็นกะตัวเอง" (Checkin กรองด้วย team ของบัญชี)
             เคสจริง: หัวหน้า 2 คนทีมสลับกัน เพราะ admin เดาตอนสร้างบัญชี */}
      {(() => {
        /* 🪪 เทียบครบทุกช่องที่เก็บ 2 ที่ ผ่าน identityDiff() (`utils/identitySync.js` · มีเทส)
           เดิมเทียบแค่ team+line ⇒ section/position/org_node เพี้ยนเงียบ (วัด 06/10: 8/8/6 ใบ) */
        const mism = users
          .map(u => ({ u, e: u.employee_id ? empById[u.employee_id] : null }))
          .map(x => ({ ...x, diff: identityDiff(x.u, x.e) }))
          .filter(x => x.diff.length);
        /* 🪪 แยก 3 กองผ่านของกลาง — "บัญชีกลางไม่ผูกตัวตน = ถูกต้องแล้ว" ห้ามนับเป็นงานค้าง */
        const tri = unlinkedTriage(users, emps);
        const unset = tri.queue;
        if (!mism.length && !tri.queue.length && !tri.personUnlinked.length) return null;
        // กางเฉพาะกองที่กดชิปไว้ (จำนวนทุกกองยังอยู่บนแถบสรุปด้านบนเสมอ)
        if (!['mismatch', 'fallback', 'dual', 'unknown'].includes(openWl)) return null;
        return (
          <div className="card" style={{ marginBottom: 12, padding: 12, borderLeft: '3px solid #f59e0b' }}>
            {mism.length > 0 && openWl === 'mismatch' && (
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#f59e0b', marginBottom: 6 }}>
                  ⚠️ ตัวตนไม่ตรงกับฐานข้อมูลพนักงาน · {mism.length} บัญชี
                </div>
                {/* เหลือเฉพาะ ทีม/ไลน์/ส่วนงาน = ค่าเดียวกันแท้ๆ ที่เก็บ 2 ที่ ⇒ ต่าง = ผิดจริง
                    ตำแหน่ง/หน่วยในผัง ย้ายไปชั้น "คนละความหมาย" แล้ว (ดู utils/identitySync.js) */}
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, lineHeight: 1.5 }}>
                  ระบบ<b>ใช้ค่าจากฐานพนักงานแล้ว</b> (หัวหน้าแผนกเป็นคนดูแล) — ค่าในบัญชีที่ต่างอยู่คือค่าเก่าที่ไม่ถูกใช้
                  · กดปุ่มเพื่อล้างให้ตรงกัน จะได้ไม่สับสนตอนเปิดดู
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {mism.map(({ u, diff }) => (
                    <div key={u.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap', fontSize: 12, background: 'var(--bg3)', borderRadius: 6, padding: '6px 9px' }}>
                      <b style={{ minWidth: 150 }}>{u.full_name}</b>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: '1 1 300px', minWidth: 0 }}>
                        {diff.map(d => (
                          <div key={d.key} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{ color: 'var(--muted)', minWidth: 72 }}>{d.label}</span>
                            <span style={{ color: 'var(--muted)' }}>บัญชี: {idText(d.key, d.acct)}</span>
                            <span style={{ color: '#22c55e' }}>→ ฐานพนักงาน: {idText(d.key, d.emp)}</span>
                          </div>
                        ))}
                      </div>
                      <button type="button" onClick={() => syncFromEmployee(u)}
                        style={{ width: 'auto', marginLeft: 'auto', fontSize: 11, padding: '3px 10px', cursor: 'pointer' }}>
                        ใช้ค่าจากฐานพนักงาน
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {(() => {
              // ⚠️ ผูกแล้วแต่ฐานพนักงานเว้นช่องนั้นว่าง → ระบบตกกลับไปใช้ค่าในบัญชี
              //    ต้องเห็นบนจอ ไม่งั้นเข้าใจผิดว่า single source แล้วทั้งที่ยังไม่ใช่
              /* ครบทุกช่องเหมือนกัน ผ่าน identityFallbacks() — เดิมดูแค่ team/line */
              const fb = users
                .map(u => ({ u, miss: identityFallbacks(u, u.employee_id ? empById[u.employee_id] : null) }))
                .filter(x => x.miss.length);
              if (!fb.length || openWl !== 'fallback') return null;
              return (
                <div style={{ fontSize: 12, color: 'var(--text2)' }}>
                  <b style={{ color: '#f59e0b' }}>ฐานพนักงานยังไม่ได้กรอก · {fb.length} บัญชี</b>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5 }}>
                    {fb.map(({ u, miss }) => `${u.full_name} (${miss.map(m => m.label).join('/')})`).join(' · ')}
                    {' '}— ระบบใช้ค่าเดิมในบัญชีไปก่อน ควรไปกรอกช่องที่วงเล็บไว้ที่หน้าฐานข้อมูลพนักงาน
                    แล้วค่าจะมาจากที่นั่นที่เดียว
                  </div>
                </div>
              );
            })()}
            {/* ── 🧭 รักษาการ / ทำงานคนละตำแหน่งกับที่บรรจุ — **ข้อมูล ไม่ใช่ข้อผิดพลาด** (13/10) ──
                user: *"ตำแหน่งจริงที่เค้าเป็นอยู่กับบริษัทคือตามฐานพนักงาน แต่งานที่ตัวเค้าทำ
                คือทำในตำแหน่งตรงกับบัญชี"* ⇒ ต่างกัน = ถูกต้อง · **ห้ามเตือน ห้ามมีปุ่มล้างค่า**
                แต่ต้องเห็นบนจอ ไม่งั้นคนอ่านไม่รู้ว่าทำไมสิทธิ์ไม่ตรงกับตำแหน่งที่บรรจุ */}
            {(() => {
              const dual = users
                .map(u => ({ u, info: dualMeaningInfo(u, u.employee_id ? empById[u.employee_id] : null) }))
                .filter(x => x.info.length);
              if (!dual.length || openWl !== 'dual') return null;
              return (
                <div style={{ fontSize: 12, color: 'var(--text2)' }}>
                  <b style={{ color: 'var(--accent)' }}>🧭 ทำงานคนละตำแหน่งกับที่บริษัทบรรจุ · {dual.length} บัญชี</b>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3, lineHeight: 1.6 }}>
                    <b>ไม่ใช่ข้อผิดพลาด</b> — 2 ช่องนี้ตอบคนละคำถาม และระบบ<b>ตัดสินสิทธิ์จากตำแหน่งที่ปฏิบัติงาน</b>
                    (ไม่ใช่ที่บรรจุ) จึงไม่มีปุ่มล้างค่า · แก้ตำแหน่งที่ปฏิบัติงานได้ที่ปุ่มแก้ไขบัญชี
                    · แก้ตำแหน่งตามบริษัทที่หน้าฐานข้อมูลพนักงาน
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 5 }}>
                    {dual.map(({ u, info }) => (
                      <div key={u.id} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11 }}>
                        <b style={{ minWidth: 150, color: 'var(--text2)' }}>{u.full_name}</b>
                        {info.map(d => (
                          <span key={d.key} style={{ color: 'var(--muted)' }}>
                            {d.empLabel}: {idText(d.key, d.emp)} · <b style={{ color: 'var(--accent)' }}>
                              {d.acctLabel}: {idText(d.key, d.acct)}</b>
                            {d.undecided ? ' (ยังไม่ตัดสิน)' : ''}
                          </span>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
            {/* ── 🪪 คิว "ยังไม่รู้ว่าบัญชีนี้เป็นใคร" (19/10 · คำสั่ง user) ───────────────────
                เดิมบรรทัดนี้บอกแค่ "ยังไม่ระบุประเภทบัญชี · 18 บัญชี" **ไม่มีชื่อ ไม่มีปุ่ม**
                ⇒ แอดมินต้องไปไล่หาเองใน 122 แถว ⇒ ไม่มีใครทำ ค้างมาตลอด
                🔴 วัดแล้ว: จับคู่ชื่ออัตโนมัติแก้ไม่ได้ (ชื่อตรง 1/18) — ปลายทางมี 3 ทาง
                   ⇒ จอต้องเสนอ "ทางไปต่อ" รายใบ ไม่ใช่ปุ่ม "ผูกให้หมด" */}
            {tri.queue.length > 0 && openWl === 'unknown' && (
              <div style={{ fontSize: 12, color: 'var(--text2)' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#f59e0b', marginBottom: 4 }}>
                  🪪 ยังไม่รู้ว่าบัญชีนี้เป็นใคร · {tri.queue.length} บัญชี
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 7, lineHeight: 1.6 }}>
                  ตัวตน (<b>ทีม / ไลน์ / ส่วนงาน</b>) อ่านจาก<b>ฐานพนักงาน</b>เมื่อผูกแล้ว —
                  ยังไม่ผูก = ใช้ค่าที่แอดมินกรอกไว้ในบัญชี ซึ่งเพี้ยนได้โดยไม่มีใครรู้
                  (เคสจริง: หัวหน้า 2 คนทีมสลับกัน แล้วเปิดจอเช็คชื่อไม่เห็นกะตัวเอง)
                  <br />🔴 <b>ระบบไม่เดาให้</b> ว่าใบไหนเป็นของคนหรือของหน่วยงาน — เสนอตัวเลือกให้ คนกดตัดสิน
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {tri.queue.map(({ u, tier, rows, confident }) => {
                    const hint = routeHint({ tier, rows, confident });
                    const busy = triBusy === u.id;
                    return (
                      <div key={u.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap',
                        fontSize: 12, background: 'var(--bg3)', borderRadius: 6, padding: '6px 9px', opacity: busy ? 0.55 : 1 }}>
                        <div style={{ minWidth: 150, flex: '0 1 190px' }}>
                          <b>{u.full_name || <span style={{ color: 'var(--muted)', fontWeight: 400 }}>ไม่ระบุชื่อ</span>}</b>
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                            {roleLabel(u.role)}{u.position ? ` · ${positionLabel(u.position)}` : ''}
                            {u.section ? ` · ${u.section}` : ''}
                          </div>
                        </div>
                        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                          <div style={{ fontSize: 11, color: tier ? 'var(--text2)' : '#f59e0b', marginBottom: 3 }}>
                            {hint.text}
                          </div>
                          {/* ชื่อที่เจอในทะเบียน — โชว์ "รหัสพนักงาน + ส่วนงาน" ให้แยกคนชื่อซ้ำออกจากกันได้ */}
                          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                            {rows.map(e => (
                              <button key={e.id} type="button" disabled={busy}
                                onClick={() => linkEmployee(u, e)}
                                title={`ผูกบัญชีนี้กับ ${e.name} (${e.employee_id_code || 'ไม่มีรหัส'})`}
                                style={{ width: 'auto', fontSize: 11, padding: '3px 9px', cursor: busy ? 'default' : 'pointer',
                                  borderRadius: 6, border: `1px solid ${confident ? 'rgba(34,197,94,0.55)' : 'var(--border2)'}`,
                                  background: confident ? 'rgba(34,197,94,0.12)' : 'var(--bg2)',
                                  color: confident ? '#22c55e' : 'var(--text2)', fontWeight: 700 }}>
                                🔗 {e.employee_id_code || '—'} · {e.name}
                                {e.section ? <span style={{ fontWeight: 400, opacity: 0.8 }}> · {e.section}</span> : null}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 5, marginLeft: 'auto', flexWrap: 'wrap' }}>
                          {/* ทาง 2: ยังไม่มีชื่อในทะเบียน → โมดัลเดิมมีปุ่ม "＋ เพิ่มคนนี้เข้าฐาน" อยู่แล้ว */}
                          <button type="button" disabled={busy} onClick={() => openEdit(u)}
                            title="เปิดแก้ไขบัญชี — ในโมดัลมีปุ่มเพิ่มคนเข้าฐานพนักงาน ถ้ายังไม่มีชื่อเขา"
                            style={{ width: 'auto', fontSize: 11, padding: '3px 9px', cursor: busy ? 'default' : 'pointer' }}>
                            ✏️ เปิดแก้ไข / เพิ่มเข้าฐาน
                          </button>
                          {/* ทาง 3: ไม่ใช่คน (จอ TV / ประจำเครื่อง / บัญชีทดสอบ) */}
                          <button type="button" disabled={busy} onClick={() => markShared(u)}
                            title="จอ TV หรือบัญชีประจำเครื่อง = บัญชีกลาง ไม่ต้องผูกตัวตน"
                            style={{ width: 'auto', fontSize: 11, padding: '3px 9px', cursor: busy ? 'default' : 'pointer',
                              background: 'var(--bg2)', border: '1px solid var(--border2)', color: 'var(--text2)' }}>
                            🖥️ เป็นบัญชีกลาง
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {/* 🔴 ตัวเลขต้องพูดให้ตรง — บัญชีกลางที่ไม่ผูกตัวตน **ถูกต้องแล้ว** ห้ามนับเป็นงานค้าง */}
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 7, lineHeight: 1.6,
                  borderTop: '1px dashed var(--border)', paddingTop: 6 }}>
                  นอกคิวนี้: <b>{tri.sharedOk.length}</b> บัญชีกลาง (จอ TV / ประจำเครื่อง) —
                  <b> ไม่ผูกตัวตนถูกต้องแล้ว ไม่ใช่งานค้าง</b>
                  {tri.personUnlinked.length > 0 && (
                    <> · <b style={{ color: '#ef4444' }}>⚠ {tri.personUnlinked.length} บัญชีติดป้ายว่าเป็นของคนแต่ยังไม่ผูกตัวตน</b>
                      {' '}({tri.personUnlinked.map(x => x.u.full_name || x.u.email).join(' · ')})
                      {' '}— เปิดแก้ไขแล้วเลือกคนให้ครบ</>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* 📋 คิวทบทวนสิทธิ์ — ISO 27001 A.5.18 บังคับให้ทบทวนสิทธิ์เป็นรอบ
          `legacy_open` = บัญชีที่เห็นทั้งโรงงานเพราะ "ไม่เคยตั้งขอบเขต" ไม่ใช่เพราะมีคนตัดสินใจให้
          ⇒ แสดงเป็นตัวเลขให้ไล่เคลียร์จนหมดแล้วหายไปเอง (pattern เดียวกับ "ข้อมูลไม่ตรงผังองค์กร")
          🔴 ห้ามแก้ให้อัตโนมัติ — คนต้องเป็นคนตัดสินว่าใครควรเห็นแค่ไหน */}
      {(() => {
        const review = users.filter(needsScopeReview);
        /* 🚩 "ตั้งแคบไว้แต่ไม่มีผลจริง" — แคบกว่า all แต่ไม่มีหน่วยให้ยึด ⇒ ยังเห็นทั้งโรงงาน
           ต้องแยกจากคิวข้างบน เพราะคนละอาการ: อันนั้น "ไม่เคยตั้ง" · อันนี้ "ตั้งแล้วแต่ไม่ครบ"
           ปล่อยเงียบ = จอบอกว่าถูกจำกัด แต่ความจริงไม่ถูกจำกัด (แย่กว่าไม่ตั้งเลย) */
        const ghost = users.filter(scopeIneffective);
        if (!review.length && !ghost.length) return null;
        if (openWl !== 'ghost' && openWl !== 'review') return null;
        return (<>
          {ghost.length > 0 && openWl === 'ghost' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
              background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.35)',
              borderRadius: 10, padding: '9px 12px', marginBottom: 10, fontSize: 12, color: 'var(--text2)' }}>
              <b style={{ color: '#ef4444' }}>🚩 ตั้งขอบเขตไว้แต่ไม่มีผลจริง {ghost.length} บัญชี</b>
              <span>
                เลือกความกว้างไว้แคบกว่า “ทั้งโรงงาน” แต่<b>ยังไม่ได้ติ๊กส่วนงาน</b> —
                จำกัดให้อยู่ในหน่วยตัวเองไม่ได้ถ้าไม่เคยบอกว่าหน่วยไหน ⇒ <b>ยังเห็นทั้งโรงงานอยู่</b>
              </span>
              <span style={{ color: 'var(--muted)' }}>
                ({ghost.slice(0, 4).map(u => u.full_name || '—').join(' · ')}
                {ghost.length > 4 ? ` · +${ghost.length - 4}` : ''})
              </span>
            </div>
          )}
          {review.length > 0 && openWl === 'review' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.35)',
            borderRadius: 10, padding: '9px 12px', marginBottom: 10, fontSize: 12, color: 'var(--text2)' }}>
            <b style={{ color: '#f59e0b' }}>🔭 ยังไม่ได้ทบทวนขอบเขต {review.length} บัญชี</b>
            <span>
              เห็น<b>ทั้งโรงงาน</b>เพราะไม่เคยตั้งขอบเขตไว้ — ไม่ใช่เพราะมีคนตั้งใจให้
              · เปิดแก้ไขแล้วเลือก “ขอบเขตการมองเห็น” ให้ตรงงานจริง แล้วรายการนี้จะหายไปเอง
            </span>
            <span style={{ color: 'var(--muted)' }}>
              ({review.slice(0, 4).map(u => u.full_name || u.email || '—').join(' · ')}
              {review.length > 4 ? ` · +${review.length - 4}` : ''})
            </span>
          </div>
          )}
        </>);
      })()}

      {/* User Table */}
      <div className="card table-sticky" style={{ overflowX: 'auto', marginBottom: 16, maxHeight: '65vh' }}>
        <table style={{ minWidth: 680 }}>
          <thead>
            <tr>
              <Th label="ชื่อ / อีเมล" sortKey="name" style={{ minWidth: 200 }} />
              <Th label="ตำแหน่ง" sortKey="position" style={{ textAlign: 'center', minWidth: 100 }} />
              <Th label="ชุดสิทธิ์" sortKey="role" style={{ textAlign: 'center', minWidth: 100 }} />
              <Th label="Section" sortKey="section" style={{ textAlign: 'center', minWidth: 80 }} />
              <Th label="ไลน์ / Group" sortKey="line" style={{ minWidth: 140 }} />
              <Th label="Team" sortKey="team" style={{ textAlign: 'center', minWidth: 80 }} />
              <Th label="สร้างเมื่อ" sortKey="created_at" style={{ textAlign: 'center', minWidth: 96 }} />
              <th style={{ textAlign: 'center', minWidth: 80 }}>แก้ไข</th>
            </tr>
          </thead>
          <tbody>
            {fetchingUsers ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--muted)', padding: 28, fontSize: 13 }}>กำลังโหลด...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--muted)', padding: 28, fontSize: 13 }}>ไม่พบข้อมูลผู้ใช้</td></tr>
            ) : view.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--muted)', padding: 28, fontSize: 13 }}>ไม่พบ user ที่ตรงกับตัวกรอง — ลองล้างตัวกรอง</td></tr>
            ) : view.map(u => {
              const rc      = ROLES.find(r => r.value === u.role);
              const lineName = lines.find(l => l.id === u.line_id)?.name || '—';
              return (
                <tr key={u.id}>
                  <td>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{u.full_name || <span style={{ color: 'var(--muted)', fontWeight: 400 }}>ไม่ระบุชื่อ</span>}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{u.email}</div>
                  </td>
                  <td style={{ textAlign: 'center', fontSize: 13, color: u.position ? 'var(--text)' : 'var(--muted)' }}>
                    {u.position ? positionLabel(u.position) : '—'}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <span style={{
                      padding: '3px 10px', borderRadius: 5, fontSize: 11, fontWeight: 700,
                      background: rc ? `${rc.color}22` : 'var(--bg3)',
                      color:      rc ? rc.color        : 'var(--text2)',
                      border:     `1px solid ${rc ? rc.color + '44' : 'var(--border2)'}`,
                    }}>
                      {u.role ? roleLabel(u.role) : '—'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'center', fontSize: 13, color: (u.sections?.length || u.section) ? 'var(--text)' : 'var(--muted)' }}>
                    {u.sections?.length ? u.sections.join(', ') : (u.section || '—')}
                    {/* 💰 ชั้นสิทธิ์ที่ 3 แกน CC — บัญชีที่ตั้งแล้ว "ชนะ" ส่วนงานข้างบน ⇒ ต้องเห็นจากลิสต์
                        ไม่งั้นแอดมินอ่านคอลัมน์นี้แล้วเข้าใจผิดว่าขอบเขตที่แก้ได้คือส่วนงานที่เขียนอยู่ */}
                    {(u.resp_cost_centers || []).length > 0 && (
                      <div title={(u.resp_cost_centers || []).join(' · ')}
                        style={{ fontSize: 11, fontWeight: 700, color: '#22c55e', marginTop: 2 }}>
                        💰 CC {(u.resp_cost_centers || []).length} รหัส
                      </div>
                    )}
                  </td>
                  <td style={{ fontSize: 13, color: u.line_id ? 'var(--text)' : 'var(--muted)' }}>
                    {lineName}
                  </td>
                  <td style={{ textAlign: 'center', fontSize: 13, color: u.team ? 'var(--text)' : 'var(--muted)' }}>
                    {u.team ? `Team ${u.team}` : '—'}
                  </td>
                  <td style={{ textAlign: 'center', fontSize: 12, color: u.created_at ? 'var(--text2)' : 'var(--muted)', whiteSpace: 'nowrap' }}>
                    {u.created_at ? new Date(u.created_at).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: '2-digit' }) : '—'}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <button
                      onClick={() => openEdit(u)}
                      style={{ padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text2)', cursor: 'pointer' }}
                    >
                      ✏️ แก้ไข
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Role reference — หมวดที่เข้าได้ดึงจากตารางสิทธิ์จริง (role_permissions) ไม่ hardcode */}
      <div style={{ padding: '12px 16px', background: 'var(--bg3)', borderRadius: 10, border: '1px solid var(--border2)' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          สิทธิ์การเข้าถึง <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>— หมวดที่เข้าได้อ่านจากตารางสิทธิ์ปัจจุบัน ปรับรายหน้าได้ที่เมนู 🔐 จัดการสิทธิ์</span>
        </div>
        {/* ⚠️ ย้ำให้ชัดว่า role ≠ ตำแหน่งงาน — เคยเข้าใจผิดว่า "ส่วนวิศวกรรม" คือตำแหน่งวิศวกร */}
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.5 }}>
          ชุดสิทธิ์ <b>ไม่ใช่ตำแหน่งงาน</b> — ตำแหน่งจริง (วิศวกร / ช่างเทคนิค / หัวหน้าแผนก) กรอกที่ช่อง “ตำแหน่งงาน” แยกต่างหาก<br />
          เช่น <b>วิศวกรที่สังกัดแผนกซ่อมบำรุง</b> ให้เลือกชุดสิทธิ์ <b>🔧 ซ่อมบำรุง</b> แล้วกรอกตำแหน่งว่า “วิศวกร” — ไม่ใช่เลือก “ส่วนวิศวกรรม”
        </div>
        {ROLE_GROUPS.map(g => (
          <div key={g.axis} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--text)', marginBottom: 2 }}>
              {g.label} <span style={{ fontWeight: 400, color: 'var(--muted)' }}>— {g.hint}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px, 100%), 1fr))', gap: 8 }}>
              {g.roles.map(r => {
                const sum = accessSummaryForRole(r.value);
                return (
                  <div key={r.value} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: r.color, flexShrink: 0, marginTop: 5 }} />
                    <div style={{ minWidth: 0 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: r.color }}>{r.label}</span>
                      <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 6 }}>{r.desc}</span>
                      <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>
                        {sum.all ? '✅ เข้าได้ทุกหน้า' : sum.total === 0 ? '— ยังไม่เปิดสิทธิ์หน้าไหน' : `เข้าได้ ${sum.total} หน้า: ${sum.groups.join(' · ')}`}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Create / Edit Modal */}
      {showModal && (
        <div className="overlay">
          {/* จอ desktop: ขยายกว้าง 2 คอลัมน์ ห้ามทรงแคบสูงจนล้นจอ (UI-CONVENTIONS "ขยายกว้างก่อนยอมสูงเกินจอ") */}
          <div className="modal" style={{ width: 'min(96vw, 920px)', maxWidth: 920, maxHeight: '94vh', overflowY: 'auto' }}>
            <h3 style={{ marginTop: 0, marginBottom: 18, fontFamily: 'var(--font-display)', color: 'var(--text)', fontSize: 17 }}>
              {modalMode === 'create' ? '➕ เพิ่มผู้ใช้ใหม่' : '✏️ แก้ไขข้อมูลผู้ใช้'}
            </h3>

            <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))', gap: 13, alignItems: 'start' }}>
              {/* โซน 1: ตัวตน (ตำแหน่ง = แสดงผล) แยกชัดจากโซน 2: สิทธิ์ — เคยปนกันจน user งงว่าตำแหน่งคือสิทธิ์ */}
              <div style={{ gridColumn: '1 / -1', fontSize: 12, fontWeight: 800, color: 'var(--accent)', borderBottom: '1px solid var(--border)', paddingBottom: 5 }}>
                👤 ข้อมูลบัญชี & ตัวตน
              </div>
              {modalMode === 'create' ? (
                <>
                  <div>
                    <label style={labelSt}>อีเมล</label>
                    <input type="email" placeholder="user@company.com" value={form.email} onChange={e => setF('email', e.target.value)} />
                  </div>
                  <div>
                    <label style={labelSt}>รหัสผ่าน (อย่างน้อย 6 ตัว)</label>
                    <input type="password" placeholder="••••••" value={form.password} onChange={e => setF('password', e.target.value)} />
                  </div>
                </>
              ) : (
                <>
                  <div style={{ padding: '8px 12px', background: 'var(--bg3)', borderRadius: 8, fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    📧 <span style={{ color: 'var(--text)' }}>{form.email}</span>
                  </div>
                  {form.role !== 'admin' && (
                    <div>
                      <label style={labelSt}>🔑 ตั้งรหัสผ่านใหม่ (กรณีลืมรหัส / login ไม่ได้)</label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {/* input ใน flex row ต้องกำหนด width เอง (กฎ F5 — index.css default 100%) */}
                        <input type="text" placeholder="รหัสใหม่ อย่างน้อย 6 ตัว..." value={resetPw}
                          onChange={e => setResetPw(e.target.value)}
                          autoComplete="off"
                          style={{ flex: 1, width: 'auto', minWidth: 0 }} />
                        <button type="button" onClick={handleResetPassword}
                          disabled={resetPwBusy || resetPw.length < 6}
                          style={{ padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
                            cursor: (resetPwBusy || resetPw.length < 6) ? 'not-allowed' : 'pointer',
                            background: 'rgba(245,158,11,0.12)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.35)',
                            opacity: (resetPwBusy || resetPw.length < 6) ? 0.5 : 1 }}>
                          {resetPwBusy ? 'กำลังตั้ง...' : 'รีเซ็ตรหัส'}
                        </button>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                        รหัสเดิมใช้ไม่ได้ทันที — แจ้งรหัสใหม่ให้เจ้าตัว แล้วแนะนำให้ไปเปลี่ยนเองที่เมนูเปลี่ยนรหัสผ่าน
                      </div>
                    </div>
                  )}
                </>
              )}

              <div>
                <label style={labelSt}>ประเภทบัญชี</label>
                {/* ⚠️ บัญชีของคน ต้องผูกตัวตนจากฐานพนักงาน — ทีม/ไลน์/ส่วนงาน อ่านจากที่นั่นที่เดียว
                    บัญชีหน่วยงาน/อุปกรณ์ (maintenance/warehouse1/Display) ไม่มีตัวตนใน employees และไม่ควรมี */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                  {[
                    { k: 'person', icon: '👤', label: 'บัญชีของคน', desc: 'ผูกกับพนักงานในฐานข้อมูล' },
                    /* ⚠️ 2026-09-21 เปลี่ยนคำจาก "บัญชีหน่วยงาน/อุปกรณ์" — คำเดิมอ่านแล้วเหมือน
                       "บัญชีของหน่วยงานนั้น" เลยถูกเลือกให้คนจริง 32 ใบ (QC/หัวหน้าแผนก/วิศวกร) */
                    { k: 'shared', icon: '🖥️', label: 'บัญชีกลาง (ไม่ใช่คน)', desc: 'จอ TV · บัญชีประจำกะ/เครื่อง' },
                  ].map(o => (
                    <button key={o.k} type="button"
                      onClick={() => { setF('accountKind', o.k); if (o.k === 'shared') setF('employeeId', ''); }}
                      style={{
                        flex: '1 1 190px', width: 'auto', textAlign: 'left', cursor: 'pointer', padding: '8px 10px',
                        borderRadius: 8, fontSize: 12,
                        border: `1px solid ${form.accountKind === o.k ? 'var(--accent)' : 'var(--border2)'}`,
                        background: form.accountKind === o.k ? 'rgba(34,197,94,0.10)' : 'var(--bg2)',
                        color: form.accountKind === o.k ? 'var(--text)' : 'var(--text2)',
                      }}>
                      <div style={{ fontWeight: 700 }}>{o.icon} {o.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{o.desc}</div>
                    </button>
                  ))}
                </div>
                {!form.accountKind && (
                  <div style={{ fontSize: 11, color: '#f59e0b', marginBottom: 6 }}>
                    ⚠️ บัญชีนี้ยังไม่ได้ระบุประเภท — เลือกให้ถูก แล้วระบบจะรู้ว่าต้องผูกตัวตนไหม
                  </div>
                )}
                {/* 🔴 กันซ้ำรอย: 32 บัญชีของคนจริงเคยถูกติดป้าย "ไม่ใช่คน" เพราะหาชื่อในฐานไม่เจอ
                    ชื่อที่เป็น "คำไทย 2 คำขึ้นไป" = แทบจะเป็นชื่อคนเสมอ → เตือนไว้ก่อน (ไม่บล็อก) */}
                {form.accountKind === 'shared' && /^[\u0E00-\u0E7F]+\s+[\u0E00-\u0E7F]+/.test((form.fullName || '').trim()) && (
                  <div style={{ fontSize: 11, color: '#f59e0b', marginBottom: 6, lineHeight: 1.5 }}>
                    ⚠️ ชื่อ "{form.fullName}" ดูเป็นชื่อคน — ถ้าเป็นคนจริงให้เลือก <b>บัญชีของคน</b> แล้วผูกตัวตน
                    (ไม่มีในฐานพนักงานก็กดเพิ่มได้จากตรงนั้นเลย) · บัญชีกลางไว้ใช้กับ <b>จอ TV / บัญชีประจำเครื่อง</b> เท่านั้น
                    <div style={{ color: 'var(--muted)', marginTop: 2 }}>
                      ติดป้ายผิด = ระบบตอบไม่ได้ว่าเขาอยู่แผนกไหน ⇒ ตัวกรอง "แผนก" ของการแจ้งเตือนใช้กับเขาไม่ได้
                    </div>
                  </div>
                )}

                {form.accountKind === 'person' ? (
                  <>
                    <label style={labelSt}>พนักงาน (ตัวตนของบัญชีนี้) <span style={{ color: 'var(--red)' }}>*</span></label>
                    <input type="text" placeholder="ค้นด้วยรหัส / ชื่อ" value={empSearch}
                      onChange={e => setEmpSearch(e.target.value)} style={{ marginBottom: 6 }} />
                    <select value={form.employeeId}
                      onChange={e => {
                        const emp = emps.find(x => x.id === e.target.value);
                        setF('employeeId', e.target.value);
                        // ตัวตนมาจากฐานพนักงาน — เติมให้ครบในจังหวะเดียว admin ไม่ต้องเดา
                        if (emp) setForm(f => ({
                          ...f, employeeId: emp.id, fullName: emp.name || '',
                          team: emp.team || '', lineId: emp.line_id ? String(emp.line_id) : '',
                          sections: emp.section ? [emp.section] : f.sections,
                          position: emp.position || f.position,
                        }));
                      }}>
                      <option value="">— เลือกพนักงาน —</option>
                      {empMatches
                        .slice(0, 300)
                        .map(e2 => (
                          <option key={e2.id} value={e2.id}>
                            {e2.employee_id_code} · {e2.name}{e2.team ? ` · ทีม ${e2.team}` : ''}{e2.section ? ` · ${e2.section}` : ''}
                          </option>
                        ))}
                    </select>
                    {empSearchMissed && (
                      <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 4, lineHeight: 1.5 }}>
                        🔎 ไม่พบชื่อที่ตรงกับ "{empSearch.trim()}" — <b>แสดงรายชื่อทั้งหมดไว้ให้เลือกแทน</b>
                        <div style={{ color: 'var(--muted)', marginTop: 2 }}>
                          ชื่อในฐานอาจสะกดต่างเล็กน้อย (เช่นไม่มี ์ ท้ายคำ) · ลองค้นด้วย<b>รหัสพนักงาน</b>หรือคำสั้นๆ
                          ก่อนกดเพิ่มคนใหม่ — เพิ่มซ้ำแล้วจะมีคนเดียวกัน 2 แถวในฐาน
                        </div>
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                      ทีม / ไลน์ / ส่วนงาน จะมาจากฐานพนักงานอัตโนมัติ — หัวหน้าแผนกแก้ที่นั่นแล้วถือเป็นค่าจริง
                    </div>

                    {/* ➕ ไม่มีชื่อเขาในฐาน = เพิ่มจากตรงนี้ได้เลย ไม่ต้องไปหน้าอื่น (2026-09-21)
                        คนสายสนับสนุน (QA/PE/ธุรการ/สโตร์) ไม่เคยถูกลงทะเบียนไว้ — เดิมทางออกเดียว
                        คือกดเป็น "บัญชีหน่วยงาน" ซึ่งทำให้ระบบตอบไม่ได้ว่าเขาอยู่แผนกไหน */}
                    {!form.employeeId && !newEmp && (
                      <button type="button"
                        onClick={() => setNewEmp({ name: (empSearch.trim() || form.fullName || ''), employee_id_code: '', department: '', section: '', staff_kind: STAFF_SUPPORT })}
                        style={{ marginTop: 8, width: 'auto', padding: '7px 12px', borderRadius: 8, border: '1px dashed var(--accent)',
                          background: 'transparent', color: 'var(--accent)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                        ＋ ไม่มีชื่อในฐานพนักงาน — เพิ่มคนนี้เข้าฐาน
                      </button>
                    )}

                    {newEmp && (
                      <div style={{ marginTop: 8, padding: 10, background: 'var(--bg3)', borderRadius: 8, border: '1px solid var(--border2)', display: 'grid', gap: 8 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>➕ เพิ่มคนนี้เข้าฐานพนักงาน</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 8 }}>
                          <div>
                            <label style={labelSt}>ชื่อ - นามสกุล <span style={{ color: 'var(--red)' }}>*</span></label>
                            <input type="text" autoFocus value={newEmp.name}
                              onChange={e => setNewEmp(v => ({ ...v, name: e.target.value }))} />
                          </div>
                          <div>
                            <label style={labelSt}>รหัสพนักงาน <span style={{ color: 'var(--red)' }}>*</span></label>
                            <input type="text" placeholder="เช่น 12345" value={newEmp.employee_id_code}
                              onChange={e => setNewEmp(v => ({ ...v, employee_id_code: e.target.value }))} />
                          </div>
                        </div>

                        <div>
                          <label style={labelSt}>ประเภทพนักงาน</label>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {STAFF_KINDS.map(k => (
                              <button key={k.key} type="button" onClick={() => setNewEmp(v => ({ ...v, staff_kind: k.key }))}
                                style={{ flex: '1 1 190px', width: 'auto', textAlign: 'left', cursor: 'pointer', padding: '7px 10px', borderRadius: 8, fontSize: 12,
                                  border: `1px solid ${newEmp.staff_kind === k.key ? 'var(--accent)' : 'var(--border2)'}`,
                                  background: newEmp.staff_kind === k.key ? 'rgba(34,197,94,0.10)' : 'var(--bg2)',
                                  color: newEmp.staff_kind === k.key ? 'var(--text)' : 'var(--text2)' }}>
                                <div style={{ fontWeight: 700 }}>{k.label}</div>
                                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{k.desc}</div>
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* 🔴 23/09 — เดิมบังคับ "สายสนับสนุน = ขึ้นตรงฝ่าย" (ส่วนงานถูกล็อกว่าง) ซึ่งผิดกับของจริง:
                            ธุรการ/QC ที่ประจำส่วนงานมีอยู่จริง (ชญาดา = clerk สังกัด PD3) และการปล่อยส่วนงานว่าง
                            มีผลข้างเคียงกับ**การแจ้งเตือน** — `notify_recipients()` ปล่อยคนที่ไม่มีส่วนงานเลย
                            (ทั้งฝั่งบัญชีและฝั่งพนักงาน) ผ่านตัวกรองทุกส่วนงาน ⇒ เด้งหาเขาทุกใบทั้งโรงงาน
                            ⇒ เลือกส่วนงานได้ทั้ง 2 ประเภท · "ขึ้นตรงฝ่าย" เป็น**ตัวเลือกหนึ่ง** ไม่ใช่ค่าบังคับ
                            แผนก cascade ตามส่วนงาน (ใช้ deptOptionsFor เดียวกับหน้าลงทะเบียนพนักงาน) */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                          <div>
                            <label style={labelSt}>ส่วนงาน (Section)</label>
                            <select value={newEmp.section}
                              onChange={e => setNewEmp(v => ({ ...v, section: e.target.value, department: '' }))}>
                              <option value="">— ไม่ระบุ —</option>
                              <option value={ORPHAN_SECTION}>{ORPHAN_SECTION_LABEL}</option>
                              {sectionOpts.map(sc => <option key={sc} value={sc}>{sc}</option>)}
                            </select>
                          </div>
                          <div>
                            <label style={labelSt}>แผนก</label>
                            <select value={newEmp.department} onChange={e => setNewEmp(v => ({ ...v, department: e.target.value }))}>
                              <option value="">{newEmp.section ? '— ไม่ระบุ —' : '— เลือกส่วนงานก่อน —'}</option>
                              {deptOptionsFor(newEmp.section, orgNodes.sections, orgNodes.depts)
                                .map(d => <option key={d.id} value={d.code || d.name}>{d.code || d.name}</option>)}
                            </select>
                          </div>
                        </div>

                        {/* 🔔 ไม่มีส่วนงานทั้ง 2 ฝั่ง = ตัวกรองส่วนงานของการแจ้งเตือนใช้กับเขาไม่ได้ */}
                        {!newEmp.section && form.sections.length === 0 && (
                          <div style={{ fontSize: 11, color: '#f59e0b', lineHeight: 1.5 }}>
                            🔔 ไม่ได้ระบุส่วนงาน และบัญชีนี้ก็ยังไม่ได้ติ๊กขอบเขตส่วนงาน
                            ⇒ <b>เขาจะได้รับแจ้งเตือนของทุกส่วนงาน</b> (ระบบถือว่า "ไม่จำกัดขอบเขต")
                            <div style={{ color: 'var(--muted)', marginTop: 2 }}>
                              ถ้าเขาดูแลเฉพาะบางส่วนงาน ให้ติ๊ก "ขอบเขตส่วนงาน" ข้างล่างด้วย
                            </div>
                          </div>
                        )}

                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                          {newEmp.staff_kind === STAFF_SUPPORT
                            ? 'สายสนับสนุน = ไม่ผูกไลน์/ทีม ⇒ ไม่โผล่ในหน้าเช็คชื่อ · ไม่ถูกนับเป็นกำลังคนหน้าไลน์ · ไม่มีแผงสกิล'
                            : 'พนักงานหน้าไลน์ = จะถูกนับในเช็คชื่อ/กำลังคน — ไลน์และทีมไปตั้งต่อที่หน้าพนักงาน (/operator)'}
                        </div>

                        <div style={{ display: 'flex', gap: 8 }}>
                          <button type="button" onClick={addEmployee} disabled={newEmpSaving}
                            style={{ width: 'auto', padding: '8px 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: 'var(--accent-ink)', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: newEmpSaving ? 0.6 : 1 }}>
                            {newEmpSaving ? 'กำลังบันทึก...' : 'บันทึกเข้าฐานพนักงาน + ผูกกับบัญชีนี้'}
                          </button>
                          <button type="button" onClick={() => setNewEmp(null)}
                            style={{ width: 'auto', padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg2)', color: 'var(--text2)', fontSize: 12, cursor: 'pointer' }}>
                            ยกเลิก
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <label style={labelSt}>ชื่อ - นามสกุล</label>
                    <input type="text" placeholder="ชื่อเต็ม" value={form.fullName} onChange={e => setF('fullName', e.target.value)} />
                  </>
                )}
              </div>

              <div>
                <label style={labelSt}>ตำแหน่งงาน (Position)</label>
                {/* 2026-09-07: เลิกช่อง "อื่นๆ (พิมพ์เอง)" — ตำแหน่งนอก master ไม่มีระดับงาน (คำเตือน AM/PM เงียบ)
                    ตำแหน่งใหม่ให้เพิ่มเข้าทะเบียน positions ก่อนแล้วเลือก · ค่าเก่าที่เคยพิมพ์ไว้ยังโชว์ (positionOptionsWith) ไม่หายตอนบันทึก */}
                <div style={{ display: 'flex', gap: 6 }}>
                  <select value={form.position} onChange={e => setF('position', e.target.value)} style={{ flex: 1, minWidth: 0 }}>
                    <option value="">— ไม่ระบุ —</option>
                    {positionOptionsWith(form.position).map(p => (
                      <option key={p.value} value={p.value}>{p.label}{p.level == null && !posOpts().some(o => o.value === p.value) ? ' ⚠ นอกทะเบียน' : ''}</option>
                    ))}
                  </select>
                  <button type="button" onClick={() => setNewPos(v => (v ? null : { key: '', label_th: '', level: 'staff' }))}
                    style={{ whiteSpace: 'nowrap', padding: '0 12px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text2)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                    {newPos ? '✕ ยกเลิก' : '+ เพิ่มตำแหน่งใหม่'}
                  </button>
                </div>
                {newPos && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr 1fr auto', gap: 6, marginTop: 6, alignItems: 'center', padding: 8, background: 'var(--bg3)', borderRadius: 8, border: '1px solid var(--border2)' }}>
                    <input type="text" autoFocus placeholder="key (a-z/_) เช่น asst_head" value={newPos.key}
                      onChange={e => setNewPos(p => ({ ...p, key: e.target.value }))} style={{ fontFamily: 'monospace' }} />
                    <input type="text" placeholder="ชื่อตำแหน่ง (ไทย) เช่น ผู้ช่วยหัวหน้าแผนก" value={newPos.label_th}
                      onChange={e => setNewPos(p => ({ ...p, label_th: e.target.value }))} />
                    <select value={newPos.level} onChange={e => setNewPos(p => ({ ...p, level: e.target.value }))} title="ระดับงาน — ใช้ตัดสินว่าใครทำ AM ใครทำ PM">
                      {POSITION_LEVELS.map(l => <option key={l.key} value={l.key}>{l.label}</option>)}
                    </select>
                    <button type="button" onClick={addPosition} disabled={newPosSaving}
                      style={{ whiteSpace: 'nowrap', padding: '8px 12px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: 'var(--accent-ink)', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: newPosSaving ? 0.6 : 1 }}>
                      {newPosSaving ? '...' : 'บันทึกตำแหน่ง'}
                    </button>
                  </div>
                )}
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                  ตำแหน่งจริงในโรงงาน — ใช้แสดงตัวตน/รายงาน/ลายเซ็น <b>ไม่มีผลต่อสิทธิ์</b>
                  {(() => {
                    const lv = levelOfPosition(form.position);
                    return lv ? <> · ระดับงาน: <b style={{ color: 'var(--text2)' }}>{levelMeta(lv)?.label}</b></> : null;
                  })()}
                </div>
                {/* ⚠️ คำเตือน "ระดับงานไม่ตรงกับสิทธิ์ที่ให้" — แนะนำเท่านั้น ไม่บล็อก (หน้างานมีข้อยกเว้นเสมอ)
                    เคสจริงที่จับได้: ธุรการ (ระดับสนับสนุน) ที่ role ซ่อมบำรุง ได้สิทธิ์อนุมัติ PM เต็ม */}
                {(() => {
                  const kind = maintenanceKindOfPosition(form.position);   // 'am' | 'pm' | 'both' | null
                  if (!form.position || !levelOfPosition(form.position)) return null;
                  const hasPm = can('pm', 'record', form.role) || can('pm', 'approve', form.role);
                  const hasAm = can('am', 'record', form.role);
                  const msgs = [];
                  if (kind === null && (hasPm || hasAm))
                    msgs.push(`ตำแหน่งนี้เป็นสายสนับสนุน แต่ชุดสิทธิ์ที่เลือกให้บันทึก/อนุมัติผลตรวจได้ — ตรวจอีกครั้งว่าตั้งใจ`);
                  if (kind === 'am' && hasPm)
                    msgs.push(`ตำแหน่งนี้เป็นระดับหน้างาน (AM) แต่ชุดสิทธิ์ให้ทำงาน PM ของช่างได้ด้วย`);
                  if (kind === 'pm' && !hasPm)
                    msgs.push(`ตำแหน่งนี้เป็นช่าง (PM) แต่ชุดสิทธิ์ที่เลือกยังบันทึกผลตรวจ PM ไม่ได้`);
                  if (!msgs.length) return null;
                  return (
                    <div style={{ marginTop: 6, padding: '6px 9px', borderRadius: 7, fontSize: 11, lineHeight: 1.5,
                      background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.45)', color: 'var(--text)' }}>
                      ⚠️ {msgs.join(' · ')}
                      <div style={{ color: 'var(--muted)', marginTop: 2 }}>
                        เป็นแค่คำแนะนำ — สิทธิ์จริงคุมที่ 🔐 จัดการสิทธิ์ (ปรับได้ตามหน้างาน)
                      </div>
                    </div>
                  );
                })()}
              </div>

              <div style={{ gridColumn: '1 / -1', fontSize: 12, fontWeight: 800, color: 'var(--accent2)', borderBottom: '1px solid var(--border)', paddingBottom: 5, marginTop: 4 }}>
                🔐 สิทธิ์การใช้งานในระบบ (ไม่เกี่ยวกับตำแหน่งงานข้างบน)
              </div>
              {/* 🧭 3 ช่องข้างล่างตอบคนละคำถาม — เขียนไว้ตรงนี้ที่เดียว (15/10 · คำสั่ง user
                  "ตอนตั้งสิทธิ์ก็ดูจะคลุมเครือ สรุปช่องนี้คือสิทธิ์ หรือส่วนงาน") */}
              <div style={{ gridColumn: '1 / -1', fontSize: 11.5, lineHeight: 1.75, color: 'var(--muted)',
                background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8, padding: '8px 10px' }}>
                <div><b style={{ color: 'var(--text2)' }}>① ชุดสิทธิ์ (Role)</b> = <b>กดอะไรได้</b> — เปิดหน้า/ปุ่มไหนบ้าง · <u>ไม่ได้บอกว่าสังกัดหน่วยไหน</u></div>
                <div><b style={{ color: 'var(--text2)' }}>② ขอบเขตการมองเห็น</b> = <b>เห็นข้อมูลของใคร</b> — กว้าง/แคบ</div>
                <div><b style={{ color: 'var(--text2)' }}>③ ส่วนงาน + ขอบเขตส่วนงาน</b> = <b>แก้ข้อมูลของใครได้</b> (ใหม่ 15/10) — ไม่ใช่ของตัวเอง = ดูได้ แก้ไม่ได้</div>
                <div><b style={{ color: 'var(--text2)' }}>④ Cost Center ที่รับผิดชอบ</b> = <b>แก้ข้อมูลของใครได้ "ตามลำดับชั้น"</b> (ใหม่ 16/10) — ติ๊กชั้นส่วนงาน ได้ทุกหน่วยใต้ลงไป · <b>ไม่ติ๊ก = ใช้ ③ เหมือนเดิม</b></div>
              </div>

              <div>
                <label style={labelSt}>① ชุดสิทธิ์การใช้งาน (Role) — <span style={{ fontWeight: 600, color: 'var(--muted)' }}>"กดอะไรได้" ไม่ใช่ "สังกัดหน่วยไหน"</span></label>
                <select value={form.role} onChange={e => setF('role', e.target.value)}>
                  <RoleOptGroups withDesc />
                </select>
                {/* สรุปหน้าเข้าได้จริงของ role ที่เลือก — อ่านสดจากตารางสิทธิ์ ไม่ hardcode */}
                {(() => {
                  const sum = accessSummaryForRole(form.role);
                  return (
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5, lineHeight: 1.5 }}>
                      {sum.all
                        ? '✅ role นี้เข้าได้ทุกหน้า'
                        : sum.total === 0
                          ? '⚠️ role นี้ยังไม่ถูกเปิดสิทธิ์หน้าไหนเลย — ไปเปิดที่เมนู 🔐 จัดการสิทธิ์'
                          : <>เข้าได้ <b>{sum.total} หน้า</b> ในหมวด: {sum.groups.join(' · ')} — ปรับรายหน้าได้ที่เมนู 🔐 จัดการสิทธิ์</>}
                    </div>
                  );
                })()}
                {/* 🔐 ใบผ่านข้ามหน่วยงาน — แอดมินต้องเห็นว่า role นี้แก้ของส่วนงานอื่นได้ไหม (15/10) */}
                <div style={{ fontSize: 11, marginTop: 4, lineHeight: 1.5,
                  color: can('scope', 'all_units', form.role) ? '#f59e0b' : 'var(--muted)' }}>
                  {can('scope', 'all_units', form.role)
                    ? '🌐 role นี้ถือใบผ่าน scope:all_units — แก้ข้อมูลข้ามส่วนงานได้ทั้งโรงงาน'
                    : '🔒 role นี้แก้ได้เฉพาะส่วนงานของตัวเอง (ข้อ ③ ข้างล่าง) — ของส่วนงานอื่นดูได้ แต่แก้ไม่ได้'}
                </div>
              </div>

              {/* 🔭 ความกว้างของการมองเห็น — คนละแกนกับ role (role = ทำอะไรได้ · อันนี้ = เห็นกว้างแค่ไหน)
                  ที่มา user: "job level manager มองได้หมด ซึ่งความจริงต้องดูว่าอยู่แผนกไหน ส่วนงานไหน"
                  🔴 ค่าเริ่มต้นต้องแคบเสมอ — "ทั้งโรงงาน" ต้องเป็นการเลือกที่เห็นได้ ไม่ใช่ผลของการเว้นว่าง
                     (deny by default · docs/ACCESS-CONTROL-STANDARDS.md §2) */}
              <div style={{ gridColumn: '1 / -1' }}>
                {(() => {
                  const lvl = levelOfPosition(form.position);
                  const suggested = depthForLevel(lvl);
                  return (
                    <>
                      <label style={labelSt}>② ขอบเขตการมองเห็น — <span style={{ fontWeight: 600, color: 'var(--muted)' }}>"เห็นข้อมูลของใคร"</span></label>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {SCOPE_DEPTHS.map(d => {
                          const m = SCOPE_DEPTH_META[d];
                          const on = (form.scopeDepth || 'unit') === d;
                          const wide = d === 'all';
                          const col = wide ? '#f59e0b' : '#4d9fff';
                          return (
                            <button key={d} type="button" title={m.desc}
                              onClick={() => setF('scopeDepth', d)}
                              style={{ padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                                cursor: 'pointer', background: on ? `${col}22` : 'var(--bg2)',
                                border: `1px solid ${on ? col : 'var(--border2)'}`,
                                color: on ? col : 'var(--text2)' }}>
                              {m.icon} {m.label}
                              {d === suggested && <span style={{ fontSize: 11, opacity: 0.75 }}> · แนะนำ</span>}
                            </button>
                          );
                        })}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                        {SCOPE_DEPTH_META[form.scopeDepth || 'unit'].desc}
                        {lvl && <> · ระดับ <b>{levelMeta(lvl)?.label || lvl}</b> ปกติใช้
                          “{SCOPE_DEPTH_META[suggested].label}” — <b>ตั้งต่างจากที่แนะนำได้</b> ของจริงมีข้อยกเว้นเสมอ</>}
                        {!lvl && <> · ยังไม่ได้เลือกตำแหน่ง — เลือกแล้วระบบจะแนะนำความกว้างที่เหมาะให้</>}
                      </div>
                      {form.scopeDepth === 'all' && (
                        <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 4, lineHeight: 1.5 }}>
                          ⚠️ <b>เห็นทุกส่วนงานทั้งโรงงาน</b> — รวมถึงได้รับแจ้งเตือนของทุกฝ่ายด้วย
                          <br />ให้เฉพาะคนที่ต้องดูข้ามฝ่ายจริงๆ (ผู้บริหาร · QA · ช่างที่ดูแลทั้งโรงงาน)
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelSt}>
                  ③ ขอบเขตส่วนงาน (Section) — <span style={{ fontWeight: 600, color: 'var(--muted)' }}>"แก้ข้อมูลของใครได้"</span>
                  {form.role === 'supervisor' && <span style={{ color: 'var(--red)' }}> * จำเป็นอย่างน้อย 1</span>}
                </label>
                {/* 🔐 15/10 — ช่องนี้ไม่ใช่แค่ตัวกรองการดูอีกแล้ว มันคือด่าน "แก้ของคนอื่นไม่ได้"
                    ต้องเขียนบอกตรงนี้ ไม่งั้นแอดมินงงว่าทำไมคนนั้นกดบันทึกไม่ผ่าน */}
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 5, lineHeight: 1.6 }}>
                  ช่องนี้คุม <b>2 แกนพร้อมกัน</b> — <b>เห็น:</b> ไม่ติ๊กเลย = เห็นทุกส่วนงาน ·
                  <b>แก้:</b> ติ๊กไว้เท่าไหร่ แก้ได้เท่านั้น · <b>ไม่ติ๊กเลย = แก้อะไรไม่ได้</b> (ดูได้อย่างเดียว)
                  {' '}— ส่วนงานของพนักงานคนนี้ตั้งที่ทะเบียนพนักงาน <code>/operator</code>
                  {' · '}คนที่งานเป็นงานทั้งโรงงานจริง (QA · สโตร์ · PE) ให้เปิดคีย์ <code>scope:all_units</code> ที่เมนู 🔐 จัดการสิทธิ์
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '8px 10px', background: 'var(--bg3)', borderRadius: 8, border: '1px solid var(--border2)' }}>
                  {sectionOpts.length === 0 && <span style={{ fontSize: 12, color: 'var(--muted)' }}>ไม่มีข้อมูล Section</span>}
                  {/* ส่วนงานผลิต + แผนกขึ้นตรงฝ่าย + ค่าเก่าที่ไม่อยู่ในทะเบียน
                      (pattern เดียวกับ positionOptionsWith) — **ห้ามซ่อนค่าที่ตั้งไว้แล้ว**
                      ไม่งั้นคนอ่านหน้าจอเข้าใจว่า "ยังไม่ได้ตั้ง" ทั้งที่ตั้งไว้ */}
                  {[...new Set([...sectionOpts, ...orphanDeptOpts, ...form.sections])].map(s => {
                    const checked = form.sections.includes(s);
                    const isOrphan  = orphanDeptOpts.includes(s);
                    const offList   = !sectionOpts.includes(s) && !isOrphan;   // ค่าเก่านอกทะเบียน
                    return (
                      <label key={s} title={isOrphan ? 'แผนกขึ้นตรงฝ่าย — ไม่ได้สังกัดส่วนงานผลิต'
                                          : offList ? 'ค่าเดิมที่ไม่มีในผังองค์กรแล้ว — ยังใช้งานอยู่ ติ๊กออกได้ถ้าไม่ต้องการ' : ''}
                        style={{
                        display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer',
                        padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600, userSelect: 'none',
                        background: checked ? 'rgba(77,159,255,0.15)' : 'var(--bg2)',
                        border: `1px ${offList ? 'dashed' : 'solid'} ${checked ? 'rgba(77,159,255,0.5)' : 'var(--border2)'}`,
                        color: checked ? '#4d9fff' : 'var(--text2)',
                      }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setF('sections', checked ? form.sections.filter(x => x !== s) : [...form.sections, s])}
                          style={{ margin: 0 }}
                        />
                        {isOrphan ? `🏛️ ${s}` : s}{offList ? ' ⚠' : ''}
                      </label>
                    );
                  })}
                </div>
                {/* กติกาสำคัญ (ไม่ติ๊ก = เห็นทุกส่วนงาน) เห็นตลอด · เหตุผล/ข้อควรระวังพับไว้ */}
                <InfoMore size={11} style={{ marginTop: 4 }} id="au_sections"
                  lead={<>เลือกได้หลายส่วนงาน — เห็นข้อมูลเฉพาะที่ติ๊ก · <b>ไม่ติ๊กเลย = เห็นทุกส่วนงาน</b>
                    {orphanDeptOpts.length > 0 && <> · 🏛️ = <b>แผนกขึ้นตรงฝ่าย</b> (QA / ช่าง — ไม่ได้สังกัดส่วนงานผลิต)</>}</>}>
                  ใช้ได้กับทุกชุดสิทธิ์ (เช่น สิทธิ์ทั้งฝ่าย ที่ดูแลเฉพาะบางส่วน)
                  <br />💡 ขอบเขตนี้มีผลกับ<b>ข้อมูลฝ่ายผลิต</b> (พนักงาน/ไลน์/เช็คชื่อ/รายงาน) — สาย Logistic/Store/ขาย <b>ไม่ต้องติ๊ก</b> เพราะโมดูล Logistic ไม่ได้แบ่งข้อมูลตามส่วนงาน ใช้ Role คุมการเข้าหน้าแทน
                </InfoMore>
              </div>

              {/* ④ 💰 Cost Center ที่รับผิดชอบ — ชั้นสิทธิ์ที่ 3 "แกนใหม่" (16/10 · คำสั่ง user
                  "เซ็ตได้ว่า user ไหน response กับ cost center ไหน **ตามลำดับชั้น** ถ้า response
                   ชั้นส่วน 46 ก็ response ได้ทั้งหมดลงไป")
                  🔴 จอนี้ไม่ใช่ด่าน — ด่านจริงคือ `canWriteScope()` ในฟังก์ชันที่เขียน DB */}
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelSt}>
                  ④ Cost Center ที่รับผิดชอบ — <span style={{ fontWeight: 600, color: 'var(--muted)' }}>“แก้ข้อมูลของใครได้ ตามลำดับชั้น”</span>
                </label>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 5, lineHeight: 1.6 }}>
                  ติ๊ก<b>ชั้นส่วนงาน</b> = ได้ทุกแผนก/ไลน์/ทีมที่อยู่<b>ใต้ลงไป</b>ทั้งหมด — ไม่ต้องติ๊กลูกทีละตัว ·
                  <b> ไม่ติ๊กเลย = ใช้ ③ ส่วนงาน เหมือนเดิม</b> (บัญชีเดิมพฤติกรรมไม่เปลี่ยน)
                  <br />🔴 ลำดับชั้นมาจาก<b>ผังองค์กร</b> ไม่ใช่ตัวเลขรหัส — ลูกของ <code>2140461000</code> (PD1) คือ <code>2140561001</code> หลักที่ 5 เปลี่ยน 4→5
                  {' · '}รหัสของแต่ละหน่วยตั้งที่ <code>/org-setup</code>
                </div>

                {/* 💡 ค่าที่ระบบอ่านได้เองจากพนักงานที่ผูกไว้ — กันคนตั้งค่าเดารหัสผิด */}
                {ccFromEmp && (
                  <div style={{ fontSize: 11, lineHeight: 1.6, marginBottom: 5, padding: '6px 9px', borderRadius: 7,
                    background: 'rgba(77,159,255,0.10)', border: '1px solid rgba(77,159,255,0.40)', color: 'var(--text)' }}>
                    💡 พนักงานที่ผูกกับบัญชีนี้สังกัดหน่วยที่ CC <code>{ccFromEmp.cc}</code>
                    {ccFromEmp.from ? <> ({ccFromEmp.from}{ccFromEmp.inherited ? ' · ตกทอดจากหน่วยแม่' : ''})</> : null}
                    {!form.respCcs.includes(ccFromEmp.cc) && (
                      <button type="button" onClick={() => toggleCc(ccFromEmp.cc)}
                        style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                          cursor: 'pointer', background: 'var(--accent)', color: 'var(--accent-ink)', border: 'none' }}>
                        ＋ ใช้รหัสนี้
                      </button>
                    )}
                  </div>
                )}

                {!ccReady && <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>กำลังโหลดผังองค์กร…</div>}
                {/* 🔴 โหลดแล้วแต่ไม่มีรหัสเลย = ผังยังไม่ได้ผูก CC — ต้องเขียนบอก ห้ามโชว์กล่องว่างเฉยๆ */}
                {ccReady && ccRows.length === 0 && (
                  <div style={{ fontSize: 11.5, color: '#f59e0b', lineHeight: 1.6 }}>
                    ⚠️ ผังองค์กรยังไม่มีหน่วยไหนผูกรหัส Cost Center เลย — ไปกรอกที่ <code>/org-setup</code> ก่อน
                    จึงจะตั้งช่องนี้ได้ (ระหว่างนี้ใช้ ③ ส่วนงาน ตามเดิม)
                  </div>
                )}

                {ccReady && ccRows.length > 0 && (() => {
                  const kw = nzThai(ccSearch.trim());
                  const shown = kw
                    ? ccRows.filter(r => nzThai(`${r.cc} ${r.name} ${r.pathText}`).includes(kw))
                    : ccRows;
                  const hiddenByKw = ccRows.length - shown.length;
                  return (
                    <>
                      <div style={{ marginBottom: 5 }}>
                        <SearchInput value={ccSearch} onChange={setCcSearch} placeholder="ค้นรหัส / ชื่อหน่วยงาน…" />
                      </div>
                      <div style={{ maxHeight: 260, overflowY: 'auto', padding: '6px 8px', background: 'var(--bg3)',
                        borderRadius: 8, border: '1px solid var(--border2)', display: 'grid', gap: 3, alignContent: 'start' }}>
                        {shown.length === 0 && <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>ไม่พบรหัสที่ค้น</span>}
                        {shown.map((r) => {
                          const on  = form.respCcs.includes(r.cc);
                          const nCov = (ccCov.covers[r.cc] || []).length;
                          const red  = ccCov.redundant[r.cc];
                          const meta = SCOPE_KIND_META[r.kind];
                          return (
                            <label key={r.cc} title={r.pathText}
                              style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 7, cursor: 'pointer', userSelect: 'none',
                                padding: '4px 8px', borderRadius: 6, fontSize: 12,
                                /* เยื้องตามชั้นเพื่อให้อ่านออกว่าใครอยู่ใต้ใคร — เพดาน 3 ชั้นไม่ให้ล้นจอแคบ
                                   (ชั้นลึกกว่านั้นยังบอกที่อยู่เต็มใน tooltip `pathText`) */
                                marginLeft: Math.min(r.depth, 3) * 12,
                                background: on ? 'rgba(34,197,94,0.14)' : 'var(--bg2)',
                                border: `1px ${r.orphan ? 'dashed' : 'solid'} ${on ? 'rgba(34,197,94,0.55)' : 'var(--border2)'}` }}>
                              <input type="checkbox" checked={on} onChange={() => toggleCc(r.cc)} style={{ margin: 0, width: 'auto' }} />
                              <span style={{ fontWeight: 700, color: on ? '#22c55e' : 'var(--text2)' }}>
                                {meta?.icon || '•'} {r.name}
                              </span>
                              <code style={{ fontSize: 11, color: 'var(--muted)' }}>{r.cc}</code>
                              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{meta?.short || r.kind}</span>
                              {on && nCov > 0 && (
                                <span style={{ fontSize: 11, fontWeight: 700, color: '#22c55e' }}>⤵ ครอบอีก {nCov} หน่วย</span>
                              )}
                              {red && (
                                <span style={{ fontSize: 11, color: 'var(--muted)' }}>⊂ ซ้ำซ้อน — อยู่ใต้ {red} ที่ติ๊กไว้แล้ว</span>
                              )}
                              {r.orphan && (
                                <span style={{ fontSize: 11, color: '#f59e0b' }}>🏚️ หน่วยแม่ไม่ได้ใช้งาน</span>
                              )}
                            </label>
                          );
                        })}
                      </div>
                      {/* 🔴 กรองแถวออกแล้วต้องบอกว่าซ่อนไปกี่รายการ (กฎความซื่อสัตย์ของจอ) */}
                      {hiddenByKw > 0 && (
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
                          ซ่อนอยู่ {hiddenByKw} รหัสเพราะคำค้น — ล้างช่องค้นเพื่อดูทั้งหมด {ccRows.length} รหัส
                        </div>
                      )}
                    </>
                  );
                })()}

                {/* สรุปผล + รหัสที่ผังไม่รู้จัก (ห้ามซ่อนค่าที่ตั้งไว้แล้ว) */}
                <div style={{ fontSize: 11, marginTop: 5, lineHeight: 1.6, color: 'var(--muted)' }}>
                  {form.respCcs.length === 0
                    ? <>ยังไม่ติ๊ก — ชั้นสิทธิ์ที่ 3 จะใช้ <b>③ ส่วนงาน</b> ({form.sections.length ? form.sections.join(' · ') : 'ยังไม่ได้ตั้ง → แก้ข้อมูลไม่ได้เลย'}) ตามเดิม</>
                    : <>ติ๊กไว้ <b style={{ color: '#22c55e' }}>{form.respCcs.length} รหัส</b> — ชนะ ③ ส่วนงาน (เมื่อมีรหัสแล้ว ระบบใช้แกนนี้ตัดสิน)</>}
                  {can('scope', 'all_units', form.role) && (
                    <><br />🌐 role นี้ถือ <code>scope:all_units</code> อยู่แล้ว — แก้ได้ทั้งโรงงานไม่ว่าติ๊กอะไรไว้ (ค่าที่ติ๊กยังถูกเก็บไว้ เผื่อถอดใบผ่านทีหลัง)</>
                  )}
                </div>
                {ccUnknown.length > 0 && (
                  <div style={{ fontSize: 11, marginTop: 4, padding: '6px 9px', borderRadius: 7, lineHeight: 1.6,
                    background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.45)', color: 'var(--text)' }}>
                    ⚠️ รหัสที่ตั้งไว้แต่<b>ไม่มีในผังองค์กรแล้ว</b>: {ccUnknown.map(cc => <code key={cc} style={{ marginRight: 6 }}>{cc}</code>)}
                    <div style={{ color: 'var(--muted)', marginTop: 2 }}>
                      ระบบหาหน่วยเจ้าของไม่ได้ ⇒ <b>ใช้ตัดสินสิทธิ์ไม่ได้</b> (ตกเป็น “ไม่รู้” = แก้ไม่ได้) —
                      ติ๊กรหัสที่ถูกต้องเพิ่ม แล้วถอดรหัสนี้ออก
                      {ccUnknown.map(cc => (
                        <button key={cc} type="button" onClick={() => toggleCc(cc)}
                          style={{ marginLeft: 6, padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                            cursor: 'pointer', background: 'var(--bg2)', color: 'var(--text2)', border: '1px solid var(--border2)' }}>
                          ถอด {cc}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* ทีมช่างซ่อม — แยกคิวใบแจ้งซ่อม MO (โผล่เฉพาะ role งานซ่อม) · แยกจาก Section ไม่กระทบ scope ข้อมูลผลิต */}
              {isMtnTeamRole(form.role) && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelSt}>🔧 ทีมช่างซ่อม (แยกคิวใบแจ้งซ่อม MO + บอกว่าอยู่ฝั่งช่าง)</label>
                  {/* 🔒 ช่องนี้ตัดสิน "ฝั่ง" ของด่านล็อกช่องเซ็นขั้น 6/7/8 ด้วย — ต้องเขียนบอกคนตั้งค่า
                      ไม่งั้น ผจก.ช่างที่ไม่ได้ติ๊กจะกดช่องของตัวเองไม่ได้ แล้วหาสาเหตุไม่เจอ */}
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', margin: '-2px 0 6px', lineHeight: 1.6 }}>
                    ติ๊ก = <b>ฝั่งซ่อมบำรุง</b> (กดช่องเซ็น “หัวหน้าแผนกช่าง” / “ผจก.ช่าง” ในใบ MO ได้) ·
                    ไม่ติ๊ก = <b>ฝั่งผู้แจ้ง</b> (กดช่อง “ผจก.ฝ่ายที่แจ้ง อนุมัติปิดใบ” ได้)
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '8px 10px', background: 'var(--bg3)', borderRadius: 8, border: '1px solid var(--border2)' }}>
                    {/* 2026-09-07: วนทีมจาก mtn_teams (pmTeamsSync — data-driven) แทน MTN_TEAMS hardcode · ค่าที่เก็บ = key เสมอ */}
                    {pmTeamsSync().map(team => {
                      const t = team.key;
                      const checked = (form.mtnTeams || []).some(x => teamKeyOf(x) === t);
                      return (
                        <label key={t} style={{
                          display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer',
                          padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600, userSelect: 'none',
                          background: checked ? 'rgba(245,158,11,0.15)' : 'var(--bg2)',
                          border: `1px solid ${checked ? 'rgba(245,158,11,0.5)' : 'var(--border2)'}`,
                          color: checked ? 'var(--accent2)' : 'var(--text2)',
                        }}>
                          <input type="checkbox" checked={checked}
                            onChange={() => setF('mtnTeams', checked ? form.mtnTeams.filter(x => teamKeyOf(x) !== t) : [...form.mtnTeams, t])}
                            style={{ margin: 0 }} />
                          {team.icon ? `${team.icon} ` : ''}{deptNameOf(t)}
                        </label>
                      );
                    })}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, lineHeight: 1.5 }}>
                    เลือกทีมที่ user คนนี้สังกัด — หน้าแจ้งซ่อม (MO) จะ<b>โชว์คิวของทีมนี้ก่อน</b> + เดาหน่วยงานปลายทางตอนแจ้ง · ช่างฝ่ายผลิตที่ first-response เลือก <b>PRODUCTION</b> · ไม่ติ๊กเลย = เห็นคิวทุกทีม
                    {/* ช่องนี้เป็น "ครึ่งหนึ่ง" ของการตั้งช่างฝ่ายผลิต — ต้องบอกอีกครึ่งไว้ตรงนี้ด้วย
                        ไม่งั้น admin ติ๊กทีมแล้วงงว่าทำไมเขายังกดรับงานไม่ได้ (ข้อความอีกชุดอยู่ในใบซ่อม ซึ่ง admin ไม่ได้เปิด) */}
                    <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px dashed var(--border)' }}>
                      🔧 <b style={{ color: 'var(--text2)' }}>ช่างของฝ่ายผลิต</b> — ไม่มี role เฉพาะ ใช้ role ตามขอบเขตที่ดูแล (ระดับไลน์ / ระดับส่วน) แล้วติ๊กทีมที่นี่
                      · ให้เขา<b>รับงาน-ซ่อม-ตรวจ (ขั้น 2-4) ของใบทีมตัวเอง</b>ได้ ต้องเปิดคีย์ <code>mtn_repair:service_own_team</code> ให้ role นั้นที่ <b>/permissions</b> ด้วย
                      <b> (ต้องครบทั้ง 2 อย่าง)</b>
                    </div>
                  </div>
                </div>
              )}

              {/* แอดมินหน่วยงาน — ชั้น 2 (แก้/ตั้งค่า/อนุมัติ เฉพาะหน่วยงานตัวเอง) ซ้อนบน role เดิม · โผล่ทุก role ยกเว้น admin/display */}
              {DEPT_ADMIN_ELIGIBLE(form.role) && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '10px 12px', borderRadius: 8,
                    background: form.deptAdmin ? 'rgba(234,179,8,0.12)' : 'var(--bg3)', border: `1px solid ${form.deptAdmin ? 'rgba(234,179,8,0.55)' : 'var(--border2)'}` }}>
                    <input type="checkbox" checked={!!form.deptAdmin} onChange={e => setF('deptAdmin', e.target.checked)} style={{ margin: 0, width: 'auto' }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: form.deptAdmin ? '#eab308' : 'var(--text)' }}>🛡️ เป็นแอดมินหน่วยงาน</span>
                  </label>
                  <InfoMore size={11} style={{ marginTop: 4 }} id="au_deptadmin"
                    lead={<>ให้สิทธิ์ <b>แก้ข้อมูล master/ตั้งค่า/อนุมัติ</b> เฉพาะหน่วยงานของตัวเอง · ไม่ติ๊ก = ใช้งานได้อย่างเดียว</>}>
                    ครอบเฉพาะหน้าที่ role นี้เข้าถึงได้อยู่แล้ว — <b>ไม่ใช่ admin ระบบ</b>
                    (ไม่ได้จัดการสิทธิ์ / ผังองค์กร / เพิ่ม user ทั้งระบบ)
                    <br />ปรับว่า "แอดมินหน่วยงานทำอะไรได้" ที่หน้าจัดการสิทธิ์ คอลัมน์ 🛡️
                  </InfoMore>
                </div>
              )}

              {/* บัญชีของคนที่ผูกพนักงานแล้ว → ทีม/ไลน์ มาจากฐานพนักงาน ล็อกไม่ให้ admin กรอกทับ
                  (ต้นเหตุเดิมของ "ทีมสลับกัน" คือช่องพวกนี้ให้กรอกเองได้) */}
              {(() => {
                const linked = form.accountKind === 'person' && !!form.employeeId;
                /* 🔴 ช่องที่ล็อก ต้องโชว์ "ค่าที่มีผลจริง" ไม่ใช่ค่าที่ค้างในบัญชี (25/09 · feedback user)
                   เกิดจริง: ตีรณา — ฐานพนักงาน team='A' แต่ `profiles.team` เป็น null ⇒ ช่องขึ้น
                   "— เลือก —" ทั้งที่ป้ายเขียนว่า "จากฐานพนักงาน" = จอโกหก แล้วกดแก้ก็ไม่ได้เพราะล็อกไว้
                   ตัวตัดสินจริงอยู่ที่ App.jsx: `emp.team ?? profiles.team` (ฐานพนักงานชนะเมื่อมีค่า)
                   ⇒ ที่นี่ต้องคิดด้วยสูตรเดียวกัน ห้ามอ่าน form.team เฉยๆ ตอน linked */
                const emp = linked ? empById[form.employeeId] : null;
                const effTeam = linked ? (emp?.team ?? form.team ?? '') : form.team;
                const effLine = linked ? (emp?.line_id ?? form.lineId ?? '') : form.lineId;
                /* ลิงก์ออกจากทางตัน — ช่องที่แก้ที่นี่ไม่ได้ ต้องบอกว่าไปแก้ที่ไหน และพาไปถึงตัวคน
                   (เดิมบอกไว้ใน `title` อย่างเดียว = ต้องเอาเมาส์ไปจ่อถึงจะเห็น มือถือไม่มีทางรู้เลย) */
                const empLink = emp
                  ? `/operator?q=${encodeURIComponent(emp.employee_id_code || emp.name || '')}`
                  : '/operator';
                const fixHint = linked && (
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                    แก้ค่านี้ที่ <a href={empLink} style={{ color: 'var(--accent)', fontWeight: 600 }}>
                      👥 ฐานข้อมูลพนักงาน →</a> (หัวหน้าแผนกเป็นคนดูแล)
                  </div>
                );
                return (<>
                  <div>
                    <label style={labelSt}>
                      Team {form.role === 'leader' && !linked && <span style={{ color: 'var(--red)' }}>* จำเป็น</span>}
                      {linked && <span style={{ color: 'var(--muted)', fontWeight: 400 }}> · จากฐานพนักงาน</span>}
                    </label>
                    <select value={effTeam} disabled={linked}
                      title={linked ? 'แก้ที่ฐานข้อมูลพนักงาน (หน้าพนักงาน) — ที่นี่แสดงค่าจริงเท่านั้น' : undefined}
                      onChange={e => setF('team', e.target.value)}>
                      <option value="">— เลือก —</option>
                      {teamOpts.map(t => <option key={t} value={t}>Team {t} {TEAM_DESC[t] || ''}</option>)}
                    </select>
                    {/* Team ของบัญชีไม่ได้บอกแค่ "เข้ากะไหน" แต่คุม "เห็นใครบ้าง" ในหน้าเช็คชื่อด้วย
                        ต้องเขียนไว้ตรงนี้ ไม่งั้น admin เลือก A/B ให้หัวหน้าที่ดูแลทั้งไลน์แล้วเขาเห็นคนไม่ครบ */}
                    {form.role === 'leader' && (
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, lineHeight: 1.5 }}>
                        Team คุม<b>ขอบเขตการมองเห็น</b>ในหน้าเช็คชื่อด้วย ไม่ใช่แค่กะ —
                        {' '}<b>A / B</b> = เห็นเฉพาะคนทีมเดียวกันในไลน์ตัวเอง ·
                        {' '}<b style={{ color: 'var(--text2)' }}>C</b> = ไม่หมุนกะ <b>เห็นคนทั้งไลน์ทุกทีม</b> (สำหรับหัวหน้าที่ไม่ได้ยืนประจำกะ)
                      </div>
                    )}
                    {fixHint}
                  </div>

                  {/* ใช้ <LineSelect> ตัวกลาง (มีลำดับชั้น/scope/ไลน์ปลดระวาง) + ล็อกเมื่อผูกพนักงาน */}
                  <div title={linked ? 'แก้ที่ฐานข้อมูลพนักงาน (หน้าพนักงาน) — ที่นี่แสดงค่าจริงเท่านั้น' : undefined}>
                    <label style={labelSt}>
                      ไลน์ผลิต / Group {form.role === 'leader' && !linked && <span style={{ color: 'var(--red)' }}>* จำเป็น</span>}
                      {linked && <span style={{ color: 'var(--muted)', fontWeight: 400 }}> · จากฐานพนักงาน</span>}
                    </label>
                    <LineSelect lines={lines} value={effLine} valueKey="id" includeSupport
                      disabled={linked} onChange={v => setF('lineId', v)} />
                    {fixHint}
                  </div>
                </>);
              })()}

              {(form.role === 'supervisor' || form.role === 'leader') && (
                <div style={{ gridColumn: '1 / -1', fontSize: 11, color: 'var(--muted)', padding: '8px 10px', background: 'var(--bg3)', borderRadius: 6, lineHeight: 1.5 }}>
                  ⚠️ {form.role === 'supervisor'
                    ? 'สิทธิ์ระดับส่วน เห็นเฉพาะข้อมูลใน Section ที่ติ๊กไว้ — ถ้าไม่กำหนดจะเห็นทุกส่วนงานแบบไม่จำกัด'
                    : 'สิทธิ์ระดับไลน์ เห็นเฉพาะข้อมูลในไลน์+Team ที่กำหนด — ถ้าไม่กำหนดจะเห็นทุกไลน์แบบไม่จำกัด'}
                </div>
              )}

              {/* ⚠️ ช่อง "📬 Notify Email" ถูกถอดออก 2026-08-17 (คำสั่ง user "เราไม่ได้มีระบบ email")
                  ระบบไม่มีการส่งอีเมลเลย — ไม่มี provider ใดๆ ในโปรเจค (resend/sendgrid/smtp/nodemailer = 0 จุด)
                  แจ้งเตือนทั้งหมดไป Telegram (notification_rules) + in-app (notifications) + Web Push
                  ของเดิมเขียนว่า "รับการแจ้งเตือนจากระบบ (4M Changes, ขาดงาน ฯลฯ)" = คำสัญญาที่ระบบทำไม่ได้
                  แอดมินที่กรอกจะเชื่อว่าคนนั้นได้เมล ทั้งที่ไม่มีอะไรถูกส่ง (ตอนถอด: กรอกไว้ 0 จาก 64 คน)
                  คอลัมน์ `profiles.notify_email` **ยังอยู่** (ไม่ drop — ไม่มีข้อมูล ไม่รีบ และเผื่อวันหน้าทำระบบเมลจริง)
                  ถ้าจะเปิดใช้ ต้องมีตัวส่งเมลจริงก่อน แล้วค่อยเอาช่องนี้กลับมา */}

              {error && (
                <div style={{ gridColumn: '1 / -1', padding: '8px 12px', background: 'rgba(231,76,60,0.08)', border: '1px solid rgba(231,76,60,0.2)', borderRadius: 7, color: 'var(--red)', fontSize: 13 }}>
                  ❌ {error}
                </div>
              )}

              <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, marginTop: 4 }}>
                {modalMode === 'edit' && form.role !== 'admin' && (
                  <button type="button" onClick={handleDelete} disabled={loading}
                    title="ลบบัญชีถาวร (ลบตัวเอง/บัญชี admin ไม่ได้)"
                    style={{ padding: '12px 16px', background: 'rgba(239,68,68,0.12)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: loading ? 'default' : 'pointer' }}>
                    🗑 ลบผู้ใช้
                  </button>
                )}
                <button
                  onClick={modalMode === 'create' ? handleCreate : handleUpdate}
                  disabled={loading}
                  style={{ flex: 2, padding: 12, background: loading ? 'var(--muted)' : 'var(--amber)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontFamily: 'var(--font-display)', fontSize: 14, cursor: loading ? 'default' : 'pointer' }}
                >
                  {loading ? 'กำลังบันทึก...' : modalMode === 'create' ? 'สร้าง Account' : 'บันทึก'}
                </button>
                <button
                  onClick={() => setShowModal(false)}
                  style={{ flex: 1, padding: 12, background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border2)', borderRadius: 8, cursor: 'pointer' }}
                >
                  ยกเลิก
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}

const labelSt = {
  display: 'block', fontSize: 12, fontWeight: 600,
  color: 'var(--text2)', marginBottom: 6,
  letterSpacing: '0.05em', textTransform: 'uppercase',
};
