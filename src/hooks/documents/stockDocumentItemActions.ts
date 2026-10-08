import { toast } from 'react-hot-toast';
import { formatPersianNumber } from '../../utils';
import { Item } from '../../types';
import type { DocItemRow } from '../../components/documents/DocItemsTable';
import { reservationMatchesListItem, type GlobalReservation } from '../../lib/documents/stockReservations';
import type { StockDocumentForm } from './useStockDocumentForm';

/**
 * TD-080 (بخش ۳): کنترل‌کننده‌های اقلام فرم رسید/حواله انبار — منتقل‌شده بدون تغییر رفتار از DocumentsPage.
 * تابع ساده (بدون hook) است و در هر رندر با وضعیت تازه فرم ساخته می‌شود، مانند توابع داخلی صفحه اصلی.
 */
/**
 * v7.0.102 (TD-233): ردیف رزرو پیش‌فاکتور در پیام سقف خروج «پیش‌فاکتور» نامیده می‌شود، نه «پروژه».
 * v9.0.297 (TD-803): مقدار با رقم فارسی («(۴ عدد)»)، مثل همه عددهای پیام‌های این فایل.
 */
export function reservationSourceLabel(r: GlobalReservation): string {
  const kind = r.sourceType === 'proforma' ? 'پیش‌فاکتور' : 'پروژه';
  return `${kind} «${r.projectCode || r.projectTitle}» (${formatPersianNumber(r.reservedQty)} ${r.unit})`;
}

export function createStockDocumentItemActions(form: StockDocumentForm, itemsList: Item[]) {
  const {
    actionType, docItems, setDocItems, selectedItem, setSelectedItem, selectedItemObj, setSelectedItemObj,
    quantity, setQuantity, unitPrice, setUnitPrice, selectedProjectId, selectedProjectReservedItems,
    getItemReservationSummary,
  } = form;

  const handleAddAllProjectReservedItems = () => {
    if (selectedProjectReservedItems.length === 0) {
      toast.error('هیچ کالای رزرو شده‌ای برای این پروژه یافت نشد.');
      return;
    }

    // v7.0.102 (TD-233): چند ردیف رزرو یک کالا جمع می‌شوند (پیش‌تر آخرین ردیف جایگزین بقیه می‌شد) و مقدار هر کالا
    // به سقف قابل خروج همان لحظه محدود می‌شود تا خطای سقف به ثبت نهایی نرسد
    const qtyByItem = new Map<number, { item: Item; quantity: number }>();
    const missingItems: string[] = [];

    for (const rItem of selectedProjectReservedItems) {
      const matchedItem = itemsList.find(i => reservationMatchesListItem(rItem, i));

      if (matchedItem) {
        const current = qtyByItem.get(matchedItem.id);
        qtyByItem.set(matchedItem.id, { item: matchedItem, quantity: (current?.quantity || 0) + Number(rItem.reservedQty || 0) });
      } else {
        missingItems.push(rItem.itemName || rItem.itemCode);
      }
    }

    const itemsToAdd: DocItemRow[] = [];
    const cappedItems: string[] = [];
    for (const { item, quantity: reservedTotal } of qtyByItem.values()) {
      const { maxAllowedForExit } = getItemReservationSummary(item);
      const quantity = Math.min(reservedTotal, maxAllowedForExit);
      if (quantity < reservedTotal) cappedItems.push(`«${item.name}» (${formatPersianNumber(maxAllowedForExit)} ${item.unit})`);
      if (quantity <= 0) continue;
      itemsToAdd.push({
        item,
        quantity,
        unitPrice: Number(item.purchase_price || item.sell_price || 0)
      });
    }

    if (itemsToAdd.length > 0) {
      setDocItems(prev => {
        const newMap = new Map<number, DocItemRow>();
        for (const it of prev) {
          newMap.set(it.item.id, { ...it });
        }
        for (const it of itemsToAdd) {
          newMap.set(it.item.id, it);
        }
        return Array.from(newMap.values());
      });
      toast.success(`تعداد ${formatPersianNumber(itemsToAdd.length)} قلم کالای رزرو شده به حواله خروج افزوده شد.`);
    }

    if (cappedItems.length > 0) {
      toast(`مقدار این کالاها به موجودی قابل خروج محدود شد: ${cappedItems.join('، ')}`, { icon: '⚠️' });
    }

    if (missingItems.length > 0) {
      toast(`کالاهای زیر در پایگاه داده انبار به عنوان کالای فیزیکی فعال یافت نشدند: ${missingItems.join('، ')}`, { icon: '⚠️' });
    }
  };

  const handleAddSingleProjectReservedItem = (rItem: GlobalReservation) => {
    const matchedItem = itemsList.find(i => reservationMatchesListItem(rItem, i));

    if (!matchedItem) {
      toast.error(`کالای «${rItem.itemName || rItem.itemCode}» در انبار یافت نشد.`);
      return;
    }

    setDocItems(prev => {
      const existingIdx = prev.findIndex(p => p.item.id === matchedItem.id);
      if (existingIdx >= 0) {
        return prev.map((p, idx) => idx === existingIdx ? { ...p, quantity: rItem.reservedQty } : p);
      }
      return [...prev, {
        item: matchedItem,
        quantity: rItem.reservedQty,
        unitPrice: Number(matchedItem.purchase_price || matchedItem.sell_price || 0)
      }];
    });

    toast.success(`کالای «${matchedItem.name}» (${formatPersianNumber(rItem.reservedQty)} ${rItem.unit}) به اقلام حواله اضافه شد.`);
  };

  const handleItemSelect = (val: string, rawItem?: Item) => {
    setSelectedItem(val);
    setSelectedItemObj(rawItem || null);
    if (rawItem) {
      if (actionType === 'in') {
        const itemPurchasePrice = rawItem.purchase_price ? Number(rawItem.purchase_price) : 0;
        setUnitPrice(itemPurchasePrice > 0 ? itemPurchasePrice : '');
      }
    } else {
      setUnitPrice('');
    }
  };

  const handleAddItem = () => {
    if (!selectedItem || !selectedItemObj) {
      toast.error('لطفاً ابتدا کالا را انتخاب کنید.');
      return;
    }
    if (!quantity || Number(quantity) <= 0) {
      toast.error('لطفاً تعداد کالا را وارد کنید (باید بیشتر از صفر باشد).');
      return;
    }
    const it = selectedItemObj;
    const reqQty = Number(quantity);
    const itemPrice = Number(unitPrice || 0);

    if (actionType === 'out') {
      const { reservedForOtherProjects, maxAllowedForExit, matchingReservations } = getItemReservationSummary(it);

      const existingQtyInDoc = docItems.find(p => p.item.id === it.id)?.quantity || 0;
      const totalRequestedInDoc = existingQtyInDoc + reqQty;

      if (totalRequestedInDoc > maxAllowedForExit) {
        if (reservedForOtherProjects > 0) {
          const otherProjTitles = matchingReservations
            .filter(r => String(r.projectId) !== String(selectedProjectId))
            .map(reservationSourceLabel)
            .join('، ');

          toast.error(
            `خطا: امکان خروج بیش از ${formatPersianNumber(maxAllowedForExit)} ${it.unit} وجود ندارد!\nتعداد ${formatPersianNumber(reservedForOtherProjects)} ${it.unit} برای سایر پروژه‌ها و پیش‌فاکتورها (${otherProjTitles}) رزرو شده است و قابل خروج نمی‌باشد.`
          );
        } else {
          toast.error(`موجودی کافی نیست! موجودی قابل خروج: ${formatPersianNumber(maxAllowedForExit)} ${it.unit}`);
        }
        return;
      }
    }

    setDocItems(prev => {
      const existingIndex = prev.findIndex(p => p.item.id === it.id);
      if (existingIndex >= 0) {
        return prev.map((p, idx) => idx === existingIndex ? {
          ...p,
          quantity: p.quantity + reqQty,
          unitPrice: itemPrice > 0 ? itemPrice : p.unitPrice
        } : p);
      }
      return [...prev, { item: it, quantity: reqQty, unitPrice: itemPrice }];
    });

    setSelectedItem('');
    setSelectedItemObj(null);
    setQuantity('');
    setUnitPrice('');
  };

  const handleUpdateItemQty = (index: number, newQty: number) => {
    if (newQty <= 0) return;
    const dItem = docItems[index];

    if (actionType === 'out') {
      const { reservedForOtherProjects, maxAllowedForExit, matchingReservations } = getItemReservationSummary(dItem.item);

      if (newQty > maxAllowedForExit) {
        if (reservedForOtherProjects > 0) {
          const otherProjTitles = matchingReservations
            .filter(r => String(r.projectId) !== String(selectedProjectId))
            .map(reservationSourceLabel)
            .join('، ');

          toast.error(
            `خطا: حداکثر سقف مجاز خروج این کالا ${formatPersianNumber(maxAllowedForExit)} ${dItem.item.unit} است. ${formatPersianNumber(reservedForOtherProjects)} ${dItem.item.unit} برای ${otherProjTitles} رزرو است.`
          );
        } else {
          toast.error(`حداکثر موجودی قابل خروج ${formatPersianNumber(maxAllowedForExit)} ${dItem.item.unit} می‌باشد.`);
        }
        return;
      }
    }

    setDocItems(prev => prev.map((item, idx) => idx === index ? { ...item, quantity: newQty } : item));
  };

  const handleUpdateItemPrice = (index: number, newPrice: number) => {
    setDocItems(prev => prev.map((item, idx) => idx === index ? { ...item, unitPrice: Math.max(0, newPrice) } : item));
  };

  const handleRemove = (id: number) => {
    setDocItems(prev => prev.filter(p => p.item.id !== id));
  };

  return {
    handleAddAllProjectReservedItems,
    handleAddSingleProjectReservedItem,
    handleItemSelect,
    handleAddItem,
    handleUpdateItemQty,
    handleUpdateItemPrice,
    handleRemove,
  };
}

export type StockDocumentItemActions = ReturnType<typeof createStockDocumentItemActions>;
