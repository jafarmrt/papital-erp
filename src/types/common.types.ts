import type React from 'react';

export interface FairTradePrinciple {
  number: number;
  title: string;
  description: string;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  tag: string;
}

export interface DashboardShortcutItem {
  id: string;
  title: string;
  description: string;
  path: string;
  iconName: string;
  category: string;
  permission?: string;
  badge?: string;
  colorTheme: string;
}
