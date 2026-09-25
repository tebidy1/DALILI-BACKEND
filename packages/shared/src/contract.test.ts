import { describe, expect, it } from 'vitest'
import { zAppendSteps, zCreateAssignment, zCreateComment, zGuide, zGuideVersionDetails, zListVersions, zSearchQuery, zStep, zStepComment, zStepSource, zTranslateGuideRequest, zUpdateComment, zVersionSummary } from './contract'

/** ASG: عقد إنشاء الإسناد — عدة أهداف بأنواع محصورة، وقائمة غير فارغة */
describe('zCreateAssignment', () => {
  it('يقبل عدة أهداف بأنواع صحيحة', () => {
    const r = zCreateAssignment.safeParse({ targets: [{ kind: 'team', id: 't1' }, { kind: 'user', id: 'u2' }], note: 'اقرأه' })
    expect(r.success).toBe(true)
  })
  it('يرفض قائمة أهداف فارغة', () => {
    expect(zCreateAssignment.safeParse({ targets: [] }).success).toBe(false)
  })
  it('يرفض نوع هدف غير معروف', () => {
    expect(zCreateAssignment.safeParse({ targets: [{ kind: 'role', id: 'x' }] }).success).toBe(false)
  })
})

/** GM-05 (تطوّر): عقد تعليقات الدليل — نوعان (مشكلة/تعليق) بلا ربط خطوة، رد بعمق واحد */
describe('zCreateComment', () => {
  it('يقبل تبليغ مشكلة ويقشّ النص ويحفظ الاسم الاختياري', () => {
    const r = zCreateComment.safeParse({ kind: 'issue', body: '  الزر لا يظهر عندي  ', author: ' سعد ' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.kind).toBe('issue')
      expect(r.data.body).toBe('الزر لا يظهر عندي')
      expect(r.data.author).toBe('سعد')
    }
  })

  it('الاسم والأب اختياريان — تعليق عام بلا اسم صالح', () => {
    const r = zCreateComment.safeParse({ kind: 'note', body: 'شكرًا، واضح' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.parentId).toBeUndefined()
  })

  it('يرفض نوعًا مجهولًا أو غيابه — لا بد من مشكلة أو تعليق', () => {
    expect(zCreateComment.safeParse({ body: 'نص' }).success).toBe(false)
    expect(zCreateComment.safeParse({ kind: 'bug', body: 'نص' }).success).toBe(false)
  })

  it('يرفض نصًا فارغًا أو أطول من 2000 حرف واسمًا أطول من 40', () => {
    expect(zCreateComment.safeParse({ kind: 'note', body: '   ' }).success).toBe(false)
    expect(zCreateComment.safeParse({ kind: 'note', body: 'ط'.repeat(2001) }).success).toBe(false)
    expect(zCreateComment.safeParse({ kind: 'note', body: 'نص', author: 'ط'.repeat(41) }).success).toBe(false)
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
      stepId: '',
      kind: 'issue',
      parentId: null,
      author: 'سعد',
      isOwner: false,
      body: 'سؤال عن هذا الدليل',
      resolved: false,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    }
    const r = zStepComment.safeParse(full)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.parentId).toBeNull()
      expect(r.data.kind).toBe('issue')
      // تعليق على مستوى الدليل: stepId فارغ مقبول (سنتينل «بلا خطوة»)
      expect(r.data.stepId).toBe('')
    }
  })

  it('يرفض تعليقًا بلا نوع — النوع جزء من المعنى', () => {
    expect(zStepComment.safeParse({ id: 'c1', stepId: '', parentId: null, author: '', isOwner: false, body: 'نص', resolved: false, createdAt: '', updatedAt: '' }).success).toBe(false)
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

  it('يقبل مرشّحي UIA (automationId وcontrolType) لخطوات الديسكتوب ويرفض قيمتهما الفارغة', () => {
    const uia = [
      { k: 'automationId', v: 'btnSave' },
      { k: 'controlType', v: 'Button' },
    ]
    const r = zStep.safeParse({ ...base, target: { anchor: uia } })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.target?.anchor).toEqual(uia)
    expect(zStep.safeParse({ ...base, target: { anchor: [{ k: 'automationId', v: '' }] } }).success).toBe(false)
    expect(zStep.safeParse({ ...base, target: { anchor: [{ k: 'controlType', v: '' }] } }).success).toBe(false)
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

/** TRNS-01: ترجمة المحتوى — طبقة تراكب اختياريّة جمعيًّا على zGuide */
describe('zGuide translations', () => {
  const base = {
    id: 'g1',
    schemaVersion: 2,
    title: 'دليل',
    locale: 'ar',
    dir: 'rtl',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    steps: [{ id: 's1', kind: 'click', title: 'افتح', target: {}, sensitive: false, ts: 0, source: { kind: 'web', url: 'https://x.sa', pageTitle: 'الصفحة' } }],
  }
  const en = {
    title: 'Guide',
    items: { title: 'Guide', 'steps/s1/title': 'Open' },
    meta: { provider: 'groq:x', createdAt: '2026-01-02T00:00:00Z', sourceUpdatedAt: '2026-01-01T00:00:00Z' },
  }

  it('دليل قديم بلا ترجمة يبقى صالحًا', () => {
    expect(zGuide.safeParse(base).success).toBe(true)
  })

  it('مع translations يمرّ round-trip بحقوله', () => {
    const r = zGuide.safeParse({ ...base, updatedAt: '2026-01-02T00:00:00Z', translations: { en } })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.translations!.en!.items['steps/s1/title']).toBe('Open')
      expect(r.data.translations!.en!.meta.provider).toBe('groq:x')
    }
  })

  it('ترجمة بلا عنوان مرفوضة — العنوان أساس الطبقة', () => {
    const r = zGuide.safeParse({ ...base, translations: { en: { ...en, title: undefined } } })
    expect(r.success).toBe(false)
  })
})

/** TRNS-01: طلب الترجمة — الإنجليزية حصرًا اليوم (إضافة لغة = توسيع القيد) */
describe('zTranslateGuideRequest', () => {
  it('يقبل en ويرفض غيره', () => {
    expect(zTranslateGuideRequest.safeParse({ locale: 'en' }).success).toBe(true)
    expect(zTranslateGuideRequest.safeParse({ locale: 'ar' }).success).toBe(false)
    expect(zTranslateGuideRequest.safeParse({}).success).toBe(false)
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


/** BKL-01: عقد الكرّاسة — إضافات جمعية بالكامل، schemaVersion يبقى ١ */
describe('عقد الكرّاسة', () => {
  const baseStep = {
    id: 's1',
    kind: 'click',
    title: 'ع',
    target: {},
    sensitive: false,
    url: '',
    pageTitle: '',
    ts: 1,
  }
  const baseGuide = {
    id: 'g1',
    schemaVersion: 1,
    title: 'دليل',
    locale: 'ar',
    dir: 'rtl',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    steps: [],
  }

  it('دليل قديم بلا kind يبقى صالحًا — حارس التوسيع الجمعي', () => {
    const r = zGuide.safeParse(baseGuide)
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.kind).toBeUndefined()
  })

  it('يقبل kind=booklet وكتل الكرّاسة الجديدة', () => {
    const r = zGuide.safeParse({
      ...baseGuide,
      kind: 'booklet',
      steps: [
        { ...baseStep, id: 't', block: 'text', rich: [{ para: 'p', runs: [{ text: 'ن', b: true }] }] },
        { ...baseStep, id: 'e', block: 'embed', embed: { guideId: 'g2', expanded: false } },
        { ...baseStep, id: 'd', block: 'divider' },
        { ...baseStep, id: 'i', block: 'image' },
        { ...baseStep, id: 'l', block: 'link' },
      ],
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.kind).toBe('booklet')
      expect(r.data.steps[1]?.embed?.guideId).toBe('g2')
    }
  })

  it('يرفض نوع مستند مجهولًا ونوع كتلة مجهولًا', () => {
    expect(zGuide.safeParse({ ...baseGuide, kind: 'page' }).success).toBe(false)
    expect(zStep.safeParse({ ...baseStep, block: 'audio' }).success).toBe(false)
  })

  // BKL-06: الفيديو نوع كتلة معتمد منذ 2026-09-07 — توسيع جمعي بلا رفع schemaVersion
  it('يقبل كتلة الفيديو ورابطها في الحقل القائم', () => {
    const r = zStep.safeParse({ ...baseStep, block: 'video', url: 'https://youtu.be/dQw4w9WgXcQ' })
    expect(r.success).toBe(true)
  })

  it('يرفض رابطًا غير صالح داخل قطعة نص — لا href مشوّه يصل العارض', () => {
    expect(
      zStep.safeParse({ ...baseStep, block: 'text', rich: [{ para: 'p', runs: [{ text: 'x', href: 'ليس رابطًا' }] }] })
        .success,
    ).toBe(false)
  })

  it('يرفض نوع فقرة مجهولًا ويقبل الخمسة المعروفة', () => {
    expect(zStep.safeParse({ ...baseStep, block: 'text', rich: [{ para: 'blockquote', runs: [] }] }).success).toBe(false)
    for (const para of ['p', 'h2', 'h3', 'ul', 'ol']) {
      expect(zStep.safeParse({ ...baseStep, block: 'text', rich: [{ para, runs: [{ text: 'ن' }] }] }).success).toBe(true)
    }
  })

  it('يرفض تضمينًا بمعرّف فارغ أو بلا expanded', () => {
    expect(zStep.safeParse({ ...baseStep, block: 'embed', embed: { guideId: '', expanded: false } }).success).toBe(false)
    expect(zStep.safeParse({ ...baseStep, block: 'embed', embed: { guideId: 'g2' } }).success).toBe(false)
  })
})

/** VER-01: عقد ملخّص الإصدار — بلا data (JSON قد يكون كبيرًا) */
describe('zVersionSummary', () => {
  const good = { id: 'abc123def456', createdAt: new Date().toISOString(), authorId: 'u1', stepCount: 3, title: 'T' }
  it('يقبل صفًّا سليمًا', () => {
    expect(zVersionSummary.parse(good)).toEqual(good)
  })
  it('يرفض stepCount سالبًا', () => {
    expect(zVersionSummary.safeParse({ ...good, stepCount: -1 }).success).toBe(false)
  })
  it('يرفض id فارغًا', () => {
    expect(zVersionSummary.safeParse({ ...good, id: '' }).success).toBe(false)
  })
  it('zListVersions.items مصفوفة ملخّصات', () => {
    expect(zListVersions.parse({ items: [good, good] }).items.length).toBe(2)
  })
})

/** VER-01: تفاصيل نسخة كاملة — الشكل الذي يفهمه العارض */
describe('zGuideVersionDetails', () => {
  it('guide يمر تحت zGuide', () => {
    const g = {
      id: 'g1', schemaVersion: 1 as const, title: 't', locale: 'ar' as const, dir: 'rtl' as const,
      createdAt: 'x', updatedAt: 'y', steps: [],
    }
    const details = { id: 'v1', guideId: 'g1', createdAt: 'z', authorId: 'u1', guide: g }
    expect(zGuideVersionDetails.parse(details).guide.id).toBe('g1')
  })
})

/** DTOP-01: مصدر الخطوة — ويب/ديسكتوب/كاميرا، وجمعيّة الأدلة القديمة */
describe('DTOP-01: مصدر الخطوة', () => {
  const base = { id: 's1', kind: 'click', title: 'ت', target: {}, sensitive: false, ts: 1 }
  it('خطوة ديسكتوب وكاميرا صالحة بلا url/pageTitle', () => {
    expect(zStep.safeParse({ ...base, source: { kind: 'desktop', processName: 'EXCEL.EXE', windowTitle: 'دفتر1', appId: 'app:EXCEL.EXE' } }).success).toBe(true)
    expect(zStep.safeParse({ ...base, source: { kind: 'camera' } }).success).toBe(true)
  })
  it('بلا رابطين وبلا مصدر تُرفض — ورابط بلا عنوان كذلك', () => {
    expect(zStep.safeParse(base).success).toBe(false)
    expect(zStep.safeParse({ ...base, url: 'https://x.example' }).success).toBe(false)
  })
  it('v1 (الرابطان ولو فارغين) تبقى صالحة — جمعيّة بلا ترحيل', () => {
    expect(zStep.safeParse({ ...base, url: '', pageTitle: '' }).success).toBe(true)
  })
  it('source بمصدر غير معروف يُرفض', () => {
    expect(zStepSource.safeParse({ kind: 'ftp' }).success).toBe(false)
    expect(zStep.safeParse({ ...base, source: { kind: 'ftp' } }).success).toBe(false)
  })
  it('ديسكتوب بـieMode ورابط اختياري يمرّ', () => {
    expect(zStep.safeParse({
      ...base,
      source: { kind: 'desktop', processName: 'msedge.exe', windowTitle: 'بوابة', appId: 'app:msedge.exe', ieMode: true, url: 'https://gov.example' },
    }).success).toBe(true)
  })
  it('zGuide يقبل schemaVersion ‏١ و٢ ويرفض ٣', () => {
    const g = { id: 'g1', title: 't', locale: 'ar', dir: 'rtl', createdAt: 'x', updatedAt: 'y', steps: [] }
    expect(zGuide.safeParse({ ...g, schemaVersion: 1 }).success).toBe(true)
    expect(zGuide.safeParse({ ...g, schemaVersion: 2 }).success).toBe(true)
    expect(zGuide.safeParse({ ...g, schemaVersion: 3 }).success).toBe(false)
  })
})
