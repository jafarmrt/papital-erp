import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { StatInfo } from '../../types';
import { QUERY_KEYS } from '../../lib/queryKeys';

export interface BIFastMoving {
  id: number;
  name: string;
  code: string;
  unit: string;
  total_qty: number;
  current_stock: number;
}

export interface BIDeadStock {
  id: number;
  name: string;
  code: string;
  unit: string;
  current_stock: number;
  weighted_average_cost: number;
}

export interface BIAlarm {
  id: number;
  name: string;
  code: string;
  current_stock: number;
  reorder_point: number;
  unit: string;
  type: string;
}

/** v8.0.54 (TD-316): گردش یک ماه شمسی (`month` = `YYYY/MM`) */
export interface BITrend {
  month: string;
  type: 'in' | 'out';
  total: number;
}

export interface BIDashboardStats {
  reorderAlarms: BIAlarm[];
  fastMoving: BIFastMoving[];
  slowMoving: BIDeadStock[];
  deadStock: BIDeadStock[];
  totalValuation: number;
  locations: Record<string, number>;
  /** v9.0.90 (TD-496): items with stock per warehouse code; quantities of different units are never added */
  locationItemCounts?: Record<string, number>;
  warehouses: { id: number; name: string; code: string; is_active: number }[];
  monthlyTrends: BITrend[];
  fastDays?: number;
  slowDays?: number;
  deadDays?: number;
}

export function useDashboardStatsQuery() {
  return useQuery<StatInfo>({
    queryKey: QUERY_KEYS.dashboard.general(),
    queryFn: () => fetchJson('/stats'),
    staleTime: 1000 * 30, // 30s
  });
}

export function useDashboardBIStatsQuery() {
  return useQuery<BIDashboardStats>({
    queryKey: QUERY_KEYS.dashboard.bi(),
    queryFn: () => fetchJson('/dashboard-bi-stats'),
    staleTime: 1000 * 30, // 30s
  });
}
