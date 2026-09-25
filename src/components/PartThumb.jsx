import { useState } from 'react';

/* 🖼️ PartThumb — รูปชิ้นงานขนาดเล็กบนการ์ด/แถวตาราง (2026-09-25 · คำสั่ง user)
   *"ควรจะมีรูปภาพชิ้นงานด้วยนะ"* — สโตร์หยิบของจากหน้าตาชิ้นงาน ไม่ได้หยิบจากเลข mat

   🔴 กติกา (UI-CONVENTIONS §รูปภาพ):
   · ไม่มีรูป = กล่องเทา + ไอคอน + tooltip บอกว่าไปเพิ่มที่ไหน **ห้ามหายเงียบ**
     (ไม่งั้นการ์ดมีรูปบ้างไม่มีบ้าง = คนคิดว่าจอพัง · วัดจริง 25/09 มีรูป 34% ของพาร์ทที่ขึ้นบอร์ด)
   · รูปโหลดไม่ขึ้น (ไฟล์ถูกลบ/URL เสีย) ต้องตกลงมาเป็นกล่องเดียวกัน ไม่ใช่ไอคอนรูปแตกของเบราว์เซอร์
   · `loading="lazy"` เสมอ — บอร์ดสโตร์มีการ์ดหลักร้อยใบต่อจอ
   · กดแล้วขยาย (overlay) — จอ TV/มือถือหน้างานซูมด้วยนิ้วไม่ได้ทุกเครื่อง */
export default function PartThumb({ url, alt = '', size = 46, radius = 8, zoomable = true }) {
  const [broken, setBroken] = useState(false);
  const [zoom, setZoom] = useState(false);
  const ok = !!url && !broken;

  const box = {
    width: size, height: size, flex: `0 0 ${size}px`, borderRadius: radius,
    border: '1px solid var(--border)', background: 'var(--bg3)', overflow: 'hidden',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };

  if (!ok) {
    return (
      <div style={box} title={url ? 'รูปนี้โหลดไม่ขึ้น — ไฟล์อาจถูกลบ' : 'ยังไม่มีรูป — เพิ่มได้ที่ 📦 ทะเบียนสินค้า/พาร์ท'}
        aria-label={url ? 'รูปโหลดไม่ขึ้น' : 'ยังไม่มีรูป'}>
        <span style={{ fontSize: Math.max(13, Math.round(size * 0.4)), opacity: 0.45, lineHeight: 1 }}>
          {url ? '⚠️' : '🖼️'}
        </span>
      </div>
    );
  }

  return (
    <>
      <div style={{ ...box, cursor: zoomable ? 'zoom-in' : 'default' }}
        onClick={zoomable ? (e) => { e.stopPropagation(); setZoom(true); } : undefined}>
        <img src={url} alt={alt} loading="lazy" onError={() => setBroken(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      </div>
      {zoom && (
        <div onClick={(e) => { e.stopPropagation(); setZoom(false); }}
          style={{
            position: 'fixed', inset: 0, zIndex: 900, background: 'rgba(0,0,0,0.78)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, cursor: 'zoom-out',
          }}>
          <div style={{ maxWidth: '90vw', maxHeight: '90vh', textAlign: 'center' }}>
            <img src={url} alt={alt} style={{ maxWidth: '90vw', maxHeight: '80vh', objectFit: 'contain', borderRadius: 10, boxShadow: 'var(--shadow-lg)' }} />
            {alt && <div style={{ marginTop: 10, color: '#fff', fontSize: 13, fontWeight: 700 }}>{alt}</div>}
          </div>
        </div>
      )}
    </>
  );
}
