cmake_minimum_required(VERSION 3.15)
project(dupfinder_backend CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(MSVC)
    add_compile_options(/O2 /W4)
else()
    add_compile_options(-O3 -Wall -Wextra)
endif()

add_executable(dupfinder_backend src/main.cpp)
target_include_directories(dupfinder_backend PRIVATE include)

find_package(Threads REQUIRED)
target_link_libraries(dupfinder_backend PRIVATE Threads::Threads)

if(WIN32)
    # ws2_32 and crypt32 are gone: they were httplib's socket/TLS
    # dependencies, and there is no HTTP server anymore. ole32 stays --
    # SHFileOperationW (recycle-bin delete in trash.hpp) uses COM.
    target_link_libraries(dupfinder_backend PRIVATE ole32)
endif()

# --- Build instructions ---
# macOS / Linux:
#   cmake -B build -DCMAKE_BUILD_TYPE=Release
#   cmake --build build --config Release
#   -> build/dupfinder_backend
#
# Windows (with Visual Studio installed):
#   cmake -B build -DCMAKE_BUILD_TYPE=Release
#   cmake --build build --config Release
#   -> build\Release\dupfinder_backend.exe
#
# Quick standalone test of any op (no Tauri needed):
#   dupfinder_backend trial-status
#   echo {"key":"...."} | dupfinder_backend activate-license
#   echo {"path":"C:\\Users\\me","min_size_kb":1} | dupfinder_backend scan
