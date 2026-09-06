import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, Layers, Package, CheckCircle2, Circle, Clock, Ban, Save, Info } from 'lucide-react';
import { fetchJson } from '../../api';
import toast from 'react-hot-toast';
import { toPersianDigits } from '../../utils';

// V3.1.0 — تب «پیشرفت به تفکیک کد کالا» (ماتریسی SKU × مرحله)
// مدل: هر ردیف = یک SKU (کد کالا × کمیت)؛ وضعیت هر مرحله دودویی (تمام/ناتمام)؛
// پیشرفت کل پروژه = تجمیع وزن‌دار (Σ sku%×qty / Σ qty)

interface StageMeta { stage_order: number; title: string; status?: string }
interface ProductProgressRow {
  stage_order: number;
  stage_title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  updated_at: string;
  updated_by_name: string;
}
interface ProductProgressRowData {
  item_id: number | null;
  item_code: string;
  item_name: string;
  quantity: number;
  unit: string;
  applicable_stage_orders: number[];
  excluded_stage_orders: number[];
  progress: ProductProgressRow[];
  completed_count: number;
  applicable_count: number;
  progress_percent: number;
}
interface ProductProgressResponse {
  stages: StageMeta[];
  products: ProductProgressRowData[];
  summary: {
    total_skus: number;
    total_quantity: number;
    weighted_progress_percent: number;
    fully_completed_skus: number;
    per_stage_counts: Array<{ stage_order: number; title: string; completed_count: number; applicable_skus: number }>;
  };
}

const STATUS_LABELS: Record<ProductProgressRow['status'], string> = {
  pending: 'ناتمام',
  in_progress: 'در جریان',
  completed: 'تمام',
  blocked: 'متوقف'
};

export default function ProjectProductProgressTab({ projectId, onUpdate }: { projectId: number; onUpdate?: () => void }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<ProductProgressResponse | null>(null);

  // pending local edits: key `${itemId}|${stageOrder}` → newStatus
  const [dirty, setDirty] = useState<Map<string, ProductProgressRow['status']>>(new Map());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchJson(`/projects/${projectId}/product-progress`);
      const payload = res?.data ?? res;
      if (payload && Array.isArray(payload.products)) {
        setData(payload);
      } else {
        toast.error('ساختار پاسخ پیشرفت نامعتبر است');
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      toast.error(err?.message || 'خطا در دریافت پیشرفت تفکیکی کد کالا');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const stages = data?.stages || [];
  const products = useMemo(() => (Array.isArray(data?.products) ? data!.products : []), [data]);

  // گروه‌بندی ستون‌ها: مراحل پایه (همه SKUها) اول، مراحل اختیاری (زیرمجموعه SKUها) بعد از آن
  const { baseStages, optionalStages } = useMemo(() => {
    const applicableEverywhere = stages.filter(s => products.length > 0 && products.every(p => p.applicable_stage_orders.includes(s.stage_order)));
    const optional = stages.filter(s => !applicableEverywhere.includes(s));
    return { baseStages: applicableEverywhere, optionalStages: optional };
  }, [stages, products]);

  const resolveStatus = (p: ProductProgressRowData, order: number): ProductProgressRow['status'] => {
    const key = `${p.item_id}|${order}`;
    if (dirty.has(key)) return dirty.get(key)!;
    const row = p.progress.find(pr => pr.stage_order === order);
    return row?.status || 'pending';
  };

  const toggleStatus = (p: ProductProgressRowData, order: number) => {
    const key = `${p.item_id}|${order}`;
    const current = resolveStatus(p, order);
    const next: ProductProgressRow['status'] = current === 'completed' ? 'pending' : 'completed';
    setDirty(prev => {
      const m = new Map(prev);
      m.set(key, next);
      return m;
    });
  };

  const setStageForAllSkus = (order: number, status: ProductProgressRow['status']) => {
    setDirty(prev => {
      const m = new Map(prev);
      for (const p of products) {
        if (p.applicable_stage_orders.includes(order)) {
          m.set(`${p.item_id}|${order}`, status);
        }
      }
      return m;
    });
  };

  const progressPercent = (p: ProductProgressRowData): number => {
    const applicable = p.applicable_stage_orders;
    if (applicable.length === 0) return 0;
    const done = applicable.filter(o => resolveStatus(p, o) === 'completed').length;
    return Math.round((done / applicable.length) * 100);
  };

  const hasChanges = dirty.size > 0;

  const saveChanges = async () => {
    if (!hasChanges || saving) return;
    setSaving(true);
    try {
      const items = Array.from(dirty.entries()).map(([key, status]) => {
        const [itemId, order] = key.split('|');
        return { item_id: Number(itemId), stage_order: Number(order), status };
      });
      const res = await fetchJson(`/projects/${projectId}/product-progress`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items })
      });
      if (res?.success) {
        toast.success(`${toPersianDigits(res.applied)} تغییر وضعیت ثبت شد`);
        setDirty(new Map());
        load();
        onUpdate?.();
      } else {
        toast.error(res?.error || 'خطا در ثبت تغییرات');
      }
    } catch (err: any) {
      toast.error(err?.message || 'خطا در ثبت تغییرات');
    } finally {
      setSaving(false);
    }
  };

  const summary = data?.summary;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-slate-400 gap-2">
        <RefreshCw className="w-6 h-6 animate-spin text-amber-500" />
        <span>در حال محاسبه پیشرفت تفکیکی کد کالاها...</span>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-slate-400 gap-2 text-center">
        <Package className="w-8 h-8 text-slate-300" />
        <p className="font-bold text-slate-600">هیچ کد کالایی (SKU) به این پروژه پیوند خورده است</p>
        <p className="text-[11px]">در فرم ویرایش پروژه، ردیف‌های «کد کالا» را با کالای انبار و تیراژ هدف تعریف کنید تا پیشرفت تفکیکی فعال شود.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 text-xs animate-fadeIn">
      {/* Summary Band */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3">
          <span className="text-[10px] text-amber-700 font-bold block mb-1">پیشرفت وزن‌دار کل پروژه</span>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 bg-amber-100 rounded-full overflow-hidden">
              <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: `${summary?.weighted_progress_percent || 0}%` }} />
            </div>
            <span className="font-mono font-bold text-amber-800 text-sm">{toPersianDigits(summary?.weighted_progress_percent || 0)}٪</span>
          </div>
        </div>
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3">
          <span className="text-[10px] text-slate-500 font-bold block mb-1">تعداد کد کالا (SKU):</span>
          <p className="font-bold font-mono text-slate-900 text-sm">{toPersianDigits(summary?.total_skus || 0)}</p>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3">
          <span className="text-[10px] text-emerald-700 font-bold block mb-1">SKUهای تکمیل‌شده (همه مراحل):</span>
          <p className="font-bold font-mono text-emerald-800 text-sm">{toPersianDigits(summary?.fully_completed_skus || 0)} از {toPersianDigits(summary?.total_skus || 0)}</p>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3">
          <span className="text-[10px] text-blue-700 font-bold block mb-1">تیراژ کل سفارش:</span>
          <p className="font-bold font-mono text-blue-800 text-sm">{toPersianDigits(summary?.total_quantity || 0)}</p>
        </div>
      </div>

      {/* Per-stage rollup strip */}
      {stages.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-3">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-bold text-slate-700 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-slate-400" />
              وضعیت هر مرحله در کل SKUها
            </h4>
            <span className="text-[10px] text-slate-400">تعداد SKU تکمیل‌شده در هر مرحله / کل SKUهای مرتبط</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {stages.map(s => {
              const stat = summary?.per_stage_counts.find(pc => pc.stage_order === s.stage_order);
              const applicable = stat?.applicable_skus || 0;
              const done = stat?.completed_count || 0;
              const pct = applicable > 0 ? Math.round((done / applicable) * 100) : 0;
              return (
                <div key={s.stage_order} className="bg-slate-50 rounded-xl border border-slate-100 p-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold text-slate-700 truncate" title={s.title}>{s.title}</span>
                    <span className="font-mono text-[10px] font-bold text-slate-500">{toPersianDigits(pct)}٪</span>
                  </div>
                  <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="flex items-center justify-between mt-1 text-[9px] text-slate-400">
                    <button
                      onClick={() => setStageForAllSkus(s.stage_order, 'completed')}
                      className="text-emerald-600 hover:text-emerald-800 font-bold cursor-pointer"
                      title="تمام کردن این مرحله برای همه SKUهای اعمال‌شده"
                    >
                      تمام همه
                    </button>
                    <span>{toPersianDigits(done)}/{toPersianDigits(applicable)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SKU × Stage Matrix */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="p-3 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <h4 className="font-bold text-slate-800 flex items-center gap-1.5">
            <Package className="w-4 h-4 text-amber-600" />
            پیشرفت هر کد کالا — وضعیت دودویی هر مرحله (تمام / ناتمام)
          </h4>
          {hasChanges && (
            <button
              onClick={saveChanges}
              disabled={saving}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white rounded-xl font-bold text-[11px] flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? 'در حال ثبت...' : `ثبت ${toPersianDigits(dirty.size)} تغییر`}
            </button>
          )}
        </div>

        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-right text-[11px]">
            <thead>
              <tr className="border-b border-slate-200 bg-white text-slate-600 font-bold">
                <th className="p-2.5 sticky right-0 bg-white z-10 border-l border-slate-100">کد کالا</th>
                <th className="p-2.5">نام کالا</th>
                <th className="p-2.5 text-center">تیراژ</th>
                {baseStages.map(s => (
                  <th key={`b-${s.stage_order}`} className="p-1.5 text-center min-w-[70px]">
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-[9px] text-slate-400 font-mono">{toPersianDigits(s.stage_order)}</span>
                      <span className="truncate max-w-[80px]" title={s.title}>{s.title}</span>
                    </div>
                  </th>
                ))}
                {optionalStages.map(s => (
                  <th key={`o-${s.stage_order}`} className="p-1.5 text-center min-w-[70px] bg-amber-50/50">
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-[9px] text-amber-600 font-mono">{toPersianDigits(s.stage_order)} ◇</span>
                      <span className="truncate max-w-[80px] text-amber-800" title={`${s.title} (اختیاری — برای برخی SKUها)`}>{s.title}</span>
                    </div>
                  </th>
                ))}
                <th className="p-2.5 text-center">پیشرفت SKU</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {products.map((p, idx) => {
                const pct = progressPercent(p);
                return (
                  <tr key={`${p.item_id}-${idx}`} className="hover:bg-amber-50/30">
                    <td className="p-2.5 font-mono font-bold text-amber-900 sticky right-0 bg-white z-10 border-l border-slate-100">
                      {p.item_code || <span className="text-red-600 font-bold">بدون کد!</span>}
                    </td>
                    <td className="p-2.5 font-bold text-slate-900 max-w-[140px] truncate" title={p.item_name}>{p.item_name || '—'}</td>
                    <td className="p-2.5 text-center font-mono font-bold text-slate-700">{toPersianDigits(p.quantity)}</td>
                    {baseStages.map(s => {
                      const applicable = p.applicable_stage_orders.includes(s.stage_order);
                      const st = applicable ? resolveStatus(p, s.stage_order) : null;
                      const isDirty = dirty.has(`${p.item_id}|${s.stage_order}`);
                      return (
                        <td key={`c-${s.stage_order}`} className={`p-1 text-center ${isDirty ? 'bg-blue-50' : ''}`}>
                          {applicable ? (
                            <button
                              onClick={() => toggleStatus(p, s.stage_order)}
                              className={`w-7 h-7 rounded-lg inline-flex items-center justify-center transition-colors cursor-pointer ${
                                st === 'completed'
                                  ? 'bg-emerald-100 text-emerald-700 border border-emerald-300 hover:bg-emerald-200'
                                  : st === 'in_progress'
                                  ? 'bg-blue-100 text-blue-700 border border-blue-300 hover:bg-blue-200'
                                  : st === 'blocked'
                                  ? 'bg-red-100 text-red-700 border border-red-300 hover:bg-red-200'
                                  : 'bg-slate-100 text-slate-300 border border-slate-200 hover:bg-slate-200'
                              }`}
                              title={`${s.title} — ${st ? STATUS_LABELS[st] : ''} (کلیک: تغییر تمام/ناتمام)`}
                            >
                              {st === 'completed' ? <CheckCircle2 className="w-4 h-4" /> : st === 'in_progress' ? <Clock className="w-4 h-4" /> : st === 'blocked' ? <Ban className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
                            </button>
                          ) : (
                            <span className="text-slate-200">—</span>
                          )}
                        </td>
                      );
                    })}
                    {optionalStages.map(s => {
                      const applicable = p.applicable_stage_orders.includes(s.stage_order);
                      const st = applicable ? resolveStatus(p, s.stage_order) : null;
                      const isDirty = dirty.has(`${p.item_id}|${s.stage_order}`);
                      return (
                        <td key={`oc-${s.stage_order}`} className={`p-1 text-center bg-amber-50/30 ${isDirty ? 'bg-blue-50' : ''}`}>
                          {applicable ? (
                            <button
                              onClick={() => toggleStatus(p, s.stage_order)}
                              className={`w-7 h-7 rounded-lg inline-flex items-center justify-center transition-colors cursor-pointer ${
                                st === 'completed'
                                  ? 'bg-emerald-100 text-emerald-700 border border-emerald-300 hover:bg-emerald-200'
                                  : st === 'in_progress'
                                  ? 'bg-blue-100 text-blue-700 border border-blue-300 hover:bg-blue-200'
                                  : st === 'blocked'
                                  ? 'bg-red-100 text-red-700 border border-red-300 hover:bg-red-200'
                                  : 'bg-slate-100 text-slate-300 border border-slate-200 hover:bg-slate-200'
                              }`}
                              title={`${s.title} (اختیاری) — ${st ? STATUS_LABELS[st] : ''}`}
                            >
                              {st === 'completed' ? <CheckCircle2 className="w-4 h-4" /> : st === 'in_progress' ? <Clock className="w-4 h-4" /> : st === 'blocked' ? <Ban className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
                            </button>
                          ) : (
                            <span className="text-slate-200">—</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="p-2 text-center">
                      <div className="flex items-center gap-1.5 justify-center">
                        <div className="w-12 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-emerald-500' : pct > 0 ? 'bg-amber-500' : 'bg-slate-300'}`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="font-mono font-bold text-[10px] text-slate-700">{toPersianDigits(pct)}٪</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="p-2.5 bg-slate-50 border-t border-slate-100 flex items-center gap-4 text-[10px] text-slate-500">
          <span className="flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> تمام</span>
          <span className="flex items-center gap-1"><Circle className="w-3.5 h-3.5 text-slate-300" /> ناتمام</span>
          <span className="flex items-center gap-1"><Info className="w-3.5 h-3.5 text-blue-500" /> مراحل اختیاری با نشان ◇ — فقط برای SKUهایی که در فرم پروژه انتخاب کرده‌اند اعمال می‌شود</span>
        </div>
      </div>
    </div>
  );
}
