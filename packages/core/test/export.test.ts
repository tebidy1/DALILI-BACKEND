import { describe, expect, it } from 'vitest'
import { toMarkdown, toPrintableHtml } from '../src/export'
import { assembleGuide } from '../src/assemble'

const guide = assembleGuide(
  [
    {
      kind: 'navigate',
      target: {},
      url: 'https://erp.example/invoices',
      pageTitle: 'الفواتير',
      ts: 1,
    },
    {
      kind: 'click',
      target: { text: 'إنشاء فاتورة' },
      url: 'https://erp.example/invoices',
      pageTitle: 'الفواتير',
      ts: 2,
      screenshot: { fileId: 'f1', blurRects: [] },
    },
    {
      kind: 'click',
      target: { label: 'زر أيقوني' },
      url: 'https://erp.example/invoices',
      pageTitle: 'الفواتير',
      ts: 3,
      screenshot: { missing: true, reason: 'صفحة غير قابلة للالتقاط' },
    },
  ],
  1700000000000,
)

describe('التصدير', () => {
  it('Markdown: بنية العنوان والخطوات والصور والفجوات الصادقة', () => {
    const urlFor = (s: (typeof guide.steps)[number]) => {
      const shot = s.screenshot
      return shot && !('missing' in shot) ? `http://x/files/${shot.fileId}` : ''
    }
    const md = toMarkdown(guide, urlFor)
    expect(md).toContain('# دليل: الفواتير')
    expect(md).toContain('## خطوة 1: انتقل إلى صفحة «الفواتير»')
    expect(md).toContain('## خطوة 2: انقر على «إنشاء فاتورة»')
    expect(md).toContain('![انقر على «إنشاء فاتورة»](http://x/files/f1)')
    expect(md).toContain('> صفحة غير قابلة للالتقاط')
    expect(md).toContain('https://erp.example/invoices')
  })

  it('BLK-01: الكتل تُرسم دون رقم خطوة، والخطوات مرقّمة بالتصفية', () => {
    const g: any = {
      title: 'د',
      steps: [
        { id: '1', kind: 'click', title: 'أولى', target: {}, sensitive: false, url: 'https://a', pageTitle: 'ص', ts: 1 },
        { id: '2', kind: 'navigate', title: 'تنبيه', note: 'انتبه', target: {}, sensitive: false, url: '', pageTitle: '', ts: 2, block: 'tip' },
        { id: '3', kind: 'navigate', title: 'ثانية', target: {}, sensitive: false, url: '', pageTitle: '', ts: 3 },
        { id: '4', kind: 'navigate', title: 'قسم', target: {}, sensitive: false, url: '', pageTitle: '', ts: 4, block: 'header' },
      ],
    }
    const md = toMarkdown(g)
    expect(md).toContain('## خطوة 1: أولى')
    expect(md).toContain('## خطوة 2: ثانية') // الترقيم تخطّى التنبيه
    expect(md).not.toContain('خطوة 2: تنبيه')
    expect(md).toContain('> **تنبيه:** انتبه') // بلوك اقتباس
    expect(md).toContain('## قسم') // هيدر بلا «خطوة N»
    expect(md).not.toContain('الصفحة:  — ') // لا سطر مصدر للخطوة اليدوية (url فارغ)
  })

  it('HTML قابل للطباعة: RTL وهيكلة الخطوات', () => {
    const html = toPrintableHtml(guide, (s) => {
      const shot = s.screenshot
      return shot && !('missing' in shot) ? `http://x/files/${shot.fileId}` : ''
    })
    expect(html).toContain('dir="rtl"')
    expect(html).toContain('<h2>خطوة 3:')
    expect(html).toContain('class="missing"')
    expect(html).not.toContain('<script')
  })

  // EDT-05 إكمال (2026-09-04): النص المكتوب على اللقطة يدخل التصدير بصدق
  it('EDT-05: النص المكتوب على اللقطة يظهر في Markdown وHTML مهربًا', () => {
    const g = assembleGuide(
      [
        {
          kind: 'click',
          target: { text: 'حفظ' },
          url: 'https://erp.example/f',
          pageTitle: 'الفواتير',
          ts: 4,
          screenshot: {
            fileId: 'f9',
            blurRects: [],
            annotations: [
              { id: 'a1', type: 'text', color: '#2b2a26', text: 'انقر هنا <أولًا>', rect: { x: 10, y: 10, w: 0, h: 0 } },
              { id: 'a2', type: 'draw', color: '#e11d48', path: [{ x: 1, y: 1 }, { x: 2, y: 2 }] },
            ],
          },
        },
      ],
      1700000000000,
    )
    const md = toMarkdown(g)
    expect(md).toContain('انقر هنا <أولًا>')
    const html = toPrintableHtml(g)
    expect(html).toContain('انقر هنا &lt;أولًا&gt;') // مهرَّب — لا حقن
  })
})
