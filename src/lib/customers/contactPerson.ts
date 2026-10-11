/**
 * TD-1176: a new contact of the customer / supplier form has no role. The role field
 * only suggests roles (its list and placeholder); a pre-filled role was saved untouched
 * and the party's contact name became «name (مدیر خرید)».
 */
export function blankContactPerson(id: string, isPrimary: boolean): { id: string; name: string; role: string; phone: string; isPrimary: boolean } {
  return { id, name: '', role: '', phone: '', isPrimary };
}
