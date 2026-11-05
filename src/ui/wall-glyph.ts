import type {Grid} from '../lib/mosaic';

const DIGITS:Record<string,string[]>={
  '1':['00100','01100','00100','00100','00100','00100','01110'],
  '5':['11111','10000','11110','00001','00001','10001','01110'],
  '0':['01110','10001','10001','10001','10001','10001','01110'],
};
/** The cells that draw the number 1500 on the wall: in one row, or as 15 over 00 on a tall one. */
export function glyphCells(grid:Grid,tall:boolean,top=tall?5:4):Set<number> {
  const out=new Set<number>(),bit=2;
  const put=(digit:string,col:number,row:number)=>{
    DIGITS[digit]!.forEach((line,y)=>{[...line].forEach((on,x)=>{
      if (on!=='1') return;
      for (let dy=0;dy<bit;dy++) for (let dx=0;dx<bit;dx++) out.add((row+y*bit+dy)*grid.cols+col+x*bit+dx);
    });});
  };
  const width=5*bit,gap=1;
  if (tall) {
    const left=Math.floor((grid.cols-(width*2+gap))/2);
    put('1',left,top);put('5',left+width+gap,top);
    put('0',left,top+7*bit+gap);put('0',left+width+gap,top+7*bit+gap);
  } else {
    const left=Math.floor((grid.cols-(width*4+gap*3))/2);
    ['1','5','0','0'].forEach((d,i)=>put(d,left+i*(width+gap),top));
  }
  return out;
}
