/* ═══ DieStatusBoard — 📊 สถานะแม่พิมพ์ (แท็บใน /die-registry) — 2026-08-19 ═══════════════
   บอร์ดติดตามสถานะแม่พิมพ์ทั้งทะเบียน: สรุปตัวนับต่อสถานะ + ตารางไล่ดู/เปลี่ยนสถานะรายตัว
   • สถานะ manual (die_status) เปลี่ยนได้จาก select ในแถว (สิทธิ์ machines:edit)
   • "มีใบซ่อม MO ค้าง" derive สดจาก mtn_orders — คอลัมน์นี้ทำงานได้แม้ยังไม่ apply migration
   • ยังไม่ระบุสถานะ = worklist (ตัวนับส้ม + กรองดูเฉพาะได้) ห้ามซ่อน                      */
import { useState, useMemo } from 'react';
import { toast } from './Toast';
import {
  DIE_STATUSES, DIE_STATUS_UNSET, dieStatusMeta, buildOpenMoMap, openMosOf,
  regrindOver, saveDieStatus, MO_STATUS_LABEL, MIGRATION_HINT,
} from '../utils/dieStatus';

const inp = { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' };
const warnBox = { background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.45)', borderRadius: 10, padding: '10px 14px', fontSize: 12.5, color: 'var(--text)' };
const thStyle = { padding: '6px 8px', fontWeight: 700, fontSize: 11.5, color: 'var(--muted)', textAlign: 'left', position: 'sticky', top: 0, background: 'var(--card)', zIndex: 1, whiteSpace: 'nowrap' };
const tdStyle = { padding: '6px 8px', fontSize: 12, verticalAlign: 'top' };

export default function DieStatusBoard({
  dies, setsById, areas, openMos, products = [], canEdit, fullName, ready, patchDieExt, onShowOnMap,
}) {
  const [fStatus, setFStatus] = useState('');   // '' | key | 'unset' | 'mo' | 'regrind'
  const [fLine, setFLine] = useState('');
  const [q, setQ] = useState('');
  const [savingId, setSavingId] = useState(null);

  const moMap = useMemo(() => buildOpenMoMap(openMos), [openMos]);
  const activeDies = useMemo(() => dies.filter(d => d.is_active), [dies]);
  const lineNames = useMemo(
    () => [...new Set(activeDies.map(d => d.line_name).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [activeDies]);
  const areaNameOf = (id) => areas.find(a => a.id === id)?.name || null;
  const setNameOf = (d) => setsById[d.ext?.die_set_id]?.part_name || null;
  // 🏭 link แม่พิมพ์ ↔ ไลน์ผลิต: ชุด → MAT → dr_products.line_name (ไลน์ที่ใช้พาร์ทของชุดนี้)
  const matLine = useMemo(() => {
    const m = {};
    products.forEach(p => { if (p.mat_no && p.line_name) m[p.mat_no] = p.line_name; });
    return m;
  }, [products]);
  const feedLineOf = (d) => { const s = setsById[d.ext?.die_set_id]; return s?.mat_no ? matLine[s.mat_no] || null : null; };

  const counts = useMemo(() => {
    const per = {}; let unset = 0, mo = 0, regrind = 0;
    for (const d of activeDies) {
      const k = d.ext?.die_status;
      if (k) per[k] = (per[k] || 0) + 1; else unset++;
      if (openMosOf(d, moMap).length) mo++;
      if (regrindOver(d.ext)) regrind++;
    }
    return { per, unset, mo, regrind };
  }, [activeDies, moMap]);

  const rows = useMemo(() => {
    const kw = q.trim().toLowerCase();
    const statusOrder = Object.fromEntries(DIE_STATUSES.map((s, i) => [s.key, i]));
    return activeDies
      .filter(d => !fLine || d.line_name === fLine)
      .filter(d => {
        if (!fStatus) return true;
        if (fStatus === 'unset') return !d.ext?.die_status;
        if (fStatus === 'mo') return openMosOf(d, moMap).length > 0;
        if (fStatus === 'regrind') return regrindOver(d.ext);
        return d.ext?.die_status === fStatus;
      })
      .filter(d => !kw || [d.machine_no, d.machine_name, d.line_name, setNameOf(d), d.ext?.status_note]
        .some(v => String(v || '').toLowerCase().includes(kw)))
      .sort((a, b) => {
        const am = openMosOf(a, moMap).length ? 0 : 1, bm = openMosOf(b, moMap).length ? 0 : 1;
        if (am !== bm) return am - bm;                                        // มีใบซ่อมค้างขึ้นบนสุด
        const ao = a.ext?.die_status ? (statusOrder[a.ext.die_status] ?? 90) : 99;
        const bo = b.ext?.die_status ? (statusOrder[b.ext.die_status] ?? 90) : 99;
        if (ao !== bo) return ao - bo;
        return (a.line_name || '').localeCompare(b.line_name || '') || (a.machine_no || '').localeCompare(b.machine_no || '');
      });
  }, [activeDies, fStatus, fLine, q, moMap]);    // eslint-disable-line react-hooks/exhaustive-deps

  const changeStatus = async (d, key) => {
    setSavingId(d.id);
    const { error } = await saveDieStatus({ machineId: d.id, status: key, note: d.ext?.status_note, byName: fullName });
    setSavingId(null);
    if (error) {
      const miss = error.code === '42703' || error.code === '42P01';
      return toast.error(miss ? MIGRATION_HINT : 'บันทึกสถานะไม่สำเร็จ: ' + error.message);
    }
    patchDieExt(d.id, {
      die_status: key || null,
      status_updated_at: new Date().toISOString(), status_updated_by_name: fullName || null,
    });
    toast.success(`${dieStatusMeta(key || null).icon} อัพเดทสถานะแล้ว`);
  };
  const editNote = async (d) => {
    const v = prompt('หมายเหตุสถานะ (เช่น ซ่อมคมตัด OP20 / ส่งบริษัท xxx)', d.ext?.status_note || '');
    if (v === null) return;
    const { error } = await saveDieStatus({ machineId: d.id, status: d.ext?.die_status, note: v, byName: fullName });
    if (error) {
      const miss = error.code === '42703' || error.code === '42P01';
      return toast.error(miss ? MIGRATION_HINT : 'บันทึกไม่สำเร็จ: ' + error.message);
    }
    patchDieExt(d.id, { status_note: v.trim() || null, status_updated_at: new Date().toISOString(), status_updated_by_name: fullName || null });
    toast.success('บันทึกหมายเหตุแล้ว');
  };

  const chip = (label, value, { color = 'var(--text)', border = 'var(--border)', active = false, onClick } = {}) => (
    <button key={label} onClick={onClick} style={{
      background: active ? 'var(--bg3)' : 'var(--card)', border: `1px solid ${active ? 'var(--accent)' : border}`,
      borderRadius: 10, padding: '7px 12px', minWidth: 96, textAlign: 'left', cursor: onClick ? 'pointer' : 'default',
    }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color }}>{value}</div>
    </button>
  );

  return (
    <div>
      {!ready && (
        <div style={{ ...warnBox, marginBottom: 12 }}>
          <b>⚠️ สถานะ manual ยังใช้ไม่ได้</b> — {MIGRATION_HINT}
          <div style={{ marginTop: 3, color: 'var(--muted)' }}>คอลัมน์ "ใบซ่อม MO ค้าง" ยังแสดงได้ปกติ (อ่านจากระบบแจ้งซ่อมโดยตรง)</div>
        </div>
      )}

      {/* ตัวนับ — กดเพื่อกรอง */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {chip('ทั้งหมด', activeDies.length, { active: !fStatus, onClick: () => setFStatus('') })}
        {chip('🔧 มีใบซ่อมค้าง', counts.mo, {
          color: counts.mo ? '#ef4444' : 'var(--text)', border: counts.mo ? 'rgba(239,68,68,0.5)' : 'var(--border)',
          active: fStatus === 'mo', onClick: () => setFStatus(v => v === 'mo' ? '' : 'mo'),
        })}
        {DIE_STATUSES.map(s => chip(`${s.icon} ${s.label}`, counts.per[s.key] || 0, {
          color: s.color, active: fStatus === s.key, onClick: () => setFStatus(v => v === s.key ? '' : s.key),
        }))}
        {chip(`${DIE_STATUS_UNSET.icon} ยังไม่ระบุ`, counts.unset, {
          color: counts.unset ? '#f59e0b' : 'var(--text)', border: counts.unset ? 'rgba(245,158,11,0.5)' : 'var(--border)',
          active: fStatus === 'unset', onClick: () => setFStatus(v => v === 'unset' ? '' : 'unset'),
        })}
        {chip('⚠️ เจียรครบเกณฑ์', counts.regrind, {
          color: counts.regrind ? '#ef4444' : 'var(--text)', border: counts.regrind ? 'rgba(239,68,68,0.5)' : 'var(--border)',
          active: fStatus === 'regrind', onClick: () => setFStatus(v => v === 'regrind' ? '' : 'regrind'),
        })}
      </div>

      {counts.unset > 0 && ready && (
        <div style={{ ...warnBox, marginBottom: 12 }}>
          ⚠️ แม่พิมพ์ <b>{counts.unset}</b> ตัวยังไม่ระบุสถานะ — ระบบไม่เดาให้ (หลักเดียวกับ backfill ทะเบียน)
          ให้ทีม DIE MTN ไล่ตั้งสถานะจริงจากหน้างาน แล้วตัวนับนี้จะหายเอง
        </div>
      )}

      {/* ตัวกรอง */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นหา เลขแม่พิมพ์ / พาร์ท / หมายเหตุ" style={{ ...inp, width: 260 }} />
        <select value={fLine} onChange={e => setFLine(e.target.value)} style={{ ...inp, width: 190 }}>
          <option value="">ทุกไลน์</option>
          {lineNames.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>แสดง {rows.length} ตัว</span>
      </div>

      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 340px)', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, minWidth: 190 }}>สถานะ</th>
                <th style={thStyle}>เลขแม่พิมพ์ / ชุด</th>
                <th style={thStyle}>ไลน์</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>ตัน</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>shot สะสม</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>เจียร</th>
                <th style={thStyle}>ใบซ่อม MO ค้าง</th>
                <th style={thStyle}>ตำแหน่งจัดเก็บ</th>
                <th style={thStyle}>อัพเดทสถานะล่าสุด</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(d => {
                const e = d.ext || {};
                const mos = openMosOf(d, moMap);
                const meta = dieStatusMeta(e.die_status);
                const placed = e.area_id && e.pos_x != null;
                return (
                  <tr key={d.id} style={{ borderTop: '1px solid var(--border)', background: mos.length ? 'rgba(239,68,68,0.05)' : 'transparent' }}>
                    <td style={tdStyle}>
                      {canEdit && ready ? (
                        <select value={e.die_status || ''} disabled={savingId === d.id}
                          onChange={ev => changeStatus(d, ev.target.value)}
                          style={{ ...inp, width: '100%', padding: '5px 7px', fontSize: 12, borderColor: meta.color, color: meta.color, fontWeight: 700 }}>
                          <option value="">❔ ยังไม่ระบุสถานะ</option>
                          {DIE_STATUSES.map(s => <option key={s.key} value={s.key}>{s.icon} {s.label}</option>)}
                        </select>
                      ) : (
                        <span style={{
                          fontSize: 11.5, fontWeight: 700, padding: '2px 9px', borderRadius: 999,
                          color: meta.color, background: meta.bg, border: `1px solid ${meta.color}`, whiteSpace: 'nowrap',
                        }}>{meta.icon} {meta.label}</span>
                      )}
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3, display: 'flex', gap: 4, alignItems: 'baseline' }}>
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.status_note || ''}>
                          {e.status_note ? `📝 ${e.status_note}` : ''}
                        </span>
                        {canEdit && ready && (
                          <button onClick={() => editNote(d)} title="แก้หมายเหตุสถานะ"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--muted)', padding: 0 }}>✎</button>
                        )}
                      </div>
                    </td>
                    <td style={{ ...tdStyle, maxWidth: 330 }}>
                      <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.machine_no}>{d.machine_no}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                        {setNameOf(d) || '—'}{e.op_seq != null ? ` · OP${e.op_seq}` : ''}
                        {feedLineOf(d) ? <> · 🏭 ป้อนไลน์ <b style={{ color: 'var(--text2)' }}>{feedLineOf(d)}</b></> : null}
                      </div>
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{d.line_name || '—'}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{e.tonnage_ton ?? '—'}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--muted)' }}>{Number(e.shot_total || 0).toLocaleString()}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', color: regrindOver(e) ? '#ef4444' : 'var(--text)', fontWeight: regrindOver(e) ? 800 : 400 }}>
                      {e.regrind_count || 0}{e.regrind_limit ? `/${e.regrind_limit}` : ''}{regrindOver(e) ? ' ⚠️' : ''}
                    </td>
                    <td style={tdStyle}>
                      {mos.length ? mos.map(o => (
                        <div key={o.id} style={{ fontSize: 11.5, color: '#ef4444', fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {o.mo_no || '(ยังไม่ออกเลข MO)'} <span style={{ fontWeight: 400 }}>· {MO_STATUS_LABEL[o.status] || o.status}</span>
                        </div>
                      )) : <span style={{ color: 'var(--muted)' }}>—</span>}
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      {placed ? (
                        <button onClick={() => onShowOnMap(d)} title="ดูตำแหน่งบนผังจัดเก็บ"
                          style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 7, padding: '3px 9px', fontSize: 11.5, color: 'var(--text)', cursor: 'pointer' }}>
                          🗺️ {areaNameOf(e.area_id) || 'ดูบนผัง'}
                        </button>
                      ) : (
                        <span style={{ fontSize: 11.5, color: '#f59e0b' }} title="ไปวางที่แท็บผังจัดเก็บ">ยังไม่วางบนผัง</span>
                      )}
                    </td>
                    <td style={{ ...tdStyle, fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                      {e.status_updated_at
                        ? <>{new Date(e.status_updated_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' })}
                          {e.status_updated_by_name ? <div>{e.status_updated_by_name}</div> : null}</>
                        : '—'}
                    </td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr><td colSpan={9} style={{ ...tdStyle, textAlign: 'center', color: 'var(--muted)', padding: 24 }}>ไม่พบแม่พิมพ์ตามเงื่อนไข</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 8, lineHeight: 1.7 }}>
        • "ใบซ่อม MO ค้าง" อ่านสดจากระบบแจ้งซ่อม (/mtn-repair) — ปิด MO แล้วหายจากบอร์ดเอง ไม่ต้องมาแก้สถานะซ้ำ<br />
        • ประวัติว่าใครเปลี่ยนสถานะ/ค่าไหน ดูได้จาก audit log ของตาราง equipment_die (⚙️ ข้อมูลตั้งต้น → 📜 ประวัติการแก้ไข ใน /mtn-repair)
      </div>
    </div>
  );
}
