$fs=0.5;
$fa=5; 

w       = 200;
th      = 3;
screw_r = 3.22/2;

bearing_ir = 8/2;
bearing_or = 22/2;
bearing_w  = 7;
bearing_th = 1.6;
bearing_i  = 0.01;
bearing_sr = bearing_or + th + screw_r*2;

module bearing() {
  difference() {
    cylinder(r=bearing_or, h=bearing_w);
    translate([0, 0, -1])
    cylinder(r=bearing_ir, h=bearing_w+2);

    translate([0, 0, bearing_w-bearing_i])
    difference() {
      cylinder(r=bearing_or-bearing_th, h=bearing_w);
      translate([0, 0, -1])
      cylinder(r=bearing_ir+bearing_th, h=bearing_w+2);
    }

    translate([0, 0, bearing_i-bearing_w])
    difference() {
      cylinder(r=bearing_or-bearing_th, h=bearing_w);
      translate([0, 0, -1])
      cylinder(r=bearing_ir+bearing_th, h=bearing_w+2);
    }
  }
}

module bearing_cap() {
  difference() {
    cylinder(r=bearing_or+th, h=bearing_w+th);
    translate([0, 0, -1])
    cylinder(r=bearing_or, h=bearing_w+1);
    translate([0, 0, -1])
    cylinder(r=bearing_ir+th, h=bearing_w+th+2);
  }
  %bearing();
}

module angle_bone() {
  cube([
    w/2, bearing_w, bearing_w
  ], center=true);
  translate([
    -w/4-bearing_or, bearing_w/2, 0
  ])
  rotate([90, 0, 0])
  bearing_cap();
    
  translate([
    w/4, 0, -th/2
  ])
  cube([
    bearing_w,
    bearing_w,
    bearing_w+th
  ], center=true);
  translate([
    w/4, bearing_w/2, -(bearing_w+bearing_or*2+th*2)/2
  ])
  rotate([90, 0, 0])
  bearing_cap();
}

module display(e) {
  translate([
    -w/4-bearing_or-th*1.5-e,
    0,
    bearing_or*4+th+e
  ])
  angle_bone();
  translate([
    -w/4-bearing_or*2-th*1.5-e,
    0,
    0
  ])
  rotate([180, 0, 180])
  angle_bone();
    
  translate([
    31.5+th*0.5+e,
    0,
    -bearing_w-bearing_or-th+e
  ])
  rotate([0, -90, 180])
  angle_bone();
  
  translate([
    14+th*0.5+e,
    0,
    -bearing_or*5-th*2
  ])
  rotate([180, 90, 0])
  angle_bone();
}
display(0);
