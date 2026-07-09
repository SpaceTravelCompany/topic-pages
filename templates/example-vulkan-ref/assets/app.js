(function () {
  const dataEl = document.getElementById("site-data");
  if (!dataEl) return;

  const { site, topics } = JSON.parse(dataEl.textContent);

  const mainPanel = document.getElementById("main");
  const eyebrowEl = document.getElementById("topic-eyebrow");
  const sectionTitleEl = document.getElementById("section-title");
  const tabsEl = document.getElementById("section-tabs");
  const tabsToggleBtn = document.getElementById("tabs-toggle");
  const viewportEl = document.getElementById("content-viewport");
  const counterEl = document.getElementById("sec-counter");
  const prevBtn = document.getElementById("sec-prev");
  const nextBtn = document.getElementById("sec-next");
  const navPanel = document.querySelector(".nav-panel");
  const navToggle = document.getElementById("nav-toggle");
  const navBackdrop = document.getElementById("nav-backdrop");
  const topicBtns = [...document.querySelectorAll(".topic-btn")];

  const STORAGE_PREFIX = (site && site.storagePrefix) || "topic-pages";
  const TABS_KEY = `${STORAGE_PREFIX}-tabs-visible`;
  const THEME_KEY = `${STORAGE_PREFIX}-theme`;
  const themeToggleBtn = document.getElementById("theme-toggle");

  const defaultTopic = site.sections[0]?.topics[0]?.slug ?? "";

  let currentTopic = defaultTopic;
  let currentSection = 0;
  let tabsVisible = localStorage.getItem(TABS_KEY) !== "false";
  let renderedTabsTopic = null;

  function getTheme() {
    return document.documentElement.dataset.theme === "light" ? "light" : "dark";
  }

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
    themeToggleBtn?.setAttribute(
      "aria-label",
      theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환",
    );
  }

  function highlightCode() {
    if (typeof Prism === "undefined") return;
    viewportEl.querySelectorAll("pre code").forEach((block) => {
      Prism.highlightElement(block);
    });
  }

  function updateHash() {
    const topic = topics[currentTopic];
    const section = topic?.sections[currentSection];
    const hash = section ? `#${currentTopic}/${section.id}` : `#${currentTopic}`;
    if (location.hash !== hash) {
      history.replaceState(null, "", hash);
    }
  }

  function parseHash() {
    const raw = location.hash.replace(/^#/, "");
    if (!raw || raw === "_home") return { topic: defaultTopic, sectionId: null };

    const slash = raw.indexOf("/");
    if (slash === -1) return { topic: raw, sectionId: null };

    return {
      topic: raw.slice(0, slash),
      sectionId: raw.slice(slash + 1),
    };
  }

  function setTabsVisible(visible) {
    tabsVisible = visible;
    localStorage.setItem(TABS_KEY, visible ? "true" : "false");
    mainPanel.classList.toggle("tabs-hidden", !visible);
    tabsToggleBtn.setAttribute("aria-expanded", String(visible));
    tabsToggleBtn.textContent = visible ? "섹션 숨기기" : "섹션 보기";
  }

  function closeMobileNav() {
    navPanel?.classList.remove("open");
    navBackdrop?.setAttribute("hidden", "");
  }

  function openMobileNav() {
    navPanel?.classList.add("open");
    navBackdrop?.removeAttribute("hidden");
  }

  function setActiveNav() {
    topicBtns.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.topic === currentTopic);
    });
  }

  function renderSectionTabs() {
    const topic = topics[currentTopic];
    if (!topic) return;

    if (renderedTabsTopic !== currentTopic) {
      tabsEl.innerHTML = topic.sections
        .map((sec, i) => {
          return `<button type="button" class="section-tab" role="tab" aria-selected="false" data-index="${i}">${escapeHtml(sec.title)}</button>`;
        })
        .join("");
      renderedTabsTopic = currentTopic;
    }

    tabsEl.querySelectorAll(".section-tab").forEach((btn, i) => {
      const active = i === currentSection;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", String(active));
    });
  }

  function renderContent() {
    const topic = topics[currentTopic];
    if (!topic) return;

    const section = topic.sections[currentSection];

    viewportEl.innerHTML = section?.html ?? "";
    viewportEl.scrollTop = 0;
    highlightCode();

    const total = topic.sections.length;
    counterEl.textContent = total ? `${currentSection + 1} / ${total}` : "";
    prevBtn.disabled = currentSection <= 0;
    nextBtn.disabled = currentSection >= total - 1;

    eyebrowEl.textContent = topic.title;
    sectionTitleEl.textContent = section?.title ?? topic.title;
    document.title = `${section?.title ?? topic.title} — ${site.title}`;

    renderSectionTabs();
    setActiveNav();
    updateHash();

    // Rebuild TOC for current topic (all sections)
    initToc(topic.sections);
  }

  function showTopic(slug, sectionId) {
    if (!topics[slug]) slug = defaultTopic;
    currentTopic = slug;

    let idx = 0;
    if (sectionId) {
      const found = topics[slug].sections.findIndex((s) => s.id === sectionId);
      if (found >= 0) idx = found;
    }
    currentSection = idx;
    closeMobileNav();
    renderContent();
  }

  function showSection(index) {
    const topic = topics[currentTopic];
    if (!topic || index < 0 || index >= topic.sections.length) return;
    currentSection = index;
    renderContent();
  }

  function escapeHtml(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  /* ── Copy code button (event delegation) ── */
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest(".copy-code-btn");
    if (!btn) return;
    const toolbar = btn.closest(".code-toolbar");
    if (!toolbar) return;
    const code = toolbar.querySelector("code");
    const text = code?.innerText ?? "";
    const toast = toolbar.querySelector(".copy-toast");

    function show(msg, ok) {
      if (!toast) return;
      toast.textContent = msg;
      toast.classList.add("show");
      btn.classList.toggle("success", ok);
      setTimeout(() => {
        toast.classList.remove("show");
        btn.classList.remove("success");
      }, 1600);
    }

    // 1st: Clipboard API
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        show("복사됨", true);
        return;
      } catch { /* fall through */ }
    }
    // 2nd: file:// fallback (execCommand)
    try {
      const range = document.createRange();
      range.selectNode(code);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      const ok = document.execCommand("copy");
      sel.removeAllRanges();
      show(ok ? "복사됨" : "Ctrl+C로 복사해 주세요", ok);
    } catch {
      show("Ctrl+C로 복사해 주세요", false);
    }
  });

  /* ── TOC (section-per-view model) ──
     Each TOC anchor stores the section index. Click navigates via showSection()
     instead of scrolling DOM headings (which don't exist for non-current sections).
  */

  function clearToc() {
    const panel = document.getElementById("toc-panel");
    if (panel) panel.innerHTML = "";
  }

  function initToc(sections) {
    clearToc();
    const panel = document.getElementById("toc-panel");
    if (!panel || !sections || sections.length === 0) return;

    const ul = document.createElement("ul");

    sections.forEach((sec, i) => {
      // Section h2
      const li = document.createElement("li");
      li.className = "depth-2";
      const a = document.createElement("a");
      a.href = "#" + sec.id;
      a.dataset.sectionIdx = i;
      a.dataset.tocTarget = sec.id;
      a.textContent = sec.title;
      a.classList.toggle("active", i === currentSection);
      li.appendChild(a);
      ul.appendChild(li);

      // h3/h4 within section (only shown when this section is active)
      if (sec.headings && i === currentSection) {
        sec.headings.forEach((h) => {
          if (h.depth < 3) return; // skip the virtual h2
          const subLi = document.createElement("li");
          subLi.className = "depth-" + h.depth;
          const subA = document.createElement("a");
          subA.href = "#" + h.id;
          subA.dataset.sectionIdx = i;
          subA.dataset.headingId = h.id;
          subA.textContent = h.text;
          subLi.appendChild(subA);
          ul.appendChild(subLi);
        });
      }
    });

    panel.appendChild(ul);

    // Click handler: navigate to section via showSection, then optionally scroll to sub-heading
    panel.addEventListener("click", (e) => {
      const a = e.target.closest("a[data-section-idx]");
      if (!a) return;
      e.preventDefault();
      const idx = parseInt(a.dataset.sectionIdx, 10);
      showSection(idx);
      // Close mobile TOC
      panel.classList.remove("open");
      document.getElementById("toc-toggle")?.setAttribute("aria-expanded", "false");
      // Scroll to sub-heading after section renders
      const headingId = a.dataset.headingId;
      if (headingId) {
        requestAnimationFrame(() => {
          const el = document.getElementById(headingId);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
    });
  }

  const tocToggleBtn = document.getElementById("toc-toggle");
  const tocPanel = document.getElementById("toc-panel");

  tocToggleBtn?.addEventListener("click", () => {
    const expanded = tocToggleBtn.getAttribute("aria-expanded") === "true";
    tocToggleBtn.setAttribute("aria-expanded", String(!expanded));
    tocPanel?.classList.toggle("open", !expanded);
  });

  topicBtns.forEach((btn) => {
    btn.addEventListener("click", () => showTopic(btn.dataset.topic));
  });

  tabsEl.addEventListener("click", (e) => {
    if (!(e.target instanceof Element)) return;
    const btn = e.target.closest(".section-tab");
    if (!btn || !tabsEl.contains(btn)) return;
    showSection(Number(btn.dataset.index));
  });

  tabsToggleBtn.addEventListener("click", () => setTabsVisible(!tabsVisible));

  themeToggleBtn?.addEventListener("click", () => {
    setTheme(getTheme() === "dark" ? "light" : "dark");
    highlightCode();
  });

  setTheme(getTheme());

  navToggle?.addEventListener("click", () => {
    if (navPanel?.classList.contains("open")) closeMobileNav();
    else openMobileNav();
  });

  navBackdrop?.addEventListener("click", closeMobileNav);

  prevBtn.addEventListener("click", () => showSection(currentSection - 1));
  nextBtn.addEventListener("click", () => showSection(currentSection + 1));

  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea, select")) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      showSection(currentSection - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      showSection(currentSection + 1);
    } else if (e.key === "Escape") {
      closeMobileNav();
    }
  });

  window.addEventListener("hashchange", () => {
    const { topic, sectionId } = parseHash();
    showTopic(topic, sectionId);
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 800) closeMobileNav();
  });

  setTabsVisible(tabsVisible);

  const initial = parseHash();
  showTopic(initial.topic, initial.sectionId);
})();
