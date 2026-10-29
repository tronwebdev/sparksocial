import { describe, expect, it } from 'vitest';
import { parseLeadCsv } from '../src/components/agency/leadCsv';

/**
 * Find Clients' Clientforce import. Clientforce has no API — its contacts CSV
 * is the connection — so what matters is that a person-first export lands as
 * leads with the right names, whatever the header spelling.
 */
describe('parseLeadCsv — a Clientforce contacts export', () => {
  it('joins First and Last Name, and keeps the company as the business', () => {
    const p = parseLeadCsv(
      'First Name,Last Name,Email,Phone Number,Company\nAda,Obi,ADA@acme.example,+44 20 7946 0018,Acme Bakery\n',
    )!;
    expect(p.importable).toEqual([
      expect.objectContaining({
        businessName: 'Acme Bakery',
        contactName: 'Ada Obi',
        email: 'ada@acme.example',
        phone: '+44 20 7946 0018',
      }),
    ]);
    expect(p.looksUnmapped).toBe(false);
  });

  it('names the lead after the person when the export has no company column', () => {
    const p = parseLeadCsv('first_name,last_name,email_address\nTunde,Bello,tunde@example.com\n')!;
    expect(p.importable[0]).toMatchObject({ businessName: 'Tunde Bello', contactName: 'Tunde Bello', email: 'tunde@example.com' });
    expect(p.mapped).toEqual(expect.arrayContaining(['contactName', 'email']));
    expect(p.mapped.filter((m) => m === 'contactName')).toHaveLength(1);
  });

  it('still reads an ordinary CRM sheet the way it did', () => {
    const p = parseLeadCsv('Business Name,Contact Name,Website\nJoe Coffee,Joe,joecoffee.example\n')!;
    expect(p.importable[0]).toMatchObject({ businessName: 'Joe Coffee', contactName: 'Joe', website: 'https://joecoffee.example' });
  });
});
