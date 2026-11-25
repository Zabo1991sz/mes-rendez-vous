const test = require('node:test');
const assert = require('node:assert');
const H = require('../public/holidays.js');

test('jours fériés vaudois 2026', () => {
  assert.deepStrictEqual(H.forYear(2026), {
    '2026-01-01': 'Nouvel An',
    '2026-01-02': '2 janvier',
    '2026-04-03': 'Vendredi saint',
    '2026-04-06': 'Lundi de Pâques',
    '2026-05-14': 'Ascension',
    '2026-05-25': 'Lundi de Pentecôte',
    '2026-08-01': 'Fête nationale',
    '2026-09-21': 'Lundi du Jeûne fédéral',
    '2026-12-25': 'Noël',
  });
});

test('dates mobiles 2027', () => {
  const y = H.forYear(2027);
  assert.strictEqual(y['2027-03-26'], 'Vendredi saint');
  assert.strictEqual(y['2027-03-29'], 'Lundi de Pâques');
  assert.strictEqual(y['2027-05-06'], 'Ascension');
  assert.strictEqual(y['2027-05-17'], 'Lundi de Pentecôte');
  assert.strictEqual(y['2027-09-20'], 'Lundi du Jeûne fédéral');
});

test('Pâques sur plusieurs années', () => {
  const iso = (d) => d.toISOString().slice(0, 10);
  const easter = (y) => { const d = H.easter(y); return iso(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))); };
  assert.strictEqual(easter(2025), '2025-04-20');
  assert.strictEqual(easter(2028), '2028-04-16');
  assert.strictEqual(easter(2030), '2030-04-21');
});

test('Jeûne fédéral quand septembre commence un dimanche (2030)', () => {
  // 1er septembre 2030 = dimanche -> 3e dimanche = 15 -> lundi 16
  assert.strictEqual(H.forYear(2030)['2030-09-16'], 'Lundi du Jeûne fédéral');
});

test('nameOf', () => {
  assert.strictEqual(H.nameOf('2026-12-25'), 'Noël');
  assert.strictEqual(H.nameOf('2026-12-26'), null);
  assert.strictEqual(H.nameOf(null), null);
});
