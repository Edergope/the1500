import {cellOrder,positionStatus,hash,SMALTI,tileLook,type Grid,type PositionRange} from '../lib/mosaic';

export interface WallCell {position:number;col:number;row:number;tint:[number,number,number];gloss:number;retired:boolean;tiltX:number;tiltY:number;}
export interface Lights {a:[number,number];b:[number,number];reveal:number;origin:[number,number];}
export interface WallRenderer {animated:boolean;draw(lights:Lights):void;resize(scale:number):void;}

const rgb=(hex:string):[number,number,number]=>[parseInt(hex.slice(1,3),16)/255,parseInt(hex.slice(3,5),16)/255,parseInt(hex.slice(5,7),16)/255];
const GLASS:Record<string,{tint:[number,number,number];gloss:number}>={
  open:{tint:[0.075,0.105,0.15],gloss:1},reserved:{tint:[0.075,0.105,0.15],gloss:1},
  unreleased:{tint:[0.036,0.05,0.074],gloss:0.42},assigned:{tint:[0.34,0.37,0.43],gloss:0.8},retired:{tint:[0.05,0.03,0.03],gloss:0.2},
};
/** Each cell as the database describes it. Companies keep their colour, so they show as single pieces when the wall is seen whole. */
export function buildCells(map:string,grid:Grid,current:PositionRange|null,slugByPosition:Map<number,string>):WallCell[] {
  const order=cellOrder(grid);
  return order.map((cell,i)=>{
    const position=i+1,status=positionStatus(position,map[i],current),h=hash(`tessera-${position}`);
    const slug=slugByPosition.get(position);
    const glass=status==='published'
      ?{tint:rgb(slug?tileLook(slug).color.bg:SMALTI[0].bg),gloss:0.9}
      :GLASS[status]!;
    return {position,col:cell%grid.cols,row:Math.floor(cell/grid.cols),tint:glass.tint,gloss:glass.gloss,retired:status==='retired',
      // Set at slightly different angles, each piece catches the light at its own moment.
      tiltX:((h&1023)/1023-0.5)*0.86,tiltY:(((h>>>10)&1023)/1023-0.5)*0.86};
  });
}

const VERTEX=`#version 300 es
layout(location=0) in vec2 corner;
layout(location=1) in vec2 cell;
layout(location=2) in vec3 tint;
layout(location=3) in vec2 tilt;
layout(location=4) in vec2 surface;
uniform vec2 grid;
out vec2 vUv;out vec2 vPos;out vec3 vTint;out vec2 vTilt;out vec2 vSurface;
void main(){
  vUv=corner;vPos=cell+.5;vTint=tint;vTilt=tilt;vSurface=surface;
  vec2 p=(vPos+corner*.47)/grid;
  gl_Position=vec4(p.x*2.-1.,1.-p.y*2.,0.,1.);
}`;
const FRAGMENT=`#version 300 es
precision highp float;
in vec2 vUv;in vec2 vPos;in vec3 vTint;in vec2 vTilt;in vec2 vSurface;
uniform vec2 lightA;uniform vec2 lightB;uniform vec2 origin;uniform float reveal;
out vec4 color;
float box(vec2 p,float r){vec2 q=abs(p)-vec2(1.-r);return length(max(q,0.))+min(max(q.x,q.y),0.)-r;}
float noise(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
vec3 shine(vec2 light,float height,vec3 N,vec3 P,float gloss,vec3 ink){
  vec3 toLight=vec3(light,height)-P;float d2=dot(toLight,toLight);vec3 L=toLight/sqrt(d2);
  vec3 H=normalize(L+vec3(0.,0.,1.));float falloff=1./(1.+d2/190.);
  float diffuse=max(dot(N,L),0.);float spec=pow(max(dot(N,H),0.),150.);
  return vTint*diffuse*falloff*2.4+ink*spec*falloff*gloss*1.5;
}
void main(){
  float d=box(vUv,.22);float aa=fwidth(d);float alpha=1.-smoothstep(-aa,aa,d);
  if(alpha<.01)discard;
  float rim=smoothstep(-.32,0.,d);
  float seed=noise(vPos)*6.28;
  vec2 hammered=vec2(sin(vUv.y*4.+seed),cos(vUv.x*3.+seed*1.7))*.035;
  vec3 N=normalize(vec3(vTilt+vUv*rim*rim*.8+hammered,1.));
  vec3 P=vec3(vPos+vUv*.47,0.);
  vec3 c=vTint*.95;
  c+=shine(lightA,5.5,N,P,vSurface.x,vec3(1.,.83,.52));
  c+=shine(lightB,9.,N,P,vSurface.x*.55,vec3(.55,.72,1.))*.6;
  if(vSurface.y>.5)c=mix(c,vec3(.42,.2,.15),smoothstep(.07,.03,abs(vUv.x-vUv.y)));
  float wave=smoothstep(reveal,reveal-14.,distance(vPos,origin));
  c*=mix(.3,1.,wave);
  color=vec4(c*alpha,alpha);
}`;

function compile(gl:WebGL2RenderingContext,type:number,source:string) {
  const shader=gl.createShader(type)!;
  gl.shaderSource(shader,source);gl.compileShader(shader);
  if (!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader)||'shader');
  return shader;
}
function createGl(canvas:HTMLCanvasElement,cells:WallCell[],grid:Grid,pixels:()=>[number,number]):WallRenderer|null {
  const gl=canvas.getContext('webgl2',{alpha:true,antialias:false,powerPreference:'low-power',premultipliedAlpha:true});
  if (!gl) return null;
  const program=gl.createProgram()!;
  gl.attachShader(program,compile(gl,gl.VERTEX_SHADER,VERTEX));
  gl.attachShader(program,compile(gl,gl.FRAGMENT_SHADER,FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program)||'program');
  gl.useProgram(program);
  gl.bindVertexArray(gl.createVertexArray());
  gl.bindBuffer(gl.ARRAY_BUFFER,gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
  const data=new Float32Array(cells.length*9);
  cells.forEach((c,i)=>data.set([c.col,c.row,...c.tint,c.tiltX,c.tiltY,c.gloss,c.retired?1:0],i*9));
  gl.bindBuffer(gl.ARRAY_BUFFER,gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);
  [[1,2,0],[2,3,2],[3,2,5],[4,2,7]].forEach(([loc,size,offset])=>{
    gl.enableVertexAttribArray(loc!);gl.vertexAttribPointer(loc!,size!,gl.FLOAT,false,36,offset!*4);gl.vertexAttribDivisor(loc!,1);
  });
  const uniform=(name:string)=>gl.getUniformLocation(program,name);
  gl.uniform2f(uniform('grid'),grid.cols,grid.rows);
  const uA=uniform('lightA'),uB=uniform('lightB'),uO=uniform('origin'),uR=uniform('reveal');
  gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.clearColor(0,0,0,0);
  return {
    animated:true,
    resize(scale) {
      const [w,h]=pixels();
      canvas.width=Math.round(w*scale);canvas.height=Math.round(h*scale);
      gl.viewport(0,0,canvas.width,canvas.height);
    },
    draw(l) {
      gl.uniform2f(uA,l.a[0],l.a[1]);gl.uniform2f(uB,l.b[0],l.b[1]);gl.uniform2f(uO,l.origin[0],l.origin[1]);gl.uniform1f(uR,l.reveal);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,4,cells.length);
    },
  };
}
/** Without WebGL the wall is still complete and true, only still. */
function create2d(canvas:HTMLCanvasElement,cells:WallCell[],grid:Grid,pixels:()=>[number,number]):WallRenderer|null {
  const ctx=canvas.getContext('2d');
  if (!ctx) return null;
  return {
    animated:false,
    resize(scale) {const [w,h]=pixels();canvas.width=Math.round(w*scale);canvas.height=Math.round(h*scale);},
    draw() {
      const u=canvas.width/grid.cols,inset=u*0.05,size=u-inset*2;
      ctx.clearRect(0,0,canvas.width,canvas.height);
      for (const c of cells) {
        const boost=1.5+(c.tiltX+0.43)*1.3;
        ctx.fillStyle=`rgb(${c.tint.map(v=>Math.round(Math.min(1,v*boost)*255)).join(' ')})`;
        ctx.fillRect(c.col*u+inset,c.row*u+inset,size,size);
      }
    },
  };
}
export function createWallRenderer(canvas:HTMLCanvasElement,cells:WallCell[],grid:Grid,pixels:()=>[number,number]):WallRenderer|null {
  try {
    const gl=createGl(canvas,cells,grid,pixels);
    if (gl) return gl;
  } catch(e) {
    console.warn('wall_webgl_unavailable',e instanceof Error?e.message:String(e));
    // A context that failed part way cannot be reused for 2D.
    const fresh=canvas.cloneNode(false) as HTMLCanvasElement;
    canvas.replaceWith(fresh);
    return create2d(fresh,cells,grid,pixels);
  }
  return create2d(canvas,cells,grid,pixels);
}
