import React, { useState, useMemo } from 'react';
import { 
  DollarSign, TrendingUp, TrendingDown, Layers, Package, Users, 
  AlertCircle, ChevronDown, ChevronUp, Calculator, PieChart, 
  HelpCircle, Eye, Sliders, CheckCircle2, ArrowRight
} from 'lucide-react';
import { ProductionProject, Item, ProjectProductItem } from '../../types';
import { formatPersianPrice, formatPersianNumber, toPersianDigits } from '../../utils';

export interface ProjectCostSummaryWidgetProps {
  project: ProductionProject;
  itemsList?: Item[];
  pricesMap?: Record<number, any[]>;
  pieceworkLogs?: any[];
  currency?: string;
  compact?: boolean;
}

export interface MaterialCostItem {
  key: string;
  code: string;
  name: string;
  requiredQty: number;
  unit: string;
  unitCost: number;
  totalCost: number;
  hasPrice: boolean;
  category?: string;
}

export interface LaborTaskCostItem {
  id: string;
  stageName: string;
  productName: string;
  taskTitle: string;
  personnelName: string;
  quantity: number;
  unit: string;
  unitRate: number;
  estimatedTotal: number;
  actualLoggedTotal: number;
  isLogged: boolean;
}

export function ProjectCostSummaryWidget({
  project,
  itemsList = [],
  pricesMap = {},
  pieceworkLogs = [],
  currency = 'تومان',
  compact = false
}: ProjectCostSummaryWidgetProps) {
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [activeAnalysisTab, setActiveAnalysisTab] = useState<'materials' | 'labor' | 'simulator'>('materials');
  const [sellingPriceOverride, setSellingPriceOverride] = useState<number | null>(null);

  // 1. Calculate Total Quantities
  const products: ProjectProductItem[] = useMemo(() => {
    if (project.products && project.products.length > 0) {
      return project.products;
    }
    if (project.product_items && project.product_items.length > 0) {
      return project.product_items;
    }
    return [{
      id: 'default-prod',
      item_id: project.item_id || null,
      item_code: project.item_code || '',
      item_name: project.item_name || 'محصول اصلی',
      customer_code: '',
      quantity: project.quantity || 100,
      unit: project.unit || 'عدد',
      needs_assembly: true
    }];
  }, [project]);

  const totalProductQuantity = useMemo(() => {
    return products.reduce((acc, p) => acc + (Number(p.quantity) || 0), 0) || (project.quantity || 100);
  }, [products, project.quantity]);

  // 2. Material Costs Breakdown (BOM)
  const { materialItems, totalMaterialCost, missingPriceCount } = useMemo(() => {
    const map: Record<string, MaterialCostItem> = {};
    const sections = project.inventory_control?.sections || [];
    const purchaseList = project.inventory_control?.purchaseList || [];
    const manualItems = project.inventory_control?.manualPurchaseItems || [];

    // Combine from sections
    sections.forEach(sec => {
      if (sec.checkType === 'per_item' && sec.perItemResults) {
        products.forEach(prod => {
          const prodRes = sec.perItemResults?.[prod.id] || {};
          const itemsSchema = sec.itemsSchema || [{ id: 'item_default', name: 'ماده اولیه', unit: 'عدد' }];

          itemsSchema.forEach(itemSchema => {
            const itemRes = prodRes[itemSchema.id];
            const reqQty = Number(itemRes?.requiredQty ?? prod.quantity ?? 100);
            const reqUnit = itemRes?.unit || itemSchema.unit || 'عدد';
            const effCode = itemRes?.itemCode || itemSchema.itemCode || '';
            const effName = itemRes?.name || itemSchema.name;

            const key = effCode ? `code_${effCode}` : `name_${effName.trim().toLowerCase()}`;
            if (!map[key]) {
              // Find matching warehouse item
              const matched = itemsList.find(i => 
                (effCode && i.code === effCode) || 
                (i.name.toLowerCase() === effName.toLowerCase())
              );

              const wac = (matched as any)?.weightedAverageCost ?? (matched as any)?.weighted_average_cost ?? (matched as any)?.purchase_price ?? (matched as any)?.unit_price ?? 0;
              const hasPrice = Number(wac) > 0;

              map[key] = {
                key,
                code: effCode,
                name: effName,
                requiredQty: 0,
                unit: reqUnit,
                unitCost: Number(wac) || 0,
                totalCost: 0,
                hasPrice,
                category: sec.title
              };
            }
            map[key].requiredQty += reqQty;
          });
        });
      } else if (sec.checkType === 'global' && sec.globalItems) {
        sec.globalItems.forEach(gItem => {
          const effCode = gItem.itemCode || '';
          const effName = gItem.name;
          const reqQty = Number(gItem.requiredQty) || 0;
          const reqUnit = gItem.unit || 'عدد';

          const key = effCode ? `code_${effCode}` : `name_${effName.trim().toLowerCase()}`;
          if (!map[key]) {
            const matched = itemsList.find(i => 
              (effCode && i.code === effCode) || 
              (i.name.toLowerCase() === effName.toLowerCase())
            );
            const wac = (matched as any)?.weightedAverageCost ?? (matched as any)?.weighted_average_cost ?? (matched as any)?.purchase_price ?? (matched as any)?.unit_price ?? 0;
            const hasPrice = Number(wac) > 0;

            map[key] = {
              key,
              code: effCode,
              name: effName,
              requiredQty: 0,
              unit: reqUnit,
              unitCost: Number(wac) || 0,
              totalCost: 0,
              hasPrice,
              category: sec.title
            };
          }
          map[key].requiredQty += reqQty;
        });
      }
    });

    // Also include manual purchase items
    manualItems.forEach(mItem => {
      const effCode = mItem.itemCode || '';
      const effName = mItem.itemName;
      const key = effCode ? `code_${effCode}` : `name_${effName.trim().toLowerCase()}`;
      if (!map[key]) {
        const matched = itemsList.find(i => 
          (effCode && i.code === effCode) || 
          (i.name.toLowerCase() === effName.toLowerCase())
        );
        const wac = (matched as any)?.weightedAverageCost ?? (matched as any)?.weighted_average_cost ?? (matched as any)?.purchase_price ?? (matched as any)?.unit_price ?? 0;
        map[key] = {
          key,
          code: effCode,
          name: effName,
          requiredQty: 0,
          unit: mItem.unit || 'عدد',
          unitCost: Number(wac) || 0,
          totalCost: 0,
          hasPrice: Number(wac) > 0,
          category: 'اقلام دستی خرید'
        };
      }
      map[key].requiredQty += Number(mItem.totalRequiredQty || 0);
    });

    const items = Object.values(map).map(item => ({
      ...item,
      totalCost: item.requiredQty * item.unitCost
    }));

    const total = items.reduce((acc, curr) => acc + curr.totalCost, 0);
    const missingCount = items.filter(i => !i.hasPrice).length;

    return {
      materialItems: items,
      totalMaterialCost: total,
      missingPriceCount: missingCount
    };
  }, [project.inventory_control, products, itemsList]);

  // 3. Labor & Piecework Costs Breakdown
  const { laborTasks, estimatedLaborCost, actualRecordedLaborCost } = useMemo(() => {
    const list: LaborTaskCostItem[] = [];
    const stageSchedules = project.stage_schedules || project.stageSchedules || {};
    const stages = project.stages || [];

    // Relevant project piecework logs
    const relevantLogs = (pieceworkLogs || []).filter(l => 
      Number(l.projectId) === Number(project.id) && l.isDeleted !== 1
    );

    stages.forEach(stg => {
      const pSched = stageSchedules[stg.id] || (stageSchedules as any)[String(stg.id)];
      const prodSchedules = pSched?.productSchedules || {};

      products.forEach(prod => {
        const prodSched = prodSchedules[prod.id];
        const tasks = prodSched?.tasks || prodSched?.taskAssignments || [];

        tasks.forEach((t, idx) => {
          const qty = Number(t.quantity) || 0;
          const rate = Number(t.defaultRate) || 0;
          const estCost = Number(t.estimatedCost) || (qty * rate);

          // Check if recorded in logs
          const matchingLog = relevantLogs.find(l => 
            Number(l.taskId) === Number(t.taskId) && 
            Number(l.personnelId) === Number(t.assignedPersonnelId)
          );

          const actualTotal = matchingLog 
            ? (Number(matchingLog.totalAmount) || (Number(matchingLog.quantity) * Number(matchingLog.unitRate)))
            : (t.isLoggedToPiecework ? estCost : 0);

          list.push({
            id: `${stg.id}_${prod.id}_${idx}`,
            stageName: stg.title,
            productName: prod.item_name || 'محصول',
            taskTitle: t.taskTitle || 'وظیفه کارگاهی',
            personnelName: t.assignedPersonnelName || 'نامشخص',
            quantity: qty,
            unit: t.unit || 'عدد',
            unitRate: rate,
            estimatedTotal: estCost,
            actualLoggedTotal: actualTotal,
            isLogged: !!matchingLog || !!t.isLoggedToPiecework
          });
        });
      });
    });

    const estTotal = list.reduce((acc, curr) => acc + curr.estimatedTotal, 0);
    const actTotal = relevantLogs.length > 0 
      ? relevantLogs.reduce((acc, curr) => acc + (Number(curr.totalAmount) || (Number(curr.quantity) * Number(curr.unitRate))), 0)
      : list.reduce((acc, curr) => acc + curr.actualLoggedTotal, 0);

    return {
      laborTasks: list,
      estimatedLaborCost: estTotal,
      actualRecordedLaborCost: actTotal
    };
  }, [project, products, pieceworkLogs]);

  // 4. Sales Revenue Estimation
  const { totalEstimatedRevenue, defaultUnitSellingPrice } = useMemo(() => {
    let revenue = 0;
    let fallbackUnitSelling = 0;

    products.forEach(prod => {
      const prodQty = Number(prod.quantity) || 0;
      let unitPrice = 0;

      // Check pricesMap for product
      if (prod.item_id && pricesMap[prod.item_id] && pricesMap[prod.item_id].length > 0) {
        const pList = pricesMap[prod.item_id];
        const primaryPrice = pList.find(p => p.title?.includes('اصلی') || p.title?.includes('فروش') || p.title?.includes('عمده')) || pList[0];
        unitPrice = Number(primaryPrice?.price) || 0;
      }

      if (unitPrice === 0) {
        // Look up matched item
        const matchItem = itemsList.find(i => 
          (prod.item_id && i.id === prod.item_id) || 
          (prod.item_code && i.code === prod.item_code)
        );
        unitPrice = (matchItem as any)?.selling_price || (matchItem as any)?.sale_price || (matchItem as any)?.unit_price || 0;
      }

      revenue += prodQty * unitPrice;
      if (unitPrice > 0 && fallbackUnitSelling === 0) {
        fallbackUnitSelling = unitPrice;
      }
    });

    return {
      totalEstimatedRevenue: revenue,
      defaultUnitSellingPrice: fallbackUnitSelling
    };
  }, [products, pricesMap, itemsList]);

  // 5. Total Project Cost and Margin Calculations
  const totalProductionCost = totalMaterialCost + estimatedLaborCost;
  const committedProductionCost = totalMaterialCost + actualRecordedLaborCost;
  const unitProductionCost = totalProductQuantity > 0 ? (totalProductionCost / totalProductQuantity) : 0;

  // Effective revenue (supports interactive simulator override)
  const effectiveRevenue = sellingPriceOverride !== null 
    ? (sellingPriceOverride * totalProductQuantity)
    : (totalEstimatedRevenue > 0 ? totalEstimatedRevenue : (unitProductionCost * 1.35 * totalProductQuantity));

  const effectiveUnitSellingPrice = totalProductQuantity > 0 ? (effectiveRevenue / totalProductQuantity) : 0;
  const grossProfit = effectiveRevenue - totalProductionCost;
  const profitMarginPercent = effectiveRevenue > 0 ? (grossProfit / effectiveRevenue) * 100 : 0;

  // Cost proportions
  const materialSharePercent = totalProductionCost > 0 ? Math.round((totalMaterialCost / totalProductionCost) * 100) : 50;
  const laborSharePercent = 100 - materialSharePercent;

  // Margin classification
  const getMarginBadge = () => {
    if (profitMarginPercent >= 35) {
      return {
        label: 'حاشیه سود عالی',
        bg: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        text: 'text-emerald-700'
      };
    }
    if (profitMarginPercent >= 15) {
      return {
        label: 'حاشیه سود استاندارد',
        bg: 'bg-amber-50 text-amber-700 border-amber-200',
        text: 'text-amber-700'
      };
    }
    if (profitMarginPercent > 0) {
      return {
        label: 'حاشیه سود فشرده / کم',
        bg: 'bg-orange-50 text-orange-700 border-orange-200',
        text: 'text-orange-700'
      };
    }
    return {
      label: 'هشدار نقطه زیان‌ده',
      bg: 'bg-rose-50 text-rose-700 border-rose-200',
      text: 'text-rose-700'
    };
  };

  const marginBadge = getMarginBadge();

  if (compact) {
    return (
      <div className="bg-slate-900 text-white p-3 rounded-2xl border border-slate-800 flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-amber-400 text-slate-950 font-bold flex items-center justify-center shrink-0">
            <Calculator className="w-4 h-4" />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 block font-medium">بهای تمام‌شده کل:</span>
            <span className="font-bold text-amber-300 font-mono text-xs">
              {formatPersianPrice(totalProductionCost, currency)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="text-left">
            <span className="text-[10px] text-slate-400 block font-medium">حاشیه سود:</span>
            <span className={`font-bold font-mono text-xs ${profitMarginPercent >= 20 ? 'text-emerald-400' : 'text-amber-400'}`}>
              {toPersianDigits(profitMarginPercent.toFixed(1))}٪
            </span>
          </div>
          <button
            type="button"
            onClick={() => setIsDetailModalOpen(true)}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors cursor-pointer"
            title="مشاهده جزئیات بهای تمام‌شده و سودآوری"
          >
            <Eye className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Main Executive KPI Widget Box */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-950 text-white rounded-3xl p-5 border border-slate-700 shadow-xl overflow-hidden relative">
        {/* Background Subtle Accent Gradients */}
        <div className="absolute -left-12 -top-12 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -right-12 -bottom-12 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Top Header Row */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4 border-b border-slate-700/80">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-400 text-slate-950 font-bold flex items-center justify-center shadow-lg shadow-amber-400/20">
              <Calculator className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm text-white flex items-center gap-1.5">
                  ویجت زنده بهای تمام‌شده و آنالیز سودآوری پروژه
                </h3>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${marginBadge.bg}`}>
                  {marginBadge.label}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                محاسبه خودکار مواد اولیه مصرفی (BOM) + دستمزد قطعه‌کاری پرسنل در برابر ارزش فروش
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsDetailModalOpen(true)}
            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-amber-300 hover:text-amber-200 border border-slate-600 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm cursor-pointer shrink-0"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>آنالیز ریز هزینه و شبیه‌ساز سود</span>
          </button>
        </div>

        {/* Core KPI Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 pt-4">
          {/* 1. Total Estimated Cost */}
          <div className="bg-slate-800/80 rounded-2xl p-3.5 border border-slate-700/70 space-y-2">
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span className="font-semibold flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5 text-amber-400" />
                کل بهای تمام‌شده
              </span>
              <span className="text-[10px] bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded font-mono">
                {toPersianDigits(totalProductQuantity)} {project.unit || 'عدد'}
              </span>
            </div>
            <div>
              <p className="text-lg font-black font-mono text-amber-300">
                {formatPersianPrice(totalProductionCost, currency)}
              </p>
              <p className="text-[11px] text-slate-400 mt-1">
                واحدی: <span className="font-mono text-slate-200 font-bold">{formatPersianPrice(unitProductionCost, currency)}</span>
              </p>
            </div>
          </div>

          {/* 2. BOM Materials Share */}
          <div className="bg-slate-800/80 rounded-2xl p-3.5 border border-slate-700/70 space-y-2">
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span className="font-semibold flex items-center gap-1.5">
                <Package className="w-3.5 h-3.5 text-blue-400" />
                سهم مواد اولیه (BOM)
              </span>
              <span className="text-[10px] font-mono font-bold text-blue-300">
                {toPersianDigits(materialSharePercent)}٪ کل
              </span>
            </div>
            <div>
              <p className="text-lg font-black font-mono text-blue-200">
                {formatPersianPrice(totalMaterialCost, currency)}
              </p>
              <p className="text-[11px] text-slate-400 mt-1">
                {toPersianDigits(materialItems.length)} قلم ماده اولیه
                {missingPriceCount > 0 && (
                  <span className="text-amber-400 font-medium mr-1">
                    ({toPersianDigits(missingPriceCount)} بدون قیمت)
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* 3. Labor & Piecework Share */}
          <div className="bg-slate-800/80 rounded-2xl p-3.5 border border-slate-700/70 space-y-2">
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span className="font-semibold flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-purple-400" />
                دستمزد و کارمزد پرسنل
              </span>
              <span className="text-[10px] font-mono font-bold text-purple-300">
                {toPersianDigits(laborSharePercent)}٪ کل
              </span>
            </div>
            <div>
              <p className="text-lg font-black font-mono text-purple-200">
                {formatPersianPrice(estimatedLaborCost, currency)}
              </p>
              <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1">
                <span>ثبت قطعی:</span>
                <span className="font-mono font-bold text-emerald-400">
                  {formatPersianPrice(actualRecordedLaborCost, currency)}
                </span>
              </div>
            </div>
          </div>

          {/* 4. Revenue & Profit Margin */}
          <div className="bg-slate-800/80 rounded-2xl p-3.5 border border-slate-700/70 space-y-2">
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span className="font-semibold flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                سود ناخالص و حاشیه سود
              </span>
              <span className="text-[10px] font-mono font-bold text-emerald-300">
                {toPersianDigits(profitMarginPercent.toFixed(1))}٪
              </span>
            </div>
            <div>
              <p className="text-lg font-black font-mono text-emerald-300">
                {formatPersianPrice(grossProfit, currency)}
              </p>
              <p className="text-[11px] text-slate-400 mt-1">
                فروش برآوردی: <span className="font-mono text-slate-200 font-bold">{formatPersianPrice(effectiveRevenue, currency)}</span>
              </p>
            </div>
          </div>
        </div>

        {/* Cost Breakdown Progress Bar */}
        <div className="pt-4 mt-4 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-4 text-[11px] text-slate-300 w-full sm:w-auto">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-400 inline-block" />
              <span>مواد اولیه: <strong>{toPersianDigits(materialSharePercent)}٪</strong></span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-purple-400 inline-block" />
              <span>دستمزد و کارگاه: <strong>{toPersianDigits(laborSharePercent)}٪</strong></span>
            </div>
          </div>

          <div className="flex-1 max-w-md w-full h-2.5 bg-slate-700 rounded-full overflow-hidden flex">
            <div 
              className="h-full bg-blue-500 transition-all"
              style={{ width: `${materialSharePercent}%` }}
              title={`مواد اولیه: ${materialSharePercent}%`}
            />
            <div 
              className="h-full bg-purple-500 transition-all"
              style={{ width: `${laborSharePercent}%` }}
              title={`دستمزد و کارگاه: ${laborSharePercent}%`}
            />
          </div>

          <div className="text-[11px] text-slate-400 shrink-0">
            سود برآوردی هر واحد: <strong className="text-emerald-400 font-mono">{formatPersianPrice(effectiveUnitSellingPrice - unitProductionCost, currency)}</strong>
          </div>
        </div>
      </div>

      {/* Deep Financial Audit & Profit Simulator Modal */}
      {isDetailModalOpen && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50 animate-fadeIn overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-4xl w-full overflow-hidden shadow-2xl border border-slate-200 my-4 flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="bg-slate-900 text-white p-5 shrink-0 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-amber-400 text-slate-950 font-bold flex items-center justify-center shadow-md">
                  <Calculator className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    آنالیز جامع بهای تمام‌شده و شبیه‌ساز سودآوری پروژه
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5 font-mono">
                    {project.project_code} - {project.title}
                  </p>
                </div>
              </div>

              <button
                onClick={() => setIsDetailModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Modal Tabs */}
            <div className="bg-slate-100 border-b border-slate-200 px-4 pt-2 flex items-center gap-1 shrink-0">
              <button
                onClick={() => setActiveAnalysisTab('materials')}
                className={`px-4 py-2.5 rounded-t-2xl font-bold text-xs transition-all flex items-center gap-1.5 border-t border-x ${
                  activeAnalysisTab === 'materials'
                    ? 'bg-white text-slate-900 border-slate-200 shadow-2xs'
                    : 'bg-transparent text-slate-600 hover:text-slate-900 border-transparent'
                }`}
              >
                <Package className="w-4 h-4 text-blue-600" />
                ۱. ریز بهای مواد اولیه BOM ({toPersianDigits(materialItems.length)})
              </button>

              <button
                onClick={() => setActiveAnalysisTab('labor')}
                className={`px-4 py-2.5 rounded-t-2xl font-bold text-xs transition-all flex items-center gap-1.5 border-t border-x ${
                  activeAnalysisTab === 'labor'
                    ? 'bg-white text-slate-900 border-slate-200 shadow-2xs'
                    : 'bg-transparent text-slate-600 hover:text-slate-900 border-transparent'
                }`}
              >
                <Users className="w-4 h-4 text-purple-600" />
                ۲. ریز دستمزد و وظایف کارگاهی ({toPersianDigits(laborTasks.length)})
              </button>

              <button
                onClick={() => setActiveAnalysisTab('simulator')}
                className={`px-4 py-2.5 rounded-t-2xl font-bold text-xs transition-all flex items-center gap-1.5 border-t border-x ${
                  activeAnalysisTab === 'simulator'
                    ? 'bg-white text-slate-900 border-slate-200 shadow-2xs'
                    : 'bg-transparent text-slate-600 hover:text-slate-900 border-transparent'
                }`}
              >
                <Sliders className="w-4 h-4 text-emerald-600" />
                ۳. شبیه‌ساز قیمت و نقطه سر‌به‌سر
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto flex-1 custom-scrollbar text-xs space-y-4">
              {/* TAB 1: BOM Materials Breakdown */}
              {activeAnalysisTab === 'materials' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between bg-blue-50/80 p-3.5 rounded-2xl border border-blue-200 text-blue-900">
                    <div>
                      <span className="font-bold block">مجموع بهای تمام‌شده مواد اولیه (BOM):</span>
                      <span className="text-[11px] text-blue-700">
                        بر اساس بهای میانگین موزون (WAC) و کاتالوگ انبار سیستم
                      </span>
                    </div>
                    <span className="text-base font-black font-mono text-blue-950">
                      {formatPersianPrice(totalMaterialCost, currency)}
                    </span>
                  </div>

                  <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-2xs">
                    <table className="w-full text-right text-xs">
                      <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                        <tr>
                          <th className="p-3">#</th>
                          <th className="p-3">کد / عنوان کالا</th>
                          <th className="p-3">دسته‌بندی</th>
                          <th className="p-3 text-center">مقدار کل مورد نیاز</th>
                          <th className="p-3 text-left">بهای واحد (WAC)</th>
                          <th className="p-3 text-left">هزینه کل</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {materialItems.map((item, idx) => (
                          <tr key={item.key || idx} className="hover:bg-slate-50/80 transition-colors">
                            <td className="p-3 font-bold text-slate-400">{idx + 1}</td>
                            <td className="p-3">
                              <span className="font-bold text-slate-900 block">{item.name}</span>
                              {item.code && (
                                <span className="font-mono text-[11px] text-slate-500">[{item.code}]</span>
                              )}
                            </td>
                            <td className="p-3 text-slate-600">{item.category || '-'}</td>
                            <td className="p-3 text-center font-mono font-bold text-slate-800">
                              {toPersianDigits(item.requiredQty)} {item.unit}
                            </td>
                            <td className="p-3 text-left font-mono text-slate-700">
                              {item.hasPrice ? (
                                formatPersianPrice(item.unitCost, currency)
                              ) : (
                                <span className="text-amber-600 font-medium text-[11px] bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                                  بدون قیمت (صفر)
                                </span>
                              )}
                            </td>
                            <td className="p-3 text-left font-mono font-bold text-blue-900">
                              {formatPersianPrice(item.totalCost, currency)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 2: Labor & Tasks Breakdown */}
              {activeAnalysisTab === 'labor' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between bg-purple-50/80 p-3.5 rounded-2xl border border-purple-200 text-purple-900">
                    <div>
                      <span className="font-bold block">مجموع برآورد دستمزد و کارمزد مراحل:</span>
                      <span className="text-[11px] text-purple-700">
                        شامل تمام وظایف پرسنلی تخصیص‌یافته در مراحل مختلف کارگاه
                      </span>
                    </div>
                    <div className="text-left">
                      <span className="text-base font-black font-mono text-purple-950 block">
                        {formatPersianPrice(estimatedLaborCost, currency)}
                      </span>
                      <span className="text-[11px] text-emerald-700 font-medium">
                        کارکرد قطعی ثبت‌شده: {formatPersianPrice(actualRecordedLaborCost, currency)}
                      </span>
                    </div>
                  </div>

                  <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-2xs">
                    <table className="w-full text-right text-xs">
                      <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                        <tr>
                          <th className="p-3">#</th>
                          <th className="p-3">مرحله کارگاهی</th>
                          <th className="p-3">عنوان وظیفه پرکیسی</th>
                          <th className="p-3">پرسنل مسئول</th>
                          <th className="p-3 text-center">تعداد کار</th>
                          <th className="p-3 text-left">نرخ واحد</th>
                          <th className="p-3 text-left">مبلغ برآوردی</th>
                          <th className="p-3 text-center">وضعیت ثبت</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {laborTasks.map((task, idx) => (
                          <tr key={task.id || idx} className="hover:bg-slate-50/80 transition-colors">
                            <td className="p-3 font-bold text-slate-400">{idx + 1}</td>
                            <td className="p-3 font-bold text-slate-800">{task.stageName}</td>
                            <td className="p-3 font-bold text-slate-900">{task.taskTitle}</td>
                            <td className="p-3 text-slate-700">{task.personnelName}</td>
                            <td className="p-3 text-center font-mono font-bold text-slate-800">
                              {toPersianDigits(task.quantity)} {task.unit}
                            </td>
                            <td className="p-3 text-left font-mono text-slate-700">
                              {formatPersianPrice(task.unitRate, currency)}
                            </td>
                            <td className="p-3 text-left font-mono font-bold text-purple-900">
                              {formatPersianPrice(task.estimatedTotal, currency)}
                            </td>
                            <td className="p-3 text-center">
                              {task.isLogged ? (
                                <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px] inline-flex items-center gap-1">
                                  <CheckCircle2 className="w-3 h-3" />
                                  ثبت شده
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium text-[10px]">
                                  برآوردی
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 3: Profit & Break-even Simulator */}
              {activeAnalysisTab === 'simulator' && (
                <div className="space-y-4">
                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-3">
                    <h4 className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                      <Sliders className="w-4 h-4 text-emerald-600" />
                      شبیه‌ساز قیمت‌گذاری و نقطه سربه‌سر
                    </h4>
                    <p className="text-slate-500 text-xs">
                      با تغییر قیمت فروش واحد محصول، حاشیه سود ناخالص و میزان سودآوری کل پروژه را به صورت زنده شبیه‌سازی و بررسی کنید.
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                      <div className="bg-white p-3.5 rounded-xl border border-slate-200 space-y-1">
                        <span className="text-[10px] text-slate-500 font-semibold block">بهای تمام‌شده هر واحد:</span>
                        <p className="font-bold font-mono text-amber-800 text-sm">
                          {formatPersianPrice(unitProductionCost, currency)}
                        </p>
                      </div>

                      <div className="bg-white p-3.5 rounded-xl border border-slate-200 space-y-1">
                        <span className="text-[10px] text-slate-500 font-semibold block">قیمت فروش واحد (شبیه‌سازی):</span>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            value={sellingPriceOverride ?? Math.round(effectiveUnitSellingPrice)}
                            onChange={(e) => setSellingPriceOverride(Number(e.target.value) || 0)}
                            className="w-full px-2.5 py-1 text-xs font-mono font-bold border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                          />
                          <span className="text-[11px] text-slate-500 shrink-0">{currency}</span>
                        </div>
                      </div>

                      <div className="bg-white p-3.5 rounded-xl border border-slate-200 space-y-1">
                        <span className="text-[10px] text-slate-500 font-semibold block">حاشیه سود نهایی:</span>
                        <p className={`font-bold font-mono text-sm ${profitMarginPercent >= 20 ? 'text-emerald-700' : 'text-amber-700'}`}>
                          {toPersianDigits(profitMarginPercent.toFixed(1))}٪
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setSellingPriceOverride(Math.round(unitProductionCost * 1.3))}
                        className="px-2.5 py-1 bg-slate-200 hover:bg-slate-300 rounded-lg font-bold text-[11px] text-slate-700 transition-colors cursor-pointer"
                      >
                        حاشیه سود ۳۰٪
                      </button>
                      <button
                        type="button"
                        onClick={() => setSellingPriceOverride(Math.round(unitProductionCost * 1.5))}
                        className="px-2.5 py-1 bg-slate-200 hover:bg-slate-300 rounded-lg font-bold text-[11px] text-slate-700 transition-colors cursor-pointer"
                      >
                        حاشیه سود ۵۰٪
                      </button>
                      <button
                        type="button"
                        onClick={() => setSellingPriceOverride(null)}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg font-bold text-[11px] text-slate-500 transition-colors cursor-pointer"
                      >
                        بازنشانی
                      </button>
                    </div>
                  </div>

                  {/* Summary Comparison Table */}
                  <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-2xs">
                    <h5 className="font-bold text-slate-800 text-xs">ترازنامه خلاصه پروژه</h5>
                    <div className="space-y-2 text-xs">
                      <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50">
                        <span className="text-slate-600">۱. هزینه مواد اولیه (BOM):</span>
                        <span className="font-mono font-bold text-slate-900">{formatPersianPrice(totalMaterialCost, currency)}</span>
                      </div>
                      <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50">
                        <span className="text-slate-600">۲. هزینه دستمزد و کارگاه:</span>
                        <span className="font-mono font-bold text-slate-900">{formatPersianPrice(estimatedLaborCost, currency)}</span>
                      </div>
                      <div className="flex items-center justify-between p-2 rounded-lg bg-amber-50/80 border border-amber-200 font-bold">
                        <span className="text-amber-950">کل بهای تمام‌شده تولید:</span>
                        <span className="font-mono text-amber-950">{formatPersianPrice(totalProductionCost, currency)}</span>
                      </div>
                      <div className="flex items-center justify-between p-2 rounded-lg bg-blue-50/80 border border-blue-200 font-bold">
                        <span className="text-blue-950">ارزش کل فروش پروژه:</span>
                        <span className="font-mono text-blue-950">{formatPersianPrice(effectiveRevenue, currency)}</span>
                      </div>
                      <div className="flex items-center justify-between p-2.5 rounded-xl bg-emerald-100 border border-emerald-300 font-bold text-emerald-950">
                        <span>سود ناخالص پروژه:</span>
                        <span className="font-mono text-sm">{formatPersianPrice(grossProfit, currency)} ({toPersianDigits(profitMarginPercent.toFixed(1))}٪)</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="bg-slate-50 border-t border-slate-200 p-4 shrink-0 flex items-center justify-between">
              <span className="text-xs text-slate-500">
                این داده‌ها به صورت بلادرنگ و با هر تغییر در انبار، BOM یا نرخ دستمزد به‌روزرسانی می‌شوند.
              </span>
              <button
                onClick={() => setIsDetailModalOpen(false)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs transition-colors cursor-pointer"
              >
                بستن پنجره
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
