import { useMemo, useState } from 'react';
import { explodeBom, checkBomFlow, uomLabel, itemNoLabel, slocLabel, sheetChildDiff } from '../utils/bomTree';

/* ═══ 🌳 BOM หลายชั้น — เทียบเคียงจอ SAP "Display Multilevel BOM" (CS12) ══════════
   user ส่งภาพจอ SAP มาให้ศึกษา 2026-09-02 แล้วสั่งยกระดับ feature BOM

   คอลัมน์ที่ยกมาจาก SAP:
     Explosion level (.1 / ..2 / ...3) · Component no. · Object description
     Qty (CUn) = ต่อ 1 หน่วยของ**ตัวแม่** · Component unit (PC / KG)
   ที่เพิ่มให้ (SAP ไม่มีในจอนั้น แต่หน้างานต้องใช้):
     "ต่อ 1 FG" = qty สะสมทั้งสาย — ตัวที่เอาไปคูณยอดผลิตได้จริง

   ⚠️⚠️ จอนี้ **ไม่แก้ BOM ให้เอง** — ชี้ให้เห็นอย่างเดียว การตัดสินใจเป็นของ PE/Planning
   ข้อยกเว้นเดียว (user สั่ง 2026-09-16 "ตัวที่นับซ้ำ ที่ถูก parent ไว้แล้ว ลบให้ได้มั้ย
   ใช้ตัวเดียวได้ไม่งง เราไม่รู้จะลบยังไง"): ถ้าตัวเรียกส่ง `onDeleteDupes` มา จะมีปุ่มลบ
   **เฉพาะแถวที่ระบบชี้ว่า `isDupeRow` เท่านั้น** (แถวชั้น 1 ที่ของตัวเดียวกันอยู่ชั้นลึกแล้ว)
   → คนยังเป็นผู้กด ระบบไม่ลบเอง · ลบแล้วเหลือเส้นทางเดียว = เลิกนับซ้ำ
   ⚠️ ห้ามขยายปุ่มนี้ไปลบแถวอื่น — แถวที่ไม่ใช่ isDupeRow ลบผิด = ความต้องการวัตถุดิบหาย

   ⚠️ หน่วยต้องโชว์เสมอ (user สั่ง 2026-09-02: "จำนวนควรมีหน่วยนะ")
      coil = KG · ชิ้น = PC — เลข 0.341 กับ 5 ดูเหมือนหน่วยเดียวกันถ้าไม่บอก
   ═══════════════════════════════════════════════════════════════════════════════ */

const fmtQty = (n) => {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 4 });
};
const TONE = { crit: '#ef4444', warn: '#f59e0b' };

const th = { padding: '6px 9px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: 'left', whiteSpace: 'nowrap' };
const td = { padding: '5px 9px', fontSize: 11.5, color: 'var(--text)', borderTop: '1px solid var(--border)', verticalAlign: 'top' };

/**
 * @param {string}   rootMat  mat_no ตัวตั้งต้น
 * @param {string}   rootName
 * @param {Function} bomOf    (mat) => [{ mat_no, part_name, qty_per_unit, uom }]
 */
/* `onOpenSheet(mat)` = พาไปเปิด "ใบของพาร์ทตัวนั้น" — ไม่ส่งมา = ไม่มีปุ่ม (จอ read-only ยังใช้ได้เหมือนเดิม) */
/* `isOpSheet(sheetId)` = ใบนั้นเป็น "ขั้นงาน (OP)" ไหม — ไม่ส่งมา = ถือว่าเป็นใบพาร์ททั้งหมด
   🔴 ใบ OP กับใบพาร์ท **ตอบคนละคำถาม** ⇒ ห้ามเอามาเทียบว่า "ต่างกัน"
      ใบ OP = "ขั้นนี้กินอะไร" (เช่น ขั้นเชื่อมนัท M6 → นัท 30044771)
      ใบพาร์ท = "พาร์ทนี้ประกอบจากอะไร" (เช่น คอยล์ 50027969)
   วัดจริง 06/10: เทียบรวม OP = เตือนผิด 5 คู่จาก 19 (26%) — สัญญาณหลอกทำให้คนเลิกเชื่อคำเตือน */
export default function BomTreeView({ rootMat, rootName, bomOf, sheetFor, ownSheetOf, isOpSheet, onDeleteDupes, onOpenSheet }) {
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);

  const { rows, flatDupes, cycles, truncated, maxLevel, flowWarn, diffs } = useMemo(() => {
    /* ⚠️ ต้องส่ง sheetFor เสมอ — ไม่งั้น `parent_mat` ข้ามใบ ต้นไม้ระเบิด (บั๊กจริง 21/09:
       10101158 กางได้ 1,276 แถว ลึก 5 ชั้น ทั้งที่มี 22 พาร์ท) ดู buildBomIndex */
    const r = explodeBom(rootMat, bomOf, { sheetFor, ownSheetOf });
    /* คำเตือน pattern การไหล — ตรวจ "ทั้งชุดพี่น้อง" ของแต่ละแม่ ไม่ใช่รายคู่
       (งานปั๊มแล้วขายเลยมีลูก 5xx ตัวเดียว = ถูกต้อง ห้ามเตือน) */
    const fw = new Map();
    const parents = new Set([rootMat, ...r.rows.filter(x => x.hasChildren).map(x => x.mat_no)]);
    parents.forEach(p => {
      checkBomFlow(p, bomOf(p) || [], bomOf).forEach((w, mat) => {   // ใบของ p เอง (ไม่ส่ง sheet)
        fw.set(`${p}|${mat}`, w);   // ผูกกับ "แม่|ลูก" — mat เดียวอาจอยู่หลายแม่ สถานะต่างกันได้
      });
    });
    /* 🔎 แถวที่ "ใบนี้จัดลูกไว้เอง ทั้งที่ของชิ้นนี้มีใบของตัวเอง" — เทียบให้เห็นว่าต่างกันกี่รายการ
       (ไม่เทียบ = จอเงียบ แล้วไม่มีใครรู้ว่า 2 ใบให้ตัวเลขต่างกัน — เคสจริง 10105772 vs 20070036) */
    const diffs = new Map();
    const isOp = typeof isOpSheet === 'function' ? isOpSheet : () => false;
    r.rows.filter(x => x.sheetConflict).forEach(x => {
      if (diffs.has(x.mat_no)) return;
      // ใบที่กำลังดูเป็นขั้นงาน = ไม่เทียบ (คนละคำถาม) · ยังให้กดเข้าไปดูใบพาร์ทได้เหมือนเดิม
      diffs.set(x.mat_no, isOp(x.sheet) ? null : sheetChildDiff(x.mat_no, bomOf, x.sheet, x.ownSheet));
    });
    return { ...r, flowWarn: fw, diffs };
  }, [rootMat, bomOf, sheetFor, ownSheetOf, isOpSheet]);

  if (!rows.length) {
    return <div style={{ padding: 16, fontSize: 12, color: 'var(--muted)' }}>ยังไม่มี BOM ของ {rootMat}</div>;
  }

  const shown = showAll ? rows : rows.slice(0, 40);
  /* แถวที่ลบได้ = isDupeRow **และมี id จริง** — bomOf บางตัวเรียกไม่ได้ส่ง id มา (ลบมั่วไม่ได้) */
  const dupRows = rows.filter(r => r.isDupeRow);
  const dupCount = dupRows.length;
  const delRows = onDeleteDupes ? dupRows.filter(r => r.id) : [];

  const doDelete = async (list) => {
    if (!list.length || busy) return;
    setBusy(true);
    try { await onDeleteDupes(list); } finally { setBusy(false); }
  };
  const flowCount = [...flowWarn.values()].length;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>🌳 {rootMat}</span>
        <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{rootName || ''}</span>
        <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>
          {rows.length} รายการ · ลึก {maxLevel} ชั้น
        </span>
      </div>

      {/* 🔴 นับซ้ำ — ของก้อนเดียวถูกเขียน 2 ชั้น (ตัวที่ user เรียกว่า "BOM เละ") */}
      {dupCount > 0 && (
        <div style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 9,
          padding: '9px 12px', fontSize: 11.5, color: 'var(--text2)', marginBottom: 8, lineHeight: 1.7 }}>
          🔴 <b style={{ color: TONE.crit }}>นับซ้ำ {dupCount} รายการ</b> — ของพวกนี้อยู่ในชั้นลึกอยู่แล้ว
          แต่ถูกใส่ที่ชั้น 1 ด้วย (BOM ถูก “แบน” มาจากโครงหลายชั้นของ SAP)
          <div style={{ marginTop: 4 }}>
            {flatDupes.map(d => (
              <div key={d.mat_no} style={{ fontFamily: 'monospace', fontSize: 11 }}>
                • {d.mat_no} — อยู่ใต้ {d.via.join(', ')} (ชั้น {d.deepestLevel}) แต่ชั้น 1 ก็มี ×{fmtQty(d.qtyAtLevel1)}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 4, color: 'var(--muted)' }}>
            ระบบ<b>ไม่ลบให้เอง</b> — ลบแถวชั้น 1 ออก = เหลือเส้นทางเดียว (ต่อโซ่ ตรงของจริง) ·
            คงไว้ = ยอมรับว่ายอดชั้น 1 นับรวมของที่อยู่ข้างในแล้ว
          </div>
          {delRows.length > 0 && (
            <button onClick={() => doDelete(delRows)} disabled={busy}
              style={{ marginTop: 7, fontSize: 11.5, fontWeight: 800, padding: '6px 13px', borderRadius: 7,
                cursor: busy ? 'wait' : 'pointer', background: 'rgba(239,68,68,0.15)', color: TONE.crit,
                border: `1px solid ${TONE.crit}`, fontFamily: 'var(--font-body)' }}>
              🧹 ลบแถวชั้น 1 ที่นับซ้ำทั้งหมด ({delRows.length} รายการ)
            </button>
          )}
          {onDeleteDupes && delRows.length < dupCount && (
            <div style={{ marginTop: 5, fontSize: 11, color: TONE.warn }}>
              ⚠️ อีก {dupCount - delRows.length} แถวยังลบจากจอนี้ไม่ได้ (ไม่มี id ของบรรทัด) — ลบที่ตารางด้านล่าง
            </div>
          )}
        </div>
      )}

      {flowCount > 0 && (
        <div style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: 9,
          padding: '9px 12px', fontSize: 11.5, color: 'var(--text2)', marginBottom: 8, lineHeight: 1.7 }}>
          ⚠️ <b style={{ color: TONE.warn }}>ผิด pattern การไหล {flowCount} รายการ</b> — ดูคำอธิบายในแถว
          <div style={{ marginTop: 2, color: 'var(--muted)', fontFamily: 'monospace', fontSize: 11 }}>
            5xx coil ─ไลน์ปั๊ม→ 2xx ─สโตร์→ ไลน์ประกอบ → 1xx FG · (งานปั๊มแล้วขายเลย 5→1 ถือว่าปกติ)
          </div>
        </div>
      )}

      {cycles.length > 0 && (
        <div style={{ fontSize: 11.5, color: TONE.crit, fontWeight: 700, marginBottom: 8 }}>
          🔴 BOM วนกลับหาตัวเอง {cycles.length} เส้น — {cycles.map(c => c.join(' → ')).join(' · ')} (ต้องแก้ที่ master)
        </div>
      )}
      {truncated && (
        <div style={{ fontSize: 11.5, color: TONE.warn, marginBottom: 8 }}>⚠️ โครงลึกเกินกำหนด — ตัดการกางที่ชั้นลึกสุด</div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
          <thead><tr style={{ background: 'var(--bg2)' }}>
            <th style={th}>ชั้น</th>
            <th style={th}>Item</th>
            <th style={th}>Component</th>
            <th style={th}>รายละเอียด</th>
            <th style={{ ...th, textAlign: 'right' }}>จำนวน/ตัวแม่</th>
            <th style={th}>หน่วย</th>
            <th style={th}>คลัง</th>
            <th style={{ ...th, textAlign: 'right' }}>ต่อ 1 FG</th>
          </tr></thead>
          <tbody>
            {shown.map((r, i) => {
              const w = flowWarn.get(`${r.parent || rootMat}|${r.mat_no}`);
              const bad = r.isDupeRow || w?.level === 'crit';
              return (
                <tr key={`${r.path.join('>')}|${i}`} style={bad ? { background: 'rgba(239,68,68,0.06)' } : undefined}>
                  <td style={{ ...td, fontFamily: 'monospace', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{r.tag}</td>
                  {/* 📍 เลขรายการนับใหม่ทุกตัวแม่ (SAP) — ชั้น 2 ที่ขึ้น 0010 ใหม่ = ปกติ ไม่ใช่ซ้ำ */}
                  <td style={{ ...td, fontFamily: 'monospace', color: r.item_no ? 'var(--text2)' : 'var(--muted)', whiteSpace: 'nowrap' }}>
                    {itemNoLabel(r.item_no) || '—'}
                  </td>
                  <td style={{ ...td, fontFamily: 'monospace', fontWeight: 700, color: '#0ea5e9', whiteSpace: 'nowrap',
                    paddingLeft: 9 + (r.level - 1) * 14 }}>
                    {r.level > 1 && <span style={{ color: 'var(--muted)' }}>└ </span>}
                    {/* 📄 แถวที่ลูกมาจาก "ใบของตัวมันเอง" — กดแล้วไปเปิดใบนั้นเลย
                        (user 06/10 เข้าใจว่าต้องสร้าง 2 ใบแยกกัน ที่จริงใบนั้นคือการนิยามครั้งเดียว
                         แล้วใบ FG ยืมมากางให้ — แต่จอไม่เคยบอก) */}
                    {r.ownSheet && onOpenSheet ? (
                      <button type="button" onClick={() => onOpenSheet(r.mat_no)}
                        title={r.fromOtherSheet
                          ? `เปิดใบ BOM ของ ${r.mat_no} — ชั้นที่ลึกกว่านี้ถูกนิยามไว้ในใบนั้น ไม่ได้กรอกซ้ำในใบนี้`
                          : `เปิดใบ BOM ของ ${r.mat_no} — ของชิ้นนี้มีใบของตัวเองด้วย กดเข้าไปเทียบได้`}
                        style={{ font: 'inherit', color: 'inherit', background: 'none', border: 'none', padding: 0,
                          cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }}>
                        {r.mat_no} ↗
                      </button>
                    ) : r.mat_no}
                  </td>
                  <td style={{ ...td, maxWidth: 260 }}>
                    {r.part_name || '—'}
                    {r.fromOtherSheet && (
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}
                        title="นิยามไว้ครั้งเดียวในใบของตัวเอง — ใบนี้ยืมมากางให้ ไม่ได้กรอกซ้ำ">
                        📄 ชั้นล่างมาจากใบของ {r.mat_no} เอง
                      </div>
                    )}
                    {/* ⚠️ นิยามไว้ 2 ที่ — บอกตรงๆ ว่าต่างกันกี่รายการ ห้ามเงียบ (จอต้องซื่อสัตย์)
                        ไม่ต่างกันเลยก็ยังต้องบอกว่า "ซ้ำ 2 ใบ" — แก้ใบเดียวแล้วอีกใบค้างคือกับดักถัดไป */}
                    {r.sheetConflict && (() => {
                      const d = diffs.get(r.mat_no);
                      /* 🔴 ใบขั้นงาน (OP) ไม่เทียบ — บอกแค่ว่ามีใบของตัวเองให้กดดู ห้ามเขียนว่า "ต่างกัน"
                         (ขั้นเชื่อมนัทกินนัท · ใบพาร์ทบอกคอยล์ = ถูกทั้งคู่ ไม่ใช่ขัดกัน) */
                      if (!d) return (
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}
                          title={`${r.mat_no} มีใบ BOM ของตัวเอง — ใบขั้นงานบอก "ขั้นนี้กินอะไร" คนละคำถามกับใบพาร์ท จึงไม่เทียบให้`}>
                          📄 {r.mat_no} มีใบของตัวเองด้วย (ใบขั้นงานไม่เทียบกับใบพาร์ท)
                        </div>
                      );
                      return (
                        <div style={{ fontSize: 11, color: TONE.warn, fontWeight: 700, marginTop: 1, lineHeight: 1.45 }}
                          title={`ลูกของ ${r.mat_no} ถูกกรอกไว้ทั้งในใบนี้ และในใบ BOM ของ ${r.mat_no} เอง`}>
                          ⚠️ ใบนี้กรอกลูกไว้เอง · {r.mat_no} มีใบของตัวเองด้วย
                          {d.differs
                            ? ` — ต่างกัน ${d.differs} รายการ${d.onlyHere.length ? ` (ใบนี้เกิน: ${d.onlyHere.join(', ')})` : ''}${d.onlyOwn.length ? ` (ใบนั้นเกิน: ${d.onlyOwn.join(', ')})` : ''}`
                            : ` — ตรงกันทั้ง ${d.same} รายการ แต่ต้องแก้ 2 ที่`}
                        </div>
                      );
                    })()}
                    {r.isDupeRow && (
                      <div style={{ fontSize: 11, color: TONE.crit, fontWeight: 700, marginTop: 1,
                        display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        🔴 นับซ้ำ — ตัวนี้อยู่ชั้นลึกอยู่แล้ว
                        {onDeleteDupes && r.id && (
                          <button onClick={() => doDelete([r])} disabled={busy} title="ลบแถวชั้น 1 นี้ทิ้ง"
                            style={{ fontSize: 11, fontWeight: 800, padding: '1px 7px', borderRadius: 5,
                              cursor: busy ? 'wait' : 'pointer', background: 'rgba(239,68,68,0.15)',
                              color: TONE.crit, border: `1px solid ${TONE.crit}`, fontFamily: 'var(--font-body)' }}>
                            🗑 ลบแถวนี้
                          </button>
                        )}
                      </div>
                    )}
                    {w && (
                      <div style={{ fontSize: 11, color: TONE[w.level] || TONE.warn, marginTop: 1, lineHeight: 1.45 }}>
                        {w.level === 'crit' ? '🔴' : '⚠️'} {w.text}
                      </div>
                    )}
                    {r.cycle && <div style={{ fontSize: 11, color: TONE.crit, marginTop: 1 }}>🔴 วนกลับหาตัวเอง — หยุดกาง</div>}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtQty(r.qty)}</td>
                  {/* หน่วยต้องมีเสมอ — ไม่มีในฐาน = บอกตรงๆ ห้ามเดา */}
                  <td style={{ ...td, whiteSpace: 'nowrap', color: r.uom ? 'var(--text2)' : TONE.warn, fontWeight: 700 }}>
                    {uomLabel(r.uom) || '⚠ ไม่ระบุ'}
                  </td>
                  <td style={{ ...td, fontFamily: 'monospace', whiteSpace: 'nowrap', color: r.storage_location ? '#a855f7' : 'var(--muted)', fontWeight: r.storage_location ? 700 : 400 }}>
                    {slocLabel(r.storage_location) || '—'}
                  </td>
                  <td style={{ ...td, textAlign: 'right', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{fmtQty(r.qtyPerRoot)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {rows.length > shown.length && (
        <button onClick={() => setShowAll(true)}
          style={{ marginTop: 8, fontSize: 11.5, fontWeight: 700, padding: '5px 12px', borderRadius: 7, cursor: 'pointer',
            background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border2)', fontFamily: 'var(--font-body)' }}>
          ▾ แสดงอีก {rows.length - shown.length} รายการ
        </button>
      )}

      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, lineHeight: 1.7 }}>
        <b>จำนวน/ตัวแม่</b> = ต่อ 1 หน่วยของชิ้นที่อยู่เหนือขึ้นไป (ตรงกับคอลัมน์ Qty ของ SAP) ·
        <b> ต่อ 1 FG</b> = คูณสะสมทั้งสายแล้ว
        <br />จอนี้แก้ BOM ไม่ได้ (ยกเว้นปุ่มลบแถว<b>นับซ้ำ</b>) — เพิ่ม/แก้พาร์ทที่ตารางด้านล่าง
      </div>
    </div>
  );
}
