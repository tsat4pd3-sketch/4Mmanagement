import { useState, useEffect, useContext, useRef, useCallback } from 'react';
import imageCompression from 'browser-image-compression';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { can } from '../utils/permissions';
import { toast } from '../components/Toast';

/* ── ผังรวมโรงงาน (Factory Master Map) — polygon อิสระ, 2026-07-16 ───────────────
   รูปผังใหญ่ทั้งโรงงาน 1 รูป + วาด "รูปทรงอิสระ" ล้อมพื้นที่แต่ละไลน์ (factory_line_regions.points)
   รองรับไลน์รูป L / U shape (ไม่ใช่แค่สี่เหลี่ยม) — แต่ละรูประบายสีตามสถานะการผลิต + โชว์ยอด/เป้า
   - View: ทุก role · Edit (อัปโหลด/วาด/ย้ายจุด/ลบ): can('factory_map','edit')
   - points = [[x,y],...] เป็น % ของรูปจริง (0-100) — รูปแสดง width:100% height:auto → % ตรงเป๊ะ
   - วาด: SVG polygon (viewBox 0 0 100 100, preserveAspectRatio=none, stroke non-scaling)
*/

function getWorkDate() {
  const d = new Date();
  if (d.getHours() < 8) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const STATUS_META = {
  down:      { color: '#ef4444', label: 'Downtime', blink: true },
  producing: { color: '#22c55e', label: 'กำลังผลิต' },
  behind:    { color: '#f59e0b', label: 'ตามหลังเป้า' },
  idle:      { color: '#6b7280', label: 'ไม่มีแผน/ปิดกะ' },
};

const round = (v) => Math.round(v * 100) / 100;
const centroid = (pts) => pts.length
  ? [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length]
  : [50, 50];

export default function FactoryMap() {
  const { role } = useContext(UserContext);
  const canEdit = can('factory_map', 'edit', role);

  const [imageUrl, setImageUrl] = useState(null);
  const [mapId, setMapId] = useState(null);
  const [regions, setRegions] = useState([]);        // [{id, line_name, points:[[x,y]...]}]
  const [lineStatus, setLineStatus] = useState({});
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [aspect, setAspect] = useState(null);

  const [drawing, setDrawing] = useState(false);
  const [draft, setDraft] = useState([]);            // จุดที่กำลังวาด [[x,y]...]
  const [hoverPt, setHoverPt] = useState(null);       // ตำแหน่งเมาส์ระหว่างวาด (preview เส้น)
  const wrapRef = useRef(null);
  const dragRef = useRef(null);                       // { id, vi:number|-1, px, py, base:[[x,y]...] }

  /* ── โหลดผัง + รูปทรง + ไลน์ ── */
  const loadMap = useCallback(async () => {
    const [{ data: fm }, { data: rg }, { data: ln }] = await Promise.all([
      supabase.from('factory_map').select('id, image_url').order('updated_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('factory_line_regions').select('id, line_name, points'),
      supabase.from('production_lines').select('id, name, parent_line_name').order('name'),
    ]);
    setImageUrl(fm?.image_url || null);
    setMapId(fm?.id || null);
    setRegions((rg || []).map(r => ({ ...r, points: Array.isArray(r.points) ? r.points : [] })));
    setLines(ln || []);
    setLoading(false);
  }, []);
  useEffect(() => { loadMap(); }, [loadMap]);

  /* ── สถานะการผลิตรายไลน์ (DR) — refresh 30 วิ ── */
  const loadStatus = useCallback(async () => {
    const workDate = getWorkDate();
    const { data: sessions } = await supabaseDR
      .from('production_sessions').select('id, line_name, status').eq('work_date', workDate);
    if (!sessions?.length) { setLineStatus({}); return; }
    const sessIds = sessions.map(s => s.id);
    const [{ data: orders }, { data: dts }] = await Promise.all([
      supabaseDR.from('prod_orders').select('session_id, status, qty, qty_ok, qty_actual, qty_target').in('session_id', sessIds),
      supabaseDR.from('downtime_logs').select('session_id, duration_min, ended_at').in('session_id', sessIds),
    ]);
    const ordBySess = {}; (orders || []).forEach(o => { (ordBySess[o.session_id] ||= []).push(o); });
    const openDtSess = new Set((dts || []).filter(d => !d.ended_at && d.duration_min == null).map(d => d.session_id));
    const byLine = {};
    sessions.forEach(s => {
      const os = ordBySess[s.id] || [];
      const target = os.reduce((a, o) => a + (o.qty_target ?? o.qty ?? 0), 0);
      const actual = os.reduce((a, o) => a + (o.status === 'confirmed' ? (o.qty_ok ?? o.qty ?? 0) : (o.qty_actual ?? 0)), 0);
      const acc = byLine[s.line_name] || { target: 0, actual: 0, hasOpen: false, down: false };
      byLine[s.line_name] = { target: acc.target + target, actual: acc.actual + actual, hasOpen: acc.hasOpen || s.status === 'open', down: acc.down || openDtSess.has(s.id) };
    });
    const out = {};
    Object.entries(byLine).forEach(([name, v]) => {
      const pct = v.target > 0 ? Math.round((v.actual / v.target) * 100) : null;
      out[name] = { status: v.down ? 'down' : v.hasOpen ? (pct != null && pct < 80 ? 'behind' : 'producing') : 'idle', actual: v.actual, target: v.target, pct };
    });
    setLineStatus(out);
  }, []);
  useEffect(() => { loadStatus(); const t = setInterval(loadStatus, 30000); return () => clearInterval(t); }, [loadStatus]);

  /* ── อัปโหลดรูปผัง (บีบเบา 2560/2.5MB/q0.9) ── */
  const handleUpload = async (e) => {
    const file = e.target.files?.[0]; if (!file) return; e.target.value = '';
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const isGif = file.type === 'image/gif' || ext === 'gif';
    if (isGif && file.size > 2 * 1024 * 1024) return toast.error('GIF ต้องไม่เกิน 2MB');
    try {
      setUploading(true);
      const blob = isGif ? file : await imageCompression(file, { maxSizeMB: 2.5, maxWidthOrHeight: 2560, initialQuality: 0.9 });
      const path = `factory/map_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('employee-photos').upload(path, blob);
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('employee-photos').getPublicUrl(path);
      const row = mapId
        ? await supabase.from('factory_map').update({ image_url: pub.publicUrl, updated_at: new Date().toISOString() }).eq('id', mapId).select('id').single()
        : await supabase.from('factory_map').insert({ image_url: pub.publicUrl }).select('id').single();
      if (row.error) throw row.error;
      const prev = imageUrl;
      if (prev?.includes('/employee-photos/factory/')) {
        const oldName = decodeURIComponent(prev.split('/employee-photos/')[1] || '');
        if (oldName.startsWith('factory/')) supabase.storage.from('employee-photos').remove([oldName]).catch(() => {});
      }
      setMapId(row.data.id); setImageUrl(pub.publicUrl); setAspect(null);
      toast.success('อัปโหลดผังโรงงานแล้ว');
    } catch (err) { toast.error('อัปโหลดไม่สำเร็จ: ' + err.message); }
    finally { setUploading(false); }
  };

  const pctFromEvent = (clientX, clientY) => {
    const r = wrapRef.current.getBoundingClientRect();
    return { x: Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)), y: Math.min(100, Math.max(0, ((clientY - r.top) / r.height) * 100)) };
  };

  const assignableLines = () => lines.map(l => l.name).filter(n => !regions.some(r => r.line_name === n));

  /* ── วาดรูปทรงใหม่: คลิกทีละจุด, คลิกใกล้จุดแรก/กดเสร็จ = ปิดรูป ── */
  const onMapClick = (e) => {
    if (!editing || !drawing) return;
    if (e.target.closest('[data-handle]') || e.target.closest('button')) return;
    const p = pctFromEvent(e.clientX, e.clientY);
    if (draft.length >= 3) {
      const f = draft[0];
      if (Math.hypot(f[0] - p.x, f[1] - p.y) < 2.5) return finishDraw();
    }
    setDraft(prev => [...prev, [round(p.x), round(p.y)]]);
  };
  const onMapMove = (e) => {
    if (drawing && draft.length) { const p = pctFromEvent(e.clientX, e.clientY); setHoverPt([round(p.x), round(p.y)]); return; }
    if (dragRef.current) {
      const p = pctFromEvent(e.clientX, e.clientY);
      const d = dragRef.current, dx = p.x - d.px, dy = p.y - d.py;
      setRegions(prev => prev.map(r => {
        if (r.id !== d.id) return r;
        const pts = d.base.map((pt, i) => (d.vi === -1 || d.vi === i)
          ? [Math.min(100, Math.max(0, round(pt[0] + dx))), Math.min(100, Math.max(0, round(pt[1] + dy)))]
          : pt);
        return { ...r, points: pts };
      }));
    }
  };
  const finishDraw = async () => {
    const pts = draft; setDraft([]); setHoverPt([]); setDrawing(false); setHoverPt(null);
    if (pts.length < 3) return;
    const remaining = assignableLines();
    if (!remaining.length) return toast.error('ทุกไลน์ถูกวางกรอบแล้ว');
    const name = window.prompt(`วาดให้ไลน์ไหน? พิมพ์ชื่อไลน์ให้ตรง:\n${remaining.join(', ')}`);
    if (!name) return;
    const match = remaining.find(n => n.toLowerCase() === name.trim().toLowerCase());
    if (!match) return toast.error('ไม่พบชื่อไลน์นี้ (หรือมีกรอบแล้ว)');
    const { data, error } = await supabase.from('factory_line_regions').insert({ line_name: match, points: pts }).select().single();
    if (error) return toast.error('บันทึกไม่สำเร็จ: ' + error.message);
    setRegions(prev => [...prev, { ...data, points: pts }]);
    toast.success(`ตีกรอบ ${match} แล้ว`);
  };
  const cancelDraw = () => { setDraft([]); setHoverPt(null); setDrawing(false); };

  const startDrag = (e, region, vi) => {
    if (!editing || drawing) return;
    e.stopPropagation();
    wrapRef.current?.setPointerCapture?.(e.pointerId);
    const p = pctFromEvent(e.clientX, e.clientY);
    dragRef.current = { id: region.id, vi, px: p.x, py: p.y, base: region.points.map(pt => [...pt]) };
  };
  const endDrag = async () => {
    if (!dragRef.current) return;
    const id = dragRef.current.id; dragRef.current = null;
    const r = regions.find(x => x.id === id);
    if (r) await supabase.from('factory_line_regions').update({ points: r.points }).eq('id', id);
  };
  const deleteRegion = async (id) => { setRegions(prev => prev.filter(r => r.id !== id)); await supabase.from('factory_line_regions').delete().eq('id', id); };

  const onImgLoad = (e) => setAspect(e.target.naturalWidth / e.target.naturalHeight);
  const wrapStyle = aspect ? { width: `min(100%, calc((100vh - 210px) * ${aspect}))` } : { width: '100%' };
  const ptsStr = (pts) => pts.map(p => `${p[0]},${p[1]}`).join(' ');

  return (
    <div className="page-content" style={{ maxWidth: 'min(97vw, 2200px)', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'clamp(16px,3vw,22px)', color: 'var(--text)' }}>🗺️ ผังรวมโรงงาน</h2>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--muted)' }}>สถานะการผลิตของทุกไลน์บนผังเดียว — อัปเดตอัตโนมัติทุก 30 วินาที</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {Object.entries(STATUS_META).map(([k, m]) => (
            <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text2)' }}>
              <span style={{ width: 11, height: 11, borderRadius: 3, background: m.color, display: 'inline-block' }} /> {m.label}
            </span>
          ))}
          {canEdit && <button onClick={() => { setEditing(v => !v); cancelDraw(); }} style={btn(editing)}>{editing ? '✓ เสร็จ' : '✏️ แก้ผัง'}</button>}
        </div>
      </div>

      {editing && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', marginBottom: 12 }}>
          <label style={{ ...btn(false), display: 'inline-flex', alignItems: 'center', gap: 6, cursor: uploading ? 'default' : 'pointer' }}>
            {uploading ? '⏳ กำลังอัปโหลด...' : (imageUrl ? '🖼️ เปลี่ยนรูปผัง' : '🖼️ อัปโหลดรูปผังโรงงาน')}
            <input type="file" accept="image/*" onChange={handleUpload} disabled={uploading} style={{ display: 'none' }} />
          </label>
          {imageUrl && !drawing && <button onClick={() => { setDrawing(true); setDraft([]); }} disabled={!assignableLines().length} style={btn(false)}>✏️ วาดกรอบไลน์ใหม่</button>}
          {drawing && (
            <>
              <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 700 }}>🖊️ คลิกทีละจุดล้อมพื้นที่ไลน์ (L/U ได้) · คลิกจุดแรกซ้ำ = ปิดรูป</span>
              <button onClick={finishDraw} disabled={draft.length < 3} style={btn(true)}>✓ เสร็จ ({draft.length} จุด)</button>
              <button onClick={() => setDraft(p => p.slice(0, -1))} disabled={!draft.length} style={btn(false)}>↩ ลบจุดล่าสุด</button>
              <button onClick={cancelDraw} style={btn(false)}>✕ ยกเลิก</button>
            </>
          )}
          {!drawing && <span style={{ fontSize: 12, color: 'var(--muted)' }}>ลากกลางรูป=ย้ายทั้งไลน์ · ลากจุดมุม=ปรับรูปทรง</span>}
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>ตีกรอบแล้ว {regions.length}/{lines.length} ไลน์</span>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>กำลังโหลด...</div>
      ) : !imageUrl ? (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--muted)', background: 'var(--card)', border: '1px dashed var(--border2)', borderRadius: 12 }}>
          ยังไม่มีรูปผังโรงงาน — {canEdit ? 'กด "✏️ แก้ผัง" แล้วอัปโหลดรูป' : 'ให้ผู้ดูแลอัปโหลดรูปผังก่อน'}
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <div ref={wrapRef} onClick={onMapClick} onPointerMove={onMapMove} onPointerUp={endDrag} onPointerCancel={endDrag}
            style={{ position: 'relative', ...wrapStyle, maxHeight: 'calc(100vh - 200px)', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)', cursor: drawing ? 'crosshair' : 'default', touchAction: 'none', background: '#0a0a0f' }}>
            <img src={imageUrl} alt="ผังโรงงาน" onLoad={onImgLoad} style={{ display: 'block', width: '100%', height: 'auto', pointerEvents: 'none', userSelect: 'none' }} />

            {/* SVG รูปทรงไลน์ (preserveAspectRatio=none → % ตรงกับรูป · stroke ไม่ยืดด้วย non-scaling) */}
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
              {regions.map(r => {
                const st = lineStatus[r.line_name]; const meta = STATUS_META[st?.status || 'idle'];
                return (
                  <polygon key={r.id} data-region points={ptsStr(r.points)}
                    className={meta.blink ? 'region-alarm' : undefined}
                    fill={meta.blink ? undefined : `${meta.color}33`} stroke={meta.blink ? undefined : meta.color}
                    strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round"
                    style={{ pointerEvents: editing && !drawing ? 'auto' : 'none', cursor: editing && !drawing ? 'move' : 'default' }}
                    onPointerDown={(e) => startDrag(e, r, -1)} />
                );
              })}
              {/* draft ระหว่างวาด */}
              {drawing && draft.length > 0 && (
                <polyline points={ptsStr(hoverPt ? [...draft, hoverPt] : draft)} fill="rgba(77,159,255,0.15)" stroke="#4d9fff" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeDasharray="3 2" />
              )}
            </svg>

            {/* ป้ายชื่อ+ยอด ที่ centroid (HTML — ไม่โดน SVG ยืด) */}
            {regions.map(r => {
              const [cx, cy] = centroid(r.points); const st = lineStatus[r.line_name]; const meta = STATUS_META[st?.status || 'idle'];
              return (
                <div key={`lbl-${r.id}`} style={{ position: 'absolute', left: `${cx}%`, top: `${cy}%`, transform: 'translate(-50%,-50%)', textAlign: 'center', pointerEvents: 'none', textShadow: '0 1px 4px rgba(0,0,0,0.95)' }}>
                  <div style={{ fontSize: 'clamp(11px,1.1vw,15px)', fontWeight: 800, color: '#fff', whiteSpace: 'nowrap' }}>{r.line_name}</div>
                  {st && st.target > 0 && <div style={{ fontSize: 'clamp(10px,0.95vw,13px)', fontWeight: 700, color: '#fff' }}>{st.actual}/{st.target}{st.pct != null ? ` · ${st.pct}%` : ''}</div>}
                  {st && <div style={{ display: 'inline-block', fontSize: 'clamp(9px,0.85vw,12px)', fontWeight: 700, color: meta.color, background: 'rgba(0,0,0,0.7)', padding: '0 5px', borderRadius: 3, marginTop: 2 }}>{meta.label}</div>}
                </div>
              );
            })}

            {/* handle มุม + ปุ่มลบ (เฉพาะตอนแก้ไข ไม่ได้วาด) */}
            {editing && !drawing && regions.map(r => {
              const [cx, cy] = centroid(r.points);
              return (
                <div key={`h-${r.id}`}>
                  {r.points.map((pt, i) => (
                    <div key={i} data-handle onPointerDown={(e) => startDrag(e, r, i)}
                      style={{ position: 'absolute', left: `${pt[0]}%`, top: `${pt[1]}%`, width: 14, height: 14, transform: 'translate(-50%,-50%)', background: '#4d9fff', border: '2px solid #fff', borderRadius: 3, cursor: 'grab', touchAction: 'none' }} />
                  ))}
                  <button onClick={(e) => { e.stopPropagation(); deleteRegion(r.id); }} title={`ลบกรอบ ${r.line_name}`}
                    style={{ position: 'absolute', left: `${cx}%`, top: `${cy}%`, transform: 'translate(-50%,-140%)', width: 22, height: 22, borderRadius: 6, border: 'none', background: 'rgba(239,68,68,0.92)', color: '#fff', fontSize: 13, cursor: 'pointer', lineHeight: 1 }}>✕</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {editing && imageUrl && assignableLines().length > 0 && (
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)' }}>ยังไม่ได้ตีกรอบ: <span style={{ color: '#f59e0b' }}>{assignableLines().join(', ')}</span></div>
      )}
    </div>
  );
}

const btn = (active) => ({
  padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
  border: `1px solid ${active ? 'var(--accent)' : 'var(--border2)'}`,
  background: active ? 'var(--accent-dim)' : 'var(--bg3)', color: active ? 'var(--accent)' : 'var(--text2)',
});
