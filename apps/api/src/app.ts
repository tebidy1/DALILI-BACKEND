import Fastify, { type FastifyServerOptions } from 'fastify'
import cookiePlugin from '@fastify/cookie'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import { createDb } from './db/client'
import { makeAuth } from './auth/session'
import { checkReady } from './lib/ready'
import { makeFileSigner } from './lib/file-cap'
import { createBurnPool } from './lib/burn-pool'
import { createDerivatives } from './lib/derivatives'
import { makeIdempotency } from './lib/idempotency'
import { parseCorsOrigins } from './lib/cors-origins'
import { registerAuthRoutes } from './routes/auth'
import { registerDeviceRoutes } from './routes/devices'
import { registerUploadRoutes } from './routes/uploads'
import { registerGuideRoutes } from './routes/guides'
import { registerCommentRoutes } from './routes/comments'
import { registerFolderRoutes } from './routes/folders'
import { registerSearchRoutes } from './routes/search'
import { registerDiscoverRoutes } from './routes/discover'
import { registerTeamRoutes } from './routes/team'
import { registerInviteRoutes } from './routes/invites'
import { registerLibraryRoutes } from './routes/library'
import { registerReportsRoutes } from './routes/reports'
import { registerAssignmentRoutes } from './routes/assignments'
import { registerTranslateRoute } from './routes/translate'
import { makeGuideHelpers } from './routes/guides-shared'
import { createGroqSttProvider } from './stt/groq'
import { createGroqTranslateProvider } from './translate/groq'
import type { SttProvider } from './stt/provider'
import type { TranslateProvider } from './translate/provider'
import type { EmbeddingProvider } from './embeddings/provider'

export interface AppOptions {
  dataDir: string
  cookieSecret: string
  publicBase: string
  /** OPS-02: خيارات السجل الأصلية تمر كما هي (redact وغيرها) */
  logger?: boolean | FastifyServerOptions['logger']
  rateLimit?: boolean
  /** VOX-04: مفتاح قروك من `.env` — يبني مزوّد التفريغ الافتراضي إن وُجد */
  groqApiKey?: string
  /** حقن مزوّد بديل (اختبار) — يتقدّم على البناء من المفتاح */
  stt?: SttProvider
  /** TRNS-01: حقن مزوّد ترجمة بديل (اختبار) — الافتراضي يُبنى من مفتاح قروك نفسه */
  translate?: TranslateProvider
  /** SRCH-06: مزوّد التضمين — يُبنى في index.ts (المحلي) ويُحقن هنا؛ غيابه = حرفي فقط */
  embeddings?: EmbeddingProvider
  /** DTOP-04: أصول CORS — غيابه = الافتراضي */
  corsOrigins?: Array<string | RegExp>
}

export async function createApp(opts: AppOptions) {
  const { sqlite, db, filesDir } = createDb(opts.dataDir)
  const app = Fastify({ logger: opts.logger ?? false })

  await app.register(cookiePlugin, { secret: opts.cookieSecret })
  // SEC-02: ترويسات الأمان — الـ API يقدّم JSON وصورًا فقط فلا يفتح شيئًا:
  // CSP كامل الإغلاق، لا تأطير، لا قواعد ولا نماذج. وCORP مفتوح عمدًا لأن
  // الويب (5174) والامتداد يعرضان لقطات /files عبر الأصول — باب CORS أعلاه هو الحارس.
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
  await app.register(cors, {
    origin: opts.corsOrigins ?? parseCorsOrigins(undefined),
    credentials: true,
  })
  // VOX: السقف العام يتسع لصوت 25MB وفوقه هامش البروتوكول؛ حد كل نوع يُطبَّق داخل المعالج
  await app.register(multipart, { limits: { fileSize: 27 * 1024 * 1024, files: 1 } })

  // SEC-01: تحديد المعدّل حسب مواصفة المرجع — عام 300/د، والمسارات الحساسة أشد عبر config عندها.
  if (opts.rateLimit) {
    await app.register(rateLimit, {
      global: true,
      max: 300,
      timeWindow: '1 minute',
    })
  }

  const auth = makeAuth(db)
  // خصوصيّة ٢ب: كل رابط ملفّ يخرج من الخادم موقَّع — مفتاحه مشتقّ من سرّ الكوكي
  const signer = makeFileSigner(opts.cookieSecret)
  // الحرق ~1.7s للقطة 1920×1080 بـjpeg-js النقيّة — خارج خيط الخادم إلزاميًّا
  const burnPool = createBurnPool()
  const derivatives = createDerivatives(db, filesDir, burnPool)
  // DTOP-02: عدم التكرار للرفع وإنشاء الدليل — شبكة تنقطع لا تُنتج نسخًا مكرّرة
  const idempotency = makeIdempotency(db)
  app.get('/health', async () => ({ ok: true, name: 'dalili-api' }))
  // OPS-02: الجهوزية — حيّ ≠ جاهز؛ القاعدة والقرص يُفحصان فعليًا لا افتراضًا
  app.get('/ready', async (_req, reply) => {
    const r = checkReady(sqlite, filesDir)
    if (!r.ok) return reply.code(503).send({ ready: false, errorAr: r.errorAr })
    return { ready: true, db: true, files: true }
  })
  registerAuthRoutes(app, db, auth, sqlite)
  // DTOP-03: اقتران تطبيق الديسكتوب — Bearer بجانب الكوكي
  registerDeviceRoutes(app, db, auth)
  registerUploadRoutes(app, db, auth, filesDir, signer, idempotency)
  // VOX-04: المزوّد المحقون (اختبار) أو المبني من مفتاح قروك، أو لا شيء (النقطة تردّ 503)
  const stt = opts.stt ?? (opts.groqApiKey ? createGroqSttProvider({ apiKey: opts.groqApiKey }) : undefined)
  registerGuideRoutes(app, db, auth, opts.publicBase, sqlite, filesDir, signer, derivatives, idempotency, stt, opts.embeddings)
  // TRNS-01: مزوّد الترجمة — نفس مفتاح قروك يخدم المسارين، والبنّاء المشترك يمنح ملكية الدليل،
  // والموقّع يعيد روابط صور الرد موقَّعة كمسار القراءة
  const translate = opts.translate ?? (opts.groqApiKey ? createGroqTranslateProvider({ apiKey: opts.groqApiKey }) : undefined)
  registerTranslateRoute(app, db, auth, sqlite, translate, signer, makeGuideHelpers(db, auth, opts.publicBase, signer))
  registerCommentRoutes(app, db, auth)
  registerFolderRoutes(app, db, auth)
  registerSearchRoutes(app, sqlite, auth, signer, opts.embeddings)
  registerDiscoverRoutes(app, sqlite, auth)
  registerTeamRoutes(app, db, auth)
  registerInviteRoutes(app, db, auth, opts.publicBase)
  registerLibraryRoutes(app, db, auth)
  registerReportsRoutes(app, db, auth)
  registerAssignmentRoutes(app, db, auth)

  app.setNotFoundHandler((_req, reply) => {
    return reply.code(404).send({ errorAr: 'المسار غير موجود' })
  })

  // SEC-02: مسارات المشاركة العمومية خارج فهرسة محركات البحث — حتى 404 يحمل الترويسة
  app.addHook('onSend', async (req, reply, payload) => {
    if (req.url.startsWith('/api/share/') || req.url.startsWith('/files/')) {
      reply.header('x-robots-tag', 'noindex')
    }
    // OPS-02: معرّف الطلب في الترويسة — يصل المستخدم الشاكي والمشغّل لنفس سطر السجل
    reply.header('x-request-id', req.id)
    return payload
  })

  app.setErrorHandler((err: import('fastify').FastifyError, req, reply) => {
    // SEC-01: تجاوز الحد يمرّ من هنا — رسالة عربية صادقة تُبقي الحالة 429 (نافذة الدقيقة كاملة انتظارًا)
    if (err.statusCode === 429 || err.code === 'FST_ERR_REACHED_RATE_LIMIT') {
      return reply
        .code(429)
        .header('retry-after', '60')
        .send({ errorAr: 'محاولات كثيرة جدًا — انتظر دقيقة ثم أعد المحاولة' })
    }
    if (err.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.code(413).send({ errorAr: 'حجم الملف يتجاوز 26 ميغابايت' })
    }
    if (err.validation) {
      return reply.code(400).send({ errorAr: 'بيانات الطلب غير صالحة' })
    }
    req.log.error(err)
    return reply.code(500).send({ errorAr: 'خطأ داخلي في الخادم — راجع سجل التشغيل' })
  })

  return {
    app,
    /** SRCH-06: مقبض sqlite للإقلاع — backfill التضمين يعمل بعد الإصغاء لا قبلها */
    sqlite,
    async close() {
      await app.close()
      await burnPool.close()
      sqlite.close()
    },
  }
}
