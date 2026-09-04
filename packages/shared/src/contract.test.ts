import { describe, expect, it } from 'vitest'
import { zAppendSteps, zCreateComment, zGuide, zSearchQuery, zStep, zStepComment, zUpdateComment } from './contract'

/** GM-05: عقد تعليقات الخطوات — إنشاء ضيف/مالك، رد بعمق واحد، وتحديث مالك */
describe('zCreateComment', () => {
  it('يقبل تعليقًا بسيطًا على خطوة ويقشّ النص ويحفظ الاسم الاختياري', () => {
    const r = zCreateComment.safeParse({ stepId: 's1', body: '  الزر لا يظهر عندي  ', author: ' سعد ' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.body).toBe('الزر لا يظهر عندي')
      expect(r.data.author).toBe('سعد')
    }
  })

  it('الاسم والأب اختياريان — زائر بلا اسم تعليق صالح', () => {
    const r = zCreateComment.safeParse({ stepId: 's1', body: 'شكرًا، واضح' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.parentId).toBeUndefined()
  })

  it('يرفض نصًا فارغًا أو أطول من 2000 حرف واسمًا أطول من 40', () => {
    expect(zCreateComment.safeParse({ stepId: 's1', body: '   ' }).success).toBe(false)
    expect(zCreateComment.safeParse({ stepId: 's1', body: 'ط'.repeat(2001) }).success).toBe(false)
    expect(zCreateComment.safeParse({ stepId: 's1', body: 'نص', author: 'ط'.repeat(41) }).success).toBe(false)
  })
})

describe('zUpdateComment', () => {
  it('يقبل تعديل النص أو الوسم كمحلول كلًّا وحده', () => {
    expect(zUpdateComment.safeParse({ body: 'نص معدّل' }).success).toBe(true)
    expect(zUpdateComment.safeParse({ resolved: true }).success).toBe(true)
  })

  it('يرفض طلب تحديث بلا أي تغيير — لا PATCH فارغ', () => {
    expect(zUpdateComment.safeParse({}).success).toBe(false)
  })
})

describe('zStepComment', () => {
  it('يفك تعليقًا كاملًا كما يرده الخادم', () => {
    const full = {
      id: 'c1',
      stepId: 's1',
      parentId: null,
      author: 'سعد',
      isOwner: false,
      body: 'سؤال عن هذه الخطوة',
      resolved: false,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    }
    const r = zStepComment.safeParse(full)
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.parentId).toBeNull()
  })

  it('يرفض تعليقًا بلا معرّف خطوة', () => {
    expect(zStepComment.safeParse({ id: 'c1', parentId: null, author: '', isOwner: false, body: 'نص', resolved: false, createdAt: '', updatedAt: '' }).success).toBe(false)
  })
})

/** CAP-17: عقد إضافة خطوات لدليل قائم */
describe('zAppendSteps', () => {
  it('يقبل خطوات صالحة مع موضع إدراج اختياري', () => {
    const step = {
      id: 's1',
      kind: 'click',
      title: 'خطوة',
      target: {},
      sensitive: false,
      url: 'https://x.test',
      pageTitle: 'ص',
      ts: 1,
    }
    const r = zAppendSteps.safeParse({ steps: [step], insertAt: 2 })
    expect(r.success).toBe(true)
  })

  it('يرفض مصفوفة فارغة — لا طلب إضافة بلا خطوات', () => {
    expect(zAppendSteps.safeParse({ steps: [] }).success).toBe(false)
  })

  it('insertAt لا يقبل سالبًا', () => {
    const r = zAppendSteps.safeParse({ steps: [], insertAt: -1 })
    expect(r.success).toBe(false)
  })
})

/** EDT-13: alt حقل اختياري محدود الطول على الخطوة */
describe('zStep alt', () => {
  const base = {
    id: 's1',
    kind: 'click',
    title: 'خطوة',
    target: {},
    sensitive: false,
    url: 'https://x.test',
    pageTitle: 'ص',
    ts: 1,
  }
  it('يقبل alt قصيرًا ويرفض الطويل جدًا', () => {
    expect(zStep.safeParse({ ...base, alt: 'وصف' }).success).toBe(true)
    expect(zStep.safeParse({ ...base, alt: 'x'.repeat(301) }).success).toBe(false)
  })
})

/** AUTO-01: بطاقة تعريف العنصر (سلسلة المرشحين) داخل step.target — تحلّها «دربني» */
describe('zStep target.anchor', () => {
  const base = {
    id: 's1',
    kind: 'click',
    title: 'خطوة',
    sensitive: false,
    url: 'https://x.test',
    pageTitle: 'ص',
    ts: 1,
  }
  const anchor = [
    { k: 'id', v: 'save-btn' },
    { k: 'text', v: 'حفظ التغييرات' },
    { k: 'path', v: 'body > button:nth-of-type(2)' },
  ]

  it('يقبل سلسلة مرشحين صالحة ويعيدها كما هي', () => {
    const r = zStep.safeParse({ ...base, target: { anchor } })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.target?.anchor).toEqual(anchor)
  })

  it('الخطوة بلا مرساة تبقى صالحة — كل الأدلة القائمة كذلك', () => {
    expect(zStep.safeParse({ ...base, target: {} }).success).toBe(true)
  })

  it('يرفض نوع مرشح مجهولًا أو قيمة فارغة — السلسلة كلها تسقط لا تُهمل بصمت', () => {
    expect(zStep.safeParse({ ...base, target: { anchor: [{ k: 'hack', v: 'x' }] } }).success).toBe(false)
    expect(zStep.safeParse({ ...base, target: { anchor: [{ k: 'id', v: '' }] } }).success).toBe(false)
  })
})

/** ANNO-01: شروحات اللقطة (المرحلة ٢) — أشكال وأسهم وأرقام تمرّ عبر عقد اللقطة */
describe('zStep screenshot.annotations', () => {
  const base = {
    id: 's1',
    kind: 'click',
    title: 'خطوة',
    target: {},
    sensitive: false,
    url: 'https://x.test',
    pageTitle: 'ص',
    ts: 1,
  }
  const shot = { fileId: 'f1', blurRects: [] as unknown[] }

  it('يقبل شكلًا مؤطّرًا وسهمًا ورقمًا ويعيدها كما هي', () => {
    const annotations = [
      { id: 'a1', type: 'rect', color: '#e11d48', rect: { x: 10, y: 20, w: 100, h: 40 } },
      { id: 'a2', type: 'curved-arrow', color: '#2563eb', from: { x: 5, y: 5 }, to: { x: 90, y: 80 } },
      { id: 'a3', type: 'number', color: '#2b2a26', rect: { x: 50, y: 50, w: 0, h: 0 }, n: 1 },
    ]
    const r = zStep.safeParse({ ...base, screenshot: { ...shot, annotations } })
    expect(r.success).toBe(true)
    if (r.success && r.data.screenshot && !('missing' in r.data.screenshot)) {
      expect(r.data.screenshot.annotations).toEqual(annotations)
    }
  })

  it('اللقطة بلا شروحات تبقى صالحة — توافق جمعي مع كل الأدلة القائمة', () => {
    const r = zStep.safeParse({ ...base, screenshot: shot })
    expect(r.success).toBe(true)
  })

  it('يرفض نوع شرح مجهولًا أو لونًا فارغًا', () => {
    expect(
      zStep.safeParse({ ...base, screenshot: { ...shot, annotations: [{ id: 'a', type: 'star', color: '#000' }] } }).success,
    ).toBe(false)
    expect(
      zStep.safeParse({ ...base, screenshot: { ...shot, annotations: [{ id: 'a', type: 'rect', color: '' }] } }).success,
    ).toBe(false)
  })
})

/** ANNO-02: إطار الهدف في العقد — لون من لوحة الحبر فقط، والغياب مسموح (أدلة قديمة) */
describe('zStep screenshot.mark', () => {
  const base = {
    id: 's1',
    kind: 'click',
    title: 'خطوة',
    target: {},
    sensitive: false,
    url: 'https://x.test',
    pageTitle: 'ص',
    ts: 1,
  }
  const shot = { fileId: 'f1', blurRects: [] as unknown[] }

  it('يقبل إطار هدف بلون من اللوحة ويعيده كما هو', () => {
    const mark = { rect: { x: 10, y: 20, w: 80, h: 30 }, color: '#2563eb' }
    const r = zStep.safeParse({ ...base, screenshot: { ...shot, mark } })
    expect(r.success).toBe(true)
    if (r.success && r.data.screenshot && !('missing' in r.data.screenshot)) {
      expect(r.data.screenshot.mark).toEqual(mark)
    }
  })

  it('اللقطة بلا إطار تبقى صالحة — كل الأدلة الملتقطة قبل اليوم كذلك', () => {
    expect(zStep.safeParse({ ...base, screenshot: shot }).success).toBe(true)
  })

  it('يرفض لونًا خارج لوحة الحبر — لا لون حرّ يدخل قاعدة البيانات', () => {
    const bad = { rect: { x: 1, y: 1, w: 2, h: 2 }, color: '#00ff00' }
    expect(zStep.safeParse({ ...base, screenshot: { ...shot, mark: bad } }).success).toBe(false)
  })

  it('يقبل شكل الإطار (بيضاوي) ويعيده كما هو', () => {
    const mark = { rect: { x: 10, y: 20, w: 80, h: 30 }, color: '#2563eb', shape: 'ellipse' }
    const r = zStep.safeParse({ ...base, screenshot: { ...shot, mark } })
    expect(r.success).toBe(true)
    if (r.success && r.data.screenshot && !('missing' in r.data.screenshot)) {
      expect(r.data.screenshot.mark?.shape).toBe('ellipse')
    }
  })

  it('إطار بلا شكل يبقى صالحًا — الغياب يعني مستطيلًا (كل الأدلة القديمة)', () => {
    const mark = { rect: { x: 10, y: 20, w: 80, h: 30 }, color: '#2563eb' }
    const r = zStep.safeParse({ ...base, screenshot: { ...shot, mark } })
    expect(r.success).toBe(true)
    if (r.success && r.data.screenshot && !('missing' in r.data.screenshot)) {
      expect(r.data.screenshot.mark?.shape).toBeUndefined()
    }
  })

  it('يرفض شكلًا مجهولًا — لا شكل حرّ يدخل قاعدة البيانات', () => {
    const bad = { rect: { x: 1, y: 1, w: 2, h: 2 }, color: '#ea580c', shape: 'triangle' }
    expect(zStep.safeParse({ ...base, screenshot: { ...shot, mark: bad } }).success).toBe(false)
  })
})

/** SRCH-02: مرشحات المجلد والنطاق في استعلام البحث */
describe('zSearchQuery filters', () => {
  it('يقبل folder وsite كمرشحات اختيارية', () => {
    const r = zSearchQuery.safeParse({ q: 'فاتورة', folder: 'f1', site: 'erp.example.com' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.folder).toBe('f1')
      expect(r.data.site).toBe('erp.example.com')
    }
  })
})

/** VOX-01..03: صوت الدليل — حقل جمعي اختياري على zGuide */
describe('zGuide audio', () => {
  const base = {
    id: 'g1',
    schemaVersion: 1,
    title: 'دليل',
    locale: 'ar',
    dir: 'rtl',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    steps: [],
  }
  const audio = { fileId: 'f1', durationMs: 61_000, startedAt: 1_700_000_000_000 }

  it('يقبل دليلًا بصوت ويعيد حقوله كما هي', () => {
    const r = zGuide.safeParse({ ...base, audio })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.audio).toEqual(audio)
  })

  it('الدليل بلا صوت يبقى صالحًا — توافق جمعي مع كل الأدلة القائمة', () => {
    expect(zGuide.safeParse(base).success).toBe(true)
  })

  it('يرفض صوتًا بمدة سالبة أو بلا معرّف ملف', () => {
    expect(zGuide.safeParse({ ...base, audio: { ...audio, durationMs: -1 } }).success).toBe(false)
    expect(zGuide.safeParse({ ...base, audio: { ...audio, fileId: '' } }).success).toBe(false)
  })
})

/** حقل وصف الدليل الاختياري */
describe('zGuide description', () => {
  const base = {
    id: 'g1',
    schemaVersion: 1,
    title: 'دليل',
    locale: 'ar',
    dir: 'rtl',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    steps: [],
  }

  it('يقبل zGuide حقل description اختياريًا ويحافظ على صلاحية الأدلة القديمة بدونه', () => {
    expect(zGuide.safeParse(base).success).toBe(true)

    const withDesc = {
      ...base,
      description: 'هذا وصف مفصل للدليل يوضح خطوات العمل بالتفصيل.',
    }
    const res = zGuide.safeParse(withDesc)
    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.data.description).toBe('هذا وصف مفصل للدليل يوضح خطوات العمل بالتفصيل.')
    }
  })

  it('يرفض وصفًا يتجاوز 2000 حرف', () => {
    expect(zGuide.safeParse({ ...base, description: 'أ'.repeat(2001) }).success).toBe(false)
  })
})

