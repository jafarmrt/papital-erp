import { useEffect, useEffectEvent, useState } from 'react';
import toast from 'react-hot-toast';
import { errorMessageOf, toPersianDigits } from '../../../utils';
import { useOpeningRead } from '../../../hooks/queries/readOnEveryOpening';
import { useProductProgressQuery } from '../../../hooks/queries/useProjectWorkspaceQueries';

/** where the progress matrix stands, for the «تکمیل‌شده» box of a delivery */
export interface DeliveryMatrix {
  /** the matrix of this opening is not read yet */
  loading: boolean;
  /** the read failed and nothing of this opening was read */
  failed: boolean;
  allCompleted: boolean;
  total: number;
  completed: number;
  missing: number;
}

/**
 * Whether a delivery may also set the project «تکمیل‌شده»: only when every cell of the progress matrix («۳. پیشرفت هر
 * کالا») is ticked. 10.3 (ARCH review finding 3): the matrix is the progress tab's read (`useProductProgressQuery`),
 * read again on each opening of the tab and whenever a save invalidates the project, never one an earlier visit left in
 * the cache. A box ticked while the matrix was complete is unticked once a newer read says it is not.
 */
export function useDeliveryCompletion(projectId: number, alreadyCompleted: boolean) {
  const query = useProductProgressQuery(projectId);
  const read = useOpeningRead(query, true);
  const summary = read.data?.summary;
  const total = Number(summary?.total_matrix_cells) || 0;
  const completed = Number(summary?.completed_matrix_cells) || 0;
  const matrix: DeliveryMatrix = {
    loading: read.data === undefined && !read.error,
    failed: read.data === undefined && Boolean(read.error),
    allCompleted: Boolean(summary?.all_matrix_completed),
    total,
    completed,
    missing: Math.max(0, total - completed),
  };

  const [markCompleted, setMarkCompleted] = useState(false);
  if (markCompleted && read.data !== undefined && !matrix.allCompleted) setMarkCompleted(false);

  // v9.0.422 (TD-766): a failed read of the matrix is said, not shown as an incomplete matrix
  const sayLoadFailed = useEffectEvent(() => { toast.error(errorMessageOf(read.error) || 'خطا در دریافت ماتریس پیشرفت پروژه'); });
  useEffect(() => {
    if (read.failedAt) sayLoadFailed();
  }, [read.failedAt]);

  /** the refusal said when the box is asked for before the matrix is complete; null when the delivery may go */
  const blockedReason = (): string | null =>
    markCompleted && !matrix.allCompleted && !alreadyCompleted
      ? `تنها زمانی می‌توانید تیک تغییر وضعیت به تکمیل‌شده را بزنید که در زبانه «۳. پیشرفت هر کالا»، تمام گزینه‌های ماتریس پیشرفت فیزیکی محصولات تیک خورده باشند. (${toPersianDigits(matrix.completed)} از ${toPersianDigits(matrix.total)} مورد تکمیل شده است)`
      : null;

  return { matrix, markCompleted, setMarkCompleted, blockedReason };
}

export type DeliveryCompletion = ReturnType<typeof useDeliveryCompletion>;
