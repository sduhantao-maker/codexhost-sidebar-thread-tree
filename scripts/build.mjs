// Builds the extension as codexhost's tools/build-desktop-extension.mjs does and writes
// desktop.js and desktop.css next to manifest.json. With --zip it also packs the files the
// manifest declares into dist/<id>.zip; the same files always give the same bytes.
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
  "desktop.js": 2048 * KiB,
  "desktop.css": 256 * KiB,
  icon: 128 * KiB,
  screenshot: 512 * KiB,
};

const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
const bilingual = (text) => Boolean(text?.en?.trim() && text["zh-CN"]?.trim());
if (manifest.desktop?.script !== "desktop.js" || manifest.desktop.style !== "desktop.css")
  throw new Error("manifest.json must declare desktop.js and desktop.css");
if (
  !manifest.author?.trim() ||
  !bilingual(manifest.name) ||
  !bilingual(manifest.description) ||
  (manifest.details && !bilingual(manifest.details))
)
  throw new Error("The registry needs an author and an English and Chinese name and description");
if ((manifest.screenshots ?? []).length > 4) throw new Error("At most 4 screenshots");

const { outputFiles } = await build({
  entryPoints: [path.join(root, "src", "index.ts")],
  absWorkingDir: root,
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  target: "es2022",
  legalComments: "inline",
  // tsconfig.json is for type checking; codexhost's build bundles without its options.
  tsconfigRaw: {},
});
const [script] = outputFiles;
// Desktop and the registry load the entry as the body of a strict function.
new Script(`(function (define) {"use strict";\n${script.text}\n})`);
await writeFile(path.join(root, "desktop.js"), script.contents);
await copyFile(path.join(root, "src", "desktop.css"), path.join(root, "desktop.css"));

const files = [];
const add = async (name, limit) => {
  const bytes = await readFile(path.join(root, name));
  if (bytes.length > limit) throw new Error(`${name} is over ${limit / KiB} KiB`);
  files.push([name, bytes]);
  return bytes;
};
for (const name of ["manifest.json", "desktop.js", "desktop.css"]) await add(name, LIMITS[name]);
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
