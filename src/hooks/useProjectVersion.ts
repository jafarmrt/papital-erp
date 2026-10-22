import { useCallback, useMemo, useState } from 'react';
import { latestProjectVersion, projectVersionOf } from '../lib/projects/projectVersion';
import { projectPartTokensOf, type ProjectPart, type ProjectPartTokens, type ProjectWriteBase } from '../lib/projects/projectParts';

interface VersionedProject {
  id?: number | null;
  version?: unknown;
  partTokens?: unknown;
}

/**
 * v9.0.385 (TD-742، تصمیم ت۳ الف): نسخه‌ای که ذخیره بعدی پروژه (`PUT /projects/:id`) می‌فرستد. تازه‌ترین نسخه میان پروژه‌ای که
 * زبانه از آن ساخته شده و پاسخ ذخیره‌های همین زبانه است، تا ذخیره دوم پیش از بارگذاری دوباره پروژه ۴۰۹ نگیرد.
 * TD-1342 (بستهٔ ۱۲ بند ۴، ت۴۲ ب): نشانهٔ بخش‌ها هم با ذخیره می‌رود (`partTokens`)، تا نسخهٔ کهنه‌ای که فقط حواله، تخصیص مواد یا
 * تأیید گزارش کارگاه آن را کهنه کرده جلوی ذخیرهٔ زبانه را نگیرد. از پاسخ هر ذخیره فقط نشانهٔ بخش‌هایی برداشته می‌شود که همان
 * ذخیره نوشت؛ بخش‌های دیگر نشانهٔ پروژه‌ای را نگه می‌دارند که صفحه نشان می‌دهد، تا تغییر کاربر دیگری در آن‌ها پنهان نماند.
 */
export function useProjectVersion(project: VersionedProject | null | undefined) {
  const projectId = project?.id ?? null;
  const [saved, setSaved] = useState<{ id: number | null; version?: number; partTokens?: ProjectPartTokens }>({ id: null });
  const savedHere = saved.id === projectId ? saved : { id: projectId };
  const version = latestProjectVersion(project?.version, savedHere.version);
  const projectVersion = projectVersionOf(project?.version);
  const projectTokens = projectPartTokensOf(project);
  // پاسخ ذخیره‌ای تازه‌تر از پروژهٔ بارگذاری‌شده: نشانهٔ بخش‌های ذخیره‌شده از پاسخ، باقی از پروژه
  const savedAhead = savedHere.version !== undefined && (projectVersion === undefined || savedHere.version > projectVersion);
  const partTokens = savedAhead && savedHere.partTokens ? { ...projectTokens, ...savedHere.partTokens } : projectTokens;

  /** پاسخ ذخیرهٔ بخش‌های `parts` (یا خواندن پروژه با `[]`) را به خاطر می‌سپارد: نسخه، و نشانهٔ همان بخش‌ها */
  const remember = useCallback((response: unknown, parts: readonly ProjectPart[]) => {
    const body = response && typeof response === 'object' ? (response as VersionedProject) : {};
    if (body.id !== projectId) return;
    setSaved(prev => {
      const prevHere = prev.id === projectId ? prev : { id: projectId };
      // نشانه‌های ذخیره‌های پیشین فقط تا وقتی که پروژهٔ بارگذاری‌شده به آن‌ها نرسیده
      const kept = prevHere.version !== undefined && (projectVersion === undefined || prevHere.version > projectVersion) ? prevHere.partTokens : undefined;
      const next = latestProjectVersion(prevHere.version, body.version);
      const answered = next === projectVersionOf(body.version) ? projectPartTokensOf(body) : undefined;
      const written: ProjectPartTokens = {};
      for (const part of parts) {
        const token = answered?.[part];
        if (token) written[part] = token;
      }
      const tokens = { ...kept, ...written };
      return { id: projectId, version: next, partTokens: Object.keys(tokens).length > 0 ? tokens : undefined };
    });
  }, [projectId, projectVersion]);

  /** نسخه و نشانه‌هایی که بدنهٔ ذخیره می‌فرستد */
  const tokensKey = partTokens ? JSON.stringify(partTokens) : '';
  // همان نسخه و همان نشانه‌ها همان شیء است، تا وابستگی‌های هوک‌ها با هر نمایش عوض نشوند
  const writeBase = useMemo<ProjectWriteBase>(
    () => ({ version, ...(tokensKey ? { partTokens: JSON.parse(tokensKey) as ProjectPartTokens } : {}) }),
    [version, tokensKey],
  );

  return { version, partTokens, writeBase, remember };
}
