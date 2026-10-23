import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import type { ProductionProject, ProjectProductItem } from '../../../types';
import { fetchJson } from '../../../api';
import { errorMessageOf, toPersianDigits } from '../../../utils';
import { useWarehousesQuery } from '../../../hooks/queries/useSettingsQueries';
import { useProjectPermissions } from '../../../hooks/useProjectPermissions';
import { readDeliveryCostNow, useProjectDeliveryCost } from '../../../hooks/useProjectMaterialReports';
import { useRialDisplay } from '../../../hooks/useAppCurrency';
import { checkDeliveryPrices, deliveryCostOutlook, projectDeliverySuggestion } from '../../../lib/projects/deliveryCostSuggestion';
import { confirmAction } from '../../ConfirmDialogHost';
import { overDeliveriesOf, type ProjectOverDeliveryView } from '../ProjectOverDeliveryPrompt';
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
}

/** v10.2.3 (TD-1290): one product of a delivery with the quantity its request carries */
interface DeliveryTarget {
  product: ProjectProductItem;
  quantity: number;
}

/** v8.0.72 (TD-327): a delivery the server refused as over the plan, resent with a reason; v10.2.3 (TD-1290): with its products and the negative 1402 balance already accepted */
interface PendingOverDelivery {
  body: DeliveryBody;
  items: ProjectOverDeliveryView[];
  targets: DeliveryTarget[];
  confirmedRemaining: number | null;
}

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
  const rial = useRialDisplay();
  const alreadyCompleted = project.status === 'completed';
  const completion = useDeliveryCompletion(project.id, alreadyCompleted);
  const [submitting, setSubmitting] = useState(false);
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  // v8.0.72 (TD-327): تحویلی که سرور به‌خاطر بیش از برنامه بودن رد کرده و دلیلش
  const [overDelivery, setOverDelivery] = useState<PendingOverDelivery | null>(null);
  const [overDeliveryReason, setOverDeliveryReason] = useState('');
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
  const handleQtyChange = (prodId: string, val: number) => {
    setProducedQuantities(prev => ({ ...prev, [prodId]: val }));
    setOverDelivery(prev => (prev && prev.targets.some(t => t.product.id === prodId && t.quantity !== val) ? null : prev));
  };
  const handleCostChange = (prodId: string, val: number) => setUnitCosts(prev => ({ ...prev, [prodId]: val }));

  // v10.2.3 (TD-1290, finding D2): a single-product project suggests its unit cost from the 1402 balance; the user may change or clear it
  const [deliveryReload, setDeliveryReload] = useState(0);
  const deliveryCost = useProjectDeliveryCost(project.id, canDeliver, deliveryReload);
  // v10.2.3 (TD-1290): only the delivered products lose the unit cost typed for them
  const delivered = (productIds: readonly string[]) => {
    setUnitCosts(prev => Object.fromEntries(Object.entries(prev).filter(([id]) => !productIds.includes(id))));
    setDeliveryReload(n => n + 1);
    onUpdate();
  };
  const productItemId = (p: ProjectProductItem) => Number(p.item_id || project.item_id) || 0;
  const suggestedCostOf = (p: ProjectProductItem, quantity: number = producedQuantities[p.id] ?? 0): number | null =>
    deliveryCost.status === 'ready' && products.length === 1 ? projectDeliverySuggestion(deliveryCost.data, productItemId(p), quantity) : null;
  /** the cost sent: typed, else suggested; zero or empty means the weighted average */
  const postedCostOf = (p: ProjectProductItem): number | undefined => {
    const cost = unitCosts[p.id] !== undefined ? unitCosts[p.id] : suggestedCostOf(p);
    return cost && cost > 0 ? Number(cost) : undefined;
  };
  /** only the typed cost, for someone who does not see costs (no suggestion) */
  const typedCostOf = (p: ProjectProductItem): number | undefined => {
    const cost = unitCosts[p.id];
    return cost && cost > 0 ? Number(cost) : undefined;
  };
  // until the first answer, and after a delivery until the new balance, nothing is sent with a stale suggestion or none
  const costPending = canDeliver && deliveryCost.status === 'loading'
    && (deliveryCost.data === null || (deliveryCost.data.costVisible && products.length === 1));

  /**
   * v10.2.3 (TD-1290): the line prices checked against a fresh 1402 report right before the send, for the quantities the
   * request carries; null means nothing is sent. A delivery that makes the 1402 balance negative asks first, unless the
   * user accepted that balance or a worse one for this delivery (`confirmedRemaining`, the over-plan box). The fresh read
   * is skipped only when an earlier successful read said costs are not visible.
   */
  const pricesToPost = async (targets: DeliveryTarget[], confirmedRemaining: number | null): Promise<{ prices: Array<number | undefined>; remaining: number | null } | null> => {
    const typedOnly = () => ({ prices: targets.map(t => typedCostOf(t.product)), remaining: null });
    if (deliveryCost.data?.costVisible === false) return typedOnly();
    const fresh = await readDeliveryCostNow(project.id);
    if (!fresh) {
      toast.error('ماندهٔ کالای در جریان ساخت پروژه خوانده نشد؛ دوباره تلاش کنید.');
      return null;
    }
    if (!fresh.costVisible) return typedOnly();
    const check = checkDeliveryPrices(fresh, targets.map(t => ({
      itemId: productItemId(t.product), quantity: t.quantity, typedPrice: unitCosts[t.product.id], shownSuggestion: suggestedCostOf(t.product, t.quantity),
    })), products.length === 1);
    if (check.kind === 'suggestion_changed') {
      setDeliveryReload(n => n + 1);
      toast.error('ماندهٔ کالای در جریان ساخت پروژه از زمان خواندن این صفحه تغییر کرده و بهای پیشنهادی تازه شد؛ آن را بررسی کنید و دوباره ثبت کنید.');
      return null;
    }
    const { outlook } = check;
    if (check.overdraws && outlook && (confirmedRemaining === null || outlook.remaining < confirmedRemaining)) {
      const ok = await confirmAction({
        title: 'ماندهٔ کالای در جریان ساخت منفی می‌شود',
        message: `این ورود ${rial.amount(outlook.credit)} از کالای در جریان ساخت پروژه برمی‌دارد، بیش از ماندهٔ آن (${rial.amount(outlook.wipBalance)})، و ماندهٔ پروژه ${rial.amount(Math.abs(outlook.remaining))} منفی می‌شود. ثبت شود؟`,
        confirmText: 'ثبت',
        cancelText: 'انصراف',
      });
      if (!ok) return null;
    }
    return { prices: check.prices, remaining: check.overdraws && outlook ? outlook.remaining : null };
  };

  const postDelivery = (body: DeliveryBody & { overDeliveryReason?: string }) =>
    fetchJson<DeliveryAnswer | null>(`/projects/${project.id}/add-to-inventory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const accepted = (res: DeliveryAnswer | null): boolean => Boolean(res && (res.success || res.addedCount !== undefined || res.message));
  const refNote = (res: DeliveryAnswer | null) => (res?.refNumber ? ` (رسید تولید ${toPersianDigits(res.refNumber)})` : '');

  // v8.0.72 (TD-327): تحویل بیش از برنامه را سرور بی‌دلیل رد می‌کند؛ کادر دلیل باز می‌شود و همان تحویل با دلیل دوباره فرستاده می‌شود
  const askOverDeliveryReason = (err: unknown, body: DeliveryBody, targets: DeliveryTarget[], confirmedRemaining: number | null): boolean => {
    const items = overDeliveriesOf(err);
    if (!items) return false;
    setOverDeliveryReason('');
    setOverDelivery({ body, items, targets, confirmedRemaining });
    return true;
  };

  /** one product, or a batch: the checks, the prices, the send and the over-plan box when the server asks for a reason */
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
    const priced = await pricesToPost(targets, null);
    if (!priced) {
      setBusy(false);
      return;
    }
    const body: DeliveryBody = {
      itemsToAdd: targets.map(({ product: p, quantity }, i) => ({
        itemId: productItemId(p), quantity, location: targetLocation, unitPrice: priced.prices[i], notes: noteOf(p),
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
      }
    } catch (err) {
      if (!askOverDeliveryReason(err, body, targets, priced.remaining)) toast.error(errorMessageOf(err) || 'خطا در ارتباط با سامانه');
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
    // v10.2.3 (TD-1290): the products are picked before the prices, so each line keeps its product for a resend
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

  const confirmOverDelivery = async () => {
    const reason = overDeliveryReason.trim();
    if (!overDelivery || !reason) return;
    setSubmitting(true);
    try {
      // v10.2.3 (TD-1290): the resend prices its lines again from a fresh balance, never the stale body's suggestion, for
      // the quantities the refused request carried, which are the ones sent again
      const priced = await pricesToPost(overDelivery.targets, overDelivery.confirmedRemaining);
      if (!priced) return;
      const itemsToAdd = overDelivery.body.itemsToAdd.map((line, i) => ({ ...line, unitPrice: priced.prices[i] }));
      const res = await postDelivery({ ...overDelivery.body, itemsToAdd, overDeliveryReason: reason });
      toast.success(`تحویل بیش از برنامه با دلیل ثبت شد${refNote(res)}`);
      setOverDelivery(null);
      setSelectedIds(new Set());
      delivered(overDelivery.targets.map(t => t.product.id));
    } catch (err) {
      toast.error(errorMessageOf(err) || 'خطا در ارتباط با سامانه');
    } finally {
      setSubmitting(false);
    }
  };

  const selectedProducts = products.filter(p => selectedIds.has(p.id));
  // the 1402 outlook of the selected products, else of all (a batch, or the one product)
  const costOutlook = deliveryCost.status === 'ready'
    ? deliveryCostOutlook(deliveryCost.data, (selectedProducts.length > 0 ? selectedProducts : products).map(p => ({
      itemId: productItemId(p), quantity: producedQuantities[p.id] ?? 0, unitPrice: postedCostOf(p) ?? null,
    })))
    : null;
  const singleSuggestion = products.length === 1 ? suggestedCostOf(products[0]) : null;
  const singlePlan = deliveryCost.data?.products.length === 1 ? deliveryCost.data.products[0] : null;
  const remainingPlanQty = singlePlan ? Math.max(singlePlan.plannedQty - singlePlan.deliveredQty, producedQuantities[products[0]?.id] ?? 0) : null;
  const totalDeliveredQty = products.reduce((sum, p) => sum + (Number(producedQuantities[p.id]) || Number(p.quantity) || 0), 0);

  return {
    canDeliver, alreadyCompleted, completion, products, warehouses, targetLocation, setTargetLocation,
    selectedIds, setSelectedIds, selectedProducts, producedQuantities, unitCosts, handleQtyChange, handleCostChange,
    suggestedCostOf, deliveryCost, costPending, costOutlook, singleSuggestion, remainingPlanQty, totalDeliveredQty,
    submitting, batchSubmitting, handleAddToInventory, handleBatchAddToInventory,
    overDelivery, overDeliveryReason, setOverDeliveryReason, setOverDelivery, confirmOverDelivery,
  };
}

export type ProjectDelivery = ReturnType<typeof useProjectDelivery>;
