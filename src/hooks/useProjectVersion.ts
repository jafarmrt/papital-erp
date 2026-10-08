import { useCallback, useState } from 'react';
import { latestProjectVersion } from '../lib/projects/projectVersion';

interface VersionedProject {
  id?: number | null;
  version?: unknown;
}

/**
 * v9.0.385 (TD-742، تصمیم ت۳ الف): نسخه‌ای که ذخیره بعدی پروژه (`PUT /projects/:id`) می‌فرستد. تازه‌ترین نسخه میان پروژه‌ای که
 * زبانه از آن ساخته شده و پاسخ ذخیره‌های همین زبانه است، تا ذخیره دوم پیش از بارگذاری دوباره پروژه ۴۰۹ نگیرد.
 */
export function useProjectVersion(project: VersionedProject | null | undefined) {
  const projectId = project?.id ?? null;
  const [saved, setSaved] = useState<{ id: number | null; version?: number }>({ id: null });
  const version = latestProjectVersion(project?.version, saved.id === projectId ? saved.version : undefined);

  /** پاسخ ذخیره یا بارگذاری پروژه را به خاطر می‌سپارد */
  const remember = useCallback((response: unknown) => {
    const body = response && typeof response === 'object' ? (response as VersionedProject) : {};
    if (body.id !== projectId) return;
    setSaved(prev => ({ id: projectId, version: latestProjectVersion(prev.id === projectId ? prev.version : undefined, body.version) }));
  }, [projectId]);

  return { version, remember };
}
