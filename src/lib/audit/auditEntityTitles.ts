/**
 * v12 phase 9a (V12_SITE_NEXT_START_PLAN.md §6, site review 3.2b): the title the audit screens show for a stored entity
 * name that no longer reads right. Audit rows keep the name they were written with (old and new rows answer one filter,
 * and `PURGEABLE_AUDIT_ENTITIES` purges by it); only what a colleague reads changes.
 */
const AUDIT_ENTITY_TITLES: Readonly<Record<string, string>> = {
  // the WooCommerce shop's catalog and stock pushes, written as «فروشگاه اینترنتی» before the new site had its own section
  'فروشگاه اینترنتی': 'ووکامرس (سایت قدیم)',
};

export const auditEntityTitle = (entity: string | null | undefined): string => {
  const name = String(entity ?? '');
  return AUDIT_ENTITY_TITLES[name] ?? name;
};
