module.exports={
  instructions:'先设计美术、解剖与动作，再制作部件和 rig.json。坐标单位像素，Y 向上，旋转单位度，时间单位秒。父骨骼在子骨骼之前；parts 是由后到前的绘制顺序。透明 PNG <= 2048×2048。提交前调用 spine_generate_preview，在预览中检查关键姿势、循环与骨骼网格，修正后再 apply。结构通过不等于美术和动作合格。',
  workflow:[
    '先列出关节位置、活动范围、承重关系和部件遮挡。人形按肩/肘/腕、髋/膝/踝建立链；四足按真实前后肢关节设计，不能把整条腿绑定一根骨骼摆动。根据实际需求决定链数，不以骨骼数量充当质量。',
    'imagegen 生成同风格透明部件。硬质铠甲、盾牌和木质部件尽量保持体积，在关节分件/重叠；不要把纹理整体拉成橡皮。只有需要柔性弯曲的连接、披风、尾巴等使用网格。先查看图像，核实关节对应纹理上的位置。',
    '骨骼原点放在旋转关节，length 表示到下一关节的长度。先组装检查静态比例、关节遮盖和重心，再动画。网格三角形需沿轮廓、关节布线；关节附近有足够顶点，并使用渐变权重，固定点不跟随末端乱动。',
    '行走分支撑相和摆动相：IK 目标控制落脚，着地不穿地，接触段足部相对地面的速度与身体移动相抵消；抬脚通过弧线、膝部屈伸回到下一落点。四足使用有相位差的步序。原地循环的接触脚应匀速后移以匹配行进速度。',
    '骑乘时骑士跟随鞍座；登场先规划马与骑士的世界轨迹，落座瞬间位置连续，并有下沉缓冲和回弹。肩、头、披风、尾巴按动作强弱错峰跟随；不要让所有骨骼同相位摆动。',
    '为主动作设置预备、发力、缓冲和恢复。缓动应配合动作：落地支撑可线性，转向/摆动使用 Bezier。循环动作显式 loop:true，首尾位置和速度都要接续。完整制作每项动作内容，不复制同一段动画冒充不同动作。',
    '调用 preview 得到本地离线预览 HTML。观察每个动作的开始、中间、接触/极值、结束以及循环接缝，检查侧别、穿插、关节脱离、脚滑、变形塌陷、持械握点与落座。可开骨骼网格、0.25 倍速和时间轴。若当前环境无法视觉检查，明确报告未做视觉验收，不宣称自然流畅。',
  ],
  schema:{
    root:'bones, parts, animations，以及可选 ik。最多 120 根骨骼、60 个部件、32 个动画。名称字母开头，字母/数字/_/-，最多 60 字符。',
    bone:'{name,parent?,x?,y?,rotation?,length?}。默认 x/y/rotation 为 0。IK 链需正数 length。',
    part:'{name,bone,file,x?,y?,rotation?,width?,height?,color?,mesh?}。file 为 result 内 PNG 文件名。x/y 为图片中心相对 bone，width/height 为显示尺寸。color 为 RGBA 8 位十六进制，可用于远侧部件轻微压暗。',
    mesh:'{vertices:[{x,y,u,v,weights:[{bone,weight}]}],triangles:[i0,i1,i2,...]}。顶点 x/y 是图片中心为原点、Y 向上的显示像素坐标，先受 part 的 rotation 与 x/y 变换，再受 part.bone 的设置姿态变换。u/v 为左上(0,0)、右下(1,1)的纹理坐标。每顶点 1–4 个已存在骨骼、正数权重之和为 1。编译器自动反算各骨骼绑定坐标；禁止自己填 Spine packed vertices。至少 3 顶点，每顶点需参与非退化三角形。网格会取代 region。',
    ik:'[{name,bones:[parent,child],target,bendPositive?,mix?,softness?}]。也支持单骨骼。链是直接父子，child.x > 0 且 child.y = 0；两骨骼 length > 0，默认 mix=1, softness=0。target 不可在任何 IK 链的子树内，一个骨骼最多属于一条 IK 链。目标放 root 或独立运动控制器下，用目标 translate 控制足部。',
    animation:'{loop?:boolean,bones:{name:{rotate?:[{time,value,ease?}],translate?:[{time,x,y,ease?}],scale?:[{time,x,y,ease?}]}},ik?:{constraintName:[{time,mix?,softness?,bendPositive?,ease?}]}}。各时间线从 0 秒起递增，2–120 帧，最长 30 秒；scale 的 1 为原始比例。loop:true 校验首尾世界网格误差 < 0.1 像素。',
    ease:'省略表示线性；"stepped" 表示阶梯；[x1,y1,x2,y2] 是归一化的三次 Bezier（如 [0.42,0,0.58,1] 缓入缓出）。x1/x2 在 [0,1]。它用于当前帧到下一帧；编译器将其转换为 Spine 4.2 的绝对时间/数值曲线。',
  },
  meshExample:{vertices:[{x:-20,y:40,u:0,v:0,weights:[{bone:'upper',weight:1}]},{x:20,y:40,u:1,v:0,weights:[{bone:'upper',weight:1}]},{x:-20,y:0,u:0,v:0.5,weights:[{bone:'upper',weight:0.5},{bone:'lower',weight:0.5}]},{x:20,y:0,u:1,v:0.5,weights:[{bone:'upper',weight:0.5},{bone:'lower',weight:0.5}]},{x:-20,y:-40,u:0,v:1,weights:[{bone:'lower',weight:1}]},{x:20,y:-40,u:1,v:1,weights:[{bone:'lower',weight:1}]}],triangles:[0,1,2,1,3,2,2,3,4,3,5,4]},
};
