import { permissionDefinition } from './permissionCatalog.js';

/**
 * v10.0.85 (TD-1185): the refusal a user reads names each permission by its Persian catalog title, never its key
 * (a key outside the catalog, which `requirePermission` never accepts, keeps its own text).
 */
export function permissionRequiredMessage(keys: readonly string[]): string {
  const titles = keys.map(k => `«${permissionDefinition(k)?.title ?? k}»`).join(' یا ');
  return `شما مجوز لازم (${titles}) برای انجام این کار را ندارید`;
}
