import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "resources/brand/spine-shelf-logo-master.png");
const temporary = await mkdtemp(path.join(tmpdir(), "spine-shelf-icon-"));
const iconset = path.join(temporary, "SpineShelf.iconset");
const resize = (size, destination) =>
  execFileSync(
    "sips",
    ["-z", String(size), String(size), source, "--out", destination],
    { stdio: "pipe" },
  );

try {
  await mkdir(iconset);
  await mkdir(path.join(root, "public/brand"), { recursive: true });
  for (const size of [16, 32, 128, 256, 512]) {
    resize(size, path.join(iconset, `icon_${size}x${size}.png`));
    resize(size * 2, path.join(iconset, `icon_${size}x${size}@2x.png`));
  }
  resize(1024, path.join(root, "resources/icon.png"));
  resize(256, path.join(root, "public/brand/spine-shelf-logo.png"));
  resize(32, path.join(root, "public/brand/favicon.png"));
  execFileSync("iconutil", [
    "-c",
    "icns",
    iconset,
    "-o",
    path.join(root, "resources/icon.icns"),
  ]);
  // Windows ICO directory containing lossless PNG images at each taskbar/DPI size.
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  const images = [];
  let offset = header.length;
  for (const [index, size] of sizes.entries()) {
    const output = path.join(temporary, `windows-${size}.png`);
    resize(size, output);
    const png = await readFile(output);
    const entry = 6 + index * 16;
    header[entry] = header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    images.push(png);
    offset += png.length;
  }
  await writeFile(path.join(root, "resources/icon.ico"), Buffer.concat([header, ...images]));
  console.log(
    "Built transparent PNG assets, macOS ICNS and Windows ICO from the same logo master.",
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
