import { describe, expect, it } from 'vitest'
import { buildAnchorChain } from './anchor'
import { primarySourceOf, siteLabel } from './sites'
import {
  desktopShotPolicy,
  desktopStepKind,
  factsToElInfo,
  factsToStepSource,
  type DesktopFacts,
} from './desktop-brain'

/** DTOP-01/٣ج-١: محوّلات حقائق الديسكتوب (عقد ٣ب) إلى مدخلات النواة — بناءً على
 *  الموجود (buildAnchorChain · primarySourceOf · siteLabel) لا إعادة بنائه. */

/** حقائق تبويب «إدراج» في Excel — مطابقة حرفيًّا لما يبثّه ٣ب (events.rs camelCase) */
const INSERT_TAB: DesktopFacts = {
  seq: 7,
  readMs: 21.4,
  element: {
    automationId: 'TabInsert',
    name: 'إدراج',
    controlType: 'TabItem',
    className: 'NetUI HWND',
    frameworkId: 'Win32',
    rect: { x: 600, y: 90, w: 80, h: 30 },
    isPassword: false,
    value: undefined,
  },
  ancestors: [],
  window: {
    hwnd: '0x10ac',
    processName: 'C:\\Program Files\\Microsoft Office\\root\\Office16\\EXCEL.EXE',
    windowTitle: 'Book1 - Excel',
    appId: 'app:EXCEL.EXE',
    affinity: 0,
    ieMode: false,
  },
}

const clone = (f: DesktopFacts): DesktopFacts => structuredClone(f)

/** حارس الشكل نفسه الذي أمسك مِعلَّقة التسطيح: element على السلك مسطَّح
 *  (serde(flatten) في events.rs — حارس Rust يقرأ json["element"]["automationId"])
 *  ولا مجال لعقدة `node` متداخلة تعيد إخفاء الانفصال عن الحمولة الحيّة */
describe('شكل الحمولة يطابق ما يبثّه الجهاز فعلًا', () => {
  it('element مسطَّح: automationId/isPassword أشقاء ولا node متداخل', () => {
    const j = JSON.parse(JSON.stringify(INSERT_TAB)) as Record<string, unknown>
    expect((j.element as Record<string, unknown>)['automationId']).toBe('TabInsert')
    expect((j.element as Record<string, unknown>)['isPassword']).toBe(false)
    expect('node' in (j.element as object)).toBe(false)
  })
})

describe('factsToElInfo — خريطة الحقائق إلى وصف المرساة', () => {
  it('تبويب إدراج: automationId ثم النص ثم controlType — بلا id ولا مسار CSS', () => {
    const info = factsToElInfo(INSERT_TAB)
    expect(info).toEqual({
      tag: 'TabItem',
      automationId: 'TabInsert',
      controlType: 'TabItem',
      text: 'إدراج',
    })
    const chain = buildAnchorChain(info)
    expect(chain).toEqual([
      { k: 'automationId', v: 'TabInsert' },
      { k: 'text', v: 'إدراج' },
      { k: 'controlType', v: 'TabItem' },
    ])
  })

  it('عنصر بلا automationId ولا اسم ⇐ المرساة تنزل إلى controlType وحده لا أكثر (صدق لا اختراع)', () => {
    const bare = clone(INSERT_TAB)
    bare.element.automationId = undefined
    bare.element.name = undefined
    const chain = buildAnchorChain(factsToElInfo(bare))
    expect(chain).toEqual([{ k: 'controlType', v: 'TabItem' }])
  })

  it('عنصر بلا controlType أصلًا ⇐ tag يصير element (افتراضيّ الخطّة)', () => {
    const bare = clone(INSERT_TAB)
    bare.element.controlType = undefined
    expect(factsToElInfo(bare).tag).toBe('element')
  })
})

describe('desktopShotPolicy — سياسة اللقطة ابتدائيًّا (يُراجَع في ٣و)', () => {
  it('أفعال التحوّل البصري الفوري ⇐ قبل', () => {
    for (const ct of ['Button', 'MenuItem', 'TabItem', 'Hyperlink', 'ListItem', 'TreeItem']) {
      expect(desktopShotPolicy(ct)).toBe('before')
    }
  })
  it('الحقول والمبدّلات ⇐ بعد (الحالة تظهر بعد الفعل)', () => {
    for (const ct of ['CheckBox', 'RadioButton', 'ComboBox', 'Edit']) {
      expect(desktopShotPolicy(ct)).toBe('after')
    }
  })
  it('المجهول والغائب ⇐ before (الأأمن: نلتقط ما قبل الفعل)', () => {
    expect(desktopShotPolicy('Custom')).toBe('before')
    expect(desktopShotPolicy(undefined)).toBe('before')
  })
})

describe('factsToStepSource — مصدر الخطوة كما تفهمه النواة', () => {
  it('حقائق Excel ⇐ مصدر ديسكتوب كامل تقرؤه النواة app:EXCEL.EXE وتسمّيه «Excel»', () => {
    const source = factsToStepSource(INSERT_TAB)
    expect(source).toEqual({
      kind: 'desktop',
      processName: 'C:\\Program Files\\Microsoft Office\\root\\Office16\\EXCEL.EXE',
      windowTitle: 'Book1 - Excel',
      appId: 'app:EXCEL.EXE',
      uiaFramework: 'Win32',
      ieMode: undefined,
      url: undefined,
    })
    const key = primarySourceOf([{ source }])
    expect(key).toBe('app:EXCEL.EXE')
    expect(siteLabel(key)).toBe('Excel')
  })

  it('ieMode=false تصير غائبة (لا خطأ) والموجبة تمرّ مع الرابط', () => {
    const ie = clone(INSERT_TAB)
    ie.window.ieMode = true
    ie.window.url = 'https://gov.example/book'
    const source = factsToStepSource(ie)
    expect(source.ieMode).toBe(true)
    expect(source.url).toBe('https://gov.example/book')
    expect(factsToStepSource(INSERT_TAB).ieMode).toBeUndefined()
  })

  it('غياب frameworkId في العقدة ⇐ غيابه في المصدر', () => {
    const bare = clone(INSERT_TAB)
    bare.element.frameworkId = undefined
    expect(factsToStepSource(bare).uiaFramework).toBeUndefined()
  })
})

describe('desktopStepKind — تصنيف الخطوة ابتدائيًّا (يُراجَع في ٣و)', () => {
  const gesture = (clicks: number, keys: string[]) => ({ clicks, keys })

  it('Edit مع مفاتيح كتابة ⇐ input', () => {
    const edit = clone(INSERT_TAB)
    edit.element.controlType = 'Edit'
    expect(desktopStepKind(edit, gesture(1, ['char']))).toBe('input')
  })

  it('CheckBox وRadioButton ⇐ toggle', () => {
    for (const ct of ['CheckBox', 'RadioButton']) {
      const f = clone(INSERT_TAB)
      f.element.controlType = ct
      expect(desktopStepKind(f, gesture(1, []))).toBe('toggle')
    }
  })

  it('ComboBox وList وTree ⇐ select', () => {
    for (const ct of ['ComboBox', 'List', 'Tree']) {
      const f = clone(INSERT_TAB)
      f.element.controlType = ct
      expect(desktopStepKind(f, gesture(1, []))).toBe('select')
    }
  })

  it('Button وMenuItem وTabItem وHyperlink ⇐ click', () => {
    for (const ct of ['Button', 'MenuItem', 'TabItem', 'Hyperlink']) {
      const f = clone(INSERT_TAB)
      f.element.controlType = ct
      expect(desktopStepKind(f, gesture(1, []))).toBe('click')
    }
  })

  it('إيماءة مفاتيح فقط بلا نقر ولا هدف ⇐ keypress (enter/tab/أسهم)', () => {
    const bare = clone(INSERT_TAB)
    bare.element.controlType = undefined
    for (const keys of [['enter'], ['tab'], ['nav']]) {
      expect(desktopStepKind(bare, gesture(0, keys))).toBe('keypress')
    }
  })

  it('تركيب غير مصنَّف (نقرة بلا نوع عنصر) ⇐ click الأأمن', () => {
    const bare = clone(INSERT_TAB)
    bare.element.controlType = undefined
    expect(desktopStepKind(bare, gesture(1, []))).toBe('click')
  })
})
