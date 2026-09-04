import { describe, expect, it } from 'vitest'
import {
  anchorNormText,
  anchorToSelector,
  buildAnchorChain,
  resolveAnchor,
  TEXT_ANCHOR_SEL,
  type AnchorChain,
  type AnchorDom,
} from './anchor'

/** DOM زائف للفحص: خريطة محدِّد → عناصر، ودالة نص لكل عنصر */
function fakeDom(bySel: Record<string, string[]>, texts: Record<string, string> = {}): AnchorDom<string> {
  return {
    queryAll: (sel) => bySel[sel] ?? [],
    textOf: (el) => texts[el] ?? el,
  }
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
})
