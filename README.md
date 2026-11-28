<p align="center"><img src="assets/icon.png" width="88" height="88" alt=""></p>

<h1 align="center">Sidebar Thread Tree</h1>

<p align="center">
  A <a href="https://github.com/BytePioneer-AI/codex-host">codexhost</a> extension for Desktop and Web that folds delegated Threads under their parent and keeps Threads joined by a context handoff side by side, with live status at a glance.
</p>

<p align="center"><b>English</b> · <a href="README.zh-CN.md">简体中文</a></p>

<p align="center">⭐ If Sidebar Thread Tree is useful to you, please give it a star! ⭐</p>

![Delegated Threads expanded under their parent](assets/expanded.png)

Delegate work to other agents, or hand a conversation to another agent, and the sidebar stays in order. Each delegated Thread folds under the Thread that started it, and Threads that continue one another after a context handoff stand side by side, so a busy project reads as a few tidy groups instead of one long list. A group keeps its members together even when one of them sits further down or is not shown. It works in codexhost Desktop and in codexhost Web.

- **Handoffs stay connected.** Hand a conversation's context to another agent and both Threads stay together, each at its own level: the one that received the context on top, the one it came from right below, joined on their left by the tree's own rounded line. A longer chain of handoffs reads the same way. The earlier Thread joins its successor even when it sits far down the list or behind **Show more**.
- **Progress at a glance.** A collapsed parent keeps one summary line, such as "5 child sessions · 2 running · 1 needs approval".
- **Expand in place.** Hover a parent's agent icon and it turns into an arrow. Select it, or the summary line, and nested delegations unfold level by level along rounded guides.
- **Connected across projects.** A child started in another project still hangs under its parent, and its own project shows that parent above it, so you always see where it belongs.
- **See what needs you.** Every child row shows its agent, title and live status, so running work and Threads waiting for you stand out.
- **Works like a native row.** Select any row to open it. Every row, parents and children alike, offers Desktop's own pin, rename and archive from its hover buttons and right-click menu. A child Desktop does not list in the sidebar, such as one started in a folder that is not a project, offers a **…** button and right-click that open it with Desktop's own **Chat actions** menu, so it can still be renamed, pinned, archived or deleted. On Web, a row moved next to its handoff keeps Web's own look, and its click, right-click menu and buttons act on Web's own row. Opening a Thread expands its parents, and Desktop's next and previous Thread shortcuts follow the tree.
- **Native look and feel.** Rows take their size, fonts and colors from the sidebar they sit in, in light and dark themes. Motion follows Desktop's own curve and is skipped under Reduce Motion.

codexhost Web already folds delegated Threads in its sidebar; there the extension adds the handoff links.

![After a context handoff, both Threads stay side by side](assets/handoff.png)

| Collapsed | Hover | Dark |
| --- | --- | --- |
| ![One summary line under a collapsed parent](assets/collapsed.png) | ![The icon turns into the expand arrow](assets/hover.png) | ![The tree in the dark theme](assets/dark.png) |

## Install

You need codexhost 0.24.0 or later. Handoff links need codexhost 0.27.0 or later, which added context handoff. One installation serves Desktop and Web.

- **From the marketplace.** Open **Marketplace**, find **Sidebar Thread Tree**, install it and turn it on.
- **From a GitHub link.** Choose **Import plugin → GitHub link** and paste `https://github.com/sduhantao-maker/codexhost-sidebar-thread-tree`.
- **From a local .zip.** Download `sidebar-thread-tree.zip` from the [latest release](https://github.com/sduhantao-maker/codexhost-sidebar-thread-tree/releases/latest), then choose **Import plugin → Local .zip** in Desktop's **Settings → Plugins** or on Web's **Plugins** page.

It shares the sidebar badge slot with Sidebar Delegation Badges, so only one of the two can be on at a time.

## How it behaves

- **Never changes a Thread on its own.** Ownership, execution, titles, pinning, archiving and the sidebar's order stay with you and codexhost, and rows from remote Hosts are left alone.
- **Leaves the sidebar's own rows intact.** The extension never moves or wraps the sidebar's rows. On Desktop it lays its toggle over the agent icon and adds its own rows inside the row's list item. On Web, a row shown next to its handoff is a copy of Web's row, rebuilt whenever Web changes it, while Web's row stays in place, hidden. Rows are hidden only through extension marks. Turn the extension off and the sidebar is exactly as before.
- **Uses the sidebar's own actions.** A row the extension draws hands pin, rename and archive to the Thread's own row, so they behave exactly as on that row. On Desktop, a Thread without a Desktop row, for example one started in a folder that is not a project or one beyond **Show more**, has no row menu to hand them to. Its **…** button and right-click open the Thread, then Desktop's own **Chat actions** menu in the header, which also offers delete. That menu opens only once the main view shows the Thread, so it never acts on another one.
- **Stays on your machine.** Parent links and live status come from codexhost through the Desktop extension API (`threads.watchTree`, `sidebar.observeRows`). Handoffs come from the extension's backend, which only reads, on this machine: codexhost's record of handoffs (`mapping-store/handoffs/handoffs.json` in codexhost's data folder) and, for a Thread the sidebar does not show, codexhost's local Thread list (`/v1/thread/list`, on loopback). Nothing leaves this machine. The extension keeps only which trees are expanded, in this Desktop's local storage.

## Feedback

Found a bug or have an idea? [Open an issue](https://github.com/sduhantao-maker/codexhost-sidebar-thread-tree/issues/new). I read every one and act on it as soon as I can.

## Develop

```sh
npm ci
npm run check     # type check, tests and build
npm run package   # dist/sidebar-thread-tree.zip
```

`desktop.js` and `desktop.css` (Desktop), `web/index.mjs` and `web/style.css` (Web) and `backend/index.mjs` (backend) are built from `src/` with the esbuild settings of codexhost's own `tools/build-desktop-extension.mjs`, and committed so codexhost can install straight from the repository. CI checks that they match the source. Before opening a pull request, see [CONTRIBUTING.md](CONTRIBUTING.md).

To release, raise `version` in `manifest.json`, run `npm run package`, and publish a release with the package and every image the manifest names:

```sh
gh release create v0.2.0 dist/sidebar-thread-tree.zip assets/*.png
```

The marketplace installs the `.zip` of the latest release and checks each image against its own release asset.

## Credits

Designed and first built in [codex-host#947](https://github.com/BytePioneer-AI/codex-host/pull/947). The codexhost maintainers adapted it to the Desktop extension platform introduced in [codex-host#992](https://github.com/BytePioneer-AI/codex-host/pull/992). `contracts/shared-contracts.ts` is copied from codexhost.

## License

[LGPL-3.0-only](LICENSE), the same as codexhost.
