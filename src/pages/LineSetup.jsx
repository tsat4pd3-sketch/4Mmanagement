import { useState, useEffect, useRef } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';

const TABS = [
  { key: 'stations', label: '📍 จุดงาน' },
  { key: 'wip',      label: '📦 จุด WIP' },
  { key: 'machines', label: '⚙️ เครื่องจักร' },
];

const SKILL_ALLOWANCE_TYPES = ['งานเชื่อม', 'งานขับรถฟอล์คลิฟท์', 'งานขับเครน'];

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
  const [lines, setLines] = useState([]);
  const [selectedLine, setSelectedLine] = useState('');
  const [newLineName, setNewLineName] = useState('');
  const [newLineSection, setNewLineSection] = useState('');
  const [isAddingLine, setIsAddingLine] = useState(false);
  const [layoutImage, setLayoutImage] = useState(null);
  const [stations, setStations] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [tempPos, setTempPos] = useState(null);
  const [formData, setFormData] = useState({ id: null, name: '', requirements: {}, skill_allowance: false, skill_allowance_type: '' });
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [collisionWarn, setCollisionWarn] = useState(null); // string message หรือ null
  const [showManpower, setShowManpower] = useState(false);
  const [skillDefs, setSkillDefs] = useState([]);
  const [activeTab, setActiveTab] = useState('stations'); // 'stations' | 'wip' | 'machines'

  // ลากย้ายจุดที่มีอยู่แล้วได้ (ไม่ต้องลบสร้างใหม่) — drag เกินระยะนิดเดียวถือเป็นการลาก ไม่ใช่คลิกแก้ไข
  const imgRef = useRef(null);
  const [dragInfo, setDragInfo] = useState(null); // { kind: 'station'|'wip'|'machine', id }
  const [dragPos, setDragPos] = useState(null);   // { top, left } พรีวิวระหว่างลาก
  const dragMovedRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const dragPosRef = useRef(null);

  // จุด WIP buffer (min/max ต่อจุด — แผนกที่เกี่ยวข้องเห็นเมื่อของต่ำกว่า min)
  // 2 ประเภท: material (เรียกงานจากสโตร์ ผูกกับ mat no. จาก Product Master) และ
  // packaging (เรียกภาชนะเปล่าจาก Tact Center — rack/box/basket แยกด้วย packaging no.)
  const [wipPoints, setWipPoints] = useState([]);
  const [wipTempPos, setWipTempPos] = useState(null);
  const [drProducts, setDrProducts] = useState([]);
  const emptyWipForm = { id: null, point_type: 'material', point_name: '', mat_no: '', material_category: '', packaging_no: '', packaging_type: '', min_qty: 0, max_qty: 0, current_qty: 0 };
  const [wipForm, setWipForm] = useState(emptyWipForm);

  // จุดเครื่องจักรบนผัง (ผูกกับตาราง machines ของ Daily Report โปรเจกต์ ด้วย machine_no)
  const [machinePoints, setMachinePoints] = useState([]);
  const [machineTempPos, setMachineTempPos] = useState(null);
  const [machineForm, setMachineForm] = useState({ id: null, machine_no: '' });
  const [drMachines, setDrMachines] = useState([]);

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

  const fetchLines = async () => {
    const { data } = await supabase.from('production_lines').select('id, name, section, std_day_shift, std_night_shift, cost_center, head_name').order('name');
    setLines(data || []);
    if (data?.length > 0 && !selectedLine) setSelectedLine(data[0].name);
  };

  useEffect(() => {
    fetchLines();
    supabase.from('skill_definitions').select('*').order('sort_order').then(({ data }) => setSkillDefs(data || []));
  }, []);

  useEffect(() => {
    if (selectedLine) fetchLineData();
  }, [selectedLine]);

  const fetchLineData = async () => {
    const { data: layoutData } = await supabase.from('line_layouts').select('*').eq('line_name', selectedLine).single();
    setLayoutImage(layoutData?.image_url || null);
    const { data: stationData } = await supabase.from('workstations').select('*, station_requirements(*)').eq('line_name', selectedLine);
    setStations(stationData || []);
    const { data: wipData } = await supabase.from('wip_buffer_points').select('*').eq('line_name', selectedLine).order('point_name');
    setWipPoints(wipData || []);
    const { data: mpData } = await supabase.from('machine_points').select('*').eq('line_name', selectedLine);
    setMachinePoints(mpData || []);
    const { data: drMc } = await supabaseDR.from('machines').select('id, machine_no, machine_name').eq('line_name', selectedLine).eq('is_active', true).order('sort_order');
    setDrMachines(drMc || []);
    const { data: drPd } = await supabaseDR.from('dr_products').select('mat_no, name').eq('line_name', selectedLine).eq('is_active', true).not('mat_no', 'is', null).order('mat_no');
    setDrProducts(drPd || []);
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
    if (!lineObj?.section) return alert('ไลน์นี้ยังไม่ได้กำหนดส่วนงาน (section)');
    setSignersSaving(true);
    const { error } = await supabase.from('section_signers').upsert({
      section: lineObj.section,
      manager_name: signerManager || null,
      ta_name: signerTA || null,
      hrm_name: signerHRM || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'section' });
    if (error) alert('Error: ' + error.message);
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
    if (error) alert('Error: ' + error.message);
    else await fetchLines();
    setMpSaving(false);
  };

  const handleAddLine = async () => {
    const name = newLineName.trim();
    if (!name) return;
    setIsAddingLine(true);
    const { error } = await supabase.from('production_lines').insert([{ name, section: newLineSection || null }]);
    if (error) { alert('Error: ' + error.message); }
    else {
      setNewLineName('');
      setNewLineSection('');
      await fetchLines();
      setSelectedLine(name);
    }
    setIsAddingLine(false);
  };

  const handleDeleteLine = async (line) => {
    if (!window.confirm(`ลบไลน์ "${line.name}" ?\n\nจุดงานและผังไลน์ทั้งหมดในไลน์นี้จะถูกลบด้วย`)) return;
    await supabase.from('workstations').delete().eq('line_name', line.name);
    await supabase.from('line_layouts').delete().eq('line_name', line.name);
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

  const handleUploadImage = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      setIsUploading(true);
      const fileExt = file.name.split('.').pop();
      const safeLineName = selectedLine.replace(/[^a-zA-Z0-9]/g, '_');
      const fileName = `layout_${safeLineName}_${Date.now()}.${fileExt}`;
      const { error: uploadError } = await supabase.storage.from('employee-photos').upload(`layouts/${fileName}`, file);
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from('employee-photos').getPublicUrl(`layouts/${fileName}`);
      await supabase.from('line_layouts').upsert({ line_name: selectedLine, image_url: data.publicUrl }, { onConflict: 'line_name' });
      setLayoutImage(data.publicUrl);
    } catch (error) { alert('Error: ' + error.message); }
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

  const startDrag = (e, kind, id) => {
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
      const pos = { top: `${((y / rect.height) * 100).toFixed(2)}%`, left: `${((x / rect.width) * 100).toFixed(2)}%` };
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
        if (kind === 'machine') { const p = machinePoints.find(s => s.id === id); if (p) editMachinePoint(p); }
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

    const x = (clampedX / rect.width) * 100;
    const y = (clampedY / rect.height) * 100;
    const pos = { top: `${y.toFixed(2)}%`, left: `${x.toFixed(2)}%` };
    const newXpx = (x / 100) * rect.width;
    const newYpx = (y / 100) * rect.height;

    const checkCollision = (points, w, h) => {
      const PAD_X = w + 8;
      const PAD_Y = h + 8;
      return points.some(p => {
        const pX = (parseFloat(p.pos_left) / 100) * rect.width;
        const pY = (parseFloat(p.pos_top) / 100) * rect.height;
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
      setMachineForm({ id: null, machine_no: '' });
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
    if (!formData.name) return alert('กรุณาระบุชื่อจุดงาน');
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
      if (error) return alert('Error: ' + error.message);
    } else {
      const { data, error } = await supabase.from('workstations').insert([payload]).select().single();
      if (error) return alert('Error: ' + error.message);
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
    if (!wipForm.point_name) return alert('กรุณาระบุชื่อจุด WIP');
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
    if (error) return alert('Error: ' + error.message);
    fetchLineData();
    setWipTempPos(null);
    setWipForm(emptyWipForm);
  };

  const deleteWipPoint = async (id) => {
    if (!window.confirm('ยืนยันการลบจุด WIP นี้?')) return;
    const { error } = await supabase.from('wip_buffer_points').delete().eq('id', id);
    if (!error) fetchLineData();
  };

  /* ── จุดเครื่องจักร ── */
  const editMachinePoint = (p) => {
    setMachineTempPos(null);
    setMachineForm({ id: p.id, machine_no: p.machine_no });
  };

  const handleSaveMachine = async () => {
    if (!machineForm.machine_no) return alert('กรุณาเลือกเครื่องจักร');
    const existing = machinePoints.find(p => p.id === machineForm.id);
    const payload = {
      line_name:   selectedLine,
      machine_no:  machineForm.machine_no,
      pos_top:     machineTempPos ? machineTempPos.top : existing?.pos_top,
      pos_left:    machineTempPos ? machineTempPos.left : existing?.pos_left,
    };
    const { error } = machineForm.id
      ? await supabase.from('machine_points').update(payload).eq('id', machineForm.id)
      : await supabase.from('machine_points').insert([payload]);
    if (error) return alert('Error: ' + error.message);
    fetchLineData();
    setMachineTempPos(null);
    setMachineForm({ id: null, machine_no: '' });
  };

  const deleteMachinePoint = async (id) => {
    if (!window.confirm('ยืนยันการลบจุดเครื่องจักรนี้?')) return;
    const { error } = await supabase.from('machine_points').delete().eq('id', id);
    if (!error) fetchLineData();
  };

  return (
    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 12, height: isMobile ? 'auto' : 'calc(100vh - 40px)' }}>
      {selectedLine && (
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {TABS.map(t => (
            <button key={t.key}
              onClick={() => { setActiveTab(t.key); setTempPos(null); setWipTempPos(null); setMachineTempPos(null); }}
              style={{
                padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                border: `1px solid ${activeTab === t.key ? 'var(--accent)' : 'var(--border2)'}`,
                background: activeTab === t.key ? 'var(--accent-dim)' : 'var(--bg2)',
                color: activeTab === t.key ? 'var(--accent)' : 'var(--text2)',
              }}>
              {t.label}
            </button>
          ))}
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
              <img
                ref={imgRef}
                src={layoutImage}
                onClick={handleImageClick}
                draggable={false}
                style={{ width: '100%', height: '100%', objectFit: 'contain', cursor: 'crosshair', display: 'block' }}
              />
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
                      width: CARD_W, height: CARD_H,
                      border: isSelected ? '2px solid var(--green)' : '2px solid rgba(255,255,255,0.75)',
                      borderRadius: 10,
                      backgroundColor: isSelected ? 'rgba(34,197,94,0.18)' : 'rgba(0,0,0,0.82)',
                      backdropFilter: 'blur(2px)',
                      boxShadow: isDragging ? '0 0 10px rgba(61,214,92,0.7)' : isSelected ? '0 0 8px rgba(34,197,94,0.5)' : '0 2px 6px rgba(0,0,0,0.6)',
                      cursor: isDragging ? 'grabbing' : 'grab', display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center',
                      padding: '4px 4px 2px', zIndex: isDragging ? 15 : 5, opacity: isDragging ? 0.85 : 1,
                    }}
                    title="คลิกเพื่อแก้ไข — ลากเพื่อย้ายตำแหน่ง"
                  >
                    <div style={{ fontSize: 12, fontWeight: 700, color: isSelected ? 'var(--green)' : '#e0e0e0', textAlign: 'center', width: '100%', padding: '0 2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {st.station_name}
                    </div>
                    {st.skill_allowance && <div style={{ fontSize: 9, color: '#22c55e', fontWeight: 800, lineHeight: '14px', textAlign: 'center' }}>💰 {st.skill_allowance_type || ''}</div>}
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
                      <div style={{ color: isSelected ? 'rgba(34,197,94,0.5)' : 'rgba(255,255,255,0.25)', fontSize: 20, lineHeight: '24px' }}>+</div>
                    </div>
                  </div>
                );
              })}
              {activeTab === 'stations' && tempPos && (
                <div style={{
                  position: 'absolute', top: tempPos.top, left: tempPos.left, transform: 'translate(-50%, -50%)',
                  width: CARD_W, height: CARD_H,
                  border: '1px dashed var(--accent)', backgroundColor: 'rgba(61,214,92,0.1)',
                  zIndex: 10, pointerEvents: 'none', borderRadius: 8,
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
                    title="คลิกเพื่อแก้ไข — ลากเพื่อย้ายตำแหน่ง"
                    style={{
                      position: 'absolute', top, left, transform: 'translate(-50%, -50%)',
                      width: POINT_W, height: POINT_H,
                      border: isSelected ? '2px solid var(--green)' : isLow ? '2px solid #ef4444' : '2px solid rgba(255,255,255,0.75)',
                      borderRadius: 7,
                      backgroundColor: isLow ? 'rgba(239,68,68,0.25)' : 'rgba(0,0,0,0.82)',
                      backdropFilter: 'blur(2px)',
                      boxShadow: isDragging ? '0 0 10px rgba(61,214,92,0.7)' : isLow ? '0 0 8px rgba(239,68,68,0.6)' : '0 2px 6px rgba(0,0,0,0.6)',
                      cursor: isDragging ? 'grabbing' : 'grab', display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center',
                      padding: '2px 2px 1px', zIndex: isDragging ? 15 : 5, opacity: isDragging ? 0.85 : 1,
                    }}
                  >
                    <div style={{ fontSize: 8, fontWeight: 700, color: isLow ? '#fecaca' : '#e0e0e0', textAlign: 'center', width: '100%', padding: '0 1px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      📦 {p.point_name}
                    </div>
                    <div style={{ fontSize: 7, color: isLow ? '#fca5a5' : '#a3a3a3', textAlign: 'center' }}>
                      {p.current_qty ?? 0}/{p.min_qty ?? 0}–{p.max_qty ?? 0}
                    </div>
                    {isLow && <div style={{ fontSize: 7, color: '#fca5a5', fontWeight: 800 }}>⚠️ ต่ำ</div>}
                  </div>
                );
              })}
              {activeTab === 'wip' && wipTempPos && (
                <div style={{
                  position: 'absolute', top: wipTempPos.top, left: wipTempPos.left, transform: 'translate(-50%, -50%)',
                  width: POINT_W, height: POINT_H,
                  border: '1px dashed var(--accent)', backgroundColor: 'rgba(61,214,92,0.1)',
                  zIndex: 10, pointerEvents: 'none', borderRadius: 6,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <div style={{ color: 'var(--accent)', fontSize: 12 }}>+</div>
                </div>
              )}

              {activeTab === 'machines' && machinePoints.map(p => {
                const isSelected = machineForm.id === p.id;
                const mc = drMachines.find(m => m.machine_no === p.machine_no);
                const isDragging = dragInfo?.kind === 'machine' && dragInfo.id === p.id;
                const top = isDragging && dragPos ? dragPos.top : p.pos_top;
                const left = isDragging && dragPos ? dragPos.left : p.pos_left;
                return (
                  <div
                    key={p.id}
                    onMouseDown={(e) => startDrag(e, 'machine', p.id)}
                    title="คลิกเพื่อแก้ไข — ลากเพื่อย้ายตำแหน่ง"
                    style={{
                      position: 'absolute', top, left, transform: 'translate(-50%, -50%)',
                      width: POINT_W, height: POINT_H,
                      border: isSelected ? '2px solid var(--green)' : '2px solid rgba(255,255,255,0.75)',
                      borderRadius: 7,
                      backgroundColor: isSelected ? 'rgba(34,197,94,0.18)' : 'rgba(0,0,0,0.82)',
                      backdropFilter: 'blur(2px)',
                      boxShadow: isDragging ? '0 0 10px rgba(61,214,92,0.7)' : isSelected ? '0 0 8px rgba(34,197,94,0.5)' : '0 2px 6px rgba(0,0,0,0.6)',
                      cursor: isDragging ? 'grabbing' : 'grab', display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center',
                      padding: '2px 2px 1px', zIndex: isDragging ? 15 : 5, opacity: isDragging ? 0.85 : 1,
                    }}
                  >
                    <div style={{ fontSize: 8, fontWeight: 700, color: isSelected ? 'var(--green)' : '#e0e0e0', textAlign: 'center', width: '100%', padding: '0 1px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      ⚙️ {p.machine_no}
                    </div>
                    <div style={{ fontSize: 7, color: '#a3a3a3', textAlign: 'center', width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {mc?.machine_name || ''}
                    </div>
                  </div>
                );
              })}
              {activeTab === 'machines' && machineTempPos && (
                <div style={{
                  position: 'absolute', top: machineTempPos.top, left: machineTempPos.left, transform: 'translate(-50%, -50%)',
                  width: POINT_W, height: POINT_H,
                  border: '1px dashed var(--accent)', backgroundColor: 'rgba(61,214,92,0.1)',
                  zIndex: 10, pointerEvents: 'none', borderRadius: 6,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <div style={{ color: 'var(--accent)', fontSize: 12 }}>+</div>
                </div>
              )}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: 20 }}>
              <p style={{ color: 'var(--muted)', marginBottom: 12 }}>ยังไม่มีรูปผังไลน์ {selectedLine}</p>
              <label style={uploadBtnSt}>
                {isUploading ? 'อัปโหลด...' : '➕ อัปโหลดรูป'}
                <input type="file" hidden onChange={handleUploadImage} disabled={isUploading} />
              </label>
            </div>
          )
        ) : (
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>เพิ่มไลน์ผลิตก่อน</p>
        )}
      </div>

      <div style={{
        width: isMobile ? '100%' : 320,
        background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14,
        padding: 18, overflowY: 'auto', display: 'flex', flexDirection: 'column', flexShrink: 0
      }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={labelSt}>ไลน์ผลิต ({lines.length})</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
            {lines.map(l => (
              <div key={l.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                  background: selectedLine === l.name ? 'var(--accent-dim)' : 'var(--bg2)',
                  border: `1px solid ${selectedLine === l.name ? 'var(--accent)' : 'var(--border)'}`,
                  transition: 'background 0.15s, border-color 0.15s',
                }}
                onClick={() => { setSelectedLine(l.name); setTempPos(null); setFormData({ id: null, name: '', requirements: {} }); }}
              >
                  <span style={{ fontSize: 13, flex: 1, color: selectedLine === l.name ? 'var(--accent)' : 'var(--text)', fontWeight: selectedLine === l.name ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {l.name}
                  </span>
                  <select
                    value={l.section || ''}
                    onClick={e => e.stopPropagation()}
                    onChange={e => { e.stopPropagation(); handleUpdateSection(l, e.target.value); }}
                    style={{ fontSize: 11, padding: '2px 4px', borderRadius: 5, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text2)', cursor: 'pointer', width: 'auto', flexShrink: 0 }}
                  >
                    <option value="">Section</option>
                    {['PD1','PD2','PD3','PD4'].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <button onClick={(e) => { e.stopPropagation(); handleDeleteLine(l); }}
                    style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 13, padding: '0 2px', lineHeight: 1, flexShrink: 0 }}
                    title="ลบไลน์">🗑️</button>
              </div>
            ))}
            {lines.length === 0 && (
              <div style={{ textAlign: 'center', padding: '12px 0', color: 'var(--muted)', fontSize: 12 }}>ยังไม่มีไลน์ผลิต</div>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <input placeholder="ชื่อไลน์ใหม่ เช่น ไลน์ F" value={newLineName}
                onChange={e => setNewLineName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddLine()}
                style={{ flex: 1, fontSize: 13, padding: '8px 10px' }} />
              <select value={newLineSection} onChange={e => setNewLineSection(e.target.value)}
                style={{ fontSize: 12, padding: '8px 8px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text2)', flexShrink: 0, width: 'auto' }}>
                <option value="">Section</option>
                {['PD1','PD2','PD3','PD4'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <button onClick={handleAddLine} disabled={isAddingLine || !newLineName.trim()}
              style={{ padding: '8px 12px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13 }}>
              {isAddingLine ? '...' : '+ เพิ่มไลน์'}
            </button>
          </div>
        </div>

        {selectedLine && <>
          {layoutImage && (
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
                            <span style={{ fontSize: 10, fontWeight: 800, color: catMeta.color, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{catMeta.icon} {catMeta.label}</span>
                            {catMeta.desc && <span style={{ fontSize: 9, color: catMeta.color, opacity: 0.7 }}>{catMeta.desc}</span>}
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
                                      <span style={{ fontSize: 10, color: 'var(--muted)' }}>%</span>
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
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>พนักงานที่ถูก assign จุดนี้จะได้ค่าฝีมือรายวัน</div>
                  </div>
                </label>
                {formData.skill_allowance && (
                  <div style={{ marginTop: 8 }}>
                    <label style={labelSt}>ประเภทค่าฝีมือ</label>
                    <select value={formData.skill_allowance_type}
                      onChange={e => setFormData({ ...formData, skill_allowance_type: e.target.value })}
                      style={{ marginTop: 4, width: '100%' }}>
                      <option value="">-- เลือกประเภท --</option>
                      {SKILL_ALLOWANCE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
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
                คลิกบนรูปภาพเพื่อเพิ่มจุดงาน<br />หรือคลิกที่จุดเดิมเพื่อแก้ไข
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
                  <div onClick={() => editStation(st)} style={{ cursor: 'pointer', flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 5 }}>
                      {st.station_name}
                      {st.skill_allowance && <span style={{ fontSize: 10, background: 'rgba(34,197,94,0.15)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>💰 ค่าฝีมือ{st.skill_allowance_type ? ` (${st.skill_allowance_type})` : ''}</span>}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                      {reqs.length > 0
                        ? reqs.map(r => {
                            const def = skillDefs.find(d => d.name === r.skill_name);
                            return `${def?.label || r.skill_name} ≥${r.min_score}%`;
                          }).join(', ')
                        : 'ไม่มีสกิลที่กำหนด'}
                    </div>
                  </div>
                  <button onClick={() => deleteStation(st.id)} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>🗑️</button>
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
                        <option value="">-- ประเภทภาชนะ --</option>
                        <option value="rack">Rack</option>
                        <option value="box">Box</option>
                        <option value="basket">Basket</option>
                      </select>
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
                  คลิกบนรูปภาพเพื่อเพิ่มจุด WIP<br />หรือคลิกที่จุดเดิมเพื่อแก้ไข
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
                      <div onClick={() => editWipPoint(p)} style={{ cursor: 'pointer', flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>
                          {p.point_type === 'packaging' ? '📦' : '🧱'} {p.point_name} {isLow && <span style={{ fontSize: 10, background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>⚠️ ต่ำกว่า min</span>}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                          {p.point_type === 'packaging'
                            ? `${p.packaging_type ? `${p.packaging_type} · ` : ''}${p.packaging_no ? `${p.packaging_no} · ` : ''}`
                            : `${p.material_category ? `cat.${p.material_category} · ` : ''}${p.mat_no ? `${p.mat_no} · ` : ''}`}
                          คงเหลือ {p.current_qty ?? 0} (min {p.min_qty ?? 0} / max {p.max_qty ?? 0})
                        </div>
                      </div>
                      <button onClick={() => deleteWipPoint(p.id)} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>🗑️</button>
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
              <h4 style={{ margin: '0 0 10px', color: 'var(--text)', fontSize: 14, fontFamily: 'var(--font-display)' }}>
                {machineForm.id ? '📝 แก้ไขจุดเครื่องจักร' : '⚙️ เพิ่มจุดเครื่องจักร'}
              </h4>
              {(machineTempPos || machineForm.id) ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--bg2)', padding: 14, borderRadius: 10, marginBottom: 14 }}>
                  <select value={machineForm.machine_no}
                    onChange={e => setMachineForm({ ...machineForm, machine_no: e.target.value })}>
                    <option value="">-- เลือกเครื่องจักร --</option>
                    {drMachines.map(m => (
                      <option key={m.id} value={m.machine_no}>{m.machine_no} {m.machine_name ? `- ${m.machine_name}` : ''}</option>
                    ))}
                  </select>
                  {drMachines.length === 0 && (
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>ไม่พบเครื่องจักรของไลน์นี้ใน Daily Report</div>
                  )}
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button onClick={handleSaveMachine} style={{ flex: 1, padding: '9px', background: 'var(--green)', color: '#fff', border: 'none', borderRadius: 7, fontWeight: 700 }}>
                      {machineForm.id ? 'บันทึก' : 'เพิ่ม'}
                    </button>
                    <button onClick={() => { setMachineTempPos(null); setMachineForm({ id: null, machine_no: '' }); }}
                      style={{ padding: '9px 14px', background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border2)', borderRadius: 7 }}>
                      ยกเลิก
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '16px', border: '2px dashed var(--border)', color: 'var(--muted)', borderRadius: 10, fontSize: 12, marginBottom: 14 }}>
                  คลิกบนรูปภาพเพื่อเพิ่มจุดเครื่องจักร<br />หรือคลิกที่จุดเดิมเพื่อแก้ไข
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
                      <div onClick={() => editMachinePoint(p)} style={{ cursor: 'pointer', flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>{p.machine_no}</div>
                        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{mc?.machine_name || ''}</div>
                      </div>
                      <button onClick={() => deleteMachinePoint(p.id)} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>🗑️</button>
                    </div>
                  );
                })}
                {machinePoints.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '12px 0', color: 'var(--muted)', fontSize: 12 }}>ยังไม่มีจุดเครื่องจักร</div>
                )}
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
                <input type="number" min={0} value={stdDay}
                  onChange={e => setStdDay(e.target.value)}
                  style={{ marginTop: 4, fontSize: 18, fontWeight: 700, textAlign: 'center' }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelSt}>🌙 กะดึก (คน)</label>
                <input type="number" min={0} value={stdNight}
                  onChange={e => setStdNight(e.target.value)}
                  style={{ marginTop: 4, fontSize: 18, fontWeight: 700, textAlign: 'center' }} />
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={labelSt}>🏷️ Cost Center</label>
              <input type="text" value={costCenter}
                onChange={e => setCostCenter(e.target.value)}
                placeholder="เช่น 2140662201"
                style={{ marginTop: 4, fontSize: 14, fontWeight: 600 }} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={labelSt}>👨‍🔧 หัวหน้างาน (ประจำไลน์นี้)</label>
              <input type="text" value={signerHead}
                onChange={e => setSignerHead(e.target.value)}
                placeholder="เช่น คุณสุวิทชัย ดีทั่ว"
                style={{ marginTop: 4 }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                รวม <strong style={{ color: 'var(--text)' }}>{(parseInt(stdDay) || 0) + (parseInt(stdNight) || 0)}</strong> คน
              </span>
              <button onClick={handleSaveStdManpower} disabled={mpSaving}
                style={{ padding: '7px 18px', background: mpSaving ? 'var(--muted)' : 'var(--accent)', color: '#fff', border: 'none', borderRadius: 7, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                {mpSaving ? 'กำลังบันทึก...' : '💾 บันทึก'}
              </button>
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
              <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 10 }}>
                ใช้ดึงอัตโนมัติในใบสรุปค่าฝีมือ — กรอกครั้งเดียวต่อส่วนงาน ใช้ร่วมกันทุกไลน์ในส่วนนี้ (หัวหน้างานแยกตามไลน์ ตั้งค่าด้านบนในช่อง Standard Manpower)
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
                <div>
                  <label style={labelSt}>ผู้จัดการต้นสังกัด</label>
                  <input type="text" value={signerManager} onChange={e => setSignerManager(e.target.value)} style={{ marginTop: 4 }} />
                </div>
                <div>
                  <label style={labelSt}>เจ้าหน้าที่ TA</label>
                  <input type="text" value={signerTA} onChange={e => setSignerTA(e.target.value)} style={{ marginTop: 4 }} />
                </div>
                <div>
                  <label style={labelSt}>ผู้จัดการส่วน HRM</label>
                  <input type="text" value={signerHRM} onChange={e => setSignerHRM(e.target.value)} style={{ marginTop: 4 }} />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button onClick={handleSaveSigners} disabled={signersSaving}
                  style={{ padding: '7px 18px', background: signersSaving ? 'var(--muted)' : 'var(--accent)', color: '#fff', border: 'none', borderRadius: 7, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                  {signersSaving ? 'กำลังบันทึก...' : '💾 บันทึก'}
                </button>
              </div>
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
