import { useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../common/Modal';
import { confirmAction } from '../ConfirmDialogHost';
import { mediaErrorMessage } from '../../lib/media/mediaApi';
import {
  createMediaSection, deleteMediaSection, movedIds, reorderMediaSections, updateMediaSection, type MediaSection, type MediaSectionInput,
} from '../../lib/media/mediaSectionsApi';
import { MediaSectionFields, MediaSectionRow } from './MediaSectionRow';

export const SECTIONS_MODAL_TITLE = 'مدیریت بخش‌ها';
export const ADD_SECTION_TEXT = 'افزودن بخش';

interface Props {
  sections: MediaSection[];
  onClose: () => void;
  /** the stored sections after a move */
  onReplace: (sections: MediaSection[]) => void;
  /** reload after an add, edit or delete */
  onReload: () => void;
}

/** v10.0.27 (N-05 PR 3): add, rename, delete and order the library's sections (media.manage) */
export function MediaSectionsModal({ sections, onClose, onReplace, onReload }: Props) {
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);

  const run = async (work: () => Promise<void>, failText: string): Promise<boolean> => {
    setIsSaving(true);
    setError(null);
    try {
      await work();
      return true;
    } catch (err: unknown) {
      setError(mediaErrorMessage(err, failText));
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const create = (input: MediaSectionInput) => run(async () => {
    await createMediaSection(input);
    toast.success('بخش افزوده شد.');
    setFormKey(k => k + 1);
    onReload();
  }, 'افزودن بخش ناموفق بود.');

  const save = (section: MediaSection, input: MediaSectionInput) => run(async () => {
    await updateMediaSection(section.id, { version: section.version, ...input });
    toast.success('بخش ذخیره شد.');
    onReload();
  }, 'ذخیره بخش ناموفق بود.');

  const move = (section: MediaSection, step: -1 | 1) => {
    const ids = sections.map(s => s.id);
    const next = movedIds(ids, section.id, step);
    if (next === ids) return;
    void run(async () => onReplace(await reorderMediaSections(next)), 'تغییر ترتیب بخش‌ها ناموفق بود.');
  };

  const remove = async (section: MediaSection) => {
    const ok = await confirmAction({
      title: 'حذف بخش',
      message: `بخش «${section.title}» حذف شود؟`,
      confirmText: 'حذف',
      cancelText: 'انصراف',
    });
    if (!ok) return;
    await run(async () => {
      await deleteMediaSection(section.id);
      toast.success('بخش حذف شد.');
      onReload();
    }, 'حذف بخش ناموفق بود.');
  };

  return (
    <Modal isOpen onClose={onClose} title={SECTIONS_MODAL_TITLE} size="md">
      <div className="space-y-4" dir="rtl">
        {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs font-semibold text-rose-700">{error}</p>}
        <ul className="space-y-2">
          {sections.map((section, index) => (
            <MediaSectionRow
              key={section.id}
              section={section}
              isFirst={index === 0}
              isLast={index === sections.length - 1}
              busy={isSaving}
              onMove={step => move(section, step)}
              onSave={input => save(section, input)}
              onDelete={() => void remove(section)}
            />
          ))}
        </ul>
        <div className="border-t border-slate-100 pt-3 space-y-2">
          <h3 className="text-xs font-black text-slate-700">{ADD_SECTION_TEXT}</h3>
          <MediaSectionFields key={formKey} initial={{ title: '', description: '' }} busy={isSaving} submitText={ADD_SECTION_TEXT} onSubmit={input => void create(input)} />
        </div>
      </div>
    </Modal>
  );
}
