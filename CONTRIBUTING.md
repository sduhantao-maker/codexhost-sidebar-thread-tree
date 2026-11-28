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
- `desktop.js`, `desktop.css`, `web/index.mjs`, `web/style.css` and `backend/index.mjs` are built from `src/`. Commit them with your change; CI checks that they match the source.
- `contracts/shared-contracts.ts` is copied from codexhost. Change it only when codexhost's extension APIs change.

## Try it in codexhost

Run `npm run package`, then import `dist/sidebar-thread-tree.zip` through **Import plugin → Local .zip** in Desktop's **Settings → Plugins** or on Web's **Plugins** page. It replaces the installed copy on both.

## Keep the extension safe to run

- Never change a Thread on its own. Pin, rename and archive the user asks for go through the Thread's own row. A Desktop Thread without one gets Desktop's own **Chat actions** menu of the open Thread instead, opened only once the main view shows that Thread.
- Leave the sidebar's own rows in place: add nodes with `api.dom.mount` and hide rows only with `api.dom.mark`, so turning the extension off restores the sidebar.
- The backend only reads: codexhost's handoff record and codexhost's local API on loopback. Make no other network requests, and do not use `eval`, `new Function` or `child_process`. The marketplace rejects packages that do.
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
- `desktop.js`、`desktop.css`、`web/index.mjs`、`web/style.css` 和 `backend/index.mjs` 由 `src/` 构建而来，请随改动一起提交；CI 会检查它们与源码一致。
- `contracts/shared-contracts.ts` 摘自 codexhost，只在 codexhost 的插件接口变化时修改。

## 在 codexhost 中试用

运行 `npm run package`，再在桌面端的「设置 → 插件」或网页端的「插件」页面，通过「导入插件 → 本地 .zip 包」导入 `dist/sidebar-thread-tree.zip`，它会同时替换两端已安装的版本。

## 让插件始终安全可用

- 插件不自行改动任何会话。用户要求的置顶、重命名和归档，都交给该会话自己的原生行执行。桌面端没有原生行的会话，改用 Desktop 为当前会话提供的「聊天操作」菜单，并且只在主界面已经显示这个会话后才弹出。
- 不动侧栏的原生行。新节点用 `api.dom.mount` 添加，隐藏行只用 `api.dom.mark`，这样关闭插件就能恢复原样。
- 后台只读取 codexhost 的交接记录，以及本机回环地址上的 codexhost 本地接口。除此之外不发起网络请求，不使用 `eval`、`new Function` 或 `child_process`，插件市场会拒收这类安装包。
- 浅色和深色主题都要检查，开启“减少动态效果”时不播放动效。

## 提交 PR

- 一个 PR 只做一件事，写清改了什么、为什么。
- 说明你是怎样验证的；界面有变化时附截图或短录屏。
- 不要修改 `manifest.json` 的 `version`，发布新版本时统一升级。
- 第一次提交 PR 时，CI 需要维护者批准后才会运行。

贡献内容与本项目其他部分一样，以 [LGPL-3.0-only](LICENSE) 授权。
