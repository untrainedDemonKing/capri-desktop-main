; Extra steps of Capri's uninstaller (electron-builder includes this file, see "nsis.include" in package.json).
;
; Uninstalling you started yourself (Windows Settings › Apps, or "Uninstall Capri" in the Start menu) asks whether the
; neural networks, voices and tools she downloaded go too. Yes: she is started once without a window
; (Capri.exe --remove-everything) and takes off everything she put on this PC (Ollama models and program she
; installed, Piper, Chatterbox, Node.js...), then her data folder (settings, memory) is deleted. No: nothing but the
; program is removed, as before.
; A silent uninstall (/S, winget) keeps everything unless it is given --remove-everything. An update never asks.

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ClearErrors
    ${GetParameters} $R0
    ${GetOptions} $R0 "/S" $R1
    ${If} ${Errors}
      ; you started it: ask
      MessageBox MB_YESNO|MB_ICONQUESTION "Удалить также всё, что Капри скачала и поставила сама (нейросети, голоса, Python-окружение, Node.js)? Так освободится всё занятое ею место, но настройки и память Капри тоже удалятся.$\r$\n$\r$\nAlso delete everything Capri downloaded and installed (AI models, voices, Python environment, Node.js)? This frees all the space she used, and her settings and memory go too." IDNO capriKeepDownloads
      ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --remove-everything'
      RMDir /r "$APPDATA\${APP_FILENAME}"
      capriKeepDownloads:
    ${Else}
      ; silent: only when asked for
      ClearErrors
      ${GetOptions} $R0 "--remove-everything" $R1
      ${IfNot} ${Errors}
        ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --remove-everything'
      ${EndIf}
    ${EndIf}
  ${endIf}
!macroend
