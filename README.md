# 皮老板智能阅卷工具

> 智学网专用 AI 自动批改助手 — DOM 选择器获取图片 · PaddleOCR 识别 · DeepSeek 评分 · 自动提交

晚上挂机睡觉，早上起来全改完。

## ✨ 功能特性

### 🤖 全自动批改流程

1. **打开智学网** — 输入链接，自动打开浏览器
2. **获取答题图片** — DOM 选择器精准获取答题卡图片（非截图）
3. **OCR 文字识别** — PaddleOCR-VL-1.5 识别手写内容
4. **AI 智能评分** — DeepSeek AI 根据评分标准打分 + 生成评语
5. **自动填分提交** — 原生 setter 绕过框架受控组件，精准填入分数
6. **循环批改** — 自动切换下一份试卷，无人值守

### 🎯 三种批改模式

| 模式 | 提交方式 | 纠错 | 适用场景 |
|------|----------|------|----------|
| **普通模式** | 5 秒倒计时（可暂停/取消） | ✅ | 日常少量批改 |
| **试改模式** | 等待教师确认 | ✅ | 首次使用、调优评分标准 |
| **无人值守** | 1 秒自动提交 | ❌ | 大量试卷、夜间挂机 |

### 🔧 分数纠错

AI 打分不准？输入正确分数，AI 自动分析错误原因，优化评分标准，越用越准。

### 🏢 多 AI 服务商

| 服务商 | 说明 |
|--------|------|
| **DeepSeek** | 推荐，性价比高 |
| **火山引擎** | 字节跳动 AI 服务 |
| **硅基流动** | 开源模型聚合 |
| **自定义** | 任何 OpenAI 兼容接口 |

### 📊 批改记录

- 按评分标准分组展示
- 显示记录数、平均分
- 支持导出 HTML 报告

### 🎨 界面设计

- 蓝绿渐变 + 毛玻璃效果
- 三栏布局：配置 | 操作 | 信息
- 页面状态持久化，切换不丢失

### 🛡️ 企业级错误处理

- **AppError 类**：标准化错误结构（code、severity、details、timestamp）
- **ErrorCodes 枚举**：20+ 种预定义错误代码
- **ErrorUtils 工具**：用户友好的错误消息、可恢复性判断、重试策略建议

### 📝 结构化日志

- **多级别日志**：DEBUG、INFO、WARN、ERROR
- **格式化输出**：时间戳、模块、数据
- **日志历史缓存**：最多 1000 条

### 🔄 智能重试

- **指数退避 + 抖动**：避免重试风暴
- **可取消的重试任务**：支持用户中断

### 🚨 React 错误边界

- 捕获组件树 JavaScript 错误
- 美观的错误 UI（图标、标题、用户消息）
- 技术详情折叠面板

### 🔔 通知组件

- 四种类型：success、error、warning、info
- 自动消失（可配置持续时间）
- 渐变动画效果

### 📈 进度条组件

- 条纹动画（进行中状态）
- 子任务步骤列表
- 暂停/继续/取消控制

### 🔐 API Key 安全存储

- 使用 electron-safe-storage 加密存储敏感信息
- 支持 API Key 的安全保存、读取、删除
- 加密存储在用户数据目录

### 🌍 外置 DOM 选择器配置

- 通过 `config/selectors.json` 文件配置平台选择器
- 支持多平台适配（智学网等）
- 可自定义选择器而无需修改代码

### 🧪 单元测试

- Vitest 测试框架
- AppError、Logger 等核心模块测试
- 17+ 个测试用例

### 🔄 CI/CD 自动化

- GitHub Actions 自动构建
- PR 时自动运行测试
- 发布时自动打包 Windows EXE

### ⬆️ 自动更新

- electron-updater 支持静默更新检查
- 设置页面集成更新检查组件
- 支持手动检查更新、下载、安装

### 📖 新手引导

- intro.js 交互式功能教程
- 首次使用自动引导
- 帮助页面包含使用教程和常见问题

## 🚀 快速开始

### 环境要求

- Node.js >= 18
- npm >= 9

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

### 打包为 EXE

```bash
npm run dist:win
```

## 📖 使用步骤

### 1. 配置 API

打开 **系统设置 → AI 设置**，填写 DeepSeek API Key。

> 免费注册：[DeepSeek 开放平台](https://platform.deepseek.com/)

### 2. 创建评分标准

打开 **评分标准** 页面，创建评分标准：
- 填写标准名称
- 设置满分分数
- 添加关键词/评分规则
- 填写参考答案

### 3. 开始批改

1. 在首页输入智学网阅卷页面链接
2. 选择评分标准
3. 选择批改模式（普通/试改/无人值守）
4. 点击「开始自动批改」

### 4. 智学网页面适配

工具自动适配智学网新旧版 UI：
- **旧版 UI**：`div[name="topicImg"] img`
- **新版 UI**：`.enhance-definition-bright`

## 🔧 技术栈

| 技术 | 用途 |
|------|------|
| **Electron 28** | 桌面应用框架 |
| **React 18 + TypeScript** | 前端 UI |
| **Zustand** | 状态管理（持久化） |
| **Playwright** | 浏览器自动化 |
| **PaddleOCR-VL-1.5** | OCR 文字识别 |
| **DeepSeek API** | AI 智能评分 |
| **electron-updater** | 自动更新 |
| **intro.js** | 新手引导 |
| **Vitest** | 单元测试 |
| **GitHub Actions** | CI/CD 自动化 |
| **Sass** | 样式预处理 |
| **Framer Motion** | 动画效果 |
| **Electron Builder** | 打包分发 |

## 📁 项目结构

```
├── electron/              # Electron 主进程
│   ├── main.ts           # 主进程入口（IPC、浏览器控制）
│   └── preload.ts        # 预加载脚本（IPC 桥接）
├── src/                  # 渲染进程（React）
│   ├── components/       # 公共组件
│   │   ├── common/       # 侧边栏、标题栏、通知、进度条
│   │   ├── layouts/      # 主布局
│   │   ├── providers/    # 主题 Provider
│   │   └── ErrorBoundary.tsx  # React 错误边界
│   ├── hooks/            # 自定义 Hooks
│   ├── pages/            # 页面组件
│   │   ├── SimpleGradingPage   # 首页（自动批改）
│   │   ├── StandardsPage       # 评分标准
│   │   ├── RecordsPage         # 批改记录
│   │   ├── SettingsPage        # 系统设置
│   │   └── ApiTestPage         # API 测试
│   ├── services/         # 服务层
│   │   └── playwrightProxy.ts  # Playwright 代理
│   ├── store/            # Zustand 状态管理
│   ├── styles/           # 全局样式
│   ├── types/            # TypeScript 类型定义
│   ├── utils/            # 工具函数
│   │   ├── AppError.ts   # 统一错误处理
│   │   ├── Logger.ts     # 结构化日志
│   │   └── RetryHelper.ts # 智能重试
│   ├── App.tsx           # 应用入口
│   └── main.tsx          # 渲染进程入口
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

## ⚠️ 注意事项

1. **仅支持智学网平台** — 工具通过 DOM 选择器获取图片，仅适配智学网
2. **需要配置 API Key** — DeepSeek API Key 在设置中配置
3. **首次使用需手动登录** — 在弹出的浏览器中登录智学网
4. **评分标准越详细越准确** — 填写完整的参考答案和评分规则

## 📄 开源协议

MIT License

---

**皮老板智能阅卷工具** ❤️
