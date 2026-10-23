// Original project-author design, licensed under the repository's Apache-2.0.
$fa=1;
$fs=0.1;

doughnut();
//rod();

module doughnut() {
  r=120.00/2;
  h=85.05;
  difference() {
    // bottom circles
    cylinder(r=r, h=h);
    translate([0, 0, -1])
    cylinder(
      r=109.9/2, h=8.88+1);
    translate([0, 0, -1])
    cylinder(
      r=94.00/2, h=8.88+6.2+1);
    translate([
      0, 0, 8.88+6.2-0.01])
    cylinder(
      r1=22.3/2,
      r2=0,
      h=22.3/2
    );

    // middle hole
    cylinder(
      r=18.9/2, h=85.05);

    // top circles
    translate([0, 0, h-9.0])
    cylinder(
      r=109.9/2, h=9+1);
    translate([0, 0, h-9.0-36])
    cylinder(
      r=75.6/2, h=36+9+1);

    // top wedge cuts
    for(a=[0, 90, 180, 270])
    translate([0, 0, h-4])
    scale([1.2, 1.2, 1])
    rotate([0, 0, a])
    arclen_wedge(
      109.9/2, 29.8+1, 4+1);

    %translate([0, 0, h])
    cube([r*2, 29.8, 8], center=true);

    // bottom wedge cuts
    for(a=[0, 90, 180, 270])
    translate([0, 0, -1])
    scale([1.2, 1.2, 1])
    rotate([0, 0, a])
    arclen_wedge(
      109.9/2, 48.8-3, 5+1);

    %cube([r*2, 48.8, 10], center=true);
  }
}

module rod() {
  difference() {
    cylinder(
      r=25.4/2, h=119.2+39.1);
    translate([-50, 0, 119.2])
    cube([100, 100, 100]);
  }
  translate([0, 0, -62.35])
  cylinder(r=19.10/2, h=62.35);
}

module arclen_wedge(
  r, arclen, h
) {
  a=asin((arclen-2)/r);
  rotate([0, 0, -a/2])
  intersection() {
    cube([r, r, h]);
    rotate([0, 0, -90+a])
    cube([r, r, h]);
  }
}

module curve(r, h) {
  difference() {
    cube([r, r, h]);

    translate([0, 0, -1])
    cylinder(r=r, h=h+2);
  }
}

module hex(s) {
    w=6.86+0.5;
    r=3.84/2;

    translate([0, 0, s/2])
    cube([w, w/1.73, s], center=true);
    rotate([0, 0, 60])
    translate([0, 0, s/2])
    cube([w, w/1.73, s], center=true);
    rotate([0, 0, 120])
    translate([0, 0, s/2])
    cube([w, w/1.73, s], center=true);

    translate([0, 0, -s+1])
    cylinder(h=s+1, r=r);
}

module rombus_box(
    w, l, h, a
) {
  // diff cube side length
  L = h/cos(a);
  // offset between top and bottom
  B = L*sin(a);

  difference() {
    translate([0, 0, h/2])
    cube([w, l, h], center=true);

    translate([
      (w+L*cos(a)-B)/2,
      0,
      (h+L*sin(a))/2
    ])
    rotate([0, -a, 0])
    cube(
      [L, l+B*2+1, L],
      center=true
    );
    translate([
      -(w+L*cos(a)-B)/2,
      0,
      (h+L*sin(a))/2
    ])
    rotate([0, a, 0])
    cube(
      [L, l+B*2+1, L],
      center=true
    );

    translate([
      0,
      (l+L*cos(a)-B)/2,
      (h+L*sin(a))/2
    ])
    rotate([a, 0, 0])
    cube(
      [w+B*2+1, L, L],
      center=true
    );
    translate([
      0,
      -(l+L*cos(a)-B)/2,
      (h+L*sin(a))/2
    ])
    rotate([-a, 0, 0])
    cube(
      [w+B*2+1, L, L],
      center=true
    );
  }
}

module quarter_anti_cylinder(r, h) {
    difference() {
        translate([1, 1, 0])
        cube([r+2, r+1, h+1], center=true);

        translate([r, r, -(h+2)/2])
        cylinder(r=r, h=h+2);
    }
}

module rounded_cylinder(r, h) {
    step=10;
    sub_r=r-h/2;
    sup_r=r-sub_r;
    for (i=[-90:step:90]) {
        translate([
            0,
            0,
            h*sin(i)/2
        ])
        cylinder(
            r1=sup_r*cos(i-step*0.5)+sub_r,
            r2=sup_r*cos(i+step*0.5)+sub_r,
            h=sup_r*(
                sin(i+step*0.55)
               -sin(i-step*0.55))
        );
    }

    translate([0, 0, -(h/2)])
    cylinder(r=sub_r, h=h);
}