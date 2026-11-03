/* 🏭 LineRegistryAlert — ตาข่ายกลาง "ทะเบียนไลน์โหลดไม่สำเร็จ" (2026-10-30)
 *
 * เคสจริงที่ทำให้ต้องมี (หน้างานแจ้ง 29/10):
 *   *"มันกรองไลน์ไม่ได้ครับ"* (จอ MO) · *"แจ้งซ่อม MO JIG เลือกไลน์ผลิตไม่ได้ค่ะ ไม่มีข้อมูล"*
 *   ตรวจแล้ว **ไม่ใช่เรื่องสิทธิ์** — RLS ของ production_lines เปิดให้ทุกคนที่ login อ่าน (`select = true`)
 *   แต่ `loadLinesRes()` คืน `{ data, error }` แล้ว **82 จาก 89 จุดเรียกทิ้ง `error` ทิ้ง**
 *   ⇒ โหลดล้มเมื่อไหร่ ทุก dropdown ไลน์ว่างพร้อมกันทั้งแอป **โดยไม่มีจอไหนบอกเหตุ**
 *   ⇒ หน้างานอ่านว่า "ไม่มีข้อมูล" แล้วแจ้งว่าใช้งานไม่ได้ · ไล่แก้ทีละจอ = ไม่มีวันครบ
 *
 * 🔴 จึงแก้ที่เดียว: แถบนี้อยู่ใน <main> ของ App.jsx **ทุกหน้าเห็นเหมือนกัน**
 *    ไม่ได้มาแทนการที่จอควรบอกเองข้างช่อง (`registryFailText`) — เป็น "พื้นล่างสุด" ที่กันไม่ให้เงียบ
 * 🔴 ห้ามบล็อกการใช้งาน — แจ้ง + ให้ปุ่มโหลดใหม่ · ของเดิมที่ค้างอยู่ยังใช้ได้ (stale)
 * ⏳ ระหว่างโหลดห้ามขึ้น (loading) ไม่งั้นแถบกะพริบทุกครั้งที่เปลี่ยนหน้า
 */
import { useState } from 'react';
import { useProductionLinesState } from '../utils/useProductionLines';
import { registryFailText } from '../utils/useMasterRows';

export default function LineRegistryAlert() {
  const { failed, stale, message, loading, reload } = useProductionLinesState();
  const [busy, setBusy] = useState(false);
  if (loading || !failed) return null;

  const onReload = () => { setBusy(true); reload(); setTimeout(() => setBusy(false), 1200); };
  return (
    <div role="status" style={{
      margin: '0 16px 10px', padding: '8px 11px', borderRadius: 8, fontSize: 12.5, fontWeight: 700,
      color: stale ? '#f59e0b' : '#ef4444', background: 'var(--card)',
      border: `1px solid ${stale ? 'rgba(245,158,11,0.5)' : 'rgba(239,68,68,0.5)'}`,
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
    }}>
      <span style={{ flex: 1, minWidth: 220 }}>
        {registryFailText('ทะเบียนไลน์', stale)}
        <div style={{ fontWeight: 400, color: 'var(--text2)', marginTop: 2 }}>
          ช่องเลือกไลน์ทุกหน้าจะว่างหรือไม่ครบ — <b>ไม่ใช่เรื่องสิทธิ์ และไม่ได้แปลว่าไลน์ถูกลบ</b>
          {message ? <> · เหตุผลจากระบบ: {message}</> : null}
        </div>
      </span>
      <button onClick={onReload} disabled={busy} style={{
        padding: '5px 11px', borderRadius: 7, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
        border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)',
        cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
      }}>{busy ? 'กำลังโหลด…' : '🔄 โหลดทะเบียนไลน์ใหม่'}</button>
    </div>
  );
}
