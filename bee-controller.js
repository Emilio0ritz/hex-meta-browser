(function () {
  "use strict";

  const POSITION_KEY = "emilio.hex.bee.position.";
  const DRAG_THRESHOLD = 6;
  const VIEWPORT_MARGIN = 10;
  const SNAP_DISTANCE = 24;
  const QUIRK_DELAY = 12000;
  const QUIRK_INTERVAL = 17000;
  const QUIRKS = ["look-left", "look-right", "wry", "pleased"];

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), Math.max(min, max));
  }

  function readPosition(surface) {
    try {
      const saved = JSON.parse(localStorage.getItem(`${POSITION_KEY}${surface}`));
      if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return null;
      return { x: clamp(saved.x, 0, 1), y: clamp(saved.y, 0, 1) };
    } catch {
      return null;
    }
  }

  function beeSvg(surface) {
    const goldId = `hexBeeGold-${surface}`;
    const headId = `hexBeeHead-${surface}`;
    const chromeId = `hexBeeChrome-${surface}`;
    const clipId = `hexBeeBodyClip-${surface}`;
    return `
      <svg class="hex-bee-mark" viewBox="0 0 120 72" focusable="false" aria-hidden="true">
        <defs>
          <linearGradient id="${goldId}" x1="0.15" y1="0" x2="0.4" y2="1">
            <stop offset="0" stop-color="#fbe6a0"></stop>
            <stop offset="0.5" stop-color="#e2b04d"></stop>
            <stop offset="1" stop-color="#a97a27"></stop>
          </linearGradient>
          <linearGradient id="${headId}" x1="0.1" y1="0" x2="0.4" y2="1">
            <stop offset="0" stop-color="#eecb74"></stop>
            <stop offset="1" stop-color="#976a1d"></stop>
          </linearGradient>
          <linearGradient id="${chromeId}" x1="0.1" y1="0" x2="0.25" y2="1">
            <stop offset="0" stop-color="#ffffff"></stop>
            <stop offset="0.5" stop-color="#c2cad1"></stop>
            <stop offset="1" stop-color="#f2f5f7"></stop>
          </linearGradient>
          <clipPath id="${clipId}">
            <ellipse cx="52" cy="44" rx="27" ry="15"></ellipse>
          </clipPath>
        </defs>
        <g class="hex-bee-flight">
          <g class="hex-bee-antennae">
            <path d="M79 35 C83 24 87 18 90 13"></path>
            <circle cx="90" cy="13" r="2.3"></circle>
            <path d="M75 34 C77 24 79 17 80 12"></path>
            <circle cx="80" cy="12" r="2.1"></circle>
          </g>
          <path class="hex-bee-wing hex-bee-wing-back" d="M53 33 C34 29 20 11 29 8 C40 4 52 22 53 33 Z" fill="url(#${chromeId})"></path>
          <path class="hex-bee-wing hex-bee-wing-front" d="M59 32 C53 24 49 5 61 8 C72 11 69 27 59 33 Z" fill="url(#${chromeId})"></path>
          <ellipse class="hex-bee-body" cx="52" cy="44" rx="27" ry="15" fill="url(#${goldId})"></ellipse>
          <g class="hex-bee-stripes" clip-path="url(#${clipId})">
            <path d="M39 30 L47 44 L39 58" stroke="url(#${chromeId})"></path>
            <path d="M29 31 L36 44 L29 57" stroke="url(#${chromeId})"></path>
            <path d="M49 31 L57 44 L49 57" stroke="url(#${chromeId})"></path>
          </g>
          <ellipse class="hex-bee-body-edge" cx="52" cy="44" rx="27" ry="15"></ellipse>
          <path class="hex-bee-shine" d="M31 37 C39 32 46 32 52 34"></path>
          <circle class="hex-bee-head" cx="77" cy="42" r="9" fill="url(#${headId})"></circle>
        </g>
      </svg>`;
  }

  function mount(options) {
    const host = options?.host;
    if (!host) return null;

    const surface = options.surface === "overlay" ? "overlay" : "main";
    host.dataset.beeSurface = surface;
    host.innerHTML = `
      <div class="thread-bee-shell" data-expression="calm">
        <button class="thread-bee-button" type="button" aria-label="Open HEX capture actions" aria-expanded="false">
          ${beeSvg(surface)}
        </button>
        <section class="thread-bee-menu" aria-label="HEX bee actions" hidden>
          <span class="thread-bee-menu-label">Active Thread</span>
          <strong class="thread-bee-thread-name"></strong>
          <div class="thread-bee-actions">
            <button class="thread-bee-primary" type="button" data-bee-action="resume">Resume Thread</button>
          </div>
          <span class="thread-bee-menu-hint">Drop files, links, or text on the bee to collect them into this thread.</span>
          <button class="thread-bee-home" type="button" data-bee-action="home">Return bee home</button>
        </section>
      </div>`;

    const shell = host.querySelector(".thread-bee-shell");
    const trigger = host.querySelector(".thread-bee-button");
    const menu = host.querySelector(".thread-bee-menu");
    const threadName = host.querySelector(".thread-bee-thread-name");
    const positionKey = `${POSITION_KEY}${surface}`;
    let drag = null;
    let suppressClickUntil = 0;
    let expressionTimer = null;
    let quirkTimer = null;
    let quirkIndex = 0;
    let resizeFrame = null;

    function refresh() {
      const title = String(options.getThreadTitle?.() || "Untitled Thread").trim();
      threadName.textContent = title || "Untitled Thread";
      threadName.title = threadName.textContent;
    }

    function setExpression(expression, duration = 1100) {
      clearTimeout(expressionTimer);
      shell.dataset.expression = expression;
      if (duration > 0) {
        expressionTimer = setTimeout(() => {
          shell.dataset.expression = "calm";
        }, duration);
      }
    }

    function scheduleQuirk(delay = QUIRK_INTERVAL) {
      clearTimeout(quirkTimer);
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
      quirkTimer = setTimeout(() => {
        if (menu.hidden && !drag) {
          setExpression(QUIRKS[quirkIndex % QUIRKS.length], 1250);
          quirkIndex += 1;
        }
        scheduleQuirk();
      }, delay);
    }

    function setFreePosition(left, top) {
      const width = shell.offsetWidth || host.offsetWidth;
      const height = shell.offsetHeight || host.offsetHeight;
      const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN;
      const maxTop = window.innerHeight - height - VIEWPORT_MARGIN;
      shell.style.left = `${clamp(left, VIEWPORT_MARGIN, maxLeft)}px`;
      shell.style.top = `${clamp(top, VIEWPORT_MARGIN, maxTop)}px`;
    }

    function applySavedPosition() {
      const saved = readPosition(surface);
      if (!saved) {
        shell.classList.remove("is-free");
        shell.style.removeProperty("left");
        shell.style.removeProperty("top");
        return;
      }
      shell.classList.add("is-free");
      const width = shell.offsetWidth || host.offsetWidth;
      const height = shell.offsetHeight || host.offsetHeight;
      const availableX = Math.max(0, window.innerWidth - width - VIEWPORT_MARGIN * 2);
      const availableY = Math.max(0, window.innerHeight - height - VIEWPORT_MARGIN * 2);
      setFreePosition(
        VIEWPORT_MARGIN + saved.x * availableX,
        VIEWPORT_MARGIN + saved.y * availableY
      );
    }

    function saveFreePosition(left, top) {
      const width = shell.offsetWidth;
      const height = shell.offsetHeight;
      const availableX = Math.max(1, window.innerWidth - width - VIEWPORT_MARGIN * 2);
      const availableY = Math.max(1, window.innerHeight - height - VIEWPORT_MARGIN * 2);
      const x = clamp((left - VIEWPORT_MARGIN) / availableX, 0, 1);
      const y = clamp((top - VIEWPORT_MARGIN) / availableY, 0, 1);
      localStorage.setItem(positionKey, JSON.stringify({ x, y }));
    }

    function snapAndSave() {
      const rect = shell.getBoundingClientRect();
      const rightGap = window.innerWidth - rect.right;
      const bottomGap = window.innerHeight - rect.bottom;
      let left = rect.left;
      let top = rect.top;
      if (rect.left < SNAP_DISTANCE) left = VIEWPORT_MARGIN;
      if (rightGap < SNAP_DISTANCE) left = window.innerWidth - rect.width - VIEWPORT_MARGIN;
      if (rect.top < SNAP_DISTANCE) top = VIEWPORT_MARGIN;
      if (bottomGap < SNAP_DISTANCE) top = window.innerHeight - rect.height - VIEWPORT_MARGIN;
      setFreePosition(left, top);
      const snapped = shell.getBoundingClientRect();
      saveFreePosition(snapped.left, snapped.top);
    }

    function resetPosition() {
      localStorage.removeItem(positionKey);
      closeMenu();
      applySavedPosition();
      setExpression("pleased", 1400);
      options.onReset?.();
    }

    function placeMenu() {
      const rect = shell.getBoundingClientRect();
      const menuWidth = menu.offsetWidth;
      const menuHeight = menu.offsetHeight;
      let left = rect.right + 9;
      if (left + menuWidth > window.innerWidth - VIEWPORT_MARGIN) {
        left = rect.left - menuWidth - 9;
      }
      if (left < VIEWPORT_MARGIN) {
        left = rect.left + rect.width / 2 - menuWidth / 2;
      }
      const top = clamp(
        rect.top,
        VIEWPORT_MARGIN,
        window.innerHeight - menuHeight - VIEWPORT_MARGIN
      );
      menu.style.left = `${clamp(left, VIEWPORT_MARGIN, window.innerWidth - menuWidth - VIEWPORT_MARGIN)}px`;
      menu.style.top = `${top}px`;
    }

    function openMenu() {
      refresh();
      menu.hidden = false;
      placeMenu();
      trigger.setAttribute("aria-expanded", "true");
      setExpression("curious", 0);
    }

    function closeMenu() {
      if (menu.hidden) return;
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      setExpression("calm", 0);
    }

    async function runAction(name, actionButton) {
      if (name === "home") return resetPosition();
      const handlers = {
        resume: options.onResumeThread
      };
      const handler = handlers[name];
      if (typeof handler !== "function") return;
      shell.classList.add("is-working");
      actionButton.disabled = true;
      try {
        const result = await handler();
        closeMenu();
        setExpression(result === false ? "wry" : "pleased", 1500);
      } catch (error) {
        setExpression("wry", 1700);
        options.onError?.(error);
      } finally {
        shell.classList.remove("is-working");
        actionButton.disabled = false;
      }
    }

    trigger.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      const rect = shell.getBoundingClientRect();
      drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        left: rect.left,
        top: rect.top,
        moved: false
      };
      try {
        trigger.setPointerCapture?.(event.pointerId);
      } catch {}
    });

    function moveDrag(event) {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      if (!drag.moved) {
        drag.moved = true;
        closeMenu();
        shell.classList.add("is-free", "is-dragging");
      }
      event.preventDefault();
      setFreePosition(drag.left + dx, drag.top + dy);
    }

    function finishDrag(event) {
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (drag.moved) {
        snapAndSave();
        shell.classList.remove("is-dragging");
        suppressClickUntil = Date.now() + 350;
        setExpression("pleased", 1200);
      }
      drag = null;
    }

    window.addEventListener("pointermove", moveDrag);
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);

    let dropHover = false;

    function dropTypesAccepted(dataTransfer) {
      const types = Array.from(dataTransfer?.types || []);
      return types.includes("Files") || types.includes("text/uri-list") || types.includes("text/plain");
    }

    function parseDropPayload(dataTransfer) {
      if (dataTransfer.files?.length) return { kind: "files" };
      const uriList = dataTransfer.getData("text/uri-list");
      const rawText = dataTransfer.getData("text/plain").trim();
      const uriCandidate = (uriList.split(/\r?\n/).find(line => line && !line.startsWith("#")) || "").trim();
      const single = uriCandidate || (!/\s/.test(rawText) ? rawText : "");
      if (single) {
        try {
          const url = new URL(single);
          if (["http:", "https:"].includes(url.protocol)) return { kind: "url", url: url.href };
        } catch {}
      }
      if (rawText) return { kind: "text", text: rawText };
      return null;
    }

    shell.addEventListener("dragenter", event => {
      if (!dropTypesAccepted(event.dataTransfer)) return;
      event.preventDefault();
      dropHover = true;
      closeMenu();
      shell.classList.add("is-catching");
      setExpression("curious", 0);
    });

    shell.addEventListener("dragover", event => {
      if (!dropTypesAccepted(event.dataTransfer)) return;
      event.preventDefault();
      dropHover = true;
    });

    shell.addEventListener("dragleave", event => {
      if (shell.contains(event.relatedTarget)) return;
      dropHover = false;
      shell.classList.remove("is-catching");
      setExpression("calm", 0);
    });

    shell.addEventListener("drop", async event => {
      if (!dropTypesAccepted(event.dataTransfer)) return;
      event.preventDefault();
      const payload = parseDropPayload(event.dataTransfer);
      shell.classList.remove("is-catching");
      setTimeout(() => { dropHover = false; }, 0);
      if (!payload) return setExpression("wry", 1300);
      // File drops are delivered with real paths by the surface's existing
      // dropped-file mechanism; the surface checks isDropHover() for routing.
      if (payload.kind === "files") return setExpression("pleased", 1500);
      if (typeof options.onCollect !== "function") return setExpression("wry", 1300);
      try {
        const result = await options.onCollect(payload);
        setExpression(result === false ? "wry" : "pleased", 1500);
      } catch (error) {
        setExpression("wry", 1700);
        options.onError?.(error);
      }
    });
    trigger.addEventListener("click", event => {
      if (Date.now() < suppressClickUntil) {
        event.preventDefault();
        return;
      }
      menu.hidden ? openMenu() : closeMenu();
    });

    menu.addEventListener("click", event => {
      const actionButton = event.target.closest("[data-bee-action]");
      if (!actionButton) return;
      runAction(actionButton.dataset.beeAction, actionButton);
    });

    document.addEventListener("pointerdown", event => {
      if (!shell.contains(event.target)) closeMenu();
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") closeMenu();
    });
    window.addEventListener("resize", () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        applySavedPosition();
        if (!menu.hidden) placeMenu();
      });
    });

    refresh();
    requestAnimationFrame(applySavedPosition);
    scheduleQuirk(QUIRK_DELAY);

    return {
      refresh,
      reset: resetPosition,
      celebrate: () => setExpression("pleased", 1500),
      isDropHover: () => dropHover
    };
  }

  window.HexBee = { mount };
})();
