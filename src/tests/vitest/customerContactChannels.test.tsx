import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  emailError, instagramError, instagramUrl, mailtoLink, normalizeEmail, normalizeInstagram, normalizeWebsite, telLink, websiteError, whatsappLink,
} from '../../lib/customers/contactChannels';
import { CustomerChannelLinks, PhoneLinks } from '../../components/customers/ContactLinks';
import { CustomerChannelFields } from '../../components/customers/CustomerChannelFields';
import { appVersionLabel } from '../../lib/system/appVersionLabel';
import { PAGE_ACCESS } from '../../lib/permissions/pageAccess';

const SRC = join(__dirname, '../..');

describe('Party contact channels (N-02 part 1)', () => {
  it('normalizes and checks e-mail', () => {
    expect(normalizeEmail(' Info@Papital.IR ')).toBe('Info@papital.ir');
    expect(emailError('info@papital.ir')).toBeNull();
    expect(emailError('')).toBeNull();
    expect(emailError('x@y')).toMatch(/قالب درستی ندارد/);
    expect(emailError('no at sign')).not.toBeNull();
  });

  it('completes a website without a scheme and refuses one without a dotted host', () => {
    expect(normalizeWebsite('papital.ir')).toBe('https://papital.ir');
    expect(normalizeWebsite('HTTP://papital.ir')).toBe('http://papital.ir');
    expect(websiteError('papital.ir/shop')).toBeNull();
    expect(websiteError('not a site')).not.toBeNull();
    expect(websiteError('localhost')).not.toBeNull();
  });

  it('stores an Instagram username without @ from a handle or a page address', () => {
    for (const input of ['@Papital', 'papital', 'instagram.com/papital', 'https://www.instagram.com/papital/?hl=fa']) {
      expect(normalizeInstagram(input)).toBe('papital');
    }
    expect(instagramError('@papital.gallery')).toBeNull();
    expect(instagramError('پاپیتال')).not.toBeNull();
    expect(instagramUrl('@Papital')).toBe('https://instagram.com/papital');
  });

  it('builds call, WhatsApp and mail links with the phone match key', () => {
    expect(telLink('۰۹۱۲ ۱۱۱ ۲۲۳۳')).toBe('tel:09121112233');
    expect(whatsappLink('09121112233')).toBe('https://wa.me/989121112233');
    expect(whatsappLink('+98 912 111 2233')).toBe('https://wa.me/989121112233');
    expect(whatsappLink('0098۹۱۲۱۱۱۲۲۳۳')).toBe('https://wa.me/989121112233');
    expect(whatsappLink('+971501234567')).toBe('https://wa.me/971501234567');
    expect(whatsappLink('12345')).toBe('');
    expect(mailtoLink('bad@')).toBe('');
    expect(mailtoLink('a@b.ir')).toBe('mailto:a@b.ir');
  });

  it('renders the one-click links only for valid values', () => {
    render(<div><PhoneLinks phone="09121112233" /><CustomerChannelLinks website="papital.ir" email="bad" instagram="papital" /></div>);
    expect(screen.getByRole('link', { name: 'تماس' }).getAttribute('href')).toBe('tel:09121112233');
    expect(screen.getByRole('link', { name: 'واتس‌اپ' }).getAttribute('href')).toBe('https://wa.me/989121112233');
    expect(screen.getByRole('link', { name: /papital\.ir/ }).getAttribute('href')).toBe('https://papital.ir');
    expect(screen.queryByRole('link', { name: /bad/ })).toBeNull();
    expect(screen.getByTitle('صفحه اینستاگرام').getAttribute('href')).toBe('https://instagram.com/papital');
  });

  it('shows a field error under the form field', () => {
    render(<CustomerChannelFields value={{ website: '', email: 'x@y', instagram: '' }} onChange={() => undefined} />);
    expect(screen.getByRole('alert').textContent).toMatch(/ایمیل/);
  });
});

describe('Intro and updates page removed (10.1 plan L4)', () => {
  it('has no route, menu item or page access row, and the login page no longer bundles the changelog', () => {
    expect(Object.keys(PAGE_ACCESS)).not.toContain('/changelog');
    const routes = readFileSync(join(SRC, 'components/AppRoutes.tsx'), 'utf8');
    const menu = readFileSync(join(SRC, 'components/layout/menuConfig.ts'), 'utf8');
    const login = readFileSync(join(SRC, 'pages/LoginPage.tsx'), 'utf8');
    expect(routes).not.toMatch(/ChangelogPage|\/changelog/);
    expect(menu).not.toMatch(/\/changelog|معرفی و به‌روزرسانی‌ها/);
    expect(login).not.toMatch(/changelog/i);
  });

  it('writes the version label with Persian digits', () => {
    expect(appVersionLabel('10.1.13')).toBe('نسخه ۱۰.۱.۱۳');
    expect(appVersionLabel('v9.0.1')).toBe('نسخه ۹.۰.۱');
    expect(appVersionLabel(undefined)).toBe('');
  });
});
