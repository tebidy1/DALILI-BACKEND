/** رموز التصميم — مصدر واحد للألوان يشترك فيه الامتداد وسطح المكتب لاحقًا. بيانات نقية بلا DOM. */

export type ThemeMode = 'light' | 'dark'

export interface Tokens {
  brand: string
  brandBright: string
  accent: string
  finish: string
  danger: string
  ground: string
  surface: string
  surface2: string
  ink: string
  muted: string
  line: string
}

// نظام لونين فقط: «قلم رصاص» جرافيت + أبيض — بلا أي لون علامة. كل العناصر التفاعلية
// (brand/accent/finish) هي نفس الجرافيت؛ الأزرار الأساسية تعكس جرافيت↔أبيض عند المرور.
// الأحمر وظيفي فقط (مؤشر التسجيل + الحذف/الإلغاء)، لا لون تزييني. الأزواج ≥4.5:1.
export const LIGHT: Tokens = {
  brand: '#2B2A26',
  brandBright: '#3C3A34',
  accent: '#2B2A26',
  finish: '#2B2A26',
  danger: '#C4453D',
  ground: '#F6F5F2',
  surface: '#FFFFFF',
  surface2: '#F3F2EE',
  ink: '#2B2A26',
  muted: '#6B675F',
  line: '#E7E3DA',
}

export const DARK: Tokens = {
  brand: '#ECEAE4',
  brandBright: '#D8D6CF',
  accent: '#ECEAE4',
  finish: '#ECEAE4',
  danger: '#E27B72',
  ground: '#191817',
  surface: '#232220',
  surface2: '#2B2A27',
  ink: '#ECEAE4',
  muted: '#A19C93',
  line: '#343330',
}

function camelToKebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())
}

function vars(t: Tokens): string {
  return (Object.keys(t) as (keyof Tokens)[])
    .map((k) => `--dl-${camelToKebab(k)}:${t[k]}`)
    .join(';')
}

/** كتلة CSS تعرّف متغيّرات --dl-* على المُحدِّد، مع تجاوز داكن حسب تفضيل النظام. */
export function tokensCss(selector: string): string {
  return (
    `${selector}{${vars(LIGHT)}}` +
    `@media (prefers-color-scheme: dark){${selector}{${vars(DARK)}}}`
  )
}
