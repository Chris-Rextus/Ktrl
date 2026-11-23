#pragma once
// Pure delay of n samples (circular buffer), §5 / §12.5.
// push(x) stores x and returns the value pushed n calls earlier.
// With n = 0 it returns x unchanged.

#include <vector>

namespace vs {

template <class T>
class DelayLine {
public:
    DelayLine() = default;
    DelayLine(int n, const T& init) { reset(n, init); }

    void reset(int n, const T& init) {
        buf_.assign(n > 0 ? static_cast<std::size_t>(n) : 0, init);
        idx_ = 0;
    }

    T push(const T& x) {
        if (buf_.empty()) return x;
        T out = buf_[idx_];
        buf_[idx_] = x;
        idx_ = (idx_ + 1) % buf_.size();
        return out;
    }

    // Value that the next push() will return (oldest sample), without modifying.
    const T& oldest() const { return buf_[idx_]; }
    int size() const { return static_cast<int>(buf_.size()); }

private:
    std::vector<T> buf_;
    std::size_t idx_ = 0;
};

} // namespace vs