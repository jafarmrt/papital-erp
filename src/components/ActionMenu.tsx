import { useState, useRef, useEffect, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical, LucideIcon } from 'lucide-react';
import { useClickOutside } from '../hooks/useClickOutside';
import { actionMenuPosition } from '../lib/ui/actionMenuPosition';

export interface ActionMenuItem {
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  variant?: 'default' | 'danger' | 'success' | 'warning';
  disabled?: boolean;
}

interface ActionMenuProps {
  items: ActionMenuItem[];
  align?: 'left' | 'right';
  triggerIcon?: LucideIcon;
  buttonClassName?: string;
  title?: string;
}

export function ActionMenu({
  items,
  align = 'left',
  triggerIcon: TriggerIcon = MoreVertical,
  buttonClassName = '',
  title = 'عملیات بیشتر'
}: ActionMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});
  const menuRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useClickOutside([menuRef, panelRef], () => setIsOpen(false), isOpen);

  // v10.0.x (TD-1238): منو در لایه رویی صفحه باز می‌شود تا جدولِ overflow آن را نبُرد؛ با پیمایش یا تغییر اندازه بسته می‌شود
  useEffect(() => {
    if (!isOpen) return;
    const close = () => setIsOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [isOpen]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  if (!items || items.length === 0) return null;

  return (
    <div className="relative inline-block text-right" ref={menuRef}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (!isOpen && menuRef.current) {
            setPanelStyle(actionMenuPosition(menuRef.current.getBoundingClientRect(), items.length, align, {
              width: window.innerWidth,
              height: window.innerHeight,
            }));
          }
          setIsOpen((prev) => !prev);
        }}
        title={title}
        className={
          buttonClassName ||
          'p-1.5 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700/60 rounded-lg transition-colors cursor-pointer inline-flex items-center justify-center'
        }
        aria-expanded={isOpen}
      >
        <TriggerIcon className="w-4 h-4" />
      </button>

      {isOpen && createPortal(
        <div
          ref={panelRef}
          role="menu"
          style={panelStyle}
          className="fixed z-[70] w-44 rounded-xl bg-white dark:bg-slate-800 shadow-xl border border-slate-200/80 dark:border-slate-700/80 py-1 focus:outline-none backdrop-blur-md animate-in fade-in zoom-in-95 duration-100"
          onClick={(e) => e.stopPropagation()}
        >
          {items.map((item, idx) => {
            const Icon = item.icon;
            let textColor = 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50';
            if (item.variant === 'danger') {
              textColor = 'text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40';
            } else if (item.variant === 'success') {
              textColor = 'text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40';
            } else if (item.variant === 'warning') {
              textColor = 'text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40';
            }

            return (
              <button
                key={idx}
                type="button"
                disabled={item.disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  setIsOpen(false);
                  item.onClick();
                }}
                className={`w-full text-right px-3 py-2 text-xs font-semibold flex items-center gap-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer ${textColor}`}
              >
                {Icon && <Icon className="w-3.5 h-3.5 shrink-0" />}
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}
