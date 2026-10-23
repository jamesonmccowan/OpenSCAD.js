case_id = 1;
$fn = 12;

if (case_id == 1) {
  linear_extrude(height = 1) text("5", size = 4);
  echo("text extrusion", 5);
}

if (case_id == 2) {
  data = import("language_features_data.json");
  assert(data.name == "reference" && data.size == 2, "JSON import");
  echo("JSON import", data.name, data.size, data.values);
  cube(data.size);
}