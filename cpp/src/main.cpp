#include "config.hpp"
#include "params.hpp"
#include "runner.hpp"
#include "tests.hpp"

#include <boost/version.hpp>

#include <csignal>
#include <cstring>
#include <iostream>

static void usage(const char* exe) {
    std::cerr << "usage: " << exe << " [config.txt] [options]\n"
              << "  config.txt   parameters file (default: sim_config.txt)\n"
              << "  (no option)  run the simulation, streaming to the output file\n"
              << "  --fast       run as fast as possible (ignores realtime_factor)\n"
              << "  --print      print the parameters and exit\n"
              << "  --selftest   compare derived constants with the document\n"
              << "  --test-ice   ICE trim / step / AEB validation runs (§6.2, §6.4)\n"
              << "  --test-ev    EV trim / step / AEB / energy validation runs (§6.2-§6.6)\n"
              << "  --test-loop  closed loop: T0 overshoot, S2 following, S3 leader braking\n"
              << "  --test-all   all tests\n";
}

static void on_signal(int) { vs::Runner::request_stop(); }

int main(int argc, char** argv) {
    std::string cfg_path = "sim_config.txt";
    bool selftest = false, test_ice = false, test_ev = false, test_loop = false;
    bool fast = false, print = false;

    for (int i = 1; i < argc; ++i) {
        const char* a = argv[i];
        if      (!std::strcmp(a, "--selftest"))  selftest = true;
        else if (!std::strcmp(a, "--test-ice"))  test_ice = true;
        else if (!std::strcmp(a, "--test-ev"))   test_ev = true;
        else if (!std::strcmp(a, "--test-loop")) test_loop = true;
        else if (!std::strcmp(a, "--test-all"))  selftest = test_ice = test_ev = test_loop = true;
        else if (!std::strcmp(a, "--fast"))      fast = true;
        else if (!std::strcmp(a, "--print"))     print = true;
        else if (!std::strcmp(a, "--help"))      { usage(argv[0]); return 0; }
        else if (a[0] == '-')                    { usage(argv[0]); return 2; }
        else                                     cfg_path = a;
    }

    const bool testing = selftest || test_ice || test_ev || test_loop;

    if (testing || print) {
        try {
            const Config cfg = Config::load(cfg_path);
            const vs::Params p = vs::Params::from_config(cfg);
            std::cout << "vehicle_sim (Boost " << BOOST_LIB_VERSION << ")  config: "
                      << cfg.path() << "\n";
            vs::print_params(p, std::cout);
            int fails = 0;
            if (selftest)  { std::cout << "\n"; fails += vs::selftest_params(p, std::cout); }
            if (test_ice)  { std::cout << "\n"; fails += vs::test_ice(p, std::cout); }
            if (test_ev)   { std::cout << "\n"; fails += vs::test_ev(p, std::cout); }
            if (test_loop) { std::cout << "\n"; fails += vs::test_loop(p, std::cout); }
            return fails == 0 ? 0 : 1;
        } catch (const std::exception& e) {
            std::cerr << "error: " << e.what() << "\n";
            return 1;
        }
    }

    std::signal(SIGINT, on_signal);
    std::signal(SIGTERM, on_signal);
    vs::Runner runner(cfg_path, fast);
    return runner.run();
}