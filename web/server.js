import "dotenv/config";
import express from "express";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dataFile = path.join(repoRoot, "data", "projects.json");
const publicDir = path.join(__dirname, "public");
const app = express();

const categories = {
  ai: { label: "AI / LLM", markdown: "projects/ai.md" },
  frontend: { label: "前端", markdown: "projects/frontend.md" },
  backend: { label: "后端", markdown: "projects/backend.md" },
  tools: { label: "工具与效率", markdown: "projects/tools.md" },
  "open-source-study": { label: "开源项目学习", markdown: "projects/open-source-study.md" }
};

app.use(express.json({ limit: "1mb" }));
app.use(express.static(publicDir));

app.get("/api/meta", (_req, res) => {
  res.json({
    categories,
    gitSync: process.env.GIT_SYNC === "true"
  });
});

app.get("/api/projects", async (_req, res, next) => {
  try {
    res.json(await readProjects());
  } catch (error) {
    next(error);
  }
});

app.post("/api/preview", requireAdmin, async (req, res, next) => {
  try {
    const repoRef = parseGitHubInput(req.body.url);
    const meta = await fetchGitHubRepo(repoRef.owner, repoRef.repo);
    res.json(toProjectDraft(meta, req.body.url));
  } catch (error) {
    next(error);
  }
});

app.post("/api/projects", requireAdmin, async (req, res, next) => {
  try {
    const repoRef = parseGitHubInput(req.body.url);
    const projects = await readProjects();
    const id = makeProjectId(repoRef.owner, repoRef.repo);

    if (projects.some((project) => project.id === id || project.url.toLowerCase() === `https://github.com/${repoRef.owner}/${repoRef.repo}`.toLowerCase())) {
      return res.status(409).json({ message: "这个项目已经收录过了。" });
    }

    const meta = await fetchGitHubRepo(repoRef.owner, repoRef.repo);
    const project = {
      ...toProjectDraft(meta, req.body.url),
      category: normalizeCategory(req.body.category),
      type: cleanText(req.body.type) || "GitHub 项目",
      tags: parseTags(req.body.tags).length ? parseTags(req.body.tags) : meta.topics,
      recommendation: cleanText(req.body.recommendation),
      useCase: cleanText(req.body.useCase),
      notes: cleanText(req.body.notes),
      addedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    projects.push(project);
    projects.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

    await writeProjects(projects);
    await appendProjectMarkdown(project);
    const sync = await maybeGitSync(project);

    res.status(201).json({ project, sync });
  } catch (error) {
    next(error);
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.use((error, _req, res, _next) => {
  const status = error.status || 500;
  res.status(status).json({
    message: error.publicMessage || error.message || "服务暂时不可用。"
  });
});

async function readProjects() {
  try {
    const raw = await readFile(dataFile, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeProjects(projects) {
  await mkdir(path.dirname(dataFile), { recursive: true });
  await writeFile(dataFile, `${JSON.stringify(projects, null, 2)}\n`, "utf8");
}

function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return res.status(503).json({ message: "服务端还没有设置 ADMIN_PASSWORD。" });
  }

  const provided = req.get("x-admin-password") || req.body.password;
  if (provided !== expected) {
    return res.status(401).json({ message: "管理密码不正确。" });
  }

  next();
}

function parseGitHubInput(input) {
  const value = String(input || "").trim();
  const markdownLink = value.match(/\((https:\/\/github\.com\/[^)]+)\)/i);
  const target = markdownLink ? markdownLink[1] : value;
  const shortRef = target.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);

  if (shortRef) {
    return { owner: shortRef[1], repo: shortRef[2].replace(/\.git$/i, "") };
  }

  let url;
  try {
    url = new URL(target);
  } catch {
    throw publicError("请输入 GitHub 仓库链接，例如 https://github.com/owner/repo。", 400);
  }

  if (url.hostname !== "github.com") {
    throw publicError("目前只支持 GitHub 仓库链接。", 400);
  }

  const [owner, repo] = url.pathname.split("/").filter(Boolean);
  if (!owner || !repo) {
    throw publicError("没有识别到 GitHub 仓库名。", 400);
  }

  return { owner, repo: repo.replace(/\.git$/i, "") };
}

async function fetchGitHubRepo(owner, repo) {
  const headers = {
    "Accept": "application/vnd.github+json",
    "User-Agent": "github-projects-and-articles"
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
  if (response.status === 404) {
    throw publicError("GitHub 上没有找到这个仓库。", 404);
  }
  if (!response.ok) {
    throw publicError(`GitHub API 请求失败：${response.status}`, response.status);
  }

  const data = await response.json();
  return {
    id: makeProjectId(data.owner.login, data.name),
    name: data.full_name,
    owner: data.owner.login,
    repo: data.name,
    url: data.html_url,
    description: data.description || "",
    homepage: data.homepage || "",
    stars: data.stargazers_count,
    language: data.language || "",
    topics: Array.isArray(data.topics) ? data.topics : []
  };
}

function toProjectDraft(meta, sourceUrl) {
  return {
    ...meta,
    sourceUrl: cleanText(sourceUrl) || meta.url,
    category: "tools",
    type: "GitHub 项目",
    tags: meta.topics,
    recommendation: "",
    useCase: "",
    notes: "",
    addedAt: "",
    updatedAt: ""
  };
}

async function appendProjectMarkdown(project) {
  const category = categories[project.category] || categories.tools;
  const markdownFile = path.join(repoRoot, category.markdown);
  let content = await readFile(markdownFile, "utf8");
  content = content.replace(/\n暂无。\s*$/u, "\n");

  const tags = project.tags.length ? project.tags.join(", ") : "未标注";
  const lines = [
    "",
    `## [${project.name}](${project.url})`,
    "",
    `- 类型：${project.type}`,
    `- 分类：${category.label}`,
    `- 标签：${tags}`,
    `- 推荐理由：${project.recommendation || project.description || "待补充。"}`,
    `- 适合场景：${project.useCase || "待补充。"}`,
  ];

  if (project.notes) {
    lines.push(`- 备注：${project.notes}`);
  }

  await writeFile(markdownFile, `${content.trimEnd()}\n${lines.join("\n")}\n`, "utf8");
}

async function maybeGitSync(project) {
  if (process.env.GIT_SYNC !== "true") {
    return { enabled: false };
  }

  const category = categories[project.category] || categories.tools;
  const files = ["data/projects.json", category.markdown];
  await execFileAsync("git", ["add", ...files], { cwd: repoRoot });

  try {
    await execFileAsync("git", ["commit", "-m", `Add curated project ${project.name}`], { cwd: repoRoot });
  } catch (error) {
    if (!String(error.stderr || error.message).includes("nothing to commit")) {
      throw error;
    }
  }

  const { stdout, stderr } = await execFileAsync("git", ["push"], { cwd: repoRoot });
  return { enabled: true, output: `${stdout}${stderr}`.trim() };
}

function normalizeCategory(value) {
  return categories[value] ? value : "tools";
}

function parseTags(value) {
  if (Array.isArray(value)) {
    return value.map(cleanText).filter(Boolean);
  }

  return String(value || "")
    .split(/[,，\n]/u)
    .map(cleanText)
    .filter(Boolean);
}

function cleanText(value) {
  return String(value || "").trim();
}

function makeProjectId(owner, repo) {
  return `${owner}-${repo}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function publicError(message, status = 500) {
  const error = new Error(message);
  error.publicMessage = message;
  error.status = status;
  return error;
}

const port = Number(process.env.PORT || 3027);
app.listen(port, () => {
  console.log(`GitHub collection web app listening on http://localhost:${port}`);
});

