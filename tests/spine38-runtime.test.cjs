const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function runtime() {
  const context = vm.createContext({ console });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../public/vendor/spine38.js"), "utf8"),
    context,
  );
  return context.spine;
}

// Small original fixture exercises the same atlas → JSON → animation path as
// SpineEngine.load, without checking a user's character into the repository.
function fixture(version) {
  return {
    skeleton: { spine: version, width: 10, height: 10 },
    bones: [{ name: "root" }, { name: "arm", parent: "root" }],
    slots: [{ name: "body", bone: "arm", attachment: "body" }],
    skins: [{ name: "default", attachments: { body: { body: {
      type: "mesh", uvs: [0, 0, 1, 0, 1, 1, 0, 1],
      triangles: [0, 1, 2, 2, 3, 0],
      vertices: [0, 0, 10, 0, 10, 10, 0, 10], hull: 4,
      width: 10, height: 10,
    } } } }],
    animations: { move: { bones: { arm: {
      translate: [{ time: 0 }, { time: 1, x: 20, y: 10 }],
    } } } },
  };
}

for (const version of ["3.8.75", "3.8.99"]) {
  test(`Spine ${version} JSON loads an atlas mesh and animates without rewriting input`, () => {
    const rt = runtime();
    const atlas = new rt.TextureAtlas(
      "page.png\nsize: 10,10\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\nbody\n  rotate: false\n  xy: 0,0\n  size: 10,10\n  orig: 10,10\n  offset: 0,0\n  index: -1\n",
      () => new rt.FakeTexture({ width: 10, height: 10 }),
    );
    const input = fixture(version);
    const before = JSON.stringify(input);
    const data = new rt.SkeletonJson(new rt.AtlasAttachmentLoader(atlas)).readSkeletonData(input);
    assert.equal(data.version, version);
    assert.equal(JSON.stringify(input), before);
    const skeleton = new rt.Skeleton(data);
    const state = new rt.AnimationState(new rt.AnimationStateData(data));
    state.setAnimation(0, "move", false);
    state.update(0.5);
    state.apply(skeleton);
    skeleton.updateWorldTransform();
    assert.ok(Math.abs(skeleton.findBone("arm").worldX - 10) < 1e-5);
    assert.ok(Math.abs(skeleton.findBone("arm").worldY - 5) < 1e-5);
    const slot = skeleton.slots[0];
    const vertices = new Float32Array(8);
    slot.attachment.computeWorldVertices(slot, 0, 8, vertices, 0, 2);
    const expected = [10, 5, 20, 5, 20, 15, 10, 15];
    assert.ok(vertices.every((value, i) => Math.abs(value - expected[i]) < 1e-5));
  });
}

test("legacy JSON compatibility retains structural validation", () => {
  const rt = runtime();
  const input = fixture("3.8.75");
  input.bones[1].parent = "missing";
  assert.throws(() => new rt.SkeletonJson({}).readSkeletonData(input), /Parent bone not found: missing/);
});

test("3.8.75 binary remains unsupported until its format is verified", () => {
  const rt = runtime();
  const string = (value) => Buffer.concat([Buffer.from([value.length + 1]), Buffer.from(value)]);
  const header = Buffer.concat([string("test"), string("3.8.75")]);
  assert.throws(() => new rt.SkeletonBinary({}).readSkeletonData(new Uint8Array(header)), /Unsupported skeleton data/);
});
