/* ═══ textCluster — จับกลุ่ม "ข้อความอิสระ" ที่พนักงานพิมพ์ ให้กลายเป็นหมวดที่วิเคราะห์ได้ (2026-08-05)
   ─────────────────────────────────────────────────────────────────────────────────────────────
   ปัญหาที่แก้: Pareto Downtime มี "อื่นๆ" ครองอันดับ 1 (37% ของนาทีทั้งหมด) แต่บอกอะไรไม่ได้เลย
   ทั้งที่ระบบ**บังคับกรอกรายละเอียด**เมื่อเลือกประเภทที่มีคำว่า "อื่น" อยู่แล้ว (กฎใน CLAUDE.md)
   → เอา description มาจับกลุ่มคำที่เขียนคล้ายกัน แล้วทำ sub-Pareto ในตัว "อื่นๆ" อีกชั้น

   ⚠️ ทำไมไม่ตัดคำภาษาไทย (word segmentation):
   ภาษาไทยไม่มีช่องว่างระหว่างคำ การตัดคำที่แม่นต้องใช้ dictionary/โมเดล (lib หนัก + ผลลัพธ์
   ยังพลาดกับคำแสลงหน้างาน เช่น "จิ๊กเบี้ยว" "โรบอทชนจิ๊ก") → ใช้ **character n-gram similarity**
   แทน ซึ่งไม่ต้องรู้ขอบเขตคำเลย ทนคำสะกดต่างกันเล็กน้อย/พิมพ์ตก และไม่มี dependency

   หลักการ: normalize → 3-gram set → Jaccard + containment → greedy clustering (ตัวใหญ่เป็นแกน)
   **ไม่เดาแทนผู้ใช้:** แถวที่ไม่มีโน้ตถูกแยกออกมานับต่างหาก (คืนใน `missing`) ห้ามกลบหาย
   ═══════════════════════════════════════════════════════════════════════════════════════════ */

/** ตัดสิ่งที่ไม่ใช่ "สาเหตุ" ออก: วรรณยุกต์ซ้ำ/สัญลักษณ์/ตัวเลข (เวลา-จำนวน-รหัสรัน) */
export function normalizeNote(s) {
  return String(s || '')
    .normalize('NFC')
    .replace(/[​‌﻿]/g, '')        // zero-width ที่ติดมาจากการ copy
    .toLowerCase()
    .replace(/[()[\]{}"'`,.:;!?\-_/\\|+*=<>~@#$%^&]/g, ' ')
    .replace(/\d+/g, ' ')                         // 14.00-14.20 / 5 ชิ้น — ไม่ใช่สาระของสาเหตุ
    .replace(/\s+/g, ' ')
    .trim();
}

/** เซ็ตของ character n-gram จากสตริงที่ flat แล้ว (ตัดช่องว่างแล้ว) — internal ใช้ร่วมกับ charNgrams/prep */
function ngramsFromFlat(t, n = 3) {
  const set = new Set();
  if (t.length <= n) { if (t) set.add(t); return set; }
  for (let i = 0; i <= t.length - n; i++) set.add(t.slice(i, i + n));
  return set;
}

/** เซ็ตของ character n-gram (default 3) — ใช้แทนการตัดคำ */
export function charNgrams(s, n = 3) {
  return ngramsFromFlat(normalizeNote(s).replace(/ /g, ''), n);
}

const jaccard = (a, b) => {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  small.forEach(g => { if (big.has(g)) inter++; });
  return inter / (a.size + b.size - inter);
};

/* ข้อความหนึ่ง "อยู่ใน" อีกข้อความ (ขยายความ) = เรื่องเดียวกัน — ต้องยาวพอ ไม่งั้นคำสั้นๆ ดูดทุกอย่าง
   เทียบบน flat (ตัดช่องว่างแล้ว) เสมอ: คนพิมพ์ "โรบอทชนจิ๊ก" กับ "โรบอท ชนจิ๊ก" ต้องเป็นกลุ่มเดียวกัน */
const MIN_CONTAIN = 5;

/* ── คำเชื่อมที่คนพิมพ์ใส่/ไม่ใส่ไม่คงเส้นคงวา (2026-08-25 · user จับได้จริง) ──────────────
   "รองานจากHDF" (750 น. · 9 ครั้ง) กับ "รองาน HDF" (135 น. · 3 ครั้ง) ถูกแยกเป็นคนละกลุ่ม
   ทั้งที่เป็นเรื่องเดียวกัน — วัดแล้ว Jaccard ได้แค่ 0.364 (< เกณฑ์ 0.45) เพราะคำว่า "จาก"
   (3 ตัวอักษร) แทรกอยู่กลางคำ ไปเปลี่ยน trigram รอบจุดต่อทั้งสองฝั่งพร้อมกัน — จุดอ่อนของ
   n-gram ล้วนๆ ที่ไม่ทนต่อคำแทรก/คำหายกลางข้อความ (insertion) ต่างจากคำสะกดผิดท้ายคำ

   ⚠️ ไม่ใช่ word segmentation (ยังไม่รู้ขอบเขตคำอื่นทั้งหมด) — แค่ลบคำเชื่อมไวยากรณ์ล้วนๆ
   ที่รู้จักแน่ชัดจำนวนน้อย (บุพบท/สันธาน) ออกก่อนเทียบอีกรอบ แล้ว **เอาค่าสูงสุด** ระหว่าง
   ค่าเดิมกับค่าหลังตัดคำเชื่อม — ไม่มีทางทำให้คู่ที่เคยจับกลุ่มได้อยู่แล้วแยกออกจากกัน
   (monotonic improvement) มีแต่จะช่วยให้คู่ที่เคยตกเกณฑ์เพราะคำเชื่อมแทรก ได้จับกลุ่มถูก */
const CONNECTORS = ['จาก', 'ที่', 'ของ', 'ให้', 'กับ', 'เพื่อ'];
const stripConnectors = (flat) => {
  let out = flat;
  CONNECTORS.forEach(w => { if (out.includes(w)) out = out.split(w).join(''); });
  return out;
};

const prep = (s) => {
  const n = normalizeNote(s);
  const flat = n.replace(/ /g, '');
  const flatX = stripConnectors(flat);
  // เท่ากับ flat เดิม (ไม่มีคำเชื่อมให้ตัด) = ไม่ต้องคำนวณ n-gram ซ้ำ ประหยัดงาน
  return { flat, gram: ngramsFromFlat(flat), flatX, gramX: flatX === flat ? null : ngramsFromFlat(flatX) };
};

/** ความเหมือน 0-1 จากค่าที่ prep ไว้แล้ว — ใช้ร่วมทั้ง noteSimilarity และ clusterNotes (กันสูตรแตกสองที่) */
function simCore(a, b) {
  if (!a.flat || !b.flat) return 0;
  if (a.flat === b.flat) return 1;
  const [shorter, longer] = a.flat.length <= b.flat.length ? [a.flat, b.flat] : [b.flat, a.flat];
  if (shorter.length >= MIN_CONTAIN && longer.includes(shorter)) return 1;
  let sim = jaccard(a.gram, b.gram);

  // ลองอีกรอบแบบตัดคำเชื่อมออก — คู่ที่เหมือนกันเป๊ะ/ขยายความกันหลังตัดคำเชื่อม = เรื่องเดียวกันแน่
  const af = a.flatX ?? a.flat, bf = b.flatX ?? b.flat;
  if (af && bf && (a.gramX || b.gramX)) {
    if (af === bf) return 1;
    const [s2, l2] = af.length <= bf.length ? [af, bf] : [bf, af];
    if (s2.length >= MIN_CONTAIN && l2.includes(s2)) return 1;
    sim = Math.max(sim, jaccard(a.gramX ?? a.gram, b.gramX ?? b.gram));
  }
  return sim;
}

/** ความเหมือน 0-1 ระหว่างข้อความสองก้อน */
export function noteSimilarity(a, b) { return simCore(prep(a), prep(b)); }

export const CLUSTER_THRESHOLD = 0.45;

/**
 * จับกลุ่มแถวตามข้อความอิสระ — greedy โดยเรียง "ตัวใหญ่ก่อน" ให้กลุ่มใหญ่ได้เป็นแกน
 * @param {Array} records แถวดิบ
 * @param {(r)=>string} noteOf   ดึงข้อความ
 * @param {(r)=>number} valueOf  ดึงค่าที่จะรวม (นาที/ชิ้น)
 * @param {{threshold?:number}} opts
 * @returns {{ clusters:Array<{name,value,count,variants:number,samples:string[],recs:Array}>,
 *             missing:{value:number,count:number} }}
 */
export function clusterNotes(records, noteOf, valueOf, opts = {}) {
  const threshold = opts.threshold ?? CLUSTER_THRESHOLD;
  const missing = { value: 0, count: 0 };
  const withNote = [];
  records.forEach(r => {
    const n = normalizeNote(noteOf(r));
    if (!n) { missing.value += Number(valueOf(r)) || 0; missing.count++; return; }
    withNote.push({ r, raw: String(noteOf(r)).trim(), ...prep(noteOf(r)), v: Number(valueOf(r)) || 0 });
  });

  // เรียงค่ามากก่อน → แกนของกลุ่มคือเหตุการณ์ที่กินเวลามากสุด (ชื่อกลุ่มสื่อความหมายกว่า)
  withNote.sort((a, b) => b.v - a.v);

  const clusters = [];
  withNote.forEach(item => {
    let best = null, bestSim = 0;
    for (const c of clusters) {
      // เทียบกับ "แกน" ของกลุ่ม (ไม่เทียบทุกสมาชิก — O(n·k) พอ และกัน cluster ไหลไปเรื่อยๆ)
      const sim = simCore(item, c.seed);
      if (sim > bestSim) { bestSim = sim; best = c; }
    }
    if (best && bestSim >= threshold) {
      best.value += item.v; best.count++; best.recs.push(item.r);
      best.raws[item.raw] = (best.raws[item.raw] || 0) + 1;
    } else {
      clusters.push({
        // seed ต้องพก flatX/gramX ไปด้วย ไม่งั้นสมาชิกถัดไปเทียบกับ seed แล้วเสียสัญญาณตัดคำเชื่อมไป
        seed: { flat: item.flat, gram: item.gram, flatX: item.flatX, gramX: item.gramX }, value: item.v, count: 1,
        recs: [item.r], raws: { [item.raw]: 1 },
      });
    }
  });

  return {
    clusters: clusters.map(c => {
      const entries = Object.entries(c.raws).sort((a, b) => b[1] - a[1] || a[0].length - b[0].length);
      return {
        name: entries[0][0],                       // ข้อความที่พนักงานเขียนบ่อยสุดในกลุ่ม = ชื่อกลุ่ม
        value: c.value, count: c.count,
        variants: entries.length,                  // เขียนกี่แบบ (สะกดต่างกัน/ขยายความ)
        samples: entries.slice(1, 4).map(e => e[0]),
        recs: c.recs,
      };
    }).sort((a, b) => b.value - a.value),
    missing,
  };
}
