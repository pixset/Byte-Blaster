; Дополнения к установщику Byte Blaster.
;
; electron-builder умеет создавать ярлыки, но только молча — либо всегда, либо
; никогда. Игрока об этом никто не спрашивает, а захламлённый рабочий стол
; раздражает. Поэтому штатное создание выключено (createDesktopShortcut и
; createStartMenuShortcut = false), а здесь добавлена страница с двумя
; галочками, и ярлыки создаются по выбору.
;
; Файл подключается автоматически: electron-builder ищет installer.nsh в папке
; ресурсов сборки. Подключается он ДО библиотек NSIS и общих макросов, поэтому
; переменные, функции и тексты объявлены внутри customHeader — этот макрос
; раскрывается уже после всех !include и после подключения языков.

!macro customHeader
  ; Что выбрал игрок. Значение выставляется и в деинсталляторе (общий .onInit),
  ; поэтому переменные объявлены всегда.
  Var MakeDesktopShortcut
  Var MakeStartMenuShortcut

  ; Элементы страницы живут только в установщике: в деинсталляторе
  ; неиспользуемая переменная — предупреждение, а оно приравнено к ошибке.
  !ifndef BUILD_UNINSTALLER
    Var ShortcutsDialog
    Var DesktopCheckbox
    Var StartMenuCheckbox
  !endif

  LangString shortcutsTitle    ${LANG_RUSSIAN} "Ярлыки"
  LangString shortcutsTitle    ${LANG_ENGLISH} "Shortcuts"
  LangString shortcutsSubtitle ${LANG_RUSSIAN} "Выберите, где создать ярлыки Byte Blaster"
  LangString shortcutsSubtitle ${LANG_ENGLISH} "Choose where to create Byte Blaster shortcuts"
  LangString shortcutsIntro    ${LANG_RUSSIAN} "Игру всегда можно запустить из папки установки."
  LangString shortcutsIntro    ${LANG_ENGLISH} "You can always start the game from its install folder."
  LangString shortcutDesktop   ${LANG_RUSSIAN} "Создать ярлык на рабочем столе"
  LangString shortcutDesktop   ${LANG_ENGLISH} "Create a desktop shortcut"
  LangString shortcutStartMenu ${LANG_RUSSIAN} "Добавить в меню «Пуск»"
  LangString shortcutStartMenu ${LANG_ENGLISH} "Add to the Start menu"

  ; Деинсталлятор собирается из этого же скрипта, но страниц выбора там нет —
  ; неиспользуемая функция в нём считается ошибкой сборки.
  !ifndef BUILD_UNINSTALLER

  Function shortcutsPageCreate
    ; При обновлении уже установленной игры спрашивать заново незачем.
    ${if} ${isUpdated}
      Abort
    ${endif}

    !insertmacro MUI_HEADER_TEXT "$(shortcutsTitle)" "$(shortcutsSubtitle)"

    nsDialogs::Create 1018
    Pop $ShortcutsDialog
    ${if} $ShortcutsDialog == error
      Abort
    ${endif}

    ${NSD_CreateLabel} 0 0 100% 24u "$(shortcutsIntro)"
    Pop $0

    ${NSD_CreateCheckbox} 0 32u 100% 12u "$(shortcutDesktop)"
    Pop $DesktopCheckbox
    ${NSD_SetState} $DesktopCheckbox ${BST_CHECKED}

    ${NSD_CreateCheckbox} 0 50u 100% 12u "$(shortcutStartMenu)"
    Pop $StartMenuCheckbox
    ${NSD_SetState} $StartMenuCheckbox ${BST_CHECKED}

    nsDialogs::Show
  FunctionEnd

  Function shortcutsPageLeave
    ${NSD_GetState} $DesktopCheckbox $MakeDesktopShortcut
    ${NSD_GetState} $StartMenuCheckbox $MakeStartMenuShortcut
  FunctionEnd

  !endif
!macroend

!macro customPageAfterChangeDir
  Page custom shortcutsPageCreate shortcutsPageLeave
!macroend

; Значения по умолчанию: при тихой установке и при обновлении страница не
; показывается, а ярлыки всё равно должны появиться.
!macro preInit
  StrCpy $MakeDesktopShortcut ${BST_CHECKED}
  StrCpy $MakeStartMenuShortcut ${BST_CHECKED}
!macroend

; Если игра уже установлена — снимаем её целиком, а потом ставим заново.
;
; Штатное поведение — положить новые файлы поверх старых. Файлы, которых в новой
; версии больше нет, при этом остаются: так в папке копились удалённые ассеты, а
; игра могла подхватить старый файл вместо нового. Чистая переустановка это
; исключает.
;
; Сохранения и настройки не страдают: они лежат в папке данных пользователя, а
; deleteAppDataOnUninstall выключён — деинсталлятор их не трогает.
!macro customInit
  ; Установщик, а не деинсталлятор: в деинсталляторе этих ключей нет.
  !ifndef BUILD_UNINSTALLER
    ReadRegStr $R0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "UninstallString"
    ReadRegStr $R1 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "InstallLocation"
    ${if} $R0 != ""
      ${if} $R1 == ""
        StrCpy $R1 "$INSTDIR"
      ${endif}
      ; _?= заставляет деинсталлятор отработать синхронно, в исходной папке.
      ; Без него ExecWait вернётся сразу, и мы начнём копировать поверх ещё не
      ; удалённых файлов. Путь в _?= не кавычим — так требует NSIS.
      ExecWait '$R0 /S _?=$R1' $R2
      ; При _?= деинсталлятор себя не удаляет — убираем сами, иначе он останется
      ; лежать рядом с новой установкой.
      Delete "$R1\${UNINSTALL_FILENAME}"
      RMDir "$R1"
    ${endif}
  !endif
!macroend

!macro customInstall
  ; При обновлении держимся прежнего выбора игрока, а не ставим ярлыки заново.
  ${if} ${isUpdated}
    ReadRegStr $0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "DesktopShortcut"
    ${if} $0 != ""
      StrCpy $MakeDesktopShortcut $0
    ${endif}
    ReadRegStr $0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "StartMenuShortcut"
    ${if} $0 != ""
      StrCpy $MakeStartMenuShortcut $0
    ${endif}
  ${endif}

  ${if} $MakeDesktopShortcut == ${BST_CHECKED}
    CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  ${else}
    Delete "$newDesktopLink"
  ${endif}

  ${if} $MakeStartMenuShortcut == ${BST_CHECKED}
    !ifdef MENU_FILENAME
      CreateDirectory "$SMPROGRAMS\${MENU_FILENAME}"
      ClearErrors
    !endif
    CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
  ${else}
    Delete "$newStartMenuLink"
  ${endif}

  ; Ярлыки-сироты от прежних установок.
  ;
  ; Штатный перенос старого ярлыка на новое место (setLinkVars → oldStartMenuLink)
  ; работает только вместе со штатным созданием ярлыков, а оно у нас выключено
  ; ради страницы с галочками. Поэтому старый ярлык оставался висеть — и после
  ; переустановки в другую папку указывал в никуда. Windows рисует такой ярлык
  ; белым листом: отсюда и «иконка игры не отображается».
  ${if} $oldStartMenuLink != $newStartMenuLink
    Delete "$oldStartMenuLink"
  ${endif}
  ${if} $oldDesktopLink != $newDesktopLink
    Delete "$oldDesktopLink"
  ${endif}
  ; И прежнее место в обоих контекстах: ярлык мог быть создан «для всех», а
  ; ставим мы теперь «для пользователя», и наоборот. $SMPROGRAMS указывает то в
  ; ProgramData, то в AppData — какой контекст выставлен, тот и читается,
  ; поэтому проходим по обоим и возвращаем контекст установки на место.
  StrCpy $R9 "$SMPROGRAMS"          ; запоминаем контекст установки
  SetShellVarContext all
  Delete "$SMPROGRAMS\${PRODUCT_FILENAME}.lnk"
  SetShellVarContext current
  Delete "$SMPROGRAMS\${PRODUCT_FILENAME}.lnk"
  ; Прочитать текущий контекст в NSIS нельзя, зато видно по самому пути: если
  ; он не совпал с запомненным — установка шла «для всех», возвращаем all.
  ${if} $R9 != "$SMPROGRAMS"
    SetShellVarContext all
  ${endif}

  ; Иконка в «Приложениях и возможностях». По умолчанию electron-builder ставит
  ; сюда картинку деинсталлятора — в списке программ уместнее сама игра.
  WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "DisplayIcon" "$appExe,0"

  ; Запоминаем выбор, чтобы обновление не создало то, от чего игрок отказался,
  ; а удаление знало, что подчищать.
  WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "DesktopShortcut" "$MakeDesktopShortcut"
  WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "StartMenuShortcut" "$MakeStartMenuShortcut"

  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend

; Ярлыки созданы нами, поэтому и убирать их приходится самим: штатный
; деинсталлятор пропускает их, раз штатное создание отключено.
!macro customUnInstall
  ${ifNot} ${isKeepShortcuts}
    WinShell::UninstShortcut "$newDesktopLink"
    Delete "$newDesktopLink"

    WinShell::UninstShortcut "$newStartMenuLink"
    Delete "$newStartMenuLink"
    ; И ярлык прежнего формата — в корне меню, без папки студии. Он мог
    ; остаться от старой версии и после удаления игры вёл бы в пустоту.
    StrCpy $R9 "$SMPROGRAMS"        ; запоминаем контекст удаления
    SetShellVarContext all
    Delete "$SMPROGRAMS\${PRODUCT_FILENAME}.lnk"
    SetShellVarContext current
    Delete "$SMPROGRAMS\${PRODUCT_FILENAME}.lnk"
    ${if} $R9 != "$SMPROGRAMS"
      SetShellVarContext all
    ${endif}
    !ifdef MENU_FILENAME
      RMDir "$SMPROGRAMS\${MENU_FILENAME}"
    !endif

    System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  ${endif}
!macroend
