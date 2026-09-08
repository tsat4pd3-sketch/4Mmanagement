/*
  pptxFit — วัดความกว้าง/ความสูงข้อความสำหรับตัวสร้าง .pptx (ฟอนต์ Tahoma)
  =======================================================================
  ทำไมต้องมีไฟล์นี้ (บทเรียน 2026-09-08 — เด็ค AUGUST 2026 ที่ user ส่งกลับมา):
    pptxgenjs `fit: 'shrink'` ปล่อยแค่ `<a:normAutofit/>` **ที่ไม่มี fontScale**
    (ยืนยันจากซอร์ส `node_modules/pptxgenjs/dist/pptxgen.cjs.js:6068`)
    → PowerPoint จะ "ย่อ" ให้ก็ต่อเมื่อมีคน**คลิกแก้ข้อความ**นั้นเสียก่อน
    เปิดไฟล์มาเฉยๆ = ตัวหนังสือ**ล้นตกบรรทัดใหม่ทับของข้างล่าง** ทุกครั้ง
    ⇒ ห้ามพึ่ง fit:'shrink' เป็นด่านกันล้น — ต้อง**คำนวณ fontSize/ความสูงเอง**ก่อนวาด

  และตาราง: `rowH` ใน PowerPoint คือ **ความสูงขั้นต่ำ** ไม่ใช่ความสูงจริง
    เนื้อหายาว = แถวโตเอง = ตารางยาวเกินที่คำนวณไว้ = ทับ footer/รูป/บรรทัดสรุป
    ⇒ ต้องประมาณความสูงจริงก่อน แล้ววาง element ถัดไปจาก "ก้นตารางจริง"

  ไฟล์นี้เป็น pure function ล้วน (ไม่มี import) — มีเทสที่ `src/lib/__tests__/pptxFit.test.mjs`
  ตัวเลขความกว้างเป็นหน่วย em ของ Tahoma (upm 2048) ปัดให้ "กว้างกว่าจริงนิดหน่อย"
  เพราะประมาณเกิน = ย่อเกินไปนิด (ยังอ่านออก) · ประมาณขาด = ล้น (พังจริง)
*/

/* ── ตารางความกว้างตัวอักษร (em) ── */
const ASCII_W = {
  ' ': 0.313, '!': 0.322, '"': 0.454, '#': 0.818, '$': 0.546, '%': 0.929, '&': 0.727, "'": 0.244,
  '(': 0.363, ')': 0.363, '*': 0.546, '+': 0.818, ',': 0.318, '-': 0.363, '.': 0.318, '/': 0.454,
  ':': 0.363, ';': 0.363, '<': 0.818, '=': 0.818, '>': 0.818, '?': 0.454, '@': 0.980,
  'A': 0.639, 'B': 0.628, 'C': 0.632, 'D': 0.702, 'E': 0.575, 'F': 0.532, 'G': 0.732, 'H': 0.717,
  'I': 0.331, 'J': 0.516, 'K': 0.647, 'L': 0.541, 'M': 0.837, 'N': 0.712, 'O': 0.766, 'P': 0.599,
  'Q': 0.766, 'R': 0.649, 'S': 0.616, 'T': 0.581, 'U': 0.699, 'V': 0.639, 'W': 0.980, 'X': 0.622,
  'Y': 0.577, 'Z': 0.596,
  '[': 0.363, '\\': 0.454, ']': 0.363, '^': 0.818, '_': 0.546, '`': 0.546,
  'a': 0.525, 'b': 0.560, 'c': 0.470, 'd': 0.560, 'e': 0.535, 'f': 0.334, 'g': 0.560, 'h': 0.556,
  'i': 0.244, 'j': 0.290, 'k': 0.523, 'l': 0.244, 'm': 0.848, 'n': 0.556, 'o': 0.545, 'p': 0.560,
  'q': 0.560, 'r': 0.383, 's': 0.454, 't': 0.361, 'u': 0.556, 'v': 0.502, 'w': 0.751, 'x': 0.500,
  'y': 0.502, 'z': 0.451, '{': 0.546, '|': 0.363, '}': 0.546, '~': 0.818,
};
const DIGIT_W = 0.546;
// สระบน/ล่าง + วรรณยุกต์ไทย = ลอยบนตัวอื่น ความกว้าง 0 (นับเป็นตัวจะทำให้ประมาณเกินเกือบเท่าตัว)
const THAI_ZERO = new Set([
  'ั', 'ิ', 'ี', 'ึ', 'ื', 'ุ', 'ู', 'ฺ',
  '็', '่', '้', '๊', '๋', '์', 'ํ', '๎',
]);
const THAI_BASE_W = 0.60;   // พยัญชนะ/สระหน้า-หลังทั่วไป
const THAI_NARROW = new Set(['ะ', 'า', 'ๅ', 'ๆ']); // ะ า ๅ ๆ
const THAI_NARROW_W = 0.45;
const THAI_WIDE = new Set(['ญ', 'ฒ', 'พ', 'ภ', 'ฬ', 'ฯ', '๚', '๛']);
const THAI_WIDE_W = 0.76;

const isThai = (ch) => ch >= '฀' && ch <= '๿';
const isCJK = (ch) => (ch >= 'ᄀ' && ch <= 'ᇿ') || (ch >= '⺀' && ch <= '꓏') ||
  (ch >= '가' && ch <= '힯') || (ch >= '豈' && ch <= '﫿');

/** ความกว้าง 1 ตัวอักษร (em) */
export function charWidthEm(ch) {
  if (ch === '\t') return 1.2;
  const a = ASCII_W[ch];
  if (a != null) return a;
  if (ch >= '0' && ch <= '9') return DIGIT_W;
  if (isThai(ch)) {
    if (THAI_ZERO.has(ch)) return 0;
    if (THAI_NARROW.has(ch)) return THAI_NARROW_W;
    if (THAI_WIDE.has(ch)) return THAI_WIDE_W;
    return THAI_BASE_W;
  }
  if (isCJK(ch)) return 1.0;
  const cp = ch.codePointAt(0);
  if (cp >= 0x1F000) return 1.25;          // emoji (สูง surrogate จะถูกรวมโดย [...str])
  if (cp >= 0x2000 && cp <= 0x27BF) return 0.85; // – — “ ” • · → ✓ ฯลฯ
  return 0.60;
}

/** ความกว้างข้อความ (นิ้ว) ที่ขนาดฟอนต์ sizePt */
export function textWidthIn(text, sizePt, { bold = false } = {}) {
  let em = 0;
  for (const ch of String(text ?? '')) em += charWidthEm(ch);
  return (em * (bold ? 1.06 : 1) * sizePt) / 72;
}

/** ความสูง 1 บรรทัด (นิ้ว) — Tahoma line gap ≈ 1.22 เท่าของขนาดฟอนต์ (ไทยมีวรรณยุกต์ 2 ชั้น) */
export const lineHeightIn = (sizePt) => (sizePt * 1.22) / 72;

/* จุดที่ตัดบรรทัดได้: หลังช่องว่าง/ขีด/จุดกลาง และ "หน้าตัวอักษรไทยที่ไม่ใช่สระลอย"
   (ไทยไม่มีเว้นวรรคระหว่างคำ — PowerPoint ตัดด้วย dictionary เราตัดตามตัวอักษรแบบระวังไว้ก่อน) */
const BREAK_AFTER = new Set([' ', '-', '/', '·', ',', ')', ']', '•', '→']);

/**
 * นับจำนวนบรรทัดเมื่อข้อความถูกห่อในกล่องกว้าง wIn
 * รองรับ \n (ขึ้นบรรทัดใหม่บังคับ) — คืนอย่างน้อย 1
 */
export function wrapLineCount(text, wIn, sizePt, { bold = false } = {}) {
  const w = Number(wIn);
  if (!(w > 0)) return 1;
  const k = (bold ? 1.06 : 1) * sizePt / 72;
  let total = 0;
  for (const para of String(text ?? '').split('\n')) {
    const chars = [...para];
    if (!chars.length) { total += 1; continue; }
    let lines = 1;
    let lineStart = 0;   // index ตัวแรกของบรรทัดปัจจุบัน
    let cur = 0;         // ความกว้างสะสมของบรรทัดปัจจุบัน
    let lastBreak = -1;  // index ตัวสุดท้ายที่ตัดบรรทัด "หลังตัวนั้น" ได้
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      const cw = charWidthEm(ch) * k;
      if (cur + cw > w && i > lineStart) {
        lines += 1;
        if (lastBreak >= lineStart && lastBreak < i) {
          // ถอยไปตัดที่จุดตัดล่าสุด แล้วเริ่มวัดบรรทัดใหม่จากตัวถัดจากจุดนั้น
          lineStart = lastBreak + 1;
          i = lastBreak;      // for-loop จะ ++ เป็น lineStart พอดี
          cur = 0;
          lastBreak = -1;
          continue;
        }
        // ไม่มีจุดตัด (คำ/ตัวเลขยาวรวด) → ตัดตรงตัวปัจจุบัน
        lineStart = i;
        cur = cw;
        lastBreak = -1;
      } else {
        cur += cw;
      }
      if (BREAK_AFTER.has(ch) || (isThai(ch) && !THAI_ZERO.has(ch))) lastBreak = i;
    }
    total += lines;
  }
  return Math.max(1, total);
}

/** ความสูงข้อความ (นิ้ว) เมื่อห่อในกล่องกว้าง wIn */
export function textHeightIn(text, wIn, sizePt, opts = {}) {
  return wrapLineCount(text, wIn, sizePt, opts) * lineHeightIn(sizePt);
}

/**
 * ขนาดฟอนต์ที่ใหญ่ที่สุด (≤ sizePt) ที่ทำให้ข้อความอยู่ "บรรทัดเดียว" ในกล่องกว้าง wIn
 * ใช้กับหัวเรื่อง/หัวข้อย่อย/ป้าย — แทน fit:'shrink' ที่ PowerPoint ไม่ย่อให้จริง
 */
export function fitOneLine(text, wIn, sizePt, minPt = 12) {
  const w0 = textWidthIn(text, sizePt, { bold: true });
  if (w0 <= wIn || w0 <= 0) return sizePt;
  const scaled = Math.floor((sizePt * wIn / w0) * 2) / 2; // ปัดลงทีละ 0.5pt
  return Math.max(minPt, Math.min(sizePt, scaled));
}

/**
 * ขนาดฟอนต์ที่ใหญ่ที่สุดที่ข้อความ (ห่อได้) ยังอยู่ในกล่อง wIn × hIn
 */
export function fitBox(text, wIn, hIn, sizePt, minPt = 8, opts = {}) {
  for (let s = sizePt; s >= minPt; s -= 0.5) {
    if (textHeightIn(text, wIn, s, opts) <= hIn) return s;
  }
  return minPt;
}

/* ── ตาราง ───────────────────────────────────────────────────────────
   pptxgenjs ใช้ระยะขอบเซลล์ default [0.05, 0.1, 0.05, 0.1] (บน/ขวา/ล่าง/ซ้าย)
   ⇒ ความกว้างที่ใช้พิมพ์ได้จริง = colW − 0.2 · ความสูงบวกเพิ่ม 0.1 */
export const CELL_PAD_X = 0.2;
export const CELL_PAD_Y = 0.1;

const cellText = (c) => (c && typeof c === 'object' && 't' in c) ? String(c.t ?? '') : String(c ?? '');

/** ความสูงจริงที่แถวหนึ่งต้องใช้ (นิ้ว) */
export function rowHeightIn(cells, colW, sizePt, { minH = 0.3, bold = false } = {}) {
  let h = minH;
  cells.forEach((c, i) => {
    const w = (colW?.[i] ?? 1.5) - CELL_PAD_X;
    h = Math.max(h, textHeightIn(cellText(c), w, sizePt, { bold: bold || i === 0 }) + CELL_PAD_Y);
  });
  return Math.round(h * 100) / 100;
}

/**
 * จัดตารางให้ "จบก่อนเส้นที่กำหนด" — ลดฟอนต์ก่อน ถ้ายังไม่พอค่อยตัดแถว (แล้วบอกว่าตัดไปกี่แถว)
 * คืน { fontSize, headRowH, rowHs, rows, hidden, height }
 *   height = ความสูงรวมจริงของตาราง → เอาไปวาง element ถัดไปได้โดยไม่ทับ
 * กฎโปรเจค: ตัดแถวได้ แต่ห้ามหายเงียบ — caller ต้องพิมพ์ "+อีก N" เมื่อ hidden > 0
 */
export function layoutTable({
  head = [], rows = [], colW, fontSize = 11.5, minFontSize = 8,
  headFontSize = 11.5, minRowH = 0.3, headMinH = 0.32, maxH = 5,
}) {
  const headH = (fs) => rowHeightIn(head, colW, fs, { minH: headMinH, bold: true });
  for (let fs = fontSize; fs >= minFontSize; fs -= 0.5) {
    const hfs = Math.min(headFontSize, fs + 2);
    const hH = headH(hfs);
    const rowHs = rows.map(r => rowHeightIn(r, colW, fs, { minH: minRowH }));
    const total = hH + rowHs.reduce((a, b) => a + b, 0);
    if (total <= maxH) {
      return { fontSize: fs, headFontSize: hfs, headRowH: hH, rowHs, rows, hidden: 0, height: Math.round(total * 100) / 100 };
    }
  }
  // เล็กสุดแล้วยังไม่พอ → ตัดแถวท้ายทิ้ง (เหลืออย่างน้อย 1 แถว) แล้วรายงานจำนวนที่ตัด
  const fs = minFontSize;
  const hfs = Math.min(headFontSize, fs + 2);
  const hH = headH(hfs);
  const all = rows.map(r => rowHeightIn(r, colW, fs, { minH: minRowH }));
  let n = rows.length, total = hH + all.reduce((a, b) => a + b, 0);
  while (n > 1 && total > maxH) { n -= 1; total = hH + all.slice(0, n).reduce((a, b) => a + b, 0); }
  return {
    fontSize: fs, headFontSize: hfs, headRowH: hH, rowHs: all.slice(0, n),
    rows: rows.slice(0, n), hidden: rows.length - n, height: Math.round(total * 100) / 100,
  };
}
