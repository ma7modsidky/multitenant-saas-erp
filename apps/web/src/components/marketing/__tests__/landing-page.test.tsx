// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The landing page itself is a server component — next-intl/server resolves
// the catalog on the server. In jsdom we stub it with an identity translator
// so section-level assertions can target message keys, plus an 'en' locale
// for the CTA hrefs. The showcase is a client component with its own test
// block below, so it is stubbed out of the section render.
vi.mock('next-intl/server', () => ({
  getTranslations: () => (key: string) => `landing.${key}`,
  getLocale: () => Promise.resolve('en'),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/en',
}));

vi.mock('../product-showcase', () => ({
  ProductShowcase: () => <div data-testid="showcase-stub" />,
}));

import { LandingPage } from '../landing-page';

describe('LandingPage — public marketing home (sections)', () => {
  let rendered: ReturnType<typeof render>;

  beforeEach(async () => {
    rendered = render(await LandingPage());
  });

  it('renders every anchored section the topbar and footer link to', () => {
    for (const id of ['product', 'modules', 'how', 'testimonials']) {
      expect(document.getElementById(id)).not.toBeNull();
    }
  });

  it('renders the hero CTAs scoped to the active locale (signup + login)', () => {
    const links = screen.getAllByRole('link', { name: 'landing.hero.ctaPrimary' });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link).toHaveAttribute('href', '/en/signup');

    const signIn = screen.getAllByRole('link', { name: 'landing.hero.ctaSecondary' });
    expect(signIn.length).toBeGreaterThan(0);
    for (const link of signIn) expect(link).toHaveAttribute('href', '/en/login');
  });

  it('lists all eight modules with availability badges', () => {
    for (const key of ['crm', 'inventory', 'pos', 'accounting', 'purchasing', 'ecommerce', 'food', 'hr']) {
      expect(screen.getByText(`landing.modules.${key}.name`)).toBeInTheDocument();
    }
    expect(screen.getAllByText('landing.modules.statusAvailable')).toHaveLength(5);
    expect(screen.getAllByText('landing.modules.statusPlanned')).toHaveLength(3);
  });

  it('renders the four how-it-works steps and the three testimonial placeholders', () => {
    for (const step of ['step1', 'step2', 'step3', 'step4']) {
      expect(screen.getByText(`landing.how.${step}.title`)).toBeInTheDocument();
    }
    for (const t of ['t1', 't2', 't3']) {
      // Quotes render wrapped in typographic quotation marks.
      expect(screen.getByText((_, el) => el?.textContent === `“landing.testimonials.${t}.quote”`)).toBeInTheDocument();
    }
    // Sample-content disclosure so placeholders are never mistaken for real customers.
    expect(screen.getByText('landing.testimonials.sampleNote')).toBeInTheDocument();
  });

  it('mounts the product showcase in the hero', () => {
    expect(screen.getByTestId('showcase-stub')).toBeInTheDocument();
    rendered.unmount();
  });
});
