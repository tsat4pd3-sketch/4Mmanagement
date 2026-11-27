import { useState, useEffect, useMemo, useCallback, useContext, useRef } from 'react';
import { isOrphanDept } from '../utils/orgLayers.js';
import { supabase, supabaseDR } from '../supabaseClient';
import { SESSION_STATUSES_DONE } from '../utils/sessionStatus';
import { UserContext } from '../App';
import Page from '../components/Page';
import PageHeader from '../components/PageHeader';
import FilterBar from '../components/FilterBar';
import BoardPager from '../components/BoardPager';
import TimeRangeBar from '../components/TimeRangeBar';
import useTimeRange from '../utils/useTimeRange';
import useFitHeight from '../utils/useFitHeight';
import { packPages, clampPage } from '../utils/boardPager';
import useTabParam, { useMergeParams } from '../utils/useTabParam';
import { useSearchParams } from 'react-router-dom';
import useProductionLines from '../utils/useProductionLines';
import { useLiveBoard } from '../utils/useLiveBoard';
import { LIVE } from '../utils/refreshRates';
import { fetchAllPages, fetchByIds } from '../utils/fetchByIds';
/* 👥 🔴 **บอร์ดนี้ไม่กรอง `staff_kind` เลย — เป็น "ผังองค์กร" ไม่ใช่ "จอนับกำลังคน"**
   (คำสั่ง user 20/10: *"ต้องขึ้นคนให้ครบ ให้ตรงผังก่อน"*)
   บอร์ดวาดแถวของตัวเองครบทุกชั้น: ผู้จัดการ/หัวหน้าส่วน · วิศวกร·เจ้าหน้าที่ · หัวหน้าแผนก ·
   หัวหน้ากลุ่ม · ช่าง · พนักงาน ⇒ กรองกลุ่มไหนออก = **แถวนั้นว่างทั้งที่มีคนอยู่จริง**
   เหตุการณ์จริง: backfill 14/10 ย้าย ผจก./หัวหน้าส่วน/หัวหน้าแผนก/วิศวกร/ธุรการ ไป `support`
   ⇒ ตัวกรองเดิมทำให้หัวผังของทุกส่วนงานขึ้น "ยังไม่มีผู้จัดการ/หัวหน้าส่วนในทะเบียน" เงียบๆ
   🔴 **ปลอดภัยเพราะตัวนับไม่ได้นับจาก "คนที่โหลดมา"** — `staffingOfDept()`/`opsTotal`/`present`
      นับจาก `cols[].ops` (แถวพนักงาน) เท่านั้น · ตำแหน่งสายสนับสนุนทุกตัว (manager/section_head/
      dept_head/engineer/officer/clerk/secretary) ตกแถวหัวผังหมด ไม่มีตัวไหนลงแถวพนักงาน
   🔴 **ห้ามใส่ตัวกรอง staff_kind กลับ** — มีด่าน `staffKindGuard.test.mjs` */
import { inSectionScope, lineScope } from '../utils/sectionScope';
import { orgNodeCompare, orgKey, naturalCompare } from '../utils/listOrder';
import { loadPositions, positionLabel, loadWorkingPositions, applyWorkingPositions } from '../utils/positions';
import { buildScheduleMaps, shiftFromTeam, scheduleTeamFor } from '../utils/shiftAssign';
import { getWorkDate, addDaysStr, getCurrentShift } from '../utils/workDate';
import { ALL } from '../utils/filterLabels';
import { markerScale } from '../utils/markerScale';
import useImgBox from '../utils/useImgBox';
import { mergeBorrowedEmployees, loadBorrowedRange } from '../utils/lineHelpers';
import { canSeeded } from '../utils/permissions';
import ManpowerBoardSetup from '../components/ManpowerBoardSetup';
import { canWriteUnit } from '../utils/writeScope';
import {
  buildManpowerBoard, fourMStatus, layoutPeople, lineFamilyOf, paginateTv, tvCardCapacity,
  describeSlotChanges, summarizeSlotChanges, SLOT_AUDIT_TABLES, SLOT_KIND_META,
  staffingOfDept, summarizeStaffing, rosterOn, stationSkillGaps,
  indexSessions, sessionsOfDeptShift, oeeOfSessions, compareOeeByStaffing, MIN_SHIFTS_TO_COMPARE,
  ATTEND_META, FOUR_M, shiftMeta, SHIFT_META,
  stationsOfLineFamily, lineFamilyDown, lineGroupRoot, lineStaffStatus, lineDeptsOf, boardForLine, lineStaffLabel, personFitState,
} from '../utils/manpowerBoard';
import { skillFit, skillMapOf, pendingMapOf } from '../utils/skillFit';
import { STATUS_COLOR } from '../utils/statusTone';
import { cachedMaster } from '../utils/masterCache';
import Segmented from '../components/Segmented';
import FactoryMiniMap from '../components/FactoryMiniMap';
import { labelAnchor } from '../utils/regionGeom';
import { lineChainIds } from '../utils/lineHierarchy';
import useIsMobile from '../utils/useIsMobile';

import SectionScopeSelect from '../components/SectionScopeSelect';
import { tr as trI18n, dateLocale } from '../utils/i18n';
/* ═══════════════════════════════════════════════════════════════════════════════════════
   🧑‍🤝‍🧑 Manpower Control Board — /manpower-board (2026-10-06 · คำสั่ง user)

   แทนบอร์ดกระดาษหน้าไลน์ 3 แผ่น:
     🧑‍🤝‍🧑 ผังกำลังคน  — ผจก.ส่วน → หัวหน้าแผนก → หัวหน้ากลุ่มรายทีม → การ์ด skill พนักงาน + ช่องว่าง + ช่างประจำไลน์
     🗺️ ผัง LAYOUT   — รูปคนตามจุดงานบนผังไลน์ สีตามกะ (เขียว=กะเช้า · น้ำเงิน=กะดึก)
     🚦 ป้ายสถานะ 4M — MAN/MACHINE/METHOD/MATERIAL ของแต่ละแผนก วันนี้ "ปกติ/ผิดปกติ"

   🔴 อ่านอย่างเดียว — ไม่มีปุ่มเขียน · ย้ายคน/ตั้งจุดประจำ/ตั้ง std ทำที่หน้าเดิม
      (/operator · /line-setup · /management · /shift-organize) — บอร์ดนี้ "ตาม" ทะเบียนเอง
   🔴 กฎจัดผัง/ช่องว่าง/4M อยู่ใน `utils/manpowerBoard.js` ที่เดียว (มีเทส) — ห้ามคิดในหน้า
   ⚠️ ข้อมูลไม่ครบต้องเขียนบนจอ: ตารางกะยังไม่ตั้ง · std ไม่ได้ตั้ง · แผนกเปล่า · ตำแหน่งที่ระบบไม่รู้จัก
   ═══════════════════════════════════════════════════════════════════════════════════════ */

const EMP_COLS = 'id, name, employee_id_code, image_url, position, team, line_id, department, section, org_node_id, staff_kind, start_date';

export default function ManpowerBoard() {
  const { sections: scopeSecs = [], role, lineId: userLineId, section: homeSection, allUnits, respCostCenters, scopeIdx } = useContext(UserContext);
  const [tab, setTab] = useTabParam(['org', 'layout', 'fourm', 'staffing', 'history'], 'org');
  const [params] = useSearchParams();
  const merge = useMergeParams();
  const lines = useProductionLines();
  const [nodes, setNodes] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [skills, setSkills] = useState({ byEmp: {}, defs: {} });
  const [sched, setSched] = useState([]);
  const [attLogs, setAttLogs] = useState([]);
  const [fourM, setFourM] = useState([]);
  const [slotPlans, setSlotPlans] = useState([]);
  const [lineTechs, setLineTechs] = useState([]);
  const [stations, setStations] = useState([]);
  const [stationPlans, setStationPlans] = useState([]);
  const [homeByEmp, setHomeByEmp] = useState({});
  const [helpers, setHelpers] = useState([]);
  const [actingPos, setActingPos] = useState(null);   // 🧭 employee_id → ตำแหน่งที่ปฏิบัติงาน (null = ยังไม่โหลด)
  const [flexUnits, setFlexUnits] = useState([]);   // 🏃 คนวิ่งข้ามแผนก (employee_flex_units)
  const [setupOpen, setSetupOpen] = useState(false);
  const canSetup = canSeeded('manpower_board', 'edit', role);
  /* 🔐 ชั้น ③ — "ส่วนงานที่กำลังตั้งค่าเป็นของหน่วยงานเราไหม" (QC audit 20/10)
     `scopeSecs` = ขอบเขต "ที่เห็น" (**ว่าง = เห็นทั้งโรงงาน**) ⇒ เอามาตัดสินการแก้ไม่ได้ ·
     แผงตั้งค่าเขียน `station_slot_plans` / `manpower_slot_plans` / `line_technicians` /
     `employee_flex_units` ของส่วนงานนั้น และ RLS รู้แค่ `has_perm('manpower_board:edit')` ไม่รู้ขอบเขต */
  const wctx = useMemo(() => ({ role, section: homeSection, sections: scopeSecs, allUnits, respCostCenters, scopeIdx }),
    [role, homeSection, scopeSecs, allUnits, respCostCenters, scopeIdx]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const workDate = getWorkDate();

  // ── master (ผัง + พนักงาน + skill) — โหลดครั้งเดียว ──
  useEffect(() => {
    let alive = true;
    (async () => {
      // รอทะเบียนตำแหน่งก่อนจัดแถว — ไม่งั้นรอบแรกจัดด้วยค่า default แล้วไม่จัดใหม่ (memo ไม่รู้ว่า cache เปลี่ยน)
      const [nRes, eRes, dRes, , actingMap] = await Promise.all([
        supabase.from('org_nodes').select('id, kind, name, code, parent_id, ref_line_id, sort_order, cost_center').eq('is_active', true),
        fetchAllPages(() => supabase.from('employees').select(EMP_COLS).eq('is_active', true)),
        supabase.from('skill_definitions').select('name, label, color, sort_order'),
        loadPositions(),
        /* 🧭 ตำแหน่ง "ที่ปฏิบัติงานจริง" จากบัญชี — บอร์ดนี้ตอบว่า *วันนี้ใครทำหน้าที่อะไร*
           จึงต้องจัดแถวด้วยงานที่ทำ ไม่ใช่ตำแหน่งที่บริษัทบรรจุ (คำสั่ง user 14/10)
           🔴 เป็น **fallback** — มีบัญชีแค่ 45 จาก 220 คน · อ่านไม่ได้ = Map ว่าง = พฤติกรรมเดิมเป๊ะ */
        loadWorkingPositions(),
      ]);
      if (!alive) return;
      const errs = [nRes.error?.message, eRes.error, dRes.error?.message].filter(Boolean);
      setNodes(nRes.data || []);
      /* ทับเฉพาะ `position` ที่ใช้จัดแถว — เก็บของเดิมไว้ที่ `company_position` ให้การ์ดเขียนบอกได้
         ⚠️ ค่าที่คำนวณตอนแสดงผลเท่านั้น **ห้ามเขียนกลับฐาน** (ดู utils/positions.js §ตำแหน่ง 2 ชั้น)
         🔴 เก็บ map ไว้ด้วย — **คนยืมตัวโหลดคนละรอบ ต้องทับด้วยชุดเดียวกัน** ไม่งั้นคนเดียวกัน
            โชว์ "ตำแหน่งที่ทำ" ตอนอยู่ไลน์ตัวเอง แต่โชว์ "ตำแหน่งที่บรรจุ" ตอนถูกยืมไปไลน์อื่น */
      setActingPos(actingMap || null);
      setEmployees(applyWorkingPositions(eRes.rows || [], actingMap));
      const sk = await fetchByIds((eRes.rows || []).map(e => e.id),
        (ids) => supabase.from('employee_skills').select('id, employee_id, skill_name, score, pending_level').in('employee_id', ids));
      if (!alive) return;
      if (sk.error) errs.push(sk.error);
      const byEmp = {};
      for (const r of sk.rows || []) (byEmp[r.employee_id] ||= []).push(r);
      for (const k in byEmp) byEmp[k].sort((a, b) => (b.score || 0) - (a.score || 0));
      setSkills({ byEmp, defs: Object.fromEntries((dRes.data || []).map(d => [d.name, d])) });
      if (errs.length) setErr(errs.join(' · '));
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  // ── ค่าตั้งบอร์ด (ช่องต่อทีม · ช่างประจำไลน์) — โหลดตอนเปิด + หลังแก้ในหน้าต่างตั้งค่า ──
  //    ตารางยังไม่ apply (42P01) = บอร์ดทำงานแบบเดิม (std) แต่ต้องเขียนบนจอ ห้ามเงียบ
  const loadSetup = useCallback(async () => {
    const [sp, lt, ws, ssp, hp, fu] = await Promise.all([
      supabase.from('manpower_slot_plans').select('id, org_node_id, team, slots'),
      supabase.from('line_technicians').select('id, employee_id, line_id'),
      fetchAllPages(() => supabase.from('workstations').select('id, line_id, line_name, station_name')),
      supabase.from('station_slot_plans').select('station_id, per_shift'),
      fetchAllPages(() => supabase.from('employee_home_positions').select('employee_id, station_id'), { orderBy: 'employee_id' }),
      supabase.from('employee_flex_units').select('id, employee_id, org_node_id, note, kind'),
    ]);
    const e = [sp.error?.message, lt.error?.message, ws.error, ssp.error?.message, hp.error, fu.error?.message].filter(Boolean);
    if (e.length) setErr(`${trI18n("ค่าตั้งบอร์ด")}: ${e.join(' · ')}`);
    setSlotPlans(sp.data || []);
    setLineTechs(lt.data || []);
    setStations(ws.rows || []);
    setStationPlans(ssp.data || []);
    setHomeByEmp(Object.fromEntries((hp.rows || []).map(h => [h.employee_id, h.station_id])));
    setFlexUnits(fu.data || []);
  }, []);
  useEffect(() => { loadSetup(); }, [loadSetup]);

  // ── ของวันนี้ (เช็คชื่อ · ตารางกะ · 4M · คนยืมตัว) — สดผ่าน realtime ──
  // ทะเบียนไลน์ผ่าน ref — ห้ามใส่ array ลง deps ของ useCallback ที่ยิง DB (กฎเหล็กข้อ 9)
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const lineCount = lines.length;
  const loadToday = useCallback(async () => {
    // 🤝 คนยืมตัว — ผ่าน mergeBorrowedEmployees() ตัวกลางเท่านั้น (UI §6.13) · ทั้ง 2 กะของวันงาน
    //    ไม่จำกัดขอบเขต (lineIds null + scopeSecs []) แล้วให้ buildManpowerBoard ตัดตามไลน์ของแต่ละแผนกเอง
    //    อ่านไม่ได้ = คืน [] + console.warn (ฟีเจอร์ "เติมคน" พังต้องไม่ทำให้บอร์ดหลักหาย)
    const hp = lineCount ? mergeBorrowedEmployees([], { lines: linesRef.current, columns: EMP_COLS, workDate }) : Promise.resolve([]);
    const [a, s, f, h] = await Promise.all([
      supabase.from('daily_production_logs').select('employee_id, shift, is_present, leave_type, assigned_line').eq('work_date', workDate),
      supabase.from('shift_schedules').select('*').eq('work_date', workDate),
      supabase.from('four_m_logs').select('id, line_name, line_id, category, description, status, created_at').eq('work_date', workDate),
      hp,
    ]);
    const e = [a.error, s.error, f.error].filter(Boolean).map(x => x.message);
    if (e.length) setErr(e.join(' · '));
    setAttLogs(a.data || []);
    setSched(s.data || []);
    setFourM(f.data || []);
    setHelpers(h || []);
  }, [workDate, lineCount]);
  useLiveBoard(loadToday, { tables: ['daily_production_logs', 'four_m_logs', 'line_helpers'], topic: 'manpower-board', client: supabase, tier: LIVE.BOARD });

  // ── ส่วนงานที่เลือกได้ (ตามผัง + scope ของ user) ──
  /* 🏛️ รวม **แผนกขึ้นตรงฝ่าย** (parent_id ว่าง — JIG MTN · QA) เป็นบอร์ดของตัวเองด้วย (20/10)
     เดิมกรองแค่ `kind === 'section'` ⇒ 2 หน่วยนี้ **เปิดบอร์ดไม่ได้เลย** คนในหน่วยไม่เคยขึ้นผัง
     (หลักเดียวกับ ORPHAN_SECTION ใน sectionScope.js — หน่วยจริง มี cost center ของตัวเอง) */
  /* 🔭 ขอบเขตของบัญชี (09/11 · user "แก้ manpower-board ให้ครบด้วยเลย") — แกนเดียวกับทุกจอ = `lineScope()`
     · `unlimited` (admin/ไม่จำกัด/ทะเบียนยังไม่โหลด) = พฤติกรรมเดิมเป๊ะ
     · ส่วนงานที่เลือกได้ = ส่วนงานที่ตั้งไว้ ∪ ส่วนงานของไลน์ในขอบเขต (หัวหน้าไลน์ที่ไม่ได้ตั้งส่วนงาน = ส่วนงานของไลน์ตัวเอง)
     · แผนก: ถ้าบัญชีไม่ได้ถือทั้งส่วนงาน = เหลือเฉพาะแผนกที่มีไลน์ในขอบเขต · `?dept=` นอกขอบเขต = ไม่สน (ห้ามเปิดแผนกนอกขอบเขตจากลิงก์) */
  const scopeKey = scopeSecs.join('|');
  const viewScope = useMemo(() => lineScope({ role, lineId: userLineId, sections: scopeSecs, lines, scopeIdx }),
    [role, userLineId, scopeKey, lines, scopeIdx]); // eslint-disable-line react-hooks/exhaustive-deps
  const scopeNames = useMemo(() => (viewScope.unlimited ? null : new Set(viewScope.names)), [viewScope]);
  const scopeSecKeys = useMemo(() => {
    if (!scopeNames) return null;
    const ks = new Set(scopeSecs);
    for (const l of lines) if (scopeNames.has(l.name) && l.section) ks.add(l.section);
    return ks;
  }, [scopeNames, lines, scopeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const sectionNodes = useMemo(() => nodes
    .filter(n => n.kind === 'section' || isOrphanDept(n, nodes))   // 🏢 ขึ้นตรง = ไม่มีแม่เป็นหน่วย (orgLayers · 04/11)
    .filter(n => (scopeSecKeys
      ? (scopeSecKeys.has(orgKey(n)) || scopeSecKeys.has(n.name))
      : (!scopeSecs.length || inSectionScope(scopeSecs, orgKey(n)) || inSectionScope(scopeSecs, n.name))))
    .sort(orgNodeCompare), [nodes, scopeSecs, scopeSecKeys]);
  const secParam = params.get('sec') || '';
  const section = sectionNodes.find(n => orgKey(n) === secParam) || (secParam && sectionNodes.find(n => n.name === secParam)) || sectionNodes[0] || null;
  const rawDeptParam = params.get('dept') || '';
  // 📺 โหมดจอ TV (ไม่เลื่อน · แบ่งหน้า) — `?tv=1|0` ชนะ · ไม่ระบุ = บัญชี display (จอแขวน) เปิดให้เอง
  const tvParam = params.get('tv');
  const tv = tvParam != null ? tvParam === '1' : role === 'display';

  const attendance = useMemo(() => {
    const m = {};
    for (const r of attLogs) { const cur = m[r.employee_id]; if (!cur || (!cur.is_present && r.is_present)) m[r.employee_id] = r; }
    return m;
  }, [attLogs]);
  const maps = useMemo(() => buildScheduleMaps(sched, lines), [sched, lines]);   // lines = ไลน์ลูกตกทอดกะจากไลน์แม่
  // 🧭 คนยืมตัวโหลดคนละรอบกับ master ⇒ ทับตำแหน่งที่นี่ (memo คิดใหม่เองเมื่อ map มาถึง)
  const helpersPos = useMemo(() => applyWorkingPositions(helpers, actingPos), [helpers, actingPos]);
  const board = useMemo(() => buildManpowerBoard({ section, nodes, employees, lines, maps, attendance, slotPlans, lineTechs, helpers: helpersPos, stations, stationPlans, homeByEmp, flexUnits }),
    [section, nodes, employees, lines, maps, attendance, slotPlans, lineTechs, helpersPos, stations, stationPlans, homeByEmp, flexUnits]);
  /* ถือ "ทั้งส่วนงาน" ไหม — ไม่จำกัด หรือส่วนงานนี้อยู่ในชุดที่ตั้งไว้ตรงๆ (ไม่ใช่แค่ได้มาจากไลน์ตัวเอง) */
  const wholeSection = !scopeNames || (!!section && scopeSecs.length > 0
    && (inSectionScope(scopeSecs, orgKey(section)) || inSectionScope(scopeSecs, section.name)));
  const allowedDepts = useMemo(() => (board?.depts || []).filter(d => wholeSection
    || (d.lines || []).some(l => scopeNames?.has(l.name))), [board, wholeSection, scopeNames]);
  const scopeHiddenDepts = (board?.depts?.length || 0) - allowedDepts.length;
  // `?dept=` ที่ไม่อยู่ในแผนกที่บัญชีเห็นได้ = ไม่สน · ไม่ถือทั้งส่วนงานและเหลือแผนกเดียว = ล็อกที่แผนกนั้น (แท็บแผน/ประวัติต้องไม่กางทั้งส่วนงาน)
  const deptParam = rawDeptParam && allowedDepts.some(d => d.key === rawDeptParam) ? rawDeptParam
    : (!wholeSection && allowedDepts.length === 1 ? allowedDepts[0].key : '');
  const deptIgnored = !!rawDeptParam && !!board && rawDeptParam !== deptParam;
  const deptNode = useMemo(() => (deptParam ? nodes.find(n => String(n.id) === deptParam) || null : null), [nodes, deptParam]);
  const depts = useMemo(() => allowedDepts.filter(d => !deptParam || d.key === deptParam), [allowedDepts, deptParam]);
  /* 🧩 กรองถึงไลน์ (`?lline=` · 23/11 user "ให้แท็บอื่นกรองถึงระดับไลน์ด้วย") — ผังกำลังคน · 4M · แผน vs มาจริง · ประวัติ
     ผ่าน `narrowDeptToLine()` ที่เดียว · 🔴 แท็บผัง LAYOUT ใช้ `depts` เดิม (ต้องเห็นรูปผังของไลน์แม่) */
  const llineName = params.get('lline') || '';
  const lineFam = useMemo(() => (llineName ? lineFamilyDown(lines, llineName) : []), [lines, llineName]);
  const lineFamKey = lineFam.map(l => l.id).join(',');
  // จุดงานของไลน์ที่เลือก (+ลูก) — คนที่วันนี้ยืนจุดเหล่านี้นับเป็นคนของไลน์ (ไม่ต้องย้ายสังกัด · user 23/11)
  const lineStationIds = useMemo(() => new Set(lineFam.length ? stationsOfLineFamily(lines, llineName, stations).map(st => String(st.id)) : []),
    [lineFamKey, llineName, stations]); // eslint-disable-line react-hooks/exhaustive-deps
  const lineDepts = useMemo(() => {
    return lineDeptsOf(depts, lineFam, llineName, { stationIds: lineStationIds });
  }, [depts, lineFamKey, llineName, lineStationIds]); // eslint-disable-line react-hooks/exhaustive-deps
  const lineSelf = lineFam[0] || null;   // getLineFamily คืนตัวเองตัวแรก
  const lineBoard = useMemo(() => (lineFam.length ? boardForLine(board, lineDepts) : board), [board, lineDepts, lineFamKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const filters = (
    <>
      {/* 09/11 (คำสั่ง user "dropdown ไม่เหมือนดึงจากผังองค์กร"): ส่วนงาน + แผนก 2 ช่องแบน → ต้นไม้ผังช่องเดียว
          · หน่วยขึ้นตรงฝ่าย (QA · Tooling MTN) อยู่ในต้นไม้เป็น "แผนก" ⇒ เลือกแล้วเปิดบอร์ดของมันเอง (เหมือนเดิมที่นับเป็น section)
          · `?sec=`/`?dept=` ใน URL เท่าเดิม (dept = id โหนดแผนก) — ลิงก์เดิมยังใช้ได้ */}
      {/* 🧩 23/11 (user "ให้ช่องเลือกส่วนงานเลือกไลน์ลูกได้ด้วย") — `pickLine`: เลือกไลน์ ⇒ ส่วนงาน+แผนกที่ครอบไลน์นั้น + `?lline=`
          (แท็บผัง LAYOUT เปิดผังของไลน์นั้น — ไลน์ลูกไม่มีรูปผัง = ผังแม่ + เขียนบอก) · เลือกส่วนงาน/แผนก = ล้าง `?lline=` */}
      <SectionScopeSelect lines={scopeNames ? viewScope.lines : lines} pickDept pickLine line={params.get('lline') || ''}
        value={section ? orgKey(section) : ''} dept={deptNode ? orgKey(deptNode) : ''}
        allLabel={sectionNodes.length ? trI18n("— เลือกส่วนงาน —") : trI18n("— ไม่มีส่วนงานในขอบเขต —")} width={300}
        onChange={(sec, info) => {
          const deptOf = (unit) => {
            const cands = nodes.filter(n => n.kind === 'department' && orgKey(n) === unit);
            const orphan = cands.find(n => isOrphanDept(n, nodes));
            if (orphan) return { sec: orgKey(orphan), dept: null };   // หน่วยขึ้นตรง = บอร์ดของตัวเอง
            const under = cands.find(n => { const p = nodes.find(x => String(x.id) === String(n.parent_id)); return p && orgKey(p) === sec; }) || cands[0];
            return { sec: sec || null, dept: under ? String(under.id) : null };
          };
          if (info.kind === 'line') {
            const d = info.dept ? deptOf(info.dept) : { sec: sec || null, dept: null };
            merge({ ...d, lline: info.unit, ...(tab === 'layout' ? { lv: 'line' } : {}) });
            return;
          }
          if (info.kind !== 'department') { merge({ sec: sec || null, dept: null, lline: null }); return; }
          merge({ ...deptOf(info.unit), lline: null });
        }} />
      {(scopeHiddenDepts > 0 || deptIgnored || viewScope.unsure) && (
        <span style={{ fontSize: 12, fontWeight: 700, borderRadius: 'var(--r-md)', padding: '3px 8px', whiteSpace: 'nowrap',
          color: viewScope.unsure || deptIgnored ? 'var(--amber)' : 'var(--accent)',
          background: viewScope.unsure || deptIgnored ? 'var(--amber)1a' : 'var(--accent-dim)' }}>
          {viewScope.unsure ? trI18n("⚠ ตัดขอบเขตบัญชีไม่ได้ — แสดงตามที่ตั้งไว้")
            : deptIgnored ? trI18n("⚠ แผนกในลิงก์อยู่นอกขอบเขตของบัญชี — แสดงแผนกที่เห็นได้แทน")
            : `🔭 ${trI18n("เฉพาะแผนกในขอบเขต · ซ่อน")} ${scopeHiddenDepts} ${trI18n("แผนก")}`}
        </span>
      )}
      <span className="spacer" />
      <span style={{ fontSize: 13, color: 'var(--muted)' }}>{trI18n('วันงาน')} {workDate}</span>
    </>
  );

  return (
    <Page>
      <PageHeader
        title="Manpower Control Board" icon="🧑‍🤝‍🧑"
        sub={trI18n('ผังกำลังคน · ผังจุดงาน · ป้ายสถานะ 4M ของส่วนงาน — อ่านอย่างเดียว ตามทะเบียนพนักงาน/ตารางกะ/เช็คชื่อวันนี้')}
        tabs={[
          { key: 'org', label: trI18n("ผังกำลังคน") },
          { key: 'layout', label: trI18n("ผัง LAYOUT") },
          { key: 'fourm', label: trI18n("ป้ายสถานะ 4M") },
          { key: 'staffing', label: trI18n("แผน vs มาจริง") },
          { key: 'history', label: trI18n("ประวัติการเปลี่ยนช่อง") },
        ]}
        tab={tab} onTab={setTab}
        filters={filters}
        actions={(<>
          {canSetup && section && (
            <button type="button" className="pg-btn" onClick={() => setSetupOpen(true)}
              style={{ padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
                border: '1px solid var(--border2)', background: 'var(--bg2-surf)', color: 'var(--text2)' }}
              title={trI18n('ตั้งจำนวนช่องตำแหน่งต่อทีม + ผูกช่างประจำไลน์ (สิทธิ์ manpower_board:edit)')}>{trI18n('ตั้งค่าบอร์ด')}</button>
          )}
          <button type="button" className="pg-btn" onClick={() => merge({ tv: tv ? '0' : '1' })} aria-pressed={tv}
            style={{ padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
              border: `1px solid ${tv ? 'var(--accent)' : 'var(--border2)'}`, background: tv ? 'var(--accent-dim)' : 'var(--bg2)', color: tv ? 'var(--accent)' : 'var(--text2)' }}
            title={trI18n('จอ TV ไม่มีเมาส์: ไม่เลื่อน แบ่งเป็นหน้า เปลี่ยนหน้าเองทุก 20 วิ (← → หรือรีโมตก็ได้)')}>
            {tv ? trI18n("ออกจากโหมดจอ TV") : trI18n("โหมดจอ TV")}
          </button>
        </>)}
      />
      {err && <div className="card" style={{ padding: 10, marginBottom: 12, borderLeft: '4px solid var(--red)', fontSize: 13 }}>{trI18n('⚠️ โหลดข้อมูลไม่ครบ —')} {err}</div>}
      {!loading && board && lineFam.length > 0 && tab !== 'layout' && (
        <LineFilterNotice lineName={llineName} lineSelf={lineSelf} depts={lineDepts} tab={tab}
          onParent={lineSelf?.parent_line_name ? () => merge({ lline: lineSelf.parent_line_name }) : null}
          onClear={() => merge({ lline: null })} />
      )}
      {loading ? <div style={{ padding: 24, color: 'var(--muted)' }}>{trI18n('กำลังโหลด…')}</div>
        : !board ? <div className="card" style={{ padding: 24 }}>{trI18n('ยังไม่มีส่วนงานในผังองค์กร (ตั้งที่ /org-setup)')}</div>
        : tab === 'org' ? (tv ? <OrgTv board={lineBoard} depts={lineDepts} skills={skills} /> : <OrgTab board={lineBoard} depts={lineDepts} skills={skills} />)
        : tab === 'layout' ? <LayoutTab board={board} depts={depts} lines={lines} attendance={attendance} maps={maps} tv={tv} stationPlans={stationPlans} skills={skills}
            employees={employees} scopeNames={scopeNames} allWs={stations} />
        : tab === 'staffing' ? <StaffingTab section={section} deptParam={deptParam} today={workDate} nodes={nodes} employees={employees} lines={lines}
            slotPlans={slotPlans} lineTechs={lineTechs} stations={stations} stationPlans={stationPlans} homeByEmp={homeByEmp} actingPos={actingPos}
            lineFam={lineFam} lineName={llineName} />
        : tab === 'history' ? <HistoryTab section={section} dept={deptParam ? (board?.depts || []).find(d => d.key === deptParam) || null : null} deptParam={deptParam} nodes={nodes} lines={lines} stations={stations} employees={employees}
            lineFam={lineFam} />
        : <FourMTab depts={lineDepts} logs={fourM} tv={tv} />}
      {setupOpen && section && (
        <ManpowerBoardSetup section={section} nodes={nodes} lines={lines} employees={employees}
          slotPlans={slotPlans} lineTechs={lineTechs} stations={stations} stationPlans={stationPlans} flexUnits={flexUnits}
          /* 🔴 หน้าแม่ที่มีกฎแล้วต้องส่งกฎลงแผงลูก — ส่งแค่ "เปิดได้ไหม" = แผงลูกเขียนข้ามหน่วยได้ */
          secWrite={canWriteUnit(wctx, section?.name, { unknownTarget: 'block' })}
          onChanged={loadSetup} onClose={() => setSetupOpen(false)} />
      )}
    </Page>
  );
}

/* ═════════════════════════ 🧑‍🤝‍🧑 ผังกำลังคน ═════════════════════════ */
function Counter({ label, value, sub, tone }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 74 }}>
      <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.1, color: tone || 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{value ?? '–'}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{sub}</div>}
    </div>
  );
}

function RoleTag({ children, nowrap }) {
  return <span style={{ display: 'inline-block', maxWidth: nowrap ? '40%' : '100%', overflowWrap: 'anywhere', flexShrink: 0,
    ...(nowrap ? { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } : null), fontSize: 11.5, fontWeight: 800, padding: '2px 8px', borderRadius: 'var(--r-xs)', background: '#facc15', color: '#1f2937' }}>{children}</span>;
}

function Photo({ p, size = 44 }) {
  const dim = p.attend === 'leave' || p.attend === 'absent';
  return (
    <div style={{ width: size, height: size * 1.2, borderRadius: 'var(--r-md)', overflow: 'hidden', background: 'var(--bg3)', flex: '0 0 auto',
      filter: dim ? 'grayscale(1)' : undefined, opacity: dim ? 0.55 : 1 }}>
      {p.image_url
        ? <img src={p.image_url} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: 'var(--muted)' }}>{(p.name || '?').slice(0, 1)}</div>}
    </div>
  );
}

function AttendDot({ p }) {
  const m = ATTEND_META[p.attend];
  const label = p.attend === 'leave' && p.log?.leave_type ? `${trI18n("ลา")} (${p.log.leave_type})` : trI18n(m.label);
  return <span title={label} style={{ fontSize: 11, fontWeight: 700, color: m.color, whiteSpace: 'nowrap' }}>● {label}</span>;
}

/** 🤝 ป้ายคนยืมตัว (UI §6.13 — ฟ้า var(--blue) = ข้อมูลบริบท ไม่ใช่ Andon)
 *  ยืมมา = ต้นสังกัดยังเป็นที่เดิม มาช่วยเฉพาะวันนี้ · ไปช่วย = คนในสังกัดที่วันนี้ไปยืนไลน์อื่น */
const SHIFT_TH = { day: 'กะเช้า', night: 'กะดึก' };
function HelperTag({ p }) {
  const b = p.borrowed, l = p.lentTo;
  if (!b && !l) return null;
  const sh = (x) => (x?.shift ? ` · ${SHIFT_TH[x.shift] || x.shift}` : '');
  const text = b ? `🤝 ${trI18n("ยืมจาก")} ${b.from || trI18n('ไลน์อื่น')}` : `↗ ${trI18n("ไปช่วย")} ${l.to || trI18n('ไลน์อื่น')}`;
  const title = b ? `${trI18n("มาช่วย")} ${b.to}${sh(b)} ${trI18n("เฉพาะวันนี้ — ต้นสังกัดยังเป็น")} ${b.from || trI18n('ที่เดิม')}`
    : `${trI18n("วันนี้ไปช่วย")} ${l.to}${sh(l)} — ${trI18n("ยังสังกัดแผนกนี้")}`;
  return <span title={title} style={{ fontSize: 11, fontWeight: 700, color: 'var(--blue)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{text}</span>;
}

/** 🏃 ป้ายคนวิ่งข้ามแผนก — "ไปช่วยประจำ" ไม่ใช่ "ยืมวันนี้" และไม่ใช่ "ย้ายสังกัด"
 *  วาดจาง + ชี้บ้านจริง ท่าเดียวกับแถวทางลัดของเมนู (`alsoIn` = ทางลัด ไม่ใช่บ้านที่สอง · UI §4.5)
 *  🔴 ต้องเขียน cost center ของบ้านจริงไว้ด้วย — คนอ่านบอร์ดจะได้ไม่คิดว่าค่าแรงมาลงที่แผนกนี้ */
function FlexTag({ p }) {
  const f = p.flexFrom;
  if (!f) return null;
  const home = f.nodeName || trI18n("หน่วยอื่น");
  const cc = f.costCenter ? ` · cost center ${f.costCenter}` : '';
  return (
    <span title={`${trI18n("ต้นสังกัด")}: ${home}${cc}${f.note ? ` · ${f.note}` : ''} — ${trI18n("มาช่วยแผนกนี้ประจำ ไม่ได้ย้ายสังกัด และไม่นับเป็นกำลังคนของแผนกนี้")}`}
      style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
      ↗ {trI18n("ต้นสังกัด")} {home}
    </span>
  );
}

/** ชิปคนระดับหัวหน้า — รูป + ชื่อ + ตำแหน่ง */
/* 🎖️ ป้ายรักษาการ — **ต้องเขียนบ้านจริง + cost center ของบ้านจริงเสมอ**
   ไม่งั้นคนอ่านผังจะเข้าใจว่าเขาย้ายมาสังกัดหน่วยนี้แล้ว (ซึ่งไม่ใช่ · ค่าแรงยังลงหน่วยเดิม)
   Andon เหลือง = นิ่ง ไม่กระพริบ (UI-CONVENTIONS) — นี่คือข้อเท็จจริง ไม่ใช่ alarm */
function ActingNote({ a }) {
  const where = [a?.nodeName, a?.costCenter && `CC ${a.costCenter}`].filter(Boolean).join(' · ');
  return (
    <div style={{ fontSize: 11, color: 'var(--amber)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      title={`${trI18n("รักษาการ — สังกัดจริงและ cost center ยังอยู่ที่")} ${where || trI18n('หน่วยเดิม')}${a?.note ? ` · ${a.note}` : ''}`}>
      🎖️ {trI18n("รักษาการ")}{where ? ` · ${trI18n("สังกัด")} ${where}` : ''}
    </div>
  );
}

function PersonChip({ p }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 6, border: '1px solid var(--border)', borderRadius: 'var(--r-md)', background: 'var(--card-surf)', minWidth: 0, maxWidth: '100%' }}>
      <Photo p={p} size={34} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{positionLabel(p.position) || trI18n("ไม่ระบุตำแหน่ง")}{p.team ? ` · ${trI18n("ทีม")} ${p.team}` : ''}{p.external && p.department ? ` · ${trI18n("สังกัด")} ${p.department}` : ''}</div>
        {p.linkedLines?.length > 0 && (
          <div style={{ fontSize: 11, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${trI18n("ช่างประจำไลน์")}: ${p.linkedLines.join(', ')}`}>{p.linkedLines.join(', ')}</div>
        )}
        {p.acting && <ActingNote a={p.acting} />}
        <AttendDot p={p} />
      </div>
    </div>
  );
}

/** 🧭 ป้าย "ทำงานคนละตำแหน่งกับที่บริษัทบรรจุ" — 2026-10-14 · คำสั่ง user
 *  บอร์ดจัดแถวด้วย**ตำแหน่งที่ปฏิบัติงาน** ⇒ คนที่ยืนคนละแถวกับที่บรรจุต้องอธิบายได้ว่าทำไม
 *  (ไม่งั้นคนดูบอร์ดเทียบกับทะเบียน HR แล้วคิดว่าระบบจัดผิด) · ธงมาจาก `isActingPosition()`
 *  ⚠️ ไม่ใช่ความผิดพลาด = **ห้ามใช้สีเตือน** · ฟอนต์ 11 = พื้นขั้นต่ำของจอ TV (ด่าน font-min-11) */
function ActingTag({ p }) {
  if (!p?.acting) return null;
  return (
    <span title={`${trI18n("ตำแหน่งตามบริษัท")}: ${positionLabel(p.company_position) || p.company_position || '—'}`}
      style={{ fontSize: 11, color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      {trI18n("ทำหน้าที่")} {positionLabel(p.position) || p.position}
    </span>
  );
}

/** การ์ด skill พนักงาน (แทนการ์ด SKILL EVALUATION CARD บนบอร์ดกระดาษ) */
/** 🎯 Top N ทักษะของคน — **ยุบชื่อทักษะซ้ำก่อนตัด** (14/10)
 *  ทะเบียน `employee_skills` ไม่มี unique(employee_id, skill_name) ⇒ คนเดียวมี 2 แถวชื่อทักษะเดียวกันได้
 *  (พบจริงตอนการ์ดคนวิ่งข้ามแผนกเริ่มวาดคนที่เดิมเป็นแค่ชิป — React เตือนคีย์ซ้ำ `SPOT`
 *   = แถบคะแนนอาจถูกวาดซ้ำ/หายไปเงียบๆ) · ลิสต์ถูกเรียงคะแนนมาก→น้อยมาแล้ว ⇒ เก็บตัวแรก = คะแนนสูงสุด */
function topSkills(rows, n) {
  const out = [], seen = new Set();
  for (const s of rows || []) {
    if (!s?.skill_name || seen.has(s.skill_name)) continue;
    seen.add(s.skill_name); out.push(s);
    if (out.length >= n) break;
  }
  return out;
}

function SkillCard({ p, skills }) {
  const top = topSkills(skills.byEmp[p.id], 3);
  return (
    <div title={`${p.name}${p.employee_id_code ? ` (${p.employee_id_code})` : ''}`} style={{
      border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 6, background: 'var(--card-surf)',
      display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 6, minWidth: 0 }}>
        <Photo p={p} size={36} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.25, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.name}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{p.employee_id_code || ''}</div>
        </div>
      </div>
      <AttendDot p={p} />
      <HelperTag p={p} />
      <FlexTag p={p} />
      <ActingTag p={p} />
      {p.unknownPos && <span style={{ fontSize: 11, color: 'var(--amber)' }} title={trI18n('ตำแหน่งนี้ไม่อยู่ในทะเบียนตำแหน่ง — แก้ที่ /operator')}>⚠️ {p.position}</span>}
      {top.length ? top.map(s => {
        const d = skills.defs[s.skill_name];
        return (
          <div key={s.skill_name} title={`${d?.label || s.skill_name}: ${s.score}`}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, gap: 4 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{trI18n(d?.label) || s.skill_name}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--muted)' }}>{s.score}</span>
            </div>
            <div style={{ height: 4, borderRadius: 'var(--r-xs)', background: 'var(--bg3)' }}>
              <div style={{ width: `${Math.min(100, s.score || 0)}%`, height: '100%', borderRadius: 'var(--r-xs)', background: d?.color || 'var(--accent)' }} />
            </div>
          </div>
        );
      }) : <span style={{ fontSize: 11, color: 'var(--muted)' }}>{trI18n('ยังไม่มีคะแนน skill')}</span>}
    </div>
  );
}

/** ช่องว่าง — รู้จุดงาน (ช่องระดับจุดงาน) = เขียนชื่อจุดด้วย หัวหน้าจะได้รู้ว่าต้องหาคนลงตรงไหน */
function EmptySlot({ station, h }) {
  return (
    <div title={station ? `${trI18n("จุด")} ${station} ${trI18n("ยังขาดคนประจำ")}` : trI18n("ช่องว่าง")} style={{ border: '2px dashed var(--border2)', borderRadius: 'var(--r-md)', minHeight: h || 92, height: h,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, padding: 4, overflow: 'hidden',
      color: 'var(--muted)', fontSize: 12, fontWeight: 700, textAlign: 'center' }}>
      {trI18n("ช่องว่าง")}
      {station && <span style={{ fontSize: 11.5, color: 'var(--text2)', overflowWrap: 'anywhere' }}>{station}</span>}
    </div>
  );
}

/** ป้ายช่องว่างของคอลัมน์ — บอกที่มาเสมอ (ตั้งเอง vs std ของไลน์) ไม่งั้นคนเถียงกันว่าเลขมาจากไหน */
const slotText = (c) => (c.slots == null ? ''
  : c.slotSource === 'plan' ? ` · ${trI18n("ว่าง")} ${c.slots} (${trI18n("ตั้งไว้")} ${c.slotPlan} ${trI18n("ช่อง")})`
  : c.slotSource === 'station' ? ` · ${trI18n("ว่าง")} ${c.slots} (${trI18n("ตามจุดงาน")})` : ` · ${trI18n("ว่าง")} ${c.slots} (${trI18n("ตาม")} std)`);

const CARD_GRID = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))', gap: 6, alignItems: 'start' };
// แถวชิปหัวหน้า — min(100%, …) กันล้นจอมือถือ (ชิปกว้าง 200 บนจอ 390 − padding = ล้น)
const CHIP_GRID = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 200px), 1fr))', gap: 6, alignItems: 'start' };

function TeamColumn({ c, skills }) {
  const sm = shiftMeta(c.shift);
  const slots = c.slots || 0;
  return (
    <div style={{ flex: '1 1 260px', minWidth: 0, maxWidth: '100%', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 8, background: 'var(--bg2-surf)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
        <RoleTag>{trI18n('หัวหน้ากลุ่ม')}</RoleTag>
        <strong style={{ fontSize: 14 }}>{c.team ? `${trI18n("ทีม")} ${c.team}` : trI18n("ไม่ระบุทีม")}</strong>
        <span style={{ fontSize: 12, fontWeight: 700, color: sm.color }}>● {c.shift ? `${trI18n(sm.label)}${trI18n("วันนี้")}` : trI18n(sm.label)}</span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>
          {c.ops.length} {trI18n('คน')}{slotText(c)}
        </span>
      </div>
      {c.leaders.length
        ? <div style={{ display: 'grid', gap: 4, marginBottom: 6 }}>{c.leaders.map(p => <PersonChip key={p.id} p={p} />)}</div>
        : <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>{trI18n('ยังไม่มีหัวหน้ากลุ่มในทะเบียน')}</div>}
      <div style={CARD_GRID}>
        {c.ops.map(p => <SkillCard key={p.id} p={p} skills={skills} />)}
        {Array.from({ length: slots }, (_, i) => <EmptySlot key={`e${i}`} station={c.slotStations?.[i]} />)}
      </div>
    </div>
  );
}

function OrgTab({ board, depts, skills }) {
  const t = board.totals;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {/* หัวผัง: ผจก./หัวหน้าส่วน + ทีมสนับสนุน + ตัวนับ */}
      <div className="card" style={{ padding: 12, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <RoleTag>{trI18n('ผู้จัดการ / หัวหน้าส่วน ·')} {board.section.name}</RoleTag>
          <div style={{ ...CHIP_GRID, marginTop: 6 }}>
            {board.top.length ? board.top.map(p => <PersonChip key={p.id} p={p} />)
              : <span style={{ fontSize: 12, color: 'var(--muted)' }}>{trI18n('ยังไม่มีผู้จัดการ/หัวหน้าส่วนในทะเบียนส่วนงานนี้')}</span>}
          </div>
        </div>
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <RoleTag>{trI18n('วิศวกร · เจ้าหน้าที่')}</RoleTag>
          <div style={{ ...CHIP_GRID, marginTop: 6 }}>
            {board.support.length ? board.support.map(p => <PersonChip key={p.id} p={p} />)
              : <span style={{ fontSize: 12, color: 'var(--muted)' }}>—</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Counter label={trI18n('แผน (std 2 กะ)')} value={t.plan} sub={t.plan == null ? trI18n('ยังไม่ตั้ง std') : null} />
          <Counter label={trI18n('ในทะเบียน')} value={t.ops} sub={trI18n('เฉพาะพนักงาน')} />
          <Counter label={trI18n('มาวันนี้')} value={t.present} tone="var(--green)" />
          {t.borrowed > 0 && <Counter label={trI18n('ยืมมาช่วย')} value={t.borrowed} tone="var(--blue)" />}
          {t.flex > 0 && <Counter label={trI18n('วิ่งข้ามมาช่วย')} value={t.flex} sub={trI18n('ไม่นับในทะเบียน')} />}
        </div>
      </div>

      {board.emptyDepts.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{trI18n('ไม่แสดง')} {board.emptyDepts.length} {trI18n('แผนกที่ยังไม่มีพนักงานในทะเบียน:')} {board.emptyDepts.join(' · ')}</div>
      )}
      {!depts.length && <div className="card" style={{ padding: 24, color: 'var(--muted)' }}>{trI18n('ส่วนงานนี้ยังไม่มีพนักงานหน้างานในทะเบียน')}</div>}

      {depts.map(d => (
        <div key={d.key} className="card" style={{ padding: 12 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
            <RoleTag>{trI18n('หัวหน้าแผนก')} {d.name}</RoleTag>
            <div style={{ ...CHIP_GRID, flex: '1 1 240px', minWidth: 0 }}>
              {d.heads.length ? d.heads.map(p => <PersonChip key={p.id} p={p} />)
                : <span style={{ fontSize: 12, color: 'var(--muted)' }}>{trI18n('ยังไม่มีหัวหน้าแผนกในทะเบียน')}</span>}
            </div>
            <Counter label={trI18n('แผน เช้า/ดึก')} value={d.planTotal == null ? null : `${d.plan.day ?? '–'}/${d.plan.night ?? '–'}`} sub={d.planTotal == null ? trI18n('ยังไม่ตั้ง std ที่ไลน์') : null} />
            <Counter label={trI18n('ในทะเบียน')} value={d.opsTotal} sub={trI18n('เฉพาะพนักงาน')} />
            <Counter label={trI18n('มาวันนี้')} value={d.present} tone="var(--green)" />
            {d.borrowed.length > 0 && <Counter label={trI18n('ยืมมาช่วย')} value={d.borrowed.length} tone="var(--blue)" />}
            {d.flex.length > 0 && <Counter label={trI18n('วิ่งข้ามมาช่วย')} value={d.flex.length} sub={trI18n('ไม่นับในทะเบียน')} />}
          </div>
          {d.stationInfo && (
            <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 8 }}>
              {trI18n("ช่องว่างคิดจากจุดงาน")} {d.stationInfo.planned}/{d.stationInfo.total} {trI18n('จุดที่ตั้งจำนวนคนไว้ (ต้องการ เช้า')} {d.stationInfo.need.day} {trI18n('· ดึก')} {d.stationInfo.need.night} {trI18n("คน")})
              {d.stationInfo.noHome > 0 && <span style={{ color: 'var(--amber)' }}> · ⚠️ {d.stationInfo.noHome} {trI18n('คนยังไม่มีจุดประจำในไลน์ของแผนก — ไม่ถูกนับลงจุดไหน ช่องว่างอาจมากกว่าจริง (ตั้งจุดประจำที่ /management)')}</span>}
            </div>
          )}
          {d.unknownShiftTeams.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--amber)', marginBottom: 8 }}>
              ⚠️ {trI18n("ทีม")} {d.unknownShiftTeams.join(', ')} {trI18n("ยังไม่ได้ตั้งตารางกะวันนี้ — ไม่รู้ว่าเข้ากะไหน จึงยังไม่คำนวณช่องว่าง (ตั้งที่")} /shift-organize)
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {d.cols.map(c => <TeamColumn key={c.team || '-'} c={c} skills={skills} />)}
          </div>
          {d.borrowed.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {/* 🤝 ไม่นับรวมในทะเบียน/ช่องว่างของแผนก — มาช่วยเฉพาะวันนี้ ต้นสังกัดยังเป็นที่เดิม (UI §6.13) */}
              <span style={{ display: 'inline-block', fontSize: 11.5, fontWeight: 800, padding: '2px 8px', borderRadius: 'var(--r-xs)', background: 'var(--blue)', color: '#fff' }}>
                {trI18n("ยืมมาช่วยวันนี้")} {d.borrowed.length} {trI18n('คน')}</span>
              <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 8 }}>{trI18n('ไม่นับรวมในทะเบียนของแผนก')}</span>
              <div style={{ ...CARD_GRID, marginTop: 6 }}>
                {d.borrowed.map(p => <SkillCard key={p.id} p={p} skills={skills} />)}
              </div>
            </div>
          )}
          {d.flex.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {/* 🏃 คนวิ่งข้ามแผนก — ทะเบียนถาวร (employee_flex_units) คนละตัวกับยืมรายวัน
                  🔴 ไม่นับรวมในทะเบียน/ช่องว่างของแผนกนี้ · บ้านจริงนับเขาอยู่แล้ว (นับ 2 ที่ = กำลังคนปลอม)
                  🔴 cost center ยังอยู่ที่บ้านจริง — เขียนบนจอเสมอ ห้ามให้คนเข้าใจผิดว่าย้ายสังกัด */}
              <span style={{ display: 'inline-block', fontSize: 11.5, fontWeight: 800, padding: '2px 8px', borderRadius: 'var(--r-xs)', border: '1px solid var(--border2)', background: 'var(--bg2-surf)', color: 'var(--text2)' }}>
                {trI18n("วิ่งข้ามมาช่วยประจำ")} {d.flex.length} {trI18n('คน')}</span>
              <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 8 }}>
                {trI18n("ไม่นับรวมในทะเบียนของแผนก · cost center ยังอยู่ที่หน่วยต้นสังกัด")}
              </span>
              <div style={{ ...CARD_GRID, marginTop: 6 }}>
                {d.flex.map(p => <SkillCard key={p.id} p={p} skills={skills} />)}
              </div>
            </div>
          )}
          {d.techs.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <RoleTag>{trI18n('ช่างเทคนิคประจำไลน์')}</RoleTag>
              <div style={{ ...CHIP_GRID, marginTop: 6 }}>
                {d.techs.map(p => <PersonChip key={p.id} p={p} />)}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* 🧩 แถบบอกว่ากำลังกรองถึงไลน์ (แท็บที่ไม่ใช่ผัง LAYOUT) — ห้ามให้จอว่างโดยไม่บอกเหตุ (กฎความซื่อสัตย์ของจอ)
   ไลน์ไม่มีพนักงานสังกัดตรง (เช่น Line 60 — คนสังกัดไลน์แม่) = เขียนบอก + ปุ่มดูไลน์แม่ (user 23/11 เลือก "กรองตรง + บอกบนจอ") */
function LineFilterNotice({ lineName, lineSelf, depts, tab, onParent, onClear }) {
  const direct = depts.reduce((a, d) => a + (d.opsTotal || 0) + d.cols.reduce((x, c) => x + c.leaders.length, 0), 0);
  const deptOps = depts.reduce((a, d) => a + (d.lineFilter?.deptOps || 0), 0);
  const hiddenFlex = depts.reduce((a, d) => a + (d.lineFilter?.hiddenFlex || 0), 0);
  const stations = depts.reduce((a, d) => Math.max(a, d.lineFilter?.stations || 0), 0);
  const viaStation = depts.reduce((a, d) => a + (d.lineFilter?.viaStation || 0), 0);
  const empty = tab !== 'fourm' && tab !== 'history' && direct === 0;
  const btn = { fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 'var(--r-md)', cursor: 'pointer', border: '1px solid var(--border2)', background: 'var(--bg2)', color: 'var(--text2)' };
  return (
    <div className="card" style={{ padding: '8px 12px', marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 13,
      borderLeft: `4px solid ${empty ? 'var(--amber)' : 'var(--accent)'}` }}>
      <span>🧩 {trI18n('กรองถึงไลน์')} <b>{lineName}</b></span>
      {!depts.length && <span style={{ color: 'var(--amber)' }}>{trI18n('— ไลน์นี้ไม่อยู่ในแผนกของส่วนงานที่เลือก')}</span>}
      {empty && depts.length > 0 && (
        <span style={{ color: 'var(--amber)' }}>
          {stations === 0
            ? <>{trI18n('— ไลน์นี้ยังไม่มีจุดงานของตัวเอง จึงยังรู้ไม่ได้ว่าวันนี้ใครทำงานที่ไลน์นี้')}{deptOps > 0 ? ` (${deptOps} ${trI18n('คนสังกัดไลน์แม่')}${lineSelf?.parent_line_name ? ` ${lineSelf.parent_line_name}` : ''})` : ''}
                {' · '}{trI18n('ผูกจุดงานให้ไลน์นี้ที่ /line-setup แล้วคนที่ถูกวางจุดของไลน์นี้จะขึ้นที่นี่')}</>
            : trI18n('— วันนี้ยังไม่มีใครถูกวางที่จุดงานของไลน์นี้ (วางจุดที่ /management)')}
        </span>
      )}
      {viaStation > 0 && <span style={{ color: 'var(--muted)', fontSize: 12 }}>· {viaStation} {trI18n('คนสังกัดไลน์แม่ วันนี้ยืนจุดงานของไลน์นี้')}</span>}
      {(tab === 'staffing') && <span style={{ color: 'var(--muted)', fontSize: 12 }}>{trI18n('· เทียบคนมาจริงกับ std ของไลน์ — ช่องตำแหน่งตั้งรายทีม แยกลงไลน์ไม่ได้ จึงไม่คิดช่องว่างอัตรากำลัง')}</span>}
      {(tab === 'org') && <span style={{ color: 'var(--muted)', fontSize: 12 }}>{trI18n('· ช่องว่างรายทีมแยกลงไลน์ไม่ได้ จึงไม่แสดง · หัวหน้าแผนก/ช่าง = ทั้งแผนก')}{hiddenFlex ? ` · ${trI18n('ซ่อนคนวิ่งข้ามแผนก')} ${hiddenFlex} ${trI18n('คน')}` : ''}</span>}
      <span className="spacer" style={{ flex: 1 }} />
      {onParent && <button type="button" className="pg-btn" style={btn} onClick={onParent}>{trI18n('ดูไลน์แม่')} {lineSelf?.parent_line_name}</button>}
      <button type="button" className="pg-btn" style={btn} onClick={onClear}>{trI18n('ล้างการกรองไลน์')}</button>
    </div>
  );
}

/* ═════════════════════════ 🗺️ ผัง LAYOUT ═════════════════════════ */
/* ═════════════════════════ 🗺️ ผัง LAYOUT ═════════════════════════
   2 มุมมอง (`?lv=factory|line` · 2026-11-20 คำสั่ง user):
     factory = ผังรวมโรงงาน (กรอบไลน์ชุดเดียวกับ /factory-map) ระบายสีตามกำลังคนวันนี้ → กดกรอบ = เข้าผังไลน์
     line    = ผังรายไลน์ + แผงสรุปด้านขวา + กดหมุด = modal รายละเอียดจุดงาน
   📺 จอ TV = ผังรายไลน์วนเหมือนเดิม (ไม่มีเมาส์กดกรอบ) · สูตรต่อจุด = layoutPeople/stationSkillGaps ตัวเดิม */
const STAFF_TONE = { good: 'var(--green)', warn: 'var(--amber)', bad: 'var(--red)', none: STATUS_COLOR.none };
const STAFF_TEXT = { good: 'มาครบ std', warn: 'ขาด 1–2 คน / ทักษะไม่ถึง', bad: 'ขาด ≥3 คน', none: 'ตัดสินไม่ได้' };
const STAFF_RANK = { bad: 0, warn: 1, none: 2, good: 3 };
const FIT_DOT = { ok: 'var(--green)', gap: 'var(--amber)', noreq: STATUS_COLOR.none };
const MARKER_MAX = 3;   // คนต่อจุดเกินนี้ = ยุบเป็น +N (ดูครบใน modal)
const LV_OPTS = [{ value: 'factory', label: 'ภาพรวมโรงงาน' }, { value: 'line', label: 'ผังรายไลน์' }];

function LayoutTab(props) {
  const { tv } = props;
  const [params] = useSearchParams();
  const merge = useMergeParams();
  const lv = tv ? 'line' : (params.get('lv') || (params.get('lline') ? 'line' : 'factory'));
  const viewSwitch = tv ? null : <Segmented value={lv} options={LV_OPTS} label={trI18n('มุมมองผัง')} onChange={v => merge({ lv: v })} />;
  return lv === 'factory'
    ? <FactoryStaffView {...props} viewSwitch={viewSwitch} />
    : <LineLayoutView {...props} viewSwitch={viewSwitch} />;
}

/* ใช้ร่วมกันทั้ง 2 มุมมอง — ใครเข้ากะไหน (ตารางกะ) */
function useShiftOfEmp(maps) {
  return useCallback((e) => (e?.team ? shiftFromTeam(scheduleTeamFor(e, maps), e.team) : null), [maps]);
}

/* ── 🗺️ ภาพรวมทั้งโรงงาน ── */
function FactoryStaffView({ lines, depts, attendance, maps, stationPlans, skills, employees, scopeNames, viewSwitch }) {
  const merge = useMergeParams();
  const isMobile = useIsMobile();
  const [ws, setWs] = useState(null);         // workstations ทั้งโรงงาน (มีพิกัด + ทักษะที่จุดต้องการ)
  const [homes, setHomes] = useState({});
  const [regions, setRegions] = useState([]);
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    (async () => {
      const [w, hp, rg] = await Promise.all([
        fetchAllPages(() => supabase.from('workstations').select('id, line_name, line_id, station_name, station_requirements(skill_name, min_score)')),
        fetchAllPages(() => supabase.from('employee_home_positions').select('employee_id, station_id'), { orderBy: 'employee_id' }),
        // คีย์ cache เดียวกับ <FactoryMiniMap> ⇒ ยิงครั้งเดียว (ห้ามมีข้อมูลกรอบชุดที่ 2)
        cachedMaster('factory_line_regions', async () => {
          const { data, error } = await supabase.from('factory_line_regions').select('id, line_name, points');
          if (error) throw error;
          return data || [];
        }).catch(e => { setErr(e?.message || 'โหลดกรอบไลน์ไม่สำเร็จ'); return []; }),
      ]);
      if (!alive) return;
      setWs(w.rows || []);
      setHomes(Object.fromEntries((hp.rows || []).map(h => [h.employee_id, h.station_id])));
      setRegions(rg || []);
      const e = [w.error, hp.error].filter(Boolean);
      if (e.length) setErr(e.join(' · '));
    })();
    return () => { alive = false; };
  }, []);

  const empById = useMemo(() => Object.fromEntries((employees || []).map(e => [e.id, e])), [employees]);
  const shiftOfEmp = useShiftOfEmp(maps);
  const shift = getCurrentShift();
  const allStationIds = useMemo(() => new Set((ws || []).map(s => String(s.id))), [ws]);
  // สถานะต่อกรอบ — คิดครั้งเดียวต่อชุดข้อมูล · นอกขอบเขตบัญชี = ไม่คิด (เทาจาง + นับบอกบนจอ)
  // ไลน์ของส่วนงาน/แผนกที่เลือก (ครอบครัวแม่-ลูก) · ส่วนงานยังไม่ผูกไลน์ = ไม่กรอง (ห้ามซ่อนทั้งผังเงียบๆ)
  const secKey = (depts || []).flatMap(d => (d.lines || []).map(l => l.id)).sort().join(',');
  const secNames = useMemo(() => {
    const fam = lineFamilyOf(lines || [], secKey ? secKey.split(',') : []);
    return fam.length ? new Set(fam.map(l => l.name)) : null;
  }, [lines, secKey]);
  const byRegion = useMemo(() => {
    const m = new Map();
    if (!ws) return m;
    const byGroup = new Map();   // 🧺 ตัดสินทั้งกลุ่ม (ไลน์แม่บนสุด) — กรอบลูกในกลุ่มเดียวกันใช้ผลเดียวกัน
    for (const r of regions) {
      if (scopeNames && !scopeNames.has(r.line_name)) { m.set(r.line_name, { outOfScope: true, why: 'scope' }); continue; }
      const group = lineGroupRoot(lines, r.line_name);
      // 🔎 กรองตามส่วนงาน/แผนกที่เลือกบนหัวเพจ (user 23/11 "เลือก PD3 ทำไมไลน์ PD4 ยังขึ้น") — นอกที่เลือก = จาง ไม่มีเลข
      if (secNames && !secNames.has(group) && !secNames.has(r.line_name)) { m.set(r.line_name, { outOfScope: true, why: 'section', group }); continue; }
      if (!byGroup.has(group)) {
        const st = stationsOfLineFamily(lines, group, ws);
        const placed = layoutPeople({ stations: st, homeByEmp: homes, attendance, empById, shiftOfEmp, stationPlans });
        const fit = stationSkillGaps(placed, { skillsByEmp: skills?.byEmp || {},
          reqsByStation: Object.fromEntries(st.map(s => [String(s.id), s.station_requirements || []])) });
        byGroup.set(group, { ...lineStaffStatus({ familyLines: lineFamilyDown(lines, group), stationIds: new Set(st.map(s => String(s.id))),
          allStationIds, attendance, empById, shift, fit }), group });
      }
      m.set(r.line_name, byGroup.get(group));
    }
    return m;
  }, [ws, regions, scopeNames, secNames, lines, homes, attendance, empById, shiftOfEmp, stationPlans, skills, allStationIds, shift]);

  // บนผัง = สีกรอบ + ชื่อไลน์ล้วน (user 20/11 "เอากรอบ text ในผังออก · มีแค่ชื่อไลน์เป็น index")
  //   ตัวเลขอยู่แผงขวาที่เดียว (ป้ายการ์ดบนผังซ้ำกับแผงและทับกันเองตรงไลน์ที่อยู่ชิดกัน) · ชื่อล้วนวางกันทับให้เอง
  const stateOf = useCallback((name) => {
    const s = byRegion.get(name);
    if (!s || s.outOfScope) return null;
    return { color: STAFF_TONE[s.status], blink: false, label: null };
  }, [byRegion]);
  const openLine = useCallback((name) => {
    const l = (lines || []).find(x => x.name === name);
    merge({ lv: 'line', lline: name, ...(l?.section ? { sec: l.section, dept: null } : {}) });
  }, [lines, merge]);

  // 🔢 เลขประจำกลุ่ม (user 20/11 "ทำ index แทน ไม่ใช้ชื่อไลน์ในกรอบ") — 1 เลข/กลุ่ม (กรอบลูกในกลุ่มเลขเดียวกัน)
  //    เรียงตาม "ตำแหน่งบนผัง" บน→ล่าง ซ้าย→ขวา (แถบละ 10% ของความสูง) ⇒ เลขนิ่ง ไม่สลับตามสถานะ = คนจำได้
  const groupNo = useMemo(() => {
    const at = new Map();
    for (const r of regions) {
      const s = byRegion.get(r.line_name);
      // เลขนับทั้งโรงงาน (ไม่นับเฉพาะส่วนงานที่กรอง) ⇒ เปลี่ยนส่วนงานแล้วเลขของไลน์เดิมไม่เปลี่ยน
      if (!s || (s.outOfScope && s.why !== 'section') || (r.points || []).length < 3) continue;
      const [x, y] = labelAnchor(r.points);
      const k = [Math.floor(y / 10), x];
      const cur = at.get(s.group);
      if (!cur || k[0] < cur[0] || (k[0] === cur[0] && k[1] < cur[1])) at.set(s.group, k);
    }
    const order = [...at.entries()].sort((a, b) => a[1][0] - b[1][0] || a[1][1] - b[1][1]);
    return new Map(order.map(([g], i) => [g, i + 1]));
  }, [regions, byRegion]);
  const badgeOf = useCallback((name) => {
    const s = byRegion.get(name);
    const n = s && !s.outOfScope ? groupNo.get(s.group) : null;
    // วงแหวน = มา ÷ std ของกะนี้ (ตัดสินไม่ได้ = null → วงประ)
    const pct = s && s.status !== 'none' && s.std ? s.onFloor / s.std : null;
    return n ? { text: String(n), pct, title: `${s.group !== name ? `${name} (${s.group})` : name}${s.std ? ` · ${trI18n("มา")} ${s.onFloor}/${s.std}` : ''}` } : null;
  }, [byRegion, groupNo]);

  // 🔗 ชี้ร่วม (linked hover): ชี้แถวแผงขวา ⇄ กรอบ/เลขบนผัง ของกลุ่มเดียวกันสว่าง ที่เหลือจาง
  const [hoverGroup, setHoverGroup] = useState(null);
  const onMapHover = useCallback((name) => setHoverGroup(name ? byRegion.get(name)?.group || null : null), [byRegion]);
  const focusNames = useMemo(() => (hoverGroup
    ? new Set([...byRegion.entries()].filter(([, s]) => s.group === hoverGroup).map(([n]) => n)) : null), [hoverGroup, byRegion]);

  // แผงขวา = 1 แถวต่อกลุ่ม (กรอบลูกหลายกรอบในกลุ่มเดียว = ผลเดียวกัน ห้ามซ้ำแถว) · กด = เปิดผังกรอบแรกของกลุ่ม
  const rows = useMemo(() => {
    const g = new Map();
    for (const [name, s] of byRegion) {
      if (s.outOfScope) continue;
      if (!g.has(s.group)) g.set(s.group, { s, names: [] });
      g.get(s.group).names.push(name);
    }
    return [...g.entries()].map(([group, v]) => [group, v.s, v.names.sort(naturalCompare)])
      .sort((a, b) => STAFF_RANK[a[1].status] - STAFF_RANK[b[1].status] || naturalCompare(a[0], b[0]));
  }, [byRegion]);
  const hidden = [...byRegion.values()].filter(s => s.outOfScope && s.why === 'scope').length;
  const otherSec = [...byRegion.values()].filter(s => s.outOfScope && s.why === 'section').length;
  const count = (k) => rows.filter(([, s]) => s.status === k).length;

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <FilterBar bare>
        {viewSwitch}
        <span className="spacer" />
        <span style={{ display: 'flex', gap: 12, fontSize: 12, flexWrap: 'wrap' }}>
          {['bad', 'warn', 'good', 'none'].map(k => (
            <span key={k} style={{ color: STAFF_TONE[k], fontWeight: 700 }}>■ {trI18n(STAFF_TEXT[k])} {ws ? count(k) : '…'}</span>
          ))}
        </span>
      </FilterBar>
      {err && <div style={{ fontSize: 12, color: 'var(--red)' }}>⚠️ {err}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0,1fr)' : 'minmax(0,1fr) 300px', gap: 10, alignItems: 'start' }}>
        <div className="card" style={{ padding: 8 }}>
          <FactoryMiniMap stateOf={stateOf} onPick={openLine} bottomReserve={isMobile ? 12 : 24} badgeOf={badgeOf}
            dimMap focusNames={focusNames} onHover={onMapHover} />
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
            {trI18n('เลขบนผัง = เลขหน้าแถวในแผงขวา (ชี้แถว/เลข = ไฮไลต์คู่กัน) · วงแหวนรอบเลข = มา ÷ std · กดกรอบ/เลข = เข้าผังรายไลน์ · สีกรอบ = คนที่มา')}{shift === 'night' ? trI18n('กะดึก') : trI18n('กะเช้า')}{trI18n(' เทียบกำลังคนตามผัง (std ต่อกะ ตั้งที่ /line-setup) · กรอบ/ชื่อไลน์ตั้งที่ /layout-setup')}
          </div>
        </div>
        <div className="card" style={{ padding: 10, display: 'grid', gap: 6, alignContent: 'start' }}>
          <div style={{ fontWeight: 800 }}>{trI18n('ไลน์บนผัง')} <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--muted)' }}>{trI18n('(แย่สุดอยู่บน)')}</span></div>
          {!ws && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{trI18n('กำลังโหลด…')}</div>}
          {ws && !regions.length && <div style={{ fontSize: 12, color: 'var(--amber)' }}>{trI18n('ยังไม่มีกรอบไลน์บนผังรวม — ตีกรอบที่ /layout-setup')}</div>}
          {rows.map(([name, s, names]) => (
            <button key={name} type="button" onClick={() => openLine(names.includes(name) ? name : names[0])}
              onMouseEnter={() => setHoverGroup(name)} onMouseLeave={() => setHoverGroup(null)} onFocus={() => setHoverGroup(name)} onBlur={() => setHoverGroup(null)}
              style={{ display: 'grid', gap: 2, textAlign: 'left', padding: '6px 8px', borderRadius: 'var(--r-md)', cursor: 'pointer', transition: 'background .15s',
                border: `1px solid ${hoverGroup === name ? STAFF_TONE[s.status] : 'var(--border)'}`, borderLeft: `4px solid ${STAFF_TONE[s.status]}`,
                background: hoverGroup === name ? 'var(--bg3)' : 'var(--bg2)', color: 'var(--text)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700 }}>
                {groupNo.get(name) && <span style={{ minWidth: 24, height: 24, padding: '0 5px', borderRadius: 12, background: STAFF_TONE[s.status], color: '#fff',
                  fontSize: 12, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{groupNo.get(name)}</span>}
                <span>{name}</span>
              </span>
              <span style={{ fontSize: 12, color: s.status === 'none' ? 'var(--muted)' : STAFF_TONE[s.status], fontVariantNumeric: 'tabular-nums' }}>{trI18n(lineStaffLabel(s))}</span>
              {(names.length > 1 || names[0] !== name) && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{trI18n('กรอบ:')} {names.join(', ')}</span>}
            </button>
          ))}
          {otherSec > 0 && <div style={{ fontSize: 12, color: 'var(--muted)' }}>🔎 {trI18n('นอกส่วนงาน/แผนกที่เลือก — จางไว้')} {otherSec} {trI18n('กรอบ (เปลี่ยนส่วนงานที่ช่องด้านบน)')}</div>}
          {hidden > 0 && <div style={{ fontSize: 12, color: 'var(--muted)' }}>🔭 {trI18n('นอกขอบเขตบัญชี — ไม่แสดงสถานะ')} {hidden} {trI18n('กรอบ')}</div>}
        </div>
      </div>
    </div>
  );
}

/* ── 📍 ผังรายไลน์ ── */
function LineLayoutView({ board, depts, lines, attendance, maps, tv, stationPlans, skills, viewSwitch, employees, allWs }) {
  const [params] = useSearchParams();
  const isMobile = useIsMobile();
  const [layouts, setLayouts] = useState([]);
  const [stations, setStations] = useState([]);
  const [homes, setHomes] = useState({});
  const [focus, setFocus] = useState(null);     // station id ที่ชี้จากแผงขวา
  const [openSt, setOpenSt] = useState(null);   // station id ที่เปิด modal
  const [gapOpen, setGapOpen] = useState(false); // ตารางคนทักษะไม่ถึง (กดเปิด)
  const lline = params.get('lline') || '';      // ?lline= ชื่อไลน์ของผังที่จะเปิด (จอวน/กดกรอบภาพรวม/เลือกเอง)
  const [err, setErr] = useState('');

  const family = useMemo(() => lineFamilyOf(lines, depts.flatMap(d => d.lines.map(l => l.id))), [lines, depts]);
  const famKey = family.map(l => l.id).sort().join(',');

  useEffect(() => {
    let alive = true;
    const names = family.map(l => l.name), ids = family.map(l => l.id);
    if (!names.length) { setLayouts([]); return undefined; }
    (async () => {
      const [lay, hp] = await Promise.all([
        supabase.from('line_layouts').select('id, line_name, line_id, image_url'),
        fetchAllPages(() => supabase.from('employee_home_positions').select('employee_id, station_id'), { orderBy: 'employee_id' }),
      ]);
      if (!alive) return;
      const low = new Set(names.map(n => n.trim().toLowerCase()));
      setLayouts((lay.data || []).filter(l => (l.line_id != null && ids.includes(l.line_id)) || low.has(String(l.line_name || '').trim().toLowerCase())));
      setHomes(Object.fromEntries((hp.rows || []).map(h => [h.employee_id, h.station_id])));
      const e = [lay.error?.message, hp.error].filter(Boolean);
      setErr(e.join(' · '));
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [famKey]);

  // 📺 จอ TV: หลายผัง = วนทีละผังเอง (ไม่มีเมาส์ไปเลือก dropdown) · โหมดปกติ = ตาม ?lline= (ไม่ระบุ = ผังแรก)
  const [tvIdx, setTvIdx] = useAutoPage(tv ? layouts.length : 0);
  const llineKey = lline.trim().toLowerCase();
  const layoutByName = (n) => layouts.find(l => String(l.line_name || '').trim().toLowerCase() === String(n || '').trim().toLowerCase()) || null;
  // 🔗 ไลน์ลูกส่วนใหญ่ไม่มีรูปผังของตัวเอง (จุดงานอยู่บนผังไลน์แม่) ⇒ ไล่ขึ้นสายแม่จนเจอผัง แล้ว**เขียนบอก**ว่าเป็นผังของใคร
  //    (user 23/11 "ไลน์ลูกไม่ขึ้นให้คลิก" — เดิมกดกรอบ HDF1 บนภาพรวมแล้วได้ "ไม่มีรูปผัง")
  const viaParent = useMemo(() => {
    if (tv || !llineKey || layoutByName(lline)) return null;
    const self = lines.find(l => l.name.trim().toLowerCase() === llineKey);
    if (!self) return null;
    const chain = lineChainIds(lines, self.id).slice(0, -1).reverse();   // แม่ใกล้สุดก่อน
    for (const id of chain) { const up = lines.find(l => String(l.id) === String(id)); if (up && layoutByName(up.name)) return up.name; }
    return null;
  }, [tv, llineKey, lline, lines, layouts]); // eslint-disable-line react-hooks/exhaustive-deps
  const layout = tv ? layouts[clampPage(tvIdx, layouts.length)] || null
    : (llineKey ? layoutByName(viaParent || lline) : layouts[0] || null);
  // 🔴 ไลน์ที่ขอมาไม่มีรูปผัง = บอกตรงๆ ห้ามแอบโชว์ผังไลน์อื่นแทน
  const llineMissing = !tv && !!llineKey && layouts.length > 0 && !layout;
  // 🎛️ เลือกผังผ่านช่อง "ส่วนงาน/ไลน์" บนหัวเพจช่องเดียว (user 24/11 — เดิมมีช่องเลือกผังซ้อนอีกช่อง แล้ว 2 ช่องไม่ตามกัน)
  //    🔴 ห้ามเขียน ?lline= ให้เองตอนยังไม่ระบุไลน์ (user 25/11 "ช่องเด้งข้ามไปไลน์ลูก ตอนเลือกไลน์แม่") —
  //       เลือกแผนก = ล้าง lline แล้วตัวตั้งค่าเองเขียนผังแรกกลับ ⇒ ช่องเด้งไป Laser GOR · ไม่ระบุ = ผังแรก + เขียนบอกบนจอแทน
  const autoLayout = !tv && !llineKey && layouts.length > 0 ? layout : null;
  // 🔴 จุดบนผัง = จุดของไลน์เจ้าของผัง "+ ไลน์ลูกทั้งหมด" — ไลน์ลูกไม่มีรูปผังของตัวเอง แต่วางพิกัดบนผังไลน์แม่
  //    (จุดไลน์ลูกผูกด้วย line_name · line_id ว่าง) · เดิมโหลดแค่ชื่อไลน์แม่ ⇒ ผัง LINE APRON ASSY ขึ้นแค่ Supervisor
  //    (user 24/11 "จุดงานก็ไม่ขึ้น") · จับคู่ผ่าน stationsOfLineFamily ตัวเดียวกับสถานะกลุ่ม
  useEffect(() => {
    let alive = true;
    if (!layout) { setStations([]); return undefined; }
    // 🎯 ทักษะที่จุดต้องการ (station_requirements) มากับจุดเลย — ใช้ตอบ "ยืนจุดที่ฝีมือถึงไหม"
    fetchAllPages(() => supabase.from('workstations').select('id, line_name, line_id, station_name, pos_top, pos_left, station_requirements(skill_name, min_score)'))
      .then((r) => { if (!alive) return; setStations(stationsOfLineFamily(lines, layout.line_name, r.rows || [])); if (r.error) setErr(String(r.error)); });
    return () => { alive = false; };
  }, [layout?.id, lines.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const empById = useMemo(() => {
    const m = {};
    for (const d of board.depts) for (const c of d.cols) for (const p of [...c.leaders, ...c.ops]) m[p.id] = p;
    for (const d of board.depts) for (const p of [...d.heads, ...d.techs]) m[p.id] = p;
    return m;
  }, [board]);
  const shiftOfEmp = useShiftOfEmp(maps);
  const placed = useMemo(() => layoutPeople({ stations, homeByEmp: homes, attendance, empById, shiftOfEmp, stationPlans }),
    [stations, homes, attendance, empById, shiftOfEmp, stationPlans]);
  const fitGaps = useMemo(() => stationSkillGaps(placed, {
    skillsByEmp: skills?.byEmp || {},
    reqsByStation: Object.fromEntries(stations.map(st => [String(st.id), st.station_requirements || []])),
  }), [placed, skills, stations]);
  // สถานะไลน์ = คนมากะนี้เทียบ std (ไม่ใช่จุดงาน) — ทะเบียนพนักงานทั้งโรงงาน (คนยืมเข้า/ออกถูกนับตามจุดที่ยืน)
  const allEmpById = useMemo(() => Object.fromEntries((employees || []).map(e => [e.id, e])), [employees]);
  const allStationIds = useMemo(() => new Set((allWs || []).map(s => String(s.id))), [allWs]);
  const curShift = getCurrentShift();
  // 🧺 ตัดสินทั้งกลุ่ม (ไลน์แม่บนสุด) — สูตรเดียวกับภาพรวม ⇒ สีแผงตรงกับสีกรอบบนผังรวมเสมอ
  //    ทักษะต้องคิดจากจุดของทั้งกลุ่ม ⇒ ผังนี้เป็นไลน์ลูก = โหลดจุด (พร้อมทักษะที่ต้องการ) ของทั้งกลุ่มเพิ่ม
  const group = layout ? lineGroupRoot(lines, layout.line_name) : null;
  // 🔴 จุดของ "ทั้งกลุ่ม" ต้องมาจากทะเบียนจุดทั้งโรงงาน — เดิมผังไลน์แม่ใช้แค่จุดบนรูปผังนี้ ⇒ คนที่ยืนจุดของไลน์ลูก
  //    ไม่ถูกนับ (user 23/11: HYDROFORM ผังรายไลน์ขึ้น 7/14 ทั้งที่มาจริง 16 = ภาพรวมโรงงาน) · โหลดครั้งเดียว (~135 แถว)
  const [groupSt, setGroupSt] = useState(null);
  useEffect(() => {
    let alive = true;
    fetchAllPages(() => supabase.from('workstations').select('id, line_name, line_id, station_name, station_requirements(skill_name, min_score)'))
      .then((r) => { if (alive) { setGroupSt(r.rows || []); if (r.error) setErr(String(r.error)); } });
    return () => { alive = false; };
  }, []);
  const sum = useMemo(() => {
    const gst = groupSt && group ? stationsOfLineFamily(lines, group, groupSt) : stations;
    // ทะเบียนพนักงานทั้งโรงงาน (ไม่ใช่ของบอร์ดส่วนงาน) — ให้ได้เลขเดียวกับภาพรวมเป๊ะ
    const gPlaced = layoutPeople({ stations: gst, homeByEmp: homes, attendance, empById: allEmpById, shiftOfEmp, stationPlans });
    const gFit = stationSkillGaps(gPlaced, { skillsByEmp: skills?.byEmp || {},
      reqsByStation: Object.fromEntries(gst.map(x => [String(x.id), x.station_requirements || []])) });
    return { ...lineStaffStatus({ familyLines: group ? lineFamilyDown(lines, group) : [],
      stationIds: new Set(gst.map(x => String(x.id))), allStationIds, attendance, empById: allEmpById, shift: curShift, fit: gFit }), group };
  }, [group, groupSt, lines, stations, homes, attendance, allEmpById, shiftOfEmp, stationPlans, skills, allStationIds, curShift]);
  const emptyStations = placed.filter(x => !x.people.length).length;
  const slotShort = placed.reduce((a, x) => (x.missing ? { day: a.day + x.missing.day, night: a.night + x.missing.night, unknown: a.unknown + x.missing.unknown } : a), { day: 0, night: 0, unknown: 0 });

  if (!layouts.length) return <div className="card" style={{ padding: 24, color: 'var(--muted)' }}>{viewSwitch && <div style={{ marginBottom: 10 }}>{viewSwitch}</div>}{trI18n('ไลน์ของแผนกที่เลือกยังไม่มีรูปผัง (อัพโหลดที่ /line-setup)')}{err ? ` · ${err}` : ''}</div>;
  const unplaced = stations.filter(s => s.pos_top == null || s.pos_left == null).length;
  const legend = (
    <span style={{ display: 'flex', gap: 12, fontSize: 12, flexWrap: 'wrap' }}>
      {Object.entries(SHIFT_META).map(([k, m]) => <span key={k} style={{ color: m.color, fontWeight: 700 }}>● {trI18n(m.label)}</span>)}
      <span style={{ color: 'var(--muted)' }}>{trI18n("จาง = ลา/ขาด · ✳ = ย้ายมาวันนี้ · ↗ = วันนี้ไปจุดอื่น · วงประ + สีกะ = ขาดคนประจำกะนั้น")}</span>
      {!tv && <span style={{ color: 'var(--muted)' }}>
        {trI18n("จุดมุมหมุด = ทักษะ")}: <b style={{ color: FIT_DOT.ok }}>●</b> {trI18n("ผ่าน")} · <b style={{ color: FIT_DOT.gap }}>●</b> {trI18n("ไม่ถึง")} · <b style={{ color: FIT_DOT.noreq }}>●</b> {trI18n("จุดยังไม่ตั้งทักษะ · กดหมุด = รายละเอียด")}
      </span>}
    </span>
  );
  const fitLine = (
    <div style={{ fontSize: 12, color: fitGaps.gaps.length ? 'var(--amber)' : 'var(--muted)' }}>
      {trI18n("ฝีมือตรงจุดไหม (คนที่มาวันนี้): ตรวจ")} {fitGaps.checked} {trI18n('คน · ผ่านครบทุกทักษะ')} {fitGaps.ok} {trI18n("คน")}
      {fitGaps.gaps.length > 0 && <b> {trI18n('· ยืนจุดที่ทักษะยังไม่ถึง')} {fitGaps.gaps.length} {trI18n('คน')}</b>}
      {fitGaps.onlyApproval > 0 && <span> {trI18n('(⏳ ในนี้')} {fitGaps.onlyApproval} {trI18n("คนได้ขั้นแล้ว แค่รอหัวหน้าอนุมัติที่")} /operator?tab=levelup)</span>}
      {fitGaps.noReqStations > 0 && <span style={{ color: 'var(--muted)' }}> {trI18n('· ยังไม่ตั้งทักษะที่จุดต้องการ')} {fitGaps.noReqStations} {trI18n('จุด (')}{fitGaps.noReqPeople} {trI18n("คนที่ยืนอยู่ ตรวจไม่ได้ — ตั้งที่")} /line-setup)</span>}
    </div>
  );
  const openX = openSt != null ? placed.find(x => String(x.station.id) === String(openSt)) : null;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <FilterBar bare>
        {viewSwitch}
        <span className="spacer" />
        {tv && legend}
      </FilterBar>
      {err && <div style={{ fontSize: 12, color: 'var(--red)' }}>⚠️ {err}</div>}
      {autoLayout && <div style={{ fontSize: 12, color: 'var(--blue)' }}>ℹ️ {trI18n('แสดงผัง')} <b>{autoLayout.line_name}</b>{layouts.length > 1 ? ` ${trI18n('(ผังแรกจาก')} ${layouts.length} ${trI18n('ผังในขอบเขตนี้ — เลือกไลน์จากช่องด้านบนเพื่อดูผังอื่น)')}` : ''}</div>}
      {viaParent && layout && <div style={{ fontSize: 12, color: 'var(--blue)' }}>ℹ️ {trI18n('ไลน์')} <b>{lline}</b> {trI18n('ไม่มีรูปผังของตัวเอง — แสดงผังของไลน์แม่')} <b>{viaParent}</b> {trI18n('(จุดงานของไลน์ลูกอยู่บนผังนี้)')}</div>}
      {llineMissing ? (
        <div className="card" style={{ padding: 24, color: 'var(--amber)' }}>
          ⚠️ {trI18n('ไลน์')} <b>{lline}</b> {trI18n('ยังไม่มีรูปผังในส่วนงานนี้ — อัพโหลดที่ /line-setup หรือเลือกผังอื่นจากช่องด้านบน')}
        </div>
      ) : tv ? (
        <>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            {stations.length} {trI18n('จุดงาน · ยังไม่มีคนประจำ')} {emptyStations} {trI18n('จุด')}{unplaced ? ` · ${trI18n("ยังไม่วางพิกัด")} ${unplaced} ${trI18n("จุด")}` : ''}
            {slotShort.day + slotShort.night + slotShort.unknown > 0 && <span style={{ color: 'var(--amber)' }}> {trI18n('· ขาดคนประจำ เช้า')} {slotShort.day} {trI18n('· ดึก')} {slotShort.night} {trI18n('ช่อง')}{slotShort.unknown ? ` · ${trI18n("ยังไม่รู้กะ")} ${slotShort.unknown} ${trI18n("ช่อง (ตั้งตารางกะที่")} /shift-organize)` : ''}</span>} — {trI18n("ตั้งจุดประจำที่")} /management
          </div>
          {fitLine}
          <LayoutMap layout={layout} placed={placed} reserve={48} fit={fitGaps} tv />
          <BoardPager page={clampPage(tvIdx, layouts.length)} count={layouts.length} onPage={setTvIdx} labels={layouts.map(l => l.line_name)} />
        </>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0,1fr)' : 'minmax(0,1fr) 300px', gap: 10, alignItems: 'start' }}>
            {/* 🔴 แผงอยู่ "ก่อน" ผังใน DOM (วางขวาด้วย grid) — useFitHeight นับพี่น้องที่ตามหลังเป็น "ของใต้กล่อง"
                แผงสูงกว่าจอ = ผังวัดที่ไม่ได้แล้วล้นจอ · มือถือ = order ดันแผงลงใต้ผัง */}
            <div style={isMobile ? { order: 2 } : { gridColumn: 2, gridRow: 1 }}>
              <LineSidePanel sum={sum} stationsN={stations.length} emptyStations={emptyStations} slotShort={slotShort} placed={placed} fit={fitGaps} unplaced={unplaced} focus={focus}
                onFocus={id => setFocus(f => (String(f) === String(id) ? null : id))} onOpen={setOpenSt} fitLine={fitLine} legend={legend}
                gapOpen={gapOpen} onGapToggle={() => setGapOpen(v => !v)} />
            </div>
            <div style={isMobile ? undefined : { gridColumn: 1, gridRow: 1, minWidth: 0 }}>
              <LayoutMap layout={layout} placed={placed} reserve={12} fit={fitGaps} focus={focus} onOpen={setOpenSt} />
            </div>
          </div>
          {/* ตารางรายคน = รายละเอียด (จำนวนคนเห็นอยู่แล้วในแผง) ⇒ กดเปิด · เปิดแล้วผังจะเตี้ยลงให้ตารางอยู่ในจอ */}
          {gapOpen && fitGaps.gaps.length > 0 && <SkillGapTable gaps={fitGaps.gaps} defs={skills?.defs || {}} />}
        </>
      )}
      {openX && <StationModal x={openX} lineName={layout?.line_name} skills={skills} fit={fitGaps} onClose={() => setOpenSt(null)} />}
    </div>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div style={{ padding: '6px 8px', borderRadius: 'var(--r-md)', background: 'var(--bg2)' }}>
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{trI18n(label)}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: tone || 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

/* แผงขวาของผังรายไลน์ — ตัวเลขสรุป + จุดที่ต้องดู (กด = ชี้หมุดบนผัง) */
function LineSidePanel({ sum, stationsN, emptyStations, slotShort, placed, fit, unplaced, focus, onFocus, onOpen, fitLine, legend, gapOpen, onGapToggle }) {
  const gapByStation = useMemo(() => {
    const m = {};
    for (const g of fit.gaps) m[String(g.station.id)] = (m[String(g.station.id)] || 0) + 1;
    return m;
  }, [fit]);
  const issues = placed.map(x => {
    const n = x.missing ? x.missing.day + x.missing.night + x.missing.unknown : 0;
    const g = gapByStation[String(x.station.id)] || 0;
    return { x, n, g, rank: n ? 0 : 1 };
  }).filter(i => i.n || i.g).sort((a, b) => a.rank - b.rank || b.n - a.n || naturalCompare(a.x.station.station_name || '', b.x.station.station_name || ''));
  return (
    <div className="card" style={{ padding: 10, display: 'grid', gap: 8, alignContent: 'start' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: STAFF_TONE[sum.status] }} />
        <b style={{ color: STAFF_TONE[sum.status] }}>{trI18n(sum.status === 'none' ? sum.reason : STAFF_TEXT[sum.status])}</b>
      </div>
      {sum.group && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{trI18n('ตัดสินทั้งกลุ่ม')} <b style={{ color: 'var(--text)' }}>{sum.group}</b></div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <Stat label={`${trI18n("มา")}${sum.shift === 'night' ? trI18n('กะดึก') : trI18n('กะเช้า')} / std`} value={sum.std == null ? '—' : `${sum.onFloor}/${sum.std}`} />
        <Stat label={trI18n("ขาด (คน)")} value={sum.short == null ? '—' : sum.short} tone={sum.short >= 3 ? 'var(--red)' : sum.short ? 'var(--amber)' : undefined} />
        <Stat label={trI18n("ทักษะไม่ถึง (กะนี้ ทั้งกลุ่ม)")} value={`${sum.gapPeople} ${trI18n("คน")}`} tone={sum.gapPeople ? 'var(--amber)' : undefined} />
        <Stat label={trI18n("จุดงาน (ยังไม่มีคนประจำ)")} value={`${stationsN} (${emptyStations})`} />
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
        {trI18n('สีไลน์ = คนที่มากะนี้เทียบกำลังคนตามผัง (std) · จุดงานเยอะกว่าคนได้ปกติ (คนเดียวหมุนหลายจุด) จึงไม่นับจุดว่างเป็นการขาด')}
        {slotShort.unknown > 0 && <div style={{ color: 'var(--amber)' }}>{trI18n('ขาดคนประจำจุด')} {slotShort.unknown} {trI18n('ช่อง ยังไม่รู้กะ (ตั้งตารางกะที่ /shift-organize)')}</div>}
        {unplaced > 0 && <div>{trI18n('ยังไม่วางพิกัด')} {unplaced} {trI18n('จุด')}</div>}
      </div>
      <div style={{ fontWeight: 800, fontSize: 13, marginTop: 2 }}>{trI18n('จุดที่ต้องดู')} {issues.length ? `(${issues.length})` : ''}</div>
      {!issues.length && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{trI18n('ไม่มีจุดที่ขาดคนประจำ/ทักษะไม่ถึง')}</div>}
      <div style={{ display: 'grid', gap: 4, maxHeight: 320, overflowY: 'auto' }}>
        {issues.map(({ x, g }) => {
          const on = String(focus) === String(x.station.id);
          return (
            <div key={x.station.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 'var(--r-md)',
              border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`, background: on ? 'var(--accent-dim)' : 'var(--bg2)' }}>
              <button type="button" onClick={() => onFocus(x.station.id)} title={trI18n('ชี้ตำแหน่งบนผัง')}
                style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer', padding: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.station.station_name || '–'}</div>
                <div style={{ fontSize: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {x.missing?.day > 0 && <span style={{ color: shiftMeta('day').color }}>{trI18n('ขาดเช้า')} {x.missing.day}</span>}
                  {x.missing?.night > 0 && <span style={{ color: shiftMeta('night').color }}>{trI18n('ขาดดึก')} {x.missing.night}</span>}
                  {x.missing?.unknown > 0 && <span style={{ color: 'var(--muted)' }}>{trI18n('ขาด')} {x.missing.unknown} {trI18n('(ไม่รู้กะ)')}</span>}
                  {g > 0 && <span style={{ color: 'var(--amber)' }}>{trI18n('ทักษะไม่ถึง')} {g}</span>}
                </div>
              </button>
              <button type="button" className="pg-btn" onClick={() => onOpen(x.station.id)}
                style={{ fontSize: 12, padding: '3px 8px', borderRadius: 'var(--r-md)', border: '1px solid var(--border2)', background: 'var(--card-surf)', color: 'var(--text2)', cursor: 'pointer' }}>
                {trI18n('ดู')}
              </button>
            </div>
          );
        })}
      </div>
      {fitLine}
      {fit.gaps.length > 0 && (
        <button type="button" className="pg-btn" onClick={onGapToggle} aria-expanded={gapOpen}
          style={{ fontSize: 12, fontWeight: 700, padding: '5px 10px', borderRadius: 'var(--r-md)', cursor: 'pointer',
            border: '1px solid var(--amber)', background: 'var(--bg2-surf)', color: 'var(--amber)' }}>
          {gapOpen ? '▲ ' : '▼ '}{trI18n('ตารางคนที่ทักษะยังไม่ถึง')} ({fit.gaps.length})
        </button>
      )}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6 }}>{legend}</div>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{trI18n('ตั้งจุดประจำที่ /management')}</div>
    </div>
  );
}

/* modal รายละเอียดจุดงาน — อ่านอย่างเดียว · ปิดด้วย ✕ / Esc (ด่าน modal-closes-on-backdrop) */
function StationModal({ x, lineName, skills, fit, onClose }) {
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  const reqs = x.station.station_requirements || [];
  const defs = skills?.defs || {};
  const groups = ['day', 'night', 'none'].map(sh => ({ sh, people: x.people.filter(p => (p.shift === 'day' || p.shift === 'night' ? p.shift : 'none') === sh) }))
    .filter(g => g.people.length || (g.sh !== 'none' && x.missing?.[g.sh] > 0));
  return (
    <div className="modal-scroll"
      style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', WebkitBackdropFilter: 'var(--scrim-blur)', backdropFilter: 'var(--scrim-blur)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: 16 }}>
      <div role="dialog" aria-modal="true"
        style={{ background: 'var(--card-surf)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)',
          width: 'min(96vw, 760px)', maxHeight: '94vh', overflowY: 'auto', padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{trI18n('จุดงาน')}{lineName ? ` · ${lineName}` : ''}</div>
            <h3 style={{ margin: '2px 0 0', fontSize: 17, fontWeight: 800 }}>{x.station.station_name || '–'}</h3>
            <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
              {x.need != null ? `${trI18n('ช่องประจำ')} ${x.need} ${trI18n('คน/กะ')}` : trI18n('ยังไม่ตั้งช่องประจำจุด')}
              {x.missing?.unknown > 0 && <span style={{ color: 'var(--amber)' }}> · {trI18n('ขาด')} {x.missing.unknown} {trI18n('ช่อง (ยังไม่รู้กะ)')}</span>}
            </div>
          </div>
          <button onClick={onClose} aria-label={trI18n('ปิด')}
            style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: 4 }}>✕</button>
        </div>

        <div style={{ fontSize: 12, marginBottom: 10 }}>
          <span style={{ color: 'var(--muted)' }}>{trI18n('ทักษะที่จุดนี้ต้องการ:')} </span>
          {reqs.length ? reqs.map(r => (
            <span key={r.skill_name} style={{ display: 'inline-block', margin: '2px 4px 2px 0', padding: '1px 8px', borderRadius: 'var(--r-pill)', border: '1px solid var(--border2)' }}>
              {trI18n(defs[r.skill_name]?.label) || r.skill_name} ≥ {r.min_score}
            </span>
          )) : <span style={{ color: 'var(--muted)' }}>{trI18n('ยังไม่ตั้ง (ตรวจฝีมือไม่ได้ — ตั้งที่ /line-setup)')}</span>}
        </div>

        {!groups.length && <div style={{ padding: 12, color: 'var(--muted)', fontSize: 13 }}>{trI18n('ยังไม่มีคนประจำจุดนี้ และวันนี้ไม่มีใครมายืน — ตั้งจุดประจำที่ /management')}</div>}
        {groups.map(({ sh, people }) => (
          <div key={sh} style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 800, fontSize: 13, color: shiftMeta(sh === 'none' ? null : sh).color, marginBottom: 6 }}>
              {trI18n(shiftMeta(sh === 'none' ? null : sh).label)} · {people.length} {trI18n('คน')}
              {sh !== 'none' && x.missing?.[sh] > 0 && <span style={{ color: 'var(--amber)' }}> · {trI18n('ขาด')} {x.missing[sh]} {trI18n('ช่อง')}</span>}
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              {people.map(p => {
                const rows = skills?.byEmp?.[p.emp.id];
                const pf = skillFit(reqs, skillMapOf(rows), pendingMapOf(rows));
                const fs = personFitState(x, p, fit);
                const am = ATTEND_META[p.attend] || ATTEND_META.unchecked;
                return (
                  <div key={p.emp.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: 8, borderRadius: 'var(--r-md)', background: 'var(--bg2)' }}>
                    <div style={{ width: 40, height: 40, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: 'var(--bg3)', border: `2px ${p.temp ? 'dashed' : 'solid'} ${shiftMeta(p.shift).color}` }}>
                      {p.emp.image_url ? <img src={p.emp.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: shiftMeta(p.shift).color }}>{(p.emp.name || '?').slice(0, 1)}</div>}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
                        <b style={{ fontSize: 13 }}>{p.emp.name}</b>
                        {p.emp.employee_id_code && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{p.emp.employee_id_code}</span>}
                        <span style={{ fontSize: 12, fontWeight: 700, color: am.color }}>{trI18n(am.label)}</span>
                        {p.temp && <span style={{ fontSize: 12, color: 'var(--blue)' }}>{trI18n('✳ ย้ายมาวันนี้')}</span>}
                        {p.away && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{trI18n('↗ วันนี้ไปยืนจุดอื่น')}</span>}
                      </div>
                      {pf ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                          {pf.details.map(d => (
                            <span key={d.skill_name} style={{ fontSize: 12, padding: '1px 8px', borderRadius: 'var(--r-pill)',
                              border: `1px ${d.assessed ? 'solid' : 'dashed'} ${d.pass ? 'var(--green)' : 'var(--amber)'}`, color: d.pass ? 'var(--green)' : 'var(--text)' }}>
                              {trI18n(defs[d.skill_name]?.label) || d.skill_name}{' '}
                              <b style={{ fontVariantNumeric: 'tabular-nums' }}>{d.assessed ? `${d.actual}/${d.required}` : `${trI18n('ยังไม่ประเมิน')} /${d.required}`}</b>
                              {d.pending != null && <span style={{ marginLeft: 4, color: d.waitApproval ? 'var(--blue)' : 'var(--muted)' }}>⏳ {d.pending}</span>}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {fs == null && pf && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{trI18n('วันนี้ไม่ได้ยืนจุดนี้ — ไม่นับในการตรวจฝีมือ')}</div>}
                    </div>
                    {fs && <span title={trI18n('ทักษะเทียบจุดนี้')} style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', color: FIT_DOT[fs] }}>
                      {fs === 'ok' ? trI18n('ผ่าน') : fs === 'gap' ? `${pf?.passed ?? 0}/${pf?.total ?? 0}` : trI18n('ตรวจไม่ได้')}
                    </span>}
                  </div>
                );
              })}
              {sh !== 'none' && Array.from({ length: x.missing?.[sh] || 0 }, (_, i) => (
                <div key={`m${i}`} style={{ padding: 8, borderRadius: 'var(--r-md)', border: `1px dashed ${shiftMeta(sh).color}`, fontSize: 12, color: 'var(--muted)' }}>
                  + {trI18n('ช่องว่าง')} {trI18n(shiftMeta(sh).label)}
                </div>
              ))}
            </div>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{trI18n('ตั้ง/ยกเลิกจุดประจำที่ /management · ประเมินทักษะที่ /operator')}</span>
          <button type="button" className="pg-btn" onClick={onClose}
            style={{ padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border2)', background: 'var(--bg2-surf)', color: 'var(--text2)' }}>{trI18n('ปิด')}</button>
        </div>
      </div>
    </div>
  );
}

/* 🎯 รายชื่อคนที่ยืนจุดที่ทักษะยังไม่ถึง — ต่ำสุดก่อน · ขาดทักษะไหน (มี/ต้องการ) · ✳ = ย้ายมาวันนี้ */
function SkillGapTable({ gaps, defs }) {
  const th = { textAlign: 'left', fontSize: 12, padding: '8px 10px', color: 'var(--muted)', whiteSpace: 'nowrap' };
  const td = { padding: '7px 10px', fontSize: 13, borderTop: '1px solid var(--border)', verticalAlign: 'top' };
  return (
    <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
      <div style={{ padding: '10px 12px', fontWeight: 800 }}>{trI18n('ยืนจุดที่ทักษะยังไม่ถึง')} <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--muted)' }}>{trI18n('(คนที่มาวันนี้ · เทียบกับทักษะที่จุดงานต้องการ)')}</span></div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={th}>{trI18n('พนักงาน')}</th><th style={th}>{trI18n('จุดงาน')}</th><th style={th}>{trI18n('กะ')}</th><th style={{ ...th, textAlign: 'right' }}>{trI18n('ผ่าน')}</th><th style={th}>{trI18n('ทักษะที่ยังไม่ถึง (มี / ต้องการ)')}</th></tr></thead>
        <tbody>
          {gaps.map(g => (
            <tr key={`${g.emp.id}-${g.station.id}`}>
              <td style={{ ...td, fontWeight: 700 }}>{g.emp.name}{g.temp && <span title={trI18n('ย้ายมายืนจุดนี้วันนี้ (จุดประจำอยู่ที่อื่น)')} style={{ marginLeft: 6, color: 'var(--blue)' }}>{trI18n('✳ ย้ายมาวันนี้')}</span>}</td>
              <td style={td}>{g.station.station_name || '–'}</td>
              <td style={{ ...td, whiteSpace: 'nowrap', color: shiftMeta(g.shift).color }}>{trI18n(shiftMeta(g.shift).label)}</td>
              <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{g.fit.passed}/{g.fit.total}</td>
              <td style={td}>
                <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {g.missing.map(m => (
                    <span key={m.skill_name} style={{ whiteSpace: 'nowrap', fontSize: 12, padding: '1px 8px', borderRadius: 'var(--r-pill)',
                      border: `1px ${m.assessed ? 'solid' : 'dashed'} var(--border2)`, color: m.assessed ? 'var(--text)' : 'var(--muted)' }}>
                      {trI18n(defs[m.skill_name]?.label) || m.skill_name}{' '}
                      {m.assessed ? <b style={{ fontVariantNumeric: 'tabular-nums' }}>{m.actual}/{m.required}</b> : <span>{trI18n('ยังไม่ประเมิน (ต้องการ')} {m.required})</span>}
                      {m.pending != null && <span title={trI18n('ได้ขั้นนี้แล้วจากการสะสม EXP — รอหัวหน้ากดอนุมัติ')} style={{ marginLeft: 4, color: m.waitApproval ? 'var(--blue)' : 'var(--muted)' }}>{trI18n('⏳ รออนุมัติขั้น')} {m.pending}</span>}
                    </span>
                  ))}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--muted)' }}>
        {trI18n("กรอบทึบ = ประเมินแล้วแต่คะแนนยังไม่ถึง (มี/ต้องการ) · กรอบประ = ยังไม่เคยประเมินทักษะนั้น (นับเป็น 0) · ⏳ = ได้ขั้นแล้วจากการสะสม EXP แต่รอหัวหน้าอนุมัติ (สีฟ้า = อนุมัติแล้วจะผ่านจุดนี้ทันที) · ประเมิน/ปรับคะแนนที่ /operator · ตั้งทักษะที่จุดต้องการที่")} /line-setup
      </div>
    </div>
  );
}

function LayoutMap({ layout, placed, reserve = 12, fit = null, focus = null, onOpen = null, tv = false }) {
  const { imgRef, imgBox, recalc } = useImgBox([layout?.image_url]);
  // ผังต้องจบในจอเดียว (จอ TV ไม่มีเมาส์) — วัดที่เหลือจริง ห้ามเดา vh (UI §6.23 ข้อ 1) · วัดไม่ได้ = สูงตามรูป
  const [fitRef, fitH] = useFitHeight(reserve, 240);
  const pts = placed.filter(x => x.station.pos_top != null && x.station.pos_left != null)
    .map(x => ({ x: parseFloat(x.station.pos_left), y: parseFloat(x.station.pos_top) }));
  const ms = imgBox ? markerScale(imgBox.rw, { points: pts, mapHeight: imgBox.rh }) : null;
  const sz = ms ? Math.round(ms.MK * 0.62) : 28;
  const dot = Math.max(7, Math.round(sz * 0.3));
  return (
    <div ref={fitRef} className="card" style={{ padding: 8, position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <img ref={imgRef} src={layout.image_url} alt={layout.line_name} onLoad={recalc}
          style={{ width: '100%', maxHeight: fitH ? fitH - 16 : undefined, objectFit: 'contain', display: 'block' }} />
        {imgBox && (
          <div style={{ position: 'absolute', left: imgBox.ox, top: imgBox.oy, width: imgBox.rw, height: imgBox.rh, pointerEvents: 'none' }}>
            {placed.filter(x => x.station.pos_top != null && x.station.pos_left != null).map((x) => {
              const { station, people, missing } = x;
              const on = focus != null && String(focus) === String(station.id);
              // 👥 คนเกิน MARKER_MAX = ยุบเป็น +N (ครบใน modal) · ช่องขาดยังวาดครบ (ความผิดปกติห้ามซ่อน · UI §5.5)
              const shown = people.slice(0, MARKER_MAX), more = people.length - shown.length;
              return (
              <div key={station.id} onClick={onOpen ? () => onOpen(station.id) : undefined}
                style={{ position: 'absolute', top: `${parseFloat(station.pos_top)}%`, left: `${parseFloat(station.pos_left)}%`,
                  transform: `translate(-50%, -50%)${on ? ' scale(1.25)' : ''}`, transition: 'transform .2s', zIndex: on ? 2 : undefined,
                  pointerEvents: 'auto', cursor: onOpen ? 'pointer' : undefined }}>
                <div style={{ position: 'relative', display: 'flex', gap: 2, borderRadius: 'var(--r-pill)',
                  boxShadow: on ? '0 0 0 3px var(--accent), 0 0 14px var(--accent)' : undefined }}>
                  {shown.length ? shown.map((p) => {
                    const { emp, shift, attend, temp, away } = p;
                    const c = shiftMeta(shift).color;
                    const dim = away || attend === 'leave' || attend === 'absent';
                    const fs = !tv && fit ? personFitState(x, p, fit) : null;
                    return (
                      <div key={emp.id} title={`${emp.name} · ${trI18n(shiftMeta(shift).label)} · ${trI18n(ATTEND_META[attend].label)}${temp ? trI18n(' · ย้ายมาวันนี้') : ''}${away ? trI18n(' · วันนี้ไปยืนจุดอื่น') : ''}`}
                        style={{ position: 'relative', width: sz, height: sz }}>
                        <div style={{ width: '100%', height: '100%', borderRadius: '50%', overflow: 'hidden', background: '#1a1a1a',
                          border: `${ms?.ring || 2}px ${temp ? 'dashed' : 'solid'} ${c}`, opacity: dim ? 0.4 : 1, filter: dim ? 'grayscale(1)' : undefined }}>
                          {emp.image_url ? <img src={emp.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: c }}>{(emp.name || '?').slice(0, 1)}</div>}
                        </div>
                        {(temp || away) && <span style={{ position: 'absolute', top: 0, right: 0, fontSize: 11, lineHeight: 1, background: 'rgba(0,0,0,.75)', color: '#fff', borderRadius: 'var(--r-md)', padding: '0 2px' }}>{temp ? '✳' : '↗'}</span>}
                        {/* 🎯 จุดทักษะมุมล่างขวา — เฉพาะคนที่ยืนอยู่จริงวันนี้ (คนลา/ไปจุดอื่น ไม่ตัดสิน) */}
                        {fs && <span style={{ position: 'absolute', right: -1, bottom: -1, width: dot, height: dot, borderRadius: '50%', background: FIT_DOT[fs], border: '1.5px solid var(--bg)' }} />}
                      </div>
                    );
                  }) : !missing ? (
                    <div title={`${station.station_name} · ${trI18n("ยังไม่มีคนประจำ")}`} style={{ width: sz, height: sz, borderRadius: '50%', border: '2px dashed var(--muted)', background: 'rgba(0,0,0,.35)', color: '#cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800 }}>+</div>
                  ) : null}
                  {more > 0 && (
                    <div title={`${station.station_name} · ${trI18n("อีก")} ${more} ${trI18n("คน (กดดูทั้งหมด")})`} style={{ width: sz, height: sz, borderRadius: '50%', background: 'var(--bg3)', border: '2px solid var(--border2)',
                      color: 'var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800 }}>+{more}</div>
                  )}
                  {/* 📍 ช่องที่ขาดต่อกะ (station_slot_plans) — วงประสีของกะ ⇒ เห็นเลยว่าจุดไหนขาดคนกะไหน */}
                  {missing && ['day', 'night', 'unknown'].flatMap(sh => Array.from({ length: missing[sh] || 0 }, (_, i) => (
                    <div key={`${sh}${i}`} title={sh === 'unknown' ? `${station.station_name} · ${trI18n("ขาดคนประจำ (ยังไม่รู้กะ — ตารางกะยังไม่ตั้ง")})` : `${station.station_name} · ${trI18n("ขาดคนประจำ")}${shiftMeta(sh).label}`}
                      style={{ width: sz, height: sz, borderRadius: '50%', border: `2px dashed ${shiftMeta(sh === 'unknown' ? null : sh).color}`, background: 'rgba(0,0,0,.35)',
                        color: shiftMeta(sh === 'unknown' ? null : sh).color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800 }}>{sh === 'unknown' ? '?' : '+'}</div>
                  )))}
                  <div style={{ position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: 2, background: on ? 'var(--accent)' : 'rgba(0,0,0,0.78)', color: '#fff', borderRadius: 'var(--r-xs)',
                    padding: '0 5px', fontSize: ms?.pillFont || 11, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: ms?.pillMaxW || 96 }}>
                    {station.station_name}
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═════════════════════════ 🚦 ป้ายสถานะ 4M ═════════════════════════ */
/* โหมด TV: การ์ดสูงคงที่ (แถวละ 1 บรรทัดรายละเอียด + "+N") ⇒ นับได้ว่าหน้าหนึ่งลงกี่ใบ */
const FOURM_CARD_W = 420, FOURM_CARD_H = 330, FOURM_GAP = 12;

function FourMCard({ d, logs, tv }) {
  const st = fourMStatus(d.lines, logs);
  const descMax = tv ? 1 : 3;
  return (
    <div className="card" style={{ padding: 12, ...(tv ? { height: FOURM_CARD_H, overflow: 'hidden' } : null) }}>
      <div style={{ marginBottom: 8 }}><RoleTag>{trI18n('ป้ายแจ้งสถานะ')} {d.name}</RoleTag>
        <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 8 }}>{trI18n('สถานะการเปลี่ยนแปลงวันนี้ ·')} {d.lines.length} {trI18n('ไลน์')}</span>
      </div>
      {!d.lines.length && <div style={{ fontSize: 12, color: 'var(--amber)', marginBottom: 6 }}>{trI18n('⚠️ แผนกนี้ยังไม่ผูกไลน์ผลิต — ตัดสิน 4M ไม่ได้')}</div>}
      <div style={{ display: 'grid', gap: 6 }}>
        {FOUR_M.map(m => {
          const s = st[m.key];
          const bad = s.abnormal;
          const tone = !d.lines.length ? '#64748b' : bad ? '#ef4444' : '#22c55e';
          return (
            <div key={m.key} style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8, alignItems: 'stretch' }}>
              <div style={{ background: m.color, color: m.key === 'machine' ? '#1f2937' : '#fff', fontWeight: 800, fontSize: 14, borderRadius: 'var(--r-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 4px' }}>{trI18n(m.label)}</div>
              <div style={{ border: `2px solid ${tone}`, borderRadius: 'var(--r-md)', padding: '6px 10px', minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 16, color: tone }}>
                  {!d.lines.length ? trI18n("ไม่รู้") : bad ? `${trI18n("ผิดปกติ")} · ${s.rows.length} ${trI18n("ใบ")}` : trI18n("ปกติ")}
                  {bad && s.pending > 0 && <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginLeft: 6 }}>{trI18n('(รออนุมัติ')} {s.pending})</span>}
                </div>
                {s.rows.slice(0, descMax).map(r => (
                  <div key={r.id} style={{ fontSize: 12, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.description}>
                    · {r.line_name} — {r.description || trI18n("(ไม่มีรายละเอียด)")}
                  </div>
                ))}
                {s.rows.length > descMax && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{trI18n('+ อีก')} {s.rows.length - descMax} {trI18n('ใบ')}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FourMTab({ depts, logs, tv }) {
  if (!depts.length) return <div className="card" style={{ padding: 24, color: 'var(--muted)' }}>{trI18n('ไม่มีแผนกให้แสดง')}</div>;
  if (tv) return <FourMTv depts={depts} logs={logs} />;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 420px), 1fr))', gap: 12, alignItems: 'start' }}>
      {depts.map(d => <FourMCard key={d.key} d={d} logs={logs} />)}
    </div>
  );
}

function FourMTv({ depts, logs }) {
  const [ref, fitH] = useFitHeight(48, 320);
  const w = useWidth(ref);
  const cols = Math.max(1, Math.floor((w + FOURM_GAP) / (FOURM_CARD_W + FOURM_GAP)));
  const rows = fitH ? Math.max(1, Math.floor((fitH + FOURM_GAP) / (FOURM_CARD_H + FOURM_GAP))) : 1;
  const pages = useMemo(() => packPages(depts, cols * rows), [depts, cols, rows]);
  const [page, setPage] = useAutoPage(pages.length);
  const cur = pages[clampPage(page, pages.length)] || [];
  return (
    <>
      <div ref={ref} style={{ height: fitH || undefined, overflow: 'clip', display: 'grid', alignContent: 'start',
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: FOURM_GAP }}>
        {cur.map(d => <FourMCard key={d.key} d={d} logs={logs} tv />)}
      </div>
      <BoardPager page={clampPage(page, pages.length)} count={pages.length} onPage={setPage} labels={pages.map(pg => pg.map(d => d.name).join(' · '))} />
    </>
  );
}

/* ═════════════════════════ 📺 ผังกำลังคน — โหมดจอ TV ═════════════════════════ */
/* กติกา (UI §6.23): ไม่เลื่อน · ที่ไม่พอ = แบ่งหน้า (ห้ามบีบการ์ด) · BoardPager ของกลาง · เปลี่ยนหน้าเองทุก 20 วิ
   การ์ด/แถบหัวขนาดคงที่ ⇒ นับความจุได้แน่นอน (`tvCardCapacity`) แล้วให้ `paginateTv` ตัดหน้า (pure + เทส) */
const TV_CARD = { w: 136, h: 128 };
const TV_TOP_H = 64, TV_DEPT_H = 56, TV_COLHEAD_H = 50, TV_GAP = 8;
const TV_AUTO_MS = 20_000;   // จอแขวน: วนหน้าเองให้คนเดินผ่านเห็นครบ · กดเอง/ลูกศร = นับใหม่

/** กว้างจริงของกล่อง (ResizeObserver) — 0 จนกว่าจะวัดได้ */
function useWidth(ref) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const set = () => setW(cur => (Math.abs(cur - el.clientWidth) < 4 ? cur : el.clientWidth));   // โซนหน่วง กันวงจรป้อนกลับ
    set();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(set) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [ref]);
  return w;
}

/** หน้าปัจจุบัน + วนเองทุก TV_AUTO_MS (เปลี่ยนหน้าเอง = ตั้งนาฬิกาใหม่ เพราะ effect ผูกกับ page) */
function useAutoPage(count) {
  const [page, setPage] = useState(0);
  useEffect(() => {
    if (!(count > 1)) return undefined;
    const t = setTimeout(() => setPage(p => (clampPage(p, count) + 1) % count), TV_AUTO_MS);
    return () => clearTimeout(t);
  }, [page, count]);
  return [page, setPage];
}

/** ชิปคนแบบบรรทัดเดียว (แถบหัวจอ TV) */
function MiniPerson({ p }) {
  return (
    <div title={`${p.name} · ${positionLabel(p.position) || ''}${p.acting ? ` · ${trI18n("รักษาการ (สังกัดจริง")} ${p.acting.nodeName || '—'}${p.acting.costCenter ? ` · CC ${p.acting.costCenter}` : ''})` : ''}`}
      style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '0 1 auto', minWidth: 0, maxWidth: 220 }}>
      <Photo p={p} size={26} />
      <div style={{ minWidth: 0, lineHeight: 1.2 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
        {/* 🎖️ จอ TV ไม่มีที่ให้เขียนยาว — แทนตำแหน่งด้วย "รักษาการ · บ้านจริง" ไปเลย
            (ป้ายที่ตัดทิ้งเพราะพื้นที่ไม่พอ = คนอ่านผังเข้าใจว่าเขาย้ายมาสังกัดแล้ว) */}
        <div style={{ fontSize: 11, color: p.acting ? 'var(--amber)' : 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {p.acting ? `🎖️ ${trI18n("รักษาการ")}${p.acting.nodeName ? ` · ${p.acting.nodeName}` : ''}` : positionLabel(p.position)}
        </div>
      </div>
    </div>
  );
}

function TvCard({ p, skills }) {
  const top = topSkills(skills.byEmp[p.id], 2);
  return (
    <div style={{ width: TV_CARD.w, height: TV_CARD.h, overflow: 'hidden', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 6,
      background: 'var(--card-surf)', display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={{ display: 'flex', gap: 6, minWidth: 0 }}>
        <Photo p={p} size={34} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.25, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.name}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{p.employee_id_code || ''}</div>
        </div>
      </div>
      <AttendDot p={p} />
      <HelperTag p={p} />
      {top.length ? top.map(s => {
        const d = skills.defs[s.skill_name];
        return (
          <div key={s.skill_name} title={`${d?.label || s.skill_name}: ${s.score}`}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, gap: 4 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{trI18n(d?.label) || s.skill_name}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--muted)' }}>{s.score}</span>
            </div>
            <div style={{ height: 4, borderRadius: 'var(--r-xs)', background: 'var(--bg3)' }}>
              <div style={{ width: `${Math.min(100, s.score || 0)}%`, height: '100%', borderRadius: 'var(--r-xs)', background: d?.color || 'var(--accent)' }} />
            </div>
          </div>
        );
      }) : <span style={{ fontSize: 11, color: 'var(--muted)' }}>{trI18n('ยังไม่มีคะแนน skill')}</span>}
    </div>
  );
}

function OrgTv({ board, depts, skills }) {
  const [ref, fitH] = useFitHeight(48, 360);
  const w = useWidth(ref);
  const areaH = (fitH || 0) - TV_TOP_H - TV_DEPT_H - TV_COLHEAD_H - TV_GAP * 3 - 16;
  const pages = useMemo(() => paginateTv(depts, (nCols) => tvCardCapacity({
    areaW: w, areaH, nCols, cardW: TV_CARD.w, cardH: TV_CARD.h, colPad: 16, colGap: TV_GAP,
  })), [depts, w, areaH]);
  const [page, setPage] = useAutoPage(pages.length);
  const pi = clampPage(page, pages.length);
  const pg = pages[pi];

  // ที่ไม่พอจริงๆ (มือถือ/จอเตี้ย) = ถอยไปโหมดเลื่อน — ซื่อสัตย์กว่าบีบจนอ่านไม่ออก (UI §6.23 ข้อ 7)
  // ⚠️ กล่องที่ผูก ref ต้องเป็น element เดิมทั้ง 2 โหมด — สลับ element = ตัววัดเฝ้าตัวที่หลุดจากจอแล้ว
  // จอแคบกว่าแท็บเล็ต (มือถือ) ไม่ใช่จอ TV — คอลัมน์ทีมเหลือการ์ดเดียว แถบหัวอ่านไม่ออก ⇒ โหมดเลื่อน
  const fallback = w > 0 && (fitH == null || w < 768);
  const t = board.totals;
  const d = pg?.dept;
  return (
    <>
      <div ref={ref} style={fallback ? undefined : { height: fitH || undefined, overflow: 'clip', display: 'flex', flexDirection: 'column', gap: TV_GAP }}>
        {fallback ? (
          <>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>{trI18n('จอนี้เล็กเกินกว่าจะแบ่งหน้าแบบจอ TV ได้ — แสดงแบบเลื่อนแทน')}</div>
            <OrgTab board={board} depts={depts} skills={skills} />
          </>
        ) : (<>
        {/* แถบหัวผังส่วนงาน — สูงคงที่ คนเยอะเกินถูกตัด (ดูครบได้ที่โหมดปกติ) */}
        <div className="card" style={{ height: TV_TOP_H, flexShrink: 0, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 14, overflow: 'hidden' }}>
          <RoleTag nowrap>{board.section.name}</RoleTag>
          <div style={{ display: 'flex', gap: 14, flex: 1, minWidth: 0, overflow: 'hidden' }}>
            {[...board.top, ...board.support].map(p => <MiniPerson key={p.id} p={p} />)}
          </div>
          <Counter label={trI18n('แผน')} value={t.plan} />
          <Counter label={trI18n('ในทะเบียน')} value={t.ops} sub={trI18n('เฉพาะพนักงาน')} />
          <Counter label={trI18n('มาวันนี้')} value={t.present} tone="var(--green)" />
        </div>
        {!d ? <div className="card" style={{ padding: 24, color: 'var(--muted)' }}>{trI18n('ส่วนงานนี้ยังไม่มีพนักงานหน้างานในทะเบียน')}</div> : (
          <>
            <div style={{ height: TV_DEPT_H, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 14, overflow: 'hidden' }}>
              <RoleTag nowrap>{trI18n('หัวหน้าแผนก')} {d.name}{pg.parts > 1 ? ` · ${trI18n("ส่วนที่")} ${pg.part + 1}/${pg.parts}` : ''}</RoleTag>
              <div style={{ display: 'flex', gap: 14, flex: 1, minWidth: 0, overflow: 'hidden' }}>
                {d.heads.map(p => <MiniPerson key={p.id} p={p} />)}
                {d.techs.length > 0 && <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap', alignSelf: 'center' }}>{trI18n('ช่างประจำไลน์')} {d.techs.length}:</span>}
                {d.techs.map(p => <MiniPerson key={p.id} p={p} />)}
                {d.borrowed.length > 0 && <span style={{ fontSize: 12, color: 'var(--blue)', fontWeight: 700, whiteSpace: 'nowrap', alignSelf: 'center' }}>{trI18n('ยืมมาช่วย')} {d.borrowed.length}:</span>}
                {d.borrowed.map(p => <MiniPerson key={p.id} p={p} />)}
                {/* 🏃 คนวิ่งข้ามแผนก — ไม่นับเป็นกำลังคนของแผนกนี้ (เทา ไม่ใช่สีบริบทฟ้าของคนยืม) */}
                {d.flex.length > 0 && <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700, whiteSpace: 'nowrap', alignSelf: 'center' }}>{trI18n('วิ่งข้ามมาช่วย')} {d.flex.length}:</span>}
                {d.flex.map(p => <MiniPerson key={p.id} p={p} />)}
              </div>
              <Counter label={trI18n('แผน เช้า/ดึก')} value={d.planTotal == null ? null : `${d.plan.day ?? '–'}/${d.plan.night ?? '–'}`} />
              <Counter label={trI18n('ในทะเบียน')} value={d.opsTotal} sub={trI18n('เฉพาะพนักงาน')} />
              <Counter label={trI18n('มาวันนี้')} value={d.present} tone="var(--green)" />
            </div>
            <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: TV_GAP }}>
              {pg.cols.map(({ col: c, items, more }) => {
                const sm = shiftMeta(c.shift);
                return (
                  <div key={c.team || '-'} style={{ flex: '1 1 0', minWidth: 0, border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 8, background: 'var(--bg2-surf)', overflow: 'hidden' }}>
                    <div style={{ height: TV_COLHEAD_H, display: 'flex', flexDirection: 'column', justifyContent: 'center', overflow: 'hidden' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', whiteSpace: 'nowrap' }}>
                        <strong style={{ fontSize: 15 }}>{c.team ? `${trI18n("ทีม")} ${c.team}` : trI18n("ไม่ระบุทีม")}</strong>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: sm.color }}>● {c.shift ? `${trI18n(sm.label)}${trI18n("วันนี้")}` : trI18n(sm.label)}</span>
                        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>{c.ops.length} {trI18n('คน')}{slotText(c)}</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {trI18n("หัวหน้ากลุ่ม")}: {c.leaders.length ? c.leaders.map(p => p.name).join(', ') : trI18n("— ยังไม่มีในทะเบียน")}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignContent: 'flex-start' }}>
                      {items.map((it, i) => it.kind === 'op'
                        ? <TvCard key={it.p.id} p={it.p} skills={skills} />
                        : <div key={`s${i}`} style={{ width: TV_CARD.w }}><EmptySlot station={it.station} h={TV_CARD.h} /></div>)}
                      {!items.length && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{trI18n('— ไม่มีการ์ดในส่วนนี้ —')}</span>}
                    </div>
                    {more > 0 && <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>{trI18n('ต่อหน้าถัดไปอีก')} {more} {trI18n('ใบ ▶')}</div>}
                  </div>
                );
              })}
            </div>
          </>
        )}
        </>)}
      </div>
      {!fallback && <BoardPager page={pi} count={pages.length} onPage={setPage}
        labels={pages.map(x => `${x.dept.name}${x.parts > 1 ? ` (${x.part + 1}/${x.parts})` : ''}`)} />}
    </>
  );
}

/* ═════════════════════════ 📊 แผน vs มาจริงรายวัน (2026-10-08) ═════════════════════════
   ย้อนหลังรายวัน × กะ ว่าแต่ละแผนกขาดคนกี่คน และขาดเพราะอะไร — สูตรทั้งหมดอยู่ที่ staffingOfDept/summarizeStaffing
   🔴 ที่นั่งคิดจาก "ค่าตั้งบอร์ด + ทะเบียนพนักงานปัจจุบัน" (ยังไม่ย้อนค่าตามประวัติ) ⇒ ต้องเขียนข้อจำกัดนี้บนจอเสมอ
   เพดาน 62 วัน (~7,500 แถวเช็คชื่อ) — เลือกยาวกว่านั้น = ตัดให้เหลือ 62 วันล่าสุดแล้วเขียนบอก ไม่บล็อก */
const STAFFING_MAX_DAYS = 62;

function StaffingTab({ section, deptParam, today, nodes, employees, lines, slotPlans, lineTechs, stations, stationPlans, homeByEmp, actingPos, lineFam = [], lineName = '' }) {
  const lineIds = useMemo(() => new Set(lineFam.map(l => String(l.id))), [lineFam]);
  const lineStIds = useMemo(() => new Set(lineFam.length ? stationsOfLineFamily(lines, lineName, stations).map(st => String(st.id)) : []), [lineFam, lineName, lines, stations]);
  const tr = useTimeRange({ defaultDays: 30 });
  const to = tr.to > today ? today : tr.to;
  const capFrom = addDaysStr(to, -(STAFFING_MAX_DAYS - 1));
  const from = tr.from < capFrom ? capFrom : tr.from;
  const clipped = from !== tr.from;
  const [raw, setRaw] = useState({ logs: [], sched: [], borrowed: { byDate: {}, missing: 0 }, sessions: [] });
  const [state, setState] = useState({ loading: true, errors: [], truncated: false });
  const linesRef = useRef(lines); linesRef.current = lines;
  const empRef = useRef(employees); empRef.current = employees;
  const lineCount = lines.length, empCount = employees.length;

  useEffect(() => {
    let alive = true;
    setState(s0 => ({ ...s0, loading: true }));
    Promise.all([
      fetchAllPages(() => supabase.from('daily_production_logs').select('id, employee_id, work_date, shift, is_present, leave_type, assigned_line')
        .gte('work_date', from).lte('work_date', to), { orderBy: 'id', maxPages: 10 }),
      fetchAllPages(() => supabase.from('shift_schedules').select('id, work_date, line_id, dept_name, day_team')
        .gte('work_date', from).lte('work_date', to), { orderBy: 'id', maxPages: 10 }),
      loadBorrowedRange({ from, to, employees: empRef.current, lines: linesRef.current }),
      // 🔗 กะผลิตที่ปิดแล้ว (ฝั่ง DR) — ใช้ OEE ที่ stamp ตอนปิดกะเท่านั้น · select แบบผอม
      fetchAllPages(() => supabaseDR.from('production_sessions').select('id, line_name, work_date, shift, oee, oee_a, oee_p, shift_min')
        .gte('work_date', from).lte('work_date', to).in('status', SESSION_STATUSES_DONE), { orderBy: 'id', maxPages: 10 }),
    ]).then(([a, s, b, ps]) => {
      if (!alive) return;
      setRaw({ logs: a.rows || [], sched: s.rows || [], borrowed: b, sessions: ps.rows || [] });
      setState({ loading: false, errors: [a.error && `เช็คชื่อ: ${a.error}`, s.error && `ตารางกะ: ${s.error}`, b.error && `คนยืมตัว: ${b.error}`,
        ps.error && `กะผลิต/OEE: ${ps.error}`].filter(Boolean),
        truncated: a.truncated || s.truncated || b.truncated || ps.truncated });
    });
    return () => { alive = false; };
  }, [from, to, lineCount, empCount]);

  const days = useMemo(() => {
    if (!section) return [];
    const att = {}, sch = {};
    for (const r of raw.logs) {
      const m = (att[r.work_date] ||= {}); const cur = m[r.employee_id];
      if (!cur || (!cur.is_present && r.is_present)) m[r.employee_id] = r;
    }
    for (const r of raw.sched) (sch[r.work_date] ||= []).push(r);
    const sIdx = indexSessions(raw.sessions);
    const out = [];
    for (let d = from; d && d <= to; d = addDaysStr(d, 1)) {
      /* 🏃 ไม่ส่ง `flexUnits` ที่นี่โดยเจตนา — แท็บนี้ตอบ "ที่นั่ง vs คนยืนจริง" ของแผนก และคนวิ่งข้าม
         แผนก **ไม่ใช่กำลังคนของที่นี่** (บ้านจริงนับเขาอยู่แล้ว) ⇒ ส่งเข้ามาก็ไม่ควรขยับตัวเลขใดๆ
         🔴 อย่าเติมเพราะ "ให้ครบพารามิเตอร์" — ทะเบียนนี้เป็นของวันนี้ ไม่มีประวัติย้อนหลังด้วย */
      const board = buildManpowerBoard({ section, nodes, employees: rosterOn(employees, d, { today, attendance: att[d] }), lines, maps: buildScheduleMaps(sch[d] || [], lines),
        // 🧭 คนยืมตัวย้อนหลังก็ต้องทับตำแหน่งด้วยชุดเดียวกับ `employees` (ส่งมาแล้วทับจากหน้าแม่)
        attendance: att[d] || {}, slotPlans, lineTechs, helpers: applyWorkingPositions(raw.borrowed.byDate?.[d] || [], actingPos), stations, stationPlans, homeByEmp });
      const inDept = (board?.depts || []).filter(x => !deptParam || x.key === deptParam);
      // 🧩 กรองถึงไลน์ — คนมาจริง vs std ของไลน์ (ช่องรายทีมแยกไลน์ไม่ได้ = ไม่คิดช่องว่าง · `lineDeptsOf`)
      out.push({ date: d, depts: (lineIds.size ? lineDeptsOf(inDept, lineFam, lineName, { stationIds: lineStIds }) : inDept)
        .map(x => {
          /* 🔴 กะผลิตที่ปิดแล้ว = หลักฐานว่า "ไลน์เดินในกะนี้จริง" — ไม่มี = ยืนยันไม่ได้
             ⇒ ไม่คิดช่องว่างของกะนั้น (จุดงานที่ไม่ได้เดินวันนั้น ไม่ใช่ "ขาดคน" · user 15/10) */
          const sessions = { day: sessionsOfDeptShift(sIdx, x.lines, d, 'day'), night: sessionsOfDeptShift(sIdx, x.lines, d, 'night') };
          const ran = { day: sessions.day.length > 0, night: sessions.night.length > 0 };
          return { key: x.key, name: x.name, shifts: staffingOfDept(x, { ran }), sessions, lineMode: !!x.lineFilter };
        }) });
    }
    return out;
  }, [raw, from, to, today, section, deptParam, nodes, employees, lines, slotPlans, lineTechs, stations, stationPlans, homeByEmp, actingPos, lineIds, lineFam, lineName, lineStIds]);
  const summary = useMemo(() => summarizeStaffing(days), [days]);
  const oeeCmp = useMemo(() => compareOeeByStaffing(days), [days]);
  const rowsOf = useMemo(() => summary.flatMap(sm => ['day', 'night'].map(sh => ({ key: sm.key, name: sm.name, sh }))), [summary]);

  const th = { textAlign: 'left', fontSize: 12, padding: '8px 10px', color: 'var(--muted)', whiteSpace: 'nowrap' };
  const td = { padding: '7px 10px', fontSize: 13, borderTop: '1px solid var(--border)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
  const num = { ...td, textAlign: 'right' };
  const pct = (x) => (x == null ? '–' : `${Math.round(x * 100)}%`);
  const dShort = (d) => { const [, m, dd] = d.split('-'); return `${Number(dd)}/${Number(m)}`; };
  const deptOf = (key, date) => days.find(x => x.date === date)?.depts.find(x => x.key === key) || null;
  const cellOf = (key, date, sh) => deptOf(key, date)?.shifts[sh] || null;
  const tip = (s, sess) => {
    const o = oeeOfSessions(sess);
    return `${trI18n("ในทะเบียน")} ${s.registered} · ${trI18n("ยืนจริง")} ${s.onFloor}`
      + `\n${trI18n("คนขาด")} ${s.absentGap ?? '–'} = ${trI18n("ลา")} ${s.leave} + ${trI18n("ขาดงาน")} ${s.absent} + ${trI18n("ยังไม่เช็ค")} ${s.unchecked} + ${trI18n("ถูกยืมออก")} ${s.lentOut} − ${trI18n("ยืมเข้า")} ${s.borrowedIn}`
      + `\n${trI18n("ช่องว่างอัตรากำลัง")} ${s.structGap == null ? trI18n('คิดไม่ได้ (ยืนยันไม่ได้ว่าไลน์เดินกะนี้)') : s.structGap}`
      + (s.capped ? ` (${trI18n("ตัดจาก")} ${s.emptyRaw} ${trI18n("ตามกำลังคนผัง")} ${s.std})` : '')
      + `\n${o ? `OEE ${o.oee}%${o.p != null ? ` · %P ${o.p}%` : ''} (${o.sessions} ${trI18n("กะผลิต")})` : trI18n('ไม่มีกะผลิตที่ปิดแล้ว')}`
      + (s.noPlan ? '\n⚠️ บางทีมไม่มีแผนช่อง — ใช้จำนวนคนในทะเบียนเป็นที่นั่ง' : '');
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <TimeRangeBar scale={tr.scale} from={tr.from} to={tr.to} today={tr.today} scales={null}
        onFrom={tr.setFrom} onTo={tr.setTo} onPreset={tr.setPreset}
        note={`${trI18n("ส่วนงาน")} ${section?.name || '–'}${deptParam ? ` · ${trI18n("แผนก")} ${summary[0]?.name || trI18n('(ไม่มีข้อมูลในช่วงนี้)')}` : ''} · ${trI18n("แท่งละ 1 วัน × กะ · ดูได้ครั้งละไม่เกิน")} ${STAFFING_MAX_DAYS} ${trI18n("วัน")}`} />
      <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
        ℹ️ <b>{trI18n('ขาด 2 ชนิด แยกกันคนละคอลัมน์')}</b> — <b>{trI18n('ขาดคน')}</b> = {trI18n("ลา + ขาดงาน + ยังไม่เช็ค + ถูกยืมออก − ยืมเข้า (เรื่องรายวัน หัวหน้าจัดการได้")}) ·
        <b>{trI18n('ช่องว่างอัตรากำลัง')}</b> = {trI18n("ตำแหน่งที่ยังไม่มีคน (เรื่องอัตรากำลัง/รับคน")}) · <b>{trI18n('มาจริง %')}</b> {trI18n('หารด้วย')}<b>{trI18n('คนในทะเบียนของกะนั้น')}</b> {trI18n("ไม่ใช่ที่นั่ง · ช่องว่างคิดเฉพาะกะที่")}<b>{trI18n('ยืนยันได้ว่าไลน์เดิน')}</b> {trI18n('(มีกะผลิตปิดแล้ว) และ')}<b>{trI18n('ไม่เกินกำลังคนตามผัง − คนที่มาจริง')}</b> ·
        {trI18n("คิดจาก")}<b>{trI18n('ค่าตั้งบอร์ด/std และทะเบียนพนักงานปัจจุบัน')}</b> ({trI18n("ตัดคนที่เริ่มงานหลังวันนั้น — คนที่ลาออกไปแล้วไม่อยู่ในตัวเลขย้อนหลัง) · กะที่ไม่มีใครในแผนกถูกเช็คชื่อเลย")} = <b>{trI18n('ไม่ได้เช็คชื่อ')}</b> {trI18n("ไม่นับเป็นขาด")}
      </div>
      {clipped && <div style={{ fontSize: 12, color: 'var(--amber)' }}>{trI18n('⚠️ ช่วงที่เลือกยาวเกิน')} {STAFFING_MAX_DAYS} {trI18n('วัน — แสดงเฉพาะ')} {from} {trI18n('ถึง')} {to}</div>}
      {state.errors.length > 0 && <div className="card" style={{ padding: 10, borderLeft: '4px solid var(--red)', fontSize: 13 }}>{trI18n('⚠️ โหลดไม่ครบ —')} {state.errors.join(' · ')} {trI18n('(ตัวเลขที่เห็นอาจขาดส่วนนี้)')}</div>}
      {state.truncated && <div style={{ fontSize: 12, color: 'var(--amber)' }}>{trI18n('⚠️ ข้อมูลช่วงนี้เกินเพดานที่โหลดได้ — ย่อช่วงวันที่ ตัวเลขยังไม่ครบ')}</div>}
      {raw.borrowed.missing > 0 && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{trI18n('ℹ️ คนยืมตัว')} {raw.borrowed.missing} {trI18n('รายการไม่อยู่ในทะเบียนพนักงานปัจจุบัน (ลาออก/ไม่ใช่พนักงานหน้างาน) — ไม่ได้นับเป็นยืมเข้า')}</div>}
      {state.loading ? <div style={{ padding: 24, color: 'var(--muted)' }}>{trI18n('กำลังโหลด…')}</div> : !summary.length ? (
        <div className="card" style={{ padding: 24, color: 'var(--muted)' }}>{trI18n('ไม่มีแผนกที่มีคน/ช่องในช่วงที่เลือก')}</div>
      ) : (
        <>
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <div style={{ padding: '10px 12px', fontWeight: 800 }}>{trI18n('สรุปต่อแผนก')}</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>{trI18n('แผนก')}</th><th style={{ ...th, textAlign: 'right' }}>{trI18n('กะที่เช็คแล้ว')}</th><th style={{ ...th, textAlign: 'right' }}>{trI18n('กะที่ขาดคน')}</th>
                <th style={{ ...th, textAlign: 'right' }}>{trI18n(lineName ? 'ยืนจริง / std' : 'ยืนจริง / ในทะเบียน')}</th><th style={{ ...th, textAlign: 'right' }}>{trI18n(lineName ? 'ขาดจาก std (คน-กะ)' : 'ขาดคน (คน-กะ)')}</th>
                <th style={{ ...th, textAlign: 'right' }}>{trI18n('ช่องว่างอัตรากำลัง')}</th><th style={{ ...th, textAlign: 'right' }}>{trI18n('ลา')}</th><th style={{ ...th, textAlign: 'right' }}>{trI18n('ขาดงาน')}</th>
                <th style={{ ...th, textAlign: 'right' }}>{trI18n('ยังไม่เช็ค')}</th><th style={{ ...th, textAlign: 'right' }}>{trI18n('ถูกยืมออก')}</th><th style={{ ...th, textAlign: 'right' }}>{trI18n('ยืมเข้า')}</th>
                <th style={th}>{trI18n('ขาดหนักสุด')}</th><th style={{ ...th, textAlign: 'right' }}>{trI18n('กะไม่ได้เช็คชื่อ')}</th>
              </tr></thead>
              <tbody>
                {summary.map(sm => (
                  <tr key={sm.key}>
                    <td style={{ ...td, fontWeight: 700, whiteSpace: 'normal', minWidth: 140 }}>{sm.name}{sm.noPlanShifts > 0 && <div style={{ fontSize: 11, color: 'var(--amber)', fontWeight: 400 }}>⚠️ {sm.noPlanShifts} {trI18n('กะมีทีมที่ไม่มีแผนช่อง')}</div>}</td>
                    <td style={num}>{sm.shifts}</td>
                    <td style={num}>{sm.shifts ? `${sm.shortShifts} (${pct(sm.shortShifts / sm.shifts)})` : '–'}</td>
                    <td style={num}>{sm.shifts ? `${sm.onFloor} / ${lineName ? sm.seats : sm.registered} (${pct(sm.fill)})` : '–'}</td>
                    <td style={{ ...num, fontWeight: 800 }}>{sm.shifts ? sm.absentShort : '–'}</td>
                    <td style={num}>
                      {/* 🧩 กรองถึงไลน์ = ช่องรายทีมแยกลงไลน์ไม่ได้ ⇒ '–' เสมอ (ห้ามโชว์ 0 · ตัวหารที่หายไม่ใช่ศูนย์) */}
                      {lineName ? '–' : sm.structUnknownShifts >= sm.shifts && sm.shifts ? '–' : sm.structShort}
                      {lineName && <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>{trI18n('แยกลงไลน์ไม่ได้')}</div>}
                      {!lineName && sm.structUnknownShifts > 0 && (
                        <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>{trI18n('คิดไม่ได้')} {sm.structUnknownShifts} {trI18n('กะ')}</div>
                      )}
                      {sm.capped > 0 && (
                        <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>{trI18n('ตัดตามผัง')} {sm.capped}</div>
                      )}
                      {sm.stdUnknownShifts > 0 && (
                        <div style={{ fontSize: 11, color: 'var(--amber)', fontWeight: 400 }}>{trI18n('⚠️ ไม่รู้กำลังคนผัง')} {sm.stdUnknownShifts} {trI18n('กะ')}</div>
                      )}
                    </td><td style={num}>{sm.leave}</td><td style={num}>{sm.absent}</td>
                    <td style={num}>{sm.unchecked}</td><td style={num}>{sm.lentOut}</td><td style={num}>{sm.borrowedIn}</td>
                    <td style={td}>{sm.worst ? `${dShort(sm.worst.date)} ${SHIFT_TH[sm.worst.shift]} ${trI18n("ขาด")} ${sm.worst.gap}` : '–'}</td>
                    <td style={num}>{sm.notChecked}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--muted)' }}>
              🧑 <b>{trI18n('ขาดคน')}</b> = {trI18n("ลา + ขาดงาน + ยังไม่เช็ค + ถูกยืมออก − ยืมเข้า (นับเฉพาะกะที่ขาด")}) · <b>"{trI18n("กะที่ขาดคน\" นับจากช่องนี้เท่านั้น")}</b> ·
              🪑 <b>{trI18n('ช่องว่างอัตรากำลัง')}</b> {trI18n("คนละเรื่องกัน — ไม่ใช่ \"วันนี้มีคนไม่มา\" แต่คือตำแหน่งที่ยังไม่มีคนประจำ · \"คิดไม่ได้ N กะ\" = ยืนยันไม่ได้ว่าไลน์เดินกะนั้น (ไม่มีกะผลิตที่ปิดแล้ว) จึงไม่นับช่องว่าง")} — <b>{trI18n('ไม่รู้ ≠ ไม่ขาด')}</b> ·
              "{trI18n("ตัดตามผัง N\" = ช่องว่างดิบจากจุดงานเกินกำลังคนตามผัง (std − คนที่มาจริง) จึงถูกตัด — จุดที่ใช้คนวนๆ ไม่ใช่ช่องว่างถาวร · \"⚠️ ไม่รู้กำลังคนผัง N กะ\" = ไลน์ของแผนกนี้ยังไม่ได้ตั้ง std (ตั้งที่")} /line-setup) ⇒ <b>{trI18n('ไม่ได้ตัดเพดาน')}</b> {trI18n("ช่องว่างอาจสูงกว่าจริง")}
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <div style={{ padding: '10px 12px', fontWeight: 800 }}>{trI18n('คนมาน้อยแล้ว OEE เป็นอย่างไร')} <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--muted)' }}>{trI18n('(เทียบกะที่คนมาตามปกติ กับกะที่คนมาน้อยกว่าปกติ ของแผนกเดียวกัน)')}</span></div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>{trI18n('แผนก')}</th>
                <th style={{ ...th, textAlign: 'right' }}>{trI18n('ปกติ (คนยืนจริง/กะ)')}</th>
                <th style={{ ...th, textAlign: 'right' }}>{trI18n('คนมาตามปกติ: OEE · %P')}</th>
                <th style={{ ...th, textAlign: 'right' }}>{trI18n('คนมาน้อยกว่าปกติ: OEE · %P')}</th>
                <th style={{ ...th, textAlign: 'right' }}>{trI18n('ส่วนต่าง OEE')}</th>
              </tr></thead>
              <tbody>
                {oeeCmp.map(c => {
                  const g = (x) => (x ? `${x.oee ?? '–'}% · ${x.p ?? '–'}% (${x.shifts} ${trI18n("กะ")})` : '–');
                  return (
                    <tr key={c.key}>
                      <td style={{ ...td, fontWeight: 700, whiteSpace: 'normal', minWidth: 140 }}>{c.name}</td>
                      <td style={num}>{c.normal == null ? '–' : `${Math.round(c.normal * 10) / 10} ${trI18n("คน")}`}</td>
                      <td style={num}>{g(c.usual)}</td>
                      <td style={num}>{g(c.low)}</td>
                      <td style={{ ...num, fontWeight: 800 }}>
                        {c.verdict === 'none' ? <span style={{ fontWeight: 400, color: 'var(--muted)' }}>{trI18n('ไม่มีกะผลิตที่ปิดแล้วในกะที่เช็คชื่อ')}</span>
                          : c.verdict === 'thin' ? <span style={{ fontWeight: 400, color: 'var(--amber)' }}>{trI18n('กะน้อยเกินจะสรุป (ต้องมีฝั่งละ ≥')} {MIN_SHIFTS_TO_COMPARE} {trI18n("กะ")})</span>
                          : c.diffOee == null ? '–' : `${c.diffOee > 0 ? '+' : ''}${c.diffOee} ${trI18n("จุด")}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
              <b>{trI18n('ปกติ')}</b> = {trI18n("มัธยฐานของคนยืนจริงต่อกะของแผนกนั้นเอง (ไม่ใช่ที่นั่งตาม std — std บางไลน์ยังตั้งสูงกว่าคนในทะเบียน จนเกือบทุกกะดู \"ขาด\") · นับเฉพาะกะที่เช็คชื่อแล้วและมีกะผลิตปิดแล้ว · OEE/%P = ค่าที่ระบบบันทึกตอนปิดกะของทุกไลน์ในแผนก (ถ่วงด้วยเวลา) · ไม่รวมยอดชิ้นข้ามไลน์เพราะไลน์ย่อยป้อนงานต่อกัน บวกกันจะนับซ้ำ · ⚠️ เป็น")}<b>{trI18n('ความสัมพันธ์')}</b> {trI18n("ไม่ใช่ข้อพิสูจน์ว่าคนน้อยเป็นสาเหตุ — กะนั้นอาจมีเครื่องเสีย/ของขาดด้วย ดูต้นเหตุที่ Daily Report ของกะนั้น")}
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <div style={{ padding: '10px 12px', fontWeight: 800 }}>{trI18n('รายวัน — คนขาดกี่คน')} <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--muted)' }}>({trI18n("ตัวเลข = คนขาด (ลา/ขาดงาน/ยังไม่เช็ค/ถูกยืมออก) · +n = คนเกิน · ✓ = มากันครบ · · = ไม่ได้เช็คชื่อ · ชี้ที่ช่องเพื่อดูสาเหตุ + ช่องว่างอัตรากำลัง")})</span></div>
            <table style={{ borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={{ ...th, position: 'sticky', left: 0, background: 'var(--card)', zIndex: 1 }}>{trI18n('แผนก · กะ')}</th>
                {days.map(d => <th key={d.date} style={{ ...th, textAlign: 'center', padding: '8px 4px' }}>{dShort(d.date)}</th>)}
              </tr></thead>
              <tbody>
                {rowsOf.map(r => (
                  <tr key={`${r.key}-${r.sh}`}>
                    <td style={{ ...td, position: 'sticky', left: 0, background: 'var(--card)', zIndex: 1, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.name}>
                      <b style={{ color: shiftMeta(r.sh).color }}>{SHIFT_TH[r.sh]}</b> · {r.name}
                    </td>
                    {days.map(d => {
                      const s = cellOf(r.key, d.date, r.sh);
                      const base = { ...td, textAlign: 'center', padding: '6px 4px', minWidth: 34, fontSize: 12 };
                      if (!s || (!s.seats && !s.evaluated)) return <td key={d.date} style={{ ...base, color: 'var(--muted)' }} />;
                      if (!s.evaluated) return <td key={d.date} style={{ ...base, color: 'var(--muted)' }} title={trI18n('ไม่มีใครในแผนกถูกเช็คชื่อกะนี้ — ไม่รู้ว่ามาครบไหม')}>·</td>;
                      /* 🔴 ช่องสีแดง = "คนขาดจริง" เท่านั้น — ช่องว่างอัตรากำลังไม่ใช่เหตุการณ์ของวันนั้น
                         (เดิมใช้ gap รวม ⇒ ทั้งตารางแดงหมดทุกวันจนดูไม่ออกว่าวันไหนมีปัญหาจริง · 15/10) */
                      if (s.absentGap > 0) return <td key={d.date} title={tip(s, deptOf(r.key, d.date)?.sessions?.[r.sh])} style={{ ...base, fontWeight: 800, color: 'var(--text)', background: `rgba(239,68,68,${Math.min(0.15 + s.absentGap * 0.08, 0.6).toFixed(2)})` }}>{s.absentGap}</td>;
                      if (s.absentGap < 0) return <td key={d.date} title={tip(s, deptOf(r.key, d.date)?.sessions?.[r.sh])} style={{ ...base, color: 'var(--blue)' }}>+{-s.absentGap}</td>;
                      return <td key={d.date} title={tip(s, deptOf(r.key, d.date)?.sessions?.[r.sh])} style={{ ...base, color: 'var(--muted)' }}>✓</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/* ═════════════════════════ 📜 ประวัติการเปลี่ยนช่อง ═════════════════════════
   อ่าน audit_log ของ 3 ตารางค่าตั้งบอร์ด (ไม่มีตารางประวัติแยก) · ตัดตามส่วนงานที่เลือก ·
   แปลเป็นภาษาคน + สรุปรายเดือนผ่าน describeSlotChanges/summarizeSlotChanges (manpowerBoard.js · มีเทส)
   รายงานย้อนหลัง ⇒ โหลดเมื่อเปลี่ยนช่วง/ส่วนงานเท่านั้น ไม่ poll ไม่ realtime */
const HISTORY_CAP = 3000;
function HistoryTab({ section, dept, deptParam, nodes, lines, stations, employees, lineFam = [] }) {
  const tr = useTimeRange({ defaultDays: 120 });
  const [rows, setRows] = useState([]);
  const [state, setState] = useState({ loading: true, error: '', truncated: false });
  const from = tr.from, to = tr.to;

  useEffect(() => {
    let alive = true;
    setState(s0 => ({ ...s0, loading: true }));
    // ขอบช่วงเป็นวันไทย — แปลงเป็นเวลา +07:00 เอง (ห้าม toISOString ของวันที่ท้องถิ่น)
    fetchAllPages(() => supabase.from('audit_log')
      .select('id, table_name, action, actor, old_data, new_data, changed_at')
      .in('table_name', SLOT_AUDIT_TABLES)
      .gte('changed_at', `${from}T00:00:00+07:00`).lte('changed_at', `${to}T23:59:59+07:00`),
    { orderBy: 'id', maxPages: Math.ceil(HISTORY_CAP / 1000) })
      .then(({ rows: r, error, truncated }) => {
        if (!alive) return;
        setRows(r || []);
        setState({ loading: false, error: error || '', truncated });
      });
    return () => { alive = false; };
  }, [from, to]);

  const scoped = useMemo(() => {
    if (!section) return { items: [], unattributed: 0 };
    const kids = new Map();
    for (const n of nodes) if (n.parent_id) (kids.get(n.parent_id) || kids.set(n.parent_id, []).get(n.parent_id)).push(n);
    const subOf = (rootId) => {
      const set = new Set([rootId]);
      for (const stack = [rootId]; stack.length;) for (const c of kids.get(stack.pop()) || []) { set.add(c.id); stack.push(c.id); }
      return set;
    };
    const sub = subOf(section.id);
    const refs = nodes.filter(n => sub.has(n.id) && n.kind === 'line' && n.ref_line_id != null).map(n => n.ref_line_id);
    const famIds = new Set(lineFamilyOf(lines, refs).map(l => String(l.id)));
    // 🏷️ กรองแผนก (?dept=) — ทีม = ใต้ต้นไม้แผนกนั้น · จุดงาน/ช่าง = ไลน์ในกลุ่มไลน์ของแผนก (ชุดเดียวกับที่บอร์ดใช้ `dept.lines`)
    //   แผนกที่เลือกไม่อยู่ในส่วนงานนี้แล้ว (dept=null) = ไม่มีอะไรตรง ห้ามถอยไปโชว์ทั้งส่วนงานเงียบๆ
    const deptSub = deptParam && dept?.node ? subOf(dept.node.id) : new Set();
    const deptLineIds = new Set((dept?.lines || []).map(l => String(l.id)));
    let unattributed = 0, teamHidden = 0;
    const lineIdSet = new Set(lineFam.map(l => String(l.id)));
    const inSection = ({ kind, nodeId, lineId }) => (kind === 'team' ? sub.has(nodeId) : lineId == null || famIds.has(String(lineId)));
    const out = describeSlotChanges(rows, {
      nodeById: new Map(nodes.map(n => [n.id, n])),
      stationById: new Map(stations.map(st => [String(st.id), st])),
      lineById: new Map(lines.map(l => [String(l.id), l])),
      empById: new Map(employees.map(e => [e.id, e])),
      // จุดงานที่ถูกลบไปแล้ว (lineId ไม่รู้) = โชว์ไว้ก่อน — ประวัติห้ามหาย ดีกว่าตัดทิ้งเพราะสืบส่วนงานไม่ได้
      inScope: (c) => {
        if (!inSection(c)) return false;
        // 🧩 กรองถึงไลน์ — ช่องรายทีม (ตั้งที่โหนดทีม) แยกลงไลน์ไม่ได้ = ไม่แสดง แต่นับบอกบนจอ
        if (lineIdSet.size) {
          if (c.kind === 'team') { teamHidden += 1; return false; }
          if (c.lineId == null) { unattributed += 1; return false; }
          return lineIdSet.has(String(c.lineId));
        }
        if (!deptParam) return true;
        if (c.kind === 'team') return deptSub.has(c.nodeId);
        // จุดงานที่ถูกลบไปแล้ว สืบแผนกไม่ได้ — ไม่ใส่ในแผนกไหน แต่นับไว้บอกบนจอ (ห้ามหายเงียบ)
        if (c.lineId == null) { unattributed += 1; return false; }
        return deptLineIds.has(String(c.lineId));
      },
    });
    return { items: out, unattributed, teamHidden };
  }, [rows, section, dept, deptParam, nodes, lines, stations, employees, lineFam]);
  const list = scoped.items;
  const months = useMemo(() => summarizeSlotChanges(list), [list]);

  const th = { textAlign: 'left', fontSize: 12, padding: '8px 10px', color: 'var(--muted)', whiteSpace: 'nowrap' };
  const td = { padding: '7px 10px', fontSize: 13, borderTop: '1px solid var(--border)', verticalAlign: 'top' };
  const signed = (n) => (n > 0 ? `+${n}` : String(n));
  const fmtAt = (t) => new Date(t).toLocaleString(dateLocale(), { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' });
  const monthTh = (ym) => { const [y, m] = ym.split('-'); return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(dateLocale(), { month: 'short', year: 'numeric' }); };
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <TimeRangeBar scale={tr.scale} from={from} to={to} today={tr.today} scales={null}
        onFrom={tr.setFrom} onTo={tr.setTo} onPreset={tr.setPreset}
        note={`${trI18n("ส่วนงาน")} ${section?.name || '–'}${deptParam ? ` · ${trI18n("แผนก")} ${dept?.name || trI18n('(ไม่อยู่ในส่วนงานนี้)')}` : ''} · ${trI18n("ช่องต่อทีม · คนต่อกะของจุดงาน · ช่างประจำไลน์ (จากบันทึกการแก้ไขของระบบ")})`} />
      {state.error && <div className="card" style={{ padding: 10, borderLeft: '4px solid var(--red)', fontSize: 13 }}>{trI18n('⚠️ โหลดประวัติไม่สำเร็จ —')} {state.error}</div>}
      {state.truncated && <div style={{ fontSize: 12, color: 'var(--amber)' }}>{trI18n('⚠️ แสดงได้ไม่เกิน')} {HISTORY_CAP.toLocaleString()} {trI18n('รายการ — ช่วงนี้มีมากกว่านั้น ให้ย่อช่วงวันที่')}</div>}
      {!state.loading && scoped.teamHidden > 0 && (
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>🧩 {trI18n('กรองถึงไลน์ — ซ่อนการเปลี่ยนช่องรายทีม')} {scoped.teamHidden} {trI18n('รายการ (ช่องตำแหน่งตั้งรายทีม แยกลงไลน์ไม่ได้ · ล้างการกรองไลน์เพื่อดู)')}</div>
      )}
      {!state.loading && scoped.unattributed > 0 && (
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{trI18n('ℹ️ อีก')} {scoped.unattributed} {trI18n("รายการเป็นจุดงานที่ถูกลบไปแล้ว สืบไม่ได้ว่าเป็นของแผนกไหน — ไม่ได้แสดงในตัวกรองแผนก (เลือก")} "{ALL.dept}" {trI18n("เพื่อดู")})</div>
      )}
      {state.loading ? <div style={{ padding: 24, color: 'var(--muted)' }}>{trI18n('กำลังโหลด…')}</div> : !list.length ? (
        <div className="card" style={{ padding: 24, color: 'var(--muted)' }}>{trI18n('ไม่มีการเปลี่ยนช่อง/คนต่อกะ/ช่างประจำไลน์ของ')}{deptParam ? trI18n("แผนก") : trI18n("ส่วนงาน")}{trI18n('นี้ในช่วงที่เลือก')}</div>
      ) : (
        <>
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <div style={{ padding: '10px 12px', fontWeight: 800 }}>{trI18n('สรุปรายเดือน')}</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>{trI18n('เดือน')}</th><th style={{ ...th, textAlign: 'right' }}>{trI18n('แก้ (ครั้ง)')}</th>
                <th style={{ ...th, textAlign: 'right' }}>{trI18n('ช่องต่อทีม สุทธิ')}</th><th style={{ ...th, textAlign: 'right' }}>{trI18n('คน/กะของจุด สุทธิ')}</th>
                <th style={{ ...th, textAlign: 'right' }}>{trI18n('ช่าง เข้า / ออก')}</th><th style={th}>{trI18n('คนแก้')}</th>
              </tr></thead>
              <tbody>
                {months.map(m => (
                  <tr key={m.month}>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{monthTh(m.month)}</td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{m.count}</td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{signed(m.teamDelta)}</td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{signed(m.stationDelta)}</td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>+{m.techIn} / −{m.techOut}</td>
                    <td style={{ ...td, color: 'var(--text2)' }}>{m.actors.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ padding: '6px 12px 10px', fontSize: 12, color: 'var(--muted)' }}>
              {trI18n("สุทธิ = ผลรวมของ (ค่าใหม่ − ค่าเดิม) · ล้างค่า = ลดเท่าค่าเดิม (บอร์ดกลับไปใช้ค่าถัดไปในลำดับ: ช่องต่อทีม → จุดงาน")} → std)
            </div>
          </div>
          <div className="card table-sticky" style={{ padding: 0, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>{trI18n('เวลา')}</th><th style={th}>{trI18n('คนแก้')}</th><th style={th}>{trI18n('เรื่อง')}</th><th style={th}>{trI18n('ที่ไหน')}</th>
                <th style={th}>{trI18n('ทีม')}</th><th style={th}>{trI18n('เปลี่ยนเป็น')}</th>
              </tr></thead>
              <tbody>
                {list.map(c => (
                  <tr key={c.id}>
                    <td style={{ ...td, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{fmtAt(c.at)}</td>
                    <td style={td}>{c.actor}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{SLOT_KIND_META[c.kind].icon} {trI18n(SLOT_KIND_META[c.kind].label)}</td>
                    <td style={td}>{c.where}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{c.kind === 'team' ? (c.team ? `${trI18n("ทีม")} ${c.team}` : trI18n("ไม่ระบุทีม")) : '–'}</td>
                    {/* ไม่ใส่สีเขียว/แดง — ช่องเพิ่มไม่ได้แปลว่า "ดี" (UI §6.17 สี = ความหมาย) */}
                    <td style={{ ...td, fontWeight: 700 }}>{c.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
