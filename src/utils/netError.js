/* 📶 ข้อความ "เน็ตหลุด" ให้คนหน้างานอ่านรู้เรื่อง (2026-10-22 · audit handheld ข้อ 4)
   supabase-js ส่ง error ของ fetch ดิบมา ("TypeError: Failed to fetch" / "Load failed" / "NetworkError…")
   ⇒ บนจอเหลือ "บันทึกไม่สำเร็จ: Failed to fetch" ซึ่งคนหน้างานไม่รู้ว่าต้องทำอะไร และไม่รู้ว่าข้อมูลหายไหม
   · ตัวนี้ "ต่อท้ายคำอธิบาย" ไม่ลบข้อความเดิม (ช่างไอทียังต้องเห็นของจริง) · ไม่ใช่ข้อผิดพลาดเน็ต = คืนเดิมเป๊ะ */
const NET_RE = /failed to fetch|load failed|networkerror|network request failed|fetch failed|err_internet_disconnected|err_network/i;
export const NET_HINT = '📶 เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ (สัญญาณ Wi-Fi หลุด?) — ข้อมูลที่กรอกยังอยู่บนจอ รอสัญญาณกลับมาแล้วกดบันทึกอีกครั้ง';

export const isNetError = (msg) => NET_RE.test(String(msg ?? ''));

export function explainNetError(msg) {
  const s = String(msg ?? '');
  return isNetError(s) && !s.includes(NET_HINT) ? `${s} — ${NET_HINT}` : s;
}
