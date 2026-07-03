# MySalesKit 导出工具 v0.1.0

首个公开发布版本。

## 包含内容

- macOS 菜单式 app：开始导出、配置、打开上次结果。
- 配置入口：MyWorkbench、邮箱、可选电脑密码。
- 运行状态提示：登录检查、刷新登录、等待人工验证、进入 MyTalent、进入 MySalesKit、拉取数据、生成 Excel、完成或失败。
- Keychain 存储密码，不在配置文件保存密码。
- 自动生成 `mysaleskit 最新数据.xlsx`。

## 注意事项

- 需要 Node.js 20 或更高版本。
- 需要账号本身拥有 MyWorkbench / MyTalent / MySalesKit 权限。
- 验证码、滑块或权限弹窗仍可能需要人工处理。
- app 是临时签名，尚未 notarize。
