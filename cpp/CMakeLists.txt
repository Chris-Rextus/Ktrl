cmake_minimum_required(VERSION 3.16)
project(vehicle_sim LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

find_package(Boost 1.70 REQUIRED CONFIG)
find_package(Threads REQUIRED)

add_executable(vehicle_sim
  src/main.cpp
  src/config.cpp
  src/params.cpp
  src/presets.cpp
  src/ice_vehicle.cpp
  src/ev_vehicle.cpp
  src/upper_controller.cpp
  src/runner.cpp
  src/batch.cpp
  src/analysis.cpp
  src/tests.cpp
)

target_include_directories(vehicle_sim PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)
target_link_libraries(vehicle_sim PRIVATE Boost::headers)
target_compile_options(vehicle_sim PRIVATE -Wall -Wextra -Wpedantic)
target_link_libraries(vehicle_sim PRIVATE Boost::headers Threads::Threads)