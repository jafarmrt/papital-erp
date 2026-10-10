import type { WorkflowPreset } from '../../constants/presets';
import { toPersianDigits } from '../../utils/persianNumber';

/**
 * v10.0.91 (TD-1193): a new production stage preset of the settings page. Its title numbers it with Persian digits and its
 * description starts empty (the field shows a placeholder), so nothing the user did not type is saved. Before, the title was
 * «الگوی مراحل تولید 1» and the description was saved as «شرح مختصر فرآیند تولید...».
 */
export function newWorkflowPreset(id: string, number: number): WorkflowPreset {
  return {
    id,
    title: `الگوی مراحل تولید ${toPersianDigits(number)}`,
    description: '',
    isArchived: false,
    stages: [{ title: 'مرحله اول تولید', isOptionalPerProduct: false, defaultTasks: [] }],
  };
}
