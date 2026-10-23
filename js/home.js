(function () {
  'use strict';

  var root = document.documentElement;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var clamp = function (v) { return Math.min(1, Math.max(0, v)); };

  /* ---------- mobile menu: Escape, focus trap, closes on link / desktop ---------- */
  var toggle = document.querySelector('.menu-btn');
  var mnav = document.getElementById('mnav');
  var mlinks = Array.prototype.slice.call(mnav.querySelectorAll('a'));

  function isOpen() { return toggle.getAttribute('aria-expanded') === 'true'; }

  function setMenu(open, returnFocus) {
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
    mnav.classList.toggle('is-open', open);
    mnav.setAttribute('aria-hidden', String(!open));
    root.classList.toggle('menu-open', open);
    if (open) {
      setTimeout(function () { if (isOpen()) mlinks[0].focus(); }, 60);
    } else if (returnFocus) {
      toggle.focus();
    }
  }

  toggle.addEventListener('click', function () { setMenu(!isOpen()); });
  mlinks.forEach(function (a) { a.addEventListener('click', function () { setMenu(false); }); });

  document.addEventListener('keydown', function (e) {
    if (!isOpen()) return;
    if (e.key === 'Escape') { setMenu(false, true); return; }
    if (e.key !== 'Tab') return;
    var items = [toggle].concat(mlinks);
    var i = items.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); items[items.length - 1].focus(); }
    else if (!e.shiftKey && (i === -1 || i === items.length - 1)) { e.preventDefault(); items[0].focus(); }
  });

  window.matchMedia('(min-width: 768px)').addEventListener('change', function (e) {
    if (e.matches) setMenu(false);
  });

  /* ---------- smooth anchors (respects reduced motion) ---------- */
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var id = a.getAttribute('href').slice(1);
      var target = id && document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      history.replaceState(null, '', '#' + id);
    });
  });

  /* ---------- scroll reveal (single observer, unobserved after reveal) ---------- */
  var revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in'); obs.unobserve(en.target); }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('in'); });
  }

  /* ---------- manifesto: words light up with scroll ---------- */
  var wordsEl = document.querySelector('[data-words]');
  var words = [];
  if (wordsEl) {
    var parts = wordsEl.textContent.trim().split(/\s+/);
    wordsEl.innerHTML = parts.map(function (w) { return '<span class="w">' + w + '</span>'; }).join(' ');
    words = Array.prototype.slice.call(wordsEl.querySelectorAll('.w'));
  }

  /* ---------- sticky cards: previous card shrinks as the next one arrives ---------- */
  var stackCards = Array.prototype.slice.call(document.querySelectorAll('.stack-card'));

  /* ---------- process steps: line fills and steps light up ---------- */
  var stepsEl = document.querySelector('.steps');
  var steps = stepsEl ? Array.prototype.slice.call(stepsEl.querySelectorAll('.step')) : [];

  var ticking = false;
  function paint() {
    ticking = false;
    var vh = window.innerHeight;

    if (wordsEl && words.length) {
      if (reduce) {
        words.forEach(function (s) { s.style.opacity = '1'; });
      } else {
        var r = wordsEl.getBoundingClientRect();
        var p = clamp((vh * 0.85 - r.top) / (r.height + vh * 0.5));
        var n = words.length;
        for (var i = 0; i < n; i++) {
          var t = clamp((p * (n + 3) - i) / 3);
          words[i].style.opacity = (0.18 + 0.82 * t).toFixed(3);
        }
      }
    }

    if (!reduce) {
      stackCards.forEach(function (card, i) {
        var next = stackCards[i + 1];
        if (!next) return;
        var stickyTop = parseFloat(getComputedStyle(next).top) || 0;
        var t = clamp(1 - (next.getBoundingClientRect().top - stickyTop) / (vh * 0.6));
        card.style.transform = 'scale(' + (1 - 0.05 * t).toFixed(4) + ')';
        card.style.filter = 'brightness(' + (1 - 0.25 * t).toFixed(3) + ')';
      });
    }

    /* navbar: dark bar once the hero has scrolled past the header */
    var navEl = document.querySelector('.nav');
    var heroEl = document.querySelector('.hero');
    var past = heroEl.getBoundingClientRect().bottom <= navEl.getBoundingClientRect().bottom;
    navEl.classList.toggle('is-scrolled', past);

    if (stepsEl) {
      var sr = stepsEl.getBoundingClientRect();
      var sp = clamp((vh * 0.7 - sr.top) / sr.height);
      stepsEl.style.setProperty('--p', sp.toFixed(3));
      steps.forEach(function (s) {
        s.classList.toggle('on', reduce || s.getBoundingClientRect().top < vh * 0.7);
      });
    }
  }

  function requestPaint() {
    if (!ticking) { ticking = true; window.requestAnimationFrame(paint); }
  }
  window.addEventListener('scroll', requestPaint, { passive: true });
  window.addEventListener('resize', requestPaint);
  paint();

  /* ---------- property filters ---------- */
  var chips = Array.prototype.slice.call(document.querySelectorAll('.chip'));
  var items = Array.prototype.slice.call(document.querySelectorAll('.prop-item'));

  function applyFilter(kind) {
    chips.forEach(function (c) { c.setAttribute('aria-pressed', String(c.dataset.filter === kind)); });
    items.forEach(function (it) {
      it.hidden = !(kind === 'all' || it.dataset.kind === kind);
    });
  }

  chips.forEach(function (c) {
    c.addEventListener('click', function () { applyFilter(c.dataset.filter); });
  });

  /* ---------- search: sets the matching filter and goes to the listings ---------- */
  var form = document.getElementById('search');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = document.getElementById('finalidade').value;
    applyFilter(f);
    document.getElementById('imoveis').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  });
})();