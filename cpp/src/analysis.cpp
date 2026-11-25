#include "analysis.hpp"
#include "ev_vehicle.hpp"
#include "ice_vehicle.hpp"
#include "lane.hpp"
#include "presets.hpp"
#include "upper_controller.hpp"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <complex>
#include <exception>
#include <functional>
#include <iomanip>
#include <iterator>
#include <limits>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <thread>
#include <type_traits>
#include <vector>

namespace vs {

namespace {

constexpr double NaN = std::numeric_limits<double>::quiet_NaN();
constexpr double INF = std::numeric_limits<double>::infinity();
using cplx = std::complex<double>;

// ============================================================================ JSON writer
class Json {
public:
    explicit Json(std::ostream& os) : os_(os) { os_ << std::setprecision(6); }
    void obj()     { prefix(); os_ << '{'; first_.push_back(true); }
    void end_obj() { os_ << '}'; first_.pop_back(); }
    void arr()     { prefix(); os_ << '['; first_.push_back(true); }
    void end_arr() { os_ << ']'; first_.pop_back(); }
    void key(const std::string& k) { comma(); quote(k); os_ << ':'; after_key_ = true; }
    void num(double v) { prefix(); if (std::isfinite(v)) os_ << v; else os_ << "null"; }
    void str(const std::string& s) { prefix(); quote(s); }
    void boolean(bool b) { prefix(); os_ << (b ? "true" : "false"); }
    // key + value helpers
    void kn(const std::string& k, double v)             { key(k); num(v); }
    void ks(const std::string& k, const std::string& v) { key(k); str(v); }
    void kb(const std::string& k, bool v)               { key(k); boolean(v); }
    void kv(const std::string& k, const std::vector<double>& v) {
        key(k); arr(); for (double x : v) num(x); end_arr();
    }
private:
    void comma() {
        if (first_.empty()) return;
        if (!first_.back()) os_ << ',';
        first_.back() = false;
    }
    void prefix() { if (after_key_) { after_key_ = false; return; } comma(); }
    void quote(const std::string& s) {
        os_ << '"';
        for (char c : s) {
            if (c == '"' || c == '\\') os_ << '\\' << c;
            else if (c == '\n') os_ << "\\n";
            else os_ << c;
        }
        os_ << '"';
    }
    std::ostream& os_;
    std::vector<bool> first_;
    bool after_key_ = false;
};

// ============================================================================ helpers
double arg(const Args& a, const std::string& k, double def) {
    const auto it = a.find(k);
    if (it == a.end() || it->second.empty()) return def;
    try { return std::stod(it->second); }
    catch (...) { throw std::runtime_error("argument " + k + " must be a number"); }
}
std::string sarg(const Args& a, const std::string& k, const std::string& def) {
    const auto it = a.find(k);
    return it == a.end() || it->second.empty() ? def : it->second;
}
std::vector<double> linspace(double a, double b, int n) {
    std::vector<double> v(std::max(n, 1));
    for (int i = 0; i < (int)v.size(); ++i) v[i] = n <= 1 ? a : a + (b - a) * i / (n - 1);
    return v;
}
std::vector<double> logspace(double a, double b, int n) {
    std::vector<double> v = linspace(std::log10(a), std::log10(b), n);
    for (double& x : v) x = std::pow(10.0, x);
    return v;
}

// Runs f(0..n-1) on all cores. Exceptions are re-thrown in the caller.
void parallel_for(std::size_t n, const std::function<void(std::size_t)>& f) {
    if (n == 0) return;
    const std::size_t nt = std::min<std::size_t>(std::max(1u, std::thread::hardware_concurrency()), n);
    std::atomic<std::size_t> next{0};
    std::exception_ptr err;
    std::mutex mu;
    std::vector<std::thread> th;
    for (std::size_t i = 0; i < nt; ++i)
        th.emplace_back([&] {
            for (;;) {
                const std::size_t k = next++;
                if (k >= n) break;
                try { f(k); }
                catch (...) { std::lock_guard<std::mutex> l(mu); if (!err) err = std::current_exception(); }
            }
        });
    for (auto& t : th) t.join();
    if (err) std::rethrow_exception(err);
}

// A scenario with nothing happening: ego at v0, no leader, no steps.
ScenarioParams quiet(const ScenarioParams& base, double v0) {
    ScenarioParams s = base;
    s.preset = "custom";
    s.v0 = v0; s.v_set = v0;
    s.v_set_step_time = -1.0; s.v_set_step_value = v0;
    s.leader_present = false; s.v_lead0 = v0; s.d_init = -1.0;
    s.lead_accel = 0.0; s.lead_accel_start = 0.0; s.lead_v_target = v0;
    s.target_appear_time = -1.0; s.target_lost_time = -1.0;
    return s;
}

// Params for analysis runs: a lane stops at the first contact (faster solvers).
Params base_params(const Params& p) {
    Params q = p;
    q.sim.stop_on_collision = true;
    return q;
}

// ============================================================================ ideal plant
// Same upper controller and scenario logic, but the car does exactly a = a_des
// (no lower level, no delays, no lags). Comparing with it shows what the plant
// adds to the closed-loop behaviour.
class IdealLane {
public:
    IdealLane(const Params& p, std::string)
        : p_(p), scn_(p.scn), ctrl_(p.ctrl, p.lim, p.sim.Ts_ctrl) {}

    void reset() {
        const auto& s = p_.scn;
        scn_.reset();
        t_ = 0.0; x_ = 0.0; v_ = s.v0; a_ = 0.0; a_des_ = 0.0; n_ = 0;
        N_ = std::max(1L, static_cast<long>(std::llround(p_.sim.Ts_ctrl / DT)));
        const double d0 = s.d_init >= 0.0 ? s.d_init : p_.ctrl.d_ref(s.v0);
        lead_.reset(d0 + p_.lead.L_veh, s.v_lead0);
        ctrl_.reset(0.0);
        collided_ = false;
        d_min_ = INF;
        update_target();
    }
    void step() {
        if (collided_) { t_ += DT; return; }
        if (scn_.cut_in_now(t_))
            lead_.reset(x_ + p_.lead.L_veh + scn_.params().cutin_distance, scn_.params().v_lead0);
        if (n_ % N_ == 0) {
            update_target();
            UpperController::Inputs in;
            in.v = v_; in.d = d(); in.v_lead = lead_.v; in.target = target_;
            in.v_set = scn_.v_set(t_);
            a_des_ = ctrl_.update(in).a_des;
        }
        lead_.step(scn_.a_lead(t_, lead_.v), DT);
        a_ = (v_ <= 0.0 && a_des_ < 0.0) ? 0.0 : a_des_;
        x_ += v_ * DT + 0.5 * a_ * DT * DT;
        v_ = std::max(0.0, v_ + a_ * DT);
        t_ += DT; ++n_;
        if (scn_.leader_on_lane(t_)) {
            d_min_ = std::min(d_min_, d());
            if (d() <= 0.0) collided_ = true;
        }
    }
    double t() const { return t_; }
    double v() const { return v_; }
    double a() const { return a_; }
    double a_des() const { return a_des_; }
    double d() const { return lead_.x - x_ - p_.lead.L_veh; }
    bool target() const { return target_; }
    bool collided() const { return collided_; }
    double d_min() const { return d_min_; }
    bool leader_on_lane() const { return scn_.leader_on_lane(t_); }
    const Leader& leader() const { return lead_; }
    const UpperController& ctrl() const { return ctrl_; }
    Scenario& scenario() { return scn_; }

private:
    void update_target() {
        const double dd = d();
        target_ = scn_.leader_on_lane(t_) && scn_.target_kept(t_) && dd > 0.0 && dd < p_.ctrl.d_det;
    }
    static constexpr double DT = 0.001;
    const Params& p_;
    Scenario scn_;
    UpperController ctrl_;
    Leader lead_;
    double t_ = 0, x_ = 0, v_ = 0, a_ = 0, a_des_ = 0, d_min_ = INF;
    long n_ = 0, N_ = 20;
    bool target_ = false, collided_ = false;
};

// ============================================================================ uniform sampling
struct Sample {
    double t, v, a, a_des, d, e_s, d_ref, lead_v, F_b;
    int mode;
    bool target, lead_on;
};

template <class Car>
Sample sample_of(const Lane<Car>& L) {
    const auto& o = L.ctrl().out();
    return {L.t(), L.car().v(), L.car().out().a, L.a_des(), L.d(), o.e_s, o.d_ref,
            L.leader().v, L.car().state()[Car::FB], o.mode, L.target(), L.leader_on_lane()};
}
Sample sample_of(const IdealLane& L) {
    const auto& o = L.ctrl().out();
    return {L.t(), L.v(), L.a(), L.a_des(), L.d(), o.e_s, o.d_ref, L.leader().v, 0.0,
            o.mode, L.target(), L.leader_on_lane()};
}

struct Trace {
    std::vector<Sample> s;
    bool collided = false;
    double d_min = INF;
    double t_collision = NaN;
};

// Run a lane (Lane<Ice>, Lane<Ev> or IdealLane) to t_end, sampling every
// `every` s (0 = no samples). hook(L) runs before every step (live inputs).
template <class Sim>
Trace simulate(const Params& q, double t_end, double every,
               const std::function<void(Sim&)>& hook = nullptr, bool stop_at_collision = true) {
    Sim L(q, "a");
    L.reset();
    Trace tr;
    double next = 0.0;
    if (every > 0) { tr.s.push_back(sample_of(L)); next = every; }
    while (L.t() < t_end - 1e-9) {
        if (hook) hook(L);
        L.step();
        if (every > 0 && L.t() >= next - 1e-9) { tr.s.push_back(sample_of(L)); next += every; }
        if (L.collided() && !tr.collided) {
            tr.collided = true;
            tr.t_collision = L.t();
            if (stop_at_collision) break;
        }
    }
    tr.d_min = L.d_min();
    return tr;
}

enum class Kind { ICE, EV, IDEAL };
const char* kind_name(Kind k) { return k == Kind::ICE ? "ice" : k == Kind::EV ? "ev" : "ideal"; }
const Kind ALL_KINDS[] = {Kind::ICE, Kind::EV, Kind::IDEAL};

Trace simulate_kind(Kind k, const Params& q, double t_end, double every) {
    switch (k) {
        case Kind::ICE: return simulate<Lane<IceVehicle>>(q, t_end, every);
        case Kind::EV:  return simulate<Lane<EvVehicle>>(q, t_end, every);
        default:        return simulate<IdealLane>(q, t_end, every);
    }
}

// Series of one field of a trace.
std::vector<double> field(const Trace& tr, double Sample::*f) {
    std::vector<double> v;
    v.reserve(tr.s.size());
    for (const auto& s : tr.s) v.push_back(s.*f);
    return v;
}

// ============================================================================ response metrics
struct StepMetrics { double t_rise = NaN, overshoot = NaN, t_settle = NaN, peak = NaN; };

// y goes from y0 to y1 after t_step. Rise 10-90 %, overshoot %, 2 % settling.
StepMetrics step_metrics(const std::vector<double>& t, const std::vector<double>& y,
                         double t_step, double y0, double y1) {
    StepMetrics m;
    const double dy = y1 - y0;
    if (std::fabs(dy) < 1e-12 || t.empty()) return m;
    double t10 = NaN, t90 = NaN, peak = 0.0, last_out = t_step;
    for (std::size_t i = 0; i < t.size(); ++i) {
        if (t[i] < t_step) continue;
        const double f = (y[i] - y0) / dy;
        if (std::isnan(t10) && f >= 0.1) t10 = t[i];
        if (std::isnan(t90) && f >= 0.9) t90 = t[i];
        peak = std::max(peak, f);
        if (std::fabs(f - 1.0) > 0.02) last_out = t[i];
    }
    m.t_rise = t90 - t10;
    m.overshoot = 100.0 * std::max(0.0, peak - 1.0);
    m.t_settle = last_out - t_step;
    m.peak = y0 + peak * dy;
    return m;
}

void write_step_metrics(Json& j, const std::string& k, const StepMetrics& m) {
    j.key(k); j.obj();
    j.kn("t_rise", m.t_rise); j.kn("overshoot", m.overshoot);
    j.kn("t_settle", m.t_settle); j.kn("peak", m.peak);
    j.end_obj();
}

// ============================================================================ 1) plant
struct PlantStep {
    std::vector<double> a, Fb;
    double dead = NaN, t10 = NaN, t63 = NaN, t90 = NaN, overshoot = NaN, a_end = NaN;
};

template <class Car>
PlantStep plant_step(const Params& p, double v0, double a_step, double t_step, double t_end,
                     double every) {
    Car car(p);
    car.trim(v0);
    PlantStep r;
    double next = 0.0, peak = 0.0;
    while (car.t() < t_end - 1e-12) {
        const double a_des = car.t() >= t_step - 1e-12 ? a_step : 0.0;
        car.step(a_des);
        if (car.t() >= next - 1e-12) {
            r.a.push_back(car.out().a);
            r.Fb.push_back(car.state()[Car::FB]);
            next += every;
        }
        if (car.t() <= t_step) continue;
        const double f = car.out().a / a_step, ts = car.t() - t_step;
        if (std::isnan(r.dead) && f >= 0.02) r.dead = ts;
        if (std::isnan(r.t10) && f >= 0.10) r.t10 = ts;
        if (std::isnan(r.t63) && f >= 0.63) r.t63 = ts;
        if (std::isnan(r.t90) && f >= 0.90) r.t90 = ts;
        peak = std::max(peak, f);
    }
    r.overshoot = 100.0 * std::max(0.0, peak - 1.0);
    r.a_end = r.a.empty() ? NaN : r.a.back();
    return r;
}

void analysis_plant(const Params& p, const Args& args, Json& j) {
    const double v0 = arg(args, "v0", 30.0);
    const std::vector<double> steps = {0.5, 1.5, -0.5, -2.0, -4.0};
    const double t_step = 0.2, t_end = 3.0, every = 0.005;
    if (v0 <= p.ice.v_min) throw std::runtime_error("v0 must be above the ICE clutch speed");

    std::vector<PlantStep> ice(steps.size()), ev(steps.size());
    parallel_for(steps.size() * 2, [&](std::size_t k) {
        const std::size_t i = k / 2;
        if (k % 2 == 0) ice[i] = plant_step<IceVehicle>(p, v0, steps[i], t_step, t_end, every);
        else            ev[i]  = plant_step<EvVehicle>(p, v0, steps[i], t_step, t_end, every);
    });

    // speed dependence of the response (+0.5 m/s2 step)
    const std::vector<double> speeds = {10, 15, 20, 25, 30, 35, 40};
    std::vector<double> ice63(speeds.size()), ev63(speeds.size()), ice_dead(speeds.size()),
                        ev_dead(speeds.size()), taum(speeds.size());
    parallel_for(speeds.size() * 2, [&](std::size_t k) {
        const std::size_t i = k / 2;
        if (k % 2 == 0) {
            const auto r = plant_step<IceVehicle>(p, speeds[i], 0.5, 0.2, 2.0, 1.0);
            ice63[i] = r.t63; ice_dead[i] = r.dead;
        } else {
            const auto r = plant_step<EvVehicle>(p, speeds[i], 0.5, 0.2, 2.0, 1.0);
            ev63[i] = r.t63; ev_dead[i] = r.dead;
        }
        taum[i] = p.ice.tau_m(speeds[i]);
    });

    j.ks("kind", "plant");
    j.kn("v0", v0);
    j.kn("t_step", t_step);
    std::vector<double> t;
    for (double x = 0.0; x <= t_end + 1e-9; x += every) t.push_back(x - t_step);
    t.resize(std::min(t.size(), ice[0].a.size()));
    j.kv("t", t);
    j.key("cars"); j.obj();
    for (int c = 0; c < 2; ++c) {
        const auto& R = c == 0 ? ice : ev;
        j.key(c == 0 ? "ice" : "ev"); j.arr();
        for (std::size_t i = 0; i < steps.size(); ++i) {
            j.obj();
            j.kn("a_step", steps[i]);
            std::vector<double> a = R[i].a, fb = R[i].Fb;
            a.resize(t.size()); fb.resize(t.size());
            j.kv("a", a); j.kv("F_b", fb);
            j.kn("dead", R[i].dead); j.kn("t10", R[i].t10); j.kn("t63", R[i].t63);
            j.kn("t90", R[i].t90); j.kn("overshoot", R[i].overshoot); j.kn("a_end", R[i].a_end);
            j.end_obj();
        }
        j.end_arr();
    }
    j.end_obj();
    j.key("speed"); j.obj();
    j.kv("v", speeds); j.kv("ice_t63", ice63); j.kv("ev_t63", ev63);
    j.kv("ice_dead", ice_dead); j.kv("ev_dead", ev_dead); j.kv("ice_tau_m", taum);
    j.end_obj();
    j.key("model"); j.obj();
    j.kn("th_e", p.ice.th_e); j.kn("tau_m_v0", p.ice.tau_m(v0));
    j.kn("th_b", p.brk.th_b); j.kn("tau_b", p.brk.tau_b);
    j.kn("Fb_max", p.brk.Fb_max); j.kn("m", p.body.m);
    j.kn("a_brake_max", p.brk.Fb_max / p.body.m);
    j.kn("w_ci", p.ev.w_ci); j.kn("tau_i", 1.0 / p.ev.w_ci);
    j.kn("tau_el", p.ev.L_a / p.ev.R_a);
    j.kn("Kp_i", p.ev.Kp_i); j.kn("Ki_i", p.ev.Ki_i);
    j.kn("Ts_ctrl", p.sim.Ts_ctrl); j.kn("dt_ice", p.sim.dt_ice); j.kn("dt_ev", p.sim.dt_ev);
    j.kn("a_min", p.lim.a_min); j.kn("a_max", p.lim.a_max); j.kn("P_max", p.lim.P_max);
    j.kn("ice_v_min", p.ice.v_min);
    j.end_obj();
}

// ============================================================================ 2) closed-loop steps
void analysis_steps(const Params& p, const Args& args, Json& j) {
    const double v0  = arg(args, "v0", 20.0);
    const double dv  = arg(args, "dv", 2.0);       // set speed step
    const double dvl = arg(args, "dvl", -5.0);     // leader speed change
    const double al  = std::fabs(arg(args, "a_lead", 2.0)) * (dvl < 0 ? -1.0 : 1.0);
    const double T   = arg(args, "t_end", 40.0);
    const double t0  = 2.0, every = 0.02;
    if (v0 + dvl < 0) throw std::runtime_error("v0 + dvl must be >= 0");

    Params qs = base_params(p);
    qs.scn = quiet(p.scn, v0);
    qs.scn.v_set_step_time = t0; qs.scn.v_set_step_value = v0 + dv;

    Params qf = base_params(p);
    qf.scn = quiet(p.scn, v0);
    qf.scn.v_set = v0 + 5.0;                       // cruise wants more: the distance law rules
    qf.scn.leader_present = true; qf.scn.v_lead0 = v0;
    qf.scn.lead_accel = al; qf.scn.lead_accel_start = t0; qf.scn.lead_v_target = v0 + dvl;

    Trace sp[3], fo[3];
    parallel_for(6, [&](std::size_t k) {
        const Kind kind = ALL_KINDS[k % 3];
        if (k < 3) sp[k % 3] = simulate_kind(kind, qs, T, every);
        else       fo[k % 3] = simulate_kind(kind, qf, T, every);
    });

    j.ks("kind", "steps");
    j.kn("v0", v0); j.kn("dv", dv); j.kn("dvl", dvl); j.kn("a_lead", al); j.kn("t_step", t0);
    j.kv("t", field(sp[0], &Sample::t));

    j.key("speed"); j.obj();
    for (int k = 0; k < 3; ++k) {
        const Trace& tr = sp[k];
        const auto t = field(tr, &Sample::t), v = field(tr, &Sample::v);
        j.key(kind_name(ALL_KINDS[k])); j.obj();
        j.kv("v", v); j.kv("a", field(tr, &Sample::a)); j.kv("a_des", field(tr, &Sample::a_des));
        write_step_metrics(j, "metrics", step_metrics(t, v, t0, v0, v0 + dv));
        double amax = 0;
        for (const auto& s : tr.s) amax = std::max(amax, std::fabs(s.a));
        j.kn("a_peak", amax);
        j.end_obj();
    }
    j.end_obj();

    j.key("follow"); j.obj();
    j.kv("t", field(fo[0], &Sample::t));
    j.kv("lead_v", field(fo[0], &Sample::lead_v));
    for (int k = 0; k < 3; ++k) {
        const Trace& tr = fo[k];
        j.key(kind_name(ALL_KINDS[k])); j.obj();
        std::vector<double> es, dref;
        double es_max = 0, ts = 0, amin = 0, amax = 0;
        for (const auto& s : tr.s) {
            es.push_back(s.target ? s.e_s : NaN);
            dref.push_back(s.target && s.d_ref > 0 ? s.d_ref : NaN);
            if (s.target) {
                es_max = std::max(es_max, std::fabs(s.e_s));
                if (std::fabs(s.e_s) > 0.5) ts = s.t;
            }
            amin = std::min(amin, s.a); amax = std::max(amax, s.a);
        }
        j.kv("v", field(tr, &Sample::v)); j.kv("a", field(tr, &Sample::a));
        j.kv("a_des", field(tr, &Sample::a_des)); j.kv("d", field(tr, &Sample::d));
        j.kv("d_ref", dref); j.kv("e_s", es);
        j.key("metrics"); j.obj();
        j.kn("es_max", es_max); j.kn("t_settle", std::max(0.0, ts - t0));
        j.kn("d_min", tr.d_min); j.kn("a_min", amin); j.kn("a_max", amax);
        j.kb("collided", tr.collided);
        j.end_obj();
        j.end_obj();
    }
    j.end_obj();

    // theory of the ideal loops (a = a_des, continuous time)
    const auto& c = p.ctrl;
    j.key("theory"); j.obj();
    j.kn("k_p", c.k_p); j.kn("k_i", c.k_i); j.kn("h", c.h); j.kn("lambda", c.lambda);
    j.kn("d0", c.d0); j.kb("fixed_spacing", c.fixed_spacing); j.kn("d_set", c.d_set);
    j.kn("wn", std::sqrt(c.k_i));
    j.kn("zeta", c.k_p / (2.0 * std::sqrt(c.k_i)));
    j.kn("zero", c.k_i / c.k_p);
    j.kn("tau_es", 1.0 / c.lambda);
    j.kn("Ts_ctrl", p.sim.Ts_ctrl);
    j.kn("a_min", p.lim.a_min); j.kn("a_max", p.lim.a_max);
    j.end_obj();
}

// ============================================================================ 3) frequency response
struct FreqPoint { double gain = NaN, phase = NaN; };

// Correlates input u(t) and output y(t) with e^{-jwt} over whole periods.
struct Correlator {
    double w; cplx U{0, 0}, Y{0, 0};
    void add(double t, double u, double y, double dt) {
        const cplx e = std::exp(cplx(0, -w * t)) * dt;
        U += u * e; Y += y * e;
    }
    FreqPoint result() const {
        FreqPoint r;
        if (std::abs(U) < 1e-12) return r;
        const cplx G = Y / U;
        r.gain = std::abs(G);
        r.phase = std::arg(G) * 180.0 / PI;
        return r;
    }
};

enum class Loop { PLANT, SPEED, FOLLOW };

template <class Car>
FreqPoint freq_point(const Params& p, Loop loop, double v0, double f) {
    const double w = 2.0 * PI * f, period = 1.0 / f;
    const double settle = loop == Loop::PLANT ? std::max(2.0 * period, 2.0)
                                              : std::max(period, 30.0);
    const int n_meas = std::max(3, static_cast<int>(std::ceil((loop == Loop::PLANT ? 3.0 : 10.0) / period)));
    const double t_end = settle + n_meas * period;

    Correlator c{w};
    if (loop == Loop::PLANT) {
        const double A = 0.3;
        Car car(p);
        car.trim(v0);
        while (car.t() < t_end - 1e-12) {
            const double t = car.t();
            const double u = A * std::sin(w * t);
            car.step(u);
            if (t >= settle) c.add(t, u, car.out().a, car.dt());
        }
        return c.result();
    }

    Params q = base_params(p);
    q.scn = quiet(p.scn, v0);
    const double A = 0.5;
    if (loop == Loop::FOLLOW) {
        q.scn.leader_present = true;
        q.scn.v_set = v0 + 5.0;                        // keep the distance law in charge
    }
    Lane<Car> L(q, "f");
    L.reset();
    while (L.t() < t_end - 1e-9) {
        const double t = L.t();
        if (loop == Loop::SPEED) L.scenario().set_v_set_override(v0 + A * std::sin(w * t));
        else                     L.scenario().set_lead_override(A * w * std::cos(w * t));
        L.step();
        if (t >= settle) {
            const double u = loop == Loop::SPEED ? A * std::sin(w * t) : L.leader().v - v0;
            c.add(t, u, L.car().v() - v0, L.car().dt());
        }
        if (L.collided()) return {};
    }
    return c.result();
}

void unwrap(std::vector<double>& ph) {
    for (std::size_t i = 1; i < ph.size(); ++i) {
        if (std::isnan(ph[i]) || std::isnan(ph[i - 1])) continue;
        while (ph[i] - ph[i - 1] > 180.0) ph[i] -= 360.0;
        while (ph[i] - ph[i - 1] < -180.0) ph[i] += 360.0;
    }
}

void analysis_bode(const Params& p, const Args& args, Json& j) {
    const double v0 = arg(args, "v0", 25.0);
    const int n = std::clamp(static_cast<int>(arg(args, "n", 14)), 5, 40);
    if (v0 <= p.ice.v_min + 1.0) throw std::runtime_error("v0 must be above the ICE clutch speed");
    struct Def { Loop loop; const char* name; double f0, f1; };
    const Def defs[] = {{Loop::PLANT, "plant", 0.05, 8.0},
                        {Loop::SPEED, "speed", 0.003, 0.5},
                        {Loop::FOLLOW, "follow", 0.003, 0.5}};
    std::vector<double> fr[3];
    for (int l = 0; l < 3; ++l) fr[l] = logspace(defs[l].f0, defs[l].f1, n);

    // results[loop][car][i]
    std::vector<FreqPoint> res[3][2];
    for (auto& L : res) for (auto& c : L) c.resize(n);
    parallel_for(3 * 2 * n, [&](std::size_t k) {
        const int l = static_cast<int>(k / (2 * n)), c = static_cast<int>((k / n) % 2),
                  i = static_cast<int>(k % n);
        res[l][c][i] = c == 0 ? freq_point<IceVehicle>(p, defs[l].loop, v0, fr[l][i])
                              : freq_point<EvVehicle>(p, defs[l].loop, v0, fr[l][i]);
    });

    const auto& C = p.ctrl;
    const double h_eff = C.fixed_spacing ? 0.0 : C.h;
    j.ks("kind", "bode");
    j.kn("v0", v0);
    for (int l = 0; l < 3; ++l) {
        j.key(defs[l].name); j.obj();
        j.kv("f", fr[l]);
        for (int c = 0; c < 2; ++c) {
            std::vector<double> g, ph;
            for (const auto& r : res[l][c]) {
                g.push_back(std::isnan(r.gain) ? NaN : 20.0 * std::log10(r.gain));
                ph.push_back(r.phase);
            }
            unwrap(ph);
            j.key(c == 0 ? "ice" : "ev"); j.obj();
            j.kv("gain_db", g); j.kv("phase", ph);
            j.end_obj();
        }
        // ideal (continuous) theory on a finer grid
        const std::vector<double> ff = logspace(defs[l].f0, defs[l].f1, 120);
        std::vector<double> g, ph;
        for (double f : ff) {
            const cplx s(0.0, 2.0 * PI * f);
            cplx G(1.0, 0.0);
            if (defs[l].loop == Loop::SPEED) G = (C.k_p * s + C.k_i) / (s * s + C.k_p * s + C.k_i);
            if (defs[l].loop == Loop::FOLLOW)
                G = (s + C.lambda) / (C.h * s * s + (1.0 + C.lambda * h_eff) * s + C.lambda);
            g.push_back(20.0 * std::log10(std::abs(G)));
            ph.push_back(std::arg(G) * 180.0 / PI);
        }
        unwrap(ph);
        j.key("ideal"); j.obj();
        j.kv("f", ff); j.kv("gain_db", g); j.kv("phase", ph);
        j.end_obj();
        j.end_obj();
    }
    j.key("model"); j.obj();
    j.kn("k_p", C.k_p); j.kn("k_i", C.k_i); j.kn("h", C.h); j.kn("lambda", C.lambda);
    j.kb("fixed_spacing", C.fixed_spacing);
    j.kn("th_e", p.ice.th_e); j.kn("tau_m_v0", p.ice.tau_m(v0));
    j.kn("th_b", p.brk.th_b); j.kn("tau_b", p.brk.tau_b); j.kn("w_ci", p.ev.w_ci);
    j.kn("Ts_ctrl", p.sim.Ts_ctrl);
    j.end_obj();
}

// ============================================================================ 4) minimum safe distance
// Leader brakes at a_b (< 0) from t = 0 until it stops; both start at v0.
Params braking_case(const Params& p, double v0, double a_b) {
    Params q = base_params(p);
    q.scn = quiet(p.scn, v0);
    q.scn.leader_present = true; q.scn.v_lead0 = v0;
    q.scn.lead_accel = a_b; q.scn.lead_accel_start = 0.0; q.scn.lead_v_target = 0.0;
    return q;
}
double braking_t_end(double v0, double a_b) { return v0 / std::fabs(a_b) + 15.0; }

bool collides(Kind k, const Params& q, double t_end) {
    return simulate_kind(k, q, t_end, 0.0).collided;
}

// Smallest x in [lo, hi_max] for which safe(x) is true (safe is monotone in x).
// NaN if even hi_max is unsafe.
double bisect_min(const std::function<bool(double)>& safe, double lo, double hi0, double hi_max,
                  double tol) {
    double hi = hi0;
    while (!safe(hi)) {
        lo = hi;
        hi *= 2.0;
        if (hi > hi_max) return NaN;
    }
    if (safe(lo)) return lo;
    while (hi - lo > tol) {
        const double mid = 0.5 * (lo + hi);
        (safe(mid) ? hi : lo) = mid;
    }
    return hi;
}

// Fixed spacing: d_set = initial gap = d (steady following at d).
double min_follow_distance(Kind k, const Params& p, double v0, double a_b) {
    const double T = braking_t_end(v0, a_b);
    return bisect_min([&](double d) {
        Params q = braking_case(p, v0, a_b);
        q.ctrl.fixed_spacing = true; q.ctrl.d_set = d; q.scn.d_init = d;
        return !collides(k, q, T);
    }, 0.05, 5.0, 2000.0, 0.02);
}
// Time-gap spacing: h such that steady following at d0 + h*v0 survives.
double min_time_gap(Kind k, const Params& p, double v0, double a_b) {
    const double T = braking_t_end(v0, a_b);
    return bisect_min([&](double h) {
        Params q = braking_case(p, v0, a_b);
        q.ctrl.fixed_spacing = false; q.ctrl.h = h; q.scn.d_init = -1.0;
        return !collides(k, q, T);
    }, 0.02, 0.5, 60.0, 0.002);
}
// Configured controller, only the initial gap changes.
double min_initial_gap(Kind k, const Params& p, double v0, double a_b) {
    const double T = braking_t_end(v0, a_b);
    return bisect_min([&](double d) {
        Params q = braking_case(p, v0, a_b);
        q.scn.d_init = d;
        return !collides(k, q, T);
    }, 0.05, 5.0, 2000.0, 0.02);
}

// Kinematics: both from v0, leader at A_l, ego at A_e from t = 0 (no delay).
double kinematic_gap(double v0, double A_e, double A_l) {
    if (A_e >= A_l) return 0.0;
    return 0.5 * v0 * v0 * (1.0 / A_e - 1.0 / A_l);
}

void analysis_min_gap(const Params& p, const Args& args, Json& j) {
    const double v0  = arg(args, "v0", 30.0);
    const double a_b = -std::fabs(arg(args, "a_b", 5.0));
    if (v0 <= 0.0) throw std::runtime_error("v0 must be > 0");
    const double A_ctrl = std::fabs(p.lim.a_min), A_phys = p.brk.Fb_max / p.body.m;

    // single case: 3 solvers x 3 plants
    double dfix[3], hmin[3], dinit[3];
    parallel_for(9, [&](std::size_t k) {
        const int c = static_cast<int>(k % 3), s = static_cast<int>(k / 3);
        const Kind kind = ALL_KINDS[c];
        if (s == 0) dfix[c] = min_follow_distance(kind, p, v0, a_b);
        if (s == 1) hmin[c] = min_time_gap(kind, p, v0, a_b);
        if (s == 2) dinit[c] = min_initial_gap(kind, p, v0, a_b);
    });

    // near-miss traces at the minimum following distance (+5 cm)
    Trace near[3];
    parallel_for(3, [&](std::size_t c) {
        if (std::isnan(dfix[c])) return;
        Params q = braking_case(p, v0, a_b);
        q.ctrl.fixed_spacing = true; q.ctrl.d_set = dfix[c] + 0.05; q.scn.d_init = dfix[c] + 0.05;
        near[c] = simulate_kind(ALL_KINDS[c], q, braking_t_end(v0, a_b), 0.02);
    });

    // curves: vs braking (at v0) and vs speed (at a_b)
    const std::vector<double> brakes = {-1, -2, -3, -4, -5, -6, -7, -8, -9};
    const std::vector<double> speeds = {10, 15, 20, 25, 30, 35, 40};
    std::vector<double> cb[3], cv[3];
    for (int c = 0; c < 3; ++c) { cb[c].resize(brakes.size()); cv[c].resize(speeds.size()); }
    const std::size_t nb = brakes.size(), nv = speeds.size();
    parallel_for(3 * (nb + nv), [&](std::size_t k) {
        const int c = static_cast<int>(k % 3);
        const std::size_t i = k / 3;
        if (i < nb) cb[c][i] = min_follow_distance(ALL_KINDS[c], p, v0, brakes[i]);
        else        cv[c][i - nb] = min_follow_distance(ALL_KINDS[c], p, speeds[i - nb], a_b);
    });

    j.ks("kind", "min_gap");
    j.kn("v0", v0); j.kn("a_b", a_b);
    j.kn("A_ctrl", A_ctrl); j.kn("A_phys", A_phys);
    j.kn("d_ref_config", p.ctrl.d_ref(v0));
    j.kb("fixed_spacing", p.ctrl.fixed_spacing);
    j.kn("h_config", p.ctrl.h); j.kn("d0", p.ctrl.d0); j.kn("d_set_config", p.ctrl.d_set);
    j.kn("lambda", p.ctrl.lambda);
    j.kn("kin_ctrl", kinematic_gap(v0, A_ctrl, std::fabs(a_b)));
    j.kn("kin_phys", kinematic_gap(v0, A_phys, std::fabs(a_b)));
    j.key("solve"); j.obj();
    for (int c = 0; c < 3; ++c) {
        j.key(kind_name(ALL_KINDS[c])); j.obj();
        j.kn("d_follow", dfix[c]); j.kn("h_min", hmin[c]);
        j.kn("d_h_min", std::isnan(hmin[c]) ? NaN : p.ctrl.d0 + hmin[c] * v0);
        j.kn("d_initial", dinit[c]);
        j.end_obj();
    }
    j.end_obj();
    j.key("near_miss"); j.obj();
    for (int c = 0; c < 3; ++c) {
        if (near[c].s.empty()) continue;
        j.key(kind_name(ALL_KINDS[c])); j.obj();
        j.kv("t", field(near[c], &Sample::t)); j.kv("d", field(near[c], &Sample::d));
        j.kv("v", field(near[c], &Sample::v)); j.kv("a", field(near[c], &Sample::a));
        j.kv("lead_v", field(near[c], &Sample::lead_v));
        j.kn("d_min", near[c].d_min);
        j.end_obj();
    }
    j.end_obj();
    j.key("vs_brake"); j.obj();
    j.kv("a_b", brakes);
    for (int c = 0; c < 3; ++c) j.kv(kind_name(ALL_KINDS[c]), cb[c]);
    std::vector<double> kc, kp;
    for (double b : brakes) { kc.push_back(kinematic_gap(v0, A_ctrl, -b)); kp.push_back(kinematic_gap(v0, A_phys, -b)); }
    j.kv("kin_ctrl", kc); j.kv("kin_phys", kp);
    j.end_obj();
    j.key("vs_speed"); j.obj();
    j.kv("v0", speeds);
    for (int c = 0; c < 3; ++c) j.kv(kind_name(ALL_KINDS[c]), cv[c]);
    std::vector<double> ks, kps, dr;
    for (double v : speeds) {
        ks.push_back(kinematic_gap(v, A_ctrl, -a_b)); kps.push_back(kinematic_gap(v, A_phys, -a_b));
        dr.push_back(p.ctrl.d_ref(v));
    }
    j.kv("kin_ctrl", ks); j.kv("kin_phys", kps); j.kv("d_ref", dr);
    j.end_obj();
}

// ============================================================================ 5) sweep
struct RunMetrics {
    double collided = 0, d_min = NaN, a_min = 0, a_max = 0, jerk_max = 0, es_max = 0,
           t_settle = 0, v_overshoot = NaN, v_settle = NaN, v_end = NaN, t_collision = NaN;
};
const char* METRICS[] = {"collided", "d_min", "a_min", "a_max", "jerk_max", "es_max",
                         "t_settle", "v_overshoot", "v_settle", "v_end", "t_collision"};

RunMetrics run_metrics(const Trace& tr, const ScenarioParams& s) {
    RunMetrics m;
    m.collided = tr.collided ? 1.0 : 0.0;
    m.d_min = std::isfinite(tr.d_min) ? tr.d_min : NaN;
    m.t_collision = tr.t_collision;
    double prev_a = NaN, prev_t = NaN;
    for (const auto& x : tr.s) {
        m.a_min = std::min(m.a_min, x.a);
        m.a_max = std::max(m.a_max, x.a);
        if (!std::isnan(prev_a) && x.t > prev_t)
            m.jerk_max = std::max(m.jerk_max, std::fabs(x.a - prev_a) / (x.t - prev_t));
        prev_a = x.a; prev_t = x.t;
        if (x.target) {
            m.es_max = std::max(m.es_max, std::fabs(x.e_s));
            if (std::fabs(x.e_s) > 0.5) m.t_settle = x.t;
        }
    }
    if (!tr.s.empty()) m.v_end = tr.s.back().v;
    if (s.v_set_step_time >= 0.0 && std::fabs(s.v_set_step_value - s.v_set) > 1e-9) {
        std::vector<double> t, v;
        for (const auto& x : tr.s) { t.push_back(x.t); v.push_back(x.v); }
        const auto sm = step_metrics(t, v, s.v_set_step_time, s.v0, s.v_set_step_value);
        m.v_overshoot = sm.overshoot; m.v_settle = sm.t_settle;
    }
    return m;
}
double metric(const RunMetrics& m, int i) {
    switch (i) {
        case 0: return m.collided;   case 1: return m.d_min;    case 2: return m.a_min;
        case 3: return m.a_max;      case 4: return m.jerk_max; case 5: return m.es_max;
        case 6: return m.t_settle;   case 7: return m.v_overshoot; case 8: return m.v_settle;
        case 9: return m.v_end;      default: return m.t_collision;
    }
}

const char* SWEEP_PARAMS = "k_p, k_i, h, lambda, d0, d_set, d_det, a_min, a_max, v0, v_set, v_lead0, d_init, a_b";

void apply_param(Params& q, const std::string& name, double x) {
    auto& c = q.ctrl; auto& s = q.scn;
    if      (name == "k_p")     c.k_p = x;
    else if (name == "k_i")     c.k_i = x;
    else if (name == "h")       { c.h = x; c.fixed_spacing = false; }
    else if (name == "lambda")  c.lambda = x;
    else if (name == "d0")      { c.d0 = x; c.fixed_spacing = false; }
    else if (name == "d_set")   { c.d_set = x; c.fixed_spacing = true; }
    else if (name == "d_det")   c.d_det = x;
    else if (name == "a_min")   q.lim.a_min = -std::fabs(x);
    else if (name == "a_max")   q.lim.a_max = std::fabs(x);
    else if (name == "v0")      { s.v0 = x; }
    else if (name == "v_set")   s.v_set = x;
    else if (name == "v_lead0") s.v_lead0 = x;
    else if (name == "d_init")  s.d_init = x;
    else if (name == "a_b")     { s.lead_accel = -std::fabs(x); }
    else throw std::runtime_error("unknown sweep parameter '" + name + "' (use " + SWEEP_PARAMS + ")");
}

void analysis_sweep(const Params& p, const Args& args, Json& j) {
    const std::string xn = sarg(args, "x", "h");
    const std::string yn = sarg(args, "y", "");
    const int nx = std::clamp(static_cast<int>(arg(args, "nx", 15)), 2, 60);
    const int ny = yn.empty() ? 1 : std::clamp(static_cast<int>(arg(args, "ny", 12)), 2, 40);
    const auto xs = linspace(arg(args, "x0", 0.5), arg(args, "x1", 3.0), nx);
    const auto ys = yn.empty() ? std::vector<double>{NaN}
                               : linspace(arg(args, "y0", 1.0), arg(args, "y1", 9.0), ny);
    const std::string scn = sarg(args, "scenario", "brake");

    // base scenario
    Params base = base_params(p);
    double T = 60.0;
    if (scn == "brake") {
        const double v0 = arg(args, "v0", 30.0), a_b = arg(args, "a_b", 5.0);
        base = braking_case(p, v0, -std::fabs(a_b));
        T = -1.0;                                  // depends on v0 / a_b of each point
    } else {
        base.scn.preset = scn;
        if (!apply_preset(scn, base.scn, T)) throw std::runtime_error("unknown scenario " + scn);
        if (scn == "custom") T = p.sim.duration > 0 ? p.sim.duration : 60.0;
    }
    if (yn == xn) throw std::runtime_error("x and y must be different parameters");
    { Params test = base; apply_param(test, xn, xs[0]); if (!yn.empty()) apply_param(test, yn, ys[0]); }

    const std::size_t npts = xs.size() * ys.size();
    std::vector<RunMetrics> res[3];
    for (auto& r : res) r.resize(npts);
    parallel_for(npts * 3, [&](std::size_t k) {
        const int c = static_cast<int>(k % 3);
        const std::size_t pt = k / 3, ix = pt % xs.size(), iy = pt / xs.size();
        Params q = base;
        apply_param(q, xn, xs[ix]);
        if (!yn.empty()) apply_param(q, yn, ys[iy]);
        if (scn == "brake") {                     // keep the scenario self-consistent
            if (xn == "v0" || yn == "v0") { q.scn.v_set = q.scn.v0; q.scn.v_lead0 = q.scn.v0; }
        }
        if (ALL_KINDS[c] == Kind::ICE && q.scn.v0 <= q.ice.v_min) { res[c][pt].collided = NaN; return; }
        const double t_end = T > 0 ? T : braking_t_end(q.scn.v0, q.scn.lead_accel);
        const Trace tr = simulate_kind(ALL_KINDS[c], q, t_end, 0.02);
        res[c][pt] = run_metrics(tr, q.scn);
    });

    j.ks("kind", "sweep");
    j.ks("scenario", scn);
    j.key("x"); j.obj(); j.ks("name", xn); j.kv("values", xs); j.end_obj();
    if (!yn.empty()) { j.key("y"); j.obj(); j.ks("name", yn); j.kv("values", ys); j.end_obj(); }
    j.key("metrics"); j.arr(); for (const char* m : METRICS) j.str(m); j.end_arr();
    j.key("cars"); j.obj();
    for (int c = 0; c < 3; ++c) {
        j.key(kind_name(ALL_KINDS[c])); j.obj();
        for (int mi = 0; mi < static_cast<int>(std::size(METRICS)); ++mi) {
            std::vector<double> v;
            for (const auto& r : res[c]) v.push_back(metric(r, mi));
            j.kv(METRICS[mi], v);                 // row-major: index = iy*nx + ix
        }
        j.end_obj();
    }
    j.end_obj();
    j.key("config"); j.obj();
    j.kn("k_p", p.ctrl.k_p); j.kn("k_i", p.ctrl.k_i); j.kn("h", p.ctrl.h);
    j.kn("lambda", p.ctrl.lambda); j.kn("d0", p.ctrl.d0); j.kn("d_set", p.ctrl.d_set);
    j.kb("fixed_spacing", p.ctrl.fixed_spacing);
    j.kn("v0", base.scn.v0); j.kn("a_b", base.scn.lead_accel);
    j.end_obj();
}

} // namespace

// ============================================================================ entry
int run_analysis(const Params& p, const std::string& kind, const Args& args, std::ostream& os) {
    std::ostringstream buf;
    try {
        Json j(buf);
        j.obj();
        const auto t0 = std::chrono::steady_clock::now();
        if      (kind == "plant")   analysis_plant(p, args, j);
        else if (kind == "steps")   analysis_steps(p, args, j);
        else if (kind == "bode")    analysis_bode(p, args, j);
        else if (kind == "min_gap") analysis_min_gap(p, args, j);
        else if (kind == "sweep")   analysis_sweep(p, args, j);
        else throw std::runtime_error("unknown analysis '" + kind +
                                      "' (plant | steps | bode | min_gap | sweep)");
        j.kn("seconds", std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count());
        j.kn("threads", std::max(1u, std::thread::hardware_concurrency()));
        j.end_obj();
    } catch (const std::exception& e) {
        std::ostringstream err;
        Json j(err);
        j.obj(); j.ks("error", e.what()); j.end_obj();
        os << err.str() << "\n";
        return 1;
    }
    os << buf.str() << "\n";
    return 0;
}

} // namespace vs