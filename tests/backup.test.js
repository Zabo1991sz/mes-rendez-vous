const test = require('node:test');
const assert = require('node:assert');
const B = require('../public/backup.js');

const A = { id: 'a1', date: '2026-11-17', time: '10:00', title: 'Psy', said: 'psy mardi', createdAt: '2026-11-15T09:00:00.000Z' };
const C = { id: 'c3', date: '2026-12-03', time: '', title: 'Prise de sang', note: 'À jeun' };
const D = { id: 'd4', date: '2026-12-10', time: '09:15', title: 'Cardiologue' };

test('un fichier de sauvegarde se relit à l’identique', () => {
  const text = B.serialize([A, C], new Date(2026, 10, 22, 10, 0));
  const r = B.parse(text);
  assert.deepStrictEqual(r.appointments, [A, C]);
  assert.strictEqual(r.rejected, 0);
  assert.ok(r.savedAt.startsWith('2026-11-22'));
});

test('refuse un fichier qui n’est pas une sauvegarde', () => {
  assert.throws(() => B.parse('pas du json'), /pas une sauvegarde/);
  assert.throws(() => B.parse('{"foo": 1}'), /pas une sauvegarde/);
  assert.throws(() => B.parse('[]'), /pas une sauvegarde/);
});

test('refuse une sauvegarde d’une version plus récente', () => {
  const text = JSON.stringify({ app: 'mes-rendez-vous', format: 99, appointments: [] });
  assert.throws(() => B.parse(text), /plus récente/);
});

test('écarte les rendez-vous abîmés et les compte', () => {
  const text = JSON.stringify({
    app: 'mes-rendez-vous', format: 1, appointments: [
      A,
      { id: 'x', date: '17/11/2026', time: '', title: 'mauvaise date' },
      { id: 'y', date: '2026-11-17', time: '25:00', title: 'mauvaise heure' },
      { date: '2026-11-17', time: '', title: 'sans identifiant' },
      null,
    ],
  });
  const r = B.parse(text);
  assert.deepStrictEqual(r.appointments, [A]);
  assert.strictEqual(r.rejected, 4);
});

test('ne garde que les champs connus', () => {
  const text = JSON.stringify({ app: 'mes-rendez-vous', format: 1, appointments: [{ ...D, pirate: '<script>' }] });
  assert.deepStrictEqual(B.parse(text).appointments, [D]);
});

test('la récupération ajoute seulement ce qui manque', () => {
  const r = B.merge([A, D], [A, C]);
  assert.deepStrictEqual(r.appointments.map((x) => x.id), ['a1', 'd4', 'c3']);
  assert.strictEqual(r.added, 1);
});

test('la récupération ne modifie pas un rendez-vous déjà présent', () => {
  const modified = { ...A, title: 'Autre chose' };
  const r = B.merge([A], [modified]);
  assert.strictEqual(r.appointments[0].title, 'Psy');
  assert.strictEqual(r.added, 0);
});

test('une copie de sécurité par jour, avec l’état d’avant la première modification', () => {
  const day1 = new Date(2026, 10, 20, 9, 0);
  let s = B.addSnapshot([], [A], day1);
  s = B.addSnapshot(s, [A, C], new Date(2026, 10, 20, 15, 0)); // même jour : ignorée
  assert.strictEqual(s.length, 1);
  assert.deepStrictEqual(s[0].appointments, [A]);
  assert.strictEqual(s[0].day, '2026-11-20');

  s = B.addSnapshot(s, [A, C], new Date(2026, 10, 21, 8, 0));
  assert.strictEqual(s.length, 2);
  assert.deepStrictEqual(s[1].appointments, [A, C]);
});

test('copie forcée le même jour (avant une récupération)', () => {
  const now = new Date(2026, 10, 20, 9, 0);
  let s = B.addSnapshot([], [A], now);
  s = B.addSnapshot(s, [A, C], now, true);
  assert.strictEqual(s.length, 2);
});

test('pas de copie inutile : liste vide ou identique à la précédente', () => {
  assert.deepStrictEqual(B.addSnapshot([], [], new Date(2026, 10, 20)), []);
  let s = B.addSnapshot([], [A], new Date(2026, 10, 20));
  s = B.addSnapshot(s, [A], new Date(2026, 10, 21));
  assert.strictEqual(s.length, 1);
});

test('garde au plus les 7 dernières copies', () => {
  let s = [];
  for (let d = 1; d <= 10; d++) s = B.addSnapshot(s, [{ ...A, title: 'v' + d }], new Date(2026, 10, d));
  assert.strictEqual(s.length, B.MAX_SNAPSHOTS);
  assert.strictEqual(s[0].appointments[0].title, 'v4');
  assert.strictEqual(s[6].appointments[0].title, 'v10');
});

test('la copie ne bouge pas si on modifie ensuite les rendez-vous', () => {
  const list = [{ ...A }];
  const s = B.addSnapshot([], list, new Date(2026, 10, 20));
  list[0].title = 'changé';
  assert.strictEqual(s[0].appointments[0].title, 'Psy');
});

test('lecture des copies enregistrées : ignore ce qui est abîmé', () => {
  assert.deepStrictEqual(B.readSnapshots(null), []);
  assert.deepStrictEqual(B.readSnapshots('{oups'), []);
  const text = JSON.stringify([
    { day: '2026-11-20', at: '2026-11-20T08:00:00.000Z', appointments: [A, { bad: true }] },
    { day: 'x' },
  ]);
  const r = B.readSnapshots(text);
  assert.strictEqual(r.length, 1);
  assert.deepStrictEqual(r[0].appointments, [A]);
});

test('nom du fichier de sauvegarde', () => {
  assert.strictEqual(B.fileName(new Date(2026, 0, 5)), 'mes-rendez-vous-2026-01-05.json');
});
