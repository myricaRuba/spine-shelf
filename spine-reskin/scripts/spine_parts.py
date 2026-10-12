#!/usr/bin/env python3
"""Reference sheets, explicit part registration, and mesh UV coverage checks."""
import argparse
import json
import math
from pathlib import Path
import tempfile
from PIL import Image, ImageChops, ImageDraw
import spine_reskin as core
import spine_mesh as mesh


def part_for(manifest, name):
    found = [p for p in manifest['parts'] if p['region'] == name]
    core.require(len(found) == 1, f'Unknown region: {name}')
    return found[0]


def interpolate(y, knots):
    for a, b in zip(knots, knots[1:]):
        if y <= b[0]:
            t = min(1, max(0, (y - a[0]) / (b[0] - a[0])))
            return a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t
    return knots[-1][1], knots[-1][2]


def run(args):
    manifest_path = Path(args.manifest).resolve()
    manifest = core.load_manifest(manifest_path)
    output = core.fresh_output(args.out, [manifest_path])
    with tempfile.TemporaryDirectory(dir=output.parent) as temporary:
        stage = Path(temporary) / 'result'
        stage.mkdir()
        if args.command == 'sheet':
            regions = args.regions or [p['region'] for p in manifest['parts']]
            core.require(len(regions) == len(set(regions)), 'Duplicate region selection')
            core.require(args.columns > 0 and args.cell > 0 and args.scale > 0, 'Positive grid parameters required')
            sheet = Image.new('RGBA', (args.columns * args.cell, math.ceil(len(regions) / args.columns) * args.cell))
            layout = []
            for i, name in enumerate(regions):
                part = part_for(manifest, name)
                image = Image.open(manifest_path.parent / part['file']).convert('RGBA')
                w, h = image.size
                core.require(max(w, h) * args.scale <= args.cell, f'Part does not fit cell: {name}')
                x = i % args.columns * args.cell + (args.cell - w * args.scale) // 2
                y = i // args.columns * args.cell + (args.cell - h * args.scale) // 2
                sheet.paste(image.resize((w * args.scale, h * args.scale), Image.Resampling.NEAREST), (x, y))
                layout.append({'region': name, 'source_canvas': list(sheet.size), 'source_box': [x, y, x + w * args.scale, y + h * args.scale], 'size': [w, h]})
            sheet.save(stage / 'reference.png')
            core.write_json(stage / 'layout.json', {'parts': layout})
        elif args.command == 'crop':
            image = Image.open(args.image).convert('RGBA')
            layout = core.read_json(args.layout)
            entries = []
            (stage / 'parts').mkdir()
            for i, entry in enumerate(layout['parts']):
                part = part_for(manifest, entry['region'])
                cw, ch = entry['source_canvas']
                x, y, xx, yy = entry['source_box']
                box = (round(x * image.width / cw), round(y * image.height / ch), round(xx * image.width / cw), round(yy * image.height / ch))
                core.require(0 <= box[0] < box[2] <= image.width and 0 <= box[1] < box[3] <= image.height, 'Crop is outside generated canvas')
                cropped = image.crop(box).resize(tuple(part['size']), Image.Resampling.LANCZOS)
                path = f'parts/{i:04d}.png'
                cropped.save(stage / path)
                entries.append({'region': part['region'], 'image': path, 'alpha': 'straight'})
            core.write_json(stage / 'replacements.json', {'replacements': entries})
        else:
            part = part_for(manifest, args.region)
            skeleton = core.read_json(manifest['source_json'])
            _, _, _, attachment = mesh.select(skeleton, args.region, args.skin, args.slot, args.attachment)
            mask = mesh.uv_mask(part, attachment, args.samples)
            image = Image.open(args.image).convert('RGBA')
            if args.command == 'align':
                mapping = core.read_json(args.mapping)
                cw, ch = mapping.get('source_canvas', list(image.size))
                x0, y0, x1, y1 = mapping.get('source_box', [0, 0, cw, ch])
                core.require(cw > 0 and ch > 0 and 0 <= x0 < x1 <= cw and 0 <= y0 < y1 <= ch, 'Invalid source canvas/box')
                w, h = part['size']
                knots = mapping.get('row_map', [[0, 0, 0], [h, h, 0]])
                core.require(len(knots) >= 2 and all(len(k) == 3 and all(math.isfinite(v) for v in k) for k in knots), 'row_map requires finite [target_y, source_y, source_x_shift] triples')
                core.require(all(a[0] < b[0] and a[1] <= b[1] for a, b in zip(knots, knots[1:])), 'row_map must be monotonic')
                core.require(knots[0][0] <= 0 and knots[-1][0] >= h, 'row_map must cover entire target height')
                # Small local high-resolution canvas avoids repeatedly processing a huge ESRGAN sheet.
                pad, scale = 4, args.samples
                unit_x, unit_y = (x1 - x0) / w, (y1 - y0) / h
                box = ((x0 - pad * unit_x) * image.width / cw, (y0 - pad * unit_y) * image.height / ch,
                       (x1 + pad * unit_x) * image.width / cw, (y1 + pad * unit_y) * image.height / ch)
                local = image.crop(tuple(round(v) for v in box)).resize(((w + 2 * pad) * scale, (h + 2 * pad) * scale), Image.Resampling.LANCZOS).convert('RGBa')
                aligned = Image.new('RGBa', (w * scale, h * scale))
                for row in range(h * scale):
                    source_y, shift = interpolate((row + .5) / scale, knots)
                    line = local.transform((w * scale, 1), Image.Transform.AFFINE, (1, 0, (pad + shift) * scale, 0, 0, (pad + source_y) * scale), Image.Resampling.BICUBIC)
                    aligned.paste(line, (0, row))
                image = aligned.convert('RGBA').resize((w, h), Image.Resampling.LANCZOS)
                if args.alpha == 'original':
                    image.putalpha(Image.open(manifest_path.parent / part['file']).convert('RGBA').getchannel('A'))
                if args.min_alpha:
                    image.putalpha(image.getchannel('A').point(lambda a: a if a >= args.min_alpha else 0))
            core.require(image.size == tuple(part['size']), 'Image must have exact logical region size; use align first')
            report = {'region': args.region, 'coverage_before_clipping': mesh.coverage(image, mask, args.threshold), 'runtime_test': False}
            if args.critical_box:
                report['critical_coverage'] = mesh.coverage(image, mask, args.threshold, args.critical_box)
                core.require(report['critical_coverage']['opaque_samples'] > 0, 'Critical box has no opaque pixels')
                core.require(report['critical_coverage']['outside_fraction'] <= args.max_outside, 'Critical feature exceeds UV hull; realign/redraw before clipping')
            mask.save(stage / 'uv_mask.png')
            preview = image.resize(mask.size, Image.Resampling.NEAREST)
            outside = ImageChops.subtract(preview.getchannel('A'), mask)
            red = Image.new('RGBA', preview.size, (255, 35, 40, 0))
            red.putalpha(outside)
            preview.alpha_composite(red)
            preview.save(stage / 'coverage_overlay.png')
            if args.command == 'align':
                if args.clip_uv:
                    scaled = image.resize(mask.size, Image.Resampling.LANCZOS)
                    scaled.putalpha(ImageChops.multiply(scaled.getchannel('A'), mask))
                    image = scaled.resize(image.size, Image.Resampling.LANCZOS)
                image.save(stage / 'aligned.png')
                report.update({'alpha_policy': args.alpha, 'clipped_uv': args.clip_uv, 'mapping': mapping})
                core.write_json(stage / 'replacements.json', {'replacements': [{'region': args.region, 'image': 'aligned.png', 'alpha': 'straight'}]})
            core.write_json(stage / 'report.json', report)
        stage.rename(output)
    print(f'{args.command}: {output}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    for command in ('sheet', 'crop', 'coverage', 'align'):
        p = sub.add_parser(command)
        p.add_argument('--manifest', required=True)
        p.add_argument('--out', required=True)
        if command == 'sheet':
            p.add_argument('--regions', nargs='+')
            p.add_argument('--columns', type=int, default=4)
            p.add_argument('--cell', type=int, default=512)
            p.add_argument('--scale', type=int, default=4)
        else:
            p.add_argument('--image', required=True)
        if command == 'crop':
            p.add_argument('--layout', required=True)
        if command in ('coverage', 'align'):
            p.add_argument('--region', required=True)
            p.add_argument('--skin')
            p.add_argument('--slot')
            p.add_argument('--attachment')
            p.add_argument('--samples', type=int, default=8)
            p.add_argument('--threshold', type=int, default=128)
            p.add_argument('--critical-box', nargs=4, type=float)
            p.add_argument('--max-outside', type=float, default=.005)
        if command == 'align':
            p.add_argument('--mapping', required=True)
            p.add_argument('--alpha', choices=('generated', 'original'), default='generated')
            p.add_argument('--min-alpha', type=int, default=0)
            p.add_argument('--clip-uv', action='store_true')
    args = parser.parse_args()
    try:
        if hasattr(args, 'samples'):
            core.require(1 <= args.samples <= 32 and 1 <= args.threshold <= 255, 'Invalid sampling/alpha threshold')
            core.require(0 <= args.max_outside <= 1, 'max-outside must be 0..1')
            if hasattr(args,'min_alpha'):
                core.require(0 <= args.min_alpha <= 255,'min-alpha must be 0..255')
            if args.critical_box:
                x,y,xx,yy=args.critical_box
                part=part_for(core.load_manifest(args.manifest),args.region)
                core.require(0 <= x < xx <= part['size'][0] and 0 <= y < yy <= part['size'][1], 'Critical box must be inside logical part')
        run(args)
    except (ValueError, OSError, KeyError, TypeError) as exc:
        parser.exit(2, f'ERROR: {exc}\n')


if __name__ == '__main__':
    main()
