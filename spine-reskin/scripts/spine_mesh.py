"""Shared attachment/UV helpers. No Spine runtime or animation evaluation."""
import copy
from PIL import Image, ImageDraw, ImageChops
import spine_reskin as core


def skin_map(skeleton, skin):
    skins = {s['name']: s.get('attachments', {}) for s in skeleton['skins']}
    core.require(skin in skins, f'Unknown skin: {skin}')
    result = copy.deepcopy(skins.get('default', {}))
    for slot, entries in skins[skin].items():
        result.setdefault(slot, {}).update(entries)
    return result


def resolve(skeleton, skin, slot, name, seen=None):
    seen = set() if seen is None else seen
    key = (skin, slot, name)
    core.require(key not in seen, 'Linked mesh cycle')
    seen.add(key)
    entries = skin_map(skeleton, skin)
    core.require(name in entries.get(slot, {}), f'Unknown attachment: {key}')
    child = copy.deepcopy(entries[slot][name])
    child['_region'] = child.get('path', child.get('name', name))
    if child.get('type') == 'linkedmesh':
        parent = resolve(skeleton, child.get('skin', skin), slot, child['parent'], seen)
        for field in ('vertices', 'uvs', 'triangles', 'hull', 'width', 'height'):
            if field in parent:
                child[field] = parent[field]
        child['type'] = 'mesh'
    return child


def select(skeleton, region, skin=None, slot=None, name=None):
    candidates = []
    for s in skeleton['skins']:
        if skin is not None and s['name'] != skin:
            continue
        for sl, entries in s.get('attachments', {}).items():
            if slot is not None and sl != slot:
                continue
            for n in entries:
                if name is not None and n != name:
                    continue
                attachment = resolve(skeleton, s['name'], sl, n)
                if attachment['_region'] == region and attachment.get('type') == 'mesh':
                    candidates.append((s['name'], sl, n, attachment))
    core.require(len(candidates) == 1, f'Expected one mesh for {region}; found {len(candidates)}. Specify --skin --slot --attachment.')
    return candidates[0]


def uv_mask(part, attachment, scale=8):
    w, h = part['size']
    ow, oh = core.pair(part['fields']['orig'])
    ox, oy = core.pair(part['fields']['offset'])
    top = oh - oy - h
    uv, triangles = attachment['uvs'], attachment['triangles']
    core.require(len(uv) % 2 == 0 and len(triangles) % 3 == 0, 'Invalid mesh arrays')
    mask = Image.new('L', (w * scale, h * scale))
    draw = ImageDraw.Draw(mask)
    for i in range(0, len(triangles), 3):
        ids = triangles[i:i + 3]
        core.require(all(isinstance(k, int) and 0 <= k < len(uv) // 2 for k in ids), 'Triangle index out of range')
        draw.polygon([((uv[k * 2] * ow - ox) * scale, (uv[k * 2 + 1] * oh - top) * scale) for k in ids], fill=255)
    return mask


def coverage(image, mask, threshold=128, box=None):
    alpha = image.getchannel('A').resize(mask.size, Image.Resampling.LANCZOS)
    opaque = alpha.point(lambda a: 255 if a >= threshold else 0)
    outside = ImageChops.subtract(opaque, mask)
    if box is not None:
        sx, sy = mask.width / image.width, mask.height / image.height
        crop = (round(box[0] * sx), round(box[1] * sy), round(box[2] * sx), round(box[3] * sy))
        opaque, outside = opaque.crop(crop), outside.crop(crop)
    count = sum(opaque.histogram()[128:])
    bad = sum(outside.histogram()[128:])
    return {'opaque_samples': count, 'outside_samples': bad, 'outside_fraction': bad / count if count else 0.0}
