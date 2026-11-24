#include "batch.hpp"
#include "columns.hpp"
#include "presets.hpp"

#include <cmath>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <limits>
#include <ostream>
#include <sstream>
#include <stdexcept>
#include <type_traits>

namespace vs {

namespace {

constexpr double INF = std::numeric_limits<double>::infinity();

struct Metrics {
    bool   collided = false;
    double d_min = INF;              // m   (leader on lane)
    double es_max = 0.0;             // m   max |e_s| with a valid target
    double t_settle = 0.0;           // s   last time |e_s| > 0.5 m (target valid)
    double jump_max = 0.0;           // m/s2 max |a_des jump| at a mode/target change (C5)
    double a_min = INF, a_max = -INF;// m/s2 actual acceleration range
    double ades_min = INF, ades_max = -INF;
    double v_end = 0.0, d_end = 0.0;
    double E_wheel = 0.0;            // J   positive traction work at the wheels
    double E_bat = 0.0;              // J   (EV) net battery energy
    double i_ratio_max = 0.0;        // -   (EV) max |i_a| / i_lim (C4)
    double Fb_max_seen = 0.0;        // N
    bool   clutch_opened = false;    // ICE
};

template <class Car>
void sample(const Params& p, const Lane<Car>& L, Metrics& m, int& prev_mode, bool& prev_target,
            double& prev_ades) {
    const auto& car = L.car();
    const auto& o = L.ctrl().out();
    const double t = L.t();

    if (L.collided()) m.collided = true;
    if (L.leader_on_lane()) m.d_min = std::min(m.d_min, L.d());
    if (L.target()) {
        m.es_max = std::max(m.es_max, std::fabs(o.e_s));
        if (std::fabs(o.e_s) > 0.5) m.t_settle = t;
    }
    // a_des only changes on controller ticks; a jump at a mode/target change is C5
    if (o.mode != prev_mode || L.target() != prev_target)
        m.jump_max = std::max(m.jump_max, std::fabs(L.a_des() - prev_ades));
    prev_mode = o.mode;
    prev_target = L.target();
    prev_ades = L.a_des();

    m.a_min = std::min(m.a_min, car.out().a);
    m.a_max = std::max(m.a_max, car.out().a);
    m.ades_min = std::min(m.ades_min, L.a_des());
    m.ades_max = std::max(m.ades_max, L.a_des());
    m.E_wheel += std::max(car.out().F_t, 0.0) * car.v() * car.dt();
    m.Fb_max_seen = std::max(m.Fb_max_seen, car.state()[Car::FB]);
    m.v_end = car.v();
    m.d_end = L.d();

    if constexpr (std::is_same_v<Car, EvVehicle>) {
        const double lim = p.ev.i_lim(car.v(), p.lim.P_max);
        m.i_ratio_max = std::max(m.i_ratio_max, std::fabs(car.state()[EvVehicle::IA]) / lim);
        m.E_bat = car.state()[EvVehicle::EBAT];
    } else {
        if (!car.engaged()) m.clutch_opened = true;
    }
}

template <class Car>
Metrics run_one(const Params& p, const std::string& tag, const std::string& file) {
    Lane<Car> L(p, tag);
    L.reset();

    std::FILE* f = nullptr;
    if (!file.empty()) {
        f = std::fopen(file.c_str(), "w");
        if (!f) throw std::runtime_error("cannot write " + file);
        NameSink names;
        names("t", 0.0);
        names.prefix = tag + "_";
        emit(names, L);
        std::fprintf(f, "# vehicle_sim batch output v1\n# vehicles = %s\n# scenario = %s\n"
                        "# period = %.9g\n# L_veh = %.9g\n%s\n",
                     tag.c_str(), p.scn.preset.c_str(), p.out.period, p.lead.L_veh,
                     names.line.c_str());
    }
    auto write = [&]() {
        if (!f) return;
        ValueSink v;
        v("t", L.t());
        emit(v, L);
        std::fprintf(f, "%s\n", v.line.c_str());
    };

    Metrics m;
    int prev_mode = L.ctrl().out().mode;
    bool prev_target = L.target();
    double prev_ades = 0.0;
    const int n_out = std::is_same_v<Car, EvVehicle> ? p.disc.n_out_ev : p.disc.n_out_ice;

    write();
    long n = 0;
    while (L.t() < p.sim.duration - 1e-9) {
        L.step();
        sample(p, L, m, prev_mode, prev_target, prev_ades);
        if (++n % n_out == 0) write();
    }
    if (f) std::fclose(f);
    return m;
}

std::string fmt(double v, int prec = 2) {
    if (std::isinf(v)) return "-";
    std::ostringstream os;
    os << std::fixed << std::setprecision(prec) << v;
    return os.str();
}

} // namespace

int run_batch(const Params& base, const std::vector<std::string>& presets_in,
              const std::string& out_dir, std::ostream& os) {
    const std::vector<std::string> presets = presets_in.empty() ? preset_names() : presets_in;
    if (!out_dir.empty()) std::filesystem::create_directories(out_dir);

    struct Row { std::string scn, car; Metrics m; std::string verdict; };
    std::vector<Row> rows;
    int fails = 0;

    for (const auto& name : presets) {
        Params p = base;
        if (!apply_preset(name, p.scn, p.sim.duration))
            throw std::runtime_error("unknown preset " + name);

        for (const std::string car : {"ice", "ev"}) {
            if (p.sim.vehicle != "both" && p.sim.vehicle != car) continue;
            const std::string file =
                out_dir.empty() ? "" : out_dir + "/" + name + "_" + car + ".txt";
            const Metrics m = car == "ice" ? run_one<IceVehicle>(p, car, file)
                                           : run_one<EvVehicle>(p, car, file);

            // criteria (§12.10)
            std::string bad;
            if (m.collided) bad += "C3 ";
            const double tol = 1e-9;
            if (m.ades_min < p.lim.a_min - tol || m.ades_max > p.lim.a_max + tol) bad += "C4a ";
            if (m.i_ratio_max > 1.05) bad += "C4i ";
            if (m.Fb_max_seen > p.brk.Fb_max + tol) bad += "C4b ";
            // C5 applies to mode switches that are not cut-ins (S6 is a real
            // emergency: a large a_des change is the expected response)
            if (name != "S6" && m.jump_max > 0.1) bad += "C5 ";
            if (!bad.empty()) ++fails;
            rows.push_back({name, car, m, bad.empty() ? "OK" : "FAIL " + bad});
        }
    }

    // ---- summary table
    std::ostringstream t;
    t << std::left << std::setw(4) << "scn" << std::setw(5) << "car" << std::right
      << std::setw(9) << "d_min" << std::setw(9) << "d_end" << std::setw(9) << "|e_s|max"
      << std::setw(9) << "t_settle" << std::setw(8) << "jumpC5" << std::setw(8) << "a_min"
      << std::setw(8) << "a_max" << std::setw(8) << "v_end" << std::setw(9) << "Fb_max"
      << std::setw(8) << "|i|/lim" << std::setw(10) << "E_wh_kWh" << std::setw(10) << "E_bat_kWh"
      << "  verdict\n";
    for (const auto& r : rows) {
        const auto& m = r.m;
        t << std::left << std::setw(4) << r.scn << std::setw(5) << r.car << std::right
          << std::setw(9) << fmt(m.d_min) << std::setw(9) << (std::isinf(m.d_min) ? "-" : fmt(m.d_end))
          << std::setw(9) << fmt(m.es_max) << std::setw(9) << fmt(m.t_settle, 1)
          << std::setw(8) << fmt(m.jump_max, 3) << std::setw(8) << fmt(m.a_min)
          << std::setw(8) << fmt(m.a_max) << std::setw(8) << fmt(m.v_end)
          << std::setw(9) << fmt(m.Fb_max_seen, 0)
          << std::setw(8) << (r.car == "ev" ? fmt(m.i_ratio_max, 3) : "-")
          << std::setw(10) << fmt(m.E_wheel / 3.6e6, 4)
          << std::setw(10) << (r.car == "ev" ? fmt(m.E_bat / 3.6e6, 4) : "-")
          << "  " << r.verdict << (m.clutch_opened ? " (clutch opened)" : "") << "\n";
    }
    t << "\nd_min/d_end: gap to leader [m]; |e_s|max, t_settle: spacing error and last time "
         "|e_s| > 0.5 m (target valid);\njumpC5: max |a_des| change at a mode/target switch "
         "[m/s2] (C5 <= 0.1, not applied to S6 cut-in);\nE_wh: positive traction work at the "
         "wheels; E_bat: net battery energy (EV, regen included).\n";
    t << (fails == 0 ? "== batch: all criteria OK\n"
                     : "== batch: " + std::to_string(fails) + " run(s) FAILED\n");

    os << t.str();
    if (!out_dir.empty()) {
        std::ofstream(out_dir + "/summary.txt") << t.str();
        os << "files: " << out_dir << "/<scenario>_<car>.txt, " << out_dir << "/summary.txt\n";
    }
    return fails;
}

} // namespace vs