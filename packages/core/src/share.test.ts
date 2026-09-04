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
