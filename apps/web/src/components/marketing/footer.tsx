import { Boxes } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { LocaleSwitcher } from '@/components/shell/locale-switcher';

const PRODUCT_ANCHORS: readonly (readonly [string, string])[] = [
  ['product', 'nav.product'],
  ['modules', 'nav.modules'],
  ['how', 'nav.how'],
  ['testimonials', 'nav.testimonials'],
];

/**
 * Landing footer — server component (no interactivity beyond links).
 * The LocaleSwitcher is a client component nested inside; it keeps working
 * because client components can render inside server components.
 */
export function Footer() {
  const t = useTranslations('landing');
  const year = new Date().getFullYear();

  return (
    <footer className="border-t bg-muted/40">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-4">
        {/* Brand */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 font-semibold">
            <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Boxes className="size-5" />
            </span>
            ModuBiz
          </div>
          <p className="text-sm text-muted-foreground">{t('footer.builtWith')}</p>
          <LocaleSwitcher />
        </div>

        {/* Product anchors */}
        <div>
          <h3 className="mb-3 text-sm font-semibold">{t('footer.product')}</h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            {PRODUCT_ANCHORS.map(([anchor, key]) => (
              <li key={anchor}>
                <a href={`#${anchor}`} className="transition-colors hover:text-foreground">
                  {t(key)}
                </a>
              </li>
            ))}
          </ul>
        </div>

        {/* Modules */}
        <div>
          <h3 className="mb-3 text-sm font-semibold">{t('footer.modules')}</h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>
              <a href="#modules" className="transition-colors hover:text-foreground">
                CRM
              </a>
            </li>
            <li>
              <a href="#modules" className="transition-colors hover:text-foreground">
                {t('modules.inventory.name')}
              </a>
            </li>
            <li>
              <a href="#modules" className="transition-colors hover:text-foreground">
                {t('modules.pos.name')}
              </a>
            </li>
            <li>
              <a href="#modules" className="transition-colors hover:text-foreground">
                {t('modules.accounting.name')}
              </a>
            </li>
            <li>
              <a href="#modules" className="transition-colors hover:text-foreground">
                {t('modules.purchasing.name')}
              </a>
            </li>
          </ul>
        </div>

        {/* Legal */}
        <div>
          <h3 className="mb-3 text-sm font-semibold">{t('footer.legal')}</h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>
              <span className="cursor-default">{t('footer.privacy')}</span>
            </li>
            <li>
              <span className="cursor-default">{t('footer.terms')}</span>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t">
        <div className="mx-auto w-full max-w-6xl px-4 py-4 text-center text-xs text-muted-foreground sm:px-6">
          {t('footer.rights', { year })}
        </div>
      </div>
    </footer>
  );
}
