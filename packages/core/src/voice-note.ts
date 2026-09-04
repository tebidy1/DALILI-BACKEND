/** VOX-09 «ميك الخطوة» — قاعدة ملء النص المقررة (2026-09-04):
 * التفريغ يملأ الملاحظة الفارغة، وإن كانت مكتوبة يدويًا يُلحق أسفلها بسطر فاصل —
 * كلام المستخدم لا يُستبدل أبدًا. نقية بلا اعتمادات (قانون النواة). */

/** يدمج نص التفريغ مع الملاحظة القائمة: فارغة→النص، موجودة→إلحاق بسطر، تفريغ فارغ→الموجودة كما هي */
export function mergeVoiceTranscript(existingNote: string | undefined, transcript: string): string {
  const clean = transcript.trim()
  if (!clean) return existingNote ?? ''
  const existing = existingNote?.trim()
  if (!existing) return clean
  return `${existing}\n${clean}`
}
