/* ══════════════════════════════════════════════════════════════════════════
   /scan — "ส่อง QR ที่ติดเครื่อง แล้วถึงงานเลย"  (2026-10-02 · คำสั่ง user)

   โจทย์จาก user: *"พิมพ์ QR ติดเครื่องแล้ว จะสแกนเพื่อเข้าไปตรวจสอบเลย เข้าตรงไหน
   มีชอทคัทไหนที่ง่าย"* — เดิม**ไม่มี**: ต้องเปิดแอปเอง → หาเมนู → เข้าหน้านั้น → กด 📷
   (ป้ายที่พิมพ์เป็นข้อความ `ESM:M:<uuid>` เฉยๆ กล้องมือถือส่องแล้วไปไหนไม่ได้)

   หน้านี้ = ปลายทางของ QR แบบลิงก์ `https://<host>/scan?c=ESM:M:<uuid>`
   ส่องด้วยกล้องมือถือปกติ → แตะ notification → แอปเปิดมาที่เมนู "เครื่องนี้ จะทำอะไร?"

   🔴 กติกาที่ห้ามพัง:
   1. **ตัวแปลงรหัสเป็นของเดิม** (`parseQrPayload`/`resolveMachine`/`resolveJig`) — ห้ามเขียนใหม่
      ⇒ ป้ายเก่าที่เป็นข้อความเปล่า · บาร์โค้ด 1D เดิมที่ติดเครื่องอยู่ก่อน · ป้ายแบบลิงก์ ใช้ได้หมด
   2. **ปุ่มโผล่ตามสิทธิ์จริง** (`canAccessPage`) — ไม่มีสิทธิ์ = ไม่โชว์ปุ่ม ไม่ใช่โชว์แล้วกดไปเจอหน้าเปล่า
   3. **หาไม่เจอต้องบอกว่าทำไม** (ป้ายชนิดไหน · รหัสอะไร) + ให้สแกนใหม่ได้ทันที
      ห้ามเด้งกลับหน้าแรกเงียบๆ — คนยืนอยู่หน้าเครื่อง ถือมือถือ ต้องรู้ว่าต้องทำอะไรต่อ
   4. **อ่านอย่างเดียว ไม่เขียนอะไรลง DB** — เป็นแค่ทางแยก ไม่ใช่หน้าทำงาน
      🔴 **ข้อยกเว้นเดียว: เช็คชื่อด้วยบัตรพนักงาน** (10/11 · คำสั่ง user *"ยิงบัตรแล้วจบตรงนั้น"*)
      เพราะการ "พาไปหน้าเช็คชื่อแล้วให้ยิงซ้ำ + กดบันทึกทั้งจอ" คือ 3 ขั้นสำหรับงานที่มีขั้นเดียว
      · เขียนได้**แถวเดียวของคนที่ยิง** ผ่าน `src/lib/checkinSave.js` เท่านั้น (ห้ามเขียนฐานตรงในหน้านี้)
      · 🔐 หน้านี้ยิงบัตร**ใครก็ได้ทั้งโรงงาน** (ไม่มีรายชื่อมากรองให้เหมือน `/checkin`)
        ⇒ **ต้องเช็คขอบเขตชั้น ③ เอง** (`canWriteLine`) — นอกขอบเขต = ไม่เขียน + บอกเหตุผลบนจอ
   5. **ทางเข้ากลาง "สแกนอะไรก็ได้"** (2026-10-19 · คำสั่ง user — QA ตรวจชิ้นงาน · AM · PM · อุปกรณ์)
      ไม่ใช่เครื่อง/จิ๊ก/จุดส่ง ⇒ ลองเป็น **ใบผลิต (`prod_no`)** แล้ว **MAT/พาร์ท** (บาร์โค้ดคัมบัง/กล่อง)
      → ปุ่ม ✅ ตรวจชิ้นงาน QA (`/qa?tab=sheet&part=`) · สอบกลับ · ปุ่ม AM/PM แยกป้ายตาม `isAmTeam`
      · ตัวแปลง/ตัดสินอยู่ `qrCode.js` ที่เดียว (`resolveProduct`/`findQaPartByScan`) ห้ามเทียบเองในหน้านี้
   6. **เฟส 3 "สแกนอะไรก็เปิดหน้าของสิ่งนั้น"** (2026-10-28 · คำสั่ง user)
      ป้ายไลน์ (ESM:L / ชื่อไลน์เปล่า) → หน้าของไลน์นั้น · บัตรพนักงาน (รหัสล้วน) → การ์ดคน ·
      ป้ายคลัง (ESM:W) → ข้อมูลคลัง · ป้ายประเภท Downtime/งานเสีย (ESM:T/X) → บอกว่าเป็นอะไร + ใช้ที่ไหน
      · ตัวตัดสิน = `resolveLine`/`resolveTypeRow` (qrCode.js) · `findByBadge` (badgeCheckin.js) — ห้ามเทียบเองในหน้านี้
      · โหลดเฉพาะเมื่อป้ายเป็นชนิดนั้น (กฎ egress) · หาเจอหลายอย่างพร้อมกัน (เลขเปล่า) = โชว์ทุกการ์ด ห้ามเดาว่าเป็นอันไหน
   ══════════════════════════════════════════════════════════════════════════ */
import { useContext, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { UserContext } from '../App';
import Page from '../components/Page';
import PageHeader from '../components/PageHeader';
import ScanModal from '../components/ScanModal';
import { supabaseDR } from '../supabaseClient';
import useMachines from '../utils/useMachines';
import { canAccessPage } from '../utils/permissions';
import { DEFAULT_TEAMS, loadPmTeams } from '../utils/pmTeams';
import { supabase } from '../supabaseClient';
import MachineRepairHistory from '../components/MachineRepairHistory';
import { parseQrPayload, resolveMachine, resolveJig, resolveDeliveryPoint, resolveProduct, resolveLine, resolveTypeRow, QR_KINDS } from '../utils/qrCode';
import { useProductionLinesState } from '../utils/useProductionLines';
import { useStorageLocationsState } from '../utils/useStorageLocations';
import { findByBadge, normBadgeCode } from '../utils/badgeCheckin';
import { checkinByBadge } from '../lib/checkinSave';
import { can } from '../utils/permissions';
import { canWriteLine, canWriteUnit, writeBlockText } from '../utils/writeScope';
import { getWorkDate, getCurrentShift } from '../utils/workDate';
import { toast } from '../components/Toast';

const card = {
  background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
  padding: 16, boxShadow: 'var(--shadow-sm)',
};

/* ปุ่มลงมือ — เป้ากด 44px ตาม UI §6.24 (คนถือมือถือ ใส่ถุงมือ ยืนหน้าเครื่อง) */
function ActionLink({ to, icon, label, sub, tone = 'var(--accent)' }) {
  return (
    <Link to={to} style={{
      display: 'flex', alignItems: 'center', gap: 12, minHeight: 56, padding: '10px 14px',
      borderRadius: 10, border: `1px solid ${tone}`, background: 'var(--bg2)',
      backgroundImage: `linear-gradient(${tone}14, ${tone}14)`, textDecoration: 'none', color: 'var(--text)',
    }}>
      <span style={{ fontSize: 22 }}>{icon}</span>
      <span style={{ minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: tone }}>{label}</div>
        {sub && <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{sub}</div>}
      </span>
    </Link>
  );
}

export default function ScanLanding() {
  const { role, section: homeSection, sections: scopeSecs, allUnits, respCostCenters, scopeIdx, fullName }
    = useContext(UserContext);
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const raw = sp.get('c') || sp.get('code') || '';
  const { machines, loading: mLoading, failed: mFailed } = useMachines();
  const [jigs, setJigs] = useState(null);      // null = ยังไม่โหลด · [] = โหลดแล้วไม่มี
  const [jigErr, setJigErr] = useState(false);
  // เปิดจากแถบล่าง 📷 (ยังไม่มีรหัส) = เปิดกล้องให้เลย ไม่ต้องแตะปุ่มซ้ำอีกที (2026-10-19)
  const [rescan, setRescan] = useState(() => !(sp.get('c') || sp.get('code')));

  useEffect(() => {
    let alive = true;   // stale-response guard (กฎเขียน DB ข้อ 4)
    /* ⚠️ `jigs` ไม่มีคอลัมน์ department (วัด 05/10) — เดิม select ไปด้วย ⇒ 42703 ทั้งคิวรี
       ⇒ จิ๊กไม่เคยถูกพบ + ปุ่ม "ตรวจ PM" ไม่เคยโผล่ · แผนกของใบตรวจอ่านจาก checklists แทน (ด้านล่าง) */
    supabaseDR.from('jigs').select('id, name, jig_no, machine_no, machine_id, line_name, equipment_type')
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) { setJigErr(true); setJigs([]); return; }
        setJigs(data ?? []);
      });
    return () => { alive = false; };
  }, []);

  const scan = useMemo(() => parseQrPayload(raw), [raw]);
  const isDelivery = scan?.kind === 'delivery';

  /* 🎯 ป้ายจุดส่งงาน (ESM:D:<uuid>) — QrLabels พิมพ์เป็นลิงก์ /scan เหมือนป้ายเครื่อง
     เดิมหน้านี้หาแค่เครื่อง/จิ๊ก ⇒ ส่องป้ายจุดส่งด้วยกล้องมือถือแล้วขึ้น "ไม่พบอุปกรณ์" ทุกครั้ง (QC 05/10)
     โหลดเฉพาะเมื่อเป็นป้ายจุดส่ง (ไม่ดึงทะเบียนทุกครั้งที่สแกนเครื่อง) */
  const [points, setPoints] = useState(null);
  const [pointErr, setPointErr] = useState(false);
  useEffect(() => {
    if (!isDelivery) { setPoints([]); return undefined; }
    let alive = true;
    setPoints(null);
    supabaseDR.from('line_delivery_points').select('id, code, name, line_names, is_active')
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) { setPointErr(true); setPoints([]); return; }
        setPoints(data ?? []);
      });
    return () => { alive = false; };
  }, [isDelivery]);

  const loading = mLoading || jigs === null || points === null;

  const hit = useMemo(() => {
    if (!scan || loading) return null;
    const machine = resolveMachine(scan, machines);
    const jig = resolveJig(scan, jigs ?? []);     // แถวทะเบียน PM (เครื่องมี "แถวเงา" ใน jigs)
    const point = isDelivery ? resolveDeliveryPoint(scan, points ?? []) : null;
    return { machine, jig, point };
  }, [scan, machines, jigs, points, isDelivery, loading]);

  const title = hit?.machine
    ? `${hit.machine.machine_no || '—'}`
    : hit?.jig ? (hit.jig.jig_no || hit.jig.name || '—') : null;
  const subtitle = hit?.machine
    ? [hit.machine.machine_name, hit.machine.line_name].filter(Boolean).join(' · ')
    : hit?.jig ? [hit.jig.name, hit.jig.line_name].filter(Boolean).join(' · ') : '';

  const found = !!(hit?.machine || hit?.jig);
  // 🔨 แม่พิมพ์ใช้ตัวตนเดียวกับเครื่องจักร (machines · equipment_kind='die') — ป้าย ESM:M ชุดเดียวกัน (2026-10-06)
  const isDie = hit?.machine?.equipment_kind === 'die';

  /* แผนกที่มีใบตรวจของอุปกรณ์นี้ (checklists.department = key ทีมช่าง) — ส่ง `dept=` ไปหน้า PM
     ไม่ส่ง = PMCheckData เปิดแผนก maintenance เสมอ ⇒ จิ๊กของ JIG MTN/AM หาใบตรวจไม่เจอ (QC 05/10)
     null = ยังโหลด · [] = ไม่มีใบตรวจ / โหลดไม่ได้ (ปุ่มยังพาไปได้ แบบไม่ระบุแผนก) */
  const jigId = hit?.jig?.id || null;
  const [pmDepts, setPmDepts] = useState(null);
  useEffect(() => {
    if (!jigId) { setPmDepts(null); return undefined; }
    let alive = true;
    supabaseDR.from('checklists').select('department').eq('equipment_id', jigId).eq('module', 'mtn')
      .then(({ data, error }) => {
        if (!alive) return;
        setPmDepts(error ? [] : [...new Set((data || []).map(r => r.department).filter(Boolean))]);
      });
    return () => { alive = false; };
  }, [jigId]);
  /* ทีมจาก mtn_teams (data-driven) — ป้ายปุ่มต้องแยก AM (ผลิตตรวจเอง) กับ PM (ช่าง) ให้ขาด ด้วย `kind` ห้าม hardcode 'production' */
  const [teams, setTeams] = useState(DEFAULT_TEAMS);
  useEffect(() => { let alive = true; loadPmTeams().then(t => { if (alive && t?.length) setTeams(t); }); return () => { alive = false; }; }, []);
  const teamOf = (k) => teams.find(t => t.key === k);
  const teamLabel = (k) => teamOf(k)?.label || k;
  const isAm = (k) => teamOf(k)?.kind === 'am';
  const [showHist, setShowHist] = useState(false);

  /* 📦 ไม่ใช่อุปกรณ์ ⇒ ลองเป็นใบผลิต / MAT (บาร์โค้ดคัมบัง-กล่อง) — ยิงเฉพาะตอนจำเป็น (กฎ egress)
     null = ยังไม่ลอง/กำลังโหลด · { order, product, qaPart, err } */
  const tryProduct = !!(scan && !loading && !(hit?.machine || hit?.jig || hit?.point)
    && (scan.kind === null || scan.kind === 'product'));
  const code = scan?.id || '';
  const [prodHit, setProdHit] = useState(null);
  useEffect(() => {
    if (!tryProduct || !code) { setProdHit(null); return undefined; }
    let alive = true;
    setProdHit(null);
    // ค่าใน .eq() ปลอดภัยต่อ comma/วงเล็บ (ไม่ได้ประกอบเป็นสตริง filter เอง)
    Promise.all([
      scan.kind === 'product' ? Promise.resolve({ data: [] })
        : supabaseDR.from('prod_orders').select('prod_no, mat_no, part_name, status, production_sessions!inner(line_name, work_date, shift)')
          .eq('prod_no', code).limit(1),
      // ⚠️ dr_products ไม่มีคอลัมน์ part_name (ชื่อ = `name`) — เดิม select ผิด ⇒ 42703 ทุกครั้ง (แก้ 20/10)
      supabaseDR.from('dr_products').select('mat_no, p_no, name').eq('mat_no', code).limit(1),
      supabase.from('qa_parts').select('id, mat_no, part_no, part_name, line_name').eq('is_active', true),
    ]).then(([o, p, q]) => {
      if (!alive) return;
      const order = o.data?.[0] || null;
      const matNo = order?.mat_no || p.data?.[0]?.mat_no || code;
      const qaPart = q.error ? null : resolveProduct({ kind: 'product', id: matNo }, q.data || [])
        || (order ? null : resolveProduct({ kind: 'product', id: code }, q.data || []));
      setProdHit({
        order, product: p.data?.[0] || null, qaPart,
        err: [o.error && 'ใบผลิต', p.error && 'ทะเบียนสินค้า', q.error && 'มาตรฐานตรวจ QA'].filter(Boolean),
      });
    });
    return () => { alive = false; };
  }, [tryProduct, code, scan?.kind]);
  const prodFound = !!(prodHit && (prodHit.order || prodHit.product || prodHit.qaPart));
  const pointHit = !found ? hit?.point : null;

  /* ══ เฟส 3 (28/10) — ไลน์ · บัตรพนักงาน · คลัง · ประเภท Downtime/งานเสีย ══ */
  const { rows: allLines, loading: linesLoading, failed: linesFailed } = useProductionLinesState();
  const { rows: storageRows, loading: stoLoading, failed: stoFailed } = useStorageLocationsState();
  const lineById = useMemo(() => Object.fromEntries((allLines || []).map(l => [String(l.id), l])), [allLines]);
  /* ป้ายไลน์ (ESM:L) หรือเลขเปล่าที่ตรงชื่อไลน์เป๊ะ — ชื่อไลน์เปล่าไม่ตรง = ไม่ใช่ไลน์ (ไม่ขึ้น error) */
  const lineHit = useMemo(() => {
    if (!scan || !(scan.kind === 'line' || scan.kind === null)) return null;
    return resolveLine(scan, allLines || []).line || null;
  }, [scan, allLines]);
  const storageHit = useMemo(() => {
    if (scan?.kind !== 'storage') return null;
    const q = normBadgeCode(scan.id);
    return (storageRows || []).find(r => normBadgeCode(r.code) === q) || null;
  }, [scan, storageRows]);

  /* 🪪 บัตรพนักงาน = รหัสล้วน (เลขเปล่า) — ลองเฉพาะป้ายไม่มีชนิด · `.in` 2 รูป (ตามที่สแกน + ปรับรูป) แล้วตัดสินด้วย findByBadge */
  const tryEmp = !!(scan && scan.kind === null && code && !loading && !found && !hit?.point);
  const [empHit, setEmpHit] = useState(null);   // null = ยังไม่ลอง · { emp, err }
  useEffect(() => {
    if (!tryEmp) { setEmpHit(null); return undefined; }
    let alive = true;
    setEmpHit(null);
    supabase.from('employees').select('id, name, employee_id_code, position, section, line_id, is_active')
      .in('employee_id_code', [...new Set([code, normBadgeCode(code)])]).limit(5)
      .then(({ data, error }) => {
        if (!alive) return;
        setEmpHit({ emp: error ? null : findByBadge(data || [], code), err: !!error });
      });
    return () => { alive = false; };
  }, [tryEmp, code]);

  const emp = empHit?.emp || null;

  /* ══ 🪪 เช็คชื่อด้วยบัตร — ยิงแล้วจบตรงนี้ (10/11 · คำสั่ง user) ═══════════════════════════
     *"ยิงบัตรแล้วขึ้น ✓ เช็คชื่อสำเร็จ พอ ไม่ต้องเปิดหน้าเช็คชื่อ"* — เดิมปุ่มนี้แค่ `navigate('/checkin')`
     แล้วต้องยิงซ้ำ + กดบันทึกทั้งจอ = 3 ขั้นสำหรับงานขั้นเดียว

     🔐 **หน้านี้ยิงบัตรใครก็ได้ทั้งโรงงาน** — `/checkin` มีรายชื่อตามขอบเขตมากรองให้อยู่แล้ว
     แต่หน้านี้ไม่มี ⇒ ต้องเช็คขอบเขตชั้น ③ เอง ไม่งั้นใครก็เช็คชื่อให้คนแผนกอื่นได้
     · มีไลน์ = ตัดสินที่ไลน์ (`canWriteLine`) · ไม่มีไลน์ (งานสนับสนุน) = ตัดสินที่ส่วนงานของตัวคน
     · `unknownTarget:'block'` — ระบุเจ้าของไม่ได้ = ไม่เขียน (fail-closed) แล้วบอกบนจอว่าทำไม */
  const ckCtx = { role, section: homeSection, sections: scopeSecs, allUnits, respCostCenters, scopeIdx };
  const canCheckin = canAccessPage('/checkin', role) && can('checkin', 'record', role);
  const empLineName = emp ? (lineById[String(emp.line_id)]?.name || '') : '';
  const ckScope = !emp ? null
    : empLineName
      ? canWriteLine(ckCtx, empLineName, allLines || [], { unknownTarget: 'block' })
      : canWriteUnit(ckCtx, emp.section, { unknownTarget: 'block' });
  const [ckResult, setCkResult] = useState(null);   // null | 'busy' | { kind, text }
  // สแกนใบใหม่ = ล้างผลของใบก่อน (ไม่งั้น ✓ ของคนก่อนค้างอยู่ใต้การ์ดคนใหม่ = อ่านผิดคน)
  useEffect(() => { setCkResult(null); }, [emp?.id]);

  const doCheckin = async () => {
    if (!emp || ckResult === 'busy') return;
    if (emp.is_active === false) { setCkResult({ kind: 'blocked', text: 'พนักงานคนนี้ถูกปิดใช้งาน/พ้นสภาพแล้ว — เช็คชื่อไม่ได้' }); return; }
    /* 🔴 อ่านทะเบียนไลน์ไม่ได้ = **ยังตัดสินขอบเขตไม่ได้** ⇒ ไม่เขียน (fail-closed)
       ปล่อยผ่าน = คนนอกขอบเขตถูกเช็คชื่อตอนทะเบียนล่ม · บีบเป็น "ไม่มีสิทธิ์" = จอโกหก */
    if (emp.line_id && (linesFailed || linesLoading)) {
      setCkResult({ kind: 'blocked', text: linesFailed
        ? 'ยังเช็คชื่อไม่ได้ — ระบบอ่านทะเบียนไลน์ไม่สำเร็จ จึงตัดสินไม่ได้ว่าอยู่ในขอบเขตที่คุณรับผิดชอบไหม · โหลดหน้าใหม่อีกครั้ง'
        : 'กำลังโหลดทะเบียนไลน์ — รอสักครู่แล้วกดใหม่' });
      return;
    }
    if (!ckScope?.ok) {   // 🔴 ด่านจริงอยู่ตรงนี้ ไม่ใช่แค่ซ่อนปุ่ม (เปิด /scan?c=<รหัส> ตรงได้)
      setCkResult({ kind: 'blocked', text: writeBlockText(ckScope, { what: 'การเช็คชื่อของคนนี้', unit: empLineName || emp.section || '' }) });
      return;
    }
    setCkResult('busy');
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user?.id) { setCkResult({ kind: 'blocked', text: 'ยังไม่ได้เข้าระบบ — บันทึกไม่ได้' }); return; }
    const workDateStr = getWorkDate();
    const r = await checkinByBadge(supabase, { emp, workDateStr, shift: getCurrentShift(), userId: userData.user.id });
    const where = [empLineName || emp.section, r.shift === 'night' ? 'กะดึก' : 'กะเช้า', workDateStr].filter(Boolean).join(' · ');
    if (r.kind === 'saved')  { toast.success(`✓ เช็คชื่อสำเร็จ — ${emp.name}`); setCkResult({ kind: 'saved', text: where }); return; }
    if (r.kind === 'already') { setCkResult({ kind: 'already', text: where }); return; }
    // ❌ ล้ม = ต้องเห็นว่ายังไม่ได้เช็ค ห้ามขึ้น ✓ (read_failed = ไม่รู้ของเดิม จึงไม่เขียนทับ PPE/ลา)
    setCkResult({ kind: 'failed', text: r.kind === 'read_failed'
      ? `อ่านข้อมูลเช็คชื่อเดิมไม่สำเร็จ จึงยังไม่บันทึก (กันทับ PPE/การลา ที่กรอกไว้แล้ว) — ลองใหม่อีกครั้ง · ${r.msg || ''}`
      : 'บันทึกไม่สำเร็จ — ยังไม่ได้เช็คชื่อ (ดูข้อความแดงที่มุมจอ) · ลองใหม่อีกครั้ง' });
  };

  /* ⏱/🔴 ป้ายประเภท — ดึงแถวเดียวตาม id เฉพาะเมื่อเป็นป้ายชนิดนั้น */
  const typeKind = scan?.kind === 'downtime_type' || scan?.kind === 'defect_type' ? scan.kind : null;
  const [typeHit, setTypeHit] = useState(null);   // null = ยังไม่โหลด · { row, err }
  useEffect(() => {
    if (!typeKind || !code) { setTypeHit(null); return undefined; }
    let alive = true;
    setTypeHit(null);
    const table = typeKind === 'downtime_type' ? 'dr_downtime_types' : 'dr_defect_types';
    const cols = typeKind === 'downtime_type' ? 'id, name_th, category, process_type, is_active' : 'id, name_th, process_type, is_active';
    supabaseDR.from(table).select(cols).eq('id', code).limit(1)
      .then(({ data, error }) => {
        if (!alive) return;
        setTypeHit({ row: error ? null : (resolveTypeRow(scan, typeKind, data || []).row || null), err: !!error });
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeKind, code]);

  const extraLoading = (scan?.kind === 'line' && linesLoading) || (scan?.kind === 'storage' && stoLoading)
    || (tryEmp && !empHit) || (typeKind && !typeHit);
  const extraFound = !!(lineHit || storageHit || empHit?.emp || typeHit?.row);
  const extraErr = (scan?.kind === 'line' && linesFailed) || (scan?.kind === 'storage' && stoFailed) || empHit?.err || typeHit?.err;

  return (
    <Page>
      <PageHeader icon="📷" title="สแกนเข้างาน"
        sub="ส่อง QR ที่ติดเครื่อง หรือบาร์โค้ดคัมบัง/ใบผลิต แล้วเลือกได้เลยว่าจะทำอะไร" />

      {!raw && (
        <div style={{ ...card, textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 6 }}>📷</div>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>ยังไม่มีรหัสจากป้าย</div>
          <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 12px' }}>
            ส่อง QR ที่ติดเครื่องด้วยกล้องมือถือ หรือกดสแกนจากในแอป
          </p>
          <button onClick={() => setRescan(true)} style={{ minHeight: 44, padding: '0 20px', fontSize: 14, fontWeight: 800 }}>
            สแกนเลย
          </button>
        </div>
      )}

      {raw && loading && <div style={{ ...card, color: 'var(--muted)', fontSize: 13 }}>กำลังค้นหาอุปกรณ์…</div>}

      {raw && !loading && pointHit && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={card}>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, marginBottom: 2 }}>จุดส่งงาน</div>
            <div style={{ fontSize: 26, fontWeight: 900, lineHeight: 1.2 }}>{pointHit.name || pointHit.code || '—'}</div>
            <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 2 }}>
              {[pointHit.code && `รหัส ${pointHit.code}`, (pointHit.line_names || []).join(', ')].filter(Boolean).join(' · ')}
              {pointHit.is_active === false && <b style={{ color: 'var(--red, var(--red))' }}> · ปิดใช้งานแล้ว</b>}
            </div>
            <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '10px 0 0', lineHeight: 1.7 }}>
              ป้ายนี้ใช้ยืนยันตอน <b>สโตร์ส่งของถึงไลน์</b> — สแกนจากปุ่ม 📍 ในใบเติม WIP (หน้า Heijunka) ไม่ใช่ป้ายเครื่องจักร
            </p>
          </div>
          {canAccessPage('/heijunka', role) && (
            <ActionLink to="/heijunka" icon="🔄" label="ไปหน้าส่งของ (Heijunka)" sub="เลือกใบที่จะส่ง แล้วสแกนป้ายนี้ยืนยัน" />
          )}
          <button onClick={() => setRescan(true)}
            style={{ minHeight: 44, background: 'var(--bg3)', border: '1px solid var(--border2)', fontSize: 13 }}>
            สแกนป้ายอื่น
          </button>
        </div>
      )}

      {raw && !loading && !found && !pointHit && extraFound && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: prodFound ? 12 : 0 }}>
          {lineHit && (() => {
            const q = encodeURIComponent(lineHit.name);
            return (<>
              <div style={card}>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, marginBottom: 2 }}>ไลน์ผลิต</div>
                <div style={{ fontSize: 26, fontWeight: 900, lineHeight: 1.2 }}>{lineHit.name}</div>
                <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 2 }}>
                  {[lineHit.section && `ส่วนงาน ${lineHit.section}`, lineHit.parent_line_name && `ใต้ ${lineHit.parent_line_name}`].filter(Boolean).join(' · ')}
                  {lineHit.is_active === false && <b style={{ color: 'var(--red, var(--red))' }}> · ปิดใช้งานแล้ว</b>}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {canAccessPage('/daily-report', role) && <ActionLink to={`/daily-report?line=${q}`} icon="📋" label="Daily Report ของไลน์นี้" sub="เปิดกะ · สแกนใบผลิต · ลง Downtime / งานเสีย" />}
                {canAccessPage('/line-oee', role) && <ActionLink to={`/line-oee?line=${q}`} icon="📈" label="OEE สดของไลน์" sub="A × P × Q ของกะนี้" tone="var(--green)" />}
                {canAccessPage('/management', role) && <ActionLink to={`/management?line=${q}`} icon="🗓️" label="แผน / สถานะงานของไลน์" sub="ใบผลิตที่กำลังเดิน + คิวถัดไป" tone="var(--blue)" />}
                {canAccessPage('/people-board', role) && <ActionLink to={`/people-board?line=${q}`} icon="🧑‍🤝‍🧑" label="คนในไลน์ / จุดงาน" sub="ใครอยู่จุดไหน กะนี้" tone="var(--blue)" />}
                {canAccessPage('/pm-check', role) && <ActionLink to={`/pm?tab=check&line=${q}`} icon="✅" label="ตรวจ AM / PM ของไลน์" sub="ใบตรวจของอุปกรณ์ในไลน์นี้" tone="var(--amber)" />}
                {canAccessPage('/qr-labels', role) && <ActionLink to={`/qr-labels?kind=sheet&line=${q}`} icon="🗒️" label="พิมพ์ใบสแกนประจำไลน์ (A4)" sub="QR ประเภท Downtime / งานเสียของไลน์นี้" tone="var(--muted)" />}
              </div>
            </>);
          })()}

          {emp && (<>
            <div style={card}>
              <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, marginBottom: 2 }}>พนักงาน</div>
              <div style={{ fontSize: 24, fontWeight: 900, lineHeight: 1.2 }}>{emp.name || '—'}</div>
              <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 2 }}>
                {[`รหัส ${emp.employee_id_code}`, emp.position, lineById[String(emp.line_id)]?.name, emp.section].filter(Boolean).join(' · ')}
                {emp.is_active === false && <b style={{ color: 'var(--red, var(--red))' }}> · พ้นสภาพ / ปิดใช้งาน</b>}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {canAccessPage('/operator', role) && <ActionLink to={`/operator?q=${encodeURIComponent(emp.employee_id_code)}`} icon="👤" label="ข้อมูลพนักงาน / ทักษะ" sub="เปิดฐานข้อมูลพนักงานที่คนนี้" />}

              {/* 🪪 เช็คชื่อจบที่นี่ — ไม่พาไปหน้าเช็คชื่อแล้วให้ยิงซ้ำ (10/11 · คำสั่ง user)
                  ปุ่มโผล่ตามสิทธิ์จริง (กฎข้อ 2) · นอกขอบเขต = โชว์ปุ่มแต่กดแล้วบอกเหตุผล
                  **ไม่ซ่อน** — ซ่อนเฉยๆ คนยืนถือบัตรอยู่จะไม่รู้ว่าทำไมไม่มีปุ่ม */}
              {canCheckin && ckResult?.kind !== 'saved' && ckResult?.kind !== 'already' && (
                <button type="button" onClick={doCheckin} disabled={ckResult === 'busy'}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 56, padding: '10px 14px', width: '100%',
                    borderRadius: 10, border: '1px solid var(--green)', background: 'var(--bg2)',
                    backgroundImage: 'linear-gradient(var(--green)14, var(--green)14)', color: 'var(--text)',
                    textAlign: 'left', cursor: ckResult === 'busy' ? 'wait' : 'pointer', opacity: ckResult === 'busy' ? 0.6 : 1,
                    fontFamily: 'var(--font-body)' }}>
                  <span style={{ fontSize: 22 }}>🪪</span>
                  <span style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--green)' }}>
                      {ckResult === 'busy' ? 'กำลังบันทึก…' : 'เช็คชื่อ “มางาน” เลย'}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                      บันทึกทันทีในนาม {fullName || 'ผู้ใช้นี้'} · {getWorkDate()} · {getCurrentShift() === 'night' ? 'กะดึก' : 'กะเช้า'}
                    </div>
                  </span>
                </button>
              )}
              {/* ผลลัพธ์ — ✓ ขึ้นเฉพาะตอนเขียนติดจริง (ล้ม = แดง ห้ามขึ้น ✓ ให้เข้าใจผิดว่าเช็คแล้ว) */}
              {ckResult && ckResult !== 'busy' && (() => {
                const tone = ckResult.kind === 'saved' ? 'var(--green)'
                  : ckResult.kind === 'already' ? 'var(--blue)' : 'var(--red)';
                const head = ckResult.kind === 'saved' ? `✓ เช็คชื่อสำเร็จ — ${emp.name}`
                  : ckResult.kind === 'already' ? `✓ ${emp.name} — เช็คมางานไว้แล้ว`
                  : `✕ ยังไม่ได้เช็คชื่อ — ${emp.name}`;
                return (
                  <div style={{ borderRadius: 10, border: `1px solid ${tone}`, background: 'var(--bg2)',
                    backgroundImage: `linear-gradient(${tone}14, ${tone}14)`, padding: '12px 14px' }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: tone, lineHeight: 1.3 }}>{head}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--text2)', marginTop: 3, lineHeight: 1.6 }}>{ckResult.text}</div>
                    {ckResult.kind === 'already' && (
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>ไม่ได้บันทึกซ้ำ — ของเดิม (PPE / OT / การลา) ยังอยู่ครบ</div>
                    )}
                  </div>
                );
              })()}
              {canAccessPage('/checkin', role) && (
                <ActionLink to="/checkin" icon="📋" label="เปิดหน้าเช็คชื่อ (ทั้งไลน์)"
                  sub="ติ๊ก PPE · การลา · OT · ยิงบัตรรัวทีละหลายคน" tone="var(--muted)" />
              )}
            </div>
          </>)}

          {storageHit && (
            <div style={card}>
              <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, marginBottom: 2 }}>ที่เก็บ / รหัสคลัง</div>
              <div style={{ fontSize: 26, fontWeight: 900, lineHeight: 1.2 }}>{storageHit.code}</div>
              <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 2 }}>
                {[storageHit.name, storageHit.kind, (storageHit.line_names || []).join(', ')].filter(Boolean).join(' · ')}
                {storageHit.is_active === false && <b style={{ color: 'var(--red, var(--red))' }}> · ปิดใช้งานแล้ว</b>}
              </div>
              <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '10px 0 0', lineHeight: 1.7 }}>
                ป้ายนี้ใช้ <b>ยิงในช่องรหัสคลัง</b> (ช่องที่มีปุ่ม 📷) แทนการเลือกจากรายการ
              </p>
            </div>
          )}

          {typeHit?.row && (() => {
            const t = typeHit.row;
            const isDt = typeKind === 'downtime_type';
            return (<>
              <div style={card}>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, marginBottom: 2 }}>{isDt ? '⏱ ประเภท Downtime' : '🔴 ประเภทงานเสีย'}</div>
                <div style={{ fontSize: 24, fontWeight: 900, lineHeight: 1.2 }}>{t.name_th || '—'}</div>
                <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 2 }}>
                  {[isDt && (t.category === 'planned' ? 'ในแผน' : 'นอกแผน'), t.process_type && `กระบวนการ ${t.process_type}`].filter(Boolean).join(' · ')}
                  {t.is_active === false && <b style={{ color: 'var(--red, var(--red))' }}> · ปิดใช้งานแล้ว — ยิงลงใบไม่ได้ พิมพ์แผ่นใหม่</b>}
                </div>
                <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '10px 0 0', lineHeight: 1.7 }}>
                  ป้ายนี้มาจาก <b>ใบสแกนประจำไลน์</b> — ใช้ยิงตอนบันทึก {isDt ? 'Downtime' : 'งานเสีย'} ใน Daily Report (ปุ่ม 📷 ข้างช่องประเภท หรือกดปุ่มสแกนข้างเครื่องตอนฟอร์มเปิดอยู่)
                </p>
              </div>
              {canAccessPage('/daily-report', role) && <ActionLink to="/daily-report" icon="📋" label="ไป Daily Report" sub={`เปิดฟอร์มบันทึก${isDt ? ' Downtime' : 'งานเสีย'} แล้วยิงป้ายนี้`} />}
            </>);
          })()}

          {!prodFound && (
            <button onClick={() => setRescan(true)}
              style={{ minHeight: 44, background: 'var(--bg3)', border: '1px solid var(--border2)', fontSize: 13 }}>
              สแกนป้ายอื่น
            </button>
          )}
        </div>
      )}

      {raw && !loading && !found && !pointHit && (extraLoading || (tryProduct && !prodHit)) && !extraFound && !prodFound && (
        <div style={{ ...card, color: 'var(--muted)', fontSize: 13 }}>ไม่ใช่ป้ายอุปกรณ์ — กำลังค้นเป็นใบผลิต / MAT / บัตรพนักงาน / ไลน์…</div>
      )}

      {raw && !loading && !found && !pointHit && prodFound && (() => {
        const { order, product, qaPart } = prodHit;
        const mat = order?.mat_no || product?.mat_no || qaPart?.mat_no || code;
        const name = order?.part_name || product?.name || qaPart?.part_name || '';
        const sess = order?.production_sessions;
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={card}>
              <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, marginBottom: 2 }}>
                {order ? '📄 ใบผลิต' : '📦 สินค้า / พาร์ท'}
              </div>
              <div style={{ fontSize: 24, fontWeight: 900, lineHeight: 1.2, wordBreak: 'break-all' }}>{order ? order.prod_no : mat}</div>
              <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 2 }}>
                {[order && `MAT ${mat}`, name, sess && `${sess.line_name} · ${sess.work_date} ${sess.shift === 'night' ? 'กะดึก' : 'กะเช้า'}`].filter(Boolean).join(' · ')}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {canAccessPage('/qa', role) && (qaPart
                ? <ActionLink to={`/qa?tab=sheet&part=${encodeURIComponent(qaPart.mat_no || qaPart.part_no)}`} icon="✅"
                    label="ตรวจชิ้นงาน (ใบตรวจ QA)" sub={`เปิดใบตรวจของ ${qaPart.part_no || qaPart.mat_no} — วันงาน/กะปัจจุบัน`} tone="var(--green)" />
                : <ActionLink to="/qa-setup" icon="📐" label="ยังไม่มีมาตรฐานการตรวจของพาร์ทนี้"
                    sub="ตั้งจุดตรวจที่ มาตรฐานการตรวจ & Drawing ก่อน จึงจะเปิดใบตรวจได้" tone="var(--muted)" />)}
              {canAccessPage('/order-trace', role) && (order
                ? <ActionLink to={`/order-trace?prod=${encodeURIComponent(order.prod_no)}`} icon="🔎" label="สอบกลับใบผลิตนี้" sub="ทุกเหตุการณ์ของใบ — คน/เครื่อง/ของเสีย/4M" tone="var(--blue)" />
                : <ActionLink to={`/order-trace?q=${encodeURIComponent(mat)}`} icon="🔎" label="ดูใบผลิตของพาร์ทนี้" sub="ค้นใบผลิตในช่วงวันล่าสุด" tone="var(--blue)" />)}
            </div>
            {prodHit.err.length > 0 && (
              <div style={{ fontSize: 12, color: 'var(--red, var(--red))' }}>⚠️ โหลด{prodHit.err.join(' · ')}ไม่สำเร็จ — ปุ่มบางอันอาจหายไปเพราะอ่านไม่ได้ ไม่ใช่เพราะไม่มี</div>
            )}
            <button onClick={() => setRescan(true)}
              style={{ minHeight: 44, background: 'var(--bg3)', border: '1px solid var(--border2)', fontSize: 13 }}>
              สแกนป้ายอื่น
            </button>
          </div>
        );
      })()}

      {raw && !loading && !found && !pointHit && !extraFound && !extraLoading && (!tryProduct || (prodHit && !prodFound)) && (
        <div style={{ ...card, borderColor: 'var(--amber, var(--amber))' }}>
          <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>⚠️ ไม่พบสิ่งที่ตรงกับป้ายนี้</div>
          <div style={{ fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.8 }}>
            รหัสที่อ่านได้: <code style={{ background: 'var(--bg3)', padding: '1px 6px', borderRadius: 4 }}>{scan?.raw || raw}</code><br />
            ชนิดป้าย: {scan?.typed ? `${QR_KINDS[scan.kind]?.icon ?? ''} ${QR_KINDS[scan.kind]?.label ?? scan.kind}` : 'เลขเปล่า (ไม่ใช่ป้ายของระบบ)'}
            {/* 🗒️ ป้ายเฟส 2 ที่หาแถวไม่เจอ (ถูกลบ/ปิด) — บอกว่าป้ายใช้ที่ไหน ไม่ปล่อยให้คิดว่าป้ายเสีย (28/10) */}
            {['line', 'downtime_type', 'defect_type', 'storage'].includes(scan?.kind) && (
              <><br />ป้ายชนิดนี้ถูกต้อง แต่<b>ไม่พบแถวในทะเบียน</b> (อาจถูกลบ/เปลี่ยนรหัส) — พิมพ์ป้ายใหม่จากหน้า QR Labels</>
            )}
            {scan?.kind === null && <><br />ลองแล้ว: เครื่อง/จิ๊ก · ใบผลิต · MAT · บัตรพนักงาน · ชื่อไลน์</>}
            {(mFailed || jigErr || pointErr || prodHit?.err?.length > 0 || extraErr) && <><br /><b style={{ color: 'var(--red, var(--red))' }}>⚠️ โหลดทะเบียนไม่ครบ — อาจไม่ใช่ว่าไม่มีเครื่องนี้จริง ลองใหม่อีกครั้ง</b></>}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button onClick={() => setRescan(true)} style={{ minHeight: 44, padding: '0 16px', fontWeight: 700 }}>สแกนใหม่</button>
            <button onClick={() => navigate('/')} style={{ minHeight: 44, padding: '0 16px', background: 'var(--bg3)' }}>หน้าแรก</button>
          </div>
        </div>
      )}

      {raw && !loading && found && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={card}>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 2 }}>
              {isDie ? '🔨 แม่พิมพ์' : hit.machine ? '⚙️ เครื่องจักร' : '🧩 อุปกรณ์'}
            </div>
            <div style={{ fontSize: 26, fontWeight: 900, lineHeight: 1.2 }}>{title}</div>
            {subtitle && <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 2 }}>{subtitle}</div>}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* 🔨 แม่พิมพ์ → เด้งเข้าหมุดบนผังจัดเก็บ (แผงหมุดมีเปลี่ยนสถานะ + ใบซ่อมค้าง) · ตัวตัดสิน = findDieByScan ใน DieRegistry */}
            {isDie && canAccessPage('/die-registry', role) && (
              <ActionLink to={`/equipment?tab=die&die=layout&focus=${encodeURIComponent(hit.machine.id)}`} icon="🗺️"
                label="ดูตำแหน่งบนผังจัดเก็บ / เปลี่ยนสถานะ" sub="เด้งไปหมุดของแม่พิมพ์ตัวนี้" tone="var(--blue)" />
            )}
            {hit.jig && canAccessPage('/pm-check', role) && (pmDepts?.length
              ? pmDepts.map(d => (
                  <ActionLink key={d} to={`/pm?tab=check&equip=${hit.jig.id}&dept=${encodeURIComponent(d)}`} icon={isAm(d) ? '🏭' : '✅'}
                    label={isAm(d) ? `ตรวจ AM (ผลิตตรวจเอง)${pmDepts.filter(isAm).length > 1 ? ` — ${teamLabel(d)}` : ''}`
                      : `ตรวจ PM (ช่าง)${pmDepts.filter(x => !isAm(x)).length > 1 ? ` — ${teamLabel(d)}` : ''}`}
                    sub={`${teamLabel(d)} · เปิดใบตรวจตามจุดที่ตั้งไว้`} tone={isAm(d) ? 'var(--green)' : 'var(--accent)'} />
                ))
              : (
                <ActionLink to={`/pm?tab=check&equip=${hit.jig.id}`} icon="✅" label="ตรวจ PM เครื่องนี้"
                  sub={pmDepts === null ? 'กำลังหาใบตรวจ…' : 'ยังไม่พบใบตรวจของอุปกรณ์นี้ — เลือกแผนกในหน้าตรวจ'} />
              ))}
            {canAccessPage('/mtn-repair', role) && (
              <ActionLink to={`/mtn-repair?tab=list&q=${encodeURIComponent(hit.machine?.machine_no || hit.jig?.machine_no || hit.jig?.jig_no || '')}`}
                icon="🔧" label="แจ้งซ่อม / ดูใบซ่อมของเครื่องนี้" sub="ใบ MO ที่ค้างอยู่ + เปิดใบใหม่" tone="var(--amber)" />
            )}
            {!hit.jig && canAccessPage('/pm-setup', role) && (
              <ActionLink to={`/pm?tab=setup`} icon="⚙️" label="ยังไม่มีแผน PM — ไปตั้งจุดตรวจ"
                sub="เครื่องนี้ยังไม่มีทะเบียนตรวจ PM" tone="var(--muted)" />
            )}
            {hit.machine?.machine_no && canAccessPage('/mtn-repair', role) && (
              <button onClick={() => setShowHist(true)} style={{
                display: 'flex', alignItems: 'center', gap: 12, minHeight: 56, padding: '10px 14px', textAlign: 'left',
                borderRadius: 'var(--r-md)', border: '1px solid var(--amber)', background: 'var(--bg2)', color: 'var(--text)', cursor: 'pointer',
              }}>
                <span style={{ fontSize: 22 }}>📜</span>
                <span><div style={{ fontSize: 15, fontWeight: 800, color: 'var(--amber)' }}>ประวัติซ่อมเครื่องนี้</div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>ใบ MO ทั้งหมด · เวลาซ่อม · ค่าใช้จ่าย</div></span>
              </button>
            )}
            {hit.machine?.machine_no && canAccessPage('/order-trace', role) && (
              <ActionLink to={`/order-trace?tab=symptom&machine=${encodeURIComponent(hit.machine.machine_no)}`} icon="📋"
                label="สอบกลับ / ประวัติเหตุการณ์ของเครื่องนี้" sub="เครื่องหยุด + ของเสียที่ผูกเครื่องนี้ ในช่วงวันที่เลือก" tone="var(--blue)" />
            )}
          </div>

          <button onClick={() => setRescan(true)}
            style={{ minHeight: 44, background: 'var(--bg3)', border: '1px solid var(--border2)', fontSize: 13 }}>
            สแกนป้ายอื่น
          </button>
        </div>
      )}

      {showHist && hit?.machine?.machine_no && (
        <MachineRepairHistory machineNo={hit.machine.machine_no} onClose={() => setShowHist(false)}
          onOpenOrder={(o) => { setShowHist(false); navigate(`/mtn-repair?mo=${o.id}`); }} />
      )}

      {rescan && (
        <ScanModal title="สแกนป้าย / บาร์โค้ด / บัตร"
          onScan={(parsed) => { if (!parsed?.raw) return 'อ่านรหัสไม่ได้'; setSp({ c: parsed.raw }); setRescan(false); }}
          onClose={() => setRescan(false)} />
      )}
    </Page>
  );
}
