/**
 * v10.0.16 (D-11): نصب برنامه روی گوشی. اندروید (کروم و مرورگرهای همانند) رویداد `beforeinstallprompt` را می‌فرستد و دکمه
 * «نصب برنامه» همان را نشان می‌دهد. آیفون چنین رویدادی ندارد، پس دکمه راهنمای «افزودن به صفحه اصلی» را باز می‌کند.
 * برنامه‌ای که نصب‌شده باز شده (display-mode: standalone) دکمه را نشان نمی‌دهد.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallMode = 'prompt' | 'ios-guide' | 'none';

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());

export function isIosDevice(userAgent: string, platform: string, maxTouchPoints: number): boolean {
  return /iphone|ipad|ipod/i.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
}

export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);
}

export function installMode(): InstallMode {
  if (typeof window === 'undefined' || isStandaloneDisplay()) return 'none';
  if (deferredPrompt) return 'prompt';
  return isIosDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints ?? 0) ? 'ios-guide' : 'none';
}

export function subscribeInstallMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** پنجره نصب اندروید را نشان می‌دهد؛ رویداد فقط یک بار به کار می‌رود */
export async function promptInstall(): Promise<boolean> {
  const event = deferredPrompt;
  if (!event) return false;
  deferredPrompt = null;
  notify();
  await event.prompt();
  const choice = await event.userChoice;
  return choice.outcome === 'accepted';
}

/** شنونده‌های نصب را یک بار ثبت می‌کند (main.tsx) */
export function listenForInstallPrompt(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notify();
  });
}
