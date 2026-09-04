/** SRCH-06 تحسين — دمج ترتيب هجين بالمراكز لا بالدرجات (RRF) وقصّ ثقة نسبي.
 * نقية بلا اعتمادات (قانون النواة). فائدته: درجات أي مزوّد تضمين (e5/gemini/pgvector)
 * تختلف سلمها كليًا، أما المراكز فثابتة المعنى — فالترتيب الهجين يُحصّن ضد انضغاط
 * الدرجات ويبقى صالحًا كما هو عند استبدال المزوّد أو الانتقال لقاعدة متجهات حقيقية.
 */

/** ثابت RRF القياسي — يخفف وزن المراكز المتأخرة بلا عنف */
const DEFAULT_K = 60

/**
 * دمج قائمة دلالية مع قائمة حرفية: لكل معرّف Σ w/(k + rank) ويُعاد المجموع مرتبًا
 * تنازليًا. المعرّف الحاضر في القائمتين يجمع وزنَين فيتقدم على من في واحدة.
 * القائمة المعادة ترتيبُها هو الناتج؛ القيم درجات دمج لا درجات تشابه.
 */
export function fuseRanked(
  semantic: string[],
  literal: string[],
  opts: { k?: number; semanticWeight?: number } = {},
): Map<string, number> {
  const k = opts.k ?? DEFAULT_K
  const semanticWeight = opts.semanticWeight ?? 1
  const acc = new Map<string, number>()
  semantic.forEach((id, i) => acc.set(id, (acc.get(id) ?? 0) + semanticWeight / (k + 1 + i)))
  literal.forEach((id, i) => acc.set(id, (acc.get(id) ?? 0) + 1 / (k + 1 + i)))
  return new Map([...acc.entries()].sort((a, b) => b[1] - a[1]))
}

/**
 * قصّ الثقة النسبي: يبقى ما اقترب من القمة — كل من هبط تحت ratio × درجة الأول يُقصّ.
 * القائمة المنبسطة (درجات متقاربة) لا تُقص، والفارغة تبقى فارغة.
 */
export function relativeCutoff(ids: string[], scores: ReadonlyMap<string, number>, ratio = 0.5): string[] {
  const top = ids.length > 0 ? scores.get(ids[0]!) : undefined
  if (top === undefined) return []
  const threshold = ratio * top
  return ids.filter((id) => (scores.get(id) ?? 0) >= threshold)
}
