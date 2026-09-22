import { nanoid } from 'nanoid'
import type Database from 'better-sqlite3'
import type { Db } from '../db/client'
import { guides } from '../db/schema'
import { indexGuide } from '../search/index'
import { primarySourceOf } from '@dalili/core'
import type { GuideDto } from '@dalili/shared'
import { toV2 } from './guide-v2'

/**
 * UX-05: الدليل الترحيبي — أول تسجيل دخول يجد دليلًا يشرح المنتج **بنفس المنتج**:
 * العارض نفسه هو العرض الحي. خطوات نصية بلا لقطات عمدًا (لا صور مزيفة)،
 * قابلة للحذف كأي دليل، وموسومة «ترحيب» فلا تختلط بأدلة العمل.
 */
export function buildWelcomeGuide(id: string, nowIso: string): GuideDto {
  const step = (sid: string, title: string, note: string) => ({
    id: sid,
    kind: 'navigate' as const,
    title,
    note,
    target: {},
    sensitive: false,
    url: 'https://dalili.app/welcome',
    pageTitle: 'دليلي',
    ts: 0,
  })
  return {
    id,
    schemaVersion: 1,
    title: 'مرحبًا بك في دليلي — دليلك الأول',
    locale: 'ar',
    dir: 'rtl',
    createdAt: nowIso,
    updatedAt: nowIso,
    steps: [
      step('w1', 'ثبّت امتداد دليلي', 'أضِف الامتداد إلى كروم من متجر الإضافات، وستظهر أيقونة البوصلة في شريط الأدوات.'),
      step('w2', 'ابدأ الالتقاط من اللوحة الجانبية', 'اضغط أيقونة دليلي أو الاختصار Ctrl+Shift+U، ثم نفّذ مهمتك كالمعتاد.'),
      step('w3', 'كل نقرة تُوثَّق تلقائيًا', 'دليلي يلتقط لقطة عند كل نقرة وكتابة وتنقّل، ويكتب الخطوات بالعربية — بلا توقّف.'),
      step('w4', 'أنهِ التسجيل وحرّر الدليل', 'من المحرر: عدّل العناوين، طمّس ما هو حساس، قصّ الصور، وأضف النص البديل للقُطّاع.'),
      step('w5', 'شارك برابط واحد', 'زر المشاركة يولّد رابطًا عامًا يفتح من الجوال، مع رمز QR ورسالة واتساب جاهزة.'),
      step('w6', 'هذا الدليل نفسه نموذج حيّ', 'هكذا سيرى زملاؤك أدلتك — تصفّح الخطوات أعلاه، ثم احذف هذا الدليل متى شئت.'),
    ],
  }
}

/** يزرع الدليل الترحيبي لحساب جديد — مرة واحدة عند التسجيل فقط */
export function seedWelcomeGuide(
  db: Db,
  sqlite: Database.Database,
  { workspaceId, userId, nowIso }: { workspaceId: string; userId: string; nowIso: string },
): string {
  // DTOP-01: الكتابة v2 دائمًا — حتى دليل الترحيب
  const guide = toV2(buildWelcomeGuide(nanoid(12), nowIso))
  const tags = ['ترحيب']
  sqlite.transaction(() => {
    db.insert(guides)
      .values({
        id: guide.id,
        workspaceId,
        userId,
        title: guide.title,
        data: JSON.stringify(guide),
        stepCount: guide.steps.length,
        thumbFileId: null,
        createdAt: nowIso,
        updatedAt: nowIso,
        tags: JSON.stringify(tags),
        // الموقع مشتق كأي دليل — وإلا بقي الترحيبي الجديد بلا موقع بعد ما شفا 0009 القدامى
        site: primarySourceOf(guide.steps),
      })
      .run()
    indexGuide(sqlite, guide, tags)
  })()
  return guide.id
}
