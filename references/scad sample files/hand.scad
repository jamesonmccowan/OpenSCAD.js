$fa=1;
$fs=0.1;

// actuator(1);
// stick(100, 10, 2, 2);
// mock_hand(ratio1=0.0, ratio2=0);

// finger_1(0.0);
test_var = 1;
finger_1(test_var*$t);

module actuator(ratio=1) {
  bl=20;
  bw=15;
  bh=38;
  nw=12.2;
  nr=16/2;
  nh=18;
  ar=9.2/2;
  a_base=0.4;
  a_ext=10;
  // base
  translate([0, 0, bh/2])
  cube([bl, bw, bh], center=true);

  // bottom hole
  difference() {
    union() {
      translate([0, 0, -5/2])
      cube([10.3, 8.2, 5], center=true);
      translate([0, 8.2/2, -5])
      rotate([90, 0, 0])
      cylinder(r=10.3/2, h=8.2);
    }
    translate([0, (8.2+2)/2, -5])
    rotate([90, 0, 0])
    cylinder(r=3.8/2, h=8.2+2);
  }

  // wires
  translate([7.5, 0, -5])
  cylinder(r=2.5/2, h=5);

  // neck
  translate([0, 0, bh])
  intersection() {
    cylinder(r=nr, h=nh);
    translate([0, 0, nh/2])
    cube([nr*2, nw, nh], center=true);
  }

  // arm
  translate([0, 0, bh+nh])
  cylinder(r=ar, h=a_base+a_ext*ratio);

  // top hole
  translate([0, 0, bh+nh+a_base+a_ext*ratio])
  difference() {
    intersection() {
      translate([0, 0, 9.6/2])
      cube([9.1, 6.1, 9.6], center=true);
      cylinder(r=9.1/2, h=9.6);
      translate([0, (6.1+2)/2, 0])
      rotate([90, 0, 0])
      cylinder(r=9.6, h=6.1+2);
    }
    translate([0, (8.2+2)/2, 4.2])
    rotate([90, 0, 0])
    cylinder(r=4/2, h=8.2+2);
  }
}


module mock_hand(ratio1=1, ratio2=0) {
  // 0-60deg
  pl=88;
  pw=30;
  ph=72;

  // palm
  translate([0, 0, ph/2])
  cube([pl, pw, ph], center=true);
  
  // fingers
  translate([0, 0, ph])
  rotate([90*ratio1-90, 0, 0]) {
    translate([33, 0, 0])
    cylinder(r=20/2, h=42);
    translate([11, 0, 0])
    cylinder(r=20/2, h=42);
    translate([-11, 0, 0])
    cylinder(r=20/2, h=42);
    translate([-33, 0, 0])
    cylinder(r=20/2, h=42);

    translate([0, 0, 42])
    rotate([90*ratio1-90, 0, 0]) {
      translate([33, 0, 0])
      cylinder(r=20/2, h=28);
      translate([11, 0, 0])
      cylinder(r=20/2, h=28);
      translate([-11, 0, 0])
      cylinder(r=20/2, h=28);
      translate([-33, 0, 0])
      cylinder(r=20/2, h=28);

      translate([0, 0, 28])
      rotate([90*ratio1-90, 0, 0]) {
        translate([33, 0, 0])
        cylinder(r=20/2, h=24);
        translate([11, 0, 0])
        cylinder(r=20/2, h=24);
        translate([-11, 0, 0])
        cylinder(r=20/2, h=24);
        translate([-33, 0, 0])
        cylinder(r=20/2, h=24);
      }
    }
  }
}

module stick(l, w, th, r) {
  difference() {
    union() {
      translate([0, 0, th/2])
      cube([l, w, th], center=true);
      translate([l/2, 0, 0])
      cylinder(r=w/2, h=th);
      translate([-l/2, 0, 0])
      cylinder(r=w/2, h=th);
    }
    translate([l/2, 0, -1])
    cylinder(r=r, h=th+2);
    translate([-l/2, 0, -1])
    cylinder(r=r, h=th+2);
  }
}

module finger_1(ratio=1) {
  translate([-33, 0, 0])
  %mock_hand(ratio1=1-ratio, ratio2=0);

  translate([0, 5, 0])
  rotate([0, -13.25, 90])
  actuator(ratio);
    
  // palm mount
  translate([8, 2, 35])
  rotate([0, 90, 0])
  rotate([0, 0, 5])
  stick(80, 10, 2, 2);

  // finger sticks
  f1=42;
  f2=28;
  f3=24;
  translate([0, 0, 80]){
    translate([
      6,
      -1.5+f1*sin(90*ratio)/2,
      -5+f1*cos(90*ratio)/2
    ])
    rotate([0, 90, 0])
    rotate([0, 0, -90*ratio])
    stick(f1, 10, 2, 2);

    translate([
      8,
      -1.5+f1*sin(90*ratio),
      -5+f1*cos(90*ratio)
    ])
    rotate([0, 90, 0])
    rotate([0, 0, -90*ratio*2])
    translate([-f2/2, 0, 0])
    stick(f2, 10, 2, 2);

    translate([
      6,
      -1.5+f1*sin(90*ratio),
      -5+f1*cos(90*ratio)
    ])
    rotate([0, 90, 0])
    rotate([0, 0, -90*ratio*2])
    translate([-f2, 0, 0])
    rotate([0, 0, -90*ratio])
    translate([-f3/2, 0, 0])
    stick(f3, 10, 2, 2);
  }
  
  // actuator link
  all=10/sqrt(2);
  ala=80;
  translate([0, 0, 80]){
    translate([
      6,
      -1.5-all*sin(90*ratio+ala)/2,
      -5-all*cos(90*ratio+ala)/2
    ])
    rotate([0, 90, 0])
    rotate([0, 0, -90*ratio-ala])
    stick(all, 10, 2, 2);
  }
  
  // actuator link 2
  bll=14.75;
  bla=1;
  // actuator pin hole
  act_ph_x=-1.75+ratio*10*sin(-13.25);
  act_ph_z=-19.75+ratio*10*cos(-13.25);
  // linkage pin hole
  link_ph_x=5.6-all*sin(90*ratio+ala);
  link_ph_z=-3.75-all*cos(90*ratio+ala);
  translate([-2, -all, 78.75]){
    /* point between the two pin holes */
    translate([
      6,
      (act_ph_x+link_ph_x)/2,
      (act_ph_z+link_ph_z)/2,
    ])
    // z=h*sin(a) -> a=asin(z/h)
    rotate([0, 90, 0])
    rotate([0, 0,
      90+acos(abs(link_ph_x-act_ph_x)/bll)
    ])
    /* */
    //rotate([0, 0, -90*ratio/3-bla])
    color([0, 1, 1])
    //cylinder(r=2, h=2);
    stick(bll, 10, 2, 2);
  }
}

