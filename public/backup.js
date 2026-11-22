/*
 * Sauvegarde des rendez-vous : fichier de sauvegarde et copies de sécurité automatiques.
 * Fonctionne dans le navigateur (window.RdvBackup) et dans Node (tests).
 * Ne touche ni à l'écran ni au stockage : uniquement des données.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RdvBackup = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var APP = 'mes-rendez-vous';
  var FORMAT = 1;
  var MAX_SNAPSHOTS = 7; // une copie par jour, sur les 7 derniers jours de modification

  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  // Garde un rendez-vous seulement s'il a une forme correcte ; renvoie une copie nettoyée ou null.
  function cleanAppt(a) {
    if (!a || typeof a !== 'object') return null;
    if (typeof a.id !== 'string' || !a.id || a.id.length > 64) return null;
    if (typeof a.date !== 'string' || !DATE_RE.test(a.date)) return null;
    var time = a.time == null ? '' : a.time;
    if (typeof time !== 'string' || (time && !TIME_RE.test(time))) return null;
    if (typeof a.title !== 'string') return null;
    var out = { id: a.id, date: a.date, time: time, title: a.title.slice(0, 500) || 'Rendez-vous' };
    if (typeof a.said === 'string') out.said = a.said.slice(0, 1000);
    if (typeof a.createdAt === 'string') out.createdAt = a.createdAt;
    if (typeof a.note === 'string' && a.note) out.note = a.note.slice(0, 5000);
    if (typeof a.updatedAt === 'string') out.updatedAt = a.updatedAt;
    return out;
  }

  // Contenu du fichier de sauvegarde
  function serialize(appts, now) {
    return JSON.stringify({
      app: APP,
      format: FORMAT,
      savedAt: (now || new Date()).toISOString(),
      appointments: clone(appts)
    }, null, 2);
  }

  // Lit un fichier de sauvegarde. Lève une erreur au message compréhensible si le fichier ne convient pas.
  function parse(text) {
    var data;
    try { data = JSON.parse(text); } catch (e) { throw new Error("Ce fichier n'est pas une sauvegarde de Mes rendez-vous."); }
    if (!data || data.app !== APP || !Array.isArray(data.appointments)) {
      throw new Error("Ce fichier n'est pas une sauvegarde de Mes rendez-vous.");
    }
    if (typeof data.format !== 'number' || data.format > FORMAT) {
      throw new Error("Cette sauvegarde vient d'une version plus récente de l'appli. Mettez l'appli à jour.");
    }
    var appointments = [], rejected = 0;
    data.appointments.forEach(function (a) {
      var c = cleanAppt(a);
      if (c) appointments.push(c); else rejected++;
    });
    return { appointments: appointments, rejected: rejected, savedAt: typeof data.savedAt === 'string' ? data.savedAt : null };
  }

  // Ajoute à « current » les rendez-vous de « incoming » qui manquent (même identifiant = déjà présent).
  // Ne supprime et ne modifie jamais rien : une récupération ne peut pas faire perdre de rendez-vous.
  function merge(current, incoming) {
    var seen = {};
    current.forEach(function (a) { seen[a.id] = true; });
    var added = [];
    incoming.forEach(function (a) {
      if (!seen[a.id]) { seen[a.id] = true; added.push(clone(a)); }
    });
    return { appointments: current.concat(added), added: added.length };
  }

  // Copies de sécurité automatiques.
  // À appeler AVANT d'enregistrer une modification, avec l'état d'avant : la première modification
  // de la journée garde donc « l'état de la veille au soir ». force = toujours garder une copie
  // (par ex. juste avant une récupération).
  function addSnapshot(snapshots, previous, now, force) {
    now = now || new Date();
    var list = Array.isArray(snapshots) ? snapshots.slice() : [];
    var day = localDay(now);
    var hasToday = list.some(function (s) { return s.day === day; });
    if (hasToday && !force) return list;
    if (!previous || !previous.length) return list; // rien à protéger
    var last = list[list.length - 1];
    if (last && JSON.stringify(last.appointments) === JSON.stringify(previous)) return list; // identique
    list.push({ day: day, at: now.toISOString(), appointments: clone(previous) });
    while (list.length > MAX_SNAPSHOTS) list.shift();
    return list;
  }

  // Lit les copies enregistrées en ignorant ce qui est abîmé
  function readSnapshots(text) {
    var list;
    try { list = JSON.parse(text || '[]'); } catch (e) { return []; }
    if (!Array.isArray(list)) return [];
    return list.filter(function (s) {
      return s && typeof s.day === 'string' && typeof s.at === 'string' && Array.isArray(s.appointments);
    }).map(function (s) {
      return { day: s.day, at: s.at, appointments: s.appointments.map(cleanAppt).filter(Boolean) };
    });
  }

  function localDay(d) {
    return d.getFullYear() + '-' + (d.getMonth() < 9 ? '0' : '') + (d.getMonth() + 1) + '-' +
      (d.getDate() < 10 ? '0' : '') + d.getDate();
  }

  function fileName(now) { return 'mes-rendez-vous-' + localDay(now || new Date()) + '.json'; }

  return {
    serialize: serialize,
    parse: parse,
    merge: merge,
    addSnapshot: addSnapshot,
    readSnapshots: readSnapshots,
    fileName: fileName,
    clean: cleanAppt,
    MAX_SNAPSHOTS: MAX_SNAPSHOTS
  };
});
