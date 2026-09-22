// نقطة إقلاع اختبار ٣د-٢ — تستخدمها اختبارات تكامل تطبيق سطح المكتب فقط.
// تشغّل createApp نفسها (نفس المسارات والقاعدة وعدم التكرار) بمعزلٍ تامّ:
// المنفذ ومجلد البيانات من متغيّرات بيئة **إلزاميّان** كي لا يقترب هذا
// الملف أبدًا من خادم المالك التطويريّ أو بياناته الحقيقيّة (‏.env).
// بلا تضمينات خارجيّة ولا شبكة خارجيّة — كلّ شيء محليّ.

import { randomUUID } from 'node:crypto'
import { createApp } from '../src/app'

const port = Number(process.env.ITQAN_TEST_PORT)
const dataDir = process.env.ITQAN_TEST_DATA_DIR
if (!Number.isInteger(port) || port <= 0 || !dataDir) {
  console.error(
    'ITQAN_TEST_PORT وITQAN_TEST_DATA_DIR إلزاميّان — رُفض الإقلاع الافتراضيّ حمايةً لبيانات المالك',
  )
  process.exit(1)
}

const { app } = await createApp({
  dataDir,
  cookieSecret: randomUUID() + randomUUID(),
  publicBase: `http://127.0.0.1:${port}`,
  rateLimit: true,
})

await app.listen({ port, host: '127.0.0.1' })
console.log(`itqan-integration-api-ready-on-${port}`)
