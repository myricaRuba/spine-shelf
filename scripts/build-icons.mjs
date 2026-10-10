import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
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
  console.log(
    "Built transparent PNG assets and macOS ICNS from the same logo master.",
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
