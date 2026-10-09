/**
 * v10.0.41 (TD-1141): the status changes a project's detail window offers. The server already accepts a status on
 * `PUT /projects/:id` (a cancel is refused while an allocation is open, TD-759); before, no screen sent «متوقف‌شده» or
 * «لغوشده», so a project could not be paused or cancelled. A paused project resumes as «برنامه‌ریزی‌شده» and the
 * progress matrix sync of the same save moves it on to «در حال انجام» or «تکمیل‌شده» by its own progress (TD-738).
 * A cancelled or completed project offers no change.
 */
export interface ProjectStatusAction {
  target: 'paused' | 'cancelled' | 'planned';
  label: string;
  confirmTitle: string;
  confirmMessage: string;
  danger: boolean;
}

const PAUSE: ProjectStatusAction = {
  target: 'paused',
  label: 'توقف پروژه',
  confirmTitle: 'توقف پروژه',
  confirmMessage: 'پروژه «متوقف‌شده» می‌شود و پیشرفت مراحل وضعیت آن را تغییر نمی‌دهد تا دوباره ادامه یابد.',
  danger: false,
};

const CANCEL: ProjectStatusAction = {
  target: 'cancelled',
  label: 'لغو پروژه',
  confirmTitle: 'لغو پروژه',
  confirmMessage: 'پروژه «لغوشده» می‌شود و مواد تازه نمی‌گیرد؛ این کار از این پنجره برنمی‌گردد.',
  danger: true,
};

const RESUME: ProjectStatusAction = {
  target: 'planned',
  label: 'ادامه پروژه',
  confirmTitle: 'ادامه پروژه',
  confirmMessage: 'پروژه از توقف بیرون می‌آید و وضعیت آن از پیشرفت مراحل خوانده می‌شود.',
  danger: false,
};

export function projectStatusActions(status: string | null | undefined): ProjectStatusAction[] {
  switch (String(status ?? 'planned') || 'planned') {
    case 'planned':
    case 'in_progress':
      return [PAUSE, CANCEL];
    case 'paused':
      return [RESUME, CANCEL];
    default:
      return [];
  }
}
