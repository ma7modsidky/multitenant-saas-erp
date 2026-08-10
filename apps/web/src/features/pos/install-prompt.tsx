'use client';

import { Download, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';

/** The non-standard install prompt event (Chromium). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * PWA install prompt (UI_UX_GUIDELINES §9 — the POS is an installable surface).
 *
 * Shows a small floating "Install app" action only while the browser is
 * offering installation (Chromium fires beforeinstallprompt when the manifest
 * + SW criteria are met). The prompt is browser-managed — we just surface the
 * trigger and hide once installed or dismissed. Never shown when already
 * running as a standalone installed app.
 */
export function PosInstallPrompt() {
  const t = useTranslations('modules.pos');
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    // Already running as an installed app — nothing to offer.
    if (window.matchMedia('(display-mode: standalone)').matches) return;

    const onPrompt = (event: Event) => {
      event.preventDefault();
      // eslint-disable-next-line no-restricted-syntax -- unavoidable: beforeinstallprompt is a non-standard Chromium event; the browser does not narrow it
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!deferred || installed) return null;

  const handleInstall = () => {
    void (async () => {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === 'accepted') setInstalled(true);
      setDeferred(null);
    })();
  };

  return (
    <div className="fixed bottom-20 end-4 z-50 flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs font-medium text-card-foreground shadow-sm backdrop-blur">
      <Download className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span>{t('pwa.install')}</span>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-2 text-xs"
        onClick={() => void handleInstall()}
        aria-label={t('pwa.install')}
      >
        {t('pwa.installAction')}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-6"
        onClick={() => setDeferred(null)}
        aria-label={t('pwa.dismiss')}
      >
        <X className="size-3.5" aria-hidden="true" />
      </Button>
    </div>
  );
}
