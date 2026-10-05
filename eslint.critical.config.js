// ── ด่านตรวจ "โค้ดพังตอน runtime" — รันอัตโนมัติใน `npm run build` (2026-07-24) ──
// เกิดจากเหตุจริง: session หนึ่งใช้ useMemo โดยไม่ import → build ผ่านแต่หน้า Daily Report
// จอขาวทั้งโรงงาน (bundler ไม่เช็คตัวแปรที่ไม่ได้ประกาศ — เจอตอน runtime เท่านั้น)
// ตั้งใจเช็คเฉพาะกฎที่ = crash แน่นอน ไม่ใช่ style — อย่าเพิ่มกฎจุกจิกที่ทำให้คน bypass ด่านนี้
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { 'react-hooks': reactHooks },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
        __BUILD_ID__: 'readonly', // inject จาก vite.config.js define
      },
    },
    rules: {
      'no-undef': 'error',        // ตัวแปร/hook ที่ไม่ได้ import — เคสจริงที่พัง
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-unreachable': 'error',
      'use-isnan': 'error',
      // hook หลัง early return / ใน if / ใน loop = React #310 (จอ error) — build ไม่จับ เจอตอน runtime
      // เคสจริง 2026-07-30: MtnRepair (useMemo หลัง `if (loading) return`) + ProtectedLayout (session guard)
      'react-hooks/rules-of-hooks': 'error',
      // อ่าน const/let ก่อนประกาศใน scope เดียวกัน = TDZ "Cannot access 'x' before initialization" ทั้งจอขาว · build ไม่จับ
      // เคสจริง 2026-09-30: ObeyaKpiBoard `const dense = data.some(…)` ก่อน `const data = …` (เจอจาก harness ไม่ใช่ด่าน)
      // variables:false = ฟ้องเฉพาะ scope เดียวกัน (อ้าง const ระดับโมดูลจากในฟังก์ชันที่ประกาศก่อน = ถูกเรียกทีหลัง ไม่พัง ไม่ฟ้อง)
      'no-use-before-define': ['error', { functions: false, classes: false, variables: false }],
    },
  },
];
