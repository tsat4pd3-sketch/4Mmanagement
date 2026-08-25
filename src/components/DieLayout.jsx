/* ═══ DieLayout — 🗺️ ผังจัดเก็บแม่พิมพ์ (แท็บใน /die-registry) — 2026-08-19 ══════════════
   digital twin ของคลัง/พื้นที่วางแม่พิมพ์: รูปจริง 1 รูปต่อผัง + หมุดตำแหน่งแม่พิมพ์รายตัว
   (พิกัดเป็น % ของรูป 0-100 — pattern เดียวกับ RackMap/FactoryMap · เก็บที่
    equipment_die.area_id/pos_x/pos_y ตัวตนแม่พิมพ์ยังอยู่ machines)

   สีหมุด: ใบซ่อม MO ค้าง = แดง (pending = กระพริบตาม Andon) ชนะสถานะ manual เสมอ
   · ค้นหาแล้วหมุดที่ตรงไฮไลต์เหลือง · แม่พิมพ์ที่ยังไม่วาง = worklist ห้ามซ่อน
   · editor เขียน DB ทันที → มี Undo/Redo (UI-CONVENTIONS §6.7)                          */
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase, supabaseDR } from '../supabaseClient';
import { toast } from './Toast';
import useUndoHistory, { undoBtnStyle } from '../utils/useUndoHistory';
import { markerScale } from '../utils/markerScale';
import {
  DIE_STATUSES, DIE_STATUS_UNSET, dieStatusMeta, dieMarkerState, openMosOf,
  buildOpenMoMap, regrindOver, MO_STATUS_LABEL, MIGRATION_HINT,
} from '../utils/dieStatus';
import DieStatusEditor from './DieStatusEditor';

const inp = { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' };
const btnPri = { background: 'var(--accent)', color: '#071008', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' };
const btnGhost = { background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 13px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' };
const warnBox = { background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.45)', borderRadius: 10, padding: '10px 14px', fontSize: 12.5, color: 'var(--text)' };

/* รูปผังต้องซูมอ่านป้าย/เลขแม่พิมพ์ออก — สเปคเดียวกับรูปผังทั้งระบบ (2560px / q0.9 / ≤2.5MB)
   ห้ามบีบแรงกว่านี้ (ดู CLAUDE.md "Storage & รูปภาพ" — เคยบีบจนเบลอใช้ไม่ได้มาแล้ว) */
async function compressPlan(file) {
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
const imgPathOf = (url) => { const p = url?.split('/mtn-images/')[1]; return p ? decodeURIComponent(p) : null; };
const removeImg = (url) => { const p = imgPathOf(url); if (p) supabaseDR.storage.from('mtn-images').remove([p]).catch(() => {}); };

const clampPct = (v) => Math.max(1.5, Math.min(98.5, v));
const missErr = (e) => e && (e.code === '42703' || e.code === '42P01');

export default function DieLayout({
  dies, setsById, areas, openMos, products = [], canEdit, fullName, ready, reload, patchDieExt, reloadAreas,
  focusDieId, onFocusConsumed,
}) {
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [areaId, setAreaId] = useState('');
  const [edit, setEdit] = useState(false);
  const [q, setQ] = useState('');
  const [selId, setSelId] = useState(null);
  const [placingId, setPlacingId] = useState(null);
  const [live, setLive] = useState(null);            // {id,x,y} พรีวิวระหว่างลาก
  const [showLabels, setShowLabels] = useState(true); // 🏷️ สองสถานะ default โชว์ (UI §1)
  const [areaForm, setAreaForm] = useState(null);
  const [mapW, setMapW] = useState(800);
  const [mapH, setMapH] = useState(450);
  const wrapRef = useRef(null);
  const moveRef = useRef(null);

  const area = areas.find(a => a.id === areaId) || null;
  useEffect(() => {
    setAreaId(prev => (prev && areas.some(a => a.id === prev)) ? prev : (areas[0]?.id || ''));
  }, [areas]);

  /* ── 🔗 link กับผังรวมโรงงาน (/factory-map) — 2026-08-19 ──
     กรอบบนผังรวมที่ชื่อตรงกับชื่อผังนี้ (factory_line_regions.line_name · Main) = โซนคลังแม่พิมพ์
     คลิกโซนบนผังรวม → เด้งมาที่นี่พร้อม ?area=<id>&from=factory-map (pattern เดียวกับโซน facility → /mtn-layout) */
  const fromFactoryMap = sp.get('from') === 'factory-map';
  useEffect(() => {
    const want = sp.get('area');
    if (!want || !areas.length) return;
    const hit = areas.find(a => a.id === want)
      || areas.find(a => String(a.name || '').trim().toLowerCase() === want.trim().toLowerCase());
    if (hit) setAreaId(hit.id);
    const next = new URLSearchParams(sp); next.delete('area'); setSp(next, { replace: true });  // คง from= ไว้ให้ปุ่มกลับ
  }, [areas, sp]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ชื่อกรอบทั้งหมดบนผังรวม (Main) — ไว้บอกว่าผังนี้ถูกตีกรอบบนผังรวมแล้วหรือยัง (โหลดครั้งเดียว)
  const [mapZoneNames, setMapZoneNames] = useState(null);   // null = ยังไม่รู้ (โหลดไม่เสร็จ/พลาด) ≠ Set ว่าง
  useEffect(() => {
    supabase.from('factory_line_regions').select('line_name').then(({ data, error }) => {
      if (!error) setMapZoneNames(new Set((data || []).map(r => String(r.line_name || '').trim().toLowerCase())));
    });
  }, []);
  const onFactoryMap = !!(area && mapZoneNames?.has(String(area.name || '').trim().toLowerCase()));

  // วัดความกว้างผังจริง — markerScale ต้องรู้ (WYSIWYG ทุกหน้า)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    // ต้องวัดความสูงด้วย — markerScale คิดความแน่นจาก "ระยะเพื่อนบ้านเป็น px" ซึ่งต้องรู้ทั้ง 2 แกน
    const ro = new ResizeObserver(() => { setMapW(el.clientWidth || 800); setMapH(el.clientHeight || 450); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [area?.image_url, ready]);

  const moMap = useMemo(() => buildOpenMoMap(openMos), [openMos]);
  const activeDies = useMemo(() => dies.filter(d => d.is_active), [dies]);
  // 🏭 link แม่พิมพ์ ↔ ไลน์ผลิต: ชุดแม่พิมพ์ผูก MAT (die_sets.mat_no) → dr_products.line_name = ไลน์ที่ใช้พาร์ทนี้
  const matLine = useMemo(() => {
    const m = {};
    products.forEach(p => { if (p.mat_no && p.line_name) m[p.mat_no] = p.line_name; });
    return m;
  }, [products]);

  const placedHere = useMemo(
    () => activeDies.filter(d => d.ext?.area_id === areaId && d.ext?.pos_x != null && d.ext?.pos_y != null),
    [activeDies, areaId]);
  const unplaced = useMemo(
    () => activeDies.filter(d => !(d.ext?.area_id && d.ext?.pos_x != null && d.ext?.pos_y != null)),
    [activeDies]);

  // ⚠️ ต้องส่ง points+mapHeight ให้ครบเหมือน caller อื่น ไม่งั้นตกไป fallback สูตรนับจำนวนแบบเดิม
  //    = ผังจัดเก็บแม่พิมพ์ได้ขนาดหมุดคนละมาตรฐานกับผังอื่นทั้งระบบ (ผิดหลัก WYSIWYG ที่ util นี้มีไว้แก้)
  //    `pctOf` ใน markerScale รับคีย์ x/y อยู่แล้ว
  const mk = useMemo(
    () => markerScale(mapW, {
      machineCount: placedHere.length,
      points: placedHere.map(d => ({ x: d.ext.pos_x, y: d.ext.pos_y })),
      mapHeight: mapH,
    }),
    [mapW, mapH, placedHere],
  );

  const selDie = activeDies.find(d => d.id === selId) || null;
  const placingDie = activeDies.find(d => d.id === placingId) || null;
  const areaNameOf = useCallback((id) => areas.find(a => a.id === id)?.name || '(ผังที่ถูกลบ)', [areas]);
  const setNameOf = useCallback((d) => setsById[d.ext?.die_set_id]?.part_name || null, [setsById]);

  /* ── ค้นหา: เลขแม่พิมพ์ / ชื่อชุด / สถานะ ── */
  const hits = useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!kw) return null;
    return activeDies.filter(d => {
      const st = dieStatusMeta(d.ext?.die_status);
      return [d.machine_no, d.machine_name, d.line_name, setNameOf(d), st.label]
        .some(v => String(v || '').toLowerCase().includes(kw));
    });
  }, [q, activeDies, setNameOf]);
  const hitIds = useMemo(() => (hits ? new Set(hits.map(d => d.id)) : null), [hits]);

  /* ── Undo/Redo — snapshot = ตำแหน่งของแม่พิมพ์ทุกตัว (UI-CONVENTIONS §6.7) ── */
  const diesRef = useRef(dies); useEffect(() => { diesRef.current = dies; }, [dies]);
  const snapOf = useCallback(() => diesRef.current.map(d => ({
    machine_id: d.id, area_id: d.ext?.area_id ?? null,
    pos_x: d.ext?.pos_x ?? null, pos_y: d.ext?.pos_y ?? null,
  })), []);
  const applySnapshot = useCallback(async (snap) => {
    try {
      const curBy = new Map(diesRef.current.map(d => [d.id, d]));
      const changed = snap.filter(s => {
        const c = curBy.get(s.machine_id); if (!c) return false;
        const e = c.ext || {};
        return String(e.area_id ?? '') !== String(s.area_id ?? '')
          || String(e.pos_x ?? '') !== String(s.pos_x ?? '')
          || String(e.pos_y ?? '') !== String(s.pos_y ?? '');
      });
      for (const s of changed) {
        const { error } = await supabaseDR.from('equipment_die').upsert(s, { onConflict: 'machine_id' });
        if (error) throw error;
        patchDieExt(s.machine_id, { area_id: s.area_id, pos_x: s.pos_x, pos_y: s.pos_y });
      }
      return true;
    } catch (e) {
      toast.error('ย้อนกลับไม่สำเร็จ: ' + (e.message || ''));
      await reload();          // ให้จอตรงกับ DB จริงเสมอ
      return false;
    }
  }, [patchDieExt, reload]);
  const hist = useUndoHistory({ snapOf, applySnapshot, enabled: canEdit && edit });

  /* ── กระโดดมาจากแท็บอื่น (📊 สถานะ กด 🗺️) ── */
  useEffect(() => {
    if (!focusDieId) return;
    const d = activeDies.find(x => x.id === focusDieId);
    if (d) {
      setSelId(d.id);
      if (d.ext?.area_id && d.ext?.pos_x != null) setAreaId(d.ext.area_id);
      else toast.info('แม่พิมพ์ตัวนี้ยังไม่ได้วางบนผัง — ดูข้อมูลได้ที่แผงขวา');
    }
    onFocusConsumed?.();
  }, [focusDieId, activeDies, onFocusConsumed]);

  /* ── วาง / ย้าย / เอาออก ─────────────────────────────────────────── */
  const writePlacement = async (dieId, patch, snapForHist) => {
    if (snapForHist) hist.pushSnapshot(snapForHist); else hist.pushHistory();
    const { error } = await supabaseDR.from('equipment_die')
      .upsert({ machine_id: dieId, ...patch }, { onConflict: 'machine_id' });
    if (error) { toast.error(missErr(error) ? MIGRATION_HINT : 'บันทึกตำแหน่งไม่สำเร็จ: ' + error.message); await reload(); return false; }
    patchDieExt(dieId, patch);
    return true;
  };

  const pctFromEvent = (e) => {
    const r = wrapRef.current.getBoundingClientRect();
    return {
      x: clampPct(((e.clientX - r.left) / r.width) * 100),
      y: clampPct(((e.clientY - r.top) / r.height) * 100),
    };
  };

  const onDown = (e) => {
    if (!edit || !area?.image_url) return;
    const dieEl = e.target.closest('[data-die]');
    if (dieEl) {
      const id = dieEl.getAttribute('data-die');
      const d = placedHere.find(x => x.id === id);
      if (!d) return;
      moveRef.current = { id, start: pctFromEvent(e), orig: { x: +d.ext.pos_x, y: +d.ext.pos_y }, moved: false, snap: snapOf() };
      setSelId(id);
      e.currentTarget.setPointerCapture?.(e.pointerId);
      return;
    }
    if (placingId) {
      const p = pctFromEvent(e);
      writePlacement(placingId, { area_id: areaId, pos_x: +p.x.toFixed(2), pos_y: +p.y.toFixed(2) })
        .then(ok => { if (ok) { setSelId(placingId); setPlacingId(null); toast.success('วางแม่พิมพ์บนผังแล้ว'); } });
    }
  };
  const onMove = (e) => {
    const m = moveRef.current;
    if (!m) return;
    const p = pctFromEvent(e);
    const dx = p.x - m.start.x, dy = p.y - m.start.y;
    if (Math.abs(dx) > 0.2 || Math.abs(dy) > 0.2) m.moved = true;
    setLive({ id: m.id, x: clampPct(m.orig.x + dx), y: clampPct(m.orig.y + dy) });
  };
  const onUp = async () => {
    const m = moveRef.current;
    if (!m) return;
    moveRef.current = null;
    const lv = live; setLive(null);
    if (m.moved && lv?.id === m.id) {
      await writePlacement(m.id, { pos_x: +lv.x.toFixed(2), pos_y: +lv.y.toFixed(2) }, m.snap);
    }
  };

  const removeFromMap = async (d) => {
    if (!confirm(`เอา "${d.machine_no}" ออกจากผัง?\n(ตัวแม่พิมพ์/สถานะไม่ถูกลบ · กด Undo คืนได้)`)) return;
    const ok = await writePlacement(d.id, { area_id: null, pos_x: null, pos_y: null });
    if (ok) toast.success('เอาออกจากผังแล้ว');
  };

  /* ── รูปผัง ── */
  const uploadImg = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file || !area) return;
    try {
      const blob = await compressPlan(file);
      const path = `die-area/${area.id}_${Date.now()}.jpg`;
      const { error } = await supabaseDR.storage.from('mtn-images').upload(path, blob, { upsert: true, contentType: blob.type || 'image/jpeg' });
      if (error) throw error;
      const url = supabaseDR.storage.from('mtn-images').getPublicUrl(path).data.publicUrl;
      const old = area.image_url;
      const { error: e2 } = await supabaseDR.from('die_storage_areas').update({ image_url: url }).eq('id', area.id);
      if (e2) throw e2;
      if (old) removeImg(old);            // ลบไฟล์เก่าหลัง DB สำเร็จเท่านั้น (best-effort)
      toast.success('อัปโหลดรูปผังแล้ว');
      await reloadAreas();
    } catch (err) { toast.error(err.message || 'อัปโหลดไม่สำเร็จ'); }
  };

  /* ═══ render ═══ */
  if (!ready) {
    return (
      <div style={{ ...warnBox, marginTop: 4 }}>
        <b>⚠️ ยังใช้ผังจัดเก็บแม่พิมพ์ไม่ได้</b>
        <div style={{ marginTop: 4, lineHeight: 1.8 }}>
          {MIGRATION_HINT}<br />
          หลัง apply แล้ว refresh หน้านี้ — จะสร้างผัง (ถ่ายรูปคลัง/พื้นที่วางแม่พิมพ์) แล้ววางหมุดแม่พิมพ์รายตัวได้ทันที
        </div>
      </div>
    );
  }

  const legendItems = [
    ...DIE_STATUSES.map(s => [s.color, `${s.icon} ${s.label}`]),
    [DIE_STATUS_UNSET.color, `${DIE_STATUS_UNSET.icon} ยังไม่ระบุ`],
    ['#ef4444', '🔧 มีใบซ่อม MO ค้าง (รอรับงาน = กระพริบ)'],
    ['#facc15', '🔍 ผลการค้นหา'],
  ];

  return (
    <div>
      {/* ── แถบเครื่องมือ ── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        {fromFactoryMap && (
          <button onClick={() => navigate('/factory-map')} style={btnGhost}>← กลับผังรวมโรงงาน</button>
        )}
        <select value={areaId} onChange={e => { setAreaId(e.target.value); setSelId(null); setPlacingId(null); hist.clear(); }} style={{ ...inp, width: 240 }}>
          {!areas.length && <option value="">— ยังไม่มีผังจัดเก็บ —</option>}
          {areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <input value={q} onChange={e => setQ(e.target.value)}
          placeholder="🔍 หาแม่พิมพ์ — เลขแม่พิมพ์ / ชื่อพาร์ท / สถานะ"
          style={{ ...inp, width: 320, flex: '1 1 220px' }} />
        <button onClick={() => setShowLabels(v => !v)} style={{ ...btnGhost, padding: '8px 11px' }} title="โชว์/ซ่อนป้ายชื่อหมุด">
          🏷️ {showLabels ? 'ซ่อนป้าย' : 'โชว์ป้าย'}
        </button>
        {canEdit && <>
          <button onClick={() => { setEdit(v => !v); setPlacingId(null); }} style={{ ...(edit ? btnPri : btnGhost) }}>
            {edit ? '✓ เสร็จแล้ว' : '✏️ แก้ผัง'}
          </button>
          <button onClick={() => setAreaForm({ mode: 'new' })} style={btnGhost}>➕ ผังใหม่</button>
          {area && <button onClick={() => setAreaForm({ mode: 'edit', area })} style={btnGhost}>⚙️</button>}
        </>}
        {onFactoryMap && (
          <button onClick={() => navigate('/factory-map')} style={btnGhost} title="โซนนี้ถูกตีกรอบบนผังรวมโรงงานแล้ว — คลิกกรอบบนผังรวมเด้งกลับมาที่นี่ได้">
            🏭 ดูบนผังรวมโรงงาน
          </button>
        )}
      </div>
      {/* บอกสถานะ link กับผังรวม — ห้ามเงียบ: ตีกรอบแล้วโซนบนผังรวมจะโชว์สถานะแม่พิมพ์ + คลิกเด้งมาหน้านี้ */}
      {area && mapZoneNames && !onFactoryMap && (
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 10 }}>
          🔗 ผังนี้ยังไม่ถูกตีกรอบบนผังรวมโรงงาน — ไปที่ <b>ผังรวมโรงงาน → โหมดแก้ผัง</b> แล้วตีกรอบเลือกโซน
          "🔨 <b>{area.name}</b>" (โซนบนผังรวมจะโชว์จำนวน/ใบซ่อมค้างของแม่พิมพ์ และคลิกเด้งเข้าผังนี้)
        </div>
      )}

      {/* ผลค้นหา */}
      {!!hits && (
        <div style={{ background: 'var(--bg3)', border: '1px solid var(--accent)', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 12.5 }}>
          {hits.length ? <>
            พบ <b>{hits.length}</b> ตัว ·{' '}
            {hits.slice(0, 6).map(d => {
              const placed = d.ext?.area_id && d.ext?.pos_x != null;
              return (
                <button key={d.id} onClick={() => { setSelId(d.id); if (placed) setAreaId(d.ext.area_id); }}
                  title={d.machine_no}
                  style={{ ...btnGhost, padding: '2px 8px', fontSize: 11.5, marginRight: 6, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                  {d.machine_no} → <b style={{ color: placed ? 'var(--accent)' : '#f59e0b' }}>
                    {placed ? areaNameOf(d.ext.area_id) : 'ยังไม่วางบนผัง'}</b>
                </button>
              );
            })}
            {hits.length > 6 && <span style={{ color: 'var(--muted)' }}>…อีก {hits.length - 6}</span>}
          </> : <span style={{ color: 'var(--muted)' }}>ไม่พบแม่พิมพ์ตามคำค้น</span>}
        </div>
      )}

      {edit && (
        <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid #f59e0b', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 12.5 }}>
          ✏️ <b>โหมดแก้ผัง</b> — {placingDie
            ? <>คลิกตำแหน่งบนรูปเพื่อวาง <b style={{ color: 'var(--accent)' }}>{placingDie.machine_no}</b> <button onClick={() => setPlacingId(null)} style={{ ...btnGhost, padding: '2px 8px', fontSize: 11.5, marginLeft: 6 }}>ยกเลิก</button></>
            : <>เลือกแม่พิมพ์จากลิสต์ "ยังไม่ได้วางบนผัง" แล้วกด 📍 วาง · ลากหมุดเพื่อย้ายตำแหน่ง</>}
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button onClick={hist.undo} disabled={!hist.canUndo || hist.busy} style={undoBtnStyle(hist.canUndo && !hist.busy)} title="Ctrl+Z">↩️ Undo</button>
            <button onClick={hist.redo} disabled={!hist.canRedo || hist.busy} style={undoBtnStyle(hist.canRedo && !hist.busy)} title="Ctrl+Y">↪️ Redo</button>
          </div>
        </div>
      )}

      {!areas.length ? (
        <div style={{ background: 'var(--card)', border: '1px dashed var(--border)', borderRadius: 10, padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>🗺️</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>ยังไม่มีผังจัดเก็บแม่พิมพ์</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.8 }}>
            ถ่ายรูปคลัง/พื้นที่วางแม่พิมพ์ (มุมสูงหรือมุมที่เห็นช่องวางชัด) → สร้างผังใหม่ → อัปโหลดรูป → วางหมุดแม่พิมพ์รายตัว<br />
            จากนั้นค้นเลขแม่พิมพ์แล้วระบบจะชี้ว่าอยู่ตรงไหน + สีหมุดบอกสถานะ/ใบซ่อมค้าง
          </div>
          {canEdit && <button onClick={() => setAreaForm({ mode: 'new' })} style={{ ...btnPri, marginTop: 14 }}>➕ สร้างผังจัดเก็บ</button>}
        </div>
      ) : (
        <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 330px', gap: 12, alignItems: 'start' }}>
          {/* ── ผัง ── */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: 10 }}>
            {!area?.image_url ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', border: '1px dashed var(--border)', borderRadius: 8 }}>
                <div style={{ fontSize: 13, marginBottom: 10 }}>ยังไม่มีรูปผัง — อัปโหลดรูปคลัง/พื้นที่วางแม่พิมพ์</div>
                {canEdit && <label style={{ ...btnPri, display: 'inline-block', cursor: 'pointer' }}>
                  📷 อัปโหลดรูป<input type="file" accept="image/*" onChange={uploadImg} style={{ display: 'none' }} />
                </label>}
              </div>
            ) : (
              <div ref={wrapRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
                style={{
                  position: 'relative', width: '100%', userSelect: 'none',
                  touchAction: edit ? 'none' : 'auto',
                  cursor: edit ? (placingId ? 'crosshair' : 'default') : 'default',
                }}>
                <img src={area.image_url} alt={area.name} style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 6 }} draggable={false} />
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(6,8,14,0.22)', borderRadius: 6, pointerEvents: 'none' }} />

                {placedHere.map(d => {
                  const pos = (live && live.id === d.id) ? live : { x: +d.ext.pos_x, y: +d.ext.pos_y };
                  const st = dieMarkerState(d, moMap);
                  const isHit = hitIds ? hitIds.has(d.id) : false;
                  const dim = hitIds && !isHit;
                  const sel = selId === d.id;
                  const meta = dieStatusMeta(d.ext?.die_status);
                  return (
                    /* วงกลม + ป้ายใต้ ตาม UI-CONVENTIONS §1 — anchor ต้องเป๊ะ (กติกา 1):
                       ตัว wrapper ที่ translate(-50%,-50%) คือ "วงกลมเอง" สูงเท่าวงกลมเท่านั้น
                       ป้ายห้อยใต้ด้วย position:absolute top:100% (ห้าม flex column — จุดกึ่งกลางจะเลื่อนขึ้นครึ่งป้าย) */
                    <div key={d.id} data-die={d.id}
                      onClick={(e) => { e.stopPropagation(); setSelId(d.id); }}
                      title={`${d.machine_no}\n${st.label}${st.mos.length ? `\n${st.mos.map(o => o.mo_no || '(ยังไม่ออกเลข MO)').join(', ')}` : ''}`}
                      className={st.blink ? 'dt-alarm-blink' : ''}
                      style={{
                        position: 'absolute', left: `${pos.x}%`, top: `${pos.y}%`,
                        transform: 'translate(-50%,-50%)', cursor: edit ? 'move' : 'pointer',
                        opacity: dim ? 0.3 : 1, zIndex: sel ? 5 : 2,
                        transition: live?.id === d.id ? 'none' : 'opacity .15s',
                        width: mk.SUB, height: mk.SUB, borderRadius: '50%',
                        border: `${mk.subRing}px solid ${isHit ? '#facc15' : sel ? 'var(--accent)' : st.color}`,
                        background: st.mos.length ? '#7f1d1d' : meta.color,
                        display: 'grid', placeItems: 'center',
                        fontSize: Math.max(11, Math.round(mk.SUB * 0.42)),
                        boxShadow: isHit ? '0 0 0 4px rgba(250,204,21,0.4)' : sel ? '0 0 0 4px rgba(61,214,92,0.35)' : '0 1px 4px rgba(0,0,0,0.5)',
                      }}>
                      {st.mos.length ? '🔧' : meta.icon}
                      {showLabels && (
                        <div style={{
                          position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
                          marginTop: 2, fontSize: mk.subPillFont, fontWeight: 700, color: '#fff',
                          background: 'rgba(9,11,18,0.82)', border: `1px solid ${isHit ? '#facc15' : st.color}`,
                          borderRadius: 6, padding: '1px 6px', maxWidth: mk.subPillMaxW,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>{d.machine_no}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* legend — หมุด 3 ตัวเลขไม่พอ ต้องมีคำอธิบายเสมอ */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8, fontSize: 11.5, color: 'var(--muted)' }}>
              {legendItems.map(([c, t]) => (
                <span key={t}><span style={{ display: 'inline-block', width: 10, height: 10, background: c, borderRadius: '50%', marginRight: 4 }} />{t}</span>
              ))}
              <span style={{ marginLeft: 'auto' }}>วางแล้ว {placedHere.length} ตัวในผังนี้</span>
            </div>
            {area?.image_url && canEdit && edit && (
              <div style={{ marginTop: 8 }}>
                <label style={{ ...btnGhost, display: 'inline-block', cursor: 'pointer', fontSize: 12 }}>
                  📷 เปลี่ยนรูปผัง<input type="file" accept="image/*" onChange={uploadImg} style={{ display: 'none' }} />
                </label>
              </div>
            )}
          </div>

          {/* ── แผงขวา ── */}
          <div style={{ display: 'grid', gap: 10 }}>
            {selDie ? (
              <div style={{ background: 'var(--card)', border: '1px solid var(--accent)', borderRadius: 10, padding: 12 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 800, wordBreak: 'break-word', flex: 1 }}>🔨 {selDie.machine_no}</div>
                  <button onClick={() => setSelId(null)} style={{ ...btnGhost, padding: '3px 8px', fontSize: 12 }}>✕</button>
                </div>
                {(() => {
                  const e = selDie.ext || {};
                  const setName = setNameOf(selDie);
                  const placed = e.area_id && e.pos_x != null;
                  const mos = openMosOf(selDie, moMap);
                  const dieSet = setsById[e.die_set_id];
                  const feedLine = dieSet?.mat_no ? matLine[dieSet.mat_no] : null;   // ไลน์ผลิตที่ใช้พาร์ทของชุดนี้
                  return (
                    <div style={{ display: 'grid', gap: 8, fontSize: 12 }}>
                      <div style={{ color: 'var(--muted)', lineHeight: 1.7 }}>
                        {setName && <>ชุด <b style={{ color: 'var(--text)' }}>{setName}</b>{e.op_seq != null && <> · OP{e.op_seq}</>}<br /></>}
                        {feedLine && <>🏭 ป้อนไลน์ผลิต <b style={{ color: 'var(--text)' }}>{feedLine}</b>{dieSet?.mat_no ? ` (MAT ${dieSet.mat_no})` : ''}<br /></>}
                        {selDie.line_name && <>เครื่องปั๊ม {selDie.line_name} · </>}
                        ตัน {e.tonnage_ton ?? '—'} · shot {Number(e.shot_total || 0).toLocaleString()} ·
                        เจียร {e.regrind_count || 0}{e.regrind_limit ? `/${e.regrind_limit}` : ''}
                        {regrindOver(e) && <b style={{ color: '#ef4444' }}> ⚠️ เจียรครบเกณฑ์แล้ว</b>}
                      </div>

                      {/* ใบซ่อมค้าง — derive จากระบบ MO จริง */}
                      {mos.length > 0 && (
                        <div style={{ border: '1px solid #ef4444', background: 'rgba(239,68,68,0.1)', borderRadius: 8, padding: '7px 9px' }}>
                          <div style={{ fontSize: 12, fontWeight: 800, color: '#ef4444', marginBottom: 3 }}>🔧 ใบซ่อม MO ค้าง {mos.length} ใบ</div>
                          {mos.map(o => (
                            <div key={o.id} style={{ fontSize: 11.5, lineHeight: 1.7 }}>
                              <b>{o.mo_no || '(ยังไม่ออกเลข MO)'}</b> · {MO_STATUS_LABEL[o.status] || o.status}
                              {o.report_at && <span style={{ color: 'var(--muted)' }}> · แจ้ง {new Date(o.report_at).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' })}</span>}
                            </div>
                          ))}
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>ดำเนินการต่อที่หน้า 🛠️ แจ้งซ่อม (MO)</div>
                        </div>
                      )}

                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>สถานะแม่พิมพ์</div>
                        <DieStatusEditor die={selDie} canEdit={canEdit} fullName={fullName} ready={ready} compact
                          onSaved={(patch) => patchDieExt(selDie.id, patch)} />
                      </div>

                      <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                        📍 {placed ? <>อยู่ผัง <b style={{ color: 'var(--text)' }}>{areaNameOf(e.area_id)}</b></> : 'ยังไม่ได้วางบนผัง'}
                      </div>
                      {canEdit && edit && (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button onClick={() => setPlacingId(selDie.id)} style={{ ...btnGhost, padding: '5px 10px', fontSize: 12 }}>
                            📍 {placed ? 'วางตำแหน่งใหม่' : 'วางบนผังนี้'}
                          </button>
                          {placed && (
                            <button onClick={() => removeFromMap(selDie)} style={{ ...btnGhost, padding: '5px 10px', fontSize: 12, color: '#ef4444' }}>
                              ✕ เอาออกจากผัง
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, fontSize: 12.5, color: 'var(--muted)' }}>
                แตะหมุดบนผังเพื่อดูรายละเอียด/เปลี่ยนสถานะแม่พิมพ์ · หรือพิมพ์เลขแม่พิมพ์ในช่องค้นหา แล้วหมุดที่ตรงจะไฮไลต์สีเหลือง
              </div>
            )}

            {/* worklist — แม่พิมพ์ที่ยังไม่ได้วางบนผังไหนเลย ห้ามซ่อน */}
            {unplaced.length > 0 && (
              <div style={{ background: 'var(--card)', border: '1px solid #f59e0b', borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: '#f59e0b', marginBottom: 6 }}>
                  ⚠️ ยังไม่ได้วางบนผัง {unplaced.length} ตัว
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 6 }}>
                  {canEdit ? (edit ? 'กด 📍 แล้วคลิกตำแหน่งบนรูป' : 'กด "✏️ แก้ผัง" ก่อน แล้วไล่วางทีละตัว') : 'ให้ผู้มีสิทธิ์แก้ไขเครื่องจักรเป็นคนวาง'}
                </div>
                <div style={{ display: 'grid', gap: 4, maxHeight: 300, overflowY: 'auto' }}>
                  {unplaced
                    .filter(d => !hitIds || hitIds.has(d.id))
                    .slice(0, 60)
                    .map(d => (
                      <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 7, padding: '4px 8px' }}>
                        <span onClick={() => setSelId(d.id)} title={d.machine_no}
                          style={{ flex: 1, fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}>
                          {d.machine_no}
                        </span>
                        {canEdit && edit && (
                          <button onClick={() => { setSelId(d.id); setPlacingId(d.id); }}
                            style={{ ...btnGhost, padding: '2px 8px', fontSize: 11, borderColor: placingId === d.id ? 'var(--accent)' : 'var(--border)' }}>
                            📍 วาง
                          </button>
                        )}
                      </div>
                    ))}
                  {unplaced.length > 60 && (
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>…อีก {unplaced.length - 60} ตัว (ใช้ช่องค้นหากรองก่อน)</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {areaForm && (
        <AreaFormModal {...areaForm} onClose={() => setAreaForm(null)}
          onSaved={async (id) => { setAreaForm(null); await reloadAreas(); if (id) setAreaId(id); }} />
      )}
    </div>
  );
}

/* ── สร้าง/แก้ผังจัดเก็บ ── */
function AreaFormModal({ mode, area, onClose, onSaved }) {
  const [name, setName] = useState(area?.name || '');
  const [note, setNote] = useState(area?.note || '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) return toast.error('ตั้งชื่อผังก่อน (เช่น คลังแม่พิมพ์หลัก / ข้างไลน์ LINE A)');
    setSaving(true);
    if (mode === 'new') {
      const { data, error } = await supabaseDR.from('die_storage_areas')
        .insert({ name: name.trim(), note: note.trim() || null }).select('id').single();
      setSaving(false);
      if (error) return toast.error(missErr(error) ? MIGRATION_HINT : error.message);
      toast.success('สร้างผังแล้ว — อัปโหลดรูปพื้นที่จัดเก็บต่อได้เลย');
      onSaved(data.id);
    } else {
      const { error } = await supabaseDR.from('die_storage_areas')
        .update({ name: name.trim(), note: note.trim() || null }).eq('id', area.id);
      setSaving(false);
      if (error) return toast.error(error.message);
      // ⚠️ cascade ชื่อไปกรอบบนผังรวมโรงงาน (Main factory_line_regions) — link จับคู่ด้วย "ชื่อ"
      //    (ข้าม project FK ไม่ได้) เปลี่ยนชื่อแล้วไม่ตามไปแก้ = กรอบบนผังรวมกำพร้าเงียบๆ (กฎ rename cascade)
      if (name.trim() !== (area.name || '').trim()) {
        const norm = (s) => String(s || '').trim().toLowerCase();
        const { data: regs, error: rerr } = await supabase.from('factory_line_regions').select('id, line_name');
        const hit = rerr ? null : (regs || []).find(r => norm(r.line_name) === norm(area.name));
        if (hit) {
          const { error: uerr } = await supabase.from('factory_line_regions')
            .update({ line_name: name.trim() }).eq('id', hit.id);
          if (uerr) toast.error('เปลี่ยนชื่อผังแล้ว แต่กรอบบนผังรวมโรงงานยังเป็นชื่อเดิม — ไปแก้ที่ผังรวมเอง (' + uerr.message + ')');
          else toast.info('เปลี่ยนชื่อกรอบบนผังรวมโรงงานตามให้แล้ว');
        } else if (rerr) {
          toast.error('เปลี่ยนชื่อผังแล้ว แต่เช็คกรอบบนผังรวมโรงงานไม่สำเร็จ — ถ้าเคยตีกรอบไว้ให้ไปแก้ชื่อที่ผังรวมด้วย');
        }
      }
      toast.success('บันทึกแล้ว');
      onSaved(area.id);
    }
  };
  const del = async () => {
    if (!confirm(`ลบผัง "${area.name}"?\nหมุดแม่พิมพ์บนผังนี้จะกลายเป็น "ยังไม่ได้วาง" (ตัวแม่พิมพ์ไม่ถูกลบ)`)) return;
    // soft delete ผัง + ปลดหมุดของแม่พิมพ์ที่ผูกอยู่ (ไม่งั้นค้างชี้ผังที่มองไม่เห็น)
    const { error } = await supabaseDR.from('die_storage_areas').update({ is_active: false }).eq('id', area.id);
    if (error) return toast.error(error.message);
    const { error: e2 } = await supabaseDR.from('equipment_die')
      .update({ area_id: null, pos_x: null, pos_y: null }).eq('area_id', area.id);
    if (e2) toast.error('ลบผังแล้ว แต่ปลดหมุดไม่สำเร็จ: ' + e2.message);   // ห้ามเงียบ
    else toast.success('ลบผังแล้ว');
    onSaved(null);
  };

  const lbl = { display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 4 };
  return (
    <div /* ⚠️ ฟอร์มกรอกข้อมูล — ไม่ปิดจาก backdrop กันเผลอแตะแล้วข้อมูลหาย (UI-CONVENTIONS §5) */  style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'grid', placeItems: 'center', zIndex: 2000, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 18, width: 'min(440px, 96vw)' }}>
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 14 }}>{mode === 'new' ? '➕ สร้างผังจัดเก็บแม่พิมพ์' : '⚙️ แก้ไขผังจัดเก็บ'}</div>
        <div style={{ display: 'grid', gap: 10 }}>
          <div><label style={lbl}>ชื่อผัง <span style={{ color: '#ef4444' }}>*</span></label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="เช่น คลังแม่พิมพ์หลัก / โซนข้าง LINE A (800 Ton)" style={inp} /></div>
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
