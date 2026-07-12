import { useState, useEffect, useContext, useMemo, useCallback } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from '../components/Toast';
import { can } from '../utils/permissions';
import { inSectionScope } from '../utils/sectionScope';
import { getLineFamilyIds } from '../utils/lineHierarchy';
import { fmtDate } from '../utils/dateFormat';

/* ── helpers ─────────────────────────────────────────────────── */

// รูปหลักฐาน before/after — บีบก่อนอัปโหลดตามกติกา CLAUDE.md "Storage & รูปภาพ" (ห้ามส่งรูปดิบ)
function resizeImage(file, maxPx = 1280, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('บีบรูปไม่สำเร็จ'))), 'image/jpeg', quality);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error('อ่านไฟล์รูปไม่ได้'));
    img.src = URL.createObjectURL(file);
  });
}

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const addDays = (dateStr, n) => {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// path ใน bucket improvement-images จาก public URL (null = ไม่ใช่ไฟล์ของ bucket นี้)
const impImagePath = (url) => {
  const p = url?.split('/improvement-images/')[1];
  return p ? decodeURIComponent(p) : null;
};
const removeImpImage = (url) => {
  const p = impImagePath(url);
  if (p) supabaseDR.storage.from('improvement-images').remove([p]).catch(() => {});
};

const STATUS_META = {
  monitoring: { label: '👁 กำลังติดตามผล', color: '#f59e0b', bg: 'rgba(245,158,11,0.14)' },
  done:       { label: '✅ สำเร็จ',          color: '#22c55e', bg: 'rgba(34,197,94,0.14)' },
  cancelled:  { label: '✖ ยกเลิก',           color: '#8b8b96', bg: 'rgba(139,139,150,0.14)' },
};

const EMPTY_FORM = {
  id: null, title: '', line_name: '', machine_no: '', mat_no: '',
  problem_source: 'downtime', problem_type_id: '', problem_label: '',
  description: '', action_taken: '', start_date: todayStr(), baseline_days: 30,
};

export default function Improvements() {
  const { role, lineId, sections: scopeSecs, fullName } = useContext(UserContext);
  const canManage = can('improvements', 'manage', role);

  const [lines, setLines] = useState([]);
  const [items, setItems] = useState([]);
  const [dtTypes, setDtTypes] = useState([]);
  const [defectTypes, setDefectTypes] = useState([]);
  const [machines, setMachines] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState({});          // improvement id -> metric result
  const [statusFilter, setStatusFilter] = useState('all');

  const [modal, setModal] = useState(null);            // form object เมื่อเปิด modal สร้าง/แก้ไข
  const [saving, setSaving] = useState(false);
  const [beforeFile, setBeforeFile] = useState(null);
  const [afterFile, setAfterFile] = useState(null);
  const [pareto, setPareto] = useState({ loading: false, rows: [] });
  const [closeModal, setCloseModal] = useState(null);  // { imp, note } ตอนกดปิดจ๊อบ

  /* ── load master + improvements ── */
  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: ln }, { data: imp }, { data: dt }, { data: dft }, { data: mc }, { data: pr }] = await Promise.all([
      supabase.from('production_lines').select('id, name, section, parent_line_name').order('name'),
      supabaseDR.from('improvements').select('*').order('created_at', { ascending: false }),
      supabaseDR.from('dr_downtime_types').select('id, name, category').order('sort_order'),
      supabaseDR.from('dr_defect_types').select('id, name').order('sort_order'),
      supabaseDR.from('machines').select('id, line_name, machine_no, machine_name').eq('is_active', true).order('sort_order'),
      supabaseDR.from('dr_products').select('id, name, mat_no, line_name').eq('is_active', true).order('name'),
    ]);
    setLines(ln || []);
    setItems(imp || []);
    setDtTypes(dt || []);
    setDefectTypes(dft || []);
    setMachines(mc || []);
    setProducts(pr || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  /* ── scope: leader → family ไลน์ตัวเอง · role อื่น → section scope (pattern เดียวกับหน้าอื่น) ── */
  const visibleLineNames = useMemo(() => {
    if (role === 'leader' && lineId) {
      const fam = getLineFamilyIds(lines, lineId);
      return new Set(lines.filter(l => fam.has(l.id)).map(l => l.name));
    }
    if (scopeSecs?.length) {
      return new Set(lines.filter(l => inSectionScope(scopeSecs, l.section)).map(l => l.name));
    }
    return null; // ไม่จำกัด
  }, [lines, role, lineId, scopeSecs]);

  const visibleItems = useMemo(() => {
    let list = visibleLineNames ? items.filter(i => visibleLineNames.has(i.line_name)) : items;
    if (statusFilter !== 'all') list = list.filter(i => i.status === statusFilter);
    return list;
  }, [items, visibleLineNames, statusFilter]);

  const lineOptions = useMemo(() => {
    const ls = visibleLineNames ? lines.filter(l => visibleLineNames.has(l.name)) : lines;
    return ls.filter(l => l.parent_line_name); // เฉพาะไลน์ผลิตจริง (ระดับลูก)
  }, [lines, visibleLineNames]);

  const typeName = useCallback((imp) => {
    const list = imp.problem_source === 'defect' ? defectTypes : dtTypes;
    return list.find(t => t.id === imp.problem_type_id)?.name || imp.problem_label || '—';
  }, [dtTypes, defectTypes]);

  /* ── ผลลัพธ์ก่อน/หลัง จากข้อมูลจริง ──
     ก่อน = [start-baseline_days, start) · หลัง = [start, วันนี้] (เพดาน baseline_days วัน)
     หารด้วย "วันที่มีการผลิตจริง" ของไลน์ (นับจาก production_sessions) ไม่ใช่วันปฏิทิน */
  const computeResult = useCallback(async (imp) => {
    const from = addDays(imp.start_date, -imp.baseline_days);
    const afterEnd = addDays(imp.start_date, imp.baseline_days - 1);
    const to = todayStr() < afterEnd ? todayStr() : afterEnd;
    const { data: sessions } = await supabaseDR.from('production_sessions')
      .select('id, work_date').eq('line_name', imp.line_name)
      .gte('work_date', from).lte('work_date', to);
    if (!sessions?.length) return { noData: true };

    const beforeIds = [], afterIds = [], beforeDays = new Set(), afterDays = new Set();
    sessions.forEach(s => {
      if (s.work_date < imp.start_date) { beforeIds.push(s.id); beforeDays.add(s.work_date); }
      else { afterIds.push(s.id); afterDays.add(s.work_date); }
    });
    const allIds = [...beforeIds, ...afterIds];
    const idSetAfter = new Set(afterIds);

    let rows = [];
    if (imp.problem_source === 'downtime') {
      let q = supabaseDR.from('downtime_logs')
        .select('session_id, duration_min, machine_no, mat_no')
        .in('session_id', allIds);
      if (imp.problem_type_id) q = q.eq('downtime_type_id', imp.problem_type_id);
      if (imp.machine_no) q = q.eq('machine_no', imp.machine_no);
      if (imp.mat_no) q = q.eq('mat_no', imp.mat_no);
      rows = (await q).data || [];
      const sum = (arr) => arr.reduce((a, r) => a + (Number(r.duration_min) || 0), 0);
      const bRows = rows.filter(r => !idSetAfter.has(r.session_id));
      const aRows = rows.filter(r => idSetAfter.has(r.session_id));
      return {
        unit: 'นาที', beforeDays: beforeDays.size, afterDays: afterDays.size,
        beforeTotal: sum(bRows), afterTotal: sum(aRows),
        beforeCount: bRows.length, afterCount: aRows.length,
        beforePerDay: beforeDays.size ? sum(bRows) / beforeDays.size : 0,
        afterPerDay: afterDays.size ? sum(aRows) / afterDays.size : 0,
      };
    }
    // defect: qty NG — กรองสินค้า (ถ้าระบุ) ผ่าน prod_orders.mat_no
    let q = supabaseDR.from('defect_logs')
      .select('session_id, qty_ng, prod_orders(mat_no)')
      .in('session_id', allIds);
    if (imp.problem_type_id) q = q.eq('defect_type_id', imp.problem_type_id);
    rows = ((await q).data || []).filter(r => !imp.mat_no || r.prod_orders?.mat_no === imp.mat_no);
    const sum = (arr) => arr.reduce((a, r) => a + (Number(r.qty_ng) || 0), 0);
    const bRows = rows.filter(r => !idSetAfter.has(r.session_id));
    const aRows = rows.filter(r => idSetAfter.has(r.session_id));
    return {
      unit: 'ชิ้น NG', beforeDays: beforeDays.size, afterDays: afterDays.size,
      beforeTotal: sum(bRows), afterTotal: sum(aRows),
      beforeCount: bRows.length, afterCount: aRows.length,
      beforePerDay: beforeDays.size ? sum(bRows) / beforeDays.size : 0,
      afterPerDay: afterDays.size ? sum(aRows) / afterDays.size : 0,
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const imp of visibleItems) {
        if (results[imp.id]) continue;
        const r = await computeResult(imp).catch(() => ({ noData: true }));
        if (cancelled) return;
        setResults(prev => ({ ...prev, [imp.id]: r }));
      }
    })();
    return () => { cancelled = true; };
  }, [visibleItems, computeResult]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Pareto ปัญหา Top ของไลน์ (หน้าต่างเดียวกับ baseline) — คลิกเพื่อเลือกเป็นเป้าโปรเจค ── */
  const loadPareto = useCallback(async (line_name, source, days) => {
    if (!line_name) { setPareto({ loading: false, rows: [] }); return; }
    setPareto({ loading: true, rows: [] });
    const from = addDays(todayStr(), -days);
    const { data: sessions } = await supabaseDR.from('production_sessions')
      .select('id').eq('line_name', line_name).gte('work_date', from);
    const ids = (sessions || []).map(s => s.id);
    if (!ids.length) { setPareto({ loading: false, rows: [] }); return; }
    const agg = new Map();
    if (source === 'downtime') {
      const { data } = await supabaseDR.from('downtime_logs')
        .select('downtime_type_id, machine_no, duration_min').in('session_id', ids);
      (data || []).forEach(r => {
        const key = `${r.downtime_type_id || ''}::${r.machine_no || ''}`;
        const cur = agg.get(key) || { type_id: r.downtime_type_id, machine_no: r.machine_no || '', value: 0, count: 0 };
        cur.value += Number(r.duration_min) || 0; cur.count += 1;
        agg.set(key, cur);
      });
    } else {
      const { data } = await supabaseDR.from('defect_logs')
        .select('defect_type_id, qty_ng, prod_orders(mat_no)').in('session_id', ids);
      (data || []).forEach(r => {
        const mat = r.prod_orders?.mat_no || '';
        const key = `${r.defect_type_id || ''}::${mat}`;
        const cur = agg.get(key) || { type_id: r.defect_type_id, mat_no: mat, value: 0, count: 0 };
        cur.value += Number(r.qty_ng) || 0; cur.count += 1;
        agg.set(key, cur);
      });
    }
    const rows = [...agg.values()].filter(r => r.value > 0).sort((a, b) => b.value - a.value).slice(0, 10);
    setPareto({ loading: false, rows });
  }, []);

  useEffect(() => {
    if (modal) loadPareto(modal.line_name, modal.problem_source, Number(modal.baseline_days) || 30);
  }, [modal?.line_name, modal?.problem_source, modal?.baseline_days]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── save / delete / status ── */
  const openCreate = () => { setBeforeFile(null); setAfterFile(null); setModal({ ...EMPTY_FORM, line_name: lineOptions[0]?.name || '' }); };
  const openEdit = (imp) => { setBeforeFile(null); setAfterFile(null); setModal({ ...imp, baseline_days: imp.baseline_days || 30 }); };

  const handleSave = async () => {
    if (!modal.title.trim()) { toast.error('กรอกชื่อโปรเจคปรับปรุงก่อน'); return; }
    if (!modal.line_name) { toast.error('เลือกไลน์ก่อน'); return; }
    if (!modal.start_date) { toast.error('เลือกวันเริ่มแก้ไขก่อน'); return; }
    setSaving(true);
    try {
      const typeList = modal.problem_source === 'defect' ? defectTypes : dtTypes;
      const payload = {
        title: modal.title.trim(),
        line_name: modal.line_name,
        machine_no: modal.machine_no || null,
        mat_no: modal.mat_no || null,
        problem_source: modal.problem_source,
        problem_type_id: modal.problem_type_id || null,
        problem_label: typeList.find(t => t.id === modal.problem_type_id)?.name || modal.problem_label || null,
        description: modal.description?.trim() || null,
        action_taken: modal.action_taken?.trim() || null,
        start_date: modal.start_date,
        baseline_days: Number(modal.baseline_days) || 30,
        updated_at: new Date().toISOString(),
      };
      let row;
      if (modal.id) {
        const { data, error } = await supabaseDR.from('improvements').update(payload).eq('id', modal.id).select().single();
        if (error) throw error;
        row = data;
      } else {
        payload.created_by_name = fullName || null;
        const { data, error } = await supabaseDR.from('improvements').insert(payload).select().single();
        if (error) throw error;
        row = data;
      }
      // อัปโหลดรูป (บีบ 1280px) — update url แล้วค่อยลบรูปเก่า (ลบหลัง DB สำเร็จเท่านั้น, best-effort)
      const imgPayload = {};
      for (const [file, field] of [[beforeFile, 'image_before_url'], [afterFile, 'image_after_url']]) {
        if (!file) continue;
        const blob = await resizeImage(file);
        const path = `${row.id}/${field === 'image_before_url' ? 'before' : 'after'}-${Date.now()}.jpg`;
        const { error: upErr } = await supabaseDR.storage.from('improvement-images').upload(path, blob, { upsert: true });
        if (upErr) throw upErr;
        imgPayload[field] = supabaseDR.storage.from('improvement-images').getPublicUrl(path).data.publicUrl;
      }
      if (Object.keys(imgPayload).length) {
        const { error: imgErr } = await supabaseDR.from('improvements').update(imgPayload).eq('id', row.id);
        if (imgErr) throw imgErr;
        if (imgPayload.image_before_url && row.image_before_url) removeImpImage(row.image_before_url);
        if (imgPayload.image_after_url && row.image_after_url) removeImpImage(row.image_after_url);
      }
      toast.success(modal.id ? 'บันทึกการแก้ไขแล้ว' : 'สร้างโปรเจคปรับปรุงแล้ว — ระบบจะติดตามผลจากข้อมูลจริงให้');
      setModal(null);
      setResults(prev => { const p = { ...prev }; delete p[row.id]; return p; }); // คำนวณผลใหม่
      load();
    } catch (e) { toast.error(e.message); }
    setSaving(false);
  };

  const handleDelete = async (imp) => {
    if (!window.confirm(`ลบโปรเจค "${imp.title}"?`)) return;
    const { error } = await supabaseDR.from('improvements').delete().eq('id', imp.id);
    if (error) { toast.error(error.message); return; }
    // ลบรูปหลัง DB สำเร็จ (กติกา CLAUDE.md — กันไฟล์กำพร้า)
    removeImpImage(imp.image_before_url);
    removeImpImage(imp.image_after_url);
    toast.success('ลบแล้ว');
    setItems(prev => prev.filter(i => i.id !== imp.id));
  };

  const setStatus = async (imp, status, result_note = null) => {
    const { error } = await supabaseDR.from('improvements')
      .update({ status, result_note, updated_at: new Date().toISOString() }).eq('id', imp.id);
    if (error) { toast.error(error.message); return; }
    setItems(prev => prev.map(i => (i.id === imp.id ? { ...i, status, result_note } : i)));
    toast.success(status === 'done' ? 'ปิดโปรเจค — สำเร็จ 🎉' : status === 'cancelled' ? 'ยกเลิกโปรเจคแล้ว' : 'กลับมาติดตามผลต่อ');
  };

  /* ── render ── */
  if (loading) return <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 40 }}>กำลังโหลด...</div>;

  const machineOpts = machines.filter(m => m.line_name === modal?.line_name);
  const productOpts = products.filter(p => p.line_name === modal?.line_name && p.mat_no);
  const typeOpts = modal?.problem_source === 'defect' ? defectTypes : dtTypes;

  return (
    <div style={{ padding: 'clamp(12px,3vw,28px)', maxWidth: 'min(96vw, 1500px)', margin: '0 auto' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 8 }}>
        <div>
          <h1 style={{ fontSize: 'clamp(18px,3vw,26px)', fontWeight: 800, color: 'var(--text)', margin: 0 }}>💡 Improvements — โปรเจคปรับปรุง</h1>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
            เลือกปัญหาจากพาเรโต้ Downtime/ของเสีย → บันทึกการแก้ไข → ระบบเทียบผลก่อน/หลังจากข้อมูลที่เกิดจริงให้อัตโนมัติ
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ width: 'auto', padding: '7px 10px', fontSize: 12, borderRadius: 8, background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)' }}>
            <option value="all">ทุกสถานะ</option>
            <option value="monitoring">👁 กำลังติดตามผล</option>
            <option value="done">✅ สำเร็จ</option>
            <option value="cancelled">✖ ยกเลิก</option>
          </select>
          {canManage && (
            <button onClick={openCreate} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#08130a', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
              ➕ เพิ่มโปรเจคปรับปรุง
            </button>
          )}
        </div>
      </div>

      {visibleItems.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--muted)', fontSize: 13 }}>
          ยังไม่มีโปรเจคปรับปรุง{canManage ? ' — กด "➕ เพิ่มโปรเจคปรับปรุง" เลือกปัญหาจากพาเรโต้ได้เลย' : ''}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 14, marginTop: 14, alignItems: 'stretch' }}>
          {visibleItems.map(imp => {
            const st = STATUS_META[imp.status] || STATUS_META.monitoring;
            const r = results[imp.id];
            const pct = r && !r.noData && r.beforePerDay > 0
              ? Math.round(((r.beforePerDay - r.afterPerDay) / r.beforePerDay) * 100)
              : null;
            const improved = pct != null && pct > 0;
            const maxPerDay = r && !r.noData ? Math.max(r.beforePerDay, r.afterPerDay, 0.0001) : 1;
            return (
              <div key={imp.id} style={{ display: 'flex', flexDirection: 'column', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, height: '100%' }}>
                {/* title + status */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', lineHeight: 1.3 }}>{imp.title}</div>
                  <span style={{ fontSize: 11, fontWeight: 800, color: st.color, background: st.bg, border: `1px solid ${st.color}55`, borderRadius: 6, padding: '2px 8px', whiteSpace: 'nowrap', flexShrink: 0 }}>{st.label}</span>
                </div>
                {/* problem chips */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, background: 'rgba(77,159,255,0.13)', color: '#4d9fff', borderRadius: 5, padding: '2px 7px' }}>🏭 {imp.line_name}</span>
                  {imp.machine_no && <span style={{ fontSize: 11, fontWeight: 700, background: 'rgba(245,158,11,0.13)', color: '#f59e0b', borderRadius: 5, padding: '2px 7px' }}>⚙️ {imp.machine_no}</span>}
                  {imp.mat_no && <span style={{ fontSize: 11, fontWeight: 700, background: 'rgba(167,139,250,0.13)', color: '#a78bfa', borderRadius: 5, padding: '2px 7px' }}>📦 {imp.mat_no}</span>}
                  <span style={{ fontSize: 11, fontWeight: 700, background: imp.problem_source === 'defect' ? 'rgba(236,72,153,0.13)' : 'rgba(239,68,68,0.13)', color: imp.problem_source === 'defect' ? '#ec4899' : '#ef4444', borderRadius: 5, padding: '2px 7px' }}>
                    {imp.problem_source === 'defect' ? '🔍 ของเสีย' : '🛑 Downtime'}: {typeName(imp)}
                  </span>
                </div>
                {/* description / action */}
                {imp.description && <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 8, lineHeight: 1.45 }}><b style={{ color: 'var(--muted)' }}>ปัญหา:</b> {imp.description}</div>}
                {imp.action_taken && <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4, lineHeight: 1.45 }}><b style={{ color: 'var(--muted)' }}>การแก้ไข:</b> {imp.action_taken}</div>}
                {/* before/after images */}
                {(imp.image_before_url || imp.image_after_url) && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
                    {[['image_before_url', 'ก่อนแก้ไข'], ['image_after_url', 'หลังแก้ไข']].map(([f, label]) => (
                      <div key={f}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 3 }}>{label}</div>
                        {imp[f]
                          ? <img src={imp[f]} alt={label} loading="lazy" style={{ width: '100%', height: 110, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer' }} onClick={() => window.open(imp[f], '_blank')} />
                          : <div style={{ width: '100%', height: 110, borderRadius: 8, border: '1px dashed var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--muted)' }}>ยังไม่มีรูป</div>}
                      </div>
                    ))}
                  </div>
                )}
                {/* ผลลัพธ์จากข้อมูลจริง */}
                <div style={{ marginTop: 10, padding: 10, background: 'var(--bg3)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)' }}>📈 ผลจากข้อมูลจริง <span style={{ fontWeight: 600, color: 'var(--muted)' }}>(เริ่ม {fmtDate(imp.start_date)} · เทียบ {imp.baseline_days} วัน)</span></span>
                    {pct != null && (
                      <span style={{ fontSize: 14, fontWeight: 800, color: improved ? '#22c55e' : '#ef4444' }}>
                        {improved ? '▼' : '▲'} {Math.abs(pct)}%
                      </span>
                    )}
                  </div>
                  {!r ? (
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>กำลังคำนวณ...</div>
                  ) : r.noData ? (
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>ยังไม่มีข้อมูลการผลิตในช่วงเทียบ</div>
                  ) : (
                    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {[['ก่อนแก้', r.beforePerDay, r.beforeTotal, r.beforeCount, r.beforeDays, '#ef4444'],
                        ['หลังแก้', r.afterPerDay, r.afterTotal, r.afterCount, r.afterDays, improved || r.afterPerDay === 0 ? '#22c55e' : '#f59e0b']].map(([label, perDay, total, count, days, color]) => (
                        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', width: 46, flexShrink: 0 }}>{label}</span>
                          <div style={{ flex: 1, height: 16, background: 'var(--bg)', borderRadius: 4, overflow: 'hidden' }}>
                            <div style={{ width: `${Math.min(100, (perDay / maxPerDay) * 100)}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.4s' }} />
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 800, color, width: 150, flexShrink: 0, textAlign: 'right' }}>
                            {perDay.toFixed(1)} {r.unit}/วัน <span style={{ fontWeight: 600, color: 'var(--muted)' }}>({total.toFixed(0)} / {days}วัน)</span>
                          </span>
                        </div>
                      ))}
                      {r.afterDays === 0 && <div style={{ fontSize: 11, color: '#f59e0b' }}>⏳ ยังไม่มีวันผลิตหลังวันเริ่มแก้ — รอข้อมูล</div>}
                    </div>
                  )}
                  {imp.result_note && <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 6 }}><b style={{ color: 'var(--muted)' }}>สรุปผล:</b> {imp.result_note}</div>}
                </div>
                {/* footer actions */}
                <div style={{ marginTop: 'auto', paddingTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)', marginRight: 'auto' }}>{imp.created_by_name ? `โดย ${imp.created_by_name}` : ''}</span>
                  {canManage && imp.status === 'monitoring' && (
                    <>
                      <button onClick={() => setCloseModal({ imp, note: '' })} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid rgba(34,197,94,0.5)', background: 'rgba(34,197,94,0.12)', color: '#22c55e', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>✅ ปิดจ๊อบ</button>
                      <button onClick={() => setStatus(imp, 'cancelled')} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--muted)', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>✖ ยกเลิก</button>
                    </>
                  )}
                  {canManage && imp.status !== 'monitoring' && (
                    <button onClick={() => setStatus(imp, 'monitoring', imp.result_note)} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid rgba(245,158,11,0.5)', background: 'rgba(245,158,11,0.1)', color: '#f59e0b', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>👁 ติดตามต่อ</button>
                  )}
                  {canManage && <button onClick={() => openEdit(imp)} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text2)', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>✏️ แก้ไข</button>}
                  {canManage && <button onClick={() => handleDelete(imp)} style={{ padding: '5px 10px', borderRadius: 6, border: 'none', background: 'transparent', color: '#ef4444', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>🗑</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── modal สร้าง/แก้ไข (ฟอร์ม — ห้ามปิดจาก backdrop ตาม UI-CONVENTIONS §5) ── */}
      {modal && (
        <div className="overlay">
          <div className="modal" style={{ width: 'min(880px, 96vw)', maxHeight: '92vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: 'var(--text)' }}>{modal.id ? '✏️ แก้ไขโปรเจคปรับปรุง' : '➕ เพิ่มโปรเจคปรับปรุง'}</h3>
              <button onClick={() => setModal(null)} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
              {/* ซ้าย: ข้อมูลโปรเจค */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>ชื่อโปรเจค *
                  <input value={modal.title} onChange={e => setModal({ ...modal, title: e.target.value })} placeholder="เช่น ลดดาวไทม์แม่พิมพ์ติดขัด HDF1" style={{ marginTop: 4 }} />
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', flex: 1 }}>ไลน์ *
                    <select value={modal.line_name} onChange={e => setModal({ ...modal, line_name: e.target.value, machine_no: '', mat_no: '' })} style={{ marginTop: 4 }}>
                      <option value="">— เลือกไลน์ —</option>
                      {lineOptions.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
                    </select>
                  </label>
                  <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', flex: 1 }}>ประเภทปัญหา *
                    <select value={modal.problem_source} onChange={e => setModal({ ...modal, problem_source: e.target.value, problem_type_id: '', problem_label: '' })} style={{ marginTop: 4 }}>
                      <option value="downtime">🛑 Downtime</option>
                      <option value="defect">🔍 ของเสีย/คุณภาพ</option>
                    </select>
                  </label>
                </div>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>ปัญหาที่แก้ (จาก master {modal.problem_source === 'defect' ? 'ของเสีย' : 'Downtime'})
                  <select value={modal.problem_type_id} onChange={e => setModal({ ...modal, problem_type_id: e.target.value })} style={{ marginTop: 4 }}>
                    <option value="">— ทุกประเภท —</option>
                    {typeOpts.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', flex: 1 }}>เครื่องจักร/จุดงาน
                    <select value={modal.machine_no || ''} onChange={e => setModal({ ...modal, machine_no: e.target.value })} style={{ marginTop: 4 }}>
                      <option value="">— ทั้งไลน์ —</option>
                      {machineOpts.map(m => <option key={m.id} value={m.machine_no}>{m.machine_no} {m.machine_name ? `· ${m.machine_name}` : ''}</option>)}
                    </select>
                  </label>
                  <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', flex: 1 }}>สินค้า
                    <select value={modal.mat_no || ''} onChange={e => setModal({ ...modal, mat_no: e.target.value })} style={{ marginTop: 4 }}>
                      <option value="">— ทุกสินค้า —</option>
                      {productOpts.map(p => <option key={p.id} value={p.mat_no}>{p.mat_no} · {p.name}</option>)}
                    </select>
                  </label>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>วันเริ่มแก้ไข *
                    {/* width กัน index.css input{width:100%} (กับดัก CSS ใน CLAUDE.md) */}
                    <input type="date" value={modal.start_date} onChange={e => setModal({ ...modal, start_date: e.target.value })} style={{ marginTop: 4, width: 150, display: 'block' }} />
                  </label>
                  <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>หน้าต่างเทียบผล
                    <select value={modal.baseline_days} onChange={e => setModal({ ...modal, baseline_days: e.target.value })} style={{ marginTop: 4, width: 130, display: 'block' }}>
                      {[14, 30, 60, 90].map(d => <option key={d} value={d}>{d} วัน</option>)}
                    </select>
                  </label>
                </div>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>สภาพปัญหา/สาเหตุ
                  <textarea value={modal.description || ''} onChange={e => setModal({ ...modal, description: e.target.value })} rows={2} style={{ marginTop: 4 }} />
                </label>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>การแก้ไข (Action)
                  <textarea value={modal.action_taken || ''} onChange={e => setModal({ ...modal, action_taken: e.target.value })} rows={2} style={{ marginTop: 4 }} />
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {[['before', 'รูปก่อนแก้ไข', beforeFile, setBeforeFile, modal.image_before_url],
                    ['after', 'รูปหลังแก้ไข', afterFile, setAfterFile, modal.image_after_url]].map(([key, label, file, setFile, existing]) => (
                    <div key={key}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
                      {(file || existing) && (
                        <img src={file ? URL.createObjectURL(file) : existing} alt={label} style={{ width: '100%', height: 100, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)', marginBottom: 4 }} />
                      )}
                      <input type="file" accept="image/*" onChange={e => setFile(e.target.files?.[0] || null)} style={{ fontSize: 11 }} />
                    </div>
                  ))}
                </div>
              </div>
              {/* ขวา: Pareto ปัญหา Top — คลิกเลือกเป็นเป้า */}
              <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, alignSelf: 'start' }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>
                  🔝 พาเรโต้ {modal.problem_source === 'defect' ? 'ของเสีย' : 'Downtime'} · {modal.line_name || 'เลือกไลน์ก่อน'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>ย้อนหลัง {modal.baseline_days} วัน — คลิกปัญหาเพื่อตั้งเป็นเป้าโปรเจค</div>
                {pareto.loading ? (
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>กำลังโหลด...</div>
                ) : pareto.rows.length === 0 ? (
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>ไม่พบข้อมูลในช่วงนี้</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {pareto.rows.map((row, i) => {
                      const max = pareto.rows[0].value || 1;
                      const tn = typeOpts.find(t => t.id === row.type_id)?.name || 'ไม่ระบุประเภท';
                      const selected = modal.problem_type_id === (row.type_id || '') &&
                        (modal.problem_source === 'downtime' ? (modal.machine_no || '') === row.machine_no : (modal.mat_no || '') === row.mat_no);
                      return (
                        <button key={i} onClick={() => setModal({
                          ...modal,
                          problem_type_id: row.type_id || '',
                          problem_label: tn,
                          ...(modal.problem_source === 'downtime' ? { machine_no: row.machine_no || '' } : { mat_no: row.mat_no || '' }),
                          title: modal.title || `ลด${modal.problem_source === 'defect' ? 'ของเสีย' : 'ดาวไทม์'} ${tn} ${row.machine_no || row.mat_no || ''}`.trim(),
                        })} style={{
                          textAlign: 'left', padding: '6px 8px', borderRadius: 7, cursor: 'pointer',
                          border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
                          background: selected ? 'var(--accent-dim)' : 'var(--bg)',
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i + 1}. {tn}{row.machine_no ? ` · ⚙️${row.machine_no}` : ''}{row.mat_no ? ` · 📦${row.mat_no}` : ''}</span>
                            <span style={{ color: '#ef4444', flexShrink: 0 }}>{row.value.toFixed(0)} {modal.problem_source === 'defect' ? 'ชิ้น' : 'นาที'} · {row.count} ครั้ง</span>
                          </div>
                          <div style={{ height: 6, background: 'var(--bg2)', borderRadius: 3, marginTop: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${(row.value / max) * 100}%`, height: '100%', background: '#ef4444', borderRadius: 3 }} />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button onClick={() => setModal(null)} style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text2)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>ยกเลิก</button>
              <button disabled={saving} onClick={handleSave} style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#08130a', fontWeight: 800, fontSize: 13, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
                {saving ? 'กำลังบันทึก...' : '💾 บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── modal ปิดจ๊อบ + สรุปผล ── */}
      {closeModal && (
        <div className="overlay">
          <div className="modal">
            <h3 style={{ margin: '0 0 10px', fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>✅ ปิดโปรเจค "{closeModal.imp.title}"</h3>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>สรุปผลการปรับปรุง
              <textarea value={closeModal.note} onChange={e => setCloseModal({ ...closeModal, note: e.target.value })} rows={3} placeholder="เช่น ดาวไทม์ลดลง 70% หลังเปลี่ยน jig ใหม่" style={{ marginTop: 4 }} />
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button onClick={() => setCloseModal(null)} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text2)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>ยกเลิก</button>
              <button onClick={() => { setStatus(closeModal.imp, 'done', closeModal.note.trim() || null); setCloseModal(null); }} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: '#22c55e', color: '#08130a', fontWeight: 800, fontSize: 12, cursor: 'pointer' }}>✅ ปิดจ๊อบ</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
