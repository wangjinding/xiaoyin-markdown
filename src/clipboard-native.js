/* Windows 原生文件剪贴板：通过 Win32 CF_HDROP 把文件对象放进系统剪贴板，
   效果等同于在资源管理器里选中文件按 Ctrl+C（可以在别处 Ctrl+V 粘出文件副本）。
   Electron 45 的 clipboard API 没有 writeBuffer，只能走 Win32。 */
let api = null;

function makeHdrop(paths) {
  const header = Buffer.alloc(20);
  header.writeUInt32LE(20, 0);       // pFiles：文件列表相对结构头的偏移
  // pt(8 字节) 与 fNC(4 字节) 留 0
  header.writeUInt32LE(1, 16);       // fWide = TRUE（UTF-16LE 路径）
  const parts = paths.map((p) => Buffer.from(String(p) + '\0', 'utf16le'));
  return Buffer.concat([header, ...parts, Buffer.from([0, 0])]); // 双 \0 结束
}

function getApi() {
  if (api) return api;
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');

  const OpenClipboard = user32.func('bool OpenClipboard(void* hWnd)');
  const EmptyClipboard = user32.func('bool EmptyClipboard()');
  const SetClipboardData = user32.func('void* SetClipboardData(unsigned int uFormat, void* hMem)');
  const CloseClipboard = user32.func('bool CloseClipboard()');
  const IsClipboardFormatAvailable = user32.func('bool IsClipboardFormatAvailable(unsigned int format)');
  const GlobalAlloc = kernel32.func('void* GlobalAlloc(unsigned int uFlags, size_t dwBytes)');
  const GlobalLock = kernel32.func('void* GlobalLock(void* hMem)');
  const GlobalUnlock = kernel32.func('bool GlobalUnlock(void* hMem)');
  const RtlMoveMemory = kernel32.func('void RtlMoveMemory(void* dst, void* src, size_t len)');

  function setFiles(paths) {
    const data = makeHdrop(paths);
    const h = GlobalAlloc(0x0002, data.length); // GMEM_MOVEABLE
    if (!h) throw new Error('内存分配失败');
    const p = GlobalLock(h);
    RtlMoveMemory(p, koffi.as(data, 'void*'), data.length);
    GlobalUnlock(h);

    if (!OpenClipboard(null)) throw new Error('无法打开剪贴板');
    try {
      EmptyClipboard();
      if (!SetClipboardData(15, h)) throw new Error('写入剪贴板失败'); // CF_HDROP
    } finally {
      CloseClipboard();
    }
    return true;
  }

  function hasFiles() {
    return !!IsClipboardFormatAvailable(15);
  }

  api = { setFiles, hasFiles };
  return api;
}

module.exports = {
  setFiles: (paths) => getApi().setFiles(paths),
  hasFiles: () => getApi().hasFiles()
};
