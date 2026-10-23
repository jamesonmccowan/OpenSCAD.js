$fs=0.5;
$fa=5;

th       = 3;
screw_r  = 3.22/2;
nozzle_r = (5.8+5.4)/4;

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
  cylinder(r=teeth*w/(PI*sqrt(2)), h=h);
}
// gear(20, 3, 3, 2);

module usb_micro_plug() {
    translate([6.15/2, 0, 0])
    cube([6.15, 7, 2.36], center=true);
    translate([-15/2, 0, 0])
    cube([15, 10.5, 6.8], center=true);
    translate([-18, 0, 0])
    cube([6, 8, 4], center=true);
}
//usb_micro_plug();

module hdmi_micro_plug() {
    translate([6.6/2, 0, 0])
    cube([6.6, 10.5, 2.45], center=true);
    translate([-12/2, 0, 0])
    cube([12, 15, 10.5], center=true);
    translate([-19.5, 0, 0])
    cube([15, 22.7, 12.25], center=true);
}
//hdmi_micro_plug();

module pico() {
  difference() {
    translate([0, 0, 6.3/2])
    cube([21.3, 52.7, 6.3], center=true);

    translate([(9.42/2-1.9/2), (51.17/2-1.9/2-1), -1])
    cylinder(r=1.9/2, h=20);
    translate([(9.42/2-1.9/2), -(51.17/2-1.9/2-1), -1])
    cylinder(r=1.9/2, h=20);
    translate([-(9.42/2-1.9/2), (51.17/2-1.9/2-1), -1])
    cylinder(r=1.9/2, h=20);
    translate([-(9.42/2-1.9/2), -(51.17/2-1.9/2-1), -1])
    cylinder(r=1.9/2, h=20);
  }

  translate([(15.43+2.6)/2, 0, -2.3/2])
  cube([2.6, 52.7, 2.3], center=true);
  translate([-(15.43+2.6)/2, 0, -2.3/2])
  cube([2.6, 52.7, 2.3], center=true);

  translate([(15.43+2.6)/2, 0, -(2.3+5.5)/2])
  cube([0.65, 52.7, 5.5], center=true);
  translate([-(15.43+2.6)/2, 0, -(2.3+5.5)/2])
  cube([0.65, 52.7, 5.5], center=true);

  %translate([0, -52.7/2, ((6.3-1.18)/2)+1.18])
  rotate([0, 0, 90])
  usb_micro_plug();
}
//pico();

module zero(top=false) {
  pin_base_width = 2.6;
  hole_x_offset = 22.8/2;
  hole_y_offset = 57.7/2;

  difference() {
    translate([0, 0, 1.5/2])
    cube([30.6, 65, 1.5], center=true);

    translate([hole_x_offset, hole_y_offset, -1])
    cylinder(r=2.7/2, h=5);
    translate([hole_x_offset, -hole_y_offset, -1])
    cylinder(r=2.7/2, h=5);
    translate([-hole_x_offset, hole_y_offset, -1])
    cylinder(r=2.7/2, h=5);
    translate([-hole_x_offset, -hole_y_offset, -1])
    cylinder(r=2.7/2, h=5);
  }

  // pins
    translate([
      -hole_x_offset+(pin_base_width/2),
      0,
      top ? (4) : (-2.3/2)
    ])
    cube([pin_base_width, 52.7, 2.3], center=true);
      
    translate([
      -hole_x_offset-(pin_base_width/2),
      0,
      top ? (4) : (-2.3/2)
    ])
    cube([pin_base_width, 52.7, 2.3], center=true);

    translate([
      -hole_x_offset+(pin_base_width/2),
      0,
      top ? (6) : (-(2.3+5.5)/2)
    ])
    cube([0.65, 52.7, 5.5], center=true);
      
    translate([
      -hole_x_offset-(pin_base_width/2),
      0,
      top ? (6) : (-(2.3+5.5)/2)
    ])
    cube([0.65, 52.7, 5.5], center=true);

  // ribon cable
  translate([0, 65/2, (3.45-1.5)/2+1.5])
  cube([17.6, 2, 3.45-1.5], center=true);
  %translate([0, 65/2, (3.45-1.5)/2+1.5])
  cube([17.6, 20, 1], center=true);

  // USBs
  translate([(30.6-5.75)/2+1.6, (65-8.1)/2-7.2, 4.2/2])
  cube([5.75, 8.1, 4.2], center=true);
  translate([(30.6)/2+1.6, (65-8.1)/2-7.2, 1.5])
  rotate([0, 0, 180])
  %usb_micro_plug();

  translate([(30.6-5.75)/2+1.6, (65-8.1)/2-20.3, 4.2/2])
  cube([5.75, 8.1, 4.2], center=true);
  translate([30.6/2+1.6, (65-8.1)/2-20.3, 1.5])
  rotate([0, 0, 180])
  %usb_micro_plug();

  // HTMI
  translate([(30.6-7.7)/2+1.6, -(65-11.4)/2+7, 4.8/2])
  cube([7.7, 11.4, 4.8], center=true);
  translate([30.6/2+1.6, -(65-11.4)/2+7, 3.3])
  rotate([0, 0, 180])
  %hdmi_micro_plug();

  // sd card
  %translate([-2.5, -(65+15)/2, 1.3/2+1.5])
  cube([12, 15, 1.3], center=true);

  // heat sink
  translate([(30.6-(14+4))/2-(5.5-2), -(65-(14+4))/2+(18-2), 8.8/2])
  cube([14+4, 14+4, 8.8], center=true);

  // space for components
  translate([0, 0, 3.45/2])
  cube([30.6, 52.25, 3.45], center=true);
  translate([0, 0, 3.45/2])
  cube([17.6, 65, 3.45], center=true);
}
//zero(true);

module pi_camera() {
  difference() {
    union() {
      translate([0, 0, 1.8/2])
      cube([25.2, 24.3, 1.8], center=true);

      // component space
      translate([0, 0, -3/2+1.8])
      cube([24.2, 23.3, 3], center=true);
    }

    // holes
    translate([21/2, (24.3-1.8)/2-1.35, -4])
    cylinder(r=1.8/2, h=8);
    translate([-21/2, (24.3-1.8)/2-1.35, -4])
    cylinder(r=1.8/2, h=8);

    translate([21/2, -(24.3-1.8)/2+8.4, -4])
    cylinder(r=1.8/2, h=8);
    translate([-21/2, -(24.3-1.8)/2+8.4, -4])
    cylinder(r=1.8/2, h=8);
  }

  // ribbon cable
  translate([0, -(24.3-5.5)/2, -4.4/2])
  cube([23, 5.5, 4.4], center=true);
  translate([0, -(24.3+10)/2, -4.4/2])
  %cube([17, 10, 2], center=true);

  // camera
  translate([(24.2-8.7)/2-8.5, (24.3-8.7)/2-10.2, 8/2])
  cube([8.7, 8.7, 8], center=true);
  translate([(24.2-8.7)/2-8.5, (24.3-8.7)/2-10.2, 8])
  %cylinder(r1=1, r2=30, h=30);
  translate([(24.2-8.7)/2-8.5, (24.3-17.8)/2-1.8, 1.8+(1.2/2)])
  cube([8.7, 17.8, 1.2], center=true);

  translate([24.2/2-5, 24.3/2-5, 1.8+(0.75/2)])
  cube([4.5, 4.5, 0.75], center=true);
}
//pi_camera();

module 180_camera() {
  translate([0, 0, 7/2])
  cube([39, 38, 7], center=true);

  translate([(39-11)/2-7, -(38-6)/2+2, -5/2])
  cube([11, 6, 5], center=true);

  cylinder(r=18/2, h=24);
}
//180_camera();

module ranger() {
}

module stepper_motor_28BYJ() {
  // drive rod
  difference() {
    cylinder(r=5/2, h=7.65);

    translate([0, (5+3)/2, 7.65/2+1.65])
    cube([5, 5, 7.65], center=true);
    translate([0, -(5+3)/2, 7.65/2+1.65])
    cube([5, 5, 7.65], center=true);
  }
  translate([0, 0, -1.6])
  cylinder(r=9.3/2, h=1.6);

  // main body
  translate([0, -28/2+1.5+9.3/2, -1.6-19.1])
  cylinder(r=28/2, h=19.1);
  translate([0, -31.2+1.5+9.3/2+5, -1.6-19.1/2])
  cube([17.5, 10, 19.1], center=true);

  // screw holes
  difference() {
    translate([0, -28/2+1.5+9.3/2, -1.6-1.2/2])
    cube([43, 7.2, 1.2], center=true);
    translate([
      (43-4.2)/2-(7.2-4.2)/2,
      -28/2+1.5+9.3/2,
      -1.6-1.3
    ])
    cylinder(r=4.2/2, h=2);
    translate([
      -(43-4.2)/2+(7.2-4.2)/2,
      -28/2+1.5+9.3/2,
      -1.6-1.3
    ])
    cylinder(r=4.2/2, h=2);
  }

  // wires
  translate([0, -41.2+1.5+9.3/2+5, -1.6-2])
  %cube([7, 10, 2], center=true);

}
//stepper_motor_28BYJ();

module stepper_motor_controller_28BYJ() {
  difference() {
    union() {
      translate([0, 0, 1.8/2])
      cube([35, 33, 1.8], center=true);
      translate([0, 0, 13/2-2])
      cube([34, 32, 13], center=true);
    }

    translate([(35/2-2.9-1), (33/2-2.9-1), -4])
    cylinder(r=2.9/2, h=18);
    translate([(35/2-2.9-1), -(33/2-2.9-1), -4])
    cylinder(r=2.9/2, h=18);
    translate([-(35/2-2.9-1), (33/2-2.9-1), -4])
    cylinder(r=2.9/2, h=18);
    translate([-(35/2-2.9-1), -(33/2-2.9-1), -4])
    cylinder(r=2.9/2, h=18);
  }
}
//stepper_motor_controller_28BYJ();

module dc_motor() {
  // drive rod
  difference() {
    cylinder(r=5.5/2, h=7.65);

    translate([0, (5.5+3.8)/2, 7.65/2])
    cube([5.5, 5.5, 7.65+1], center=true);
    translate([0, -(5.5+3.8)/2, 7.65/2])
    cube([5.5, 5.5, 7.65+1], center=true);
  }

  // body
  difference() {
    translate([0, (37.1-3.8)/2-9.27, -18.8/2])
    cube([22.4, 37.1, 18.8], center=true);

    translate([22.4/2-2.5, 20, -20])
    cylinder(r=3/2, h=30);
    translate([-22.4/2+2.5, 20, -20])
    cylinder(r=3/2, h=30);
  }

  // second drive rod
  difference() {
    translate([0, 0, -18.8-7.65])
    cylinder(r=5.5/2, h=7.65);

    translate([0, (5.5+3.8)/2, -18.8-7.65+7.65/2])
    cube([5.5, 5.5, 7.65+1], center=true);
    translate([0, -(5.5+3.8)/2, -18.8-7.65+7.65/2])
    cube([5.5, 5.5, 7.65+1], center=true);
  }

  // screw tab
  difference() {
    translate([0, -13.6, -9-2.8/2])
    cube([5.3, 5, 2.8], center=true);
    translate([0, -13.6, -10-2.8])
    cylinder(r=3/2, h=5);
  }

  // vague motor block
  translate([0, 37.1+29/2-9.27-3.8/2, -23/2+(23-18.8)/2])
  cube([23, 29, 23], center=true);
}
// dc_motor();

module voltage_switch() {
  difference() {
    translate([0, 0, 30/2])
    cube([45, 48, 30], center=true);

    translate([38/2, ((48-2.9)/2-2), -1])
    cylinder(r=2.9/2, h=34);
    translate([-38/2, ((48-2.9)/2-2), -1])
    cylinder(r=2.9/2, h=34);
    translate([38/2, -((48-2.9)/2-5), -1])
    cylinder(r=2.9/2, h=34);
    translate([-38/2, -((48-2.9)/2-5), -1])
    cylinder(r=2.9/2, h=34);
  }

  // wire space
  translate([0, -((48-10)/2-17.5), 7])
  %cube([45+20, 10, 4], center=true);
}
//voltage_switch();

module pump() {
  cylinder(r=27.5/2, h=29.8);
  cylinder(r=25/2, h=70);

  difference() {
    translate([0, 28.45-3.2/2-25/2, 13/2+17])
    cube([41, 3.2, 13], center=true);

    translate([30.5/2, 0, 13/2+17])
    rotate([-90, 0, 0])
    cylinder(r=3/2, h=30);
    translate([-30.5/2, 0, 13/2+17])
    rotate([-90, 0, 0])
    cylinder(r=3/2, h=30);
  }

  translate([0, 0, -10.75])
  cylinder(r=6.75/2, h=10.75);
  translate([(6.75-27.5)/2, 0, -10.75])
  cylinder(r=6.75/2, h=10.75);
}
//pump();

module pump_nozzle() {
  difference() {
    union() {
      cylinder(r=6.6/2, h=2.1);
      cylinder(r=5.3/2, h=7.1);
      translate([0, 0, 7.1])
      cylinder(r1=6.5/2, r2=4.4/2, h=10.7-7.1);
    }
    translate([0, 0, -1])
    cylinder(r=3.0/2, h=12);
  }
}
//pump_nozzle();

module pump_mount() {
  translate([0, 0, 40])
  %pump();

  // cube mount hole
  /*
  %difference() {
    translate([0, 0, 10])
    cube([40+th*2, 40+th*2, 20], center=true);

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
  */

  // nozzle
  %union() {
    translate([0, 0, 7])
    cylinder(r=nozzle_r, h=5.3);
    translate([0, 0, -1])
    cylinder(r1=0, r2=7/2, h=8);
  }

  // mount and base
  difference() {
    translate([0, 0, 63/2+7])
    cube([39, 39, 63], center=true);
    translate([0, 0, 63/2+7+th])
    cube([39-th*2, 39-th*2, 63], center=true);
    translate([0, -th*1.5, 63/2+17+th])
    cube([39-th*2, 39+th, 63], center=true);
    translate([0, -21, 50])
    rotate([-45, 0, 0])
    cube([39+th, 39+th, 63], center=true);
    translate([0, 0, 67])
    cube([39+th*2, 39-th*2, 20], center=true);

    // top screw holes
    translate([15, 30, 63.5])
    rotate([90, 0, 0])
    cylinder(r=screw_r, h=60);
    translate([-15, 30, 63.5])
    rotate([90, 0, 0])
    cylinder(r=screw_r, h=60);

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

    translate([0, 0, 6])
    cylinder(r=nozzle_r, h=th+2);
  }

  translate([0, 0, 15])
  pump_nozzle();
  difference() {
    translate([0, 0, 10])
    cylinder(r=nozzle_r+th/2, h=5);
    cylinder(r=nozzle_r, h=20);
  }
  translate([-10, -5, 10])
  rotate([0, 0, -90])
  %u_out_pipe();
  
  // ink well mount
  difference() {
    union() {
      translate([th+0.1, 22.5, 47.5-7])
      cube([th, th*2+0.1, 34], center=true);
      translate([-th-0.1, 22.5, 47.5-7])
      cube([th, th*2+0.1, 34], center=true);
    }

    translate([0, 24, 47.5-26])
    rotate([-45, 0, 0])
    cube([th*4, 11, 30], center=true);
    
    translate([0, 21.1, 47.5])
    cube([th*4, th+0.2, 30], center=true);
  }
}
pump_mount();

module u_pipe() {
  difference() {
    union() {
      translate([-5, 0, 8])
      pump_nozzle();
      translate([5, 0, 8])
      pump_nozzle();
      translate([-5, 0, 5])
      cylinder(r=nozzle_r+th/2, h=3);
      translate([5, 0, 5])
      cylinder(r=nozzle_r+th/2, h=3);

      translate([5+nozzle_r+th/2, 0, nozzle_r+th/2])
      rotate([0, -90, 0])
      cylinder(r=nozzle_r+th/2, h=2*(5+nozzle_r+th/2));
    }
    translate([-5, 0, 4])
    cylinder(r=nozzle_r, h=4.1);
    translate([5, 0, 4])
    cylinder(r=nozzle_r, h=4.1);
    translate([5+nozzle_r, 0, nozzle_r+th/2])
    rotate([0, -90, 0])
    %cylinder(r=nozzle_r, h=2*(5+nozzle_r));
  }
}
//u_pipe();

module s_pipe(l) {
  difference() {
    union() {
      translate([-l/2, 0, nozzle_r+th/2])
      pump_nozzle();
      translate([-l/2, 0, nozzle_r+th/2-3])
      cylinder(r=nozzle_r+th/2, h=3);

      translate([l/2, 0, -nozzle_r-th/2])
      rotate([180, 0, 0])
      pump_nozzle();
      translate([l/2, 0, 3-nozzle_r-th/2])
      rotate([180, 0, 0])
      cylinder(r=nozzle_r+th/2, h=3);

      translate([(l+th)/2+nozzle_r, 0, 0])
      rotate([0, -90, 0])
      cylinder(r=nozzle_r+th/2, h=l+nozzle_r*2+th);
    }
    translate([-l/2, 0, nozzle_r+th/2-3.1])
    cylinder(r=nozzle_r, h=3.2);

    translate([l/2, 0, 3.1-nozzle_r-th/2])
    rotate([180, 0, 0])
    cylinder(r=nozzle_r, h=3.2);

    translate([(l-th)/2+nozzle_r, 0, 0])
    rotate([0, -90, 0])
    cylinder(r=nozzle_r, h=l+nozzle_r*2-th);
  }
}
//s_pipe(10);

module u_out_pipe() {
  difference() {
    union() {
      translate([-5, 0, 8])
      pump_nozzle();
      translate([-5, 0, 5])
      cylinder(r=nozzle_r+th/2, h=3);

      translate([5+nozzle_r+th/2, 0, nozzle_r+th/2])
      rotate([0, -90, 0])
      cylinder(r=nozzle_r+th/2, h=2*(5+nozzle_r+th/2));

      translate([5, 0, 0])
      cylinder(r=nozzle_r+th/2, h=2*(5+nozzle_r+th/2));

      translate([9, 0, 13.5])
      rotate([0, 90, 0])
      pump_nozzle();
      translate([6, 0, 13.5])
      rotate([0, 90, 0])
      cylinder(r=nozzle_r+th/2, h=3);
    }
    translate([-5, 0, 4])
    cylinder(r=nozzle_r, h=4.1);

    translate([5, 0, nozzle_r+th/2])
    cylinder(r=nozzle_r, h=2*(5+nozzle_r)-th);

    translate([5+nozzle_r, 0, nozzle_r+th/2])
    rotate([0, -90, 0])
    cylinder(r=nozzle_r, h=2*(5+nozzle_r));

    translate([5, 0, 13.5])
    rotate([0, 90, 0])
    cylinder(r=nozzle_r, h=4.1);
  }
}
//u_out_pipe();

module ink_well() {
  th=3;
  w=40;
  h=60;

  // main body
  difference() {
    union() {
      cylinder(r=w/2, h=h);

      translate([0, 0, h])
      cylinder(r1=w/2, r2=w/4, h=w/4);
      translate([0, 0, h+w/4])
      cylinder(r1=w/4, r2=w/3.8, h=w/4);

      translate([-w/2+1, 0, th*1.5])
      rotate([0, -90, 0])
      pump_nozzle();
    }
    translate([0, 0, th*2])
    cylinder(r=w/2-th, h=h-th*2);
    translate([0, 0, th])
    cylinder(r1=0, r2=w/2-th, h=th+0.1);

    translate([0, 0, h-0.1])
    cylinder(r1=w/2-th, r2=w/4-th, h=w/4+0.2);
    translate([0, 0, h+w/4-0.1])
    cylinder(r1=w/4-th, r2=w/3.8-th, h=w/4+0.2);

    translate([0, 0, th*1.5])
    rotate([0, -90, 0])
    cylinder(r=th/2, h=h);
  }

  // mount
  difference() {
    union() {
      translate([0, -28, 47.5])
      cube([39, th, 39], center=true);
    }

    // v shape
    translate([39/2, -28, 47.5-20])
    rotate([0, 45, 0])
    cube([39, th+1, 39], center=true);
    translate([-39/2, -28, 47.5-20])
    rotate([0, 45, 0])
    cube([39, th+1, 39], center=true);
    translate([0, -28, 47.5+35])
    rotate([0, 45, 0])
    cube([39, th+1, 39], center=true);

    // screw holes
    translate([15, 30, 63.5-th])
    rotate([90, 0, 0])
    cylinder(r=screw_r, h=60);
    translate([-15, 30, 63.5-th])
    rotate([90, 0, 0])
    cylinder(r=screw_r, h=60);
    
    // removing screw holes
    translate([15, -30, 63.5-th])
    cube([10, 10, 50], center=true);
    translate([-15, -30, 63.5-th])
    cube([10, 10, 50], center=true);
  }

  // mount arm
  difference() {
      translate([0, -24, 47.5-7])
      cube([th, 11, 34], center=true);

      translate([0, -24, 47.5-26])
      rotate([45, 0, 0])
      cube([th+1, 11, 30], center=true);
  }
}
//translate([0, 49, th])
//ink_well();

module battery() {
  cylinder(r=19/2, h=66.7);
  translate([19/4, 19/4, 66.7/2+5])
  cube([19/2, 19/2, 66.7], center=true);
}
// battery();

module dewalt_battery() {
    translate([-33, -60, -100])
    import("../stl/dewalt_battery_top.stl");
}
//dewalt_battery();

module dewalt_battery_mount() {
  min_width=35.2;
  max_width=51;
  height=10.5;
  sub_height=4.7;
  tab_w=9.3;
  tab_l=23.5;
  tab_gap=50;
  rail_len=27;
  conductor_gap=23;
  
  l=tab_gap+tab_w+th*4;

  translate([0.25, 5, 17.4])
  rotate([0, 180, 0])
  %dewalt_battery();

  difference() {
    translate([0, 0, (height+th)/2])
    cube([max_width+th*2, l, height+th], center=true);

    // main groove
    translate([0, th*3, th+height])
    cube([min_width, l, height], center=true);
      
    // tab hole
    translate([0, l/2-th-tab_w/2, 0])
    cube([tab_l, tab_w, th*3], center=true);
      
    // rail groove
    translate([0, th*3, th+(height-sub_height)/2])
    cube([max_width, l, height-sub_height], center=true);

    // rail cutoff
    translate([0, th*3+rail_len, th*1.5+height/2])
    cube([max_width+th*3, l, height+th], center=true);
      
    // conductor holes
    translate([conductor_gap/2, -l/2, th+height/2])
    cube([1.4, l, height-th], center=true);
    translate([-conductor_gap/2, -l/2, th+height/2])
    cube([1.4, l, height-th], center=true);
    
    translate([conductor_gap/2, -l/2, th+height/2])
    cube([5.7, th*4, height-th], center=true);
    translate([-conductor_gap/2, -l/2, th+height/2])
    cube([5.7, th*4, height-th], center=true);

    /*
    translate([24, -38, -1])
    cylinder(r=screw_r, h=30);
    translate([24, -38, th+1])
    cylinder(r=screw_r*2, h=30);
    translate([-24, -38, -1])
    cylinder(r=screw_r, h=30);
    translate([-24, -38, th+1])
    cylinder(r=screw_r*2, h=30);
    */
  }
}
//dewalt_battery_mount();

module omni_wheel() {
  difference() {
    cylinder(r=48/2, h=25.5);

    translate([0, 0, -1])
    hex(6.2, 16.3+1);
  }
}
// omni_wheel();

// GPS 16329 - GPS dead reckoning breakout board
module gps() {
  difference() {
    union() {
      translate([0, 0, 1.8/2])
      cube([33, 42, 1.8], center=true);
      translate([0, 0, 5/2])
      cube([20, 41, 5], center=true);
    }

    translate([(33-3.1-1.2)/2, (42-3.1-1.2)/2, -4])
    cylinder(r=3.1/2, h=18);
    translate([(33-3.1-1.2)/2, -(42-3.1-1.2)/2, -4])
    cylinder(r=3.1/2, h=18);
    translate([-(33-3.1-1.2)/2, (42-3.1-1.2)/2, -4])
    cylinder(r=3.1/2, h=18);
    translate([-(33-3.1-1.2)/2, -(42-3.1-1.2)/2, -4])
    cylinder(r=3.1/2, h=18);
  }

  // USB
  translate([(33-7.5)/2+1.7, (42-10)/2-6.4, 3.3/2+1.8])
  cube([7.5, 10, 3.3], center=true);
  translate([33/2+1.7, (42-10)/2-6.4, 3.3/2+1.8])
  rotate([0, 0, 180])
  %usb_micro_plug();
}
//gps();

module battery_charge_detector() {
  difference() {
    union() {
      translate([0, 0, 1.6/2])
      cube([17.2, 28.2, 1.6], center=true);
      translate([0, 0, (3-1.6)/2-1.6])
      cube([10, 26, 3], center=true);
    }
    // holes
    translate([(17.2-2.5)/2-1.4, 22.8/2, -4])
    cylinder(r=2.5/2, h=18);
    translate([(17.2-2.5)/2-1.4, -22.8/2, -4])
    cylinder(r=2.5/2, h=18);
  }

  // pins
  translate([-((17.2-2.6)/2-0.5), 0, -2.3/2])
  cube([2.6, 26, 2.9], center=true);
  translate([-((17.2-2.6)/2-0.5), 0, 11.8/2-8.2])
  cube([1, 26, 11.8], center=true);
}
//battery_charge_detector();

module usb_charge_chip() {
  difference() {
    union() {
      translate([0, 0, 1.1/2])
      cube([17.6, 28.4, 1.1], center=true);
      translate([-(17.6-15)/2+0.5, (28.4-20)/2-5.4, 2.6/2])
      cube([15, 20, 2.6], center=true);
    }
  }
  // USB
  translate([0, -(28.4-7.5)/2-1.7, 3.3/2+1.1])
  cube([10, 7.5, 3.3], center=true);
  translate([0, -28.4/2-1.7, 3.3/2+1.1])
  rotate([0, 0, 90])
  %usb_micro_plug();
}
//usb_charge_chip();

module small_voltage_regulator() {
  translate([0, 0, 13/2])
  cube([18, 3, 13], center=true);
}
//small_voltage_regulator();

module medium_voltage_regulator() {
  difference() {
    translate([0, 0, 14/2])
    cube([44, 22, 14], center=true);

    translate([4.5+3-44/2, 22/2-3-0.5, -1])
    cylinder(r=3/2, h=16);

    translate([44/2-4.5-3, 1+3-22/2, -1])
    cylinder(r=3/2, h=16);
  }
}
//medium_voltage_regulator();

module large_voltage_regulator() {
  difference() {
    translate([0, 0, 14/2])
    cube([37, 67, 14], center=true);

    translate([31.15/2, 61/2, -1])
    cylinder(r=3/2, h=18);
    translate([31.15/2, -61/2, -1])
    cylinder(r=3/2, h=18);
    translate([-31.15/2, 61/2, -1])
    cylinder(r=3/2, h=18);
    translate([-31.15/2, -61/2, -1])
    cylinder(r=3/2, h=18);
  }
}
//large_voltage_regulator();

module encoder() {
  difference() {
    cylinder(r=25.9/2, h=2.90);

    translate([0, 0, -1])
    difference() {
      cylinder(r=5.5/2, h=7.65);

      translate([0, (5.5+3.8)/2, 7.65/2])
      cube([5.5, 5.5, 7.65+1], center=true);
      translate([0, -(5.5+3.8)/2, 7.65/2])
      cube([5.5, 5.5, 7.65+1], center=true);
    }
    
    for(i=[0:360/20:360]) {
      rotate([0, 0, i])
      translate([(14.7+3.63)/2, 0, -1])
      cube([3.63, 1.4, 10], center=true);
    }
  }
}
//encoder();

module comparator_LM393() {
  difference() {
    translate([0, 0, 4.5/2])
    cube([31.2, 14.1, 4.5], center=true);
    translate([31.2/2-3-5.5, 0, -1])
    cylinder(r=3/2, h=6);
  }
  difference() {
    translate([
      -(31.2-6.1)/2+0.75, 0, 4.5+10/2
    ])
    cube([6.1, 13.15, 10], center=true);
    translate([
      -(31.2-6.1)/2+0.75,
      0,
      4.5+10/2+(3.55-1.6)
    ])
    cube([6.1+1, 4.9, 10], center=true);
  }
  translate([
    (31.2-2.7)/2-0.55, 0, 4.5+4.2/2
  ])
  cube([2.7, 10.2, 4.2], center=true);
  
  translate([
    (31.2-2.7)/2+7, 0, 4.5+4.2
  ])
  %cube([18, 10.2, 2.7], center=true);
}
//comparator_LM393();
