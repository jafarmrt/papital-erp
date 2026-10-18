/**
 * v10.2.0: the answer of the WooCommerce order webhook goes to the shop, outside the application. A failed order
 * (or a database that cannot be reached) answered 200 with the error text itself, SQL and constraint names included.
 * A failure now answers only one general Persian message with its status; the order log in the application keeps
 * the details, and the order is processed again with the manual order sync.
 */
export const WOO_WEBHOOK_FAILED_MESSAGE =
  'پردازش این سفارش در برنامه انجام نشد؛ جزئیات در گزارش سفارش‌های ووکامرس برنامه است و سفارش با «همگام‌سازی دستی سفارش» دوباره پردازش می‌شود.';

export interface WooWebhookAnswer {
  success: boolean;
  status?: string;
  message: string;
  error?: string;
  [key: string]: unknown;
}

/** The answer of a processed order: a success as it is, a failure with the general message only */
export function wooWebhookAnswer<T extends { success: boolean; status?: string }>(result: T): T | WooWebhookAnswer {
  if (result.success !== false) return result;
  return { success: false, status: result.status || 'failed', message: WOO_WEBHOOK_FAILED_MESSAGE, error: WOO_WEBHOOK_FAILED_MESSAGE };
}

/** The answer when the webhook itself failed (database unreachable, unreadable secret …) */
export function wooWebhookErrorAnswer(): WooWebhookAnswer {
  return { success: false, status: 'failed', message: WOO_WEBHOOK_FAILED_MESSAGE, error: WOO_WEBHOOK_FAILED_MESSAGE };
}
