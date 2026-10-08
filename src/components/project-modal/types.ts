import { ProductionProject, Customer, Item } from '../../types';

export interface ProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectToEdit?: ProductionProject | null;
  customersList: Customer[];
  itemsList: Item[];
  onSuccess: () => void;
  /** v9.0.384 (TD-740): در ویرایش، دکمه بخش مراحل در جزئیات پروژه را باز می‌کند */
  onOpenStages?: (project: ProductionProject) => void;
  initialProducts?: Array<{
    item_id: number;
    item_code: string;
    item_name: string;
    quantity: number;
    unit?: string;
  }>;
  initialTitle?: string;
}

export interface ProductRow {
  id: string;
  item_id: number | null;
  item_code: string;
  item_name: string;
  customer_code: string;
  quantity: number;
  unit: string;
  needs_assembly: boolean;
  selected_optional_stages?: string[];
  notes: string;
}

export interface ProjectStage {
  title: string;
  assigned_personnel: string[];
  required_resources: string[];
}
