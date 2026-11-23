#pragma once
// Simple INI-style config reader.
//
// Format:
//   # comment          (also ';', allowed at end of line)
//   [section]
//   key = value
//
// Keys are accessed as "section.key" (case-sensitive).
// Every getter marks the key as used; unused_keys() lists keys present in the
// file but never read (catches typos).

#include <map>
#include <set>
#include <string>
#include <vector>

class Config {
public:
    static Config load(const std::string& path);

    bool has(const std::string& key) const;

    // Required getters: throw std::runtime_error if missing or malformed.
    double      get_double(const std::string& key) const;
    int         get_int(const std::string& key) const;
    bool        get_bool(const std::string& key) const;
    std::string get_string(const std::string& key) const;

    // Optional getters: return `def` if the key is absent.
    double      get_double(const std::string& key, double def) const;
    int         get_int(const std::string& key, int def) const;
    bool        get_bool(const std::string& key, bool def) const;
    std::string get_string(const std::string& key, const std::string& def) const;

    std::vector<std::string> unused_keys() const;
    const std::map<std::string, std::string>& entries() const { return values_; }
    const std::string& path() const { return path_; }

private:
    struct Location { int line; };

    const std::string& raw(const std::string& key) const;   // throws if missing
    [[noreturn]] void fail(const std::string& key, const std::string& msg) const;

    std::string path_;
    std::map<std::string, std::string> values_;
    std::map<std::string, Location> where_;
    mutable std::set<std::string> used_;
};