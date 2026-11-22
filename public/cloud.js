/*
 * Sauvegarde en ligne (Firebase) : les rendez-vous sont copiés dans Firestore et partagés
 * entre les appareils connectés au même compte (tablette, téléphone).
 * Utilise directement les API web de Firebase (pas de bibliothèque à charger).
 * Fonctionne dans le navigateur (window.RdvCloud) et dans Node (tests).
 *
 * Principe :
 *  - la tablette reste la référence : tout est d'abord enregistré sur l'appareil ;
 *  - chaque modification locale part dans une « boîte d'envoi », vidée dès qu'Internet est là ;
 *  - une suppression est envoyée comme une marque « supprimé » (les autres appareils l'appliquent) ;
 *  - en cas de modification des deux côtés, la plus récente gagne.
 */
(function (root, factory) {
  var B = typeof module === 'object' && module.exports ? require('./backup.js') : root.RdvBackup;
  var api = factory(B);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RdvCloud = api;
})(typeof self !== 'undefined' ? self : this, function (B) {
  'use strict';

  var FIELDS = ['id', 'date', 'time', 'title', 'said', 'createdAt', 'note', 'updatedAt'];
  var COLLECTION = 'rdv';
  var KEYS = {
    session: 'mes-rendez-vous-compte',  // e-mail, identifiant et jeton de reconnexion
    outbox: 'mes-rendez-vous-envoi',    // modifications pas encore envoyées
    cursor: 'mes-rendez-vous-curseur',  // date de la dernière modification reçue
    status: 'mes-rendez-vous-etat',     // dernier envoi réussi / dernière erreur
    lastUid: 'mes-rendez-vous-dernier-compte'
  };
  var CURSOR_MARGIN_MS = 10 * 60 * 1000; // relit les 10 dernières minutes (horloges un peu décalées)

  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function canon(a) { return JSON.stringify(FIELDS.filter(function (k) { return k !== 'updatedAt'; }).map(function (k) { return a[k]; })); }

  // ---------- Format Firestore ----------
  function encode(item) {
    var f = {};
    FIELDS.forEach(function (k) { if (typeof item[k] === 'string') f[k] = { stringValue: item[k] }; });
    if (item.deleted) f.deleted = { booleanValue: true };
    return { fields: f };
  }

  function decode(doc) {
    var f = (doc && doc.fields) || {}, out = {};
    FIELDS.forEach(function (k) { if (f[k] && typeof f[k].stringValue === 'string') out[k] = f[k].stringValue; });
    if (f.deleted && f.deleted.booleanValue === true) out.deleted = true;
    if (!out.id && doc && typeof doc.name === 'string') out.id = doc.name.split('/').pop();
    return out;
  }

  // ---------- Ce qu'il faut envoyer après une modification locale ----------
  // before : état enregistré avant ; after : nouvel état (ses éléments reçoivent updatedAt s'ils ont changé).
  // keepFrom : date (AAAA-MM-JJ) avant laquelle un rendez-vous disparu a juste été nettoyé, pas supprimé.
  function diff(before, after, nowIso, keepFrom) {
    var prev = {};
    before.forEach(function (a) { prev[a.id] = a; });
    var out = [];
    after.forEach(function (a) {
      var p = prev[a.id];
      delete prev[a.id];
      if (!p || canon(p) !== canon(a)) { a.updatedAt = nowIso; out.push(clone(a)); }
    });
    Object.keys(prev).forEach(function (id) {
      if (keepFrom && prev[id].date < keepFrom) return; // nettoyage automatique des vieux rendez-vous
      out.push({ id: id, deleted: true, updatedAt: nowIso });
    });
    return out;
  }

  // ---------- Fusion de ce qui vient d'Internet ----------
  // local : rendez-vous de l'appareil ; outbox : { id: modification en attente } ;
  // remote : documents reçus (décodés) ; full : liste complète (sinon seulement les derniers changements).
  // Renvoie la nouvelle liste, s'il y a eu un changement, et les rendez-vous locaux à (r)envoyer.
  function reconcile(local, outbox, remote, keepFrom, full, nowIso) {
    var result = local.slice();
    var index = {};
    result.forEach(function (a, i) { index[a.id] = i; });
    var seen = {}, changed = false, toSend = [];

    function stamp(a) { return a.updatedAt || ''; }

    remote.forEach(function (r) {
      if (!r || !r.id) return;
      seen[r.id] = true;
      if (outbox[r.id]) return; // une modification locale attend d'être envoyée : elle gagne
      var i = index[r.id];
      var l = i === undefined ? null : result[i];
      if (r.deleted) {
        if (!l) return;
        if (stamp(l) <= (r.updatedAt || '')) { result[i] = null; changed = true; }
        else toSend.push(clone(l));
        return;
      }
      var c = B.clean(r);
      if (!c) return;
      if (!l) {
        if (keepFrom && c.date < keepFrom) return; // trop ancien : on ne le remet pas sur l'appareil
        index[c.id] = result.length;
        result.push(c);
        changed = true;
      } else if (stamp(c) > stamp(l)) {
        result[i] = c;
        changed = true;
      } else if (stamp(l) > stamp(c)) {
        toSend.push(clone(l));
      }
    });

    if (full) {
      result.forEach(function (l) {
        if (l && !seen[l.id] && !outbox[l.id]) {
          var s = clone(l);
          if (!s.updatedAt) s.updatedAt = s.createdAt || nowIso;
          toSend.push(s);
        }
      });
    }
    return { appointments: result.filter(Boolean), changed: changed, toSend: toSend };
  }

  // ---------- Messages d'erreur ----------
  function CloudError(code, message) { this.code = code; this.message = message; }
  CloudError.prototype = Object.create(Error.prototype);

  function authMessage(code) {
    if (/INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND|INVALID_EMAIL|MISSING_PASSWORD/.test(code)) {
      return 'E-mail ou mot de passe incorrect.';
    }
    if (/TOO_MANY_ATTEMPTS/.test(code)) return 'Trop d’essais. Réessayez dans quelques minutes.';
    if (/USER_DISABLED/.test(code)) return 'Ce compte a été désactivé.';
    return 'Connexion impossible (' + code + ').';
  }

  // ---------- Client ----------
  // o : { config: { apiKey, projectId }, store: { get(k), set(k, v), remove(k) }, fetch, now: () => Date }
  function createClient(o) {
    var cfg = o.config, store = o.store, fetchFn = o.fetch;
    var now = o.now || function () { return new Date(); };
    var base = 'https://firestore.googleapis.com/v1/projects/' + cfg.projectId + '/databases/(default)/documents';
    var idToken = null, idTokenExp = 0;

    function readJson(k, fallback) {
      try { var v = JSON.parse(store.get(k) || 'null'); return v == null ? fallback : v; } catch (e) { return fallback; }
    }
    function writeJson(k, v) { store.set(k, JSON.stringify(v)); }

    function session() { return readJson(KEYS.session, null); }
    function outbox() { var b = readJson(KEYS.outbox, {}); return b && typeof b === 'object' ? b : {}; }
    function status() { return readJson(KEYS.status, {}); }
    function setStatus(patch) {
      var s = status();
      Object.keys(patch).forEach(function (k) { s[k] = patch[k]; });
      try { writeJson(KEYS.status, s); } catch (e) {}
      return s;
    }

    function request(url, opts) {
      return fetchFn(url, opts).then(function (res) {
        return res.text().then(function (text) {
          var data = null;
          try { data = text ? JSON.parse(text) : null; } catch (e) {}
          if (!res.ok) {
            var code = (data && data.error && (data.error.message || data.error.status)) || ('HTTP_' + res.status);
            throw new CloudError(code, code);
          }
          return data;
        });
      }, function () {
        throw new CloudError('NETWORK', 'Pas de connexion Internet.');
      });
    }

    function signIn(email, password) {
      return request('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + cfg.apiKey, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, password: password, returnSecureToken: true })
      }).then(function (d) {
        idToken = d.idToken;
        idTokenExp = now().getTime() + (+d.expiresIn || 3600) * 1000;
        var previous = readJson(KEYS.lastUid, null);
        writeJson(KEYS.session, { email: d.email || email, uid: d.localId, refreshToken: d.refreshToken });
        writeJson(KEYS.lastUid, d.localId);
        // Même compte qu'avant (reconnexion) : on garde les modifications pas encore envoyées
        if (previous !== d.localId) store.remove(KEYS.outbox);
        store.remove(KEYS.cursor);
        store.remove(KEYS.status);
        return { email: d.email || email, uid: d.localId };
      }, function (e) {
        if (e.code === 'NETWORK') throw e;
        throw new CloudError(e.code, authMessage(e.code));
      });
    }

    function signOut() {
      idToken = null; idTokenExp = 0;
      [KEYS.session, KEYS.outbox, KEYS.cursor, KEYS.status].forEach(function (k) { store.remove(k); });
    }

    function getToken(forceRefresh) {
      var s = session();
      if (!s || !s.refreshToken) return Promise.reject(new CloudError('SIGNED_OUT', 'Pas connecté.'));
      if (!forceRefresh && idToken && now().getTime() < idTokenExp - 60000) return Promise.resolve(idToken);
      return request('https://securetoken.googleapis.com/v1/token?key=' + cfg.apiKey, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(s.refreshToken)
      }).then(function (d) {
        idToken = d.id_token;
        idTokenExp = now().getTime() + (+d.expires_in || 3600) * 1000;
        if (d.refresh_token && d.refresh_token !== s.refreshToken) {
          s.refreshToken = d.refresh_token;
          writeJson(KEYS.session, s);
        }
        return idToken;
      }, function (e) {
        if (e.code === 'NETWORK') throw e;
        // Jeton refusé (mot de passe changé, compte désactivé…) : il faudra se reconnecter
        throw new CloudError('AUTH', 'La connexion a expiré : reconnectez-vous.');
      });
    }

    // Appel Firestore avec le jeton ; en cas de refus du jeton, on le renouvelle une fois.
    function api(method, url, body, retried) {
      return getToken(retried).then(function (token) {
        var opts = { method: method, headers: { Authorization: 'Bearer ' + token } };
        if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
        return request(url, opts);
      }).catch(function (e) {
        if (!retried && (e.code === 'UNAUTHENTICATED' || e.code === 'HTTP_401')) return api(method, url, body, true);
        if (e.code === 'PERMISSION_DENIED') throw new CloudError('DENIED', "Ce compte n'a pas accès à la sauvegarde.");
        throw e;
      });
    }

    function enqueue(items) {
      if (!items || !items.length || !session()) return;
      var box = outbox();
      items.forEach(function (it) { box[it.id] = clone(it); });
      writeJson(KEYS.outbox, box);
    }

    // Envoie la boîte d'envoi, un rendez-vous après l'autre
    function push() {
      var ids = Object.keys(outbox());
      var p = Promise.resolve();
      ids.forEach(function (id) {
        p = p.then(function () {
          var item = outbox()[id];
          if (!item) return;
          return api('PATCH', base + '/' + COLLECTION + '/' + encodeURIComponent(id), encode(item)).then(function () {
            var box = outbox();
            // on ne retire que si rien n'a changé pendant l'envoi
            if (box[id] && box[id].updatedAt === item.updatedAt) { delete box[id]; writeJson(KEYS.outbox, box); }
          });
        });
      });
      return p;
    }

    function listAll() {
      var docs = [];
      function page(token) {
        var url = base + '/' + COLLECTION + '?pageSize=300' + (token ? '&pageToken=' + encodeURIComponent(token) : '');
        return api('GET', url).then(function (d) {
          ((d && d.documents) || []).forEach(function (doc) { docs.push(decode(doc)); });
          return d && d.nextPageToken ? page(d.nextPageToken) : docs;
        });
      }
      return page(null);
    }

    function changedSince(since) {
      return api('POST', base + ':runQuery', {
        structuredQuery: {
          from: [{ collectionId: COLLECTION }],
          where: { fieldFilter: { field: { fieldPath: 'updatedAt' }, op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: since } } }
        }
      }).then(function (rows) {
        return (rows || []).filter(function (r) { return r && r.document; }).map(function (r) { return decode(r.document); });
      });
    }

    // Envoie puis reçoit. Renvoie les documents reçus ; la fusion se fait ensuite (reconcile),
    // au moment où l'appli a la liste à jour sous la main.
    function exchange(full) {
      var cursor = store.get(KEYS.cursor);
      return push().then(function () {
        if (full || !cursor) return listAll();
        var since = new Date(new Date(cursor).getTime() - CURSOR_MARGIN_MS).toISOString();
        return changedSince(since);
      }).then(function (docs) {
        var max = cursor || '';
        docs.forEach(function (d) { if (d.updatedAt && d.updatedAt > max) max = d.updatedAt; });
        if (max) store.set(KEYS.cursor, max);
        setStatus({ lastOk: now().toISOString(), error: null, errorCode: null });
        return { docs: docs, full: full || !cursor };
      }, function (e) {
        setStatus({ error: e.message || String(e), errorCode: e.code || 'ERROR', errorAt: now().toISOString() });
        throw e;
      });
    }

    return {
      signIn: signIn,
      signOut: signOut,
      session: session,
      isConnected: function () { return !!session(); },
      enqueue: enqueue,
      outbox: outbox,
      pending: function () { return Object.keys(outbox()).length; },
      status: status,
      exchange: exchange
    };
  }

  return {
    encode: encode,
    decode: decode,
    diff: diff,
    reconcile: reconcile,
    createClient: createClient,
    KEYS: KEYS
  };
});
