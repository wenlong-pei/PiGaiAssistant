# 本地构建指南

## 生成安装版（支持自动更新）

由于 Linux 环境无法生成 NSIS 安装包，需要在本地 Windows 电脑上执行以下步骤：

### 1. 克隆代码

```bash
git clone https://github.com/wenlong-pei/IMA.git
cd IMA
```

### 2. 安装依赖

```bash
npm install
```

### 3. 构建项目

```bash
npm run build
```

### 4. 打包（生成安装版 + 便携版）

```bash
npm run dist:win
```

生成的文件在 `release/` 目录：
- `皮老板智能阅卷工具-Setup-2.1.1.exe` - **安装版（支持自动更新）**
- `皮老板智能阅卷工具-2.1.1-绿色版.exe` - 便携版

### 5. 发布到 GitHub Release

1. 打开 https://github.com/wenlong-pei/IMA/releases
2. 点击 "Draft a new release"
3. 版本号填 `v2.1.1`
4. 上传两个 EXE 文件
5. 点击 "Publish release"

发布后，安装版应用会自动检测到更新！

---

## 自动更新原理

```
用户打开应用 → electron-updater 检查 GitHub Release
                                    ↓
                        发现新版本 v2.1.2
                                    ↓
                        提示用户更新 → 下载 → 安装重启
```

**注意**：只有 NSIS 安装版支持自动更新，绿色便携版不支持。
