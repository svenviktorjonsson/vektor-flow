// Standalone compiler runtime: no host descriptors or environment are exposed.
// This is a capability boundary, not a filesystem implementation. Source and
// diagnostics travel exclusively through the compiler's explicit byte buffers.
#ifdef __EMSCRIPTEN__
#include <cstdint>
#include <wasi/api.h>

extern "C" {
__wasi_errno_t __wasi_fd_close(__wasi_fd_t) {
    return __WASI_ERRNO_NOTCAPABLE;
}
__wasi_errno_t __wasi_fd_read(__wasi_fd_t, const __wasi_iovec_t*,
                            size_t, __wasi_size_t* count) {
    *count = 0;
    return __WASI_ERRNO_NOTCAPABLE;
}
__wasi_errno_t __wasi_fd_write(__wasi_fd_t, const __wasi_ciovec_t*,
                             size_t, __wasi_size_t* count) {
    *count = 0;
    return __WASI_ERRNO_NOTCAPABLE;
}
__wasi_errno_t __wasi_fd_seek(__wasi_fd_t, __wasi_filedelta_t,
                            __wasi_whence_t, __wasi_filesize_t*) {
    return __WASI_ERRNO_NOTCAPABLE;
}
__wasi_errno_t __wasi_environ_sizes_get(__wasi_size_t* count, __wasi_size_t* size) {
    *count = 0;
    *size = 0;
    return 0;
}
__wasi_errno_t __wasi_environ_get(std::uint8_t**, std::uint8_t*) {
    return 0;
}
}
#endif
