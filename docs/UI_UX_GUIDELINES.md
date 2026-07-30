# ModuBiz — UI/UX Design & Implementation Guidelines

**Status:** Living document. Version 1.0. **Purpose:** Define the design system,
component standards, and UX patterns that ensure a clean, beautiful, modern,
accessible, and RTL-safe user interface across all modules.

> **Read alongside:**
> [CODING_STANDARDS.md §10](./CODING_STANDARDS.md#10-frontend-specifics)
> (frontend rules) ·
> [ARCHITECTURE.md §9](./ARCHITECTURE.md#9-frontend-architecture) (frontend
> structure) · [BUSINESS_RULES.md §5](./BUSINESS_RULES.md#5-localization-rules)
> (i18n/RTL rules) · [PLAN.md](../PLAN.md) (when to build what) This document
> covers _design and UX_; `CODING_STANDARDS.md` covers _the code rules_.

---

## 1. Design philosophy

ModuBiz serves SMBs across retail, food service, e-commerce, and professional
services in multiple languages (including RTL). The UI must be:

| Principle                | What it means                                           | How we achieve it                                                                |
| ------------------------ | ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Clarity**              | The user always knows what to do next                   | Clear hierarchy, obvious primary actions, progressive disclosure                 |
| **Density**              | Show enough information without overwhelming            | Compact but breathable spacing; data-dense tables with clear alignment           |
| **Speed**                | The UI feels instant                                    | Server Components by default; optimistic updates; < 150ms interactions           |
| **Accessibility**        | Everyone can use it, including with keyboard only       | WCAG 2.1 AA; semantic HTML; visible focus; keyboard operability                  |
| **Consistency**          | The same pattern works the same everywhere              | Shared design system in `@modubiz/ui`; no one-off components                     |
| **Internationalization** | Works in LTR and RTL, in 4+ languages                   | Logical CSS only; `next-intl`; no hardcoded strings; no text in images           |
| **Beauty**               | Modern, clean, professional — not a generic admin panel | Refined color palette, thoughtful typography, subtle motion, generous whitespace |

**The design bet:** a user's first impression should be "this is a modern,
professional tool" — not "this is another generic admin panel." Every pixel
should feel intentional.

---

## 2. Design system

The design system lives in `@modubiz/ui` (shadcn/ui + Radix primitives, vendored
and customized). It is the **single source of truth** for visual style. No
module or feature may introduce a competing component library.

### 2.1 Color tokens

All colors are defined as CSS custom properties (HSL-based tokens) and consumed
via Tailwind classes. **Never use raw hex values in components.**

#### Light theme

| Token                      | HSL value     | Usage                       |
| -------------------------- | ------------- | --------------------------- |
| `--background`             | `0 0% 100%`   | Page background             |
| `--foreground`             | `222 47% 11%` | Primary text                |
| `--card`                   | `0 0% 100%`   | Card background             |
| `--card-foreground`        | `222 47% 11%` | Card text                   |
| `--popover`                | `0 0% 100%`   | Popover/dropdown background |
| `--popover-foreground`     | `222 47% 11%` | Popover text                |
| `--primary`                | `222 47% 11%` | Primary actions (dark navy) |
| `--primary-foreground`     | `210 40% 98%` | Text on primary             |
| `--secondary`              | `210 40% 96%` | Secondary surfaces          |
| `--secondary-foreground`   | `222 47% 11%` | Text on secondary           |
| `--muted`                  | `210 40% 96%` | Muted backgrounds           |
| `--muted-foreground`       | `215 16% 47%` | Muted text                  |
| `--accent`                 | `210 40% 96%` | Hover/active states         |
| `--accent-foreground`      | `222 47% 11%` | Text on accent              |
| `--destructive`            | `0 72% 51%`   | Destructive actions (red)   |
| `--destructive-foreground` | `210 40% 98%` | Text on destructive         |
| `--success`                | `142 71% 45%` | Success states (green)      |
| `--success-foreground`     | `210 40% 98%` | Text on success             |
| `--warning`                | `38 92% 50%`  | Warning states (amber)      |
| `--warning-foreground`     | `222 47% 11%` | Text on warning             |
| `--border`                 | `214 32% 91%` | Borders and dividers        |
| `--input`                  | `214 32% 91%` | Input borders               |
| `--ring`                   | `222 47% 11%` | Focus ring                  |
| `--radius`                 | `0.5rem`      | Border radius base          |

#### Dark theme

| Token                      | HSL value     | Usage                       |
| -------------------------- | ------------- | --------------------------- |
| `--background`             | `222 47% 11%` | Page background (dark navy) |
| `--foreground`             | `210 40% 98%` | Primary text                |
| `--card`                   | `222 47% 14%` | Card background             |
| `--card-foreground`        | `210 40% 98%` | Card text                   |
| `--popover`                | `222 47% 14%` | Popover background          |
| `--popover-foreground`     | `210 40% 98%` | Popover text                |
| `--primary`                | `210 40% 98%` | Primary actions (inverted)  |
| `--primary-foreground`     | `222 47% 11%` | Text on primary             |
| `--secondary`              | `217 33% 17%` | Secondary surfaces          |
| `--secondary-foreground`   | `210 40% 98%` | Text on secondary           |
| `--muted`                  | `217 33% 17%` | Muted backgrounds           |
| `--muted-foreground`       | `215 20% 65%` | Muted text                  |
| `--accent`                 | `217 33% 17%` | Hover/active states         |
| `--accent-foreground`      | `210 40% 98%` | Text on accent              |
| `--destructive`            | `0 63% 31%`   | Destructive actions         |
| `--destructive-foreground` | `210 40% 98%` | Text on destructive         |
| `--success`                | `142 71% 45%` | Success states              |
| `--success-foreground`     | `210 40% 98%` | Text on success             |
| `--warning`                | `38 92% 50%`  | Warning states              |
| `--warning-foreground`     | `222 47% 11%` | Text on warning             |
| `--border`                 | `217 33% 20%` | Borders and dividers        |
| `--input`                  | `217 33% 20%` | Input borders               |
| `--ring`                   | `212 95% 68%` | Focus ring                  |

#### Semantic color usage

| Context                                | Token                                                  | Notes                          |
| -------------------------------------- | ------------------------------------------------------ | ------------------------------ |
| Primary action (save, submit, confirm) | `bg-primary text-primary-foreground`                   | One primary action per view    |
| Destructive action (delete, remove)    | `bg-destructive text-destructive-foreground`           | Always requires confirmation   |
| Success feedback                       | `text-success` or `bg-success text-success-foreground` | Toasts, badges, indicators     |
| Warning feedback                       | `text-warning` or `bg-warning text-warning-foreground` | Trial banners, degraded states |
| Disabled state                         | `opacity-50 cursor-not-allowed`                        | Never just a color change      |
| Loading state                          | `animate-pulse` or `Spinner` component                 | Never a bare "Loading..." text |

### 2.2 Typography scale

Font stack: **Inter** (UI) + **JetBrains Mono** (code/numbers in tables). Both
loaded via `next/font` for zero layout shift.

| Token       | Size (rem) | Weight | Line height | Usage                                   |
| ----------- | ---------- | ------ | ----------- | --------------------------------------- |
| `text-xs`   | 0.75       | 400    | 1rem        | Labels, badges, metadata                |
| `text-sm`   | 0.875      | 400    | 1.25rem     | Table cells, form hints, secondary text |
| `text-base` | 1.0        | 400    | 1.5rem      | Body text, form inputs                  |
| `text-lg`   | 1.125      | 500    | 1.75rem     | Card titles, section headers            |
| `text-xl`   | 1.25       | 600    | 1.75rem     | Page section headers                    |
| `text-2xl`  | 1.5        | 600    | 2rem        | Page titles                             |
| `text-3xl`  | 1.875      | 700    | 2.25rem     | Dashboard hero numbers                  |
| `text-4xl`  | 2.25       | 700    | 2.5rem      | Auth page titles                        |

**Rules:**

- Never use `text-[Npx]` arbitrary values — use the scale.
- Numbers in tables and financial displays use `tabular-nums` for alignment.
- Headings use `tracking-tight`; body uses normal tracking.
- Never use `font-bold` (700) for body text — reserve it for emphasis in
  headings.

### 2.3 Spacing scale

Tailwind's default spacing scale (4px base). Key tokens:

| Token           | Value | Usage                                     |
| --------------- | ----- | ----------------------------------------- |
| `gap-1` / `p-1` | 4px   | Tight grouping (icon + label)             |
| `gap-2` / `p-2` | 8px   | Compact controls, table cell padding      |
| `gap-3` / `p-3` | 12px  | Form field spacing, card internal padding |
| `gap-4` / `p-4` | 16px  | Default card padding, section spacing     |
| `gap-6` / `p-6` | 24px  | Page section spacing, large card padding  |
| `gap-8` / `p-8` | 32px  | Major section breaks                      |

**Rules:**

- Use `gap-*` in flex/grid layouts, not margins on children.
- Page content has `px-4 md:px-6 lg:px-8` responsive horizontal padding.
- Vertical rhythm: sections separated by `py-6` or `py-8`.

### 2.4 Border radius

| Token          | Value                       | Usage                          |
| -------------- | --------------------------- | ------------------------------ |
| `rounded-sm`   | `calc(var(--radius) - 4px)` | Small elements (badges, chips) |
| `rounded-md`   | `calc(var(--radius) - 2px)` | Inputs, buttons                |
| `rounded-lg`   | `var(--radius)` (0.5rem)    | Cards, dialogs                 |
| `rounded-xl`   | `calc(var(--radius) + 4px)` | Large containers               |
| `rounded-full` | 9999px                      | Avatars, pills, icon buttons   |

### 2.5 Shadows

| Token         | Usage                               |
| ------------- | ----------------------------------- |
| `shadow-sm`   | Cards, dropdowns (subtle elevation) |
| `shadow-md`   | Popovers, floating elements         |
| `shadow-lg`   | Dialogs, modals                     |
| `shadow-none` | Flat surfaces (tables, lists)       |

**Rule:** shadows communicate elevation. A flat list has `shadow-none`; a card
has `shadow-sm`; a dialog has `shadow-lg`. Never use arbitrary shadow values.

### 2.6 Icons

- **Library:** Lucide React (consistent, tree-shakeable, RTL-friendly).
- **Size:** `size-4` (16px) for inline, `size-5` (20px) for buttons, `size-6`
  (24px) for nav.
- **Stroke width:** 2 (default).
- **Never** use emoji as functional icons.
- Icons in buttons: `ms-2` (after text in LTR) or `me-2` (before text) — use
  logical utilities so RTL flips automatically.

### 2.7 Motion and animation

| Element          | Animation                   | Duration | Easing        |
| ---------------- | --------------------------- | -------- | ------------- |
| Hover state      | background/color transition | 150ms    | `ease-out`    |
| Focus ring       | opacity transition          | 100ms    | `ease-out`    |
| Dialog open      | fade + scale in             | 200ms    | `ease-out`    |
| Dialog close     | fade + scale out            | 150ms    | `ease-in`     |
| Toast enter      | slide in from top-end       | 250ms    | `ease-out`    |
| Toast exit       | fade out                    | 150ms    | `ease-in`     |
| Dropdown open    | fade + slide                | 150ms    | `ease-out`    |
| Skeleton loading | `animate-pulse`             | 2s       | `ease-in-out` |

**Rules:**

- Respect `prefers-reduced-motion`: disable non-essential animation.
- Never animate layout properties (`width`, `height`, `top`, `left`) — use
  `transform` and `opacity`.
- Motion is feedback, not decoration. Every animation communicates a state
  change.
- POS cart interactions must feel instant (< 100ms); no animation on
  add-to-cart.

---

## 3. Layout and grid

### 3.1 App shell

```
┌─────────────────────────────────────────────────────┐
│ Topbar: [org switcher] [search]    [locale] [user]  │
├──────────┬──────────────────────────────────────────┤
│          │                                          │
│ Sidebar  │  Main content area                       │
│ (nav)    │  (max-w-7xl, px-4 md:px-6 lg:px-8)       │
│          │                                          │
│          │                                          │
└──────────┴──────────────────────────────────────────┘
```

- **Sidebar:** fixed width (`w-64`), collapsible to icon-only (`w-16`) on
  smaller screens, hidden on mobile (drawer).
- **Topbar:** sticky, `h-14`, contains org switcher, global search, locale
  selector, user menu.
- **Main content:** `flex-1`, scrollable, max-width `max-w-7xl` for readability
  on large screens.
- **RTL:** the sidebar flips to the right side automatically via logical
  properties (`start-0` / `end-0`).

### 3.2 Responsive breakpoints

| Breakpoint | Width    | Behavior                                       |
| ---------- | -------- | ---------------------------------------------- |
| `sm`       | ≥ 640px  | Mobile landscape; 1 column → 2 columns         |
| `md`       | ≥ 768px  | Tablet; sidebar becomes icon-only              |
| `lg`       | ≥ 1024px | Desktop; sidebar full width                    |
| `xl`       | ≥ 1280px | Large desktop; max-width constrains content    |
| `2xl`      | ≥ 1536px | Extra large; no layout change, more whitespace |

**Mobile-first:** write styles for mobile first, then enhance with `md:` and
`lg:` prefixes. Never assume a desktop viewport.

### 3.3 Content width

| Content type | Max width    | Reason                                             |
| ------------ | ------------ | -------------------------------------------------- |
| Forms        | `max-w-2xl`  | Readable line length; focused input                |
| Tables       | `max-w-full` | Use available space; horizontal scroll on overflow |
| Dashboard    | `max-w-7xl`  | Multi-column widgets                               |
| Auth pages   | `max-w-md`   | Centered, focused                                  |
| Settings     | `max-w-4xl`  | Tabbed sections                                    |

---

## 4. Component standards

All components live in `@modubiz/ui` and are vendored from shadcn/ui, then
customized. **No module may install its own component library.**

### 4.1 Buttons

| Variant       | Class                                        | Usage                              |
| ------------- | -------------------------------------------- | ---------------------------------- |
| `default`     | `bg-primary text-primary-foreground`         | Primary action (one per view)      |
| `secondary`   | `bg-secondary text-secondary-foreground`     | Secondary actions                  |
| `outline`     | `border border-input bg-background`          | Tertiary actions, cancel           |
| `ghost`       | `hover:bg-accent`                            | Toolbar actions, icon buttons      |
| `destructive` | `bg-destructive text-destructive-foreground` | Delete, remove (with confirmation) |
| `link`        | `text-primary underline-offset-4`            | Inline links                       |

**Rules:**

- Sizes: `sm` (`h-8`), `default` (`h-9`), `lg` (`h-10`), `icon` (`size-9`).
- One `default` button per view — the primary action. Others are `secondary` or
  `outline`.
- Destructive buttons always open a confirmation dialog.
- Disabled buttons: `opacity-50 pointer-events-none`.
- Loading state: replace text with `Spinner` + keep text visible via
  `aria-busy`.
- Full-width buttons (`w-full`) only in mobile forms and auth pages.

### 4.2 Forms

Built with `react-hook-form` + Zod resolver, using shared schemas from
`@modubiz/contracts`.

| Element     | Component                         | Rules                                                        |
| ----------- | --------------------------------- | ------------------------------------------------------------ |
| Text input  | `Input`                           | `h-9`, `rounded-md`, focus ring via `--ring`                 |
| Textarea    | `Textarea`                        | Same as Input; auto-resize for long content                  |
| Select      | `Select` (Radix)                  | Searchable for > 5 options; always shows placeholder         |
| Checkbox    | `Checkbox`                        | Label is clickable; `ms-2` spacing                           |
| Switch      | `Switch`                          | For binary toggles; label beside it                          |
| Date picker | `Calendar` + `Popover`            | Uses org timezone; never native date input                   |
| Money input | `MoneyInput`                      | Custom: separate amount + currency; never `number` input     |
| Form layout | `Form` + `FormField` + `FormItem` | Label above input; error below in `text-destructive text-sm` |

**Form rules:**

- Labels are always visible (no placeholder-only labels).
- Required fields marked with `*` in `text-destructive`.
- Validation errors appear below the field in `text-destructive text-sm`, with
  the error code mapped to an i18n key.
- Submit button is disabled while submitting; shows spinner.
- Never submit on blur — explicit submit only, except for search.
- Forms are divided into sections with `FormSection` for complex forms.

### 4.3 Tables

Data-dense tables are the primary data view in an ERP.

| Feature        | Implementation                                                          |
| -------------- | ----------------------------------------------------------------------- |
| Header         | `bg-muted text-muted-foreground text-xs uppercase tracking-wide`        |
| Rows           | `border-b border-border hover:bg-accent/50 transition-colors`           |
| Cell padding   | `px-4 py-2` (compact) or `px-4 py-3` (comfortable)                      |
| Alignment      | Numbers `text-end tabular-nums`; text `text-start`; icons `text-center` |
| Sort indicator | Chevron icon in header; `text-muted-foreground` when inactive           |
| Pagination     | Cursor-based; "Load more" button or page numbers at the bottom          |
| Empty state    | `EmptyState` component (icon + message + optional action)               |
| Loading        | `Skeleton` rows (not a spinner over the whole table)                    |
| Row actions    | `ActionsMenu` (dropdown) at the end of the row                          |

**Table rules:**

- Never horizontal-scroll on desktop; wrap cells or use truncation with tooltip.
- Money columns use `tabular-nums` and `text-end`.
- Date columns use the shared date formatter (org timezone).
- Bulk selection: checkbox column with a header "select all" checkbox.
- Sticky header on long tables: `sticky top-0`.

### 4.4 Cards

| Element   | Style                                                                                                    |
| --------- | -------------------------------------------------------------------------------------------------------- |
| Container | `rounded-lg border bg-card text-card-foreground shadow-sm`                                               |
| Header    | `p-6 pb-4` with title (`text-lg font-semibold`) + optional description (`text-sm text-muted-foreground`) |
| Content   | `p-6 pt-0`                                                                                               |
| Footer    | `p-6 pt-4 flex justify-end gap-2` (actions aligned to the end)                                           |

**Rules:**

- Cards group related information; one card = one concept.
- Dashboard widgets are cards with a header + content area.
- Never nest cards more than one level deep.

### 4.5 Dialogs and modals

| Type             | Usage                                      |
| ---------------- | ------------------------------------------ |
| `Dialog` (Radix) | Confirmations, quick forms, detail views   |
| `AlertDialog`    | Destructive confirmations (delete, remove) |
| `Sheet`          | Mobile navigation, detail panels on mobile |

**Rules:**

- Dialog width: `max-w-md` (small), `max-w-lg` (default), `max-w-2xl` (large),
  `max-w-4xl` (extra large).
- Always have a close button (`X` icon) in the top-end corner.
- Escape key and overlay click close the dialog.
- Focus trap: focus moves to the dialog on open; returns to trigger on close.
- Destructive dialogs use `AlertDialog` with a clear warning + `destructive`
  confirm button.

### 4.6 Badges and tags

| Variant       | Usage                        |
| ------------- | ---------------------------- |
| `default`     | Neutral status               |
| `success`     | Active, completed, paid      |
| `warning`     | Trial, past_due, pending     |
| `destructive` | Error, suspended, expired    |
| `outline`     | Secondary status, categories |

**Rules:**

- Badges are `text-xs`, `rounded-full`, `px-2.5 py-0.5`.
- Status badges use a dot indicator + text (e.g., `● Active`).

### 4.7 Navigation

| Element     | Component                       | Notes                                                    |
| ----------- | ------------------------------- | -------------------------------------------------------- |
| Sidebar nav | `Nav` from `GET /me/navigation` | Never hardcoded; derived from entitlements + permissions |
| Breadcrumbs | `Breadcrumb`                    | Show the path to the current page                        |
| Tabs        | `Tabs` (Radix)                  | For sub-navigation within a page                         |
| Pagination  | `Pagination`                    | Cursor-based at the bottom of lists                      |

**Rules:**

- Active nav item: `bg-accent text-accent-foreground font-medium`.
- Inactive: `text-muted-foreground hover:bg-accent/50`.
- Icons in nav: `size-4` with `me-2` (before label, flips in RTL).
- Module sections in the sidebar are grouped with a label
  (`text-xs uppercase text-muted-foreground`).

---

## 5. Data display patterns

### 5.1 Lists

- Default to tables for structured data.
- Use card lists for unstructured/visual data (contacts with avatars, products
  with images).
- Every list has: loading state, empty state, error state.
- Pagination at the bottom; "Load more" for infinite scroll on mobile.

### 5.2 Detail views

- Header: title + key attributes + primary actions.
- Body: sections in cards or tabs.
- Related data: tabs or a "Related" section at the bottom.
- Edit: inline form or a dialog, not a separate page (unless the form is
  complex).

### 5.3 Dashboards

- Grid of widget cards (`grid gap-4 md:grid-cols-2 lg:grid-cols-3`).
- Each widget: title + key metric + optional chart + optional "view all" link.
- Widgets are contributed by modules via `dashboardWidgets` in the descriptor.
- Empty dashboard: a welcome message + "get started" actions.

### 5.4 Charts

- **Library:** Recharts (composable, responsive, accessible).
- Colors: use design tokens (`--primary`, `--success`, `--warning`,
  `--destructive`).
- Always include: axis labels, legend, tooltip, and an empty state.
- Money charts use the shared `formatMoney()` for axis labels.
- Date charts use the org timezone.

### 5.5 Money display

- Always use the `<Money>` component or `formatMoney()` — never `toFixed(2)`.
- Currency symbol position follows the locale (symbol before amount in en, after
  in ar).
- Negative money: `text-destructive` with parentheses or a minus sign per
  locale.
- Money in tables: `tabular-nums text-end`.

### 5.6 Date and time display

- Always use the shared date/time formatters — never `toLocaleString()`.
- Display in the org timezone unless the user overrides it.
- Relative time ("2 hours ago") for recent events; absolute time for historical
  records.
- Business day boundaries (POS shifts, daily sales) use the org timezone.

---

## 6. Feedback patterns

### 6.1 Toasts

| Type    | Color                                        | Usage                           |
| ------- | -------------------------------------------- | ------------------------------- |
| Success | `bg-success text-success-foreground`         | "Saved", "Created", "Completed" |
| Error   | `bg-destructive text-destructive-foreground` | "Failed", "Error"               |
| Warning | `bg-warning text-warning-foreground`         | "Trial expiring", "Degraded"    |
| Info    | `bg-primary text-primary-foreground`         | Informational                   |

**Rules:**

- Position: top-end of the screen (`top-4 end-4`).
- Auto-dismiss: 5 seconds (success/info), 10 seconds (warning), persistent
  (error).
- Always include a close button.
- Toast message is an i18n key, never a hardcoded string.
- Never more than 3 toasts visible at once; stack them.

### 6.2 Loading states

| Pattern            | When                                             |
| ------------------ | ------------------------------------------------ |
| `Skeleton`         | Initial page load, table load, card content load |
| `Spinner` (inline) | Button submitting, small area loading            |
| Progress bar       | Long-running operations (exports, imports)       |
| `aria-busy`        | On any element that is loading                   |

**Rules:**

- Never a bare "Loading..." text.
- Skeletons match the shape of the content being loaded.
- Buttons show a spinner and keep their text (for screen readers).
- Optimistic updates where possible: update the UI immediately, reconcile on
  response.

### 6.3 Empty states

Every data view has an empty state:

```
┌───────────────────────────────────┐
│         [Icon, size-12]           │
│                                   │
│    No contacts yet                │
│    Get started by creating one.   │
│                                   │
│      [Create contact]             │
└───────────────────────────────────┘
```

- Icon: `size-12 text-muted-foreground`.
- Title: `text-lg font-semibold`.
- Description: `text-sm text-muted-foreground`.
- Action: primary button (if the user has permission).

### 6.4 Error states

| Error type         | Display                                                                       |
| ------------------ | ----------------------------------------------------------------------------- |
| Network error      | Full-page error with "Try again" button                                       |
| Not found (404)    | Full-page "Not found" with link back                                          |
| Forbidden (403)    | Full-page "You don't have access" with explanation                            |
| Validation error   | Inline in the form field                                                      |
| Conflict (409)     | Toast or inline: "This already exists"                                        |
| Server error (500) | Toast with correlation id: "Something went wrong. Reference: {correlationId}" |

**Rules:**

- Error messages are i18n keys mapped from the error code.
- Never show stack traces or internal details to the user.
- Always provide a path forward (retry, go back, contact support).
- The correlation id is shown so support can trace the error.

---

## 7. Accessibility (WCAG 2.1 AA)

Accessibility is non-negotiable. The POS must be fully keyboard- and
scanner-driven.

### 7.1 General rules

| Rule               | Implementation                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Semantic HTML      | Use `<nav>`, `<main>`, `<article>`, `<section>`, `<aside>`, `<header>`, `<footer>`                                       |
| Headings           | Hierarchical: one `h1` per page; `h2` for sections; `h3` for subsections; never skip levels                              |
| Labels             | Every input has a visible `<label>`; icon-only buttons have `aria-label`                                                 |
| Focus              | Visible focus ring (`focus-visible:ring-2 focus-visible:ring-ring`); never `outline: none` without replacement           |
| Keyboard           | All interactive elements are keyboard-operable; logical tab order; no keyboard traps (except dialogs, which have Escape) |
| Color contrast     | ≥ 4.5:1 for normal text; ≥ 3:1 for large text; verified with axe in CI                                                   |
| Color independence | Information is never conveyed by color alone (add icons, text, or patterns)                                              |
| Images             | Decorative images: `alt=""`; informational images: descriptive `alt`                                                     |
| Animations         | Respect `prefers-reduced-motion`                                                                                         |
| Language           | `<html lang="...">` and `dir="rtl                                                                                        | ltr"` set per locale |

### 7.2 ARIA patterns

- Use Radix primitives' built-in ARIA (they are accessible by default).
- `aria-busy="true"` on loading elements.
- `aria-expanded` on dropdowns and accordions.
- `aria-selected` on tabs and listbox options.
- `aria-describedby` linking inputs to their error messages.
- `role="alert"` on toast containers for screen reader announcements.
- `aria-live="polite"` for dynamic content updates (stock levels, cart totals).

### 7.3 POS-specific accessibility

The POS is used in fast-paced environments, often with a barcode scanner and
minimal mouse interaction.

| Requirement               | Implementation                                                         |
| ------------------------- | ---------------------------------------------------------------------- |
| Keyboard-driven checkout  | Tab through cart lines; Enter to pay; F-keys for quick actions         |
| Barcode scanner input     | Hidden input that captures scanner input; auto-adds to cart            |
| Large touch targets       | Min `size-11` (44px) for POS buttons (vs `size-9` elsewhere)           |
| High contrast             | POS uses a high-contrast variant; tested in bright retail environments |
| Screen reader             | Cart contents announced via `aria-live`; totals announced on update    |
| No drag-and-drop required | All actions have keyboard equivalents                                  |

---

## 8. RTL (Right-to-Left) guidelines

The product must work perfectly in Arabic (`ar`) and any future RTL locale. This
is a hard rule ([AGENTS.md §1 rule 5](../AGENTS.md#1-the-ten-hard-rules)).

### 8.1 CSS rules

| ❌ Never                            | ✅ Instead                                                    |
| ----------------------------------- | ------------------------------------------------------------- |
| `ml-4`, `mr-4`                      | `ms-4`, `me-4`                                                |
| `pl-4`, `pr-4`                      | `ps-4`, `pe-4`                                                |
| `left-0`, `right-0`                 | `start-0`, `end-0`                                            |
| `text-left`, `text-right`           | `text-start`, `text-end`                                      |
| `float-left`, `float-right`         | Use flex/grid instead                                         |
| `border-l`, `border-r`              | `border-s`, `border-e`                                        |
| `rounded-l`, `rounded-r`            | `rounded-s`, `rounded-e`                                      |
| `space-x-4`                         | `gap-4` (in flex) or `space-x-reverse` is not needed with gap |
| `rotate-90` (for directional icons) | Use `rtl:rotate-180` or an icon that is direction-agnostic    |

**Enforcement:** the ESLint Tailwind rule bans directional utilities. This is a
CI-blocking gate.

### 8.2 Layout in RTL

- The sidebar flips to the right side.
- The topbar org switcher moves to the right; user menu moves to the left.
- Tables: the first column is on the right; numbers still align to the end
  (which is now the left).
- Icons that imply direction (chevrons, arrows) must flip: use `rtl:rotate-180`
  or Lucide's `FlipHorizontal`.
- Toasts slide in from the top-left in RTL (top-end in logical terms).

### 8.3 Typography in RTL

- Arabic text uses a larger line height (`leading-loose`) for readability.
- Numbers remain LTR even in RTL context (Arabic-Indic digits are not used;
  Western Arabic numerals are standard in business contexts).
- Mixed-direction text (Arabic + English product names) uses the Unicode
  bidirectional algorithm; ensure `dir="auto"` on user-generated content fields.

### 8.4 Testing RTL

- Every E2E suite includes a test that switches to `ar` and verifies layout.
- RTL snapshot test of the shell and POS in `ar`.
- Visual review in `ar` for every new page/component before merge.
- The i18n completeness check ensures all `ar` keys exist.

---

## 9. POS-specific UI patterns

The POS is a special surface — it is an installable PWA, used in fast-paced
environments, and must work offline.

### 9.1 Layout

```
┌─────────────────────────────────────────────────────┐
│ POS Topbar: [register] [shift status] [offline] [×] │
├──────────────────────┬──────────────────────────────┤
│                      │                              │
│  Product grid        │  Cart                        │
│  (search + tiles)    │  (lines, totals, checkout)   │
│                      │                              │
│                      │                              │
└──────────────────────┴──────────────────────────────┘
```

- **Product grid:** large tiles (`size-20`+) with product name + price;
  searchable; barcode input at the top.
- **Cart:** line items with quantity steppers, line totals, discount field, tax,
  grand total.
- **Checkout:** payment method buttons (cash, card), tendered amount, change
  due, complete button.
- **Offline indicator:** a badge in the topbar showing online/offline status and
  unsynced sale count.

### 9.2 Offline UX

| State      | Indicator                              | Behavior                                               |
| ---------- | -------------------------------------- | ------------------------------------------------------ |
| Online     | Green dot, no label                    | Normal operation                                       |
| Offline    | Amber "Offline" badge + unsynced count | Sales queue locally; user sees "Will sync when online" |
| Syncing    | Spinner on the badge                   | Sales are being sent; progress count                   |
| Sync error | Red badge with error count             | Alert: "N sales failed to sync. [Retry]"               |
| Synced     | Brief green "Synced" toast             | Returns to online state                                |

**Rules:**

- The user is never blocked from making a sale when offline.
- The offline state is always visible — never hidden.
- The user can see how many sales are queued.
- A sale completed offline shows a provisional receipt number; the final number
  is assigned on sync.

### 9.3 Receipt

- Rendered in the **customer's** locale (**I18N-8**), which may differ from the
  operator's.
- Printable via the browser's print dialog (a print-optimized CSS view).
- Emailable via a dialog (enter email, send).
- Contains: org name, receipt number, date/time (org timezone), lines (snapshot
  name + qty + price), subtotal, discounts, tax, total, payments, change, footer
  (org-configurable, translatable).

---

## 10. Responsive design

### 10.1 Mobile

- The sidebar becomes a drawer (hamburger menu in the topbar).
- Tables become card lists (one record per card) or horizontal-scroll with a
  swipe hint.
- Forms are single-column, full-width inputs.
- Dialogs become bottom sheets (`Sheet` from the bottom).
- The POS is usable on a tablet (768px+) but not designed for phone screens.

### 10.2 Tablet

- The sidebar is icon-only (`w-16`); expand on hover or tap.
- Tables show 2–3 columns; secondary columns in a detail expansion.
- Forms may use 2 columns for short fields.

### 10.3 Desktop

- The sidebar is full width (`w-64`).
- Tables show all columns.
- Forms use 2 columns where sensible.
- Dashboards show 3 columns of widgets.

---

## 11. Visual quality checklist

Before a UI PR is merged, verify:

### Layout

- [ ] No directional CSS (`ml-*`, `text-left`, etc.) — use logical utilities
- [ ] Responsive: works on mobile, tablet, desktop
- [ ] Content max-width applied (no full-width text on large screens)
- [ ] Consistent spacing (uses the spacing scale, not arbitrary values)

### Typography

- [ ] Uses the typography scale (no arbitrary `text-[Npx]`)
- [ ] `tabular-nums` on numbers in tables
- [ ] Headings use `tracking-tight`

### Color

- [ ] Uses design tokens (no raw hex values)
- [ ] One primary action per view
- [ ] Destructive actions have confirmation
- [ ] Color is not the only information channel (icons + text)

### Components

- [ ] Uses `@modubiz/ui` components (no one-off components)
- [ ] No competing component library
- [ ] Icons from Lucide

### States

- [ ] Loading state (skeleton or spinner, never "Loading...")
- [ ] Empty state (icon + message + action)
- [ ] Error state (i18n key + path forward)
- [ ] Disabled state (`opacity-50`, not just a color change)

### Accessibility

- [ ] Semantic HTML
- [ ] Visible focus ring
- [ ] Keyboard operable
- [ ] `aria-label` on icon-only buttons
- [ ] `aria-busy` on loading elements
- [ ] Color contrast ≥ 4.5:1 (verified with axe)

### Internationalization

- [ ] No hardcoded user-facing strings (all via `next-intl`)
- [ ] No text in images
- [ ] RTL verified in `ar` (layout flips correctly)
- [ ] Money rendered via `<Money>` / `formatMoney()`
- [ ] Dates rendered via shared formatters (org timezone)
- [ ] Message catalogs complete for `en`, `ar`, `fr`, `es`

### Motion

- [ ] Animations use `transform`/`opacity` (not layout properties)
- [ ] `prefers-reduced-motion` respected
- [ ] POS cart interactions are instant (< 100ms)

### Gating

- [ ] `<ModuleGate>` on module routes
- [ ] `<Can>` on mutating controls
- [ ] Entitlement and permission checks are server-authoritative (gates are UX
      only)

---

## 12. Design tokens reference (CSS custom properties)

These are defined in `@modubiz/ui` and consumed by all apps. **Never override
them in feature code.**

```css
/* Light theme (default) */
:root {
  --background: 0 0% 100%;
  --foreground: 222 47% 11%;
  --card: 0 0% 100%;
  --card-foreground: 222 47% 11%;
  --popover: 0 0% 100%;
  --popover-foreground: 222 47% 11%;
  --primary: 222 47% 11%;
  --primary-foreground: 210 40% 98%;
  --secondary: 210 40% 96%;
  --secondary-foreground: 222 47% 11%;
  --muted: 210 40% 96%;
  --muted-foreground: 215 16% 47%;
  --accent: 210 40% 96%;
  --accent-foreground: 222 47% 11%;
  --destructive: 0 72% 51%;
  --destructive-foreground: 210 40% 98%;
  --success: 142 71% 45%;
  --success-foreground: 210 40% 98%;
  --warning: 38 92% 50%;
  --warning-foreground: 222 47% 11%;
  --border: 214 32% 91%;
  --input: 214 32% 91%;
  --ring: 222 47% 11%;
  --radius: 0.5rem;
}

/* Dark theme */
.dark {
  --background: 222 47% 11%;
  --foreground: 210 40% 98%;
  --card: 222 47% 14%;
  --card-foreground: 210 40% 98%;
  --popover: 222 47% 14%;
  --popover-foreground: 210 40% 98%;
  --primary: 210 40% 98%;
  --primary-foreground: 222 47% 11%;
  --secondary: 217 33% 17%;
  --secondary-foreground: 210 40% 98%;
  --muted: 217 33% 17%;
  --muted-foreground: 215 20% 65%;
  --accent: 217 33% 17%;
  --accent-foreground: 210 40% 98%;
  --destructive: 0 63% 31%;
  --destructive-foreground: 210 40% 98%;
  --success: 142 71% 45%;
  --success-foreground: 210 40% 98%;
  --warning: 38 92% 50%;
  --warning-foreground: 222 47% 11%;
  --border: 217 33% 20%;
  --input: 217 33% 20%;
  --ring: 212 95% 68%;
}
```

---

## 13. Related documents

[AGENTS.md](../AGENTS.md) · [PLAN.md](../PLAN.md) · [PRD.md](./PRD.md) ·
[TECH_STACK.md](./TECH_STACK.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) ·
[MODULE_GUIDE.md](./MODULE_GUIDE.md) · [DATA_MODEL.md](./DATA_MODEL.md) ·
[BUSINESS_RULES.md](./BUSINESS_RULES.md) ·
[CODING_STANDARDS.md](./CODING_STANDARDS.md) · [TESTING.md](./TESTING.md) ·
[CODE_QUALITY.md](./CODE_QUALITY.md)
