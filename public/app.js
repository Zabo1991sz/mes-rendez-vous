/*
 * Mes rendez-vous — application tablette.
 * Les rendez-vous sont enregistrés sur l'appareil (localStorage), avec des copies de sécurité (backup.js).
 */
(function () {
  'use strict';

  // ---------- Réglages ----------
  var CONFIG = {
    name: 'Marianna',            // prénom affiché sur l'écran de veille ('' pour aucun)
    lockAfterMs: 2 * 60 * 1000,  // retour à l'écran de veille après 2 minutes sans toucher
    speakBack: true              // relire le rendez-vous à voix haute avant validation
  };
  var STORAGE_KEY = 'mes-rendez-vous-v1';
  var SNAPSHOTS_KEY = 'mes-rendez-vous-copies';        // copies de sécurité automatiques
  var LAST_FILE_KEY = 'mes-rendez-vous-dernier-fichier'; // date du dernier fichier de sauvegarde

  var P = window.RdvParser;
  var B = window.RdvBackup;
  var Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  function $(id) { return document.getElementById(id); }

  // ---------- Données ----------
  function load() {
    try {
      var arr = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  // Enregistre les rendez-vous. Avant la première modification du jour, garde une copie de l'état
  // précédent (forceCopy : garder une copie quoi qu'il arrive, par ex. avant une récupération).
  function persist(forceCopy) {
    try {
      var copies = B.addSnapshot(readSnapshots(), load(), new Date(), forceCopy);
      localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(copies));
    } catch (e) { /* la copie de sécurité ne doit jamais empêcher l'enregistrement */ }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(appts)); return true; } catch (e) { return false; }
  }
  function readSnapshots() {
    try { return B.readSnapshots(localStorage.getItem(SNAPSHOTS_KEY)); } catch (e) { return []; }
  }
  var appts = load();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function todayIso() { return P.toIso(new Date()); }
  function nowHHMM() { var d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function addDays(iso, n) { var d = P.fromIso(iso); d.setDate(d.getDate() + n); return P.toIso(d); }
  function diffDays(a, b) {
    var pa = a.split('-'), pb = b.split('-');
    return Math.round((Date.UTC(+pb[0], +pb[1] - 1, +pb[2]) - Date.UTC(+pa[0], +pa[1] - 1, +pa[2])) / 86400000);
  }
  function compare(a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    var ta = a.time || '99:99', tb = b.time || '99:99';
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  }
  function upcoming() {
    var t = todayIso();
    return appts.filter(function (a) { return a.date >= t; }).sort(compare);
  }
  function purgeOld() {
    var limit = addDays(todayIso(), -30), n = appts.length;
    appts = appts.filter(function (a) { return a.date >= limit; });
    if (appts.length !== n) persist();
  }
  function isPast(a) { return a.date === todayIso() && a.time && a.time < nowHHMM(); }

  function relLabel(iso) {
    var t = todayIso();
    if (iso === t) return "Aujourd'hui";
    var n = diffDays(t, iso);
    if (n === 1) return 'Demain';
    if (n === 2) return 'Après-demain';
    return 'Dans ' + n + ' jours';
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- Voix de l'appareil ----------
  function speak(text) {
    if (!CONFIG.speakBack || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'fr-FR';
      u.rate = 0.9;
      window.speechSynthesis.speak(u);
    } catch (e) { /* pas de synthèse vocale : tant pis */ }
  }
  function stopSpeaking() { try { window.speechSynthesis.cancel(); } catch (e) {} }

  // ---------- Écran de veille ----------
  function renderLock() {
    var now = new Date();
    var h = now.getHours();
    var hello = h >= 18 || h < 5 ? 'Bonsoir' : 'Bonjour';
    $('lockGreeting').textContent = hello + (CONFIG.name ? ' ' + CONFIG.name : '');
    $('lockTime').textContent = pad(h) + ':' + pad(now.getMinutes());
    $('lockDate').textContent = P.formatDate(P.toIso(now));

    var next = upcoming().filter(function (a) { return !isPast(a); })[0];
    var box = $('lockNext');
    if (next) {
      box.innerHTML = 'Prochain rendez-vous :<strong>' + esc(relLabel(next.date)) +
        (next.time ? ' à ' + esc(P.formatTime(next.time)) : '') + ' — ' + esc(next.title) + '</strong>';
      box.classList.remove('hidden');
    } else {
      box.classList.add('hidden');
    }
  }

  function showLock() {
    closeAllOverlays();
    renderLock();
    $('main').classList.add('hidden');
    $('lock').classList.remove('hidden');
    window.scrollTo(0, 0);
  }

  function unlock() {
    $('lock').classList.add('hidden');
    $('main').classList.remove('hidden');
    renderList();
    window.scrollTo(0, 0);
    requestWakeLock();
    resetIdle();
  }

  // ---------- Liste ----------
  function renderList() {
    var t = todayIso();
    $('todayLabel').textContent = 'Nous sommes ' + P.formatDate(t).replace(/^./, function (c) { return c.toLowerCase(); });
    var list = upcoming();
    var el = $('list');

    if (!list.length) {
      el.innerHTML = '<div class="empty"><span class="big">📅</span>Aucun rendez-vous à venir.<br>' +
        'Touchez le bouton vert <strong>+</strong> pour en ajouter un.</div>';
      return;
    }

    var html = '', nextDone = false, laterShown = false;
    list.forEach(function (a) {
      var past = isPast(a);
      var isNext = false;
      if (!past && !nextDone) {
        isNext = true;
        html += '<div class="next-label">Prochain rendez-vous</div>';
        nextDone = true;
      } else if (!past && !laterShown) {
        html += '<div class="next-label later-label">Ensuite</div>';
        laterShown = true;
      }
      html += cardHtml(a, isNext);
    });
    el.innerHTML = html;
  }

  // Carte d'un rendez-vous (liste et vue « jour »)
  function cardHtml(a, isNext) {
    var t = todayIso();
    var dayPast = a.date < t;
    var past = dayPast || isPast(a);
    var rel = dayPast ? 'Passé' : relLabel(a.date);
    var cls = 'card' + (isNext ? ' is-next' : '');
    var badgeCls = 'badge';
    if (past) { cls += ' is-past'; badgeCls += ' past'; if (!dayPast) rel = "Aujourd'hui — déjà passé"; }
    else if (a.date === t) { cls += ' is-today'; badgeCls += ' today'; }
    else if (a.date === addDays(t, 1)) { cls += ' is-tomorrow'; badgeCls += ' tomorrow'; }

    return '<article class="' + cls + '" data-rdv="' + esc(a.id) + '">' +
      '<div class="' + badgeCls + '">' + esc(rel) + '</div>' +
      '<div class="card-date">' + esc(P.formatDate(a.date)) + '</div>' +
      (a.time
        ? '<div class="card-time">🕙 ' + esc(P.formatTime(a.time)) + '</div>'
        : '<div class="card-time muted">Heure non précisée</div>') +
      '<div class="card-title">' + esc(a.title) + '</div>' +
      '<div class="card-actions">' +
      (a.note
        ? '<button class="btn-note has-note" type="button" data-note="' + esc(a.id) + '">📝 Voir la note</button>'
        : '<button class="btn-note" type="button" data-note="' + esc(a.id) + '">＋ Ajouter une note</button>') +
      '<button class="btn-del" type="button" data-id="' + esc(a.id) + '">🗑 Supprimer</button>' +
      '</div>' +
      '</article>';
  }

  function flashCard(containerId, id) {
    var card = $(containerId).querySelector('[data-rdv="' + id + '"]');
    if (!card) return;
    card.classList.add('flash');
    if (card.scrollIntoView) card.scrollIntoView({ block: 'center' });
  }

  function isOpen(id) { return !$(id).classList.contains('hidden'); }

  function refreshViews() {
    renderList();
    if (isOpen('calendar')) renderCalendar();
    if (isOpen('day')) renderDay();
  }

  document.addEventListener('click', function (e) {
    var noteBtn = e.target.closest ? e.target.closest('.btn-note') : null;
    if (noteBtn) { openNote(noteBtn.getAttribute('data-note')); return; }
    var btn = e.target.closest ? e.target.closest('.btn-del') : null;
    if (!btn) return;
    var id = btn.getAttribute('data-id');
    var a = appts.filter(function (x) { return x.id === id; })[0];
    if (!a) return;
    askConfirm('Supprimer ce rendez-vous ?',
      a.title + '<br>' + P.formatDate(a.date) + (a.time ? ' à ' + P.formatTime(a.time) : ''),
      function () {
        appts = appts.filter(function (x) { return x.id !== id; });
        persist();
        refreshViews();
        toast('Rendez-vous supprimé');
      });
  });

  // ---------- Calendrier ----------
  var MONTHS_FR = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre',
    'Octobre', 'Novembre', 'Décembre'];
  var cal = { year: 0, month: 0 };
  var dayIso = null;

  function openCalendar() {
    var now = new Date();
    cal.year = now.getFullYear();
    cal.month = now.getMonth();
    renderCalendar();
    showOverlay('calendar');
  }

  function moveMonth(delta) {
    var d = new Date(cal.year, cal.month + delta, 1);
    cal.year = d.getFullYear();
    cal.month = d.getMonth();
    renderCalendar();
  }

  function renderCalendar() {
    var now = new Date();
    var t = todayIso();
    var isCurrent = cal.year === now.getFullYear() && cal.month === now.getMonth();
    $('calTitle').textContent = MONTHS_FR[cal.month] + ' ' + cal.year;
    $('calToday').classList.toggle('hidden', isCurrent);

    var counts = {};
    appts.forEach(function (a) { counts[a.date] = (counts[a.date] || 0) + 1; });

    var offset = (new Date(cal.year, cal.month, 1).getDay() + 6) % 7; // semaine commençant le lundi
    var nbDays = new Date(cal.year, cal.month + 1, 0).getDate();
    var html = '';
    for (var i = 0; i < offset; i++) html += '<div class="cal-day empty"></div>';
    for (var d = 1; d <= nbDays; d++) {
      var iso = cal.year + '-' + pad(cal.month + 1) + '-' + pad(d);
      var n = counts[iso] || 0;
      var cls = 'cal-day';
      if (iso < t) cls += ' is-past';
      if (iso === t) cls += ' is-today';
      if (n) cls += ' has-rdv';
      html += '<button type="button" class="' + cls + '" data-date="' + iso + '">' + d +
        (n ? '<span class="cal-count">' + n + ' rdv</span>' : '') + '</button>';
    }
    $('calGrid').innerHTML = html;
  }

  $('calGrid').addEventListener('click', function (e) {
    var cell = e.target.closest ? e.target.closest('.cal-day') : null;
    if (!cell || !cell.getAttribute('data-date')) return;
    openDay(cell.getAttribute('data-date'));
  });
  $('calPrev').addEventListener('click', function () { moveMonth(-1); });
  $('calNext').addEventListener('click', function () { moveMonth(1); });
  $('calToday').addEventListener('click', function () {
    var now = new Date();
    cal.year = now.getFullYear(); cal.month = now.getMonth();
    renderCalendar();
  });
  $('calClose').addEventListener('click', function () { hideOverlay('calendar'); renderList(); });
  $('calBtn').addEventListener('click', openCalendar);

  // ---------- Vue d'un jour ----------
  function openDay(iso) {
    dayIso = iso;
    renderDay();
    showOverlay('day');
  }

  function renderDay() {
    if (!dayIso) return;
    var t = todayIso();
    var rel = dayIso === t ? "Aujourd'hui — " : dayIso === addDays(t, 1) ? 'Demain — ' : '';
    $('dayTitle').textContent = rel + P.formatDate(dayIso);
    var list = appts.filter(function (a) { return a.date === dayIso; }).sort(compare);
    $('dayList').innerHTML = list.length
      ? list.map(function (a) { return cardHtml(a, false); }).join('')
      : '<div class="day-empty">Aucun rendez-vous ce jour-là.</div>';
    $('dayAdd').classList.toggle('hidden', dayIso < t);
  }

  $('dayAdd').addEventListener('click', function () { openVoice(dayIso); });
  $('dayBack').addEventListener('click', function () { hideOverlay('day'); renderCalendar(); });

  // ---------- Fenêtres ----------
  // Ordre = ordre d'empilement. Les fenêtres « bloquantes » empêchent la mise en veille (saisie en cours).
  var OVERLAYS = ['calendar', 'day', 'backup', 'note', 'voice', 'verify', 'confirm'];
  var BLOCKING = ['backup', 'note', 'voice', 'verify', 'confirm'];
  function showOverlay(id) { $(id).classList.remove('hidden'); $(id).scrollTop = 0; }
  function hideOverlay(id) { $(id).classList.add('hidden'); }
  function isOverlayOpen() { return BLOCKING.some(isOpen); }
  function closeAllOverlays() {
    cancelListening();
    stopSpeaking();
    OVERLAYS.forEach(hideOverlay);
  }

  var confirmYes = null, confirmNo = null;
  // opts : { yes: 'libellé', no: 'libellé', danger: true/false, onNo: fonction }
  function askConfirm(text, detailHtml, onYes, opts) {
    opts = opts || {};
    $('confirmText').textContent = text;
    $('confirmDetail').innerHTML = esc(detailHtml).replace(/&lt;br&gt;/g, '<br>');
    $('confirmYes').textContent = opts.yes || 'Oui, supprimer';
    $('confirmYes').className = 'btn ' + (opts.danger === false ? 'btn-yes' : 'btn-danger');
    $('confirmNo').textContent = opts.no || 'Non';
    confirmYes = onYes;
    confirmNo = opts.onNo || null;
    showOverlay('confirm');
  }
  $('confirmYes').addEventListener('click', function () {
    hideOverlay('confirm');
    var fn = confirmYes; confirmYes = confirmNo = null;
    if (fn) fn();
  });
  $('confirmNo').addEventListener('click', function () {
    hideOverlay('confirm');
    var fn = confirmNo; confirmYes = confirmNo = null;
    if (fn) fn();
  });

  // ---------- Notes d'un rendez-vous ----------
  var noteId = null, noteOriginal = '';

  function findAppt(id) { return appts.filter(function (x) { return x.id === id; })[0]; }
  function setNoteStatus(t) { $('noteStatus').textContent = t; }

  function openNote(id) {
    var a = findAppt(id);
    if (!a) return;
    noteId = id;
    noteOriginal = a.note || '';
    $('noteFor').textContent = a.title + ' — ' + P.formatDate(a.date) + (a.time ? ' à ' + P.formatTime(a.time) : '');
    $('noteText').value = noteOriginal;
    $('noteDelete').classList.toggle('hidden', !noteOriginal);
    $('noteTitle').textContent = noteOriginal ? 'Note' : 'Ajouter une note';
    showOverlay('note');
    if (!Rec) setNoteStatus('Écrivez la note ci-dessous.');
    else if (noteOriginal) setNoteStatus('Touchez le micro pour ajouter du texte à la note.');
    else startNoteListening(); // nouvelle note : on écoute tout de suite
  }

  function startNoteListening() {
    var before = $('noteText').value.replace(/\s+$/, '');
    setNoteStatus('Un instant…');
    listen({
      onStart: function () {
        $('noteMic').classList.add('listening');
        setNoteStatus('Je vous écoute… Dites votre note.');
      },
      onText: function (t) { $('noteText').value = (before ? before + '\n' : '') + t; },
      onDone: function (t) {
        $('noteMic').classList.remove('listening');
        var txt = t.charAt(0).toUpperCase() + t.slice(1);
        $('noteText').value = (before ? before + '\n' : '') + txt;
        setNoteStatus('Vérifiez la note, puis touchez « Enregistrer ».');
      },
      onError: function (code) {
        $('noteMic').classList.remove('listening');
        $('noteText').value = before;
        setNoteStatus(micError(code, 'la note'));
      }
    });
  }

  function closeNote() { stopListening(); noteId = null; hideOverlay('note'); }

  function saveNote() {
    var a = findAppt(noteId);
    if (!a) { closeNote(); return; }
    var txt = $('noteText').value.trim();
    if (txt) a.note = txt; else delete a.note;
    if (!persist()) { toast("Erreur : la note n'a pas pu être enregistrée"); return; }
    closeNote();
    refreshViews();
    toast(txt ? '✓ Note enregistrée' : 'Note effacée');
  }

  $('noteMic').addEventListener('click', function () {
    if (!Rec) { setNoteStatus(micError('unsupported')); return; }
    if (listening) { finishListening(); return; }
    startNoteListening();
  });
  $('noteText').addEventListener('input', function () { if (listening) stopListening(); });
  $('noteSave').addEventListener('click', saveNote);
  $('noteDelete').addEventListener('click', function () {
    stopListening();
    askConfirm('Effacer la note ?', $('noteFor').textContent, function () {
      $('noteText').value = '';
      saveNote();
    }, { yes: 'Oui, effacer' });
  });
  $('noteClose').addEventListener('click', function () {
    stopListening();
    var txt = $('noteText').value.trim();
    if (txt === noteOriginal.trim()) { closeNote(); return; }
    askConfirm('Enregistrer la note ?', 'La note a été modifiée.', saveNote,
      { yes: '✓ Oui, enregistrer', no: 'Non, ne pas garder', danger: false, onNo: closeNote });
  });

  // ---------- Sauvegarde ----------
  function plural(n, word) { return n + ' ' + word + (n > 1 ? 's' : ''); }

  function openBackup() { renderBackup(); showOverlay('backup'); }

  function renderBackup() {
    var last = null;
    try { last = localStorage.getItem(LAST_FILE_KEY); } catch (e) {}
    var lastDate = last ? new Date(last) : null;
    $('bkInfo').innerHTML = '<strong>' + plural(appts.length, 'rendez-vous') + '</strong> sur cette tablette.<br>' +
      (lastDate && !isNaN(lastDate)
        ? 'Dernière copie enregistrée : ' + esc(P.formatDate(P.toIso(lastDate)).replace(/^./, function (c) { return c.toLowerCase(); }))
        : 'Aucune copie enregistrée dans un fichier pour l’instant.');

    var copies = readSnapshots().reverse(); // la plus récente en premier
    $('bkSnaps').innerHTML = copies.length
      ? copies.map(function (s, i) {
        var at = new Date(s.at);
        var hhmm = isNaN(at) ? '' : ' à ' + P.formatTime(pad(at.getHours()) + ':' + pad(at.getMinutes()));
        return '<div class="snap"><div class="snap-text"><strong>' + esc(P.formatDate(s.day) + hhmm) + '</strong>' +
          '<span>' + esc(plural(s.appointments.length, 'rendez-vous')) + '</span></div>' +
          '<button class="btn-snap" type="button" data-snap="' + i + '">Récupérer</button></div>';
      }).join('')
      : '<div class="snap-empty">Pas encore de copie : elle se fera à la prochaine modification.</div>';
  }

  function saveBackupFile() {
    try {
      var blob = new Blob([B.serialize(appts)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = B.fileName();
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
      try { localStorage.setItem(LAST_FILE_KEY, new Date().toISOString()); } catch (e) {}
      renderBackup();
      toast('✓ Copie enregistrée dans « Téléchargements »');
    } catch (e) {
      toast("Erreur : la copie n'a pas pu être enregistrée");
    }
  }

  // Récupère des rendez-vous : ajoute seulement ceux qui manquent, n'efface jamais rien.
  function restoreFrom(list, fromText) {
    var n = B.merge(appts, list).added;
    if (!n) { toast('Rien à récupérer : tous ces rendez-vous sont déjà là'); return; }
    askConfirm('Récupérer ' + plural(n, 'rendez-vous') + ' ?',
      fromText + '<br>Les rendez-vous déjà sur la tablette sont gardés.',
      function () {
        var before = appts;
        var r = B.merge(appts, list);
        appts = r.appointments;
        if (!persist(true)) { appts = before; toast("Erreur : la récupération n'a pas pu être enregistrée"); return; }
        renderBackup();
        refreshViews();
        toast('✓ ' + plural(r.added, 'rendez-vous') + ' ' + (r.added > 1 ? 'récupérés' : 'récupéré'));
      }, { yes: '✓ Oui, récupérer', danger: false });
  }

  $('bkFile').addEventListener('change', function () {
    var file = this.files && this.files[0];
    this.value = ''; // pour pouvoir rechoisir le même fichier
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast("Ce fichier n'est pas une sauvegarde de Mes rendez-vous."); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try { data = B.parse(String(reader.result)); } catch (e) { toast(e.message); return; }
      var d = data.savedAt ? new Date(data.savedAt) : null;
      restoreFrom(data.appointments, d && !isNaN(d) ? 'Copie du ' + P.formatDate(P.toIso(d)) : 'Fichier : ' + file.name);
    };
    reader.onerror = function () { toast("Le fichier n'a pas pu être lu"); };
    reader.readAsText(file);
  });

  $('bkSnaps').addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.btn-snap') : null;
    if (!btn) return;
    var s = readSnapshots().reverse()[+btn.getAttribute('data-snap')];
    if (s) restoreFrom(s.appointments, 'Copie automatique du ' + P.formatDate(s.day));
  });
  $('bkSave').addEventListener('click', saveBackupFile);
  $('bkOpen').addEventListener('click', function () { $('bkFile').click(); });
  $('bkClose').addEventListener('click', function () { hideOverlay('backup'); });
  $('backupBtn').addEventListener('click', openBackup);

  var toastTimer = null;
  function toast(text) {
    var el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 3000);
  }

  // ---------- Reconnaissance vocale (commune aux rendez-vous et aux notes) ----------
  var rec = null, listening = false, recSession = 0;

  // h : { onStart(), onText(texte partiel), onDone(texte final), onError(code) }
  function listen(h) {
    stopListening();
    stopSpeaking();
    if (!Rec) { h.onError('unsupported'); return; }
    var session = ++recSession, heard = '', lastError = '';
    try { rec = new Rec(); } catch (e) { h.onError('unsupported'); return; }
    rec.lang = 'fr-FR';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.onstart = function () {
      if (session !== recSession) return;
      listening = true;
      h.onStart();
    };
    rec.onresult = function (e) {
      if (session !== recSession) return;
      var txt = '';
      for (var i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
      heard = txt;
      h.onText(txt);
    };
    rec.onerror = function (e) { lastError = e.error || ''; };
    rec.onend = function () {
      if (session !== recSession) return; // écoute annulée entre-temps
      listening = false;
      rec = null;
      var t = heard.trim();
      if (t) h.onDone(t);
      else h.onError(lastError || 'no-speech');
    };
    try { rec.start(); } catch (e) { h.onError('start'); }
  }

  // Arrête l'écoute et ignore ce qui a été entendu
  function stopListening() {
    recSession++;
    if (rec) { try { rec.abort(); } catch (e) {} rec = null; }
    listening = false;
    var mics = document.querySelectorAll('.mic');
    for (var i = 0; i < mics.length; i++) mics[i].classList.remove('listening');
  }

  // Termine l'écoute en gardant ce qui a été entendu
  function finishListening() { if (rec) { try { rec.stop(); } catch (e) {} } }

  function micError(code, what) {
    if (code === 'not-allowed' || code === 'service-not-allowed') {
      return "Le micro n'est pas autorisé. Autorisez le micro pour cette application, ou écrivez " + what + '.';
    }
    if (code === 'network') return 'Pas de connexion Internet : la dictée ne marche pas. Vous pouvez écrire ' + what + '.';
    if (code === 'unsupported') return "La dictée vocale n'est pas disponible sur cet appareil.";
    if (code === 'start') return 'Touchez le micro pour parler.';
    return "Je n'ai rien entendu. Touchez le micro et parlez.";
  }

  // ---------- Dictée d'un rendez-vous ----------
  function setStatus(t) { $('voiceStatus').textContent = t; }
  function setMic(on) { $('micBtn').classList.toggle('listening', on); }
  function cancelListening() { stopListening(); }

  var voiceDate = null; // date imposée quand on ajoute depuis un jour du calendrier

  function openVoice(defaultDate) {
    stopSpeaking();
    voiceDate = typeof defaultDate === 'string' ? defaultDate : null;
    if (voiceDate) {
      $('voiceFor').textContent = 'Pour le ' + P.formatDate(voiceDate);
      $('voiceFor').classList.remove('hidden');
      $('voiceExample').textContent = '« Psy à 10 heures »';
    } else {
      $('voiceFor').classList.add('hidden');
      $('voiceExample').textContent = '« Rendez-vous chez le psy mardi 17 novembre à 10 heures »';
    }
    $('transcript').textContent = '';
    $('textInput').value = '';
    $('textForm').classList.add('hidden');
    $('typeBtn').classList.remove('hidden');
    showOverlay('voice');
    if (!Rec) {
      setStatus("La dictée vocale n'est pas disponible sur cet appareil.");
      showTextMode();
      return;
    }
    startListening();
  }

  function startListening() {
    $('transcript').textContent = '';
    setStatus('Un instant…');
    listen({
      onStart: function () { setMic(true); setStatus('Je vous écoute… Parlez maintenant.'); },
      onText: function (t) { $('transcript').textContent = '« ' + t + ' »'; },
      onDone: function (t) { setMic(false); openVerify(t); },
      onError: function (code) {
        setMic(false);
        setStatus(micError(code, 'le rendez-vous'));
        if (code === 'unsupported') showTextMode();
      }
    });
  }

  function showTextMode() {
    cancelListening();
    $('textForm').classList.remove('hidden');
    $('typeBtn').classList.add('hidden');
    setTimeout(function () { $('textInput').focus(); }, 50);
  }

  $('micBtn').addEventListener('click', function () {
    if (!Rec) return;
    if (listening) { finishListening(); return; }
    startListening();
  });
  $('typeBtn').addEventListener('click', showTextMode);
  $('voiceCancel').addEventListener('click', function () { cancelListening(); hideOverlay('voice'); });
  $('textOk').addEventListener('click', function () {
    var t = $('textInput').value.trim();
    if (!t) { $('textInput').focus(); return; }
    openVerify(t);
  });
  $('textInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('textOk').click(); }
  });

  // ---------- Vérification ----------
  var pending = null;

  function openVerify(text) {
    cancelListening();
    var r = P.parse(text, new Date(), { defaultDate: voiceDate });
    pending = { date: r.date, time: r.time, title: r.title, transcript: text, warnings: r.warnings };
    hideOverlay('voice');
    showOverlay('verify');
    toggleEdit(!r.date);
    renderVerify();
    if (r.date) {
      speak(pending.title + ', ' + P.formatDate(r.date) +
        (r.time ? ', à ' + P.spokenTime(r.time) : '') + '. Est-ce correct ?');
    } else {
      speak("Je n'ai pas compris la date. Merci de la choisir.");
    }
  }

  function renderVerify() {
    var p = pending;
    $('vSaid').textContent = p.transcript ? 'Vous avez dit : « ' + p.transcript + ' »' : '';

    var vDate = $('vDate');
    vDate.textContent = p.date ? P.formatDate(p.date, { year: true }) : 'Date non comprise';
    vDate.classList.toggle('missing', !p.date);

    var vTime = $('vTime');
    vTime.textContent = p.time ? P.formatTime(p.time) : 'Non précisée';
    vTime.classList.toggle('missing', !p.time);

    $('vTitle').textContent = p.title || 'Rendez-vous';

    var warnings = p.warnings.slice();
    if (p.date && p.date < todayIso()) warnings.push('Attention : cette date est déjà passée.');
    $('vWarnings').innerHTML = warnings.map(function (w) { return '<div class="warn">⚠️ ' + esc(w) + '</div>'; }).join('');

    $('vSave').disabled = !p.date;
  }

  function toggleEdit(show) {
    var box = $('editBox');
    if (show) {
      $('eDate').value = pending.date || '';
      $('eTime').value = pending.time || '';
      $('eTitle').value = pending.title || '';
      box.classList.remove('hidden');
      $('vEdit').classList.add('hidden');
    } else {
      box.classList.add('hidden');
      $('vEdit').classList.remove('hidden');
    }
  }

  function onEditChange() {
    if (!pending) return;
    pending.date = $('eDate').value || null;
    pending.time = $('eTime').value || null;
    pending.title = $('eTitle').value.trim() || 'Rendez-vous';
    pending.warnings = pending.date ? [] : ['Merci de choisir la date.'];
    renderVerify();
  }
  ['eDate', 'eTime', 'eTitle'].forEach(function (id) {
    $(id).addEventListener('input', onEditChange);
    $(id).addEventListener('change', onEditChange);
  });

  $('vEdit').addEventListener('click', function () { stopSpeaking(); toggleEdit(true); });
  $('vRetry').addEventListener('click', function () { pending = null; hideOverlay('verify'); openVoice(voiceDate); });
  $('vCancel').addEventListener('click', function () { stopSpeaking(); pending = null; hideOverlay('verify'); });

  $('vSave').addEventListener('click', function () {
    if (!pending || !pending.date) return;
    stopSpeaking();
    var item = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      date: pending.date,
      time: pending.time || '',
      title: pending.title || 'Rendez-vous',
      said: pending.transcript || '',
      createdAt: new Date().toISOString()
    };
    appts.push(item);
    if (!persist()) {
      appts.pop();
      toast("Erreur : le rendez-vous n'a pas pu être enregistré");
      return;
    }
    pending = null;
    hideOverlay('verify');
    if (isOpen('day')) {
      dayIso = item.date; // si la phrase contenait une autre date, on affiche ce jour-là
      refreshViews();
      flashCard('dayList', item.id);
    } else {
      refreshViews();
      flashCard('list', item.id);
    }
    toast('✓ Rendez-vous enregistré');
    speak('Rendez-vous enregistré.');
  });

  // ---------- Veille automatique ----------
  var idleTimer = null;
  function resetIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
      if (isOverlayOpen()) { resetIdle(); return; } // ne jamais perdre une saisie en cours
      showLock();
    }, CONFIG.lockAfterMs);
  }
  ['touchstart', 'mousedown', 'keydown', 'scroll'].forEach(function (ev) {
    document.addEventListener(ev, function () {
      if ($('lock').classList.contains('hidden')) resetIdle();
    }, { passive: true });
  });

  $('lock').addEventListener('click', unlock);
  $('lockBtn').addEventListener('click', showLock);
  $('addBtn').addEventListener('click', function () { openVoice(null); });

  // ---------- Écran toujours allumé ----------
  var wakeLock = null;
  function requestWakeLock() {
    if (!('wakeLock' in navigator) || wakeLock) return;
    navigator.wakeLock.request('screen').then(function (l) {
      wakeLock = l;
      l.addEventListener('release', function () { wakeLock = null; });
    }).catch(function () {});
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      requestWakeLock();
      refresh();
    }
  });

  // ---------- Mise à jour régulière (heure, changement de jour) ----------
  var lastMinute = '';
  function refresh() {
    var m = nowHHMM();
    if (m === lastMinute) return;
    lastMinute = m;
    if (!$('lock').classList.contains('hidden')) renderLock();
    else if (!isOverlayOpen()) renderList();
  }
  setInterval(refresh, 5000);

  // ---------- Démarrage ----------
  purgeOld();
  renderLock();

  if ('serviceWorker' in navigator &&
      (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
