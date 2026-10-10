const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  classify,
  featuresFromJSON,
  atlasRegionNames,
} = require("../electron/classifier.cjs");

test("non-humanoid characters are recognized from a complete combat lifecycle", () => {
  assert.equal(classify({ name: "10020", features: { boneNames: ["root", "head", "eye_L"], animationNames: ["attack01", "attack02", "move", "suffer", "death", "frozen"] } }).category, "character");
  assert.equal(classify({ name: "effect01", features: { animationNames: ["attack01", "attack02", "attack03"] } }).category, "unclassified");
});
test("UI containers mentioning heroes or levels are not mistaken for characters or scenes", () => {
  assert.equal(classify({ name: "ui_hero_blue", features: { boneNames: ["root", "bone1"], animationNames: ["idle"] } }).category, "material");
  assert.equal(classify({ name: "ui_level_up", features: { animationNames: ["idle1", "idle2"] } }).category, "material");
  assert.equal(classify({ name: "ui_hero_portrait", features: { boneNames: ["hip", "head", "arm", "leg"], slotNames: ["head", "body", "arm"], animationNames: ["walk", "attack"] } }).category, "character");
});

test("an opaque filename is classified from anatomy and movement rather than the file name", () => {
  const result = classify({
    name: "103945",
    features: {
      boneNames: ["root", "hip", "head", "front-arm", "back-leg"],
      animationNames: ["walk", "attack"],
    },
  });
  assert.equal(result.category, "character");
  assert.equal(result.categoryConfidence, "high");
  assert.ok(result.categoryReasons.some((reason) => reason.includes("骨骼")));
});
test("scene layers, frame regions and text attachments determine their respective categories", () => {
  assert.equal(
    classify({
      name: "001",
      regionNames: ["sky", "cloud-2", "mountain", "grass", "foreground"],
    }).category,
    "scene",
  );
  assert.equal(
    classify({
      name: "002",
      regionNames: ["panel-frame", "text-label", "button-confirm"],
    }).category,
    "material",
  );
  assert.equal(
    classify({
      name: "003",
      features: { attachmentNames: ["数字_01", "标题_欢迎"] },
    }).category,
    "material",
  );
  assert.equal(
    classify({
      name: "004",
      regionNames: [
        "top-left",
        "top-right",
        "bottom-left",
        "bottom-right",
        "center",
      ],
    }).category,
    "material",
  );
});
test("unclear and conflicting assets are left unclassified instead of forced into ordinary materials", () => {
  assert.equal(
    classify({
      name: "001",
      features: {
        boneNames: ["root", "bone1", "bone2"],
        animationNames: ["animation", "idle"],
      },
      regionNames: ["image1"],
    }).category,
    "unclassified",
  );
  assert.equal(
    classify({
      name: "headquarters",
      regionNames: ["toolbarrel", "earthquake", "manipulate"],
    }).category,
    "unclassified",
  );
  assert.equal(
    classify({
      name: "001",
      features: { boneNames: ["head", "hip", "arm"] },
      regionNames: ["sky", "ground", "tree"],
    }).category,
    "unclassified",
  );
});
test("English token boundaries, camel case and Chinese labels are supported", () => {
  assert.equal(classify({ name: "battleScene" }).category, "scene");
  assert.equal(classify({ name: "活动文字" }).category, "material");
  assert.equal(classify({ name: "主角人物" }).category, "character");
  assert.equal(classify({ name: "a_hero_02" }).category, "character");
  assert.equal(classify({ name: "barrel" }).category, "unclassified");
});
test("JSON skin schemas and atlas pages do not get confused with texture region names", () => {
  const slots = { "slot-0": { "attachment-0": { path: "title" } } };
  for (const skins of [
    { default: slots },
    [{ name: "default", attachments: slots }],
  ]) {
    const features = featuresFromJSON({
      bones: [{ name: "root" }],
      slots: [{ name: "slot-0" }],
      skins,
      animations: { animation: {} },
    });
    assert.equal(classify({ name: "001", features }).category, "material");
  }
  const regions = atlasRegionNames(
    "\ncharacters.png\nsize: 512,512\nfilter: Linear,Linear\ntext_label\n  bounds: 0,0,10,10\n\nscene.png\nsize: 512,512\nbutton\n bounds: 0,0,10,10\n",
  );
  assert.deepEqual(regions, ["text_label", "button"]);
});
