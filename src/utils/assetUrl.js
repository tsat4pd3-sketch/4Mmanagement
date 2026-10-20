/* URL ของรูปที่ import จาก src/assets → ใช้ได้ทั้งในหน้า/ใบพิมพ์/Excel (2026-10-20)
   🔴 Vite ฝังไฟล์ < 4 KB เป็น `data:` URL — ต่อ `location.origin` หน้า data: = รูปพัง (โลโก้ใบ MO หายเพราะเรื่องนี้ 19/10)
   ⇒ absolute (http/data/blob) ใช้ตรง · path สัมพัทธ์ค่อยต่อ origin · มีด่าน `asset-url-data-inline` */
export const absAssetUrl = (u) => (/^(https?:|data:|blob:)/i.test(String(u || '')) ? u : location.origin + u);
