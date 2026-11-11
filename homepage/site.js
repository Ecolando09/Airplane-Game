// play.latlas.lol homepage behavior. No libraries. Each block below is independent:
// nav, hero preview (slides, tilt, particles), media gallery + pop-up viewer,
// scroll reveal, and the app sizes next to the download buttons.
(() => {
  const $ = (id) => document.getElementById(id);
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.documentElement.classList.add('js');

  // ------------------------------------------------------------ navigation
  // Glass background once scrolled; the menu button on small screens; and the
  // link of the section in view lights up.
  const nav = $('nav');
  const onScroll = () => nav.classList.toggle('scrolled', scrollY > 12);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  const toggle = $('navToggle');
  const setMenu = (open) => {
    nav.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.addEventListener('click', () => setMenu(!nav.classList.contains('open')));
  $('navLinks').addEventListener('click', (e) => e.target.closest('a') && setMenu(false));

  const links = [...document.querySelectorAll('.nav-links a')];
  const spy = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      for (const a of links) a.classList.toggle('active', a.getAttribute('href') === `#${e.target.id}`);
    }
  }, { rootMargin: '-45% 0px -50% 0px' });
  for (const a of links) {
    const s = document.querySelector(a.getAttribute('href'));
    if (s) spy.observe(s);
  }

  // ------------------------------------------------------------ hero preview
  // Screenshots cross-fade like a looping clip.
  const slides = [...document.querySelectorAll('.screen img')];
  let slide = 0;
  if (!calm && slides.length > 1) {
    setInterval(() => {
      slides[slide].classList.remove('on');
      slide = (slide + 1) % slides.length;
      slides[slide].classList.add('on');
    }, 3800);
  }

  // The preview tilts toward the pointer.
  const stage = $('stage');
  const device = $('device');
  if (!calm && matchMedia('(pointer: fine)').matches) {
    stage.addEventListener('pointermove', (e) => {
      const r = stage.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      device.style.setProperty('--ry', `${x * 16}deg`);
      device.style.setProperty('--rx', `${-y * 12}deg`);
    });
    stage.addEventListener('pointerleave', () => {
      device.style.removeProperty('--ry');
      device.style.removeProperty('--rx');
    });
  }

  // Slow neon particles drifting up behind the preview. Paused when off screen.
  const canvas = $('particles');
  const ctx = canvas.getContext('2d');
  if (!calm && ctx) {
    let w = 0;
    let h = 0;
    let visible = true;
    const dots = Array.from({ length: 42 }, () => ({
      x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 1.8,
      v: 0.02 + Math.random() * 0.05, violet: Math.random() < 0.35,
    }));
    const size = () => {
      const d = Math.min(devicePixelRatio || 1, 2);
      w = canvas.width = canvas.clientWidth * d;
      h = canvas.height = canvas.clientHeight * d;
    };
    size();
    addEventListener('resize', size);
    new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(canvas);
    let last = performance.now();
    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (visible) {
        ctx.clearRect(0, 0, w, h);
        for (const p of dots) {
          p.y -= p.v * dt;
          if (p.y < -0.02) {
            p.y = 1.02;
            p.x = Math.random();
          }
          ctx.globalAlpha = 0.25 + 0.6 * Math.sin(p.y * Math.PI);
          ctx.fillStyle = p.violet ? '#7c3aed' : '#00ff9d';
          ctx.shadowColor = ctx.fillStyle;
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.arc(p.x * w, p.y * h, p.r * (w / 600 + 0.6), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------ media gallery + pop-up viewer
  // Thumbnails pick what the big preview shows; the preview (or any
  // [data-open-media] button) opens the pop-up. A thumbnail with data-video
  // plays that video in the pop-up instead of showing its picture.
  const thumbs = [...document.querySelectorAll('#thumbs button')];
  const viewerImg = $('viewerImg');
  const modal = $('modal');
  let current = 0;

  const select = (i) => {
    current = (i + thumbs.length) % thumbs.length;
    const t = thumbs[current];
    thumbs.forEach((b, k) => {
      b.classList.toggle('on', k === current);
      b.setAttribute('aria-selected', String(k === current));
    });
    viewerImg.classList.add('swap');
    setTimeout(() => {
      viewerImg.src = t.dataset.src;
      viewerImg.alt = t.dataset.cap;
      $('viewerCap').textContent = t.dataset.cap;
      viewerImg.classList.remove('swap');
    }, calm ? 0 : 180);
    t.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  const fillModal = () => {
    const t = thumbs[current];
    const box = $('modalMedia');
    box.textContent = '';
    let el;
    if (t.dataset.video) {
      el = Object.assign(document.createElement('video'), { src: t.dataset.video, controls: true, autoplay: true, playsInline: true });
      el.poster = t.dataset.src;
    } else {
      el = Object.assign(document.createElement('img'), { src: t.dataset.src, alt: t.dataset.cap });
    }
    box.appendChild(el);
    $('modalCap').textContent = `${t.dataset.cap} · ${current + 1}/${thumbs.length}`;
  };
  const openModal = (i = current) => {
    select(i);
    fillModal();
    if (!modal.open) modal.showModal();
  };
  const step = (d) => {
    select(current + d);
    fillModal();
  };

  thumbs.forEach((b, i) => b.addEventListener('click', () => select(i)));
  $('viewer').addEventListener('click', () => openModal());
  for (const b of document.querySelectorAll('[data-open-media]')) {
    b.addEventListener('click', () => openModal(Number(b.dataset.openMedia) || 0));
  }
  $('modalPrev').addEventListener('click', () => step(-1));
  $('modalNext').addEventListener('click', () => step(1));
  $('modalClose').addEventListener('click', () => modal.close());
  // A click on the dark area around the picture closes it.
  modal.addEventListener('click', (e) => e.target === modal && modal.close());
  modal.addEventListener('close', () => ($('modalMedia').textContent = '')); // stops a playing video
  modal.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
  });

  // ------------------------------------------------------------ scroll reveal
  const reveal = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('in');
      reveal.unobserve(e.target);
    }
  }, { threshold: 0.12 });
  document.querySelectorAll('.section-head, .card, .gallery').forEach((el, i) => {
    el.classList.add('reveal');
    el.style.transitionDelay = `${(i % 3) * 70}ms`;
    reveal.observe(el);
  });

  // ------------------------------------------------------------ app sizes by the download buttons
  const json = (url) => fetch(url, { cache: 'no-store' }).then((r) => r.json());
  json('downloads/lego-sky.json')
    .then((a) => ($('appMeta').textContent = `v${a.versionName} · ${Math.max(1, Math.round(a.size / 1024))} KB · Android 7+`))
    .catch(() => {});
  json('downloads/lego-sky-psg1.json')
    .then((a) => ($('psg1Meta').textContent = `${Math.max(1, Math.round(a.size / 1048576))} MB · or hit Play now in the PSG1 browser`))
    .catch(() => {});
})();
