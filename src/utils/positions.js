// ตำแหน่งงาน (job position) — source of truth เดียวทุกหน้า
//   ใช้ทั้งพนักงาน (employees.position — Register/operator) และ user (profiles.position — AddUser)
//   คำสั่ง user 2026-07-22: master list ไทยชุดเดียวทุกหน้า + ช่อง "อื่นๆ (พิมพ์เอง)" · ค่าเก่ายังเลือก/แสดงได้ ไม่หาย
//   ⚠️ เพิ่ม/แก้ตำแหน่ง ให้แก้ที่นี่ที่เดียว — ห้าม hardcode ลิสต์ position ซ้ำในหน้าใดๆ
export const POSITION_OPTIONS = [
  'ผู้จัดการฝ่าย',
  'หัวหน้าแผนก',
  'หัวหน้าส่วน',
  'หัวหน้าไลน์',
  'วิศวกร',
  'ช่างเทคนิค',
  'QC',
  'เจ้าหน้าที่',
  'ธุรการ',
  'พนักงานฝ่ายผลิต',
];

// รวมค่าปัจจุบันที่อาจอยู่นอกลิสต์ (ค่าเก่า เช่น Operator/Leader/Technician/Engineer) ไว้หัวลิสต์
// เพื่อให้ dropdown ยังโชว์/เลือกค่าเดิมได้ ไม่ถูกล้างตอนบันทึก
export const positionOptionsWith = (current) =>
  current && !POSITION_OPTIONS.includes(current) ? [current, ...POSITION_OPTIONS] : POSITION_OPTIONS;
