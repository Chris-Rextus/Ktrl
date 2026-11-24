#include "runner.hpp"
#include "config.hpp"
#include "columns.hpp"
#include "presets.hpp"

#include <atomic>
#include <cctype>
#include <cmath>
#include <csignal>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <thread>

namespace vs {

namespace {

std::atomic<bool> g_stop_requested{false};

constexpr double POLL_PERIOD_S   = 0.1;   // config file check (wall clock)
constexpr double STATUS_PERIOD_S = 0.1;   // status file refresh (wall clock)

double secs(std::chrono::steady_clock::duration d) {
    return std::chrono::duration<double>(d).count();
}

std::string lower(std::string s) {
    for (auto& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return s;
}

} // namespace

void Runner::request_stop() { g_stop_requested = true; }

Runner::Runner(std::string cfg_path, bool force_fast)
    : cfg_path_(std::move(cfg_path)), force_fast_(force_fast) {}

Runner::~Runner() {
    if (out_) std::fclose(out_);
}

double Runner::sim_t() const {
    if (ice_) return ice_->t();
    if (ev_)  return ev_->t();
    return 0.0;
}

bool Runner::finished() const {
    return p_.sim.duration > 0.0 && sim_t() >= p_.sim.duration - 1e-9;
}

// ------------------------------------------------------------------ (re)start
void Runner::start_run() {
    const Config cfg = Config::load(cfg_path_);
    p_ = Params::from_config(cfg);

    for (const auto& k : cfg.unused_keys())
        if (k.rfind("runtime.", 0) != 0)
            std::cerr << "warning: unused config key '" << k << "' (typo?)\n";
    std::cerr << "scenario " << p_.scn.preset << ": " << preset_description(p_.scn.preset)
              << " (";
    if (p_.sim.endless) std::cerr << "endless)\n";
    else std::cerr << p_.sim.duration << " s)\n";

    ice_.reset();
    ev_.reset();
    if (p_.sim.vehicle == "ice" || p_.sim.vehicle == "both") {
        ice_ = std::make_unique<Lane<IceVehicle>>(p_, "ice");
        ice_->reset();
    }
    if (p_.sim.vehicle == "ev" || p_.sim.vehicle == "both") {
        ev_ = std::make_unique<Lane<EvVehicle>>(p_, "ev");
        ev_->reset();
    }

    status_path_ = std::filesystem::path(p_.out.file).replace_extension("").string() + "_status.txt";
    ++run_id_;
    lines_ = 0;

    // runtime section: start from a clean slate, then apply what is in the file
    paused_ = false;
    stop_ = false;
    restart_ = false;
    rt_factor_ = force_fast_ ? 0.0 : p_.sim.realtime_factor;
    if (p_.sim.endless && rt_factor_ <= 0.0) {
        // an endless run as fast as possible would fill the disk
        std::cerr << "note: endless run - realtime_factor 0 (or --fast) replaced by 1\n";
        rt_factor_ = 1.0;
    }
    runtime_seen_.clear();
    apply_runtime(cfg, /*first=*/true);
    cfg_mtime_ = std::filesystem::last_write_time(cfg_path_);

    if (out_) std::fclose(out_);
    out_ = std::fopen(p_.out.file.c_str(), "w");           // truncate: new run
    if (!out_) throw std::runtime_error("cannot open output file " + p_.out.file);
    write_header();
    write_line();                                          // t = 0
    rebase_clock();
    write_status("running", "run started");
}

// ------------------------------------------------------------------ main loop
int Runner::run() {
    try {
        start_run();
    } catch (const std::exception& e) {
        std::cerr << "error: " << e.what() << "\n";
        if (!status_path_.empty()) write_status("error", e.what());
        return 1;
    }
    std::cerr << "running: output " << p_.out.file << ", status " << status_path_
              << ", Ctrl-C to stop\n";

    while (true) {
        if (g_stop_requested) stop_ = true;
        poll_config();

        if (stop_) { write_status("stopped", "stop requested"); break; }

        if (restart_) {
            try {
                start_run();
                std::cerr << "restarted (run " << run_id_ << ")\n";
            } catch (const std::exception& e) {
                // keep the old run alive, report the problem
                restart_ = false;
                write_status("error", std::string("restart failed: ") + e.what());
                std::cerr << "restart failed: " << e.what() << "\n";
            }
            continue;
        }

        if (finished()) {
            if (p_.sim.on_finish == "exit") { write_status("done", "duration reached"); break; }
            if (secs(clock::now() - last_status_) >= STATUS_PERIOD_S)
                write_status("waiting", "duration reached; change runtime.restart_id or set stop");
            std::this_thread::sleep_for(std::chrono::milliseconds(50));
            continue;
        }

        if (paused_) {
            if (secs(clock::now() - last_status_) >= STATUS_PERIOD_S) write_status("paused");
            std::this_thread::sleep_for(std::chrono::milliseconds(20));
            rebase_clock();
            continue;
        }

        advance_one_period();
        write_line();

        // pacing
        if (rt_factor_ > 0.0) {
            const auto target = wall0_ + std::chrono::duration_cast<clock::duration>(
                                    std::chrono::duration<double>((sim_t() - sim0_) / rt_factor_));
            const auto now = clock::now();
            if (target > now) {
                std::this_thread::sleep_until(target);
                lag_ = 0.0;
            } else {
                lag_ = secs(now - target);
                if (lag_ > 1.0) rebase_clock();        // fell far behind: do not try to catch up
            }
        }
        if (secs(clock::now() - last_status_) >= STATUS_PERIOD_S) write_status("running");
    }

    if (out_) { std::fclose(out_); out_ = nullptr; }
    return 0;
}

void Runner::advance_one_period() {
    if (ice_) for (int k = 0; k < p_.disc.n_out_ice; ++k) ice_->step();
    if (ev_)  for (int k = 0; k < p_.disc.n_out_ev;  ++k) ev_->step();
}

void Runner::rebase_clock() {
    wall0_ = clock::now();
    sim0_  = sim_t();
}

// ------------------------------------------------------------------ output
void Runner::write_header() {
    std::fprintf(out_, "# vehicle_sim output v1\n");
    std::fprintf(out_, "# run_id = %ld\n", run_id_);
    std::fprintf(out_, "# vehicles =%s%s\n", ice_ ? " ice" : "", ev_ ? " ev" : "");
    std::fprintf(out_, "# period = %.9g\n", p_.out.period);
    std::fprintf(out_, "# duration = %.9g\n", p_.sim.duration);
    std::fprintf(out_, "# L_veh = %.9g\n", p_.lead.L_veh);
    std::fprintf(out_, "# scenario = %s\n", p_.scn.preset.c_str());
    std::fprintf(out_, "# units: SI (m, m/s, m/s2, N, N.m, Pa, rad, A, V, W, J); "
                       "flags 0/1; mode 0 = cruise, 1 = follow\n");
    NameSink names;
    names("t", 0.0);
    if (ice_) { names.prefix = "ice_"; emit(names, *ice_); }
    if (ev_)  { names.prefix = "ev_";  emit(names, *ev_); }
    std::fprintf(out_, "%s\n", names.line.c_str());
    std::fflush(out_);
}

void Runner::write_line() {
    ValueSink vals;
    vals("t", sim_t());
    if (ice_) emit(vals, *ice_);
    if (ev_)  emit(vals, *ev_);
    vals.line += '\n';
    std::fputs(vals.line.c_str(), out_);
    if (p_.out.flush_each_line) std::fflush(out_);
    ++lines_;
}

void Runner::write_status(const std::string& state, const std::string& msg) {
    if (!msg.empty()) last_msg_ = msg;
    const std::string tmp = status_path_ + ".tmp";
    {
        std::ofstream f(tmp, std::ios::trunc);
        if (!f) return;
        f << "state = " << state << "\n"
          << "run_id = " << run_id_ << "\n"
          << "t = " << sim_t() << "\n"
          << "duration = " << p_.sim.duration << "\n"
          << "realtime_factor = " << rt_factor_ << "\n"
          << "lag = " << lag_ << "\n"
          << "lines = " << lines_ << "\n"
          << "output = " << p_.out.file << "\n"
          << "message = " << (last_msg_.empty() ? "-" : last_msg_) << "\n";
    }
    std::error_code ec;
    std::filesystem::rename(tmp, status_path_, ec);   // atomic on POSIX
    last_status_ = clock::now();
}

// ------------------------------------------------------------------ live config
void Runner::poll_config(bool force) {
    const auto now = clock::now();
    if (!force && secs(now - last_poll_) < POLL_PERIOD_S) return;
    last_poll_ = now;

    std::error_code ec;
    const auto mt = std::filesystem::last_write_time(cfg_path_, ec);
    if (ec || mt == cfg_mtime_) return;

    try {
        const Config cfg = Config::load(cfg_path_);
        apply_runtime(cfg, /*first=*/false);
        cfg_mtime_ = mt;                       // only after a successful parse
    } catch (const std::exception& e) {
        // probably caught the file half-written: retry at the next poll
        last_msg_ = std::string("config reload failed: ") + e.what();
    }
}

// [runtime] keys (all optional). A key is applied at start and whenever its
// text changes in the file. Physics constants are only re-read on restart.
void Runner::apply_runtime(const Config& c, bool first) {
    auto changed = [&](const std::string& key) {
        const std::string full = "runtime." + key;
        if (!c.has(full)) {
            runtime_seen_.erase(key);          // removed: re-adding applies again
            return false;
        }
        const std::string raw = c.get_string(full);
        auto it = runtime_seen_.find(key);
        if (it != runtime_seen_.end() && it->second == raw) return false;
        runtime_seen_[key] = raw;
        return true;
    };
    auto for_lanes = [&](auto&& fn) {
        if (ice_) fn(*ice_);
        if (ev_)  fn(*ev_);
    };
    std::string applied;
    auto note = [&](const std::string& k) { applied += (applied.empty() ? "" : ", ") + k; };

    // stop is edge-triggered: a 'stop = true' left in the file at start is ignored
    if (changed("stop") && !first && c.get_bool("runtime.stop")) { stop_ = true; note("stop"); }
    if (changed("pause")) { paused_ = c.get_bool("runtime.pause"); note("pause"); }

    if (changed("restart_id")) {
        const long id = c.get_int("runtime.restart_id");
        if (first) restart_id_ = id;           // value at start is the baseline
        else if (id != restart_id_) { restart_id_ = id; restart_ = true; note("restart"); }
    }

    if (changed("realtime_factor") && !force_fast_) {
        rt_factor_ = std::max(0.0, c.get_double("runtime.realtime_factor"));
        if (p_.sim.endless && rt_factor_ <= 0.0) rt_factor_ = 1.0;   // see start_run
        rebase_clock();
        note("realtime_factor");
    }

    if (changed("v_set")) {
        const std::string raw = lower(c.get_string("runtime.v_set"));
        std::optional<double> v;
        if (raw != "scenario") v = c.get_double("runtime.v_set");
        for_lanes([&](auto& L) { L.scenario().set_v_set_override(v); });
        note("v_set");
    }
    if (changed("leader_accel")) {
        const std::string raw = lower(c.get_string("runtime.leader_accel"));
        std::optional<double> a;
        if (raw != "scenario") a = c.get_double("runtime.leader_accel");
        for_lanes([&](auto& L) { L.scenario().set_lead_override(a); });
        note("leader_accel");
    }

    // controller gains (live)
    for (const char* k : {"k_p", "k_i", "h", "lambda", "d0", "d_set"}) {
        if (!changed(k)) continue;
        const double val = c.get_double(std::string("runtime.") + k);
        for_lanes([&](auto& L) {
            auto& g = L.ctrl().gains();
            if      (std::string(k) == "k_p")    g.k_p = val;
            else if (std::string(k) == "k_i")    g.k_i = val;
            else if (std::string(k) == "h")      g.h = std::max(val, 0.05);
            else if (std::string(k) == "lambda") g.lambda = val;
            else if (std::string(k) == "d0")     g.d0 = val;
            else if (std::string(k) == "d_set")  g.d_set = std::max(val, 0.5);
        });
        note(k);
    }
    if (changed("spacing")) {
        const std::string sp = lower(c.get_string("runtime.spacing"));
        if (sp == "fixed" || sp == "time_gap") {
            for_lanes([&](auto& L) { L.ctrl().gains().fixed_spacing = sp == "fixed"; });
            note("spacing");
        } else {
            last_msg_ = "runtime.spacing must be time_gap | fixed";
        }
    }

    // road grade (disturbance): lanes read p_ by reference
    if (changed("beta")) { p_.env.beta = c.get_double("runtime.beta"); note("beta"); }

    if (!applied.empty()) {
        last_msg_ = "runtime: " + applied;
        if (!first) std::cerr << last_msg_ << " (t = " << sim_t() << ")\n";
    }
}

} // namespace vs