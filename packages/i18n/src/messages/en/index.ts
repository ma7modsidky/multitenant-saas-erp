// English locale messages
// All user-facing text must use i18n keys per CODING_STANDARDS.md §10

const en = {
  // ─── Common ──────────────────────────────────────────────────────────────
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.edit': 'Edit',
  'common.create': 'Create',
  'common.search': 'Search',
  'common.filter': 'Filter',
  'common.loading': 'Loading...',
  'common.error': 'An error occurred',
  'common.retry': 'Retry',
  'common.back': 'Back',
  'common.next': 'Next',
  'common.close': 'Close',
  'common.confirm': 'Confirm',
  'common.yes': 'Yes',
  'common.no': 'No',
  'common.enabled': 'Enabled',
  'common.disabled': 'Disabled',
  'common.actions': 'Actions',
  'common.status': 'Status',
  'common.name': 'Name',
  'common.email': 'Email',
  'common.phone': 'Phone',
  'common.address': 'Address',
  'common.notes': 'Notes',
  'common.noResults': 'No results found',
  'common.loadMore': 'Load more',
  'common.required': 'Required',
  'common.optional': 'Optional',

  // ─── Auth ────────────────────────────────────────────────────────────────
  'auth.login': 'Log in',
  'auth.logout': 'Log out',
  'auth.signup': 'Sign up',
  'auth.email': 'Email address',
  'auth.password': 'Password',
  'auth.forgotPassword': 'Forgot password?',
  'auth.resetPassword': 'Reset password',
  'auth.newPassword': 'New password',
  'auth.confirmPassword': 'Confirm password',
  'auth.loginTitle': 'Welcome back',
  'auth.loginSubtitle': 'Log in to your organization account',
  'auth.signupTitle': 'Create your account',
  'auth.signupSubtitle': 'Start your free trial today',

  // ─── Navigation ──────────────────────────────────────────────────────────
  'nav.dashboard': 'Dashboard',
  'nav.settings': 'Settings',
  'nav.organizations': 'Organizations',
  'nav.members': 'Members',
  'nav.roles': 'Roles',
  'nav.billing': 'Billing',
  'nav.modules': 'Module Marketplace',

  // ─── Settings ────────────────────────────────────────────────────────────
  'settings.title': 'Organization Settings',
  'settings.general': 'General',
  'settings.locale': 'Language & Region',
  'settings.members': 'Members',
  'settings.roles': 'Roles & Permissions',
  'settings.billing': 'Billing & Subscription',
  'settings.modules': 'Module Marketplace',

  // ─── Errors ──────────────────────────────────────────────────────────────
  'error.notFound': 'The requested resource was not found',
  'error.forbidden': 'You do not have permission to perform this action',
  'error.unauthorized': 'Please log in to continue',
  'error.validation': 'Please check your input and try again',
  'error.serverError': 'An unexpected error occurred. Please try again later.',
  'error.rateLimited': 'Too many requests. Please wait a moment and try again.',

  // ─── Modules ─────────────────────────────────────────────────────────────
  'modules.crm.name': 'CRM',
  'modules.crm.description': 'Manage contacts, companies, deals, and pipeline',
  'modules.inventory.name': 'Inventory',
  'modules.inventory.description': 'Track products, stock levels, and warehouse movements',
  'modules.pos.name': 'POS',
  'modules.pos.description': 'Point of sale with offline support',
};

export default en;
export type LocaleMessages = typeof en;
