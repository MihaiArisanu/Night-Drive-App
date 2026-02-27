if(NOT TARGET hermes-engine::hermesvm)
add_library(hermes-engine::hermesvm SHARED IMPORTED)
set_target_properties(hermes-engine::hermesvm PROPERTIES
    IMPORTED_LOCATION "/Users/mihaiarisanu/.gradle/caches/9.0.0/transforms/2a154e3ea4e67fbf20e53383d94bbdf7/transformed/hermes-android-250829098.0.7-debug/prefab/modules/hermesvm/libs/android.armeabi-v7a/libhermesvm.so"
    INTERFACE_INCLUDE_DIRECTORIES "/Users/mihaiarisanu/.gradle/caches/9.0.0/transforms/2a154e3ea4e67fbf20e53383d94bbdf7/transformed/hermes-android-250829098.0.7-debug/prefab/modules/hermesvm/include"
    INTERFACE_LINK_LIBRARIES ""
)
endif()

