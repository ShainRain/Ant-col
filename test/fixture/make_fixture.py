from PIL import Image, ImageDraw
import math, os
root = os.path.dirname(os.path.abspath(__file__))
os.makedirs(root, exist_ok=True)

def grad(w,h,c1,c2):
    im = Image.new("RGB",(w,h))
    d = ImageDraw.Draw(im)
    for y in range(h):
        t=y/max(1,h-1)
        d.line([(0,y),(w,y)], fill=tuple(int(c1[i]*(1-t)+c2[i]*t) for i in range(3)))
    return im

im = grad(1600,1000,(247,90,60),(32,28,80))
d = ImageDraw.Draw(im)
for i in range(12):
    x=100+i*120; y=200+int(160*math.sin(i*0.8))
    d.ellipse([x,y,x+180,y+180], fill=(250,240,220), outline=(20,18,24), width=6)
d.text((60,60),"ANT-COL FIXTURE 1600x1000", fill=(255,255,255))
im.save(os.path.join(root,"art-1.jpg"), quality=88)

im2 = grad(900,1200,(30,40,70),(255,140,90))
d2 = ImageDraw.Draw(im2)
for i in range(9):
    d2.rectangle([80+i*70,120+i*90,300+i*60,500+i*70], outline=(255,255,255), width=5)
d2.text((60,60),"PORTRAIT 900x1200", fill=(255,255,255))
im2.save(os.path.join(root,"art-2.png"))

im3 = grad(80,80,(20,20,20),(240,80,60))
im3.save(os.path.join(root,"tiny.png"))

im4 = grad(1400,800,(20,50,40),(240,220,120))
d4 = ImageDraw.Draw(im4)
d4.text((60,60),"CSS BACKGROUND 1400x800", fill=(20,20,20))
for i in range(7):
    d4.line([(0,100+i*90),(1400,40+i*100)], fill=(250,250,250), width=8)
im4.save(os.path.join(root,"bg.png"))

im5 = grad(1280,720,(60,20,40),(255,180,80))
d5 = ImageDraw.Draw(im5)
d5.text((60,60),"VIDEO POSTER 1280x720", fill=(255,255,255))
im5.save(os.path.join(root,"poster.jpg"))
print("fixture images done")
