import { logger } from '../middleware/logger.js';

export interface SingleRuleCondition {
  field: string;
  operator: 
    | 'eq' | '=' | '==' 
    | 'neq' | '!=' 
    | 'gt' | '>' 
    | 'gte' | '>=' 
    | 'lt' | '<' 
    | 'lte' | '<=' 
    | 'in' | 'not_in' | 'nin'
    | 'contains' | 'like' | 'includes'
    | 'is_empty' | 'is_not_empty'
    | 'exists' | 'not_exists'
    | 'regex' | 'regexp'
    | string;
  value?: any;
}

export interface RuleGroup {
  logic?: 'AND' | 'OR' | 'NOT' | 'and' | 'or' | 'not';
  matchType?: 'AND' | 'OR' | 'NOT';
  conditions?: (SingleRuleCondition | RuleGroup | (SingleRuleCondition | RuleGroup)[])[];
  rules?: (SingleRuleCondition | RuleGroup | (SingleRuleCondition | RuleGroup)[])[];
}

export type RuleExpression = SingleRuleCondition | RuleGroup | (SingleRuleCondition | RuleGroup)[];

export interface EvaluationTraceItem {
  type: 'rule' | 'group';
  field?: string;
  operator?: string;
  expectedValue?: any;
  actualValue?: any;
  logic?: 'AND' | 'OR' | 'NOT';
  passed: boolean;
  reason?: string;
  children?: EvaluationTraceItem[];
}

export interface EvaluationTraceResult {
  passed: boolean;
  durationMs: number;
  traceTree: EvaluationTraceItem;
  flatTrace: { path: string; passed: boolean; details: string }[];
}

export class RuleEngineService {
  /**
   * Resolve nested property paths using dot notation and array index notation.
   * Examples: 'payload.totalAmount', 'items[0].unitPrice', 'document.items.0.price'
   */
  public static resolvePath(path: string, context: any): any {
    if (!path || context === null || context === undefined) return undefined;

    // Normalize path by replacing brackets like [0] with .0
    const cleanPath = path
      .trim()
      .replace(/^event\./, '')
      .replace(/^context\./, '')
      .replace(/\[(\d+)\]/g, '.$1');

    const segments = cleanPath.split('.').filter(Boolean);
    let current = context;

    for (const seg of segments) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = current[seg];
    }

    return current;
  }

  /**
   * Evaluate a single rule condition against resolved context value
   */
  public static evaluateSingleRule(rule: SingleRuleCondition, context: any): { passed: boolean; actualValue: any; reason: string } {
    const actualValue = this.resolvePath(rule.field, context);
    const targetValue = rule.value;
    const op = String(rule.operator || '=').toLowerCase().trim();

    let passed = false;
    let reason = '';

    switch (op) {
      case '=':
      case '==':
      case 'eq':
      case 'equal':
        passed = String(actualValue ?? '') === String(targetValue ?? '');
        reason = passed ? `مقدار ${actualValue} برابر با ${targetValue} است` : `مقدار واقعی (${actualValue}) برابر با (${targetValue}) نیست`;
        break;

      case '!=':
      case 'neq':
      case 'not_equal':
        passed = String(actualValue ?? '') !== String(targetValue ?? '');
        reason = passed ? `مقدار ${actualValue} مخالف ${targetValue} است` : `مقدار واقعی (${actualValue}) برابر با (${targetValue}) است`;
        break;

      case '>':
      case 'gt':
        passed = Number(actualValue ?? 0) > Number(targetValue ?? 0);
        reason = passed ? `مقدار ${actualValue} بزرگتر از ${targetValue} است` : `مقدار واقعی (${actualValue}) بزرگتر از (${targetValue}) نیست`;
        break;

      case '>=':
      case 'gte':
        passed = Number(actualValue ?? 0) >= Number(targetValue ?? 0);
        reason = passed ? `مقدار ${actualValue} بزرگتر یا مساوی ${targetValue} است` : `مقدار واقعی (${actualValue}) کوچکتر از (${targetValue}) است`;
        break;

      case '<':
      case 'lt':
        passed = Number(actualValue ?? 0) < Number(targetValue ?? 0);
        reason = passed ? `مقدار ${actualValue} کوچکتر از ${targetValue} است` : `مقدار واقعی (${actualValue}) کوچکتر از (${targetValue}) نیست`;
        break;

      case '<=':
      case 'lte':
        passed = Number(actualValue ?? 0) <= Number(targetValue ?? 0);
        reason = passed ? `مقدار ${actualValue} کوچکتر یا مساوی ${targetValue} است` : `مقدار واقعی (${actualValue}) بزرگتر از (${targetValue}) است`;
        break;

      case 'in':
        if (Array.isArray(targetValue)) {
          passed = targetValue.map(String).includes(String(actualValue ?? ''));
        } else if (typeof targetValue === 'string') {
          const list = targetValue.split(',').map(s => s.trim());
          passed = list.includes(String(actualValue ?? ''));
        } else {
          passed = false;
        }
        reason = passed ? `مقدار ${actualValue} در لیست مجاز موجود است` : `مقدار واقعی (${actualValue}) در لیست مجاز یافت نشد`;
        break;

      case 'not_in':
      case 'nin':
        if (Array.isArray(targetValue)) {
          passed = !targetValue.map(String).includes(String(actualValue ?? ''));
        } else if (typeof targetValue === 'string') {
          const list = targetValue.split(',').map(s => s.trim());
          passed = !list.includes(String(actualValue ?? ''));
        } else {
          passed = true;
        }
        reason = passed ? `مقدار ${actualValue} در لیست نامجاز وجود ندارد` : `مقدار واقعی (${actualValue}) در لیست نامجاز مشاهده گردید`;
        break;

      case 'contains':
      case 'like':
      case 'includes':
        passed = String(actualValue ?? '').toLowerCase().includes(String(targetValue ?? '').toLowerCase());
        reason = passed ? `عبارت شامل ${targetValue} می‌باشد` : `عبارت شامل ${targetValue} نمی‌باشد`;
        break;

      case 'is_empty':
      case 'empty':
        passed = actualValue === null || actualValue === undefined || String(actualValue).trim() === '' || (Array.isArray(actualValue) && actualValue.length === 0);
        reason = passed ? 'فیلد مورد نظر خالی است' : 'فیلد مورد نظر دارای مقدار است';
        break;

      case 'is_not_empty':
      case 'not_empty':
        passed = actualValue !== null && actualValue !== undefined && String(actualValue).trim() !== '' && (!Array.isArray(actualValue) || actualValue.length > 0);
        reason = passed ? 'فیلد دارای مقدار است' : 'فیلد خالی است';
        break;

      case 'exists':
        passed = actualValue !== undefined && actualValue !== null && actualValue !== '';
        reason = passed ? 'فیلد در داده‌ها وجود دارد' : 'فیلد یافت نشد یا مقدار آن تهی است';
        break;

      case 'not_exists':
        passed = actualValue === undefined || actualValue === null || actualValue === '';
        reason = passed ? 'فیلد در داده‌ها وجود ندارد' : 'فیلد در داده‌ها موجود است';
        break;

      case 'regex':
      case 'regexp':
        try {
          const re = new RegExp(String(targetValue), 'i');
          passed = re.test(String(actualValue ?? ''));
          reason = passed ? `مقدار با الگوی عبارت باقاعده تطابق دارد` : `مقدار با الگوی عبارت باقاعده تطابق ندارد`;
        } catch (err: any) {
          passed = false;
          reason = `خطای الگوی عبارت باقاعده: ${err.message}`;
        }
        break;

      default:
        logger.warn(`[RuleEngine] Unknown operator: ${op}`);
        passed = false;
        reason = `عملگر ناشناخته: ${op}`;
        break;
    }

    return { passed, actualValue, reason };
  }

  /**
   * Main evaluation entry point - returns boolean
   */
  public static evaluate(expression: RuleExpression, context: any): boolean {
    const trace = this.evaluateWithTrace(expression, context);
    return trace.passed;
  }

  /**
   * Evaluates expression and produces detailed evaluation trace tree & log
   */
  public static evaluateWithTrace(expression: RuleExpression, context: any): EvaluationTraceResult {
    const startTime = Date.now();

    if (!expression) {
      const emptyTrace: EvaluationTraceItem = {
        type: 'group',
        logic: 'AND',
        passed: true,
        reason: 'هیچ شرطی تعریف نشده است (ارزیابی همیشه مثبت است)',
        children: []
      };
      return {
        passed: true,
        durationMs: Date.now() - startTime,
        traceTree: emptyTrace,
        flatTrace: []
      };
    }

    const flatTraceList: { path: string; passed: boolean; details: string }[] = [];
    const traceTree = this.evaluateExpressionNode(expression, context, flatTraceList, '');

    return {
      passed: traceTree.passed,
      durationMs: Date.now() - startTime,
      traceTree,
      flatTrace: flatTraceList
    };
  }

  /**
   * Helper: Recursive node evaluation (single condition or group)
   */
  private static evaluateExpressionNode(
    node: RuleExpression, 
    context: any, 
    flatTraceList: { path: string; passed: boolean; details: string }[],
    parentPath: string
  ): EvaluationTraceItem {
    // 1. If Array: treat as an AND/OR group depending on standard conventions (default AND)
    if (Array.isArray(node)) {
      return this.evaluateGroupNode({ logic: 'AND', conditions: node }, context, flatTraceList, parentPath);
    }

    // 2. Check if Single Rule or Group
    const objNode = node as any;
    const isSingleRule = typeof objNode.field === 'string' && objNode.operator !== undefined;

    if (isSingleRule) {
      const singleRule = objNode as SingleRuleCondition;
      const res = this.evaluateSingleRule(singleRule, context);
      const currentPath = parentPath ? `${parentPath}.${singleRule.field}` : singleRule.field;

      flatTraceList.push({
        path: currentPath,
        passed: res.passed,
        details: `${singleRule.field} ${singleRule.operator} ${singleRule.value ?? ''} => (واقعی: ${res.actualValue ?? 'null'}) [${res.reason}]`
      });

      return {
        type: 'rule',
        field: singleRule.field,
        operator: singleRule.operator,
        expectedValue: singleRule.value,
        actualValue: res.actualValue,
        passed: res.passed,
        reason: res.reason
      };
    } else {
      // 3. Group evaluation
      return this.evaluateGroupNode(objNode as RuleGroup, context, flatTraceList, parentPath);
    }
  }

  /**
   * Helper: Evaluate Group Node (AND, OR, NOT)
   */
  private static evaluateGroupNode(
    group: RuleGroup, 
    context: any, 
    flatTraceList: { path: string; passed: boolean; details: string }[],
    parentPath: string
  ): EvaluationTraceItem {
    const rawLogic = (group.logic || group.matchType || 'AND').toString().toUpperCase().trim();
    const logic: 'AND' | 'OR' | 'NOT' = rawLogic === 'OR' ? 'OR' : (rawLogic === 'NOT' ? 'NOT' : 'AND');

    const childrenRaw = group.conditions || group.rules || [];
    const childrenList = Array.isArray(childrenRaw) ? childrenRaw : [];

    if (childrenList.length === 0) {
      return {
        type: 'group',
        logic,
        passed: true,
        reason: 'گروه خالی (بدون شرط)',
        children: []
      };
    }

    const childrenTrace: EvaluationTraceItem[] = [];
    let innerPassed = logic === 'OR' ? false : true;

    for (let i = 0; i < childrenList.length; i++) {
      const child = childrenList[i];
      const childPath = parentPath ? `${parentPath}.g[${i}]` : `g[${i}]`;
      const childResult = this.evaluateExpressionNode(child, context, flatTraceList, childPath);
      childrenTrace.push(childResult);

      if ((logic === 'AND' || logic === 'NOT') && !childResult.passed) {
        innerPassed = false;
      } else if (logic === 'OR' && childResult.passed) {
        innerPassed = true;
      }
    }

    if (logic === 'OR' && childrenTrace.every(c => !c.passed)) {
      innerPassed = false;
    }

    let groupPassed = innerPassed;
    if (logic === 'NOT') {
      groupPassed = !innerPassed;
    }

    return {
      type: 'group',
      logic,
      passed: groupPassed,
      reason: `گروه ${logic}: ${groupPassed ? 'قبول شد' : 'رد شد'}`,
      children: childrenTrace
    };
  }

  /**
   * Validate Rule Expression Syntax
   */
  public static validateExpression(expression: RuleExpression): { valid: boolean; error?: string } {
    if (!expression) return { valid: true };

    const validOperators = [
      '=', '==', 'eq', 'equal',
      '!=', 'neq', 'not_equal',
      '>', 'gt',
      '>=', 'gte',
      '<', 'lt',
      '<=', 'lte',
      'in', 'not_in', 'nin',
      'contains', 'like', 'includes',
      'is_empty', 'empty', 'is_not_empty', 'not_empty',
      'exists', 'not_exists',
      'regex', 'regexp'
    ];

    const validateNode = (node: any, path: string): string | null => {
      if (!node) return null;

      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) {
          const err = validateNode(node[i], `${path}[${i}]`);
          if (err) return err;
        }
        return null;
      }

      if (typeof node !== 'object') {
        return `عنصر غیرمجاز در مسیر ${path}`;
      }

      const isSingle = typeof node.field === 'string' && node.operator !== undefined;

      if (isSingle) {
        if (!node.field || typeof node.field !== 'string') {
          return `نام فیلد در مسیر ${path} نامعتبر است`;
        }
        const op = String(node.operator || '').toLowerCase().trim();
        if (!validOperators.includes(op)) {
          return `عملگر '${node.operator}' در مسیر ${path} پشتیبانی نمی‌شود`;
        }
        return null;
      } else {
        // Validate group
        const children = node.conditions || node.rules;
        if (children && !Array.isArray(children)) {
          return `مجموعه زیرشرایط در گروه ${path} باید به صورت آرایه باشد`;
        }
        if (children && Array.isArray(children)) {
          for (let i = 0; i < children.length; i++) {
            const err = validateNode(children[i], `${path}.conditions[${i}]`);
            if (err) return err;
          }
        }
        return null;
      }
    };

    const error = validateNode(expression, 'root');
    return error ? { valid: false, error } : { valid: true };
  }
}
