/**
 * BKL-06: قراءة معرّف فيديو يوتيوب من رابط — نقية بلا DOM ولا شبكة.
 *
 * لماذا هنا: الرابط يأتي من المؤلف ويُعرض لضيف بلا حساب، فلا يجوز أن يُبنى منه
 * `src` إطارٍ إلا بعد **استخراج معرّف مطابق لنمط يوتيوب حرفيًّا**. نحن لا «ننظّف»
 * الرابط بل نرفض كل ما لا يطابق: الناتج معرّف من ١١ محرفًا مسموحًا فقط، وما عداه `null`.
 */

/** ١١ محرفًا من أبجدية يوتيوب — أي شيء آخر ليس معرّفًا */
const ID = /^[A-Za-z0-9_-]{11}$/

const HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
  'youtu.be',
  'www.youtu.be',
])

/**
 * يعيد معرّف الفيديو أو `null`. يقبل: `watch?v=`, `youtu.be/`, `/embed/`,
 * `/shorts/`, `/live/`. ويرفض كل مضيف آخر — فلا يُحقن إطارٌ لموقع ثالث.
 */
export function youtubeId(raw: string | undefined): string | null {
  if (!raw) return null
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  if (!HOSTS.has(u.hostname.toLowerCase())) return null

  const segs = u.pathname.split('/').filter(Boolean)
  const candidate =
    u.hostname.toLowerCase().endsWith('youtu.be')
      ? segs[0]
      : segs[0] === 'embed' || segs[0] === 'shorts' || segs[0] === 'live'
        ? segs[1]
        : (u.searchParams.get('v') ?? undefined)

  return candidate && ID.test(candidate) ? candidate : null
}

/**
 * رابط التضمين — **`youtube-nocookie` دائمًا** ولا يُبنى إلا من معرّف مُتحقَّق منه.
 * لا يُستدعى إلا بعد نقر القارئ (الواجهة أولًا)، فلا اتصال بغوغل قبل قراره.
 */
export function youtubeEmbedUrl(id: string, autoplay = true): string {
  const q = autoplay ? '?autoplay=1&rel=0' : '?rel=0'
  return `https://www.youtube-nocookie.com/embed/${id}${q}`
}

/** رابط المشاهدة العادي — للتصدير والطباعة حيث لا مشغّل */
export function youtubeWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`
}
