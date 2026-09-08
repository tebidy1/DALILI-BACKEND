/** أدوات المشاركة — HTML غني للصق في Word/Docs (VIEW-10) ورابط واتساب (VIEW-07). نقية بلا DOM. */
import { richToHtml, type RichText } from './rich-text'
import { youtubeId, youtubeWatchUrl } from './youtube'

/** النموذج الهيكلي الذي تحتاجه الدالة من GuideDto — core لا يعتمد على حزم أخرى */
interface HtmlGuideStep {
  /** الدالة تستهلك العنوان/الملاحظة/النص البديل/اللقطة فقط — بقية حقول العقد تمر سليمة */
  [field: string]: unknown
  title: string
  note?: string
  /** EDT-13: إن غاب يُستخدم عنوان الخطوة نصًّا بديلًا للصورة */
  alt?: string
  screenshot?: { fileId: string; fileUrl?: string; blurRects?: unknown[] } | { missing: true; reason?: string }
  /** BLK-01 + BKL-01: نوع الكتلة — غيابه خطوة عادية تُرقَّم */
  block?: 'tip' | 'alert' | 'header' | 'text' | 'embed' | 'divider' | 'link' | 'image' | 'video'
  /** BKL-01: نص كتلة text المنسّق */
  rich?: RichText
}

export interface HtmlGuide {
  [field: string]: unknown
  title: string
  description?: string
  steps: HtmlGuideStep[]
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * الدليل كاملًا كـHTML بأنماط مضمّنة وصور مطلقة المصدر — الصق في Word/Google Docs/Confluence
 * فتظهر الخطوات بصورها. لا نص عربي مضمن هنا؛ كل النصوص من بيانات الدليل وتُهرَّب.
 */
export function guideToHtml(guide: HtmlGuide, fileUrl: (fileId: string) => string): string {
  // BLK-01: ترقيم يُصفّي الكتل محليًّا (share نقي بلا استيراد من guide)
  let n = 0
  const steps = guide.steps
    .map((s) => {
      if (s.block === 'header')
        return `<h2 style="font-size:1.2rem;margin:18px 0 0">${esc(s.title)}</h2>`
      if (s.block === 'tip' || s.block === 'alert') {
        const bg = s.block === 'tip' ? '#e0f2fe' : '#ffedd5'
        const bd = s.block === 'tip' ? '#7dd3fc' : '#fdba74'
        // BKL-07: الجملة المنسّقة هي المحتوى الجديد؛ العنوان/الملاحظة يبقيان للكتل القديمة
        const body = s.rich?.length
          ? richToHtml(s.rich)
          : `<b>${esc(s.title)}</b>${s.note ? ` — ${esc(s.note)}` : ''}`
        return `<div style="background:${bg};border:1px solid ${bd};border-radius:8px;padding:8px 12px;margin:10px 0">${body}</div>`
      }
      // BKL-01: كتل الكرّاسة كلها بلا ترقيم — تُعالَج قبل زيادة العدّاد
      const shotOf = (st: HtmlGuideStep) =>
        st.screenshot && !('missing' in st.screenshot) ? st.screenshot : null
      const imgTag = (st: HtmlGuideStep, margin: string) => {
        const sh = shotOf(st)
        if (!sh) return ''
        const fid = sh.fileUrl ? (sh.fileUrl.split('/').pop() ?? sh.fileId) : sh.fileId
        return `<img src="${esc(fileUrl(fid))}" alt="${esc(st.alt ?? st.title)}" style="max-width:100%;height:auto;border:1px solid #e2e2e2;border-radius:8px;margin:${margin}" />`
      }
      if (s.block === 'text')
        return s.rich?.length ? `<div style="margin:10px 0">${richToHtml(s.rich)}</div>` : ''
      if (s.block === 'divider')
        return '<hr style="border:0;border-top:1px solid #e2e2e2;margin:18px 0" />'
      if (s.block === 'link') {
        // الرابط الخطر يسقط ويبقى النص — نفس قاعدة rich-text (الصدق خير من رابط صامت خطر)
        const raw = typeof s.url === 'string' ? s.url : ''
        let href = ''
        try {
          const u = new URL(raw)
          if (u.protocol === 'http:' || u.protocol === 'https:') href = raw
        } catch {
          href = ''
        }
        const label = esc(s.title || raw)
        return href
          ? `<p style="margin:8px 0"><a href="${esc(href)}" rel="noopener noreferrer nofollow">${label}</a></p>`
          : `<p style="margin:8px 0">${label}</p>`
      }
      if (s.block === 'embed') return `<p style="margin:8px 0"><b>${esc(s.title)}</b></p>`
      if (s.block === 'video') {
        // لا إطار في HTML المُصدَّر — Word ولا Docs يشغّلانه، والرابط أصدق من إطار ميت
        const vid = youtubeId(typeof s.url === 'string' ? s.url : '')
        if (!vid) return ''
        const label = esc(s.title || youtubeWatchUrl(vid))
        return `<p style="margin:8px 0"><a href="${esc(youtubeWatchUrl(vid))}" rel="noopener noreferrer nofollow">${label}</a></p>`
      }
      if (s.block === 'image') return imgTag(s, '10px 0')

      n += 1
      const shot = s.screenshot && !('missing' in s.screenshot) ? s.screenshot : null
      const img = shot
        ? `<img src="${esc(fileUrl(shot.fileUrl ? shot.fileUrl.split('/').pop() ?? shot.fileId : shot.fileId))}" alt="${esc(s.alt ?? s.title)}" style="max-width:100%;height:auto;border:1px solid #e2e2e2;border-radius:8px;margin:6px 0" />`
        : ''
      const note = s.note ? `<p style="color:#555;margin:4px 0">${esc(s.note)}</p>` : ''
      return `<div style="margin:0 0 22px"><h2 style="font-size:1.05rem;margin:0">${n}. ${esc(s.title)}</h2>${note}${img}</div>`
    })
    .join('')
  const desc = guide.description ? `<p style="color:#666;font-size:1rem;margin:8px 0 18px">${esc(guide.description)}</p>` : ''
  return `<div dir="rtl" style="font-family:'IBM Plex Sans Arabic','Segoe UI',Tahoma,sans-serif;line-height:1.8;max-width:820px"><h1 style="font-size:1.4rem;margin:0 0 6px">${esc(guide.title)}</h1>${desc}${steps}</div>`
}

/**
 * رابط واتساب بنص جاهز — بلا رقم فيفتح اختيار جهة الاتصال.
 * نستخدم `api.whatsapp.com/send?text=` لا `wa.me/?text=`: الصيغة الأخيرة **بلا رقم**
 * لا تُحوّل بثبات على سطح المكتب (تقف عند صفحة wa.me)، بينما api.whatsapp.com
 * يفتح منتقي جهة الاتصال على الويب ويطلق التطبيق على الجوال بثبات.
 */
export function whatsappUrl(title: string, url: string): string {
  return `https://api.whatsapp.com/send?text=${encodeURIComponent(`${title}\n${url}`)}`
}
