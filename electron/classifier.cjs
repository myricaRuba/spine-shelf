// Local, explainable content rules. No cloud calls or visual-model claims.
const CLASSIFIER_VERSION = 1;
const CATEGORIES = ["character", "scene", "material", "unclassified"];
const MAX_NAMES = 12000;

function names(values) {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(
      values.filter((v) => typeof v === "string").map((v) => v.slice(0, 240)),
    ),
  ].slice(0, MAX_NAMES);
}
function sanitizeFeatures(value) {
  return Object.fromEntries(
    ["boneNames", "slotNames", "attachmentNames", "animationNames"].map(
      (key) => [key, names(value?.[key])],
    ),
  );
}
function featuresFromJSON(json) {
  const attachmentNames = [];
  const skins = Array.isArray(json.skins)
    ? json.skins.map((skin) => skin.attachments)
    : Object.values(json.skins || {});
  for (const skin of skins)
    for (const slot of Object.values(skin || {})) {
      for (const [name, attachment] of Object.entries(slot || {})) {
        attachmentNames.push(name);
        if (typeof attachment?.path === "string")
          attachmentNames.push(attachment.path);
      }
    }
  return sanitizeFeatures({
    boneNames: (json.bones || []).map((bone) => bone.name),
    slotNames: (json.slots || []).map((slot) => slot.name),
    attachmentNames,
    animationNames: Object.keys(json.animations || {}),
  });
}
function atlasRegionNames(text) {
  let page = true;
  const result = [];
  for (const line of text.replace(/\r/g, "").split("\n")) {
    const value = line.trim();
    if (!value) {
      page = true;
      continue;
    }
    if (page) {
      page = false;
      continue;
    }
    if (!value.includes(":")) result.push(value);
  }
  return names(result);
}
function binaryNames(buffer) {
  // Initial hints only; precise bone/slot/animation names replace these after
  // the matching official runtime decodes the skeleton in the preview queue.
  return names(
    buffer
      .toString("utf8")
      .match(/[A-Za-z\u3400-\u9fff][A-Za-z0-9\u3400-\u9fff_./ -]{2,160}/g) ||
      [],
  );
}
function normalize(text) {
  return String(text || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[0-9_.\/\\-]+/g, " ");
}
function term(text, english, chinese = "") {
  return new RegExp(
    `(?:^|[^a-z])(?:${english})(?:s|es)?(?:$|[^a-z])${chinese ? `|${chinese}` : ""}`,
    "i",
  ).test(text);
}
const anatomy = [
  ["head|neck|skull|eye|jaw", "头|颈|眼|下巴"],
  ["body|torso|hip|pelvis|chest|waist|spine", "身体|躯干|盆骨|腰|胸"],
  ["arm|hand|shoulder|elbow|wrist|fist", "手臂|胳膊|肩|肘|手掌|拳"],
  ["leg|foot|feet|thigh|shin|knee|ankle", "腿|脚|膝|踝"],
  ["tail|wing|paw|tentacle", "尾巴|翅膀|爪|触手"],
];
const sceneParts = [
  ["sky|cloud|sun|moon|starfield", "天空|云朵|太阳|月亮|星空"],
  ["ground|terrain|grass|land|floor", "地面|地形|草地|地板"],
  ["mountain|hill|rock|cliff", "山峰|山脉|山体|岩石|悬崖"],
  ["tree|forest|bush|foliage|leaf|leaves", "树木|森林|树林|灌木|树叶"],
  ["sea|ocean|river|water|lake|waterfall", "大海|海洋|河流|湖泊|瀑布|水面"],
  ["building|house|castle|city|wall|roof", "建筑|房屋|城堡|城市|墙壁|屋顶"],
  ["background|foreground|midground|parallax", "远景|中景|前景|远山"],
];
const uiParts = [
  ["frame|border|panel|window|dialog|popup", "边框|外框|相框|面板|弹窗|窗口"],
  [
    "text|label|title|font|glyph|word|caption|number|digit|txt",
    "文字|文本|标题|字形|字体|字幕|数字",
  ],
  [
    "button|btn|checkbox|toggle|slider|input|tab",
    "按钮|复选框|开关|滑块|输入框|页签",
  ],
  ["progress|healthbar|loadingbar|bar|meter", "进度条|血条|能量条"],
  ["icon|badge|emblem|logo|ribbon|banner", "图标|徽章|标志|飘带|横幅"],
];
function groupHits(text, groups) {
  return groups.filter(([en, zh]) => term(text, en, zh)).length;
}

function classify({
  name = "",
  features = {},
  regionNames = [],
  binaryHints = [],
} = {}) {
  const clean = sanitizeFeatures(features);
  const title = normalize(name);
  const bones = normalize(clean.boneNames.join(" "));
  const parts = normalize(
    [...clean.slotNames, ...clean.attachmentNames, ...regionNames].join(" "),
  );
  const hints = normalize(binaryHints.join(" "));
  const actions = normalize(clean.animationNames.join(" "));
  const explicitInterface = term(title, "ui|hud|gui", "界面");
  const score = { character: 0, scene: 0, material: 0 };
  const reasons = { character: [], scene: [], material: [] };
  const add = (category, weight, reason) => {
    score[category] += weight;
    reasons[category].push(reason);
  };

  if (
    !explicitInterface && term(
      title,
      "character|char|hero|player|enemy|npc|boss|monster|creature|pet|animal|goblin|dragon",
      "人物|角色|英雄|怪物|宠物|动物",
    )
  )
    add("character", 8, "名称包含角色或生物标识");
  if (
    term(
      title,
      "scene|scenery|landscape|environment|background|bg|map",
      "场景|风景|环境|背景|地图",
    )
  )
    add("scene", 8, "名称包含场景或背景标识");
  if (explicitInterface || groupHits(title, uiParts))
    add("material", explicitInterface ? 12 : 8, "名称包含界面、边框或文字标识");

  const boneParts = groupHits(bones, anatomy),
    imageParts = groupHits(parts, anatomy);
  if (boneParts >= 3)
    add("character", 12, "骨骼包含头部、躯干、四肢等多个身体部位");
  else if (boneParts === 2) add("character", 4, "骨骼包含多个身体部位");
  if (imageParts >= 3) add("character", 8, "图集或附件包含成套身体部件");
  const movementCount = [
    "walk|walking",
    "run|running",
    "jump|jumping",
    "attack|shoot|hit|death|die|roar",
  ].filter((en) => term(actions, en)).length;
  if (movementCount)
    add("character", movementCount > 1 ? 5 : 3, "包含行走、奔跑或战斗动作");
  if (term(actions, "locomotion", "行走|走路|奔跑|跑步|攻击|死亡|跳跃"))
    add("character", 4, "包含角色运动动作");
  const combatStates = ["walk|run|move|jump", "attack|shoot|cast|skill", "hit|hurt|suffer|damage|block", "death|die", "frozen|stun|vertigo"].filter(en => term(actions, en)).length;
  if (combatStates >= 3 && (boneParts > 0 || term(actions, "walk|run|move|jump")))
    add("character", 10, "包含移动、攻击、受击或死亡等完整角色状态");
  if (!clean.boneNames.length && groupHits(hints, anatomy) >= 3)
    add("character", 8, "二进制文件包含多种身体部位名称");

  const scenery = groupHits(`${bones} ${parts}`, sceneParts);
  if (scenery >= 2)
    add(
      "scene",
      Math.min(12, scenery * 4),
      "包含天空、地面、建筑或植被等环境图层",
    );
  else if (scenery) add("scene", 3, "包含环境图层名称");
  const interfaces = groupHits(`${bones} ${parts}`, uiParts);
  if (interfaces)
    add(
      "material",
      Math.min(12, interfaces * 6),
      "包含边框、文字、按钮或界面控件区域",
    );
  if (!clean.boneNames.length) {
    if (groupHits(hints, sceneParts) >= 2)
      add("scene", 7, "二进制文件包含多种环境图层名称");
    if (groupHits(hints, uiParts) >= 2)
      add("material", 7, "二进制文件包含多种界面元素名称");
  }
  const slices = [
    "top left",
    "top right",
    "bottom left",
    "bottom right",
    "center",
  ].filter((position) => parts.includes(position));
  if (slices.length >= 4) add("material", 8, "包含九宫格边框的角与中心区域");

  const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
  const [winner, value] = ranked[0],
    margin = value - ranked[1][1];
  const certain = value >= 6 && margin >= 3;
  return {
    category: certain ? winner : "unclassified",
    categorySource: "auto",
    categoryConfidence: certain
      ? value >= 12 && margin >= 6
        ? "high"
        : "medium"
      : "low",
    categoryReasons: certain
      ? reasons[winner]
      : [
          value >= 6
            ? "素材包含多类内容，暂不能确定主要类别"
            : "内容线索不足，可在资源信息中手动选择类别",
        ],
    classificationVersion: CLASSIFIER_VERSION,
  };
}
module.exports = {
  CLASSIFIER_VERSION,
  CATEGORIES,
  classify,
  sanitizeFeatures,
  featuresFromJSON,
  atlasRegionNames,
  binaryNames,
};
