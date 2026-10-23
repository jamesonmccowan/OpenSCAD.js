$fs=0.5;
$fa=5;
 
th=3;
mr=10;
br=20;
tape_w=50;
 
module base_plug() {
  cylinder(r=mr*2, h=th);
  cylinder(r=mr-th, h=th*3);
}
//base_plug();
 
module pole() {
  difference() {
    union () {
      cylinder(r=mr*2, h=th);
      cylinder(r=mr, h=mr*2+th);
      cylinder(r=mr-th, h=mr*2+th*3);
    }
    
    translate([0, 0, -0.01])
    cylinder(r=mr-th, h=mr+th);
  }
}
//pole();
 
module mirrored_cap() {
  difference() {
    union() {
      cylinder(r=br+th, h=th);
      cylinder(r=br-th, h=th*2);
    }
    translate([0, 0, -0.01])
    cylinder(r=mr-th, h=mr+th);
  } 
}
//mirrored_cap();
 
module mirror_cylinder() {
  difference() {
    cylinder(r=br, h=tape_w);
    translate([0, 0, -1])
    cylinder(r=br-th, h=tape_w+2);
  }
}
//mirror_cylinder();
 
module prism_assembly(e) {
  base_plug();
    
  translate([0, 0, th+e*2])
  pole();
    
  translate([0, 0, mr*2+th*2+e*4])
  mirrored_cap();
    
  translate([0, 0, mr*2+th*3+e*5])
  mirror_cylinder();
    
  translate([0, 0, mr*2+th*4+tape_w+e*6])
  rotate([180, 0, 0])
  mirrored_cap();
}
prism_assembly(4);
