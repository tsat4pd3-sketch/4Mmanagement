import { useState, useEffect, useContext } from 'react';
import { Link } from 'react-router-dom';
import { orgNodeCompare } from '../utils/listOrder';
import { useObjectUrl } from '../utils/useObjectUrl';
import { supabase } from '../supabaseClient';
import { loadLinesRes } from '../utils/useProductionLines';
import { UserContext } from '../App';
import { can } from '../utils/permissions';
import {
  inSectionScope, ORPHAN_SECTION, ORPHAN_SECTION_LABEL,
  orphanDepts, deptOptionsFor, deptNodeFor,
} from '../utils/sectionScope';
/* 🪪 ตัวตนพนักงานใหม่ประกอบที่ utils ที่เดียว — ทางเข้าอีกทางคือโมดัลแก้ผู้ใช้ใน /add-user
   (เดิมหน้านี้ไม่เขียน `staff_kind` เลย ⇒ QA/วิศวกร/ธุรการ ถูกนับเป็นกำลังคนหน้าไลน์เงียบๆ · audit 26/10) */
import { newEmployeeRow, staffKindHint } from '../utils/employeeIdentity';
import { STAFF_KINDS, STAFF_SHOPFLOOR, SUPPORT_VALUES } from '../utils/staffKind';
import { checkWrite } from '../utils/dbWrite';
import { positionOptionsWith } from '../utils/positions';
import ImageCropModal from '../components/ImageCropModal';
import { toast } from '../components/Toast';
import { filterLinesByDept } from '../utils/lineHierarchy';
import { lineOptions, lineOptionLabel, groupLineOptions } from '../components/LineSelect';
import { uploadOpts } from '../utils/storageUpload';
import PageHeader from '../components/PageHeader';
import Page from '../components/Page';

export default function Register() {
  const { role, lineId: userLineId, sections: scopeSecs = [] } = useContext(UserContext);
  const canRegister = can('employees', 'register', role);
  const isLeader     = role === 'leader';

  const [empCode,     setEmpCode]     = useState('');
  const [name,        setName]        = useState('');
  const [position,    setPosition]    = useState('');
  const [department,  setDepartment]  = useState('');
  const [section,     setSection]     = useState('');
  const [groupName,   setGroupName]   = useState('');
  const [lineId,      setLineId]      = useState(null);
  const [team,        setTeam]        = useState('');
  const [staffKind,   setStaffKind]   = useState(STAFF_SHOPFLOOR);   // 👥 หน้างาน / ช่าง / สายสนับสนุน
  const [startDate,   setStartDate]   = useState('');
  const [photo,       setPhoto]       = useState(null);
  const photoPreview = useObjectUrl(photo);   // blob URL สร้างครั้งเดียวต่อไฟล์ + revoke เอง (ห้าม createObjectURL ใน render)
  const [cropFile,    setCropFile]    = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [lines,       setLines]       = useState([]);
  const [busRoutes,   setBusRoutes]   = useState([]);
  const [busRouteId,  setBusRouteId]  = useState('');
  const [orgSections, setOrgSections] = useState([]);
  const [orgDepts,    setOrgDepts]    = useState([]);
  const [orgLines,    setOrgLines]    = useState([]); // org groups (kind='line') + ref_line_id
  const [teamOpts,    setTeamOpts]    = useState([]);

  useEffect(() => {
    loadLinesRes()
      .then(({ data }) => {
        setLines(data || []);
        if (scopeSecs.length === 1) {
          setSection(scopeSecs[0]);
        } else if (isLeader && userLineId) {
          // leader ไม่มี profiles.section — ล็อกส่วนงานจาก section ของไลน์ที่ตัวเองผูกอยู่
          const myLine = (data || []).find(l => l.id === userLineId);
          if (myLine?.section) setSection(myLine.section);
        }
      });
    supabase.from('bus_routes').select('id, code, name').eq('is_active', true).order('sort_order')
      .then(({ data }) => setBusRoutes(data || []));
    supabase.from('org_nodes').select('id, code, name, kind, parent_id, ref_line_id, sort_order').eq('is_active', true)
      .then(({ data }) => {
        const nodes = [...(data || [])].sort(orgNodeCompare);   // ลำดับผังมาตรฐาน (listOrder.js)
        setOrgSections(nodes.filter(n => n.kind === 'section'));
        setOrgDepts(nodes.filter(n => n.kind === 'department'));
        setOrgLines(nodes.filter(n => n.kind === 'line'));
        const teamCodes = [...new Set(nodes.filter(n => n.kind === 'team').map(n => n.code || n.name))];
        setTeamOpts(teamCodes);
      });
  }, []);

  // ส่วนงานที่ถูกล็อก: scope เหลือ section เดียว (supervisor เดิม) = ล็อกเลย, leader = section ของไลน์ที่ผูกอยู่
  // ('' = ไม่ล็อก — ไม่มี scope เลือกอิสระ / scope หลาย section เลือกได้เฉพาะใน scope)
  const leaderSection = isLeader && userLineId ? (lines.find(l => l.id === userLineId)?.section || '') : '';
  const lockedSection = scopeSecs.length === 1 ? scopeSecs[0] : leaderSection;
  const sectionOptsInScope = scopeSecs.length
    ? orgSections.filter(s => inSectionScope(scopeSecs, s.code || s.name))
    : orgSections;

  // แผนกขึ้นตรงฝ่าย (MTN/JIG MTN/DIE MTN/QA) เลือกได้ผ่าน sentinel ในช่อง Section — ดู sectionScope.js
  //   เห็นเฉพาะ user ที่ไม่ถูกจำกัด scope (หัวหน้าราย section ลงทะเบียนคนนอกส่วนงานตัวเองไม่ได้)
  const orphanDeptOpts = orphanDepts(orgDepts);
  const showOrphanOpt  = !scopeSecs.length && orphanDeptOpts.length > 0;
  const isOrphanSec    = section === ORPHAN_SECTION;
  const isSupportKind  = SUPPORT_VALUES.includes(staffKind);   // 👥 สายสนับสนุน = ไม่ผูกไลน์/ทีม

  const deptOpts = deptOptionsFor(section, orgSections, orgDepts);
  // กลุ่ม (org_nodes kind='line') ใต้แผนกที่เลือก — cascade จากผังองค์กร
  const selectedDeptNode = deptNodeFor(section, department, orgSections, orgDepts);
  const orgGroupOpts = selectedDeptNode ? orgLines.filter(g => g.parent_id === selectedDeptNode.id) : [];

  const handleRegister = async (e) => {
    e.preventDefault();
    // ด่านชั้นสอง — ปุ่ม disabled อย่างเดียวไม่พอ (ฟอร์มอาจค้างอยู่ตอนสิทธิ์เปลี่ยน · Enter ในช่องกรอกก็ submit ได้)
    if (!canRegister) return toast.error('บัญชีของคุณไม่มีสิทธิ์ลงทะเบียนพนักงาน');
    setIsUploading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;
      if (!userId) { toast.error('กรุณา Login ก่อนเพิ่มพนักงาน'); setIsUploading(false); return; }

      let photoUrl = null;
      if (photo) {
        const fileExt = photo.name.split('.').pop();
        const fileName = `${Date.now()}.${fileExt}`;
        const { error: uploadError } = await supabase.storage.from('employee-photos').upload(fileName, photo, uploadOpts());
        if (uploadError) throw uploadError;
        const { data: pub } = supabase.storage.from('employee-photos').getPublicUrl(fileName);
        photoUrl = pub.publicUrl;
      }

      const row = newEmployeeRow({
        employeeIdCode: empCode, name, position, department, section,
        orgSections, orgDepts,
        staffKind, groupName, team, lineId, busRouteId, startDate,
        imageUrl: photoUrl, createdBy: userId,
      });
      if (!checkWrite(await supabase.from('employees').insert([row]), 'เพิ่มพนักงานใหม่')) {
        setIsUploading(false);
        return;
      }

      toast.success('เพิ่มพนักงานสำเร็จ!');
      setEmpCode(''); setName(''); setPosition(''); setDepartment('');
      setSection(lockedSection || '');
      setGroupName(''); setLineId(null); setBusRouteId('');
      setTeam(''); setStartDate(''); setPhoto(null); setStaffKind(STAFF_SHOPFLOOR);
      document.getElementById('photo-upload').value = '';
    } catch (err) {
      toast.error('เกิดข้อผิดพลาด: ' + err.message);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    /* ชิดซ้าย-บนเหมือนหน้าอื่น (เดิมจัดกลางจอ ⇒ ชื่อหน้าเริ่มคนละตำแหน่ง — UI-STANDARD §1)
       🔴 `form` (960px) ไม่ใช่ `narrow` (640px) — 26/10: ฟอร์มนี้มี 10 ช่อง + 3 แถวสองคอลัมน์
       พอตรึง 640 แล้วชิดซ้าย กลายเป็นเสาผอมเกาะขอบ เหลือที่ว่างขวาค่อนจอ (feedback user)
       `narrow` มีไว้สำหรับกล่องสั้นจริงๆ (login/ยืนยัน) ไม่ใช่ฟอร์มกรอกข้อมูล */
    <Page width="form">
      <PageHeader title="เพิ่มพนักงานใหม่" icon="📸" sub="บันทึกข้อมูลพนักงานเข้าระบบ" />
      {/* 🔴 การ์ดต้องเต็มคอลัมน์ของ <Page width="form"> (960px) — ห้ามตั้ง maxWidth ซ้อนอีกชั้น (14/10)
          เดิมตรึง 440px ไว้ตั้งแต่ยุคที่หน้านี้จัดกลางจอ ⇒ พอเปลี่ยนเป็นชิดซ้าย กลายเป็น
          ฟอร์มผอมเกาะขอบซ้าย เหลือที่ว่างขวาค่อนจอ · ช่อง 2 คอลัมน์แคบจนป้ายล้น
          · กล่อง = `.card` ของกลาง (เงา `--shadow-sm` · UI §6.20 — `--shadow-lg` เป็นของ modal) */}
      <div className="card" style={{ width: '100%', padding: '28px 26px' }}>


        <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelSt}>รหัสพนักงาน</label>
              <input type="text" placeholder="เช่น EMP001" value={empCode} onChange={e => setEmpCode(e.target.value)} required />
            </div>
            <div>
              <label style={labelSt}>ชื่อ - นามสกุล</label>
              <input type="text" placeholder="ชื่อเต็มของพนักงาน" value={name} onChange={e => setName(e.target.value)} required />
            </div>
          </div>

          {/* 👥 ประเภทพนักงาน — ชุดเดียวกับโมดัลเพิ่มคนใน /add-user (ป้าย/คำอธิบายมาจาก staffKind.js)
              🔴 เดิมหน้านี้ไม่มีช่องนี้ ⇒ ทุกคนที่ลงทะเบียนทางนี้ตกไปที่ default 'shopfloor'
                 = QA/วิศวกร/ธุรการ ถูกนับเป็นกำลังคนหน้าไลน์เงียบๆ (audit 26/10) */}
          <div>
            <label style={labelSt}>ประเภทพนักงาน</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {STAFF_KINDS.map(k => (
                <button key={k.key} type="button" onClick={() => setStaffKind(k.key)}
                  style={{ flex: '1 1 190px', width: 'auto', textAlign: 'left', cursor: 'pointer', padding: '7px 10px', borderRadius: 8, fontSize: 12,
                    border: `1px solid ${staffKind === k.key ? 'var(--accent)' : 'var(--border2)'}`,
                    background: staffKind === k.key ? 'rgba(34,197,94,0.10)' : 'var(--bg2)',
                    color: staffKind === k.key ? 'var(--text)' : 'var(--text2)' }}>
                  <div style={{ fontWeight: 700 }}>{k.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{k.desc}</div>
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{staffKindHint(staffKind)}</div>
          </div>

          <div>
            <label style={labelSt}>วันเริ่มงาน</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          </div>

          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelSt}>ตำแหน่งงาน</label>
              {/* ตำแหน่งงาน — master list กลาง (src/utils/positions.js) ใช้ร่วมทุกหน้า */}
              <select value={position} onChange={e => setPosition(e.target.value)}>
                <option value="">— เลือก —</option>
                {positionOptionsWith(position).map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelSt}>Section / ส่วน</label>
              {lockedSection ? (
                <input type="text" value={lockedSection} disabled style={{ opacity: 0.6, cursor: 'not-allowed' }} />
              ) : (
                <select value={section} onChange={e => { setSection(e.target.value); setDepartment(''); setGroupName(''); setLineId(null); }}>
                  <option value="">— เลือก —</option>
                  {sectionOptsInScope.map(s => <option key={s.id} value={s.code || s.name}>{s.name}</option>)}
                  {showOrphanOpt && <option value={ORPHAN_SECTION}>{ORPHAN_SECTION_LABEL}</option>}
                </select>
              )}
            </div>
          </div>

          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelSt}>Department / แผนก</label>
              <select value={department} onChange={e => { setDepartment(e.target.value); setGroupName(''); setLineId(null); }} disabled={!section}>
                <option value="">{section ? '— เลือก —' : 'เลือก Section ก่อน'}</option>
                {deptOpts.map(d => <option key={d.id} value={d.code || d.name}>{d.name}</option>)}
              </select>
              {isOrphanSec && (
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, lineHeight: 1.4 }}>
                  หน่วยงานขึ้นตรงฝ่าย — ไม่มี Section · Group/Line เว้นว่างได้
                </div>
              )}
              {/* 🔴 เลือก Section แล้วแต่ dropdown แผนกว่าง = ส่วนงานนั้นยังไม่มีแผนกในผังองค์กร
                  (เคสจริง 2026-08-24: `Planning&Store` มี 0 แผนก · ผังมีแผนกแค่ใต้ PD1-4 + 4 แผนกขึ้นตรงฝ่าย)
                  เดิมปล่อยว่างเงียบ → คนกรอกนึกว่าระบบพัง ต้องบอกว่าติดตรงไหนและไปแก้ที่ไหน */}
              {!isOrphanSec && section && deptOpts.length === 0 && (
                <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 4, lineHeight: 1.5 }}>
                  ⚠️ ส่วนงาน <b>{section}</b> ยังไม่มีแผนกในผังองค์กร — เลือกแผนกไม่ได้จนกว่าจะเพิ่มก่อน
                  <div style={{ color: 'var(--muted)' }}>เพิ่มที่ <b>ตั้งค่า → ผังองค์กร (/org-setup)</b></div>
                </div>
              )}
            </div>
            <div>
              <label style={labelSt}>Team / กะ</label>
              {/* 🔴 สายสนับสนุน = ไม่ผูกไลน์/ทีม — `newEmployeeRow()` ตัดเป็น null ให้อยู่แล้ว
                  ช่องจึงต้องปิดด้วย ไม่งั้นจอสัญญาอย่าง ฐานเก็บอีกอย่าง */}
              <select value={isSupportKind ? '' : team} disabled={isSupportKind}
                onChange={e => setTeam(e.target.value)}
                style={isSupportKind ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}>
                <option value="">{isSupportKind ? '— สายสนับสนุนไม่ผูกทีม —' : '— เลือก —'}</option>
                {teamOpts.map(t => <option key={t} value={t}>Team {t}</option>)}
              </select>
            </div>
          </div>

          {/* 🔴 แถวสองคอลัมน์ — ที่กรอบ 960px ช่อง select เดี่ยวจะยืดเป็น 850px (stdsweep 26/10)
              ช่องเลือกที่กว้างเกิน ~420px อ่านยาก (ตาต้องกวาดจากป้ายไปค่าไกลมาก) */}
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'start' }}>
          <div>
            <label style={labelSt}>Group / กลุ่ม (Line)</label>
            {isSupportKind ? (
              <div style={{ fontSize: 12, color: 'var(--muted)', border: '1px dashed var(--border2)', borderRadius: 8, padding: '8px 10px', lineHeight: 1.5 }}>
                สายสนับสนุนไม่ผูกกลุ่ม/ไลน์ผลิต — สังกัดอยู่ที่ <b>ส่วนงาน + แผนก</b> ข้างบนแทน
              </div>
            ) : (() => {
              // cascade Section→แผนก→กลุ่ม (UI-CONVENTIONS §5.3): กลุ่มจากผังองค์กร (org_nodes kind='line') ใต้แผนกที่เลือก
              //   ตั้ง line_id ผ่าน ref_line_id ของกลุ่ม (production ยังทำงาน) · ผังยังไม่มีกลุ่ม → fallback production_lines
              if (orgGroupOpts.length) {
                /* 🔴 เก็บ "ชื่อกลุ่ม" ไม่ใช่ `code || name` — ต้องตรงกับ /operator (06/10)
                     `org_nodes(kind='line').code` บางตัวเป็นคนละสตริงกับชื่อ (ของจริง:
                     ASSEMBLY 1 → code 'Assembly Line D1' · GWM → code 'Assembly Line D2')
                     ⇒ เดิมคนที่ลงทะเบียนใหม่ได้ `group_name='Assembly Line D1'` ขณะที่เพื่อน
                       ร่วมกลุ่ม 35 คนเป็น 'ASSEMBLY 1' = แยกกันคนละกลุ่มในทุกตัวกรอง
                       และ /operator โชว์ว่า "(นอกผัง — ค่าเดิม)"
                   🔴 กลุ่มที่ยังไม่ผูกไลน์ผลิต (`ref_line_id` ว่าง) ⇒ line_id = null
                     = พนักงานใหม่ **ไม่ขึ้นหน้าเช็คชื่อ** ต้องเตือนตรงนี้ ห้ามเงียบ
                     (เคสจริง 05/10: PD2 ตั้งแผนก+กลุ่มครบแล้วแต่เช็คชื่อว่าง 35 คน) */
                const curNode = orgGroupOpts.find(g => g.name === groupName || g.code === groupName);
                const noRef = orgGroupOpts.filter(g => !g.ref_line_id);
                return (
                  <>
                  <select value={curNode ? curNode.name : groupName} disabled={!department} onChange={e => {
                    const val = e.target.value;
                    setGroupName(val);
                    const g = orgGroupOpts.find(x => x.name === val || x.code === val);
                    setLineId(g?.ref_line_id || null);
                  }}>
                    <option value="">{department ? '— เลือกกลุ่ม —' : 'เลือกแผนกก่อน'}</option>
                    {orgGroupOpts.map(g => (
                      <option key={g.id} value={g.name}>{g.name}{g.ref_line_id ? '' : '  ⚠ ยังไม่ผูกไลน์'}</option>
                    ))}
                  </select>
                  {curNode && !curNode.ref_line_id && (
                    <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 4, lineHeight: 1.45 }}>
                      ⚠️ กลุ่ม <b>{curNode.name}</b> ยังไม่ได้ผูกกับไลน์ผลิตจริง — บันทึกได้ แต่พนักงานคนนี้
                      <b> จะไม่ขึ้นในหน้าเช็คชื่อ</b> · ผูกไลน์ให้กลุ่มนี้ที่{' '}
                      <Link to="/org-setup" style={{ color: '#f59e0b', fontWeight: 700 }}>ผังองค์กร</Link> ก่อน
                    </div>
                  )}
                  {!curNode && noRef.length > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, lineHeight: 1.45 }}>
                      ⚠ {noRef.length} กลุ่มในลิสต์นี้ยังไม่ผูกไลน์ผลิต — เลือกแล้วคนจะไม่ขึ้นหน้าเช็คชื่อ
                    </div>
                  )}
                  </>
                );
              }
              // แผนกขึ้นตรงฝ่ายไม่มี section ให้กรอง — ปล่อยดูทุกไลน์แล้วให้ filterLinesByDept คัดตามแผนก
              const secFilter = isOrphanSec ? '' : (lockedSection || section);
              let lineOpts = secFilter ? lines.filter(l => l.section === secFilter) : lines;
              lineOpts = filterLinesByDept(lineOpts, department);
              return (
                <select value={groupName} disabled={!department} onChange={e => {
                  const val = e.target.value;
                  setGroupName(val);
                  const line = lines.find(l => l.name === val);
                  setLineId(line?.id || null);
                }}>
                  <option value="">{department ? '— เลือก Line —' : 'เลือกแผนกก่อน'}</option>
                  {(() => {
                    // ลำดับ+หัวกลุ่มส่วนงานชุดเดียวกับ <LineSelect> (2026-10-01)
                    const { pinned, groups } = groupLineOptions(lineOptions(lineOpts, { current: groupName }));
                    const opt = o => <option key={o.value} value={o.value}>{lineOptionLabel(o)}</option>;
                    return [...pinned.map(opt), ...groups.map(g => g.label
                      ? <optgroup key={g.label} label={`📁 ${g.label}`}>{g.options.map(opt)}</optgroup>
                      : g.options.map(opt))];
                  })()}
                </select>
              );
            })()}
          </div>

          <div>
            <label style={labelSt}>🚐 สายรถรับส่ง (สำหรับจองรถ OT)</label>
            <select value={busRouteId} onChange={e => setBusRouteId(e.target.value)}>
              <option value="">— ไม่ระบุ —</option>
              {busRoutes.map(r => <option key={r.id} value={r.id}>{r.code} {r.name}</option>)}
            </select>
          </div>
          </div>

          <div>
            <label style={labelSt}>รูปถ่าย (ถ้ามี)</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {photoPreview && <img loading="lazy" src={photoPreview} alt="" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: '50%', border: '1px solid var(--border)' }} />}
              <input id="photo-upload" type="file" accept="image/*" onChange={e => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) setCropFile(f);
              }} />
            </div>
          </div>
          {cropFile && (
            <ImageCropModal file={cropFile} aspect={1} shape="circle" outputSize={480}
              title="จัดตำแหน่งรูปพนักงานให้ตรงกรอบ" allowGif={false} webp
              onCancel={() => setCropFile(null)}
              onConfirm={f => { setPhoto(f); setCropFile(null); }} />
          )}

          <button
            type="submit"
            disabled={isUploading || !canRegister}
            title={canRegister ? undefined : 'บัญชีของคุณไม่มีสิทธิ์ลงทะเบียนพนักงาน'}
            style={{
              marginTop: 4, padding: '13px',
              background: (isUploading || !canRegister) ? 'var(--muted)' : 'var(--accent)',
              color: '#fff', border: 'none', borderRadius: 8,
              fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15,
            }}
          >
            {isUploading ? 'กำลังบันทึก...' : canRegister ? 'บันทึกข้อมูลพนักงาน' : '🔒 ไม่มีสิทธิ์ลงทะเบียนพนักงาน'}
          </button>
        </form>
      </div>
    </Page>
  );
}

const labelSt = {
  display: 'block', fontSize: 12, fontWeight: 600,
  color: 'var(--text2)', marginBottom: 6,
  letterSpacing: '0.05em', textTransform: 'uppercase',
};
