/*
 * Mes rendez-vous — application tablette.
 * Les rendez-vous sont enregistrés sur l'appareil (localStorage).
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

  var P = window.RdvParser;
  var Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  function $(id) { return document.getElementById(id); }

  // ---------- Données ----------
  function load() {
    try {
      var arr = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(appts)); return true; } catch (e) { return false; }
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
      var rel = relLabel(a.date);
      var cls = 'card';
      var badgeCls = 'badge';
      if (past) { cls += ' is-past'; badgeCls += ' past'; rel = "Aujourd'hui — déjà passé"; }
      else if (a.date === t) { cls += ' is-today'; badgeCls += ' today'; }
      else if (a.date === addDays(t, 1)) { cls += ' is-tomorrow'; badgeCls += ' tomorrow'; }

      if (!past && !nextDone) {
        cls += ' is-next';
        html += '<div class="next-label">Prochain rendez-vous</div>';
        nextDone = true;
      } else if (!past && !laterShown) {
        html += '<div class="next-label later-label">Ensuite</div>';
        laterShown = true;
      }

      html += '<article class="' + cls + '" id="rdv-' + esc(a.id) + '">' +
        '<div class="' + badgeCls + '">' + esc(rel) + '</div>' +
        '<div class="card-date">' + esc(P.formatDate(a.date)) + '</div>' +
        (a.time
          ? '<div class="card-time">🕙 ' + esc(P.formatTime(a.time)) + '</div>'
          : '<div class="card-time muted">Heure non précisée</div>') +
        '<div class="card-title">' + esc(a.title) + '</div>' +
        '<button class="btn-del" type="button" data-id="' + esc(a.id) + '">🗑 Supprimer</button>' +
        '</article>';
    });
    el.innerHTML = html;
  }

  function flashCard(id) {
    var card = $('rdv-' + id);
    if (!card) return;
    card.classList.add('flash');
    if (card.scrollIntoView) card.scrollIntoView({ block: 'center' });
  }

  $('list').addEventListener('click', function (e) {
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
        renderList();
        toast('Rendez-vous supprimé');
      });
  });

  // ---------- Fenêtres ----------
  var OVERLAYS = ['voice', 'verify', 'confirm'];
  function showOverlay(id) { $(id).classList.remove('hidden'); $(id).scrollTop = 0; }
  function hideOverlay(id) { $(id).classList.add('hidden'); }
  function isOverlayOpen() {
    return OVERLAYS.some(function (id) { return !$(id).classList.contains('hidden'); });
  }
  function closeAllOverlays() {
    cancelListening();
    stopSpeaking();
    OVERLAYS.forEach(hideOverlay);
  }

  var confirmYes = null;
  function askConfirm(text, detailHtml, onYes) {
    $('confirmText').textContent = text;
    $('confirmDetail').innerHTML = esc(detailHtml).replace(/&lt;br&gt;/g, '<br>');
    confirmYes = onYes;
    showOverlay('confirm');
  }
  $('confirmYes').addEventListener('click', function () {
    hideOverlay('confirm');
    var fn = confirmYes; confirmYes = null;
    if (fn) fn();
  });
  $('confirmNo').addEventListener('click', function () { hideOverlay('confirm'); confirmYes = null; });

  var toastTimer = null;
  function toast(text) {
    var el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 3000);
  }

  // ---------- Dictée vocale ----------
  var rec = null, listening = false, cancelled = false, heard = '', lastError = '';

  function setStatus(t) { $('voiceStatus').textContent = t; }
  function setMic(on) { $('micBtn').classList.toggle('listening', on); }

  function openVoice() {
    stopSpeaking();
    cancelled = false;
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
    if (!Rec || listening) return;
    stopSpeaking();
    heard = ''; lastError = '';
    $('transcript').textContent = '';
    try {
      rec = new Rec();
    } catch (e) {
      setStatus("La dictée vocale n'est pas disponible.");
      showTextMode();
      return;
    }
    rec.lang = 'fr-FR';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    rec.onstart = function () {
      listening = true;
      setMic(true);
      setStatus('Je vous écoute… Parlez maintenant.');
    };
    rec.onresult = function (e) {
      var txt = '';
      for (var i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
      heard = txt;
      $('transcript').textContent = '« ' + txt + ' »';
    };
    rec.onerror = function (e) { lastError = e.error || ''; };
    rec.onend = function () {
      listening = false;
      setMic(false);
      rec = null;
      if (cancelled) return;
      var t = heard.trim();
      if (t) { openVerify(t); return; }
      if (lastError === 'not-allowed' || lastError === 'service-not-allowed') {
        setStatus("Le micro n'est pas autorisé. Autorisez le micro pour cette application, ou écrivez le rendez-vous.");
      } else if (lastError === 'network') {
        setStatus("Pas de connexion Internet : la dictée ne marche pas. Vous pouvez écrire le rendez-vous.");
      } else {
        setStatus("Je n'ai rien entendu. Touchez le micro et parlez.");
      }
    };

    try {
      rec.start();
      setStatus('Un instant…');
    } catch (e) {
      setStatus('Touchez le micro pour parler.');
    }
  }

  function cancelListening() {
    cancelled = true;
    if (rec) { try { rec.abort(); } catch (e) {} }
    listening = false;
    setMic(false);
  }

  function showTextMode() {
    cancelListening();
    $('textForm').classList.remove('hidden');
    $('typeBtn').classList.add('hidden');
    setTimeout(function () { $('textInput').focus(); }, 50);
  }

  $('micBtn').addEventListener('click', function () {
    if (!Rec) return;
    if (listening) { if (rec) rec.stop(); return; }
    cancelled = false;
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
    var r = P.parse(text, new Date());
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
  $('vRetry').addEventListener('click', function () { pending = null; hideOverlay('verify'); openVoice(); });
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
    renderList();
    flashCard(item.id);
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
  $('addBtn').addEventListener('click', openVoice);

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
