// Builds the extension with the esbuild settings of codexhost's own tools/build-desktop-extension.mjs
// and writes every file the manifest declares next to it: desktop.js and desktop.css for Desktop,
// web/index.mjs and web/style.css for Web, backend/index.mjs for the backend. With --zip it also
// packs those files into dist/<id>.zip; the same files always give the same bytes.
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import { crc32 } from "node:zlib";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
const KiB = 1024;
// The limits codexhost and the extension registry apply.
const LIMITS = {
  "manifest.json": 128 * KiB,
  script: 2048 * KiB,
  style: 256 * KiB,
  license: 64 * KiB,
  icon: 128 * KiB,
  screenshot: 512 * KiB,
};
const DESKTOP = { script: "desktop.js", style: "desktop.css" };
const WEB = { entry: "web/index.mjs", style: "web/style.css" };
const BACKEND = { entry: "backend/index.mjs" };

const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
const bilingual = (text) => Boolean(text?.en?.trim() && text["zh-CN"]?.trim());
if (manifest.manifestVersion !== 2) throw new Error("manifest.json must use manifestVersion 2");
if (
  manifest.desktop?.apiVersion !== 1 ||
  manifest.desktop.script !== DESKTOP.script ||
  manifest.desktop.style !== DESKTOP.style
)
  throw new Error(`manifest.json must declare ${DESKTOP.script} and ${DESKTOP.style} for Desktop`);
if (
  manifest.web?.apiVersion !== 1 ||
  manifest.web.entry !== WEB.entry ||
  manifest.web.style !== WEB.style
)
  throw new Error(`manifest.json must declare ${WEB.entry} and ${WEB.style} for Web`);
if (manifest.backend?.apiVersion !== 1 || manifest.backend.entry !== BACKEND.entry)
  throw new Error(`manifest.json must declare ${BACKEND.entry} for the backend`);
if (
  !manifest.author?.trim() ||
  !bilingual(manifest.name) ||
  !bilingual(manifest.description) ||
  (manifest.details && !bilingual(manifest.details))
)
  throw new Error("The registry needs an author and an English and Chinese name and description");
if ((manifest.screenshots ?? []).length > 4) throw new Error("At most 4 screenshots");

const bundle = async (entry, options) => {
  const { outputFiles } = await build({
    entryPoints: [path.join(root, entry)],
    absWorkingDir: root,
    bundle: true,
    write: false,
    target: "es2022",
    legalComments: "inline",
    // tsconfig.json is for type checking; codexhost's build bundles without its options.
    tsconfigRaw: {},
    ...options,
  });
  const [output] = outputFiles;
  return output;
};

const desktop = await bundle("src/index.ts", { platform: "browser", format: "iife" });
// Desktop and the registry load the entry as the body of a strict function.
new Script(`(function (define) {"use strict";\n${desktop.text}\n})`);
const web = await bundle("src/web/index.ts", { platform: "browser", format: "esm" });
const backend = await bundle("src/backend/index.ts", {
  platform: "node",
  format: "esm",
  target: "node22",
});
await mkdir(path.join(root, "web"), { recursive: true });
await mkdir(path.join(root, "backend"), { recursive: true });
await writeFile(path.join(root, DESKTOP.script), desktop.contents);
await copyFile(path.join(root, "src", "desktop.css"), path.join(root, DESKTOP.style));
await writeFile(path.join(root, WEB.entry), web.contents);
await copyFile(path.join(root, "src", "web", "web.css"), path.join(root, WEB.style));
await writeFile(path.join(root, BACKEND.entry), backend.contents);

const files = [];
const add = async (name, limit) => {
  const bytes = await readFile(path.join(root, name));
  if (bytes.length > limit) throw new Error(`${name} is over ${limit / KiB} KiB`);
  files.push([name, bytes]);
  return bytes;
};
await add("manifest.json", LIMITS["manifest.json"]);
for (const name of [DESKTOP.script, WEB.entry, BACKEND.entry]) await add(name, LIMITS.script);
for (const name of [DESKTOP.style, WEB.style]) await add(name, LIMITS.style);
await add("LICENSE", LIMITS.license);
const images = [
  ...(manifest.icon ? [[manifest.icon, LIMITS.icon]] : []),
  ...(manifest.screenshots ?? []).map((name) => [name, LIMITS.screenshot]),
];
for (const [name, limit] of images) checkImage(name, await add(name, limit));

if (process.argv.includes("--zip")) {
  const output = path.join(root, "dist", `${manifest.id}.zip`);
  await mkdir(path.dirname(output), { recursive: true });
  files.sort(([a], [b]) => (a < b ? -1 : 1));
  await writeFile(output, zip(files));
  console.log(path.relative(root, output));
}

/** PNG, JPEG or WebP, with the suffix matching the contents, as the registry requires. */
function checkImage(name, bytes) {
  const suffix = name.split(".").pop().toLowerCase();
  const head = bytes.subarray(0, 12);
  const matches =
    suffix === "png"
      ? head.subarray(0, 8).toString("hex") === "89504e470d0a1a0a"
      : suffix === "jpg" || suffix === "jpeg"
        ? head.subarray(0, 3).toString("hex") === "ffd8ff"
        : suffix === "webp" &&
          head.subarray(0, 4).toString() === "RIFF" &&
          head.subarray(8, 12).toString() === "WEBP";
  if (!matches) throw new Error(`${name} must be a PNG, JPEG or WebP named after its type`);
}

/** A stored (uncompressed) ZIP dated 2026-01-01, like codexhost's own seed packages. */
function zip(entries) {
  const date = ((2026 - 1980) << 9) | (1 << 5) | 1;
  const parts = [];
  const directory = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const fileName = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(fileName.length, 28);
    central.writeUInt32LE(0o100644 * 0x10000, 38);
    central.writeUInt32LE(offset, 42);
    parts.push(local, fileName, data);
    directory.push(central, fileName);
    offset += local.length + fileName.length + data.length;
  }
  const centralDirectory = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralDirectory, end]);
}
