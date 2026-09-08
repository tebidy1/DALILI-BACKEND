import { describe, expect, it } from 'vitest'
import { richToHtml, richToPlain, type RichText } from './rich-text'

const sample: RichText = [
  { para: 'h2', runs: [{ text: 'المقدمة' }] },
  { para: 'p', runs: [{ text: 'افتح ' }, { text: 'النظام', b: true }, { text: ' أولًا' }] },
  { para: 'ul', runs: [{ text: 'بند أول' }, { text: 'بند ثانٍ' }] },
]

describe('richToPlain — نص الفهرسة والبحث', () => {
  it('يجمع نص كل القطع بفواصل مسافة صالحة للفهرس', () => {
    expect(richToPlain(sample)).toBe('المقدمة افتح النظام أولًا بند أول بند ثانٍ')
  })

  it('نص فارغ يعطي سلسلة فارغة لا "undefined"', () => {
    expect(richToPlain([])).toBe('')
  })
})

describe('richToHtml — العرض والطباعة والنسخ الغني', () => {
  it('يحوّل الفقرات والعناوين والقوائم بعلاماتها', () => {
    const html = richToHtml(sample)
    expect(html).toContain('<h2>المقدمة</h2>')
    expect(html).toContain('<b>النظام</b>')
    expect(html).toContain('<ul><li>بند أول</li><li>بند ثانٍ</li></ul>')
  })

  // حارس الأمان الأول: الكرّاسة تُشارَك برابط عام يفتحه ضيف بلا حساب
  it('يهرّب HTML في النص فلا يصير وسمًا', () => {
    const evil: RichText = [{ para: 'p', runs: [{ text: '<img src=x onerror=alert(1)>' }] }]
    const html = richToHtml(evil)
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })

  it('يرفض روابط javascript: ويبقي النص ظاهرًا بلا رابط', () => {
    const evil: RichText = [{ para: 'p', runs: [{ text: 'اضغط', href: 'javascript:alert(1)' }] }]
    const html = richToHtml(evil)
    expect(html).not.toContain('javascript:')
    expect(html).toContain('اضغط')
    expect(html).not.toContain('<a ')
  })

  it('يرفض روابط data: كذلك', () => {
    const evil: RichText = [{ para: 'p', runs: [{ text: 'حمّل', href: 'data:text/html,<script>x</script>' }] }]
    expect(richToHtml(evil)).not.toContain('<a ')
  })

  it('يقبل http و https ويضيف rel آمنًا', () => {
    const ok: RichText = [{ para: 'p', runs: [{ text: 'الموقع', href: 'https://example.com' }] }]
    expect(richToHtml(ok)).toContain(
      '<a href="https://example.com/" rel="noopener noreferrer nofollow" target="_blank">الموقع</a>',
    )
  })
})
