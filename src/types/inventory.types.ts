export interface Item {
  id: number;
  type: 'product' | 'raw_material';
  name: string;
  code: string;
  current_stock: number;
  unit: string;
  category?: string;
  image?: string;
  thumbnail?: string;
  reorder_point?: number;
  weightedAverageCost?: number;
  weighted_average_cost?: number;
  purchase_price?: number;
  sell_price?: number;
  color?: string;
  weight?: number;
  material?: string;
  size?: string;
}

export interface PendingMaterial {
  id: number;
  code: string;
  name: string;
  unit: string;
  category?: string;
  type?: string;
  projectId?: number | null;
  project_id?: number | null;
  projectTitle?: string;
  project_title?: string;
  requestedBy?: string;
  requested_by?: string;
  status: 'pending' | 'approved' | 'rejected';
  reorderPoint?: number;
  reorder_point?: number;
  weightedAverageCost?: number;
  weighted_average_cost?: number;
  color?: string;
  weight?: number;
  material?: string;
  size?: string;
  image?: string;
  thumbnail?: string;
  rejectionReason?: string;
  rejection_reason?: string;
  createdAt?: string;
  created_at?: string;
}

export interface Transaction {
  id: number;
  item_id: number;
  type: 'in' | 'out';
  quantity: number;
  date: string;
  document_type: string;
  document_ref: string;
  notes?: string;
  user?: string;
  // joined info
  item_name?: string;
  item_code?: string;
  item_unit?: string;
  item_type?: string;
}

export interface StatInfo {
  totalProducts: number;
  totalMaterials: number;
  lowStock: number;
  recentTx: number;
}

export interface Category {
  id: number;
  name: string;
  prefix: string;
  type: string;
  defaultUnit?: string;
  default_unit?: string;
}

export interface ItemPrice {
  id: number;
  item_id: number;
  title: string;
  price: number;
  currency: string;
}
