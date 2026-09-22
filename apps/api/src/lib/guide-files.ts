import type { GuideDto, ScreenshotDto, StepDto } from '@dalili/shared'
import type { FileSigner } from './file-cap'
import type { BurnSpec } from './burn'

/**
 * خصوصيّة ٢ب: روابط الملفّات حقول يملكها الخادم.
 * تُنزع عند الكتابة (لا توقيع منتهٍ ولا API_BASE قديم داخل JSON)،
 * وتُركَّب عند القراءة: موقَّعة للعضو، ومحروقة ومقيَّدة بالرمز للضيف.
 */
export const SHOT_WITHHELD_AR = 'لقطة محجوبة — تعذّر تطبيق الطمس على صيغة هذه الصورة، فلم تُعرض حمايةً للبيانات'

type Shot = Extract<ScreenshotDto, { fileId: string }>
type Pt = { x: number; y: number }

function mapSteps(guide: GuideDto, fn: (s: StepDto) => StepDto): GuideDto {
  return { ...guide, steps: guide.steps.map(fn) }
}

/** نزع روابط الخادم من الخطوات وحدها — يستعملها الدليل الكامل وإدراج الخطوات المُلحقة */
export function stripStepUrls(steps: StepDto[]): StepDto[] {
  return steps.map((s) => {
    let next = s
    if (s.screenshot && 'fileId' in s.screenshot) {
      const { fileUrl: _f, thumbUrl: _t, ...shot } = s.screenshot
      next = { ...next, screenshot: shot }
    }
    if (s.voice) {
      const { fileUrl: _v, ...voice } = s.voice
      next = { ...next, voice }
    }
    return next
  })
}

export function stripServerUrls(guide: GuideDto): GuideDto {
  const out = { ...guide, steps: stripStepUrls(guide.steps) }
  if (out.audio) {
    const { fileUrl: _a, ...audio } = out.audio
    return { ...out, audio }
  }
  return out
}

export function signForMember(guide: GuideDto, signer: FileSigner): GuideDto {
  const out = mapSteps(stripServerUrls(guide), (s) => {
    let next = s
    if (s.screenshot && 'fileId' in s.screenshot) {
      const sh = s.screenshot
      next = {
        ...next,
        screenshot: {
          ...sh,
          fileUrl: signer.original(sh.fileId),
          ...(sh.thumbFileId ? { thumbUrl: signer.original(sh.thumbFileId) } : {}),
        },
      }
    }
    if (s.voice?.fileId) next = { ...next, voice: { ...s.voice, fileUrl: signer.original(s.voice.fileId) } }
    return next
  })
  return out.audio ? { ...out, audio: { ...out.audio, fileUrl: signer.original(out.audio.fileId) } } : out
}

const shift = (p: Pt, dx: number, dy: number): Pt => ({ x: p.x - dx, y: p.y - dy })

/** القصّ محروق في المشتقّ، فكل ما يُرسم فوقه يُزاح إلى أصل الصورة الجديدة */
function shiftShot(sh: Shot, dx: number, dy: number): Shot {
  if (dx === 0 && dy === 0) return sh
  return {
    ...sh,
    ...(sh.mark ? { mark: { ...sh.mark, rect: { ...sh.mark.rect, ...shift(sh.mark.rect, dx, dy) } } } : {}),
    ...(sh.annotations
      ? {
          annotations: sh.annotations.map((a) => ({
            ...a,
            ...(a.rect ? { rect: { ...a.rect, ...shift(a.rect, dx, dy) } } : {}),
            ...(a.from ? { from: shift(a.from, dx, dy) } : {}),
            ...(a.to ? { to: shift(a.to, dx, dy) } : {}),
            ...(a.path ? { path: a.path.map((p) => shift(p, dx, dy)) } : {}),
          })),
        }
      : {}),
  }
}

/**
 * نسخة الضيف: روابط مقيَّدة بالرمز، واللقطة المطموسة/المقصوصة مشتقّ محروق.
 * غير متزامنة لأن الحرق يجري في خيط عامل — الخادم لا يتجمّد أثناءه.
 */
export async function publicGuide(
  guide: GuideDto,
  token: string,
  signer: FileSigner,
  derive: (fileId: string, spec: BurnSpec) => Promise<string | null>,
): Promise<GuideDto> {
  const stripped = stripServerUrls(guide)
  const steps = await Promise.all(
    stripped.steps.map(async (s): Promise<StepDto> => {
      let next = s
      if (s.screenshot && 'fileId' in s.screenshot) {
        // المصغّرة لا تُعطى للضيف أبدًا — القوائم للأعضاء، والعارض يعرض الأصل/المشتقّ
        const { thumbFileId: _thumb, ...sh } = s.screenshot
        const needsBurn = sh.blurRects.length > 0 || !!sh.crop
        if (!needsBurn) {
          next = { ...next, screenshot: { ...sh, fileUrl: signer.shared(sh.fileId, token) } }
        } else {
          const spec: BurnSpec = sh.crop ? { blurRects: sh.blurRects, crop: sh.crop } : { blurRects: sh.blurRects }
          const did = await derive(sh.fileId, spec)
          if (!did) {
            next = { ...next, screenshot: { missing: true, reason: SHOT_WITHHELD_AR } }
          } else {
            const { crop: _crop, ...rest } = shiftShot(sh, sh.crop?.x ?? 0, sh.crop?.y ?? 0)
            next = { ...next, screenshot: { ...rest, fileId: did, blurRects: [], fileUrl: signer.shared(did, token) } }
          }
        }
      }
      if (s.voice?.fileId) next = { ...next, voice: { ...s.voice, fileUrl: signer.shared(s.voice.fileId, token) } }
      return next
    }),
  )
  const out: GuideDto = { ...stripped, steps }
  return out.audio ? { ...out, audio: { ...out.audio, fileUrl: signer.shared(out.audio.fileId, token) } } : out
}
