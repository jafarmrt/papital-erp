import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { confirmAction } from '../../components/ConfirmDialogHost';
import type { ProductionProject, ProjectInventoryControlSectionData, PurchaseListItem } from '../../types';
import { fetchJson } from '../../api';
import { errorMessageOf } from '../../utils';
import type { useProjectVersion } from '../useProjectVersion';
import { storedReservationShortages } from '../../lib/projects/projectReservationState';
import { finalizeReservationOutcome, reservationShortageMessage } from '../../lib/projects/reservationOutcome';
import type { ReservationShortage } from '../../lib/projects/projectReservation';
import type { ReservationReconcileResult } from '../../lib/projects/reservationReconcile';

/** پاسخ PUT /projects/:id؛ رزرو پروژه را سرور می‌نویسد (v8.0.58، TD-306) */
interface SavedProjectInventory {
  inventory_control?: { finalizedAt?: string; reservedItems?: unknown[]; reservationShortages?: unknown[] };
}

const reservedItemsOf = (inventoryControl: { reservedItems?: unknown } | null | undefined): unknown[] =>
  Array.isArray(inventoryControl?.reservedItems) ? inventoryControl.reservedItems : [];

interface InventoryReservationOptions {
  project: ProductionProject;
  projectVersion: ReturnType<typeof useProjectVersion>;
  sections: ProjectInventoryControlSectionData[];
  manualPurchaseItems: PurchaseListItem[];
  /** how many edits the tab has had; read when a save is sent */
  editsNow: () => number;
  /** the save answered: the unsaved mark goes only if no edit came after `editsAtSend` */
  saved: (editsAtSend: number) => void;
  onUpdate?: () => void | Promise<void>;
}

/**
 * «ذخیره فرم»، «ثبت نهایی و رزرو انبار»، «لغو ثبت نهایی» and «تکمیل رزرو» of the materials tab: each sends the sections
 * and the manual purchase rows in one `PUT /projects/:id` with the version they started from, and shows the reservation
 * the server wrote (v8.0.58 TD-306; v9.0.373 TD-819 shortages). 10.3 (ARCH review finding 3, part 11): moved out of
 * `useProjectInventory`; a save clears the unsaved mark only when nothing was edited while it was under way, so an edit
 * made then is neither lost nor marked saved.
 */
export function useInventoryReservation({ project, projectVersion, sections, manualPurchaseItems, editsNow, saved, onUpdate }: InventoryReservationOptions) {
  const [saving, setSaving] = useState(false);
  const [isFinalized, setIsFinalized] = useState<boolean>(!!project.inventory_control?.isFinalized);
  const [finalizedAt, setFinalizedAt] = useState<string | undefined>(project.inventory_control?.finalizedAt);
  const [reservedItems, setReservedItems] = useState<unknown[]>(() => reservedItemsOf(project.inventory_control));
  // v9.0.373 (TD-819): کمبود رزرو هنگام ثبت نهایی، نوشته سرور
  const [reservationShortages, setReservationShortages] = useState<ReservationShortage[]>(() => storedReservationShortages(project.inventory_control));

  // the project as read again (after a save, or a change elsewhere once the tab is clean)
  useEffect(() => {
    setIsFinalized(!!project.inventory_control?.isFinalized);
    setFinalizedAt(project.inventory_control?.finalizedAt);
    setReservedItems(reservedItemsOf(project.inventory_control));
    setReservationShortages(storedReservationShortages(project.inventory_control));
  }, [project]);

  /**
   * one `PUT /projects/:id` of the sections and manual rows with this finalize flag; `apply` shows the answer before the
   * save is over, a failure is said. `editsAtSend` is the edit count when the button was pressed, the moment the sections
   * sent were taken: an edit made later (while a confirm is open) stays unsaved
   */
  const put = async (editsAtSend: number, isFinalizedNow: boolean, failure: string, logged: string, apply: (answer: SavedProjectInventory) => void) => {
    try {
      setSaving(true);
      const answer = await fetchJson<SavedProjectInventory>(`/api/projects/${project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inventory_control: { sections, manualPurchaseItems, isFinalized: isFinalizedNow, lastUpdated: new Date().toISOString() },
          ...projectVersion.writeBase
        })
      });
      projectVersion.remember(answer, ['inventory']);
      saved(editsAtSend);
      apply(answer ?? {});
      void onUpdate?.();
    } catch (err) {
      console.error(logged, err);
      toast.error(errorMessageOf(err) || failure);
    } finally {
      setSaving(false);
    }
  };

  const handleFinalizeAndReserveStock = async () => {
    const editsAtSend = editsNow();
    if (isFinalized) {
      toast.error('این فهرست پیش‌تر ثبت نهایی شده و اقلام آن در انبار رزرو شده‌اند.');
      return;
    }
    if (!(await confirmAction({ title: 'ثبت نهایی و رزرو اقلام', message: 'آیا از ثبت نهایی و رزرو اقلام در انبار اطمینان دارید؟ پس از ثبت نهایی، موجودی این اقلام به این پروژه اختصاص خواهد یافت.' }))) {
      return;
    }
    // v8.0.58 (TD-306): رزرو را سرور از بخش‌ها می‌سازد؛ مرورگر فقط نتیجه ذخیره‌شده را نمایش می‌دهد
    await put(editsAtSend, true, 'خطا در ثبت نهایی و رزرو انبار', 'Error finalizing inventory reservation:', answer => {
      setIsFinalized(true);
      setFinalizedAt(answer.inventory_control?.finalizedAt);
      const reserved = reservedItemsOf(answer.inventory_control);
      setReservedItems(reserved);
      const shortages = storedReservationShortages(answer.inventory_control);
      setReservationShortages(shortages);
      // v10.0.116 (TD-1149): the message follows what the server reserved, not the button that was pressed
      const outcome = finalizeReservationOutcome(reserved, shortages);
      if (outcome.kind === 'success') toast.success(outcome.message);
      else toast(outcome.message, { icon: '⚠️' });
      const shortageMessage = reserved.length > 0 ? reservationShortageMessage(shortages) : null;
      if (shortageMessage) toast(shortageMessage, { icon: '⚠️' });
    });
  };

  const handleUnfinalizeReservation = async () => {
    const editsAtSend = editsNow();
    if (!(await confirmAction({ title: 'لغو ثبت نهایی', message: 'آیا از لغو ثبت نهایی و آزاد کردن رزرو انبار مطمئن هستید؟' }))) return;
    await put(editsAtSend, false, 'خطا در آزاد کردن رزرو انبار', 'Error unfreezing reservation:', () => {
      setIsFinalized(false);
      setFinalizedAt(undefined);
      setReservedItems([]);
      setReservationShortages([]);
      toast.success('رزرو انبار آزاد شد.');
    });
  };

  const handleSaveInventoryControl = async () => {
    await put(editsNow(), isFinalized, 'خطا در ذخیره‌سازی کنترل موجودی پروژه', 'Error saving project inventory control:', answer => {
      setReservedItems(reservedItemsOf(answer.inventory_control));
      setReservationShortages(storedReservationShortages(answer.inventory_control));
      toast.success('اطلاعات کنترل موجودی با موفقیت ذخیره شد.');
    });
  };

  /** TD-1341: «تکمیل رزرو» ثبت شد؛ نسخه و رزرو ذخیره‌شده همان پاسخ سرور است */
  const applyReservationReconcile = (result: ReservationReconcileResult) => {
    projectVersion.remember(result, ['inventory']);
    setReservedItems(reservedItemsOf(result?.inventory_control));
    setReservationShortages(storedReservationShortages(result?.inventory_control));
    void onUpdate?.();
  };

  return {
    saving, isFinalized, finalizedAt, reservedItems, reservationShortages,
    handleFinalizeAndReserveStock, handleUnfinalizeReservation, handleSaveInventoryControl, applyReservationReconcile,
  };
}
