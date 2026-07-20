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
    const clipId = `hexBeeBodyClip-${surface}`;
    return `
      <svg class="hex-bee-mark" viewBox="0 0 170 96" focusable="false" aria-hidden="true">
        <defs>
          <clipPath id="${clipId}">
            <ellipse cx="70" cy="58" rx="38" ry="23"></ellipse>
          </clipPath>
        </defs>
        <polygon class="hex-bee-cell" points="69,4 108,26 108,70 69,92 30,70 30,26"></polygon>
        <path class="hex-bee-loop" d="M116 59 C137 68 160 61 161 43 C162 27 146 19 132 23 C118 27 116 39 124 46 C133 53 147 49 152 40 C155 34 151 29 145 30 C140 31 138 35 140 39"></path>
        <circle class="hex-bee-loop-origin" cx="116" cy="59" r="2.2"></circle>
        <g class="hex-bee-flight">
          <path class="hex-bee-wing hex-bee-wing-left" d="M62 39 C47 30 44 11 57 8 C71 5 78 24 74 39 Z"></path>
          <path class="hex-bee-wing hex-bee-wing-right" d="M75 39 C75 18 87 5 99 12 C111 19 101 38 86 43 Z"></path>
          <path class="hex-bee-stinger" d="M106 52 L120 58 L107 66 Z"></path>
          <ellipse class="hex-bee-body-fill" cx="70" cy="58" rx="38" ry="23"></ellipse>
          <g class="hex-bee-stripes" clip-path="url(#${clipId})">
            <path d="M66 30 L63 87"></path>
            <path d="M87 31 L84 86"></path>
          </g>
          <ellipse class="hex-bee-body-outline" cx="70" cy="58" rx="38" ry="23"></ellipse>
          <path class="hex-bee-body-shine" d="M43 45 C51 38 60 36 68 37"></path>
          <g class="hex-bee-face">
            <g class="hex-bee-shades">
              <rect class="hex-bee-shade-left" x="36" y="48" width="14" height="10" rx="4"></rect>
              <rect class="hex-bee-shade-right" x="52" y="48" width="14" height="10" rx="4"></rect>
              <path d="M49 52 C51 51 52 51 54 52"></path>
              <path d="M36 51 L32 49"></path>
            </g>
            <path class="hex-bee-mouth hex-bee-smile" d="M41 64 C46 69 53 69 58 64"></path>
            <path class="hex-bee-mouth hex-bee-wry-mouth" d="M41 66 C46 63 52 68 58 64"></path>
            <circle class="hex-bee-cheek" cx="61" cy="65" r="1.6"></circle>
          </g>
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
        <section class="thread-bee-menu" aria-label="HEX capture actions" hidden>
          <span class="thread-bee-menu-label">Active Thread</span>
          <strong class="thread-bee-thread-name"></strong>
          <div class="thread-bee-actions">
            <button type="button" data-bee-action="pin">Pin clipboard</button>
            <button type="button" data-bee-action="next">Add next step</button>
            <button class="thread-bee-primary" type="button" data-bee-action="resume">Resume Thread</button>
          </div>
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
        pin: options.onPinClipboard,
        next: options.onAddNextStep,
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
      celebrate: () => setExpression("pleased", 1500)
    };
  }

  window.HexBee = { mount };
})();
