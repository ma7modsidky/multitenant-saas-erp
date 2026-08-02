// Frontend counterpart templates (MODULE_GUIDE.md §3).
// The committed web shell uses the (dashboard) route group; module pages live
// under app/[locale]/(dashboard)/m/<key>/ and are gated by <ModuleGate>.

import { pascalCase } from './helpers.mjs';

const pageTemplate = (key, localeLabel) => `'use client';

import { useTranslations } from 'next-intl';

import { ModuleGate } from '@/lib/entitlements';

export default function ${pascalCase(key)}Page() {
  const t = useTranslations();

  return (
    <ModuleGate moduleKey="${key}">
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('modules.${key}.name')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('modules.${key}.description')}</p>
        </div>
        <p className="text-sm text-muted-foreground">${localeLabel}</p>
      </div>
    </ModuleGate>
  );
}
`;

const featuresIndexTemplate = (key) => `// Feature code for the ${key} module.
// Components, hooks, API bindings, and shared schemas live here
// (MODULE_GUIDE.md §4 Step 10).
`;

const i18nBlock = (key) => `    ${key}: {
      name: '${pascalCase(key)}',
      description: '${pascalCase(key)} module',
      nav: {
        root: '${pascalCase(key)}',
      },
      widgets: {
        overview: '${pascalCase(key)} overview',
      },
    },
`;

/** Web page for the module (under the committed (dashboard) shell). */
export function webPageFile(key) {
  return [
    `apps/web/src/app/[locale]/(dashboard)/m/${key}/page.tsx`,
    pageTemplate(key, 'Scaffolded by the module generator.'),
  ];
}

/** Feature folder entry. */
export function featuresFile(key) {
  return [`apps/web/src/features/${key}/index.ts`, featuresIndexTemplate(key)];
}

/** i18n key block inserted into each locale catalog. */
export { i18nBlock };
