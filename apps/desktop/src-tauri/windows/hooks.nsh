; P5-5：卸载后不残留安装位置注册表键。
; 上游 NSIS 仅在用户勾选「删除应用数据」时才清理 HKCU\Software\<厂商>\<产品>，
; 静默卸载（/S）没有该勾选项，会把指向已删除目录的键留下来。
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegKey SHCTX "${MANUPRODUCTKEY}"
    DeleteRegKey /ifempty SHCTX "${MANUKEY}"
  ${EndIf}
!macroend
