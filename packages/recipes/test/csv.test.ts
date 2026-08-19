import { describe, expect, it } from 'vitest';
import { parseCsv, csvToRecords } from '../src/csv.js';

describe('parseCsv', () => {
  it('parses a simple comma-delimited grid', () => {
    expect(parseCsv('a,b,c\n1,2,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('handles quoted fields with embedded commas and escaped quotes', () => {
    const csv = 'title,note\n"Sale, 20% off","She said ""yes"""\n';
    expect(parseCsv(csv)).toEqual([
      ['title', 'note'],
      ['Sale, 20% off', 'She said "yes"'],
    ]);
  });

  it('handles a quoted field containing a newline', () => {
    const csv = 'title,body\n"multi\nline",ok\n';
    expect(parseCsv(csv)).toEqual([
      ['title', 'body'],
      ['multi\nline', 'ok'],
    ]);
  });

  it('handles a trailing row with no final newline', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('csvToRecords', () => {
  it('maps rows to header-keyed records', () => {
    const records = csvToRecords('topic,url\nSpring sale,https://example.com/1\n');
    expect(records).toEqual([{ topic: 'Spring sale', url: 'https://example.com/1' }]);
  });

  it('returns an empty array for an empty or header-only input', () => {
    expect(csvToRecords('')).toEqual([]);
    expect(csvToRecords('topic,url\n')).toEqual([]);
  });
});
