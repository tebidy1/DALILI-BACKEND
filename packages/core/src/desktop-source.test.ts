import { describe, expect, it } from 'vitest'
import { assembleGuide, type RawStep } from './assemble'
import { deriveGuideTitle, placeTitleOf, type StepSource } from './guide'
import { migrateGuide } from './migrate'
import { appSiteKey, extractCapturedSites, primarySourceOf, siteLabel } from './sites'
import { stepTitle } from './titles'

/** DTOP-01: النواة تفهم خطوة الديسكتوب — لا url، والهوية من نافذة التطبيق */
const EXCEL: StepSource = {
  kind: 'desktop',
  processName: 'EXCEL.EXE',
  windowTitle: 'Book1 - Excel',
  appId: 'C:\\Program Files\\Microsoft Office\\root\\Office16\\EXCEL.EXE',
}
const FIXED = 1700000000000

describe('placeTitleOf — عنوان المكان أيًّا كان المصدر', () => {
  it('الديسكتوب ← عنوان النافذة · الويب الصريح ← عنوان الصفحة · v1 ← pageTitle', () => {
    expect(placeTitleOf({ source: EXCEL })).toBe('Book1 - Excel')
    expect(placeTitleOf({ source: { kind: 'web', url: 'https://x', pageTitle: 'الرئيسة' } })).toBe('الرئيسة')
    expect(placeTitleOf({ pageTitle: 'قديم' })).toBe('قديم')
    expect(placeTitleOf({ source: { kind: 'camera' } })).toBeUndefined()
  })
})

describe('العناوين العربيّة للديسكتوب', () => {
  it('navigate على الديسكتوب ← «انتقل إلى نافذة»', () => {
    expect(stepTitle({ kind: 'navigate', target: {}, sensitive: false, source: EXCEL })).toBe('انتقل إلى نافذة «Book1 - Excel»')
  })
  it('navigate على الويب لم يتغيّر حرفًا', () => {
    expect(stepTitle({ kind: 'navigate', target: {}, sensitive: false, pageTitle: 'الرئيسة' })).toBe('انتقل إلى صفحة «الرئيسة»')
  })
  it('عنوان الدليل من نافذة أول خطوة ديسكتوب', () => {
    expect(deriveGuideTitle([{ kind: 'click', source: EXCEL }])).toBe('دليل: Book1 - Excel')
  })
})

describe('assembleGuide يكتب v2', () => {
  const web: RawStep = { kind: 'click', target: { text: 'حفظ' }, url: 'https://erp.example/a', pageTitle: 'النظام', ts: 1 }
  const desk: RawStep = { kind: 'click', target: { text: 'Insert' }, ts: 2, source: EXCEL }

  it('schemaVersion 2، وخطوة الويب تحمل source مع بقاء url/pageTitle للقرّاء القدامى', () => {
    const g = assembleGuide([web], FIXED)
    expect(g.schemaVersion).toBe(2)
    expect(g.steps[0]!.source).toEqual({ kind: 'web', url: 'https://erp.example/a', pageTitle: 'النظام' })
    expect(g.steps[0]!.url).toBe('https://erp.example/a')
  })

  it('خطوة ديسكتوب بلا url: المصدر يمرّ كما هو والعنوان من النافذة', () => {
    const g = assembleGuide([desk], FIXED)
    expect(g.steps[0]!.url).toBeUndefined()
    expect(g.steps[0]!.source).toEqual(EXCEL)
    expect(g.title).toBe('دليل: Book1 - Excel')
    expect(g.steps[0]!.title).toBe('انقر على «Insert»')
  })

  it('خطوة ويب برابط فارغ تبقى بلا source (مطابقة قاعدة migrateGuide)', () => {
    const g = assembleGuide([{ kind: 'navigate', target: {}, url: '', pageTitle: '', ts: 1 }], FIXED)
    expect('source' in g.steps[0]!).toBe(false)
  })

  it('ناتج التجميع ثابت أمام migrateGuide — لا فرق بين ما نكتبه وما نرقّيه', () => {
    const g = assembleGuide([web, desk], FIXED)
    expect(migrateGuide(structuredClone(g))).toEqual(g)
  })
})

describe('المواقع: مفتاح التطبيق وتسميته', () => {
  it('appSiteKey يأخذ اسم الملفّ بأحرف كبيرة ولو جاء مسارًا', () => {
    expect(appSiteKey('excel.exe')).toBe('app:EXCEL.EXE')
    expect(appSiteKey('C:\\Office16\\WINWORD.EXE')).toBe('app:WINWORD.EXE')
  })

  it('primarySourceOf: الويب لم يتغيّر · الديسكتوب app: · IE-mode برابط ← المضيف · IE-mode بلا رابط ← app: · الكاميرا', () => {
    expect(primarySourceOf([{ url: 'https://www.erp.example/x' }])).toBe('erp.example')
    expect(primarySourceOf([{ source: EXCEL }])).toBe('app:EXCEL.EXE')
    expect(primarySourceOf([{ source: { ...EXCEL, processName: 'msedge.exe', ieMode: true, url: 'https://gov.example/p' } }])).toBe('gov.example')
    expect(primarySourceOf([{ source: { ...EXCEL, processName: 'msedge.exe', ieMode: true } }])).toBe('app:MSEDGE.EXE')
    expect(primarySourceOf([{ source: { kind: 'camera' } }])).toBe('camera')
    expect(primarySourceOf([{ url: '' }, { source: EXCEL }])).toBe('app:EXCEL.EXE')
  })

  it('siteLabel: أسماء بشريّة للتطبيقات والكاميرا، والمضيف كما هو', () => {
    expect(siteLabel('app:EXCEL.EXE')).toBe('Excel')
    expect(siteLabel('app:SAPLOGON.EXE')).toBe('SAP GUI')
    expect(siteLabel('app:MYERP.EXE')).toBe('Myerp')
    expect(siteLabel('camera')).toBe('الكاميرا')
    expect(siteLabel('erp.example')).toBe('erp.example')
  })

  it('extractCapturedSites يعطي شارة للتطبيق مرّة واحدة بجانب شارات الويب', () => {
    const sites = extractCapturedSites([{ source: EXCEL }, { source: EXCEL }, { url: 'https://github.com/x' }])
    expect(sites.map((s) => [s.host, s.name])).toEqual([
      ['app:EXCEL.EXE', 'Excel'],
      ['github.com', 'GitHub'],
    ])
  })
})
