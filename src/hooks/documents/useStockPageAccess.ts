import { useAuth } from '../../contexts/AuthContext';
import { userHoldsPermission } from '../../lib/permissions/userHoldsPermission';
import { stockPageAccess, type StockPageAccess } from '../../lib/documents/stockDocumentAccess';

/**
 * v9.0.241 (TD-791): نوع‌هایی از صفحه اسناد انبار که کاربر جاری ثبت قطعی آن‌ها را دارد (`stockDocumentAccess.ts`). شیء هر
 * بار تازه ساخته می‌شود؛ اثرها به `key` آن وابسته شوند.
 */
export function useStockPageAccess(): StockPageAccess {
  const { userPermissions } = useAuth();
  return stockPageAccess(permission => userHoldsPermission(userPermissions, permission));
}
