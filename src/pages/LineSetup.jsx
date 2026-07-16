import { useState, useEffect, useRef, useMemo, useContext } from 'react';
import imageCompression from 'browser-image-compression';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { can } from '../utils/permissions';
import { inSectionScope } from '../utils/sectionScope';
import { markerScale } from '../utils/markerScale';
import { toast } from '../components/Toast';

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

export default function LineSetup() {
  // สิทธิ์แก้ไข — role ที่ไม่มี line_setup:edit เห็นหน้าแบบอ่านอย่างเดียว (ดูผัง/รายการได้ แก้ไม่ได้)
  const { role, sections: scopeSecs = [] } = useContext(UserContext);
  const canEdit = can('line_setup', 'edit', role);
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
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [collisionWarn, setCollisionWarn] = useState(null); // string message หรือ null
  const [showManpower, setShowManpower] = useState(false);
  const [skillDefs, setSkillDefs] = useState([]);
  const [sectionOpts, setSectionOpts] = useState([]);
  const [activeTab, setActiveTab] = useState('stations'); // 'stations' | 'wip' | 'machines'
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
  const [drProducts, setDrProducts] = useState([]);
  const [containerTypes, setContainerTypes] = useState([]);
  const emptyWipForm = { id: null, point_type: 'material', point_name: '', mat_no: '', material_category: '', packaging_no: '', packaging_type: '', min_qty: 0, max_qty: 0, current_qty: 0 };
  const [wipForm, setWipForm] = useState(emptyWipForm);

  // จุดเครื่องจักรบนผัง (ผูกกับตาราง machines ของ Daily Report โปรเจกต์ ด้วย machine_no)
  const [machinePoints, setMachinePoints] = useState([]);
  const [machineTempPos, setMachineTempPos] = useState(null);
  const [machineForm, setMachineForm] = useState({ id: null, machine_no: '', redundancy_group: '' });
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
  const [mpSaving, setMpSaving] = useState(false);

  // ผู้บันทึก/อนุมัติ ประจำส่วนงาน (ใช้ดึงอัตโนมัติในใบค่าฝีมือ)
  const [signerHead,    setSignerHead]    = useState('');
  const [signerManager, setSignerManager] = useState('');
  const [signerTA,       setSignerTA]      = useState('');
  const [signerHRM,      setSignerHRM]     = useState('');
  const [signersSaving, setSignersSaving] = useState(false);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  const skillAllowanceTypes = useMemo(() => [...new Set(skillDefs.filter(sd => sd.category === 'allowance_skill' && sd.allowance_type).map(sd => sd.allowance_type))].sort(), [skillDefs]);

  // ตัวเลือก Section จำกัดตามขอบเขตส่วนงานของ user (scope ว่าง = เลือกได้ทุกส่วน)
  const sectionOptsInScope = scopeSecs.length ? sectionOpts.filter(s => inSectionScope(scopeSecs, s)) : sectionOpts;

  const fetchLines = async () => {
    const { data } = await supabase.from('production_lines').select('id, name, section, std_day_shift, std_night_shift, cost_center, head_name, parent_line_name').order('name');
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
    const { data: drMt } = await supabaseDR.from('machine_types').select('*').order('sort_order');
    setMachineTypes(drMt || []);
    const { data: drPd } = await supabaseDR.from('dr_products').select('mat_no, name').eq('line_name', selectedLine).eq('is_active', true).not('mat_no', 'is', null).order('mat_no');
    setDrProducts(drPd || []);
    // ภาชนะ — ดึงจาก container_types (supabaseDR) ตารางกลางเดียวกับ Packaging/Rack Center
    const { data: ctData } = await supabaseDR.from('container_types').select('code, name, category').eq('is_active', true).order('code');
    setContainerTypes(ctData || []);
    const lineObj = lines.find(l => l.name === selectedLine);
    if (lineObj) {
      setStdDay(lineObj.std_day_shift ?? 0);
      setStdNight(lineObj.std_night_shift ?? 0);
      setCostCenter(lineObj.cost_center ?? '');
      setSignerHead(lineObj.head_name ?? '');
      if (lineObj.section) {
        const { data: signers } = await supabase.from('section_signers').select('*').eq('section', lineObj.section).maybeSingle();
        setSignerManager(signers?.manager_name || '');
        setSignerTA(signers?.ta_name || '');
        setSignerHRM(signers?.hrm_name || '');
      } else {
        setSignerManager(''); setSignerTA(''); setSignerHRM('');
      }
    }
  };

  const handleSaveSigners = async () => {
    const lineObj = lines.find(l => l.name === selectedLine);
    if (!lineObj?.section) return toast.error('ไลน์นี้ยังไม่ได้กำหนดส่วนงาน (section)');
    setSignersSaving(true);
    const { error } = await supabase.from('section_signers').upsert({
      section: lineObj.section,
      manager_name: signerManager || null,
      ta_name: signerTA || null,
      hrm_name: signerHRM || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'section' });
    if (error) toast.error('Error: ' + error.message);
    setSignersSaving(false);
  };

  const handleSaveStdManpower = async () => {
    const lineObj = lines.find(l => l.name === selectedLine);
    if (!lineObj) return;
    setMpSaving(true);
    const { error } = await supabase
      .from('production_lines')
      .update({ std_day_shift: parseInt(stdDay) || 0, std_night_shift: parseInt(stdNight) || 0, cost_center: costCenter || null, head_name: signerHead || null })
      .eq('id', lineObj.id);
    if (error) toast.error('Error: ' + error.message);
    else await fetchLines();
    setMpSaving(false);
  };

  const handleUpdateParent = async (line, parentName) => {
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
    await supabase.from('workstations').delete().eq('line_name', line.name);
    await supabase.from('line_layouts').delete().eq('line_name', line.name);
    // ลบเฉพาะไฟล์ของไลน์นี้เอง — ข้ามถ้าไลน์อื่น (เช่นไลน์แม่/ลูกที่ยืมผัง) ยังชี้ URL เดียวกันอยู่
    if (delLayout?.image_url?.includes('/employee-photos/layouts/')) {
      const { data: sharers } = await supabase.from('line_layouts').select('line_name').eq('image_url', delLayout.image_url).limit(1);
      if (!sharers?.length) {
        const oldName = decodeURIComponent(delLayout.image_url.split('/employee-photos/')[1] || '');
        if (oldName.startsWith('layouts/')) supabase.storage.from('employee-photos').remove([oldName]).catch(() => {});
      }
    }
    await supabase.from('employees').update({ line_id: null }).eq('line_id', line.id);
    await supabase.from('production_lines').delete().eq('id', line.id);
    const remaining = lines.filter(l => l.id !== line.id);
    setLines(remaining);
    if (selectedLine === line.name) {
      const next = remaining[0]?.name || '';
      setSelectedLine(next);
      if (!next) { setLayoutImage(null); setStations([]); }
    }
  };

  const handleUpdateSection = async (line, section) => {
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
    // Cascade to map/station tables
    await supabase.from('workstations').update({ line_name: name }).eq('line_name', old);
    await supabase.from('line_layouts').update({ line_name: name }).eq('line_name', old);
    await supabase.from('wip_buffer_points').update({ line_name: name }).eq('line_name', old);
    await supabase.from('machine_points').update({ line_name: name }).eq('line_name', old);
    await supabase.from('machine_flow_links').update({ line_name: name }).eq('line_name', old);
    // DR project: machines table
    await supabaseDR.from('machines').update({ line_name: name }).eq('line_name', old);
    setEditingLineId(null);
    if (selectedLine === old) setSelectedLine(name);
    await fetchLines();
  };

  const handleUploadImage = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      setIsUploading(true);
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
      await supabase.from('line_layouts').upsert({ line_name: selectedLine, image_url: data.publicUrl }, { onConflict: 'line_name' });
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
    toast.success(`🔔 เรียกเติม "${p.point_name}" แล้ว — ดูสถานะได้ที่ Heijunka Kanban → ตู้ Kanban รวม → 🔄 WIP Point`);
  };

  /* ── จุดเครื่องจักร ── */
  const editMachinePoint = (p) => {
    setMachineTempPos(null);
    setMachineForm({ id: p.id, machine_no: p.machine_no, redundancy_group: p.redundancy_group || '' });
  };

  const handleSaveMachine = async () => {
    if (!machineForm.machine_no) return toast.error('กรุณาเลือกเครื่องจักร');
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
    const { error } = await supabase.from('machine_flow_links').insert([{
      line_name: selectedLine, from_machine_point_id: connectFrom, to_machine_point_id: id,
    }]);
    if (error) return toast.error('Error: ' + error.message);
    fetchLineData();
  };

  const deleteFlowLink = async (id) => {
    if (!window.confirm('ยืนยันการลบเส้นเชื่อมต่อนี้?')) return;
    const { error } = await supabase.from('machine_flow_links').delete().eq('id', id);
    if (!error) fetchLineData();
  };

  // ขนาดหมุดวงกลมบนผัง — ใช้สูตรกลาง markerScale (src/utils/markerScale.js) ตัวเดียวกับหน้าแสดงผล
  // เพื่อให้ WYSIWYG: ขนาดหมุด + พฤติกรรมป้ายชื่อตอนจัดผัง ตรงกับที่ Management/Dashboard แสดงจริงเป๊ะ
  // MK = จุดงานหลัก · SUB = หมุดรอง (เครื่องจักร/WIP) ย่อตามความแน่น
  const { MK, SUB, pillFont: PILL_FONT, subPillFont, badgeFont, pillMaxW, subPillMaxW } =
    markerScale(imgBox?.rw, { machineCount: machinePoints.length });
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
    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 12, height: isMobile ? 'auto' : 'calc(100vh - 40px)' }}>
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
          <button
            onClick={() => setShowPills(v => !v)}
            title={'แสดง/ซ่อนป้ายชื่อทุกจุดบนผัง (เหมือนหน้าแสดงผลจริง)\nหมุดที่กำลังเลือก/แก้ไขโชว์ป้ายเสมอ'}
            style={{
              padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
              marginLeft: 'auto',
              border: `1px solid ${showPills ? 'var(--accent)' : 'var(--border2)'}`,
              background: showPills ? 'var(--accent-dim)' : 'var(--bg2)',
              color: showPills ? 'var(--accent)' : 'var(--text2)',
            }}>
            {showPills ? '🏷️ ซ่อนป้าย' : '🏷️ โชว์ป้าย'}
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={labelSt}>ไลน์ผลิต ({lines.length})</span>
          </div>
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
              return ordered.map(l => (
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
                  {l._isParent && <span style={{ fontSize: 11, color: 'var(--accent)', flexShrink: 0 }}>▼</span>}
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
                      <button onClick={(e) => { e.stopPropagation(); handleDeleteLine(l); }}
                        style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 13, padding: '0 2px', lineHeight: 1, flexShrink: 0 }}
                        title="ลบไลน์">🗑️</button>
                    </>
                  )}
                </div>
              ));
            })()}
            {lines.length === 0 && (
              <div style={{ textAlign: 'center', padding: '12px 0', color: 'var(--muted)', fontSize: 12 }}>ยังไม่มีไลน์ผลิต</div>
            )}
          </div>
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
              {lines.filter(l => !l.parent_line_name).map(l => (
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
            <label style={{ fontSize: 12, color: 'var(--blue)', cursor: 'pointer', display: 'block', marginBottom: 14, textAlign: 'right' }}>
              {isUploading ? 'อัปโหลด...' : '🔄 เปลี่ยนรูปภาพ'}
              <input type="file" hidden onChange={handleUploadImage} disabled={isUploading} />
            </label>
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
          <div style={{ flex: 1, minHeight: showManpower ? 120 : 260, overflowY: 'auto' }}>
            {stations.map(st => {
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
                  {canEdit && <button onClick={() => deleteStation(st.id)} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>🗑️</button>}
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
                      <select value={wipForm.material_category}
                        onChange={e => setWipForm({ ...wipForm, material_category: e.target.value })}>
                        <option value="">-- ประเภทวัสดุ (200/300/500) --</option>
                        <option value="200">200</option>
                        <option value="300">300</option>
                        <option value="500">500</option>
                      </select>
                      <input list="dr-mat-no-list" placeholder="เลขที่วัสดุ (mat no.) — พิมพ์เพื่อค้นจาก Product Master" value={wipForm.mat_no}
                        onChange={e => setWipForm({ ...wipForm, mat_no: e.target.value })} />
                      <datalist id="dr-mat-no-list">
                        {drProducts.map(p => (
                          <option key={p.mat_no} value={p.mat_no}>{p.name}</option>
                        ))}
                      </datalist>
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
              <div style={{ flex: 1, minHeight: 260, overflowY: 'auto' }}>
                {wipPoints.map(p => {
                  const isLow = (p.current_qty ?? 0) < (p.min_qty ?? 0);
                  return (
                    <div key={p.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div onClick={() => canEdit && editWipPoint(p)} style={{ cursor: canEdit ? 'pointer' : 'default', flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>
                          {p.point_type === 'packaging' ? '📦' : '🧱'} {p.point_name} {isLow && <span style={{ fontSize: 11, background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>⚠️ ต่ำกว่า min</span>}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                          {p.point_type === 'packaging'
                            ? `${p.packaging_type ? `${p.packaging_type} · ` : ''}${p.packaging_no ? `${p.packaging_no} · ` : ''}`
                            : `${p.material_category ? `cat.${p.material_category} · ` : ''}${p.mat_no ? `${p.mat_no} · ` : ''}`}
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
                        {canEdit && <button onClick={() => deleteWipPoint(p.id)} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>🗑️</button>}
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
                  <select value={machineForm.machine_no}
                    onChange={e => setMachineForm({ ...machineForm, machine_no: e.target.value })}>
                    <option value="">-- เลือกเครื่องจักร --</option>
                    {drMachines.filter(m => m.is_active && !m.machine_type_id).map(m => (
                      <option key={m.id} value={m.machine_no}>{m.machine_no} {m.machine_name ? `- ${m.machine_name}` : ''}</option>
                    ))}
                    {machineTypes.map(t => {
                      const items = drMachines.filter(m => m.is_active && m.machine_type_id === t.id);
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
                  {drMachines.filter(m => m.is_active).length === 0 && (
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>ยังไม่มีเครื่องจักรในทะเบียนของไลน์นี้ — เพิ่มได้ที่ 🏭 ฐานข้อมูลเครื่องจักร ด้านบน</div>
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
              <div style={{ flex: 1, minHeight: 260, overflowY: 'auto' }}>
                {machinePoints.map(p => {
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
                      {canEdit && <button onClick={() => deleteMachinePoint(p.id)} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>🗑️</button>}
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
                      padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                      border: `1px solid ${connectMode ? '#f97316' : 'var(--border2)'}`,
                      background: connectMode ? 'rgba(249,115,22,0.18)' : 'var(--bg2)',
                      color: connectMode ? '#f97316' : 'var(--text2)',
                    }}>
                    {connectMode ? '✓ กำลังเชื่อม' : '🔗 เชื่อมต่อ'}
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
                        {canEdit && <button onClick={() => deleteFlowLink(link.id)} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 14 }}>🗑️</button>}
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
              👥 Standard Manpower
            </h4>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{showManpower ? '▲ ซ่อน' : '▼ แสดง'}</span>
          </button>
          {showManpower && (
          <div style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 10, padding: 14 }}>
            <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
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
            <div style={{ marginBottom: 12 }}>
              <label style={labelSt}>🏷️ Cost Center</label>
              <input type="text" value={costCenter} disabled={!canEdit}
                onChange={e => setCostCenter(e.target.value)}
                placeholder="เช่น 2140662201"
                style={{ marginTop: 4, fontSize: 14, fontWeight: 600 }} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={labelSt}>👨‍🔧 หัวหน้างาน (ประจำไลน์นี้)</label>
              <input type="text" value={signerHead} disabled={!canEdit}
                onChange={e => setSignerHead(e.target.value)}
                placeholder="เช่น คุณสุวิทชัย ดีทั่ว"
                style={{ marginTop: 4 }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                รวม <strong style={{ color: 'var(--text)' }}>{(parseInt(stdDay) || 0) + (parseInt(stdNight) || 0)}</strong> คน
              </span>
              {canEdit && (
              <button onClick={handleSaveStdManpower} disabled={mpSaving}
                style={{ padding: '7px 18px', background: mpSaving ? 'var(--muted)' : 'var(--accent)', color: '#fff', border: 'none', borderRadius: 7, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                {mpSaving ? 'กำลังบันทึก...' : '💾 บันทึก'}
              </button>
              )}
            </div>
          </div>
          )}

          {/* ── ผู้บันทึก/อนุมัติ ประจำส่วนงาน ─────────────────── */}
          <div style={{ borderTop: '1px solid var(--border)', margin: '14px 0 12px' }} />
          <h4 style={{ margin: '0 0 10px', color: 'var(--text)', fontSize: 14, fontFamily: 'var(--font-display)' }}>
            ✍️ ผู้อนุมัติ ประจำส่วนงาน {lines.find(l => l.name === selectedLine)?.section ? `(${lines.find(l => l.name === selectedLine)?.section})` : ''}
          </h4>
          {lines.find(l => l.name === selectedLine)?.section ? (
            <div style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 10, padding: 14 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>
                ใช้ดึงอัตโนมัติในใบสรุปค่าฝีมือ — กรอกครั้งเดียวต่อส่วนงาน ใช้ร่วมกันทุกไลน์ในส่วนนี้ (หัวหน้างานแยกตามไลน์ ตั้งค่าด้านบนในช่อง Standard Manpower)
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
                <div>
                  <label style={labelSt}>ผู้จัดการต้นสังกัด</label>
                  <input type="text" value={signerManager} disabled={!canEdit} onChange={e => setSignerManager(e.target.value)} style={{ marginTop: 4 }} />
                </div>
                <div>
                  <label style={labelSt}>เจ้าหน้าที่ TA</label>
                  <input type="text" value={signerTA} disabled={!canEdit} onChange={e => setSignerTA(e.target.value)} style={{ marginTop: 4 }} />
                </div>
                <div>
                  <label style={labelSt}>ผู้จัดการส่วน HRM</label>
                  <input type="text" value={signerHRM} disabled={!canEdit} onChange={e => setSignerHRM(e.target.value)} style={{ marginTop: 4 }} />
                </div>
              </div>
              {canEdit && (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button onClick={handleSaveSigners} disabled={signersSaving}
                  style={{ padding: '7px 18px', background: signersSaving ? 'var(--muted)' : 'var(--accent)', color: '#fff', border: 'none', borderRadius: 7, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                  {signersSaving ? 'กำลังบันทึก...' : '💾 บันทึก'}
                </button>
              </div>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: 'var(--muted)', padding: '8px 0' }}>
              ไลน์นี้ยังไม่ได้กำหนดส่วนงาน (section) — กำหนดในหน้ารายการไลน์ก่อนเพื่อบันทึกผู้อนุมัติ
            </div>
          )}

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

const uploadBtnSt = {
  display: 'inline-block', padding: '10px 20px',
  background: 'var(--accent)', color: '#fff',
  borderRadius: 8, cursor: 'pointer', fontSize: 14
};
