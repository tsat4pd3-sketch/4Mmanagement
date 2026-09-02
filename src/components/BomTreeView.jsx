import { useMemo, useState } from 'react';
import { explodeBom, checkBomFlow, uomLabel } from '../utils/bomTree';

/* ═══ 🌳 BOM หลายชั้น — เทียบเคียงจอ SAP "Display Multilevel BOM" (CS12) ══════════
   user ส่งภาพจอ SAP มาให้ศึกษา 2026-09-02 แล้วสั่งยกระดับ feature BOM

   คอลัมน์ที่ยกมาจาก SAP:
     Explosion level (.1 / ..2 / ...3) · Component no. · Object description
     Qty (CUn) = ต่อ 1 หน่วยของ**ตัวแม่** · Component unit (PC / KG)
   ที่เพิ่มให้ (SAP ไม่มีในจอนั้น แต่หน้างานต้องใช้):
     "ต่อ 1 FG" = qty สะสมทั้งสาย — ตัวที่เอาไปคูณยอดผลิตได้จริง

   ⚠️⚠️ จอนี้ **อ่านอย่างเดียว + ชี้ให้เห็น ห้ามแก้ BOM ให้เอง**
   จะลบแถวที่นับซ้ำหรือคงไว้ เป็นการตัดสินใจของ PE/Planning (เดาผิด = ความต้องการทั้งโรงงานเพี้ยน)

   ⚠️ หน่วยต้องโชว์เสมอ (user สั่ง 2026-09-02: "จำนวนควรมีหน่วยนะ")
      coil = KG · ชิ้น = PC — เลข 0.341 กับ 5 ดูเหมือนหน่วยเดียวกันถ้าไม่บอก
   ═══════════════════════════════════════════════════════════════════════════════ */

const fmtQty = (n) => {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 4 });
};
const TONE = { crit: '#ef4444', warn: '#f59e0b' };

const th = { padding: '6px 9px', fontSize: 10.5, fontWeight: 800, color: 'var(--muted)', textAlign: 'left', whiteSpace: 'nowrap' };
const td = { padding: '5px 9px', fontSize: 11.5, color: 'var(--text)', borderTop: '1px solid var(--border)', verticalAlign: 'top' };

/**
 * @param {string}   rootMat  mat_no ตัวตั้งต้น
 * @param {string}   rootName
 * @param {Function} bomOf    (mat) => [{ mat_no, part_name, qty_per_unit, uom }]
 */
export default function BomTreeView({ rootMat, rootName, bomOf }) {
  const [showAll, setShowAll] = useState(false);

  const { rows, flatDupes, cycles, truncated, maxLevel, flowWarn } = useMemo(() => {
    const r = explodeBom(rootMat, bomOf);
    /* คำเตือน pattern การไหล — ตรวจ "ทั้งชุดพี่น้อง" ของแต่ละแม่ ไม่ใช่รายคู่
       (งานปั๊มแล้วขายเลยมีลูก 5xx ตัวเดียว = ถูกต้อง ห้ามเตือน) */
    const fw = new Map();
    const parents = new Set([rootMat, ...r.rows.filter(x => x.hasChildren).map(x => x.mat_no)]);
    parents.forEach(p => {
      checkBomFlow(p, bomOf(p) || [], bomOf).forEach((w, mat) => {
        fw.set(`${p}|${mat}`, w);   // ผูกกับ "แม่|ลูก" — mat เดียวอาจอยู่หลายแม่ สถานะต่างกันได้
      });
    });
    return { ...r, flowWarn: fw };
  }, [rootMat, bomOf]);

  if (!rows.length) {
    return <div style={{ padding: 16, fontSize: 12, color: 'var(--muted)' }}>ยังไม่มี BOM ของ {rootMat}</div>;
  }

  const shown = showAll ? rows : rows.slice(0, 40);
  const dupCount = rows.filter(r => r.isDupeRow).length;
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
            ระบบ<b>ไม่แก้ให้เอง</b> — จะลบแถวชั้น 1 ออก (ต่อโซ่) หรือลบ BOM ของขั้นกลาง (คงแบน) ต้องให้ PE/Planning เคาะ
          </div>
        </div>
      )}

      {flowCount > 0 && (
        <div style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: 9,
          padding: '9px 12px', fontSize: 11.5, color: 'var(--text2)', marginBottom: 8, lineHeight: 1.7 }}>
          ⚠️ <b style={{ color: TONE.warn }}>ผิด pattern การไหล {flowCount} รายการ</b> — ดูคำอธิบายในแถว
          <div style={{ marginTop: 2, color: 'var(--muted)', fontFamily: 'monospace', fontSize: 10.5 }}>
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
            <th style={th}>Component</th>
            <th style={th}>รายละเอียด</th>
            <th style={{ ...th, textAlign: 'right' }}>จำนวน/ตัวแม่</th>
            <th style={th}>หน่วย</th>
            <th style={{ ...th, textAlign: 'right' }}>ต่อ 1 FG</th>
          </tr></thead>
          <tbody>
            {shown.map((r, i) => {
              const w = flowWarn.get(`${r.parent || rootMat}|${r.mat_no}`);
              const bad = r.isDupeRow || w?.level === 'crit';
              return (
                <tr key={`${r.path.join('>')}|${i}`} style={bad ? { background: 'rgba(239,68,68,0.06)' } : undefined}>
                  <td style={{ ...td, fontFamily: 'monospace', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{r.tag}</td>
                  <td style={{ ...td, fontFamily: 'monospace', fontWeight: 700, color: '#0ea5e9', whiteSpace: 'nowrap',
                    paddingLeft: 9 + (r.level - 1) * 14 }}>
                    {r.level > 1 && <span style={{ color: 'var(--muted)' }}>└ </span>}{r.mat_no}
                  </td>
                  <td style={{ ...td, maxWidth: 260 }}>
                    {r.part_name || '—'}
                    {r.isDupeRow && (
                      <div style={{ fontSize: 10, color: TONE.crit, fontWeight: 700, marginTop: 1 }}>
                        🔴 นับซ้ำ — ตัวนี้อยู่ชั้นลึกอยู่แล้ว
                      </div>
                    )}
                    {w && (
                      <div style={{ fontSize: 10, color: TONE[w.level] || TONE.warn, marginTop: 1, lineHeight: 1.45 }}>
                        {w.level === 'crit' ? '🔴' : '⚠️'} {w.text}
                      </div>
                    )}
                    {r.cycle && <div style={{ fontSize: 10, color: TONE.crit, marginTop: 1 }}>🔴 วนกลับหาตัวเอง — หยุดกาง</div>}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtQty(r.qty)}</td>
                  {/* หน่วยต้องมีเสมอ — ไม่มีในฐาน = บอกตรงๆ ห้ามเดา */}
                  <td style={{ ...td, whiteSpace: 'nowrap', color: r.uom ? 'var(--text2)' : TONE.warn, fontWeight: 700 }}>
                    {uomLabel(r.uom) || '⚠ ไม่ระบุ'}
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

      <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 8, lineHeight: 1.7 }}>
        <b>จำนวน/ตัวแม่</b> = ต่อ 1 หน่วยของชิ้นที่อยู่เหนือขึ้นไป (ตรงกับคอลัมน์ Qty ของ SAP) ·
        <b> ต่อ 1 FG</b> = คูณสะสมทั้งสายแล้ว
        <br />จอนี้อ่านอย่างเดียว — แก้ BOM ที่ตารางด้านล่าง
      </div>
    </div>
  );
}
