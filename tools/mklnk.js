/* 生成 Windows .lnk 快捷方式（纯字节拼装，不依赖 COM） */
const fs = require('node:fs');
const path = require('node:path');

function buildLnk({ target, workdir, icon, desc, args }) {
  const isUnicode = true;

  // ---- StringData ----
  const strings = [];
  const pushStr = (s) => {
    if (s == null) return 0;
    const chars = isUnicode ? 2 : 1;
    const buf = Buffer.alloc(2 + s.length * chars);
    buf.writeUInt16LE(s.length, 0);
    if (isUnicode) buf.write(s, 2, 'utf16le');
    else buf.write(s, 2, 'latin1');
    strings.push(buf);
    return 1;
  };

  let flags = 0x00000002 /* HasLinkInfo */ | 0x00000004 /* HasName */;
  const parts = [];
  parts.push(pushStr(desc ? desc : null));                 // NAME_STRING
  if (target) { flags |= 0x00000008; parts.push(pushStr(null)); } // RELATIVE_PATH 占位（用 target）
  if (workdir) { flags |= 0x00000010; parts.push(pushStr(workdir)); }
  if (args) { flags |= 0x00000020; parts.push(pushStr(args)); }
  if (icon) { flags |= 0x00000040; parts.push(pushStr(icon)); }
  if (isUnicode) flags |= 0x00000080;

  // 重新按顺序构建（NAME, RELATIVE_PATH, WORKING_DIR, ARGUMENTS, ICON）
  strings.length = 0;
  const seq = [];
  const add = (s) => {
    const buf = Buffer.alloc(2 + String(s).length * 2);
    buf.writeUInt16LE(String(s).length, 0);
    buf.write(String(s), 2, 'utf16le');
    seq.push(buf);
  };
  if (desc) add(desc);
  if (target) add(target);          // RELATIVE_PATH
  if (workdir) add(workdir);
  if (args) add(args);
  if (icon) add(icon);
  const stringData = Buffer.concat(seq);

  // ---- LinkInfo ----
  const volumeLabel = Buffer.from([0x00]);                       // 空卷标
  const volumeIdHeader = Buffer.alloc(16);
  volumeIdHeader.writeUInt32LE(16 + volumeLabel.length, 0);      // VolumeIDSize
  volumeIdHeader.writeUInt32LE(3, 4);                            // DRIVE_FIXED
  volumeIdHeader.writeUInt32LE(0x12345678, 8);                   // DriveSerialNumber
  volumeIdHeader.writeUInt32LE(0x10, 12);                        // VolumeLabelOffset
  const volumeId = Buffer.concat([volumeIdHeader, volumeLabel]);

  const localBaseAnsi = Buffer.from(target + '\0', 'latin1');
  const suffixAnsi = Buffer.from([0x00]);
  const localBaseUni = Buffer.from(target + '\0', 'utf16le');
  const suffixUni = Buffer.from([0x00, 0x00]);

  const headerSize = 0x24;
  const volumeIdOffset = headerSize;
  const localBaseOffset = volumeIdOffset + volumeId.length;
  const suffixOffset = localBaseOffset + localBaseAnsi.length;
  const localBaseUniOffset = suffixOffset + suffixAnsi.length;
  const suffixUniOffset = localBaseUniOffset + localBaseUni.length;
  const linkInfoSize = suffixUniOffset + suffixUni.length;

  const li = Buffer.alloc(headerSize);
  li.writeUInt32LE(linkInfoSize, 0);
  li.writeUInt32LE(headerSize, 4);
  li.writeUInt32LE(0x00000001, 8);      // VolumeIDAndLocalBasePath
  li.writeUInt32LE(volumeIdOffset, 12);
  li.writeUInt32LE(localBaseOffset, 16);
  li.writeUInt32LE(0, 20);              // CommonNetworkRelativeLinkOffset
  li.writeUInt32LE(suffixOffset, 24);
  li.writeUInt32LE(localBaseUniOffset, 28);
  li.writeUInt32LE(suffixUniOffset, 32);

  const linkInfo = Buffer.concat([li, volumeId, localBaseAnsi, suffixAnsi, localBaseUni, suffixUni]);

  // ---- Header (76 bytes) ----
  const h = Buffer.alloc(76);
  h.writeUInt32LE(0x4c, 0);
  // LinkCLSID {00021401-0000-0000-C000-000000000046}
  Buffer.from('0114020000000000c000000000000046', 'hex').copy(h, 4);
  h.writeUInt32LE(flags, 20);
  h.writeUInt32LE(0x20, 24);            // FILE_ATTRIBUTE_ARCHIVE
  // 28 CreationTime / 36 AccessTime / 44 WriteTime 均留 0
  h.writeUInt32LE(0, 52);               // FileSize
  h.writeUInt32LE(0, 56);               // IconIndex
  h.writeUInt32LE(1, 60);               // ShowCommand = SW_SHOWNORMAL
  h.writeUInt16LE(0, 64);               // HotKey
  h.writeUInt16LE(0, 66);               // Reserved1
  h.writeUInt32LE(0, 68);               // Reserved2
  h.writeUInt32LE(0, 72);               // Reserved3

  return Buffer.concat([h, linkInfo, stringData, Buffer.alloc(4)]); // 末尾 TerminalBlock
}

const target = (process.argv[2] || '').replace(/\//g, '\\');
const out = process.argv[3];
if (!target || !out) {
  console.error('usage: node tools/mklnk.js <target.exe> <out.lnk>');
  process.exit(1);
}
const buf = buildLnk({
  target,
  workdir: path.dirname(target),
  icon: target + ',0',
  desc: '小银 Markdown 编辑器'
});
fs.writeFileSync(out, buf);
console.log('written', out, buf.length, 'bytes');
