/**
 * آلة توقيت الإيماءة النقية — نواة «المِضخّة» الزمنية المنقولة من امتداد المتصفح
 * (مهمّة ٢ في خطّة المرحلة ١): النوافذ الزمنية (صمت collectMs / سقف maxMs) وحدها
 * تسكن هنا، وتوقّعات DOM تبقى لدى العميل (الامتداد اليوم، والديسكتوب لاحقًا).
 *
 * القيد الملزم من الخطّة الرئيسيّة §٣ب: الساعة والمجدول **محقونان** — لا
 * `Date.now` ولا `setTimeout` هنا إطلاقًا؛ الديسكتوب سيغذّي `schedule` من ساعة
 * QPC عبر `TickEvt` بدل مؤقّتات WebView المخنوقة، والامتداد يمرّر المؤقّتات
 * الحقيقيّة فيبقى سلوك `vi.useFakeTimers()` القائم يعمل.
 */
export interface GesturePacerOpts<R> {
  /** صمت يُغلق النافذة (٦٠مث في الالتقاط — القياس الحيّ 2026-09-06) */
  collectMs: number
  /** سقف عمر النافذة مهما تتابعت الأحداث (٤٠٠مث — قانون لا تعليق) */
  maxMs: number
  /** الساعة المحقونة — مصدر الزمن الوحيد */
  now: () => number
  /** المجدول المحقون — يؤجّل تنفيذًا ويعيد دالّة إلغاء */
  schedule: (fn: () => void, ms: number) => () => void
  /** مَصرف النافذة المغلقة — يُستدعى مرة واحدة بعناصرها غير الفارغة */
  onFlush: (items: R[]) => void
}

export interface GesturePacer<R> {
  /** يصرّف أي نافذة معلّقة فورًا ثم يفتح نافذة نظيفة (ضغطة جديدة) */
  open(): void
  /** حدث ينضم للنافذة الجارية — أو يفتحها إن لم تكن مفتوحة */
  add(r: R): void
  /** إغلاق يدوي فوري (قبل مغادرة الصفحة أو إيقاف التسجيل أو Enter) */
  flush(): void
  /** عدد عناصر النافذة الحيّة */
  seenCount(): number
}

export function createGesturePacer<R>(opts: GesturePacerOpts<R>): GesturePacer<R> {
  let win: { items: R[]; openedAt: number; cancel: (() => void) | null } | null = null

  function close() {
    const w = win
    win = null
    if (!w) return
    w.cancel?.()
    // flush فارغ بلا أثر — الإيماءة بلا عناصر لا تصل المصرف
    if (w.items.length > 0) opts.onFlush(w.items)
  }

  function arm() {
    if (!win) return
    win.cancel?.()
    // الصمت يُقاس من آخر حدث، والسقف من فتح النافذة — أيّهما أقرب يفوز
    const left = opts.maxMs - (opts.now() - win.openedAt)
    win.cancel = opts.schedule(close, Math.max(0, Math.min(opts.collectMs, left)))
  }

  return {
    open() {
      close()
      win = { items: [], openedAt: opts.now(), cancel: null }
    },
    add(r: R) {
      if (!win) win = { items: [], openedAt: opts.now(), cancel: null }
      win.items.push(r)
      arm()
    },
    flush: close,
    seenCount: () => win?.items.length ?? 0,
  }
}
