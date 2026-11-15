/**
 * Minimalist Mission Interface — Lunar Landing Site Navigator.
 *
 * Designed per Docs/.agents/skills/design-taste-frontend:
 *   - The 3D Moon view is the dominant, unencumbered visual hero (100% viewport).
 *   - Minimalist floating top navbar with live telemetry and site/date status.
 *   - Floating Isle at Center-Bottom:
 *       • Quick action message chips that immediately update the 3D scene, camera,
 *         orbital geometry, and telemetry when clicked.
 *       • Conversational AI prompt input with instant interface mutation and Undo.
 *   - Compact floating popovers for LOLA Horizon chart, coordinates, and share.
 *   - Clean, quiet micro-interactions, dark translucent glass, zero visual clutter.
 */

import "./index.css";
import { createElement } from "lucide";
import {
  Activity,
  ChevronDown,
  Earth,
  Info,
  Link2,
  Loader,
  Moon,
  Pause,
  Play,
  Rocket,
  Send,
  Share,
  Sun,
  Undo2,
  X,
} from "lucide";
import {
  type ScenarioState,
  defaultScenario,
  readScenarioFromUrl,
  scenarioToUrl,
  scenarioToQuery,
  PRESET_SITES,
  siteLabel,
} from "./scenario";
import { LunarScene } from "./scene";
import { renderHorizonChart } from "./horizonChart";
import {
  skyAtForDate,
  horizonMaskForSite,
  horizonsVerifyUrl,
  maskElevationAt,
  horizontalPowerProxy,
} from "./science";
import {
  QUICK_ACTIONS,
  executeQuickAction,
  processMissionQuery,
  type ChatTurn,
} from "./aiAssistant";

/* ── DOM helper ── */

function el(tag: string, attrs: Record<string, string> = {}, ...children: (string | Node)[]): HTMLElement {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    element.setAttribute(key, value);
  }
  for (const child of children) {
    if (typeof child === "string") {
      element.appendChild(document.createTextNode(child));
    } else if (child) {
      element.appendChild(child);
    }
  }
  return element;
}

function clear(element: HTMLElement) {
  while (element.firstChild) element.removeChild(element.firstChild);
}

/** Strip lightweight markdown emphasis (e.g. **bold**) before rendering plain text. */
function plainText(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "$1");
}

function showToast(message: string, durationMs = 2500) {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = el("div", { id: "toast-container", class: "toast-container" });
    document.body.appendChild(container);
  }
  const toast = el("div", { class: "toast" }, createElement(Rocket, { class: "h-3.5 w-3.5 shrink-0 text-[var(--color-accent)]" }), " ", message);
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(-10px)";
    toast.style.transition = "all 0.2s ease";
    setTimeout(() => toast.remove(), 200);
  }, durationMs);
}

/* ── State ── */

let state: ScenarioState = defaultScenario();
let previousState: ScenarioState | null = null;
let scene: LunarScene | null = null;
let sceneContainerEl: HTMLElement | null = null;

// Chat thread state
let chatTurns: ChatTurn[] = [];
let previousChatTurns: ChatTurn[] | null = null;
let isThinking = false;
let chatTurnSeq = 0;

function nextChatId(prefix: string): string {
  return `${prefix}-${Date.now()}-${chatTurnSeq++}`;
}

function makeChatTurn(role: "user" | "assistant", text: string, canUndo: boolean): ChatTurn {
  return { id: nextChatId(role), role, text, timestamp: new Date().toISOString(), canUndo };
}

function setThinking(value: boolean): void {
  isThinking = value;
}

function pushChatTurn(turn: ChatTurn): void {
  chatTurns = [...chatTurns, turn];
}

// UI Panels
let isTelemetryOpen = false;
let isAdjustOpen = false;
let isPlayingDiurnal = false;
let diurnalIntervalId: number | null = null;
let diurnalSpeed = 1;

/* ── Main Render Entry ── */

async function render() {
  const root = document.getElementById("app");
  if (!root) return;

  const isFirstRender = !root.querySelector("#top-navbar");

  if (isFirstRender) {
    clear(root);
    buildMinimalistApp(root);
    await initSceneAndData();
  } else {
    updateTopNavbar();
    const sky = await skyAtForDate(state.site, state.dateUtc, state.hourUtc ?? 12);
    const { mask } = await horizonMaskForSite(state.site);
    if (scene) {
      scene.update(state.site, sky, mask);
      scene.setViewMode(state.viewMode);
    }
    if (isTelemetryOpen) renderTelemetryPopover();
    if (isAdjustOpen) renderAdjustPopover();
  }
}

/* ── Minimalist Shell Construction ── */

function buildMinimalistApp(root: HTMLElement) {
  root.appendChild(el("a", { href: "#scene-container", class: "skip-link" }, "Skip to 3D scene"));

  // 1. Full-screen 3D Scene Viewport
  sceneContainerEl = el("div", {
    id: "scene-container",
    class: "absolute inset-0 w-full h-full bg-black cursor-grab active:cursor-grabbing",
  });
  root.appendChild(sceneContainerEl);

  // 2. Floating Top Navbar
  root.appendChild(buildTopNavbar());

  // 3. Floating Isle (Center-Bottom AI & Mission Control Island)
  root.appendChild(buildFloatingIsle());

  // 4. Subtle Playback Scrubber (Floating just above the isle)
  root.appendChild(buildPlaybackHUD());

  // 5. Modals / Flyout Containers
  const flyouts = el("div", { id: "flyout-container", class: "pointer-events-none absolute inset-0 z-40" });
  root.appendChild(flyouts);
}

/* ── Floating Top Navbar ── */

function buildTopNavbar(): HTMLElement {
  const nav = el("header", {
    id: "top-navbar",
    class: "fixed top-3 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 glass-pill px-3 py-1.5 rounded-full text-xs font-medium text-[var(--color-text-primary)] max-w-[96vw]",
  });

  // Logo & Title
  const brand = el("div", { class: "flex items-center gap-1.5 pr-2 border-r border-[var(--color-border)]" },
    el("span", { class: "text-sm text-[var(--color-accent)]" }, createElement(Moon, { class: "h-4 w-4" })),
    el("span", { class: "font-bold tracking-wider text-[11px] uppercase text-[var(--color-text-primary)]" }, "Lunar Navigator"),
  );
  nav.appendChild(brand);

  // Interactive Target & Epoch Chip (Click opens Adjust Flyout)
  const siteDateBtn = el("button", {
    id: "nav-site-date-btn",
    class: "px-2.5 py-1 rounded-full bg-[var(--color-bg-elevated)]/60 hover:bg-[var(--color-bg-elevated)] text-[11px] font-mono flex items-center gap-2 transition-colors",
    "aria-label": "Click to change target site or mission epoch",
  },
    el("span", { id: "nav-site-label", class: "text-white font-semibold" }, siteLabel(state.site.id)),
    el("span", { class: "text-[var(--color-text-muted)]" }, "•"),
    el("span", { id: "nav-date-label", class: "text-[var(--color-accent)] font-semibold" }, `${state.dateUtc} ${String(state.hourUtc ?? 12).padStart(2, "0")}:00`),
    createElement(ChevronDown, { class: "h-3 w-3 text-[var(--color-text-muted)]" }),
  );
  siteDateBtn.addEventListener("click", () => toggleAdjustPopover());
  nav.appendChild(siteDateBtn);

  // View Mode Pill Toggle
  const viewToggle = el("div", { class: "flex items-center bg-[var(--color-bg-input)] rounded-full p-0.5 border border-[var(--color-border)] text-[10px]" });
  const ovBtn = el("button", {
    id: "nav-btn-overview",
    class: `px-2 py-0.5 rounded-full font-semibold transition-all ${state.viewMode === "overview" ? "bg-[var(--color-accent)] text-black" : "text-[var(--color-text-secondary)] hover:text-white"}`,
  }, "Overview");
  const sfBtn = el("button", {
    id: "nav-btn-surface",
    class: `px-2 py-0.5 rounded-full font-semibold transition-all ${state.viewMode === "site-level" ? "bg-[var(--color-accent)] text-black" : "text-[var(--color-text-secondary)] hover:text-white"}`,
  }, "Surface");

  ovBtn.addEventListener("click", () => {
    state = { ...state, viewMode: "overview" };
    scene?.setViewMode("overview");
    syncUrl();
    void render();
  });
  sfBtn.addEventListener("click", () => {
    state = { ...state, viewMode: "site-level" };
    scene?.setViewMode("site-level");
    syncUrl();
    void render();
  });
  viewToggle.appendChild(ovBtn);
  viewToggle.appendChild(sfBtn);
  nav.appendChild(viewToggle);

  // Live Telemetry Summary Pill (Click opens Telemetry Popover)
  const telemBtn = el("button", {
    id: "nav-telem-btn",
    class: "px-2.5 py-1 rounded-full bg-[var(--color-bg-elevated)]/60 hover:bg-[var(--color-bg-elevated)] font-mono text-[10px] flex items-center gap-2 transition-colors",
    "aria-label": "Click to view detailed LOLA horizon and orbital telemetry",
  },
    el("span", { id: "nav-sun-stat-icon", class: "flex items-center" }, createElement(Sun, { class: "h-3 w-3" })),
    el("span", { id: "nav-sun-stat", class: "text-[var(--color-sun)] font-bold" }, "Computing..."),
    el("span", { class: "text-[var(--color-text-muted)]" }, ""),
    el("span", { id: "nav-earth-stat-icon", class: "flex items-center" }, createElement(Earth, { class: "h-3 w-3" })),
    el("span", { id: "nav-earth-stat", class: "text-[var(--color-earth)] font-bold" }, ""),
    el("span", { class: "ml-1" }, createElement(Activity, { class: "h-3 w-3 text-[var(--color-text-muted)]" })),
  );
  telemBtn.addEventListener("click", () => toggleTelemetryPopover());
  nav.appendChild(telemBtn);

  // Share Button
  const shareBtn = el("button", {
    class: "p-1.5 rounded-full hover:bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] hover:text-white text-xs transition-colors",
    "aria-label": "Share scenario link",
  }, createElement(Link2, { class: "h-3.5 w-3.5" }));
  shareBtn.addEventListener("click", () => openShareModal());
  nav.appendChild(shareBtn);

  // Site Info Button
  const siteInfoBtn = el("button", {
    id: "nav-site-info-btn",
    class: "p-1.5 rounded-full hover:bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] hover:text-white text-xs transition-colors",
    "aria-label": "View landing site information",
  }, createElement(Info, { class: "h-3.5 w-3.5" }));
  siteInfoBtn.addEventListener("click", () => void openSiteInfoModal());
  nav.appendChild(siteInfoBtn);

  return nav;
}

function updateTopNavbar() {
  const siteLabelEl = document.getElementById("nav-site-label");
  const dateLabelEl = document.getElementById("nav-date-label");
  if (siteLabelEl) siteLabelEl.textContent = siteLabel(state.site.id);
  if (dateLabelEl) dateLabelEl.textContent = `${state.dateUtc} ${String(state.hourUtc ?? 12).padStart(2, "0")}:00`;

  const ovBtn = document.getElementById("nav-btn-overview");
  const sfBtn = document.getElementById("nav-btn-surface");
  if (ovBtn && sfBtn) {
    ovBtn.className = `px-2 py-0.5 rounded-full font-semibold transition-all ${
      state.viewMode === "overview" ? "bg-[var(--color-accent)] text-black" : "text-[var(--color-text-secondary)] hover:text-white"
    }`;
    sfBtn.className = `px-2 py-0.5 rounded-full font-semibold transition-all ${
      state.viewMode === "site-level" ? "bg-[var(--color-accent)] text-black" : "text-[var(--color-text-secondary)] hover:text-white"
    }`;
  }

  void updateNavbarTelemetry();
}

async function updateNavbarTelemetry() {
  const sunStat = document.getElementById("nav-sun-stat");
  const earthStat = document.getElementById("nav-earth-stat");
  const sunIconWrap = document.getElementById("nav-sun-stat-icon");
  const earthIconWrap = document.getElementById("nav-earth-stat-icon");
  if (!sunStat || !earthStat) return;

  const sky = await skyAtForDate(state.site, state.dateUtc, state.hourUtc ?? 12);
  const { mask } = await horizonMaskForSite(state.site);
  const sunElev = maskElevationAt(mask, sky.sunAzimuthDeg);
  const earthElev = maskElevationAt(mask, sky.earthAzimuthDeg);

  const sunIconEl = sky.sunElevationDeg > sunElev
    ? createElement(Sun, { class: "h-3 w-3" })
    : createElement(Moon, { class: "h-3 w-3 text-[var(--color-text-muted)]" });
  if (sunIconWrap) clear(sunIconWrap);
  sunIconWrap?.appendChild(sunIconEl);

  const sunSign = sky.sunElevationDeg >= 0 ? "+" : "";
  sunStat.textContent = `Sun ${sunSign}${sky.sunElevationDeg.toFixed(1)}°`;

  const earthClear = sky.earthElevationDeg > earthElev;
  const earthIconEl = createElement(Earth, { class: earthClear ? "h-3 w-3" : "h-3 w-3 text-[var(--color-misses)]" });
  if (earthIconWrap) clear(earthIconWrap);
  earthIconWrap?.appendChild(earthIconEl);

  earthStat.textContent = earthClear ? "Comms OK" : "Blocked";
  earthStat.className = earthClear ? "text-[var(--color-meets)] font-bold" : "text-[var(--color-misses)] font-bold";
}

/* ── Floating Isle (Center-Bottom AI & Mission Control) ── */

function buildFloatingIsle(): HTMLElement {
  const isle = el("div", {
    id: "floating-isle",
    class: "floating-isle flex flex-col p-2.5 gap-2",
  });

  // Row 1: Quick Action Messages / Pills
  const actionsRow = el("div", {
    id: "isle-quick-actions",
    class: "flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px] no-scrollbar",
  });

  for (const action of QUICK_ACTIONS) {
    const pill = el("button", {
      class: "px-2.5 py-1 rounded-full bg-[var(--color-bg-elevated)] hover:bg-[var(--color-accent)] hover:text-black text-[var(--color-text-secondary)] hover:font-bold border border-[var(--color-border)] whitespace-nowrap transition-all duration-150 active:scale-95",
      title: action.hint,
    }, createElement(action.icon, { class: "h-3 w-3" }), action.label);

    pill.addEventListener("click", () => {
      handleQuickActionClick(action.id);
    });

    actionsRow.appendChild(pill);
  }
  isle.appendChild(actionsRow);

  // Row 2: Response & Action Card (Collapsible)
  const responseBox = el("div", {
    id: "isle-response-box",
    class: "p-2.5 rounded-xl bg-[var(--color-bg-input)] border border-[var(--color-border)] text-xs text-[var(--color-text-primary)] space-y-1.5 transition-all duration-200 hidden",
  });
  isle.appendChild(responseBox);

  // Row 3: Input prompt bar
  const inputForm = el("form", { class: "flex items-center gap-2" });
  const input = el("input", {
    type: "text",
    id: "isle-input-prompt",
    placeholder: "Ask AI or type: 'Malapert', '2026-07-20', 'relax constraints', 'slip scan'...",
    class: "flex-1 rounded-xl bg-[var(--color-bg-input)] border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-primary)] focus:border-[var(--color-border-focus)] transition-colors",
  }) as HTMLInputElement;

  const submitBtn = el("button", {
    type: "submit",
    class: "w-8 h-8 rounded-xl bg-[var(--color-accent)] text-black font-bold flex items-center justify-center hover:bg-[var(--color-warning)] active:scale-95 transition-all",
    "aria-label": "Submit mission request",
  }, createElement(Send, { class: "h-4 w-4" }));

  inputForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const query = input.value.trim();
    if (query) {
      input.value = "";
      handleUserQuerySubmit(query);
    }
  });

  inputForm.appendChild(input);
  inputForm.appendChild(submitBtn);
  isle.appendChild(inputForm);

  return isle;
}

/** Immediate action execution when an already-made message or pill is clicked */
function handleQuickActionClick(actionId: string) {
  const action = QUICK_ACTIONS.find((a) => a.id === actionId);
  const promptText = action?.promptText ?? actionId;

  previousState = { ...state };
  previousChatTurns = [...chatTurns];
  pushChatTurn(makeChatTurn("user", promptText, true));

  const res = executeQuickAction(actionId, state);

  if (res.updatedScenario) {
    state = res.updatedScenario;
    syncUrl();
    void render();
    showToast(`Updated to ${siteLabel(state.site.id)}`);
  }

  pushChatTurn(makeChatTurn("assistant", res.replyText, true));
  renderIsleThread(res.actionToTrigger);
}

/** Handle free-form typed query */
async function handleUserQuerySubmit(query: string) {
  const trimmed = query.trim();
  if (!trimmed) return;

  previousState = { ...state };
  previousChatTurns = [...chatTurns];
  pushChatTurn(makeChatTurn("user", trimmed, true));
  setThinking(true);
  renderIsleThread();

  const res = processMissionQuery(trimmed, state);

  // Brief local latency so the thinking state is perceptible (offline rule engine).
  await new Promise((resolve) => setTimeout(resolve, 450));

  pushChatTurn(makeChatTurn("assistant", res.replyText, true));
  setThinking(false);

  if (res.updatedScenario) {
    state = res.updatedScenario;
    syncUrl();
    void render();
    showToast(`Scenario updated`);
  }

  renderIsleThread(res.actionToTrigger);
}

function renderIsleThread(actionTrigger?: "slip-search" | "area-check") {
  const box = document.getElementById("isle-response-box");
  if (!box) return;
  clear(box);
  box.classList.remove("hidden");

  const header = el("div", { class: "flex items-center justify-between" },
    el("span", { class: "text-[10px] font-bold text-[var(--color-accent)] uppercase tracking-wider" }, "Mission Update"),
    el("div", { class: "flex items-center gap-2" },
      previousState ? el("button", {
        class: "text-[10px] text-[var(--color-text-muted)] hover:text-white underline",
      }, createElement(Undo2, { class: "h-3 w-3" }), " Undo") : el("span", {}),
      el("button", {
        class: "text-xs text-[var(--color-text-muted)] hover:text-white p-0.5",
        "aria-label": "Dismiss message",
      }, createElement(X, { class: "h-3 w-3" })),
    ),
  );

  header.querySelectorAll("button")[0]?.addEventListener("click", () => {
    if (previousState) {
      state = { ...previousState };
      chatTurns = previousChatTurns ? [...previousChatTurns] : chatTurns;
      previousState = null;
      previousChatTurns = null;
      syncUrl();
      void render();
      showToast("Undone scenario change.");
    }
    renderIsleThread();
  });

  header.querySelectorAll("button")[1]?.addEventListener("click", () => {
    box.classList.add("hidden");
  });

  box.appendChild(header);

  // Chat thread turns
  const turnsEl = el("div", { id: "isle-chat-turns", class: "flex flex-col gap-1.5 max-h-44 overflow-y-auto pr-0.5" });

  for (const turn of chatTurns) {
    const bubble = el("div", { class: `flex ${turn.role === "user" ? "justify-end" : "justify-start"}` },
      turn.role === "user"
        ? el("div", { class: "max-w-[85%] rounded-2xl rounded-br-md bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/30 px-2.5 py-1.5" },
            el("div", { class: "text-[11px] text-[var(--color-text-primary)]" }, plainText(turn.text)),
          )
        : el("div", { class: "max-w-[90%] px-1.5" },
            el("div", { class: "text-[11px] leading-relaxed text-[var(--color-text-secondary)]" }, plainText(turn.text)),
          ),
    );
    turnsEl.appendChild(bubble);
  }

  if (isThinking) {
    turnsEl.appendChild(el("div", { class: "flex justify-start" },
      el("div", { class: "flex items-center gap-1.5 px-2.5 py-1.5 rounded-2xl rounded-tl-md bg-[var(--color-bg-elevated)] border border-[var(--color-border)]" },
        createElement(Loader, { class: "h-3 w-3 animate-spin" }),
        el("span", { class: "text-[11px] text-[var(--color-text-secondary)]" }, "Analyzing mission context…"),
      ),
    ));
  }

  box.appendChild(turnsEl);

  // If action to trigger (e.g. slip scan or area check), run inline!
  if (actionTrigger === "slip-search") {
    runInlineSlipSearch(box);
  } else if (actionTrigger === "area-check") {
    runInlineAreaCheck(box);
  }
}

async function runInlineSlipSearch(container: HTMLElement) {
  const resultsDiv = el("div", { class: "pt-1 text-[10px] text-[var(--color-accent)] animate-pulse" }, "Scanning candidate dates...");
  container.appendChild(resultsDiv);

  try {
    const { sampleDailyWindows } = await import("./science");
    const samples = await sampleDailyWindows(state.site, state.dateUtc, state.hourUtc ?? 12, 30, state.constraints);
    clear(resultsDiv);
    resultsDiv.classList.remove("animate-pulse");

    const nextSuitable = samples.find((s) => s.verdict === "meets" && s.dateUtc > state.dateUtc);
    if (nextSuitable) {
      const banner = el("div", { class: "p-2 rounded bg-[var(--color-meets)]/15 border border-[var(--color-meets)]/30 flex items-center justify-between" },
        el("span", { class: "text-[var(--color-meets)] font-bold" }, `${nextSuitable.dateUtc} (Sun ${nextSuitable.sunElevationDeg.toFixed(1)}°)`),
        el("button", {
          class: "px-2 py-0.5 rounded bg-[var(--color-meets)] text-white font-semibold text-[10px]",
        }, "Jump"),
      );
      banner.querySelector("button")?.addEventListener("click", () => {
        state = { ...state, dateUtc: nextSuitable.dateUtc };
        syncUrl();
        void render();
        showToast(`Jumped to ${nextSuitable.dateUtc}`);
      });
      resultsDiv.appendChild(banner);
    } else {
      resultsDiv.textContent = "No meeting dates found in 30 days under current constraints.";
    }
  } catch (e) {
    resultsDiv.textContent = `Error: ${e}`;
  }
}

async function runInlineAreaCheck(container: HTMLElement) {
  const resultsDiv = el("div", { class: "pt-1 text-[10px] text-[var(--color-accent)] animate-pulse" }, "Checking 3 km dispersion radius...");
  container.appendChild(resultsDiv);

  try {
    const { checkLandingArea } = await import("./science");
    const res = await checkLandingArea(state.site, state.dateUtc, state.hourUtc ?? 12, 3, state.constraints);
    clear(resultsDiv);
    resultsDiv.classList.remove("animate-pulse");

    const pct = Math.round((res.meets / res.total) * 100);
    const summary = el("div", { class: "p-2 rounded bg-[var(--color-bg-elevated)] border border-[var(--color-border)] flex items-center justify-between" },
      el("div", {},
        el("span", { class: `font-bold ${pct >= 80 ? "text-[var(--color-meets)]" : "text-[var(--color-warning)]"}` }, `${pct}% Meets Constraints `),
        el("span", { class: "text-[var(--color-text-muted)]" }, `(${res.meets}/${res.total} sample points)`),
      ),
      el("span", { class: "font-mono text-[9px] text-[var(--color-sun)]" }, `Sun: ${res.sunElevMin.toFixed(1)}° – ${res.sunElevMax.toFixed(1)}°`),
    );
    resultsDiv.appendChild(summary);
  } catch (e) {
    resultsDiv.textContent = `Error: ${e}`;
  }
}

/* ── Minimalist Diurnal Playback HUD ── */

function buildPlaybackHUD(): HTMLElement {
  const hud = el("div", {
    id: "playback-hud",
    class: "fixed bottom-[88px] left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 glass-pill px-3 py-1 rounded-full text-xs",
  });

  // Play / Pause Button
  const playBtn = el("button", {
    id: "hud-play-btn",
    class: "w-5 h-5 rounded-full bg-[var(--color-accent)] text-black font-bold flex items-center justify-center text-[10px] hover:scale-105 transition-transform",
    "aria-label": "Play diurnal sun cycle",
  }, createElement(Play, { class: "h-3 w-3" }));
  playBtn.addEventListener("click", toggleDiurnalPlayback);
  hud.appendChild(playBtn);

  // Hour Scrubber Slider
  const slider = el("input", {
    type: "range",
    id: "hud-hour-slider",
    min: "0",
    max: "23",
    value: String(state.hourUtc ?? 12),
    class: "w-28 cursor-pointer",
  }) as HTMLInputElement;

  slider.addEventListener("input", () => {
    const h = parseInt(slider.value, 10);
    setHourUtc(h);
  });
  hud.appendChild(slider);

  // Hour Readout
  const hourText = el("span", {
    id: "hud-hour-text",
    class: "font-mono text-[11px] text-[var(--color-accent)] font-semibold w-12 text-center",
  }, `${String(state.hourUtc ?? 12).padStart(2, "0")}:00`);
  hud.appendChild(hourText);

  // Speed Multiplier
  const speedBtn = el("button", {
    id: "hud-speed-btn",
    class: "text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] hover:text-white",
  }, "1x");
  speedBtn.addEventListener("click", () => {
    diurnalSpeed = diurnalSpeed === 1 ? 5 : diurnalSpeed === 5 ? 30 : 1;
    speedBtn.textContent = `${diurnalSpeed}x`;
    if (isPlayingDiurnal) restartDiurnalPlayback();
  });
  hud.appendChild(speedBtn);

  return hud;
}

function setHourUtc(hour: number) {
  state = { ...state, hourUtc: hour };
  const slider = document.getElementById("hud-hour-slider") as HTMLInputElement | null;
  const hourText = document.getElementById("hud-hour-text");
  if (slider) slider.value = String(hour);
  if (hourText) hourText.textContent = `${String(hour).padStart(2, "0")}:00`;
  syncUrl();
  void render();
}

function toggleDiurnalPlayback() {
  isPlayingDiurnal = !isPlayingDiurnal;
  const playBtn = document.getElementById("hud-play-btn");
  if (playBtn) {
    playBtn.textContent = "";
    playBtn.appendChild(isPlayingDiurnal ? createElement(Pause, { class: "h-3 w-3" }) : createElement(Play, { class: "h-3 w-3" }));
  }

  if (isPlayingDiurnal) startDiurnalInterval();
  else stopDiurnalInterval();
}

function startDiurnalInterval() {
  stopDiurnalInterval();
  const delay = 60_000 / diurnalSpeed;
  diurnalIntervalId = window.setInterval(() => {
    const cur = state.hourUtc ?? 12;
    const next = (cur + 1) % 24;
    setHourUtc(next);
  }, delay);
}

function restartDiurnalPlayback() {
  if (isPlayingDiurnal) startDiurnalInterval();
}

function stopDiurnalInterval() {
  if (diurnalIntervalId !== null) {
    clearInterval(diurnalIntervalId);
    diurnalIntervalId = null;
  }
}

/* ── Floating Popovers (Telemetry & Adjust) ── */

function toggleTelemetryPopover() {
  isTelemetryOpen = !isTelemetryOpen;
  if (isTelemetryOpen) isAdjustOpen = false;
  renderTelemetryPopover();
}

function toggleAdjustPopover() {
  isAdjustOpen = !isAdjustOpen;
  if (isAdjustOpen) isTelemetryOpen = false;
  renderAdjustPopover();
}

async function renderTelemetryPopover() {
  const container = document.getElementById("flyout-container");
  if (!container) return;
  const existing = document.getElementById("telemetry-popover");
  if (existing) existing.remove();

  if (!isTelemetryOpen) return;

  const sky = await skyAtForDate(state.site, state.dateUtc, state.hourUtc ?? 12);
  const { mask } = await horizonMaskForSite(state.site);
  const sunElev = maskElevationAt(mask, sky.sunAzimuthDeg);
  const earthElev = maskElevationAt(mask, sky.earthAzimuthDeg);
  const sunAboveMask = sky.sunElevationDeg > sunElev;
  const earthAboveMask = sky.earthElevationDeg > earthElev;
  const powerProxy = horizontalPowerProxy(sky.sunElevationDeg, sunAboveMask);

  const popover = el("div", {
    id: "telemetry-popover",
    class: "pointer-events-auto fixed top-14 right-6 w-[360px] glass-pill rounded-2xl p-4 text-xs space-y-3 z-50",
  });

  const header = el("div", { class: "flex items-center justify-between border-b border-[var(--color-border)] pb-2" },
    el("span", { class: "font-bold text-[var(--color-accent)] uppercase text-[10px] tracking-wider" }, "LOLA Horizon & Telemetry"),
    el("button", {
      class: "text-xs text-[var(--color-text-muted)] hover:text-white p-1",
    }, createElement(X, { class: "h-3 w-3" })),
  );
  header.querySelector("button")?.addEventListener("click", () => {
    isTelemetryOpen = false;
    popover.remove();
  });
  popover.appendChild(header);

  // SVG Chart
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "100%");
  svg.style.height = "150px";
  popover.appendChild(svg);
  renderHorizonChart(svg, mask, sky);

  // Metrics Grid
  const grid = el("div", { class: "grid grid-cols-2 gap-2 font-mono text-[10px]" },
    el("div", { class: "bg-[var(--color-bg-input)] p-2 rounded" },
      el("div", { class: "text-[var(--color-text-muted)]" }, "Sun Elevation"),
      el("div", { class: "text-sm font-bold text-[var(--color-sun)]" }, `${sky.sunElevationDeg.toFixed(1)}°`),
      el("div", { class: "text-[9px] text-[var(--color-text-secondary)]" }, `Az: ${sky.sunAzimuthDeg.toFixed(0)}°`),
    ),
    el("div", { class: "bg-[var(--color-bg-input)] p-2 rounded" },
      el("div", { class: "text-[var(--color-text-muted)]" }, "Earth Elevation"),
      el("div", { class: "text-sm font-bold text-[var(--color-earth)]" }, `${sky.earthElevationDeg.toFixed(1)}°`),
      el("div", { class: "text-[9px] text-[var(--color-text-secondary)]" }, `Az: ${sky.earthAzimuthDeg.toFixed(0)}°`),
    ),
  );
  popover.appendChild(grid);

  // Comms & Power
  const assessment = el("div", { class: "space-y-1.5 pt-1 text-[11px]" },
    el("div", { class: "flex justify-between" },
      el("span", { class: "text-[var(--color-text-muted)]" }, "Solar Power Proxy:"),
      el("span", { class: "font-mono font-bold text-white" }, `${Math.round(powerProxy * 100)}%`),
    ),
    el("div", { class: "flex justify-between" },
      el("span", { class: "text-[var(--color-text-muted)]" }, "Earth Line-of-Sight:"),
      el("span", {
        class: earthAboveMask ? "text-[var(--color-meets)] font-semibold" : "text-[var(--color-misses)] font-semibold",
      }, earthAboveMask ? "Clear Link" : "Obstructed by Ridge"),
    ),
  );
  popover.appendChild(assessment);

  const sunVerifyUrl = horizonsVerifyUrl(state.site, state.dateUtc, "sun");
  const linkRow = el("div", { class: "pt-2 border-t border-[var(--color-border)] flex justify-between" },
    el("a", {
      href: sunVerifyUrl,
      target: "_blank",
      rel: "noopener",
      class: "text-[10px] text-[var(--color-accent)] hover:underline",
    }, "Verify in NASA JPL Horizons"),
  );
  popover.appendChild(linkRow);

  container.appendChild(popover);
}

function renderAdjustPopover() {
  const container = document.getElementById("flyout-container");
  if (!container) return;
  const existing = document.getElementById("adjust-popover");
  if (existing) existing.remove();

  if (!isAdjustOpen) return;

  const popover = el("div", {
    id: "adjust-popover",
    class: "pointer-events-auto fixed top-14 left-1/2 -translate-x-1/2 w-[340px] glass-pill rounded-2xl p-4 text-xs space-y-3 z-50",
  });

  const header = el("div", { class: "flex items-center justify-between border-b border-[var(--color-border)] pb-2" },
    el("span", { class: "font-bold text-[var(--color-accent)] uppercase text-[10px] tracking-wider" }, "Adjust Target & Epoch"),
    el("button", {
      class: "text-xs text-[var(--color-text-muted)] hover:text-white p-1",
    }, createElement(X, { class: "h-3 w-3" })),
  );
  header.querySelector("button")?.addEventListener("click", () => {
    isAdjustOpen = false;
    popover.remove();
  });
  popover.appendChild(header);

  // Preset Site Dropdown
  const siteSelect = el("select", {
    class: "w-full rounded-lg bg-[var(--color-bg-input)] border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-white",
  }) as HTMLSelectElement;

  for (const site of PRESET_SITES) {
    const opt = el("option", { value: site.id }, `${siteLabel(site.id)} (${site.latDeg}°, ${site.eastLonDeg}°)`);
    if (site.id === state.site.id) opt.setAttribute("selected", "");
    siteSelect.appendChild(opt);
  }

  siteSelect.addEventListener("change", () => {
    const sel = PRESET_SITES.find((s) => s.id === siteSelect.value);
    if (sel) {
      previousState = { ...state };
      state = { ...state, site: sel };
      syncUrl();
      void render();
      showToast(`Selected ${siteLabel(sel.id)}`);
    }
  });
  popover.appendChild(siteSelect);

  // Coordinates row
  const coordRow = el("div", { class: "grid grid-cols-2 gap-2" });
  const lonInp = el("input", {
    type: "number",
    step: "0.01",
    value: state.site.eastLonDeg.toString(),
    placeholder: "Lon °E",
    class: "rounded bg-[var(--color-bg-input)] border border-[var(--color-border)] px-2 py-1 text-xs font-mono text-white",
  }) as HTMLInputElement;

  const latInp = el("input", {
    type: "number",
    step: "0.01",
    value: state.site.latDeg.toString(),
    placeholder: "Lat °N",
    class: "rounded bg-[var(--color-bg-input)] border border-[var(--color-border)] px-2 py-1 text-xs font-mono text-white",
  }) as HTMLInputElement;

  coordRow.appendChild(lonInp);
  coordRow.appendChild(latInp);
  popover.appendChild(coordRow);

  const applyCoordBtn = el("button", {
    class: "w-full py-1 rounded bg-[var(--color-bg-elevated)] hover:bg-[var(--color-border)] font-semibold text-[11px] text-white transition-colors",
  }, "Apply Custom Coords");
  applyCoordBtn.addEventListener("click", () => {
    const lon = parseFloat(lonInp.value);
    const lat = parseFloat(latInp.value);
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      previousState = { ...state };
      state = { ...state, site: { id: "custom", eastLonDeg: lon, latDeg: lat } };
      syncUrl();
      void render();
      showToast("Applied custom coordinates.");
    }
  });
  popover.appendChild(applyCoordBtn);

  // Date picker
  const datePicker = el("input", {
    type: "date",
    value: state.dateUtc,
    min: "2026-01-01",
    max: "2026-12-31",
    class: "w-full rounded bg-[var(--color-bg-input)] border border-[var(--color-border)] px-2.5 py-1.5 text-xs font-mono text-white",
  }) as HTMLInputElement;
  datePicker.addEventListener("change", () => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(datePicker.value)) {
      previousState = { ...state };
      state = { ...state, dateUtc: datePicker.value };
      syncUrl();
      void render();
    }
  });
  popover.appendChild(datePicker);

  container.appendChild(popover);
}

/* ── Share Modal ── */

function openShareModal() {
  const url = scenarioToUrl(state);
  const backdrop = el("div", { class: "modal-backdrop" });
  const modal = el("div", {
    class: "w-[440px] max-w-[95vw] glass-pill rounded-2xl p-5 space-y-4 shadow-2xl text-xs",
    role: "dialog",
  });

  const header = el("div", { class: "flex items-center justify-between border-b border-[var(--color-border)] pb-2" },
    el("span", { class: "flex items-center gap-1.5 font-bold text-[var(--color-accent)] text-xs uppercase tracking-wider" }, createElement(Share, { class: "h-3.5 w-3.5" }), " Share Mission Scenario"),
    el("button", { class: "text-sm text-[var(--color-text-muted)] hover:text-white" }, createElement(X, { class: "h-4 w-4" })),
  );
  header.querySelector("button")?.addEventListener("click", () => backdrop.remove());
  modal.appendChild(header);

  const inp = el("input", {
    type: "text",
    readonly: "",
    value: url,
    class: "w-full rounded-lg bg-[var(--color-bg-input)] border border-[var(--color-border)] px-3 py-2 font-mono text-[11px] text-white",
  }) as HTMLInputElement;
  modal.appendChild(inp);

  const copyBtn = el("button", {
    class: "w-full py-2 rounded-lg bg-[var(--color-accent)] text-black font-bold text-xs hover:bg-[var(--color-warning)] transition-colors",
  }, "Copy Scenario Link");

  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(url);
      copyBtn.textContent = "Copied!";
      showToast("Link copied to clipboard!");
      setTimeout(() => backdrop.remove(), 800);
    } catch {
      inp.select();
      document.execCommand("copy");
    }
  });
  modal.appendChild(copyBtn);

  backdrop.appendChild(modal);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) backdrop.remove();
  });
  document.body.appendChild(backdrop);
}

/* ── Site Info Modal ── */

async function openSiteInfoModal() {
  const sky = await skyAtForDate(state.site, state.dateUtc, state.hourUtc ?? 12);
  const { mask } = await horizonMaskForSite(state.site);
  const sunElev = maskElevationAt(mask, sky.sunAzimuthDeg);
  const earthElev = maskElevationAt(mask, sky.earthAzimuthDeg);
  const earthAboveMask = sky.earthElevationDeg > earthElev;

  const backdrop = el("div", { class: "modal-backdrop" });
  const modal = el("div", {
    class: "w-[420px] max-w-[95vw] glass-pill rounded-2xl p-5 space-y-4 shadow-2xl text-xs",
    role: "dialog",
    "aria-label": "Landing site information",
  });

  const header = el("div", { class: "flex items-center justify-between border-b border-[var(--color-border)] pb-2" },
    el("span", { class: "flex items-center gap-1.5 font-bold text-[var(--color-accent)] text-xs uppercase tracking-wider" }, createElement(Info, { class: "h-3.5 w-3.5" }), " Landing Site Info"),
    el("button", { class: "text-sm text-[var(--color-text-muted)] hover:text-white", "aria-label": "Close site info" }, createElement(X, { class: "h-4 w-4" })),
  );
  header.querySelector("button")?.addEventListener("click", () => backdrop.remove());
  modal.appendChild(header);

  const rows = el("div", { class: "space-y-2" },
    el("div", { class: "flex justify-between" },
      el("span", { class: "text-[var(--color-text-muted)]" }, "Site"),
      el("span", { class: "font-semibold text-[var(--color-text-primary)]" }, siteLabel(state.site.id)),
    ),
    el("div", { class: "flex justify-between" },
      el("span", { class: "text-[var(--color-text-muted)]" }, "Coordinates"),
      el("span", { class: "font-mono text-[var(--color-text-primary)]" }, `${state.site.latDeg.toFixed(2)}°, ${state.site.eastLonDeg.toFixed(2)}°`),
    ),
    el("div", { class: "flex justify-between" },
      el("span", { class: "text-[var(--color-text-muted)]" }, "Epoch"),
      el("span", { class: "font-mono text-[var(--color-text-primary)]" }, `${state.dateUtc} ${String(state.hourUtc ?? 12).padStart(2, "0")}:00 UTC`),
    ),
    el("div", { class: "flex justify-between" },
      el("span", { class: "text-[var(--color-text-muted)]" }, "Sun Elevation"),
      el("span", { class: `font-mono font-bold ${sky.sunElevationDeg > sunElev ? "text-[var(--color-sun)]" : "text-[var(--color-text-secondary)]"}` }, `${sky.sunElevationDeg.toFixed(1)}°`),
    ),
    el("div", { class: "flex justify-between" },
      el("span", { class: "text-[var(--color-text-muted)]" }, "Earth Elevation"),
      el("span", { class: `font-mono font-bold ${earthAboveMask ? "text-[var(--color-meets)]" : "text-[var(--color-misses)]"}` }, `${sky.earthElevationDeg.toFixed(1)}°`),
    ),
  );
  modal.appendChild(rows);

  const closeBtn = el("button", {
    class: "w-full py-2 rounded-lg bg-[var(--color-bg-elevated)] hover:bg-[var(--color-border)] font-semibold text-[11px] text-white transition-colors",
  }, "Close");
  closeBtn.addEventListener("click", () => backdrop.remove());
  modal.appendChild(closeBtn);

  backdrop.appendChild(modal);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) backdrop.remove();
  });
  document.body.appendChild(backdrop);
}


/* ── Scene Initialization ── */

async function initSceneAndData() {
  if (sceneContainerEl) {
    const sky = await skyAtForDate(state.site, state.dateUtc, state.hourUtc ?? 12);
    const { mask } = await horizonMaskForSite(state.site);
    scene = new LunarScene({
      container: sceneContainerEl,
      site: state.site,
      skyState: sky,
      mask,
      viewMode: state.viewMode,
    });
  }
  updateTopNavbar();
}

/* ── URL Sync ── */

function syncUrl() {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(scenarioToQuery(state));
  window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
}

/* ── Global Listeners ── */

window.addEventListener("resize", () => {
  scene?.resize();
});

document.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

  if (e.code === "Space") {
    e.preventDefault();
    toggleDiurnalPlayback();
  } else if (e.key === "Escape") {
    isTelemetryOpen = false;
    isAdjustOpen = false;
    document.getElementById("telemetry-popover")?.remove();
    document.getElementById("adjust-popover")?.remove();
  }
});

/* ── Init ── */

state = readScenarioFromUrl();
render().catch((e) => console.error("Render failed:", e));
