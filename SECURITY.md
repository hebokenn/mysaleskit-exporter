# 安全说明

## 本地保存了什么

这个工具会在本机保存以下内容：

- `work/mysaleskit_credentials.json`：只保存账号，不保存密码。
- macOS Keychain：保存 MyWorkbench 密码、邮箱密码、可选的电脑密码、MySalesKit API token。
- `work/`：浏览器登录资料、临时 token、本地调试资料。
- `logs/`：运行日志。
- `downloads/`：接口下载的原始文件。
- `mysaleskit 最新数据.xlsx`：最终导出结果。

这些本地运行产物都不会提交到 Git。

## Keychain 服务名

- `mysaleskit-portal-password`
- `mysaleskit-mail-password`
- `mysaleskit-mac-login-password`
- `mysaleskit-api-token`

## 电脑密码的用途

保存电脑密码是可选功能，只用于运行前尝试解锁 `login.keychain-db`：

```bash
security unlock-keychain
```

它不会用于管理员授权，不会点击系统安全弹窗，也不会模拟键盘输入任意密码框。

如果你不希望保存电脑密码，请不要配置这个选项。工具仍然可以运行，只是 macOS 可能要求你手动解锁 Keychain。

## 网络访问

工具会访问 MyWorkbench、MyTalent、MySalesKit API 和配置的 OWA 邮箱地址。请只在你有合法权限、并符合公司政策的情况下使用。

## 发布包说明

公开发布包不包含个人账号、密码、token、浏览器资料、日志、下载数据或导出的 Excel。

GitHub Release 里的 app 是临时签名，不是 Apple notarized 软件。首次打开时 macOS 可能要求你手动允许。
