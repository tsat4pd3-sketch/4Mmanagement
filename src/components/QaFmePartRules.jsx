/* ══════════════════════════════════════════════════════════════════════════════
   🎛️ กฎเรียกตรวจรายพาร์ท — ความถี่ (Middle) + จำนวนชิ้นต่อรอบ (2026-11-19 · คำสั่ง user)
   user: "ให้ QA setup frequency กับ sampling rate ของแต่ละ product — ตัวไหนรอบเวลา
          ตัวไหนตามจำนวนที่คอนเฟิมยอดผลิต และจำนวนที่จะตรวจต่อรอบ"
   ตาราง `qa_fme_part_rules` (Main · คีย์ mat_no) — ไม่มีแถว = ใช้ค่ากลาง (qa_fme_config)
   · โหมด: ค่ากลาง · ตามยอดผลิต (ทุก N ชิ้น · ว่าง = lot size × ตัวคูณ) · ตามเวลา (ทุก N นาที) · ไม่ตรวจ Middle
   · n ต่อรอบ = ขั้นต่ำ (ตัวเดินกฎ `evalSequence({ minPieces })` · ตกสะสม 2 = alarm เหมือนเดิม)
   ผู้อ่าน: edge `qa-fme-scan` (โหมด/คาบ) · `QaCheckSheet` (n)
   ══════════════════════════════════════════════════════════════════════════════ */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { toast } from './Toast';
import { checkWrite } from '../utils/dbWrite';
import SearchInput from './SearchInput';
import MatLabel from './MatLabel';
import { tr } from '../utils/i18n';

const MODES = [
  { k: '', label: 'ค่ากลาง' },
  { k: 'lot', label: 'ตามยอดผลิต' },
  { k: 'min', label: 'ตามเวลา' },
  { k: 'off', label: 'ไม่ตรวจ Middle' },
];
const posInt = (v) => { const n = Math.floor(Number(v)); return n > 0 ? n : null; };

export default function QaFmePartRules({ canEdit, fullName, centralMode }) {
  const [parts, setParts] = useState([]);
  const [rules, setRules] = useState({});
  const [fail, setFail] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    const [p, r] = await Promise.all([
      supabase.from('qa_parts').select('id, part_no, part_name, mat_no, line_name').eq('is_active', true)
        .not('mat_no', 'is', null).order('line_name').order('part_no').limit(1000),   // 19/11 วัด 10 พาร์ท
      supabase.from('qa_fme_part_rules').select('mat_no, mid_mode, mid_every_pcs, mid_every_min, sample_n, is_active, updated_by, updated_at').limit(1000),   // 1 แถวต่อพาร์ท QA (ไม่เกินจำนวนพาร์ท)
    ]);
    if (p.error || r.error) setFail(`${tr("โหลดไม่สำเร็จ")}: ${(p.error || r.error).message}`); else setFail('');
    setParts(p.data || []);
    const m = {}; (r.data || []).forEach(x => { m[x.mat_no] = x; }); setRules(m);
  }, []);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    const k = q.trim().toLowerCase();
    const seen = new Set();
    return parts.filter(p => {
      if (seen.has(p.mat_no)) return false; seen.add(p.mat_no);
      return !k || `${p.part_no} ${p.part_name} ${p.mat_no} ${p.line_name}`.toLowerCase().includes(k);
    });
  }, [parts, q]);
  const nSet = Object.values(rules).filter(r => r.mid_mode || r.sample_n || r.mid_every_pcs || r.is_active === false).length;

  const save = async (mat, patch) => {
    const cur = rules[mat] || {};
    const row = {
      mat_no: mat,
      mid_mode: cur.mid_mode ?? null, mid_every_pcs: cur.mid_every_pcs ?? null,
      mid_every_min: cur.mid_every_min ?? null, sample_n: cur.sample_n ?? null,
      is_active: cur.is_active ?? true, ...patch,
      updated_by: fullName || null, updated_at: new Date().toISOString(),
    };
    if (row.mid_mode) row.is_active = true;   // โหมดใหม่ชนะธงเก่า (is_active=false = ปิด Middle แบบเดิม)
    if (row.mid_mode === 'min' && !row.mid_every_min) {
      toast.error('โหมดตามเวลา ต้องใส่ "ทุกกี่นาที" (5–1440)');
    }
    setBusy(mat);
    const res = await supabase.from('qa_fme_part_rules').upsert(row, { onConflict: 'mat_no' }).select('mat_no');
    setBusy('');
    if (!checkWrite(res, 'บันทึกกฎรายพาร์ท')) return;
    setRules(m => ({ ...m, [mat]: row }));
  };

  const effMode = (r) => r?.mid_mode || (r?.is_active === false ? 'off' : '');

  return (
    <div style={{ marginTop: 10, paddingTop: 9, borderTop: '1px dashed var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <b style={{ fontSize: 12.5 }}>{tr('🎛️ กฎรายพาร์ท — ความถี่ Middle + จำนวนชิ้นต่อรอบ')}</b>
        <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{tr('ตั้งแล้ว')} {nSet} {tr('พาร์ท · ที่เหลือใช้ค่ากลาง')} ({centralMode || '—'})</span>
        <span style={{ flex: 1 }} />
        <SearchInput value={q} onChange={setQ} placeholder={tr('ค้น Part No. / ชื่อ / MAT / ไลน์')} />
      </div>
      {fail && <div style={{ fontSize: 12, color: 'var(--amber)', marginBottom: 6 }}>⚠️ {fail}</div>}
      <div style={{ maxHeight: 360, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--r-md)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 720 }}>
          <thead><tr>
            {[tr("ไลน์"), tr("พาร์ท"), 'Middle', tr("ทุกกี่ชิ้น"), tr("ทุกกี่นาที"), tr("ตรวจต่อรอบ (ชิ้น)")].map(h => (
              <th key={h} style={th}>{tr(h)}</th>
            ))}
          </tr></thead>
          <tbody>
            {rows.map(p => {
              const r = rules[p.mat_no];
              const mode = effMode(r);
              const dis = !canEdit || busy === p.mat_no;
              return (
                <tr key={p.mat_no} style={{ background: r && (mode || r.sample_n || r.mid_every_pcs) ? 'var(--accent-dim)' : undefined }}>
                  <td style={td}>{p.line_name || '—'}</td>
                  <td style={td}><MatLabel mat={p.mat_no} name={p.part_name} pNo={p.part_no} oneLine /></td>
                  <td style={td}>
                    <select disabled={dis} value={mode} onChange={e => save(p.mat_no, { mid_mode: e.target.value || null, is_active: e.target.value === 'off' ? true : (r?.is_active ?? true) })}>
                      {MODES.map(m => <option key={tr(m.k)} value={tr(m.k)}>{tr(m.label)}</option>)}
                    </select>
                  </td>
                  <td style={td}>
                    <NumCell disabled={dis || !(mode === 'lot' || (!mode && centralMode === 'lot'))} value={r?.mid_every_pcs}
                      placeholder={tr('lot×ตัวคูณ')} onSave={v => save(p.mat_no, { mid_every_pcs: posInt(v) })} />
                  </td>
                  <td style={td}>
                    <NumCell disabled={dis || mode !== 'min'} value={r?.mid_every_min} placeholder={mode === 'min' ? tr('ต้องใส่') : '—'}
                      onSave={v => save(p.mat_no, { mid_every_min: posInt(v) })} />
                    {mode === 'min' && !r?.mid_every_min && <span style={{ color: 'var(--amber)', marginLeft: 4 }} title={tr('ยังไม่ใส่นาที = ไม่เรียก Middle')}>⚠️</span>}
                  </td>
                  <td style={td}>
                    <NumCell disabled={dis} value={r?.sample_n} placeholder="1" onSave={v => save(p.mat_no, { sample_n: posInt(v) })} />
                  </td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: 'var(--muted)', padding: 14 }}>
              {parts.length ? tr('ไม่พบพาร์ทที่ตรงกับคำค้น') : tr('ยังไม่มีพาร์ทใน QA ที่ผูก MAT — ตั้งที่ /qa-setup')}
            </td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6, lineHeight: 1.6 }}>
        {tr('ตามยอดผลิต = นับจากยอดที่ฝ่ายผลิตคอนเฟิม · ตามเวลา = ซ้ำทุก N นาทีที่รุ่นยังวิ่ง · ตรวจต่อรอบ = ต้องผ่านอย่างน้อย n ชิ้นถึงปิดใบ (ตกสะสม 2 = alarm เหมือนเดิม · ใช้ทุกสเตจ First/Middle/End)')}
      </div>
    </div>
  );
}

function NumCell({ value, onSave, disabled, placeholder }) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => { setV(value ?? ''); }, [value]);
  const commit = () => { if (String(v) !== String(value ?? '')) onSave(v); };
  return (
    <input type="number" min="1" value={v} disabled={disabled} placeholder={placeholder}
      onChange={e => setV(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      style={{ width: 80, padding: '4px 6px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg2-surf)', color: 'var(--text)', opacity: disabled ? 0.45 : 1 }} />
  );
}
const th = { padding: '6px 8px', textAlign: 'left', fontSize: 11, color: 'var(--muted)', fontWeight: 700, whiteSpace: 'nowrap', borderBottom: '1px solid var(--border2)', position: 'sticky', top: 0, background: 'var(--bg3)' };
const td = { padding: '4px 8px', borderBottom: '1px solid var(--border)', verticalAlign: 'middle', color: 'var(--text)' };
