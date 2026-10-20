import { useMemo, useState } from 'react';
import Segmented from './Segmented';
import { matColor, matLabel } from '../utils/matPrefix';
import { GROUP_VERDICTS } from '../utils/bomDupAudit';
import { statusColor } from '../utils/statusTone';

/* ═══ 📋 "พาร์ทนี้ถูกนิยามลูกไว้ในใบไหนบ้าง" — ตารางกลุ่ม (ใต้ตารางคู่ใน /products?tab=bomdup) ═══
   ทำไมต้องมีทั้ง 2 ตาราง — ตารางคู่เทียบได้แค่ **2 ใบ** (ใบที่ใช้มัน ↔ ใบของพาร์ทเอง) ⇒ ตกไป 2 คลาส:
     ① พาร์ทที่ **ไม่มีใบ BOM ของตัวเองเลย** แต่ถูกนิยามไว้หลายใบ — ตารางคู่ข้ามทั้งหมด
     ② **ใบที่ 3 ขึ้นไป** — 2 ใบที่เทียบกันตรงกันเป๊ะ แต่ใบที่ 3 เขียนคนละค่า
        (ยุบจากการเทียบ 2 ใบ แล้วเส้นทางไปอ่านใบที่ 3 = ตัวเลขเปลี่ยนเงียบ · เคสนัท 20059851 ×4→×1)

   🔴 อ่านอย่างเดียว ไม่มีปุ่มตรวจแล้ว — การตัดสินยังอยู่ที่ตารางคู่ (คีย์ = ใบ + พาร์ท)
   🔴 **ไม่ยุบ ไม่ลบ ไม่เลือกใบให้เอง** เหมือนทุกที่ในโมดูลนี้ — PE/Planning ตัดสิน
   🔴 การตัดสินทั้งหมด (verdict/diffs) มาจาก `auditBomSheetGroups()` ใน `utils/bomDupAudit.js`
      **ห้ามคิดเองในไฟล์นี้** · สีจาก `STATUS_COLOR` เท่านั้น (ด่าน `status-palette-single-source`)
   ═══════════════════════════════════════════════════════════════════════════════════ */

const BAD = statusColor('bad'), WARN = statusColor('warn'), OK = statusColor('good');

const th = { padding: '7px 9px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: 'left', whiteSpace: 'nowrap' };
const td = { padding: '7px 9px', fontSize: 11.5, color: 'var(--text)', borderTop: '1px solid var(--border)', verticalAlign: 'top' };
const chip = (c) => ({
  fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap',
  color: c, border: `1px solid ${c}55`, background: 'var(--card)', backgroundImage: `linear-gradient(${c}14, ${c}14)`,
});
const btn = {
  fontSize: 11.5, fontWeight: 800, padding: '2px 8px', borderRadius: 7, cursor: 'pointer',
  background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border2)',
  fontFamily: 'monospace',
};

/* qty เป็นได้ทั้งจำนวนเต็ม (นัท) และทศนิยม (คอยล์ KG) — ห้ามปัดจนเลขจริงหาย
   🔴 `null` = "ใบนั้นไม่มีของตัวนี้" **ไม่ใช่ 0** ⇒ เขียนขีด ห้ามแสดงเป็นเลข */
const fmtQty = (n) => {
  if (n == null) return '–';
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : v.toLocaleString(undefined, { maximumFractionDigits: 4 });
};

export default function BomSheetGroups({ groups = [], counts = {}, search = '', onOpenSheet }) {
  const [gFilter, setGFilter] = useState('open');     // open = ต้องดู · all = ทั้งหมด

  const shown = useMemo(() => {
    const q = (search || '').trim().toUpperCase();
    return groups.filter(g => {
      if (gFilter === 'open' && g.verdict === 'agree') return false;
      if (!q) return true;
      return g.mat.includes(q) || (g.matName || '').toUpperCase().includes(q)
        || g.sheets.some(s => (s.sheetMat || '').toUpperCase().includes(q))
        || g.diffs.some(d => d.mat.includes(q));
    });
  }, [groups, gFilter, search]);

  return (
    <div style={{ marginTop: 20 }}>
      {/* ── ที่มา: ทำไมต้องมีตารางนี้เพิ่มจากตารางคู่ ── */}
      <div style={{ marginBottom: 10, padding: '10px 14px', borderRadius: 10, fontSize: 12, lineHeight: 1.65,
        color: 'var(--text2)', border: '1px solid var(--border)', background: 'var(--bg2)' }}>
        <div style={{ fontWeight: 800, color: 'var(--text)', marginBottom: 2 }}>
          📋 พาร์ทที่ถูกนิยามลูกไว้หลายใบ — เทียบ “ทุกใบ” พร้อมกัน
        </div>
        ตารางคู่ด้านบนเทียบได้แค่ <b>2 ใบ</b> ⇒ ตกไป 2 แบบ ซึ่งมาโผล่ที่นี่:
        <b style={{ color: BAD }}> พาร์ทที่ไม่มีใบ BOM ของตัวเองเลย</b> (ตารางคู่ข้ามทั้งหมด) และ
        <b style={{ color: BAD }}> ใบที่ 3 ขึ้นไป</b> (2 ใบตรงกันเป๊ะ แต่ใบที่ 3 คนละค่า —
        ยุบแล้วเส้นทางไปอ่านใบนั้น ตัวเลขเปลี่ยนเงียบ) ·
        <b> ตารางนี้อ่านอย่างเดียว</b> กดตรวจแล้วที่ตารางคู่ด้านบน
      </div>

      {/* ── ตัวนับ: ต้องตอบได้ว่าของ 2 คลาสนั้นมีกี่ตัว ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10,
        alignContent: 'start', marginBottom: 10 }}>
        {[
          { k: 'ต้องดู', v: counts.open ?? 0, c: counts.open ? WARN : OK, sub: `จาก ${counts.total ?? 0} พาร์ทที่นิยามหลายใบ` },
          { k: '🔴 ไม่มีใบของตัวเอง', v: counts.noOwn ?? 0, c: counts.noOwn ? BAD : OK, sub: 'ตารางคู่มองไม่เห็นเลย' },
          { k: '⚠️ นิยามไว้ ≥3 ใบ', v: counts.threePlus ?? 0, c: counts.threePlus ? BAD : OK, sub: 'เทียบ 2 ใบแล้วตัดสินไม่ได้' },
          { k: 'ทุกใบตรงกัน', v: counts.agree ?? 0, c: OK, sub: 'ยังเสี่ยงแก้ใบเดียวแล้วใบอื่นค้าง' },
        ].map(s => (
          <div key={s.k} style={{ padding: '9px 12px', borderRadius: 10, background: 'var(--card)',
            border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{s.k}</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: s.c, lineHeight: 1.2 }}>{s.v}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{s.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <Segmented label="แสดง" value={gFilter} onChange={setGFilter} options={[
          { value: 'open', label: `ต้องดู (${counts.open ?? 0})` },
          { value: 'all', label: `ทั้งหมด (${counts.total ?? 0})` },
        ]} />
        <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{shown.length} พาร์ท</span>
      </div>

      {/* 🔴 ว่างต้องเขียนว่าว่างเพราะอะไร ห้ามซ่อนแผงเงียบๆ */}
      {!shown.length ? (
        <div style={{ padding: 18, textAlign: 'center', fontSize: 12.5, color: 'var(--muted)',
          border: '1px dashed var(--border2)', borderRadius: 10 }}>
          {!counts.total ? '✅ ไม่มีพาร์ทไหนถูกนิยามลูกไว้เกิน 1 ใบ'
            : gFilter === 'open' ? '✅ ทุกพาร์ทที่นิยามหลายใบ เขียนตรงกันหมด (กด "ทั้งหมด" เพื่อดูรายการ)'
            : 'ไม่มีพาร์ทที่ตรงคำค้น'}
        </div>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
            <thead>
              <tr style={{ background: 'var(--bg3)' }}>
                <th style={th}>ผลตรวจระบบ</th>
                <th style={th}>พาร์ท</th>
                <th style={th}>ถูกนิยามไว้ในใบ</th>
                <th style={th}>ของที่แต่ละใบเขียนไม่ตรงกัน</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(g => {
                const meta = GROUP_VERDICTS[g.verdict] || GROUP_VERDICTS.conflict;
                const tone = statusColor(meta.tone);
                return (
                  <tr key={g.mat} style={g.verdict === 'agree' ? { opacity: 0.68 } : undefined}>
                    <td style={td}>
                      <span style={chip(tone)} title={meta.why}>{meta.label}</span>
                      {/* 🔴 2 ป้ายนี้คือเหตุผลที่แถวนี้มาอยู่ที่นี่ที่เดียว — ห้ามตัดออก */}
                      {!g.hasOwn && (
                        <div style={{ fontSize: 11, color: BAD, fontWeight: 800, marginTop: 3 }}>
                          ไม่มีใบ BOM ของตัวเอง
                        </div>
                      )}
                      {g.nSheets >= 3 && (
                        <div style={{ fontSize: 11, color: WARN, fontWeight: 800, marginTop: 2 }}>
                          นิยามไว้ {g.nSheets} ใบ
                        </div>
                      )}
                    </td>
                    <td style={td}>
                      <button type="button" onClick={() => onOpenSheet?.(g.mat)} disabled={!onOpenSheet}
                        title={`เปิดดู ${g.mat}`} style={btn}>{g.mat} ↗</button>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, maxWidth: 190 }}>
                        <span style={{ color: matColor(g.mat), fontWeight: 700 }}>{matLabel(g.mat)}</span>
                        {g.matName ? ` · ${g.matName}` : ''}
                      </div>
                    </td>
                    <td style={{ ...td, maxWidth: 260 }}>
                      <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4 }}>
                        {g.sheets.map(s => (
                          <button key={s.sheetId} type="button" disabled={!onOpenSheet}
                            onClick={() => onOpenSheet?.(s.sheetMat)}
                            title={`${s.sheetName || s.sheetMat} · ${s.count} รายการ${s.isOwn ? ' (ใบของพาร์ทเอง)' : ''}`}
                            style={{ ...btn, fontSize: 11 }}>
                            {s.isOwn ? '★ ' : ''}{s.sheetMat || s.sheetId}
                          </button>
                        ))}
                      </span>
                      {/* ใบขั้นงานไม่ถูกเอามาเทียบ — แต่ต้องบอกว่ามี ห้ามซ่อน */}
                      {g.opSheets?.length > 0 && (
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5 }}>
                          + ใบขั้นงาน {g.opSheets.map(s => s.sheetMat || s.sheetId).join(', ')} (ไม่เอามาเทียบ — คนละคำถาม)
                        </div>
                      )}
                    </td>
                    <td style={{ ...td, maxWidth: 420 }}>
                      {!g.diffs.length ? <span style={{ color: 'var(--muted)' }}>— ตรงกันทุกใบ</span> : g.diffs.map(d => (
                        <div key={d.mat} style={{ marginBottom: 3, lineHeight: 1.6 }}>
                          <span style={{ fontFamily: 'monospace', fontWeight: 800,
                            color: d.missing ? BAD : (d.x2 ? WARN : BAD) }}>{d.mat}</span>
                          {d.x2 && <span style={{ ...chip(WARN), marginLeft: 5 }}>×2 ชิ้น/shot</span>}
                          {d.missing > 0 && <span style={{ ...chip(BAD), marginLeft: 5 }}>ขาดจาก {d.missing} ใบ</span>}
                          {/* 🔴 เขียนค่าของ "ทุกใบ" เสมอ ห้ามบอกแค่ว่าไม่ตรง — คนตัดสินต้องเห็นเลขจริง */}
                          <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text2)' }}>
                            {d.vals.map(v => `${v.sheetMat || v.sheetId}=${fmtQty(v.qty)}`).join('  ·  ')}
                          </div>
                        </div>
                      ))}
                      {g.verdict === 'pair_shot' && (
                        <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
                          งานคู่ปั๊มทีเดียวได้ 2 ชิ้น — ใบหนึ่งน่าจะกรอกต่อ shot อีกใบต่อชิ้น
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

      {/* ── คำอธิบายผลตรวจของตารางกลุ่ม (คนละชุดกับตารางคู่ — คนละคำถาม) ── */}
      <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
        gap: 8, alignContent: 'start' }}>
        {Object.entries(GROUP_VERDICTS)
          .sort((a, b) => a[1].rank - b[1].rank)
          .map(([k, m]) => (
            <div key={k} style={{ padding: '7px 10px', borderRadius: 8, fontSize: 11, lineHeight: 1.55,
              color: 'var(--text2)', border: '1px solid var(--border)', background: 'var(--card)' }}>
              <span style={chip(statusColor(m.tone))}>{m.label}</span>
              <span style={{ marginLeft: 6, color: 'var(--muted)' }}>({counts[k] ?? 0} พาร์ท)</span>
              <div style={{ marginTop: 3 }}>{m.why}</div>
            </div>
          ))}
      </div>
    </div>
  );
}
