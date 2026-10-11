const fs=require('node:fs/promises');
const path=require('node:path');

// One offline HTML document: no server, credentials, or access to library APIs.
async function writeGenerationPreview(directory,validation) {
  const [runtime,json,atlas,png,license]=await Promise.all([
    fs.readFile(path.join(path.dirname(require.resolve('spine42')),'iife','spine-webgl.js'),'utf8'),
    fs.readFile(path.join(directory,'skeleton.json'),'utf8'),
    fs.readFile(path.join(directory,'texture.atlas'),'utf8'),
    fs.readFile(path.join(directory,'texture.png')),
    fs.readFile(path.join(path.dirname(require.resolve('spine42')),'..','LICENSE'),'utf8'),
  ]);
  const payload=JSON.stringify({json:JSON.parse(json),atlas,image:`data:image/png;base64,${png.toString('base64')}`,validation}).replace(/</g,'\\u003c');
  const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Spine 动作检查</title>
<style>*{box-sizing:border-box}body{margin:0;background:#141a20;color:#dce6ec;font:14px system-ui}header{padding:18px 24px;border-bottom:1px solid #35404a}h1{font-size:20px;margin:0 0 8px}p{color:#9eaeb8;margin:7px 0}main{max-width:1100px;margin:auto}nav{display:flex;gap:16px;align-items:center;flex-wrap:wrap;padding:16px}button,select{background:#28333d;border:1px solid #596771;color:inherit;padding:8px 14px;border-radius:6px}canvas{display:block;width:100%;height:calc(100vh - 235px);min-height:400px;background-image:linear-gradient(#ffffff05 1px,transparent 1px),linear-gradient(90deg,#ffffff05 1px,transparent 1px);background-size:24px 24px}input[type=range]{flex:1;min-width:160px;accent-color:#c8ed91}label{display:flex;gap:7px;align-items:center}footer{padding:12px 24px;color:#9eaeb8}#error{color:#ffad97;white-space:pre-wrap}</style>
<header><h1>Spine 动作检查</h1><p id="stats"></p><p>拖动时间轴检查落脚、关节与重心；打开骨骼和网格检查变形。结构检查通过不代表动作质量合格。</p></header>
<main><nav><select id="animation" aria-label="动作"></select><button id="play">暂停</button><label>速度<select id="speed"><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="1" selected>1×</option></select></label><label><input id="debug" type="checkbox">骨骼与网格</label><label><input id="loop" type="checkbox" checked>循环预览</label></nav><canvas id="stage"></canvas><nav><input id="time" aria-label="时间" type="range" min="0" max="1" step="0.001"><output id="clock"></output></nav></main><footer id="error"></footer>
<pre hidden>${license.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</pre>
<script>${runtime.replace(/<\/script/gi,'<\\/script').replace(/\/\/# sourceMappingURL=.*$/gm,'')}</script><script>
const payload=${payload};
(async()=>{
const $=id=>document.getElementById(id),canvas=$('stage'),rt=spine;
const gl=canvas.getContext('webgl',{alpha:true,antialias:true,preserveDrawingBuffer:true});if(!gl)throw Error('WebGL 不可用');
const renderer=new rt.SceneRenderer(canvas,gl),image=new Image();image.src=payload.image;await image.decode();
const atlas=new rt.TextureAtlas(payload.atlas);for(const page of atlas.pages)page.setTexture(new rt.GLTexture(gl,image));
const data=new rt.SkeletonJson(new rt.AtlasAttachmentLoader(atlas)).readSkeletonData(payload.json),skeleton=new rt.Skeleton(data);
let animation,playing=true,time=0,bounds;
const debug=renderer.skeletonDebugRenderer;debug.drawBones=true;debug.drawRegionAttachments=false;debug.drawMeshHull=false;debug.drawMeshTriangles=true;
function pose(t){skeleton.setToSetupPose();animation.apply(skeleton,-1,t,false,[],1,rt.MixBlend.replace,rt.MixDirection.mixIn);skeleton.updateWorldTransform(rt.Physics.none);}
function fit(){let x=Infinity,y=Infinity,right=-Infinity,top=-Infinity;for(let i=0;i<=32;i++){pose(animation.duration*i/32);const o=new rt.Vector2(),s=new rt.Vector2();skeleton.getBounds(o,s,[]);x=Math.min(x,o.x);y=Math.min(y,o.y);right=Math.max(right,o.x+s.x);top=Math.max(top,o.y+s.y);}bounds={x,y,width:right-x,height:top-y};}
function draw(){pose(time);const w=canvas.clientWidth,h=canvas.clientHeight;if(canvas.width!==w)canvas.width=w;if(canvas.height!==h)canvas.height=h;const size=Math.max(bounds.height*1.15,bounds.width*1.15*h/w,1);renderer.camera.setViewport(size*w/h,size);renderer.camera.position.x=bounds.x+bounds.width/2;renderer.camera.position.y=bounds.y+bounds.height/2;renderer.camera.update();gl.viewport(0,0,w,h);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);renderer.begin();renderer.line(-1000,0,1000,0,new rt.Color(.4,.5,.4,.6));renderer.drawSkeleton(skeleton,false);if($('debug').checked)renderer.drawSkeletonDebug(skeleton,false);renderer.end();$('time').value=time;$('clock').textContent=time.toFixed(2)+' / '+animation.duration.toFixed(2)+' 秒';}
function select(name){animation=data.findAnimation(name);time=0;fit();$('animation').value=name;$('time').max=animation.duration;$('loop').checked=payload.validation.samples?.find(s=>s.name===name)?.loop??true;draw();}
for(const a of data.animations){const option=document.createElement('option');option.value=option.textContent=a.name;$('animation').append(option);}
$('stats').textContent=payload.validation.bones+' 根骨骼 · '+payload.validation.meshes+' 个网格 · '+payload.validation.ik+' 条 IK 链 · '+payload.validation.curvedSegments+' 段缓动';
$('animation').onchange=()=>select($('animation').value);$('play').onclick=()=>{playing=!playing;$('play').textContent=playing?'暂停':'播放';};$('time').oninput=()=>{playing=false;$('play').textContent='播放';time=+$('time').value;draw();};$('debug').onchange=draw;
select(data.findAnimation('walk')?'walk':data.animations[0].name);
window.spinePreview={data,skeleton,select,seek(t){playing=false;$('play').textContent='播放';time=Math.min(animation.duration,Math.max(0,t));draw();},debug(value){$('debug').checked=value;draw();},get time(){return time;}};
let last=performance.now();function tick(now){const dt=Math.min(.1,(now-last)/1000);last=now;if(playing){time+=dt*+$('speed').value;if(time>animation.duration){time=$('loop').checked?time%animation.duration:animation.duration;}}draw();requestAnimationFrame(tick);}requestAnimationFrame(tick);
})().catch(e=>{document.getElementById('error').textContent=e.stack||String(e);});
</script></html>`;
  const file=path.join(directory,'preview.html');await fs.writeFile(file,html);return file;
}
module.exports={writeGenerationPreview};
