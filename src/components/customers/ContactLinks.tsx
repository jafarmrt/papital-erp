import { Phone, MessageCircle, Mail, Globe, Instagram } from 'lucide-react';
import { instagramUrl, mailtoLink, normalizeWebsite, telLink, websiteError, whatsappLink } from '../../lib/customers/contactChannels';

/**
 * v10.1.15 (N-02 بخش ۱، ت۳): پیوندهای یک‌کلیکی کنار تلفن («تماس» و «واتس‌اپ»)، ایمیل («نامه»)، وب‌سایت و اینستاگرام
 * («صفحه»). پیوندی که مقدارش خالی یا نادرست است نشان داده نمی‌شود.
 */

const LINK_CLASS = 'inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50 hover:text-blue-700';

export function PhoneLinks({ phone }: { phone: string | null | undefined }) {
  const tel = telLink(phone);
  const wa = whatsappLink(phone);
  if (!tel && !wa) return null;
  return (
    <span className="inline-flex items-center gap-1">
      {tel && (
        <a href={tel} className={LINK_CLASS} title="تماس" aria-label="تماس">
          <Phone size={11} /> تماس
        </a>
      )}
      {wa && (
        <a href={wa} target="_blank" rel="noopener noreferrer" className={LINK_CLASS} title="واتس‌اپ" aria-label="واتس‌اپ">
          <MessageCircle size={11} /> واتس‌اپ
        </a>
      )}
    </span>
  );
}

export function EmailLink({ email }: { email: string | null | undefined }) {
  const href = mailtoLink(email);
  if (!href) return null;
  return (
    <a href={href} className={LINK_CLASS} title={`نامه به ${email}`} aria-label="نامه">
      <Mail size={11} /> نامه
    </a>
  );
}

interface CustomerChannelLinksProps {
  website?: string | null;
  email?: string | null;
  instagram?: string | null;
}

/** وب‌سایت، ایمیل و اینستاگرام طرف حساب، هر کدام با مقدارش و پیوند خودش */
export function CustomerChannelLinks({ website, email, instagram }: CustomerChannelLinksProps) {
  const site = website && !websiteError(website) ? normalizeWebsite(website) : '';
  const insta = instagramUrl(instagram);
  const mail = mailtoLink(email);
  if (!site && !insta && !mail) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="customer-channel-links">
      {site && (
        <a href={site} target="_blank" rel="noopener noreferrer" className={LINK_CLASS} title={site} dir="ltr">
          <Globe size={11} /> {site.replace(/^https?:\/\//, '')}
        </a>
      )}
      {mail && (
        <a href={mail} className={LINK_CLASS} title="نامه" dir="ltr">
          <Mail size={11} /> {email}
        </a>
      )}
      {insta && (
        <a href={insta} target="_blank" rel="noopener noreferrer" className={LINK_CLASS} title="صفحه اینستاگرام" dir="ltr">
          <Instagram size={11} /> {instagram}
        </a>
      )}
    </div>
  );
}
