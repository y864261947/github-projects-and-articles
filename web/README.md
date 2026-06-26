# GitHub 项目收录 Web

这是当前仓库的网页收录工具，用来浏览、搜索和添加 GitHub 项目。

## 本地运行

```bash
cd web
cp .env.example .env
npm install
npm start
```

默认访问：

```text
http://localhost:3027
```

## 环境变量

```env
PORT=3027
ADMIN_PASSWORD=change-me
GIT_SYNC=false
GITHUB_TOKEN=
```

- `ADMIN_PASSWORD`：后台收录时使用的管理密码。
- `GIT_SYNC`：设为 `true` 后，保存项目时自动 `git commit` 并 `git push`。
- `GITHUB_TOKEN`：可选。设置后 GitHub API 限额更高，也适合服务器稳定使用。

## 服务器部署建议

1. 将域名 `github.v2api.top` 的 A 记录指向服务器 IP。
2. 在服务器克隆本仓库。
3. 在 `web/.env` 设置管理密码和同步开关。
4. 使用 PM2 启动。
5. 使用 Nginx 反向代理到 `127.0.0.1:3027`。

## Nginx 示例

```nginx
server {
    listen 80;
    server_name github.v2api.top;

    location / {
        proxy_pass http://127.0.0.1:3027;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

