if(NOT TARGET fbjni::fbjni)
add_library(fbjni::fbjni SHARED IMPORTED)
set_target_properties(fbjni::fbjni PROPERTIES
    IMPORTED_LOCATION "/Users/mihaiarisanu/.gradle/caches/9.0.0/transforms/e2575a32666c9d6ebbf516280d8f962f/transformed/fbjni-0.7.0/prefab/modules/fbjni/libs/android.x86/libfbjni.so"
    INTERFACE_INCLUDE_DIRECTORIES "/Users/mihaiarisanu/.gradle/caches/9.0.0/transforms/e2575a32666c9d6ebbf516280d8f962f/transformed/fbjni-0.7.0/prefab/modules/fbjni/include"
    INTERFACE_LINK_LIBRARIES ""
)
endif()

