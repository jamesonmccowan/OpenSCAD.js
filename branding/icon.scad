// Three centered square tunnels intersect along the cube's principal axes.
side = 24;
opening = side / 2;

color("#168fe5")
difference() {
    cube(side, center=true);
    cube([side * 2, opening, opening], center=true);
    cube([opening, side * 2, opening], center=true);
    cube([opening, opening, side * 2], center=true);
}
