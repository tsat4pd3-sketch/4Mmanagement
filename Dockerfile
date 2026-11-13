# ══ อิมเมจหน้าเว็บ ESM สำหรับ INET Container Platform (OpenShift) · 2026-11-13 · คำสั่ง user ══
# ขั้น 1 ของ "ย้ายเข้า server บริษัท" (docs/modules/deploy.md) — ย้ายแค่ไฟล์หน้าเว็บ
# ข้อมูล/login/รูป ยังอยู่ Supabase เหมือนเดิม (เบราว์เซอร์ยิงตรง ไม่ผ่านอิมเมจนี้)
#
# 🔴 ค่า Supabase ต้องส่งเป็น "build args" ไม่ใช่ env ตอนรัน — Vite ฝังลง JS ตอน build
#    ส่งตอนรัน = ไม่มีผล แอปต่อฐานไม่ได้ · ไม่ส่ง = build ล้มทันที (ด่านข้างล่าง ห้ามถอด)
# 🔴 build ผ่าน `npm run build` เต็มชุด (ด่าน context/lint/เทส) — ห้ามลัดเป็น `vite build` ตรงๆ

# ---------- ชั้น build ----------
FROM node:22-alpine AS build
WORKDIR /app

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
RUN test -n "$VITE_SUPABASE_URL" && test -n "$VITE_SUPABASE_ANON_KEY" \
    || (echo "❌ ต้องส่ง build arg VITE_SUPABASE_URL และ VITE_SUPABASE_ANON_KEY" && exit 1)
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# ---------- ชั้นรันจริง ----------
# OpenShift รัน container ด้วย UID สุ่ม ไม่ใช่ root ⇒ ใช้ nginx-unprivileged ฟังพอร์ต 8080
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
