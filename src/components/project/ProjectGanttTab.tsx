import { useState, useMemo } from 'react';
import { Calendar, Clock, CheckCircle2, PlayCircle, Tag, BarChart3 } from 'lucide-react';
import { ProductionProject, ProjectStage, ProjectProductItem } from '../../types';
import { toPersianDigits } from '../../utils';

interface ProjectGanttTabProps {
  project: ProductionProject;
  onUpdate?: () => void;
}

// Convert Jalali or ISO date string (YYYY/MM/DD or YYYY-MM-DD) to comparable timestamp
function parseDateToTimestamp(dateStr?: string): number | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const clean = dateStr.trim().replace(/-/g, '/');
  const parts = clean.split('/').map(p => parseInt(p, 10));
  if (parts.length < 3 || isNaN(parts[0]) || isNaN(parts[1]) || isNaN(parts[2])) {
    return null;
  }
  // Approximate day index for relative positioning (support both Jalali 14xx and Gregorian 20xx)
  return parts[0] * 365 + parts[1] * 30 + parts[2];
}

// Calculate days difference
function getDaysDiff(startVal: number, endVal: number): number {
  return Math.max(1, endVal - startVal + 1);
}

export default function ProjectGanttTab({ project, onUpdate }: ProjectGanttTabProps) {
  const [selectedProductId, setSelectedProductId] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'in_progress' | 'pending'>('all');
  const [activeViewMode, setActiveViewMode] = useState<'interactive' | 'timeline' | 'summary'>('interactive');

  // Stages & Products
  const stages: ProjectStage[] = useMemo(() => {
    const raw = Array.isArray(project.stages) ? project.stages : [];
    return [...raw].sort((a, b) => (Number(a.stage_order || a.id) - Number(b.stage_order || b.id)));
  }, [project.stages]);

  const products: ProjectProductItem[] = useMemo(() => {
    return Array.isArray(project.products) && project.products.length > 0
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
  }, [project]);

  // Schedules map from project stage_schedules
  const stageSchedules = project.stage_schedules || {};

  // Timeline global bounds calculation
  const timelineBounds = useMemo(() => {
    let minDay: number | null = parseDateToTimestamp(project.start_date);
    let maxDay: number | null = parseDateToTimestamp(project.end_date);

    stages.forEach(stg => {
      const stgStart = parseDateToTimestamp(stg.start_date);
      const stgEnd = parseDateToTimestamp(stg.end_date);
      if (stgStart) minDay = minDay ? Math.min(minDay, stgStart) : stgStart;
      if (stgEnd) maxDay = maxDay ? Math.max(maxDay, stgEnd) : stgEnd;

      const schedObj = stageSchedules[stg.id] || {};
      Object.values(schedObj).forEach((pSched: any) => {
        const pStart = parseDateToTimestamp(pSched.startDate);
        const pEnd = parseDateToTimestamp(pSched.endDate);
        if (pStart) minDay = minDay ? Math.min(minDay, pStart) : pStart;
        if (pEnd) maxDay = maxDay ? Math.max(maxDay, pEnd) : pEnd;
      });
    });

    if (!minDay) minDay = 1404 * 365 + 1 * 30 + 1;
    if (!maxDay || maxDay <= minDay) maxDay = minDay + 30; // fallback 30 days span

    const totalDays = Math.max(1, maxDay - minDay);
    return { minDay, maxDay, totalDays };
  }, [project.start_date, project.end_date, stages, stageSchedules]);

  // Filtered stages
  const filteredStages = useMemo(() => {
    return stages.filter(stg => {
      if (statusFilter === 'all') return true;
      const prog = Number(stg.progress_percent || (stg.status === 'completed' ? 100 : 0));
      if (statusFilter === 'completed') return stg.status === 'completed' || prog === 100;
      if (statusFilter === 'in_progress') return stg.status === 'in_progress' || (prog > 0 && prog < 100);
      if (statusFilter === 'pending') return stg.status === 'pending' || prog === 0;
      return true;
    });
  }, [stages, statusFilter]);

  // Overall Project Progress Metrics
  const projectMetrics = useMemo(() => {
    if (stages.length === 0) return { overallProgress: 0, completedCount: 0, inProgressCount: 0, pendingCount: 0, criticalCount: 0 };

    let totalProg = 0;
    let completed = 0;
    let inProgress = 0;
    let pending = 0;
    let critical = 0;

    stages.forEach(stg => {
      const prog = Number(stg.progress_percent || (stg.status === 'completed' ? 100 : 0));
      totalProg += prog;
      if (prog === 100 || stg.status === 'completed') {
        completed++;
      } else if (prog > 0 || stg.status === 'in_progress') {
        inProgress++;
      } else {
        pending++;
      }

      // Check if stage is delayed or close to target date with 0% progress
      if (prog < 100 && stg.end_date && project.end_date && stg.end_date >= project.end_date) {
        critical++;
      }
    });

    return {
      overallProgress: Math.round(totalProg / stages.length),
      completedCount: completed,
      inProgressCount: inProgress,
      pendingCount: pending,
      criticalCount: critical
    };
  }, [stages, project.end_date]);

  const getStatusBadge = (status: string, progress: number) => {
    if (status === 'completed' || progress === 100) {
      return (
        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-md text-[10px] font-bold flex items-center gap-1 border border-emerald-300">
          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
          تکمیل شده
        </span>
      );
    }
    if (status === 'in_progress' || progress > 0) {
      return (
        <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded-md text-[10px] font-bold flex items-center gap-1 border border-blue-300">
          <PlayCircle className="w-3 h-3 text-blue-600" />
          در حال انجام ({toPersianDigits(progress)}٪)
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-md text-[10px] font-semibold flex items-center gap-1 border border-slate-200">
        <Clock className="w-3 h-3 text-slate-400" />
        در انتظار شروع
      </span>
    );
  };

  return (
    <div className="space-y-4 text-xs animate-fadeIn font-farsi">
      {/* 1. Header Overview & Progress Cockpit */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-100 text-amber-900 border border-amber-300 font-bold flex items-center justify-center shrink-0 shadow-2xs">
              <BarChart3 className="w-5 h-5 text-amber-700" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="font-bold text-slate-900 text-sm">نمودار گانت، مسیر بحرانی و زمان‌بندی خط تولید</h4>
                <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-900 font-bold text-[10px] border border-amber-200">
                  {toPersianDigits(stages.length)} مرحله تولیدی
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                ردیابی تقویمی پیشرفت مراحل، همپوشانی وظایف محصولات و تحلیل توالی تحویل سفارشات کارگاهی
              </p>
            </div>
          </div>

          {/* Planned Dates Summary */}
          <div className="flex items-center gap-2.5 font-mono text-xs">
            <div className="bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
              <span className="text-slate-400 text-[10px] block font-sans">تاریخ شروع پروژه:</span>
              <span className="font-bold text-slate-800">{project.start_date || 'تعیین‌نشده'}</span>
            </div>
            <div className="bg-amber-50 px-3 py-1.5 rounded-xl border border-amber-200">
              <span className="text-amber-800 text-[10px] block font-sans font-bold">موعد تحویل تعهدشده:</span>
              <span className="font-bold text-amber-900">{project.end_date || 'تعیین‌نشده'}</span>
            </div>
          </div>
        </div>

        {/* Metric Badges */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 pt-2 border-t border-slate-100">
          <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200">
            <span className="text-[10px] text-slate-500 block">پیشرفت کل پروژه</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-base font-bold font-mono text-amber-900">
                {toPersianDigits(projectMetrics.overallProgress)}٪
              </span>
            </div>
          </div>

          <div className="p-2.5 bg-emerald-50/60 rounded-xl border border-emerald-200">
            <span className="text-[10px] text-emerald-800 block">مراحل تکمیل‌شده</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-base font-bold font-mono text-emerald-900">
                {toPersianDigits(projectMetrics.completedCount)}
              </span>
              <span className="text-[10px] text-emerald-700 font-sans">مرحله</span>
            </div>
          </div>

          <div className="p-2.5 bg-blue-50/60 rounded-xl border border-blue-200">
            <span className="text-[10px] text-blue-800 block">مراحل در جریان</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-base font-bold font-mono text-blue-900">
                {toPersianDigits(projectMetrics.inProgressCount)}
              </span>
              <span className="text-[10px] text-blue-700 font-sans">مرحله</span>
            </div>
          </div>

          <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200">
            <span className="text-[10px] text-slate-500 block">مراحل در انتظار</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-base font-bold font-mono text-slate-700">
                {toPersianDigits(projectMetrics.pendingCount)}
              </span>
              <span className="text-[10px] text-slate-500 font-sans">مرحله</span>
            </div>
          </div>

          <div className="p-2.5 bg-rose-50/60 rounded-xl border border-rose-200 col-span-2 sm:col-span-1">
            <span className="text-[10px] text-rose-800 block">نقاط بحرانی/حساس</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-base font-bold font-mono text-rose-900">
                {toPersianDigits(projectMetrics.criticalCount)}
              </span>
              <span className="text-[10px] text-rose-700 font-sans">ریسک تاخیر</span>
            </div>
          </div>
        </div>

        {/* Global Progress Bar */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px] text-slate-500">
            <span>راندمان تحقق فیزیکی کل مراحل تولید:</span>
            <span className="font-mono font-bold text-slate-800">{toPersianDigits(projectMetrics.overallProgress)}٪</span>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden p-0.5 border border-slate-200">
            <div 
              className={`h-full rounded-full transition-all duration-700 ${
                projectMetrics.overallProgress === 100 
                  ? 'bg-emerald-500' 
                  : projectMetrics.overallProgress > 0 
                  ? 'bg-amber-500' 
                  : 'bg-slate-300'
              }`}
              style={{ width: `${Math.max(2, projectMetrics.overallProgress)}%` }}
            />
          </div>
        </div>
      </div>

      {/* 2. Controls & Filtering Bar */}
      <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-2xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Status Filter Buttons */}
          <div className="flex items-center bg-slate-100 p-0.5 rounded-xl border border-slate-200 text-[11px]">
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                statusFilter === 'all' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              همه ({toPersianDigits(stages.length)})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('in_progress')}
              className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                statusFilter === 'in_progress' ? 'bg-white text-blue-800 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              در جریان ({toPersianDigits(projectMetrics.inProgressCount)})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('completed')}
              className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                statusFilter === 'completed' ? 'bg-white text-emerald-800 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              تکمیل‌شده ({toPersianDigits(projectMetrics.completedCount)})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('pending')}
              className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                statusFilter === 'pending' ? 'bg-white text-slate-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              در انتظار ({toPersianDigits(projectMetrics.pendingCount)})
            </button>
          </div>

          {/* Product Filter Selector */}
          {products.length > 1 && (
            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-xl text-[11px]">
              <Tag className="w-3.5 h-3.5 text-slate-400" />
              <label className="font-bold text-slate-600">فیلتر کالا:</label>
              <select
                value={selectedProductId}
                onChange={(e) => setSelectedProductId(e.target.value)}
                className="bg-transparent font-bold text-slate-800 focus:outline-none cursor-pointer"
              >
                <option value="all">همه محصولات ({toPersianDigits(products.length)} قلم)</option>
                {products.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.item_name} {p.customer_code ? `(${p.customer_code})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center bg-slate-100 p-0.5 rounded-xl border border-slate-200 text-[11px]">
          <button
            type="button"
            onClick={() => setActiveViewMode('interactive')}
            className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1 ${
              activeViewMode === 'interactive' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5 text-amber-600" />
            <span>پیشرفت مرحله‌ای</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveViewMode('timeline')}
            className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1 ${
              activeViewMode === 'timeline' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Calendar className="w-3.5 h-3.5 text-blue-600" />
            <span>نوار خط زمانی (Timeline)</span>
          </button>
        </div>
      </div>

      {/* 3. Empty State */}
      {stages.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 mx-auto flex items-center justify-center">
            <Clock className="w-6 h-6" />
          </div>
          <h4 className="font-bold text-slate-800 text-sm">هیچ مرحله تولیدی برای این پروژه تعریف نشده است</h4>
          <p className="text-slate-500 text-xs max-w-md mx-auto leading-relaxed">
            جهت نمایش نمودار گانت، ابتدا مراحل خط تولید را در تب خلاصه‌ی پروژه یا از طریق الگوهای گردش کار تعریف کنید.
          </p>
        </div>
      ) : activeViewMode === 'timeline' ? (
        /* TIMELINE VIEW (Visual Gantt Bar Positioned on Date Grid) */
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4 shadow-2xs overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h4 className="font-bold text-slate-900 text-xs">خط زمانی تقویمی مراحل (Gantt Calendar Grid)</h4>
              <p className="text-[11px] text-slate-500">موقعیت و طول هر نوار بر مبنای تاریخ‌های شروع و پایان هر مرحله محاسبه شده است.</p>
            </div>
            <div className="flex items-center gap-3 text-[10px] text-slate-500">
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded bg-emerald-500 inline-block" /> تکمیل‌شده
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded bg-amber-500 inline-block" /> در جریان
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded bg-slate-300 inline-block" /> در انتظار
              </span>
            </div>
          </div>

          <div className="space-y-4 overflow-x-auto pb-2">
            {filteredStages.map((stg) => {
              const prog = Number(stg.progress_percent || (stg.status === 'completed' ? 100 : 0));
              const stgStart = parseDateToTimestamp(stg.start_date) || timelineBounds.minDay;
              const stgEnd = parseDateToTimestamp(stg.end_date) || timelineBounds.maxDay;

              // Calculate relative left % and width % on timeline
              const leftPercent = Math.max(0, Math.min(95, ((stgStart - timelineBounds.minDay) / timelineBounds.totalDays) * 100));
              const spanDays = getDaysDiff(stgStart, stgEnd);
              const widthPercent = Math.max(8, Math.min(100 - leftPercent, (spanDays / timelineBounds.totalDays) * 100));

              return (
                <div key={stg.id} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-md bg-slate-900 text-amber-400 font-bold flex items-center justify-center text-[10px]">
                        {toPersianDigits(stg.stage_order || stg.id)}
                      </span>
                      <span className="font-bold text-slate-800">{stg.title}</span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        ({stg.start_date || 'شروع نامشخص'} تا {stg.end_date || 'پایان نامشخص'})
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {getStatusBadge(stg.status, prog)}
                      <span className="font-mono font-bold text-slate-700 w-10 text-left">
                        {toPersianDigits(prog)}٪
                      </span>
                    </div>
                  </div>

                  {/* Relative Timeline Bar Track */}
                  <div className="w-full bg-slate-100 rounded-lg h-5 relative overflow-hidden border border-slate-200">
                    <div
                      className={`absolute top-0.5 bottom-0.5 rounded-md transition-all flex items-center justify-between px-2 text-[10px] font-bold text-white shadow-xs ${
                        prog === 100
                          ? 'bg-emerald-600'
                          : prog > 0
                          ? 'bg-amber-500'
                          : 'bg-slate-400'
                      }`}
                      style={{
                        right: `${leftPercent}%`,
                        width: `${widthPercent}%`
                      }}
                      title={`${stg.title}: پیشرفت ${prog}٪`}
                    >
                      <span className="truncate">{stg.title}</span>
                      <span className="font-mono font-bold">{toPersianDigits(prog)}٪</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* INTERACTIVE STAGE PROGRESS VIEW */
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4 shadow-2xs">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <h4 className="font-bold text-slate-900 text-xs">
              مراحل فرآیند تولید و تفکیک وضعیت محصولات
            </h4>
            <span className="text-[11px] text-slate-400">
              نمایش {toPersianDigits(filteredStages.length)} از {toPersianDigits(stages.length)} مرحله
            </span>
          </div>

          <div className="space-y-4 divide-y divide-slate-100">
            {filteredStages.map((stg) => {
              const isAssemblyStage = stg.title.includes('مونتاژ');
              const prog = Number(stg.progress_percent || (stg.status === 'completed' ? 100 : 0));
              const schedObj = stageSchedules[stg.id] || {};

              // Target products for this stage based on selector
              const activeProducts = selectedProductId === 'all' 
                ? products 
                : products.filter(p => p.id === selectedProductId);

              return (
                <div key={stg.id} className="pt-3 first:pt-0 space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-lg bg-slate-900 text-amber-400 font-bold flex items-center justify-center text-xs shrink-0">
                        {toPersianDigits(stg.stage_order || stg.id)}
                      </span>
                      <span className="font-bold text-slate-800 text-xs">{stg.title}</span>
                      {stg.start_date && stg.end_date && (
                        <span className="text-[10px] text-slate-500 font-mono bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                          {stg.start_date} الی {stg.end_date}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-center">
                      {getStatusBadge(stg.status, prog)}
                      <span className="font-mono font-bold text-slate-700 w-10 text-left">
                        {toPersianDigits(prog)}٪
                      </span>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden p-0.5 border border-slate-200">
                    <div 
                      className={`h-full rounded-full transition-all duration-500 ${
                        prog === 100 
                          ? 'bg-emerald-500' 
                          : prog > 0 
                          ? 'bg-amber-500' 
                          : 'bg-slate-300'
                      }`}
                      style={{ width: `${Math.max(3, prog)}%` }}
                    />
                  </div>

                  {/* Product Specific Schedule Badges Under Stage */}
                  <div className="flex flex-wrap gap-2 pt-1 pr-8">
                    {activeProducts.map((p) => {
                      const isSkippedAssembly = isAssemblyStage && p.needs_assembly === false;
                      const pSched = schedObj[p.id];
                      const hasSpecificDates = pSched && (pSched.startDate || pSched.endDate);

                      return (
                        <div
                          key={p.id}
                          className={`px-2.5 py-1 rounded-xl text-[10px] font-mono border flex items-center gap-1.5 transition-all ${
                            isSkippedAssembly
                              ? 'bg-slate-50 text-slate-400 border-slate-200 line-through'
                              : 'bg-amber-50/70 text-amber-950 border-amber-200/90 font-semibold'
                          }`}
                        >
                          <span className="font-sans font-bold">{p.item_name}</span>
                          {p.customer_code && (
                            <span className="text-amber-800 bg-amber-100/70 px-1 py-0.2 rounded text-[9px]">
                              {p.customer_code}
                            </span>
                          )}
                          {isSkippedAssembly ? (
                            <span className="text-slate-400 font-sans">(بدون مونتاژ)</span>
                          ) : hasSpecificDates ? (
                            <span className="text-slate-500 text-[9px]">
                              [{pSched.startDate || '...'} تا {pSched.endDate || '...'}]
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
