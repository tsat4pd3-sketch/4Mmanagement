import { useState, useEffect, useMemo, useCallback, useContext } from 'react';
import { supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { can } from '../utils/permissions';
import { toast } from '../components/Toast';
import { checkWriteRows } from '../utils/dbWrite';
import FilterBar from './FilterBar';
import SearchInput from './SearchInput';
import Segmented from './Segmented';
import { matColor, matLabel } from '../utils/matPrefix';
import { statusColor } from '../utils/statusTone';
import MatLabel from './MatLabel';
import {
  classifyIntermediate, phantomCounts, sortIntermediates, PHANTOM_VERDICTS,
} from '../utils/bomPhantom';

/* ═══ 🫧 ของลม (phantom) — ทะเบียนให้ PE คุม "คอนเฟิมแม่ ตัดลูก ไม่ตัดหลาน" ═══════════
   แท็บ 🫧 ใน /products (?tab=phantom) · 4/11 · คำสั่ง user (หลัก SAP)

   ตัดสต็อกจริง = trigger `fn_explode_child_demand` (DR) → `fn_bom_direct_demand(mat)`
   ตัด **ลูกตรงชั้นเดียว** · ของลมไม่ถูกตัดเอง แต่ลูกของมันถูกดึงขึ้นมาตัดที่ชั้นแม่แทน

   🔴 จอนี้แก้ได้แค่ "ทะเบียนของลม" (`bom_phantom_mats`) — **ห้ามแตะ `bom_items`** (PE แก้เอง)
   🔴 เกณฑ์ตีป้ายอยู่ `src/utils/bomPhantom.js` (pure · มีเทส) ห้ามคิดเองในจอนี้
   🔴 โหลดไม่ได้ = เขียนบนจอ ห้ามโชว์ลิสต์ว่างแล้วให้คนเข้าใจว่า "ไม่มีปัญหา"
   สิทธิ์: อ่าน = ใครเข้า /products ได้ · ติ๊ก = `products:edit` (piggyback ไม่ seed คีย์ใหม่)
   ═══════════════════════════════════════════════════════════════════════════════════ */

const BAD = statusColor('bad'), WARN = statusColor('warn'), OK = statusColor('good');
const toneOf = (v) => statusColor(PHANTOM_VERDICTS[v]?.tone || 'warn');
const fmtQty = (n) => {
  if (n == null) return '–';
  const v = Number(n) || 0;
  return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 3 });
};

const th = { textAlign: 'left', padding: '6px 8px', fontSize: 11.5, fontWeight: 700,
             color: 'var(--muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };
const td = { padding: '6px 8px', fontSize: 12, borderBottom: '1px solid var(--border)', verticalAlign: 'top' };

export default function BomPhantomPanel({ onOpenSheet }) {
  const { role } = useContext(UserContext);
  const canEdit = can('products', 'edit', role);

  const [rows, setRows]   = useState([]);
  const [reg, setReg]     = useState([]);
  const [gaps, setGaps]   = useState([]);     // mat ที่ไม่มีใบไหนตัดมันเลย (โซ่ขาด)
  const [loading, setLoading] = useState(true);
  const [loadFail, setLoadFail] = useState('');     // ลิสต์ว่างมี 2 ความหมาย — ต้องแยกให้เห็น
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [busy, setBusy]   = useState('');

  const load = useCallback(async (alive = () => true) => {
    setLoading(true);
    const [a, b, g] = await Promise.all([
      supabaseDR.rpc('fn_bom_intermediates'),
      supabaseDR.from('bom_phantom_mats').select('mat_no, seeded, note'),
      supabaseDR.rpc('fn_bom_deduct_gaps'),
    ]);
    if (!alive()) return;
    if (a.error || b.error || g.error) {
      setLoadFail(a.error?.message || b.error?.message || g.error?.message || 'อ่านข้อมูลไม่สำเร็จ');
      setRows([]); setReg([]); setGaps([]);
    } else {
      setLoadFail('');
      setRows(a.data || []);
      setReg(b.data || []);
      setGaps(g.data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let on = true;                                   // stale-response guard
    load(() => on);
    return () => { on = false; };
  }, [load]);

  const list = useMemo(() => {
    const regMap = new Map((reg || []).map(r => [String(r.mat_no || '').trim().toUpperCase(), r]));
    return sortIntermediates((rows || []).map(r => {
      const key = String(r.mat_no || '').trim().toUpperCase();
      const hit = regMap.get(key);
      return {
        ...r,
        mat_no: key,
        verdict: classifyIntermediate({
          inRegistry:  !!hit || !!r.in_registry,
          seeded:      hit ? !!hit.seeded : !!r.seeded,
          isOperation: !!r.is_operation,
          ownOrders:   r.own_orders == null ? null : Number(r.own_orders),
        }),
      };
    }));
  }, [rows, reg]);

  const counts = useMemo(() => phantomCounts(list), [list]);

  const shown = useMemo(() => {
    const q = search.trim().toUpperCase();
    return list.filter(r => {
      if (filter !== 'all' && r.verdict !== filter) return false;
      if (q && !r.mat_no.includes(q) && !String(r.part_name || '').toUpperCase().includes(q)) return false;
      return true;
    });
  }, [list, search, filter]);

  const hidden = list.length - shown.length;

  /* ── เขียนทะเบียน — RLS ปฏิเสธ UPDATE/DELETE = "สำเร็จ 0 แถว ไม่มี error" ⇒ ต้องนับแถว ── */
  const setPhantom = async (mat, on) => {
    if (!canEdit) return;
    setBusy(mat);
    try {
      if (on) {
        /* 🔑 upsert ด้วย primary key คอลัมน์ล้วน (mat_no) · ต่อ .select() แล้วนับแถว
           🔴 RLS ปฏิเสธ UPDATE/DELETE = "สำเร็จ 0 แถว ไม่มี error" ⇒ ต้อง checkWriteRows */
        const ok = checkWriteRows(await supabaseDR.from('bom_phantom_mats').upsert({
          mat_no: mat, seeded: false, created_by: 'จอ /products?tab=phantom',
        }, { onConflict: 'mat_no' }).select('mat_no'), 'ติ๊กเป็นของลม');
        if (!ok) return;
      } else {
        const ok = checkWriteRows(await supabaseDR.from('bom_phantom_mats').delete()
          .eq('mat_no', mat).select('mat_no'), 'เอาออกจากทะเบียนของลม');
        if (!ok) return;
      }
      toast.success(on ? `${mat} = ของลม — ลูกของมันจะถูกตัดที่ชั้นแม่` : `${mat} = ของจริง — ใบของมันตัดลูกเอง`);
      await load();
    } finally { setBusy(''); }
  };

  const confirmSeeded = async (mat) => {
    if (!canEdit) return;
    setBusy(mat);
    try {
      const ok = checkWriteRows(await supabaseDR.from('bom_phantom_mats')
        .update({ seeded: false }).eq('mat_no', mat).select('mat_no'), 'ยืนยันของลม');
      if (!ok) return;
      toast.success(`ยืนยัน ${mat} เป็นของลมแล้ว`);
      await load();
    } finally { setBusy(''); }
  };

  const Card = ({ n, label, color }) => (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
                  padding: '8px 12px', minWidth: 104 }}>
      <div style={{ fontSize: 19, fontWeight: 800, color: color || 'var(--text)' }}>{n}</div>
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{label}</div>
    </div>
  );

  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 10 }}>
        🔻 <b style={{ color: 'var(--text)' }}>กฎการตัดสต็อก</b> — คอนเฟิมใบไหน ตัด<b>ลูกที่ติดตัวใบนั้น</b>เท่านั้น ·
        <b>ลูกมีหน้าที่ไปตัดหลาน</b>เมื่อใบของลูกถูกคอนเฟิม · ผัง BOM สร้าง<b>ใบเดียว</b> ลูก/หลานไม่ต้องมีใบแยก
        <div style={{ marginTop: 4 }}>
          🫧 <b style={{ color: 'var(--text)' }}>ของลม (phantom)</b> = <b>ข้อยกเว้น</b> สำหรับชิ้นที่ไม่มีวันเปิดใบผลิตเอง —
          ติ๊กแล้วระบบจะข้ามตัวมัน ไปตัดลูกของมันที่ชั้นแม่แทน (ขั้น OP เป็นของลมอัตโนมัติ)
        </div>
        <div style={{ marginTop: 4 }}>
          🔴 จอนี้แก้ได้แค่ทะเบียนของลม — <b>ไม่แก้ BOM ให้</b> (PE เป็นเจ้าของข้อมูล)
        </div>
      </div>

      {loadFail && (
        <div style={{ background: 'var(--card)', border: `1px solid ${BAD}`, borderRadius: 'var(--r-md)',
                      padding: '8px 12px', marginBottom: 10, fontSize: 12, color: BAD }}>
          🔴 อ่านข้อมูลไม่สำเร็จ — <b>ตัวเลขข้างล่างเชื่อไม่ได้</b> ({loadFail})
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <Card n={counts.total} label="ลูกกลางทั้งหมด" />
        <Card n={gaps.length} label="🔴 โซ่ขาด (ไม่มีใครตัด)" color={gaps.length ? BAD : undefined} />
        <Card n={counts.seeded} label="🟡 ระบบเดา รอยืนยัน" color={counts.seeded ? WARN : undefined} />
        <Card n={counts.confirmed} label="ของลม ยืนยันแล้ว" color={OK} />
        <Card n={counts.real} label="ของจริง (มีใบผลิตเอง)" />
        {counts.unknown > 0 && <Card n={counts.unknown} label="⚠️ ตัดสินไม่ได้" color={WARN} />}
      </div>

      {/* 🔴 โซ่ขาด = mat ที่อยู่ใน BOM แต่ไม่มีใบไหนตัดมันเลย — ต้องโชว์ ห้ามซ่อน (กฎความซื่อสัตย์ของจอ) */}
      {gaps.length > 0 && (
        <div style={{ background: 'var(--card)', border: `1px solid ${BAD}`, borderRadius: 'var(--r-md)',
                      padding: '8px 12px', marginBottom: 10, fontSize: 12, lineHeight: 1.6 }}>
          🔴 <b style={{ color: BAD }}>โซ่ขาด {gaps.length} รายการ</b> — อยู่ใน BOM แต่
          <b> ไม่มีใบผลิตไหนตัดมันไปใช้เลย</b> (กฎ: ตัดลูกตรง · ลูกไปตัดหลาน ⇒ โซ่ต้องเดินถึงทุกชั้น)
          <div style={{ overflowX: 'auto', marginTop: 6 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>ชิ้นงาน</th><th style={th}>ห้อยใต้</th>
                <th style={{ ...th, textAlign: 'right' }}>ใบผลิตเอง</th>
                <th style={{ ...th, textAlign: 'right' }}>คงเหลือ</th><th style={th}>ต้องทำอะไร</th>
              </tr></thead>
              <tbody>
                {gaps.map(g => (
                  <tr key={g.mat_no}>
                    <td style={{ ...td, minWidth: 220 }}>
                      <MatLabel mat={g.mat_no} name={g.part_name} size={12} />
                    </td>
                    <td style={{ ...td, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{g.hangs_under || '–'}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{fmtQty(g.own_orders)}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{fmtQty(g.on_hand)}</td>
                    <td style={{ ...td, color: WARN, maxWidth: 420 }}>{g.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <FilterBar style={{ marginBottom: 12 }}>
        <Segmented label="สถานะ" value={filter} onChange={setFilter} options={[
          { value: 'all',       label: `ทั้งหมด (${counts.total})` },
          { value: 'gap',       label: `🔴 โซ่ขาด (${counts.gap})` },
          { value: 'seeded',    label: `🟡 รอยืนยัน (${counts.seeded})` },
          { value: 'confirmed', label: `ของลม (${counts.confirmed})` },
          { value: 'real',      label: `ของจริง (${counts.real})` },
        ]} />
        <SearchInput value={search} onChange={setSearch} fields="MAT / ชื่อพาร์ท" />
        <span className="spacer" />
        <span className="filter-count">{shown.length} รายการ</span>
      </FilterBar>

      {hidden > 0 && (
        <div style={{ fontSize: 11.5, color: 'var(--muted)', margin: '6px 2px' }}>
          ซ่อนอยู่ {hidden} รายการจากตัวกรอง (ทั้งหมด {list.length})
        </div>
      )}

      {loading ? (
        <div style={{ fontSize: 12, color: 'var(--muted)', padding: 12 }}>กำลังโหลด…</div>
      ) : shown.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--muted)', padding: 12 }}>
          {loadFail ? 'อ่านข้อมูลไม่ได้ — ไม่ใช่ว่าไม่มีรายการ' : 'ไม่มีรายการตามตัวกรองนี้'}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>ชิ้นงาน</th>
                <th style={th}>สถานะ</th>
                <th style={{ ...th, textAlign: 'right' }}>ใบผลิตเอง</th>
                <th style={{ ...th, textAlign: 'right' }}>คงเหลือ</th>
                <th style={{ ...th, textAlign: 'right' }}>ถูกอ้างในใบ</th>
                <th style={{ ...th, textAlign: 'right' }}>ลูก (แถว)</th>
                <th style={th}>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(r => {
                const meta = PHANTOM_VERDICTS[r.verdict] || {};
                const isPhantom = r.verdict === 'seeded' || r.verdict === 'confirmed';
                return (
                  <tr key={r.mat_no}>
                    <td style={{ ...td, minWidth: 220 }}>
                      <MatLabel mat={r.mat_no} name={r.part_name} size={12} />
                      <span title={matLabel(r.mat_no)} style={{ color: matColor(r.mat_no), fontSize: 11 }}>
                        {' '}{matLabel(r.mat_no)}
                      </span>
                      {onOpenSheet && r.has_own_sheet && (
                        <button onClick={() => onOpenSheet(r.mat_no)}
                          title={`เปิดใบ BOM ของ ${r.mat_no}`}
                          style={{ marginLeft: 6, fontSize: 11, background: 'none', border: 'none',
                                   color: 'var(--accent)', cursor: 'pointer', padding: 0 }}>↗</button>
                      )}
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      <span title={meta.hint || ''}
                        style={{ fontSize: 11, fontWeight: 700, color: toneOf(r.verdict),
                                 border: `1px solid ${toneOf(r.verdict)}`, borderRadius: 'var(--r-pill)', padding: '1px 7px' }}>
                        {meta.label || r.verdict}
                      </span>
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>{r.own_orders == null ? '–' : fmtQty(r.own_orders)}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{fmtQty(r.on_hand)}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{fmtQty(r.used_in)}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{fmtQty(r.kid_rows)}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      {r.verdict === 'op' ? (
                        <span style={{ fontSize: 11, color: 'var(--muted)' }}>อัตโนมัติ</span>
                      ) : !canEdit ? (
                        <span style={{ fontSize: 11, color: 'var(--muted)' }}>ดูอย่างเดียว</span>
                      ) : (
                        <span style={{ display: 'inline-flex', gap: 6 }}>
                          {r.verdict === 'seeded' && (
                            <button onClick={() => confirmSeeded(r.mat_no)} disabled={busy === r.mat_no}
                              style={{ fontSize: 11, padding: '2px 8px', borderRadius: 'var(--r-md)',
                                       border: `1px solid ${OK}`, color: OK, background: 'var(--card)', cursor: 'pointer' }}>
                              ✓ ยืนยัน
                            </button>
                          )}
                          <button onClick={() => setPhantom(r.mat_no, !isPhantom)} disabled={busy === r.mat_no}
                            style={{ fontSize: 11, padding: '2px 8px', borderRadius: 'var(--r-md)',
                                     border: '1px solid var(--border)', color: 'var(--text)',
                                     background: 'var(--card)', cursor: 'pointer' }}>
                            {isPhantom ? 'ไม่ใช่ของลม' : 'ติ๊กเป็นของลม'}
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
