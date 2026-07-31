// English locale messages
// All user-facing text must use i18n keys per CODING_STANDARDS.md §10

const en = {
  // ─── Common ──────────────────────────────────────────────────────────────
  common: {
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    edit: 'Edit',
    create: 'Create',
    search: 'Search',
    filter: 'Filter',
    loading: 'Loading...',
    error: 'An error occurred',
    retry: 'Retry',
    back: 'Back',
    next: 'Next',
    close: 'Close',
    confirm: 'Confirm',
    yes: 'Yes',
    no: 'No',
    enabled: 'Enabled',
    disabled: 'Disabled',
    actions: 'Actions',
    status: 'Status',
    name: 'Name',
    email: 'Email',
    phone: 'Phone',
    address: 'Address',
    notes: 'Notes',
    noResults: 'No results found',
    loadMore: 'Load more',
    required: 'Required',
    optional: 'Optional',
  },

  // ─── Auth ────────────────────────────────────────────────────────────────
  auth: {
    login: 'Log in',
    logout: 'Log out',
    signup: 'Sign up',
    email: 'Email address',
    password: 'Password',
    forgotPassword: 'Forgot password?',
    resetPassword: 'Reset password',
    newPassword: 'New password',
    confirmPassword: 'Confirm password',
    loginTitle: 'Welcome back',
    loginSubtitle: 'Log in to your organization account',
    signupTitle: 'Create your account',
    signupSubtitle: 'Start your free trial today',
    noAccount: "Don't have an account?",
    haveAccount: 'Already have an account?',
    rememberMe: 'Remember me',
    forgotPasswordTitle: 'Forgot your password?',
    forgotPasswordSubtitle: "Enter your email and we'll send you a reset link",
    resetPasswordTitle: 'Set new password',
    resetPasswordSubtitle: 'Your new password must be at least 12 characters',
    checkEmail: 'Check your email',
    checkEmailText: "We've sent a password reset link to {email}. Please check your inbox.",
    passwordResetSuccess: 'Password reset successfully! You can now log in with your new password.',
    organizationName: 'Organization name',
    organizationSlug: 'Organization URL',
    terms: 'I agree to the Terms of Service and Privacy Policy',
    passwordMinLength: 'At least 12 characters',
    signupSuccess: 'Account created. Please check your email to verify your account.',
    loginSuccess: 'Logged in successfully.',
    errors: {
      emailTaken: 'An account with this email already exists.',
      invalidCredentials: 'Invalid email or password.',
      accountLocked: 'Account temporarily locked due to too many failed attempts. Try again later.',
      emailNotVerified: 'Please verify your email address before logging in.',
      network: 'Could not reach the server. Please check your connection and try again.',
      server: 'Something went wrong. Please try again later.',
      unknown: 'Something went wrong. Please try again.',
      passwordMismatch: 'The passwords do not match.',
      invalidResetToken: 'This reset link is invalid or has expired. Please request a new one.',
    },
  },

  // ─── Shell ───────────────────────────────────────────────────────────────
  shell: {
    search: 'Search anything...',
    collapseSidebar: 'Collapse sidebar',
    expandSidebar: 'Expand sidebar',
    switchOrg: 'Switch organization',
    organizations: 'Organizations',
    noOrganizations: 'You are not a member of any organization yet.',
    userMenu: 'User menu',
    profile: 'Profile',
    accountSettings: 'Account settings',
    darkMode: 'Dark mode',
    lightMode: 'Light mode',
    systemMode: 'System mode',
    notifications: 'Notifications',
    help: 'Help & support',
    keyboardShortcuts: 'Keyboard shortcuts',
    loading: 'Loading...',
    copyright: 'All rights reserved.',
  },

  // ─── Navigation ──────────────────────────────────────────────────────────
  nav: {
    dashboard: 'Dashboard',
    settings: 'Settings',
    organizations: 'Organizations',
    members: 'Members',
    roles: 'Roles',
    billing: 'Billing',
    modules: 'Module Marketplace',
    overview: 'Overview',
    platform: 'Platform',
    modulesLabel: 'Modules',
  },

  // ─── Dashboard ───────────────────────────────────────────────────────────
  dashboard: {
    welcome: "Here's an overview of your business.",
    recentActivity: 'Recent Activity',
    recentActivitySubtitle: 'Your recent actions across all modules',
    noActivity: 'No recent activity yet. Start using modules to see your activity here.',
    noModulesTitle: 'No active modules yet',
    noModulesHint: 'Enable modules to start working.',
    stats: {
      activeModules: 'Active Modules',
      modulesHint: 'Start a trial to activate',
      products: 'Products',
      startInventory: 'Add products in Inventory',
      revenueMtd: 'Revenue (MTD)',
      startSelling: 'Start selling',
      activeDeals: 'Active Deals',
      dealsHint: 'Track deals in CRM',
    },
  },

  // ─── Settings ────────────────────────────────────────────────────────────
  settings: {
    title: 'Settings',
    subtitle: 'Manage your organization, members, roles, billing, and modules.',
    saved: 'Saved successfully.',
    sections: {
      organization: 'Organization',
      members: 'Members',
      roles: 'Roles & Permissions',
      billing: 'Billing',
      modules: 'Module Marketplace',
      profile: 'Profile',
    },
    descriptions: {
      organization: 'Organization profile and preferences',
      members: 'Invite and manage team members',
      roles: 'Define roles and permissions',
      billing: 'Subscription and module entitlements',
      modules: 'Browse and enable business modules',
      profile: 'Your personal information and security',
    },
    errors: {
      saveFailed: 'Failed to save. Please try again.',
      currentPassword: 'Your current password is incorrect.',
    },
    org: {
      profileTitle: 'Organization profile',
      profileSubtitle: 'Basic details about your organization',
      timezone: 'Timezone',
      receiptFooter: 'Receipt footer',
      dangerZone: 'Danger zone',
      dangerZoneHint: 'Deleting the organization is irreversible after the grace period.',
      deleteOrganization: 'Delete organization',
      deleteConfirm: 'Are you sure you want to delete this organization? This cannot be undone after 30 days.',
      deletionScheduled: 'Deletion scheduled. The organization will be removed after 30 days.',
    },
    profile: {
      detailsTitle: 'Personal details',
      detailsSubtitle: 'Your name and interface language',
      locale: 'Preferred language',
      passwordTitle: 'Change password',
      passwordSubtitle: 'Use a strong password with at least 12 characters',
      currentPassword: 'Current password',
      changePassword: 'Change password',
    },
  },

  // ─── Organizations ───────────────────────────────────────────────────────
  org: {
    name: 'Organization name',
    slug: 'Organization URL',
    slugHint: 'Lowercase letters, numbers, and hyphens',
    country: 'Country code',
    currency: 'Currency',
    create: 'Create organization',
    onboardingTitle: 'Create your organization',
    onboardingSubtitle: 'Set up your workspace to start using modules.',
    errors: {
      slugTaken: 'This organization URL is already taken. Try another one.',
    },
  },

  // ─── Invitations ─────────────────────────────────────────────────────────
  invitations: {
    acceptTitle: 'You have been invited',
    acceptSubtitle: 'Accept the invitation to join the organization.',
    accept: 'Accept invitation',
    accepted: 'Invitation accepted. You have joined the organization.',
    expired: 'This invitation has expired or is no longer valid.',
    errors: {
      invalid: 'This invitation link is invalid.',
      expired: 'This invitation has expired.',
      failed: 'Could not accept the invitation. Please try again.',
    },
  },

  // ─── Members ─────────────────────────────────────────────────────────────
  members: {
    inviteTitle: 'Invite a member',
    inviteSubtitle: 'They will receive an email with a link to join.',
    invite: 'Send invitation',
    role: 'Role',
    chooseRole: 'Choose a role',
    listTitle: 'Members',
    listSubtitle: 'People with access to this organization',
    noMembers: 'No members yet.',
    invitationsTitle: 'Pending invitations',
    noInvitations: 'No pending invitations.',
    expires: 'Expires {date}',
    remove: 'Remove member',
    confirmRemove: 'Remove this member from the organization?',
    inviteSent: 'Invitation sent.',
    errors: {
      chooseRole: 'Please choose a role first.',
      inviteFailed: 'Could not send the invitation. Please try again.',
      actionFailed: 'Action failed. Please try again.',
    },
  },

  // ─── Roles ───────────────────────────────────────────────────────────────
  roles: {
    createTitle: 'Create a custom role',
    createSubtitle: 'Custom roles appear in the permission matrix below.',
    create: 'Create role',
    key: 'Key',
    name: 'Display name',
    matrixTitle: 'Permission matrix',
    matrixSubtitle: 'Which role can do what',
    permission: 'Permission',
    system: 'system',
    noPermissions: 'No permissions defined yet.',
    created: 'Role created.',
    errors: {
      createFailed: 'Could not create the role. The key may already be in use.',
    },
  },

  // ─── Billing ─────────────────────────────────────────────────────────────
  billing: {
    subscriptionTitle: 'Subscription',
    subscriptionSubtitle: 'Your current plan and billing details',
    status: 'Status',
    currency: 'Billing currency',
    periodEnd: 'Current period ends',
    noPeriodEnd: '—',
    noSubscription: 'No active subscription yet. Enable modules to get started.',
    entitlementsTitle: 'Module entitlements',
    noEntitlements: 'No modules enabled yet.',
    disable: 'Disable',
    confirmDisable: 'Disable this module? You will lose access until you re-enable it.',
  },

  // ─── Errors ──────────────────────────────────────────────────────────────
  error: {
    notFound: 'The requested resource was not found',
    forbidden: 'You do not have permission to perform this action',
    unauthorized: 'Please log in to continue',
    validation: 'Please check your input and try again',
    serverError: 'An unexpected error occurred. Please try again later.',
    rateLimited: 'Too many requests. Please wait a moment and try again.',
  },

  // ─── Modules ─────────────────────────────────────────────────────────────
  modules: {
    crm: {
      name: 'CRM',
      description: 'Manage contacts, companies, deals, and pipeline',
      nav: {
        contacts: 'Contacts',
        companies: 'Companies',
        deals: 'Deals',
      },
    },
    inventory: {
      name: 'Inventory',
      description: 'Track products, stock levels, and warehouse movements',
      nav: {
        products: 'Products',
        warehouses: 'Warehouses',
        stock: 'Stock',
      },
    },
    pos: {
      name: 'POS',
      description: 'Point of sale with offline support',
      nav: {
        register: 'Register',
        shifts: 'Shifts',
        reports: 'Reports',
      },
    },
    trialDays: '{days}-day free trial',
    startTrial: 'Start free trial',
    noModules: 'No modules are available yet.',
  },
};

export default en;
export type LocaleMessages = typeof en;
