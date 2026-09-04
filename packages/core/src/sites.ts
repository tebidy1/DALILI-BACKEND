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

/**
 * موقع الدليل الأساسي (WS-05) — مضيف أول خطوة لها رابط صالح،
 * بأحرف صغيرة ودون www؛ سلسلة فارغة إن لم يوجد رابط صالح.
 * يُشتق عند الإنشاء والتحريك ويخزَّن عمودًا فالترشيح بلا فكّ JSON (قانون PERF-05).
 */
export function primarySiteOf(steps: Array<{ url?: string }>): string {
  for (const step of steps) {
    const raw = step.url?.trim()
    if (!raw) continue
    const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    try {
      const host = new URL(candidate).hostname.toLowerCase().replace(/^www\./, '')
      // مضيف بلا نقطة لا يُقبل إلا localhost — وإلا يمرّ أي كلمة مفردة (URL متساهل)
      if (host && (host.includes('.') || host === 'localhost' || host === '127.0.0.1')) return host
    } catch {
      // رابط تالف — المحاولة التالية
    }
  }
  return ''
}

/**
 * يستخرج جميع المواقع الفريدة التي التُقطت منها خطوات الدليل
 * وينسق أسماءها ويولد شارات بحرف أولي ولون مميز.
 */
export function extractCapturedSites(steps: Array<{ url?: string; pageTitle?: string }>): CapturedSite[] {
  const seen = new Set<string>()
  const result: CapturedSite[] = []

  for (const step of steps) {
    if (!step.url) continue
    try {
      // قبول البروتوكولات الصالحة
      let urlStr = step.url.trim()
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
