#pragma once
// Output columns, shared by the real-time runner and the batch mode.
// The same emit() produces the header (names) and the data (values), so they
// can never get out of sync.

#include "ev_vehicle.hpp"
#include "ice_vehicle.hpp"
#include "lane.hpp"

#include <cstdio>
#include <string>

namespace vs {

struct NameSink {
    std::string line;
    std::string prefix;
    void operator()(const char* name, double) {
        if (!line.empty()) line += ' ';
        line += prefix;
        line += name;
    }
};

struct ValueSink {
    std::string line;
    char buf[64];
    void operator()(const char*, double v) {
        // %.9g keeps ~1 mm resolution on positions of several km
        std::snprintf(buf, sizeof buf, line.empty() ? "%.9g" : " %.9g", v);
        line += buf;
    }
};

template <class Sink, class Car>
inline void emit_common(Sink& s, const Lane<Car>& L) {
    const auto& car = L.car();
    const auto& o   = L.ctrl().out();
    const auto& ld  = L.leader();
    s("x",        car.pos());
    s("v",        car.v());
    s("a",        car.out().a);
    s("a_des",    L.a_des());
    s("a_cr",     o.a_cr);
    s("a_sv",     o.a_sv);
    s("mode",     o.mode);
    s("I",        o.I);
    s("v_set",    L.scenario().v_set(L.t()));
    s("e_v",      o.e_v);
    s("d",        L.d());
    s("d_ref",    o.d_ref);
    s("e_s",      o.e_s);
    s("target",   L.target());
    s("lead_on",  L.leader_on_lane());
    s("lead_x",   ld.x);
    s("lead_v",   ld.v);
    s("lead_a",   ld.a);
    s("F_t",      car.out().F_t);
    s("F_b",      car.state()[Car::FB]);
    s("F_b_cmd",  car.out().ll.Fb_cmd);
    s("sat_hi",   car.out().ll.sat_hi);
    s("sat_lo",   car.out().ll.sat_lo);
    s("collided", L.collided());
}

template <class Sink>
inline void emit(Sink& s, const Lane<IceVehicle>& L) {
    emit_common(s, L);
    const auto& car = L.car();
    s("theta_th", car.out().ll.theta_th);
    s("p_m",      car.state()[IceVehicle::PM]);
    s("T_e",      car.out().T_e);
    s("rpm",      car.out().rpm);
    s("clutch",   car.engaged());
}

template <class Sink>
inline void emit(Sink& s, const Lane<EvVehicle>& L) {
    emit_common(s, L);
    const auto& car = L.car();
    s("i_a",      car.state()[EvVehicle::IA]);
    s("i_ref",    car.out().ll.i_ref_s);
    s("D",        car.out().D);
    s("V_c",      car.out().V_c);
    s("rpm",      car.out().rpm);
    s("P_bat",    car.out().P_bat);
    s("E_bat",    car.state()[EvVehicle::EBAT]);
}

} // namespace vs