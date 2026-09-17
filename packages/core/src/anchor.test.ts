import { describe, expect, it } from 'vitest'
import {
  anchorNormText,
  anchorToSelector,
  buildAnchorChain,
  cssAnchorFinder,
  isEphemeralId,
  resolveAnchor,
  TEXT_ANCHOR_SEL,
  type AnchorChain,
  type AnchorDom,
} from './anchor'

/** DOM زائف للفحص: خريطة محدِّد → عناصر، ودالة نص لكل عنصر — عبر محوّل CSS نفسه الذي يستعمله الامتداد */
function fakeDom(bySel: Record<string, string[]>, texts: Record<string, string> = {}): AnchorDom<string> {
  return cssAnchorFinder(
    (sel) => bySel[sel] ?? [],
    (el) => texts[el] ?? el,
  )
}

describe('buildAnchorChain — بطاقة تعريف الزر (AUTO-01)', () => {
  it('يبني السلسلة بترتيب الأولوية الملزم: id ثم testid ثم aria ثم name ثم نص ثم مسار', () => {
    const chain = buildAnchorChain({
      tag: 'button',
      id: 'save-btn',
      testid: 'submit',
      ariaLabel: 'حفظ',
      name: 'action',
      text: 'حفظ التغييرات',
      path: 'body > div:nth-of-type(2) > button:nth-of-type(1)',
    })
    expect(chain.map((c) => c.k)).toEqual(['id', 'testid', 'aria', 'name', 'text', 'path'])
    expect(chain[0]).toEqual({ k: 'id', v: 'save-btn' })
    expect(chain[4]).toEqual({ k: 'text', v: 'حفظ التغييرات' })
  })

  it('يتخطى الحقول الفارغة والمسافات فقط — لا مرشح بلا قيمة', () => {
    const chain = buildAnchorChain({ tag: 'div', id: '  ', ariaLabel: '', path: 'body > div:nth-of-type(3)' })
    expect(chain).toEqual([{ k: 'path', v: 'body > div:nth-of-type(3)' }])
  })

  it('يطبّع النص: يدمج المسافات ويقص عند ٨٠ حرفًا بعلامة قطع', () => {
    const long = 'كلمة '.repeat(30)
    const chain = buildAnchorChain({ tag: 'a', text: `  ${long} ` })
    expect(chain).toHaveLength(1)
    expect(chain[0]!.v.length).toBe(80)
    expect(chain[0]!.v.endsWith('…')).toBe(true)
  })

  it('نص أقصر من حرفين لا يصلح مرساة (أيقونات وحروف يتيمة كثيرة التكرار)', () => {
    expect(buildAnchorChain({ tag: 'span', text: ' × ' })).toEqual([])
  })

  it('بلا path ولا أي صفة = سلسلة فارغة (خطوات navigate مثلًا لا مرساة لها)', () => {
    expect(buildAnchorChain({ tag: 'html' })).toEqual([])
  })
})

describe('isEphemeralId — معرّفات أطر العمل المتطايرة (علة الزر الخاطئ في التدريب)', () => {
  it('يكشف معرّفات React useForId وBase UI المتولّدة (تتغيّر كل تحميل فتطابق عنصرًا آخر)', () => {
    // من دليل حقيقي: React useId وBase UI — سبب «نُفّذت الخطوة على زر خاطئ»
    expect(isEphemeralId('_r_6_')).toBe(true)
    expect(isEphemeralId('_r_u0_')).toBe(true)
    expect(isEphemeralId('_r_rr_')).toBe(true)
    expect(isEphemeralId('base-ui-_r_pu_')).toBe(true)
    expect(isEphemeralId('base-ui-_r_sr_')).toBe(true)
    expect(isEphemeralId(':r0:')).toBe(true) // شكل React الخام
    expect(isEphemeralId('radix-:r3:')).toBe(true)
    expect(isEphemeralId('radix-42')).toBe(true)
    expect(isEphemeralId('headlessui-menu-button-7')).toBe(true)
    expect(isEphemeralId('mui-1423')).toBe(true)
  })

  it('يقبل المعرّفات الدلالية المستقرّة — لا يُسقط زرًا حقيقيًا', () => {
    expect(isEphemeralId('save-btn')).toBe(false)
    expect(isEphemeralId('frame-peek-portal')).toBe(false)
    expect(isEphemeralId('user_profile_menu')).toBe(false)
    expect(isEphemeralId('email')).toBe(false)
    expect(isEphemeralId('')).toBe(false)
  })
})

describe('buildAnchorChain — يُسقط المعرّف المتطاير فيسقط لبديلٍ مستقرّ', () => {
  it('معرّف React المتطاير لا يُلتقط id — يبقى النص والمسار مرساةً صادقة', () => {
    const chain = buildAnchorChain({
      tag: 'button',
      id: '_r_6_',
      text: 'فعّل cowork',
      path: 'body > div:nth-of-type(2) > button:nth-of-type(1)',
    })
    expect(chain.some((c) => c.k === 'id')).toBe(false) // لا معرّف متطاير
    expect(chain.map((c) => c.k)).toEqual(['text', 'path'])
  })
})

describe('anchorToSelector', () => {
  it('مرشحو الصفات يصيرون محدّدات سمات آمنة، والمسار يمر كما هو', () => {
    expect(anchorToSelector({ k: 'id', v: 'save' })).toBe('[id="save"]')
    expect(anchorToSelector({ k: 'testid', v: 'submit' })).toBe('[data-testid="submit"]')
    expect(anchorToSelector({ k: 'aria', v: 'حفظ' })).toBe('[aria-label="حفظ"]')
    expect(anchorToSelector({ k: 'name', v: 'action' })).toBe('[name="action"]')
    expect(anchorToSelector({ k: 'path', v: 'body > button:nth-of-type(2)' })).toBe('body > button:nth-of-type(2)')
  })

  it('القيمة الحاوية لعلامة اقتباس تُهرَّب فلا ينهار المحدِّد', () => {
    expect(anchorToSelector({ k: 'aria', v: 'قال "نعم"' })).toBe('[aria-label="قال \\"نعم\\""]')
  })
})

describe('anchorNormText', () => {
  it('يدمج المسافات ويقص الطويل — الدالة نفسها تُستخدم وقت الالتقاط ووقت الحل فتتطابقان', () => {
    expect(anchorNormText('  فاتورة   جديدة ')).toBe('فاتورة جديدة')
    expect(anchorNormText('x'.repeat(100)).length).toBe(80)
  })
})

describe('resolveAnchor — أول مرشح فريد يفوز (GM-01 يقف عليه)', () => {
  it('المرشح الأول الفريد يحسم فورًا', () => {
    const chain: AnchorChain = [
      { k: 'id', v: 'save' },
      { k: 'path', v: 'body > button:nth-of-type(1)' },
    ]
    const dom = fakeDom({ '[id="save"]': ['btn-save'] })
    const hit = resolveAnchor(chain, dom)
    expect(hit).toEqual({ el: 'btn-save', via: 0 })
  })

  it('مرشح ملتبس (تطابقان) يُتجاوز ويسقط الترتيب إلى التالي الفريد', () => {
    const chain: AnchorChain = [
      { k: 'testid', v: 'row' },
      { k: 'aria', v: 'حفظ' },
    ]
    const dom = fakeDom({ '[data-testid="row"]': ['a', 'b'], '[aria-label="حفظ"]': ['btn'] })
    expect(resolveAnchor(chain, dom)).toEqual({ el: 'btn', via: 1 })
  })

  it('مرشح النص: يفلتر عناصر النص التفاعلية بالنص المطوَّع ويشترط الفرادة', () => {
    const chain: AnchorChain = [{ k: 'text', v: 'حفظ التغييرات' }]
    const dom = fakeDom(
      { [TEXT_ANCHOR_SEL]: ['btn-a', 'btn-b', 'btn-c'] },
      { 'btn-a': 'إلغاء', 'btn-b': '  حفظ   التغييرات ', 'btn-c': 'حفظ' },
    )
    expect(resolveAnchor(chain, dom)).toEqual({ el: 'btn-b', via: 0 })
  })

  it('نص ملتبس (زران بنفس الكلمة) لا يُحل — صدق لا تخمين', () => {
    const chain: AnchorChain = [{ k: 'text', v: 'حفظ' }]
    const dom = fakeDom({ [TEXT_ANCHOR_SEL]: ['x', 'y'] }, { x: 'حفظ', y: 'حفظ' })
    expect(resolveAnchor(chain, dom)).toBeNull()
  })

  it('سلسلة بلا فريد من أي مرشح = لا حل (الواجهة تغيّرت — يُعلن بصدق لا توهيم)', () => {
    const chain: AnchorChain = [{ k: 'id', v: 'gone' }, { k: 'path', v: 'body > x:nth-of-type(9)' }]
    const dom = fakeDom({})
    expect(resolveAnchor(chain, dom)).toBeNull()
  })

  it('يتجاوز مرشّح id المتطاير ولو طابق عنصرًا واحدًا — يحمي الأدلة القديمة من زرٍ خاطئ', () => {
    // علة حقيقية: `_r_6_` قد يُسنَد لعنصرٍ مختلف على الصفحة الطازجة فيطابق «فريدًا» خطأً.
    const chain: AnchorChain = [
      { k: 'id', v: '_r_6_' },
      { k: 'text', v: 'فعّل cowork' },
    ]
    const dom = fakeDom(
      { '[id="_r_6_"]': ['wrong-el'], [TEXT_ANCHOR_SEL]: ['right-el'] },
      { 'right-el': 'فعّل cowork' },
    )
    expect(resolveAnchor(chain, dom)).toEqual({ el: 'right-el', via: 1 }) // النص لا المعرّف المتطاير
  })

  it('نص عنصر menuitemradio يُحل (علة الخطوة الأخيرة: اختيار النموذج في قائمة حديثة)', () => {
    // TEXT_ANCHOR_SEL يشمل menuitemradio الآن — «Opus 4.8» في قائمة النماذج يُطابَق بنصه
    expect(TEXT_ANCHOR_SEL).toContain('[role="menuitemradio"]')
    const chain: AnchorChain = [
      { k: 'id', v: '_r_u0_' }, // معرّف متطاير يُتجاوز
      { k: 'text', v: 'Opus 4.8' },
    ]
    const dom = fakeDom({ [TEXT_ANCHOR_SEL]: ['radio-a', 'radio-b'] }, { 'radio-a': 'Opus 4.7', 'radio-b': 'Opus 4.8' })
    expect(resolveAnchor(chain, dom)).toEqual({ el: 'radio-b', via: 1 })
  })

  it('يتجاوز مرشّح مسار يحوي معرّفًا متطايرًا — سلف بمعرّف React لا يوثَّق به', () => {
    const chain: AnchorChain = [
      { k: 'path', v: '[id="_r_rr_"] > div:nth-of-type(2)' },
      { k: 'aria', v: 'إلغاء' },
    ]
    const dom = fakeDom({ '[id="_r_rr_"] > div:nth-of-type(2)': ['wrong'], '[aria-label="إلغاء"]': ['right'] })
    expect(resolveAnchor(chain, dom)).toEqual({ el: 'right', via: 1 })
  })
})

describe('AnchorDom.find — منفذ بلا CSS (تمهيد محوّل UIA لتطبيق الديسكتوب)', () => {
  it('resolveAnchor يمرّر المرشّح نفسه للمحوّل ولا يطلب محدِّد CSS أبدًا', () => {
    const seen: unknown[] = []
    const dom: AnchorDom<string> = {
      find: (c) => {
        seen.push(c)
        return c.k === 'automationId' && c.v === 'btnSave' ? ['uia-save'] : []
      },
    }
    expect(resolveAnchor([{ k: 'automationId', v: 'btnSave' }], dom)).toEqual({ el: 'uia-save', via: 0 })
    expect(seen).toEqual([{ k: 'automationId', v: 'btnSave' }])
  })

  it('مرشّح controlType الملتبس يُتجاوز إلى الفريد التالي', () => {
    const dom: AnchorDom<string> = {
      find: (c) => (c.k === 'controlType' ? ['b1', 'b2'] : c.k === 'text' && c.v === 'موافق' ? ['ok'] : []),
    }
    const chain: AnchorChain = [
      { k: 'controlType', v: 'Button' },
      { k: 'text', v: 'موافق' },
    ]
    expect(resolveAnchor(chain, dom)).toEqual({ el: 'ok', via: 1 })
  })

  it('المرشّحات المتطايرة تُتجاوز قبل سؤال المحوّل أصلًا', () => {
    const seen: string[] = []
    const dom: AnchorDom<string> = { find: (c) => (seen.push(c.k), ['hit']) }
    resolveAnchor([{ k: 'id', v: '_r_6_' }, { k: 'path', v: '[id="_r_rr_"] > a' }, { k: 'aria', v: 'حفظ' }], dom)
    expect(seen).toEqual(['aria'])
  })

  it('cssAnchorFinder لا يطابق مرشّحات UIA على الويب — لا تخمين', () => {
    const f = cssAnchorFinder(() => ['any'], (el) => el)
    expect(f.find({ k: 'automationId', v: 'x' })).toEqual([])
    expect(f.find({ k: 'controlType', v: 'Button' })).toEqual([])
    expect(anchorToSelector({ k: 'automationId', v: 'x' })).toBeNull()
    expect(anchorToSelector({ k: 'controlType', v: 'Button' })).toBeNull()
  })

  it('buildAnchorChain: automationId بعد id وcontrolType قبل المسار — والويب بلا الحقلين لا يتغيّر', () => {
    const chain = buildAnchorChain({
      tag: 'Button',
      automationId: 'btnSave',
      controlType: 'Button',
      text: 'حفظ',
      path: 'Window/Pane[2]/Button[1]',
    })
    expect(chain.map((c) => c.k)).toEqual(['automationId', 'text', 'controlType', 'path'])
    const web = buildAnchorChain({ tag: 'button', id: 'save', text: 'حفظ' })
    expect(web.map((c) => c.k)).toEqual(['id', 'text'])
  })
})
