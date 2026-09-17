/**
 * TD-107 (v4.0.31) — مارکر مرکزی داده تستی
 * ========================================
 * تمام فیکسچرهای سینتتیک باید نام/عنوان/توضیح خود را با این مارکر علامت‌گذاری کنند
 * تا پاکسازی (dbTestHelper.cleanupAllTestFixtures) فقط و فقط رکوردهای حامل
 * مارکر را هدف بگیرد — نه واژگان عمومی مانند «آزمایشی/تستی/TEST» که با
 * داده واقعی کسب‌وکار تداخل معنایی دارد (کلاس نقض TD-064/TD-107).
 */
export const TEST_MARKER = 'ERP-TEST-MARKER';

/** نام/متن فیکسچر مارک‌دار بساز: `${TEST_MARKER} متن` */
export function withTestMarker(text: string): string {
  return `${TEST_MARKER} ${text}`;
}
