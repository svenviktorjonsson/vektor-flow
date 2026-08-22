package main
import ("fmt"; "math")
type body struct { x,y,z,vx,vy,vz,mass float64 }
func main() {
	solar, days := 39.478417604357434, 365.24
	b := [5]body{
		{mass:solar},
		{4.841431442464721,-1.1603200440274284,-0.10362204447112311,0.001660076642744037*days,0.007699011184197404*days,-0.0000690460016972063*days,0.0009547919384243266*solar},
		{8.34336671824458,4.124798564124305,-0.4035234171143214,-0.002767425107268624*days,0.004998528012349172*days,0.000023041729757376393*days,0.0002858859806661308*solar},
		{12.894369562139131,-15.111151401698631,-0.22330757889265573,0.002964601375647616*days,0.0023784717395948095*days,-0.000029658956854023756*days,0.00004366244043351563*solar},
		{15.379697114850917,-25.919314609987964,0.17925877295037118,0.0026806777249038932*days,0.001628241700382423*days,-0.00009515922545197159*days,0.000051513890204661146*solar},
	}
	px,py,pz:=0.0,0.0,0.0; for _,a:=range b { px+=a.vx*a.mass; py+=a.vy*a.mass; pz+=a.vz*a.mass }
	b[0].vx=-px/solar; b[0].vy=-py/solar; b[0].vz=-pz/solar
	for step:=0; step<10000; step++ {
		for i:=0;i<5;i++ { for j:=i+1;j<5;j++ { dx,dy,dz:=b[i].x-b[j].x,b[i].y-b[j].y,b[i].z-b[j].z; squared:=dx*dx+dy*dy+dz*dz; m:=0.01/(squared*math.Sqrt(squared)); mi,mj:=b[i].mass,b[j].mass; b[i].vx-=dx*mj*m;b[i].vy-=dy*mj*m;b[i].vz-=dz*mj*m;b[j].vx+=dx*mi*m;b[j].vy+=dy*mi*m;b[j].vz+=dz*mi*m } }
		for i:=range b { b[i].x+=0.01*b[i].vx;b[i].y+=0.01*b[i].vy;b[i].z+=0.01*b[i].vz }
	}
	energy:=0.0; for i,a:=range b { energy+=0.5*a.mass*(a.vx*a.vx+a.vy*a.vy+a.vz*a.vz); for _,c:=range b[i+1:] { dx,dy,dz:=a.x-c.x,a.y-c.y,a.z-c.z;energy-=a.mass*c.mass/math.Sqrt(dx*dx+dy*dy+dz*dz) } }
	fmt.Printf("%.17g\n",energy)
}
