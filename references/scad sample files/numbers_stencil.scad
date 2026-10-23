$fs=0.5;
$fa=1;

inches_to_mm=25.4;
depth=0.5*inches_to_mm;

screw_max_r=8/2;
screw_min_r=4/2;

gh1=(3/4)*4.5*inches_to_mm+screw_max_r-2;
gh2=(3/4)*4.5*inches_to_mm-screw_max_r-2;

numbers();
//guide_1();
//guide_2();

module scale_guide() {
  %cube([
    3.25 * inches_to_mm,
    4.5  * inches_to_mm,
    0.25  * inches_to_mm,
  ]);

  translate([
    (1/ 8) * inches_to_mm,
    (1/8) * inches_to_mm,
    0.25  * inches_to_mm,
  ])
  %cube([
    3.00 * inches_to_mm,
    4.25  * inches_to_mm,
    0.25  * inches_to_mm,
  ]);
}

module numeral(txt, t, s) {
  scale_guide();
  intersection() {
    cube([
      3.25 * inches_to_mm,
      4.5  * inches_to_mm,
      0.5  * inches_to_mm,
    ]);

    translate(t)
    scale(s)
    roof()
    text(
      txt, size=118,
      halign="left",
      valign="bottom"
    );
  }
}

module screw_hole(x, y) {
  translate([x, y, 0]) {
    translate([0, 0, -1])
    cylinder(r=screw_min_r, h=depth+2);
    translate([0, 0, depth/2])
    cylinder(r=screw_max_r, h=1+depth/2);
  }
}

module numbers() {
difference() {
  mirror([1, 0, 0])
  translate([-387, 0, 0])
  union() {
    translate([
      (3.25*0+0.75*0)*inches_to_mm, 0, 0])
    %numeral("2", [-9, 0, 0], [1.105, 1, 4]);

    translate([
      (3.25*1+0.75*1)*inches_to_mm, 0, 0])
    %numeral("0", [-7, 0, 0], [1.055, 0.985, 4]);

    translate([
      (3.25*2+0.75*2)*inches_to_mm, 0, 0])
    %numeral("2", [-9, 0, 0], [1.105, 1, 4]);

    translate([
      (3.25*3+0.75*3)*inches_to_mm, 0, 0])
    numeral("5", [-7.2, 0, 0], [1.065, 1, 4]);
  }

  screw_hole(x=69.5, y=gh1);
  screw_hole(x=69.5, y=gh2);
  screw_hole(x=72, y=20);
  
  screw_hole(x=112, y=gh1);
  screw_hole(x=112, y=gh2);
  screw_hole(x=174, y=9);
  
  screw_hole(x=274, y=gh1);
  screw_hole(x=213, y=gh2);
  screw_hole(x=276, y=35);
  
  screw_hole(x=315, y=gh1);
  screw_hole(x=315, y=gh2);
  screw_hole(x=378, y=9);
}
}

module guide_1() {
  w=255;
  translate([64+w/2, gh1, depth+5])
  cube([w, screw_max_r*2, 10], center=true);

  translate([69.5, gh1, depth/2+2])
  cylinder(r=screw_max_r-0.05, h=depth/2-1);
  
  translate([112, gh1, depth/2+2])
  cylinder(r=screw_max_r-0.05, h=depth/2-1);
  
  translate([274, gh1, depth/2+2])
  cylinder(r=screw_max_r-0.05, h=depth/2-1);
  
  translate([315, gh1, depth/2+2])
  cylinder(r=screw_max_r-0.05, h=depth/2-1);
}

module guide_2() {
  w=255;
  translate([64+w/2, gh2, depth+5])
  cube([w, screw_max_r*2, 10], center=true);

  translate([69.5, gh2, depth/2+2])
  cylinder(r=screw_max_r-0.05, h=depth/2-1);
  
  translate([112, gh2, depth/2+2])
  cylinder(r=screw_max_r-0.05, h=depth/2-1);
  
  translate([213, gh2, depth/2+2])
  cylinder(r=screw_max_r-0.05, h=depth/2-1);
  
  translate([315, gh2, depth/2+2])
  cylinder(r=screw_max_r-0.05, h=depth/2-1);
}
