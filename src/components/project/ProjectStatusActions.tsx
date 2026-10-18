import { useEffect, useId, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { MoreHorizontal } from 'lucide-react';
import { fetchJson } from '../../api';
import { errorMessageOf } from '../../utils';
import { confirmAction } from '../ConfirmDialogHost';
import { projectStatusActions, type ProjectStatusAction } from '../../lib/projects/projectStatusActions';
import { PHONE_ONLY_TAP_TARGET } from '../../lib/pwa/phoneLayout';

interface ProjectStatusActionsProps {
  projectId: number;
  status: string | null | undefined;
  version: number | undefined;
  onSaved: (response: unknown) => void;
}

// v10.2.7 (10.2 package 10): at least 44 px high on a phone, where the phone header shows these buttons too
const BUTTON = `${PHONE_ONLY_TAP_TARGET} px-3 py-1.5 bg-white hover:bg-slate-50 text-xs font-bold rounded-xl transition-colors border border-slate-300 cursor-pointer disabled:opacity-50`;

/**
 * v10.0.66 (TD-1141): توقف، ادامه و لغو پروژه، با `PUT /projects/:id` و نسخه پروژه (TD-742). فراخواننده آن را فقط برای
 * دارنده `projects.edit` نشان می‌دهد؛ پیام رد سرور (مثلاً تخصیص مواد باز هنگام لغو) همان‌طور نشان داده می‌شود.
 * v10.2.1 (10.2 package 2, review U17): «لغو پروژه», which no screen undoes, sits in the «بیشتر» menu instead of beside
 * «توقف پروژه», so it is not pressed by mistake; it still asks before it is sent.
 */
export function ProjectStatusActions({ projectId, status, version, onSaved }: ProjectStatusActionsProps) {
  const [saving, setSaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const actions = projectStatusActions(status);
  const direct = actions.filter(action => !action.danger);
  const more = actions.filter(action => action.danger);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onPointer = (event: MouseEvent) => {
      if (menuRef.current && event.target instanceof Node && !menuRef.current.contains(event.target)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  if (actions.length === 0) return null;

  const run = async (action: ProjectStatusAction) => {
    if (saving) return;
    setMenuOpen(false);
    if (!(await confirmAction({ title: action.confirmTitle, message: action.confirmMessage, confirmText: action.label }))) return;
    setSaving(true);
    try {
      const res = await fetchJson(`/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: action.target, version }),
      });
      toast.success('وضعیت پروژه ذخیره شد');
      onSaved(res);
    } catch (err) {
      toast.error(errorMessageOf(err) || 'وضعیت پروژه ذخیره نشد');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {direct.map(action => (
        <button key={action.target} type="button" disabled={saving} onClick={() => void run(action)} className={`${BUTTON} text-slate-700`}>
          {action.label}
        </button>
      ))}
      {more.length > 0 && (
        <div ref={menuRef} className="relative">
          <button
            type="button"
            disabled={saving}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-controls={menuOpen ? menuId : undefined}
            onClick={() => setMenuOpen(open => !open)}
            className={`${BUTTON} text-slate-700 flex items-center gap-1`}
          >
            <MoreHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
            <span>بیشتر</span>
          </button>
          {menuOpen && (
            <div id={menuId} role="menu" aria-label="کارهای بیشتر پروژه" className="absolute left-0 top-full mt-1 z-20 min-w-[10rem] bg-white border border-slate-200 rounded-xl shadow-lg p-1">
              {more.map(action => (
                <button
                  key={action.target}
                  type="button"
                  role="menuitem"
                  onClick={() => void run(action)}
                  className={`w-full ${PHONE_ONLY_TAP_TARGET} text-right px-3 py-2 rounded-lg text-xs font-bold text-rose-700 hover:bg-rose-50 cursor-pointer`}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
