$fs=0.5;
$fa=5; 

use <parts.scad>
th=3;
screw_r = 3.22/2;

module hex(w, h) {
    translate([0, 0, h/2])
    cube([w, w/1.73, h], center=true);
    rotate([0, 0, 60])
    translate([0, 0, h/2])
    cube([w, w/1.73, h], center=true);
    rotate([0, 0, 120])
    translate([0, 0, h/2])
    cube([w, w/1.73, h], center=true);
}

module sw() {
  // cube for mounting on/off switch
  difference() {
    translate([
      -50+th/2, 50, (12.4+th*2)/2+th*2
    ])
    cube([20+th*2, th, 12.4+th*2], center=true);
    translate([
      -50+th/2, 50, (12.4+th*2)/2+th*2
    ])
    cube([20, th*2, 12.4], center=true);
  }
}

import("import-base.stl");

translate([-th-screw_r-0.3, -th/2-screw_r, 0])
difference() {
  translate([0, 0, th/2])
  cube([screw_r*2+th*2, screw_r*2+th*2, th], center=true);
  translate([0, 0, -1])
  cylinder(r=screw_r, h=th+2);
}
translate([-th-screw_r-0.3, 58, 0])
difference() {
  translate([0, 0, th/2])
  cube([screw_r*2+th*2, screw_r*2+th*2, th], center=true);
  translate([0, 0, -1])
  cylinder(r=screw_r, h=th+2);
}

translate([42, 76, 18])
rotate([0, 0, 90])
sw();
