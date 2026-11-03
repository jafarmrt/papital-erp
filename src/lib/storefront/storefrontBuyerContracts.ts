import type { ApplicationStatus, BuyerAccountStatus, CatalogScope } from './storefrontBuyerRules.js';

/**
 * v11 phase 8.2b (package 18, start plan §6 and §8): the shapes the buyer group and buyer account routes take and answer,
 * on the ERP side (`/api/storefront/...`) and on the Storefront API (`/api/storefront/v1/...`). Amounts are whole rials as
 * text. The site's answers name no customer of the ERP, no balance and no other group.
 */

/** A buyer group as the «گروه‌های خریدار» section edits it */
export interface BuyerGroupInput {
  code: string;
  title: string;
  description: string;
  priceList: string;
  minOrderAmount: string;
  minLineQuantity: number;
  allowCard: boolean;
  allowOnAccount: boolean;
  creditLimit: string;
  catalogScope: CatalogScope;
  collections: string[];
  acceptsDiscounts: boolean;
  isActive: boolean;
  sortOrder: number;
}

export interface BuyerGroupRow extends BuyerGroupInput {
  id: number;
  /** live accounts approved into the group */
  accountCount: number;
  version: number;
}

export interface BuyerGroupsView {
  groups: BuyerGroupRow[];
  priceLists: string[];
  /** the collections of the live items, to pick a group's visible products from */
  collections: string[];
}

/** A row of the «خریداران عمده» page */
export interface BuyerAccountRow {
  id: number;
  name: string;
  phone: string;
  city: string;
  companyName: string;
  status: BuyerAccountStatus;
  applicationStatus: ApplicationStatus;
  groupId: number | null;
  groupTitle: string;
  customerId: number | null;
  customerName: string;
  hasPassword: boolean;
  appliedAt: string | null;
  createdAt: string;
  version: number;
}

export interface BuyerAccountPage {
  data: BuyerAccountRow[];
  total: number;
  page: number;
  limit: number;
}

export interface BuyerAccountDetail extends BuyerAccountRow {
  nationalId: string;
  economicCode: string;
  applicationNote: string;
  reviewedBy: string;
  reviewedAt: string | null;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  /** an unused set-password link exists until this time */
  passwordLinkExpiresAt: string | null;
  /** live customers whose phone matches the account's, to link on approval */
  customerMatches: Array<{ id: number; name: string; city: string }>;
  /** the live buyer groups to approve into (this page does not need the storefront settings key) */
  groupOptions: Array<{ id: number; title: string; isActive: boolean }>;
}

export interface ApproveBuyerRequest {
  groupId: number;
  /** an existing customer, or 0 to make one from the account */
  customerId: number;
  version: number;
}

/** A new set-password link, shown once to be sent to the buyer */
export interface PasswordLinkAnswer {
  token: string;
  expiresAt: string;
  account: BuyerAccountDetail;
}

/** Storefront API: what a signed-in buyer sees of their own account */
export interface StorefrontAccountView {
  name: string;
  phone: string;
  city: string;
  kind: 'retail' | 'wholesale';
  /** the wholesale application, as the buyer may see it */
  application: 'none' | 'pending' | 'approved' | 'declined';
  companyName: string;
  group: null | {
    code: string;
    title: string;
    minOrderAmount: string;
    minLineQuantity: number;
    paymentMethods: Array<'card' | 'on_account'>;
  };
}

export interface StorefrontSessionAnswer {
  /** the session token, answered only here; the app keeps it in an httpOnly cookie and sends it in `X-Buyer-Session` */
  sessionToken: string;
  expiresAt: string;
  account: StorefrontAccountView;
}

/** Storefront API: a group's price of each product the group may see */
export interface StorefrontGroupPrices {
  group: string;
  prices: Array<{ slug: string; price: string }>;
}

export interface RegisterRequest {
  name: string;
  phone: string;
  password: string;
}

export interface LoginRequest {
  phone: string;
  password: string;
}

export interface SetPasswordRequest {
  token: string;
  password: string;
}

export interface WholesaleApplyRequest {
  name: string;
  companyName: string;
  city: string;
  phone: string;
  nationalId: string;
  economicCode: string;
  note: string;
}
