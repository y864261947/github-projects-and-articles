const state = {
  projects: [],
  categories: {},
  activeCategory: "all",
  query: "",
  preview: null
};

const elements = {
  categoryNav: document.querySelector("#categoryNav"),
  projectList: document.querySelector("#projectList"),
  overview: document.querySelector("#overview"),
  searchInput: document.querySelector("#searchInput"),
  projectCount: document.querySelector("#projectCount"),
  syncMode: document.querySelector("#syncMode"),
  refreshButton: document.querySelector("#refreshButton"),
  focusFormButton: document.querySelector("#focusFormButton"),
  closeFormButton: document.querySelector("#closeFormButton"),
  editorPanel: document.querySelector("#editorPanel"),
  form: document.querySelector("#projectForm"),
  passwordInput: document.querySelector("#passwordInput"),
  urlInput: document.querySelector("#urlInput"),
  previewButton: document.querySelector("#previewButton"),
  repoPreview: document.querySelector("#repoPreview"),
  categoryInput: document.querySelector("#categoryInput"),
  typeInput: document.querySelector("#typeInput"),
  tagsInput: document.querySelector("#tagsInput"),
  recommendationInput: document.querySelector("#recommendationInput"),
  useCaseInput: document.querySelector("#useCaseInput"),
  notesInput: document.querySelector("#notesInput"),
  submitButton: document.querySelector("#submitButton"),
  statusLine: document.querySelector("#statusLine")
};

init();

async function init() {
  elements.passwordInput.value = localStorage.getItem("collectionPassword") || "";
  bindEvents();
  await loadAll();
  renderIcons();
}

function bindEvents() {
  elements.searchInput.addEventListener("input", (event) => {
    state.query = event.target.value.trim().toLowerCase();
    render();
  });

  elements.refreshButton.addEventListener("click", loadAll);
  elements.focusFormButton.addEventListener("click", () => elements.editorPanel.classList.add("open"));
  elements.closeFormButton.addEventListener("click", () => elements.editorPanel.classList.remove("open"));
  elements.previewButton.addEventListener("click", previewRepo);
  elements.form.addEventListener("submit", saveProject);
  elements.passwordInput.addEventListener("change", () => {
    localStorage.setItem("collectionPassword", elements.passwordInput.value);
  });
}

async function loadAll() {
  setStatus("正在加载项目...");
  const [meta, projects] = await Promise.all([
    fetchJson("/api/meta"),
    fetchJson("/api/projects")
  ]);

  state.categories = meta.categories;
  state.projects = projects;
  elements.syncMode.textContent = meta.gitSync ? "自动推送" : "本地写入";
  fillCategoryOptions();
  render();
  setStatus("");
}

function fillCategoryOptions() {
  const current = elements.categoryInput.value || "tools";
  elements.categoryInput.innerHTML = Object.entries(state.categories)
    .map(([value, category]) => `<option value="${escapeHtml(value)}">${escapeHtml(category.label)}</option>`)
    .join("");
  elements.categoryInput.value = state.categories[current] ? current : "tools";
}

function render() {
  renderNav();
  renderOverview();
  renderProjects();
  elements.projectCount.textContent = String(state.projects.length);
  renderIcons();
}

function renderNav() {
  const counts = countByCategory();
  const items = [
    ["all", "全部", state.projects.length],
    ...Object.entries(state.categories).map(([key, category]) => [key, category.label, counts[key] || 0])
  ];

  elements.categoryNav.innerHTML = items.map(([key, label, count]) => `
    <button class="nav-button ${state.activeCategory === key ? "active" : ""}" type="button" data-category="${escapeHtml(key)}">
      <span>${escapeHtml(label)}</span>
      <span class="count">${count}</span>
    </button>
  `).join("");

  elements.categoryNav.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeCategory = button.dataset.category;
      render();
    });
  });
}

function renderOverview() {
  const languages = new Set(state.projects.map((project) => project.language).filter(Boolean));
  const tags = new Set(state.projects.flatMap((project) => project.tags || []));
  const totalStars = state.projects.reduce((sum, project) => sum + (Number(project.stars) || 0), 0);
  const latest = [...state.projects].sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)))[0];

  elements.overview.innerHTML = [
    metric("项目", state.projects.length),
    metric("语言", languages.size),
    metric("标签", tags.size),
    metric("Stars", formatNumber(totalStars)),
    latest ? metric("最近", latest.name.split("/").pop()) : ""
  ].filter(Boolean).slice(0, 4).join("");
}

function renderProjects() {
  const projects = filteredProjects();
  if (!projects.length) {
    elements.projectList.innerHTML = `<div class="empty-state">没有匹配的项目。</div>`;
    return;
  }

  elements.projectList.innerHTML = projects.map((project) => {
    const tags = (project.tags || []).slice(0, 8);
    const category = state.categories[project.category]?.label || project.category;
    return `
      <article class="project-card">
        <img class="avatar" src="https://github.com/${escapeHtml(project.owner)}.png?size=104" alt="" loading="lazy" />
        <div>
          <div class="project-head">
            <div class="project-title">
              <a href="${escapeHtml(project.url)}" target="_blank" rel="noreferrer">${escapeHtml(project.name)}</a>
              <p>${escapeHtml(project.description || project.type || "暂无描述")}</p>
            </div>
            <div class="stats">
              <span class="stat" title="Stars"><i data-lucide="star"></i>${formatNumber(project.stars)}</span>
              <span class="stat" title="Language"><i data-lucide="code-2"></i>${escapeHtml(project.language || "N/A")}</span>
            </div>
          </div>
          <p class="summary">${escapeHtml(project.recommendation || project.useCase || "待补充推荐理由。")}</p>
          <div class="tag-row">
            <span class="category-pill">${escapeHtml(category)}</span>
            ${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function filteredProjects() {
  return state.projects.filter((project) => {
    const categoryMatched = state.activeCategory === "all" || project.category === state.activeCategory;
    const haystack = [
      project.name,
      project.description,
      project.recommendation,
      project.useCase,
      project.notes,
      project.language,
      ...(project.tags || [])
    ].join(" ").toLowerCase();
    return categoryMatched && (!state.query || haystack.includes(state.query));
  });
}

async function previewRepo() {
  const payload = formPayload();
  if (!payload.url) {
    setStatus("先输入 GitHub 链接。", "error");
    return;
  }

  await withBusy(elements.previewButton, async () => {
    setStatus("正在读取 GitHub 信息...");
    const preview = await fetchJson("/api/preview", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(payload)
    });

    state.preview = preview;
    elements.typeInput.value = elements.typeInput.value || preview.type;
    elements.tagsInput.value = (preview.tags || []).join(", ");
    renderPreview(preview);
    setStatus("已读取仓库信息。", "success");
  });
}

function renderPreview(project) {
  elements.repoPreview.innerHTML = `
    <div class="preview-avatar" style="background-image: url('https://github.com/${escapeHtml(project.owner)}.png?size=88')"></div>
    <div>
      <strong>${escapeHtml(project.name)}</strong>
      <p>${escapeHtml(project.description || project.url)}</p>
    </div>
  `;
}

async function saveProject(event) {
  event.preventDefault();
  const payload = formPayload();
  if (!payload.recommendation) {
    setStatus("推荐理由最好补一句，后面翻起来才有价值。", "error");
    return;
  }

  await withBusy(elements.submitButton, async () => {
    setStatus("正在保存...");
    const result = await fetchJson("/api/projects", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(payload)
    });

    localStorage.setItem("collectionPassword", payload.password);
    state.projects.push(result.project);
    elements.form.reset();
    elements.passwordInput.value = payload.password;
    elements.typeInput.value = "GitHub 项目";
    state.preview = null;
    renderPreview({ owner: "github", name: "保存成功", description: result.sync.enabled ? "已提交并推送到 GitHub。" : "已写入本地数据和 Markdown。", url: "" });
    render();
    setStatus(result.sync.enabled ? "已保存并推送。" : "已保存，当前未开启自动推送。", "success");
  });
}

function formPayload() {
  return {
    password: elements.passwordInput.value,
    url: elements.urlInput.value,
    category: elements.categoryInput.value,
    type: elements.typeInput.value,
    tags: elements.tagsInput.value,
    recommendation: elements.recommendationInput.value,
    useCase: elements.useCaseInput.value,
    notes: elements.notesInput.value
  };
}

function authHeaders() {
  return {
    "Content-Type": "application/json",
    "x-admin-password": elements.passwordInput.value
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(data.message || `请求失败：${response.status}`);
  }

  return data;
}

async function withBusy(button, task) {
  button.disabled = true;
  try {
    await task();
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    button.disabled = false;
    renderIcons();
  }
}

function countByCategory() {
  return state.projects.reduce((counts, project) => {
    counts[project.category] = (counts[project.category] || 0) + 1;
    return counts;
  }, {});
}

function metric(label, value) {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`;
}

function formatNumber(value) {
  if (value === null || value === undefined || value === "") return "N/A";
  const number = Number(value);
  if (!Number.isFinite(number)) return "N/A";
  if (number >= 1000) return `${(number / 1000).toFixed(number >= 10000 ? 0 : 1)}k`;
  return String(number);
}

function setStatus(message, type = "") {
  elements.statusLine.textContent = message;
  elements.statusLine.className = `status-line ${type}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

