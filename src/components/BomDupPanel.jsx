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
import {
  auditBomDupes, applyDupReviews, dupProgress,
  DUP_VERDICTS, DUP_DECISIONS, decisionLabel,
} from '../utils/bomDupAudit';
import { statusColor } from '../utils/statusTone';

/* ═══ 🔁 คู่ที่ "ของชิ้นเดียวถูกนิยามไว้ 2 ใบ" — จอให้ PE ไล่เคลียร์ ════════════════════
   แท็บ 🔁 ใน /products (?tab=bomdup) · user 08/10: *"ทำจอสรุป 94 คู่ให้ PE ไล่เคลียร์เลย"*

   ทำอะไร: ลิสต์คู่ (ใบ × พาร์ท) ที่ลูกถูกกรอกทั้งในใบนั้นและในใบ BOM ของพาร์ทเอง
           พร้อมบอกว่าต่างกันตรงไหน · เรียงของร้อนขึ้นก่อน · กดไปเปิดใบได้ทั้ง 2 ใบ
   🔴 **ไม่ยุบ ไม่ลบ ไม่เลือกใบให้เอง** — PE/Planning ตัดสิน (ของบางตัวใช้ต่างกันตามรุ่น/ลูกค้าได้จริง)
   🔴 **การตัดสินทั้งหมดอยู่ใน `src/utils/bomDupAudit.js`** (pure · มีเทส) ห้ามคิดเองในหน้านี้

   ลิสต์คำนวณ**สด**จาก bom_items ทุกครั้ง — แก้ BOM แล้วคู่หายเอง ไม่ต้องมากดปิด
   ตาราง `bom_dup_reviews` เก็บแค่ "คนตัดสินว่าอะไร" + ลายนิ้วมือ ⇒ BOM เปลี่ยน = คู่กลับเข้าคิว

   สิทธิ์: อ่าน = ใครเข้า /products ได้ก็เห็น · กดตรวจแล้ว = `products:edit` (piggyback ไม่ seed คีย์ใหม่)
   ═══════════════════════════════════════════════════════════════════════════════════ */

/* 🔴 สีทุกจุดในจอนี้มาจากตารางสีกลาง `STATUS_COLOR` (`utils/statusTone.js`) — ห้ามตั้ง hex เอง
   (มีด่าน `status-palette-single-source` · เคยมีแดง 4 เฉดปนกันทั้งระบบ) */
const BAD = statusColor('bad'), WARN = statusColor('warn'), OK = statusColor('good');
const toneOf = (v) => statusColor(DUP_VERDICTS[v]?.tone || 'warn');

const th = { padding: '7px 9px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: 'left', whiteSpace: 'nowrap' };
const td = { padding: '7px 9px', fontSize: 11.5, color: 'var(--text)', borderTop: '1px solid var(--border)', verticalAlign: 'top' };
const chip = (c) => ({
  fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap',
  color: c, border: `1px solid ${c}55`, background: 'var(--card)', backgroundImage: `linear-gradient(${c}14, ${c}14)`,
});
const btn = {
  fontSize: 11.5, fontWeight: 700, padding: '4px 10px', borderRadius: 7, cursor: 'pointer',
  background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border2)', fontFamily: 'var(--font-body)',
};

/** กล่องรายการ MAT — ยาวได้ ต้องตัดบรรทัดได้ ไม่ดันตารางล้นจอ */
function MatList({ mats, color }) {
  if (!mats?.length) return <span style={{ color: 'var(--muted)' }}>—</span>;
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4 }}>
      {mats.map(m => <span key={m} style={{ ...chip(color), fontFamily: 'monospace', fontWeight: 700 }}>{m}</span>)}
    </span>
  );
}

export default function BomDupPanel({ onOpenSheet }) {
  const { role, fullName } = useContext(UserContext);
  const canReview = can('products', 'edit', role);

  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');      // 🔴 โหลดไม่ได้ต้องเขียนบนจอ ห้ามโชว์ "ไม่มีปัญหา"
  const [rows, setRows] = useState([]);            // bom_items (คอลัมน์ที่ใช้เท่านั้น — กฎ egress ข้อ 11)
  const [prods, setProds] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [busyKey, setBusyKey] = useState('');

  const [vFilter, setVFilter] = useState('open');  // open | hot | cleared | all
  const [search, setSearch] = useState('');
  const [noteFor, setNoteFor] = useState('');      // dupKey ที่เปิดช่องหมายเหตุ
  const [noteText, setNoteText] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setLoadErr('');
    /* 🔴 เลือกเฉพาะคอลัมน์ที่ใช้ (bom_items โตได้ · ตารางกว้าง = egress จริง)
       bom_items ปัจจุบัน ~760 แถว — ยังไม่ชนเพดาน 1000 แต่ต้องรู้ตัว ⇒ `.range()` เผื่อโต */
    const [bomRes, prodRes, revRes] = await Promise.all([
      supabaseDR.from('bom_items').select('product_id, mat_no, parent_mat')
        .eq('is_active', true).range(0, 9999),
      supabaseDR.from('dr_products').select('id, mat_no, name, is_operation')
        .eq('is_active', true).range(0, 9999),
      supabaseDR.from('bom_dup_reviews').select('sheet_mat, component_mat, fingerprint, verdict, decision, note, reviewed_by_name, reviewed_at')
        .range(0, 9999),
    ]);
    /* 🔴 supabase-js ไม่ throw ⇒ ต้องอ่าน error เอง · คิวรีหลักล้ม = บอกบนจอ ห้ามโชว์ลิสต์ว่างแล้วให้คนเข้าใจว่า "ไม่มีปัญหา"
       ผลตรวจล้มอย่างเดียว = ยังโชว์ลิสต์ได้ แต่ต้องเขียนว่าสถานะ "ตรวจแล้ว" อาจไม่ครบ */
    const fatal = bomRes.error || prodRes.error;
    if (fatal) { setLoadErr(fatal.message || 'โหลดข้อมูล BOM ไม่สำเร็จ'); setLoading(false); return; }
    setRows(bomRes.data || []);
    setProds(prodRes.data || []);
    if (revRes.error) { setReviews([]); setLoadErr(`อ่านผลตรวจไม่สำเร็จ (${revRes.error.message}) — สถานะ "ตรวจแล้ว" อาจไม่ครบ`); }
    else setReviews(revRes.data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    let alive = true;                                 // กฎเหล็ก DB ข้อ 4: await แล้ว set state ต้องมี guard
    (async () => { await load(); if (!alive) return; })();
    return () => { alive = false; };
  }, [load]);

  /* ── ตัวลิสต์: คำนวณสดจากข้อมูล แล้วผูกผลตรวจที่คนบันทึกไว้ ── */
  const { pairs, counts, prog } = useMemo(() => {
    const matOf = {}, opOf = {}, nameOf = {};
    for (const p of prods) { matOf[p.id] = p.mat_no; opOf[p.id] = !!p.is_operation; nameOf[p.id] = p.name || ''; }
    const r = auditBomDupes(rows, matOf, {
      isOpSheet: (id) => !!opOf[id],
      infoOfSheet: (id) => ({ mat: matOf[id], name: nameOf[id] }),
    });
    const withRev = applyDupReviews(r.pairs, reviews);
    return { pairs: withRev, counts: r.counts, prog: dupProgress(withRev) };
  }, [rows, prods, reviews]);

  const shown = useMemo(() => {
    const q = search.trim().toUpperCase();
    return pairs.filter(p => {
      if (vFilter === 'open' && p.cleared) return false;
      if (vFilter === 'hot' && (p.cleared || p.rank > 3)) return false;
      if (vFilter === 'cleared' && !p.cleared) return false;
      if (!q) return true;
      return p.sheetMat.toUpperCase().includes(q) || p.mat.includes(q)
        || (p.sheetName || '').toUpperCase().includes(q) || (p.matName || '').toUpperCase().includes(q)
        || p.onlyHere.some(m => m.includes(q)) || p.onlyOwn.some(m => m.includes(q));
    });
  }, [pairs, vFilter, search]);

  /* ── กด "ตรวจแล้ว" ─────────────────────────────────────────────────────────────── */
  const saveReview = async (p, decision, note) => {
    if (!canReview) return;
    setBusyKey(p.dupKey);
    /* 🔑 upsert ด้วยคีย์ unique คอลัมน์ล้วน (sheet_mat, component_mat) — ต้องตรงกับ constraint
       🔴 ต่อ `.select('sheet_mat')` แล้วนับแถวผ่าน checkWriteRows (RLS ปฏิเสธ = 0 แถว ไม่มี error) */
    const ok = checkWriteRows(await supabaseDR.from('bom_dup_reviews').upsert({
      sheet_mat: p.sheetMat.toUpperCase(),
      component_mat: p.mat,
      fingerprint: p.fingerprint,          // ลายนิ้วมือ ณ เวลาที่ตรวจ — BOM เปลี่ยน = คู่กลับเข้าคิว
      verdict: p.verdict,
      decision,
      note: (note || '').trim() || null,
      reviewed_by_name: fullName || null,
      reviewed_at: new Date().toISOString(),
      updated_by_name: fullName || null,
    }, { onConflict: 'sheet_mat,component_mat' }).select('sheet_mat'), 'บันทึกผลตรวจคู่ BOM');
    setBusyKey('');
    if (!ok) return;
    setNoteFor(''); setNoteText('');
    toast.success(`บันทึกแล้ว — ${decisionLabel(decision)}`);
    await load();
  };

  const clearReview = async (p) => {
    if (!canReview) return;
    setBusyKey(p.dupKey);
    const ok = checkWriteRows(await supabaseDR.from('bom_dup_reviews').delete()
      .eq('sheet_mat', p.sheetMat.toUpperCase()).eq('component_mat', p.mat)
      .select('sheet_mat'), 'ยกเลิกผลตรวจคู่ BOM');
    setBusyKey('');
    if (!ok) return;
    toast.info('ยกเลิกผลตรวจแล้ว — คู่นี้กลับเข้าคิว');
    await load();
  };

  if (loading) return <div style={{ padding: 16, fontSize: 12, color: 'var(--muted)' }}>กำลังโหลด…</div>;

  return (
    <>
      {/* 🔴 โหลดไม่ครบต้องเขียนบนจอ — "ลิสต์ว่าง" กับ "คิวรีล่ม" คนละเรื่อง */}
      {loadErr && (
        <div style={{ marginBottom: 12, padding: '9px 13px', borderRadius: 9, fontSize: 12, fontWeight: 700,
          color: BAD, border: `1px solid ${BAD}55`, background: 'var(--card)',
          backgroundImage: `linear-gradient(${BAD}14, ${BAD}14)` }}>
          ⚠️ {loadErr}
        </div>
      )}

      {/* ── ที่มา + สิ่งที่จอนี้ไม่ทำ (คนอ่านครั้งแรกต้องเข้าใจว่าทำไมมีคู่พวกนี้) ── */}
      <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 10, fontSize: 12, lineHeight: 1.65,
        color: 'var(--text2)', border: '1px solid var(--border)', background: 'var(--bg2)' }}>
        <div style={{ fontWeight: 800, color: 'var(--text)', marginBottom: 2 }}>
          🔁 ของชิ้นเดียวถูกกรอกลูกไว้ 2 ที่ — ใบที่ใช้มัน และใบ BOM ของตัวมันเอง
        </div>
        ระบบใช้ <b>ชุดของใบที่กำลังกางอยู่ชนะทั้งชุด</b> (ไม่ได้เอา 2 ชุดมารวมกัน) ⇒
        ตัวที่มีแต่ในใบของพาร์ทเอง <b style={{ color: BAD }}>ไม่ถูกระเบิดเลย</b> ·
        <b> จอนี้ชี้ให้เห็นอย่างเดียว ไม่ยุบ/ไม่ลบ/ไม่เลือกใบให้เอง</b> —
        ของบางตัวใช้ต่างกันตามรุ่น/ลูกค้าได้จริง การตัดสินเป็นของ PE/Planning
      </div>

      {/* ── ความคืบหน้า ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10,
        alignContent: 'start', marginBottom: 12 }}>
        {[
          { k: 'เหลือต้องตรวจ', v: prog.open, c: prog.open ? WARN : OK, sub: `จากทั้งหมด ${prog.total} คู่` },
          { k: '🔥 ของร้อนที่ยังไม่แตะ', v: prog.openHot, c: prog.openHot ? BAD : OK, sub: 'ขาดของ / ขัดกัน / มีเกิน' },
          { k: 'MAT ที่หายจากการระเบิด', v: counts.missingMats, c: counts.missingMats ? BAD : OK, sub: 'ความต้องการเป็น 0 ทั้งที่ใช้จริง' },
          { k: 'ตรวจแล้ว', v: prog.cleared, c: OK, sub: prog.stale ? `⚠️ ${prog.stale} คู่ต้องตรวจซ้ำ (BOM เปลี่ยน)` : 'ข้อมูลยังเหมือนตอนตรวจ' },
        ].map(s => (
          <div key={s.k} style={{ padding: '9px 12px', borderRadius: 10, background: 'var(--card)',
            border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{s.k}</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: s.c, lineHeight: 1.2 }}>{s.v}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{s.sub}</div>
          </div>
        ))}
      </div>

      <FilterBar style={{ marginBottom: 12 }}>
        <Segmented label="สถานะ" value={vFilter} onChange={setVFilter} options={[
          { value: 'open', label: `ยังไม่ตรวจ (${prog.open})` },
          { value: 'hot', label: `🔥 ของร้อน (${prog.openHot})` },
          { value: 'cleared', label: `ตรวจแล้ว (${prog.cleared})` },
          { value: 'all', label: `ทั้งหมด (${prog.total})` },
        ]} />
        <SearchInput value={search} onChange={setSearch} fields="MAT ใบ / พาร์ท / ชื่อ" />
        <span className="spacer" />
        <span className="filter-count">{shown.length} คู่</span>
      </FilterBar>

      {/* 🔴 ว่างต้องเขียนว่าว่างเพราะอะไร ห้ามซ่อนแผงเงียบๆ */}
      {!shown.length ? (
        <div style={{ padding: 20, textAlign: 'center', fontSize: 12.5, color: 'var(--muted)',
          border: '1px dashed var(--border2)', borderRadius: 10 }}>
          {!prog.total ? '✅ ไม่มีคู่ที่นิยามไว้ 2 ใบเลย'
            : vFilter === 'open' ? '✅ ตรวจครบทุกคู่แล้ว (กด "ทั้งหมด" เพื่อดูย้อนหลัง)'
            : vFilter === 'hot' ? '✅ ของร้อนเคลียร์หมดแล้ว'
            : vFilter === 'cleared' ? 'ยังไม่มีคู่ที่กดตรวจแล้ว'
            : 'ไม่มีคู่ที่ตรงคำค้น'}
        </div>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead>
              <tr style={{ background: 'var(--bg3)' }}>
                <th style={th}>ผลตรวจระบบ</th>
                <th style={th}>ใบ</th>
                <th style={th}>พาร์ทที่ถูกนิยาม 2 ที่</th>
                <th style={{ ...th, textAlign: 'right' }}>ตรงกัน</th>
                <th style={th}>ใบนี้มี แต่ใบนั้นไม่มี</th>
                <th style={th}>ใบนั้นมี แต่ใบนี้ไม่มี (ไม่ถูกระเบิด)</th>
                <th style={th}>การตัดสิน</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(p => {
                const meta = DUP_VERDICTS[p.verdict] || DUP_VERDICTS.other;
                const tone = toneOf(p.verdict);
                const busy = busyKey === p.dupKey;
                return (
                  <tr key={p.dupKey} style={p.cleared ? { opacity: 0.62 } : undefined}>
                    <td style={td}>
                      <span style={chip(tone)} title={meta.why}>{meta.label}</span>
                      {/* 🔴 "ขาดของ" ต้องบอกจำนวนให้เห็นขนาด ไม่ใช่แค่ป้าย */}
                      {p.missingFromExplode.length > 0 && (
                        <div style={{ fontSize: 11, color: BAD, fontWeight: 800, marginTop: 3 }}>
                          หาย {p.missingFromExplode.length} รายการ
                        </div>
                      )}
                    </td>
                    <td style={td}>
                      <button type="button" onClick={() => onOpenSheet?.(p.sheetMat)} disabled={!onOpenSheet}
                        title={`เปิดใบ BOM ของ ${p.sheetMat}`}
                        style={{ ...btn, fontFamily: 'monospace', fontWeight: 800, padding: '2px 8px' }}>
                        {p.sheetMat} ↗
                      </button>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, maxWidth: 190 }}>{p.sheetName || '—'}</div>
                    </td>
                    <td style={td}>
                      <button type="button" onClick={() => onOpenSheet?.(p.mat)} disabled={!onOpenSheet}
                        title={`เปิดใบ BOM ของ ${p.mat}`}
                        style={{ ...btn, fontFamily: 'monospace', fontWeight: 800, padding: '2px 8px' }}>
                        {p.mat} ↗
                      </button>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, maxWidth: 190 }}>
                        <span style={{ color: matColor(p.mat), fontWeight: 700 }}>{matLabel(p.mat)}</span>{p.matName ? ` · ${p.matName}` : ''}
                      </div>
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>
                      {p.same}
                      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>
                        {p.kidsHere.length} / {p.kidsOwn.length}
                      </div>
                    </td>
                    <td style={{ ...td, maxWidth: 230 }}><MatList mats={p.onlyHere} color={WARN} /></td>
                    <td style={{ ...td, maxWidth: 230 }}>
                      <MatList mats={p.onlyOwn} color={p.verdict === 'op' ? OK : BAD} />
                      {p.verdict === 'op' && p.onlyOwn.length > 0 && (
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                          ใบขั้นงาน — ไม่นับว่าขาด
                        </div>
                      )}
                    </td>
                    <td style={{ ...td, minWidth: 210 }}>
                      {/* เคยตรวจไว้ — บอกว่าใคร/ว่าอะไร · BOM เปลี่ยนหลังตรวจ = เตือนให้ตรวจซ้ำ */}
                      {p.review && (
                        <div style={{ fontSize: 11, marginBottom: 4, lineHeight: 1.5 }}>
                          <span style={{ fontWeight: 800, color: p.cleared ? OK : WARN }}>
                            {decisionLabel(p.review.decision)}
                          </span>
                          {p.review.reviewed_by_name ? <span style={{ color: 'var(--muted)' }}> · {p.review.reviewed_by_name}</span> : null}
                          {p.review.note ? <div style={{ color: 'var(--text2)' }}>“{p.review.note}”</div> : null}
                          {p.staleReview && (
                            <div style={{ color: WARN, fontWeight: 800 }}>
                              ⚠️ BOM เปลี่ยนหลังตรวจ — ต้องตรวจซ้ำ
                            </div>
                          )}
                        </div>
                      )}
                      {!canReview ? (
                        <span style={{ fontSize: 11, color: 'var(--muted)' }}>ต้องมีสิทธิ์ products:edit</span>
                      ) : noteFor === p.dupKey ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                          <input value={noteText} onChange={e => setNoteText(e.target.value)}
                            placeholder="หมายเหตุ (ไม่ใส่ก็ได้)" autoFocus
                            style={{ fontSize: 11.5, padding: '4px 7px', borderRadius: 6,
                              border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--text)' }} />
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {DUP_DECISIONS.map(d => (
                              <button key={d.value} type="button" disabled={busy} title={d.hint}
                                onClick={() => saveReview(p, d.value, noteText)}
                                style={{ ...btn, fontSize: 11, cursor: busy ? 'wait' : 'pointer' }}>
                                {d.label}
                              </button>
                            ))}
                            <button type="button" onClick={() => { setNoteFor(''); setNoteText(''); }}
                              style={{ ...btn, fontSize: 11 }}>ยกเลิก</button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          <button type="button" disabled={busy}
                            onClick={() => { setNoteFor(p.dupKey); setNoteText(p.review?.note || ''); }}
                            style={{ ...btn, fontSize: 11, cursor: busy ? 'wait' : 'pointer' }}>
                            {p.cleared ? '✏️ แก้ผลตรวจ' : '✓ ตรวจแล้ว…'}
                          </button>
                          {p.review && (
                            <button type="button" disabled={busy} onClick={() => clearReview(p)}
                              title="ลบผลตรวจ — คู่นี้กลับเข้าคิว"
                              style={{ ...btn, fontSize: 11, cursor: busy ? 'wait' : 'pointer' }}>↩ ยกเลิก</button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── คำอธิบายผลตรวจแต่ละชนิด (คนใช้ครั้งแรกต้องรู้ว่าแต่ละป้ายหมายถึงอะไร) ── */}
      <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
        gap: 8, alignContent: 'start' }}>
        {Object.entries(DUP_VERDICTS)
          .sort((a, b) => a[1].rank - b[1].rank)
          .map(([k, m]) => (
            <div key={k} style={{ padding: '7px 10px', borderRadius: 8, fontSize: 11, lineHeight: 1.55,
              color: 'var(--text2)', border: '1px solid var(--border)', background: 'var(--card)' }}>
              <span style={chip(statusColor(m.tone))}>{m.label}</span>
              <span style={{ marginLeft: 6, color: 'var(--muted)' }}>({counts[k] ?? 0} คู่)</span>
              <div style={{ marginTop: 3 }}>{m.why}</div>
            </div>
          ))}
      </div>
    </>
  );
}
