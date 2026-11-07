// Minimal WASI preview1 imports for tracer.wasm (browser workers and Node).
//
// Only what the tracer's libc actually calls is implemented:
//   - fd_write: stdout/stderr lines go to the `log` callback (console by default)
//   - a read-only in-memory file system: one preopened directory "." whose
//     files are the `files` map ({ "assets/textures/x.png": Uint8Array }), so
//     the tracer's own fopen()/stb_image loading code runs unchanged
//   - proc_exit throws WasiExit; clock_time_get, random_get, args/environ stubs
// Anything else returns ENOSYS.

const ESUCCESS = 0, EBADF = 8, EINVAL = 28, ENOENT = 44, ENOSYS = 52, EISDIR = 31;
const FILETYPE_CHAR = 2, FILETYPE_DIR = 3, FILETYPE_FILE = 4;
const PREOPEN_FD = 3;
const RIGHTS_ALL = 0x1fffffffn;

export class WasiExit extends Error {
  constructor(code) {
    super(`wasm exited with code ${code}`);
    this.code = code;
  }
}

/**
 * @param {{ files?: Record<string, Uint8Array>, log?: (stream: 1|2, line: string) => void }} opts
 * @returns {{ imports: { wasi_snapshot_preview1: object }, setMemory(m: WebAssembly.Memory): void }}
 */
export function createWasi({ files = {}, log } = {}) {
  let memory = null;
  const out = { 1: "", 2: "" };
  const emit = log || ((fd, line) => (fd === 2 ? console.warn : console.log)("[tracer]", line));
  const decoder = new TextDecoder();
  const open = new Map();  // fd -> { data: Uint8Array, pos: number }
  let nextFd = PREOPEN_FD + 1;

  const view = () => new DataView(memory.buffer);
  const bytes = () => new Uint8Array(memory.buffer);
  const normalize = (p) => p.replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/^\/+/, "");

  function iovecs(iovs, count) {
    const dv = view();
    const list = [];
    for (let i = 0; i < count; i++) {
      list.push([dv.getUint32(iovs + i * 8, true), dv.getUint32(iovs + i * 8 + 4, true)]);
    }
    return list;
  }

  const wasi = {
    args_sizes_get(argc, bufSize) {
      const dv = view();
      dv.setUint32(argc, 0, true);
      dv.setUint32(bufSize, 0, true);
      return ESUCCESS;
    },
    args_get() { return ESUCCESS; },
    environ_sizes_get(count, bufSize) {
      const dv = view();
      dv.setUint32(count, 0, true);
      dv.setUint32(bufSize, 0, true);
      return ESUCCESS;
    },
    environ_get() { return ESUCCESS; },

    clock_res_get(_id, res) {
      view().setBigUint64(res, 1000n, true);
      return ESUCCESS;
    },
    clock_time_get(id, _precision, time) {
      const ms = id === 0 ? Date.now() : performance.now();
      view().setBigUint64(time, BigInt(Math.round(ms * 1e6)), true);
      return ESUCCESS;
    },
    random_get(buf, len) {
      crypto.getRandomValues(new Uint8Array(memory.buffer, buf, len));
      return ESUCCESS;
    },
    proc_exit(code) {
      throw new WasiExit(code);
    },
    sched_yield() { return ESUCCESS; },

    fd_write(fd, iovs, iovsLen, nwritten) {
      if (fd !== 1 && fd !== 2) return EBADF;
      let total = 0;
      for (const [ptr, len] of iovecs(iovs, iovsLen)) {
        out[fd] += decoder.decode(bytes().subarray(ptr, ptr + len));
        total += len;
      }
      let nl;
      while ((nl = out[fd].indexOf("\n")) >= 0) {
        emit(fd, out[fd].slice(0, nl));
        out[fd] = out[fd].slice(nl + 1);
      }
      view().setUint32(nwritten, total, true);
      return ESUCCESS;
    },

    fd_fdstat_get(fd, ptr) {
      let type;
      if (fd <= 2) type = FILETYPE_CHAR;
      else if (fd === PREOPEN_FD) type = FILETYPE_DIR;
      else if (open.has(fd)) type = FILETYPE_FILE;
      else return EBADF;
      const dv = view();
      dv.setUint8(ptr, type);
      dv.setUint16(ptr + 2, 0, true);
      dv.setBigUint64(ptr + 8, RIGHTS_ALL, true);
      dv.setBigUint64(ptr + 16, RIGHTS_ALL, true);
      return ESUCCESS;
    },
    fd_fdstat_set_flags() { return ESUCCESS; },

    fd_prestat_get(fd, ptr) {
      if (fd !== PREOPEN_FD) return EBADF;
      const dv = view();
      dv.setUint8(ptr, 0);  // preopentype dir
      dv.setUint32(ptr + 4, 1, true);  // strlen(".")
      return ESUCCESS;
    },
    fd_prestat_dir_name(fd, ptr, len) {
      if (fd !== PREOPEN_FD) return EBADF;
      if (len < 1) return EINVAL;
      bytes()[ptr] = 0x2e;  // "."
      return ESUCCESS;
    },

    path_open(dirFd, _dirflags, pathPtr, pathLen, oflags, _rightsBase, _rightsInh, _fdflags, fdOut) {
      if (dirFd !== PREOPEN_FD) return EBADF;
      const path = normalize(decoder.decode(bytes().slice(pathPtr, pathPtr + pathLen)));
      if (oflags & 0x2) return EISDIR;          // O_DIRECTORY: no directories here
      if (oflags & (0x1 | 0x8)) return ENOSYS;  // O_CREAT / O_TRUNC: read-only fs
      const data = files[path];
      if (!data) return ENOENT;
      const fd = nextFd++;
      open.set(fd, { data, pos: 0 });
      view().setUint32(fdOut, fd, true);
      return ESUCCESS;
    },
    fd_read(fd, iovs, iovsLen, nread) {
      const f = open.get(fd);
      if (!f) return fd === 0 ? (view().setUint32(nread, 0, true), ESUCCESS) : EBADF;
      let total = 0;
      for (const [ptr, len] of iovecs(iovs, iovsLen)) {
        const n = Math.min(len, f.data.length - f.pos);
        if (n <= 0) break;
        bytes().set(f.data.subarray(f.pos, f.pos + n), ptr);
        f.pos += n;
        total += n;
        if (n < len) break;
      }
      view().setUint32(nread, total, true);
      return ESUCCESS;
    },
    fd_seek(fd, offset, whence, newOffset) {
      const f = open.get(fd);
      if (!f) return EBADF;
      const base = whence === 0 ? 0 : whence === 1 ? f.pos : f.data.length;
      const pos = base + Number(offset);
      if (pos < 0) return EINVAL;
      f.pos = pos;
      view().setBigUint64(newOffset, BigInt(pos), true);
      return ESUCCESS;
    },
    fd_tell(fd, ptr) {
      const f = open.get(fd);
      if (!f) return EBADF;
      view().setBigUint64(ptr, BigInt(f.pos), true);
      return ESUCCESS;
    },
    fd_filestat_get(fd, ptr) {
      const f = open.get(fd);
      if (!f) return EBADF;
      const dv = view();
      for (let i = 0; i < 64; i += 8) dv.setBigUint64(ptr + i, 0n, true);
      dv.setUint8(ptr + 16, FILETYPE_FILE);
      dv.setBigUint64(ptr + 32, BigInt(f.data.length), true);
      return ESUCCESS;
    },
    fd_close(fd) {
      if (fd <= PREOPEN_FD) return ESUCCESS;
      return open.delete(fd) ? ESUCCESS : EBADF;
    },
  };

  // Unknown imports resolve to an ENOSYS stub instead of failing instantiation.
  const imports = new Proxy(wasi, {
    get: (target, name) => (name in target ? target[name] : () => ENOSYS),
  });

  return {
    imports: { wasi_snapshot_preview1: imports },
    setMemory(m) { memory = m; },
    /** Flushes partial stdout/stderr lines (e.g. an abort message without "\n"). */
    flush() {
      for (const fd of [1, 2]) if (out[fd]) { emit(fd, out[fd]); out[fd] = ""; }
    },
  };
}
