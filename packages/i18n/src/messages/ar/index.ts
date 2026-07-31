// Arabic locale messages (in development)
// RTL layout — logical CSS utilities only (ms-, me-, text-start, etc.)

const ar = {
  // ─── Common ──────────────────────────────────────────────────────────────
  common: {
    save: 'حفظ',
    cancel: 'إلغاء',
    delete: 'حذف',
    edit: 'تعديل',
    create: 'إنشاء',
    search: 'بحث',
    filter: 'تصفية',
    loading: 'جارٍ التحميل...',
    error: 'حدث خطأ',
    retry: 'إعادة المحاولة',
    back: 'رجوع',
    next: 'التالي',
    close: 'إغلاق',
    confirm: 'تأكيد',
    yes: 'نعم',
    no: 'لا',
    enabled: 'مفعل',
    disabled: 'معطل',
    actions: 'الإجراءات',
    status: 'الحالة',
    name: 'الاسم',
    email: 'البريد الإلكتروني',
    phone: 'الهاتف',
    address: 'العنوان',
    notes: 'ملاحظات',
    noResults: 'لا توجد نتائج',
    loadMore: 'تحميل المزيد',
    required: 'مطلوب',
    optional: 'اختياري',
  },

  // ─── Auth ────────────────────────────────────────────────────────────────
  auth: {
    login: 'تسجيل الدخول',
    logout: 'تسجيل الخروج',
    signup: 'إنشاء حساب',
    email: 'البريد الإلكتروني',
    password: 'كلمة المرور',
    forgotPassword: 'نسيت كلمة المرور؟',
    resetPassword: 'إعادة تعيين كلمة المرور',
    newPassword: 'كلمة المرور الجديدة',
    confirmPassword: 'تأكيد كلمة المرور',
    loginTitle: 'مرحباً بعودتك',
    loginSubtitle: 'سجل الدخول إلى حساب مؤسستك',
    signupTitle: 'أنشئ حسابك',
    signupSubtitle: 'ابدأ نسختك التجريبية المجانية اليوم',
    noAccount: 'ليس لديك حساب؟',
    haveAccount: 'لديك حساب بالفعل؟',
    rememberMe: 'تذكرني',
    forgotPasswordTitle: 'نسيت كلمة المرور؟',
    forgotPasswordSubtitle: 'أدخل بريدك الإلكتروني وسنرسل لك رابط إعادة التعيين',
    resetPasswordTitle: 'تعيين كلمة مرور جديدة',
    resetPasswordSubtitle: 'يجب أن تتكون كلمة المرور الجديدة من 12 حرفاً على الأقل',
    checkEmail: 'تحقق من بريدك الإلكتروني',
    checkEmailText: 'لقد أرسلنا رابط إعادة تعيين كلمة المرور إلى {email}. يرجى التحقق من صندوق الوارد الخاص بك.',
    passwordResetSuccess: 'تم إعادة تعيين كلمة المرور بنجاح! يمكنك الآن تسجيل الدخول بكلمة المرور الجديدة.',
    organizationName: 'اسم المؤسسة',
    organizationSlug: 'رابط المؤسسة',
    terms: 'أوافق على شروط الخدمة وسياسة الخصوصية',
    passwordMinLength: '12 حرفاً على الأقل',
    signupSuccess: 'تم إنشاء الحساب. يرجى التحقق من بريدك الإلكتروني لتأكيد حسابك.',
    loginSuccess: 'تم تسجيل الدخول بنجاح.',
    errors: {
      emailTaken: 'يوجد حساب مسجل بهذا البريد الإلكتروني بالفعل.',
      invalidCredentials: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
      accountLocked: 'الحساب مقفل مؤقتاً بسبب كثرة محاولات تسجيل الدخول. حاول مرة أخرى لاحقاً.',
      emailNotVerified: 'يرجى التحقق من بريدك الإلكتروني قبل تسجيل الدخول.',
      network: 'تعذر الوصول إلى الخادم. يرجى التحقق من اتصالك والمحاولة مرة أخرى.',
      server: 'حدث خطأ ما. يرجى المحاولة مرة أخرى لاحقاً.',
      unknown: 'حدث خطأ ما. يرجى المحاولة مرة أخرى.',
      passwordMismatch: 'كلمتا المرور غير متطابقتين.',
      invalidResetToken: 'رابط إعادة التعيين غير صالح أو منتهي الصلاحية. يرجى طلب رابط جديد.',
    },
  },

  // ─── Shell ───────────────────────────────────────────────────────────────
  shell: {
    search: 'ابحث عن أي شيء...',
    collapseSidebar: 'طي الشريط الجانبي',
    expandSidebar: 'توسيع الشريط الجانبي',
    switchOrg: 'تبديل المؤسسة',
    organizations: 'المؤسسات',
    noOrganizations: 'لست عضواً في أي مؤسسة بعد.',
    userMenu: 'قائمة المستخدم',
    profile: 'الملف الشخصي',
    accountSettings: 'إعدادات الحساب',
    darkMode: 'الوضع الداكن',
    lightMode: 'الوضع الفاتح',
    systemMode: 'وضع النظام',
    notifications: 'الإشعارات',
    help: 'المساعدة والدعم',
    keyboardShortcuts: 'اختصارات لوحة المفاتيح',
    loading: 'جارٍ التحميل...',
    copyright: 'جميع الحقوق محفوظة.',
  },

  // ─── Navigation ──────────────────────────────────────────────────────────
  nav: {
    dashboard: 'لوحة التحكم',
    settings: 'الإعدادات',
    organizations: 'المؤسسات',
    members: 'الأعضاء',
    roles: 'الأدوار',
    billing: 'الفواتير',
    modules: 'سوق الوحدات',
    overview: 'نظرة عامة',
    platform: 'المنصة',
    modulesLabel: 'الوحدات',
  },

  // ─── Dashboard ───────────────────────────────────────────────────────────
  dashboard: {
    welcome: 'إليك نظرة عامة على أعمالك.',
    recentActivity: 'النشاط الأخير',
    recentActivitySubtitle: 'إجراءاتك الأخيرة عبر جميع الوحدات',
    noActivity: 'لا يوجد نشاط بعد. ابدأ باستخدام الوحدات لرؤية نشاطك هنا.',
    noModulesTitle: 'لا توجد وحدات مفعلة بعد',
    noModulesHint: 'فعّل الوحدات لبدء العمل.',
    stats: {
      activeModules: 'الوحدات النشطة',
      modulesHint: 'ابدأ نسخة تجريبية للتفعيل',
      products: 'المنتجات',
      startInventory: 'أضف المنتجات في المخزون',
      revenueMtd: 'الإيرادات (الشهر الجاري)',
      startSelling: 'ابدأ البيع',
      activeDeals: 'الصفقات النشطة',
      dealsHint: 'تتبع الصفقات في CRM',
    },
  },

  // ─── Settings ────────────────────────────────────────────────────────────
  settings: {
    title: 'الإعدادات',
    subtitle: 'أدر مؤسستك وأعضاءها وأدوارها وفواتيرها ووحداتها.',
    saved: 'تم الحفظ بنجاح.',
    sections: {
      organization: 'المؤسسة',
      members: 'الأعضاء',
      roles: 'الأدوار والصلاحيات',
      billing: 'الفواتير',
      modules: 'سوق الوحدات',
      profile: 'الملف الشخصي',
    },
    descriptions: {
      organization: 'ملف المؤسسة وتفضيلاتها',
      members: 'دعوة الأعضاء وإدارتهم',
      roles: 'تعريف الأدوار والصلاحيات',
      billing: 'الاشتراك وتراخيص الوحدات',
      modules: 'استعرض وافعّل وحدات الأعمال',
      profile: 'معلوماتك الشخصية والأمان',
    },
    errors: {
      saveFailed: 'تعذر الحفظ. يرجى المحاولة مرة أخرى.',
      currentPassword: 'كلمة المرور الحالية غير صحيحة.',
    },
    org: {
      profileTitle: 'ملف المؤسسة',
      profileSubtitle: 'التفاصيل الأساسية لمؤسستك',
      timezone: 'المنطقة الزمنية',
      receiptFooter: 'تذييل الإيصال',
      dangerZone: 'منطقة الخطر',
      dangerZoneHint: 'حذف المؤسسة لا يمكن التراجع عنه بعد انتهاء فترة السماح.',
      deleteOrganization: 'حذف المؤسسة',
      deleteConfirm: 'هل أنت متأكد من حذف هذه المؤسسة؟ لا يمكن التراجع عن ذلك بعد 30 يوماً.',
      deletionScheduled: 'تم جدولة الحذف. ستتم إزالة المؤسسة بعد 30 يوماً.',
    },
    profile: {
      detailsTitle: 'التفاصيل الشخصية',
      detailsSubtitle: 'اسمك ولغة الواجهة',
      locale: 'اللغة المفضلة',
      passwordTitle: 'تغيير كلمة المرور',
      passwordSubtitle: 'استخدم كلمة مرور قوية من 12 حرفاً على الأقل',
      currentPassword: 'كلمة المرور الحالية',
      changePassword: 'تغيير كلمة المرور',
    },
  },

  // ─── Organizations ───────────────────────────────────────────────────────
  org: {
    name: 'اسم المؤسسة',
    slug: 'رابط المؤسسة',
    slugHint: 'أحرف صغيرة وأرقام وواصلات',
    country: 'رمز الدولة',
    currency: 'العملة',
    create: 'إنشاء مؤسسة',
    onboardingTitle: 'أنشئ مؤسستك',
    onboardingSubtitle: 'أعد مساحة العمل الخاصة بك لبدء استخدام الوحدات.',
    errors: {
      slugTaken: 'رابط المؤسسة هذا مستخدم بالفعل. جرّب رابطاً آخر.',
    },
  },

  // ─── Invitations ─────────────────────────────────────────────────────────
  invitations: {
    acceptTitle: 'تمت دعوتك',
    acceptSubtitle: 'قبل الدعوة للانضمام إلى المؤسسة.',
    accept: 'قبول الدعوة',
    accepted: 'تم قبول الدعوة. لقد انضممت إلى المؤسسة.',
    expired: 'هذه الدعوة منتهية الصلاحية أو لم تعد صالحة.',
    errors: {
      invalid: 'رابط الدعوة هذا غير صالح.',
      expired: 'انتهت صلاحية هذه الدعوة.',
      failed: 'تعذر قبول الدعوة. يرجى المحاولة مرة أخرى.',
    },
  },

  // ─── Members ─────────────────────────────────────────────────────────────
  members: {
    inviteTitle: 'دعوة عضو',
    inviteSubtitle: 'سيصله بريد إلكتروني برابط للانضمام.',
    invite: 'إرسال الدعوة',
    role: 'الدور',
    chooseRole: 'اختر دوراً',
    listTitle: 'الأعضاء',
    listSubtitle: 'الأشخاص الذين لديهم حق الوصول إلى هذه المؤسسة',
    noMembers: 'لا يوجد أعضاء بعد.',
    invitationsTitle: 'الدعوات المعلقة',
    noInvitations: 'لا توجد دعوات معلقة.',
    expires: 'تنتهي في {date}',
    remove: 'إزالة العضو',
    confirmRemove: 'إزالة هذا العضو من المؤسسة؟',
    inviteSent: 'تم إرسال الدعوة.',
    errors: {
      chooseRole: 'يرجى اختيار دور أولاً.',
      inviteFailed: 'تعذر إرسال الدعوة. يرجى المحاولة مرة أخرى.',
      actionFailed: 'فشل الإجراء. يرجى المحاولة مرة أخرى.',
    },
  },

  // ─── Roles ───────────────────────────────────────────────────────────────
  roles: {
    createTitle: 'إنشاء دور مخصص',
    createSubtitle: 'تظهر الأدوار المخصصة في مصفوفة الصلاحيات أدناه.',
    create: 'إنشاء دور',
    key: 'المفتاح',
    name: 'الاسم المعروض',
    matrixTitle: 'مصفوفة الصلاحيات',
    matrixSubtitle: 'ما الذي يمكن لكل دور فعله',
    permission: 'الصلاحية',
    system: 'نظام',
    noPermissions: 'لا توجد صلاحيات محددة بعد.',
    created: 'تم إنشاء الدور.',
    errors: {
      createFailed: 'تعذر إنشاء الدور. قد يكون المفتاح مستخدماً بالفعل.',
    },
  },

  // ─── Billing ─────────────────────────────────────────────────────────────
  billing: {
    subscriptionTitle: 'الاشتراك',
    subscriptionSubtitle: 'باقتك الحالية وتفاصيل الفوترة',
    status: 'الحالة',
    currency: 'عملة الفوترة',
    periodEnd: 'تنتهي الفترة الحالية',
    noPeriodEnd: '—',
    noSubscription: 'لا يوجد اشتراك نشط بعد. فعّل الوحدات للبدء.',
    entitlementsTitle: 'تراخيص الوحدات',
    noEntitlements: 'لا توجد وحدات مفعلة بعد.',
    disable: 'تعطيل',
    confirmDisable: 'تعطيل هذه الوحدة؟ ستفقد الوصول حتى تعيد تفعيلها.',
  },

  // ─── Errors ──────────────────────────────────────────────────────────────
  error: {
    notFound: 'المورد المطلوب غير موجود',
    forbidden: 'ليس لديك صلاحية للقيام بهذا الإجراء',
    unauthorized: 'يرجى تسجيل الدخول للمتابعة',
    validation: 'يرجى التحقق من المدخلات والمحاولة مرة أخرى',
    serverError: 'حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى لاحقاً.',
    rateLimited: 'طلبات كثيرة جداً. يرجى الانتظار لحظة ثم المحاولة مرة أخرى.',
  },

  // ─── Modules ─────────────────────────────────────────────────────────────
  modules: {
    crm: {
      name: 'CRM',
      description: 'إدارة جهات الاتصال والشركات والصفقات ومسار المبيعات',
      nav: {
        contacts: 'جهات الاتصال',
        companies: 'الشركات',
        deals: 'الصفقات',
      },
    },
    inventory: {
      name: 'المخزون',
      description: 'تتبع المنتجات ومستويات المخزون وحركات المستودعات',
      nav: {
        products: 'المنتجات',
        warehouses: 'المستودعات',
        stock: 'المخزون',
      },
    },
    pos: {
      name: 'نقطة البيع',
      description: 'نقطة بيع مع دعم العمل دون اتصال',
      nav: {
        register: 'سجل البيع',
        shifts: 'الورديات',
        reports: 'التقارير',
      },
    },
    trialDays: 'نسخة تجريبية مجانية لمدة {days} يوماً',
    startTrial: 'ابدأ النسخة التجريبية',
    noModules: 'لا تتوفر وحدات بعد.',
  },
};

export default ar;
