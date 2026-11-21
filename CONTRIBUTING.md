# Contributing

**English** · [简体中文](#参与贡献)

Thanks for helping improve Sidebar Thread Tree. Bug reports and pull requests are both welcome.

## Set up

You need Node.js 24 or later.

```sh
npm ci
npm run check     # type check, tests and build
npm run package   # dist/sidebar-thread-tree.zip
```

- `src/` holds the extension and `test/` its tests.
- `desktop.js` and `desktop.css` are built from `src/`. Commit them with your change; CI checks that they match the source.
- `contracts/shared-contracts.ts` is copied from codexhost. Change it only when codexhost's Desktop extension API changes.

## Try it in Codex Desktop

Run `npm run package`, then import `dist/sidebar-thread-tree.zip` through **Settings → Plugins → Import plugin → Local .zip**. It replaces the installed copy.

## Keep the extension safe to run

- Change only what the sidebar shows. Never change Thread ownership, execution, titles, pinning or archiving.
- Leave Desktop's own rows in place: add nodes with `api.dom.mount` and hide rows only with `api.dom.mark`, so turning the extension off restores the sidebar.
- Make no network requests, and do not use `eval`, `new Function` or `child_process`. The marketplace rejects packages that do.
- Check light and dark themes, and keep motion off under Reduce Motion.

## Open a pull request

- Keep one topic per pull request, and say what changed and why.
- Describe how you verified it, with screenshots or a short recording for visible changes.
- Leave `version` in `manifest.json` unchanged; it is raised when a release is published.
- CI for a first pull request runs after the maintainer approves it.

Contributions are licensed under [LGPL-3.0-only](LICENSE), like the rest of the project.

---

# 参与贡献

[English](#contributing) · **简体中文**

感谢你帮助改进「侧栏委派树」。欢迎提交问题报告，也欢迎直接提 PR。

## 准备环境

需要 Node.js 24 或更高版本。

```sh
npm ci
npm run check     # 类型检查、测试和构建
npm run package   # 生成 dist/sidebar-thread-tree.zip
```

- `src/` 是插件源码，`test/` 是对应的测试。
- `desktop.js` 和 `desktop.css` 由 `src/` 构建而来，请随改动一起提交；CI 会检查它们与源码一致。
- `contracts/shared-contracts.ts` 摘自 codexhost，只在 codexhost 的 Desktop 插件接口变化时修改。

## 在 Codex Desktop 中试用

运行 `npm run package`，再通过「设置 → 插件 → 导入插件 → 本地 .zip 包」导入 `dist/sidebar-thread-tree.zip`，它会替换已安装的版本。

## 让插件始终安全可用

- 只改变侧栏的显示方式，不改变会话的归属、执行、标题、置顶或归档。
- 不动 Desktop 的原生行。新节点用 `api.dom.mount` 添加，隐藏行只用 `api.dom.mark`，这样关闭插件就能恢复原样。
- 不发起网络请求，不使用 `eval`、`new Function` 或 `child_process`，插件市场会拒收这类安装包。
- 浅色和深色主题都要检查，开启“减少动态效果”时不播放动效。

## 提交 PR

- 一个 PR 只做一件事，写清改了什么、为什么。
- 说明你是怎样验证的；界面有变化时附截图或短录屏。
- 不要修改 `manifest.json` 的 `version`，发布新版本时统一升级。
- 第一次提交 PR 时，CI 需要维护者批准后才会运行。

贡献内容与本项目其他部分一样，以 [LGPL-3.0-only](LICENSE) 授权。
