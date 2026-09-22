/**
 * النواة الموحَّدة لتطبيع «رابط أو مضيف مجرّد» — كانت مكتوبة يدويًّا في أربعة مواضع
 * (hostOf في sites.ts وurlHost في blur-suggest.ts وparseUrlish وموضعها الداخلي في
 * steps-ops.ts) بفروق مقصودة صارت معاملات صريحة حتى يبقى كل موضع بسلوكه الحرفيّ:
 * - dottedOrLocalOnly: يُرفض المضيف عديم النقطة إلا إن كان localhost أو 127.0.0.1
 *   (سلوك hostOf). بدونه يُقبل أي مضيف نجح تحليله حتى لو بلا نقطة (سلوك urlHost).
 * - trimTrailingSlash: يقصّ كل الشرطات المائلة من نهاية المسار (سلوك parseUrlish)؛
 *   بدونه يعود المسار كما هو.
 * القاعدة المشتركة: قصّ الفراط، ثم إضافة https:// إن غاب بروتوكول http(s)، ثم new URL؛
 * والمضيف بأحرف صغيرة ودون بادئة www. عند فشل التحليل أو الفراغ تعيد parseLooseUrl
 * قيمة null وnormalizeUrlHost سلسلة فارغة. وحدة داخلية لا تُصدَّر من index.ts.
 */

/** نتيجة تحليل ناجحة لرابط أو مضيف مجرّد */
export interface LooseUrl {
  /** المضيف بأحرف صغيرة ودون بادئة www */
  host: string
  /** المسار (pathname) — مع قصّ الشرطات الختامية حين trimTrailingSlash */
  path: string
  /** البروتوكول مع النقطتين، مثل 'https:' */
  protocol: string
  /** الاستعلام مع علامة الاستفهام، أو '' إن غاب */
  search: string
}

export interface LooseUrlOptions {
  /** ارفض المضيف عديم النقطة إلا localhost و127.0.0.1 — سلوك hostOf في sites.ts */
  dottedOrLocalOnly?: boolean
  /** اقصّ الشرطات المائلة من نهاية المسار — سلوك parseUrlish في steps-ops.ts */
  trimTrailingSlash?: boolean
}

/** يحلّل رابطًا أو مضيفًا مجرّدًا بالقاعدة المشتركة — null عند فشل التحليل أو الفراغ */
export function parseLooseUrl(raw: string, opts: LooseUrlOptions = {}): LooseUrl | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const u = new URL(candidate)
    const host = u.hostname.toLowerCase().replace(/^www\./, '')
    if (opts.dottedOrLocalOnly && !(host.includes('.') || host === 'localhost' || host === '127.0.0.1')) {
      return null
    }
    return {
      host,
      path: opts.trimTrailingSlash ? u.pathname.replace(/\/+$/, '') : u.pathname,
      protocol: u.protocol,
      search: u.search,
    }
  } catch {
    return null
  }
}

/** مضيف الرابط بأحرف صغيرة ودون www — سلسلة فارغة عند فشل التحليل أو غياب الرابط */
export function normalizeUrlHost(raw: string | undefined, opts: LooseUrlOptions = {}): string {
  return parseLooseUrl(raw ?? '', opts)?.host ?? ''
}
