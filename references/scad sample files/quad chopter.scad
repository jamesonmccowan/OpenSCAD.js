$fs=0.5;
$fa=5; 

/* to do:
x frame base
x frame side
x frame top
x frame doors
x way to mount frame doors
x way to mount prism
- adjustable way to mount nozzle
> vertical screw adjusted by spacers/nuts?
- wheels
- wheel tred
- mockup of all internal components
- arrange all internal components
- devise wiring and mounting for all internal components
*/

w       = 200;
th      = 3;
screw_r = 3.22/2;

bearing_ir = 8.03/2;
bearing_or = 22/2;
bearing_w  = 7;
bearing_th = 1.6;
bearing_i  = 0.1;
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
    }
      
    translate([0, 0, -1])
    cylinder(r=prism_thread_r, h=th+2);
    
    translate([side_height/2, 0, th*1.5])
    rotate([0, 45, 0])
    cube([th*4, w+th, th*2], center=true);
    translate([-side_height/2, 0, th*1.5])
    rotate([0, -45, 0])
    cube([th*4, w+th, th*2], center=true);
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

module frame_door_pin() {
  cylinder(r=bearing_ir+th, h=th);
  cylinder(r=bearing_ir-0.1, h=bearing_w+th*4);
}


module wheel() {
  o = bearing_w+th+1;
  difference() {
    union() {
      //translate([0, 0, o])
      //cylinder(r=side_height/2, h=bearing_w);
      translate([0, 0, o+bearing_w/3])
      cylinder(r=side_height/2-2, h=bearing_w/3);
      translate([0, 0, o])
      gear(45, 3, 3, bearing_w);
        
      translate([0, 0, o+bearing_w+screw_r*2])
      cube([
        screw_r*4+th*2,
        screw_r*4+th*2,
        screw_r*4
      ], center=true);
    }
    translate([0, 0, o+screw_r*2])
    cube([
      screw_r*4+0.1,
      screw_r*4+0.1,
      (o+screw_r*2+th)*2
    ], center=true);
    
    translate([0, screw_r*2+th*2, o+bearing_w+screw_r*2])
    rotate([90, 0, 0])
    cylinder(r=screw_r, h=screw_r*6+th*3);
  }
}
//wheel();
module wheel_axis() {
  difference() {
    translate([0, 0, -th-screw_r*4])
    cylinder(r=bearing_ir-0.1, h=bearing_w+th*2+screw_r*4);
     
    translate([0, bearing_ir, -th-screw_r*2])
    rotate([90, 0, 0])
    cylinder(r=screw_r, h=bearing_ir*2);
  }
  translate([0, 0, bearing_w])
  cylinder(r=bearing_ir+bearing_th, h=th);
  
  cl = bearing_w+th+screw_r*4+th*2+1;
  difference() {
    translate([0, 0, (cl+bearing_w)/2+1])
    cube([
      screw_r*4,
      screw_r*4,
      cl-bearing_w
    ], center=true);
    
    translate([0, screw_r*2+th*2, cl-screw_r*2+1])
    rotate([90, 0, 0])
    cylinder(r=screw_r, h=screw_r*6+th*3);
  }
}

module wheel_axis_cap() {
  o = -screw_r*4-th;
  difference() {
    translate([0, 0, o-1])
    cylinder(r=bearing_ir+th, h=screw_r*4+1);
    
    translate([0, 0, o-1.1])
    cylinder(r=bearing_ir+0.1, h=screw_r*6);
      
    translate([0, bearing_ir+th*2, o+screw_r*2])
    rotate([90, 0, 0])
    cylinder(r=screw_r, h=bearing_ir*2+th*4);
  }
  translate([0, 0, o-1-bearing_w])
  gear(10, 3, 3, bearing_w);
}
//wheel_axis_cap();
module wheel_assembly(e) {
  translate([0, 0, e*5])
  wheel_axis();
  translate([0, 0, e*7])
  wheel();
  wheel_axis_cap();
}
// wheel_assembly();

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
  teeth=110;
  difference() {
    cylinder(r=circumference/(2*PI)+2, h=bearing_w);

    translate([0, 0, bearing_w/3])
    cylinder(r=circumference/(2*PI), h=bearing_w/3);

    translate([0, 0, -0.1])
    gear(teeth, 3, 3, bearing_w+0.2);
  }
  
  // tread
  for(i=[0:teeth-1]) {
    rotate(i*360/teeth)
    translate([
      0, teeth*3/(PI*sqrt(2))*cos(180/teeth)+th*1.5, bearing_w/2
    ])
    cube([th/2, th/2, bearing_w], center=true);
  }
}

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
  
  translate([wheel_x, wheel_y, wheel_z])
  rotate([-90, 0, 0])
  wheel_assembly(e);
  translate([-wheel_x, wheel_y, wheel_z])
  rotate([-90, 0, 0])
  wheel_assembly(e);
  translate([wheel_x, -wheel_y, wheel_z])
  rotate([90, 0, 0])
  wheel_assembly(e);
  translate([-wheel_x, -wheel_y, wheel_z])
  rotate([90, 0, 0])
  wheel_assembly(e);
  
  t_offset=wheel_z*3;
  translate([0, -wheel_y-e*3, t_offset])
  rotate([0, 0, 180])
  tensioner_assembly(spring_len, th*2, e);
  translate([0, wheel_y+e*3, t_offset])
  tensioner_assembly(spring_len, th*2, e);
}
display(10, 90, 30);
// wheel_assembly();
// tensioner(30, 10);
// frame_base();     // x1
// frame_side();     // x2
// frame_top();      // x1
// frame_door();     // x2
// frame_door_pin(); // x4
// tensioner(30, th*2);
// tensioner_wheel();
// tensioner_bearing(th*2);
// tire();