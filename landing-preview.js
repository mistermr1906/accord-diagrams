/* ============================================================================
   Accord — Behaviour preview · landing-preview.js
   All behaviour for landing-preview.html in one vanilla-JS IIFE.

   GSAP (gsap + ScrollTrigger, loaded from CDN in the HTML) is an OPTIONAL
   enhancement layer: when present and motion is allowed, the three sticky
   swap sections get distinct, direction-aware transitions, a scrubbed
   progress rail with step dots, focus-dimming on the text columns, and
   entrance reveals. When GSAP is absent — or prefers-reduced-motion is set —
   every behaviour still works via the original CSS swaps.

   Modules:
     1. reducedMotion  — single matchMedia flag consulted everywhere
     2. gsapOK         — GSAP availability gate (motion-allowed + CDN loaded)
     3. countUp        — §02 stat numbers (IntersectionObserver + rAF ease-out)
     4. pinWatch       — §02 sticky stats bar .is-pinned toggle via 1px sentinel
     5. makeScrollSpy  — centre-band observer factory (§06, §08, §10)
     6. swap FX        — per-section GSAP transitions + progress rail + dimming
     7. makeTabs       — accessible tablist (§07, §19) with panel entrance fade
     8. §08 rails      — migrating bottom→top fixed tab rails (two-rail version)
     9. makeAutoTabs   — §19 auto-advance wrapper (animationend-driven)
    10. ambient reveals — §02 stat stagger, §14 alternating row reveals
    11. hashRouter     — deterministic state URLs
   ============================================================================ */
(() => {
  'use strict';

  /* ----------------------------------------------------------------------
     1. Reduced motion — one flag, consulted everywhere.
        Reduced: count-ups render final values instantly, §19 has no timer
        and no progress bar, layer swaps are instant, GSAP layer disabled.
     ---------------------------------------------------------------------- */
  const reducedMotion =
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ----------------------------------------------------------------------
     2. GSAP gate — the enhancement layer only activates when the CDN
        scripts actually loaded AND motion is allowed. Everything below
        checks this single flag; no behaviour depends on GSAP existing.
     ---------------------------------------------------------------------- */
  const gsapOK =
    !reducedMotion &&
    typeof window.gsap !== 'undefined' &&
    typeof window.ScrollTrigger !== 'undefined';

  if (gsapOK) window.gsap.registerPlugin(window.ScrollTrigger);

  /* ----------------------------------------------------------------------
     3. §02 — count-up
        Numbers carry data-count-to; prefix/suffix text lives OUTSIDE the
        counting span, so nothing but the digits ever changes. The bar uses
        tabular-nums so the line never reflows while counting.
     ---------------------------------------------------------------------- */
  function countUp(el) {
    const target = parseInt(el.dataset.countTo, 10);

    // The 0 just fades in (CSS transition on .is-started).
    if (target === 0) {
      el.classList.add('is-started');
      return;
    }
    if (reducedMotion) {
      el.textContent = String(target);
      return;
    }

    const DURATION = 900; // ms, ease-out
    const start = performance.now();
    const frame = (now) => {
      const t = Math.min(1, (now - start) / DURATION);
      const eased = 1 - Math.pow(1 - t, 3); // cubic ease-out
      el.textContent = String(Math.round(eased * target));
      if (t < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  function initCountUps() {
    const counts = Array.from(document.querySelectorAll('#s02 .count'));
    if (!counts.length) return;

    if (reducedMotion) {
      counts.forEach((el) => countUp(el));
      return;
    }

    // Zero out the animating numbers so they have somewhere to count from.
    counts.forEach((el) => {
      if (parseInt(el.dataset.countTo, 10) > 0) el.textContent = '0';
    });

    // Fire once per stat at ~40% visibility.
    const seen = new WeakSet();
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || seen.has(entry.target)) continue;
          seen.add(entry.target);
          countUp(entry.target);
          io.unobserve(entry.target);
        }
      },
      { threshold: 0.4 }
    );
    counts.forEach((el) => io.observe(el));
  }

  /* ----------------------------------------------------------------------
     4. §02 — pinned-state watcher
        A 1px sentinel sits just above the sticky bar. When the sentinel has
        scrolled off the top, the bar is pinned → .is-pinned.
     ---------------------------------------------------------------------- */
  function initPinWatch() {
    const sentinel = document.querySelector('#s02 .pin-sentinel');
    const bar = document.getElementById('s02-stats');
    if (!sentinel || !bar) return;

    const io = new IntersectionObserver(
      ([entry]) => {
        const pinned =
          !entry.isIntersecting && entry.boundingClientRect.top < 0;
        bar.classList.toggle('is-pinned', pinned);
      },
      { threshold: 0 }
    );
    io.observe(sentinel);
  }

  /* ----------------------------------------------------------------------
     5. Scroll-spy factory — the workhorse (§06, §08, §10)
        Centre-band observer: rootMargin -45%/-45% leaves a 10% band at the
        viewport centre. The block crossing that band activates. Rules:
        last activated wins; never deactivate to nothing. Blocks carry
        scroll-margin-top: 40vh so hash navigation lands them in the band.

        onChange(activeIndex, states) — states[i] ∈ 'passed'|'active'|'upcoming'
     ---------------------------------------------------------------------- */
  function makeScrollSpy(section, blockSelector, onChange) {
    const blocks = Array.from(section.querySelectorAll(blockSelector));
    if (!blocks.length) return null;

    let active = 0;

    const states = () =>
      blocks.map((_, i) =>
        i < active ? 'passed' : i === active ? 'active' : 'upcoming'
      );

    const emit = () => onChange(active, states(), blocks);

    const io = new IntersectionObserver(
      (entries) => {
        // Last activated wins: among entries currently in the band, take the
        // one with the deepest intersection. Leave events never deactivate.
        let best = null;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          if (!best || entry.intersectionRatio > best.intersectionRatio) {
            best = entry;
          }
        }
        if (!best) return;
        const idx = blocks.indexOf(best.target);
        if (idx !== -1 && idx !== active) {
          active = idx;
          emit();
        }
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 }
    );
    blocks.forEach((b) => io.observe(b));

    emit(); // initial paint — block 0 active, never "nothing"

    return {
      get active() {
        return active;
      },
      blocks,
    };
  }

  /* ----------------------------------------------------------------------
     6. Swap FX — the GSAP enhancement layer for the three sticky sections.
        Each section gets its OWN transition so the pattern stops feeling
        repetitive:
          §06 isometric — figure settles in: scale 1.07→1 + slight tilt,
                          direction-aware drift
          §08 screens   — card-deck slide: pushes in from scroll direction
          §10 phone     — native app push: full vertical slide inside the
                          phone frame (overflow:hidden clips it)
        All factories take the layer list and return (from, to, dir) where
        dir is +1 scrolling down, -1 scrolling up.
        Transforms live ONLY on .swap-layer — a descendant of the sticky
        panel, never an ancestor of anything sticky or fixed.
     ---------------------------------------------------------------------- */
  const fxIso = (layers) => (from, to, dir) => {
    const out = layers[from];
    const inc = layers[to];
    window.gsap.killTweensOf([out, inc]);
    layers.forEach((l, i) => {
      if (i !== to && i !== from) window.gsap.set(l, { autoAlpha: 0 });
    });
    window.gsap.to(out, {
      autoAlpha: 0,
      scale: 0.96,
      y: -16 * dir,
      duration: 0.35,
      ease: 'power2.in',
    });
    window.gsap.fromTo(
      inc,
      { autoAlpha: 0, scale: 1.07, y: 22 * dir, rotation: 0.8 * dir },
      {
        autoAlpha: 1,
        scale: 1,
        y: 0,
        rotation: 0,
        duration: 0.6,
        ease: 'power3.out',
      }
    );
  };

  const fxScreens = (layers) => (from, to, dir) => {
    const out = layers[from];
    const inc = layers[to];
    window.gsap.killTweensOf([out, inc]);
    layers.forEach((l, i) => {
      if (i !== to && i !== from) window.gsap.set(l, { autoAlpha: 0 });
    });
    window.gsap.to(out, {
      autoAlpha: 0,
      y: -30 * dir,
      scale: 0.99,
      duration: 0.32,
      ease: 'power1.in',
    });
    window.gsap.fromTo(
      inc,
      { autoAlpha: 0, y: 46 * dir, scale: 0.98 },
      { autoAlpha: 1, y: 0, scale: 1, duration: 0.55, ease: 'power3.out' }
    );
  };

  const fxPhone = (layers) => (from, to, dir) => {
    const out = layers[from];
    const inc = layers[to];
    window.gsap.killTweensOf([out, inc]);
    layers.forEach((l, i) => {
      if (i !== to && i !== from) window.gsap.set(l, { autoAlpha: 0 });
    });
    window.gsap.to(out, {
      yPercent: -32 * dir,
      autoAlpha: 0,
      duration: 0.45,
      ease: 'power2.inOut',
    });
    window.gsap.fromTo(
      inc,
      { yPercent: 70 * dir, autoAlpha: 1 },
      { yPercent: 0, duration: 0.6, ease: 'power4.out' }
    );
  };

  /* Scrubbed progress rail + step dots, appended beside the sticky stage.
     The fill scrubs with section scroll (ScrollTrigger); dots light up as
     blocks are passed. Decorative — aria-hidden; the TOC and §08 rails
     remain the navigable equivalents. GSAP-only (hidden ≤900px in CSS). */
  function buildRail(panel, stage, count, section) {
    const rail = document.createElement('div');
    rail.className = 'progress-rail';
    rail.setAttribute('aria-hidden', 'true');

    const fill = document.createElement('div');
    fill.className = 'fill';
    rail.appendChild(fill);

    const dots = [];
    for (let i = 0; i < count; i++) {
      const dot = document.createElement('div');
      dot.className = 'dot';
      dot.style.top =
        (count > 1 ? (i / (count - 1)) * 100 : 0) + '%';
      rail.appendChild(dot);
      dots.push(dot);
    }
    panel.appendChild(rail);

    const size = () => {
      rail.style.height = stage.offsetHeight + 'px';
    };
    size();
    window.addEventListener('resize', size);

    window.gsap.to(fill, {
      scaleY: 1,
      ease: 'none',
      scrollTrigger: {
        trigger: section,
        start: 'top 55%',
        end: 'bottom 75%',
        scrub: 0.4,
      },
    });

    return {
      update(active) {
        dots.forEach((d, i) => d.classList.toggle('is-on', i <= active));
      },
    };
  }

  /* Generic swap-consumer. With GSAP: direction-aware FX, caption micro-
     fade, focus-dimming of the text blocks, progress rail. Without GSAP:
     the original .is-active CSS crossfade and plain caption swap. */
  function wireSwap(sectionId, blockSelector, stageId, captionId, opts = {}) {
    const section = document.getElementById(sectionId);
    const stage = document.getElementById(stageId);
    const caption = document.getElementById(captionId);
    if (!section || !stage) return null;

    const layers = Array.from(stage.querySelectorAll('.swap-layer'));
    const blockCount = section.querySelectorAll(blockSelector).length;

    let fx = null;
    let rail = null;

    if (gsapOK) {
      stage.classList.add('fx'); // CSS hands opacity control to inline styles
      layers.forEach((l, i) =>
        window.gsap.set(l, { autoAlpha: i === 0 ? 1 : 0 })
      );
      if (opts.fx) fx = opts.fx(layers);
      const panel = stage.closest('.swap-panel');
      if (panel) rail = buildRail(panel, stage, blockCount, section);
    }

    let prev = 0;
    let booted = false;

    return makeScrollSpy(section, blockSelector, (active, states, blocks) => {
      // Layer swap
      if (fx) {
        if (active !== prev) fx(prev, active, active > prev ? 1 : -1);
      } else {
        layers.forEach((layer, i) =>
          layer.classList.toggle('is-active', i === active)
        );
      }
      prev = active;

      // Caption
      const cap = blocks[active] && blocks[active].dataset.caption;
      if (caption && cap) {
        caption.textContent = cap;
        if (gsapOK && booted) {
          window.gsap.fromTo(
            caption,
            { autoAlpha: 0, y: 6 },
            {
              autoAlpha: 1,
              y: 0,
              duration: 0.3,
              ease: 'power1.out',
              overwrite: 'auto',
            }
          );
        }
      }

      // Focus-dimming: active block full strength, the rest recede.
      // Opacity only (never visibility) — content stays readable to AT.
      if (gsapOK) {
        window.gsap.to(blocks, {
          opacity: (i) => (i === active ? 1 : 0.45),
          duration: booted ? 0.35 : 0,
          ease: 'power1.out',
          overwrite: 'auto',
        });
      }

      if (rail) rail.update(active);
      if (opts.extra) opts.extra(active, states, blocks);
      booted = true;
    });
  }

  /* ----------------------------------------------------------------------
     7. Accessible tablist factory (§07, §19)
        Click + Left/Right/Home/End keys, aria-selected, roving tabindex,
        panels toggled with the hidden attribute. With GSAP, the shown
        panel gets a small entrance fade.

        opts.onUserSelect fires only on direct user interaction (click/key) —
        §19 uses it to stop the auto-advance timer permanently.
     ---------------------------------------------------------------------- */
  function makeTabs(root, opts = {}) {
    const tabs = Array.from(root.querySelectorAll('[role="tab"]'));
    const panels = tabs.map((tab) =>
      document.getElementById(tab.getAttribute('aria-controls'))
    );

    let current = Math.max(
      0,
      tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true')
    );

    function select(index, { focus = false, user = false } = {}) {
      if (index < 0 || index >= tabs.length) return;
      current = index;
      tabs.forEach((tab, i) => {
        const selected = i === index;
        tab.setAttribute('aria-selected', selected ? 'true' : 'false');
        tab.tabIndex = selected ? 0 : -1;
        if (panels[i]) panels[i].hidden = !selected;
      });
      if (gsapOK && panels[index]) {
        window.gsap.fromTo(
          panels[index],
          { autoAlpha: 0, y: 14 },
          { autoAlpha: 1, y: 0, duration: 0.4, ease: 'power2.out' }
        );
      }
      if (focus) tabs[index].focus();
      if (user && opts.onUserSelect) opts.onUserSelect(index);
    }

    tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => select(i, { user: true }));
      tab.addEventListener('keydown', (e) => {
        let next = null;
        if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = tabs.length - 1;
        if (next === null) return;
        e.preventDefault();
        select(next, { focus: true, user: true });
      });
    });

    return {
      select,
      tabs,
      get current() {
        return current;
      },
    };
  }

  /* ----------------------------------------------------------------------
     §06 — audience toggle (two aria-pressed buttons, not a tablist:
     it switches a CSS-scoped attribute, panels stay in the document flow)
     ---------------------------------------------------------------------- */
  function initAudienceToggle() {
    const section = document.getElementById('s06');
    if (!section) return null;
    const buttons = Array.from(section.querySelectorAll('.aud-btn'));

    function setAudience(audience) {
      section.dataset.audience = audience;
      buttons.forEach((btn) =>
        btn.setAttribute(
          'aria-pressed',
          btn.dataset.audience === audience ? 'true' : 'false'
        )
      );
    }

    buttons.forEach((btn) =>
      btn.addEventListener('click', () => setAudience(btn.dataset.audience))
    );

    return { setAudience };
  }

  /* ----------------------------------------------------------------------
     8. §08 — migrating tab rails (two-rail version)
        Two fixed rails, rendered only while §08 intersects the viewport
        (body.in-s08). All 8 feature-name tabs are real anchors. Per the
        scroll-spy state: passed → TOP rail, upcoming → BOTTOM rail, the
        active tab stays highlighted in whichever rail it last occupied.
        Discrete jumps, no animation.
     ---------------------------------------------------------------------- */
  function initRails() {
    const section = document.getElementById('s08');
    const railTop = document.getElementById('s08-rail-top');
    const railBottom = document.getElementById('s08-rail-bottom');
    if (!section || !railTop || !railBottom) return null;

    const features = Array.from(section.querySelectorAll('.feature'));

    // Keep the READ / UPCOMING tag spans; tabs are appended after them.
    const tagTop = railTop.querySelector('.rail-tag');
    const tagBottom = railBottom.querySelector('.rail-tag');

    const tabs = features.map((feature) => {
      const a = document.createElement('a');
      a.className = 'rail-tab';
      a.href = '#' + feature.id;
      a.textContent = feature.dataset.tab;
      return a;
    });

    // Rail memory: a tab starts in the bottom rail; 'passed' promotes it to
    // the top rail; 'upcoming' demotes it back. 'active' keeps it where it
    // last was — so the highlight sits in the rail it last occupied.
    const railOf = tabs.map(() => 'bottom');

    function distribute(_active, states) {
      states.forEach((state, i) => {
        if (state === 'passed') railOf[i] = 'top';
        else if (state === 'upcoming') railOf[i] = 'bottom';
        // 'active' → unchanged
      });
      railTop.replaceChildren(
        tagTop,
        ...tabs.filter((_, i) => railOf[i] === 'top')
      );
      railBottom.replaceChildren(
        tagBottom,
        ...tabs.filter((_, i) => railOf[i] === 'bottom')
      );
      tabs.forEach((tab, i) =>
        tab.classList.toggle('is-active', states[i] === 'active')
      );
    }

    // Rails exist only while §08 is on screen.
    const io = new IntersectionObserver(
      (entries) => {
        document.body.classList.toggle(
          'in-s08',
          entries.some((e) => e.isIntersecting)
        );
      },
      { threshold: 0 }
    );
    io.observe(section);

    return distribute;
  }

  /* ----------------------------------------------------------------------
     9. §19 — auto-tabs
        Auto-advance every 5s. The 2px accent progress bar under the active
        tab IS the timer: a 5s CSS animation whose animationend event
        advances to the next tab. Pausing is pure CSS
        (.autotabs:hover/:focus-within → animation-play-state: paused), so
        the bar and the advance can never drift apart.
        ANY user interaction (click, keyboard, or arriving via #s19-tabN)
        stops the timer PERMANENTLY. Reduced motion: no timer, no bar.
     ---------------------------------------------------------------------- */
  function makeAutoTabs(root) {
    let stopped = false;

    const stop = () => {
      if (stopped) return;
      stopped = true;
      root.classList.remove('running');
    };

    const tabsApi = makeTabs(root, { onUserSelect: stop });

    if (!reducedMotion) {
      root.classList.add('running');
      root.querySelectorAll('.tab .progress').forEach((bar) => {
        bar.addEventListener('animationend', () => {
          if (stopped) return;
          tabsApi.select((tabsApi.current + 1) % tabsApi.tabs.length);
        });
      });
    }

    return { tabsApi, stop };
  }

  /* ----------------------------------------------------------------------
     10. Ambient reveals (GSAP-only)
         §02 — the three stat cards rise in, staggered, on first view.
         §14 — each row's text and figure slide in from opposite sides,
                mirrored on the alternating (.rev) rows.
     ---------------------------------------------------------------------- */
  function initAmbientReveals() {
    if (!gsapOK) return;

    window.gsap.from('#s02 .stat', {
      y: 26,
      autoAlpha: 0,
      duration: 0.6,
      ease: 'power2.out',
      stagger: 0.1,
      scrollTrigger: { trigger: '#s02-stats', start: 'top 80%', once: true },
    });

    window.gsap.utils.toArray('#s14 .hood-row').forEach((row) => {
      const rev = row.classList.contains('rev');
      window.gsap.from(Array.from(row.children), {
        x: (i) => (i === 0 ? -1 : 1) * (rev ? -1 : 1) * 28,
        autoAlpha: 0,
        duration: 0.6,
        ease: 'power2.out',
        stagger: 0.08,
        scrollTrigger: { trigger: row, start: 'top 78%', once: true },
      });
    });
  }

  /* ----------------------------------------------------------------------
     Boot
     ---------------------------------------------------------------------- */

  // §02
  initCountUps();
  initPinWatch();

  // §06 — sticky diagram swap (isometric settle FX) + audience toggle
  const audience = initAudienceToggle();
  wireSwap('s06', '.outcome', 's06-stage', 's06-caption', { fx: fxIso });

  // §07 — two-track switch
  const s07Root = document.querySelector('#s07 .tablist');
  const s07Tabs = s07Root ? makeTabs(s07Root) : null;

  // §08 — sticky panel (card-deck FX) + migrating rails on the same spy
  const distributeRails = initRails();
  wireSwap('s08', '.feature', 's08-stage', 's08-caption', {
    fx: fxScreens,
    extra: (active, states) => {
      if (distributeRails) distributeRails(active, states);
    },
  });

  // §10 — phone scroll-reveals (app-push FX)
  wireSwap('s10', '.reveal', 's10-stage', 's10-caption', { fx: fxPhone });

  // §19 — auto-tabs + permanent-stop wiring
  const s19Root = document.getElementById('s19-autotabs');
  const s19Auto = s19Root ? makeAutoTabs(s19Root) : null;

  // Entrance reveals (§02 stats stagger, §14 rows)
  initAmbientReveals();

  /* ----------------------------------------------------------------------
     11. Hash router
        #s06-oN / #s08-fN / #s10-rN are real element ids — native anchor
        scrolling plus scroll-margin-top: 40vh lands them inside the spy's
        activation band, so the right layer activates by itself.
        #s06-team, #s07-managers, #s07-team, #s19-tab1..3 are tab/button ids:
        native scroll still lands on them; here we also preselect the state
        (and, for §19, permanently suspend the timer).
     ---------------------------------------------------------------------- */
  function applyHash() {
    const hash = window.location.hash;
    if (!hash) return;

    if (hash === '#s06-team' && audience) {
      audience.setAudience('team');
    } else if (hash === '#s06-managers' && audience) {
      audience.setAudience('managers');
    } else if (hash === '#s07-managers' && s07Tabs) {
      s07Tabs.select(0);
    } else if (hash === '#s07-team' && s07Tabs) {
      s07Tabs.select(1);
    } else if (/^#s19-tab[123]$/.test(hash) && s19Auto) {
      // Arriving on a specific roadmap tab is an interaction: stop the timer.
      s19Auto.stop();
      s19Auto.tabsApi.select(parseInt(hash.slice(-1), 10) - 1);
    }
  }

  window.addEventListener('hashchange', applyHash);
  applyHash();
})();
