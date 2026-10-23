case_id = 0;
$fn = 12;

function factorial(number) = number <= 1 ? 1 : number * factorial(number - 1);
function lexical_value() = lexical_number;
function dynamic_value() = $fn;
function add_values(first, second = 3) = first + second;
lexical_number = 7;

module expressions() {
  assert(2 + 3 * 4 == 14, "arithmetic precedence");
  assert(2 ^ 3 == 8, "exponentiation");
  assert(abs(asin(0.5) - 30) < 0.000001, "degree trigonometry");
  assert((true ? 5 : 9) == 5, "conditional expression");
  echo("expressions", 2 + 3 * 4, 2 ^ 3, [sin(0), cos(0), sin(90)]);
}

module values() {
  assert(![] && !undef && !"" && !0, "false values");
  assert(!![0] && !!"value", "true values");
  assert(is_list([1, "value", true, undef]), "heterogeneous vector");
  assert(is_undef([1, 2][9]), "out of bounds indexing");
  echo("values", [false, 0, "", [], undef], [true, "value", [0]]);
}

module vectors_and_matrices() {
  assert([for (index = [0 : 3]) index * index] == [0, 1, 4, 9], "list comprehension");
  assert([for (index = [0 : 4]) if (index % 2 == 0) index] == [0, 2, 4], "filtered comprehension");
  assert([each [1, 2], each [3 : 4]] == [1, 2, 3, 4], "each expansion");
  assert([1, 2, 3] * [4, 5, 6] == 32, "dot product");
  assert([[1, 2], [3, 4]] * [5, 6] == [17, 39], "matrix vector product");
  echo("vectors", [1, 2] + [3, 4], 2 * [1, 2], [[1, 2], [3, 4]] * [[5, 6], [7, 8]]);
  echo("indexing", [[1, 2], [3, 4]][1][0], [3, 4].y, "abc"[1]);
}

module functions_and_bindings() {
  assert(factorial(5) == 120, "recursive function");
  assert(add_values(2) == 5, "default parameter");
  assert(add_values(second = 5, first = 4) == 9, "named parameters");
  assert(let(first = 2, second = first + 3) second == 5, "sequential let");
  echo("functions", factorial(5), add_values(2), add_values(second = 5, first = 4));
}

module scoping() {
  lexical_number = 99;
  $fn = 8;
  assert(lexical_value() == 7, "lexical ordinary variables");
  assert(dynamic_value() == 8, "dynamic special variables");
  echo("scoping", lexical_value(), dynamic_value());
}

module loops_and_ranges() {
  for (index = [3 : -1 : 1]) echo("range", index);
  for (first = [1, 2], second = [first]) echo("dependent loop", first, second);
}

module forward_lookup() {
  shape();
  module shape() { translate([0, 0, 2]) cube(1); }
  echo("forward lookup", twice(3));
  function twice(number) = number * 2;
}

module shifted_children(distance = 2) {
  assert($children == 1, "module child count");
  translate([distance, 0, 0]) children();
}

module geometry_and_modifiers() {
  translate([12, 0, 0]) polyhedron(points = [[0,0,0], [2,0,0], [0,2,0], [0,0,2]], faces = [[0,1,2], [0,3,1], [0,2,3], [1,3,2]]);
  color([0.3, 0.8, 0.5]) difference() {
    cube([4, 4, 2]);
    translate([2, 2, -1]) cylinder(h = 4, r = 1, $fn = 12);
  }
  translate([6, 0, 0]) shifted_children() cube(1);
  %translate([0, 0, -1]) cube([10, 5, 0.2]);
  #translate([5, 0, 0]) sphere(r = 0.5, $fn = 8);
  *cube(100);
  echo("context", $preview, $t);
}

module vector_builtins() {
  assert(cross([1, 2], [3, 4]) == -2, "2D cross product");
  assert(norm([3, 4]) == 5, "vector norm");
  assert(chr([65, 66]) == "AB" && ord("AB") == 65, "Unicode conversion");
  assert(version_num() == 20261002, "version number");
  assert(search("b", "abc") == [1], "string search");
  assert(rands(0, 1, 3, 17) == rands(0, 1, 3, 17), "seeded random sequence");
  echo("builtins", cross([1, 2], [3, 4]), norm([3, 4]), chr([65, 66]), ord("AB"), version_num() == 20261002, search("b", "abc"));
}

module experimental_roof() {
  roof() square([4, 4]);
  echo("experimental roof", 4);
}

module text_extrusion() {
  linear_extrude(height = 1) text("5", size = 4);
  echo("text extrusion", 5);
}

module imported_json() {
  data = import("language_features_data.json");
  assert(data.name == "reference" && data.size == 2, "JSON import");
  echo("JSON import", data.name, data.size, data.values);
  cube(data.size);
}

if (case_id == 0 || case_id == 1) expressions();
if (case_id == 0 || case_id == 2) values();
if (case_id == 0 || case_id == 3) vectors_and_matrices();
if (case_id == 0 || case_id == 4) functions_and_bindings();
if (case_id == 0 || case_id == 5) scoping();
if (case_id == 0 || case_id == 6) loops_and_ranges();
if (case_id == 0 || case_id == 7) forward_lookup();
if (case_id == 0 || case_id == 8) geometry_and_modifiers();
if (case_id == 0 || case_id == 9) vector_builtins();
if (case_id == 10) experimental_roof();
if (case_id == 11) text_extrusion();
if (case_id == 12) imported_json();