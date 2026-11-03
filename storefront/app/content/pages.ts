/**
 * The information pages of the site. Their texts are placeholders until the content step (phase 8.5) writes them with
 * the owner; a page marked `draft` says so on the page. The shipping and contact pages also read the live settings of
 * the ERP (methods, free-shipping threshold, reservation hours, WhatsApp), so those parts are never stale.
 */
export interface InfoSection {
  heading?: string;
  paragraphs: string[];
}

export interface InfoPage {
  slug: 'about' | 'contact' | 'shipping' | 'terms' | 'privacy';
  title: string;
  description: string;
  draft: boolean;
  sections: InfoSection[];
}

export const INFO_PAGES: readonly InfoPage[] = [
  {
    slug: 'about',
    title: 'دربارهٔ پاپیتال',
    description: 'گالری پاپیتال زیورآلات دست‌ساز با نقش کاشی‌های ایران می‌سازد.',
    draft: true,
    sections: [
      { paragraphs: [
        'پاپیتال کارگاهی در تهران است که نقش کاشی‌کاری بناهای ایران را روی گردنبند، گوشواره و ست‌های هدیه می‌نشاند.',
        'هر قطعه در کارگاه و با دست ساخته می‌شود، پس دو قطعه هیچ‌وقت کاملاً یکی نیستند.',
      ] },
    ],
  },
  {
    slug: 'contact',
    title: 'تماس با ما',
    description: 'راه‌های گفت‌وگو با گالری پاپیتال برای خرید، سفارش سازمانی و خرید عمده.',
    draft: true,
    sections: [
      { paragraphs: ['برای پرسش دربارهٔ محصولات، پیگیری سفارش، هدیهٔ سازمانی یا خرید عمده با ما در تماس باشید.'] },
    ],
  },
  {
    slug: 'shipping',
    title: 'ارسال و پرداخت',
    description: 'روش‌های ارسال، هزینهٔ ارسال و پرداخت کارت‌به‌کارت در گالری پاپیتال.',
    draft: false,
    sections: [],
  },
  {
    slug: 'terms',
    title: 'قوانین خرید',
    description: 'شرایط ثبت سفارش، پرداخت، ارسال و بازگشت کالا در گالری پاپیتال.',
    draft: true,
    sections: [
      { heading: 'ثبت سفارش', paragraphs: ['قیمت هر محصول همان است که روی صفحهٔ آن نوشته شده است. سفارش پس از تأیید پرداخت از سوی فروشگاه قطعی می‌شود.'] },
      { heading: 'پرداخت', paragraphs: ['پرداخت به‌صورت کارت‌به‌کارت است و رسید آن در صفحهٔ سفارش بارگذاری می‌شود.'] },
      { heading: 'بازگشت کالا', paragraphs: ['شرایط بازگشت و تعویض کالا پیش از راه‌اندازی سایت همین‌جا نوشته می‌شود.'] },
    ],
  },
  {
    slug: 'privacy',
    title: 'حریم خصوصی',
    description: 'گالری پاپیتال با اطلاعات خریداران چه می‌کند.',
    draft: true,
    sections: [
      { paragraphs: [
        'نام، شمارهٔ تماس و نشانی شما فقط برای رساندن سفارش و پیگیری آن به کار می‌رود و به کسی فروخته یا داده نمی‌شود، جز شرکت ارسال‌کنندهٔ همان سفارش.',
      ] },
    ],
  },
];

export const infoPage = (slug: string) => INFO_PAGES.find(page => page.slug === slug);
