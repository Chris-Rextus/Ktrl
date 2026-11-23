#include "config.hpp"

#include <algorithm>
#include <cctype>
#include <fstream>
#include <sstream>
#include <stdexcept>

namespace {

std::string trim(const std::string& s) {
    const auto b = s.find_first_not_of(" \t\r\n");
    if (b == std::string::npos) return "";
    const auto e = s.find_last_not_of(" \t\r\n");
    return s.substr(b, e - b + 1);
}

std::string lower(std::string s) {
    std::transform(s.begin(), s.end(), s.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return s;
}

std::string strip_comment(const std::string& line) {
    const auto p = line.find_first_of("#;");
    return p == std::string::npos ? line : line.substr(0, p);
}

} // namespace

Config Config::load(const std::string& path) {
    std::ifstream in(path);
    if (!in) throw std::runtime_error("cannot open config file: " + path);

    Config cfg;
    cfg.path_ = path;

    std::string line, section;
    int lineno = 0;
    while (std::getline(in, line)) {
        ++lineno;
        const std::string s = trim(strip_comment(line));
        if (s.empty()) continue;

        const auto here = path + ":" + std::to_string(lineno) + ": ";

        if (s.front() == '[') {
            if (s.back() != ']' || s.size() < 3)
                throw std::runtime_error(here + "malformed section header '" + s + "'");
            section = trim(s.substr(1, s.size() - 2));
            continue;
        }

        const auto eq = s.find('=');
        if (eq == std::string::npos)
            throw std::runtime_error(here + "expected 'key = value', got '" + s + "'");

        const std::string k = trim(s.substr(0, eq));
        const std::string v = trim(s.substr(eq + 1));
        if (k.empty()) throw std::runtime_error(here + "empty key");
        if (v.empty()) throw std::runtime_error(here + "empty value for '" + k + "'");

        const std::string full = section.empty() ? k : section + "." + k;
        if (cfg.values_.count(full))
            throw std::runtime_error(here + "duplicate key '" + full + "' (first at line " +
                                     std::to_string(cfg.where_.at(full).line) + ")");

        cfg.values_[full] = v;
        cfg.where_[full] = {lineno};
    }
    return cfg;
}

bool Config::has(const std::string& key) const { return values_.count(key) != 0; }

void Config::fail(const std::string& key, const std::string& msg) const {
    std::ostringstream os;
    os << path_;
    if (auto it = where_.find(key); it != where_.end()) os << ":" << it->second.line;
    os << ": '" << key << "': " << msg;
    throw std::runtime_error(os.str());
}

const std::string& Config::raw(const std::string& key) const {
    auto it = values_.find(key);
    if (it == values_.end()) fail(key, "missing required key");
    used_.insert(key);
    return it->second;
}

double Config::get_double(const std::string& key) const {
    const std::string& v = raw(key);
    try {
        std::size_t n = 0;
        const double d = std::stod(v, &n);
        if (n != v.size()) fail(key, "not a number: '" + v + "'");
        return d;
    } catch (const std::invalid_argument&) {
        fail(key, "not a number: '" + v + "'");
    } catch (const std::out_of_range&) {
        fail(key, "number out of range: '" + v + "'");
    }
}

int Config::get_int(const std::string& key) const {
    const std::string& v = raw(key);
    try {
        std::size_t n = 0;
        const int i = std::stoi(v, &n);
        if (n != v.size()) fail(key, "not an integer: '" + v + "'");
        return i;
    } catch (const std::invalid_argument&) {
        fail(key, "not an integer: '" + v + "'");
    } catch (const std::out_of_range&) {
        fail(key, "integer out of range: '" + v + "'");
    }
}

bool Config::get_bool(const std::string& key) const {
    const std::string v = lower(raw(key));
    if (v == "true" || v == "yes" || v == "on" || v == "1") return true;
    if (v == "false" || v == "no" || v == "off" || v == "0") return false;
    fail(key, "not a boolean: '" + v + "' (use true/false)");
}

std::string Config::get_string(const std::string& key) const { return raw(key); }

double Config::get_double(const std::string& key, double def) const {
    return has(key) ? get_double(key) : def;
}
int Config::get_int(const std::string& key, int def) const {
    return has(key) ? get_int(key) : def;
}
bool Config::get_bool(const std::string& key, bool def) const {
    return has(key) ? get_bool(key) : def;
}
std::string Config::get_string(const std::string& key, const std::string& def) const {
    return has(key) ? get_string(key) : def;
}

std::vector<std::string> Config::unused_keys() const {
    std::vector<std::string> out;
    for (const auto& [k, v] : values_)
        if (!used_.count(k)) out.push_back(k);
    return out;
}