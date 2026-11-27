import { useState, useEffect, useContext, useMemo, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { UserContext } from '../App';
import { can } from '../utils/permissions';
import { toast } from '../components/Toast';
import { ngReasonCheck } from '../utils/ngReason';   // 🚩 "ไม่ผ่านต้องมีเหตุผล" — กฎเดียวกับใบตรวจ AM/PM (23/11)
import { inSectionScope, scopedLines } from '../utils/sectionScope';
import { getLineFamilyNames } from '../utils/lineHierarchy';
// picker กลาง (single-source audit 2026-09-07) — ไลน์/คน อ่านจากทะเบียน · สถานีจาก workstations ของไลน์
import LineSelect, { scopeLines as pickerLines } from '../components/LineSelect';
import PersonSelect from '../components/PersonSelect';
import useColumnHistory from '../utils/useColumnHistory';
import SelectOrFree from '../components/SelectOrFree';
import { loadLinesRes, LINE_COLUMNS } from '../utils/useProductionLines';
import PageHeader from '../components/PageHeader';
import Page from '../components/Page';
import FilterBar from '../components/FilterBar';
import Segmented from '../components/Segmented';
import { DeleteButton } from '../components/IconButton';
/* 🔴 "ยังไม่ได้ทดสอบ" ต้องแยกจาก "กะนี้ไม่ได้ผลิต" (13/10 · คำสั่ง user) */
import { loadRunDays, ranOn } from '../utils/runDays';
import NoticeBar from '../components/NoticeBar';
import { tr } from '../utils/i18n';
import { tint } from '../utils/statusTone';   // สี token ต่อ alpha-hex ไม่ได้ ⇒ ย่อยเป็น -dim/-line (UI §6.17)
import { askConfirm } from '../utils/askConfirm';
import { notifyEvent } from '../utils/notifyEvent';
import WfRoundPanel from '../components/WfRoundPanel';   // ✍️ การเซ็นของรอบ (e-Workflow โหมดผูกเอกสาร · 25/11)   // 🔔 N3 (24/11): ทดสอบไม่ผ่าน = แจ้ง (เดิมเงียบ)
import { checkWriteRows } from '../utils/dbWrite';
import { canWriteLine, writeBlockText } from '../utils/writeScope';   // 🔐 ชั้น ③ (19/11 · ออดิท check sheet)
const NO_LINES = [];

/* ── Poka-Yoke Check — ทดสอบอุปกรณ์ error-proofing รายวัน/กะ (TPM · 2026-07-23) ──────
   ทะเบียนอุปกรณ์ต่อไลน์ (pokayoke_devices) + บันทึกทดสอบด้วยชิ้น master NG (pokayoke_checks)
   แท็บที่ 3 ใน Daily Checker · scope ไลน์ตามมาตรฐาน (leader→family · role อื่น→sections · admin/qa→ทั้งหมด)
   สิทธิ์: record = pokayoke:record · จัดการทะเบียน = pokayoke:manage · migration 20260723_pokayoke_check.sql
*/
const localDateStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const getWorkDate = () => { const d = new Date(); if (d.getHours() < 8) d.setDate(d.getDate() - 1); return localDateStr(d); };
const getCurrentShift = () => { const h = new Date().getHours(); return h >= 8 && h < 20 ? 'day' : 'night'; };
const SHIFT_LABEL = { day: 'กะเช้า (Shift 01)', night: 'กะดึก (Shift 02)' };

export default function PokaYokeCheck() {
  const { role, lineId: userLineId, sections: scopeSecs, fullName,
          section: homeSection, allUnits, respCostCenters, scopeIdx } = useContext(UserContext);
  const canRecord = can('pokayoke', 'record', role);
  const canManage = can('pokayoke', 'manage', role);
  // 📜 ชื่อผู้ตรวจที่เคยบันทึก (Main pokayoke_checks) — คนนอกทะเบียนยังเลือกซ้ำได้ ไม่หายเงียบ (2026-09-07)
  const checkerHist = useColumnHistory(supabase, 'pokayoke_checks', 'checker_name');

  const [lines, setLines] = useState([]);
  const [selLine, setSelLine] = useState('');
  const [selShift, setSelShift] = useState(getCurrentShift());
  const [selDate, setSelDate] = useState(getWorkDate());
  const [devices, setDevices] = useState([]);
  const [checks, setChecks] = useState({});   // device_id → check row
  const [checker, setChecker] = useState(fullName || '');
  const [loading, setLoading] = useState(true);
  const [dEditing, setDEditing] = useState(null); // อุปกรณ์ที่กำลังเพิ่ม/แก้

  useEffect(() => { setChecker(fullName || ''); }, [fullName]);

  useEffect(() => {
    loadLinesRes() // LINE_COLUMNS = ครบตามสัญญา <LineSelect> (2026-09-07)
      .then(({ data }) => setLines(data || []));
  }, []);

  /* สถานีของไลน์ที่กำลังแก้อุปกรณ์ (Main `workstations`) — จุดงานเลือกจากทะเบียน ไม่พิมพ์เอง (audit #24 · 2026-09-07)
     <SelectOrFree> = ระบุเองสำหรับอุปกรณ์ที่ไม่ได้อยู่ประจำสถานี · guard alive กัน stale-response ตอนสลับไลน์ */
  const [stations, setStations] = useState([]);
  const editLine = dEditing?.line_name || '';
  useEffect(() => {
    if (!editLine) { setStations([]); return; }
    let alive = true;
    supabase.from('workstations').select('station_name').eq('line_name', editLine).order('station_name')
      .then(({ data }) => { if (alive) setStations([...new Set((data || []).map(w => w.station_name).filter(Boolean))]); });
    return () => { alive = false; };
  }, [editLine]);
  // ครอบครัวไลน์ที่เลือก — ให้ picker ผู้ตรวจเรียงคนของไลน์ขึ้นก่อน (ไม่ตัดคนอื่น)
  const selFam = useMemo(() => (selLine ? getLineFamilyNames(lines, selLine) : NO_LINES), [lines, selLine]);

  // scope ไลน์มาตรฐาน
  /* 🔴 ลิสต์ของ picker ต้อง "ไม่ตาย" — ส่วนงานที่ไม่มีไลน์ผลิตสังกัด (QA · Planning&Store · ฝั่งช่าง)
     กรองแล้วเหลือ 0 ⇒ dropdown ว่าง = ใช้ฟีเจอร์ไม่ได้ทั้งหน้า (เคสจริง 26/10 · ด่าน line-picker-never-dead)
     ⇒ ผ่าน `scopeLines()` ของกลาง (components/LineSelect.jsx) = "กรองแล้วไม่เหลือ = ไม่กรอง" */
  const visibleLines = useMemo(() => {
    const arr = pickerLines(lines, { role, lineId: userLineId, sections: scopeSecs, scopeIdx });
    return [...arr].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [lines, role, userLineId, scopeSecs, scopeIdx]);

  useEffect(() => { if (!selLine && visibleLines.length) setSelLine(visibleLines[0].name); }, [visibleLines, selLine]);

  /* วันนี้/กะนี้ไลน์นี้เปิดกะไหม — `null` ระหว่างโหลด · `{ok:false}` = อ่านไม่ได้ (⇒ เขียนบนจอว่าไม่รู้) */
  const [runs, setRuns] = useState(null);

  const load = useCallback(async () => {
    if (!selLine) { setDevices([]); setChecks({}); setRuns(null); setLoading(false); return; }
    setLoading(true);
    // กะนี้ไลน์นี้เปิดกะจริงไหม (DR · คนละ project) — ล้ม = "ไม่รู้" ห้ามแปลว่าไม่ได้ผลิต
    loadRunDays({ lineNames: [selLine], from: selDate, to: selDate }).then(setRuns);
    const { data: devs } = await supabase.from('pokayoke_devices').select('*').eq('line_name', selLine).order('sort').order('id');
    const list = devs || [];
    setDevices(list);
    if (list.length) {
      const { data: chk } = await supabase.from('pokayoke_checks')
        .select('*').in('device_id', list.map(d => d.id)).eq('check_date', selDate).eq('shift', selShift);
      const m = {}; (chk || []).forEach(c => { m[c.device_id] = c; });
      setChecks(m);
    } else setChecks({});
    setLoading(false);
  }, [selLine, selDate, selShift]);
  useEffect(() => { load(); }, [load]);

  /* 🔐 ชั้น ③ (19/11 · ออดิท check sheet) — `pokayoke:record/manage` บอกแค่ "กดเป็นไหม"
     ไม่ได้บอกว่า "อุปกรณ์ของไลน์นี้เป็นของหน่วยงานเราไหม" ⇒ เดิมเลือกไลน์ส่วนงานอื่นแล้วลงผล/แก้ทะเบียนได้
     · ต้นแบบเดียวกับ LPA · ตรวจข้อมูลจริงก่อนใส่ด่าน: 13 คู่ (ผู้บันทึก × ไลน์) ของ 1,296 ผลทดสอบ ผ่านหมด
     · เช็คที่ไลน์ของ "ตัวอุปกรณ์" ไม่ใช่ไลน์ที่เลือกบนจอ (ตัวเลือกบนจอเป็นตัวกรองการดู ไม่ใช่ด่าน) */
  const wCtx = { role, section: homeSection, sections: scopeSecs, allUnits, respCostCenters, scopeIdx };
  const lineWrite = canWriteLine(wCtx, selLine, lines);
  const lineGuard = (lineName, what) => {
    const w = canWriteLine(wCtx, lineName, lines);
    if (w.ok) return true;
    const sec = lines.find(l => l.name === lineName)?.section || '';
    toast.error(writeBlockText(w, { what: `${what}${tr("ของไลน์")} ${lineName}`, unit: sec }));
    return false;
  };

  /* 🚩 "ไม่ผ่าน" ต้องมีเหตุผล (23/11 · คำสั่ง user — ขยายจากใบตรวจ AM/PM)
     ทำไม: ปุ่มนี้ **กดครั้งเดียวเขียนฐานทันที** (upsert) ⇒ กดพลาดคือบันทึกไปแล้ว
     เคสเดียวกับที่หน้างานเจอกับใบตรวจ AM/PM (*"เกิดการกดผิดและพนักงานไม่รู้ตัว"*)
     🔴 กด "ไม่ผ่าน" แล้ว **ยังไม่เขียน** — เปิดช่องเหตุผลก่อน ต้องกดยืนยันถึงบันทึก
     🔴 ตัดสินด้วย `ngReasonCheck()` ตัวเดียวกับใบตรวจ ห้ามเขียนเกณฑ์ชุดที่ 2
        (`fail` ของจอนี้ = `ng` ของกฎนั้น) · "ผ่าน" ไม่บังคับเหมือนเดิม */
  const [pendFail, setPendFail] = useState({});   // deviceId → ข้อความเหตุผลที่กำลังพิมพ์
  const askFail = (d) => setPendFail(m => ({ ...m, [d.id]: checks[d.id]?.note || '' }));
  const dropFail = (id) => setPendFail(m => { const n = { ...m }; delete n[id]; return n; });

  // บันทึกผลทดสอบ 1 อุปกรณ์ (upsert)
  const saveCheck = async (device, patch) => {
    if (!canRecord) { toast.error('ไม่มีสิทธิ์บันทึก'); return; }
    if (!lineGuard(device.line_name, 'ผลทดสอบ Poka-Yoke ')) return;
    const prev = checks[device.id] || {};
    /* 🔴 ด่านตอนเขียนจริง ไม่ใช่แค่ซ่อนปุ่ม — ช่องหมายเหตุเดิมลบข้อความทิ้งได้ */
    {
      const willResult = patch.result ?? prev.result ?? 'pass';
      const willNote = patch.note ?? prev.note ?? '';
      const chk = ngReasonCheck({ attr: willResult === 'fail' ? 'ng' : 'ok', text: willNote });
      if (!chk.ok) {
        toast.error(`${device.code ? `${device.code} · ` : ''}${device.name}: ${chk.blockText}`);
        askFail(device);
        return;
      }
    }
    const { data: { user } } = await supabase.auth.getUser();
    const row = {
      device_id: device.id, check_date: selDate, shift: selShift,
      result: patch.result ?? prev.result ?? 'pass',
      detected: patch.detected ?? prev.detected ?? null,
      note: patch.note ?? prev.note ?? null,
      checker_name: checker || fullName || null,
      created_by: user?.id || null,
    };
    const { data, error } = await supabase.from('pokayoke_checks')
      .upsert(row, { onConflict: 'device_id,check_date,shift' }).select().single();
    if (error) { toast.error((tr('บันทึกไม่สำเร็จ') + ': ') + error.message); return; }
    setChecks(m => ({ ...m, [device.id]: data }));
    dropFail(device.id);
    /* 🔔 N3 (24/11 · คำสั่ง user): อุปกรณ์กันผิดพลาด "จับของเสียไม่ได้" = ของต้องสงสัยไหลต่อ ⇒ แจ้งทันที
       ผู้รับตามทะเบียน `pokayoke_fail` (supervisor + QA ของส่วนงานไลน์ · แก้ที่ /notification-config)
       · แจ้งเฉพาะตอนเปลี่ยนเป็น "ไม่ผ่าน" (บันทึกซ้ำ/แก้โน้ตของใบที่ไม่ผ่านอยู่แล้ว = ไม่ยิงซ้ำ) */
    if (row.result === 'fail' && prev.result !== 'fail') notifyEvent({
      event: 'pokayoke_fail', type: 'error', ref_table: 'pokayoke_checks', ref_id: data?.id,
      line_name: device.line_name, actor: row.checker_name || fullName,
      link: `/daily-checker?tab=pokayoke`,
      lines: [
        `🏭 ${tr("ไลน์")}: ${device.line_name} · ${selShift === 'night' ? tr('กะดึก') : tr('กะเช้า')} · 📅 ${selDate}`,
        `🛡️ ${device.code ? `${device.code} · ` : ''}${device.name}${device.station ? ` (${device.station})` : ''}`,
        `❌ ${tr("ทดสอบไม่ผ่าน")}: ${row.note || '-'}`,
      ],
    });
  };

  // ── ทะเบียนอุปกรณ์ ──
  const saveDevice = async () => {
    if (!dEditing.name?.trim()) { toast.error('กรอกชื่ออุปกรณ์'); return; }
    // ย้ายของต้องเช็ค 2 ฝั่ง: ไลน์เดิมของแถว (ต้นทาง) + ไลน์ที่กำลังจะเขียน (ปลายทาง)
    const orig = dEditing.id ? devices.find(x => x.id === dEditing.id) : null;
    if (orig && !lineGuard(orig.line_name, 'อุปกรณ์ Poka-Yoke ')) return;
    if (!lineGuard(dEditing.line_name || selLine, 'อุปกรณ์ Poka-Yoke ')) return;
    const row = {
      ...(dEditing.id ? { id: dEditing.id } : {}),
      line_name: dEditing.line_name || selLine,
      code: dEditing.code?.trim() || null, name: dEditing.name.trim(),
      station: dEditing.station?.trim() || null, test_method: dEditing.test_method?.trim() || null,
      master_ref: dEditing.master_ref?.trim() || null, sort: Number(dEditing.sort) || 0,
      is_active: dEditing.is_active !== false,
    };
    const { error } = await supabase.from('pokayoke_devices').upsert(row, { onConflict: 'id' });
    if (error) { toast.error((tr('บันทึกไม่สำเร็จ') + ': ') + error.message); return; }
    toast.success('บันทึกอุปกรณ์แล้ว'); setDEditing(null); load();
  };
  /* 🗑️ ลบอุปกรณ์ (19/11 · ออดิท check sheet ข้อ 3) — เดิม FK `on delete cascade` ⇒ ลบอุปกรณ์ =
     **ผลทดสอบย้อนหลังทั้งหมดหายถาวร** (หลักฐานการตรวจ error-proofing) ⇒
     · มีประวัติ = ห้ามลบ เสนอ "ปิดใช้งาน" แทน (`is_active=false` · หายจากใบตรวจ แต่ประวัติยังอยู่)
     · ไม่มีประวัติ (เพิ่มผิด) = ลบได้ · นับประวัติไม่ได้ = ห้ามลบ (fail-closed)
     · ฝั่ง DB เปลี่ยน FK เป็น `restrict` แล้ว (migration 20261119_pokayoke_checks_fk_restrict) = ตาข่ายชั้นสุดท้าย */
  const deleteDevice = async (d) => {
    if (!lineGuard(d.line_name, 'อุปกรณ์ Poka-Yoke ')) return;
    const { count, error: cErr } = await supabase.from('pokayoke_checks')
      .select('id', { count: 'exact', head: true }).eq('device_id', d.id);
    if (cErr || count == null) { toast.error(`${tr("นับประวัติผลทดสอบไม่สำเร็จ — ยังไม่ลบ")}${cErr ? `: ${cErr.message}` : ''}`); return; }
    if (count > 0) {
      if (!await askConfirm(`"${d.name}" ${tr("มีผลทดสอบย้อนหลัง")} ${count} ${tr("ครั้ง — ลบไม่ได้เพราะจะทำให้ประวัติการตรวจหาย\\n\\nปิดใช้งานแทนไหม? (หายจากใบตรวจ แต่ผลทดสอบย้อนหลังยังอยู่ครบ")})`)) return;
      if (!checkWriteRows(await supabase.from('pokayoke_devices').update({ is_active: false })
        .eq('id', d.id).select('id'), 'ปิดใช้งานอุปกรณ์')) return;
      toast.success(`${tr("ปิดใช้งาน")} "${d.name}" ${tr("แล้ว")}`); load(); return;
    }
    if (!await askConfirm(`${tr("ลบอุปกรณ์")} "${d.name}"? (${tr("ยังไม่มีผลทดสอบ")})`)) return;
    if (!checkWriteRows(await supabase.from('pokayoke_devices').delete().eq('id', d.id).select('id'), 'ลบอุปกรณ์')) return;
    load();
  };

  const ran = ranOn(runs, selDate, selShift);   // true ผลิต · false ไม่ผลิต · null ไม่รู้
  const activeDevs = devices.filter(d => d.is_active);
  const done = activeDevs.filter(d => checks[d.id]).length;
  const failN = activeDevs.filter(d => checks[d.id]?.result === 'fail').length;

  return (
    <Page>
      <PageHeader title="Poka-Yoke Check" icon="🛡️"
        sub={`${tr("ทดสอบ error-proofing ด้วยชิ้น master NG ทุกกะ — จับ NG ได้ = ผ่าน")} · ${tr(SHIFT_LABEL[selShift])}`} />

      {/* ตัวเลือก — UI-STANDARD 2026-09-24: FilterBar · กะ 2 ตัวเลือก = Segmented */}
      <FilterBar style={{ marginBottom: 12 }}>
        <span className="filter-label">{tr('ไลน์ / พื้นที่')}</span>
        {/* <LineSelect> — visibleLines กรอง scope แล้ว (ไม่มี option ว่าง เหมือนเดิม) · 2026-09-07 */}
        <LineSelect lines={visibleLines} value={selLine} onChange={setSelLine} placeholder={null} />
        <Segmented value={selShift} onChange={setSelShift} label={tr('กะ')}
          options={[{ value: 'day', label: tr(SHIFT_LABEL.day) }, { value: 'night', label: tr(SHIFT_LABEL.night) }]} />
        <span className="filter-label">{tr('วันที่')}</span>
        <input type="date" value={selDate} onChange={e => setSelDate(e.target.value)} />
        <span className="filter-label">{tr('ผู้ตรวจ')}</span>
        {/* <PersonSelect> profiles+employees ของไลน์ที่เลือกขึ้นก่อน · default = ชื่อผู้ใช้ · เก็บ snapshot checker_name เหมือนเดิม · 2026-09-07 */}
        <PersonSelect value={checker} source="both" lines={selFam} history={checkerHist} onChange={res => setChecker(res.name)} style={{ flex: '1 1 180px', maxWidth: 260 }} inputStyle={{ background: 'var(--bg)' }} />
        <span className="spacer" />
        {canManage && <button onClick={() => setDEditing({ line_name: selLine, name: '', is_active: true, sort: (Math.max(0, ...devices.map(d => d.sort || 0)) + 1) })} style={btnAccent}>{tr('เพิ่มอุปกรณ์')}</button>}
      </FilterBar>

      {(canRecord || canManage) && selLine && !lineWrite.ok && (
        <NoticeBar tone="warn" style={{ marginBottom: 10 }}>🔒 {writeBlockText(lineWrite, { what: `${tr("ใบ Poka-Yoke ของไลน์")} ${selLine}`, unit: lines.find(l => l.name === selLine)?.section || '' })}</NoticeBar>
      )}

      {/* 🔴 "ยังไม่ทดสอบ" กับ "กะนี้ไม่ได้ผลิต" คนละเรื่อง — ไม่บอก คนอ่านจะนับเป็นขาดตรวจทั้งที่ไลน์ไม่ได้เดิน
          (หลักเดียวกับ AM ที่แยก notStarted ออกจาก late มาตั้งแต่ 08/10 · utils/dailyCheckDay.js) */}
      {ran === false && (
        <div style={{ padding: '9px 13px', borderRadius: 'var(--r-md)', marginBottom: 10, fontSize: 12.5,
          background: 'rgba(148,163,184,0.10)', border: '1px solid var(--border)', color: 'var(--muted)' }}>
          ⚪ <b>{selLine}</b> {tr('ไม่ได้เปิดกะใน')} {tr(SHIFT_LABEL[selShift])} {tr('วันที่')} {selDate} — <b>{tr('ยังไม่ต้องทดสอบ')}</b> ·
          {tr("อุปกรณ์ที่ยังว่างอยู่ไม่นับเป็นขาดตรวจ")}
        </div>
      )}
      {ran == null && runs && (
        <NoticeBar tone="warn" style={{ marginBottom: 10 }}>
          {tr("อ่านข้อมูลการเปิดกะไม่สำเร็จ — บอกไม่ได้ว่ากะนี้ไลน์นี้เดินหรือไม่ ⇒ ที่ว่างอยู่อาจเป็น \"ไม่ได้ผลิต\" ไม่ใช่ \"ขาดตรวจ")}"
        </NoticeBar>
      )}

      {/* ✍️ 25/11 (คำสั่ง user "ทุกเอกสาร issued/checked/approved คุมด้วย e-workflow"): ใครเซ็น/ความถี่ไหน = ตั้งที่ /workflow-designer
          · เซ็นแล้ว = ผลทดสอบในรอบนั้นถูกล็อกฝั่ง DB (trigger) · แก้ = ผู้มีสิทธิ์กดเพิกถอนพร้อมเหตุผล */}
      <WfRoundPanel subject="pokayoke" line={selLine} date={selDate} shift={selShift}
        hasData={done > 0} summary={`${tr('ทดสอบแล้ว')} ${done}/${activeDevs.length}${failN ? ` · ${tr('ไม่ผ่าน')} ${failN}` : ''}`} />

      {/* สรุป */}
      {activeDevs.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10, fontSize: 12, fontWeight: 700 }}>
          <span style={chip('var(--text2)')}>{tr('ทดสอบแล้ว')} {done}/{activeDevs.length}</span>
          {failN > 0 && <span style={chip('var(--red)')}>{tr('❌ ไม่ผ่าน')} {failN}</span>}
          {done - failN > 0 && <span style={chip('var(--green)')}>{tr('✅ ผ่าน')} {done - failN}</span>}
          {done < activeDevs.length && <span style={chip('var(--amber)')}>{tr('รอทดสอบ')} {activeDevs.length - done}</span>}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>{tr('กำลังโหลด...')}</div>
      ) : activeDevs.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', background: 'var(--card-surf)', border: '1px dashed var(--border2)', borderRadius: 'var(--r-lg)' }}>
          {tr("ยังไม่มีอุปกรณ์ poka-yoke ของไลน์")} {selLine} — {canManage ? tr("กด \"➕ เพิ่มอุปกรณ์\"") : tr("ให้หัวหน้าลงทะเบียนอุปกรณ์ก่อน")}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {activeDevs.map(d => {
            const c = checks[d.id]; const res = c?.result;
            return (
              <div key={d.id} style={{ background: 'var(--card-surf)', border: `1px solid ${res === 'fail' ? 'var(--red)' : res === 'pass' ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 'var(--r-md)', padding: '10px 14px' }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{d.code ? `${d.code} · ` : ''}{d.name}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                      {d.station ? `📍 ${d.station}` : ''}{d.test_method ? ` · ${tr("วิธี")}: ${d.test_method}` : ''}{d.master_ref ? ` · master NG: ${d.master_ref}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button disabled={!canRecord} onClick={() => saveCheck(d, { result: 'pass', detected: true })}
                      style={resBtn(res === 'pass', 'var(--green)', canRecord)}>{tr('ผ่าน (จับ NG ได้)')}</button>
                    {/* 🚩 ไม่เขียนทันที — เปิดช่องเหตุผลก่อน (กดพลาด = ยังไม่บันทึก) */}
                    <button disabled={!canRecord} onClick={() => askFail(d)}
                      style={resBtn(res === 'fail', 'var(--red)', canRecord)}>{tr('ไม่ผ่าน')}</button>
                  </div>
                  {canManage && (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="tbtn" onClick={() => setDEditing({ ...d })} style={{ ...btnGray, padding: '4px 8px', fontSize: 12 }}>✏️</button>
                      <DeleteButton onClick={() => deleteDevice(d)} title={tr('ลบ')} />
                    </div>
                  )}
                </div>
                {/* 🚩 แถว "ยืนยันไม่ผ่าน" — โผล่หลังกดปุ่มไม่ผ่าน · ยังไม่เขียนฐานจนกว่าจะกดยืนยัน (23/11) */}
                {pendFail[d.id] != null && (
                  <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input autoFocus value={pendFail[d.id]}
                      onChange={e => setPendFail(m => ({ ...m, [d.id]: e.target.value }))}
                      placeholder={tr('เหตุผลที่ไม่ผ่าน (บังคับ) — เจออะไร / ทำอะไรต่อ')}
                      disabled={!canRecord}
                      style={{ flex: 1, minWidth: 220, fontSize: 12, borderColor: pendFail[d.id].trim() ? undefined : 'var(--amber)' }} />
                    <button type="button" disabled={!canRecord || !pendFail[d.id].trim()}
                      onClick={() => saveCheck(d, { result: 'fail', detected: false, note: pendFail[d.id].trim() })}
                      style={{ ...btnAccent, padding: '5px 12px', fontSize: 12,
                               ...(pendFail[d.id].trim() ? null : { opacity: 0.5, cursor: 'not-allowed' }) }}>
                      {tr('ยืนยันไม่ผ่าน')}
                    </button>
                    <button type="button" onClick={() => dropFail(d.id)} style={{ ...btnGray, padding: '5px 12px', fontSize: 12 }}>{tr('ยกเลิก')}</button>
                  </div>
                )}
                {res && (
                  <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input placeholder={tr('หมายเหตุ / การแก้ไข (ถ้าไม่ผ่าน)')} defaultValue={c?.note || ''}
                      onBlur={e => { if ((e.target.value || '') !== (c?.note || '')) saveCheck(d, { note: e.target.value }); }}
                      disabled={!canRecord} style={{ flex: 1, minWidth: 200, fontSize: 12 }} />
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>{tr('ผู้ตรวจ:')} {c?.checker_name || '—'}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* modal ทะเบียนอุปกรณ์ */}
      {dEditing && (
        <div className="modal-scroll" style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', WebkitBackdropFilter: 'var(--scrim-blur)', backdropFilter: 'var(--scrim-blur)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }}>
          <div style={{ background: 'var(--card-surf)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 18, width: 'min(96vw, 560px)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{dEditing.id ? tr("✏️ แก้ไข") : tr("➕ เพิ่ม")}{tr('อุปกรณ์ Poka-Yoke —')} {dEditing.line_name}</div>
              <button onClick={() => setDEditing(null)} style={{ background: 'none', border: 'none', fontSize: 20, color: 'var(--muted)', cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 10 }}>
                <div><div style={lb}>{tr('รหัส')}</div><input value={dEditing.code || ''} onChange={e => setDEditing(p => ({ ...p, code: e.target.value }))} style={{ width: '100%' }} /></div>
                <div><div style={lb}>{tr('ชื่อ/หน้าที่ *')}</div><input value={dEditing.name || ''} onChange={e => setDEditing(p => ({ ...p, name: e.target.value }))} style={{ width: '100%' }} /></div>
              </div>
              <div><div style={lb}>{tr('จุดงาน/ตำแหน่ง')}</div>
                {/* เลือกจาก workstations ของไลน์ (ทะเบียนสถานี) — "ระบุเอง" เฉพาะอุปกรณ์ที่ไม่อยู่ประจำสถานี · ค่าเก่าที่ไม่ตรงทะเบียนโชว์ในโหมดระบุเอง · 2026-09-07 */}
                <SelectOrFree value={dEditing.station || ''} options={stations} placeholder={tr('— ไม่ระบุสถานี —')} freeLabel={tr("✏️ ระบุเอง (ไม่อยู่ประจำสถานี)")} freePlaceholder={tr("ระบุเอง (อุปกรณ์ที่ไม่ได้อยู่ประจำสถานี)")}
                  onChange={v => setDEditing(p => ({ ...p, station: v }))} style={{ width: '100%' }} />
              </div>
              <div><div style={lb}>{tr('วิธีทดสอบ')}</div><input value={dEditing.test_method || ''} onChange={e => setDEditing(p => ({ ...p, test_method: e.target.value }))} style={{ width: '100%' }} placeholder={tr('เช่น ใส่ชิ้น NG แล้วเครื่องต้อง alarm/ไม่ปล่อยผ่าน')} /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: 10 }}>
                <div><div style={lb}>{tr('ชิ้น master NG ที่ใช้')}</div><input value={dEditing.master_ref || ''} onChange={e => setDEditing(p => ({ ...p, master_ref: e.target.value }))} style={{ width: '100%' }} /></div>
                <div><div style={lb}>{tr('ลำดับ')}</div><input type="number" value={dEditing.sort ?? 0} onChange={e => setDEditing(p => ({ ...p, sort: e.target.value }))} style={{ width: '100%' }} /></div>
              </div>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, color: 'var(--text2)' }}>
                <input type="checkbox" checked={dEditing.is_active !== false} onChange={e => setDEditing(p => ({ ...p, is_active: e.target.checked }))} style={{ width: 'auto' }} /> {tr('ใช้งาน')}
              </label>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                <button onClick={() => setDEditing(null)} style={btnGray}>{tr('ยกเลิก')}</button>
                <button onClick={saveDevice} style={btnAccent}>{tr('บันทึก')}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}

const lb = { fontSize: 11, color: 'var(--muted)', marginBottom: 3, fontWeight: 600 };
const chip = (c) => ({ display: 'inline-flex', alignItems: 'center', gap: 5, color: c, background: `${tint(c, 'dim')}`, border: `1px solid ${tint(c, 'line')}`, padding: '3px 10px', borderRadius: 20 });
const btnAccent = { padding: '9px 16px', borderRadius: 9, fontSize: 13, fontWeight: 800, cursor: 'pointer', background: 'var(--accent)', color: 'var(--accent-ink)', border: 'none' };
const btnGray = { padding: '9px 14px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer', background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border2)' };
const resBtn = (on, color, enabled) => ({
  padding: '7px 12px', borderRadius: 8, fontSize: 12.5, fontWeight: 800, cursor: enabled ? 'pointer' : 'not-allowed',
  border: `1px solid ${on ? color : 'var(--border2)'}`, background: on ? color : 'var(--bg3)', color: on ? '#fff' : 'var(--text2)', opacity: enabled ? 1 : 0.5,
});
