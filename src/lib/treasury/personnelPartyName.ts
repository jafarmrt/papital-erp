import type { Personnel } from '../../types/personnel.types';

/**
 * v10.0.259 (TD-953، P5-W09): نام طرف حساب پرسنل در فرم خزانه و چک. پرسنلی که از اکسل فقط با «نام کامل» آمده نام و نام
 * خانوادگی خالی دارد؛ فرم‌ها نام را از این دو می‌ساختند، پس نام طرف حساب خالی فرستاده می‌شد و کارساز ۴۰۰ «نام طرف حساب
 * الزامی است» می‌داد. نام کامل پرسنل (همان نامی که صورت‌حساب و سند حسابداری نشان می‌دهند) اول خوانده می‌شود.
 */
export function personnelPartyName(p: Pick<Personnel, 'fullName' | 'firstName' | 'lastName'>): string {
  return (p.fullName || '').trim() || `${p.firstName || ''} ${p.lastName || ''}`.trim();
}
