const test = require('node:test');
const assert = require('node:assert');
const C = require('../public/cloud.js');

const KEEP = '2026-10-23'; // nettoyage : 30 jours avant le 22/11/2026
const NOW = '2026-11-22T10:00:00.000Z';
const A = { id: 'a1', date: '2026-11-25', time: '10:00', title: 'Psy', createdAt: '2026-11-20T08:00:00.000Z' };
const D = { id: 'd4', date: '2026-12-10', time: '09:15', title: 'Cardiologue' };

// ---------- Fonctions pures ----------

test('encode / decode : aller-retour au format Firestore', () => {
  const item = { ...A, note: 'Carte Vitale', updatedAt: NOW };
  assert.deepStrictEqual(C.decode(C.encode(item)), item);
  const tomb = { id: 'x', deleted: true, updatedAt: NOW };
  assert.deepStrictEqual(C.decode(C.encode(tomb)), tomb);
});

test('encode ignore les champs inconnus (refusés par les règles Firestore)', () => {
  const doc = C.encode({ ...A, pirate: 'x', nombre: 3 });
  assert.deepStrictEqual(Object.keys(doc.fields).sort(), ['createdAt', 'date', 'id', 'time', 'title']);
});

test('diff : ajout, modification, suppression', () => {
  const before = [{ ...A }, { ...D }];
  const after = [{ ...A, note: 'nouvelle note' }, { id: 'n1', date: '2026-12-01', time: '', title: 'Kiné' }];
  const out = C.diff(before, after, NOW, KEEP);
  assert.deepStrictEqual(out.map((x) => [x.id, !!x.deleted]), [['a1', false], ['n1', false], ['d4', true]]);
  assert.ok(out.every((x) => x.updatedAt === NOW));
  assert.strictEqual(after[0].updatedAt, NOW); // la date de modification est aussi posée sur l'appareil
});

test('diff : rien de changé, rien à envoyer', () => {
  const before = [{ ...A, updatedAt: 'ancien' }];
  const after = [{ title: A.title, id: A.id, time: A.time, date: A.date, createdAt: A.createdAt, updatedAt: 'ancien' }];
  assert.deepStrictEqual(C.diff(before, after, NOW, KEEP), []);
});

test('diff : le nettoyage des vieux rendez-vous n’est pas une suppression', () => {
  const old = { id: 'o', date: '2026-09-01', time: '', title: 'Vieux' };
  assert.deepStrictEqual(C.diff([old], [], NOW, KEEP), []);
});

test('reconcile : ajoute les nouveaux, applique les suppressions et les modifs plus récentes', () => {
  const local = [{ ...A, updatedAt: '2026-11-20T00:00:00.000Z' }, { ...D, updatedAt: '2026-11-20T00:00:00.000Z' }];
  const remote = [
    { ...A, title: 'Psy (modifié sur le téléphone)', updatedAt: '2026-11-21T00:00:00.000Z' },
    { id: 'd4', deleted: true, updatedAt: '2026-11-21T00:00:00.000Z' },
    { id: 'n1', date: '2026-12-01', time: '', title: 'Kiné', updatedAt: '2026-11-21T00:00:00.000Z' },
  ];
  const r = C.reconcile(local, {}, remote, KEEP, false, NOW);
  assert.ok(r.changed);
  assert.deepStrictEqual(r.appointments.map((x) => x.title), ['Psy (modifié sur le téléphone)', 'Kiné']);
  assert.deepStrictEqual(r.toSend, []);
});

test('reconcile : une modification locale en attente gagne', () => {
  const local = [{ ...A, title: 'Local', updatedAt: '2026-11-21T00:00:00.000Z' }];
  const remote = [{ ...A, title: 'Distant', updatedAt: '2026-11-22T00:00:00.000Z' }];
  const r = C.reconcile(local, { a1: local[0] }, remote, KEEP, false, NOW);
  assert.strictEqual(r.appointments[0].title, 'Local');
  assert.strictEqual(r.changed, false);
});

test('reconcile : la version locale plus récente est renvoyée', () => {
  const local = [{ ...A, title: 'Récent', updatedAt: '2026-11-22T00:00:00.000Z' }];
  const remote = [{ ...A, title: 'Ancien', updatedAt: '2026-11-21T00:00:00.000Z' }];
  const r = C.reconcile(local, {}, remote, KEEP, false, NOW);
  assert.strictEqual(r.appointments[0].title, 'Récent');
  assert.deepStrictEqual(r.toSend.map((x) => x.title), ['Récent']);
});

test('reconcile : un rendez-vous remis après une suppression plus ancienne est renvoyé', () => {
  const local = [{ ...A, updatedAt: '2026-11-22T00:00:00.000Z' }];
  const remote = [{ id: 'a1', deleted: true, updatedAt: '2026-11-21T00:00:00.000Z' }];
  const r = C.reconcile(local, {}, remote, KEEP, false, NOW);
  assert.strictEqual(r.appointments.length, 1);
  assert.strictEqual(r.toSend.length, 1);
});

test('reconcile complet : ce qui n’est pas en ligne est envoyé (première connexion)', () => {
  const local = [{ ...A }, { ...D }];
  const r = C.reconcile(local, {}, [], KEEP, true, NOW);
  assert.deepStrictEqual(r.toSend.map((x) => x.id), ['a1', 'd4']);
  assert.strictEqual(r.toSend[0].updatedAt, A.createdAt);
  assert.strictEqual(r.toSend[1].updatedAt, NOW);
});

test('reconcile : ne remet pas sur l’appareil les rendez-vous trop anciens', () => {
  const remote = [{ id: 'o', date: '2026-09-01', time: '', title: 'Vieux', updatedAt: NOW }];
  const r = C.reconcile([], {}, remote, KEEP, true, NOW);
  assert.deepStrictEqual(r.appointments, []);
});

test('reconcile : écarte un document abîmé', () => {
  const remote = [{ id: 'z', date: 'demain', title: 'x', updatedAt: NOW }];
  assert.deepStrictEqual(C.reconcile([], {}, remote, KEEP, true, NOW).appointments, []);
});

// ---------- Client avec un faux Firebase ----------

function fakeFirebase() {
  const fb = { docs: {}, tokenOk: 'tok-1', refreshOk: 'refresh-1', offline: false, calls: [] };
  const reply = (status, body) => ({ ok: status < 300, status, text: () => Promise.resolve(JSON.stringify(body)) });
  fb.fetch = (url, opts = {}) => {
    fb.calls.push(opts.method + ' ' + url.replace(/\?.*/, ''));
    if (fb.offline) return Promise.reject(new TypeError('Failed to fetch'));
    if (url.includes('accounts:signInWithPassword')) {
      const b = JSON.parse(opts.body);
      if (b.email === 'famille@example.com' && b.password === 'bon-mot-de-passe') {
        return Promise.resolve(reply(200, { idToken: fb.tokenOk, refreshToken: fb.refreshOk, expiresIn: '3600', localId: 'UID', email: b.email }));
      }
      return Promise.resolve(reply(400, { error: { code: 400, message: 'INVALID_LOGIN_CREDENTIALS' } }));
    }
    if (url.includes('securetoken.googleapis.com')) {
      if (opts.body.includes(fb.refreshOk)) return Promise.resolve(reply(200, { id_token: fb.tokenOk, refresh_token: fb.refreshOk, expires_in: '3600' }));
      return Promise.resolve(reply(400, { error: { message: 'INVALID_REFRESH_TOKEN' } }));
    }
    if (opts.headers.Authorization !== 'Bearer ' + fb.tokenOk) {
      return Promise.resolve(reply(401, { error: { code: 401, status: 'UNAUTHENTICATED' } }));
    }
    const m = url.match(/\/documents\/rdv\/([^?]+)$/);
    if (opts.method === 'PATCH' && m) {
      const id = decodeURIComponent(m[1]);
      fb.docs[id] = { name: 'projects/p/databases/(default)/documents/rdv/' + id, ...JSON.parse(opts.body) };
      return Promise.resolve(reply(200, fb.docs[id]));
    }
    if (opts.method === 'GET' && /\/documents\/rdv\?/.test(url)) {
      return Promise.resolve(reply(200, { documents: Object.values(fb.docs) }));
    }
    if (opts.method === 'POST' && url.endsWith(':runQuery')) {
      const since = JSON.parse(opts.body).structuredQuery.where.fieldFilter.value.stringValue;
      const rows = Object.values(fb.docs).filter((d) => d.fields.updatedAt.stringValue >= since).map((document) => ({ document }));
      return Promise.resolve(reply(200, rows.length ? rows : [{ readTime: NOW }]));
    }
    return Promise.resolve(reply(404, { error: { message: 'NOT_FOUND' } }));
  };
  return fb;
}

function memoryStore() {
  const m = {};
  return { get: (k) => (k in m ? m[k] : null), set: (k, v) => { m[k] = String(v); }, remove: (k) => { delete m[k]; }, m };
}

function device(fb) {
  return C.createClient({
    config: { apiKey: 'KEY', projectId: 'p' }, store: memoryStore(), fetch: fb.fetch,
    now: () => new Date(NOW),
  });
}

// Simule ce que fait l'appli : échange puis fusion
async function sync(client, local, full) {
  const ex = await client.exchange(full);
  const r = C.reconcile(local, client.outbox(), ex.docs, KEEP, ex.full, NOW);
  client.enqueue(r.toSend);
  if (r.toSend.length) await client.exchange(false);
  return r.appointments;
}

test('connexion : mauvais mot de passe → message clair', async () => {
  const c = device(fakeFirebase());
  await assert.rejects(c.signIn('famille@example.com', 'faux'), /E-mail ou mot de passe incorrect/);
  assert.strictEqual(c.isConnected(), false);
});

test('pas d’Internet → message clair et état mémorisé', async () => {
  const fb = fakeFirebase();
  const c = device(fb);
  await c.signIn('famille@example.com', 'bon-mot-de-passe');
  fb.offline = true;
  await assert.rejects(c.exchange(true), /Pas de connexion Internet/);
  assert.strictEqual(c.status().errorCode, 'NETWORK');
});

test('tablette et téléphone : ajout, modification et suppression se retrouvent des deux côtés', async () => {
  const fb = fakeFirebase();
  const tablette = device(fb), telephone = device(fb);
  await tablette.signIn('famille@example.com', 'bon-mot-de-passe');
  await telephone.signIn('famille@example.com', 'bon-mot-de-passe');

  // La tablette avait déjà des rendez-vous avant la connexion : ils partent en ligne
  let tab = [{ ...A }, { ...D }];
  tab = await sync(tablette, tab, true);
  assert.deepStrictEqual(Object.keys(fb.docs).sort(), ['a1', 'd4']);

  // Le téléphone les reçoit
  let tel = await sync(telephone, [], true);
  assert.deepStrictEqual(tel.map((x) => x.id).sort(), ['a1', 'd4']);

  // Le téléphone ajoute un rendez-vous et en supprime un
  const telAvant = JSON.parse(JSON.stringify(tel));
  tel = tel.filter((x) => x.id !== 'd4').concat([{ id: 'n1', date: '2026-12-01', time: '', title: 'Kiné' }]);
  telephone.enqueue(C.diff(telAvant, tel, '2026-11-22T10:05:00.000Z', KEEP));
  await sync(telephone, tel, false);

  // La tablette le voit au passage suivant
  tab = await sync(tablette, tab, false);
  assert.deepStrictEqual(tab.map((x) => x.id).sort(), ['a1', 'n1']);
  assert.strictEqual(tablette.pending(), 0);
  assert.strictEqual(telephone.pending(), 0);
});

test('modification faite hors ligne : envoyée au retour d’Internet', async () => {
  const fb = fakeFirebase();
  const c = device(fb);
  await c.signIn('famille@example.com', 'bon-mot-de-passe');
  const avant = [];
  const apres = [{ ...A }];
  c.enqueue(C.diff(avant, apres, NOW, KEEP));
  fb.offline = true;
  await assert.rejects(c.exchange(false));
  assert.strictEqual(c.pending(), 1);
  fb.offline = false;
  await c.exchange(false);
  assert.strictEqual(c.pending(), 0);
  assert.ok(fb.docs.a1);
});

test('jeton expiré : renouvelé automatiquement', async () => {
  const fb = fakeFirebase();
  const c = device(fb);
  await c.signIn('famille@example.com', 'bon-mot-de-passe');
  fb.tokenOk = 'tok-2'; // le serveur n'accepte plus l'ancien jeton
  await c.exchange(true);
  assert.ok(fb.calls.some((x) => x.includes('securetoken')));
});

test('connexion révoquée (mot de passe changé) : demande de se reconnecter', async () => {
  const fb = fakeFirebase();
  const c = device(fb);
  await c.signIn('famille@example.com', 'bon-mot-de-passe');
  fb.tokenOk = 'tok-2';
  fb.refreshOk = 'autre';
  await assert.rejects(c.exchange(true), /reconnectez-vous/);
  assert.strictEqual(c.status().errorCode, 'AUTH');
});

test('reconnexion au même compte : les modifications en attente sont gardées', async () => {
  const fb = fakeFirebase();
  const c = device(fb);
  await c.signIn('famille@example.com', 'bon-mot-de-passe');
  c.enqueue([{ id: 'd4', deleted: true, updatedAt: NOW }]);
  await c.signIn('famille@example.com', 'bon-mot-de-passe');
  assert.strictEqual(c.pending(), 1);
});

test('déconnexion : efface le compte et la boîte d’envoi, pas les rendez-vous', async () => {
  const fb = fakeFirebase();
  const c = device(fb);
  await c.signIn('famille@example.com', 'bon-mot-de-passe');
  c.enqueue([{ ...A, updatedAt: NOW }]);
  c.signOut();
  assert.strictEqual(c.isConnected(), false);
  assert.strictEqual(c.pending(), 0);
});

test('sans connexion, rien n’est mis en attente', () => {
  const c = device(fakeFirebase());
  c.enqueue([{ ...A, updatedAt: NOW }]);
  assert.strictEqual(c.pending(), 0);
});

test('période (vacances) : la date de fin voyage dans « time » et revient intacte', () => {
  const v = { id: 'v1', date: '2026-12-01', endDate: '2026-12-20', time: '', title: 'Vacances', updatedAt: NOW };
  const doc = C.encode(v);
  assert.deepStrictEqual(Object.keys(doc.fields).sort(), ['date', 'id', 'time', 'title', 'updatedAt']);
  assert.strictEqual(doc.fields.time.stringValue, 'fin:2026-12-20');
  assert.deepStrictEqual(C.decode(doc), v);
  const cure = { ...v, id: 'c1', time: '09:00', title: 'Cure' };
  assert.deepStrictEqual(C.decode(C.encode(cure)), cure);
});

test('période : modifier la date de fin est bien un changement à envoyer', () => {
  const v = { id: 'v1', date: '2026-12-01', endDate: '2026-12-20', time: '', title: 'Vacances' };
  const out = C.diff([{ ...v }], [{ ...v, endDate: '2026-12-22' }], NOW, KEEP);
  assert.deepStrictEqual(out.map((x) => x.endDate), ['2026-12-22']);
});

test('période en cours : pas considérée comme trop ancienne tant qu\'elle n\'est pas finie', () => {
  const v = { id: 'v1', date: '2026-10-01', endDate: '2026-12-20', time: '', title: 'Cure', updatedAt: NOW };
  const r = C.reconcile([], {}, [v], KEEP, false, NOW);
  assert.deepStrictEqual(r.appointments.map((a) => a.id), ['v1']);
});
