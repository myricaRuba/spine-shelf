#!/usr/bin/env python3
"""Render a static setup-pose attachment preview, not a Spine runtime."""
import argparse
import math
from pathlib import Path
import tempfile
from PIL import Image, ImageDraw, ImageChops
import spine_reskin as core
import spine_mesh as mesh


def point(matrix, x, y):
    a,b,c,d,tx,ty=matrix
    return a*x+b*y+tx,c*x+d*y+ty


def world_matrices(skeleton, notes):
    matrices=[];names={}
    for i,bone in enumerate(skeleton['bones']):
        parent=matrices[names[bone['parent']]] if 'parent' in bone else (1,0,0,1,0,0)
        a,b,c,d,_,_=parent
        x,y=point(parent,bone.get('x',0),bone.get('y',0))
        mode=bone.get('transform','normal')
        if mode=='onlyTranslation':a,b,c,d=1,0,0,1
        elif mode=='noRotationOrReflection':
            sx=math.hypot(a,c);sy=math.hypot(b,d)
            if abs(a*b+c*d)>1e-6:notes.append(f'{bone["name"]}: inherited shear approximated for noRotationOrReflection')
            a,b,c,d=sx,0,0,sy
        elif mode in ('noScale','noScaleOrReflection'):
            sx=math.hypot(a,c);sy=math.hypot(b,d)
            core.require(sx>0 and sy>0,'Zero parent scale')
            a,c=a/sx,c/sx;b,d=b/sy,d/sy
            if mode=='noScaleOrReflection' and a*d-b*c<0:b,d=-b,-d
            notes.append(f'{bone["name"]}: noScale transform uses normalized parent axes')
        else:core.require(mode=='normal',f'Unsupported bone transform: {mode}')
        rx=math.radians(bone.get('rotation',0)+bone.get('shearX',0));ry=math.radians(bone.get('rotation',0)+90+bone.get('shearY',0))
        sx=bone.get('scaleX',1);sy=bone.get('scaleY',1)
        la,lb,lc,ld=math.cos(rx)*sx,math.cos(ry)*sy,math.sin(rx)*sx,math.sin(ry)*sy
        matrices.append((a*la+b*lc,a*lb+b*ld,c*la+d*lc,c*lb+d*ld,x,y));names[bone['name']]=i
    return matrices,names


def mesh_vertices(attachment, matrix, matrices):
    vertices=attachment['vertices'];uv=attachment['uvs']
    if len(vertices)==len(uv):return [point(matrix,vertices[k],vertices[k+1]) for k in range(0,len(vertices),2)]
    result=[];k=0
    while k<len(vertices):
        count=vertices[k];k+=1
        core.require(count==int(count) and count>0,'Invalid weighted vertex count')
        x=y=0
        for _ in range(int(count)):
            core.require(k+4<=len(vertices),'Incomplete weighted vertex')
            bi,xx,yy,weight=vertices[k:k+4];k+=4
            core.require(bi==int(bi) and 0<=bi<len(matrices),'Invalid weighted bone index')
            wx,wy=point(matrices[int(bi)],xx,yy);x+=wx*weight;y+=wy*weight
        result.append((x,y))
    core.require(len(result)*2==len(uv),'Weighted vertex/UV count differs')
    return result


def draw_triangle(canvas, texture, dst, src):
    x0=max(0,math.floor(min(x for x,y in dst))-1);y0=max(0,math.floor(min(y for x,y in dst))-1)
    x1=min(canvas.width,math.ceil(max(x for x,y in dst))+1);y1=min(canvas.height,math.ceil(max(y for x,y in dst))+1)
    if x1<=x0 or y1<=y0:return
    (a,b),(c,d),(e,f)=dst;det=a*(d-f)+c*(f-b)+e*(b-d)
    if abs(det)<1e-10:return
    def coeff(values):
        u,v,w=values
        A=(u*(d-f)+v*(f-b)+w*(b-d))/det
        B=(u*(e-c)+v*(a-e)+w*(c-a))/det
        C=(u*(c*f-e*d)+v*(e*b-a*f)+w*(a*d-c*b))/det
        return A,B,C+A*x0+B*y0
    tile=texture.transform((x1-x0,y1-y0),Image.Transform.AFFINE,coeff([x for x,y in src])+coeff([y for x,y in src]),Image.Resampling.BILINEAR)
    mask=Image.new('L',tile.size);ImageDraw.Draw(mask).polygon([(x-x0,y-y0) for x,y in dst],fill=255)
    # Copy within each triangle into a single attachment layer. Shared edges must
    # not alpha-composite the same translucent texture twice.
    canvas.paste(tile,(x0,y0),mask)


def run(args):
    mp=Path(args.manifest).resolve();manifest=core.load_manifest(mp);skeleton=core.read_json(manifest['source_json']);core.attachments(skeleton)
    notes=[]
    for key in ('ik','transform','path'):
        if skeleton.get(key):notes.append(f'{key} constraints are NOT solved')
    matrices,names=world_matrices(skeleton,notes);parts={p['region']:p for p in manifest['parts']}
    files={p['region']:mp.parent/p['file'] for p in manifest['parts']}
    if args.replacements:
        plan=Path(args.replacements).resolve()
        for item in core.read_json(plan)['replacements']:
            core.require(item['region'] in files and item.get('alpha','straight')=='straight','Unknown region or non-straight replacement')
            path=Path(item['image']);files[item['region']]=path if path.is_absolute() else plan.parent/path
    overrides=dict(entry.split('=',1) for entry in args.attachment)
    skin=mesh.skin_map(skeleton,args.skin);drawables=[]
    for slot in skeleton['slots']:
        name=overrides.get(slot['name'],slot.get('attachment'))
        if not name or name not in skin.get(slot['name'],{}):continue
        attachment=mesh.resolve(skeleton,args.skin,slot['name'],name);kind=attachment.get('type','region')
        if kind not in ('region','mesh'):
            notes.append(f'{slot["name"]}: {kind} attachment skipped');continue
        part=parts[attachment['_region']];image=Image.open(files[part['region']]).convert('RGBA')
        core.require(image.size==tuple(part['size']),f'Logical image size differs: {part["region"]}')
        ow,oh=core.pair(part['fields']['orig']);ox,oy=core.pair(part['fields']['offset'])
        texture=Image.new('RGBA',(ow,oh));texture.paste(image,(ox,oh-oy-image.height))
        # Respect attachment/slot color in straight alpha.
        factors=[1.,1.,1.,1.]
        for tint in (slot.get('color','ffffffff'),attachment.get('color','ffffffff')):
            core.require(len(tint)==8,'Invalid color')
            for n in range(4):factors[n]*=int(tint[n*2:n*2+2],16)/255
        texture=Image.merge('RGBA',tuple(channel.point(lambda value,factor=factors[n]:round(value*factor)) for n,channel in enumerate(texture.split())))
        matrix=matrices[names[slot['bone']]]
        if kind=='mesh':
            verts=mesh_vertices(attachment,matrix,matrices);uv=attachment['uvs'];tri=attachment['triangles']
        else:
            w=attachment.get('width',ow);h=attachment.get('height',oh);angle=math.radians(attachment.get('rotation',0));sx=attachment.get('scaleX',1);sy=attachment.get('scaleY',1)
            verts=[]
            for x,y in ((-w/2,h/2),(w/2,h/2),(w/2,-h/2),(-w/2,-h/2)):
                x,y=x*sx,y*sy
                verts.append(point(matrix,math.cos(angle)*x-math.sin(angle)*y+attachment.get('x',0),math.sin(angle)*x+math.cos(angle)*y+attachment.get('y',0)))
            uv=[0,0,1,0,1,1,0,1];tri=[0,1,2,0,2,3]
        if slot.get('blend','normal')!='normal':notes.append(f'{slot["name"]}: blend mode approximated with normal compositing')
        drawables.append((texture,verts,uv,tri))
    core.require(drawables,'No visible attachments; select the correct skin/setup attachment')
    allpoints=[p for _,vertices,_,_ in drawables for p in vertices]
    core.require(all(math.isfinite(v) for p in allpoints for v in p),'Non-finite vertex')
    left=min(x for x,y in allpoints);right=max(x for x,y in allpoints);bottom=min(y for x,y in allpoints);top=max(y for x,y in allpoints)
    w=math.ceil((right-left)*args.scale)+2*args.margin;h=math.ceil((top-bottom)*args.scale)+2*args.margin
    core.require(0<w<=8192 and 0<h<=8192,'Preview dimensions exceed limit; reduce --scale')
    canvas=Image.new('RGBA',(w,h))
    if args.background=='checker':
        draw=ImageDraw.Draw(canvas)
        for y in range(0,h,16):
            for x in range(0,w,16):draw.rectangle((x,y,x+15,y+15),fill=(220,224,220,255) if (x//16+y//16)%2 else (240,242,238,255))
    for texture,vertices,uv,tri in drawables:
        layer=Image.new('RGBA',canvas.size)
        screen=[((x-left)*args.scale+args.margin,(top-y)*args.scale+args.margin) for x,y in vertices]
        for k in range(0,len(tri),3):
            ids=tri[k:k+3]
            core.require(len(ids)==3 and all(0<=i<len(screen) for i in ids),'Invalid triangle index')
            draw_triangle(layer,texture,[screen[i] for i in ids],[(uv[i*2]*texture.width,uv[i*2+1]*texture.height) for i in ids])
        canvas.alpha_composite(layer)
    output=core.fresh_output(args.out,[mp])
    with tempfile.TemporaryDirectory(dir=output.parent) as tmp:
        stage=Path(tmp)/'result';stage.mkdir();canvas.save(stage/'setup.png')
        core.write_json(stage/'report.json',{'preview':'static setup pose only','skin':args.skin,'runtime_test':False,'animation_evaluated':False,'omissions_and_approximations':sorted(set(notes)),'size':[w,h]})
        stage.rename(output)
    print(f'Static setup preview: {output}; constraints/runtime/animations not tested')


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--manifest',required=True);p.add_argument('--skin',required=True);p.add_argument('--replacements');p.add_argument('--attachment',action='append',default=[],help='Setup override slot=name')
    p.add_argument('--scale',type=float,default=6);p.add_argument('--margin',type=int,default=24);p.add_argument('--background',choices=('checker','transparent'),default='checker');p.add_argument('--out',required=True)
    args=p.parse_args()
    try:
        core.require(math.isfinite(args.scale) and args.scale>0 and args.margin>=0,'Invalid preview geometry')
        run(args)
    except (ValueError,OSError,KeyError,TypeError,IndexError) as exc:p.exit(2,f'ERROR: {exc}\n')


if __name__=='__main__':main()
