# MySalesKit 导出工具

这是一个 macOS 小工具，用来把 MySalesKit 里的在职学习数据自动导出成 Excel。

它会复用 MyWorkbench / MyTalent / MySalesKit 的网页登录流程：先检查本地已有 token，失效时自动打开登录页面，必要时读取邮箱验证码，最后拉取数据并生成 `mysaleskit 最新数据.xlsx`。

## 适用场景

- 你已经有 MyWorkbench、MyTalent、MySalesKit 的访问权限。
- 你希望每天或手动一键导出 MySalesKit 数据。
- 你接受验证码、滑块等安全验证有时仍需要人工处理。

这个工具不会绕过权限控制。如果当前账号没有 MyTalent 或 MySalesKit 权限，导出会失败并提示原因。

## 下载和安装

1. 到 GitHub Release 下载 `MySalesKit导出工具-v0.1.0.zip`。
2. 解压 zip。
3. 不要只拖走 app。请保持 `MySalesKit导出工具.app` 和 `scripts/`、`package.json` 在同一个解压文件夹里。
4. 双击 `MySalesKit导出工具.app`。

第一次运行可能需要安装 Node 依赖，会比平时慢一些。

## 运行前准备

- macOS。
- Node.js 20 或更高版本。
- 能访问 MyWorkbench、MyTalent、MySalesKit。
- 能登录接收验证码的邮箱。

如果没有安装 Node.js，可以先安装官方版本或 Homebrew 版本。安装后重新打开 app。

邮箱验证码默认读取 OWA；如你的邮箱地址不同，可以用 `MYSK_OWA_URL` 环境变量覆盖。

## App 菜单

打开 app 后会看到三个入口：

- `开始导出`：运行完整导出流程。
- `配置`：保存账号和密码。
- `打开上次结果`：打开上一次生成的 Excel。

配置菜单包含：

- `配置 MyWorkbench`：保存 MyWorkbench 账号和密码。
- `配置邮箱`：保存邮箱账号和密码，用于读取登录验证码。
- `保存电脑密码`：可选，只用于运行前尝试解锁 macOS 登录钥匙串。
- `查看配置状态`：只显示账号和“已配置/未配置”，不会显示密码。

## 导出流程

1. 检查本地是否已有有效登录 token。
2. 如果 token 失效，自动尝试刷新登录。
3. 如果需要验证码，尝试从配置邮箱读取验证码。
4. 如果需要滑块、图片验证或人工确认，app 会显示状态提示并打开可见浏览器。
5. 进入 MyTalent，再进入 MySalesKit。
6. 拉取数据并生成 `mysaleskit 最新数据.xlsx`。

运行日志在 `logs/` 文件夹里。失败时 app 会提供打开最新日志的按钮。

## 可选：定时运行

仓库里提供了 `launchd/com.mysaleskit.daily.plist.example` 模板。

使用方式：

1. 把模板复制到 `~/Library/LaunchAgents/com.mysaleskit.daily.plist`。
2. 把里面的 `__INSTALL_DIR__` 替换成解压后的绝对路径。
3. 按需修改运行时间。
4. 用 macOS 的 `launchctl` 加载这个任务。

建议先手动运行成功一次，再启用定时任务。

## 安全说明

- 密码不会写入仓库文件。
- MyWorkbench 密码保存在 macOS Keychain，服务名是 `mysaleskit-portal-password`。
- 邮箱密码保存在 macOS Keychain，服务名是 `mysaleskit-mail-password`。
- 电脑密码是可选项，保存在 macOS Keychain，服务名是 `mysaleskit-mac-login-password`。
- 账号会保存到本地 `work/mysaleskit_credentials.json`，这个文件不会提交到 Git。
- 登录 token 会保存到 Keychain，并在 `work/.mysaleskit_token` 保留一份本地缓存。
- 浏览器登录资料在 `work/`，日志在 `logs/`，下载的原始文件在 `downloads/`，这些目录都被 `.gitignore` 排除。

“保存电脑密码”只用于执行 macOS 的 `security unlock-keychain`，不会用于管理员授权，也不会模拟键盘输入系统密码框。如果你不希望保存电脑密码，可以不配置；遇到 Keychain 弹窗时手动输入即可。

## 重要限制

- 这是一个本地自动化工具，不是官方 MySalesKit 客户端。
- 网站页面结构变化时，登录点击逻辑可能需要更新。
- 验证码、滑块、权限弹窗可能需要人工处理。
- GitHub Release 里的 app 是临时签名，不是 Apple notarized 软件。macOS 首次打开时可能需要右键打开，或在系统设置里允许打开。

## 命令行运行

也可以在解压目录里运行：

```bash
bash scripts/run_mysaleskit_cron.sh
```

手动可见浏览器登录模式：

```bash
bash scripts/run_mysaleskit_daily_manual_login.sh
```
