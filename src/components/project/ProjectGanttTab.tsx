import React from 'react';
import { Calendar, Clock, CheckCircle2, AlertCircle, PlayCircle, Tag } from 'lucide-react';
import { ProductionProject, ProjectStage, ProjectProductItem } from '../../types';
import { toPersianDigits } from '../../utils';

interface ProjectGanttTabProps {
  project: ProductionProject;
}

export default function ProjectGanttTab({ project }: ProjectGanttTabProps) {
  // V3.1.0: مراحل ساختگی با پیشرفت جعلی ۶۰٪ حذف شد — Empty State صادقانه
  const stages: ProjectStage[] = (Array.isArray(project.stages) ? project.stages : []) as any;

  const products: ProjectProductItem[] = Array.isArray(project.products) && project.products.length > 0
    ? project.products
    : project.item_id ? [{
        id: 'prod-main',
        item_id: project.item_id,
        item_code: project.item_code || '',
        item_name: project.item_name || '',
        customer_code: '',
        quantity: project.quantity || 100,
        unit: project.unit || 'عدد',
        needs_assembly: true
      }] : [];

  const getStatusBadge = (status: string, progress: number) => {
    if (status === 'completed' || progress === 100) {
      return (
        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-md text-[10px] font-bold flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
          تکمیل شده
        </span>
      );
    }
    if (status === 'in_progress' || progress > 0) {
      return (
        <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded-md text-[10px] font-bold flex items-center gap-1">
          <PlayCircle className="w-3 h-3 text-blue-600" />
          در حال انجام ({progress}٪)
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-md text-[10px] font-semibold flex items-center gap-1">
        <Clock className="w-3 h-3 text-slate-400" />
        در انتظار شروع
      </span>
    );
  };

  return (
    <div className="space-y-6 text-xs animate-fadeIn">
      {/* Overview Dates Bar */}
      <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-400 text-slate-950 font-bold flex items-center justify-center">
            <Calendar className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-bold text-slate-900 text-xs">زمان‌بندی فرآیند تولید و تحویل پروژه</h4>
            <p className="text-[11px] text-slate-500 mt-0.5">برنامه‌ریزی زمانی به تفکیک {toPersianDigits(stages.length)} مرحله فرآیند تولید و کدهای محصولات</p>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs font-mono">
          <div className="bg-white px-3 py-1.5 rounded-xl border border-slate-200">
            <span className="text-slate-400 text-[10px] block">تاریخ شروع:</span>
            <span className="font-bold text-slate-800">{project.start_date || 'تعیین‌نشده'}</span>
          </div>
          <div className="bg-white px-3 py-1.5 rounded-xl border border-slate-200">
            <span className="text-slate-400 text-[10px] block">تاریخ تحویل هدف:</span>
            <span className="font-bold text-amber-700">{project.end_date || 'تعیین‌نشده'}</span>
          </div>
        </div>
      </div>

        {/* Gantt / Stage Progress Chart */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4 shadow-2xs">
          <h4 className="font-bold text-slate-900 text-xs border-b border-slate-100 pb-2">
            نمودار پیشرفت خط تولید (Gantt Progress)
          </h4>

          {stages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-slate-400 gap-1.5 text-center">
              <Clock className="w-7 h-7 text-slate-300" />
              <p className="font-bold text-slate-600">هیچ مرحله‌ای برای این پروژه تعریف نشده است</p>
              <p className="text-[11px]">مراحل از تنظیمات (پریست گردش کار) یا دکمه «افزودن مرحله» تعریف کنید.</p>
            </div>
          ) : (
          <div className="space-y-4">
            {stages.map((stg) => {
              const isAssemblyStage = stg.title.includes('مونتاژ');
              // V3.1.0: دیگر درصد ساختگی (۵۰٪ برای in_progress) — فقط داده واقعی
              const prog = stg.progress_percent || (stg.status === 'completed' ? 100 : 0);

            return (
              <div key={stg.id} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-md bg-slate-900 text-amber-400 font-bold flex items-center justify-center text-[10px]">
                      {stg.stage_order || stg.id}
                    </span>
                    <span className="font-bold text-slate-800">{stg.title}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {getStatusBadge(stg.status, prog)}
                    <span className="font-mono font-bold text-slate-700 w-10 text-left">{prog}٪</span>
                  </div>
                </div>

                {/* Progress Bar Container */}
                <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden p-0.5 border border-slate-200">
                  <div 
                    className={`h-full rounded-full transition-all duration-500 ${
                      prog === 100 
                        ? 'bg-emerald-500' 
                        : prog > 0 
                        ? 'bg-amber-400' 
                        : 'bg-slate-300'
                    }`}
                    style={{ width: `${Math.max(3, prog)}%` }}
                  />
                </div>

                {/* Product specifics under stage */}
                <div className="flex flex-wrap gap-2 pt-1 pr-7">
                  {products.map((p) => {
                    const isSkippedAssembly = isAssemblyStage && p.needs_assembly === false;
                    return (
                      <span 
                        key={p.id} 
                        className={`px-2 py-0.5 rounded text-[10px] font-mono border ${
                          isSkippedAssembly 
                            ? 'bg-slate-50 text-slate-400 border-slate-200 line-through' 
                            : 'bg-amber-50 text-amber-900 border-amber-200 font-semibold'
                        }`}
                      >
                        {p.item_name} {p.customer_code ? `[کد مشتری: ${p.customer_code}]` : ''} {isSkippedAssembly ? '(بدون مونتاژ)' : ''}
                      </span>
                    );
                  })}
                </div>
              </div>
            );
              })}
          </div>
          )}
        </div>
      </div>
  );
}
