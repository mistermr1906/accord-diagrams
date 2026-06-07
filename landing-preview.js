/* ============================================================================
   Accord — Behaviour preview · landing-preview.js
   All behaviour for landing-preview.html in one vanilla-JS IIFE.

   GSAP (gsap + ScrollTrigger, loaded from CDN in the HTML) is an OPTIONAL
   enhancement layer. With it, each sticky section runs a DISTINCT scene:
     §06 — living figure: directional clip-path wipes, rolling ghost index
            (01–05) behind the stage, breathing float, mouse parallax
     §08 — card deck: the next two screens visibly stacked and peeking below
            the front card; scroll promotes the stack, front card flies off
     §10 — 3D phone: perspective tilt scrubbed by scroll position while
            screens push inside the frame like a native app
   Plus: §02 scrubbed text reveal, focus-dimming, progress rails, entrance
   reveals. Without GSAP — or with prefers-reduced-motion — every behaviour
   still works via the original CSS swaps.

   Modules:
     1. reducedMotion  — single matchMedia flag consulted everywhere
     2. gsapOK         — GSAP availability gate (motion-allowed + CDN loaded)
     3. countUp        — §02 stat numbers (IntersectionObserver + rAF ease-out)
     4. pinWatch       — §02 sticky stats bar .is-pinned toggle via 1px sentinel
     5. scrubText      — §02 body copy brightens word-by-word with scroll
     6. makeScrollSpy  — centre-band observer factory (§06, §08, §10)
     7. scenes         — per-section GSAP scenes + progress rail + dimming
     8. makeTabs       — accessible tablist (§07, §19) with panel entrance fade
     9. §08 rails      — migrating bottom→top fixed tab rails (two-rail version)
    10. makeAutoTabs   — §19 auto-advance wrapper (animationend-driven)
    11. ambient reveals — §02 stat stagger, §14 alternating row reveals
    12. hashRouter     — deterministic state URLs
   ============================================================================ */
(() => {
  'use strict';

  /* ----------------------------------------------------------------------
     1. Reduced motion — one flag, consulted everywhere.
     ---------------------------------------------------------------------- */
  const reducedMotion =
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ----------------------------------------------------------------------
     2. GSAP gate — the enhancement layer only activates when the CDN
        scripts actually loaded AND motion is allowed.
     ---------------------------------------------------------------------- */
  const gsapOK =
    !reducedMotion &&
    typeof window.gsap !== 'undefined' &&
    typeof window.ScrollTrigger !== 'undefined';

  const g = gsapOK ? window.gsap : null;
  if (gsapOK) g.registerPlugin(window.ScrollTrigger);

  /* ----------------------------------------------------------------------
     3. §02 — count-up
        Numbers carry data-count-to; prefix/suffix text lives OUTSIDE the
        counting span. tabular-nums keeps the line from reflowing.
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
     5. §02 — scrubbed text reveal
        The section body copy fills the scroll run under the pinned bar.
        Words start at 16% opacity and brighten in reading order, scrubbed
        to scroll position. GSAP-only — the fallback paragraph is simply
        fully visible (no .w spans are ever created).
     ---------------------------------------------------------------------- */
  function initScrubText() {
    if (!gsapOK) return;
    const p = document.querySelector('#s02 .scrub-text');
    if (!p) return;

    const words = p.textContent.trim().split(/\s+/);
    p.innerHTML = words.map((w) => `<span class="w">${w}</span>`).join(' ');

    g.to(p.querySelectorAll('.w'), {
      opacity: 1,
      stagger: 0.5,
      ease: 'none',
      scrollTrigger: {
        trigger: p,
        start: 'top 80%',
        end: 'bottom 45%',
        scrub: 0.3,
      },
    });
  }

  /* ----------------------------------------------------------------------
     6. Scroll-spy factory — the workhorse (§06, §08, §10)
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
     7. Scenes — one per sticky section. Each factory receives
        { layers, stage, section, panel } and returns:
          init()                  — one-time setup (initial layer states,
                                    scene furniture, ambient motion)
          swap(prev, active, dir) — dir is +1 scrolling down, -1 up
        Transforms live ONLY on the stage and its descendants — both are
        DESCENDANTS of the sticky panel, never ancestors of anything
        sticky or fixed.
     ---------------------------------------------------------------------- */

  /* §06 — living figure: clip-path wipe + rolling ghost index + breathing
     float + mouse parallax. */
  const sceneIso = ({ layers, stage, panel }) => {
    let ghost = null;

    return {
      init() {
        layers.forEach((l, i) => g.set(l, { autoAlpha: i === 0 ? 1 : 0 }));

        // Ghost index, stacked behind the stage (stage is z-index:1).
        ghost = document.createElement('div');
        ghost.className = 'ghost-num';
        ghost.textContent = '01';
        panel.insertBefore(ghost, stage);

        // Breathing float — the figure never sits perfectly still.
        g.set(stage, { transformPerspective: 700 });
        g.to(stage, {
          y: 10,
          duration: 3.2,
          ease: 'sine.inOut',
          yoyo: true,
          repeat: -1,
        });

        // Mouse parallax — the figure tilts toward the cursor.
        const qx = g.quickTo(stage, 'rotationY', {
          duration: 0.6,
          ease: 'power2.out',
        });
        const qy = g.quickTo(stage, 'rotationX', {
          duration: 0.6,
          ease: 'power2.out',
        });
        panel.addEventListener('pointermove', (e) => {
          const r = stage.getBoundingClientRect();
          qx(((e.clientX - r.left) / r.width - 0.5) * 8);
          qy(-((e.clientY - r.top) / r.height - 0.5) * 6);
        });
        panel.addEventListener('pointerleave', () => {
          qx(0);
          qy(0);
        });
      },

      swap(prev, active, dir) {
        const out = layers[prev];
        const inc = layers[active];
        g.killTweensOf([out, inc]);
        layers.forEach((l, i) => {
          if (i !== active && i !== prev) g.set(l, { autoAlpha: 0 });
        });

        g.to(out, {
          autoAlpha: 0,
          scale: 0.97,
          duration: 0.3,
          ease: 'power1.in',
        });

        // Directional wipe: scrolling down reveals upward, up reveals downward.
        const clipFrom =
          dir > 0 ? 'inset(100% 0% 0% 0%)' : 'inset(0% 0% 100% 0%)';
        g.set(inc, { autoAlpha: 1 });
        g.fromTo(
          inc,
          { clipPath: clipFrom, scale: 1.04 },
          {
            clipPath: 'inset(0% 0% 0% 0%)',
            scale: 1,
            duration: 0.55,
            ease: 'power3.out',
          }
        );

        // Ghost index rolls to the new number.
        if (ghost) {
          const next = String(active + 1).padStart(2, '0');
          g.timeline()
            .to(ghost, {
              yPercent: -40,
              autoAlpha: 0,
              duration: 0.18,
              ease: 'power1.in',
              onComplete: () => {
                ghost.textContent = next;
              },
            })
            .fromTo(
              ghost,
              { yPercent: 40 },
              { yPercent: 0, autoAlpha: 1, duration: 0.3, ease: 'power2.out' }
            );
        }
      },
    };
  };

  /* §08 — card deck: every layer animates to the slot for its depth
     (active = front; next two peek below; passed cards fly up and off).
     Works for any jump size — each card just moves to its new slot. */
  const sceneDeck = ({ layers }) => {
    const slot = (depth) => {
      if (depth < 0) return { y: -54, scale: 1.02, autoAlpha: 0, zIndex: 40 };
      if (depth === 0) return { y: 0, scale: 1, autoAlpha: 1, zIndex: 30 };
      if (depth === 1) return { y: 18, scale: 0.95, autoAlpha: 0.5, zIndex: 29 };
      if (depth === 2) return { y: 34, scale: 0.9, autoAlpha: 0.22, zIndex: 28 };
      return { y: 46, scale: 0.86, autoAlpha: 0, zIndex: 27 };
    };

    const apply = (active, instant) => {
      layers.forEach((layer, i) =>
        g.to(layer, {
          ...slot(i - active),
          duration: instant ? 0 : 0.55,
          ease: 'power3.out',
          overwrite: 'auto',
        })
      );
    };

    return {
      init() {
        // Bottom-anchored scaling so depth reads as a peek below the front card.
        layers.forEach((l) => g.set(l, { transformOrigin: 'center bottom' }));
        apply(0, true);
      },
      swap(_prev, active) {
        apply(active, false);
      },
    };
  };

  /* §10 — 3D phone: perspective tilt scrubbed by section scroll progress,
     screens push vertically inside the frame like native app navigation. */
  const scenePhone = ({ layers, stage, section }) => ({
    init() {
      layers.forEach((l, i) => g.set(l, { autoAlpha: i === 0 ? 1 : 0 }));
      g.set(stage, { transformPerspective: 900 });
      g.fromTo(
        stage,
        { rotationY: -9, rotationX: 1.5 },
        {
          rotationY: 9,
          rotationX: -1.5,
          ease: 'none',
          scrollTrigger: {
            trigger: section,
            start: 'top 60%',
            end: 'bottom 60%',
            scrub: 0.5,
          },
        }
      );
    },

    swap(prev, active, dir) {
      const out = layers[prev];
      const inc = layers[active];
      g.killTweensOf([out, inc]);
      layers.forEach((l, i) => {
        if (i !== active && i !== prev) g.set(l, { autoAlpha: 0 });
      });
      g.to(out, {
        yPercent: -32 * dir,
        autoAlpha: 0,
        duration: 0.45,
        ease: 'power2.inOut',
      });
      g.fromTo(
        inc,
        { yPercent: 70 * dir, autoAlpha: 1 },
        { yPercent: 0, duration: 0.6, ease: 'power4.out' }
      );
    },
  });

  /* Scrubbed progress rail + step dots, appended beside the sticky stage.
     Decorative — aria-hidden; the TOC and §08 rails remain the navigable
     equivalents. GSAP-only (hidden ≤900px in CSS). */
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
      dot.style.top = (count > 1 ? (i / (count - 1)) * 100 : 0) + '%';
      rail.appendChild(dot);
      dots.push(dot);
    }
    panel.appendChild(rail);

    const size = () => {
      rail.style.height = stage.offsetHeight + 'px';
    };
    size();
    window.addEventListener('resize', size);

    g.to(fill, {
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

  /* Generic swap-consumer. With GSAP: the section's scene runs the swap,
     plus caption micro-fade, focus-dimming, progress rail. Without GSAP:
     the original .is-active CSS crossfade and plain caption swap. The
     .is-focus class on the active block is toggled in BOTH modes (drives
     the §08 accent edge and §10 icon chips). */
  function wireSwap(sectionId, blockSelector, stageId, captionId, opts = {}) {
    const section = document.getElementById(sectionId);
    const stage = document.getElementById(stageId);
    const caption = document.getElementById(captionId);
    if (!section || !stage) return null;

    const layers = Array.from(stage.querySelectorAll('.swap-layer'));
    const panel = stage.closest('.swap-panel');
    const blockCount = section.querySelectorAll(blockSelector).length;

    let scene = null;
    let rail = null;

    if (gsapOK) {
      stage.classList.add('fx'); // CSS hands layer control to inline styles
      if (opts.scene) {
        scene = opts.scene({ layers, stage, section, panel });
        scene.init();
      } else {
        layers.forEach((l, i) => g.set(l, { autoAlpha: i === 0 ? 1 : 0 }));
      }
      if (panel) rail = buildRail(panel, stage, blockCount, section);
    }

    let prev = 0;
    let booted = false;

    return makeScrollSpy(section, blockSelector, (active, states, blocks) => {
      // Layer swap
      if (scene) {
        if (active !== prev) scene.swap(prev, active, active > prev ? 1 : -1);
      } else if (!gsapOK) {
        layers.forEach((layer, i) =>
          layer.classList.toggle('is-active', i === active)
        );
      }
      prev = active;

      // Focus marker — both modes (CSS hooks: §08 edge, §10 chips)
      blocks.forEach((b, i) => b.classList.toggle('is-focus', i === active));

      // Caption
      const cap = blocks[active] && blocks[active].dataset.caption;
      if (caption && cap) {
        caption.textContent = cap;
        if (gsapOK && booted) {
          g.fromTo(
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
        g.to(blocks, {
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
     8. Accessible tablist factory (§07, §19)
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
        g.fromTo(
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
     9. §08 — migrating tab rails (two-rail version)
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
     10. §19 — auto-tabs
        Auto-advance every 5s. The 2px accent progress bar under the active
        tab IS the timer: a 5s CSS animation whose animationend event
        advances to the next tab. Pausing is pure CSS
        (.autotabs:hover/:focus-within → animation-play-state: paused).
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
     11. Ambient reveals (GSAP-only)
         §02 — the three stat cards rise in, staggered, on first view.
         §14 — each row's text and figure slide in from opposite sides,
                mirrored on the alternating (.rev) rows.
     ---------------------------------------------------------------------- */
  function initAmbientReveals() {
    if (!gsapOK) return;

    g.from('#s02 .stat', {
      y: 26,
      autoAlpha: 0,
      duration: 0.6,
      ease: 'power2.out',
      stagger: 0.1,
      scrollTrigger: { trigger: '#s02-stats', start: 'top 80%', once: true },
    });

    g.utils.toArray('#s14 .hood-row').forEach((row) => {
      const rev = row.classList.contains('rev');
      g.from(Array.from(row.children), {
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
     Iframe auto-fit — the embedded screens are full 1100×825 (or 640×960)
     designer-handoff pages whose actual figure sits small in the centre.
     Same-origin, so we can measure the content's bounding box and zoom the
     iframe so the FIGURE fills the stage instead of the empty page around
     it. Runs in both modes (no GSAP needed); falls back silently to the
     stock CSS scale if the document isn't readable.
     ---------------------------------------------------------------------- */
  function fitFrame(iframe) {
    let doc;
    try {
      doc = iframe.contentDocument;
    } catch (e) {
      return; // cross-origin — keep the stock CSS scale
    }
    if (!doc || !doc.body) return;

    const stage = iframe.parentElement; // .swap-layer or .screen-stage
    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    if (!sw || !sh) return;

    // Union bounding box of elements that actually PAINT something —
    // backgrounds, borders, images, direct text. Invisible full-width
    // layout wrappers (which made the old top-level measure huge) are
    // skipped, as are page-sized backdrop fills.
    const view = doc.defaultView;
    const pageW = view.innerWidth;
    const pageH = view.innerHeight;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;

    doc.body.querySelectorAll('*').forEach((el) => {
      const tag = el.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK') return;

      // The screens' own `FIG n.nA - …` captions sit at the page's bottom
      // edge, far from the figure — including them inflates the box and
      // shrinks the figure. The preview renders its own captions, so skip
      // them (and anything inside them).
      if (
        el.closest('.fig-caption') ||
        /^FIG\s+\d/i.test((el.textContent || '').trim().slice(0, 8))
      ) {
        return;
      }

      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) return;
      // Page-sized backdrop, not content.
      if (r.width > pageW * 0.96 && r.height > pageH * 0.96) return;

      const cs = view.getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.opacity === '0') return;

      const paints =
        tag === 'IMG' || tag === 'svg' || tag === 'SVG' ||
        tag === 'CANVAS' || tag === 'VIDEO' ||
        (cs.backgroundColor &&
          cs.backgroundColor !== 'transparent' &&
          !/^rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\)$/.test(cs.backgroundColor)) ||
        cs.backgroundImage !== 'none' ||
        parseFloat(cs.borderTopWidth) > 0 ||
        parseFloat(cs.borderBottomWidth) > 0 ||
        parseFloat(cs.borderLeftWidth) > 0 ||
        parseFloat(cs.borderRightWidth) > 0 ||
        Array.from(el.childNodes).some(
          (n) => n.nodeType === 3 && n.textContent.trim()
        );
      if (!paints) return;

      x1 = Math.min(x1, r.left);
      y1 = Math.min(y1, r.top);
      x2 = Math.max(x2, r.right);
      y2 = Math.max(y2, r.bottom);
    });
    if (!isFinite(x1) || x2 - x1 < 40 || y2 - y1 < 40) return;

    const PAD = 28;
    x1 -= PAD; y1 -= PAD; x2 += PAD; y2 += PAD;
    const w = x2 - x1;
    const h = y2 - y1;

    // Contain-fit, with upscaling allowed (HTML scales crisply).
    let scale = Math.min(sw / w, sh / h, 1.3);

    // Landscape stages showing TALL content (§07's chat panel): contain-fit
    // wastes most of the stage. Fill the width instead and accept a capped
    // bottom crop (≤35%), top-aligned so the content's head stays visible.
    // Phones are exempt — a cropped phone reads as broken.
    const isPhone = !!iframe.closest('.phone-stage');
    if (!isPhone) {
      scale = Math.min(sw / w, scale * 1.35, 1.3);
    }

    const vh = h * scale;
    const top =
      vh <= sh ? (sh - vh) / 2 - y1 * scale : -y1 * scale; // centre or top-crop
    iframe.style.transform = 'scale(' + scale + ')';
    iframe.style.left = (sw - w * scale) / 2 - x1 * scale + 'px';
    iframe.style.top = top + 'px';
  }

  function initIframeFit() {
    const frames = Array.from(
      document.querySelectorAll(
        '.screen-stage iframe, .stage-8 iframe, .phone-stage iframe'
      )
    );
    frames.forEach((f) => {
      const run = () => {
        requestAnimationFrame(() => fitFrame(f));
        // Re-fit once webfonts have settled.
        setTimeout(() => fitFrame(f), 900);
      };
      if (f.contentDocument && f.contentDocument.readyState === 'complete') {
        run();
      }
      f.addEventListener('load', run);
    });
    let t;
    window.addEventListener('resize', () => {
      clearTimeout(t);
      t = setTimeout(() => frames.forEach(fitFrame), 150);
    });
  }

  /* ----------------------------------------------------------------------
     Boot
     ---------------------------------------------------------------------- */

  // §02
  initCountUps();
  initPinWatch();
  initScrubText();

  // §06 — living figure scene + audience toggle
  const audience = initAudienceToggle();
  wireSwap('s06', '.outcome', 's06-stage', 's06-caption', { scene: sceneIso });

  // §07 — two-track switch
  const s07Root = document.querySelector('#s07 .tablist');
  const s07Tabs = s07Root ? makeTabs(s07Root) : null;

  // §08 — card-deck scene + migrating rails on the same spy
  const distributeRails = initRails();
  wireSwap('s08', '.feature', 's08-stage', 's08-caption', {
    scene: sceneDeck,
    extra: (active, states) => {
      if (distributeRails) distributeRails(active, states);
    },
  });

  // §10 — 3D phone scene
  wireSwap('s10', '.reveal', 's10-stage', 's10-caption', { scene: scenePhone });

  // §19 — auto-tabs + permanent-stop wiring
  const s19Root = document.getElementById('s19-autotabs');
  const s19Auto = s19Root ? makeAutoTabs(s19Root) : null;

  // Entrance reveals (§02 stats stagger, §14 rows)
  initAmbientReveals();

  // Zoom every embedded screen to its actual content
  initIframeFit();

  /* ----------------------------------------------------------------------
     12. Hash router
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
