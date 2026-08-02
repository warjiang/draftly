# Draftly

Draftly 是一个支持多人协作的 AI 源码原型服务。用户通过 GitHub 登录，Pi 在隔离工作区中生成
Vite + React + TypeScript + Tailwind CSS + shadcn/ui 项目，并支持实时预览、源码修改、Git
版本回退和 ZIP 导出。

PostgreSQL 保存账号、会话、项目、版本和成员关系，S3 兼容对象存储保存包含 `.git` 的工作区
快照。项目成员分为 Owner、Editor 和 Viewer；Owner 可以按 GitHub 用户名邀请协作者。

## 所需镜像

开发和生产环境只使用以下私有基础镜像：

```text
crpi-a01fov5fxhl285uu.cn-shanghai.personal.cr.aliyuncs.com/warjiang/node:24.18.1-bookworm-slim
crpi-a01fov5fxhl285uu.cn-shanghai.personal.cr.aliyuncs.com/warjiang/postgres:17.6-bookworm
crpi-a01fov5fxhl285uu.cn-shanghai.personal.cr.aliyuncs.com/warjiang/minio-minio:RELEASE.2025-04-22T22-12-26Z
crpi-a01fov5fxhl285uu.cn-shanghai.personal.cr.aliyuncs.com/warjiang/minio-mc:RELEASE.2025-04-16T18-13-26Z
```

应用镜像发布到：

```text
crpi-a01fov5fxhl285uu.cn-shanghai.personal.cr.aliyuncs.com/warjiang/draftly:<tag>
```

应用镜像已预装 Pi CLI、Git、`fd` 和 `ripgrep`，运行时不需要再下载 Pi 的搜索工具。

运行 Compose 前先登录私有仓库：

```bash
docker login crpi-a01fov5fxhl285uu.cn-shanghai.personal.cr.aliyuncs.com
```

## GitHub OAuth

创建 GitHub OAuth App，并配置：

| 环境 | Homepage URL | Authorization callback URL |
| --- | --- | --- |
| 本地 | `http://127.0.0.1:4173` | `http://127.0.0.1:4173/api/auth/callback/github` |
| 生产 | `https://<domain>` | `https://<domain>/api/auth/callback/github` |

将 OAuth App 的 Client ID 和 Client Secret 分别写入 `GITHUB_CLIENT_ID` 和
`GITHUB_CLIENT_SECRET`。生产环境的 `BETTER_AUTH_URL` 必须是浏览器访问的 HTTPS 根地址。

## Docker Compose 本地开发

要求 Docker Engine 及 Compose v2。先认证 Pi CLI，并准备只读挂载目录：

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.83.0
pi
mkdir -p .draftly/pi
# 将已认证的 Pi 配置放入 .draftly/pi，或通过 PI_CONFIG_DIR 指向可写目录
```

`DRAFTLY_PI_PROVIDER` 和 `DRAFTLY_PI_MODEL` 只负责选择模型，不包含认证信息。使用内置的
Kimi For Coding 时，还需要在 `.env` 中配置：

```dotenv
DRAFTLY_PI_PROVIDER=kimi-coding
DRAFTLY_PI_MODEL=k3
KIMI_API_KEY=<your-kimi-api-key>
```

也可以在宿主机运行 `pi` 并通过 `/login` 登录，然后将生成的 `~/.pi/agent/` 复制到
`${PI_CONFIG_DIR}/agent/`。开发和生产容器都固定通过
`PI_CODING_AGENT_DIR=/home/node/.pi/agent` 读取该目录。该挂载必须可写，因为 Pi 会维护
model catalog、trust 状态并刷新凭据。生产宿主机应将目录权限限制为运行容器的 UID 1000：

```bash
sudo install -d -m 700 -o 1000 -g 1000 /opt/draftly/secrets/pi
```

可用以下命令确认凭据与模型：

```bash
docker compose -f compose.dev.yml exec app pi --list-models kimi-coding
```

启动完整开发环境：

```bash
export GITHUB_CLIENT_ID=<github-client-id>
export GITHUB_CLIENT_SECRET=<github-client-secret>
export PI_CONFIG_DIR="$PWD/.draftly/pi"
npm run docker:dev
```

打开 <http://127.0.0.1:4173>。开发 Compose 会启动应用、PostgreSQL、MinIO，创建 `draftly`
bucket 并执行数据库 migration。容器会在后台持续运行；源码以 bind mount 注入，编辑器使用
Vite HMR，服务端使用 `tsx watch`，保存代码后无需重启 Compose。PostgreSQL 位于
`127.0.0.1:5432`，MinIO API/Console 位于 `127.0.0.1:9000/9001`。需要查看日志时执行
`npm run docker:dev:logs`。

生成项目时的 `npm install` 默认使用 npm 官方 registry。网络受限时可在 `.env`、
`.env.production` 或启动命令中设置，例如：

```dotenv
NPM_CONFIG_REGISTRY=https://registry.npmmirror.com
```

依赖安装的 stdout/stderr 会以 `[draft:<id>:npm]` 前缀实时写入应用日志，可通过
`npm run docker:dev:logs` 查看。

```bash
npm run docker:dev        # 首次启动，或依赖/Dockerfile 变化后重建
npm run docker:dev:logs   # 跟踪应用日志，Ctrl-C 不会停止容器
npm run docker:dev:reload # 修改 .env 后重新创建 app 容器，不重建镜像
npm run docker:dev:down   # 停止容器，保留数据
npm run docker:dev:reset  # 停止容器并删除开发 volumes，会清空所有本地数据
```

`.env` 由 Docker Compose 在创建容器时读取，不支持热重载；修改后执行
`npm run docker:dev:reload`。不要使用 `docker compose restart app`，因为 restart 会继续使用
旧容器环境。若修改了依赖、Dockerfile 或 Compose 服务定义，则改用 `npm run docker:dev`。

如需不使用 Docker 运行应用，复制 `.env.example` 为 `.env`，确保 PostgreSQL、S3 bucket 和
Pi 配置已就绪，然后执行：

```bash
npm install
npm run db:migrate
npm run dev
```

## 生产部署

1. 复制 `.env.production.example` 为宿主机上的 `.env.production`，填写所有空值并生成高强度
   PostgreSQL、MinIO 和 Better Auth 密钥。
2. 创建仅 UID 1000 可读写的 Pi 配置目录，并通过 `PI_CONFIG_DIR` 指向它。
3. 将 HTTPS 反向代理转发到 `DRAFTLY_PORT`，不要直接暴露 PostgreSQL 或 MinIO。
4. 拉取镜像、执行 migration，再启动服务：

```bash
docker compose --env-file .env.production -f compose.prod.yml config
docker compose --env-file .env.production -f compose.prod.yml pull
docker compose --env-file .env.production -f compose.prod.yml run --rm migrate
docker compose --env-file .env.production -f compose.prod.yml up -d --remove-orphans
curl --fail https://<domain>/api/health/ready
```

生产应用以非 root 用户运行，根文件系统只读；PostgreSQL 和 MinIO 仅连接内部网络。应用端口是
唯一发布的端口。`/api/health/live` 检查进程存活，`/api/health/ready` 检查数据库和对象存储。

升级时修改 `DRAFTLY_IMAGE_TAG` 为不可变的 `sha-*` tag，并重复 pull、migration、up 和健康检查。
应用回滚只需恢复旧 tag 后重新部署；数据库 migration 不自动回滚，因此 migration 必须保持
向后兼容。日志可通过以下命令查看：

```bash
docker compose --env-file .env.production -f compose.prod.yml logs -f app
```

### 备份与恢复

数据库和 MinIO 必须同时备份。下列命令在部署目录执行：

```bash
# PostgreSQL 备份
docker compose --env-file .env.production -f compose.prod.yml exec -T postgres \
  pg_dump -U draftly -d draftly -Fc > draftly-postgres.dump

# PostgreSQL 恢复到空数据库
docker compose --env-file .env.production -f compose.prod.yml exec -T postgres \
  pg_restore --clean --if-exists -U draftly -d draftly < draftly-postgres.dump

# MinIO bucket 备份/恢复（宿主机需安装 mc）
mc mirror --overwrite <production-alias>/draftly ./draftly-bucket-backup
mc mirror --overwrite ./draftly-bucket-backup <production-alias>/draftly
```

恢复时应使用同一备份时间点的数据库和 bucket。`workspace-cache` volume 可安全重建，不需要备份。

## GitHub Actions

- `ci.yml`：构建、测试、PostgreSQL/MinIO 集成验证及生产镜像构建。
- `image.yml`：CI 成功后发布 `linux/amd64`、`linux/arm64` 的 SHA/edge 镜像；版本 tag 发布
  semver/latest，并生成 SBOM 和 provenance。
- `deploy.yml`：输入不可变镜像 tag，经 `production` Environment 审批后通过 SSH 部署。

仓库需要配置以下 Actions secrets：

```text
ALIYUN_REGISTRY_USERNAME
ALIYUN_REGISTRY_PASSWORD
DEPLOY_HOST
DEPLOY_USER
DEPLOY_PATH
DEPLOY_SSH_KEY
DEPLOY_KNOWN_HOSTS
PRODUCTION_ENV
```

`PRODUCTION_ENV` 是不含 `DRAFTLY_IMAGE_TAG` 的完整生产 env 内容。建议保护 `main` 分支并要求
CI 通过，同时为 `production` Environment 配置人工审批。

## 常用命令

```bash
npm run build
npm test
npm run smoke
npm run db:generate
npm run db:migrate
npm run db:studio
npm run docker:prod:config
```

## 权限与安全边界

- Owner 可编辑项目并管理成员和邀请；Editor 可编辑项目；Viewer 只能读取、预览和导出。
- 所有 draft 权限都通过其所属项目解析，非成员无法探测资源是否存在。
- 工作区快照拒绝绝对路径、路径穿越、符号/硬链接、超限文件数和超限展开体积。
- 对象存储凭证只存在于服务端，浏览器不会获得 bucket 权限。
- Pi 具有工作区内的源码读写和命令执行能力，但容器不是针对恶意生成代码的完整安全沙箱。
