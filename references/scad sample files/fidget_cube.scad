$fs=0.5;
$fa=5; 

/* repair hinge
difference() {
  translate([0, 3.0, 6])
  rotate([90, 0, 0])
  joint(14, 10.5, 6.5, 0.5, 1.5);

  translate([3.5, 0, 0])
  cylinder(r=1.8, h=15);
  translate([-3.5, 0, 0])
  cylinder(r=1.8, h=15);
  
  translate([5, 0, 7.5])
  cube([5, 2.5, 15], center=true);
  translate([-5, 0, 7.5])
  cube([5, 2.5, 15], center=true);
}
//*/

///* cube
difference() {
  union() {
    fidget_cube(
      cube_size=20,
      gap=0.3,
      angled_r=3,
      angled_sides=2,
      joint_margin=0.3,
      joint_radius=1.5,
      joint_offset=0.5
    ); // angled
    
    // top hinge supports
    translate([30.5, 0, 13.5])
    rotate([0, 0, 45])
    cube([0.4, 12.5, 1],center=true);
    translate([30.5, 0, 13.5])
    rotate([0, 0, -45])
    cube([0.4, 12.5, 1],center=true);
    translate([-30.5, 0, 13.5])
    rotate([0, 0, 45])
    cube([0.4, 12.5, 1],center=true);
    translate([-30.5, 0, 13.5])
    rotate([0, 0, -45])
    cube([0.4, 12.5, 1],center=true);
    
    // side hinge supports
    translate([0, 16.5, 5.0])
    rotate([0, 0, 45])
    cube([0.4, 9.75, 1],center=true);
    translate([0, 16.5, 5.0])
    rotate([0, 0, -45])
    cube([0.4, 9.75, 1],center=true);
    translate([0, -16.5, 5.0])
    rotate([0, 0, 45])
    cube([0.4, 9.75, 1],center=true);
    translate([0, -16.5, 5.0])
    rotate([0, 0, -45])
    cube([0.4, 9.75, 1],center=true);
  }

  translate([10.25-0.2/2, 10.25, 19.5])
  text_inset(
    text=["Libera", "Sans"],
    size=2.9, r1=9.5, r2=6.5, h=0.6
  );
  translate([-10.25+0.2/2, -10.25, 19.5])
  text_inset(
    text=["Libera", "Sans"],
    size=2.9, r1=9.5, r2=6.5, h=0.6
  );

  //translate([50, 0, 10])
  //cube([30, 30, 30], center=true);
}
//*/

/* text
translate([10.25-0.2/2, 10.25, 19.5])
text_inset(
  text=["Libera", "Sans"],
  size=2.9, r1=9.5, r2=6.5, h=0.6
);
translate([-10.25+0.2/2, -10.25, 19.5])
text_inset(
  text=["Libera", "Sans"],
  size=2.9, r1=9.5, r2=6.5, h=0.6
);
*/

module angler(r, h, c) {
  //cube([r, r, h], center=true);
  for (i=[1:1:c]) {
    a=90*i/(c+1);
    rotate([0, 0, a])
    translate([r, -r, -h/2])
    translate([r*(-1+(c-1)/(c*2)), 0, 0])
    cube([2*r, 2*r, h]);
  }
}
//angler(10, 50, 2);

// r=size of the rounded portion
// s=sides used to make it round
module rounded_cube(
  lwh=[0, 0, 0], r=0, s=1, center=false
) {
  av=(lwh[0]+lwh[1]+lwh[2])/3;
  l=1;
  w=l;
  h=l;

  o = center==false ? 0 : 0.5;

  scale(lwh)
  difference() {
    cube([l, w, h], center=center);
    ratio=0.854;
    // sides
    for(i=[-1, 1]) {
      for(j=[-1, 1]) {
        translate([
          (l*o-r/(av*2))*i,
          (w*o-r/(av*2))*j,
          0
        ])
        rotate([0, 0, 90*(1-i*(2-j))/2])
        angler(r/av, 1, s);
          
        rotate([90, 0, 0])
        translate([
          (l*o-r/(av*2))*i,
          (w*o-r/(av*2))*j,
          0
        ])
        rotate([0, 0, 90*(1-i*(2-j))/2])
        angler(r/av, 1, s);
          
        rotate([0, 90, 0])
        translate([
          (l*o-r/(av*2))*i,
          (w*o-r/(av*2))*j,
          0
        ])
        rotate([0, 0, 90*(1-i*(2-j))/2])
        angler(r/av, 1, s);
      }
    }
  }
}
//rounded_cube([30, 30, 30], 3, 10, true);

module joint(l, w, h, m, r, o1=0, o2=0) {
  //translate([0, 0, h/2])
  //cube([l, w, h], center=true);
    
  difference() {
    translate([0, o1, o2])
    union() {
      translate([(l-h-m)/2, w/2-m, (h-m)/2])
      rotate([90, 0, 0])
      cylinder(r=(h-m)/2, h=w-m*2);
      translate([(h-l+m)/2, w/2-m, (h-m)/2])
      rotate([90, 0, 0])
      cylinder(r=(h-m)/2, h=w-m*2);
      
      translate([0, 0, (h-m)/2])
      cube([
        l-h-m,
        w-m*2,
        h-m
      ], center=true);
    }
    
    translate([(l-h-m)/2, w/2-m+1, (h-m)/2+o2])
    rotate([90, 0, 0])
    cylinder(r=r+m, h=w-m*2+2);
    translate([(h-l+m)/2, w/2-m+1, (h-m)/2+o2])
    rotate([90, 0, 0])
    cylinder(r=r+m, h=w-m*2+2);
  }
  
  translate([(l-h-m)/2, w/2, (h-m)/2])
  rotate([90, 0, 0])
  cylinder(r=r, h=w);
  translate([(h-l+m)/2, w/2, (h-m)/2])
  rotate([90, 0, 0])
  cylinder(r=r, h=w);
  
}
//joint(20, 10, 8, 0.5, 1.5);

module fidget_cube(
  cube_size, gap,
  angled_r, angled_sides,
  joint_margin,
  joint_radius,
  joint_offset // side joint distance from resting on cube
) {
  difference() {
    union() {
      for (i=[-1, 1]) {
        for (j=[-1, 0, 1, 2]) {
          translate([
            (cube_size+gap)*j-cube_size/2-gap/2,
            (cube_size+gap)*i/2,
            cube_size/2
          ])
          rounded_cube(
            [cube_size, cube_size, cube_size],
            angled_r,
            angled_sides,
            true
          );
        }
      }
    }
    
    // make space for joints
    for (i=[-1, 1]) {
      for (j=[-1, 1]) {
        // bottom
        translate([
          (cube_size+gap)*j,
          (cube_size+gap)*i/2,
          0
        ])
        cube([
          cube_size*(2/3)+gap,
          cube_size/2+gap,
          cube_size*(2/3)+gap
        ], center=true);
      }

      // side
      translate([
        0,
        (cube_size)*i,
        cube_size/2
      ])
      cube([
        cube_size*(2/3)+gap,
        cube_size*(2/3)+gap,
        cube_size/2+gap
      ], center=true);
      
      // top
      translate([
        (cube_size+gap)*i*3/2,
        0,
        cube_size
      ])
      rotate([0, 0, 90])
      cube([
        cube_size*(2/3)+gap,
        cube_size/2+gap,
        cube_size*(2/3)+gap
      ], center=true);
    }
  }

  // add joints
  for (i=[-1, 1]) {
    for (j=[-1, 1]) {
      // bottom
      translate([
        (cube_size+gap)*j,
        (cube_size+gap)*i/2,
        0
      ])
      joint(
        cube_size*(2/3)+gap,
        cube_size/2+gap,
        (cube_size*(2/3)+gap)/2,
        joint_margin,
        joint_radius
      );
    }

    // side
    translate([
      0,
      (cube_size+gap/2)*i,
      cube_size/2
    ])
    rotate([90*i, 0, 0])
    joint(
      cube_size*(2/3)+gap,
      cube_size/2+gap,
      (cube_size*(2/3)+gap)/2,
      joint_margin,
      joint_radius,
      -i*gap+joint_offset*i
    );
    
    // top
    translate([
      (cube_size+gap)*i*3/2,
      0,
      cube_size
    ])
    rotate([0, 180, 90])
    joint(
      cube_size*(2/3)+gap,
      cube_size/2+gap,
      (cube_size*(2/3)+gap)/2,
      joint_margin,
      joint_radius,
      0,
      gap-joint_offset
    );
  }
}
// cube_size, gap,
// angled_r, angled_sides,
// joint_margin, joint_radius, joint_offset
//fidget_cube(20, 1,  3, 4,  0.5, 2, 0.25); // rounded
//fidget_cube(20, 0.5,  3, 1,  0.25, 2, 0.125); // angled
//fidget_cube(20, 0.2,  5, 1,  0.2, 1, 0.0); // over-angled

module text_inset(
  text, size, r1, r2, h
) {

  difference() {
    scale([1, r2/r1, 1])
    cylinder(r=r1, h=h);

    line_w=0.75;
    scale([
      1, (r2-line_w)/(r1-line_w), 1
    ])
    cylinder(r=r1-line_w, h=h);
  }

  l=len(text);
  to=0.71;
  for(i=[0:l-1]) {
    translate([-0.15, (l/2-i*1.2-to)*size, 0])
    linear_extrude(h)
    text(
      text[i],
      size,
      halign="center",
      valign="center",
      font="Liberation Sans:style=Bold"
      //font="Liberation Sans:style=Bold"
    );
  }
}
