import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app'
import { loadEnv } from './env'
import { createLocalEmbeddingProvider } from './embeddings/local'
import { backfillEmbeddings } from './embeddings/store'

const env = loadEnv()
// SRCH-06: المزوّد المحلي — نماذجه في .models خارج data كي لا تثقل النسخ الاحتياطية
const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const embeddings = createLocalEmbeddingProvider({ modelsDir: path.join(appDir, '.models') })

const { app, sqlite } = await createApp({
  dataDir: env.dataDir,
  cookieSecret: env.cookieSecret,
  publicBase: env.publicBase,
  groqApiKey: env.groqApiKey,
  corsOrigins: env.corsOrigins,
  embeddings,
  // OPS-02: سجل منظّم (JSON بمعرّف طلب يلتقطه journalctl) مع إخفاء الكوكيز منه —
  // السجل أداة تشخيص لا صندوق أسرار
  logger: {
    redact: {
      // DTOP-03: رمز الجهاز سرّ كالكوكي — لا يدخل السجل
      paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
      censor: '[مخفي]',
    },
  },
  rateLimit: true,
})

await app.listen({ port: env.port, host: '127.0.0.1' })
app.log.info(`دليلي API جاهز على http://127.0.0.1:${env.port}`)

// SRCH-06: شفاء البصمات بعد الإصغاء — لا يحجب الإقلاع، ولا حلقة استطلاع: مهمة واحدة
// عند كل إقلاع تضمّن الناقص وتحدّث المتغيّر، وما كُتب أثناء التشغيل يُضمَّن لحظة كتابته
void backfillEmbeddings(sqlite, embeddings, (done, total) => {
  app.log.info(`البحث بالمعنى: فهرسة بصمات الأدلة ${done}/${total}`)
})
  .then((r) => app.log.info(`البحث بالمعنى جاهز — بصمات ${r.total} دليلًا، أُضمِّن الآن ${r.embedded}`))
  .catch((err) => app.log.warn({ err }, 'تعذّر تجهيز بصمات البحث بالمعنى — الحرفي يعمل والشفاء عند الإقلاع القادم'))
