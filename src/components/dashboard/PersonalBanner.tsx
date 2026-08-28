import React, { useState, useEffect } from 'react';
import { Sparkles, Sun, Sunrise, Sunset, Moon, RefreshCw, ShieldCheck, Scale, Leaf, HeartHandshake, Eye, Award, Users, HardHat, GraduationCap, Megaphone } from 'lucide-react';
import { toPersianDigits, getTodayJalaliDate } from '../../utils';
import { User, FairTradePrinciple } from '../../types';

interface PersonalBannerProps {
  user: User;
  onLogout?: () => Promise<void> | void;
}

export const FAIR_TRADE_PRINCIPLES: FairTradePrinciple[] = [
  {
    number: 1,
    title: 'ایجاد فرصت برای تولیدکنندگان محروم اقتصادی',
    description: 'حمایت و توانمندسازی کارگاه‌ها و سازندگان خرد برای دستیابی به استقلال مالی و امنیت پایدار شغلی.',
    icon: HeartHandshake,
    tag: 'حمایت و اشتغال',
  },
  {
    number: 2,
    title: 'شفافیت و پاسخگویی در تمام سطوح',
    description: 'مدیریت شفاف، ارتباط باز با همکاران و زنجیره تامین و مشارکت دادن اعضا در تصمیم‌گیری‌های کلیدی.',
    icon: Eye,
    tag: 'شفافیت سازمانی',
  },
  {
    number: 3,
    title: 'شیوه‌های تجاری منصفانه و تعهد بلندمدت',
    description: 'تعهد به همکاری پایدار، حفظ هویت فرهنگی محصولات و عدم بیشینه‌سازی سود به بهای تضعیف همکاران.',
    icon: Scale,
    tag: 'عدالت در دادوستد',
  },
  {
    number: 4,
    title: 'پرداخت دستمزد و بهای منصفانه',
    description: 'توافق بر سر قیمت و دستمزد عادلانه با مشارکت تولیدکننده که تامین‌کننده یک زندگی شایسته و شرافتمندانه باشد.',
    icon: Award,
    tag: 'دستمزد شایسته',
  },
  {
    number: 5,
    title: 'عدم استفاده از کار کودکان و کار اجباری',
    description: 'رعایت کامل حقوق و کرامت انسانی، پیشگیری از هرگونه استثمار و تضمین حق آموزش و رشد برای کودکان.',
    icon: ShieldCheck,
    tag: 'کرامت انسانی',
  },
  {
    number: 6,
    title: 'تعهد به عدم تبعیض، برابری جنسیتی و توانمندسازی زنان',
    description: 'فرصت‌های شغلی و دستمزد برابر، شایسته‌سالاری فارغ از جنسیت، قومیت یا عقیده و احترام به حق تشکل‌یابی.',
    icon: Users,
    tag: 'برابری و شایستگی',
  },
  {
    number: 7,
    title: 'تضمین شرایط کاری ایمن و محیط بهداشتی',
    description: 'فراهم‌سازی محیط کار سالم، تجهیزات حفاظت فردی، ارگونومی کارگاهی و ساعات کاری استاندارد.',
    icon: HardHat,
    tag: 'سلامت و ایمنی کار',
  },
  {
    number: 8,
    title: 'ارتقای ظرفیت‌ها و توانمندسازی مهارتی',
    description: 'آموزش پیوسته، رشد مهارت‌های فردی و مدیریتی همکاران و توسعه استعدادهای کارگاهی.',
    icon: GraduationCap,
    tag: 'آموزش و بالندگی',
  },
  {
    number: 9,
    title: 'ترویج و آگاهی‌بخشی درباره تجارت منصفانه',
    description: 'معرفی اهداف تجارت عادلانه به جامعه، آگاهی‌بخشی به مشتریان و ترویج الگوهای مصرف اخلاقی و مسئولانه.',
    icon: Megaphone,
    tag: 'ترویج فرهنگ انصاف',
  },
  {
    number: 10,
    title: 'حفاظت از محیط زیست و تولید پایدار',
    description: 'بهینه‌سازی مصرف مواد اولیه، کاهش ضایعات کارگاهی، استفاده از بسته‌بندی‌های تجدیدپذیر و انرژی پاک.',
    icon: Leaf,
    tag: 'پایداری زیست‌محیطی',
  },
];

export function PersonalBanner({ user }: PersonalBannerProps) {
  const [currentTime, setCurrentTime] = useState<string>('');
  const [currentDateStr, setCurrentDateStr] = useState<string>('');

  // Random Fair Trade Principle on load
  const [principleIndex, setPrincipleIndex] = useState<number>(() => {
    return Math.floor(Math.random() * FAIR_TRADE_PRINCIPLES.length);
  });

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const seconds = String(now.getSeconds()).padStart(2, '0');
      setCurrentTime(`${toPersianDigits(hours)}:${toPersianDigits(minutes)}:${toPersianDigits(seconds)}`);
    };

    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      const now = new Date();
      const dayName = new Intl.DateTimeFormat('fa-IR', { weekday: 'long' }).format(now);
      const dayNum = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { day: 'numeric' }).format(now);
      const monthName = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { month: 'long' }).format(now);
      const yearNum = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric' }).format(now);
      setCurrentDateStr(`${dayName}، ${toPersianDigits(dayNum)} ${monthName} ${toPersianDigits(yearNum)}`);
    } catch {
      setCurrentDateStr(getTodayJalaliDate());
    }
  }, []);

  // Time of day greeting
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 11) {
      return { text: 'صبح بخیر و پر از انگیزه', icon: Sunrise, bgGradient: 'from-amber-500/10 via-orange-500/5 to-transparent', iconColor: 'text-amber-500' };
    } else if (hour >= 11 && hour < 16) {
      return { text: 'ظهر بخیر و روزتان پربرکت', icon: Sun, bgGradient: 'from-sky-500/10 via-blue-500/5 to-transparent', iconColor: 'text-sky-500' };
    } else if (hour >= 16 && hour < 20) {
      return { text: 'عصر بخیر و خدا قوت', icon: Sunset, bgGradient: 'from-indigo-500/10 via-purple-500/5 to-transparent', iconColor: 'text-indigo-500' };
    } else {
      return { text: 'شب بخیر و لحظاتتان آرام', icon: Moon, bgGradient: 'from-purple-900/10 via-slate-800/5 to-transparent', iconColor: 'text-purple-400' };
    }
  };

  const greeting = getGreeting();
  const GreetingIcon = greeting.icon;

  const handleNextPrinciple = () => {
    setPrincipleIndex((prev) => (prev + 1) % FAIR_TRADE_PRINCIPLES.length);
  };

  const currentPrinciple = FAIR_TRADE_PRINCIPLES[principleIndex];
  const PrincipleIcon = currentPrinciple.icon;
  const displayName = user?.full_name || (user as any)?.fullName || user?.username || 'کاربر گرامی';

  return (
    <div className={`relative overflow-hidden bg-white border border-slate-200/80 rounded-3xl p-5 sm:p-6 shadow-xs bg-gradient-to-r ${greeting.bgGradient} transition-all`}>
      {/* Decorative background glow */}
      <div className="absolute top-0 left-0 -mt-8 -ml-8 w-44 h-44 bg-blue-400/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-0 -mb-8 -mr-8 w-44 h-44 bg-emerald-400/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 flex flex-col items-start justify-between gap-5">
        {/* Main greeting info and 10 Principles of Fair Trade */}
        <div className="space-y-2.5 w-full">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border border-slate-200 bg-white/90 backdrop-blur-xs shadow-xs ${greeting.iconColor}`}>
              <GreetingIcon size={14} className="animate-pulse" />
              {greeting.text}
            </span>
            <span className="text-xs text-slate-500 font-medium bg-slate-100/80 px-2.5 py-1 rounded-full">
              📅 {currentDateStr}
            </span>
            <span className="text-xs text-slate-600 font-bold bg-slate-100/80 px-2.5 py-1 rounded-full">
              ⏰ {currentTime}
            </span>
          </div>

          <h1 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight flex items-center gap-2">
            سلام، {displayName} عزیز!
            <span className="text-xl animate-bounce">👋</span>
          </h1>

          {/* 10 Principles of Fair Trade Box */}
          <div className="flex items-start gap-3 pt-1 text-slate-600 text-xs sm:text-sm leading-relaxed bg-white/80 backdrop-blur-xs p-3.5 sm:p-4 rounded-2xl border border-emerald-100 shadow-2xs">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold shrink-0 border border-emerald-200/60 shadow-2xs">
              <PrincipleIcon size={18} />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className="text-[11px] font-extrabold px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800">
                  اصل {toPersianDigits(currentPrinciple.number)} از ۱۰ تجارت عادلانه
                </span>
                <span className="text-xs font-extrabold text-slate-800 truncate">
                  {currentPrinciple.title}
                </span>
              </div>
              <p className="text-xs text-slate-600 font-medium leading-relaxed">
                {currentPrinciple.description}
              </p>
            </div>

            <button
              onClick={handleNextPrinciple}
              title="اصل بعدی تجارت عادلانه"
              className="flex items-center gap-1 p-2 text-slate-400 hover:text-emerald-700 hover:bg-emerald-50 rounded-xl transition-colors shrink-0 border border-slate-200/60 bg-white"
            >
              <RefreshCw size={13} className="hover:rotate-180 transition-transform duration-500" />
              <span className="text-[10px] font-bold hidden sm:inline text-slate-500">اصل بعدی</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
