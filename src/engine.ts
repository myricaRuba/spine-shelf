import { assetUrl, type Asset } from "./types";
import { addReskin, skinAttachments } from "./reskin-runtime";

// The runtime APIs differ across Spine export versions. Keep that adaptation here.
let legacyPromise: Promise<any> | undefined;
let spine36Promise: Promise<any> | undefined;
async function getRuntime(version: string): Promise<any> {
  switch (version) {
    case "3.6":
      spine36Promise ??= new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = new URL("vendor/spine36.js", document.baseURI).href;
        script.onload = () => resolve({ ...window.spine36, ...window.spine36.webgl });
        script.onerror = () => {
          script.remove();
          spine36Promise = undefined;
          reject(new Error("Spine 3.6 运行库加载失败。"));
        };
        document.head.appendChild(script);
      });
      return spine36Promise;
    case "4.0":
      return import("spine40");
    case "4.1":
      return import("spine41");
    case "4.2":
      return import("spine42");
    case "4.3":
      return import("spine43");
    case "3.8":
      legacyPromise ??= new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = new URL("vendor/spine38.js", document.baseURI).href;
        script.onload = () =>
          resolve({ ...window.spine, ...window.spine.webgl });
        script.onerror = () => {
          legacyPromise = undefined;
          reject(new Error("Spine 3.8 运行库加载失败。"));
        };
        document.head.appendChild(script);
      });
      return legacyPromise;
    default:
      throw new Error(`暂不支持 Spine ${version}`);
  }
}
export class SpineEngine {
  runtime: any;
  renderer: any;
  manager: any;
  skeleton: any;
  state: any;
  data: any;
  canvas: HTMLCanvasElement;
  asset: Asset;
  gl!: WebGLRenderingContext;
  private offscreenWidth: number;
  private offscreenHeight: number;
  animation = "";
  skin = "";
  duration = 0;
  time = 0;
  playing = true;
  loop = true;
  speed = 1;
  zoom = 1;
  panX = 0;
  panY = 0;
  debug = false;
  flip = false;
  bounds = { x: 0, y: 0, width: 100, height: 100 };
  disposed = false;
  constructor(canvas: HTMLCanvasElement, asset: Asset) {
    this.canvas = canvas;
    this.asset = asset;
    this.offscreenWidth = canvas.width;
    this.offscreenHeight = canvas.height;
  }
  async load() {
    const rt = (this.runtime = await getRuntime(this.asset.runtime));
    if (this.disposed) return;
    const gl = this.canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
      antialias: true,
    });
    if (!gl) throw new Error("无法创建 WebGL 预览，请重启应用后重试。");
    this.gl = gl;
    this.renderer = new rt.SceneRenderer(this.canvas, gl);
    this.manager = new rt.AssetManager(gl);
    try {
      const atlasPath = assetUrl(this.asset, "texture.atlas");
      const legacyBinary = this.asset.runtime === "3.6" && this.asset.format === "skel";
      const jsonPreview = legacyBinary || this.asset.format === "json";
      const [atlas, response] = await Promise.all([
        new Promise<any>((resolve, reject) =>
          this.manager.loadTextureAtlas(
            atlasPath,
            (_path: string, atlas: any) => resolve(atlas),
            (_path: string, message: string) => reject(new Error(message)),
          ),
        ),
        fetch(assetUrl(this.asset, legacyBinary ? "preview.json" : `skeleton.${this.asset.format}`)),
      ]);
      if (this.disposed) {
        this.manager.dispose();
        return;
      }
      if (!response.ok) throw new Error("骨骼文件读取失败。");
      const loader = new rt.AtlasAttachmentLoader(atlas);
      const reader =
        jsonPreview
          ? new rt.SkeletonJson(loader)
          : new rt.SkeletonBinary(loader);
      const content =
        jsonPreview
          ? await response.json()
          : new Uint8Array(await response.arrayBuffer());
      if (this.disposed) return;
      this.data = reader.readSkeletonData(content);
      for (const layer of this.asset.reskins || []) {
        const extra = await new Promise<any>((resolve, reject) =>
          this.manager.loadTextureAtlas(assetUrl(this.asset, layer.atlas),
            (_path: string, value: any) => resolve(value),
            (_path: string, message: string) => reject(new Error(message))),
        );
        if (this.disposed) return;
        addReskin(rt, this.data, extra, layer.name, layer.baseSkin);
      }
      this.skeleton = new rt.Skeleton(this.data);
      const skins = this.data.skins;
      const skin = skins.find((s: any) => s.name === this.asset.reskins?.at(-1)?.name)
        || skins.find((s: any) => s.name !== "default") || skins[0];
      if (skin) {
        this.applySkin(skin.name);
        this.skin = skin.name;
      }
      this.setupPose();
      const stateData = new rt.AnimationStateData(this.data);
      stateData.defaultMix = 0.15;
      this.state = new rt.AnimationState(stateData);
      const animations = this.data.animations;
      const animation =
        animations.find((a: any) => /^(idle|walk|run)$/i.test(a.name)) ||
        animations[0];
      if (animation) this.setAnimation(animation.name);
      this.worldTransform();
      this.fit();
      this.draw();
    } catch (error) {
      this.dispose();
      const missing = error instanceof Error && /^Region not found in atlas: (.*?) \((?:region|mesh) attachment:/.exec(error.message);
      if (missing) throw new Error(`图集缺少图块「${missing[1]}」。骨骼与图集不匹配或素材不完整，请补齐对应的 atlas 和贴图。`);
      throw error;
    }
  }
  worldTransform() {
    this.skeleton.updateWorldTransform(this.runtime.Physics?.update);
  }
  currentTrack() {
    return this.asset.runtime === "4.3"
      ? this.state.getTrack(0)
      : this.state.getCurrent(0);
  }
  setupPose() {
    if (this.asset.runtime === "4.3") this.skeleton.setupPose();
    else this.skeleton.setToSetupPose();
  }
  applySkin(name: string) {
    if (this.asset.runtime === "4.3") this.skeleton.setSkin(name);
    else this.skeleton.setSkinByName(name);
  }
  setAnimation(name: string) {
    this.animation = name;
    this.time = 0;
    const entry = this.state.setAnimation(0, name, this.loop);
    this.duration = entry.animation.duration;
    this.setupPose();
    this.state.update(0);
    this.state.apply(this.skeleton);
    this.worldTransform();
  }
  setSkin(name: string) {
    this.applySkin(name);
    this.skin = name;
    if (this.asset.runtime === "4.3") this.skeleton.setupPoseSlots();
    else this.skeleton.setSlotsToSetupPose();
    this.state.apply(this.skeleton);
    this.worldTransform();
    this.fit();
  }
  setLoop(loop: boolean) {
    this.loop = loop;
    const track = this.currentTrack();
    if (track) track.loop = loop;
  }
  seek(seconds: number) {
    if (!this.animation) return;
    // Reset state for deterministic seeking, including physics in 4.2+.
    this.setupPose();
    this.state.clearTracks();
    const track = this.state.setAnimation(0, this.animation, this.loop);
    track.mixDuration = 0;
    this.time = Math.max(0, Math.min(this.duration, seconds));
    this.state.update(this.time);
    this.state.apply(this.skeleton);
    this.skeleton.updateWorldTransform(this.runtime.Physics?.reset);
    this.draw();
  }
  fit() {
    const offset = new this.runtime.Vector2(),
      size = new this.runtime.Vector2();
    this.skeleton.getBounds(offset, size, []);
    if (
      Number.isFinite(size.x) &&
      Number.isFinite(size.y) &&
      size.x + size.y > 0
    )
      this.bounds = {
        x: offset.x,
        y: offset.y,
        width: Math.max(1, size.x),
        height: Math.max(1, size.y),
      };
    this.zoom = 1;
    this.panX = this.panY = 0;
  }
  tick(delta: number) {
    if (this.disposed || !this.skeleton) return;
    if (this.canvas.isConnected && !this.canvas.clientWidth) return;
    if (this.playing) {
      const dt = Math.min(delta, 0.06) * this.speed;
      this.state.update(dt);
      this.state.apply(this.skeleton);
      this.skeleton.update?.(dt);
      const track = this.currentTrack();
      this.time = track
        ? this.loop && this.duration > 0
          ? track.trackTime % this.duration
          : Math.min(track.trackTime, this.duration)
        : 0;
      if (!this.loop && this.duration > 0 && this.time >= this.duration)
        this.playing = false;
    }
    if (this.asset.runtime === "3.6") this.skeleton.flipX = this.flip;
    else this.skeleton.scaleX = this.flip ? -1 : 1;
    this.worldTransform();
    this.draw();
  }
  draw() {
    if (this.disposed || !this.skeleton) return;
    const canvas = this.canvas;
    if (canvas.isConnected && !canvas.clientWidth) return;
    const width = canvas.clientWidth || this.offscreenWidth,
      height = canvas.clientHeight || this.offscreenHeight;
    const ratio = canvas.isConnected
      ? Math.min(window.devicePixelRatio || 1, 2)
      : 1;
    if (
      canvas.width !== Math.round(width * ratio) ||
      canvas.height !== Math.round(height * ratio)
    ) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    const b = this.bounds;
    const worldHeight =
      Math.max(b.height * 1.28, (b.width * 1.28) / (width / height)) /
      this.zoom;
    const camera = this.renderer.camera;
    camera.setViewport((worldHeight * width) / height, worldHeight);
    camera.position.x =
      (this.flip ? -(b.x + b.width / 2) : b.x + b.width / 2) + this.panX;
    camera.position.y = b.y + b.height / 2 + this.panY;
    camera.update();
    this.gl.viewport(0, 0, canvas.width, canvas.height);
    this.gl.clearColor(0, 0, 0, 0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    this.renderer.begin();
    if (this.asset.runtime === "4.3") this.renderer.drawSkeleton(this.skeleton);
    else this.renderer.drawSkeleton(this.skeleton, this.asset.pma);
    if (this.debug) {
      const debug = this.renderer.skeletonDebugRenderer;
      debug.drawBones = true;
      debug.drawRegionAttachments = false;
      debug.drawMeshHull = false;
      debug.drawMeshTriangles = false;
      if (this.asset.runtime === "4.3")
        this.renderer.drawSkeletonDebug(this.skeleton);
      else this.renderer.drawSkeletonDebug(this.skeleton, this.asset.pma);
    }
    this.renderer.end();
  }
  capture() {
    this.draw();
    return this.canvas.toDataURL("image/png");
  }
  metadata() {
    return {
      animations: this.data.animations.map((a: any) => a.name),
      skins: this.data.skins.map((s: any) => s.name),
      bones: this.data.bones.length,
      slots: this.data.slots.length,
      contentFeatures: {
        boneNames: this.data.bones.map((bone: any) => bone.name),
        slotNames: this.data.slots.map((slot: any) => slot.name),
        attachmentNames: this.data.skins.flatMap((skin: any) =>
          skinAttachments(skin)
            .map((entry: any) => entry.attachment?.path || entry.name || ""),
        ),
        animationNames: this.data.animations.map(
          (animation: any) => animation.name,
        ),
      },
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer?.dispose();
    this.manager?.dispose();
    this.gl?.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
