import { useCallback, useMemo, useState } from 'react';
import { latestProjectVersion, projectVersionOf } from '../lib/projects/projectVersion';
import { projectPartTokensOf, type ProjectPartTokens, type ProjectWriteBase } from '../lib/projects/projectParts';

interface VersionedProject {
  id?: number | null;
  version?: unknown;
  partTokens?: unknown;
}

/**
 * v9.0.385 (TD-742، تصمیم ت۳ الف): نسخه‌ای که ذخیره بعدی پروژه (`PUT /projects/:id`) می‌فرستد. تازه‌ترین نسخه میان پروژه‌ای که
 * زبانه از آن ساخته شده و پاسخ ذخیره‌های همین زبانه است، تا ذخیره دوم پیش از بارگذاری دوباره پروژه ۴۰۹ نگیرد.
 * TD-1342 (بستهٔ ۱۲ بند ۴، ت۴۲ ب): نشانهٔ بخش‌های همان نسخه هم با ذخیره می‌رود (`partTokens`)، تا نسخهٔ کهنه‌ای که فقط حواله،
 * تخصیص مواد یا تأیید گزارش کارگاه آن را کهنه کرده جلوی ذخیرهٔ زبانه را نگیرد.
 */
export function useProjectVersion(project: VersionedProject | null | undefined) {
  const projectId = project?.id ?? null;
  const [saved, setSaved] = useState<{ id: number | null; version?: number; partTokens?: ProjectPartTokens }>({ id: null });
  const savedHere = saved.id === projectId ? saved : { id: projectId };
  const version = latestProjectVersion(project?.version, savedHere.version);
  // نشانه‌ها از همان منبعی می‌آیند که تازه‌ترین نسخه را داد؛ پاسخی بی نشانه نشانه‌های پیشین را نگه می‌دارد (فقط ۴۰۹ بیهوده)
  const projectVersion = projectVersionOf(project?.version);
  const partTokens = savedHere.version !== undefined && (projectVersion === undefined || savedHere.version > projectVersion)
    ? savedHere.partTokens ?? projectPartTokensOf(project)
    : projectPartTokensOf(project);

  /** پاسخ ذخیره یا بارگذاری پروژه را به خاطر می‌سپارد */
  const remember = useCallback((response: unknown) => {
    const body = response && typeof response === 'object' ? (response as VersionedProject) : {};
    if (body.id !== projectId) return;
    setSaved(prev => {
      const prevHere = prev.id === projectId ? prev : { id: projectId };
      const next = latestProjectVersion(prevHere.version, body.version);
      const tokens = next === projectVersionOf(body.version) ? projectPartTokensOf(body) ?? prevHere.partTokens : prevHere.partTokens;
      return { id: projectId, version: next, partTokens: tokens };
    });
  }, [projectId]);

  /** نسخه و نشانه‌هایی که بدنهٔ ذخیره می‌فرستد */
  const tokensKey = partTokens ? JSON.stringify(partTokens) : '';
  // همان نسخه و همان نشانه‌ها همان شیء است، تا وابستگی‌های هوک‌ها با هر نمایش عوض نشوند
  const writeBase = useMemo<ProjectWriteBase>(
    () => ({ version, ...(tokensKey ? { partTokens: JSON.parse(tokensKey) as ProjectPartTokens } : {}) }),
    [version, tokensKey],
  );

  return { version, partTokens, writeBase, remember };
}
