/**
 * محوّلات حقائق الديسكتوب (٣ج-١) — الجسر النقيّ بين عقد المستشعرات (٣ب) وطبقة
 * الدليل المبنيّة في هذه النواة (assemble/anchor/sites/titles).
 *
 * المبدأ الحاكم (خطّة ٣ج): **لا تُعَد بناء ما بنته النواة** — هذه الدوالّ ترجمة
 * خريطة صرفة فحسب: حقائق UIA ← AnchorElInfo/StepSource/StepKind/سياسة اللقطة.
 * أيّ منطق تجميع أو مراسي أو هويّة يُستورد من وحدات النواة لا يُنسخ هنا.
 *
 * `DesktopFacts` توأم TS لعقد Rust المثبَّت: apps/desktop/src-tauri/src/sensors/
 * events.rs (أسماء حقول serde camelCase حرفيًّا — القيمة غائبة عن JSON لحقل
 * كلمة السرّ ببوّابة ٣ب). **العنصر مسطَّح تحت `element` مباشرةً** (لا `node`
 * متداخلًا): الحقل `#[serde(flatten)] node: UiaNode` يجعل صفات العقدة أشقّاءَ
 * `isPassword`/`value` — يُثبته حارس العقد في events.rs نفسه
 * (`json["element"]["automationId"]`). الجلسة (٣ج-٢) هي من يملأ هذه البنية من
 * `sensor://facts`. جداول `desktopShotPolicy`/`desktopStepKind` **ابتدائيّة
 * تُراجَع في ٣و** (خطّة ٣ج §٧) — لا تُعتمد كنهائيّة قبل البرهان الحيّ.
 */
import type { AnchorElInfo } from './anchor'
import type { StepKind, StepSource } from './guide'

/** عقدة UIA كما يبثّها ٣ب — كل الخيارات اختياريّة عدا المستطيل الفيزيائيّ.
 *  في `element` تُدمج هذه الصفات بالتسطيح (flatten) مع isPassword/value. */
export interface DesktopUiaNode {
  automationId?: string
  name?: string
  controlType?: string
  className?: string
  frameworkId?: string
  /** بكسل فيزيائي على الشاشة — التحويل لإحداثيّات الصورة في جلسة ٣ج-٢ عبر monitor */
  rect: { x: number; y: number; w: number; h: number }
}

/** حقائق نقرة ناجحة (`FactsEvt::Ok` كما يبثّها `sensor://facts`) — العنصر
 *  مسطَّح بمطابقة `serde(flatten)` لا مُعشَّشًا */
export interface DesktopFacts {
  seq: number
  readMs: number
  element: DesktopUiaNode & {
    isPassword: boolean
    /** غائب تمامًا عن JSON حين يكون الحقل سرًّا (بوّابة ٣ب) */
    value?: string
  }
  /** فروع الأسلاف كما يبثّها Rust — مسطَّحة أصلًا (Vec<UiaNode>) */
  ancestors: DesktopUiaNode[]
  window: {
    hwnd: string
    processName: string
    windowTitle: string
    appId: string
    affinity: number
    ieMode: boolean
    url?: string
  }
}

/** إيماءة نافذة المِضخّة كما جمعتها الجلسة (٣ج-٢): نقرات + أصناف مفاتيح
 *  (keyClass من ٣ب: char|enter|tab|nav|modifier|escape|other) — لا حرف واحد يُخزَّن */
export interface DesktopGesture {
  clicks: number
  keys: string[]
}

/** خريطة §٣ج في الخطّة الأمّ: الحقائق ← وصف مرساة النواة.
 *  ‏text ← name (التسمية المرئيّة)، و`name`/`id`/`path` لا تُملأ — لا معنى
 *  لها على الديسكتوب ووجودها يكرّر المرشّحات في السلسلة. */
export function factsToElInfo(ok: DesktopFacts): AnchorElInfo {
  const n = ok.element
  return {
    tag: n.controlType ?? 'element',
    automationId: n.automationId,
    controlType: n.controlType,
    text: n.name,
  }
}

/** سياسة اللقطة الابتدائيّة: أفعال التحوّل الفوري تُصوَّر قبلها، والحقول
 *  والمبدّلات تُصوَّر بعدها حيث تظهر الحالة، والمجهول ⇐ before الأأمن. */
export function desktopShotPolicy(controlType?: string): 'before' | 'after' {
  switch (controlType) {
    case 'CheckBox':
    case 'RadioButton':
    case 'ComboBox':
    case 'Edit':
      return 'after'
    default:
      // Button/MenuItem/TabItem/Hyperlink/ListItem/TreeItem والمجهول كلها قبل
      return 'before'
  }
}

/** الحقائق ← مصدر خطوة ديسكتوب (عقد `zStepSource` في shared). ‏ieMode=false
 *  تصير غائبة كي لا تُلوِّث JSON، و`primarySourceOf` يقرأ `processName` فيعرض
 *  الهويّة (app:EXCEL.EXE ⇐ «Excel» عبر siteLabel). */
export function factsToStepSource(ok: DesktopFacts): Extract<StepSource, { kind: 'desktop' }> {
  return {
    kind: 'desktop',
    processName: ok.window.processName,
    windowTitle: ok.window.windowTitle,
    appId: ok.window.appId,
    uiaFramework: ok.element.frameworkId,
    ieMode: ok.window.ieMode || undefined,
    url: ok.window.url,
  }
}

/** تصنيف الخطوة الابتدائيّ (القيم مطابقة لـ`zStepKind` في shared). الترتيب
 *  مُلزِم: الكتابة قبل المبدّلات قبل الاختيار قبل النقر، وإيماءة مفاتيح فقط
 *  (بلا نقرة) ⇐ keypress، وكل تركيب آخر ⇐ click الأأمن. كشف `navigate` قرار
 *  جلسة (٣ج-٢) لا مصنّف نقيّ. */
export function desktopStepKind(ok: DesktopFacts, gesture: DesktopGesture): StepKind {
  const ct = ok.element.controlType
  if (ct === 'Edit' && gesture.keys.includes('char')) return 'input'
  if (ct === 'CheckBox' || ct === 'RadioButton') return 'toggle'
  if (ct === 'ComboBox' || ct === 'List' || ct === 'Tree') return 'select'
  if (ct === 'Button' || ct === 'MenuItem' || ct === 'TabItem' || ct === 'Hyperlink') return 'click'
  if (gesture.clicks === 0) return 'keypress'
  return 'click'
}
