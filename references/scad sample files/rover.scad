$fs=0.5;
$fa=5;

use <parts.scad>
w       = 200;
th      = 3;
screw_r = 3.22/2;

bearing_ir = 8.2/2;
bearing_or = 22/2;
bearing_w  = 7;
bearing_th = 1.6;
bearing_i  = 0.01;
bearing_sr = bearing_or + th + screw_r*2;

prism_r = 35/2;
prism_thread_r = 16/2;

side_height = max(w/5, prism_r*4);
side_top_height = side_height
    + ((w-side_height)/2);

side_pos_y  =  w/2-th*2.5;
tab_x = w/2-th*2-screw_r;

hinge_x=side_pos_y/2-th*3.5;
hinge_z=side_top_height-bearing_or-th*2;

wheel_x = side_pos_y-bearing_sr-th*2;
wheel_y = w/2-th*2;
wheel_z = side_pos_y/4;



display(0, 90, 30);
// wheel_assembly();
// tensioner(30, 10);
// frame_base();     // x1
// frame_side();     // x2
// frame_top();      // x1
// battery_mount();  // x2
// frame_door();     // x2
// frame_door_pin(); // x4
// tensioner(30, th*2);
// tensioner_wheel();
// tensioner_bearing(th*2);
// tire();
// pi_clip();

module tooth(w, l, h) {
  difference() {
    linear_extrude(height=h)
    polygon(points=[
      [w/2, 0],
      [w/2-w/8, l/2],
      [w/6, l],
      [-w/6, l],
      [-w/2+w/8, l/2],
      [-w/2, 0]
    ]);
  }
}

module gear(teeth, w, l, h) {
  for(i=[0:teeth-1]) {
    rotate(i*360/teeth)
    translate([
      0, teeth*w/(PI*sqrt(2))*cos(180/teeth), 0
    ])
    tooth(w, l, h);
  }
  cylinder(r=teeth*w/(PI*sqrt(2)-0.01), h=h);
}

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
        union() {
            cylinder(r=bearing_or+th, h=bearing_w+th);
            translate([0, 0, th/2])
            cube([
                2*(bearing_or+th)+screw_r*8,
                screw_r*4,
                th
            ], center=true);
        }

        translate([0, 0, -0.1])
        cylinder(r=bearing_or+0.1, h=bearing_w+0.2);

        cylinder(
            r=(bearing_ir+bearing_or)/2,
            h=bearing_w+th*2
        );

        translate([bearing_sr, 0, -0.1])
        cylinder(r=screw_r, h=th+0.2);
        translate([-bearing_sr, 0, -0.1])
        cylinder(r=screw_r, h=th+0.2);
    }
    %bearing();
}
//bearing_cap();

module square_screw_tab() {
  difference() {
    cube([screw_r*4, th, screw_r*4], center=true);
    translate([0, -th, 0])
    rotate([-90, 0, 0])
    cylinder(r=screw_r, h=th*2);
  }
}
// square_screw_tab();

module triangle_screw_tab() {
  difference() {
    %cube([screw_r*4, th+1, screw_r*4], center=true);

    translate([0, 0, -screw_r*2])
    rotate([0, 45, 0])
    cube([screw_r*4*sqrt(2), th, screw_r*4*sqrt(2)], center=true);
    translate([0, 0, -screw_r*4])
    cube([screw_r*8, th+1, screw_r*4], center=true);

    translate([0, -th, 0])
    rotate([-90, 0, 0])
    cylinder(r=screw_r, h=th*2);
  }
}
//triangle_screw_tab();

module circle_screw_tab() {
  difference() {
    %cube([screw_r*4, th+1, screw_r*4], center=true);

    translate([0, th/2, -screw_r*4])
    rotate([90, , 0])
    cylinder(r=screw_r*6, h=th);
    translate([0, 0, -screw_r*6])
    cube([screw_r*12, th+1, screw_r*8], center=true);

    translate([0, -th, 0])
    rotate([-90, 0, 0])
    cylinder(r=screw_r, h=th*2);
  }
}
//circle_screw_tab();

module frame_base() {
  // bottom with cube hole
  difference() {
    union () {
      translate([0, 0, th/2])
      cube([w, w, th], center=true);

      translate([0, 0, 10])
      cube([40+th*2, 40+th*2, 20], center=true);
    }
    translate([0, 0, 10])
    cube([40, 40, 20+th], center=true);

    translate([10, 30, 20-th])
    rotate([90, 0, 0])
    cylinder(r=screw_r, h=60);
    translate([0, 30, 20-th])
    rotate([90, 0, 0])
    cylinder(r=screw_r, h=60);
    translate([-10, 30, 20-th])
    rotate([90, 0, 0])
    cylinder(r=screw_r, h=60);

    translate([-30, 10, 20-th])
    rotate([0, 90, 0])
    cylinder(r=screw_r, h=60);
    translate([-30, 0, 20-th])
    rotate([0, 90, 0])
    cylinder(r=screw_r, h=60);
    translate([-30, -10, 20-th])
    rotate([0, 90, 0])
    cylinder(r=screw_r, h=60);
  }

  // front
  translate([w/2, 0, side_height/2])
  cube([th, w, side_height], center=true);

  // back
  translate([-w/2, 0, side_height/2])
  cube([th, w, side_height], center=true);

  // right groove
  difference() {
    union () {
      translate([0, side_pos_y+th, side_height/2])
      cube([w, th, side_height], center=true);
      translate([0, side_pos_y-th, side_height/2])
      cube([w, th, side_height], center=true);
    }
    translate([0, side_pos_y, side_height/2+th*2])
    cube([w-th*3, th*4, side_height], center=true);
  }

  // left groove
  difference() {
    union () {
      translate([0, -side_pos_y+th, side_height/2])
      cube([w, th, side_height], center=true);
      translate([0, -side_pos_y-th, side_height/2])
      cube([w, th, side_height], center=true);
    }
    translate([0, -side_pos_y, side_height/2+th*2])
    cube([w-th*3, th*4, side_height], center=true);
  }

  // side screw hole tabs (middle)
  translate([0, side_pos_y+th, th*2+screw_r*2])
  circle_screw_tab();
  translate([0, -(side_pos_y+th), th*2+screw_r*2])
  circle_screw_tab();

  // side screw hole tabs (front and back)
  translate([tab_x, side_pos_y+th, side_height/2])
  rotate([0, -90, 0])
  circle_screw_tab();
  translate([-tab_x, side_pos_y+th, side_height/2])
  rotate([0, 90, 0])
  circle_screw_tab();
  translate([tab_x, -(side_pos_y+th), side_height/2])
  rotate([0, -90, 0])
  circle_screw_tab();
  translate([-tab_x, -(side_pos_y+th), side_height/2])
  rotate([0, 90, 0])
  circle_screw_tab();
}
module frame_base_m2() {
  difference() {
    frame_base();

    // slant top edges for lid
    translate([w/2+th, 0, side_height])
    rotate([0, 45, 0])
    cube([th*3, w+th, th*2], center=true);
    translate([-w/2-th, 0, side_height])
    rotate([0, -45, 0])
    cube([th*3, w+th, th*2], center=true);
  }
}

module frame_side() {
  difference() {
    union() {
      translate([0, -(side_top_height-side_height)/2, 0])
      cube([w-th, side_height-th, th], center=true);

      intersection() {
        cube([
          w-th, side_top_height-th, th],
          center=true
        );

        translate([
          0, side_height-(side_top_height+th)/2, 0
        ])
        rotate([0, 0, 45])
        cube([
          (w-th)/sqrt(2), (w-th)/sqrt(2), th
        ], center=true);
      }
    }

    // screw holes
    translate([0, -side_height+th*2+screw_r*2+1, -th])
    cylinder(r=screw_r, th*2);

    translate([tab_x, (screw_r-side_height)/2, -th])
    cylinder(r=screw_r, th*2);
    translate([-tab_x, (screw_r-side_height)/2, -th])
    cylinder(r=screw_r, th*2);

    translate([
      side_height/4,
      side_top_height/2-th*2-screw_r,
      -th
    ])
    cylinder(r=screw_r, th*2);
    translate([
      -side_height/4,
      side_top_height/2-th*2-screw_r,
      -th
    ])
    cylinder(r=screw_r, th*2);

    // hinge holes
    translate([
      hinge_x,
      hinge_z/2-th*3-1,
      -th
    ])
    cylinder(r=bearing_ir, th*2);
    translate([
      -hinge_x,
      hinge_z/2-th*3-1,
      -th
    ])
    cylinder(r=bearing_ir, th*2);

    // wheel holes
    translate([wheel_x, wheel_z-side_height+1, -th])
    cylinder(r=(bearing_ir+bearing_or)/2, h=th*2);
    translate([-wheel_x, wheel_z-side_height+1, -th])
    cylinder(r=(bearing_ir+bearing_or)/2, h=th*2);

    // bearing cap screw holes
    translate([
        -wheel_x+bearing_sr/(sqrt(2)),
        wheel_z-side_height+1+bearing_sr/(sqrt(2)),
        -th
    ])
    cylinder(r=screw_r, h=th*2);
    translate([
        -wheel_x-bearing_sr/(sqrt(2)),
        wheel_z-side_height+1-bearing_sr/(sqrt(2)),
        -th
    ])
    cylinder(r=screw_r, h=th*2);
    translate([
        wheel_x-bearing_sr/(sqrt(2)),
        wheel_z-side_height+1+bearing_sr/(sqrt(2)),
        -th
    ])
    cylinder(r=screw_r, h=th*2);
    translate([
        wheel_x+bearing_sr/(sqrt(2)),
        wheel_z-side_height+1-bearing_sr/(sqrt(2)),
        -th
    ])
    cylinder(r=screw_r, h=th*2);

    // tensioner mount screws
    translate([
        screw_r*4,
        wheel_z*2-screw_r*6,
        -th
    ])
    cylinder(r=screw_r, h=th*2);
    translate([
        -screw_r*4,
        wheel_z*2-screw_r*6,
        -th
    ])
    cylinder(r=screw_r, h=th*2);
  }
}
//frame_side();

module frame_top() {
  difference() {
    union() {
      translate([0, 0, th/2])
      cube([side_height, w, th], center=true);

      // right groove
      translate([0, side_pos_y+th, th])
      cube([side_height, th, th*2], center=true);
      translate([0, side_pos_y-th, th])
      cube([side_height, th, th*2], center=true);

      // left groove
      translate([0, -side_pos_y+th, th])
      cube([side_height, th, th*2], center=true);
      translate([0, -side_pos_y-th, th])
      cube([side_height, th, th*2], center=true);

      // support cross beams
      translate([(side_height-th*6)/2, 0, th])
      cube([th, w-th*6, th*2], center=true);
      translate([-(side_height-th*6)/2, 0, th])
      cube([th, w-th*6, th*2], center=true);

      translate([0, (side_height-th*6)/2, th])
      cube([side_height-th*6, th, th*2], center=true);
      translate([0, -(side_height-th*6)/2, th])
      cube([side_height-th*6, th, th*2], center=true);
    }

    translate([0, 0, -1])
    cylinder(r=prism_thread_r, h=th+2);

    translate([side_height/2, 0, th*1.5])
    rotate([0, 45, 0])
    cube([th*4, w+th, th*2], center=true);
    translate([-side_height/2, 0, th*1.5])
    rotate([0, -45, 0])
    cube([th*4, w+th, th*2], center=true);

    translate([screw_r*3, side_height-15, -40])
    cylinder(r=screw_r, h=side_height);
    translate([screw_r*3, -side_height+15, -40])
    cylinder(r=screw_r, h=side_height);
    translate([-screw_r*3, side_height-15, -40])
    cylinder(r=screw_r, h=side_height);
    translate([-screw_r*3, -side_height+15, -40])
    cylinder(r=screw_r, h=side_height);

    translate([0, -side_height/2, -40])
    cylinder(r=screw_r*4, h=side_height);
    translate([0, side_height/2, -40])
    cylinder(r=screw_r*4, h=side_height);
    
    // switch slot
    translate([
      side_height/2-th*6,
      side_height/2,
      th-0.1
    ])
    cube([6.9, 13, th*2], center=true);
  }

  // side screw hole tabs (front and back)
  translate([
      side_height/4,
      side_pos_y+th,
      th*2+screw_r*2
  ])
  circle_screw_tab();
  translate([
      -side_height/4,
      side_pos_y+th,
      th*2+screw_r*2
  ])
  circle_screw_tab();
  translate([
      side_height/4,
      -side_pos_y-th,
      th*2+screw_r*2
  ])
  circle_screw_tab();
  translate([
      -side_height/4,
      -side_pos_y-th,
      th*2+screw_r*2
  ])
  circle_screw_tab();
}
//frame_top();

module frame_door() {
  difference() {
    translate([w/4-th*2, 0, -bearing_or-th/2])
    cube([w/2-th*4, w, th], center=true);

    translate([th*2, w/2-th*1.5, -bearing_or-th/2])
    cube([th*4+1, th*3+1, th*2], center=true);
    translate([th*2, -w/2+th*1.5, -bearing_or-th/2])
    cube([th*4+1, th*3+1, th*2], center=true);
  }

  cyp = w/2-th*3-1;
  ch = bearing_or*2;
  translate([0, cyp, 0])
  rotate([90, 0, 0])
  difference() {
    cylinder(r=bearing_or+th, h=bearing_w+th);
    translate([0, 0, -0.5])
    cylinder(r=bearing_or, h=bearing_w+1);
    cylinder(r=bearing_ir+th, h=bearing_w+th+1);
    translate([0, bearing_or, bearing_w])
    cube([th, bearing_or*2, bearing_w*3], center=true);
  }
  translate([0, -cyp, 0])
  rotate([-90, 0, 0])
  difference() {
    cylinder(r=bearing_or+th, h=bearing_w+th);
    translate([0, 0, -0.5])
    cylinder(r=bearing_or, h=bearing_w+1);
    cylinder(r=bearing_ir+th, h=bearing_w+th+1);
    translate([0, -bearing_or, bearing_w])
    cube([th, bearing_or*2, bearing_w*3], center=true);
  }
  intersection() {
    translate([0, cyp, 0])
    rotate([90, 0, 0])
    difference() {
      cylinder(r=bearing_or+th, h=cyp*2-bearing_w-th);
      translate([0, 0, -0.5])
      cylinder(r=bearing_or, h=cyp*2);
    }
    translate([-bearing_or-th/2, 0, -bearing_or-th/2])
    cube([
      bearing_or*2+th, cyp*2, bearing_or*2+th
    ], center=true);
  }
}

module battery_mount() {
  difference() {
    import("stl/Dewalt_Adapter_-_Battery_Clip.stl");

    translate([screw_r*3, -16, -10])
    cylinder(r=screw_r, h=40);
    translate([-screw_r*3, -16, -10])
    cylinder(r=screw_r, h=40);
  }
}
//battery_mount();

module frame_door_pin() {
  cylinder(r=bearing_ir+th, h=th);
  cylinder(r=bearing_ir-0.1, h=bearing_w+th*4);
}


module wheel() {
  o = bearing_w+th+1;
  difference() {
    union() {
      translate([0, 0, bearing_w/3])
      cylinder(r=side_height/2-2, h=bearing_w/3);
      translate([0, 0, 0])
      gear(45, 3, 3, bearing_w);
      translate([0, 0, -th])
      cylinder(r=bearing_ir+bearing_th, h=th);
    }
    translate([0, 0, -th/2])
    cube([
      bearing_w/sqrt(2),
      bearing_w/sqrt(2),
      bearing_w/1.5+th
    ], center=true);
    translate([0, 0, bearing_w/1.5])
    cylinder(r=screw_r*2, h=bearing_w);
    translate([0, 0, 0])
    cylinder(r=screw_r, h=bearing_w);
  }
}
//wheel();

module wheel_axle() {
  difference() {
    union() {
      cylinder(r=bearing_ir+bearing_th, h=th);
      cylinder(
        r=bearing_ir-bearing_i,
        h=bearing_w+th
      );
      translate([0, 0, bearing_w+1.5*th+bearing_w/6])
      cube([
        bearing_w/sqrt(2),
        bearing_w/sqrt(2),
        bearing_w/3+th
      ], center=true);
    }

    translate([0, 0, -1])
    cylinder(r=screw_r, h=bearing_w+th*2+bearing_w/3+2);

    // drive rod hole
    translate([0, 0, -0.01])
    difference() {
      cylinder(r=5.5/2, h=7.65);

      translate([0, (5.5+3.8)/2, 7.65/2])
      cube([5.5, 5.5, 7.65+1], center=true);
      translate([0, -(5.5+3.8)/2, 7.65/2])
      cube([5.5, 5.5, 7.65+1], center=true);

    }
    translate([0, 0, -0.1])
    hex(5.4, 2.34);
  }
}
// wheel_axle();

//wheel_axis_cap();
module wheel_assembly(e) {
  translate([0, 0, e*5])
  wheel_axle();
  translate([0, 0, bearing_w+th*2+e*7])
  wheel();
}
//wheel_assembly(0);

module tensioner(spring_len, spring_w) {
  m=bearing_w*1+th+1;

  // mount point
  translate([0, 0, spring_len-screw_r*2])
  difference() {
    translate([0, th/2, screw_r*6])
    cube([screw_r*12, th, screw_r*12], center=true);

    translate([screw_r*4, screw_r*2, screw_r*6])
    rotate([90, 0, 0])
    cylinder(r=screw_r, h=screw_r*4);
    translate([-screw_r*4, screw_r*2, screw_r*6])
    rotate([90, 0, 0])
    cylinder(r=screw_r, h=screw_r*4);
  }

  // spring hanger
  translate([0, 0, spring_len-screw_r*2])
  difference() {
    translate([0, m+th, screw_r*6])
    cube([th, m*2, screw_r*12], center=true);

    translate([-screw_r*2, m+th-spring_w-1/2, screw_r*2])
    rotate([0, 90, 0])
    cylinder(r=screw_r, h=screw_r*4);

    translate([-screw_r*2, m+th+spring_w+1.5, screw_r*2])
    rotate([0, 90, 0])
    cylinder(r=screw_r, h=screw_r*4);
  }
}

module tensioner_bearing(spring_w) {
  difference() {
    union() {
      cylinder(r=bearing_or+th, h=bearing_w+th-1);
      translate([
        0,
        -bearing_or-th-screw_r*2+0.1,
        (bearing_w+th-1)/2
      ])
      cube([th, screw_r*4, bearing_w+th-1], center=true);
    }

    translate([0, 0, -0.1])
    cylinder(r=bearing_or+0.1, h=bearing_w+0.2);

    cylinder(
      r=(bearing_ir+bearing_or)/2,
      h=bearing_w+th*2
    );

    translate([
      -th,
      -bearing_or-th-screw_r*2,
      (spring_w)/2
    ])
    rotate([0, 90, 0])
    cylinder(r=screw_r, h=th*2);
  }
  %bearing();
}
//tensioner_bearing();

module tensioner_wheel() {
  translate([0, bearing_w/6, 0])
  rotate([90, 0, 0])
  cylinder(r=12.5, h=bearing_w/3);
  translate([0, bearing_w/2, 0])
  rotate([90, 0, 0])
  gear(15, 3, 3, bearing_w);

  translate([0, bearing_w*1.5+th/2, 0])
  rotate([90, 0, 0])
  cylinder(r=bearing_ir-0.1, h=bearing_w*3+th);

  translate([0, (bearing_w+1)/2, 0])
  rotate([90, 0, 0])
  cylinder(r=bearing_ir+bearing_th, h=bearing_w+1);
}

module tensioner_assembly(spring_len, spring_w, e) {
  m=bearing_w*1.5+th+1;
  tensioner(spring_len, spring_w);

  translate([0, m-spring_w-1, 0])
  %cylinder(r=spring_w/2, h=spring_len);
  translate([0, m+spring_w+1+e, 0])
  %cylinder(r=spring_w/2, h=spring_len);

  translate([0, m+spring_w/2+1+e*2, -bearing_or-th-screw_r*2])
  rotate([-90, 0, 0])
  tensioner_bearing(spring_w);

  translate([0, m-spring_w/2-1, -bearing_or-th-screw_r*2])
  rotate([90, 180, 0])
  tensioner_bearing(spring_w);

  translate([0, m+e, -bearing_or-th-screw_r*2])
  tensioner_wheel();
}

module tire() {
  //translate([0, 0, o+bearing_w/3])
  //cylinder(r=side_height/2-2, h=bearing_w/3);
  circumference = wheel_x*4+(side_height/2-2)*2*PI;
  difference() {
    cylinder(r=circumference/(2*PI)+2, h=bearing_w);

    //translate([0, 0, bearing_w/3])
    //cylinder(r=circumference/(2*PI), h=bearing_w/3);

    translate([0, 0, -1])
    cylinder(r=circumference/(2*PI)-0.4, h=bearing_w+2);;

    //translate([0, 0, -0.1])
    //gear(teeth, 3, 3, bearing_w+0.2);
  }

  teeth=104;
  gap_modifier=0.15;
  for(i=[0:teeth-1]) {
    angle=i*360/teeth;
    r=teeth*(3+gap_modifier)/(PI*sqrt(2))*cos(180/teeth)+3;

    rotate([0, 0, angle])
    translate([0, r, 0])
    rotate([0, 0, 180])
    tooth(3, 3, bearing_w/3);

    rotate([0, 0, angle])
    translate([0, r, 2*bearing_w/3])
    rotate([0, 0, 180])
    tooth(3, 3, bearing_w/3);
  }
  // tread
  treads=110;
  for(i=[0:treads-1]) {
    rotate(i*360/treads)
    translate([
      0, treads*3/(PI*sqrt(2))*cos(180/treads)+th*1.5,
      bearing_w/2
    ])
    cube([th/2, th/2, bearing_w], center=true);
  }
}

module pi_clip() {
  hole_x_offset = 22.8/2;
  hole_y_offset = 57.7/2;
   
  translate([0, 0, 5]) 
  %zero(true);
  
  translate([0, 0, -th*3])
  rotate([180, 0, 0])
  %pi_camera();
  
  //translate([0, 0, -th/2])
  //%cube([w, side_height, th], center=true);

  // pi mount
  difference() {
    translate([hole_x_offset, hole_y_offset+th, 8])
    cube([screw_r*3, screw_r*3+th*2, th], center=true);
    translate([hole_x_offset, hole_y_offset, 0])
    cylinder(r=screw_r, h=10);
  }
  difference() {
    translate([-hole_x_offset, hole_y_offset+th, 8])
    cube([screw_r*3, screw_r*3+th*2, th], center=true);
    translate([-hole_x_offset, hole_y_offset, 0])
    cylinder(r=screw_r, h=10);
  }
  
  // "arch"
  difference() {
    union() {
      translate([
        hole_x_offset, hole_y_offset+th*2+0.15, 0
      ])
      cube([screw_r*3, th*1.5, th*5], center=true);
      translate([
        -hole_x_offset, hole_y_offset+th*2+0.15, 0
      ])
      cube([screw_r*3, th*1.5, th*5], center=true);
    }
    translate([0, 0, -th/2])
    cube([w, side_height, th+0.1], center=true);

    translate([0, hole_y_offset+th*4, -9])
    rotate([45, 0, 0])
    cube([40, 40, 10], center=true);
  }
  
  // camera holder
  difference() {
    translate([0, 10+th/2, -9])
    cube([30, side_height/2+20-th, 10], center=true);
      
    translate([0, 21, -9])
    cube([26, side_height/2, 11], center=true);
    translate([0, 0, -9])
    cube([20, 20, 12], center=true);
    translate([0, 0, -9])
    cube([26, 26, 2], center=true);

    translate([0, hole_y_offset+th*4, -9])
    rotate([45, 0, 0])
    cube([40, 40, 10], center=true);
  }
}
//rotate([90, 0, 0])
//pi_clip();

module display(e, a, spring_len) {
  translate([0, 0, -e])
  frame_base_m2();

  translate([0, side_pos_y+e*2, (side_top_height+th)/2])
  rotate([90, 0, 0])
  frame_side();

  translate([0, -side_pos_y-e*2, (side_top_height+th)/2])
  rotate([90, 0, 180])
  frame_side();

  translate([0, 0, side_top_height+th])
  rotate([0, 180, 0])
  frame_top();

  translate([
    0,
    side_top_height/2+th,
    side_top_height+th+e
  ])
  battery_mount();
  translate([
    0,
    -side_top_height/2-th,
    side_top_height+th+e
  ])
  rotate([0, 0, 180])
  battery_mount();

  translate([0, 0, hinge_z])
  union() {
    translate([hinge_x+e, 0, 0])
    rotate([0, 135+a, 180])
    frame_door();

    translate([-hinge_x-e, 0, 0])
    rotate([0, 135+a, 0])
    frame_door();

    translate([hinge_x, -side_pos_y+th*0.5-e, 0])
    rotate([-90, 0, 0])
    union() {
      %bearing();

      translate([0, 0, -th*2-e*2])
      frame_door_pin();
    }
    translate([-hinge_x, -side_pos_y+th*0.5-e, 0])
    rotate([-90, 0, 0])
    union() {
      %bearing();

      translate([0, 0, -th*2-e*2])
      frame_door_pin();
    }

    translate([hinge_x, side_pos_y-th*0.5+e, 0])
    rotate([90, 0, 0])
    union() {
      %bearing();

      translate([0, 0, -th*2-e*2])
      frame_door_pin();
    }

    translate([-hinge_x, side_pos_y-th*0.5+e, 0])
    rotate([90, 0, 0])
    union() {
      %bearing();

      translate([0, 0, -th*2-e*2])
      frame_door_pin();
    }
  }

  translate([wheel_x, wheel_y+e*3, wheel_z])
  rotate([-90, 45, 0])
  bearing_cap();
  translate([-wheel_x, wheel_y+e*3, wheel_z])
  rotate([-90, -45, 0])
  bearing_cap();
  translate([wheel_x, -wheel_y-e*3, wheel_z])
  rotate([90, 45, 0])
  bearing_cap();
  translate([-wheel_x, -wheel_y-e*3, wheel_z])
  rotate([90, -45, 0])
  bearing_cap();

  translate([wheel_x, wheel_y-th, wheel_z])
  rotate([-90, 90, 0])
  wheel_assembly(e);
  translate([-wheel_x, wheel_y-th, wheel_z])
  rotate([-90, 90, 0])
  wheel_assembly(e);
  translate([wheel_x, -wheel_y+th, wheel_z])
  rotate([90, 90, 0])
  wheel_assembly(e);
  translate([-wheel_x, -wheel_y+th, wheel_z])
  rotate([90, 90, 0])
  wheel_assembly(e);

  t_offset=wheel_z*3;
  translate([0, -wheel_y-e*3, t_offset])
  rotate([0, 0, 180])
  tensioner_assembly(spring_len, th*2, e);
  translate([0, wheel_y+e*3, t_offset])
  tensioner_assembly(spring_len, th*2, e);

  // electronics
  rotate([0, 0, 90])
  pump_mount();
  translate([-50, 0, th])
  rotate([0, 0, 90])
  ink_well();

  translate([-wheel_x, wheel_y-th*2, wheel_z])
  rotate([90, -90, 180])
  %dc_motor();
  translate([-wheel_x, -wheel_y+th*2, wheel_z])
  rotate([0, 90, -90])
  %dc_motor();

  translate([25, -wheel_y+30+th, th])
  %voltage_switch();
  translate([25, -wheel_y+30+th, th+34])
  %voltage_switch();
  
  translate([50, wheel_y-30-th, th])
  rotate([0, 0, 90])
  %large_voltage_regulator();
  translate([50, wheel_y-30-th, th+20])
  rotate([0, 0, 90])
  %large_voltage_regulator();

  translate([w/2-th/2+e*2, 0, side_height/2])
  rotate([90, 0, -90])
  pi_clip();
}

