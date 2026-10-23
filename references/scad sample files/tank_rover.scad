$fs=0.5;
$fa=5;

use <parts.scad>

th = 3;

// cube for mounting on/off switch
module switch_mount() {
  difference() {
    translate([0, 0, (12.4+th*2)/2])
    cube([20+th*2, th, 12.4+th*2], center=true);
    translate([0, 0, (12.4+th*2)/2])
    cube([20, th*2, 12.4], center=true);
    translate([0, 0, 12.4+th*2])
    cube([th, th*2, th*3], center=true);
  }
}

switch_mount();