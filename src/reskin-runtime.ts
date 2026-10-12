// Clone Spine attachments as native skins. Mesh copies remain linked to their
// original geometry and animation timelines; only texture regions change.
export function skinAttachments(skin: any): any[] {
  if (skin.getAttachments) return skin.getAttachments();
  return skin.attachments.flatMap((items: any, slotIndex: number) =>
    Object.entries(items || {}).map(([name, attachment]) => ({slotIndex, name, attachment})));
}

function copySkin(rt: any, target: any, source: any) {
  if (target.copySkin) { target.copySkin(source); return; }
  // 3.6 has no copySkin API. Copy visual attachments without sharing mutable
  // UVs/colors, and retain the source mesh's deform timeline relationship.
  for (const entry of skinAttachments(source)) {
    const original = entry.attachment;
    let copy = original;
    if (original instanceof rt.RegionAttachment || original instanceof rt.MeshAttachment) {
      copy = new original.constructor(original.name);
      for (const key of ['path','x','y','scaleX','scaleY','rotation','width','height','region'])
        if (key in original) copy[key] = original[key];
      copy.color.setFromColor(original.color);
      if (original instanceof rt.MeshAttachment) {
        copy.setParentMesh(original);
        copy.inheritDeform = true;
        // A linked source can itself inherit another mesh's deform timelines.
        copy.applyDeform = (sourceAttachment: any) => original.applyDeform(sourceAttachment);
      } else {
        copy.uvs = original.uvs.slice();
        copy.offset = original.offset.slice();
      }
    }
    target.addAttachment(entry.slotIndex, entry.name, copy);
  }
}

export function addReskin(rt: any, data: any, atlas: any, name: string, baseSkin: string) {
  if (data.findSkin(name)) throw new Error(`皮肤已存在：${name}`);
  const base = data.findSkin(baseSkin);
  if (!base) throw new Error(`基础皮肤不存在：${baseSkin}`);
  const skin = new rt.Skin(name);
  if (data.defaultSkin && data.defaultSkin !== base) copySkin(rt, skin, data.defaultSkin);
  copySkin(rt, skin, base);
  for (const entry of skinAttachments(skin)) {
    const attachment = entry.attachment;
    if (!(attachment instanceof rt.RegionAttachment) && !(attachment instanceof rt.MeshAttachment)) continue;
    const regionFor = (old: any) => {
      const region = atlas.findRegion(old?.name || attachment.path);
      if (!region) throw new Error(`新皮肤缺少图块：${old?.name || attachment.path}`);
      // Spine 3.8's attachment loader normally sets this self reference.
      if (old?.renderObject === old) region.renderObject = region;
      return region;
    };
    if (attachment.sequence) {
      attachment.sequence = attachment.sequence.copy();
      attachment.sequence.regions = attachment.sequence.regions.map(regionFor);
    }
    if (attachment.updateSequence) {
      // 4.3 stores even single-frame texture regions in a Sequence.
      attachment.updateSequence();
    } else {
      const region = regionFor(attachment.region);
      if (attachment.setRegion) attachment.setRegion(region);
      else attachment.region = region;
      if (attachment.updateRegion) attachment.updateRegion();
      else if (attachment.updateUVs) attachment.updateUVs();
      else attachment.updateOffset();
    }
  }
  data.skins.push(skin);
  return skin;
}
