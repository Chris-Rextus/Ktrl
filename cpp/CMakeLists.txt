cmake_minimum_required(VERSION 3.16)
project(vehicle_sim_cpp LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_executable(vehicle_sim src/main.cpp)
target_include_directories(vehicle_sim PRIVATE include)

if(MSVC)
  target_compile_options(vehicle_sim PRIVATE /W4)
else()
  target_compile_options(vehicle_sim PRIVATE -Wall -Wextra -Wpedantic)
endif()