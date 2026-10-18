import { useState } from 'react';
import { Paperclip } from 'lucide-react';
import { Modal } from '../common/Modal';
import { CrmAttachmentsPanel } from './CrmAttachmentsPanel';
import type { CrmAttachmentOwner } from '../../lib/crm/crmAttachments';

interface CrmAttachmentsWindowProps {
  owner: CrmAttachmentOwner;
  ownerId: number;
  title: string;
  onClose: () => void;
  onCountChange?: (count: number) => void;
}

/**
 * v10.2 package 7 (N-02 §3.3): the attachments of one activity or follow-up in a window. While a file is being sent or
 * removed the window does not close, by Esc, the backdrop or its close button.
 */
export function CrmAttachmentsWindow({ owner, ownerId, title, onClose, onCountChange }: CrmAttachmentsWindowProps) {
  const [busy, setBusy] = useState(false);
  const close = () => {
    if (!busy) onClose();
  };
  return (
    <Modal isOpen onClose={close} title={`پیوست‌های «${title}»`} icon={<Paperclip size={18} />} size="xl"
      closeOnEscape={!busy} closeOnBackdropClick={!busy} layerClassName="z-[70]">
      <CrmAttachmentsPanel owner={owner} ownerId={ownerId} onBusyChange={setBusy} onCountChange={onCountChange} />
    </Modal>
  );
}
