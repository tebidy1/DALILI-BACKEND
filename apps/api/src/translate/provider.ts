/** TRNS-01: عقد مزوّد الترجمة — نمط SttProvider (قرار ت5): كل مزوّد خلف العقد، مفتاحه في .env وحده.
 *  قروك اليوم، مزوّد أعلى أو محلي للمؤسسة لاحقًا — بلا تغيير كود المستدعي. */
import type { TranslateItem } from './payload'

export interface TranslateProvider {
  readonly name: string
  translate(req: { items: TranslateItem[]; target: 'en' }): Promise<Array<{ id: string; text: string }>>
}
