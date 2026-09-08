import { describe, expect, it } from 'vitest'
import { extractCapturedSites, primarySiteOf } from './sites'

describe('primarySiteOf — الكرّاسة بلا موقع', () => {
  // BKL-01: كتل الكرّاسة بروابط فارغة ⇒ موقع فارغ صادق بلا تخمين.
  // هذا يجعل استبعاد الكرّاسة من اكتشاف الشاشة سلوكًا طبيعيًا لا استثناءً.
  it('كتل بروابط فارغة تعطي موقعًا فارغًا', () => {
    expect(primarySiteOf([{ url: '' }, { url: '' }])).toBe('')
  })
})

describe('extractCapturedSites — استخراج شارات المواقع والتطبيقات', () => {
  it('يستخرج المواقع الفريدة من خطوات الدليل مع أسماء منسقة وحروف بادئة وألوان متناسقة', () => {
    const steps = [
      { url: 'https://claude.ai/chat/12345', pageTitle: 'Claude' },
      { url: 'https://mail.google.com/mail/u/0/#inbox', pageTitle: 'Gmail' },
      { url: 'https://claude.ai/chat/67890', pageTitle: 'Claude New' },
      { url: 'http://localhost:5174/g/xj-p469fZ16E', pageTitle: 'دليلي' },
      { url: 'https://github.com/dalili/core', pageTitle: 'GitHub' },
    ]

    const sites = extractCapturedSites(steps)
    expect(sites).toHaveLength(4)
    expect(sites.map((s) => s.name)).toEqual(['Claude', 'Gmail', 'Localhost', 'GitHub'])
    expect(sites[0]).toMatchObject({
      host: 'claude.ai',
      name: 'Claude',
      initial: 'C',
    })
    expect(sites[1]).toMatchObject({
      host: 'mail.google.com',
      name: 'Gmail',
      initial: 'G',
    })
  })

  it('يتعامل بسلاسة مع الروابط غير الصالحة أو الخطوات الفارغة دون انهيار', () => {
    const steps = [
      { url: '', pageTitle: 'خطوة يدوية' },
      { url: undefined, pageTitle: 'هيدر' },
      { url: 'not-a-valid-url', pageTitle: 'فاسد' },
    ]
    expect(extractCapturedSites(steps)).toEqual([])
  })

  it('يتجاهل التكرارات ويحافظ على ترتيب أول ظهور', () => {
    const steps = [
      { url: 'https://scribehow.com/shared/123', pageTitle: 'Scribe' },
      { url: 'https://scribehow.com/shared/456', pageTitle: 'Scribe 2' },
    ]
    const sites = extractCapturedSites(steps)
    expect(sites).toHaveLength(1)
    expect(sites[0]?.name).toBe('Scribe')
  })
})

describe('primarySiteOf — موقع الدليل الأساسي (WS-05)', () => {
  it('يعيد مضيف أول خطوة لها رابط صالح، بأحرف صغيرة ودون www', () => {
    expect(primarySiteOf([{ url: 'https://www.SAP.example/fi_01' }, { url: 'https://mail.google.com/x' }])).toBe(
      'sap.example',
    )
    expect(primarySiteOf([{ url: 'https://mail.google.com/x' }, { url: 'https://sap.example/y' }])).toBe(
      'mail.google.com',
    )
  })

  it('يتخطى الخطوات بلا رابط أو برابط تالف ويصل للصالح بعدها', () => {
    expect(primarySiteOf([{}, { url: 'ليس رابطًا' }, { url: 'https://erp.example/invoices' }])).toBe('erp.example')
  })

  it('يقبل المضيف المجرد (localhost) ويعيد سلسلة فارغة حين لا رابط صالح إطلاقًا', () => {
    expect(primarySiteOf([{ url: 'localhost:5174/g/x' }])).toBe('localhost')
    expect(primarySiteOf([{}, { url: 'not-a-url' }])).toBe('')
    expect(primarySiteOf([])).toBe('')
  })
})
