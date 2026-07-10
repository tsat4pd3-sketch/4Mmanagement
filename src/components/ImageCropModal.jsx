import { useState, useRef, useEffect } from 'react';

/* ─── ImageCropModal ───────────────────────────────────────────────────────
   Crop/reposition + zoom รูปก่อนอัปโหลด ให้เห็นกรอบจริงที่จะถูกใช้แสดงผล
   ป้องกันรูปตกขอบ/ล้นกรอบ — ใช้ร่วมกันได้ทุกหน้าที่มีการอัปโหลดรูป
   ใช้งาน:
     const [cropFile, setCropFile] = useState(null); // raw File ที่รอ crop
     <input type="file" onChange={e => setCropFile(e.target.files?.[0] || null)} />
     {cropFile && (
       <ImageCropModal file={cropFile} aspect={1} shape="rect" outputSize={480}
         onCancel={() => setCropFile(null)}
         onConfirm={(croppedFile) => { setImageFile(croppedFile); setCropFile(null); }} />
     )}
   ─────────────────────────────────────────────────────────────────────────── */
// GIF (รูปขยับ): การวาดลง canvas ได้เฟรมแรกเฟรมเดียว = การเคลื่อนไหวหาย
// จึงส่งไฟล์ต้นฉบับผ่านไปทั้งไฟล์แทน แลกกับการจำกัดขนาด ไม่งั้น storage บวม
// (เคยเจอ GIF เฉลี่ยไฟล์ละ ~4MB ใหญ่กว่ารูปนิ่งที่บีบแล้ว ~30 เท่า)
const GIF_MAX_BYTES = 2 * 1024 * 1024;

export default function ImageCropModal({
  file, aspect = 1, shape = 'rect', outputSize = 480,
  title = 'จัดตำแหน่งรูปภาพให้ตรงกรอบ', quality = 0.85,
  onCancel, onConfirm,
}) {
  const [imgUrl, setImgUrl] = useState(null);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [scale, setScale] = useState(1);
  const [minScale, setMinScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);

  const FRAME_W = 300;
  const FRAME_H = Math.round(FRAME_W / aspect);

  const isGif = file?.type === 'image/gif';

  useEffect(() => {
    if (!file) return;
    if (isGif && file.size > GIF_MAX_BYTES) {
      alert(`รูปขยับ (GIF) ต้องมีขนาดไม่เกิน 2 MB (ไฟล์นี้ ${(file.size / 1024 / 1024).toFixed(1)} MB)\nลองใช้ GIF ที่สั้นลง/เล็กลง หรือย่อไฟล์ก่อนอัปโหลด`);
      onCancel?.();
      return;
    }
    const url = URL.createObjectURL(file);
    setImgUrl(url);
    const img = new Image();
    img.onload = () => {
      setNatural({ w: img.width, h: img.height });
      const s = Math.max(FRAME_W / img.width, FRAME_H / img.height);
      setScale(s);
      setMinScale(s);
      setPos({ x: 0, y: 0 });
    };
    img.onerror = () => {
      // เบราว์เซอร์ไม่รองรับฟอร์แมตไฟล์นี้ (เช่นรูป .heic จากกล้อง iPhone) — ถ้าไม่ดักไว้
      // กรอบครอบรูปจะว่างเปล่าแบบไม่มี error ใดๆ ผู้ใช้กดยืนยันไปได้โดยไม่มีรูปติดไปด้วย
      alert('ไม่สามารถแสดงตัวอย่างรูปนี้ได้ ไฟล์อาจเป็นฟอร์แมตที่ไม่รองรับ (เช่น .heic จากกล้อง iPhone)\nกรุณาเปลี่ยนรูปเป็น JPG หรือ PNG แล้วลองใหม่');
      onCancel?.();
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const clampPos = (x, y, s) => {
    const dispW = natural.w * s, dispH = natural.h * s;
    const maxX = Math.max(0, (dispW - FRAME_W) / 2);
    const maxY = Math.max(0, (dispH - FRAME_H) / 2);
    return { x: Math.min(maxX, Math.max(-maxX, x)), y: Math.min(maxY, Math.max(-maxY, y)) };
  };

  const onPointerDown = (e) => {
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
    dragRef.current = start;
    const move = (ev) => {
      const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
      setPos(clampPos(start.px + dx, start.py + dy, scale));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onScaleChange = (newScale) => {
    setScale(newScale);
    setPos(p => clampPos(p.x, p.y, newScale));
  };

  const handleConfirm = () => {
    if (isGif) {
      // ส่งต้นฉบับทั้งไฟล์เพื่อคงการเคลื่อนไหว (ขนาดถูกเช็คแล้วตอนเลือกไฟล์)
      onConfirm(file);
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = outputSize;
    canvas.height = Math.round(outputSize / aspect);
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.onload = () => {
      const renderScale = canvas.width / FRAME_W;
      const dispW = natural.w * scale * renderScale;
      const dispH = natural.h * scale * renderScale;
      const cx = canvas.width / 2 - pos.x * renderScale;
      const cy = canvas.height / 2 - pos.y * renderScale;
      ctx.drawImage(img, cx - dispW / 2, cy - dispH / 2, dispW, dispH);
      canvas.toBlob(blob => {
        const fileName = (file.name || 'image').replace(/\.\w+$/, '.jpg');
        onConfirm(new File([blob], fileName, { type: 'image/jpeg' }));
      }, 'image/jpeg', quality);
    };
    img.onerror = () => {
      alert('ไม่สามารถใช้รูปนี้ได้ ไฟล์อาจเป็นฟอร์แมตที่ไม่รองรับ (เช่น .heic จากกล้อง iPhone)\nกรุณาเปลี่ยนรูปเป็น JPG หรือ PNG แล้วลองใหม่');
      onCancel?.();
    };
    img.src = imgUrl;
  };

  if (!file) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 14, padding: 20, width: 'min(380px,100%)' }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', marginBottom: 12 }}>{title}</div>
        <div
          onPointerDown={onPointerDown}
          style={{
            width: FRAME_W, height: FRAME_H, margin: '0 auto', position: 'relative', overflow: 'hidden',
            borderRadius: shape === 'circle' ? '50%' : 8, border: '2px solid var(--accent)', background: '#000',
            cursor: 'grab', touchAction: 'none',
          }}>
          {imgUrl && natural.w > 0 && (
            <img src={imgUrl} draggable={false}
              style={{
                position: 'absolute', left: '50%', top: '50%',
                width: natural.w * scale, height: natural.h * scale,
                transform: `translate(-50%, -50%) translate(${pos.x}px, ${pos.y}px)`,
                userSelect: 'none', pointerEvents: 'none', maxWidth: 'none',
              }} />
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
          <span style={{ fontSize: 13 }}>🔍</span>
          <input type="range" min={minScale * 0.4} max={minScale * 4} step={0.01} value={scale}
            onChange={e => onScaleChange(Number(e.target.value))} style={{ flex: 1 }} />
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', marginTop: 6 }}>
          {isGif
            ? '🎞️ รูปขยับ (GIF) จะถูกใช้ทั้งภาพเพื่อคงการเคลื่อนไหว — การ crop/ซูมในกรอบนี้ไม่มีผลกับไฟล์จริง'
            : 'ลากรูปเพื่อขยับตำแหน่ง • เลื่อนแถบเพื่อซูม — กรอบนี้คือพื้นที่จริงที่จะแสดงผล'}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          {/* type="button" จำเป็น — modal นี้ถูก render อยู่ใน <form> ของหน้า Register/Operator
              ถ้าไม่ระบุ ปุ่มจะเป็น submit โดย default ทำให้ฟอร์มถูกบันทึกทันทีก่อนรูปถูกแนบ (รูปหายเงียบๆ) */}
          <button type="button" onClick={onCancel} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', cursor: 'pointer', fontSize: 13 }}>ยกเลิก</button>
          <button type="button" onClick={handleConfirm} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>✓ ใช้รูปนี้</button>
        </div>
      </div>
    </div>
  );
}
