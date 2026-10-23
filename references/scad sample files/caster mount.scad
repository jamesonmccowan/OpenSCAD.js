$fs=0.5;
$fa=5;

th      = 3;
screw_r = 3.22/2;

bearing_ir = 8.2/2;
bearing_or = 22/2;
bearing_w  = 7;
bearing_th = 1.6;
bearing_i  = 0.01;
bearing_sr = bearing_or + th + screw_r*2;

caster_r=48/2;
caster_mount_r=7/2;
caster_w=38.5;

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

module caster() {
    translate([0, caster_w/2, caster_r])
    rotate([90, 0, 0])
    cylinder(r=caster_r, h=caster_w);
    
    translate([caster_r-4-th, 0, caster_r+th])
    difference() {
        cylinder(r=caster_mount_r+th, h=caster_r);
        translate([0, 0, -1])
        cylinder(r=caster_mount_r, h=caster_r+2);
    }
}
%caster();

module caster_mount() {
    translate([caster_r-4-th, 0, caster_r*2+th])
    %bearing();
    
    translate([caster_r-4-th, 0, caster_r*2+th])
    difference() {
        union() {
            cylinder(r=bearing_or+th, h=bearing_w+th);
            translate([-caster_r, 0, (bearing_w+th)/2])
            cube([
                (caster_r*2),
                (bearing_or+th)*2,
                bearing_w+th
            ], center=true);
        }

        translate([0, 0, -0.1])
        cylinder(r=bearing_or+0.1, h=bearing_w+0.2);

        cylinder(
            r=(bearing_ir+bearing_or)/2,
            h=bearing_w+th*2
        );
    }
    translate([
        -caster_r-2,
        0,
        caster_r*2+th*1.5+bearing_or*2
    ])
    difference() {
        cube([
            bearing_w+th,
            (bearing_or+th)*2,
            (bearing_or+th)*2
        ], center=true);
        
        translate([-bearing_w, 0, 0])
        rotate([0, 90, 0])
        union() {
            translate([bearing_w, bearing_w, 0])
            cylinder(r=screw_r, h=(bearing_w+th)*2);
            translate([bearing_w, -bearing_w, 0])
            cylinder(r=screw_r, h=(bearing_w+th)*2);
            translate([-bearing_w, bearing_w, 0])
            cylinder(r=screw_r, h=(bearing_w+th)*2);
            translate([-bearing_w, -bearing_w, 0])
            cylinder(r=screw_r, h=(bearing_w+th)*2);
        }
    }
}
caster_mount();

module caster_mount_rod() {
  difference() {
    union() {
      translate([0, 0, bearing_w])
      cylinder(r=bearing_ir+bearing_th, h=th);
      cylinder(
        r=bearing_ir-bearing_i,
        h=bearing_w+th
      );
      translate([0, 0, -bearing_w-th])
      cylinder(
        r=caster_mount_r,
        h=bearing_w+th
      );
    }

    translate([0, 0, -50])
    cylinder(r=screw_r, h=100);
  }
}
//translate([caster_r-4-th, 0, caster_r*2+th])caster_mount_rod();