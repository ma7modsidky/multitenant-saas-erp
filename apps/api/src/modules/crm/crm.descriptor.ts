import { CRM_EVENTS, defineModule, type ModuleDescriptor } from '@modubiz/contracts';

/**
 * Crm module descriptor — the entire integration surface with the platform.
 *
 * @see MODULE_GUIDE.md §2 — Descriptor rules
 * @see PLAN.md §4.1 — Declare contracts first
 */
export const crmDescriptor: ModuleDescriptor = defineModule({
  key: 'crm',
  version: '1.0.0',
  nameKey: 'modules.crm.name',
  descriptionKey: 'modules.crm.description',
  icon: 'users',
  tablePrefix: 'crm_',
  dependsOn: [],
  stripePriceKey: 'price_crm_monthly',
  trialDays: 14,
  permissions: [
    'crm:contact:read',
    'crm:contact:write',
    'crm:company:read',
    'crm:company:write',
    'crm:deal:read',
    'crm:deal:write',
    'crm:activity:read',
    'crm:activity:write',
    'crm:pipeline:manage',
  ],
  navigation: [
    {
      labelKey: 'modules.crm.nav.contacts',
      href: '/m/crm/contacts',
      icon: 'contact',
    },
    {
      labelKey: 'modules.crm.nav.companies',
      href: '/m/crm/companies',
      icon: 'building',
    },
    {
      labelKey: 'modules.crm.nav.deals',
      href: '/m/crm/deals',
      icon: 'target',
    },
  ],
  publishes: [
    CRM_EVENTS.CONTACT_CREATED_V1,
    CRM_EVENTS.CONTACT_UPDATED_V1,
    CRM_EVENTS.DEAL_STAGE_CHANGED_V1,
    CRM_EVENTS.DEAL_WON_V1,
    CRM_EVENTS.DEAL_LOST_V1,
  ],
  consumes: [],
  providesPorts: [],
  consumesPorts: [],
  searchContributor: true,
  dashboardWidgets: [
    { id: 'recent-deals', titleKey: 'modules.crm.widgets.recent_deals', width: 2, height: 1 },
    { id: 'upcoming-activities', titleKey: 'modules.crm.widgets.upcoming_activities', width: 2, height: 1 },
  ],
  dataRetentionDays: 90,
});
