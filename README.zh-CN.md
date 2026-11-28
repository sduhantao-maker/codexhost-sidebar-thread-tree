<p align="center"><img src="assets/icon.png" width="88" height="88" alt=""></p>

<h1 align="center">侧栏委派树</h1>

<p align="center">
  <a href="https://github.com/BytePioneer-AI/codex-host">codexhost</a> 的插件，桌面端和网页端都能用。把委派出去的子会话收进父会话下方，上下文交接前后的会话并排相连，进度和待处理一眼可见。
</p>

<p align="center"><a href="README.md">English</a> · <b>简体中文</b></p>

<p align="center">⭐ 如果这个项目对你有帮助，请给它一个 Star！⭐</p>

![展开后的委派树](assets/expanded.png)

把工作委派给其他 Agent，或者把对话交给另一个 Agent 接着做，侧栏依旧井然有序。每个子会话都收在发起它的父会话下方，上下文交接前后的会话也并排相连，项目再忙，侧栏也只是几组层次分明的会话。即使其中一个会话排得靠后或没有显示出来，这一组也会聚在一起，不会散落。codexhost 桌面端和网页端都能用。

- **交接前后连在一起。** 把对话的上下文交给另一个 Agent 之后，两个会话会排在一起，各自保持原来的层级。接手的新会话在上，原来的会话紧跟在下，左侧用和委派树相同的圆角连线连起来。连续多次交接也连成同样的一串。原会话即使排得很靠后，或者收在「展开显示」里，也会跟到新会话下方。
- **不点开也能看进度。** 父会话收起时保留一行小结，例如“5 个子会话 · 2 运行中 · 1 待批准”。
- **原地展开。** 鼠标移到父会话的 Agent 图标上，图标会变成箭头。点击箭头或小结行，多层委派沿圆角连线逐级展开。
- **跨项目也连在一起。** 子会话即使属于另一个项目，也挂在父会话下方；在子会话自己的项目里，也会在它上方显示所属的父会话，隶属关系始终清楚。
- **需要你处理的，一眼就能找到。** 每个子会话都显示 Agent 图标、标题和实时状态，正在运行还是等待处理一目了然。
- **和原生行一样操作。** 点击任意一行即可打开。父会话和子会话都能通过悬停按钮和右键菜单，使用 Desktop 自己的置顶、重命名和归档。Desktop 侧栏里没有列出的子会话（比如在非项目文件夹里启动的），悬停时显示 **…** 按钮，点它或右键会打开这个会话，并弹出 Desktop 自己的「聊天操作」菜单，同样可以重命名、置顶、归档和删除。在网页端，挪到交接会话旁边的行保持网页侧栏原本的样子，点击、右键菜单和行上的按钮都交给网页自己的那一行处理。打开某个会话时，它的上级会自动展开；切换上一个、下一个会话的快捷键也按树的顺序走。
- **与原生侧栏浑然一体。** 行高、字体和颜色都取自所在的侧栏，浅色深色主题都合适。展开收起的动效沿用 Desktop 自己的曲线，开启“减少动态效果”时不播放。

网页端的侧栏本身已经会把委派的子会话收成树，插件在网页端负责加上交接连线。

![交接之后，前后会话并排相连](assets/handoff.png)

| 收起 | 悬停 | 深色 |
| --- | --- | --- |
| ![父会话收起时的一行小结](assets/collapsed.png) | ![图标原地变成展开箭头](assets/hover.png) | ![深色主题下的委派树](assets/dark.png) |

## 安装

需要 codexhost 0.24.0 或更高版本。交接连线需要 codexhost 0.27.0 或更高版本，这一版加入了上下文交接。安装一次，桌面端和网页端都生效。

- **从插件市场安装。** 打开「市场」，找到「侧栏委派树」，安装后开启。
- **用 GitHub 链接导入。** 点「导入插件 → GitHub 链接」，粘贴 `https://github.com/sduhantao-maker/codexhost-sidebar-thread-tree`。
- **用本地 .zip 包导入。** 从[最新 Release](https://github.com/sduhantao-maker/codexhost-sidebar-thread-tree/releases/latest) 下载 `sidebar-thread-tree.zip`，再在桌面端的「设置 → 插件」或网页端的「插件」页面点「导入插件 → 本地 .zip 包」。

本插件与「侧栏委派角标」共用侧栏角标槽位，两者同一时间只能启用一个。

## 它怎样工作

- **不会自行改动会话。** 会话的归属、执行、标题、置顶、归档和侧栏的排序都由你和 codexhost 决定，远程 Host 的行也不受影响。
- **不动侧栏的原生行。** 插件从不移动或包裹侧栏自己的行。在桌面端，展开按钮叠在 Agent 图标上，插件画的行放在该行自己的列表项里。在网页端，挪到交接会话旁边的是网页那一行的副本，网页每次改动那一行，副本都会跟着重建，原来的行留在原处并被隐藏。隐藏行只通过插件标记完成。关闭插件后，侧栏立即恢复原样。
- **使用侧栏自己的操作。** 插件画出的行会把置顶、重命名和归档交给该会话自己的原生行执行，效果与在原生行上操作完全一样。在桌面端，没有原生行的会话（比如在非项目文件夹里启动的，或在「展开显示」之后的），没有行菜单可交。这时它的 **…** 按钮和右键会先打开这个会话，再弹出标题栏里 Desktop 自己的「聊天操作」菜单，其中还有删除。菜单只在主界面已经显示这个会话后才弹出，不会误操作别的会话。
- **数据留在本机。** 父子关系和实时状态由 codexhost 通过 Desktop 插件接口（`threads.watchTree`、`sidebar.observeRows`）提供。交接关系由插件的后台提供，后台只在本机读取两样东西，一是 codexhost 数据目录里的交接记录（`mapping-store/handoffs/handoffs.json`），二是侧栏没有显示的会话在 codexhost 本地会话列表（`/v1/thread/list`，只走本机回环地址）里的标题和状态。任何数据都不会离开本机。插件自己只在本机 Desktop 的本地存储里记住哪些树是展开的。

## 反馈

发现问题或有改进想法，欢迎[提交 issue](https://github.com/sduhantao-maker/codexhost-sidebar-thread-tree/issues/new)。每一条我都会认真看，并尽快参考修改。

## 开发

```sh
npm ci
npm run check     # 类型检查、测试和构建
npm run package   # 生成 dist/sidebar-thread-tree.zip
```

桌面端的 `desktop.js`、`desktop.css`，网页端的 `web/index.mjs`、`web/style.css` 和后台的 `backend/index.mjs` 都由 `src/` 构建，esbuild 设置与 codexhost 自己的 `tools/build-desktop-extension.mjs` 相同。构建结果提交在仓库里，codexhost 可以直接从仓库安装；CI 会检查它们与源码一致。提交 PR 前请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md#参与贡献)。

发布新版本时，先提高 `manifest.json` 里的 `version`，运行 `npm run package`，再把安装包和 manifest 里列出的每张图片一起发布到 Release：

```sh
gh release create v0.2.0 dist/sidebar-thread-tree.zip assets/*.png
```

插件市场安装最新 Release 里的 `.zip`，并把每张图片与 Release 里同名的附件逐一核对。

## 致谢

本插件的设计和最初实现来自 [codex-host#947](https://github.com/BytePioneer-AI/codex-host/pull/947)，codexhost 维护者把它适配到了 [codex-host#992](https://github.com/BytePioneer-AI/codex-host/pull/992) 引入的 Desktop 插件平台。`contracts/shared-contracts.ts` 摘自 codexhost。

## 许可证

[LGPL-3.0-only](LICENSE)，与 codexhost 相同。
