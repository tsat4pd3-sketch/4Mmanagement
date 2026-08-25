/**
 * 🏬 StorageZonePanel — แท็บ "โซนคลัง (ผัง)" ใน /line-stock (WMS เฟส 1 · 2026-08-25)
 *
 * จัดการทะเบียนโซนจัดเก็บ (storage_zones ฝั่ง DR): ชื่อ/ชนิด/ความจุ(กล่อง)/MAT ที่เก็บ
 * แล้วไปตีกรอบบนผังรวม `/factory-map` ด้วยชื่อเดียวกัน (ชื่อคือกุญแจ — pattern die_storage_areas)
 * ผังจะคำนวณสถานะโซนสดจาก line_stock_summary (คลังกลาง FG WAREHOUSE/STORE) — สูตร utils/storageZones.js
 *
 * ⚠️ เฟส 1 ไม่แตะ write-path ของ stock — โซนเป็น "ทะเบียนที่เก็บ" ยอดยังมาจาก ledger กลางตาม MAT
 *   MAT เดียวผูกหลายโซน = ยอดโชว์ซ้ำ → มี worklist เตือน (ห้ามซ่อน)
 * ⚠️ เปลี่ยนชื่อโซน = cascade ชื่อกรอบบนผังรวม (factory_line_regions ฝั่ง Main) — พลาดต้อง toast ห้ามเงียบ
 */
import { useState, useEffect, useContext, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from '../components/Toast';
import { can } from '../utils/permissions';
import ReadOnlyNote from './ReadOnlyNote';
import { ZONE_KINDS, zoneKindMeta, zoneFill, zoneHealth, zoneHealthText, WAREHOUSE_LOCATIONS } from '../utils/storageZones';

const CAT_COLOR = { good: 'var(--accent)', ok: 'var(--accent2)', bad: '#e5484d', idle: 'var(--muted)' };

export default function StorageZonePanel() {
  const { role } = useContext(UserContext);
  const navigate = useNavigate();
  const canManage = can('storage', 'manage', role);

  const [zones, setZones] = useState([]);
  const [missing, setMissing] = useState(false);   // ตาราง storage_zones ยังไม่ apply (42P01) — ห้ามเงียบ
  const [parts, setParts] = useState([]);          // parts_master: mat_no, part_name, qty_per_pkg
  const [stds, setStds] = useState({});            // mat_no → { min_qty, max_qty, qty_per_kanban }
  const [stockByMat, setStockByMat] = useState({}); // mat_no → qty รวมในคลังกลาง
  const [framed, setFramed] = useState(new Set()); // ชื่อกรอบบนผังรวม (normalize) — บอกว่าโซนไหนตีกรอบแล้ว
  const [frameNames, setFrameNames] = useState([]); // ชื่อกรอบตัวจริง (คงตัวพิมพ์เดิม) — ใช้เสนอ "กรอบที่ยังไม่มีทะเบียน"
  const [claimedElsewhere, setClaimedElsewhere] = useState(new Set()); // ชื่อที่เป็นของระบบอื่นแล้ว (ไลน์ผลิต/โซนแม่พิมพ์/facility)
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState(null);          // null | {} (ใหม่) | zone (แก้)

  const load = useCallback(async () => {
    setLoading(true);
    const [zRes, pRes, kRes, sRes, rRes] = await Promise.all([
      supabaseDR.from('storage_zones').select('*').order('sort_order').order('name'),
      // ⚠️ parts_master ใช้คอลัมน์ `part_name` ไม่ใช่ `name` (บั๊กจริง 2026-08-25: select name → 42703 เงียบ ลิสต์ค้น MAT ว่างทั้งช่อง)
      supabaseDR.from('parts_master').select('mat_no, part_name, qty_per_pkg').eq('is_active', true).order('mat_no'),
      supabaseDR.from('kanban_standards').select('mat_no, min_qty, max_qty, qty_per_kanban').eq('is_active', true),
      supabaseDR.from('line_stock_summary').select('line_name, mat_no, qty_on_hand').in('line_name', WAREHOUSE_LOCATIONS),
      supabase.from('factory_line_regions').select('line_name'),
    ]);
    if (zRes.error) {
      // 42P01 = ตารางยังไม่ apply — แจ้งชัด ไม่ใช่จอว่างเงียบๆ
      setMissing(true); setZones([]);
    } else { setMissing(false); setZones(zRes.data || []); }
    setParts(pRes.data || []);
    const km = {}; (kRes.data || []).forEach(k => { km[k.mat_no] = k; });
    setStds(km);
    const st = {}; (sRes.data || []).forEach(r => { st[r.mat_no] = (st[r.mat_no] || 0) + (Number(r.qty_on_hand) || 0); });
    setStockByMat(st);
    const frames = [...new Set((rRes.data || []).map(r => String(r.line_name || '').trim()).filter(Boolean))];
    setFrameNames(frames);
    setFramed(new Set(frames.map(n => n.toLowerCase())));
    // ชื่อกรอบที่ "เป็นของระบบอื่นแล้ว" — เอาไว้กรองข้อเสนอ "ลงทะเบียนกรอบเดิมเป็นโซนคลัง"
    // (ไลน์ผลิต · โซนคลังแม่พิมพ์ · โซน facility ที่ลงทะเบียน · ชื่อระบบของเครื่อง facility) — best-effort ทุกก้อน
    const claimed = new Set();
    const addAll = (rows, key) => (rows || []).forEach(r => { const v = String(r[key] || '').trim().toLowerCase(); if (v) claimed.add(v); });
    try {
      const [pl, da, fa, fm] = await Promise.all([
        supabase.from('production_lines').select('name'),
        supabaseDR.from('die_storage_areas').select('name').eq('is_active', true),
        supabaseDR.from('pm_facility_areas').select('name'),
        supabaseDR.from('machines').select('line_name').in('equipment_category', ['facility', 'utility']),
      ]);
      addAll(pl.data, 'name'); addAll(da.data, 'name'); addAll(fa.data, 'name'); addAll(fm.data, 'line_name');
    } catch { /* ตาราง/สิทธิ์ไม่พร้อม — ข้อเสนออาจมีชื่อระบบอื่นปน (คนเป็นผู้ตัดสินอยู่แล้ว) */ }
    setClaimedElsewhere(claimed);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const partByMat = useMemo(() => { const m = {}; parts.forEach(p => { m[p.mat_no] = p; }); return m; }, [parts]);
  const pkgOf = useCallback((mat) => {
    const pkg = Number(partByMat[mat]?.qty_per_pkg) || Number(stds[mat]?.qty_per_kanban) || 0;
    return pkg > 0 ? pkg : null;
  }, [partByMat, stds]);
  const stdOf = useCallback((mat) => stds[mat] || null, [stds]);

  const activeZones = zones.filter(z => z.is_active);

  /* worklist 1: ของในคลังกลางที่ยังไม่กำหนดโซน (ห้ามซ่อน — นี่คืองานจัดข้อมูลที่เหลือ) */
  const unassigned = useMemo(() => {
    const assigned = new Set(activeZones.flatMap(z => z.mat_nos || []));
    return Object.entries(stockByMat)
      .filter(([mat, qty]) => qty > 0 && !assigned.has(mat))
      .map(([mat, qty]) => ({ mat, qty, name: partByMat[mat]?.part_name || '' }))
      .sort((a, b) => b.qty - a.qty);
  }, [activeZones, stockByMat, partByMat]);

  /* worklist 2: MAT ที่ถูกผูกหลายโซน = ยอดโชว์ซ้ำ (เฟส 1 ยังไม่รู้รายโซนจริง) */
  const dupMats = useMemo(() => {
    const cnt = {};
    activeZones.forEach(z => (z.mat_nos || []).forEach(m => { cnt[m] = (cnt[m] || 0) + 1; }));
    return Object.entries(cnt).filter(([, n]) => n > 1).map(([m]) => m);
  }, [activeZones]);

  const [showAllUnassigned, setShowAllUnassigned] = useState(false);

  /* 🗺️ อ้างอิงแผนผังที่มีอยู่แล้ว (คำสั่ง user 2026-08-25): กรอบบนผังรวมที่ยังไม่มีทะเบียนระบบไหนเลย
     → เสนอให้ "ลงทะเบียนเป็นโซนคลัง" (ระบบเสนอ คนตัดสิน — กรอบพวกนี้อาจเป็นโซนช่างที่พิมพ์ชื่ออิสระก็ได้) */
  const unclaimedFrames = useMemo(() => {
    const zoneNames = new Set(zones.map(z => String(z.name || '').trim().toLowerCase()));
    return frameNames.filter(n => {
      const k = n.toLowerCase();
      return !zoneNames.has(k) && !claimedElsewhere.has(k);
    }).sort((a, b) => a.localeCompare(b));
  }, [frameNames, zones, claimedElsewhere]);

  return (
    <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
      {missing && (
        <div style={{ background: 'rgba(229,72,77,.12)', border: '1px solid #e5484d', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
          ⛔ ตาราง <code>storage_zones</code> ยังไม่ถูกสร้างในฐานข้อมูล (DR) — แจ้ง admin รัน migration
          <code> 20260825_storage_zones.sql</code> ก่อน แท็บนี้ถึงใช้งานได้
        </div>
      )}
      <ReadOnlyNote show={!canManage && !missing} role={role} what="จัดการโซนคลัง (เพิ่ม/แก้/ผูก MAT)" permKey="storage:manage" />

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: 'var(--text2)' }}>
          ทะเบียนโซนจัดเก็บในคลัง — เริ่มจาก<b>ระบบ setup แผนผัง</b>ก็ได้: วาดกรอบบนผังรวม → เลือก
          "🏬 โซนคลังสินค้า" ระบบสร้างทะเบียนให้เลย แล้วค่อยมาผูก MAT/ความจุที่นี่
          (ผังคำนวณ เต็ม/ใกล้เต็ม/ต่ำกว่า Min จากสต็อกจริงให้เอง)
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={() => navigate('/factory-map')} style={btnSec}>🗺️ ไปผังรวมโรงงาน</button>
        {canManage && !missing && <button onClick={() => setEdit({})} style={btnPri}>➕ เพิ่มโซน</button>}
      </div>

      {loading && <div style={{ color: 'var(--muted)', fontSize: 13 }}>กำลังโหลด…</div>}

      {/* 🗺️ กรอบเดิมบนผังรวมที่ยังไม่มีทะเบียน — หยิบมาลงทะเบียนเป็นโซนคลังได้เลย (อ้างอิงแผนผังที่วาดไว้แล้ว) */}
      {!loading && !missing && canManage && unclaimedFrames.length > 0 && (
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
          🗺️ กรอบบนผังรวมที่<b>ยังไม่มีทะเบียนโซน {unclaimedFrames.length} กรอบ</b> —
          ถ้ากรอบไหนคือพื้นที่คลัง กด ➕ ลงทะเบียนได้เลย (ชื่อตรงกัน = จับคู่กรอบเดิมอัตโนมัติ ไม่ต้องวาดใหม่)
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {unclaimedFrames.map(n => (
              <button key={n} onClick={() => setEdit({ name: n })} style={{ ...btnSec, fontSize: 12, padding: '4px 10px' }}>
                ➕ {n}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5 }}>
            * กรอบที่เป็นโซนช่าง/facility ที่พิมพ์ชื่ออิสระไว้ ก็โผล่ในลิสต์นี้ — ไม่ใช่พื้นที่คลังก็ไม่ต้องกด
          </div>
        </div>
      )}

      {!loading && !missing && !zones.length && (
        <div style={{ background: 'var(--bg2)', border: '1px dashed var(--border2)', borderRadius: 8, padding: 18, fontSize: 13, color: 'var(--text2)' }}>
          ยังไม่มีโซนจัดเก็บ — เริ่มจาก ➕ เพิ่มโซน (เช่น "FG OUT LANE 1", "WIP APRON", "STORE SUB PART")
          แล้วผูกว่า MAT ไหนเก็บโซนนั้น · ระบบไม่เดาผังคลังให้ (ตำแหน่งจัดเก็บเป็นความรู้หน้างาน)
        </div>
      )}

      {/* การ์ดรายโซน */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 10, alignContent: 'start' }}>
        {zones.map(z => {
          const f = zoneFill(z, stockByMat, pkgOf, stdOf);
          const cat = z.is_active ? zoneHealth(f) : 'idle';
          const km = zoneKindMeta(z.kind);
          const isFramed = framed.has(String(z.name || '').trim().toLowerCase());
          return (
            <div key={z.id} style={{ background: 'var(--card)', border: `1px solid ${z.is_active ? CAT_COLOR[cat] : 'var(--border)'}`, borderRadius: 10, padding: '10px 12px', opacity: z.is_active ? 1 : 0.55, display: 'grid', gap: 6, alignContent: 'start' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <b style={{ fontSize: 14 }}>{km.icon} {z.name}</b>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>{km.label}</span>
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 12, color: CAT_COLOR[cat], fontWeight: 600 }}>{z.is_active ? zoneHealthText(f) : 'ปิดใช้งาน'}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text2)' }}>
                MAT {f.mats.length} รายการ · รวม {f.totQty.toLocaleString()} ชิ้น
                {z.capacity_pkg ? ` · ความจุ ${z.capacity_pkg} กล่อง` : ' · ⚠ ยังไม่กรอกความจุ (fill% = ไม่รู้)'}
              </div>
              {f.mats.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {f.mats.slice(0, 6).map(m => (
                    <span key={m.mat_no} title={partByMat[m.mat_no]?.part_name || ''} style={{ fontSize: 11, padding: '1px 7px', borderRadius: 6, border: `1px solid ${m.short ? '#e5484d' : 'var(--border)'}`, color: m.short ? '#e5484d' : 'var(--text2)' }}>
                      {m.mat_no} · {m.qty.toLocaleString()}{m.short ? ' 🟥' : m.over ? ' ⚠' : ''}
                    </span>
                  ))}
                  {f.mats.length > 6 && <span style={{ fontSize: 11, color: 'var(--muted)' }}>+อีก {f.mats.length - 6}</span>}
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {isFramed
                  ? <span style={{ fontSize: 11, color: 'var(--accent)' }}>✅ ตีกรอบบนผังแล้ว</span>
                  : <span style={{ fontSize: 11, color: 'var(--accent2)' }}>⚠ ยังไม่ตีกรอบบนผังรวม — วาดที่ /factory-map (ชื่อ "{z.name}")</span>}
                <div style={{ flex: 1 }} />
                {canManage && <button onClick={() => setEdit(z)} style={btnMini}>✏️ แก้ไข</button>}
              </div>
            </div>
          );
        })}
      </div>

      {/* worklist — ห้ามซ่อนของที่ยังไม่เข้าระบบ */}
      {!missing && unassigned.length > 0 && (
        <div style={{ background: 'rgba(255,180,0,.08)', border: '1px solid var(--accent2)', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
          ⚠️ ของในคลังกลาง (FG WAREHOUSE/STORE) ที่<b>ยังไม่กำหนดโซนเก็บ {unassigned.length} รายการ</b>
          {' '}— ผูกเข้าโซนให้ครบ ผังถึงตอบได้ว่า "ของอยู่ตรงไหน"
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
            {(showAllUnassigned ? unassigned : unassigned.slice(0, 12)).map(u => (
              <span key={u.mat} title={u.name} style={{ fontSize: 11, padding: '1px 7px', borderRadius: 6, border: '1px solid var(--border2)' }}>
                {u.mat} · {u.qty.toLocaleString()}
              </span>
            ))}
            {unassigned.length > 12 && (
              <button onClick={() => setShowAllUnassigned(v => !v)} style={btnMini}>
                {showAllUnassigned ? 'ย่อ' : `▾ ดูทั้งหมด (${unassigned.length})`}
              </button>
            )}
          </div>
        </div>
      )}
      {dupMats.length > 0 && (
        <div style={{ background: 'rgba(255,180,0,.08)', border: '1px solid var(--accent2)', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
          ⚠️ MAT ถูกผูกไว้<b>หลายโซนพร้อมกัน {dupMats.length} รายการ</b> ({dupMats.slice(0, 8).join(', ')}{dupMats.length > 8 ? ' …' : ''})
          — เฟสนี้ระบบยังไม่รู้ยอดรายโซนจริง ยอดจะโชว์ซ้ำทั้งสองโซน · ถ้าเก็บหลายที่จริงปล่อยได้ แต่ให้รู้ว่าตัวเลขคือ "ยอดรวมของ MAT" ไม่ใช่ยอดเฉพาะโซน
        </div>
      )}

      {edit !== null && (
        <ZoneFormModal
          zone={edit.id ? edit : null}
          initialName={!edit.id ? edit.name : undefined} /* ลงทะเบียนจากกรอบเดิมบนผัง — prefill ชื่อให้ตรงกรอบ */
          parts={parts}
          stockByMat={stockByMat}
          onClose={() => setEdit(null)}
          onSaved={() => { setEdit(null); load(); }}
        />
      )}
    </div>
  );
}

/* ── ฟอร์มเพิ่ม/แก้โซน — ไม่ปิดจาก backdrop (ฟอร์มมีข้อมูลกรอกค้าง · UI-CONVENTIONS §5) ── */
function ZoneFormModal({ zone, initialName, parts, stockByMat, onClose, onSaved }) {
  const [name, setName] = useState(zone?.name || initialName || '');
  const [kind, setKind] = useState(zone?.kind || 'fg');
  const [cap, setCap] = useState(zone?.capacity_pkg ?? '');
  const [note, setNote] = useState(zone?.note || '');
  const [mats, setMats] = useState(zone?.mat_nos || []);
  const [active, setActive] = useState(zone ? !!zone.is_active : true);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  const options = useMemo(() => {
    const t = q.trim().toLowerCase();
    const sel = new Set(mats);
    let list = parts.filter(p => !sel.has(p.mat_no));
    if (t) list = list.filter(p => p.mat_no.toLowerCase().includes(t) || (p.part_name || '').toLowerCase().includes(t));
    // ของที่มีสต็อกในคลังกลางขึ้นก่อน (คือตัวที่ต้องหาที่เก็บจริง)
    return list.sort((a, b) => (Number(stockByMat[b.mat_no]) || 0) - (Number(stockByMat[a.mat_no]) || 0)).slice(0, 30);
  }, [parts, mats, q, stockByMat]);

  const save = async () => {
    const nm = name.trim();
    if (!nm) { toast.error('กรอกชื่อโซนก่อน'); return; }
    setBusy(true);
    try {
      const payload = {
        name: nm, kind, note: note.trim() || null, mat_nos: mats, is_active: active,
        capacity_pkg: cap === '' ? null : Math.max(0, Math.round(Number(cap))) || null,
      };
      if (zone) {
        const { data, error } = await supabaseDR.from('storage_zones').update(payload).eq('id', zone.id).select('id');
        if (error) throw error;
        if (!data?.length) throw new Error('บันทึกไม่เข้า (0 แถว)'); // กฎนับแถว — RLS/เงื่อนไขเงียบ
        // เปลี่ยนชื่อ = cascade ชื่อกรอบบนผังรวม (Main) — พลาดต้องบอก ห้ามเงียบ (กฎ rename cascade)
        if (zone.name !== nm) {
          const { data: rg, error: re } = await supabase.from('factory_line_regions')
            .update({ line_name: nm }).eq('line_name', zone.name).select('id');
          if (re) toast.error(`เปลี่ยนชื่อโซนแล้ว แต่แก้ชื่อกรอบบนผังรวมไม่สำเร็จ — ไปแก้เองที่ /factory-map (${re.message})`);
          else if (rg?.length) toast.info(`อัพเดทชื่อกรอบบนผังรวมให้แล้ว ${rg.length} กรอบ`);
        }
      } else {
        const { error } = await supabaseDR.from('storage_zones').insert(payload);
        if (error) throw error;
      }
      toast.success('บันทึกโซนแล้ว');
      onSaved();
    } catch (e) {
      toast.error(e.code === '23505' ? `ชื่อโซน "${nm}" มีอยู่แล้ว — ใช้ชื่อไม่ซ้ำ (ชื่อคือกุญแจจับคู่กรอบบนผัง)` : `บันทึกไม่สำเร็จ: ${e.message}`);
    } finally { setBusy(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      {/* ⚠️ ห้ามเติม onClick={onClose} ที่ backdrop — ฟอร์มมีข้อมูลค้าง เผลอแตะแล้วหาย (UI-CONVENTIONS §5) */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 12, width: 'min(680px, 96vw)', maxHeight: '92vh', overflowY: 'auto', padding: 18, display: 'grid', gap: 10, alignContent: 'start' }}>
        <b style={{ fontSize: 15 }}>{zone ? `✏️ แก้โซน: ${zone.name}` : '➕ เพิ่มโซนจัดเก็บ'}</b>
        <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label style={lbl}>ชื่อโซน (= ชื่อกรอบบนผังรวม)
            <input value={name} onChange={e => setName(e.target.value)} placeholder="เช่น FG OUT LANE 1" />
          </label>
          <label style={lbl}>ชนิดโซน
            <select value={kind} onChange={e => setKind(e.target.value)}>
              {ZONE_KINDS.map(k => <option key={k.key} value={k.key}>{k.icon} {k.label}</option>)}
            </select>
          </label>
          <label style={lbl}>ความจุ (จำนวนภาชนะ/กล่อง) — เว้นว่าง = ไม่รู้
            <input type="number" min="0" value={cap} onChange={e => setCap(e.target.value)} placeholder="เช่น 120" />
          </label>
          <label style={lbl}>หมายเหตุ
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="เช่น แร็ค stillage ซ้อน 4 ชั้น" />
          </label>
        </div>

        <div style={{ display: 'grid', gap: 6 }}>
          <b style={{ fontSize: 13 }}>MAT ที่เก็บโซนนี้ ({mats.length})</b>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {mats.map(m => (
              <span key={m} style={{ fontSize: 12, padding: '2px 8px', borderRadius: 7, border: '1px solid var(--accent)', color: 'var(--accent)' }}>
                {m}{stockByMat[m] ? ` · ${Number(stockByMat[m]).toLocaleString()}` : ''}
                <button onClick={() => setMats(v => v.filter(x => x !== m))} style={{ ...btnMini, marginLeft: 6, padding: '0 4px' }}>✕</button>
              </span>
            ))}
            {!mats.length && <span style={{ fontSize: 12, color: 'var(--muted)' }}>ยังไม่ผูก MAT — โซนจะขึ้นสีเทา "ยังไม่ผูก MAT" บนผัง</span>}
          </div>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔎 ค้น MAT / ชื่อพาร์ท จากทะเบียน Parts Master แล้วกดเพิ่ม…" />
          {q.trim() !== '' && (
            <div style={{ display: 'grid', gap: 3, maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 6 }}>
              {options.map(p => (
                <button key={p.mat_no} onClick={() => { setMats(v => [...v, p.mat_no]); }} style={{ ...btnSec, textAlign: 'left', fontSize: 12, display: 'flex', gap: 8 }}>
                  <b>{p.mat_no}</b>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.part_name || ''}</span>
                  <span style={{ color: 'var(--muted)' }}>{stockByMat[p.mat_no] ? `คงเหลือ ${Number(stockByMat[p.mat_no]).toLocaleString()}` : '—'}</span>
                </button>
              ))}
              {!options.length && <span style={{ fontSize: 12, color: 'var(--muted)', padding: 4 }}>ไม่พบในทะเบียน Parts Master</span>}
            </div>
          )}
        </div>

        {zone && (
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
            เปิดใช้งานโซนนี้ (ปิด = soft delete — ประวัติ/กรอบยังอยู่ ไม่ลบทิ้ง)
          </label>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnSec} disabled={busy}>ยกเลิก</button>
          <button onClick={save} style={btnPri} disabled={busy}>{busy ? 'กำลังบันทึก…' : '💾 บันทึก'}</button>
        </div>
      </div>
    </div>
  );
}

const lbl = { display: 'grid', gap: 4, fontSize: 12, color: 'var(--text2)' };
const btnPri = { background: 'var(--accent)', color: '#08110a', border: 'none', borderRadius: 8, padding: '7px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 13 };
const btnSec = { background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border2)', borderRadius: 8, padding: '7px 12px', cursor: 'pointer', fontSize: 13 };
const btnMini = { background: 'transparent', color: 'var(--text2)', border: '1px solid var(--border2)', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: 11 };
