$fs=0.5;
$fa=5; 

use <parts.scad>
th=3;


screw_r = 3.22/2;

bearing_ir = 8.2/2;
bearing_or = 22/2;
bearing_w  = 7;
bearing_th = 1.6;
bearing_i  = 0.01;
bearing_sr = bearing_or + th + screw_r*2;

zc=-2.23; // post-print z correction

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

module bearing_cap() {
  difference() {
    cylinder(r=bearing_or+th, h=bearing_w+th);

    translate([0, 0, -0.1])
    cylinder(r=bearing_or+0.1, h=bearing_w+0.2);

    cylinder(
      r=(bearing_ir+bearing_or)/2,
      h=bearing_w+th*2
    );
  }
  %bearing();
}

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

module motor_assembly() {
  rotate([0, 90, 0])
  %dc_motor();

  translate([-26.5, 0, 0])
  rotate([0, 90, 0])
  %encoder();
    
  translate([-25.5, 12, -20])
  rotate([0, 0, 90])
  %comparator_LM393();

  translate([10, 0, 0])
  rotate([0, 90, 0])
  %omni_wheel();
    
  difference() {
    union() {
      translate([-25.5, 12, -20])
      cube([21, 36, th*2], center=true);
      translate([-9, 6, -6])
      cube([22, 37, 34], center=true);
    }
    translate([-25.5, 12, -20+th])
    cube([14.1, 32.2, th*2], center=true);

    translate([-25.5, 21, -25])
    cylinder(r=screw_r, h=10);
    translate([-10, 0, -25])
    cylinder(r=screw_r, h=20);
    
    // dc motor space
    rotate([0, 90, 0]) {
      // body
      translate([
        0, (37.1-3.8)/2-9.27, -18.8/2
      ])
      cube([22.4, 37.1, 18.8], center=true);

      // screw tab
      translate([0, -13.6, -9-2.8/2])
      cube([6.3, 6, 3.8], center=true);
      
      // screw holes
      translate([22.4/2-2.5, 20, -22])
      cylinder(r=3/2, h=30);
      translate([-22.4/2+2.5, 20, -22])
      cylinder(r=3/2, h=30);
    }
    
    translate([-9, 6, 1])
    cube([25, 20, 30], center=true);
    
    translate([-20.5, 15, -14])
    rotate([0, 45, 0])
    cube([3, 20, 3], center=true);
  }
}

module axel_end() {
  l=30;
  hh=6;
  ghw=6;
  difference() {
    translate([0, 0, 0])
    hex(12, hh);
    
    translate([0, 0, -1])
    cylinder(r=3.9/2, h=52);
  }
  translate([0, 0, hh])
  cylinder(r=4, h=l-hh-ghw);

  translate([0, 0, l-ghw/2])
  cube(
    [8/sqrt(2), 8/sqrt(2), ghw],
    center=true
  );
}

module parts_mount() {
  translate([48, 50, 17]) {
    rotate([0, 90, 90])
    %pico();
    // pico hooks
    translate([30, 0, -2])
    cube([th*2, th*2, 20], center=true);
    translate([30+th, 0, 5+th/2])
    cube([th*2, th, th], center=true);
    translate([-30, 0, -2])
    cube([th*2, th*2, 20], center=true);
    translate([-30-th, 0, 5+th/2])
    cube([th*2, th, th], center=true);
  }
  
  translate([30, 0, th])
  rotate([180, 0, 90])
  %voltage_switch();
  translate([-30, 0, th])
  rotate([180, 0, -90])
  %voltage_switch();
  

  translate([-65, -5, th])
  %large_voltage_regulator();
  translate([-65, -5, 20])
  %large_voltage_regulator();

  difference() {
    union() {
      translate([0, 0, th])
      cube([170, 124, th*2], center=true);
        
      translate([0, 0, th*2])
      rotate([0, 0, -90])
      dewalt_battery_mount();
    }
    
    translate([0, 40, -th])
    cylinder(r=20/2, h=20);
    translate([0, -35, -th])
    cylinder(r=10/2, h=20);
    
    // motor mount screws
    mmsx1=49;
    mmsy1=34.5;
    mmsx2=70;
    mmsy2=50;
    pwx1=12.5;
    pwx2=50.5;
    pwy1=19;
    for(i=[-1,1]) {
      for(j=[-1,1]) {
        translate([i*mmsx1, j*mmsy1, -10])
        cylinder(r=screw_r, h=20);
        translate([i*mmsx2, j*mmsy2, -50])
        cylinder(r=screw_r, h=100);
        translate([i*pwx1, j*pwy1, -10])
        cylinder(r=screw_r, h=20);
        translate([i*pwx2, j*pwy1, -10])
        cylinder(r=screw_r, h=20);
        
        translate([i*mmsx1, j*mmsy1, th])
        cylinder(r=screw_r*2, h=th*3);
        translate([i*mmsx2, j*mmsy2, th])
        cylinder(r=screw_r*2, h=th*3);
        translate([i*pwx1, j*pwy1, th])
        cylinder(r=screw_r*2, h=th*3);
        translate([i*pwx2, j*pwy1, th])
        cylinder(r=screw_r*2, h=th*3);
      }
    }
    
    translate([-31.15/2-65, -61/2-5, -10])
    cylinder(r=screw_r, h=20);
    translate([-31.15/2-65, 61/2-5, -10])
    cylinder(r=screw_r, h=20);
  }
  
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

module display(e) {
  magl=70;
  magw=60;
  translate([magl, magw, 0])
  rotate([180, 0, 90])
  mirror([0, 1, 0])
  motor_assembly();
  translate([-magl, magw, 0])
  rotate([180, 0, 90])
  motor_assembly();
  translate([-magl, -magw, 0])
  rotate([180, 0, -90])
  mirror([0, 1, 0])
  motor_assembly();
  translate([magl, -magw, 0])
  rotate([180, 0, -90])
  motor_assembly();
    
  translate([0, 0, 23+e])
  parts_mount();
}
display(0);
//parts_mount();
//motor_assembly();