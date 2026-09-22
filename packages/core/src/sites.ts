import { normalizeUrlHost } from './host-url'

/** استخراج وتنسيق شارات المواقع والتطبيقات الملتقطة في خطوات الدليل — نقي بلا DOM */

export interface CapturedSite {
  host: string
  name: string
  initial: string
  color: string
}

/** لوحة ألوان دلالية هادئة لشارات التطبيقات */
const SITE_COLORS = [
  '#2563eb', // أزرق
  '#ea580c', // برتقالي
  '#7c3aed', // بنفسجي
  '#059669', // أخضر زمردي
  '#db2777', // وردي
  '#d97706', // عنبري
  '#0284c7', // سماوي
  '#4f46e5', // نيلي
]

function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

/** استخراج مضيف الرابط بأحرف صغيرة ودون www — مضيف بلا نقطة لا يُقبل إلا localhost (URL متساهل) */
function hostOf(raw: string): string {
  return normalizeUrlHost(raw, { dottedOrLocalOnly: true })
}

/** DTOP-01: أسماء بشريّة لأشهر التطبيقات — الباقي يُشتقّ من اسم الملفّ */
const APP_NAMES: Record<string, string> = {
  'EXCEL.EXE': 'Excel',
  'WINWORD.EXE': 'Word',
  'POWERPNT.EXE': 'PowerPoint',
  'OUTLOOK.EXE': 'Outlook',
  'SAPLOGON.EXE': 'SAP GUI',
  'MSEDGE.EXE': 'Edge',
}

/** مصدر كما تحتاجه دوال المواقع — بنية أعمّ من StepSource كي تقبل خطوات v1 وv2 معًا */
type SiteSource = { kind?: string; url?: string; processName?: string; ieMode?: boolean }

/** DTOP-01: مفتاح موقع التطبيق — اسم الملفّ التنفيذي بأحرف كبيرة: app:EXCEL.EXE */
export function appSiteKey(processName: string): string {
  const base = processName.split(/[\\/]/).pop() ?? processName
  return `app:${base.trim().toUpperCase()}`
}

/** DTOP-01: تسمية بشريّة لقيمة عمود site — للشارات والمرشّحات في الويب */
export function siteLabel(site: string): string {
  if (site === 'camera') return 'الكاميرا'
  if (!site.startsWith('app:')) return site
  const exe = site.slice(4)
  const known = APP_NAMES[exe]
  if (known) return known
  const stem = exe.replace(/\.EXE$/, '')
  return stem.charAt(0) + stem.slice(1).toLowerCase()
}

/** رابط الخطوة القابل للاستعمال: v1 ثم مصدر الويب ثم IE-mode */
function urlOfStep(step: { url?: string; source?: SiteSource }): string {
  const legacy = step.url?.trim()
  if (legacy) return legacy
  const src = step.source
  if (src?.kind === 'web' || (src?.kind === 'desktop' && src.ieMode)) return (src.url ?? '').trim()
  return ''
}

/**
 * موقع الدليل الأساسي (WS-05 → DTOP-01) — أول خطوة لها هويّة: مضيف رابط صالح (ويب/IE-mode)
 * أو `app:<EXE>` للديسكتوب أو `camera`. سلوك الويب مطابق لسابقه حرفيًّا.
 */
export function primarySourceOf(steps: Array<{ url?: string; source?: SiteSource }>): string {
  for (const step of steps) {
    const raw = urlOfStep(step)
    if (raw) {
      const host = hostOf(raw)
      if (host) return host
    }
    const src = step.source
    if (src?.kind === 'desktop' && src.processName?.trim()) return appSiteKey(src.processName)
    if (src?.kind === 'camera') return 'camera'
  }
  return ''
}

/**
 * @deprecated استخدم primarySourceOf — الاسم القديم يفوّض إليها حتى تهجرة المستوردين.
 * النسخة المجمَّدة داخل ترحيلات API معزولة عن هذه الدالة بحارس migrations-frozen.
 */
export function primarySiteOf(steps: Array<{ url?: string }>): string {
  return primarySourceOf(steps)
}

// 70 سطرًا و4 مستويات تعشيش — جدول أسماء العلامات مرتَّب تعاقدًا (drive/docs قبل google.com)؛
// أي استخراج يحافظ على الترتيب حرفيًّا.
/**
 * يستخرج جميع المواقع الفريدة التي التُقطت منها خطوات الدليل
 * وينسق أسماءها ويولد شارات بحرف أولي ولون مميز.
 */
export function extractCapturedSites(steps: Array<{ url?: string; pageTitle?: string; source?: SiteSource }>): CapturedSite[] {
  const seen = new Set<string>()
  const result: CapturedSite[] = []

  for (const step of steps) {
    const src = step.source
    // DTOP-01: تطبيق ديسكتوب (غير IE-mode ذي رابط) ← شارة باسم التطبيق
    if (src?.kind === 'desktop' && !(src.ieMode && src.url)) {
      if (!src.processName?.trim()) continue
      const host = appSiteKey(src.processName)
      if (seen.has(host)) continue
      seen.add(host)
      const name = siteLabel(host)
      result.push({ host, name, initial: name.charAt(0).toUpperCase(), color: SITE_COLORS[hashString(host) % SITE_COLORS.length] ?? '#2563eb' })
      continue
    }
    const rawUrl = urlOfStep(step)
    if (!rawUrl) continue
    try {
      // قبول البروتوكولات الصالحة
      let urlStr = rawUrl
      if (!/^https?:\/\//i.test(urlStr)) {
        if (urlStr.startsWith('localhost') || urlStr.startsWith('127.0.0.1')) {
          urlStr = `http://${urlStr}`
        } else {
          continue
        }
      }

      const parsed = new URL(urlStr)
      const host = parsed.hostname.toLowerCase()
      if (!host || seen.has(host)) continue
      seen.add(host)

      let name = host
      if (host.includes('claude.ai')) name = 'Claude'
      else if (host.includes('mail.google.com') || (host.includes('google.com') && step.pageTitle?.toLowerCase().includes('gmail'))) name = 'Gmail'
      else if (host.includes('drive.google.com')) name = 'Google Drive'
      else if (host.includes('docs.google.com')) name = 'Google Docs'
      else if (host.includes('google.com')) name = 'Google'
      else if (host === 'localhost' || host === '127.0.0.1') name = 'Localhost'
      else if (host.includes('github.com')) name = 'GitHub'
      else if (host.includes('notion.so')) name = 'Notion'
      else if (host.includes('figma.com')) name = 'Figma'
      else if (host.includes('slack.com')) name = 'Slack'
      else if (host.includes('scribehow.com')) name = 'Scribe'
      else {
        // تنسيق الاسم من النطاق الأساسي
        const cleanHost = host.replace(/^www\./, '')
        const parts = cleanHost.split('.')
        const mainPart = parts[0] ?? cleanHost
        name = mainPart.charAt(0).toUpperCase() + mainPart.slice(1)
      }

      const initial = name.charAt(0).toUpperCase()
      const colorIdx = hashString(host) % SITE_COLORS.length
      const color = SITE_COLORS[colorIdx] ?? '#2563eb'

      result.push({
        host,
        name,
        initial,
        color,
      })
    } catch {
      // تجاهل الروابط غير الصالحة بصمت
    }
  }

  return result
}
