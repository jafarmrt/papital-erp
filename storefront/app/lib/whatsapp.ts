/** A wa.me link; the number is the shop's, kept in the ERP settings («فروشگاه سایت»), in international digits */
export function whatsappLink(number: string, text = ''): string {
  const digits = number.replace(/\D/g, '');
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}
