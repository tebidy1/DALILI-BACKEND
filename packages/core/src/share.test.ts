import { describe, expect, it } from 'vitest'
import { guideToHtml, whatsappUrl } from './share'

const now = new Date().toISOString()
const base = { schemaVersion: 1 as const, locale: 'ar' as const, dir: 'rtl' as const, createdAt: now, updatedAt: now }

describe('guideToHtml — نسخ HTML غني (VIEW-10)', () => {
  it('عنوان وخطوات بصور مطلقة المصدر وRTL — جاهز للصق في Word/Docs', () => {
    const html = guideToHtml(
      {
        ...base,
        id: 'g1',
        title: 'إصدار فاتورة',
        steps: [
          {
            id: 's1',
            kind: 'click',
            title: 'افتح الفواتير',
            note: 'من القائمة',
            target: {},
            sensitive: false,
            url: 'https://erp/x',
            pageTitle: 'p',
            ts: 1,
            screenshot: { fileId: 'f1', blurRects: [] },
          },
        ],
      },
      (fileId) => `http://localhost:8787/files/${fileId}`,
    )
    expect(html).toContain('dir="rtl"')
    expect(html).toMatch(/<h1[^>]*>إصدار فاتورة<\/h1>/)
    expect(html).toContain('1. افتح الفواتير')
    expect(html).toContain('http://localhost:8787/files/f1')
    expect(html).toMatch(/<img[^>]+src="http:\/\/localhost:8787\/files\/f1"/)
  })

  it('خطوة بلا لقطة: بلا صورة إطلاقًا — والنص يُهرَّب ضد الحقن', () => {
    const html = guideToHtml(
      {
        ...base,
        id: 'g2',
        title: '<script>x</script>',
        steps: [
          { id: 's2', kind: 'navigate', title: 'انتقال', target: {}, sensitive: false, url: 'u', pageTitle: 'p', ts: 1 },
        ],
      },
      () => 'x',
    )
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<img')
  })
})

describe('guideToHtml — كتل الكرّاسة (BKL-01)', () => {
  const url = (id: string) => `https://x.test/files/${id}`
  const blk = (over: Record<string, unknown>) => ({
    id: 'b1', kind: 'click' as const, title: '', target: {}, sensitive: false,
    url: '', pageTitle: '', ts: 1, ...over,
  })

  it('كتلة النص تخرج HTML منسّقًا مهرَّبًا', () => {
    const html = guideToHtml(
      { ...base, id: 'k', title: 'كرّاسة', steps: [blk({ block: 'text', rich: [{ para: 'p', runs: [{ text: 'مرحبًا', b: true }] }] })] },
      url,
    )
    expect(html).toContain('<b>مرحبًا</b>')
  })

  // BKL-06: التصدير رابط لا إطار — Word ولا Docs يشغّلان مشغّلًا
  it('كتلة الفيديو تخرج رابط مشاهدة لا إطارًا، والرابط المزيّف يسقط', () => {
    const html = guideToHtml(
      {
        ...base, id: 'k', title: 'ك',
        steps: [
          blk({ block: 'video', title: 'شرح الفوترة', url: 'https://youtu.be/dQw4w9WgXcQ' }),
          blk({ id: 'b2', block: 'video', title: 'مزيّف', url: 'https://evil.example.com/watch?v=dQw4w9WgXcQ' }),
        ],
      },
      url,
    )
    expect(html).toContain('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(html).toContain('شرح الفوترة')
    expect(html).not.toContain('<iframe')
    expect(html).not.toContain('evil.example.com')
    expect(html).not.toContain('مزيّف')
  })

  // BKL-07: التنبيه صار جملة منسّقة — والقديم بعنوان وملاحظة يبقى صالحًا
  it('التنبيه يخرج بجملته المنسّقة، والقديم بعنوانه وملاحظته', () => {
    const now = guideToHtml(
      { ...base, id: 'k', title: 'ك', steps: [blk({ block: 'tip', rich: [{ para: 'p', runs: [{ text: 'اطلب الصلاحية', b: true }] }] })] },
      url,
    )
    expect(now).toContain('<b>اطلب الصلاحية</b>')
    const legacy = guideToHtml(
      { ...base, id: 'k', title: 'ك', steps: [blk({ block: 'alert', title: 'انتبه', note: 'لا تحذف' })] },
      url,
    )
    expect(legacy).toContain('انتبه')
    expect(legacy).toContain('لا تحذف')
  })

  it('الفاصل يخرج <hr> والكتل غير المرقّمة لا تستهلك رقمًا', () => {
    const html = guideToHtml(
      { ...base, id: 'k', title: 'ك', steps: [blk({ block: 'divider' }), blk({ id: 'b2', title: 'خطوة حقيقية' })] },
      url,
    )
    expect(html).toContain('<hr')
    expect(html).toContain('1. خطوة حقيقية')
  })

  it('الدليل المضمّن يخرج بعنوانه لا خطواتٍ منسوخة ولا رقمًا', () => {
    const html = guideToHtml(
      { ...base, id: 'k', title: 'ك', steps: [blk({ block: 'embed', title: 'دليل الفوترة' })] },
      url,
    )
    expect(html).toContain('دليل الفوترة')
    // الترقيم يُرسم داخل عنوان الخطوة هكذا: <h2 …>1. العنوان</h2>
    expect(html).not.toMatch(/>1\.\s/)
  })

  it('بطاقة الرابط تخرج وصلة مهرَّبة، والرابط الخطر يسقط', () => {
    const ok = guideToHtml(
      { ...base, id: 'k', title: 'ك', steps: [blk({ block: 'link', title: 'الموقع', url: 'https://example.com' })] },
      url,
    )
    expect(ok).toContain('href="https://example.com"')
    const bad = guideToHtml(
      { ...base, id: 'k', title: 'ك', steps: [blk({ block: 'link', title: 'خطر', url: 'javascript:alert(1)' })] },
      url,
    )
    expect(bad).not.toContain('javascript:')
  })

  it('كتلة الصورة تخرج <img> بلا رقم', () => {
    const html = guideToHtml(
      { ...base, id: 'k', title: 'ك', steps: [blk({ block: 'image', alt: 'مخطط', screenshot: { fileId: 'f9', blurRects: [] } })] },
      url,
    )
    expect(html).toMatch(/<img[^>]+src="https:\/\/x\.test\/files\/f9"/)
    expect(html).not.toMatch(/>1\.\s/)
  })
})

describe('whatsappUrl — قناة التوزيع الفعلية (VIEW-07)', () => {
  it('نص + رابط في نص واحد عبر api.whatsapp.com (يُحوّل بثبات بلا رقم)', () => {
    const u = whatsappUrl('دليل: إصدار فاتورة', 'https://dalili.sa/s/abc')
    expect(u).toBe(
      `https://api.whatsapp.com/send?text=${encodeURIComponent('دليل: إصدار فاتورة\nhttps://dalili.sa/s/abc')}`,
    )
  })

  it('لا يستخدم صيغة wa.me/?text= بلا رقم (المعطوبة على سطح المكتب)', () => {
    expect(whatsappUrl('x', 'https://dalili.sa/s/y')).not.toContain('wa.me')
  })
})
