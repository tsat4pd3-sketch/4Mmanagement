/* RackMap — ผังคลังอะไหล่ (digital twin ของชั้นวาง มุมมองด้านหน้า)
   ใช้ในแท็บ "🗺️ ผังคลัง" ของ /mtn-repair · ข้อมูลอยู่ DR project

   แนวคิดเดียวกับ FactoryMap: รูปจริง 1 รูป + พิกัดเป็น % ของรูป (0-100)
   ต่างที่ FactoryMap เป็น polygon (ไลน์รูป L/U) — ชั้นวางเป็นตาราง จึงใช้ rect (x,y,w,h)
   + มีตัวสร้างตารางอัตโนมัติ (แถว × คอลัมน์) ไม่ต้องลากทีละช่อง

   กุญแจจับคู่ของ = shelf_code ↔ mtn_spare_parts.shelf (ข้อความตรงกัน ไม่ใช้ FK
   เพราะ 1 ช่องมีอะไหล่ได้หลายตัว) → รหัสชั้นวางต้องนิ่ง (ฟอร์มอะไหล่มี datalist ช่วย) */
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import useUndoHistory, { undoBtnStyle } from '../utils/useUndoHistory';
import { supabaseDR } from '../supabaseClient';
import { toDecodableImage } from '../utils/heicToJpeg';
import { toast } from './Toast';
import { pmTeamsSync } from '../utils/pmTeams';
import { teamKeyOf } from '../utils/mtnTeams';
import { loadSpareSections, sectionOptions, sectionKeyOf, COMMON_SECTION_LABEL } from '../utils/spareSection';
import { stockState, computeSpareRank, RANK_META, RANK_RULE, monthKeysBack } from '../utils/spareRank';
import { checkWrite } from '../utils/dbWrite';

const lbl = { display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 4 };
const inp = { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' };
const btnPri = { background: 'var(--accent)', color: '#071008', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' };
const btnGhost = { background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const fmtNum = (v) => (v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString());

/* รูปผังต้องอ่านป้ายบนชั้นออก — บีบเบากว่ารูปทั่วไปตามกฎ Storage (2560px / q0.9)
   ห้ามลดลงไปกว่านี้ เคยบีบแรงจนผังเบลออ่านไม่ออกมาแล้ว (ดู CLAUDE.md "Storage & รูปภาพ") */
async function compressPlan(file) {
  // HEIC/HEIF จากกล้องมือถือ → แปลงเป็น JPEG ก่อน (ไฟล์อื่นคืนตัวเดิม · แปลงไม่ได้ = โยนข้อความบอกวิธีตั้งกล้อง)
  file = await toDecodableImage(file);
  if (file.type === 'image/gif') { if (file.size > 2 * 1024 * 1024) throw new Error('GIF ต้องไม่เกิน 2MB'); return file; }
  const img = await new Promise((res, rej) => {
    const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file);
  });
  const MAX = 2560;
  const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(img.src);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
  if (blob.size > 2.5 * 1024 * 1024) throw new Error('รูปใหญ่เกินไป (เกิน 2.5MB หลังบีบ) — ลองถ่ายใหม่ให้เล็กลง');
  return blob;
}
const rackImgPath = (url) => { const p = url?.split('/mtn-images/')[1]; return p ? decodeURIComponent(p) : null; };
const removeRackImg = (url) => { const p = rackImgPath(url); if (p) supabaseDR.storage.from('mtn-images').remove([p]).catch(() => {}); };

/* สีของช่อง: ว่าง=เทา · ปกติ=เขียว · มีของต่ำกว่าขั้นต่ำ=เหลือง · มีของหมด=แดง
   (ตาม Andon: ไม่กระพริบ — นี่เป็นสถานะคลัง ไม่ใช่เหตุฉุกเฉินเครื่องหยุด) */
function cellStatus(parts) {
  if (!parts.length) return { key: 'empty', color: '#6b7280', bg: 'rgba(107,114,128,0.18)', label: 'ว่าง' };
  const st = parts.map(p => stockState(p).key);
  if (st.includes('out')) return { key: 'out', color: '#ef4444', bg: 'rgba(239,68,68,0.3)', label: 'มีของหมด' };
  if (st.includes('low')) return { key: 'low', color: '#f59e0b', bg: 'rgba(245,158,11,0.28)', label: 'ต่ำกว่าขั้นต่ำ' };
  return { key: 'ok', color: '#22c55e', bg: 'rgba(34,197,94,0.24)', label: 'ปกติ' };
}

export default function RackMap({ parts = [], canEdit, myTeams = [], mySection = '' }) {
  const [usage, setUsage] = useState({});   // part_id → usage rows (ใช้โชว์ชิป Rank ในแผงขวา)
  const [racks, setRacks] = useState([]);
  const [rackId, setRackId] = useState('');
  const [orgSecs, setOrgSecs] = useState([]);      // ส่วนงานจากผังองค์กร (ป้ายเจ้าของผัง)
  const [cells, setCells] = useState([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState(false);
  const [q, setQ] = useState('');
  const [selCell, setSelCell] = useState(null);      // ช่องที่กดดู
  const [draft, setDraft] = useState(null);          // rect ที่กำลังลาก
  const [showGrid, setShowGrid] = useState(false);
  const [showRackForm, setShowRackForm] = useState(null);
  const [live, setLive] = useState(null);            // ช่องที่กำลังลากย้าย/ปรับขนาด (พรีวิวลื่นๆ ก่อนบันทึก)
  const wrapRef = useRef(null);
  const dragRef = useRef(null);
  const moveRef = useRef(null);
  const teams = pmTeamsSync();
  useEffect(() => { loadSpareSections().then(setOrgSecs); }, []);
  const secOpts = useMemo(() => sectionOptions(racks, orgSecs), [racks, orgSecs]);

  const rack = racks.find(r => r.id === rackId) || null;

  const loadRacks = useCallback(async () => {
    const { data } = await supabaseDR.from('mtn_rack_maps').select('*').eq('is_active', true).order('sort_order');
    const list = data || [];
    setRacks(list);
    setRackId(prev => (prev && list.some(r => r.id === prev)) ? prev : (list[0]?.id || ''));
    setLoading(false);
  }, []);
  useEffect(() => { loadRacks(); }, [loadRacks]);

  useEffect(() => {
    const from = monthKeysBack(RANK_RULE.windowMonths)[0];
    supabaseDR.from('mtn_spare_usage_monthly').select('*').gte('month_key', from).then(({ data }) => {
      const m = {}; for (const r of (data || [])) (m[r.part_id] ||= []).push(r); setUsage(m);
    });
  }, []);

  const loadCells = useCallback(async (rid) => {
    if (!rid) return setCells([]);
    const { data } = await supabaseDR.from('mtn_rack_cells').select('*').eq('rack_id', rid);
    setCells(data || []);
  }, []);
  // ── Undo/Redo (UI-CONVENTIONS §6.7 — editor ผังทุกตัวเขียน DB ทันที ต้องย้อนได้) ──
  //    snapshot = ช่องทั้งชุดของผังที่เปิดอยู่ · applySnapshot diff แล้วเขียนย้อนลง DB
  //    ⚠️ ลำดับ delete → update → insert : ปลดปล่อยรหัสที่ไม่ควรมีก่อน
  //       ไม่งั้นชน unique (rack_id, shelf_code) ตอนคืนช่องที่เคยถูกลบ
  //    ⚠️ insert คืนด้วย id เดิม เพื่อให้ undo/redo ซ้อนกันหลายชั้นยังอ้างแถวเดิมได้
  const cellsRef = useRef([]); useEffect(() => { cellsRef.current = cells; }, [cells]);
  const rackIdRef = useRef(''); useEffect(() => { rackIdRef.current = rackId; }, [rackId]);
  const snapOf = useCallback(() => cellsRef.current.map(c => ({ ...c })), []);
  const applySnapshot = useCallback(async (snap) => {
    const rid = rackIdRef.current;
    try {
      const cur = cellsRef.current;
      const snapById = new Map(snap.map(c => [c.id, c]));
      const curById = new Map(cur.map(c => [c.id, c]));

      const toDel = cur.filter(c => !snapById.has(c.id)).map(c => c.id);
      if (toDel.length) {
        const { error } = await supabaseDR.from('mtn_rack_cells').delete().in('id', toDel);
        if (error) throw error;
      }
      for (const s of snap) {
        const c = curById.get(s.id);
        if (!c) continue;
        const patch = {};
        for (const k of ['shelf_code', 'x', 'y', 'w', 'h']) if (String(c[k]) !== String(s[k])) patch[k] = s[k];
        if (Object.keys(patch).length) {
          const { error } = await supabaseDR.from('mtn_rack_cells').update(patch).eq('id', s.id);
          if (error) throw error;
        }
      }
      const toIns = snap.filter(s => !curById.has(s.id)).map(s => ({
        id: s.id, rack_id: s.rack_id || rid, shelf_code: s.shelf_code, x: s.x, y: s.y, w: s.w, h: s.h,
      }));
      if (toIns.length) {
        const { error } = await supabaseDR.from('mtn_rack_cells').insert(toIns);
        if (error) throw error;
      }
      await loadCells(rid);
      setSelCell(null);
      return true;
    } catch (e) {
      toast.error('ย้อนกลับไม่สำเร็จ: ' + (e.message || ''));
      await loadCells(rid);          // ให้จอตรงกับ DB จริงเสมอ แม้ย้อนไม่สำเร็จ
      return false;
    }
  }, [loadCells]);
  const hist = useUndoHistory({ snapOf, applySnapshot, enabled: canEdit && edit });

  // สลับผังคนละแผ่น = snapshot เก่าใช้ไม่ได้ (คนละ rack_id) ห้ามให้ undo ไปลบของผังอื่น
  useEffect(() => { loadCells(rackId); setSelCell(null); hist.clear(); }, [rackId, loadCells]);   // eslint-disable-line react-hooks/exhaustive-deps

  // อะไหล่ต่อรหัสชั้นวาง (เทียบแบบตัดช่องว่าง/ตัวพิมพ์ — รหัสที่คนพิมพ์ไม่เป๊ะเสมอ)
  const norm = (s) => String(s || '').trim().toUpperCase();
  const partsByShelf = useMemo(() => {
    const m = {};
    for (const p of parts) { const k = norm(p.shelf); if (k) (m[k] ||= []).push(p); }
    return m;
  }, [parts]);
  const partsOf = useCallback((code) => partsByShelf[norm(code)] || [], [partsByShelf]);

  // ค้นหา: "ของชิ้นนี้อยู่ตรงไหน" — ไฮไลต์ช่องที่มีของตรงคำค้น
  const hitCodes = useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!kw) return null;
    const codes = new Set();
    for (const p of parts) {
      const hit = [p.name, p.code, p.mat_no, p.part_no, p.used_with].some(v => String(v || '').toLowerCase().includes(kw));
      if (hit && p.shelf) codes.add(norm(p.shelf));
    }
    return codes;
  }, [q, parts]);
  const searchHits = useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!kw) return [];
    return parts.filter(p => [p.name, p.code, p.mat_no, p.part_no, p.used_with].some(v => String(v || '').toLowerCase().includes(kw)));
  }, [q, parts]);

  // อะไหล่ที่ยังไม่มีช่องบนผังไหนเลย — ห้ามปล่อยหายเงียบ
  const [allCellCodes, setAllCellCodes] = useState(new Set());
  useEffect(() => {
    supabaseDR.from('mtn_rack_cells').select('shelf_code')
      .then(({ data }) => setAllCellCodes(new Set((data || []).map(c => norm(c.shelf_code)))));
  }, [cells]);
  const unplaced = useMemo(() => {
    const withShelf = parts.filter(p => p.shelf && !allCellCodes.has(norm(p.shelf)));
    const noShelf = parts.filter(p => !p.shelf);
    return { withShelf, noShelf };
  }, [parts, allCellCodes]);

  /* ── พิกัด % จาก pointer ── */
  const pctFromEvent = (e) => {
    const r = wrapRef.current.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)),
      y: Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100)),
    };
  };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const onDown = (e) => {
    if (!edit || !rack?.image_url) return;
    const cellEl = e.target.closest('[data-cell]');
    const p = pctFromEvent(e);
    if (cellEl) {
      // กดบนช่องเดิม = ย้าย (หรือปรับขนาดถ้ากดที่มุมขวาล่าง) — ไม่ใช่วาดช่องใหม่
      const c = cells.find(x => x.id === cellEl.getAttribute('data-cell'));
      if (!c) return;
      moveRef.current = {
        mode: e.target.closest('[data-handle]') ? 'resize' : 'move',
        id: c.id, start: p, orig: { x: +c.x, y: +c.y, w: +c.w, h: +c.h }, moved: false,
        snap: snapOf(),        // ถ่ายก่อนลาก — push จริงตอนปล่อยเมาส์ (แตะแล้วไม่ลาก = ไม่ต้องมีประวัติ)
      };
      setSelCell(c);
      e.currentTarget.setPointerCapture?.(e.pointerId);
      return;
    }
    dragRef.current = p;
    setDraft({ x: p.x, y: p.y, w: 0, h: 0 });
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    const m = moveRef.current;
    if (m) {
      const p = pctFromEvent(e);
      const dx = p.x - m.start.x, dy = p.y - m.start.y;
      if (Math.abs(dx) > 0.2 || Math.abs(dy) > 0.2) m.moved = true;
      const o = m.orig;
      const next = m.mode === 'move'
        ? { x: clamp(o.x + dx, 0, 100 - o.w), y: clamp(o.y + dy, 0, 100 - o.h), w: o.w, h: o.h }
        : { x: o.x, y: o.y, w: clamp(o.w + dx, 1, 100 - o.x), h: clamp(o.h + dy, 1, 100 - o.y) };
      setLive({ id: m.id, ...next });
      return;
    }
    if (!dragRef.current) return;
    const p = pctFromEvent(e), s = dragRef.current;
    setDraft({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
  };
  const onUp = async () => {
    // จบการย้าย/ปรับขนาด
    const m = moveRef.current;
    if (m) {
      moveRef.current = null;
      const lv = live;
      setLive(null);
      if (m.moved && lv?.id === m.id) {
        hist.pushSnapshot(m.snap);           // ประวัติ = ตำแหน่งก่อนเริ่มลาก
        const patch = { x: +lv.x.toFixed(2), y: +lv.y.toFixed(2), w: +lv.w.toFixed(2), h: +lv.h.toFixed(2) };
        const { error } = await supabaseDR.from('mtn_rack_cells').update(patch).eq('id', m.id);
        if (error) { toast.error(error.message); loadCells(rackId); }
        else setCells(cs => cs.map(c => (c.id === m.id ? { ...c, ...patch } : c)));
      }
      return;
    }
    const d = draft; dragRef.current = null; setDraft(null);
    if (!d || d.w < 1.5 || d.h < 1.5) return;        // ลากสั้นเกิน = ถือว่าพลาด ไม่สร้างช่องจิ๋ว
    const code = prompt('รหัสชั้นวางของช่องนี้ (ต้องตรงกับช่อง "ตำแหน่งชั้นวาง" ของอะไหล่)\nเช่น A-01-3');
    if (!code?.trim()) return;
    await addCell(code.trim(), d);
  };

  const addCell = async (shelf_code, rect) => {
    hist.pushHistory();
    const { error } = await supabaseDR.from('mtn_rack_cells').insert({
      rack_id: rackId, shelf_code,
      x: +rect.x.toFixed(2), y: +rect.y.toFixed(2), w: +rect.w.toFixed(2), h: +rect.h.toFixed(2),
    });
    if (error) return toast.error(error.code === '23505' ? `รหัส "${shelf_code}" มีช่องอยู่แล้วในผังนี้` : error.message);
    loadCells(rackId);
  };
  const delCell = async (c) => {
    if (!confirm(`ลบช่อง "${c.shelf_code}" ออกจากผัง?\n(ตัวอะไหล่ไม่ถูกลบ · กด Undo คืนได้)`)) return;
    hist.pushHistory();
    checkWrite(await supabaseDR.from('mtn_rack_cells').delete().eq('id', c.id), 'ลบช่องชั้นวาง');
    setSelCell(null); loadCells(rackId);
  };
  const renameCell = async (c) => {
    const v = prompt('รหัสชั้นวางใหม่', c.shelf_code);
    if (!v?.trim() || v.trim() === c.shelf_code) return;
    hist.pushHistory();
    const { error } = await supabaseDR.from('mtn_rack_cells').update({ shelf_code: v.trim() }).eq('id', c.id);
    if (error) return toast.error(error.code === '23505' ? 'รหัสนี้มีช่องอยู่แล้ว' : error.message);
    loadCells(rackId);
  };

  const uploadImg = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file || !rack) return;
    try {
      const blob = await compressPlan(file);
      const path = `rack/${rack.id}_${Date.now()}.jpg`;
      const { error } = await supabaseDR.storage.from('mtn-images').upload(path, blob, { upsert: true, contentType: blob.type || 'image/jpeg' });
      if (error) throw error;
      const url = supabaseDR.storage.from('mtn-images').getPublicUrl(path).data.publicUrl;
      const old = rack.image_url;
      const { error: e2 } = await supabaseDR.from('mtn_rack_maps').update({ image_url: url }).eq('id', rack.id);
      if (e2) throw e2;
      if (old) removeRackImg(old);              // ลบไฟล์เก่าหลัง DB สำเร็จเท่านั้น (best-effort)
      toast.success('อัปโหลดรูปชั้นวางแล้ว'); loadRacks();
    } catch (err) { toast.error(err.message || 'อัปโหลดไม่สำเร็จ'); }
  };

  if (loading) return <div style={{ color: 'var(--muted)', padding: 20 }}>กำลังโหลด…</div>;

  return (
    <div>
      {/* ── แถบเครื่องมือ ── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <select value={rackId} onChange={e => setRackId(e.target.value)} style={{ ...inp, width: 250 }}>
          {!racks.length && <option value="">— ยังไม่มีผังชั้นวาง —</option>}
          {racks.map(r => <option key={r.id} value={r.id}>{r.section ? `[${sectionKeyOf(r.section)}] ` : ''}{r.name}</option>)}
        </select>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 หาของ — พิมพ์ชื่อ/รหัส/MAT แล้วดูว่าอยู่ช่องไหน"
          style={{ ...inp, width: 340, flex: '1 1 240px' }} />
        {canEdit && <>
          <button onClick={() => { setEdit(v => !v); setSelCell(null); }} style={{ ...(edit ? btnPri : btnGhost), padding: '8px 14px', fontSize: 12.5 }}>
            {edit ? '✓ เสร็จแล้ว' : '✏️ แก้ผัง'}
          </button>
          <button onClick={() => setShowRackForm({ mode: 'new' })} style={{ ...btnGhost, padding: '8px 13px', fontSize: 12.5 }}>➕ ผังใหม่</button>
          {rack && <button onClick={() => setShowRackForm({ mode: 'edit', rack })} style={{ ...btnGhost, padding: '8px 13px', fontSize: 12.5 }}>⚙️</button>}
        </>}
      </div>

      {!!q && (
        <div style={{ background: 'var(--bg3)', border: '1px solid var(--accent)', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 12.5 }}>
          {searchHits.length
            ? <>พบ <b>{searchHits.length}</b> รายการ · {searchHits.slice(0, 8).map(p => (
              <span key={p.id} style={{ marginRight: 10 }}>
                {p.name} → <b style={{ color: p.shelf ? 'var(--accent)' : '#f59e0b' }}>{p.shelf || 'ยังไม่ระบุชั้นวาง'}</b>
              </span>))}{searchHits.length > 8 && <span style={{ color: 'var(--muted)' }}>…อีก {searchHits.length - 8}</span>}</>
            : <span style={{ color: 'var(--muted)' }}>ไม่พบอะไหล่ตามคำค้น</span>}
        </div>
      )}

      {edit && (
        <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid #f59e0b', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 12.5 }}>
          ✏️ <b>โหมดแก้ผัง</b> — ลากบน<b>พื้นที่ว่าง</b>เพื่อสร้างช่องใหม่ · ลาก<b>ตัวช่อง</b>เพื่อย้าย · ลาก<b>มุมขวาล่าง</b>เพื่อปรับขนาด · กดช่องแล้วเปลี่ยนรหัส/ลบได้ที่แผงขวา
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
            <button onClick={hist.undo} disabled={!hist.canUndo || hist.busy} style={undoBtnStyle(hist.canUndo && !hist.busy)} title="Ctrl+Z">↩️ Undo</button>
            <button onClick={hist.redo} disabled={!hist.canRedo || hist.busy} style={undoBtnStyle(hist.canRedo && !hist.busy)} title="Ctrl+Y">↪️ Redo</button>
            {rack && <button onClick={() => setShowGrid(true)} style={{ ...btnGhost, padding: '6px 11px', fontSize: 12 }}>⊞ สร้างตารางอัตโนมัติ</button>}
          </div>
        </div>
      )}

      {!racks.length ? (
        <div style={{ background: 'var(--card)', border: '1px dashed var(--border)', borderRadius: 10, padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>🗺️</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>ยังไม่มีผังชั้นวาง</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.8 }}>
            ถ่ายรูป<b>ด้านหน้า</b>ของชั้นวางอะไหล่ → สร้างผังใหม่ → อัปโหลดรูป → ตีช่องแต่ละชั้น แล้วใส่รหัสชั้นวางให้ตรงกับที่กรอกในอะไหล่<br />
            จากนั้นค้นชื่ออะไหล่แล้วระบบจะบอกว่าอยู่ช่องไหนบนผัง
          </div>
          {canEdit && <button onClick={() => setShowRackForm({ mode: 'new' })} style={{ ...btnPri, marginTop: 14 }}>➕ สร้างผังชั้นวาง</button>}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 12, alignItems: 'start' }} className="mgrid">
          {/* ── ผัง ── */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: 10 }}>
            {!rack?.image_url ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', border: '1px dashed var(--border)', borderRadius: 8 }}>
                <div style={{ fontSize: 13, marginBottom: 10 }}>ยังไม่มีรูปชั้นวาง — อัปโหลดรูปด้านหน้าของชั้น</div>
                {canEdit && <label style={{ ...btnPri, display: 'inline-block', cursor: 'pointer' }}>
                  📷 อัปโหลดรูป<input type="file" accept="image/*" onChange={uploadImg} style={{ display: 'none' }} />
                </label>}
              </div>
            ) : (
              <div ref={wrapRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
                style={{ position: 'relative', width: '100%', userSelect: 'none', touchAction: edit ? 'none' : 'auto', cursor: edit ? 'crosshair' : 'default' }}>
                <img src={rack.image_url} alt={rack.name} style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 6 }} draggable={false} />
                {/* scrim ให้ช่องเด่นขึ้น (เหมือน FactoryMap) */}
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(6,8,14,0.22)', borderRadius: 6, pointerEvents: 'none' }} />

                {cells.map(c0 => {
                  const c = (live && live.id === c0.id) ? { ...c0, ...live } : c0;   // พรีวิวระหว่างลาก
                  const ps = partsOf(c.shelf_code);
                  const st = cellStatus(ps);
                  const isHit = hitCodes ? hitCodes.has(norm(c.shelf_code)) : false;
                  const dim = hitCodes && !isHit;
                  const sel = selCell?.id === c.id;
                  return (
                    <div key={c.id} data-cell={c.id}
                      onClick={(e) => { e.stopPropagation(); setSelCell(c0); }}
                      title={edit ? `${c.shelf_code} — ลากเพื่อย้าย · ลากมุมขวาล่างเพื่อปรับขนาด` : `${c.shelf_code} · ${ps.length} รายการ · ${st.label}`}
                      style={{
                        position: 'absolute', left: `${c.x}%`, top: `${c.y}%`, width: `${c.w}%`, height: `${c.h}%`,
                        border: `2px solid ${isHit ? '#facc15' : sel ? 'var(--accent)' : st.color}`,
                        background: isHit ? 'rgba(250,204,21,0.4)' : st.bg,
                        opacity: dim ? 0.28 : 1,
                        boxShadow: isHit ? '0 0 0 3px rgba(250,204,21,0.35)' : sel ? '0 0 0 3px rgba(61,214,92,0.3)' : 'none',
                        borderRadius: 4, cursor: edit ? 'move' : 'pointer', display: 'grid', placeItems: 'center', overflow: 'visible',
                        transition: live?.id === c.id ? 'none' : 'opacity .15s',
                      }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.9)', textAlign: 'center', lineHeight: 1.25, padding: 2, overflow: 'hidden' }}>
                        {c.label || c.shelf_code}
                        {!!ps.length && <div style={{ fontSize: 10, fontWeight: 700, opacity: 0.95 }}>{ps.length} รายการ</div>}
                      </div>
                      {/* มือจับปรับขนาด (มุมขวาล่าง) — โผล่เฉพาะโหมดแก้ผัง */}
                      {edit && (
                        <div data-handle="1" title="ลากเพื่อปรับขนาด"
                          style={{
                            position: 'absolute', right: -5, bottom: -5, width: 12, height: 12,
                            background: 'var(--accent)', border: '2px solid #fff', borderRadius: 3,
                            cursor: 'nwse-resize', boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
                          }} />
                      )}
                    </div>
                  );
                })}

                {draft && (
                  <div style={{ position: 'absolute', left: `${draft.x}%`, top: `${draft.y}%`, width: `${draft.w}%`, height: `${draft.h}%`, border: '2px dashed var(--accent)', background: 'rgba(61,214,92,0.2)', borderRadius: 4, pointerEvents: 'none' }} />
                )}
              </div>
            )}

            {/* legend */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8, fontSize: 11.5, color: 'var(--muted)' }}>
              {[['#22c55e', 'ปกติ'], ['#f59e0b', 'ต่ำกว่าขั้นต่ำ'], ['#ef4444', 'มีของหมด'], ['#6b7280', 'ว่าง'], ['#facc15', 'ผลการค้นหา']].map(([c, t]) => (
                <span key={t}><span style={{ display: 'inline-block', width: 10, height: 10, background: c, borderRadius: 2, marginRight: 4 }} />{t}</span>
              ))}
              <span style={{ marginLeft: 'auto' }}>{cells.length} ช่อง</span>
            </div>
          </div>

          {/* ── แผงขวา ── */}
          <div style={{ display: 'grid', gap: 10 }}>
            {selCell ? (
              <div style={{ background: 'var(--card)', border: '1px solid var(--accent)', borderRadius: 10, padding: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div style={{ fontSize: 15, fontWeight: 800 }}>📍 {selCell.shelf_code}</div>
                  <button onClick={() => setSelCell(null)} className="tbtn" style={{ ...btnGhost, marginLeft: 'auto', padding: '3px 8px', fontSize: 12 }}>✕</button>
                </div>
                {edit && (
                  <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                    <button onClick={() => renameCell(selCell)} style={{ ...btnGhost, padding: '5px 10px', fontSize: 12 }}>✏️ เปลี่ยนรหัส</button>
                    <button onClick={() => delCell(selCell)} style={{ ...btnGhost, padding: '5px 10px', fontSize: 12, color: '#ef4444' }}>🗑 ลบช่อง</button>
                  </div>
                )}
                {(() => {
                  const ps = partsOf(selCell.shelf_code);
                  if (!ps.length) return <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                    ช่องนี้ยังไม่มีอะไหล่ — ไปตั้ง "ตำแหน่งชั้นวาง" = <b>{selCell.shelf_code}</b> ที่แท็บคลังอะไหล่
                  </div>;
                  return <div style={{ display: 'grid', gap: 6 }}>
                    {ps.map(p => {
                      const st = stockState(p);
                      const rk = computeSpareRank(p, usage[p.id] || []);
                      return (
                        <div key={p.id} style={{ background: 'var(--bg3)', border: `1px solid ${st.color}`, borderRadius: 8, padding: '7px 9px' }}>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <span style={{ fontSize: 12.5, fontWeight: 700, flex: 1 }}>{p.name}</span>
                            {rk.rank && <span style={{ fontSize: 10.5, fontWeight: 800, color: RANK_META[rk.rank].color, border: `1px solid ${RANK_META[rk.rank].color}`, borderRadius: 4, padding: '0 5px' }}>{rk.rank}</span>}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                            {p.code ? `${p.code} · ` : ''}{p.mat_no || ''}
                          </div>
                          <div style={{ fontSize: 12, fontWeight: 800, color: st.color, marginTop: 3 }}>
                            คงเหลือ {fmtNum(p.stock_qty)} {p.unit || ''} {st.key !== 'ok' && `· ${st.label}`}
                          </div>
                        </div>
                      );
                    })}
                  </div>;
                })()}
              </div>
            ) : (
              <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, fontSize: 12.5, color: 'var(--muted)' }}>
                แตะช่องบนผังเพื่อดูว่ามีอะไหล่อะไรอยู่ · หรือพิมพ์ชื่อของในช่องค้นหาด้านบน แล้วช่องที่มีของจะไฮไลต์สีเหลือง
              </div>
            )}

            {/* ของที่ยังไม่มีตำแหน่งบนผัง — ห้ามปล่อยหายเงียบ */}
            {(!!unplaced.withShelf.length || !!unplaced.noShelf.length) && (
              <div style={{ background: 'var(--card)', border: '1px solid #f59e0b', borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: '#f59e0b', marginBottom: 6 }}>⚠️ ยังหาบนผังไม่เจอ</div>
                {!!unplaced.noShelf.length && (
                  <div style={{ fontSize: 12, marginBottom: 6 }}>
                    <b>{unplaced.noShelf.length}</b> รายการ <span style={{ color: 'var(--muted)' }}>ยังไม่ได้กรอกตำแหน่งชั้นวาง</span>
                  </div>
                )}
                {!!unplaced.withShelf.length && (
                  <div style={{ fontSize: 12 }}>
                    <b>{unplaced.withShelf.length}</b> รายการ <span style={{ color: 'var(--muted)' }}>มีรหัสชั้นวางแต่ยังไม่ได้ตีช่องบนผังไหนเลย:</span>
                    <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {[...new Set(unplaced.withShelf.map(p => p.shelf))].slice(0, 12).map(s => (
                        <span key={s} style={{ fontSize: 11, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 6px' }}>{s}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {showGrid && rack && <GridModal rackId={rack.id} existing={cells} onBeforeSave={() => hist.pushHistory()} onClose={() => setShowGrid(false)} onDone={() => { setShowGrid(false); loadCells(rack.id); }} />}
      {showRackForm && <RackFormModal {...showRackForm} teams={teams} myTeams={myTeams} secOpts={secOpts} defSection={mySection} onClose={() => setShowRackForm(null)}
        onSaved={(id) => { setShowRackForm(null); loadRacks().then(() => id && setRackId(id)); }} />}
    </div>
  );
}

/* ── สร้างตารางช่องอัตโนมัติ (แถว × คอลัมน์) — ชั้นวางเป็นตาราง ไม่ต้องลากทีละช่อง ── */
function GridModal({ rackId, existing, onClose, onDone, onBeforeSave }) {
  const [rows, setRows] = useState(4);
  const [cols, setCols] = useState(5);
  const [prefix, setPrefix] = useState('A');
  const [saving, setSaving] = useState(false);
  const [area, setArea] = useState({ x: 4, y: 4, w: 92, h: 92 });
  const [gap, setGap] = useState(1);

  const preview = useMemo(() => {
    const out = [];
    const cw = (area.w - gap * (cols - 1)) / cols;
    const ch = (area.h - gap * (rows - 1)) / rows;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      out.push({
        shelf_code: `${prefix}-${String(r + 1).padStart(2, '0')}-${c + 1}`,
        x: +(area.x + c * (cw + gap)).toFixed(2), y: +(area.y + r * (ch + gap)).toFixed(2),
        w: +cw.toFixed(2), h: +ch.toFixed(2),
      });
    }
    return out;
  }, [rows, cols, prefix, area, gap]);

  const dup = useMemo(() => {
    const have = new Set(existing.map(c => String(c.shelf_code).trim().toUpperCase()));
    return preview.filter(p => have.has(p.shelf_code.toUpperCase())).length;
  }, [preview, existing]);

  const save = async () => {
    setSaving(true);
    const have = new Set(existing.map(c => String(c.shelf_code).trim().toUpperCase()));
    const rowsToAdd = preview.filter(p => !have.has(p.shelf_code.toUpperCase())).map(p => ({ ...p, rack_id: rackId }));
    if (!rowsToAdd.length) { setSaving(false); return toast.error('ทุกรหัสมีช่องอยู่แล้ว'); }
    onBeforeSave?.();        // สร้างทีเดียวหลายสิบช่อง — ต้องกด Undo ล้างทั้งชุดได้
    const { error } = await supabaseDR.from('mtn_rack_cells').insert(rowsToAdd);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(`สร้าง ${rowsToAdd.length} ช่องแล้ว`); onDone();
  };

  const nf = (k, v, o = area, set = setArea) => set({ ...o, [k]: Number(v) || 0 });
  return (
    <div /* ⚠️ ฟอร์มกรอกข้อมูล — ไม่ปิดจาก backdrop กันเผลอแตะแล้วข้อมูลหาย (UI-CONVENTIONS §5) */  style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'grid', placeItems: 'center', zIndex: 2000, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 18, width: 'min(560px, 96vw)', maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 2 }}>⊞ สร้างตารางช่องอัตโนมัติ</div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 14 }}>ชั้นวางส่วนใหญ่เป็นตาราง — กำหนดจำนวนแถว/คอลัมน์แล้วปรับตำแหน่งทีหลังได้</div>
        <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div><label style={lbl}>จำนวนชั้น (แถว)</label><input type="number" min="1" max="20" value={rows} onChange={e => setRows(Math.max(1, Number(e.target.value) || 1))} style={inp} /></div>
          <div><label style={lbl}>ช่องต่อชั้น (คอลัมน์)</label><input type="number" min="1" max="20" value={cols} onChange={e => setCols(Math.max(1, Number(e.target.value) || 1))} style={inp} /></div>
          <div><label style={lbl}>ขึ้นต้นรหัส</label><input value={prefix} onChange={e => setPrefix(e.target.value)} style={inp} /></div>
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 6 }}>พื้นที่ตารางบนรูป (% ของรูป)</div>
        <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 12 }}>
          {[['x', 'ซ้าย'], ['y', 'บน'], ['w', 'กว้าง'], ['h', 'สูง']].map(([k, t]) => (
            <div key={k}><label style={lbl}>{t}</label><input type="number" min="0" max="100" value={area[k]} onChange={e => nf(k, e.target.value)} style={inp} /></div>
          ))}
          <div><label style={lbl}>ระยะห่าง</label><input type="number" min="0" max="10" step="0.5" value={gap} onChange={e => setGap(Number(e.target.value) || 0)} style={inp} /></div>
        </div>
        <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
            จะสร้าง <b style={{ color: 'var(--text)' }}>{preview.length}</b> ช่อง — ตัวอย่างรหัส: <b style={{ color: 'var(--accent)' }}>{preview[0]?.shelf_code}</b> … <b style={{ color: 'var(--accent)' }}>{preview[preview.length - 1]?.shelf_code}</b>
            {!!dup && <span style={{ color: '#f59e0b' }}> · ข้าม {dup} ช่องที่รหัสซ้ำของเดิม</span>}
          </div>
          {/* พรีวิวสัดส่วนจริง */}
          <div style={{ position: 'relative', width: '100%', paddingTop: '56%', background: 'var(--bg)', borderRadius: 6, overflow: 'hidden' }}>
            {preview.map(p => (
              <div key={p.shelf_code} style={{ position: 'absolute', left: `${p.x}%`, top: `${p.y}%`, width: `${p.w}%`, height: `${p.h}%`, border: '1px solid var(--accent)', background: 'rgba(61,214,92,0.15)', borderRadius: 2 }} />
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnGhost}>ยกเลิก</button>
          <button onClick={save} disabled={saving} style={{ ...btnPri, opacity: saving ? 0.5 : 1 }}>{saving ? 'กำลังสร้าง…' : `สร้าง ${preview.length - dup} ช่อง`}</button>
        </div>
      </div>
    </div>
  );
}

/* ── สร้าง/แก้ผังชั้นวาง ── */
function RackFormModal({ mode, rack, teams, myTeams, secOpts = [], defSection = '', onClose, onSaved }) {
  const [name, setName] = useState(rack?.name || '');
  const [team, setTeam] = useState(rack?.team || (myTeams.length === 1 ? teamKeyOf(myTeams[0]) : 'maintenance'));
  const [section, setSection] = useState(rack?.section || (rack ? '' : sectionKeyOf(defSection)));
  const [note, setNote] = useState(rack?.note || '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) return toast.error('ตั้งชื่อผัง');
    setSaving(true);
    if (mode === 'new') {
      const { data, error } = await supabaseDR.from('mtn_rack_maps')
        .insert({ name: name.trim(), team, section: sectionKeyOf(section) || null, note: note.trim() || null }).select('id').single();
      setSaving(false);
      if (error) return toast.error(error.message);
      toast.success('สร้างผังแล้ว — อัปโหลดรูปชั้นวางต่อได้เลย'); onSaved(data.id);
    } else {
      const { error } = await supabaseDR.from('mtn_rack_maps')
        .update({ name: name.trim(), team, section: sectionKeyOf(section) || null, note: note.trim() || null }).eq('id', rack.id);
      setSaving(false);
      if (error) return toast.error(error.message);
      toast.success('บันทึกแล้ว'); onSaved(rack.id);
    }
  };
  const del = async () => {
    if (!confirm(`ลบผัง "${rack.name}"?\nช่องทั้งหมดบนผังนี้จะถูกลบด้วย (ตัวอะไหล่ไม่ถูกลบ)`)) return;
    const { error } = await supabaseDR.from('mtn_rack_maps').update({ is_active: false }).eq('id', rack.id);
    if (error) return toast.error(error.message);
    toast.success('ลบผังแล้ว'); onSaved(null);
  };

  return (
    <div /* ⚠️ ฟอร์มกรอกข้อมูล — ไม่ปิดจาก backdrop กันเผลอแตะแล้วข้อมูลหาย (UI-CONVENTIONS §5) */  style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'grid', placeItems: 'center', zIndex: 2000, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 18, width: 'min(440px, 96vw)' }}>
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 14 }}>{mode === 'new' ? '➕ สร้างผังชั้นวาง' : '⚙️ แก้ไขผังชั้นวาง'}</div>
        <div style={{ display: 'grid', gap: 10 }}>
          <div><label style={lbl}>ชื่อผัง <span style={{ color: '#ef4444' }}>*</span></label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="เช่น ชั้นวาง A (ห้องอะไหล่ JIG)" style={inp} /></div>
          <div><label style={lbl}>ทีมที่ดูแล</label>
            <select value={team} onChange={e => setTeam(e.target.value)} style={inp}>
              {teams.map(t => <option key={t.key} value={t.key}>{t.icon || ''} {t.dept_name || t.label}</option>)}
            </select></div>
          <div><label style={lbl}>หน่วยงานเจ้าของ</label>
            <select value={sectionKeyOf(section)} onChange={e => setSection(e.target.value)} style={inp}>
              <option value="">{COMMON_SECTION_LABEL}</option>
              {secOpts.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
              {/* ค่าเดิมนอกลิสต์ต้องยังเลือกได้ ไม่งั้นเปิดแก้ไขแล้วหน่วยงานหายเงียบ */}
              {section && !secOpts.some(o => o.code === sectionKeyOf(section)) &&
                <option value={section}>⚠ {section} (ไม่มีในผัง)</option>}
            </select>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>แต่ละหน่วยงานเก็บของคนละพื้นที่ — ระบุไว้จะได้รู้ว่าผังนี้ของใคร</div></div>
          <div><label style={lbl}>หมายเหตุ</label><input value={note} onChange={e => setNote(e.target.value)} style={inp} /></div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          {mode === 'edit' && <button onClick={del} style={{ ...btnGhost, color: '#ef4444', marginRight: 'auto' }}>🗑 ลบผัง</button>}
          <button onClick={onClose} style={btnGhost}>ยกเลิก</button>
          <button onClick={save} disabled={saving} style={{ ...btnPri, opacity: saving ? 0.5 : 1 }}>บันทึก</button>
        </div>
      </div>
    </div>
  );
}
