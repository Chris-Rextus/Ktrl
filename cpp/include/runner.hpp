#pragma once
// Real-time runner (§12.9 + streaming):
//   - runs the ICE lane, the EV lane, or both side by side;
//   - paces simulated time against the wall clock (realtime_factor);
//   - appends one line per output period to the output file (flushed);
//   - writes a small status file atomically (tmp + rename);
//   - watches the config file and applies its [runtime] section live
//     (pause, stop, restart, set speed, gains, leader override, grade, speed).
//   - collisions: a lane that collides can freeze (simulation.on_collision);
//     the run ends when every lane has stopped.

#include "ev_vehicle.hpp"
#include "ice_vehicle.hpp"
#include "lane.hpp"
#include "params.hpp"

#include <chrono>
#include <cstdio>
#include <filesystem>
#include <map>
#include <memory>
#include <string>

class Config;

namespace vs {

class Runner {
public:
    explicit Runner(std::string cfg_path, bool force_fast = false);
    ~Runner();

    int run();                        // returns process exit code

    static void request_stop();       // async-signal-safe (SIGINT/SIGTERM)

private:
    using clock = std::chrono::steady_clock;

    void start_run();                 // (re)load everything, reset lanes, new output
    void advance_one_period();        // integrate both lanes by output.period
    void write_header();
    void write_line();
    void write_status(const std::string& state, const std::string& msg = "");
    void poll_config(bool force = false);
    void apply_runtime(const Config& c, bool first);
    void rebase_clock();
    double sim_t() const;
    bool finished() const;
    bool all_stopped() const;         // every lane frozen by a collision
    void report_collisions();         // console + status message, once per lane

    std::string cfg_path_;
    bool force_fast_;
    Params p_;                        // lanes keep a reference: address must not change
    std::unique_ptr<Lane<IceVehicle>> ice_;
    std::unique_ptr<Lane<EvVehicle>>  ev_;

    std::FILE* out_ = nullptr;
    std::string status_path_;
    long run_id_ = 0;
    long lines_ = 0;

    // runtime state
    bool   paused_ = false;
    bool   stop_ = false;
    bool   restart_ = false;
    double rt_factor_ = 1.0;
    long   restart_id_ = 0;
    std::map<std::string, std::string> runtime_seen_;   // last applied raw values
    std::filesystem::file_time_type cfg_mtime_{};
    clock::time_point last_poll_{};
    clock::time_point last_status_{};
    std::string last_msg_;
    bool ice_reported_ = false, ev_reported_ = false;

    // pacing
    clock::time_point wall0_{};
    double sim0_ = 0.0;
    double lag_ = 0.0;                // s of wall time behind schedule
};

} // namespace vs