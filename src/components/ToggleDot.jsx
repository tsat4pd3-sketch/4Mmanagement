// จุดสถานะเปิด/ปิด มุมล่างขวาของปุ่ม toggle — ดูออกทันทีว่าฟีเจอร์นั้นเปิดอยู่หรือปิดอยู่
//   เขียว = เปิด/แสดง/กรองอยู่ · เทา = ปิด/ซ่อน
//   ⚠️ ปุ่มแม่ต้องมี position:relative (ไม่งั้นจุดจะหลุดตำแหน่ง)
//   ใช้กับปุ่ม toggle แบบ on/off ทุกหน้า (show/hide, กรองเปิด/ปิด) ให้เครื่องหมายเหมือนกันทั้งระบบ (2026-07-21)
//   ring = สีพื้นที่ปุ่มวางอยู่ (default var(--bg)) — การ์ด/พื้นเข้มให้ส่งค่าให้ตรง ให้จุดเด้ง
export default function ToggleDot({ on, size = 7, ring = 'var(--bg)' }) {
  return (
    <span
      aria-hidden
      style={{
        position: 'absolute', bottom: -2, right: -2,
        width: size, height: size, borderRadius: size / 2,
        background: on ? '#22c55e' : '#6b7280',
        border: `1.5px solid ${ring}`, pointerEvents: 'none',
        boxSizing: 'content-box',
      }}
    />
  );
}
