#pragma once
// Lead vehicle (§12.7): point mass with imposed acceleration, v >= 0.
// Integrated exactly for a constant acceleration over each step.

namespace vs {

struct Leader {
    double x = 0.0;     // m   position of the leader's FRONT bumper
    double v = 0.0;     // m/s
    double a = 0.0;     // m/s2 acceleration applied during the last step

    void reset(double x0, double v0) { x = x0; v = v0; a = 0.0; }

    void step(double a_cmd, double dt) {
        a = a_cmd;
        if (v <= 0.0 && a_cmd <= 0.0) { v = 0.0; a = 0.0; return; }      // stopped
        const double v_new = v + a_cmd * dt;
        if (v_new < 0.0) {                       // stops inside the step
            const double t_stop = -v / a_cmd;
            x += v * t_stop + 0.5 * a_cmd * t_stop * t_stop;
            v = 0.0;
            return;
        }
        x += v * dt + 0.5 * a_cmd * dt * dt;
        v = v_new;
    }
};

} // namespace vs