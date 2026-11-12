/* Footer Arino Imóveis — spotlight que segue o cursor/toque e revela o vídeo */
(() => {
  const footer = document.getElementById('contato');
  if (!footer) return;

  const svg = footer.querySelector('.ft-spot svg');
  const mask = footer.querySelector('#ft-mask');
  const video = footer.querySelector('.ft-video');
  if (!svg || !mask || !video) return;

  const year = document.getElementById('ftYear');
  if (year) year.textContent = new Date().getFullYear();

  /* ---------- Rastros do spotlight ---------- */
  const NS = 'http://www.w3.org/2000/svg';
  const TRAILS = 6;
  const circles = [];

  // Do último para o primeiro, para o líder ficar por cima
  for (let i = TRAILS - 1; i >= 0; i--) {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', '-1000');
    c.setAttribute('cy', '-1000');
    c.setAttribute('fill', 'url(#ft-hole)');
    c.setAttribute('opacity', String(1 - i * 0.15));
    mask.appendChild(c);
    circles[i] = c;
  }

  const points = Array.from({ length: TRAILS }, () => ({ x: -1000, y: -1000 }));

  const mqMobile = window.matchMedia('(max-width: 639px)');
  const mqAuto = window.matchMedia('(hover: none), (max-width: 639px)');
  const mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  const baseRadius = () => (mqMobile.matches ? 280 : 520);
  const applyRadius = () => {
    circles.forEach((c, i) => c.setAttribute('r', Math.max(baseRadius() - i * 35, 40)));
  };
  applyRadius();

  /* ---------- Posição do cursor / toque (coordenadas da janela) ---------- */
  let pointer = null;
  const setPointer = (x, y) => { pointer = { x, y }; };

  window.addEventListener('mousemove', (e) => setPointer(e.clientX, e.clientY), { passive: true });

  const onTouch = (e) => {
    const t = e.touches[0];
    if (t) setPointer(t.clientX, t.clientY);
  };
  footer.addEventListener('touchstart', onTouch, { passive: true });
  footer.addEventListener('touchmove', onTouch, { passive: true });

  /* ---------- Loop de animação (só roda com o footer visível) ---------- */
  let raf = 0;
  const frame = () => {
    const r = footer.getBoundingClientRect();

    // Alvo em coordenadas locais do footer; sem ponteiro, usa o centro visível
    const tx = pointer ? pointer.x - r.left : r.width / 2;
    const ty = pointer
      ? pointer.y - r.top
      : Math.min(Math.max(window.innerHeight / 2 - r.top, 0), r.height);

    points[0].x += (tx - points[0].x) * 0.2;
    points[0].y += (ty - points[0].y) * 0.2;
    for (let i = 1; i < TRAILS; i++) {
      points[i].x += (points[i - 1].x - points[i].x) * 0.35;
      points[i].y += (points[i - 1].y - points[i].y) * 0.35;
    }
    for (let i = 0; i < TRAILS; i++) {
      circles[i].setAttribute('cx', points[i].x.toFixed(1));
      circles[i].setAttribute('cy', points[i].y.toFixed(1));
    }
    raf = requestAnimationFrame(frame);
  };

  /* ---------- Vídeo: hover nas zonas (mouse) ou autoplay (toque/mobile) ---------- */
  const holds = new Set();
  let visible = false;

  const syncVideo = () => {
    const auto = mqAuto.matches && !mqReduce.matches;
    const want = visible && (auto || holds.size > 0);
    if (want && video.paused) video.play().catch(() => {});
    if (!want && !video.paused) video.pause();
  };

  footer.querySelectorAll('[data-ft-zone]').forEach((el) => {
    el.addEventListener('mouseenter', () => { holds.add(el); syncVideo(); });
    el.addEventListener('mouseleave', () => { holds.delete(el); syncVideo(); });
  });

  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible && !raf) raf = requestAnimationFrame(frame);
    if (!visible && raf) { cancelAnimationFrame(raf); raf = 0; }
    syncVideo();
  }, { threshold: 0.05 }).observe(footer);

  mqMobile.addEventListener('change', applyRadius);
  mqAuto.addEventListener('change', syncVideo);
  mqReduce.addEventListener('change', syncVideo);
})();