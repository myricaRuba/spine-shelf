#!/usr/bin/env python3
"""Spine 3.8.75 texture workflow. Requires Python 3.10+ and Pillow.

All mutations write new output directories. Sources are never overwritten.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

from PIL import Image


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def write_json(path, data):
    Path(path).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def within(base, name):
    base = Path(base).resolve()
    result = (base / name).resolve()
    require(result.is_relative_to(base), f"Path outside resource directory: {name}")
    return result


def pair(value):
    values = [int(x.strip()) for x in value.split(",")]
    require(len(values) == 2, f"Expected two integers: {value}")
    return values


def rotation(region):
    value = region["fields"].get("rotate", "false").lower()
    angle = {"true": 90, "false": 0}.get(value)
    if angle is None:
        angle = int(value)
    require(angle in (0, 90, 180, 270), "Region rotation must be 0/90/180/270.")
    return angle


def rectangle(region):
    f = region["fields"]
    x, y = pair(f["xy"])
    w, h = pair(f["size"])
    if rotation(region) in (90, 270):
        w, h = h, w
    return x, y, w, h


def parse_atlas(path):
    pages = []
    page = None
    current = None
    names = set()
    for raw in Path(path).read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line:
            page = current = None
            continue
        if ":" in line:
            require(current is not None, f"Atlas field without header: {line}")
            key, value = line.split(":", 1)
            require(key not in current["fields"], f"Duplicate atlas field: {key}")
            current["fields"][key] = value.strip()
        elif page is None:
            page = {"name": line, "fields": {}, "regions": []}
            require(all(p["name"] != line for p in pages), f"Duplicate page: {line}")
            pages.append(page)
            current = page
        else:
            require(line not in names, f"Ambiguous duplicate region: {line}")
            names.add(line)
            current = {"name": line, "fields": {}}
            page["regions"].append(current)
    require(pages, "Empty atlas")
    for page in pages:
        for field in ("format", "filter", "repeat"):
            require(field in page["fields"], f"Page {page['name']} missing {field}")
        # Preserve explicit source metadata; runtime support is renderer-specific.
        require(set(page["fields"]) <= {"size", "format", "filter", "repeat", "pma"}, "Unsupported atlas page fields")
        require(page["fields"].get("pma", "false").lower() in ("true", "false"), "pma must be true/false")
        for r in page["regions"]:
            for field in ("rotate", "xy", "size", "orig", "offset", "index"):
                require(field in r["fields"], f"Region {r['name']} missing {field}")
            require(set(r["fields"]) <= {"rotate", "xy", "size", "split", "pad", "orig", "offset", "index"}, f"Unsupported fields: {r['name']}")
            require("pad" not in r["fields"] or "split" in r["fields"], "pad requires split")
            rotation(r)
    return pages


def serialize_atlas(pages):
    lines = []
    for p in pages:
        lines.append(p["name"])
        for k in ("size", "format", "filter", "pma", "repeat"):
            if k in p["fields"]:
                lines.append(f"{k}: {p['fields'][k]}")
        for r in p["regions"]:
            lines.append(r["name"])
            for k in ("rotate", "xy", "size", "split", "pad", "orig", "offset", "index"):
                if k in r["fields"]:
                    lines.append(f"  {k}: {r['fields'][k]}")
        lines.append("")
    return "\n".join(lines) + "\n"


def load_pages(atlas, pages):
    images = {}
    for p in pages:
        filename = within(Path(atlas).parent, p["name"])
        with Image.open(filename) as image:
            require(image.format == "PNG", f"Expected PNG page: {filename}")
            image = image.convert("RGBA")
        if "size" in p["fields"]:
            require(tuple(pair(p["fields"]["size"])) == image.size, f"Page size mismatch: {p['name']}")
        images[p["name"]] = image
        for r in p["regions"]:
            x, y, w, h = rectangle(r)
            require(x >= 0 and y >= 0 and w > 0 and h > 0 and x + w <= image.width and y + h <= image.height, f"Region out of bounds: {r['name']}")
            ow, oh = pair(r["fields"]["orig"])
            ox, oy = pair(r["fields"]["offset"])
            rw, rh = pair(r["fields"]["size"])
            require(ow >= rw and oh >= rh and ox >= 0 and oy >= 0 and ox + rw <= ow and oy + rh <= oh, f"Invalid trim metadata: {r['name']}")
    return images


def logical_crop(image, region):
    x, y, w, h = rectangle(region)
    crop = image.crop((x, y, x + w, y + h))
    # Atlas stores rotate:true counterclockwise; undo with clockwise rotation.
    return crop.rotate(-rotation(region), expand=True) if rotation(region) else crop


def alpha_convert(image, to_pma):
    pixels = []
    for r, g, b, a in image.getdata():
        if to_pma:
            pixels.append(((r * a + 127) // 255, (g * a + 127) // 255, (b * a + 127) // 255, a))
        elif a:
            pixels.append((min(255, (r * 255 + a // 2) // a), min(255, (g * 255 + a // 2) // a), min(255, (b * 255 + a // 2) // a), a))
        else:
            pixels.append((0, 0, 0, 0))
    result = Image.new("RGBA", image.size)
    result.putdata(pixels)
    return result


def attachments(skeleton):
    require(skeleton.get("skeleton", {}).get("spine") == "3.8.75", "Expected Spine JSON version 3.8.75 (version field is never rewritten)")
    skins = skeleton.get("skins", [])
    require(isinstance(skins, list), "Expected Spine 3.8 skins array")
    slots = {s["name"]: s["bone"] for s in skeleton.get("slots", [])}
    records = []
    for skin in skins:
        for slot, entries in skin.get("attachments", {}).items():
            require(slot in slots, f"Unknown attachment slot: {slot}")
            for key, a in entries.items():
                typ = a.get("type", "region")
                record = {"skin": skin["name"], "slot": slot, "bone": slots[slot], "attachment": key, "type": typ}
                if typ in ("region", "mesh", "linkedmesh"):
                    record["region"] = a.get("path", a.get("name", key))
                if "parent" in a and typ in ("mesh", "linkedmesh"):
                    record["parent"] = a["parent"]
                    record["parent_skin"] = a.get("skin") or "default"
                records.append(record)
    lookup = {(r["skin"], r["slot"], r["attachment"]): r for r in records}
    for r in records:
        if "parent" in r:
            parent = lookup.get((r["parent_skin"], r["slot"], r["parent"]))
            require(parent is not None and parent["type"] in ("mesh", "linkedmesh"), f"Missing linked mesh parent: {r}")
    return records


def inspect_resources(json_path, atlas):
    skeleton = read_json(json_path)
    pages = parse_atlas(atlas)
    load_pages(atlas, pages)
    records = attachments(skeleton)
    regions = {r["name"] for p in pages for r in p["regions"]}
    missing = sorted({r["region"] for r in records if "region" in r} - regions)
    require(not missing, f"Missing atlas regions: {missing}")
    used = {r["region"] for r in records if "region" in r}
    return {"version": "3.8.75", "bones": len(skeleton.get("bones", [])), "slots": len(skeleton.get("slots", [])), "animations": list(skeleton.get("animations", {})), "pages": pages, "attachments": records, "unused_regions": sorted(regions - used)}


def fresh_output(path, inputs):
    output = Path(path).resolve()
    require(not output.exists(), f"Output already exists; choose a new directory: {output}")
    require(all(not Path(p).resolve().is_relative_to(output) for p in inputs), "Output would contain source files")
    output.parent.mkdir(parents=True, exist_ok=True)
    return output


def cmd_inspect(args):
    report = inspect_resources(args.json, args.atlas)
    if args.report:
        target = Path(args.report)
        require(not target.exists(), "Report already exists")
        target.parent.mkdir(parents=True, exist_ok=True)
        write_json(target, report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


def cmd_unpack(args):
    report = inspect_resources(args.json, args.atlas)
    pages = report["pages"]
    for page in pages:
        if "pma" in page["fields"]:
            declared = "pma" if page["fields"]["pma"].lower() == "true" else "straight"
            require(args.alpha == declared, f"Alpha mode contradicts atlas pma metadata: {page['name']}")
    images = load_pages(args.atlas, pages)
    output = fresh_output(args.out, [args.json, args.atlas])
    with tempfile.TemporaryDirectory(dir=output.parent) as temporary:
        stage = Path(temporary) / "export"
        (stage / "parts").mkdir(parents=True)
        parts = []
        for page in pages:
            for region in page["regions"]:
                identifier = hashlib.sha256(region["name"].encode()).hexdigest()[:20]
                crop = logical_crop(images[page["name"]], region)
                if args.alpha == "pma":
                    crop = alpha_convert(crop, False)
                relative = f"parts/{identifier}.png"
                crop.save(stage / relative)
                parts.append({"region": region["name"], "page": page["name"], "file": relative, "size": list(crop.size), "fields": region["fields"]})
        manifest = {"schema": 1, "alpha": args.alpha, "source_json": str(Path(args.json).resolve()), "source_atlas": str(Path(args.atlas).resolve()), "json_sha256": digest(args.json), "atlas_sha256": digest(args.atlas), "page_sha256": {p["name"]: digest(within(Path(args.atlas).parent, p["name"])) for p in pages}, "parts": parts, "attachments": report["attachments"]}
        write_json(stage / "manifest.json", manifest)
        write_json(stage / "replacements.json", {"replacements": []})
        stage.rename(output)
    print(f"Unpacked {len(parts)} regions: {output}")


def load_manifest(path):
    m = read_json(path)
    require(m.get("schema") == 1 and m.get("alpha") in ("straight", "pma"), "Invalid manifest")
    require(digest(m["source_json"]) == m["json_sha256"], "Source JSON changed; unpack again")
    require(digest(m["source_atlas"]) == m["atlas_sha256"], "Source atlas changed; unpack again")
    for name, checksum in m["page_sha256"].items():
        require(digest(within(Path(m["source_atlas"]).parent, name)) == checksum, f"Source page changed: {name}")
    return m


def replacement_images(args, manifest):
    plan = read_json(args.replacements)
    require(isinstance(plan.get("replacements"), list), "Expected replacements list")
    indexed = {p["region"]: p for p in manifest["parts"]}
    images = {}
    details = []
    for item in plan["replacements"]:
        name = item["region"]
        require(name in indexed and name not in images, f"Unknown or duplicate replacement: {name}")
        source = Path(item["image"])
        if not source.is_absolute():
            source = Path(args.replacements).resolve().parent / source
        require(item.get("alpha", "straight") == "straight", "Replacement images must use straight alpha")
        with Image.open(source) as im:
            require("A" in im.getbands() or "transparency" in im.info, f"Replacement needs alpha channel: {source}")
            image = im.convert("RGBA")
        target = tuple(indexed[name]["size"])
        resized = image.size != target
        if resized:
            require(args.resize, f"Size mismatch for {name}: {image.size} vs {target}; align manually or explicitly use --resize")
            image = image.resize(target, Image.Resampling.LANCZOS)
        if args.keep_alpha:
            original = within(Path(args.manifest).parent, indexed[name]["file"])
            with Image.open(original) as im:
                require(im.size == target, f"Original alpha size mismatch: {name}")
                image.putalpha(im.convert("RGBA").getchannel("A"))
        require(image.getchannel("A").getbbox() is not None, f"Empty replacement: {name}")
        if manifest["alpha"] == "pma":
            image = alpha_convert(image, True)
        images[name] = image
        details.append({"region": name, "image": str(source.resolve()), "resized": resized, "kept_original_alpha": args.keep_alpha})
    return images, details


def overlap(a, b):
    x, y, w, h = rectangle(a)
    xx, yy, ww, hh = rectangle(b)
    return x < xx + ww and xx < x + w and y < yy + hh and yy < y + h


def cmd_replace(args):
    m = load_manifest(args.manifest)
    pages = parse_atlas(m["source_atlas"])
    images = load_pages(m["source_atlas"], pages)
    replacements, details = replacement_images(args, m)
    require(replacements, "No replacements specified")
    output = fresh_output(args.out, [args.manifest, args.replacements, m["source_json"], m["source_atlas"]])
    for page in pages:
        for r in page["regions"]:
            if r["name"] not in replacements:
                continue
            require(not any(other is not r and overlap(r, other) for other in page["regions"]), f"Replacement overlaps another region/alias: {r['name']}; use repack")
            image = replacements[r["name"]]
            if rotation(r):
                image = image.rotate(rotation(r), expand=True)
            x, y, _, _ = rectangle(r)
            images[page["name"]].paste(image, (x, y))  # Never pass alpha as a mask.
    with tempfile.TemporaryDirectory(dir=output.parent) as temporary:
        stage = Path(temporary) / "result"
        stage.mkdir()
        json_name, atlas_name = Path(m["source_json"]).name, Path(m["source_atlas"]).name
        require(json_name != atlas_name and all(p["name"] not in (json_name, atlas_name, "report.json") for p in pages), "Output filename collision")
        shutil.copyfile(m["source_json"], stage / json_name)
        shutil.copyfile(m["source_atlas"], stage / atlas_name)
        for page in pages:
            path = within(stage, page["name"])
            path.parent.mkdir(parents=True, exist_ok=True)
            if any(r["name"] in replacements for r in page["regions"]):
                images[page["name"]].save(path)
            else:
                shutil.copyfile(within(Path(m["source_atlas"]).parent, page["name"]), path)
        inspect_resources(stage / json_name, stage / atlas_name)
        write_json(stage / "report.json", {"operation": "replace", "json_byte_identical": digest(stage / json_name) == m["json_sha256"], "atlas_byte_identical": digest(stage / atlas_name) == m["atlas_sha256"], "alpha": m["alpha"], "replacements": details})
        stage.rename(output)
    print(f"Replaced {len(details)} regions: {output}")


def shelf_pack(items, max_size, padding):
    ordered = sorted(items, key=lambda x: (-x[2].height, -x[2].width, x[1]["name"]))
    minimum = max(image.width + 2 * padding for _, _, image in ordered)
    widths = {minimum, max_size}
    width = 1
    while width <= max_size:
        if width >= minimum:
            widths.add(width)
        width *= 2
    area = sum((im.width + 2 * padding) * (im.height + 2 * padding) for _, _, im in ordered)
    widths.add(min(max_size, max(minimum, math.ceil(math.sqrt(area)))))
    best = None
    for limit in sorted(widths):
        if limit > max_size:
            continue
        x = y = row = used = 0
        placements = []
        for page, region, im in ordered:
            w, h = im.width + 2 * padding, im.height + 2 * padding
            if x + w > limit:
                y += row
                x = row = 0
            placements.append((page, region, im, x + padding, y + padding))
            x += w
            row = max(row, h)
            used = max(used, x)
        height = y + row
        if used <= max_size and height <= max_size and (best is None or used * height < best[0]):
            best = (used * height, used, height, placements)
    require(best is not None, "Shelf pack cannot fit within --max-size; increase limit or use an external packer (this is not an optimal solver)")
    return best[1:]


def extrude(canvas, image, x, y, padding):
    w, h = image.size
    canvas.paste(image, (x, y))
    if padding:
        canvas.paste(image.crop((0, 0, 1, h)).resize((padding, h)), (x - padding, y))
        canvas.paste(image.crop((w - 1, 0, w, h)).resize((padding, h)), (x + w, y))
        canvas.paste(image.crop((0, 0, w, 1)).resize((w, padding)), (x, y - padding))
        canvas.paste(image.crop((0, h - 1, w, h)).resize((w, padding)), (x, y + h))
        for sx, sy, dx, dy in ((0, 0, x-padding, y-padding), (w-1, 0, x+w, y-padding), (0, h-1, x-padding, y+h), (w-1, h-1, x+w, y+h)):
            canvas.paste(Image.new("RGBA", (padding, padding), image.getpixel((sx, sy))), (dx, dy))


def cmd_repack(args):
    require(args.max_size > 0 and args.padding >= 0, "Invalid packing limits")
    m = load_manifest(args.manifest)
    pages = parse_atlas(m["source_atlas"])
    source_images = load_pages(m["source_atlas"], pages)
    replacements, details = replacement_images(args, m) if args.replacements else ({}, [])
    settings = {tuple(p["fields"].get(k, "<unspecified>") for k in ("format", "filter", "repeat", "pma")) for p in pages}
    require(len(settings) == 1, "Pages have different sampler/format settings; cannot merge automatically")
    require(pages[0]["fields"]["repeat"] == "none", "Repeated pages cannot be safely repacked")
    used = {a["region"] for a in attachments(read_json(m["source_json"])) if "region" in a}
    items = []
    removed = []
    for page in pages:
        for r in page["regions"]:
            if args.prune_unused and r["name"] not in used:
                require(r["name"] not in replacements, f"Replacement selected for pruned region: {r['name']}")
                removed.append(r["name"])
                continue
            image = replacements.get(r["name"])
            if image is None:
                x, y, w, h = rectangle(r)
                image = source_images[page["name"]].crop((x, y, x + w, y + h))
            elif rotation(r):
                image = image.rotate(rotation(r), expand=True)
            items.append((page, r, image))
    require(items, "No regions to pack")
    width, height, placements = shelf_pack(items, args.max_size, args.padding)
    canvas = Image.new("RGBA", (width, height))
    regions = []
    for _, region, image, x, y in placements:
        extrude(canvas, image, x, y, args.padding)
        fields = dict(region["fields"])
        fields["xy"] = f"{x}, {y}"
        regions.append({"name": region["name"], "fields": fields})
    fields = dict(pages[0]["fields"])
    fields["size"] = f"{width}, {height}"
    output = fresh_output(args.out, [args.manifest, m["source_json"], m["source_atlas"]])
    with tempfile.TemporaryDirectory(dir=output.parent) as temporary:
        stage = Path(temporary) / "result"
        stage.mkdir()
        json_name = Path(m["source_json"]).name
        require(json_name not in ("reskin.atlas", "reskin.png", "report.json"), "Output filename collision")
        shutil.copyfile(m["source_json"], stage / json_name)
        canvas.save(stage / "reskin.png")
        (stage / "reskin.atlas").write_text(serialize_atlas([{"name": "reskin.png", "fields": fields, "regions": regions}]), encoding="utf-8")
        inspect_resources(stage / json_name, stage / "reskin.atlas")
        write_json(stage / "report.json", {"operation": "repack", "json_byte_identical": digest(stage / json_name) == m["json_sha256"], "alpha": m["alpha"], "size": [width, height], "png_bytes": (stage / "reskin.png").stat().st_size, "removed_regions": removed, "replacements": details})
        stage.rename(output)
    print(f"Single page {width}x{height}: {output}")


def cmd_validate(args):
    report = inspect_resources(args.json, args.atlas)
    if args.baseline_json:
        report["json_byte_identical"] = digest(args.json) == digest(args.baseline_json)
        require(report["json_byte_identical"], "JSON differs from baseline")
    if args.baseline_atlas:
        old = {r["name"]: r["fields"] for p in parse_atlas(args.baseline_atlas) for r in p["regions"]}
        new = {r["name"]: r["fields"] for p in report["pages"] for r in p["regions"]}
        require(set(new) <= set(old), "Unexpected new atlas region")
        for name in new:
            require(all(new[name].get(k) == old[name].get(k) for k in ("rotate", "size", "orig", "offset", "index", "split", "pad")), f"Region geometry changed: {name}")
        report["region_geometry_preserved"] = True
    print(json.dumps(report, ensure_ascii=False, indent=2))


def cmd_upscale(args):
    require(args.scale > 0, "Scale must be positive")
    source = Path(args.image).resolve()
    exe = Path(args.exe).resolve()
    require(exe.is_file(), f"Executable missing: {exe}")
    output = fresh_output(args.out, [source, exe])
    with Image.open(source) as im:
        image = im.convert("RGBA")
    with tempfile.TemporaryDirectory(dir=output.parent) as temporary:
        stage = Path(temporary)
        image.convert("RGB").save(stage / "rgb.png")
        command = [str(exe), "-i", str(stage / "rgb.png"), "-o", str(stage / "rgb-up.png"), "-n", args.model, "-s", str(args.scale), "-m", str(Path(args.models).resolve())]
        result = subprocess.run(command, cwd=exe.parent, capture_output=True, text=True, errors="replace", timeout=args.timeout)
        require(result.returncode == 0, f"Upscaler failed ({result.returncode}): {result.stderr[-2000:]}")
        require((stage / "rgb-up.png").is_file(), "Upscaler returned no image")
        with Image.open(stage / "rgb-up.png") as im:
            rgb = im.convert("RGB")
        target = (image.width * args.scale, image.height * args.scale)
        require(rgb.size == target, f"Unexpected upscale dimensions: {rgb.size}, expected {target}")
        original_visible = image.convert("RGB").copy()
        original_visible.paste((0, 0, 0), mask=image.getchannel("A").point(lambda a: 255 if a == 0 else 0))
        require(rgb.getbbox() is not None or original_visible.getbbox() is None, "Unexpected all-black upscale output")
        rgb.putalpha(image.getchannel("A").resize(target, Image.Resampling.LANCZOS))
        result_dir = stage / "result"
        result_dir.mkdir()
        rgb.save(result_dir / "upscaled.png")
        write_json(result_dir / "report.json", {"size": list(target), "model": args.model, "scale": args.scale, "rgb_extrema": rgb.convert("RGB").getextrema(), "command": command})
        result_dir.rename(output)
    print(f"Upscaled straight-alpha image: {output}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for name, function in (("inspect", cmd_inspect), ("unpack", cmd_unpack), ("validate", cmd_validate)):
        p = sub.add_parser(name)
        p.add_argument("--json", required=True)
        p.add_argument("--atlas", required=True)
        p.set_defaults(run=function)
        if name == "inspect":
            p.add_argument("--report")
        elif name == "unpack":
            p.add_argument("--out", required=True)
            p.add_argument("--alpha", choices=("straight", "pma"), required=True)
        else:
            p.add_argument("--baseline-json")
            p.add_argument("--baseline-atlas")
    for name, function in (("replace", cmd_replace), ("repack", cmd_repack)):
        p = sub.add_parser(name)
        p.add_argument("--manifest", required=True)
        p.add_argument("--out", required=True)
        p.add_argument("--replacements", required=name == "replace")
        p.add_argument("--resize", action="store_true")
        p.add_argument("--keep-alpha", action="store_true")
        if name == "repack":
            p.add_argument("--max-size", type=int, default=4096)
            p.add_argument("--padding", type=int, default=2)
            p.add_argument("--prune-unused", action="store_true")
        p.set_defaults(run=function)
    p = sub.add_parser("upscale")
    p.add_argument("--image", required=True)
    p.add_argument("--exe", required=True)
    p.add_argument("--models", required=True)
    p.add_argument("--model", default="realesrgan-x4plus-anime")
    p.add_argument("--scale", type=int, default=4)
    p.add_argument("--timeout", type=int, default=600)
    p.add_argument("--out", required=True)
    p.set_defaults(run=cmd_upscale)
    args = parser.parse_args()
    try:
        args.run(args)
    except (ValueError, OSError, KeyError, TypeError, subprocess.TimeoutExpired) as exc:
        parser.exit(2, f"ERROR: {exc}\n")


if __name__ == "__main__":
    main()

