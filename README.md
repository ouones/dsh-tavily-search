# dsh-tavily-search

DeepSeek Harness (DSH) 的 Tavily 网页搜索 provider 插件。

通过 **Tavily Search API 直连**实现 `web-search-tavily` 网页搜索工具，**不消耗任何 LLM token**（搜索费用只走 Tavily API 额度，Tavily 本身有免费额度）。

## 特性

- 直接调用 `api.tavily.com/search`，无模型参与，搜索不烧 token
- 注册为 DSH web seam 的搜索 provider（id: `tavily-official`），工具名为 `web-search-tavily`
- 凭据通过 DSH 凭据服务 / 环境变量注入，key 由各用户自行保管，不会随插件分发
- 标准 bundle 插件：`dsh plugin add` 一条命令装好并自动挂载，无需手改 patch
- 纯 JS（ESM），无构建步骤

## 安装

需要 DSH 支持的环境（官方要求 Node.js 22.19+，本包自身要求 Node >= 18）。插件作为 bundle 分发，安装后自动成为 profile 的配置层。**安装不需要任何账号**——公开 npm 包可匿名下载，无需登录：

```sh
# 从 npm 安装（公开包，无需 npm 登录）
dsh plugin --profile web add dsh-tavily-search

# 或者从 GitHub 安装（同样无需账号）
dsh plugin --profile web add github:ouones/dsh-tavily-search
```

（npm 登录只在**发布**新版本时需要，与安装无关。）

装完重启 `dsh web` 即可。`dsh plugin` 是 profile 目录里的 pnpm 转发层；若首次安装提示 `ERR_PNPM_IGNORED_BUILDS`，按提示在 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds` 里加入相应依赖后重试。

## 配置

### 1. 凭据（key 由每个用户自己保管）

三种方式任选其一，按优先级从高到低：

1. **DSH 凭据服务**（推荐）：把 `TAVILY_API_KEY` 存进 DSH 的凭据存储；
2. **环境变量**：启动 `dsh web` 前导出 `TAVILY_API_KEY`；
3. **配置文件里直接写**（不推荐，key 会落盘）：见下方 patch 覆盖中的 `apiKey` 字段。

在 [Tavily 官网](https://tavily.com) 注册即可拿到自己的 API key。

### 2.（可选）覆盖默认配置

插件自带的默认配置（`apiKeyEnv: TAVILY_API_KEY`、`searchDepth: basic`、`includeAnswer: true`）一般够用。需要调整时，在 profile 的 `cordis.patch.yml` 里按**相同的行 id** 覆盖：

```yaml
# ~/.dsh/profiles/<name>/cordis.patch.yml
- id: web-search-tavily
  name: dsh-tavily-search
  config:
    apiKeyEnv: TAVILY_API_KEY   # 环境变量名，默认 TAVILY_API_KEY
    searchDepth: advanced       # basic | advanced，advanced 更贵更慢但更全
    includeAnswer: true         # 是否让 Tavily 生成自然语言回答
```

> 注意：按 id 覆盖时 `config` 是**整段替换**（不是深合并），要改的键都要写上。

### 3.（可选）把 web seam 默认搜索切到 Tavily

想让搜索默认走 Tavily、并停用官方 DeepSeek 搜索（避免搜索消耗 LLM token），在 profile 的 `cordis.patch.yml` 追加：

```yaml
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: tavily-official

- id: web-search-deepseek
  name: '@deepseek-ai/dsh-web-search-deepseek'
  disabled: true
```

### 4. 重启生效

```sh
dsh web
```

重启后对话里就能用 `include:web-search-tavily` 工具了。

## 配置项

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `apiKey` | string (secret) | — | 直接写 key（不推荐，会落盘） |
| `apiKeyEnv` | string (credential-ref) | `TAVILY_API_KEY` | 从凭据服务/环境读取 key 时用的名字 |
| `baseURL` | string | `https://api.tavily.com` | Tavily API 地址，自建中转时可覆盖 |
| `searchDepth` | string | `basic` | `basic` \| `advanced` |
| `includeAnswer` | boolean | `true` | 是否返回 Tavily 生成的自然语言回答 |

## 验证是否装好

```sh
dsh --profile web --dump-config   # 应出现 id: web-search-tavily 这一层
```

## 常见问题

**Q: 搜索报 `WEB_PROVIDER_CREDENTIAL_MISSING`？**
A: 没找到 key。确认 `TAVILY_API_KEY` 已通过凭据服务或环境变量提供，或检查 `apiKeyEnv` 拼写。

**Q: 和官方 DeepSeek 搜索有什么区别？**
A: 官方搜索走 DeepSeek 模型调用（每次搜索消耗 LLM token）；本插件直连 Tavily，只花 Tavily 额度。

**Q: key 会共享吗？**
A: 不会。key 只存在于各用户自己的 DSH 凭据存储/环境变量里，插件代码里没有、也不会上传任何 key。

## License

MIT
