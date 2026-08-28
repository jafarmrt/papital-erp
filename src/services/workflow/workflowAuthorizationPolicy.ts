import { 
  UserAuthContext, 
  WorkflowPermission 
} from './contracts/workflowDomainContracts.js';

export class WorkflowAuthorizationPolicy {
  /**
   * Equivalent roles mapping dictionary
   */
  static equivalentRolesMap: Record<string, string[]> = {
    'admin': ['admin', 'superadmin', 'manager'],
    'superadmin': ['superadmin', 'admin'],
    'manager': ['manager', 'admin'],
    'warehouse': ['warehouse', 'storekeeper', 'warehouse_manager', 'admin'],
    'warehouse_manager': ['warehouse_manager', 'warehouse', 'admin'],
    'storekeeper': ['storekeeper', 'warehouse', 'admin'],
    'accounting': ['accounting', 'accountant', 'financial_manager', 'admin'],
    'accountant': ['accountant', 'accounting', 'admin'],
    'financial_manager': ['financial_manager', 'accounting', 'admin'],
    'sales': ['sales', 'sales_expert', 'sales_manager', 'admin'],
    'sales_manager': ['sales_manager', 'sales', 'admin']
  };

  /**
   * Get equivalent role array for a given role key
   */
  static getEquivalentRoles(roleKey: string): string[] {
    const key = (roleKey || '').trim().toLowerCase();
    if (!key) return [];
    return this.equivalentRolesMap[key] || [key, 'admin'];
  }

  /**
   * Check if a user's role matches required role considering equivalence rules
   */
  static checkUserRoleMatch(userRole: string | undefined, requiredRole: string | undefined): boolean {
    if (!requiredRole || requiredRole.trim() === '' || requiredRole === '*' || requiredRole.toLowerCase() === 'all') {
      return true;
    }

    const normUserRole = (userRole || '').trim().toLowerCase();
    const normReqRole = requiredRole.trim().toLowerCase();

    if (normUserRole === 'admin' || normUserRole === 'superadmin') {
      return true;
    }

    if (normUserRole === normReqRole) {
      return true;
    }

    const equivalent = this.getEquivalentRoles(normReqRole);
    return equivalent.includes(normUserRole);
  }

  /**
   * Evaluates standard authorization action for workflow permission/role
   */
  static authorizeAction(
    userCtx: UserAuthContext,
    requiredRole?: string,
    requiredPermissions?: string[],
    actionScope?: WorkflowPermission
  ): boolean {
    const normRole = (userCtx.role || '').trim().toLowerCase();
    if (normRole === 'admin' || normRole === 'superadmin') {
      return true;
    }

    if (actionScope && userCtx.permissions.includes(actionScope)) {
      return true;
    }

    if (requiredPermissions && requiredPermissions.length > 0) {
      const hasPerm = requiredPermissions.some(p => userCtx.permissions.includes(p));
      if (hasPerm) return true;
    }

    if (requiredRole) {
      return this.checkUserRoleMatch(userCtx.role, requiredRole);
    }

    return true;
  }
}
