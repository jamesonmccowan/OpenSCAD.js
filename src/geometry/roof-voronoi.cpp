#include <boost/polygon/voronoi.hpp>
#include <boost/polygon/segment_data.hpp>
#include <emscripten/bind.h>
#include <cstdint>
#include <stdexcept>
#include <unordered_map>
#include <vector>

emscripten::val diagram(const emscripten::val& coordinates)
{
    using namespace boost::polygon;
    using Diagram = voronoi_diagram<double>;
    std::vector<segment_data<std::int32_t>> segments;
    const unsigned length = coordinates["length"].as<unsigned>();
    if (length % 4 || length > 40000) throw std::invalid_argument("Invalid roof segment count");
    for (unsigned index = 0; index < length; index += 4) {
        segments.emplace_back(point_data<std::int32_t>(coordinates[index].as<std::int32_t>(), coordinates[index + 1].as<std::int32_t>()),
                              point_data<std::int32_t>(coordinates[index + 2].as<std::int32_t>(), coordinates[index + 3].as<std::int32_t>()));
    }
    Diagram graph;
    construct_voronoi(segments.begin(), segments.end(), &graph);
    std::unordered_map<const Diagram::edge_type*, unsigned> identifiers;
    unsigned identifier = 0;
    for (const auto& edge : graph.edges()) {
        if (!identifiers.count(&edge)) {
            identifiers[&edge] = identifier;
            identifiers[edge.twin()] = identifier++;
        }
    }
    auto cells = emscripten::val::array();
    for (const auto& cell : graph.cells()) {
        if (cell.is_degenerate()) continue;
        auto result = emscripten::val::object();
        result.set("source", cell.source_index());
        result.set("category", static_cast<unsigned>(cell.source_category()));
        result.set("segment", cell.contains_segment());
        auto edges = emscripten::val::array();
        const auto* edge = cell.incident_edge();
        do {
            if (edge->is_finite()) {
                auto vertices = emscripten::val::array();
                vertices.call<void>("push", identifiers.at(edge), edge->vertex0()->x(), edge->vertex0()->y(), edge->vertex1()->x(), edge->vertex1()->y(),
                                    edge->twin()->cell()->source_index(), static_cast<unsigned>(edge->twin()->cell()->source_category()),
                                    edge->twin()->cell()->contains_segment(), edge->is_curved());
                edges.call<void>("push", vertices);
            }
            edge = edge->next();
        } while (edge != cell.incident_edge());
        result.set("edges", edges);
        cells.call<void>("push", result);
    }
    return cells;
}

EMSCRIPTEN_BINDINGS(roof_voronoi)
{
    emscripten::function("diagram", &diagram);
}