import { Item, Category } from '../../../types';
import { WarehouseItem } from '../../../hooks/queries/useSettingsQueries';

export interface ItemFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  item?: Item | null;
  editingItem?: Item | null;
  categories?: Category[];
  allCategories?: Category[];
  warehouses?: WarehouseItem[];
  onSave?: (data: Partial<Item>) => Promise<void>;
  onSuccess?: () => void | Promise<any>;
  type?: 'product' | 'raw_material' | '';
  typeFilter?: 'product' | 'raw_material' | '';
}

export interface ItemFormData {
  name: string;
  code: string;
  category: string;
  type: 'product' | 'raw_material';
  unit: string;
  current_stock: number;
  initial_cost: number;
  reorder_point: number;
  thumbnail: string;
  color: string;
  material: string;
  weight: string;
  size: string;
  stocks: Record<string, number>;
}

export const PREDEFINED_COLORS = [
  'طلایی', 'نقره‌ای', 'برنزی', 'مشکی', 'سفید', 'قرمز', 'آبی',
  'سبز', 'زرد', 'بنفش', 'صورتی', 'قهوه‌ای', 'کرم', 'طوسی',
  'هفت‌رنگ', 'رزگلد', 'دودی', 'فیروزه‌ای', 'یشمی', 'عسلی'
];

export const PREDEFINED_MATERIALS = [
  'استیل', 'برنج', 'زاماک', 'مس', 'نقره', 'طلا', 'تیتانیوم',
  'سنگ طبیعی', 'سنگ مصنوعی', 'کریستال', 'شیشه', 'سرامیک',
  'رزین', 'پلاستیک', 'چوب', 'چرم طبیعی', 'چرم مصنوعی', 'بافت/نخ',
  'سواروسکی', 'مروارید پرورشی', 'مروارید مصنوعی', 'ترانسفر'
];
