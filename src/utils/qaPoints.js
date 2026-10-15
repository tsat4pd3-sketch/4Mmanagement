/* กติกาจุดตรวจชิ้นงาน (QA) ที่ใช้ร่วมระหว่างหน้า /qa-setup กับโมดัลตั้งค่าจุดตรวจ (`QaPointsEditor`)
   pure — ไม่แตะ DB/UI · 📄 docs/modules/inspection-point-setup.md */

/* สีหมุด/ป้ายตาม Rank ของจุด (ตามฟอร์ม FM-QA-112) */
export const QA_RANK = {
  M:  { label: 'M',  color: '#f59e0b' },
  SC: { label: 'SC', color: '#ef4444' },
};
/* เรียง balloon แบบ natural: A1 < A2 < B < D1 < H2 < H10 < 1 < 2 */
export const balloonSort = (a, b) =>
  String(a.balloon_no || '').localeCompare(String(b.balloon_no || ''), undefined, { numeric: true, sensitivity: 'base' });

/* เดา balloon ถัดไป: ถ้าล่าสุดลงท้ายด้วยตัวเลข (H35, A1, 7) → เพิ่มเลขต่อท้าย 1 */
export function nextBalloonOf(list) {
  const nos = list.map(i => String(i.balloon_no || '').trim()).filter(Boolean);
  if (!nos.length) return '1';
  const last = [...nos].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })).at(-1);
  const m = last.match(/^(.*?)(\d+)$/);
  return m ? `${m[1]}${parseInt(m[2], 10) + 1}` : '';
}

