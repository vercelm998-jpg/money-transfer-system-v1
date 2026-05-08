# Dockerfile
# المرحلة الأولى: بناء التطبيق
FROM node:20-alpine AS builder

WORKDIR /app

# نسخ ملفات package.json
COPY package*.json ./

# تثبيت الاعتماديات
RUN npm ci --only=production && npm cache clean --force

# المرحلة الثانية: تشغيل التطبيق
FROM node:20-alpine

WORKDIR /app

# تثبيت أدوات إضافية
RUN apk add --no-cache tzdata curl

# تعيين المنطقة الزمنية
ENV TZ=Asia/Riyadh

# نسخ ملفات الإنتاج من المرحلة الأولى
COPY --from=builder /app/node_modules ./node_modules

# نسخ ملفات المشروع
COPY . .

# إنشاء مستخدم غير root للتشغيل
RUN addgroup -g 1001 -S nestjs && \
    adduser -S nestjs -u 1001 && \
    chown -R nestjs:nestjs /app

USER nestjs

# فتح المنفذ
EXPOSE 3000

# فحص الصحة
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s \
  CMD curl -f http://localhost:3000/api/v1 || exit 1

# تشغيل التطبيق
CMD ["node", "dist/main"]