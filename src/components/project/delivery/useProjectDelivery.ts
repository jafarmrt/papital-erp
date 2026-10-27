import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';
import type { ProductionProject, ProjectProductItem } from '../../../types';
import { fetchJson } from '../../../api';
import { errorMessageOf, toPersianDigits } from '../../../utils';
import { invalidatePreset } from '../../../lib/queryInvalidation';
import { useWarehousesQuery } from '../../../hooks/queries/useSettingsQueries';
import { useProjectPermissions } from '../../../hooks/useProjectPermissions';
import { useProjectDeliveryCost } from '../../../hooks/useProjectMaterialReports';
import { deliveryCostOutlook } from '../../../lib/projects/deliveryCostSuggestion';
import { overDeliveriesOf, type ProjectOverDeliveryView } from '../ProjectOverDeliveryPrompt';
import { productionCostAskOf, type ProductionCostAsk } from './ProductionCostPrompt';
import { useDeliveryCompletion } from './useDeliveryCompletion';

interface DeliveryLineBody {
  itemId: number;
  quantity: number;
  location: string;
  unitPrice: number | undefined;
  notes: string;
}

interface DeliveryBody {
  itemsToAdd: DeliveryLineBody[];
  markCompleted: boolean;
  overDeliveryReason?: string;
  productionCostReason?: string;
}

/** v10.2.3 (TD-1290): one product of a delivery with the quantity its request carries */
interface DeliveryTarget {
  product: ProjectProductItem;
  quantity: number;
}

/**
 * A delivery the server refused for a reason it needs, resent with it: over the plan (v8.0.72, TD-327) or a cost other than
 * the project's real cost (v11 phase 6.1ث, decision ت۵۲-۳). The body keeps a reason already given, so a delivery that needs
 * both asks for them one after the other.
 */
export type PendingReason =
  | { kind: 'over_delivery'; body: DeliveryBody; targets: DeliveryTarget[]; items: ProjectOverDeliveryView[] }
  | { kind: 'production_cost'; body: DeliveryBody; targets: DeliveryTarget[]; ask: ProductionCostAsk };

interface DeliveryAnswer {
  success?: boolean;
  addedCount?: number;
  message?: string;
  refNumber?: string | number;
  error?: string;
}

/** V3.1.0: the project's own products; a project without a product list delivers its one item, never a made-up product */
export function deliveryProductsOf(project: ProductionProject): ProjectProductItem[] {
  if (Array.isArray(project.products) && project.products.length > 0) return project.products;
  return project.item_id ? [{
    id: 'prod-main',
    item_id: project.item_id,
    item_code: project.item_code || '',
    item_name: project.item_name || '',
    customer_code: '',
    quantity: project.quantity,
    unit: project.unit || 'عدد',
    needs_assembly: true,
  }] : [];
}

/**
 * «ورود به انبار» of a project's products: the quantities and unit costs typed per product, the destination warehouse,
 * the 1402 cost outlook and the sends (one product, a batch, or a resend over the plan with a reason). The rules are those
 * of v10.2.3 (TD-1290); 10.3 (ARCH review finding 3) moved them out of the tab and reads the matrix and the delivery cost
 * through the shared cache, with the fresh cost read before a send in `readDeliveryCostNow`.
 */
export function useProjectDelivery(project: ProductionProject, onUpdate: () => void) {
  // v9.0.417 (TD-752): ورود به انبار با کلیدهای `POST /projects/:id/add-to-inventory`؛ از v9.0.454 (TD-923) `projects.edit` و `warehouse.in`
  const { canDeliver } = useProjectPermissions();
  const queryClient = useQueryClient();
  const alreadyCompleted = project.status === 'completed';
  const completion = useDeliveryCompletion(project.id, alreadyCompleted);
  const [submitting, setSubmitting] = useState(false);
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  // v8.0.72 (TD-327) / v11 phase 6.1ث: the delivery the server refused for a missing reason, and the reason typed for it
  const [pendingReason, setPendingReason] = useState<PendingReason | null>(null);
  const [reasonText, setReasonText] = useState('');
  const { data: warehouses = [] } = useWarehousesQuery();
  const [chosenLocation, setTargetLocation] = useState('');
  const targetLocation = chosenLocation || warehouses[0]?.code || '';
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const products = useMemo(() => deliveryProductsOf(project), [project]);
  // v10.0.28 (TD-977): مقدار پیش‌فرض همان مقدار برنامه است؛ بی برنامه خالی می‌ماند و هیچ عدد ساختگی (۱۰۰) فرستاده نمی‌شود
  const [producedQuantities, setProducedQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(products.map(p => [p.id, Number(p.quantity) > 0 ? Number(p.quantity) : 0])));
  // v10.0.28 (TD-977): the unit cost is sent only when typed; the cached weighted average is only the field's hint
  const [unitCosts, setUnitCosts] = useState<Record<string, number>>({});

  // v10.2.3 (TD-1290): changing the quantity of a product the over-plan box is about closes it, so a stale quantity is never resent with a new price
  // v10.2.3 (TD-1290): changing the quantity of a product a reason box is about closes it, so a stale quantity is never
  // resent; v11 phase 6.1ث: so does changing its cost, since a cleared cost may need no reason
  const closeAskAbout = (prodId: string, changed: (t: DeliveryTarget) => boolean) =>
    setPendingReason(prev => (prev && prev.targets.some(t => t.product.id === prodId && changed(t)) ? null : prev));
  const handleQtyChange = (prodId: string, val: number) => {
    setProducedQuantities(prev => ({ ...prev, [prodId]: val }));
    closeAskAbout(prodId, t => t.quantity !== val);
  };
  const handleCostChange = (prodId: string, val: number) => {
    setUnitCosts(prev => ({ ...prev, [prodId]: val }));
    closeAskAbout(prodId, () => true);
  };

  // v11 phase 6.1ث (S2, decision ت۵۲-۳): the server prices the receipt from the project's 1402 under the project lock; the
  // tab reads the same report to show the computed unit cost in each empty cost field and the 1402 outlook
  const deliveryCost = useProjectDeliveryCost(project.id, canDeliver, 0);
  // v10.2.3 (TD-1290): only the delivered products lose the unit cost typed for them. 10.3 (review of part 10): a
  // delivery posts a production receipt, so the stock, documents, kardex and accounting screens are refreshed as after
  // any stock document (the product rows' stock among them), not only the project; the project's delivery cost, under
  // the project, is read again by the same invalidation
  const delivered = (productIds: readonly string[]) => {
    setUnitCosts(prev => Object.fromEntries(Object.entries(prev).filter(([id]) => !productIds.includes(id))));
    void invalidatePreset(queryClient, 'documentChange');
    onUpdate();
  };
  /** a refused delivery that asked for «تکمیل‌شده» reads the matrix again: the refusal may be the matrix changed elsewhere */
  const refused = (body: DeliveryBody) => {
    if (body.markCompleted) completion.recheck();
  };
  const productItemId = (p: ProjectProductItem) => Number(p.item_id || project.item_id) || 0;
  /** the typed cost; none means the server's computed cost */
  const typedCostOf = (p: ProjectProductItem): number | undefined => {
    const cost = unitCosts[p.id];
    return cost && cost > 0 ? Number(cost) : undefined;
  };
  const outlookOf = (targets: readonly ProjectProductItem[], typed: (p: ProjectProductItem) => number | undefined) =>
    deliveryCost.status === 'ready'
      ? deliveryCostOutlook(deliveryCost.data, targets.map(p => ({ itemId: productItemId(p), quantity: producedQuantities[p.id] ?? 0, typedUnitCost: typed(p) ?? null })))
      : null;
  const selectedProducts = products.filter(p => selectedIds.has(p.id));
  // the 1402 outlook of the selected products, else of all (a batch, or the one product), at their typed costs
  const outlookTargets = selectedProducts.length > 0 ? selectedProducts : products;
  const costOutlook = outlookOf(outlookTargets, typedCostOf);
  /**
   * the unit cost the server computes for this product with an empty cost field; null when hidden. In a batch of several
   * products that completes the plan it is the product's share of the spread (review of S2), else the product on its own.
   */
  const computedCostOf = (p: ProjectProductItem): number | null => {
    const i = outlookTargets.indexOf(p);
    if (costOutlook?.multiProduct && costOutlook.rule === 'complete' && i >= 0) return costOutlook.unitCosts[i] ?? null;
    return outlookOf([p], () => undefined)?.unitCosts[0] ?? null;
  };

  const postDelivery = (body: DeliveryBody) =>
    fetchJson<DeliveryAnswer | null>(`/projects/${project.id}/add-to-inventory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const accepted = (res: DeliveryAnswer | null): boolean => Boolean(res && (res.success || res.addedCount !== undefined || res.message));
  const refNote = (res: DeliveryAnswer | null) => (res?.refNumber ? ` (رسید تولید ${toPersianDigits(res.refNumber)})` : '');

  // v8.0.72 (TD-327) / v11 phase 6.1ث: a delivery over the plan, or at a cost other than the real one, is refused without
  // a reason; the reason box opens and the same delivery is resent with it
  const askReason = (err: unknown, body: DeliveryBody, targets: DeliveryTarget[]): boolean => {
    const items = overDeliveriesOf(err);
    if (items) {
      setReasonText('');
      setPendingReason({ kind: 'over_delivery', body, targets, items });
      return true;
    }
    const ask = productionCostAskOf(err);
    if (!ask) return false;
    setReasonText('');
    setPendingReason({ kind: 'production_cost', body, targets, ask });
    return true;
  };

  /** one product, or a batch: the checks, the send and the reason box when the server asks for a reason */
  const deliver = async ({ targets, noteOf, setBusy, saidOf, failure, batch }: {
    targets: DeliveryTarget[];
    noteOf: (p: ProjectProductItem) => string;
    setBusy: (busy: boolean) => void;
    saidOf: (res: DeliveryAnswer) => string;
    failure: string;
    /** a batch clears the selection it delivered */
    batch: boolean;
  }) => {
    const blocked = completion.blockedReason();
    if (blocked) {
      toast.error(blocked);
      return;
    }
    setBusy(true);
    const body: DeliveryBody = {
      itemsToAdd: targets.map(({ product: p, quantity }) => ({
        itemId: productItemId(p), quantity, location: targetLocation, unitPrice: typedCostOf(p), notes: noteOf(p),
      })),
      markCompleted: completion.markCompleted,
    };
    try {
      const res = await postDelivery(body);
      if (res && accepted(res)) {
        toast.success(`${saidOf(res)}${refNote(res)}`);
        if (batch) setSelectedIds(new Set());
        delivered(targets.map(t => t.product.id));
      } else {
        toast.error(res?.error || failure);
        refused(body);
      }
    } catch (err) {
      if (!askReason(err, body, targets)) {
        toast.error(errorMessageOf(err) || 'خطا در ارتباط با سامانه');
        refused(body);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleAddToInventory = async (product: ProjectProductItem) => {
    if (!(product.item_id || project.item_id)) {
      toast.error('کد کالا برای این محصول در انبار مشخص نشده است');
      return;
    }
    // v9.0.381 (TD-741): مقدار صفر خطاست و به مقدار برنامه پروژه برنمی‌گردد
    const qty = producedQuantities[product.id] ?? 0;
    if (!(qty > 0)) {
      toast.error('مقدار تحویل باید بزرگتر از صفر باشد');
      return;
    }
    await deliver({
      targets: [{ product, quantity: Number(qty) }],
      noteOf: p => `ورود مستقیم از پروژه کنترل تولید ${project.project_code || project.id} - محصول ${p.item_name}`,
      setBusy: setSubmitting,
      saidOf: () => `تعداد ${toPersianDigits(qty)} ${product.unit} «${product.item_name}» به انبار تحویل داده شد`,
      failure: 'خطا در ثبت ورود به انبار',
      batch: false,
    });
  };

  const handleBatchAddToInventory = async (targetProducts: ProjectProductItem[]) => {
    // v9.0.381 (TD-741): محصول با مقدار صفر یا نامعتبر کل تحویل را نگه می‌دارد و بی‌صدا کنار گذاشته نمی‌شود
    const zeroQty = targetProducts.find(p => !((producedQuantities[p.id] ?? 0) > 0));
    if (zeroQty) {
      toast.error(`مقدار تحویل «${zeroQty.item_name}» باید بزرگ‌تر از صفر باشد`);
      return;
    }
    // v10.2.3 (TD-1290): the products are picked first, so each line keeps its product for a resend
    const deliverable = targetProducts.filter(p => productItemId(p) > 0 && (producedQuantities[p.id] ?? 0) > 0);
    if (deliverable.length === 0) {
      toast.error('هیچ محصول معتبر و قابل تحویلی انتخاب نشده است');
      return;
    }
    await deliver({
      targets: deliverable.map(p => ({ product: p, quantity: Number(producedQuantities[p.id] ?? 0) })),
      noteOf: p => `ورود دسته‌ای از پروژه کنترل تولید ${project.project_code || project.id} - محصول ${p.item_name}`,
      setBusy: setBatchSubmitting,
      saidOf: res => `تعداد ${toPersianDigits(res.addedCount || deliverable.length)} قلم محصول با موفقیت به انبار تحویل داده شدند`,
      failure: 'خطا در ثبت دسته‌ای محصولات به انبار',
      batch: true,
    });
  };

  /** the refused delivery again with the reason; a second reason it still needs opens the box again */
  const confirmReason = async () => {
    const reason = reasonText.trim();
    if (!pendingReason || !reason) return;
    const pending = pendingReason;
    const body: DeliveryBody = pending.kind === 'over_delivery'
      ? { ...pending.body, overDeliveryReason: reason }
      : { ...pending.body, productionCostReason: reason };
    setSubmitting(true);
    try {
      const res = await postDelivery(body);
      // the answer is read as for the first send (review of S2): a body that is not a success is not reported as one
      if (!accepted(res)) {
        toast.error(res?.error || 'خطا در ثبت ورود به انبار');
        refused(pending.body);
        return;
      }
      toast.success(`${pending.kind === 'over_delivery' ? 'تحویل بیش از برنامه با دلیل ثبت شد' : 'تحویل با دلیل بهای تولید ثبت شد'}${refNote(res)}`);
      setPendingReason(null);
      setSelectedIds(new Set());
      delivered(pending.targets.map(t => t.product.id));
    } catch (err) {
      if (!askReason(err, body, pending.targets)) {
        toast.error(errorMessageOf(err) || 'خطا در ارتباط با سامانه');
        refused(pending.body);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const singlePlan = deliveryCost.data?.products.length === 1 ? deliveryCost.data.products[0] : null;
  const remainingPlanQty = singlePlan ? Math.max(singlePlan.plannedQty - singlePlan.deliveredQty, producedQuantities[products[0]?.id] ?? 0) : null;
  const totalDeliveredQty = products.reduce((sum, p) => sum + (Number(producedQuantities[p.id]) || Number(p.quantity) || 0), 0);

  return {
    canDeliver, alreadyCompleted, completion, products, warehouses, targetLocation, setTargetLocation,
    selectedIds, setSelectedIds, selectedProducts, producedQuantities, unitCosts, handleQtyChange, handleCostChange,
    computedCostOf, deliveryCost, costOutlook, remainingPlanQty, totalDeliveredQty,
    submitting, batchSubmitting, handleAddToInventory, handleBatchAddToInventory,
    pendingReason, reasonText, setReasonText, setPendingReason, confirmReason,
  };
}

export type ProjectDelivery = ReturnType<typeof useProjectDelivery>;
