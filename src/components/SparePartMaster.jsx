/* SparePartMaster — คลังอะไหล่ (FM-JIG-009 Spare part list) + Rank ตาม WI-JIG-010
   ข้อมูลอยู่ DR project (supabaseDR = anon) · ใช้ในแท็บ "🔩 คลังอะไหล่" ของ /mtn-repair

   หลักการ:
   - ยอดคงเหลือเคลื่อนไหวผ่าน RPC `mtn_stock_move` เท่านั้น (atomic + กันติดลบ + ลง ledger)
     ห้ามกลับไป update stock_qty ตรงๆ จาก client (read-modify-write = ยอดเพี้ยนเมื่อ 2 เครื่องทำพร้อมกัน)
   - Rank A/B/C คำนวณจากการใช้จริง (mtn_spare_usage_monthly) + leadtime ผ่าน utils/spareRank.js
     ไม่กรอก Rank เอง (แต่ override ได้พร้อมเหตุผล)
   - ตำแหน่งชั้นวาง (shelf) ใช้ "รหัสเดียวกันทั้งคลัง" (datalist ช่วยไม่ให้พิมพ์ใหม่ทุกครั้ง)
     — เป็นกุญแจที่แผนผังคลัง (rack map) จะใช้จับคู่ในเฟสถัดไป */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import ReadOnlyNote from './ReadOnlyNote';
import { supabaseDR } from '../supabaseClient';
import { toast } from './Toast';
import { can, canDelete } from '../utils/permissions';
import { pmTeamsSync } from '../utils/pmTeams';
import { teamKeyOf, filterByTeam } from '../utils/mtnTeams';
import { docFormSync, fullCode, withDocFoot } from '../utils/docForms';
import { computeSpareRank, safetyStockIssue, stockState, RANK_META, RANK_RULE, monthKeysBack } from '../utils/spareRank';
import ImageCropModal from './ImageCropModal';
import { parseSpareSheet, matchExisting, TEMPLATE_HEADERS } from '../utils/spareImport';
import { pickUnusedColor } from '../utils/colorPick';

/* ── styles (ให้ตรงกับ MtnRepair) ── */
const lbl = { display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 4 };
const inp = { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' };
const btnPri = { background: 'var(--accent)', color: '#071008', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' };
const btnGhost = { background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const th = { textAlign: 'left', padding: '8px 8px', fontSize: 11.5, fontWeight: 800, color: 'var(--text2)', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' };
const td = { padding: '7px 8px', fontSize: 12.5, borderBottom: '1px solid var(--border)', verticalAlign: 'middle' };
const Field = ({ label, required, hint, children }) => (
  <div><label style={lbl}>{label}{required && <span style={{ color: '#ef4444' }}> *</span>}</label>{children}
    {hint && <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 3 }}>{hint}</div>}</div>
);
const num = (v) => (v === '' || v == null ? null : Number(v));
const fmtNum = (v, d = 0) => (v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: d }));

/* ── storage (bucket mtn-images ร่วมกับใบซ่อม · path spare/) ── */
const mtnPath = (url) => { const p = url?.split('/mtn-images/')[1]; return p ? decodeURIComponent(p) : null; };
const removeMtnImg = (url) => { const p = mtnPath(url); if (p) supabaseDR.storage.from('mtn-images').remove([p]).catch(() => {}); };

/* ── ชิป Rank ── */
function RankChip({ rank, overridden, size = 'md' }) {
  if (!rank) return <span style={{ fontSize: 11, color: 'var(--muted)' }} title="ข้อมูลไม่พอคำนวณ (ต้องมี leadtime + ประวัติการใช้)">— ยังไม่จัด</span>;
  const m = RANK_META[rank];
  const pad = size === 'sm' ? '1px 7px' : '2px 9px';
  return (
    <span title={`Rank ${rank} · ${m.desc}${overridden ? ' (กำหนดเอง)' : ''}`}
      style={{ display: 'inline-block', padding: pad, borderRadius: 5, background: m.bg, color: m.color, border: `1px solid ${m.color}`, fontSize: size === 'sm' ? 11 : 12, fontWeight: 800, whiteSpace: 'nowrap' }}>
      {m.label}{overridden ? ' ✎' : ''}
    </span>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Main
   ══════════════════════════════════════════════════════════════════════════ */
export default function SparePartMaster({ parts = [], reload, fullName, role, myTeams = [] }) {
  const [cats, setCats] = useState([]);
  const [usage, setUsage] = useState({});          // part_id → [usage rows]
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState('');
  const [fTeam, setFTeam] = useState('');
  const [fCat, setFCat] = useState('');
  const [fRank, setFRank] = useState('');
  const [fState, setFState] = useState('');

  const [editPart, setEditPart] = useState(null);   // object = แก้ไข · 'new' = เพิ่ม
  const [movePart, setMovePart] = useState(null);   // { part, type }
  const [histPart, setHistPart] = useState(null);
  const [showCats, setShowCats] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const canEdit = can('mtn_repair', 'manage_master', role);
  const canMove = can('mtn_repair', 'service', role) || canEdit;
  const teams = pmTeamsSync();

  // default ทีม = ทีมของ user ถ้าสังกัดทีมเดียว (เห็นคลังตัวเองก่อน) — เปลี่ยนเป็น "ทุกทีม" ได้
  const didInitTeam = useRef(false);
  useEffect(() => {
    if (didInitTeam.current) return;
    if (myTeams.length === 1) { setFTeam(teamKeyOf(myTeams[0])); didInitTeam.current = true; }
    else if (myTeams.length) didInitTeam.current = true;
  }, [myTeams]);

  const loadAux = useCallback(async () => {
    setLoading(true);
    const months = monthKeysBack(RANK_RULE.windowMonths);
    const [c, u] = await Promise.all([
      supabaseDR.from('mtn_spare_categories').select('*').eq('is_active', true).order('sort_order'),
      supabaseDR.from('mtn_spare_usage_monthly').select('*').gte('month_key', months[0]),
    ]);
    setCats(c.data || []);
    const map = {};
    for (const r of (u.data || [])) (map[r.part_id] ||= []).push(r);
    setUsage(map);
    setLoading(false);
  }, []);
  useEffect(() => { loadAux(); }, [loadAux]);

  const reloadAll = useCallback(async () => { await Promise.all([reload?.(), loadAux()]); }, [reload, loadAux]);

  const catOf = useCallback((k) => cats.find(c => c.key === k), [cats]);
  // หมวดอะไหล่เป็นมุมมองของทีม (เช่น LP = Locating Pin เป็นของ JIG) → dropdown กรองตามทีมที่เลือก
  const teamCats = useMemo(() => filterByTeam(cats, fTeam), [cats, fTeam]);
  // รหัสชั้นวางที่เคยใช้ — datalist กันพิมพ์รหัสใหม่ทุกครั้ง (รหัสต้องนิ่งเพื่อผูกแผนผังคลังในอนาคต)
  const shelfOpts = useMemo(() => [...new Set(parts.map(p => p.shelf).filter(Boolean))].sort(), [parts]);

  // รวม Rank + สถานะสต็อกไว้ล่วงหน้า (ใช้ทั้งกรอง/เรียง/สรุป)
  const rows = useMemo(() => parts.map(p => {
    const rk = computeSpareRank(p, usage[p.id] || []);
    return { ...p, _rank: rk, _state: stockState(p), _safety: safetyStockIssue(rk.rank, p.min_qty) };
  }), [parts, usage]);

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return rows.filter(p => {
      if (fTeam && teamKeyOf(p.team) !== fTeam) return false;
      if (fCat && (p.category || '') !== fCat) return false;
      if (fRank && (p._rank.rank || '') !== fRank) return false;
      if (fState && p._state.key !== fState) return false;
      if (!kw) return true;
      return [p.name, p.code, p.mat_no, p.part_no, p.supplier, p.shelf, p.used_with, p.note]
        .some(v => String(v || '').toLowerCase().includes(kw));
    }).sort((a, b) => {
      // ของที่ต้องรีบเห็นขึ้นบน: หมด → ต่ำกว่าขั้นต่ำ → Rank A → ชื่อ
      const sev = (x) => (x._state.key === 'out' ? 0 : x._state.key === 'low' ? 1 : 2);
      if (sev(a) !== sev(b)) return sev(a) - sev(b);
      const rk = (x) => ({ A: 0, B: 1, C: 2 }[x._rank.rank] ?? 3);
      if (rk(a) !== rk(b)) return rk(a) - rk(b);
      return String(a.name || '').localeCompare(String(b.name || ''), 'th');
    });
  }, [rows, q, fTeam, fCat, fRank, fState]);

  const summary = useMemo(() => {
    const s = { total: filtered.length, A: 0, B: 0, C: 0, none: 0, out: 0, low: 0, value: 0, noSafety: 0 };
    for (const p of filtered) {
      if (p._rank.rank) s[p._rank.rank]++; else s.none++;
      if (p._state.key === 'out') s.out++; else if (p._state.key === 'low') s.low++;
      if (p._safety?.level === 'warn') s.noSafety++;
      s.value += (Number(p.stock_qty) || 0) * (Number(p.unit_price) || 0);
    }
    return s;
  }, [filtered]);

  const doDelete = async (p) => {
    if (!confirm(`ลบอะไหล่ "${p.name}" ออกจากคลัง?\n(ประวัติการเบิก-รับยังอยู่ ไม่ถูกลบ)`)) return;
    const { error } = await supabaseDR.from('mtn_spare_parts').update({ is_active: false }).eq('id', p.id);
    if (error) return toast.error(error.message);
    toast.success('ลบแล้ว'); reloadAll();
  };

  const printList = () => {
    const df = docFormSync('spare_part_list', {});
    const code = fullCode(df);
    const teamLabel = fTeam ? (teams.find(t => t.key === fTeam)?.dept_name || fTeam) : 'ทุกทีม';
    const head = ['ลำดับ', 'รหัส', 'ชื่ออะไหล่', 'MAT SAP', 'Part no.', 'หมวด', 'ชั้นวาง', 'คงเหลือ', 'ขั้นต่ำ', 'สูงสุด', 'Rank', 'ใช้เฉลี่ย/เดือน', 'Leadtime (วัน)', 'ผู้ขาย', 'ใช้กับ'];
    const body = filtered.map((p, i) => [
      i + 1, p.code || '', p.name || '', p.mat_no || '', p.part_no || '',
      catOf(p.category)?.label || p.category || '', p.shelf || '',
      `${fmtNum(p.stock_qty)} ${p.unit || ''}`, fmtNum(p.min_qty), fmtNum(p.max_qty),
      p._rank.rank || '-', p._rank.rank ? fmtNum(p._rank.avgPerMonth, 1) : '-',
      p.lead_time_days ?? '-', p.supplier || '', p.used_with || '',
    ]);
    const esc = (s) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const html = `<html><head><meta charset="utf-8"><title>${esc(df.title || 'รายการอะไหล่สำรอง')}</title>
      <style>@page{size:A4 landscape;margin:10mm}
      body{font-family:'Sarabun',sans-serif;font-size:10px;color:#111}
      h2{margin:0 0 2px;font-size:15px}.sub{font-size:10px;color:#555;margin-bottom:8px}
      table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:3px 4px}
      th{background:#eee;font-size:9.5px}tr{page-break-inside:avoid}</style></head><body>
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div><h2>${esc(df.title || 'รายการอะไหล่สำรอง (Spare part list)')}</h2>
        <div class="sub">ทีม: ${esc(teamLabel)} · จำนวน ${filtered.length} รายการ · พิมพ์ ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}</div></div>
        ${code ? `<div style="font-size:10px;text-align:right">${esc(code)}${df.effective_date ? `<br>Effective: ${esc(df.effective_date)}` : ''}</div>` : ''}
      </div>
      <table><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${body.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>
      <div style="margin-top:6px;font-size:9px;color:#555">Rank ตาม WI-JIG-010: A = ${esc(RANK_META.A.desc)} · B = ${esc(RANK_META.B.desc)} · C = ${esc(RANK_META.C.desc)}</div>
      </body></html>`;
    const w = window.open('', '_blank');
    if (!w) return toast.error('เบราว์เซอร์บล็อกหน้าต่างพิมพ์');
    w.document.write(withDocFoot(html, 'spare_part_list'));
    w.document.close(); w.focus(); setTimeout(() => w.print(), 400);
  };

  const chip = (label, val, color) => (
    <div style={{ background: 'var(--bg3)', border: `1px solid ${color || 'var(--border)'}`, borderRadius: 8, padding: '6px 11px', minWidth: 78 }}>
      <div style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: color || 'var(--text)' }}>{val}</div>
    </div>
  );

  return (
    <div>
      <ReadOnlyNote show={!canEdit && !canMove} role={role} what="แก้ทะเบียนอะไหล่/รับเข้า-เบิก"
        permKey="mtn_repair:manage_master, mtn_repair:service"
        hint="ค้นหาอะไหล่/ดูตำแหน่งชั้นวางได้ตามปกติ (ตั้งใจให้ช่างทุกคนค้นของได้)" />
      {/* ── แถบเครื่องมือ ── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 ค้นหา ชื่อ / รหัส / MAT / Part no. / ผู้ขาย / ชั้นวาง / ใช้กับ"
          style={{ ...inp, width: 340, flex: '1 1 260px' }} />
        <select value={fTeam} onChange={e => setFTeam(e.target.value)} style={{ ...inp, width: 160 }}>
          <option value="">ทุกทีม</option>
          {teams.map(t => <option key={t.key} value={t.key}>{t.icon || ''} {t.dept_name || t.label}</option>)}
        </select>
        <select value={fCat} onChange={e => setFCat(e.target.value)} style={{ ...inp, width: 170 }}>
          <option value="">ทุกหมวด</option>
          {teamCats.map(c => <option key={c.key} value={c.key}>{c.icon || ''} {c.label}</option>)}
        </select>
        <select value={fRank} onChange={e => setFRank(e.target.value)} style={{ ...inp, width: 130 }}>
          <option value="">ทุก Rank</option>
          {['A', 'B', 'C'].map(r => <option key={r} value={r}>Rank {r}</option>)}
        </select>
        <select value={fState} onChange={e => setFState(e.target.value)} style={{ ...inp, width: 150 }}>
          <option value="">ทุกสถานะ</option>
          <option value="out">หมด</option>
          <option value="low">ต่ำกว่าขั้นต่ำ</option>
          <option value="over">เกินสูงสุด</option>
          <option value="ok">ปกติ</option>
        </select>
        <button onClick={printList} style={{ ...btnGhost, padding: '8px 13px', fontSize: 12.5 }}>🖨️ พิมพ์</button>
        {canEdit && <button onClick={() => setShowImport(true)} style={{ ...btnGhost, padding: '8px 13px', fontSize: 12.5 }}>📥 นำเข้า/อัพเดท</button>}
        {canEdit && <button onClick={() => setShowCats(true)} style={{ ...btnGhost, padding: '8px 13px', fontSize: 12.5 }}>🏷️ หมวด</button>}
        {canEdit && <button onClick={() => setEditPart('new')} style={{ ...btnPri, padding: '8px 15px', fontSize: 12.5 }}>➕ เพิ่มอะไหล่</button>}
      </div>

      {/* ── สรุป ── */}
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 12 }}>
        {chip('รายการ', summary.total)}
        {chip('Rank A', summary.A, RANK_META.A.color)}
        {chip('Rank B', summary.B, RANK_META.B.color)}
        {chip('Rank C', summary.C, RANK_META.C.color)}
        {!!summary.none && chip('ยังไม่จัด', summary.none, 'var(--muted)')}
        {chip('หมด', summary.out, summary.out ? '#ef4444' : undefined)}
        {chip('ต่ำกว่าขั้นต่ำ', summary.low, summary.low ? '#f59e0b' : undefined)}
        {chip('มูลค่าคงคลัง', `฿${fmtNum(summary.value)}`)}
      </div>

      {/* Rank A/B ที่ยังไม่ตั้ง Safety Stock — เตือนนิ่ง (ไม่กระพริบ ไม่ใช่ alarm) */}
      {!!summary.noSafety && (
        <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid #f59e0b', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 12.5, color: 'var(--text)' }}>
          ⚠️ มี <b>{summary.noSafety}</b> รายการที่เป็น Rank A/B แต่ยังไม่ได้ตั้ง Safety Stock (ขั้นต่ำ) —
          ตาม WI-JIG-010 Rank A ต้องมีมากกว่าค่า Safety Stock เสมอ, Rank B ต้องมี Safety Stock
        </div>
      )}

      {loading && <div style={{ color: 'var(--muted)', fontSize: 13, padding: 10 }}>กำลังโหลด…</div>}

      {/* ── ตาราง ── */}
      <div className="table-sticky card" style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1080 }}>
          <thead><tr>
            <th style={{ ...th, width: 44 }}></th>
            <th style={th}>อะไหล่</th>
            <th style={th}>MAT / Part no.</th>
            <th style={th}>หมวด</th>
            <th style={th}>ชั้นวาง</th>
            <th style={{ ...th, textAlign: 'right' }}>คงเหลือ</th>
            <th style={{ ...th, textAlign: 'center' }}>ขั้นต่ำ/สูงสุด</th>
            <th style={{ ...th, textAlign: 'center' }}>Rank</th>
            <th style={{ ...th, textAlign: 'right' }}>ใช้/เดือน</th>
            <th style={{ ...th, textAlign: 'right' }}>LT (วัน)</th>
            <th style={th}>ผู้ขาย</th>
            <th style={{ ...th, textAlign: 'right' }}>ราคา/หน่วย</th>
            <th style={{ ...th, width: 190 }}></th>
          </tr></thead>
          <tbody>
            {filtered.map(p => {
              const st = p._state, rk = p._rank, c = catOf(p.category);
              return (
                <tr key={p.id}>
                  <td style={td}>
                    {p.image_url
                      ? <img src={p.image_url} alt="" style={{ width: 34, height: 34, objectFit: 'cover', borderRadius: 5, border: '1px solid var(--border)', cursor: 'pointer' }} onClick={() => window.open(p.image_url, '_blank')} />
                      : <div style={{ width: 34, height: 34, borderRadius: 5, background: 'var(--bg3)', border: '1px dashed var(--border)', display: 'grid', placeItems: 'center', fontSize: 13, color: 'var(--muted)' }}>🔩</div>}
                  </td>
                  <td style={td}>
                    <div style={{ fontWeight: 700 }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                      {p.code ? `${p.code} · ` : ''}{p.used_with ? `ใช้กับ ${p.used_with}` : ''}
                    </div>
                  </td>
                  <td style={{ ...td, fontSize: 11.5 }}>
                    <div>{p.mat_no || '—'}</div>
                    <div style={{ color: 'var(--muted)' }}>{p.part_no || ''}</div>
                  </td>
                  <td style={td}>
                    {c ? <span style={{ fontSize: 11.5, padding: '1px 7px', borderRadius: 4, background: 'var(--bg3)', border: `1px solid ${c.color || 'var(--border)'}`, color: c.color || 'var(--text)', fontWeight: 700, whiteSpace: 'nowrap' }}>{c.icon || ''} {c.key}</span>
                      : <span style={{ color: 'var(--muted)', fontSize: 11.5 }}>—</span>}
                  </td>
                  <td style={{ ...td, fontWeight: 700, whiteSpace: 'nowrap' }}>{p.shelf || <span style={{ color: 'var(--muted)', fontWeight: 400 }}>—</span>}</td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <span style={{ fontSize: 14, fontWeight: 800, color: st.color }}>{fmtNum(p.stock_qty)}</span>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}> {p.unit || ''}</span>
                    {st.key !== 'ok' && <div style={{ fontSize: 10.5, color: st.color, fontWeight: 700 }}>{st.label}</div>}
                  </td>
                  <td style={{ ...td, textAlign: 'center', fontSize: 11.5, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                    {fmtNum(p.min_qty)} / {Number(p.max_qty) > 0 ? fmtNum(p.max_qty) : '—'}
                    {p._safety?.level === 'warn' && <div style={{ color: '#f59e0b', fontSize: 10 }}>⚠️ ไม่มี Safety</div>}
                  </td>
                  <td style={{ ...td, textAlign: 'center' }}><RankChip rank={rk.rank} overridden={rk.overridden} /></td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <span style={{ fontWeight: 700 }}>{fmtNum(rk.avgPerMonth, 1)}</span>
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>ใช้ {fmtNum(rk.totalUsed)} / {rk.months} ด.</div>
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>{p.lead_time_days ?? <span style={{ color: '#f59e0b' }} title="ยังไม่ได้กรอก leadtime — คำนวณ Rank ไม่ได้">—</span>}</td>
                  <td style={{ ...td, fontSize: 11.5 }}>{p.supplier || '—'}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{p.unit_price != null ? `฿${fmtNum(p.unit_price, 2)}` : '—'}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    {canMove && <>
                      <button className="tbtn" onClick={() => setMovePart({ part: p, type: 'in' })} title="รับเข้า" style={{ ...btnGhost, padding: '5px 9px', fontSize: 12, color: '#22c55e' }}>➕</button>
                      <button className="tbtn" onClick={() => setMovePart({ part: p, type: 'issue' })} title="เบิกออก" style={{ ...btnGhost, padding: '5px 9px', fontSize: 12, color: '#f59e0b', marginLeft: 4 }}>➖</button>
                      <button className="tbtn" onClick={() => setMovePart({ part: p, type: 'adjust' })} title="ปรับยอด (นับจริง)" style={{ ...btnGhost, padding: '5px 9px', fontSize: 12, marginLeft: 4 }}>⚖</button>
                    </>}
                    <button className="tbtn" onClick={() => setHistPart(p)} title="ประวัติเคลื่อนไหว" style={{ ...btnGhost, padding: '5px 9px', fontSize: 12, marginLeft: 4 }}>📜</button>
                    {canEdit && <button className="tbtn" onClick={() => setEditPart(p)} title="แก้ไข" style={{ ...btnGhost, padding: '5px 9px', fontSize: 12, marginLeft: 4 }}>✏️</button>}
                    {canDelete('mtn_repair', 'manage_master', role) && <button className="tbtn" onClick={() => doDelete(p)} title="ลบ" style={{ ...btnGhost, padding: '5px 9px', fontSize: 12, color: '#ef4444', marginLeft: 4 }}>🗑</button>}
                  </td>
                </tr>
              );
            })}
            {!filtered.length && !loading && (
              <tr><td colSpan={13} style={{ ...td, textAlign: 'center', color: 'var(--muted)', padding: 24 }}>
                {parts.length ? 'ไม่พบอะไหล่ตามเงื่อนไขที่กรอง' : 'ยังไม่มีอะไหล่ในคลัง — กด "➕ เพิ่มอะไหล่"'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, lineHeight: 1.7 }}>
        📘 <b>Rank ตาม WI-JIG-010</b> (คำนวณอัตโนมัติจากการใช้จริงย้อนหลัง {RANK_RULE.windowMonths} เดือน + leadtime · ✎ = กำหนดเอง):
        <span style={{ color: RANK_META.A.color, fontWeight: 700 }}> A</span> ใช้ &gt;{RANK_RULE.usageHigh} ชิ้น/เดือน หรือ LT &gt;{RANK_RULE.ltLong} วัน — {RANK_META.A.desc} ·
        <span style={{ color: RANK_META.B.color, fontWeight: 700 }}> B</span> — {RANK_META.B.desc} ·
        <span style={{ color: RANK_META.C.color, fontWeight: 700 }}> C</span> ใช้ &lt;{RANK_RULE.usageLow} ชิ้น/เดือน และ LT &lt;{RANK_RULE.ltShort} วัน — {RANK_META.C.desc}
      </div>

      {movePart && <StockMoveModal {...movePart} fullName={fullName} onClose={() => setMovePart(null)} onDone={reloadAll} />}
      {histPart && <HistoryModal part={histPart} usageRows={usage[histPart.id] || []} onClose={() => setHistPart(null)} />}
      {editPart && <PartEditModal part={editPart === 'new' ? null : editPart} cats={cats} teams={teams} shelfOpts={shelfOpts}
        usageRows={editPart === 'new' ? [] : (usage[editPart.id] || [])} count={parts.length}
        onClose={() => setEditPart(null)} onSaved={reloadAll} />}
      {showCats && <CategoryModal cats={cats} teams={teams} onClose={() => setShowCats(false)} onSaved={loadAux} />}
      {showImport && <ImportModal parts={parts} cats={cats} teams={teams} fullName={fullName}
        onClose={() => setShowImport(false)} onDone={reloadAll} />}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   รับเข้า / เบิก / ปรับยอด — ผ่าน RPC เท่านั้น
   ══════════════════════════════════════════════════════════════════════════ */
const MOVE_META = {
  in: { title: '➕ รับเข้าคลัง', label: 'จำนวนที่รับเข้า', color: '#22c55e', note: 'เช่น รับของจากผู้ขาย / คืนของที่ไม่ได้ใช้' },
  issue: { title: '➖ เบิกออก', label: 'จำนวนที่เบิก', color: '#f59e0b', note: 'เบิกไปใช้นอกใบซ่อม (ถ้าเบิกในใบ MO ระบบหักให้เองตอนบันทึกขั้นซ่อม)' },
  adjust: { title: '⚖ ปรับยอด (นับจริง)', label: 'ยอดคงเหลือที่นับได้จริง', color: 'var(--accent2)', note: 'ใช้ตอนตรวจนับสต๊อก — ระบบจะบันทึกส่วนต่างให้เอง' },
};
function StockMoveModal({ part, type, fullName, onClose, onDone }) {
  const m = MOVE_META[type];
  const [qty, setQty] = useState(type === 'adjust' ? String(part.stock_qty ?? 0) : '');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const cur = Number(part.stock_qty) || 0;
  const n = Number(qty);
  const valid = Number.isFinite(n) && (type === 'adjust' ? n >= 0 : n > 0);
  const after = !valid ? null : type === 'in' ? cur + n : type === 'issue' ? cur - n : n;
  const notEnough = type === 'issue' && valid && after < 0;

  const save = async () => {
    if (!valid || notEnough) return;
    setSaving(true);
    const { data, error } = await supabaseDR.rpc('mtn_stock_move', {
      p_part_id: part.id, p_type: type, p_qty: n,
      p_note: note || null, p_by_name: fullName || null, p_ref_order: null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(`${m.title.replace(/^[^ ]+ /, '')} "${part.name}" → คงเหลือ ${fmtNum(data)}`);
    onDone(); onClose();
  };

  return (
    <div /* ⚠️ ฟอร์มกรอกข้อมูล — ไม่ปิดจาก backdrop กันเผลอแตะแล้วข้อมูลหาย (UI-CONVENTIONS §5) */  style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'grid', placeItems: 'center', zIndex: 2000, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 18, width: 'min(420px, 96vw)' }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: m.color, marginBottom: 3 }}>{m.title}</div>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>{part.name}</div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 12 }}>
          {part.code ? `${part.code} · ` : ''}คงเหลือปัจจุบัน <b style={{ color: 'var(--text)' }}>{fmtNum(cur)} {part.unit || ''}</b>
          {part.shelf ? ` · ชั้นวาง ${part.shelf}` : ''}
        </div>
        <div style={{ display: 'grid', gap: 10 }}>
          <Field label={m.label} required hint={m.note}>
            <input type="number" min="0" step="any" autoFocus value={qty} onChange={e => setQty(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && valid && !notEnough && save()} style={inp} />
          </Field>
          <Field label="หมายเหตุ"><input value={note} onChange={e => setNote(e.target.value)} placeholder="ไม่บังคับ" style={inp} /></Field>
          {valid && (
            <div style={{ fontSize: 12.5, background: 'var(--bg3)', border: `1px solid ${notEnough ? '#ef4444' : 'var(--border)'}`, borderRadius: 8, padding: '8px 11px' }}>
              {notEnough
                ? <span style={{ color: '#ef4444', fontWeight: 700 }}>❌ สต๊อกไม่พอ — คงเหลือ {fmtNum(cur)} เบิก {fmtNum(n)} ไม่ได้</span>
                : <>คงเหลือหลังทำรายการ: <b style={{ color: 'var(--accent)', fontSize: 14 }}>{fmtNum(after)} {part.unit || ''}</b>
                  {type === 'adjust' && <span style={{ color: 'var(--muted)' }}> · ส่วนต่าง {after - cur > 0 ? '+' : ''}{fmtNum(after - cur)}</span>}</>}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onClose} style={btnGhost}>ยกเลิก</button>
          <button onClick={save} disabled={!valid || notEnough || saving} style={{ ...btnPri, opacity: (!valid || notEnough || saving) ? 0.5 : 1, cursor: (!valid || notEnough || saving) ? 'not-allowed' : 'pointer' }}>
            {saving ? 'กำลังบันทึก…' : 'บันทึก'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   เพิ่ม / แก้ไขอะไหล่ (FM-JIG-009)
   ══════════════════════════════════════════════════════════════════════════ */
function PartEditModal({ part, cats, teams, shelfOpts, usageRows, count, onClose, onSaved }) {
  const isNew = !part;
  const [f, setF] = useState(() => ({
    code: part?.code || '', name: part?.name || '', unit: part?.unit || 'ชิ้น',
    team: part?.team || 'maintenance', mat_no: part?.mat_no || '', part_no: part?.part_no || '',
    supplier: part?.supplier || '', category: part?.category || '', shelf: part?.shelf || '',
    min_qty: part?.min_qty ?? 0, max_qty: part?.max_qty ?? 0,
    unit_price: part?.unit_price ?? '', lead_time_days: part?.lead_time_days ?? '',
    rank_override: part?.rank_override || '', rank_note: part?.rank_note || '',
    used_with: part?.used_with || '', note: part?.note || '',
    stock_qty: part?.stock_qty ?? 0,
  }));
  const [img, setImg] = useState(part?.image_url || '');
  const [cropFile, setCropFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  // ── ยอดใช้ย้อนหลังที่คีย์เอง (source='manual') — ใช้ตอนย้ายข้อมูลจาก Excel (คอลัมน์ PI/PO)
  //    เพื่อให้จัด Rank ได้ทันที ไม่ต้องรอสะสม ledger 6 เดือน
  const months = useMemo(() => monthKeysBack(RANK_RULE.windowMonths), []);
  const [manual, setManual] = useState(() => {
    const m = {};
    for (const r of usageRows) if (r.source === 'manual') m[r.month_key] = String(r.qty_out ?? '');
    return m;
  });
  const [manualDirty, setManualDirty] = useState(false);
  const setManualQty = (k, v) => { setManual(p => ({ ...p, [k]: v })); setManualDirty(true); };

  // รวมยอด system + manual สำหรับ preview Rank สดในฟอร์ม
  const previewRows = useMemo(() => {
    const sys = usageRows.filter(r => r.source !== 'manual');
    const man = Object.entries(manual)
      .filter(([, v]) => v !== '' && Number.isFinite(Number(v)))
      .map(([month_key, v]) => ({ month_key, qty_out: Number(v), qty_in: 0, source: 'manual' }));
    return [...sys, ...man];
  }, [usageRows, manual]);

  // Rank ที่คำนวณได้จาก leadtime + ยอดใช้ที่กำลังพิมพ์ (preview สดในฟอร์ม)
  const preview = useMemo(
    () => computeSpareRank({ ...part, lead_time_days: num(f.lead_time_days), rank_override: null, created_at: part?.created_at }, previewRows),
    [f.lead_time_days, previewRows, part]);

  const onPick = (e) => { const file = e.target.files?.[0]; if (file) setCropFile(file); e.target.value = ''; };
  const onCropped = async (blob) => {
    setCropFile(null);
    try {
      const path = `spare/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.jpg`;
      const { error } = await supabaseDR.storage.from('mtn-images').upload(path, blob, { upsert: true, contentType: blob.type });
      if (error) throw error;
      setImg(supabaseDR.storage.from('mtn-images').getPublicUrl(path).data.publicUrl);
    } catch (err) { toast.error('อัปโหลดรูปไม่สำเร็จ: ' + err.message); }
  };

  const save = async () => {
    if (!f.name.trim()) return toast.error('กรอกชื่ออะไหล่');
    if (f.rank_override && !f.rank_note.trim()) return toast.error('กำหนด Rank เองต้องระบุเหตุผล');
    setSaving(true);
    const payload = {
      code: f.code.trim() || null, name: f.name.trim(), unit: f.unit.trim() || 'ชิ้น',
      team: f.team, mat_no: f.mat_no.trim() || null, part_no: f.part_no.trim() || null,
      supplier: f.supplier.trim() || null, category: f.category || null, shelf: f.shelf.trim() || null,
      min_qty: Number(f.min_qty) || 0, max_qty: Number(f.max_qty) || 0,
      unit_price: num(f.unit_price), lead_time_days: num(f.lead_time_days),
      rank_override: f.rank_override || null, rank_note: f.rank_override ? f.rank_note.trim() : null,
      used_with: f.used_with.trim() || null, note: f.note.trim() || null,
      image_url: img || null,
    };
    const oldImg = part?.image_url;
    let err;
    if (isNew) {
      // สต็อกตั้งต้นลง ledger ผ่าน RPC (ไม่ตั้ง stock_qty ตรงๆ) เพื่อให้ยอดกับประวัติตรงกันเสมอ
      const { data, error } = await supabaseDR.from('mtn_spare_parts')
        .insert({ ...payload, stock_qty: 0, sort_order: count + 1 }).select('id').single();
      err = error;
      const opening = Number(f.stock_qty) || 0;
      if (!error && opening > 0) {
        const { error: e2 } = await supabaseDR.rpc('mtn_stock_move', {
          p_part_id: data.id, p_type: 'in', p_qty: opening, p_note: 'ยอดยกมาตอนสร้างรายการ', p_by_name: null, p_ref_order: null,
        });
        if (e2) toast.error('บันทึกอะไหล่แล้ว แต่ตั้งยอดยกมาไม่สำเร็จ: ' + e2.message);
      }
    } else {
      ({ error: err } = await supabaseDR.from('mtn_spare_parts').update(payload).eq('id', part.id));
      // ยอดใช้ย้อนหลังที่คีย์เอง — upsert แยก source='manual' (ไม่ทับยอดที่ ledger สะสมเอง)
      if (!err && manualDirty) {
        const rows = Object.entries(manual)
          .filter(([, v]) => v !== '' && Number.isFinite(Number(v)))
          .map(([month_key, v]) => ({ part_id: part.id, month_key, qty_out: Number(v), qty_in: 0, source: 'manual' }));
        const clear = months.filter(k => !(k in manual) || manual[k] === '');
        if (rows.length) {
          const { error: e3 } = await supabaseDR.from('mtn_spare_usage_monthly').upsert(rows, { onConflict: 'part_id,month_key,source' });
          if (e3) toast.error('บันทึกยอดใช้ย้อนหลังไม่สำเร็จ: ' + e3.message);
        }
        if (clear.length) await supabaseDR.from('mtn_spare_usage_monthly')
          .delete().eq('part_id', part.id).eq('source', 'manual').in('month_key', clear);
      }
    }
    setSaving(false);
    if (err) return toast.error(err.message);
    // ลบรูปเก่าหลัง DB สำเร็จเท่านั้น (best-effort) — กันไฟล์กำพร้าใน bucket
    if (oldImg && img !== oldImg) removeMtnImg(oldImg);
    toast.success(isNew ? 'เพิ่มอะไหล่แล้ว' : 'บันทึกแล้ว');
    onSaved(); onClose();
  };

  const g2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 };
  return (
    <>
      <div /* ⚠️ ฟอร์มกรอกข้อมูล — ไม่ปิดจาก backdrop กันเผลอแตะแล้วข้อมูลหาย (UI-CONVENTIONS §5) */  style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'grid', placeItems: 'center', zIndex: 2000, padding: 16, overflow: 'auto' }}>
        <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 18, width: 'min(760px, 96vw)', maxHeight: '92vh', overflow: 'auto' }}>
          <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 2 }}>{isNew ? '➕ เพิ่มอะไหล่เข้าคลัง' : '✏️ แก้ไขอะไหล่'}</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 14 }}>ตามฟอร์ม FM-JIG-009 Spare part list · Rank จัดอัตโนมัติตาม WI-JIG-010</div>

          <div style={{ display: 'grid', gap: 12 }}>
            <div className="mgrid" style={g2}>
              <Field label="ชื่ออะไหล่" required><input value={f.name} onChange={e => set('name', e.target.value)} style={inp} /></Field>
              <Field label="รหัสภายใน"><input value={f.code} onChange={e => set('code', e.target.value)} placeholder="เช่น SP-001" style={inp} /></Field>
              <Field label="เลข MAT (SAP)"><input value={f.mat_no} onChange={e => set('mat_no', e.target.value)} style={inp} /></Field>
              <Field label="Part no. (ผู้ผลิต)"><input value={f.part_no} onChange={e => set('part_no', e.target.value)} style={inp} /></Field>
              <Field label="ทีมที่ดูแลคลัง" required>
                <select value={f.team} onChange={e => set('team', e.target.value)} style={inp}>
                  {teams.map(t => <option key={t.key} value={t.key}>{t.icon || ''} {t.dept_name || t.label}</option>)}
                </select>
              </Field>
              <Field label="หมวดอะไหล่">
                <select value={f.category} onChange={e => set('category', e.target.value)} style={inp}>
                  <option value="">— ไม่ระบุ —</option>
                  {cats.map(c => <option key={c.key} value={c.key}>{c.icon || ''} {c.key} · {c.label}</option>)}
                </select>
              </Field>
              <Field label="ตำแหน่งชั้นวาง" hint="ใช้รหัสเดิมให้ตรงกันทั้งคลัง (เลือกจากที่เคยใช้ได้) — หาของเจอเร็วขึ้น">
                <input value={f.shelf} onChange={e => set('shelf', e.target.value)} list="spare-shelf-opts" placeholder="เช่น A-01-3" style={inp} />
                <datalist id="spare-shelf-opts">{shelfOpts.map(s => <option key={s} value={s} />)}</datalist>
              </Field>
              <Field label="ใช้กับ (เครื่อง/จิ๊ก)"><input value={f.used_with} onChange={e => set('used_with', e.target.value)} placeholder="เช่น RB-104, จิ๊ก APRON" style={inp} /></Field>
            </div>

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--accent2)', marginBottom: 8 }}>📦 สต็อก & การจัดซื้อ</div>
              <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
                {isNew
                  ? <Field label="ยอดยกมา" hint="บันทึกเป็นรายการ 'รับเข้า'"><input type="number" min="0" value={f.stock_qty} onChange={e => set('stock_qty', e.target.value)} style={inp} /></Field>
                  : <Field label="คงเหลือ" hint="แก้ผ่านปุ่ม ➕ ➖ ⚖ เท่านั้น"><input value={fmtNum(part.stock_qty)} disabled style={{ ...inp, opacity: 0.6 }} /></Field>}
                <Field label="หน่วย"><input value={f.unit} onChange={e => set('unit', e.target.value)} style={inp} /></Field>
                <Field label="ขั้นต่ำ (Safety)"><input type="number" min="0" value={f.min_qty} onChange={e => set('min_qty', e.target.value)} style={inp} /></Field>
                <Field label="สูงสุด"><input type="number" min="0" value={f.max_qty} onChange={e => set('max_qty', e.target.value)} style={inp} /></Field>
                <Field label="ผู้ขาย"><input value={f.supplier} onChange={e => set('supplier', e.target.value)} style={inp} /></Field>
                <Field label="ราคา/หน่วย (บาท)"><input type="number" min="0" step="any" value={f.unit_price} onChange={e => set('unit_price', e.target.value)} style={inp} /></Field>
                <Field label="Leadtime (วัน)" hint="ใช้จัด Rank"><input type="number" min="0" value={f.lead_time_days} onChange={e => set('lead_time_days', e.target.value)} style={inp} /></Field>
              </div>
            </div>

            {/* Rank */}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--accent2)', marginBottom: 8 }}>🏷️ Rank ความสำคัญ (WI-JIG-010)</div>
              <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', fontSize: 12.5, marginBottom: 10 }}>
                {preview.calcRank ? (
                  <>ระบบคำนวณได้: <RankChip rank={preview.calcRank} />
                    <span style={{ color: 'var(--muted)', marginLeft: 8 }}>
                      จากการใช้เฉลี่ย <b style={{ color: 'var(--text)' }}>{fmtNum(preview.avgPerMonth, 1)}</b> ชิ้น/เดือน
                      (ใช้จริง {fmtNum(preview.totalUsed)} ชิ้นใน {preview.months} เดือน)
                      {preview.leadTimeDays != null && <> · leadtime <b style={{ color: 'var(--text)' }}>{preview.leadTimeDays}</b> วัน</>}
                    </span></>
                ) : (
                  <span style={{ color: '#f59e0b' }}>
                    ⚠️ ยังคำนวณ Rank ไม่ได้ — {preview.missing === 'lead_time'
                      ? 'ต้องกรอก Leadtime (วัน) ก่อน'
                      : 'ยังไม่มีประวัติการใช้ — คีย์ยอดใช้ย้อนหลังจาก Excel ด้านล่าง หรือรอให้ระบบสะสมเองจากการเบิกใช้'}
                  </span>
                )}
              </div>

              {/* ยอดใช้ย้อนหลัง — ทางลัดให้ Rank ทำงานได้ทันทีตอนย้ายข้อมูลจาก Excel */}
              {!isNew && (
                <div style={{ marginBottom: 10 }}>
                  <label style={lbl}>ยอดที่ <b>เบิกใช้</b> ย้อนหลัง (ชิ้น/เดือน) — คีย์จากไฟล์ Excel เดิมได้</label>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {months.map(k => {
                      const sysOut = usageRows.filter(r => r.source !== 'manual' && r.month_key === k)
                        .reduce((s, r) => s + (Number(r.qty_out) || 0), 0);
                      return (
                        <div key={k} style={{ width: 82 }}>
                          <div style={{ fontSize: 10.5, color: 'var(--muted)', textAlign: 'center', marginBottom: 2 }}>{k.slice(2)}</div>
                          <input type="number" min="0" value={manual[k] ?? ''} onChange={e => setManualQty(k, e.target.value)}
                            placeholder={sysOut ? String(sysOut) : '—'} title={sysOut ? `ระบบบันทึกไว้แล้ว ${sysOut} ชิ้น (ยอดที่คีย์จะบวกเพิ่ม)` : 'ยังไม่มียอดในระบบ'}
                            style={{ ...inp, textAlign: 'center', padding: '6px 4px' }} />
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 4 }}>
                    ตัวเลขจางในช่อง = ยอดที่ระบบสะสมเองจากการเบิกจริง (ยอดที่คีย์จะ<b>บวกเพิ่ม</b> ไม่ทับกัน) · เว้นว่าง = ไม่มียอดที่คีย์เอง
                  </div>
                </div>
              )}
              <div className="mgrid" style={g2}>
                <Field label="กำหนด Rank เอง (ทับค่าที่คำนวณ)">
                  <select value={f.rank_override} onChange={e => set('rank_override', e.target.value)} style={inp}>
                    <option value="">— ใช้ค่าที่ระบบคำนวณ —</option>
                    {['A', 'B', 'C'].map(r => <option key={r} value={r}>Rank {r} · {RANK_META[r].desc}</option>)}
                  </select>
                </Field>
                <Field label="เหตุผลที่กำหนดเอง" required={!!f.rank_override}>
                  <input value={f.rank_note} onChange={e => set('rank_note', e.target.value)} disabled={!f.rank_override}
                    placeholder={f.rank_override ? 'เช่น อะไหล่วิกฤต เครื่องหยุดทั้งไลน์' : '—'} style={{ ...inp, opacity: f.rank_override ? 1 : 0.5 }} />
                </Field>
              </div>
            </div>

            {/* รูป + หมายเหตุ */}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: 12 }}>
                <div>
                  <label style={lbl}>รูปอะไหล่</label>
                  {img
                    ? <div style={{ position: 'relative' }}>
                      <img src={img} alt="" style={{ width: 140, height: 140, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
                      <button onClick={() => setImg('')} className="tbtn" style={{ ...btnGhost, position: 'absolute', top: 4, right: 4, padding: '3px 8px', fontSize: 12, color: '#ef4444' }}>✕</button>
                    </div>
                    : <label style={{ ...btnGhost, display: 'grid', placeItems: 'center', width: 140, height: 140, cursor: 'pointer', fontSize: 12, color: 'var(--muted)' }}>
                      📷 เลือกรูป<input type="file" accept="image/*" onChange={onPick} style={{ display: 'none' }} />
                    </label>}
                </div>
                <Field label="หมายเหตุ">
                  <textarea value={f.note} onChange={e => set('note', e.target.value)} rows={5} style={{ ...inp, resize: 'vertical' }} />
                </Field>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button onClick={onClose} style={btnGhost}>ยกเลิก</button>
            <button onClick={save} disabled={saving} style={{ ...btnPri, opacity: saving ? 0.5 : 1 }}>{saving ? 'กำลังบันทึก…' : 'บันทึก'}</button>
          </div>
        </div>
      </div>
      {cropFile && <ImageCropModal file={cropFile} aspect={1} outputSize={480} title="จัดรูปอะไหล่" onCancel={() => setCropFile(null)} onConfirm={onCropped} />}
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   ประวัติเคลื่อนไหว + การใช้รายเดือน
   ══════════════════════════════════════════════════════════════════════════ */
const TXN_META = {
  in: { label: 'รับเข้า', color: '#22c55e' },
  issue: { label: 'เบิกออก', color: '#f59e0b' },
  consume: { label: 'เบิกใช้ (ใบซ่อม)', color: '#f59e0b' },
  adjust: { label: 'ปรับยอด', color: 'var(--text2)' },
};
function HistoryModal({ part, usageRows, onClose }) {
  const [txns, setTxns] = useState(null);
  useEffect(() => {
    supabaseDR.from('mtn_stock_txns').select('*').eq('part_id', part.id)
      .order('created_at', { ascending: false }).limit(200)
      .then(({ data }) => setTxns(data || []));
  }, [part.id]);

  const months = monthKeysBack(RANK_RULE.windowMonths);
  const byMonth = useMemo(() => {
    const m = {};
    for (const r of usageRows) {
      const cur = m[r.month_key] || { in: 0, out: 0 };
      cur.in += Number(r.qty_in) || 0; cur.out += Number(r.qty_out) || 0;
      m[r.month_key] = cur;
    }
    return m;
  }, [usageRows]);
  const maxOut = Math.max(1, ...months.map(k => byMonth[k]?.out || 0));

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'grid', placeItems: 'center', zIndex: 2000, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 18, width: 'min(660px, 96vw)', maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ fontSize: 15, fontWeight: 800 }}>📜 ประวัติ · {part.name}</div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 14 }}>คงเหลือปัจจุบัน {fmtNum(part.stock_qty)} {part.unit || ''}</div>

        <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--accent2)', marginBottom: 6 }}>
          📊 การใช้ย้อนหลัง {RANK_RULE.windowMonths} เดือน (แทนคอลัมน์ PI/PO ในไฟล์เดิม)
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 90, marginBottom: 14, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px' }}>
          {months.map(k => {
            const out = byMonth[k]?.out || 0;
            return (
              <div key={k} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, height: '100%', justifyContent: 'flex-end' }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: out ? 'var(--text)' : 'var(--muted)' }}>{out || ''}</div>
                <div title={`${k}: เบิก ${out}`} style={{ width: '100%', height: `${Math.max(2, (out / maxOut) * 52)}px`, background: out ? '#f59e0b' : 'var(--border)', borderRadius: '3px 3px 0 0' }} />
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>{k.slice(5)}</div>
              </div>
            );
          })}
        </div>

        <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--accent2)', marginBottom: 6 }}>🧾 รายการเคลื่อนไหวล่าสุด</div>
        {txns === null && <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>กำลังโหลด…</div>}
        {txns?.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>ยังไม่มีการเคลื่อนไหว</div>}
        {!!txns?.length && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>เวลา</th><th style={th}>รายการ</th><th style={{ ...th, textAlign: 'right' }}>จำนวน</th><th style={{ ...th, textAlign: 'right' }}>คงเหลือ</th><th style={th}>โดย</th><th style={th}>หมายเหตุ</th></tr></thead>
            <tbody>
              {txns.map(t => {
                const m = TXN_META[t.type] || { label: t.type, color: 'var(--text2)' };
                const qn = Number(t.qty) || 0;
                return (
                  <tr key={t.id}>
                    <td style={{ ...td, fontSize: 11.5, whiteSpace: 'nowrap' }}>{new Date(t.created_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' })}</td>
                    <td style={{ ...td, color: m.color, fontWeight: 700, fontSize: 12 }}>{m.label}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 800, color: qn >= 0 ? '#22c55e' : '#f59e0b' }}>{qn > 0 ? '+' : ''}{fmtNum(qn)}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{fmtNum(t.balance)}</td>
                    <td style={{ ...td, fontSize: 11.5 }}>{t.by_name || '—'}</td>
                    <td style={{ ...td, fontSize: 11.5, color: 'var(--muted)' }}>{t.note || ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}><button onClick={onClose} style={btnGhost}>ปิด</button></div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   นำเข้า/อัพเดทจากไฟล์ Excel/CSV — อัพโหลดไฟล์เดิมซ้ำได้ ระบบอัพเดททับไม่สร้างซ้ำ
   ══════════════════════════════════════════════════════════════════════════ */
function ImportModal({ parts, cats, teams, fullName, onClose, onDone }) {
  const [keyField, setKeyField] = useState('code');
  const [withStock, setWithStock] = useState(false);
  const [parsed, setParsed] = useState(null);      // { rows, unknown, monthCols }
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);

  const matched = useMemo(
    () => (parsed ? matchExisting(parsed.rows, parts, keyField) : []),
    [parsed, parts, keyField]);
  const stat = useMemo(() => ({
    create: matched.filter(r => r.action === 'create').length,
    update: matched.filter(r => r.action === 'update').length,
    skip: matched.filter(r => r.action === 'skip').length,
    warn: matched.filter(r => r.action !== 'skip' && r.errors.length).length,
  }), [matched]);

  const pick = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setBusy(true); setFileName(file.name);
    try {
      const XLSX = await import('xlsx');          // dynamic import — ไม่ให้ bundle หลักบวม
      const wb = XLSX.read(await file.arrayBuffer(), { cellDates: false });
      // เลือกชีทแรกที่แปลงแล้วได้แถวข้อมูล (ไฟล์จริงมักมีหลายชีท)
      let best = null;
      for (const name of wb.SheetNames) {
        const matrix = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
        const p = parseSpareSheet(matrix, { teamKeyOf, categories: cats });
        if (p.rows.length && (!best || p.rows.length > best.rows.length)) best = p;
      }
      if (!best || !best.rows.length) {
        toast.error('อ่านไฟล์ไม่ได้ — ต้องมีหัวคอลัมน์ "ชื่ออะไหล่" หรือ "รหัส" อย่างน้อย 1 คอลัมน์');
        setParsed(null);
      } else setParsed(best);
    } catch (err) { toast.error('อ่านไฟล์ไม่สำเร็จ: ' + err.message); setParsed(null); }
    setBusy(false);
  };

  const template = async () => {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.aoa_to_sheet([
      TEMPLATE_HEADERS,
      ['SP-001', 'โซลินอยด์วาล์ว SMC', 'ชิ้น', teams[0]?.dept_name || 'MTN', '', 'VQ1000', 'SMC', cats[0]?.key || '', 'A-01-1', 5, 2, 10, 850, 30, 'RB-104', ''],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'spare parts');
    XLSX.writeFile(wb, 'spare_part_import_template.xlsx');
  };

  const apply = async () => {
    const todo = matched.filter(r => r.action !== 'skip');
    if (!todo.length) return toast.error('ไม่มีแถวที่นำเข้าได้');
    setBusy(true);
    let created = 0, updated = 0, failed = 0, stockDone = 0;
    for (let i = 0; i < todo.length; i++) {
      const r = todo[i];
      setProgress({ i: i + 1, total: todo.length });
      try {
        let pid = r.existing?.id;
        if (r.action === 'update') {
          // อัพเดทเฉพาะฟิลด์ที่มีค่าในไฟล์ — คอลัมน์ที่ไม่ได้ส่งมา ห้ามล้างของเดิมทิ้ง
          const patch = {};
          for (const [k, v] of Object.entries(r.data)) if (v !== null && v !== undefined) patch[k] = v;
          const { error } = await supabaseDR.from('mtn_spare_parts').update(patch).eq('id', pid);
          if (error) throw error;
          updated++;
        } else {
          const { data, error } = await supabaseDR.from('mtn_spare_parts')
            .insert({ ...r.data, stock_qty: 0, sort_order: parts.length + i + 1 }).select('id').single();
          if (error) throw error;
          pid = data.id; created++;
        }

        // ยอดคงเหลือ: ผ่าน RPC เสมอ (กฎเหล็ก) — ของใหม่ = รับเข้า · ของเดิม = ปรับยอด (ตรวจนับ)
        if (withStock && r.stockQty != null && pid) {
          const type = r.action === 'create' ? 'in' : 'adjust';
          if (!(type === 'in' && r.stockQty <= 0)) {
            const { error: e2 } = await supabaseDR.rpc('mtn_stock_move', {
              p_part_id: pid, p_type: type, p_qty: r.stockQty,
              p_note: `นำเข้าจากไฟล์ ${fileName}`, p_by_name: fullName || null, p_ref_order: null,
            });
            if (!e2) stockDone++;
          }
        }

        // ยอดใช้ย้อนหลังจากคอลัมน์เดือน → source 'manual'
        const uRows = Object.entries(r.usage).map(([month_key, qty_out]) => ({
          part_id: pid, month_key, qty_out, qty_in: 0, source: 'manual',
        }));
        if (uRows.length && pid)
          await supabaseDR.from('mtn_spare_usage_monthly').upsert(uRows, { onConflict: 'part_id,month_key,source' });
      } catch { failed++; }
    }
    setBusy(false); setProgress(null);
    toast.success(`นำเข้าเสร็จ — เพิ่ม ${created} · อัพเดท ${updated}${stockDone ? ` · ตั้งยอด ${stockDone}` : ''}${failed ? ` · ไม่สำเร็จ ${failed}` : ''}`);
    onDone(); onClose();
  };

  const badge = (a) => ({
    create: { t: 'เพิ่มใหม่', c: '#22c55e' }, update: { t: 'อัพเดท', c: '#38bdf8' }, skip: { t: 'ข้าม', c: '#ef4444' },
  }[a]);

  return (
    <div /* ⚠️ ฟอร์มกรอกข้อมูล — ไม่ปิดจาก backdrop กันเผลอแตะแล้วข้อมูลหาย (UI-CONVENTIONS §5) */  style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'grid', placeItems: 'center', zIndex: 2000, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 18, width: 'min(820px, 96vw)', maxHeight: '92vh', overflow: 'auto' }}>
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 2 }}>📥 นำเข้า / อัพเดทคลังอะไหล่จากไฟล์</div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 14 }}>
          รองรับ .xlsx / .csv · หัวคอลัมน์ไทยหรืออังกฤษก็ได้ · <b>อัพโหลดไฟล์เดิมซ้ำได้เรื่อยๆ</b> ระบบจะอัพเดททับตามคีย์ ไม่สร้างรายการซ้ำ
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <label style={{ ...btnPri, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.5 : 1 }}>
            📄 เลือกไฟล์<input type="file" accept=".xlsx,.xls,.csv" disabled={busy} onChange={pick} style={{ display: 'none' }} />
          </label>
          <button onClick={template} style={{ ...btnGhost, padding: '8px 13px', fontSize: 12.5 }}>⬇️ ดาวน์โหลดไฟล์ตัวอย่าง</button>
          {fileName && <span style={{ fontSize: 12, color: 'var(--muted)' }}>📎 {fileName}</span>}
        </div>

        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12, fontSize: 12.5 }}>
          <span style={{ fontWeight: 700, color: 'var(--text2)' }}>จับคู่ของเดิมด้วย:</span>
          {[['code', 'รหัสภายใน'], ['mat_no', 'เลข MAT']].map(([k, t]) => (
            <label key={k} style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
              <input type="radio" name="keyf" checked={keyField === k} onChange={() => setKeyField(k)} style={{ width: 'auto' }} />{t}
            </label>
          ))}
          <label style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer', marginLeft: 'auto' }}>
            <input type="checkbox" checked={withStock} onChange={e => setWithStock(e.target.checked)} style={{ width: 'auto' }} />
            อัพเดทยอดคงเหลือด้วย <span style={{ color: 'var(--muted)', fontSize: 11 }}>(ลงเป็นรายการรับเข้า/ปรับยอดในประวัติ)</span>
          </label>
        </div>

        {parsed && (
          <>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 10 }}>
              {[['เพิ่มใหม่', stat.create, '#22c55e'], ['อัพเดท', stat.update, '#38bdf8'], ['ข้าม', stat.skip, stat.skip ? '#ef4444' : undefined], ['ต้องดู', stat.warn, stat.warn ? '#f59e0b' : undefined]].map(([t, v, c]) => (
                <div key={t} style={{ background: 'var(--bg3)', border: `1px solid ${c || 'var(--border)'}`, borderRadius: 8, padding: '6px 12px' }}>
                  <div style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 700 }}>{t}</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: c || 'var(--text)' }}>{v}</div>
                </div>
              ))}
              {!!Object.keys(parsed.monthCols).length && (
                <div style={{ background: 'var(--bg3)', border: '1px solid var(--accent)', borderRadius: 8, padding: '6px 12px' }}>
                  <div style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 700 }}>ยอดใช้ย้อนหลัง</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--accent)' }}>{Object.keys(parsed.monthCols).join(', ')}</div>
                </div>
              )}
            </div>
            {!!parsed.unknown.length && (
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 8 }}>
                คอลัมน์ที่ระบบไม่รู้จัก (ข้ามไป): {parsed.unknown.slice(0, 10).join(' · ')}{parsed.unknown.length > 10 ? ' …' : ''}
              </div>
            )}

            <div className="table-sticky" style={{ maxHeight: 320, border: '1px solid var(--border)', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                <thead><tr>
                  <th style={th}>แถว</th><th style={th}>สถานะ</th><th style={th}>ชื่ออะไหล่</th>
                  <th style={th}>รหัส</th><th style={th}>MAT</th><th style={th}>ชั้นวาง</th>
                  <th style={{ ...th, textAlign: 'right' }}>LT</th><th style={th}>หมายเหตุการนำเข้า</th>
                </tr></thead>
                <tbody>
                  {matched.slice(0, 200).map((r, i) => {
                    const b = badge(r.action);
                    return (
                      <tr key={i} style={{ opacity: r.action === 'skip' ? 0.55 : 1 }}>
                        <td style={{ ...td, color: 'var(--muted)', fontSize: 11.5 }}>{r.rowNo}</td>
                        <td style={td}><span style={{ fontSize: 11, fontWeight: 800, color: b.c, border: `1px solid ${b.c}`, borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap' }}>{b.t}</span></td>
                        <td style={{ ...td, fontWeight: 600 }}>{r.data.name || <span style={{ color: '#ef4444' }}>(ไม่มีชื่อ)</span>}</td>
                        <td style={{ ...td, fontSize: 11.5 }}>{r.data.code || '—'}</td>
                        <td style={{ ...td, fontSize: 11.5 }}>{r.data.mat_no || '—'}</td>
                        <td style={{ ...td, fontSize: 11.5, fontWeight: 700 }}>{r.data.shelf || '—'}</td>
                        <td style={{ ...td, textAlign: 'right', fontSize: 11.5 }}>{r.data.lead_time_days ?? '—'}</td>
                        <td style={{ ...td, fontSize: 11, color: r.errors.length ? '#f59e0b' : 'var(--muted)' }}>{r.errors.join(' · ')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {matched.length > 200 && <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>แสดง 200 แถวแรกจาก {matched.length} — นำเข้าครบทุกแถว</div>}
          </>
        )}

        {progress && (
          <div style={{ marginTop: 12, fontSize: 12.5 }}>
            กำลังนำเข้า {progress.i}/{progress.total}…
            <div style={{ height: 6, background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden', marginTop: 4 }}>
              <div style={{ height: '100%', width: `${(progress.i / progress.total) * 100}%`, background: 'var(--accent)' }} />
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onClose} disabled={busy} style={{ ...btnGhost, opacity: busy ? 0.5 : 1 }}>ปิด</button>
          <button onClick={apply} disabled={busy || !parsed || !(stat.create + stat.update)}
            style={{ ...btnPri, opacity: (busy || !parsed || !(stat.create + stat.update)) ? 0.5 : 1 }}>
            {busy ? 'กำลังทำงาน…' : `นำเข้า ${stat.create + stat.update} รายการ`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   จัดการหมวดอะไหล่ (data-driven)
   ══════════════════════════════════════════════════════════════════════════ */
function CategoryModal({ cats, teams = [], onClose, onSaved }) {
  // ฟอร์มเพิ่มหมวดใหม่ default สีที่ยังไม่ซ้ำกับหมวดที่มี (ผู้ใช้เปลี่ยนทับได้)
  const [n, setN] = useState(() => ({ key: '', label: '', icon: '', color: pickUnusedColor(cats.map(c => c.color)) }));
  const add = async () => {
    const key = n.key.trim().toUpperCase();
    if (!key || !n.label.trim()) return toast.error('กรอกรหัสหมวดและชื่อ');
    const { error } = await supabaseDR.from('mtn_spare_categories')
      .insert({ key, label: n.label.trim(), icon: n.icon.trim() || null, color: n.color, sort_order: cats.length + 1 });
    if (error) return toast.error(error.message);
    setN({ key: '', label: '', icon: '', color: pickUnusedColor([...cats.map(c => c.color), n.color]) }); onSaved();
  };
  const upd = async (key, patch) => {
    const { error } = await supabaseDR.from('mtn_spare_categories').update(patch).eq('key', key);
    if (error) return toast.error(error.message);
    onSaved();
  };
  return (
    <div /* ⚠️ ฟอร์มกรอกข้อมูล — ไม่ปิดจาก backdrop กันเผลอแตะแล้วข้อมูลหาย (UI-CONVENTIONS §5) */  style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'grid', placeItems: 'center', zIndex: 2000, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 18, width: 'min(560px, 96vw)', maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 2 }}>🏷️ หมวดอะไหล่</div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 12 }}>รหัสหมวดใช้จัดกลุ่มในคลัง — เพิ่ม/แก้ได้เอง ไม่ต้องแก้โค้ด · ตั้งทีมได้ถ้าหมวดนั้นใช้เฉพาะบางทีม (เช่น LP = Locating Pin ของ JIG)</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          <input value={n.key} onChange={e => setN(p => ({ ...p, key: e.target.value }))} placeholder="รหัส (EE)" style={{ ...inp, width: 90 }} />
          <input value={n.icon} onChange={e => setN(p => ({ ...p, icon: e.target.value }))} placeholder="ไอคอน" style={{ ...inp, width: 70 }} />
          <input value={n.label} onChange={e => setN(p => ({ ...p, label: e.target.value }))} placeholder="ชื่อหมวด" style={{ ...inp, width: 200, flex: '1 1 160px' }} />
          <input type="color" value={n.color} onChange={e => setN(p => ({ ...p, color: e.target.value }))} style={{ ...inp, width: 50, padding: 3 }} />
          <button onClick={add} style={btnPri}>+ เพิ่ม</button>
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          {cats.map(c => (
            <div key={c.key} style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px' }}>
              <span style={{ fontWeight: 800, minWidth: 34, color: c.color }}>{c.key}</span>
              <input defaultValue={c.icon || ''} onBlur={e => e.target.value !== (c.icon || '') && upd(c.key, { icon: e.target.value || null })} style={{ ...inp, width: 60 }} />
              <input defaultValue={c.label} onBlur={e => e.target.value !== c.label && upd(c.key, { label: e.target.value })} style={{ ...inp, flex: 1 }} />
              <input type="color" defaultValue={c.color || '#94a3b8'} onBlur={e => e.target.value !== c.color && upd(c.key, { color: e.target.value })} style={{ ...inp, width: 46, padding: 3 }} />
              <select value={c.team || ''} onChange={e => upd(c.key, { team: e.target.value || null })}
                title="ทีมที่ใช้หมวดนี้" style={{ ...inp, width: 165, flex: '0 0 auto' }}>
                <option value="">🌐 ใช้ร่วมทุกทีม</option>
                {teams.map(t => <option key={t.key} value={t.key}>{t.icon || ''} {t.dept_name || t.label}</option>)}
              </select>
              <button className="tbtn" onClick={() => confirm(`ซ่อนหมวด ${c.key}?`) && upd(c.key, { is_active: false })} style={{ ...btnGhost, padding: '5px 9px', color: '#ef4444' }}>🗑</button>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}><button onClick={onClose} style={btnGhost}>ปิด</button></div>
      </div>
    </div>
  );
}
