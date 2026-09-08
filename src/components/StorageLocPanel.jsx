/**
 * 🏬 StorageLocPanel — ทะเบียนรหัสคลัง (SAP Storage Location) · 2026-09-02 · ผูกไลน์ 2026-09-08
 *
 * user กำหนดรูปแบบเอง: ตัวอักษร 1-3 ตัว + เลข 3 หลัก · ตัวอักษรนำหน้าบอกชนิดพื้นที่
 *   S401 สโตร์ชิ้นส่วน · P4xx พื้นที่ผลิต · W401 warehouse (FG) · R401 สโตร์เหล็ก
 *
 * ⚠️⚠️ คนละเรื่องกับ `storage_zones` (โซนกองของที่ตีกรอบบนผังโรงงาน) — **ห้ามยุบรวม**
 *   นี่คือ "รหัสบัญชีคลัง" ที่อ้างในทุกบรรทัด BOM (`bom_items.storage_location`) แบบ SAP
 *
 * ═══ ชั้นบัญชี SAP ↔ ชั้นกายภาพ (user 2026-09-08) ═══════════════════════════════════════
 *   SAP คุมวัตถุดิบระดับ "พื้นที่": P411 = ทั้งแผนก Apron Assy (Line 60 · 61 · Sub Apron) · P409 = ทั้ง Hydroform
 *   ESM คุมของที่ไลน์ย่อยที่สุด (ของ sub component ของ FG แต่ละตัวอยู่หน้าไลน์ของมัน)
 *   → ผูก SLoc ที่ **ไลน์แม่ครั้งเดียว** (`line_names`) ไลน์ลูกตกทอด (`slocOfLine` ไล่สายบน) · ระบบแปะ `storage_location`
 *     ให้ทุกใบขอเติม / ledger / จุดส่ง ตอนเขียน — ไลน์ที่ยังไม่ผูก = null ไม่เดา → worklist ในแผงนี้
 *   · ค่าพิเศษ STORE / FG WAREHOUSE = "ไลน์" เสมือนใน line_stock_summary (S401 / W401)
 *   · ledger เก่าก่อนมีชั้นนี้ → ปุ่ม "แปะรหัสคลังย้อนหลัง" (เฉพาะแถวที่ยัง null · idempotent)
 *
 * ⚠️ รูปแบบ/ชนิด/การตรวจ/การ derive อยู่ที่ `src/utils/storageLoc.js` ที่เดียว **ห้ามเขียน regex/ไล่สายบนซ้ำที่นี่**
 * ⚠️ production_lines อยู่ Main (supabase) · ทะเบียน/ledger อยู่ DR (supabaseDR) — 2 project
 */
import { useState, useEffect, useContext, useMemo, useCallback } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from './Toast';
import { can } from '../utils/permissions';
import { isLeafLine } from '../utils/lineHierarchy';
import ReadOnlyNote from './ReadOnlyNote';
import LineSelect from './LineSelect';
import { SLOC_KINDS, slocKindMeta, slocKindGuess, slocLabel, slocValid, SLOC_FORMAT_HINT, slocOfLine, linesOfSloc } from '../utils/storageLoc';

const inputSt = {
  width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--bg2)', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--font-body)',
};
/** "ไลน์" เสมือนที่ไม่อยู่ใน production_lines แต่มีสต็อกใน line_stock_summary — ให้ผูก SLoc ได้ด้วยชิปเดียว */
const VIRTUAL_LINES = ['STORE', 'FG WAREHOUSE'];
const MIG_DR = '20260908_storage_locations_line_map.sql';

export default function StorageLocPanel() {
  const { role, lineId, sections, fullName } = useContext(UserContext);
  const canManage = can('storage', 'manage', role);

  const [rows, setRows]     = useState([]);
  const [used, setUsed]     = useState([]);      // รหัสที่ถูกใช้ใน bom_items จริง
  const [lines, setLines]   = useState([]);      // production_lines (Main) — ลำดับชั้นสำหรับตกทอด
  const [missing, setMissing] = useState(false); // ตารางยังไม่ apply (42P01) — ห้ามเงียบ
  const [noLineMap, setNoLineMap] = useState(false); // มีตารางแต่ยังไม่มี line_names (ยังไม่ apply 20260908)
  const [untagged, setUntagged] = useState(null); // แถว ledger ที่ยังไม่แปะ SLoc (null = นับไม่ได้)
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]     = useState(false);
  const [edit, setEdit]     = useState(null);    // null | {} (ใหม่) | row (แก้)

  const load = useCallback(async () => {
    setLoading(true);
    const [r1, r2, r3, r4] = await Promise.all([
      supabaseDR.from('storage_locations').select('*').order('sort_order').order('code'),
      supabaseDR.from('bom_items').select('storage_location').eq('is_active', true),
      supabase.from('production_lines').select('id, name, parent_line_name, section, is_active').order('name'),
      supabaseDR.from('line_stock_transactions').select('id', { count: 'exact', head: true }).is('storage_location', null).eq('status', 'approved'),
    ]);
    setLoading(false);
    if (r1.error?.code === '42P01') { setMissing(true); setRows([]); return; }
    if (r1.error) { toast.error(r1.error.message); return; }
    setMissing(false);
    setRows(r1.data || []);
    // ตารางมีแต่ยังไม่มีคอลัมน์ line_names = ยังไม่ apply 20260908 → ชั้นบัญชียังไม่ทำงาน ต้องบอก ห้ามให้ดูเหมือน "ยังไม่มีใครผูก"
    setNoLineMap((r1.data || []).length > 0 && !('line_names' in r1.data[0]));
    // ⚠️ ยังไม่ apply migration ของ bom_items = อ่านคอลัมน์ไม่ได้ → ถือว่ายังไม่มีใครใช้ (ไม่ใช่ error)
    setUsed(r2.error ? [] : [...new Set((r2.data || []).map(b => slocLabel(b.storage_location)).filter(Boolean))]);
    if (r3.error) toast.error('โหลดทะเบียนไลน์ (Main) ไม่ได้: ' + r3.error.message);
    setLines(r3.data || []);
    setUntagged(r4.error ? null : (r4.count ?? 0));
  }, []);
  useEffect(() => { load(); }, [load]);

  const usedCount = useMemo(() => {
    const m = {};
    used.forEach(c => { m[c] = true; });
    return m;
  }, [used]);
  /* รหัสที่ถูกใช้ใน BOM แต่ยังไม่มีในทะเบียน = worklist **ห้ามซ่อน**
     (ซ่อนแล้วหาตัวที่พิมพ์ผิด/ตัวที่ต้องลงทะเบียนไม่เจอ — หลักเดียวกับ optgroup "นอกผัง") */
  const orphan = useMemo(() => {
    const reg = new Set(rows.map(r => slocLabel(r.code)));
    return used.filter(c => !reg.has(c));
  }, [rows, used]);

  /* ไลน์ย่อยที่สุดที่ยังไม่ตกอยู่ใน SLoc ไหนเลย = ใบ/ledger ของไลน์นั้นจะไม่มีมุม SAP → worklist ห้ามซ่อน */
  const unmappedLeaf = useMemo(() => {
    if (noLineMap) return [];
    return lines.filter(l => l.is_active !== false && isLeafLine(lines, l.name) && !slocOfLine(rows, lines, l.name)).map(l => l.name);
  }, [rows, lines, noLineMap]);
  /* ไลน์ที่ SLoc นี้ครอบ (ผูกตรง + ตกทอด) — ไว้โชว์บนแถว + ใช้ backfill */
  const coverOf = useCallback((r) => {
    const own = Array.isArray(r.line_names) ? r.line_names : [];
    const inherited = linesOfSloc(rows, lines, r.code);
    return [...new Set([...own, ...inherited])];
  }, [rows, lines]);

  const save = async (form) => {
    const code = slocLabel(form.code);
    if (!code) { toast.error('ใส่รหัสคลัง'); return false; }
    if (!slocValid(code)) { toast.error(`รหัสไม่ถูกรูปแบบ — ${SLOC_FORMAT_HINT}`); return false; }
    if (!form.name.trim()) { toast.error('ใส่ชื่อพื้นที่'); return false; }
    const lineNames = [...new Set((form.line_names || []).map(s => String(s).trim()).filter(Boolean))];
    // ไลน์เดียวผูก 2 SLoc ตรงๆ ไม่ได้ (ตกทอดจากแม่แล้วผูกเองที่ลูกได้ — ลูกชนะแม่)
    const clash = rows.filter(r => r.code !== edit?.code && r.is_active !== false && (r.line_names || []).some(n => lineNames.includes(n)));
    if (clash.length) { toast.error(`${clash.map(r => r.code).join(', ')} ผูกไลน์เดียวกันอยู่แล้ว — ไลน์หนึ่งอยู่ได้พื้นที่เดียว เอาออกจากตัวเก่าก่อน`); return false; }
    const payload = {
      code, name: form.name.trim(), kind: form.kind || null,
      note: form.note?.trim() || null,
      sort_order: Number(form.sort_order) || 100,
      is_active: !!form.is_active,
      updated_by_name: fullName || null,
      ...(noLineMap ? {} : { line_names: lineNames }),
    };
    // แก้รหัส = สร้างแถวใหม่ (code เป็น PK) → บล็อกไว้ ให้ลบแล้วสร้างใหม่แทน กันรหัสกำพร้าใน BOM
    const q = edit?.code
      ? supabaseDR.from('storage_locations').update(payload).eq('code', edit.code)
      : supabaseDR.from('storage_locations').insert(payload);
    const { error } = await q;
    if (error) {
      toast.error(error.code === '23505' ? `รหัส ${code} มีอยู่แล้วในทะเบียน`
        : error.code === '23514' ? `รหัสไม่ถูกรูปแบบ — ${SLOC_FORMAT_HINT}`
        : error.message);
      return false;
    }
    toast.success(edit?.code ? 'แก้ไขแล้ว' : `เพิ่มรหัส ${code} แล้ว`);
    setEdit(null); load();
    return true;
  };

  const remove = async (r) => {
    const n = usedCount[slocLabel(r.code)] ? 1 : 0;
    if (n) { toast.error(`รหัส ${r.code} ถูกใช้ใน BOM อยู่ — ปิดใช้งานแทนการลบ (กดแก้ไข → เอาติ๊ก "ใช้งาน" ออก)`); return; }
    if (!window.confirm(`ลบรหัส ${r.code} · ${r.name}?`)) return;
    const { error } = await supabaseDR.from('storage_locations').delete().eq('code', r.code);
    if (error) { toast.error(error.message); return; }
    toast.success('ลบแล้ว'); load();
  };

  /* แปะรหัสคลังย้อนหลังให้ ledger + จุดส่ง ที่เขียนก่อนมีชั้นนี้ — เฉพาะแถวที่ยัง null (รันซ้ำได้ ไม่ทับที่ tag แล้ว)
     ทำจาก client เพราะลำดับชั้นไลน์อยู่ Main (trigger ฝั่ง DR เติมได้แค่ชื่อที่ผูกตรง) */
  const backfill = async () => {
    const active = rows.filter(r => r.is_active !== false);
    const plan = active.map(r => ({ code: slocLabel(r.code), names: coverOf(r) })).filter(p => p.names.length);
    if (!plan.length) { toast.error('ยังไม่มีรหัสคลังที่ผูกไลน์ไว้ — ผูกก่อน (กด ✏️ ที่รหัส)'); return; }
    const preview = plan.map(p => `${p.code} ← ${p.names.length} ไลน์`).join('\n');
    if (!window.confirm(`แปะรหัสคลังให้รายการเก่าที่ยังไม่มีมุม SAP (${untagged ?? '?'} แถว)\n\n${preview}\n\nเฉพาะแถวที่ยังว่าง — ไม่ทับที่แปะแล้ว · ดำเนินการ?`)) return;
    setBusy(true);
    let total = 0, pts = 0;
    const errs = [];
    for (const p of plan) {
      const { error, count } = await supabaseDR.from('line_stock_transactions')
        .update({ storage_location: p.code }, { count: 'exact' }).is('storage_location', null).in('line_name', p.names);
      if (error) { errs.push(`${p.code}: ${error.message}`); continue; }
      total += count || 0;
    }
    // จุดส่งเก่า — tag ตามไลน์แรกของจุด (ไลน์ในจุดเดียวต้องพื้นที่เดียวกันอยู่แล้ว — กฎของแผงจุดส่ง)
    const { data: dps, error: dpErr } = await supabaseDR.from('line_delivery_points').select('id, line_names').is('storage_location', null);
    if (dpErr && !['42P01', '42703'].includes(dpErr.code)) errs.push(`จุดส่ง: ${dpErr.message}`);
    for (const d of dps || []) {
      const code = slocOfLine(rows, lines, (d.line_names || [])[0])?.code;
      if (!code) continue;
      const { error } = await supabaseDR.from('line_delivery_points').update({ storage_location: code }).eq('id', d.id);
      if (error) errs.push(`จุดส่ง ${d.id.slice(0, 8)}: ${error.message}`); else pts++;
    }
    setBusy(false);
    if (errs.length) toast.error(`แปะไม่สำเร็จบางส่วน: ${errs[0]}${errs.length > 1 ? ` (+${errs.length - 1})` : ''}`);
    toast.success(`แปะรหัสคลังแล้ว — ledger ${total.toLocaleString()} แถว · จุดส่ง ${pts} จุด`);
    load();
  };

  const untaggedTip = untagged == null ? null : untagged > 0
    ? `ledger เก่า ${untagged.toLocaleString()} แถวยังไม่มีมุม SAP (เขียนก่อนมีชั้นนี้ หรือไลน์ยังไม่ผูก) — ยอดใน v_sloc_stock จะต่ำกว่าจริงจนกว่าจะแปะ`
    : 'ledger ทุกแถวมีมุม SAP แล้ว';

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>🏬 ทะเบียนรหัสคลัง (Storage Location)</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5 }}>
            รหัสบัญชีคลังแบบ SAP ที่อ้างในทุกบรรทัดของ BOM · {SLOC_FORMAT_HINT}
            <br />🔗 <b>ผูกไลน์แม่ครั้งเดียว ไลน์ลูกตกทอด</b> (P411 = ทั้ง Apron Assy) — ระบบแปะรหัสคลังให้ใบขอเติม / ledger / จุดส่ง เองตอนเขียน
            · ของยังนับที่ไลน์ย่อยที่สุดเหมือนเดิม (มุม SAP กับมุมไลน์คือรายการเดียวกัน) · คนละเรื่องกับ “โซนคลัง (ผัง)” ด้านล่าง
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canManage && !missing && !noLineMap && untagged > 0 && (
            <button onClick={backfill} disabled={busy} title={untaggedTip}
              style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid rgba(245,158,11,0.5)', cursor: busy ? 'wait' : 'pointer', background: 'rgba(245,158,11,0.1)', color: '#f59e0b', fontSize: 12.5, fontWeight: 800, fontFamily: 'var(--font-body)' }}>
              {busy ? '…' : `🏷️ แปะรหัสคลังย้อนหลัง (${untagged.toLocaleString()} แถว)`}
            </button>
          )}
          {canManage && !missing && (
            <button onClick={() => setEdit({ code: '', name: '', kind: '', note: '', sort_order: (rows.length + 1) * 10, is_active: true, line_names: [] })}
              style={{ padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'var(--accent)', color: '#08130a', fontSize: 13, fontWeight: 800, fontFamily: 'var(--font-body)' }}>
              + เพิ่มรหัสคลัง
            </button>
          )}
        </div>
      </div>

      <ReadOnlyNote show={!canManage && !missing} role={role} what="จัดการทะเบียนรหัสคลัง" permKey="storage:manage" />

      {missing && (
        <div style={{ padding: '12px 14px', borderRadius: 8, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', fontSize: 12.5, color: '#f59e0b', fontWeight: 700 }}>
          ⚠️ ยังไม่ได้ apply migration <code>20260902_storage_locations_master.sql</code> — ทะเบียนยังใช้ไม่ได้ (แจ้ง admin)
        </div>
      )}
      {!missing && noLineMap && (
        <div style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', fontSize: 12, color: '#f59e0b', marginBottom: 10 }}>
          ⚠️ ยังไม่ได้ apply migration <code>{MIG_DR}</code> (DR) — <b>ผูกไลน์กับรหัสคลังยังไม่ได้</b> ใบ/ledger จึงยังไม่มีมุม SAP (แจ้ง admin)
        </div>
      )}

      {!missing && orphan.length > 0 && (
        <div style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', fontSize: 12, color: '#f59e0b', marginBottom: 10 }}>
          <b>⚠ มีรหัสที่ถูกใช้ใน BOM แต่ยังไม่อยู่ในทะเบียน {orphan.length} รหัส</b> — อาจพิมพ์ผิด หรือเป็นพื้นที่ใหม่ที่ยังไม่ลงทะเบียน
          <div style={{ marginTop: 5, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {orphan.map(c => (
              <span key={c} onClick={canManage ? () => setEdit({ code: c, name: '', kind: slocKindGuess(c) || '', note: '', sort_order: (rows.length + 1) * 10, is_active: true, line_names: [] }) : undefined}
                style={{ fontFamily: 'monospace', fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: 'rgba(245,158,11,0.16)', cursor: canManage ? 'pointer' : 'default' }}>
                {c}{canManage ? ' +' : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* worklist: ไลน์ย่อยที่ยังไม่มีมุม SAP — ใบ/ledger ของไลน์พวกนี้จะไม่ถูกแปะรหัส (ห้ามซ่อน · ไม่เดาให้) */}
      {!missing && !noLineMap && !loading && unmappedLeaf.length > 0 && (
        <div style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.3)', fontSize: 12, color: 'var(--text2)', marginBottom: 10 }}>
          <b style={{ color: '#3b82f6' }}>🔗 ไลน์ที่ยังไม่ผูกรหัสคลัง {unmappedLeaf.length} ไลน์</b> — ใบขอเติม/ตัดสต็อกของไลน์เหล่านี้จะไม่มีมุม SAP จนกว่าจะผูก (ผูกที่ไลน์แม่ทีเดียวได้)
          <div style={{ marginTop: 4, color: 'var(--muted)', lineHeight: 1.6 }}>{unmappedLeaf.slice(0, 30).join(' · ')}{unmappedLeaf.length > 30 ? ` … (+${unmappedLeaf.length - 30})` : ''}</div>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>กำลังโหลด...</div>
      ) : !missing && rows.length === 0 ? (
        <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: 13, background: 'var(--bg2)', borderRadius: 8, border: '1px dashed var(--border)' }}>
          ยังไม่มีรหัสคลังในทะเบียน{canManage && ' — กด "+ เพิ่มรหัสคลัง"'}
        </div>
      ) : !missing && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map(r => {
            const meta = slocKindMeta(r.kind);
            const inUse = !!usedCount[slocLabel(r.code)];
            const own = Array.isArray(r.line_names) ? r.line_names : [];
            const cover = coverOf(r);
            const inherited = cover.filter(n => !own.includes(n));
            return (
              <div key={r.code} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8,
                background: 'var(--bg2)', border: '1px solid var(--border)', opacity: r.is_active ? 1 : 0.5 }}>
                <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 14, padding: '3px 9px', borderRadius: 8, background: `${meta.color}1f`, color: meta.color, flexShrink: 0 }}>
                  {r.code}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{r.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
                    {meta.icon} {meta.label}
                    {!r.kind && <span style={{ color: '#f59e0b' }}> · ⚠ ยังไม่ระบุชนิด</span>}
                    {r.note && <span> · {r.note}</span>}
                    {!r.is_active && <span style={{ color: '#f59e0b' }}> · ปิดใช้งาน</span>}
                  </div>
                  {!noLineMap && (
                    <div style={{ fontSize: 11, marginTop: 3, lineHeight: 1.5 }}>
                      {own.length
                        ? <><span style={{ color: '#3b82f6', fontWeight: 700 }}>🔗 {own.join(' · ')}</span>
                            {inherited.length > 0 && <span style={{ color: 'var(--muted)' }}> → ตกทอด {inherited.length} ไลน์: {inherited.slice(0, 8).join(' · ')}{inherited.length > 8 ? ` … (+${inherited.length - 8})` : ''}</span>}</>
                        : <span style={{ color: 'var(--muted)' }}>— ยังไม่ผูกไลน์ (ไม่มีอะไรถูกแปะรหัสนี้อัตโนมัติ)</span>}
                    </div>
                  )}
                </div>
                {inUse && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', flexShrink: 0 }}>ใช้ใน BOM</span>}
                {canManage && (
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button className="tbtn" onClick={() => setEdit({ ...r, line_names: own })} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text)', cursor: 'pointer', fontSize: 12 }}>✏️</button>
                    <button className="tbtn" onClick={() => remove(r)} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', color: '#ef4444', cursor: 'pointer', fontSize: 12 }}>🗑</button>
                  </div>
                )}
              </div>
            );
          })}
          {untaggedTip && !noLineMap && <div style={{ fontSize: 11, color: untagged > 0 ? '#f59e0b' : 'var(--muted)', marginTop: 4 }}>{untagged > 0 ? '⚠ ' : '✓ '}{untaggedTip}</div>}
        </div>
      )}

      {edit && (
        <LocForm init={edit} isNew={!rows.some(r => r.code === edit.code)} onSave={save} onClose={() => setEdit(null)}
          rows={rows} lines={lines} noLineMap={noLineMap} role={role} lineId={lineId} sections={sections} />
      )}
    </div>
  );
}

function LocForm({ init, isNew, onSave, onClose, rows, lines, noLineMap, role, lineId, sections }) {
  const [f, setF] = useState({ ...init, code: slocLabel(init.code), line_names: Array.isArray(init.line_names) ? init.line_names : [] });
  const [busy, setBusy] = useState(false);
  const [addLine, setAddLine] = useState('');
  const code = slocLabel(f.code);
  const badFormat = code !== '' && !slocValid(code);
  const guess = slocKindGuess(code);

  // ตัวอย่างว่าผูกแบบนี้แล้ว "ครอบ" ไลน์ไหนบ้าง (ผ่าน helper เดียวกับที่ระบบใช้จริง — จะได้ไม่มีเซอร์ไพรส์ตอนเซฟ)
  const preview = useMemo(() => {
    const tmp = [...(rows || []).filter(r => r.code !== code), { code, line_names: f.line_names, is_active: true }];
    return linesOfSloc(tmp, lines, code).filter(n => !f.line_names.includes(n));
  }, [rows, lines, code, f.line_names]);
  const addName = (v) => { if (v && !f.line_names.includes(v)) setF(x => ({ ...x, line_names: [...x.line_names, v] })); setAddLine(''); };

  const submit = async () => { setBusy(true); await onSave(f); setBusy(false); };

  return (
    <div className="modal-scroll" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 14, padding: 24, width: 'min(480px,100%)', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-display)', marginBottom: 14 }}>
          {isNew ? '➕ เพิ่มรหัสคลัง' : `✏️ แก้ไข ${init.code}`}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>รหัส *</label>
            <input autoFocus={isNew} disabled={!isNew} maxLength={6}
              style={{ ...inputSt, fontFamily: 'monospace', fontSize: 18, fontWeight: 800, textAlign: 'center', textTransform: 'uppercase', opacity: isNew ? 1 : 0.55 }}
              value={f.code} onChange={e => setF(v => ({ ...v, code: e.target.value }))} placeholder="S401" />
            <div style={{ fontSize: 10.5, marginTop: 3, lineHeight: 1.45 }}>
              {badFormat
                ? <span style={{ color: '#ef4444', fontWeight: 700 }}>🔴 {SLOC_FORMAT_HINT}</span>
                : <span style={{ color: 'var(--muted)' }}>{SLOC_FORMAT_HINT}</span>}
              {/* รหัสเป็น PK และถูกอ้างใน BOM → แก้ไม่ได้ ต้องบอกเหตุผล ไม่ใช่ปิดเฉยๆ */}
              {!isNew && <div style={{ color: 'var(--muted)' }}>รหัสแก้ไม่ได้ (ถูกอ้างใน BOM) — ถ้าตั้งผิด ให้เพิ่มรหัสใหม่แล้วปิดใช้งานตัวเก่า</div>}
            </div>
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>ชื่อพื้นที่ *</label>
            <input autoFocus={!isNew} style={inputSt} value={f.name} onChange={e => setF(v => ({ ...v, name: e.target.value }))} placeholder="เช่น พื้นที่ผลิต Apron Assy" />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>ชนิดพื้นที่</label>
            <select style={inputSt} value={f.kind || ''} onChange={e => setF(v => ({ ...v, kind: e.target.value }))}>
              <option value="">— ยังไม่ระบุ —</option>
              {Object.entries(SLOC_KINDS).map(([k, m]) => <option key={k} value={k}>{m.icon} {m.label}</option>)}
            </select>
            {/* 💡 ระบบเสนอจากตัวอักษรนำหน้า **คนกดยืนยันเอง** ไม่เติมให้อัตโนมัติ */}
            {guess && guess !== f.kind && (
              <div onClick={() => setF(v => ({ ...v, kind: guess }))} style={{ fontSize: 10.5, color: '#0ea5e9', cursor: 'pointer', marginTop: 3, fontWeight: 700 }}>
                💡 รหัสขึ้นต้น {code[0]} — น่าจะเป็น “{slocKindMeta(guess).label}” (กดเพื่อใช้)
              </div>
            )}
          </div>

          {/* 🔗 ไลน์ที่ตกอยู่ในพื้นที่นี้ — ใส่ไลน์แม่ครั้งเดียว ลูกตกทอด */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>🔗 ไลน์/พื้นที่ที่อยู่ในรหัสคลังนี้</label>
            {noLineMap ? (
              <div style={{ fontSize: 11.5, color: '#f59e0b' }}>ยังไม่ได้ apply migration <code>{MIG_DR}</code> (DR) — ผูกไลน์ยังไม่ได้</div>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  {f.line_names.map(n => (
                    <span key={n} style={{ fontSize: 12, fontWeight: 700, padding: '3px 9px', borderRadius: 12, background: 'rgba(59,130,246,0.12)', color: '#3b82f6', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      {n}
                      <button type="button" onClick={() => setF(x => ({ ...x, line_names: x.line_names.filter(y => y !== n) }))} style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', padding: 0, fontSize: 13, lineHeight: 1 }}>✕</button>
                    </span>
                  ))}
                  <LineSelect lines={(lines || []).filter(l => !f.line_names.includes(l.name))} value={addLine} onChange={addName}
                    placeholder="+ เพิ่มไลน์ (ใส่ไลน์แม่ = ครอบทั้งแผนก)" role={role} lineId={lineId} sections={sections}
                    style={{ width: 260, padding: '6px 9px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: 12.5 }} />
                  {VIRTUAL_LINES.filter(v => !f.line_names.includes(v)).map(v => (
                    <button key={v} type="button" onClick={() => addName(v)} title={`"${v}" คือพื้นที่เสมือนที่ถือสต็อกใน Line Stock (ไม่ใช่ไลน์ผลิต)`}
                      style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 12, border: '1px dashed var(--border2)', background: 'transparent', color: 'var(--text2)', cursor: 'pointer' }}>
                      + {v}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 4, lineHeight: 1.5 }}>
                  ไลน์ลูกตกทอดจากไลน์แม่อัตโนมัติ · ไลน์ลูกที่ผูกรหัสอื่นเองจะชนะแม่ · ไลน์หนึ่งอยู่ได้พื้นที่เดียว
                  {preview.length > 0 && <div style={{ color: 'var(--text2)' }}>→ ครอบเพิ่ม {preview.length} ไลน์: {preview.slice(0, 10).join(' · ')}{preview.length > 10 ? ` … (+${preview.length - 10})` : ''}</div>}
                </div>
              </>
            )}
          </div>

          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>หมายเหตุ</label>
            <input style={inputSt} value={f.note || ''} onChange={e => setF(v => ({ ...v, note: e.target.value }))} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text)', cursor: 'pointer' }}>
            <input type="checkbox" checked={!!f.is_active} onChange={e => setF(v => ({ ...v, is_active: e.target.checked }))} />
            ใช้งาน (เอาติ๊กออก = ซ่อนจากตัวเลือก + ไลน์ที่ผูกไว้ไม่ถูกแปะรหัสนี้อีก แต่ BOM/ledger เดิมที่อ้างอยู่ยังอ่านได้)
          </label>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button onClick={onClose} style={{ padding: '9px 18px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-body)' }}>ยกเลิก</button>
          <button onClick={submit} disabled={busy || badFormat}
            style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#08130a', cursor: busy || badFormat ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 800, fontFamily: 'var(--font-body)', opacity: busy || badFormat ? 0.5 : 1 }}>
            {busy ? '...' : '💾 บันทึก'}
          </button>
        </div>
      </div>
    </div>
  );
}
