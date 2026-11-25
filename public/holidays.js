/*
 * Jours fériés officiels du canton de Vaud (Suisse), calculés pour n'importe quelle année.
 *   Nouvel An (1er janvier), 2 janvier, Vendredi saint, lundi de Pâques, Ascension,
 *   lundi de Pentecôte, Fête nationale (1er août), lundi du Jeûne fédéral, Noël (25 décembre).
 *
 * Fonctionne dans le navigateur (window.RdvHolidays) et dans Node (tests).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RdvHolidays = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function plus(d, days) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days); }

  // Dimanche de Pâques (calendrier grégorien, algorithme de Meeus/Jones/Butcher)
  function easter(year) {
    var a = year % 19, b = Math.floor(year / 100), c = year % 100;
    var d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    var g = Math.floor((b - f + 1) / 3);
    var h = (19 * a + b - d - g + 15) % 30;
    var i = Math.floor(c / 4), k = c % 4;
    var l = (32 + 2 * e + 2 * i - h - k) % 7;
    var m = Math.floor((a + 11 * h + 22 * l) / 451);
    var month = Math.floor((h + l - 7 * m + 114) / 31);
    var day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
  }

  // Lundi du Jeûne fédéral : lendemain du 3e dimanche de septembre
  function jeune(year) {
    var first = new Date(year, 8, 1);
    var firstSunday = 1 + (7 - first.getDay()) % 7;
    return new Date(year, 8, firstSunday + 14 + 1);
  }

  var cache = {};

  // { 'AAAA-MM-JJ': 'Nom du jour férié', … } pour une année
  function forYear(year) {
    if (cache[year]) return cache[year];
    var p = easter(year);
    var list = {};
    list[year + '-01-01'] = 'Nouvel An';
    list[year + '-01-02'] = '2 janvier';
    list[iso(plus(p, -2))] = 'Vendredi saint';
    list[iso(plus(p, 1))] = 'Lundi de Pâques';
    list[iso(plus(p, 39))] = 'Ascension';
    list[iso(plus(p, 50))] = 'Lundi de Pentecôte';
    list[year + '-08-01'] = 'Fête nationale';
    list[iso(jeune(year))] = 'Lundi du Jeûne fédéral';
    list[year + '-12-25'] = 'Noël';
    cache[year] = list;
    return list;
  }

  // Nom du jour férié pour une date 'AAAA-MM-JJ', ou null
  function nameOf(dateIso) {
    if (!dateIso) return null;
    var year = parseInt(dateIso.slice(0, 4), 10);
    return forYear(year)[dateIso] || null;
  }

  return { forYear: forYear, nameOf: nameOf, easter: easter };
});
