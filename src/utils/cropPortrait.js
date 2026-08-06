// cropPortrait — บังคับ crop รูปเป็นแนวตั้ง (center crop) + ลดขนาด สำหรับรูป PM/อุปกรณ์
//   (คำสั่ง user 2026-07-24 — รูปถ่ายจากมือถือ ส่วนใหญ่แนวตั้ง จอตรวจก็แนวตั้ง → ล็อกสัดส่วนให้เท่ากันทุกรูป)
//   ควรเรียกหลัง imageCompression (ปรับ EXIF orientation ให้ตรงก่อน) เพื่อกันรูปหมุนผิด
//   ratio = w/h เป้าหมาย (default 3:4 = 0.75) · maxLongSide = ด้านยาว (สูง) สูงสุด px · quality JPEG
export default function cropPortrait(fileOrBlob, { ratio = 3 / 4, maxLongSide = 1200, quality = 0.82 } = {}) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(fileOrBlob)
    const img = new Image()
    img.onload = () => {
      try {
        const w = img.naturalWidth, h = img.naturalHeight
        if (!w || !h) { URL.revokeObjectURL(url); return resolve(fileOrBlob) }
        const cur = w / h
        // center crop ให้ได้สัดส่วน ratio (w/h)
        let cropW, cropH, sx, sy
        if (cur > ratio) { cropH = h; cropW = Math.round(h * ratio); sx = Math.round((w - cropW) / 2); sy = 0 }      // กว้างเกิน → ตัดข้าง
        else            { cropW = w; cropH = Math.round(w / ratio); sx = 0; sy = Math.round((h - cropH) / 2) }        // สูงเกิน → ตัดบน-ล่าง
        // ลดขนาด: ด้านยาว (สูง) ไม่เกิน maxLongSide
        const scale = Math.min(1, maxLongSide / cropH)
        const outH = Math.round(cropH * scale), outW = Math.round(cropW * scale)
        const canvas = document.createElement('canvas')
        canvas.width = outW; canvas.height = outH
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, sx, sy, cropW, cropH, 0, 0, outW, outH)
        canvas.toBlob(blob => {
          URL.revokeObjectURL(url)
          if (!blob) return resolve(fileOrBlob)
          const name = (fileOrBlob.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg'
          resolve(new File([blob], name, { type: 'image/jpeg' }))
        }, 'image/jpeg', quality)
      } catch (e) { URL.revokeObjectURL(url); reject(e) }
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(fileOrBlob) }
    img.src = url
  })
}
