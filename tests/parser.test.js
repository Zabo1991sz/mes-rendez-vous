const test = require('node:test');
const assert = require('node:assert');
const P = require('../public/parser.js');

// « Aujourd'hui » pour les tests : dimanche 15 novembre 2026, 9 h
const NOW = new Date(2026, 10, 15, 9, 0);

const cases = [
  ["J'ai un rendez-vous chez le Psy le mardi 17 novembre a 10 heure", '2026-11-17', '10:00', 'Rendez-vous chez le Psy'],
  ['rendez-vous chez le dentiste demain à 14h30', '2026-11-16', '14:30', 'Rendez-vous chez le dentiste'],
  ['prise de sang au laboratoire le 3 décembre à 8h', '2026-12-03', '08:00', 'Prise de sang au laboratoire'],
  ["j'ai rendez-vous avec le docteur Martin vendredi à 3 heures de l'après-midi", '2026-11-20', '15:00', 'Rendez-vous avec le docteur Martin'],
  ['kiné le 1er décembre à 11 heures et demie', '2026-12-01', '11:30', 'Kiné'],
  ["rendez-vous chez l'ophtalmo le 5 janvier à midi", '2027-01-05', '12:00', "Rendez-vous chez l'ophtalmo"],
  ['cardiologue le 10/12 à 9h15', '2026-12-10', '09:15', 'Cardiologue'],
  ['dentiste après-demain à 10 heures moins le quart', '2026-11-17', '09:45', 'Dentiste'],
  ["j'ai rendez-vous chez le médecin mardi à dix heures", '2026-11-17', '10:00', 'Rendez-vous chez le médecin'],
  ["J'ai un rendez-vous chez le psy le dix-sept novembre à 10h", '2026-11-17', '10:00', 'Rendez-vous chez le psy'],
  ['rendez-vous pour une prise de sang dans 3 jours à 7h30', '2026-11-18', '07:30', 'Prise de sang'],
  ["Rendez-vous à l'hôpital le 2 février 2027 à 14:00", '2027-02-02', '14:00', "Rendez-vous à l'hôpital"],
  ['coiffeur samedi 21 novembre à 9 h', '2026-11-21', '09:00', 'Coiffeur'],
  ['infirmière ce soir à 6 heures', '2026-11-15', '18:00', 'Infirmière'],
];

for (const [text, date, time, title] of cases) {
  test(text, () => {
    const r = P.parse(text, NOW);
    assert.deepStrictEqual({ date: r.date, time: r.time, title: r.title }, { date, time, title });
  });
}

test('signale un jour de la semaine qui ne correspond pas à la date', () => {
  const r = P.parse("j'ai un rendez-vous chez le psy le lundi 17 novembre à 10h", NOW);
  assert.strictEqual(r.date, '2026-11-17');
  assert.ok(r.warnings.some((w) => w.includes('mardi')));
});

test('date absente : date nulle et avertissement', () => {
  const r = P.parse('rendez-vous chez le psy', NOW);
  assert.strictEqual(r.date, null);
  assert.strictEqual(r.time, null);
  assert.strictEqual(r.title, 'Rendez-vous chez le psy');
  assert.ok(r.warnings.length > 0);
});

test('date par défaut (ajout depuis le calendrier)', () => {
  const r = P.parse('Psy à 10 heures', NOW, { defaultDate: '2026-11-24' });
  assert.deepStrictEqual([r.date, r.time, r.title, r.warnings.length], ['2026-11-24', '10:00', 'Psy', 0]);
  const r2 = P.parse('dentiste le 3 décembre à 9h', NOW, { defaultDate: '2026-11-24' });
  assert.strictEqual(r2.date, '2026-12-03'); // la date dite l'emporte
});

test('date inexistante', () => {
  const r = P.parse('dentiste le 31 février à 10h', NOW);
  assert.strictEqual(r.date, null);
});

test('mise en forme', () => {
  assert.strictEqual(P.formatDate('2026-11-17', { now: NOW }), 'Mardi 17 novembre');
  assert.strictEqual(P.formatDate('2027-01-05', { now: NOW }), 'Mardi 5 janvier 2027');
  assert.strictEqual(P.formatTime('10:00'), '10 h');
  assert.strictEqual(P.formatTime('14:30'), '14 h 30');
});
