// Two perpendicular square tunnels at different heights, separated by a web.
side = 24;
opening = 8;
offset = 5;

color("#168fe5")
difference() {
    cube(side, center=true);
    cube([side*2, side/2, side/2], center=true);
    cube([side/2, side*2, side/2], center=true);
    %cube([side/2, side*1.75, side/2], center=true);
    cube([side/2, side/2, side*2], center=true);
}
