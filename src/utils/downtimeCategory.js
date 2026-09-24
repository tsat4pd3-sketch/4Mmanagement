/* ═══ 🗑️ ถังขยะของพาเรโต Downtime — แตกด้วย "เครื่อง" ไม่ใช่การเดา ═══ 2026-09-23

   ที่มา (คำสั่ง user ต่อจากรอบใบซ่อม MO): *"ทำข้อ 2 ต่อเลย downtime"*
   = ถังขยะ "อื่นๆ / ไม่ระบุสาเหตุ" ของดาวน์ไทม์ที่ audit 23/09 ชี้ไว้

   ── วัดจริง 90 วัน (23/09) ──
   ถังขยะ 3 ประเภท: `อื่นๆ (ในแผน)` 168 ใบ · `เครื่องแจ้งเตือน Alarm (ไม่ระบุสาเหตุ)` 139 ใบ ·
   `อื่นๆ (นอกแผน)` 131 ใบ = 438 ใบ / 15,433 นาที
   · พาเรโต**นอกแผน**: "อื่นๆ (นอกแผน)" = อันดับ 5 (5.7%) · "Alarm ไม่ระบุสาเหตุ" = อันดับ 8 (4.6%)
     → รวมกัน 10.3% ของนาทีหยุดนอกแผน = **ถ้ายุบเป็นแท่งเดียวจะขึ้นอันดับ 2 ทันที**

   ── 🔴 ทางแก้: ใช้ค่าที่ระบบมีอยู่แล้ว ไม่ใช่เดาจากคำ ──
   **401 จาก 438 ใบ (92%) กรอก `machine_no` ไว้แล้ว** (ถัง Alarm สูงถึง 135/139 = 97%)
   ⇒ ถังขยะไม่ได้ "ไม่รู้อะไรเลย" — มันรู้ว่าเครื่องไหนหยุด แค่จอโยนทิ้งเอง
   เคสจริงที่โผล่ทันทีที่แตกตามเครื่อง: **HDF-02 = 66 ใบ / 2,619 นาที** ซ่อนอยู่ในถังขยะ
   (มากกว่าแท่งอันดับ 3 ของพาเรโตนอกแผนทั้งพาเรโต) — วันนี้ไม่มีจอไหนเห็นเลย

   ── ✅ อัพเดท 24/09 — ตัวเดาจากคำ **กลับมาใช้ได้แล้ว** หลังเพิ่ม "ชั้นภาษา" ──
   `thaiText.js` (ตัดคำไทยด้วย ICU + คีย์เสียงข้ามสคริปต์) + `termStats.js` (log-odds)
   ทำให้ความแม่นดีพอจะเปิดใช้: วัดจริงบนถังขยะ**นอกแผน** 270 ใบ / 8,101 นาที
     ตัวอักษรอย่างเดียว (แบบเดิม)  32 ใบ /   715 นาที
     + ชั้นภาษา (เทียบเสียงทับศัพท์) **64 ใบ / 1,929 นาที** ← ×2 ใบ ×2.7 นาที
   ที่เพิ่มมาเกือบทั้งหมดคือคำทับศัพท์: เบนดิ่ง→Bending 22 ใบ · เลเซอร์→เลเซอร์ 27 ใบ ·
   ไฮดรอลิค→Hydraulic · โรบอท→Robot · สแค็ป→Srcap
   🔴 **ลำดับยังเหมือนเดิม: เดาจากคำเป็น "ท่าสุดท้าย"** — แตกตามเครื่อง (ของจริง) มาก่อน
   ⇒ ใบที่เดาไม่ได้ ยังถูกแตกตามเครื่องเหมือนเดิม ไม่หายไปไหน
   ⚠️ ที่เหลือเป็นการเดาผิดที่รู้ตัว 1 เคส (20 นาที / 1%): "…2 คนไม่ทัน" → Meeting
      ("ไม่ทัน" กับ "meeting" ได้คีย์เสียง mtn เท่ากันเป๊ะ) — จอต้องบอกจำนวนใบที่เดาเสมอ

   ── ⚠️ ประวัติ: ตอนยังไม่มีชั้นภาษา ตัวเดาจากคำ **ตก** (23/09) ──
   ลองจริง 23/09 บนข้อมูล 90 วัน (ทะเบียน 86 ประเภท + เรียนจากใบที่จัดประเภทแล้ว 180 วัน):
     · เดาได้ 223/438 ใบ **แต่ประมาณครึ่งหนึ่งผิด** เช่น "น้ำมันรั่ว"→ปืนยิงรีเวท ·
       "พนักงานไม่เพียงพอ"→อบรม · "กล้อง"→ระบบ PLC · "line"→Improved line (990 นาที!)
     · ตัดให้เหลือเฉพาะคำจาก**ทะเบียน** → เหลือ 96 ใบ และคำที่มีค่าที่สุดตายหมด เพราะ
       **ทะเบียนเองมีป้ายซ้ำซ้อน**: `conveyor` อยู่ทั้ง "ชิ้นงานเต็มราง Conveyor" และ
       "ราง Conveyor มีปํญหา" · `laser` อยู่ทั้ง "เครื่อง Laser มีปัญหา" และ "รอชิ้นงาน (HDF, Laser)"
       ⇒ ตกกฎ DOMINANCE (คำกำกวม = ไม่ให้คะแนน) ซึ่งถูกต้องแล้ว
   ⇒ ตอนนั้นตัดสินตามกฎ **"ก้ำกึ่ง → null · ตกถังดีกว่าเดาผิด"** (ปิดไว้ก่อน)
   สิ่งที่ทำให้กลับมาใช้ได้คือ **แก้ที่ชั้นภาษา** ไม่ใช่ปรับ threshold ให้ผ่าน:
     · เทียบเสียงเฉพาะ**ข้ามสคริปต์** (ปัญหาทับศัพท์) · สคริปต์เดียวกันเทียบตัวอักษร (ปัญหาพิมพ์ผิด)
     · ข้ามสคริปต์ต้องคีย์**ตรงเป๊ะ** ห้ามเผื่อ · หลักฐานจากเสียงมีน้ำหนักน้อยกว่าตัวอักษร
     · คำที่เรียนจากใบเก่าต้องผ่าน log-odds z ≥ 1.96 (เลิกใช้กติกา "ชนะ 80%")
   🔴 **ยังต้องแก้ทะเบียนต่อ** (ยุบป้ายซ้ำ + เติมประเภทที่ขาด) — ตัวเดาเก่งขึ้นเองเมื่อทะเบียนสะอาด
      ดู "งานค้างฝั่งทะเบียน" ใน docs/modules/mtn-problem-analysis.md

   ⚠️ pure — ห้าม import supabase (ต้องเทสได้ด้วย `node --test` ตรงๆ)                */

import { isVague } from './unclassified.js';
import { buildCategoryIndex, classifyText } from './autoCategory.js';

/** ป้ายเมื่อใบนั้นไม่ได้กรอกเครื่องไว้ — ต้องต่างจาก "ไม่ระบุประเภท" ให้ชัด */
export const NO_MACHINE = 'ไม่ระบุเครื่อง';
/** ป้ายเมื่อใบนั้นไม่มีประเภทผูกอยู่เลย (downtime_type_id หลุด) */
export const NO_TYPE = 'ไม่ระบุประเภท';

/** ชื่อประเภทดิบของแถว downtime — รองรับทั้งแบบ join (`dr_downtime_types`) และแบบ flatten */
export function dtTypeName(d) {
  const j = d?.dr_downtime_types;
  const name = j?.name_th ?? d?.type_name ?? d?.name_th ?? '';
  return String(name).trim();
}

const machineOf = (d) => String(d?.machine_no ?? '').trim();

/**
 * พจนานุกรมสำหรับเดาประเภทจากข้อความ — สร้างจาก **ชื่อประเภทที่อยู่ในชุดข้อมูลนี้เอง**
 * ⇒ ไม่ต้องยิงคิวรีเพิ่ม (ทุกจอ join `dr_downtime_types(name_th)` มาแล้ว) และไม่เดา taxonomy
 * (สร้างครั้งเดียวต่อชุดข้อมูล — ห่อ `useMemo` ในจอที่เรียกทุก render)
 */
export function buildDtIndex(rows = []) {
  const names = new Set();
  for (const d of rows) { const n = dtTypeName(d); if (n && !isVague(n)) names.add(n); }
  return buildCategoryIndex([...names].map((n) => ({ label: n, group: n, kind: 'registry' })));
}

/**
 * ตัดสินว่าแถวนี้ควรอยู่แท่งไหน — ลำดับสำคัญ:
 *   ① ประเภทบอกอะไรได้ → ใช้ชื่อประเภทเลย
 *   ② ถังขยะ + เดาจากคำได้ → ยุบเข้าประเภทจริง (`guessed: true` — จอต้องบอกจำนวน)
 *   ③ ถังขยะ + เดาไม่ได้ → แตกตามเครื่อง (ของจริง ไม่ใช่การเดา)
 * @returns {{name:string, guessed:boolean, terms:string[], vague:boolean}}
 */
export function dtResolve(d, index = null) {
  const name = dtTypeName(d);
  const vague = !name || isVague(name);
  if (!vague) return { name, guessed: false, terms: [], vague: false };
  if (index) {
    const hit = classifyText(d?.description, index, {});
    if (hit) return { name: hit.group, guessed: true, terms: hit.terms, vague: false };
  }
  const mc = machineOf(d) || NO_MACHINE;
  return { name: `${mc} · ${name || NO_TYPE}`, guessed: false, terms: [], vague: true };
}

/**
 * ชื่อที่จอเอาไป **จัดกลุ่ม/วาดแท่ง** — ถังขยะถูกแตกตามเครื่อง
 *   "อื่นๆ (นอกแผน)"                    → "HDF-02 · อื่นๆ (นอกแผน)"
 *   "เครื่องแจ้งเตือน Alarm (ไม่ระบุสาเหตุ)" → "LS-04 · เครื่องแจ้งเตือน Alarm (ไม่ระบุสาเหตุ)"
 *   ประเภทปกติ                          → ชื่อเดิมเป๊ะ (ห้ามเปลี่ยน — จอต้องเทียบกับของเดิมได้)
 * 🔴 นี่ไม่ใช่การเดา — `machine_no` คือค่าที่พนักงานกรอกไว้เองในใบเดียวกัน
 * 🔴 **เลขเครื่องมาก่อนชื่อประเภทเสมอ** — บอร์ด TV ตัดป้ายแกน X ที่ ~8 ตัวอักษร
 *    ถ้าเอาชื่อประเภทขึ้นก่อน ทุกแท่งจะถูกตัดเหลือ "อื่นๆ (นอ…" เหมือนกันหมด = แตกแล้วก็ยังอ่านไม่ออก
 */
export function dtBucketName(d, index = null) {
  return dtResolve(d, index).name;
}

/** ถังขยะแตกไปแล้วหรือยัง — ใช้ตอนอยากตกแต่งแท่ง (สีจาง/ไอคอน) ให้ต่างจากแท่งปกติ */
export const isDtVague = (d) => { const n = dtTypeName(d); return !n || isVague(n); };

/**
 * ตัวเลขสำหรับ "บรรทัดความซื่อสัตย์" ใต้กราฟ (กฎ 4 ชั้น ชั้น 3)
 * @returns {{total, vague, vagueMin, vaguePct, guessed, withMachine, noMachine, noMachineMin}}
 *   · vague       = ใบที่ประเภทบอกอะไรไม่ได้
 *   · guessed     = ในนั้น กี่ใบที่ระบบเดาประเภทจากคำให้ (ส่ง `index` มาด้วยจึงจะนับ)
 *   · withMachine = กี่ใบที่เดาไม่ได้ แต่ยังชี้เป้าต่อได้เพราะรู้ว่าเครื่องไหน
 *   · noMachine   = ใบที่ **ชี้เป้าไม่ได้จริงๆ** — ต้องไปแก้ที่การกรอก ไม่ใช่ที่จอ
 */
export function dtTrashStats(rows = [], opt = {}) {
  const { minOf = (d) => Number(d?.duration_min) || 0, index = null } =
    typeof opt === 'function' ? { minOf: opt } : opt;      // รับแบบเดิม (minOf ตรงๆ) ได้ด้วย
  let total = 0, vague = 0, vagueMin = 0, withMachine = 0, noMachine = 0, noMachineMin = 0;
  let guessed = 0, guessedMin = 0;
  for (const d of rows) {
    total++;
    if (!isDtVague(d)) continue;
    const m = minOf(d);
    vague++; vagueMin += m;
    if (index && dtResolve(d, index).guessed) { guessed++; guessedMin += m; continue; }
    if (machineOf(d)) withMachine++;
    else { noMachine++; noMachineMin += m; }
  }
  return {
    total, vague, vagueMin, withMachine, noMachine, noMachineMin, guessed, guessedMin,
    vaguePct: total ? (vague / total) * 100 : 0,
  };
}
