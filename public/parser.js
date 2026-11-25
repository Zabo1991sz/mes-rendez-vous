/*
 * Analyse d'une phrase en français pour en extraire un rendez-vous.
 * Ex. : « J'ai un rendez-vous chez le psy le mardi 17 novembre à 10 heures »
 *   -> { date: '2026-11-17', time: '10:00', title: 'Rendez-vous chez le psy' }
 *
 * Fonctionne dans le navigateur (window.RdvParser) et dans Node (tests).
 * Écrit sans syntaxe récente pour rester compatible avec de vieilles tablettes.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RdvParser = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
  var MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  var DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  var DAYS_FR = DAYS;

  // ---------- Nombres écrits en lettres ----------
  var UNITS = ['zero', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze',
    'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
  var TENS = { 2: 'vingt', 3: 'trente', 4: 'quarante', 5: 'cinquante' };

  function numberToWords(n) {
    if (n < 20) return UNITS[n];
    var t = Math.floor(n / 10), u = n % 10, w = TENS[t];
    if (u === 0) return w;
    if (u === 1) return w + ' et un';
    return w + '-' + UNITS[u];
  }

  var WORD_VALUES = { une: 1, premier: 1, zero: 0 };
  for (var i = 1; i < 60; i++) WORD_VALUES[numberToWords(i).replace(/[- ]+/g, ' ')] = i;

  function wordsPattern(max) {
    var list = ['une'];
    for (var n = 1; n <= max; n++) list.push(numberToWords(n));
    list.sort(function (a, b) { return b.length - a.length; });
    return list.map(function (w) { return w.replace(/[- ]/g, '[- ]'); }).join('|');
  }

  function parseNum(s) {
    s = s.replace(/\s*(er|ere)$/, '');
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    var v = WORD_VALUES[s.replace(/[- ]+/g, ' ')];
    return typeof v === 'number' ? v : NaN;
  }

  // ---------- Expressions régulières (sur texte normalisé : minuscules, sans accents) ----------
  var WD = DAYS.join('|');
  var MO = MONTHS.join('|');
  var DAY_NUM = '(\\d{1,2}|premier|' + wordsPattern(31) + ')(?:\\s*(?:er|ere))?(?![a-z0-9])';
  var HOUR_NUM = '(\\d{1,2}(?!\\d)|(?:' + wordsPattern(23) + ')(?![a-z]))';
  var MIN_NUM = '(\\d{1,2}(?!\\d)|(?:' + wordsPattern(59) + ')(?![a-z]))';

  var RE_PERIOD = /(?:\b(du|de\s+l'?|dans\s+l'?|le|ce|cet|en)\s*)?\b(matin|soir|apres[- ]?midi|aprem)\b/;
  var RE_FULL = new RegExp('(?:\\b(?:pour\\s+)?(?:le|ce)\\s+)?(?:\\b(' + WD + ')\\s+)?(?:\\ble\\s+)?\\b' + DAY_NUM +
    '\\s+(' + MO + ')(?:\\s+(\\d{4}))?\\b');
  var RE_NUMERIC = /(?:\b(?:pour\s+)?le\s+)?\b(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?(?!\d)/;
  // Périodes : « du 1er septembre au 20 septembre », « du 1er au 20 septembre », « du 1/9 au 20/9 »
  var RANGE_SEP = "\\s+(?:au|jusqu'?\\s?au)\\s+";
  var RE_RANGE = new RegExp('\\b(?:du|depuis\\s+le)\\s+(?:(' + WD + ')\\s+)?' + DAY_NUM + '(?:\\s+(' + MO + '))?(?:\\s+(\\d{4}))?' +
    RANGE_SEP + '(?:le\\s+)?(?:(' + WD + ')\\s+)?' + DAY_NUM + '\\s+(' + MO + ')(?:\\s+(\\d{4}))?\\b');
  var RE_RANGE_NUM = new RegExp('\\b(?:du|depuis\\s+le)\\s+(\\d{1,2})[\\/.](\\d{1,2})(?:[\\/.](\\d{2,4}))?' +
    RANGE_SEP + '(?:le\\s+)?(\\d{1,2})[\\/.](\\d{1,2})(?:[\\/.](\\d{2,4}))?(?!\\d)');
  var RE_REL = /\b(?:pour\s+)?(apres[- ]?demain|demain|aujourd'?\s?hui)\b/;
  var RE_IN = new RegExp('\\bdans\\s+(\\d{1,2}|' + wordsPattern(31) + ')\\s+(jours?|semaines?)\\b');
  var RE_WEEKDAY = new RegExp('(?:\\b(?:pour\\s+)?(?:le|ce)\\s+)?\\b(' + WD + ')\\b(?:\\s+(prochain|qui vient))?');
  var RE_MIDI = /(?:\b(?:a|vers|pour|des)\s+)?\b(midi|minuit)(?:\s+et\s+(demie?|quart)|\s+(\d{1,2})(?!\d))?\b/;
  var RE_TIME = new RegExp('(?:\\b(?:a|vers|pour|des)\\s+)?\\b' + HOUR_NUM +
    '\\s*(?:heures?|h(?![a-z])|:)\\s*(?:et\\s+(demie?|quart)\\b|moins\\s+(?:le\\s+)?(quart|\\d{1,2}|' + wordsPattern(59) + ')\\b|' + MIN_NUM + ')?');
  var RE_START = /^\s*(?:(?:alors|bon|bonjour|euh|donc|oui|ok|voila)[\s,]+)*(?:il y a|j'?\s?ai|je dois aller|je vais|je dois|note|notez|noter|ajoute|ajouter|enregistre|enregistrer)\b/;

  var LEADING_FILLERS = ['un', 'une', 'mon', 'ma', 'le', 'la', 'nouveau', 'nouvel', 'rendez-vous', 'rendez', 'vous',
    'rdv', 'rendezvous', 'pour', 'de', "d'", 'des', 'et'];
  var TRAILING_FILLERS = ['le', 'la', 'les', 'a', 'au', 'aux', 'de', 'du', 'des', 'pour', 'et', 'ce', 'cet', 'cette',
    'vers', 'dans', 'prochain', 'prochaine', 'merci', 'stp', 'svp', "s'il", 'te', 'vous', 'plait', 'qui', 'vient', 'en'];
  var TITLE_STARTERS = ['chez', 'avec', 'au', 'aux', 'a', 'du', 'des'];

  // ---------- Outils ----------
  function normalize(text) {
    var out = '';
    for (var k = 0; k < text.length; k++) {
      var c = text.charAt(k);
      if (c === '’' || c === '`' || c === '´') { out += "'"; continue; }
      var n = c.toLowerCase().normalize('NFD').charAt(0);
      out += n || ' ';
    }
    return out;
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function toIso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function fromIso(iso) { var p = iso.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  // Texte de travail : on « efface » (remplace par des espaces) chaque morceau reconnu,
  // en gardant la même longueur pour que le texte original et le texte normalisé restent alignés.
  function Work(text) { this.orig = text; this.norm = normalize(text); }
  Work.prototype.take = function (re) {
    var m = re.exec(this.norm);
    if (!m) return null;
    var s = m.index, e = s + m[0].length;
    var blank = new Array(e - s + 1).join(' ');
    this.norm = this.norm.slice(0, s) + blank + this.norm.slice(e);
    this.orig = this.orig.slice(0, s) + blank + this.orig.slice(e);
    return m;
  };

  // ---------- Analyse principale ----------
  // opts.defaultDate ('AAAA-MM-JJ') : date utilisée si la phrase n'en contient pas
  // (ajout depuis un jour choisi dans le calendrier).
  function parse(text, now, opts) {
    now = now || new Date();
    opts = opts || {};
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var w = new Work(String(text || ''));
    var warnings = [];
    var date = null, time = null, period = null;

    // Moment de la journée (« de l'après-midi », « du soir », « ce matin »…)
    var pm = w.take(RE_PERIOD);
    if (pm) {
      period = pm[2].indexOf('apres') === 0 || pm[2] === 'aprem' ? 'apresmidi' : pm[2];
      if (pm[1] === 'ce' || pm[1] === 'cet') date = new Date(today);
    }

    // Période (début et fin) — elle a priorité sur une date seule
    var endDate = null;
    function setRange(d1, m1, y1, d2, m2, y2) {
      if (y1 !== null && y1 < 100) y1 += 2000;
      if (y2 !== null && y2 < 100) y2 += 2000;
      var ey = y2 === null ? today.getFullYear() : y2;
      var end = new Date(ey, m2, d2);
      if (isNaN(d2) || m2 < 0 || m2 > 11 || end.getMonth() !== m2 || end.getDate() !== d2) {
        warnings.push("La date de fin n'existe pas. Merci de la corriger.");
        return;
      }
      if (y2 === null && end < today) { ey += 1; end = new Date(ey, m2, d2); }
      var sy = y1 === null ? ey : y1;
      var start = new Date(sy, m1, d1);
      if (isNaN(d1) || m1 < 0 || m1 > 11 || start.getMonth() !== m1 || start.getDate() !== d1) {
        warnings.push("La date de début n'existe pas. Merci de la corriger.");
        return;
      }
      if (y1 === null && start > end) start = new Date(sy - 1, m1, d1); // « du 28 décembre au 3 janvier »
      if (start > end) warnings.push('La date de fin est avant la date de début. Vérifiez les dates.');
      date = start;
      endDate = end;
    }

    // Date
    var m;
    if ((m = w.take(RE_RANGE))) {
      var mEnd = MONTHS.indexOf(m[7]);
      setRange(parseNum(m[2]), m[3] ? MONTHS.indexOf(m[3]) : mEnd, m[4] ? parseInt(m[4], 10) : null,
        parseNum(m[6]), mEnd, m[8] ? parseInt(m[8], 10) : null);
    } else if ((m = w.take(RE_RANGE_NUM))) {
      setRange(parseInt(m[1], 10), parseInt(m[2], 10) - 1, m[3] ? parseInt(m[3], 10) : null,
        parseInt(m[4], 10), parseInt(m[5], 10) - 1, m[6] ? parseInt(m[6], 10) : null);
    } else if ((m = w.take(RE_FULL))) {
      var day = parseNum(m[2]), month = MONTHS.indexOf(m[3]);
      var year = m[4] ? parseInt(m[4], 10) : today.getFullYear();
      var d = new Date(year, month, day);
      if (isNaN(day) || d.getMonth() !== month) {
        warnings.push('Le ' + m[2] + ' ' + MONTHS_FR[month] + " n'existe pas. Merci de corriger la date.");
      } else {
        if (!m[4] && d < today) d = new Date(year + 1, month, day);
        date = d;
        if (m[1] && d.getDay() !== DAYS.indexOf(m[1])) {
          warnings.push('Attention : le ' + formatDate(toIso(d), { year: true, weekday: false }) + ' est un ' +
            DAYS_FR[d.getDay()] + ', pas un ' + m[1] + '. Vérifiez la date.');
        }
      }
    } else if ((m = w.take(RE_NUMERIC))) {
      var dd = parseInt(m[1], 10), mm = parseInt(m[2], 10) - 1;
      var yy = m[3] ? parseInt(m[3], 10) : today.getFullYear();
      if (yy < 100) yy += 2000;
      var dn = new Date(yy, mm, dd);
      if (mm < 0 || mm > 11 || dn.getMonth() !== mm || dn.getDate() !== dd) {
        warnings.push("La date « " + m[1] + '/' + m[2] + " » n'est pas valide. Merci de la corriger.");
      } else {
        if (!m[3] && dn < today) dn = new Date(yy + 1, mm, dd);
        date = dn;
      }
    } else if ((m = w.take(RE_REL))) {
      var offset = m[1].indexOf('apres') === 0 ? 2 : m[1] === 'demain' ? 1 : 0;
      date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
    } else if ((m = w.take(RE_IN))) {
      var n = parseNum(m[1]);
      if (!isNaN(n)) {
        var days = m[2].indexOf('semaine') === 0 ? n * 7 : n;
        date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
      }
    } else if ((m = w.take(RE_WEEKDAY))) {
      var wd = DAYS.indexOf(m[1]);
      var delta = (wd - today.getDay() + 7) % 7;
      if (delta === 0) delta = 7; // « mardi » dit un mardi = mardi prochain
      date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + delta);
    }

    // Heure
    var h = null, min = 0;
    if ((m = w.take(RE_MIDI))) {
      h = m[1] === 'midi' ? 12 : 0;
      if (m[2]) min = m[2] === 'quart' ? 15 : 30;
      else if (m[3]) min = parseInt(m[3], 10);
    } else if ((m = w.take(RE_TIME))) {
      h = parseNum(m[1]);
      if (m[2]) min = m[2] === 'quart' ? 15 : 30;
      else if (m[3]) {
        var minus = m[3] === 'quart' ? 15 : parseNum(m[3]);
        h = h - 1; min = 60 - minus;
      } else if (m[4]) min = parseNum(m[4]);
      if (!isNaN(h)) {
        if ((period === 'soir' || period === 'apresmidi') && h < 12) h += 12;
        else if (!period && h >= 1 && h <= 6) h += 12; // « 3 heures » pour un rendez-vous = 15 h
        if (h < 0) h += 24;
      }
    }
    if (h !== null && !isNaN(h) && !isNaN(min) && h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      time = pad(h) + ':' + pad(min);
    }

    // Motif : ce qui reste, débarrassé des formules d'introduction
    w.take(RE_START);
    var motif = extractMotif(w.orig, w.norm);
    var title = buildTitle(motif);

    if (!date && opts.defaultDate && !warnings.length) date = fromIso(opts.defaultDate);
    if (!date) warnings.unshift("Je n'ai pas compris la date. Merci de la choisir.");

    return {
      date: date ? toIso(date) : null,
      // fin d'une période (vacances…) ; null pour un rendez-vous d'un seul jour
      endDate: date && endDate && endDate > date ? toIso(endDate) : null,
      time: time,
      motif: motif,
      title: title,
      warnings: warnings
    };
  }

  function extractMotif(orig, norm) {
    var tokens = [], re = /\S+/g, m;
    while ((m = re.exec(norm))) {
      var n = m[0].replace(/^[.,;:!?«»"()]+|[.,;:!?«»"()]+$/g, '');
      var o = orig.substr(m.index, m[0].length).replace(/^[.,;:!?«»"()]+|[.,;:!?«»"()]+$/g, '');
      if (n) tokens.push({ n: n, o: o });
    }
    while (tokens.length && LEADING_FILLERS.indexOf(tokens[0].n) !== -1) tokens.shift();
    while (tokens.length && TRAILING_FILLERS.indexOf(tokens[tokens.length - 1].n) !== -1) tokens.pop();
    return tokens.map(function (t) { return t.o; }).join(' ');
  }

  function buildTitle(motif) {
    if (!motif) return 'Rendez-vous';
    var first = normalize(motif.split(/[\s']/)[0]);
    if (TITLE_STARTERS.indexOf(first) !== -1) return 'Rendez-vous ' + motif;
    return cap(motif);
  }

  // ---------- Affichage ----------
  function formatDate(iso, opts) {
    opts = opts || {};
    var d = fromIso(iso);
    var s = (opts.weekday === false ? '' : DAYS_FR[d.getDay()] + ' ') +
      (d.getDate() === 1 ? '1er' : d.getDate()) + ' ' + MONTHS_FR[d.getMonth()];
    var thisYear = (opts.now || new Date()).getFullYear();
    if (opts.year || d.getFullYear() !== thisYear) s += ' ' + d.getFullYear();
    return opts.weekday === false ? s : cap(s);
  }

  // « Du mardi 1er septembre au dimanche 20 septembre »
  function formatRange(start, end, opts) {
    function lower(s) { return s.charAt(0).toLowerCase() + s.slice(1); }
    return 'Du ' + lower(formatDate(start, opts)) + ' au ' + lower(formatDate(end, opts));
  }

  function formatTime(t) {
    if (!t) return '';
    var p = t.split(':'), h = +p[0], mi = +p[1];
    return h + ' h' + (mi ? ' ' + pad(mi) : '');
  }

  function spokenTime(t) {
    if (!t) return '';
    var p = t.split(':'), h = +p[0], mi = +p[1];
    var s = h === 12 && !mi ? 'midi' : h === 0 && !mi ? 'minuit' : h + (h <= 1 ? ' heure' : ' heures');
    return s + (mi ? ' ' + mi : '');
  }

  return {
    parse: parse,
    formatDate: formatDate,
    formatRange: formatRange,
    formatTime: formatTime,
    spokenTime: spokenTime,
    toIso: toIso,
    fromIso: fromIso,
    normalize: normalize
  };
});
