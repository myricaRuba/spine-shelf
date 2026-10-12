// Spine 3.6 binary -> same-version JSON for the official 3.6 WebGL runtime.
// Format reference: upstream spine-libgdx SkeletonBinary.java, pinned in
// licenses/spine36-source.json. See licenses/spine-3.6.txt for upstream terms.
// Keep source SKEL bytes and version intact; this is an internal preview cache.
const record = () => Object.create(null);

class Input {
  constructor(bytes) {
    this.bytes = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = 0;
  }
  fail(message) { throw new Error(`Spine 3.6 二进制数据无效（字节 ${this.pos}）：${message}`); }
  need(size) {
    if (!Number.isSafeInteger(size) || size < 0 || size > this.bytes.length - this.pos) this.fail('文件不完整');
  }
  byte() { this.need(1); return this.bytes[this.pos++]; }
  bool() { const n = this.byte(); if (n > 1) this.fail('布尔值无效'); return n === 1; }
  int(signed = false) {
    let value = 0;
    for (let shift = 0; shift < 35; shift += 7) {
      const b = this.byte();
      if (shift === 28 && (b & 0xf0)) this.fail('整数超出范围');
      value |= (b & 127) << shift;
      if (!(b & 128)) return signed ? (value >>> 1) ^ -(value & 1) : value;
    }
    this.fail('整数无效');
  }
  count() { const n = this.int(); this.need(n); return n; }
  float() {
    this.need(4);
    const n = this.bytes.readFloatBE(this.pos); this.pos += 4;
    if (!Number.isFinite(n)) this.fail('非有限数值');
    return n;
  }
  floats(n) { this.need(n * 4); return Array.from({length: n}, () => this.float()); }
  fields(names) { return Object.fromEntries(names.split(' ').map(name => [name, this.float()])); }
  shorts() {
    const n = this.count(); this.need(n * 2);
    return Array.from({length: n}, () => { const v = this.bytes.readUInt16BE(this.pos); this.pos += 2; return v; });
  }
  string() {
    const n = this.int();
    if (n === 0) return null;
    this.need(n - 1);
    // Spine 3.6 encodes UTF-16 code units in 1-3 byte sequences (including
    // surrogate pairs), so Node's strict UTF-8 decoder would lose some names.
    const end = this.pos + n - 1, chars = [];
    while (this.pos < end) {
      const b = this.byte();
      if (b < 128) chars.push(b);
      else {
        const extra = (b & 0xe0) === 0xc0 ? 1 : (b & 0xf0) === 0xe0 ? 2 : -1;
        if (extra < 0 || this.pos + extra > end) this.fail('字符串编码无效');
        let c = b & (extra === 1 ? 31 : 15);
        for (let i = 0; i < extra; i++) {
          const next = this.byte(); if ((next & 0xc0) !== 0x80) this.fail('字符串编码无效');
          c = (c << 6) | (next & 63);
        }
        chars.push(c);
      }
    }
    let result = '';
    for (let i = 0; i < chars.length; i += 8192) result += String.fromCharCode(...chars.slice(i, i + 8192));
    return result;
  }
  name() { const name = this.string(); if (!name) this.fail('名称为空'); return name; }
  color() { this.need(4); const c = this.bytes.subarray(this.pos, this.pos + 4).toString('hex'); this.pos += 4; return c; }
  ref(items) { const i = this.int(); if (i < 0 || i >= items.length) this.fail('引用索引无效'); return items[i]; }
  enum(names, byte = false) {
    const i = byte ? this.byte() : this.int();
    if (i < 0 || i >= names.length) this.fail('类型无效');
    return names[i];
  }
  list(read) { return Array.from({length: this.count()}, (_, i) => read(i)); }
  bend() { const n = this.byte(); if (n !== 1 && n !== 255) this.fail('IK 方向无效'); return n === 1; }
}

function decodeSkeleton36(bytes) {
  const r = new Input(bytes);
  const skeleton = {hash: r.string(), spine: r.string()};
  if (!/^3\.6\.\d+$/.test(skeleton.spine || '')) r.fail('需要 3.6 导出文件');
  Object.assign(skeleton, r.fields('width height'));
  const nonessential = r.bool();
  if (nonessential) { skeleton.fps = r.float(); skeleton.images = r.string(); }
  const data = {skeleton, bones: [], slots: [], skins: record(), events: record(), animations: record()};
  r.list(i => {
    const bone = {name: r.name()};
    if (i) bone.parent = r.ref(data.bones).name;
    Object.assign(bone, r.fields('rotation x y scaleX scaleY shearX shearY length'));
    bone.transform = r.enum(['normal', 'onlyTranslation', 'noRotationOrReflection', 'noScale', 'noScaleOrReflection']);
    if (nonessential) bone.color = r.color();
    data.bones.push(bone);
  });
  data.slots = r.list(() => {
    const slot = {name: r.name(), bone: r.ref(data.bones).name, color: r.color()};
    const dark = r.color(); if (dark !== 'ffffffff') slot.dark = dark.slice(2);
    slot.attachment = r.string();
    slot.blend = r.enum(['normal', 'additive', 'multiply', 'screen']);
    return slot;
  });
  const constraint = () => ({name: r.name(), order: r.int(), bones: r.list(() => r.ref(data.bones).name)});
  data.ik = r.list(() => ({...constraint(), target: r.ref(data.bones).name, mix: r.float(), bendPositive: r.bend()}));
  data.transform = r.list(() => ({...constraint(), target: r.ref(data.bones).name, local: r.bool(), relative: r.bool(),
    ...r.fields('rotation x y scaleX scaleY shearY rotateMix translateMix scaleMix shearMix')}));
  data.path = r.list(() => ({...constraint(), target: r.ref(data.slots).name,
    positionMode: r.enum(['fixed', 'percent']), spacingMode: r.enum(['length', 'fixed', 'percent']),
    rotateMode: r.enum(['tangent', 'chain', 'chainScale']), ...r.fields('rotation position spacing rotateMix translateMix')}));

  function vertices(count) {
    if (!r.bool()) return r.floats(count * 2);
    const values = [];
    for (let i = 0; i < count; i++) {
      const n = r.count(); values.push(n);
      for (let j = 0; j < n; j++) {
        const bone = r.int();
        if (bone < 0 || bone >= data.bones.length) r.fail('网格骨骼索引无效');
        values.push(bone, ...r.floats(3));
      }
    }
    return values;
  }
  function attachment(key) {
    const a = {name: r.string() ?? key, type: r.enum(['region','boundingbox','mesh','linkedmesh','path','point','clipping'], true)};
    switch (a.type) {
      case 'region':
        a.path = r.string() ?? a.name;
        Object.assign(a, r.fields('rotation x y scaleX scaleY width height'), {color: r.color()});
        break;
      case 'mesh': {
        a.path = r.string() ?? a.name; a.color = r.color();
        const count = r.count(); a.uvs = r.floats(count * 2); a.triangles = r.shorts();
        a.vertices = vertices(count); a.hull = r.int();
        if (nonessential) Object.assign(a, {edges: r.shorts()}, r.fields('width height'));
        break;
      }
      case 'linkedmesh':
        a.path = r.string() ?? a.name; a.color = r.color(); a.skin = r.string(); a.parent = r.name(); a.deform = r.bool();
        if (nonessential) Object.assign(a, r.fields('width height'));
        break;
      case 'point':
        Object.assign(a, r.fields('rotation x y'));
        if (nonessential) a.color = r.color();
        break;
      default:
        if (a.type === 'path') { a.closed = r.bool(); a.constantSpeed = r.bool(); }
        if (a.type === 'clipping') a.end = r.ref(data.slots).name;
        a.vertexCount = r.count(); a.vertices = vertices(a.vertexCount);
        if (a.type === 'path') a.lengths = r.floats(Math.floor(a.vertexCount / 3));
        if (nonessential) a.color = r.color();
    }
    return a;
  }
  const skinNames = [];
  function skin(name, isDefault = false) {
    const slots = r.count();
    if (!slots && isDefault) return;
    skinNames.push(name);
    const entries = data.skins[name] = record();
    for (let i = 0; i < slots; i++) {
      const attachments = entries[r.ref(data.slots).name] = record();
      r.list(() => { const key = r.name(); attachments[key] = attachment(key); });
    }
  }
  skin('default', true);
  r.list(() => skin(r.name()));
  const eventNames = r.list(() => {
    const name = r.name(); data.events[name] = {int: r.int(true), float: r.float(), string: r.string()}; return name;
  });

  function frames(read, curved = true) {
    const count = r.count();
    if (!count) r.fail('动画帧为空');
    return Array.from({length: count}, (_, i) => {
      const frame = {time: r.float(), ...read()};
      if (curved && i < count - 1) {
        const curve = r.enum(['linear','stepped','bezier'], true);
        if (curve === 'stepped') frame.curve = 'stepped';
        if (curve === 'bezier') frame.curve = r.floats(4);
      }
      return frame;
    });
  }
  function animation() {
    const a = {slots: record(), bones: record(), ik: record(), transform: record(), paths: record(), deform: record()};
    r.list(() => {
      const timelines = a.slots[r.ref(data.slots).name] = record();
      r.list(() => {
        const type = r.enum(['attachment','color','twoColor'], true);
        timelines[type] = frames(() => type === 'attachment' ? {name: r.string()}
          : type === 'color' ? {color: r.color()} : {light: r.color(), dark: r.color().slice(2)}, type !== 'attachment');
      });
    });
    r.list(() => {
      const timelines = a.bones[r.ref(data.bones).name] = record();
      r.list(() => {
        const type = r.enum(['rotate','translate','scale','shear'], true);
        timelines[type] = frames(() => r.fields(type === 'rotate' ? 'angle' : 'x y'));
      });
    });
    r.list(() => { a.ik[r.ref(data.ik).name] = frames(() => ({mix: r.float(), bendPositive: r.bend()})); });
    r.list(() => { a.transform[r.ref(data.transform).name] = frames(() => r.fields('rotateMix translateMix scaleMix shearMix')); });
    r.list(() => {
      const timelines = a.paths[r.ref(data.path).name] = record();
      r.list(() => {
        const type = r.enum(['position','spacing','mix'], true);
        timelines[type] = frames(() => r.fields(type === 'mix' ? 'rotateMix translateMix' : type));
      });
    });
    r.list(() => {
      const skinName = r.ref(skinNames), slots = a.deform[skinName] = record();
      r.list(() => {
        const slotName = r.ref(data.slots).name, attachments = slots[slotName] = record();
        r.list(() => {
          const name = r.name();
          if (!data.skins[skinName][slotName]?.[name]) r.fail('变形附件不存在');
          attachments[name] = frames(() => {
            const count = r.count();
            return count ? {offset: r.int(), vertices: r.floats(count)} : {};
          });
        });
      });
    });
    a.drawOrder = r.list(() => ({time: r.float(), offsets: r.list(() => ({slot: r.ref(data.slots).name, offset: r.int()}))}));
    a.events = r.list(() => {
      const event = {time: r.float(), name: r.ref(eventNames), int: r.int(true), float: r.float()};
      event.string = r.bool() ? r.string() : data.events[event.name].string;
      return event;
    });
    // Empty timelines must be omitted: the 3.6 JSON reader assumes at least one frame.
    if (!a.drawOrder.length) delete a.drawOrder;
    if (!a.events.length) delete a.events;
    return a;
  }
  r.list(() => { const name = r.name(); data.animations[name] = animation(); });
  if (r.pos !== r.bytes.length) r.fail('文件尾存在无法识别的数据');
  return data;
}

module.exports = {decodeSkeleton36};
