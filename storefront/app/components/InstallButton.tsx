import { useEffect, useState } from 'react';
import { Smartphone } from 'lucide-react';

/** Chrome's install offer (not in the DOM types yet) */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * «نصب روی گوشی»: shown only when the browser offers to install the site (Android Chrome and others that send
 * beforeinstallprompt); iPhone users add it from the share menu, as Safari offers no such event.
 */
export function InstallButton() {
  const [offer, setOffer] = useState<InstallPromptEvent | null>(null);
  useEffect(() => {
    const keep = (event: Event) => {
      event.preventDefault();
      setOffer(event as InstallPromptEvent);
    };
    const installed = () => setOffer(null);
    window.addEventListener('beforeinstallprompt', keep);
    window.addEventListener('appinstalled', installed);
    return () => {
      window.removeEventListener('beforeinstallprompt', keep);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);
  if (!offer) return null;
  return (
    <button
      type="button"
      onClick={async () => {
        await offer.prompt();
        await offer.userChoice.catch(() => undefined);
        setOffer(null);
      }}
      className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-control border border-current/20 px-4 font-medium"
    >
      <Smartphone className="size-5" strokeWidth={1.75} aria-hidden />
      نصب پاپیتال روی گوشی
    </button>
  );
}
