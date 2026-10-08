/* ═══ 🏷️ เลขเครื่อง — สะกดต่างกันแต่เป็นเครื่องเดียวกัน ═══════════ 2026-09-24

   ที่มา: audit ถังขยะ downtime (23-24/09) เจอว่า `machine_no` เป็น **ข้อความอิสระ**
   ⇒ เครื่องเดียวกันถูกพิมพ์หลายแบบ แล้ว**แตกเป็นคนละแท่ง**ในทุกจอวิเคราะห์

   ── วัดจริง 180 วัน (`downtime_logs` 8,345 แถวที่กรอกเลขเครื่อง) ──
     ตรงทะเบียนเป๊ะ           6,575 แถว
     ต่างแค่ "รูปแบบ"           498 แถว / 84 ค่า  ← ไฟล์นี้แก้
     ต้องให้คนตัดสิน          1,272 แถว          ← ห้ามเดา (ดูท้ายไฟล์)
   ตัวอย่างที่ต่างแค่รูปแบบ: `LS10`→`LS-10` · `RB 102`→`RB-102` · `SP78`→`SP-78` ·
   `Lwr306`→`LWR-306` (ตัวพิมพ์) · `RB-0102`→`RB-102` (เลข 0 นำ)

   ── 🔴 ขอบเขตของไฟล์นี้: "รูปแบบ" เท่านั้น ห้ามเดาตัวตนเครื่อง ──
   ทำ: ตัวพิมพ์ · ช่องว่าง · ขีด/จุด/ขีดล่าง · เลขศูนย์นำหน้าท้ายคำ
   **ไม่ทำ:** `เลเซอร์04` → `LS-04` · `Laser4` → `LS-04` · `laser` → เครื่องไหน
     ⇒ ต้องรู้ว่าโรงงานตั้งชื่อย่อ LS = Laser และเลข 4 หมายถึงตัวเดียวกัน
        **นั่นคือการเดาตัวตนอุปกรณ์** (กฎ CLAUDE.md ห้าม AI เดาทะเบียนของโรงงาน)
        และเสี่ยงจริง: ทะเบียนมี `LS-11` ชื่อ "Laser" อยู่ไลน์ HYDROFORM ด้วย
   ⇒ ค่าพวกนี้ต้องให้คนของโรงงานแมป (หรือเพิ่มเครื่องที่ยังไม่มีในทะเบียน)

   ⚠️ pure — ห้าม import supabase                                                  */

/** คีย์เทียบ "เครื่องเดียวกันไหม" — ตัดทุกอย่างที่เป็นแค่รูปแบบการพิมพ์ทิ้ง
 *  `LS-10` · `ls10` · `LS 010` → `LS10`
 *  🔴 ตัดเลขศูนย์นำหน้า**เฉพาะกลุ่มตัวเลขท้ายคำ** — ห้ามตัดทั้งสตริง
 *     ไม่งั้น `RB-01` กับ `RB-1` (ถ้าโรงงานมีทั้งคู่) จะกลายเป็นตัวเดียวกัน
 *     กรณีนั้นจึงถูกตรวจด้วย "ต้องแมปได้เครื่องเดียว" อีกชั้นใน `snapMachineNo` */
export function machineKey(s) {
  const up = String(s ?? '').normalize('NFC').toUpperCase().replace(/[^A-Z0-9฀-๿]/g, '');
  return up.replace(/^([A-Z฀-๿]+)0*([0-9]+)$/, '$1$2');
}

/**
 * สร้างตัวแมป "คีย์ → เลขเครื่องในทะเบียน" จากทะเบียนเครื่องจักร
 * 🔴 คีย์ที่ชี้ไปได้ **มากกว่า 1 เครื่อง** ถูกทิ้ง — กำกวม = ไม่แตะดีกว่าแก้ผิด
 * @param {Array<{machine_no:string}|string>} machines
 */
export function buildMachineKeyMap(machines = []) {
  const byKey = new Map();
  for (const m of (Array.isArray(machines) ? machines : [])) {
    const no = String((typeof m === 'string' ? m : m?.machine_no) ?? '').trim();
    if (!no) continue;
    const k = machineKey(no);
    if (!k) continue;
    if (!byKey.has(k)) byKey.set(k, new Set());
    byKey.get(k).add(no);
  }
  const out = new Map();
  for (const [k, set] of byKey) if (set.size === 1) out.set(k, [...set][0]);
  return out;
}

/**
 * ข้อความที่พิมพ์มา → เลขเครื่องตามทะเบียน (ถ้าเป็นแค่เรื่องรูปแบบ)
 * @returns {string|null} null = ไม่ใช่เครื่องในทะเบียน (ปล่อยค่าเดิมไว้ ห้ามดัด)
 */
export function snapMachineNo(text, keyMap) {
  const t = String(text ?? '').trim();
  if (!t || !(keyMap instanceof Map)) return null;
  const hit = keyMap.get(machineKey(t));
  return hit && hit !== t ? hit : null;
}
