#include "tests.hpp"
#include "ev_vehicle.hpp"
#include "ice_vehicle.hpp"
#include "lane.hpp"

#include <cmath>
#include <iomanip>
#include <sstream>
#include <ostream>
#include <string>
#include <vector>

namespace vs {

namespace {

struct Checker {
    std::ostream& os;
    int fails = 0;
    // pass if |got - ref| <= atol + rtol*|ref|
    void operator()(const std::string& name, double got, double ref,
                    double rtol, double atol = 0.0) {
        const bool ok = std::fabs(got - ref) <= atol + rtol * std::fabs(ref);
        if (!ok) ++fails;
        os << "  " << (ok ? "OK  " : "FAIL") << "  " << std::left << std::setw(34) << name
           << std::right << std::fixed << std::setprecision(4) << std::setw(12) << got
           << "   doc " << std::setw(10) << ref << std::defaultfloat << "\n";
    }
};

// Times (after the step) when the acceleration first reaches 10/63/90 % of a_des.
struct RiseTimes { double t10 = -1, t63 = -1, t90 = -1; };

template <class Vehicle>
RiseTimes step_response(Vehicle& car, double a_step, double t_step, double t_end) {
    RiseTimes r;
    while (car.t() < t_end - 1e-12) {
        const double a_des = car.t() >= t_step - 1e-12 ? a_step : 0.0;
        car.step(a_des);
        if (car.t() <= t_step) continue;
        const double frac = car.out().a / a_step;     // works for both signs
        const double ts = car.t() - t_step;
        if (r.t10 < 0 && frac >= 0.10) r.t10 = ts;
        if (r.t63 < 0 && frac >= 0.63) r.t63 = ts;
        if (r.t90 < 0 && frac >= 0.90) r.t90 = ts;
    }
    return r;
}

} // namespace

int test_ice(const Params& p, std::ostream& os) {
    Checker ck{os};

    // ---------------------------------------------------- 1) trim + drift (§6.2, C2)
    os << "-- ICE trim and drift over 10 s at a_des = 0 (§6.2, criterion C2)\n";
    struct TrimRef { double v0, pm_kPa, theta_deg; };
    const std::vector<TrimRef> trims = {
        {10, 22.51, 10.5}, {20, 33.17, 18.0}, {30, 49.00, 26.9}, {40, 70.01, 38.7}};
    for (const auto& r : trims) {
        IceVehicle car(p);
        car.trim(r.v0);
        const std::string tag = "v0=" + std::to_string(int(r.v0)) + " ";
        ck(tag + "p_m [kPa]", car.state()[IceVehicle::PM] / 1e3, r.pm_kPa, 2e-3);
        ck(tag + "theta_th [deg]", car.out().ll.theta_th * 180.0 / PI, r.theta_deg, 0, 0.06);
        while (car.t() < 10.0 - 1e-12) car.step(0.0);
        ck(tag + "|v drift| 10 s [m/s]", std::fabs(car.v() - r.v0), 0.0, 0, 1e-3);
    }

    // ---------------------------------------------------- 2) step responses at 30 m/s (§6.4)
    os << "-- ICE step responses from 30 m/s, step at t = 0.2 s (§6.4)\n";
    struct StepRef { double a, t10, t63, t90; };
    const std::vector<StepRef> steps = {
        {+0.3, 0.066, 0.114, 0.185}, {-0.3, 0.066, 0.114, 0.185}, {-1.0, 0.069, 0.128, 0.210}};
    for (const auto& s : steps) {
        IceVehicle car(p);
        car.trim(30.0);
        const RiseTimes r = step_response(car, s.a, 0.2, 2.2);
        std::ostringstream tag;
        tag << "a=" << std::showpos << s.a << std::noshowpos << " ";
        ck(tag.str() + "t10 [s]", r.t10, s.t10, 0, 0.004);
        ck(tag.str() + "t63 [s]", r.t63, s.t63, 0, 0.004);
        ck(tag.str() + "t90 [s]", r.t90, s.t90, 0, 0.004);
        // final value: within 0.5 % of a_des at t = 2 s after the step
        ck(tag.str() + "a(2 s)/a_des", car.out().a / s.a, 1.0, 0, 0.005);
    }

    // ---------------------------------------------------- 3) t63 vs speed (§6.4)
    os << "-- ICE t63 vs speed, step +0.3 m/s2 (60 ms + tau_m(v))\n";
    const std::vector<std::pair<double, double>> t63ref = {
        {10, 0.222}, {20, 0.141}, {30, 0.114}, {40, 0.100}};
    for (const auto& [v0, ref] : t63ref) {
        IceVehicle car(p);
        car.trim(v0);
        const RiseTimes r = step_response(car, 0.3, 0.2, 1.5);
        ck("v0=" + std::to_string(int(v0)) + " t63 [s]", r.t63, ref, 0, 0.004);
    }

    // ---------------------------------------------------- 4) AEB -0.5 g (§6.4)
    os << "-- ICE emergency braking -0.5 g from 30 m/s, step at t = 0.2 s (§6.4)\n";
    {
        IceVehicle car(p);
        car.trim(30.0);
        const double a_step = p.lim.a_min;
        double Fb_max_seen = 0.0;
        struct Probe { double t, ref; double got = 0; };
        std::vector<Probe> probes = {{0.3, -1.67}, {0.5, -4.65}, {1.0, -4.89}, {2.0, -4.89}};
        while (car.t() < 2.0 - 1e-12) {
            car.step(car.t() >= 0.2 - 1e-12 ? a_step : 0.0);
            Fb_max_seen = std::max(Fb_max_seen, car.state()[IceVehicle::FB]);
            for (auto& pr : probes)
                if (std::fabs(car.t() - pr.t) < 0.5 * car.dt()) pr.got = car.out().a;
        }
        for (const auto& pr : probes) {
            std::ostringstream tag;
            tag << "a(t=" << pr.t << " s) [m/s2]";
            ck(tag.str(), pr.got, pr.ref, 0, 0.06);
        }
        // Doc §6.4 gives max F_b = 8994 N without stating the horizon; F_b keeps
        // growing as v drops (engine brake and drag shrink). Check instead that
        // the brake has settled on its command (quasi-static blending, §10.2).
        const double Fb_cmd = car.out().ll.Fb_cmd;
        ck("F_b(2 s) / F_b,cmd", car.state()[IceVehicle::FB] / Fb_cmd, 1.0, 0, 0.01);
        os << "  info  max F_b over 2 s = " << std::fixed << std::setprecision(0)
           << Fb_max_seen << " N (doc 8994 N, horizon not stated), v(2 s) = "
           << std::setprecision(2) << car.v() << " m/s" << std::defaultfloat << "\n";
    }

    os << (ck.fails == 0 ? "== ICE test: all OK\n"
                         : "== ICE test: " + std::to_string(ck.fails) + " FAILURE(S)\n");
    return ck.fails;
}

int test_ev(const Params& p, std::ostream& os) {
    Checker ck{os};

    // ---------------------------------------------------- 1) trim + drift (§6.2, C2)
    os << "-- EV trim and drift over 10 s at a_des = 0 (§6.2, criterion C2)\n";
    struct TrimRef { double v0, i_a, D; };
    const std::vector<TrimRef> trims = {
        {10, 46.55, 0.214}, {20, 74.40, 0.426}, {30, 120.82, 0.640}, {40, 185.81, 0.857}};
    for (const auto& r : trims) {
        EvVehicle car(p);
        car.trim(r.v0);
        const std::string tag = "v0=" + std::to_string(int(r.v0)) + " ";
        ck(tag + "i_a [A]", car.state()[EvVehicle::IA], r.i_a, 2e-3);
        ck(tag + "D", car.out().D, r.D, 0, 6e-4);
        while (car.t() < 10.0 - 1e-12) car.step(0.0);
        ck(tag + "|v drift| 10 s [m/s]", std::fabs(car.v() - r.v0), 0.0, 0, 1e-3);
    }
    {
        EvVehicle car(p);                 // E6: start from standstill is allowed
        car.trim(0.0);
        while (car.t() < 2.0 - 1e-12) car.step(1.0);
        ck("start from 0, a_des=1: v(2 s) [m/s]", car.v(), 2.0, 0, 0.02);
    }

    // ---------------------------------------------------- 2) step responses at 30 m/s (§6.4)
    os << "-- EV step responses from 30 m/s, step at t = 0.2 s (§6.4)\n";
    struct StepRef { double a, t10, t63, t90; };
    const std::vector<StepRef> steps = {
        {+0.3, 0.0002, 0.0016, 0.0038}, {-0.3, 0.0002, 0.0016, 0.0038},
        {-1.0, 0.0002, 0.0018, 0.0038}};
    for (const auto& s : steps) {
        EvVehicle car(p);
        car.trim(30.0);
        const RiseTimes r = step_response(car, s.a, 0.2, 2.2);
        std::ostringstream tag;
        tag << "a=" << std::showpos << s.a << std::noshowpos << " ";
        ck(tag.str() + "t10 [s]", r.t10, s.t10, 0, 0.0004);
        ck(tag.str() + "t63 [s]", r.t63, s.t63, 0, 0.0004);
        ck(tag.str() + "t90 [s]", r.t90, s.t90, 0, 0.0004);
        ck(tag.str() + "a(2 s)/a_des", car.out().a / s.a, 1.0, 0, 1e-3);
        ck(tag.str() + "F_b stays 0 [N]", car.state()[EvVehicle::FB], 0.0, 0, 1e-6);
    }

    // ---------------------------------------------------- 3) AEB -0.5 g (§6.4)
    os << "-- EV emergency braking -0.5 g from 30 m/s, step at t = 0.2 s (§6.4)\n";
    {
        EvVehicle car(p);
        car.trim(30.0);
        double Fb_max_seen = 0.0, i_min_seen = 0.0;
        struct Probe { double t, ref; double got = 0; };
        std::vector<Probe> probes = {{0.3, -2.95}, {0.5, -4.73}, {1.0, -4.89}, {2.0, -4.89}};
        while (car.t() < 2.0 - 1e-12) {
            car.step(car.t() >= 0.2 - 1e-12 ? p.lim.a_min : 0.0);
            Fb_max_seen = std::max(Fb_max_seen, car.state()[EvVehicle::FB]);
            i_min_seen  = std::min(i_min_seen, car.state()[EvVehicle::IA]);
            for (auto& pr : probes)
                if (std::fabs(car.t() - pr.t) < 0.5 * car.dt()) pr.got = car.out().a;
        }
        for (const auto& pr : probes) {
            std::ostringstream tag;
            tag << "a(t=" << pr.t << " s) [m/s2]";
            ck(tag.str(), pr.got, pr.ref, 0, 0.06);
        }
        ck("min i_a (regen limit) [A]", i_min_seen, -p.ev.i_max, 0, 2.0);
        ck("F_b(2 s) / F_b,cmd", car.state()[EvVehicle::FB] / car.out().ll.Fb_cmd, 1.0, 0, 0.01);
        os << "  info  max F_b over 2 s = " << std::fixed << std::setprecision(0)
           << Fb_max_seen << " N (doc 6578 N, horizon not stated), v(2 s) = "
           << std::setprecision(2) << car.v() << " m/s" << std::defaultfloat << "\n";
    }

    // ---------------------------------------------------- 4) energy balance (§6.6, C6)
    os << "-- EV energy balance, 30 m/s, step +0.3 at t = 0.2 s, 3 s (§6.6, C6)\n";
    {
        EvVehicle car(p);
        car.trim(30.0);
        while (car.t() < 3.0 - 1e-12) car.step(car.t() >= 0.2 - 1e-12 ? 0.3 : 0.0);
        const auto& x = car.state();
        const double E_ind = 0.5 * p.ev.L_a * (x[EvVehicle::IA] * x[EvVehicle::IA] -
                                               car.i_a0() * car.i_a0());
        ck("E_bat [J]",   x[EvVehicle::EBAT], 157648.0, 5e-3);
        ck("E_joule [J]", x[EvVehicle::EJ],   6033.7,   5e-3);
        ck("E_mech [J]",  x[EvVehicle::EM],   151600.3, 5e-3);
        ck("E_inductance [J]", E_ind,         14.2,     0, 0.5);
        ck("|residual| / E_bat", std::fabs(car.energy_residual()) / x[EvVehicle::EBAT],
           0.0, 0, 1e-4);
    }

    os << (ck.fails == 0 ? "== EV test: all OK\n"
                         : "== EV test: " + std::to_string(ck.fails) + " FAILURE(S)\n");
    return ck.fails;
}

// ============================================================== closed loop
namespace {

ScenarioParams base_scenario() {
    ScenarioParams s{};
    s.preset = "custom";
    s.v_set_step_time = -1;  s.leader_present = false;
    s.d_init = -1;           s.lead_accel = 0.0;   s.lead_accel_start = 0.0;
    s.target_appear_time = -1; s.target_lost_time = -1;
    return s;
}

// T0-type test: v_set step of +dv at t = 5 s from trim v0; returns overshoot %.
template <class Car>
double overshoot_pct(const Params& base, double v0, double dv, double t_end, double& v_end) {
    Params p = base;
    p.scn = base_scenario();
    p.scn.v0 = v0;  p.scn.v_set = v0;
    p.scn.v_set_step_time = 5.0;  p.scn.v_set_step_value = v0 + dv;
    Lane<Car> lane(p, "t0");
    lane.reset();
    double v_max = v0;
    while (lane.t() < t_end - 1e-12) {
        lane.step();
        v_max = std::max(v_max, lane.car().v());
    }
    v_end = lane.car().v();
    return 100.0 * (v_max - (v0 + dv)) / dv;
}

struct FollowResult { double e_s, a_des, v, d_min; int mode; bool collided; };

template <class Car>
FollowResult follow_run(const Params& base, const ScenarioParams& s, double t_end) {
    Params p = base;
    p.scn = s;
    Lane<Car> lane(p, "follow");
    lane.reset();
    while (lane.t() < t_end - 1e-12) lane.step();
    const auto& o = lane.ctrl().out();
    return {o.e_s, o.a_des, lane.car().v(), lane.d_min(), o.mode, lane.collided()};
}

} // namespace

int test_loop(const Params& p, std::ostream& os) {
    Checker ck{os};

    // ---------------------------------------------- T0: linearity (§12.6, C1)
    os << "-- T0 cruise step v_set +0.5 m/s at t = 5 s, ideal sensors (§12.6, C1 +/-10 %)\n";
    {
        double v_end = 0.0;
        const double D_ev = overshoot_pct<EvVehicle>(p, 30.0, 0.5, 40.0, v_end);
        ck("EV  v0=30 overshoot [%]", D_ev, 16.4, 0.10);
        ck("EV  v0=30 v(40 s) [m/s]", v_end, 30.5, 0, 0.01);
        struct Ref { double v0, D; };
        for (const Ref& r : {Ref{10, 19.2}, Ref{20, 18.0}, Ref{30, 17.6}, Ref{40, 17.4}}) {
            const double D = overshoot_pct<IceVehicle>(p, r.v0, 0.5, 40.0, v_end);
            const std::string tag = "ICE v0=" + std::to_string(int(r.v0)) + " ";
            ck(tag + "overshoot [%]", D, r.D, 0.10);
            ck(tag + "v(40 s) [m/s]", v_end, r.v0 + 0.5, 0, 0.01);
        }
    }

    // ---------------------------------------------- S2: steady following
    os << "-- S2 steady following: v = v_lead = 25, d = d0 + h*v, v_set = 30, 60 s\n";
    {
        ScenarioParams s = base_scenario();
        s.v0 = 25; s.v_set = 30; s.leader_present = true; s.v_lead0 = 25;
        for (int k = 0; k < 2; ++k) {
            const FollowResult r = k == 0 ? follow_run<IceVehicle>(p, s, 60.0)
                                          : follow_run<EvVehicle>(p, s, 60.0);
            const std::string tag = k == 0 ? "ICE " : "EV  ";
            ck(tag + "mode = FOLLOW", r.mode, UpperController::FOLLOW, 0, 0);
            ck(tag + "e_s(60 s) [m]", r.e_s, 0.0, 0, 0.01);
            ck(tag + "a_des(60 s) [m/s2]", r.a_des, 0.0, 0, 1e-3);
        }
    }

    // ---------------------------------------------- S3: leader slows 30 -> 20
    os << "-- S3 leader -1 m/s2 from t = 10 s, 30 -> 20 m/s, 60 s (C3)\n";
    {
        ScenarioParams s = base_scenario();
        s.v0 = 30; s.v_set = 30; s.leader_present = true; s.v_lead0 = 30;
        s.lead_accel = -1.0; s.lead_accel_start = 10.0; s.lead_v_target = 20.0;
        for (int k = 0; k < 2; ++k) {
            const FollowResult r = k == 0 ? follow_run<IceVehicle>(p, s, 60.0)
                                          : follow_run<EvVehicle>(p, s, 60.0);
            const std::string tag = k == 0 ? "ICE " : "EV  ";
            ck(tag + "no collision", r.collided ? 1.0 : 0.0, 0.0, 0, 0);
            ck(tag + "v(60 s) [m/s]", r.v, 20.0, 0, 0.05);
            ck(tag + "e_s(60 s) [m]", r.e_s, 0.0, 0, 0.1);
            os << "  info  " << tag << "d_min = " << std::fixed << std::setprecision(2)
               << r.d_min << " m (d_ref at 20 m/s = " << p.ctrl.d0 + p.ctrl.h * 20.0
               << " m)" << std::defaultfloat << "\n";
        }
    }

    os << (ck.fails == 0 ? "== loop test: all OK\n"
                         : "== loop test: " + std::to_string(ck.fails) + " FAILURE(S)\n");
    return ck.fails;
}

} // namespace vs