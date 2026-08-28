import React, { useState, useMemo } from 'react';
import { 
  APP_FEATURES, 
  TECH_STACK, 
  SYSTEM_UPDATES, 
  getLatestAppVersion,
  AppFeature, 
  TechStackItem, 
  AIUpdateLog 
} from '../data/appInfoAndChangelog';
import { formatPersianNumber } from '../utils';
import { 
  Building2, 
  Calculator, 
  FileOutput, 
  DollarSign, 
  ClipboardList, 
  Image as ImageIcon, 
  Activity, 
  ShieldCheck, 
  Layers, 
  Cpu, 
  Sparkles, 
  Code2, 
  CheckCircle2, 
  History, 
  BookOpen, 
  Terminal,
  Server,
  Database,
  Lock,
  Users,
  ShoppingCart,
  FileSpreadsheet,
  AlertTriangle,
  GitMerge,
  FileCheck,
  Search,
  X,
  Filter,
  Check,
  Tag,
  CheckCircle,
  Scale,
  Boxes,
  Radio,
  ShieldAlert,
  FileText,
  Landmark
} from 'lucide-react';

export default function ChangelogPage() {
  const [activeSection, setActiveSection] = useState<'all' | 'features' | 'tech' | 'updates'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const getFeatureIcon = (iconName: string) => {
    switch (iconName) {
      case 'Building2': return <Building2 className="text-blue-600" size={20} />;
      case 'Calculator': return <Calculator className="text-emerald-600" size={20} />;
      case 'FileOutput': return <FileOutput className="text-purple-600" size={20} />;
      case 'DollarSign': return <DollarSign className="text-amber-600" size={20} />;
      case 'ClipboardList': return <ClipboardList className="text-indigo-600" size={20} />;
      case 'Image': return <ImageIcon className="text-pink-600" size={20} />;
      case 'Activity': return <Activity className="text-teal-600" size={20} />;
      case 'ShieldCheck': return <ShieldCheck className="text-cyan-600" size={20} />;
      case 'Layers': return <Layers className="text-violet-600" size={20} />;
      case 'Users': return <Users className="text-orange-600" size={20} />;
      case 'ShoppingCart': return <ShoppingCart className="text-rose-600" size={20} />;
      case 'FileSpreadsheet': return <FileSpreadsheet className="text-emerald-600" size={20} />;
      case 'AlertTriangle': return <AlertTriangle className="text-amber-600" size={20} />;
      case 'BookOpen': return <BookOpen className="text-blue-600" size={20} />;
      case 'GitMerge': return <GitMerge className="text-indigo-600" size={20} />;
      case 'Cpu': return <Cpu className="text-purple-600" size={20} />;
      case 'History': return <History className="text-amber-600" size={20} />;
      case 'FileCheck': return <FileCheck className="text-emerald-600" size={20} />;
      case 'Database': return <Database className="text-cyan-600" size={20} />;
      case 'FileText': return <FileText className="text-blue-600" size={20} />;
      case 'Landmark': return <Landmark className="text-emerald-600" size={20} />;
      case 'Lock': return <Lock className="text-rose-600" size={20} />;
      case 'Scale': return <Scale className="text-indigo-600" size={20} />;
      case 'Boxes': return <Boxes className="text-teal-600" size={20} />;
      case 'Radio': return <Radio className="text-violet-600" size={20} />;
      case 'ShieldAlert': return <ShieldAlert className="text-rose-600" size={20} />;
      case 'CheckCircle': return <CheckCircle className="text-emerald-600" size={20} />;
      default: return <Sparkles className="text-blue-600" size={20} />;
    }
  };

  const getTechCategoryIcon = (category: string) => {
    if (category.includes('فرانت‌اند')) return <Code2 size={18} className="text-blue-500" />;
    if (category.includes('بک‌اند')) return <Server size={18} className="text-emerald-500" />;
    if (category.includes('پایگاه‌داده')) return <Database size={18} className="text-amber-500" />;
    return <Lock size={18} className="text-purple-500" />;
  };

  // Extract unique feature categories
  const featureCategories = useMemo(() => {
    const set = new Set<string>();
    APP_FEATURES.forEach(f => set.add(f.category));
    return Array.from(set);
  }, []);

  // Filter features
  const filteredFeatures = useMemo(() => {
    return APP_FEATURES.filter(f => {
      const matchesCat = selectedCategory === 'all' || f.category === selectedCategory;
      const matchesQuery = !searchQuery.trim() || 
        f.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
        f.description.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCat && matchesQuery;
    });
  }, [selectedCategory, searchQuery]);

  // Filter tech stack
  const filteredTech = useMemo(() => {
    return TECH_STACK.filter(t => {
      if (!searchQuery.trim()) return true;
      return t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.role.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.category.toLowerCase().includes(searchQuery.toLowerCase());
    });
  }, [searchQuery]);

  // Filter system updates
  const filteredUpdates = useMemo(() => {
    return SYSTEM_UPDATES.filter(u => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return u.version.toLowerCase().includes(q) ||
        u.title.toLowerCase().includes(q) ||
        u.summary.toLowerCase().includes(q) ||
        u.changes.some(c => c.toLowerCase().includes(q)) ||
        (u.fixes && u.fixes.some(f => f.toLowerCase().includes(q)));
    });
  }, [searchQuery]);

  // Group tech stack by category
  const techCategories = Array.from(new Set<string>(filteredTech.map(t => t.category)));

  return (
    <div className="space-y-8 max-w-5xl mx-auto font-sans pb-12" dir="rtl">
      
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white rounded-2xl p-6 sm:p-8 shadow-lg border border-slate-700/50 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="space-y-2 max-w-2xl">
          <div className="inline-flex items-center gap-2 bg-blue-500/20 text-blue-300 border border-blue-500/30 px-3 py-1 rounded-full text-xs font-bold">
            <Sparkles size={14} />
            <span>معرفی کامل سیستم و به‌روزرسانی‌های هوشمند</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
            شناسنامه فنی، قابلیت‌ها و تاریخچه سیستم
          </h1>
          <p className="text-sm text-slate-300 leading-relaxed">
            بررسی تمام ماژول‌های فعال، معماری توسعه و تاریخچه به‌روزرسانی‌های سامانه یکپارچه مدیریت کارگاه و ERP پاپیتال.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:flex sm:items-center gap-3 self-stretch md:self-auto shrink-0">
          <div className="bg-slate-800/90 border border-slate-700 p-3.5 rounded-xl text-center min-w-[120px]">
            <div className="text-[11px] text-slate-400 mb-0.5">نسخه فعال</div>
            <div className="text-xl font-black text-emerald-400 font-mono" dir="ltr">{getLatestAppVersion()}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">پاپیتال ERP</div>
          </div>
          <div className="bg-slate-800/90 border border-slate-700 p-3.5 rounded-xl text-center min-w-[120px]">
            <div className="text-[11px] text-slate-400 mb-0.5">ماژول‌های اصلی</div>
            <div className="text-xl font-black text-blue-400 font-mono">{formatPersianNumber(APP_FEATURES.length)}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">قابلیت کلیدی</div>
          </div>
        </div>
      </div>

      {/* Control Bar: Search and Section Navigation */}
      <div className="space-y-4 bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          
          {/* Section Selector Buttons */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
            <button
              onClick={() => setActiveSection('all')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
                activeSection === 'all' 
                  ? 'bg-blue-600 text-white shadow-sm' 
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Layers size={15} />
              <span>همه بخش‌ها</span>
            </button>

            <button
              onClick={() => setActiveSection('features')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
                activeSection === 'features' 
                  ? 'bg-blue-600 text-white shadow-sm' 
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Sparkles size={15} />
              <span>۱. قابلیت‌ها ({formatPersianNumber(APP_FEATURES.length)})</span>
            </button>

            <button
              onClick={() => setActiveSection('tech')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
                activeSection === 'tech' 
                  ? 'bg-blue-600 text-white shadow-sm' 
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Cpu size={15} />
              <span>۲. تکنولوژی‌ها ({formatPersianNumber(TECH_STACK.length)})</span>
            </button>

            <button
              onClick={() => setActiveSection('updates')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
                activeSection === 'updates' 
                  ? 'bg-blue-600 text-white shadow-sm' 
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <History size={15} />
              <span>۳. به‌روزرسانی‌ها ({formatPersianNumber(SYSTEM_UPDATES.length)})</span>
            </button>
          </div>

          {/* Search Box */}
          <div className="relative w-full md:w-72">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="جستجو در قابلیت‌ها و تغییرات..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pr-9 pl-8 py-2 text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Feature Category Filter (Only when viewing Features or All) */}
        {(activeSection === 'all' || activeSection === 'features') && (
          <div className="flex items-center gap-2 pt-2 border-t border-slate-100 overflow-x-auto text-xs">
            <span className="text-slate-500 font-bold shrink-0 flex items-center gap-1">
              <Filter size={13} />
              <span>دسته ویژگی:</span>
            </span>
            <button
              onClick={() => setSelectedCategory('all')}
              className={`px-2.5 py-1 rounded-lg transition-all ${
                selectedCategory === 'all'
                  ? 'bg-slate-900 text-white font-bold'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              همه ({formatPersianNumber(APP_FEATURES.length)})
            </button>
            {featureCategories.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-2.5 py-1 rounded-lg transition-all whitespace-nowrap ${
                  selectedCategory === cat
                    ? 'bg-slate-900 text-white font-bold'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {cat} ({formatPersianNumber(APP_FEATURES.filter(f => f.category === cat).length)})
              </button>
            ))}
          </div>
        )}
      </div>

      {/* SECTION 1: APP FEATURES */}
      {(activeSection === 'all' || activeSection === 'features') && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <Sparkles className="text-blue-600" size={20} />
              <span>۱. قابلیت‌ها و امکانات اصلی سامانه</span>
            </h2>
            <span className="text-xs text-slate-500 font-medium">
              {formatPersianNumber(filteredFeatures.length)} مورد نمایش داده شده
            </span>
          </div>

          {filteredFeatures.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-500 text-xs">
              هیچ ویژگی با عبارات یا دسته‌بندی جستجو شده پیدا نشد.
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredFeatures.map(feature => (
                <div 
                  key={feature.id} 
                  className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between group"
                >
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-lg group-hover:scale-105 transition-transform">
                        {getFeatureIcon(feature.iconName)}
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200/60">
                        {feature.category}
                      </span>
                    </div>
                    <h3 className="font-bold text-slate-800 text-sm mb-1.5">{feature.title}</h3>
                    <p className="text-xs text-slate-500 leading-relaxed">{feature.description}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* SECTION 2: TECH STACK */}
      {(activeSection === 'all' || activeSection === 'tech') && (
        <section className="space-y-4 pt-4 border-t border-slate-200">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <Cpu className="text-emerald-600" size={20} />
              <span>۲. تکنولوژی‌ها و معماری توسعه (Tech Stack)</span>
            </h2>
            <span className="text-xs text-slate-500 font-medium">معماری فول‌استک مدرن</span>
          </div>

          {filteredTech.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-500 text-xs">
              هیچ تکنولوژی با عبارت جستجو شده یافت نشد.
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {techCategories.map(cat => (
                <div key={cat} className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3">
                  <div className="flex items-center gap-2 font-bold text-sm text-slate-800 border-b pb-2.5 border-slate-100">
                    {getTechCategoryIcon(cat)}
                    <span>{cat}</span>
                  </div>

                  <div className="space-y-2">
                    {filteredTech.filter(t => t.category === cat).map((item, idx) => (
                      <div key={idx} className="p-2.5 bg-slate-50 rounded-lg border border-slate-100 flex items-start justify-between gap-3">
                        <div>
                          <div className="font-bold text-xs text-slate-800">{item.name}</div>
                          <div className="text-[11px] text-slate-500 mt-0.5">{item.role}</div>
                        </div>
                        <CheckCircle2 size={16} className="text-emerald-500 shrink-0 mt-0.5" />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* SECTION 3: AI CHANGELOG & UPDATES */}
      {(activeSection === 'all' || activeSection === 'updates') && (
        <section className="space-y-4 pt-4 border-t border-slate-200">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <History className="text-indigo-600" size={20} />
                <span>۳. تاریخچه به روزرسانی‌های سیستم به همراه جزییات فنی</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                لیست جامع به‌روزرسانی‌ها و رفع اشکالات انجام‌شده در نسخه‌های مختلف نرم‌افزار.
              </p>
            </div>

            <div className="bg-indigo-50 border border-indigo-200 text-indigo-700 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2 shrink-0">
              <Terminal size={14} />
              <span>ثبت خودکار با پروتکل AGENTS.md</span>
            </div>
          </div>

          {filteredUpdates.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-500 text-xs">
              هیچ به‌روزرسانی با عبارت مورد نظر پیدا نشد.
            </div>
          ) : (
            <div className="space-y-6 relative before:absolute before:inset-0 before:mr-5 before:h-full before:w-0.5 before:bg-slate-200">
              {filteredUpdates.map((log, idx) => (
                <div key={idx} className="relative flex items-start gap-4 group">
                  {/* Version badge node */}
                  <div className="w-10 h-10 rounded-xl bg-slate-900 text-white border-2 border-white shadow flex items-center justify-center font-mono font-bold text-xs shrink-0 z-10 mt-1">
                    v{log.version}
                  </div>

                  <div className="flex-1 bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 border-b pb-2 border-slate-100">
                      <h3 className="font-bold text-slate-800 text-sm">{log.title}</h3>
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <time className="font-mono bg-slate-100 px-2 py-0.5 rounded text-[11px]" dir="ltr">
                          {log.date}
                        </time>
                        {log.author && (
                          <span className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full font-bold">
                            {log.author}
                          </span>
                        )}
                      </div>
                    </div>

                    <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                      {log.summary}
                    </p>

                    <div className="space-y-2 text-xs">
                      {log.changes && log.changes.length > 0 && (
                        <div>
                          <span className="font-bold text-emerald-700 block mb-1">تغییرات و قابلیت‌های اضافه‌شده:</span>
                          <ul className="space-y-1 pr-2">
                            {log.changes.map((c, i) => (
                              <li key={i} className="flex items-start gap-2 text-slate-700">
                                <span className="text-emerald-500 font-bold">•</span>
                                <span>{c}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {log.fixes && log.fixes.length > 0 && (
                        <div className="mt-2">
                          <span className="font-bold text-amber-700 block mb-1">اصلاحات و رفع اشکال:</span>
                          <ul className="space-y-1 pr-2">
                            {log.fixes.map((f, i) => (
                              <li key={i} className="flex items-start gap-2 text-slate-700">
                                <span className="text-amber-500 font-bold">•</span>
                                <span>{f}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

    </div>
  );
}
