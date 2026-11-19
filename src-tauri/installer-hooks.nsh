; ── 小银 Markdown NSIS 安装钩子 ────────────────────────────────────────────
; 目标：安装完成后，双击 .md 默认就用小银 Markdown 打开。
;
; 背景：Tauri 的 fileAssociations 会写 HKCU\Software\Classes 下的关联，但 Windows 10/11
; 还有一个带哈希保护的「用户选择」键：
;     HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.md\UserChoice
; 它优先级**最高**，而且不能直接写（哈希由系统算）。但它可以**删** ——
; 删掉之后系统就回落到我们刚写的 HKCU\Software\Classes 关联，等于把默认打开方式交给本程序。
;
; 只动 HKCU（安装模式是 currentUser），不需要管理员权限。

!macro NSIS_HOOK_POSTINSTALL
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.md\UserChoice"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.markdown\UserChoice"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.mdown\UserChoice"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.mkd\UserChoice"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.mdwn\UserChoice"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.txt\UserChoice"

  ; 让资源管理器立刻刷新图标与「打开方式」缓存（SHCNE_ASSOCCHANGED）
  System::Call 'shell32::SHChangeNotify(l 0x08000000, l 0, l 0, l 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; 卸载时一并清掉可能残留的关联（不怕清不到）
  DeleteRegKey HKCU "Software\Classes\.md"
  DeleteRegKey HKCU "Software\Classes\.markdown"
  DeleteRegKey HKCU "Software\Classes\.mdown"
  DeleteRegKey HKCU "Software\Classes\.mkd"
  DeleteRegKey HKCU "Software\Classes\.mdwn"
  DeleteRegKey HKCU "Software\Classes\XiaoyinMarkdown.Document"
  DeleteRegKey HKCU "Software\Classes\XiaoyinMarkdown.Text"
  System::Call 'shell32::SHChangeNotify(l 0x08000000, l 0, l 0, l 0)'
!macroend
