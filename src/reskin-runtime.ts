// Clone Spine attachments as native skins. Mesh copies remain linked to their
// original geometry and animation timelines; only texture regions change.
export function addReskin(rt: any, data: any, atlas: any, name: string, baseSkin: string) {
  if (data.findSkin(name)) throw new Error(`皮肤已存在：${name}`);
  const base = data.findSkin(baseSkin);
  if (!base) throw new Error(`基础皮肤不存在：${baseSkin}`);
  const skin = new rt.Skin(name);
  if (data.defaultSkin && data.defaultSkin !== base) skin.copySkin(data.defaultSkin);
  skin.copySkin(base);
  for (const entry of skin.getAttachments()) {
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
