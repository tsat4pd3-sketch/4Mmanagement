# รูป How-to ติดตั้ง ESM ลงมือถือ (PWA — เพิ่มลงหน้าจอโฮม)

- `esm-install-howto.png` — รูปสำเร็จ 2400×3528 ส่งให้ทีมงานทาง LINE/แชทได้เลย
- `poster.html` — ต้นฉบับ (แก้ข้อความ/URL แล้ว render ใหม่ได้)
- `qr.png` — QR ชี้ `https://4mmanagement.onrender.com` (สร้างด้วย `node -e` + lib `qrcode` ใน repo)

**วิธี render ใหม่หลังแก้ poster.html** (ใช้ Chromium ที่มากับ environment):
```
chromium --headless=new --no-sandbox --hide-scrollbars --force-device-scale-factor=2 \
  --window-size=1200,1764 --screenshot=esm-install-howto.png file://$PWD/poster.html
```
ฟอนต์: Sarabun (Regular แตกจาก `src/lib/pdfThaiFont.js` · Bold/SemiBold/ExtraBold จาก google/fonts raw) ต้องติดตั้งใน fontconfig ก่อน
รูปในโปสเตอร์อ้าง `tslogo.png`(= src/assets/TS logo.png) + `icon-512.png`(= public/icon-512.png) — copy มาไว้โฟลเดอร์เดียวกันตอน render

⚠️ **URL ในรูป/QR = `4mmanagement.onrender.com` เดาจากชื่อ service ใน render.yaml** (ตรวจตรงจาก environment นี้ไม่ได้ — proxy บล็อก)
ถ้าโดเมนจริงต่างจากนี้ ต้องแก้ใน poster.html + gen QR ใหม่ก่อนแจกทีม
