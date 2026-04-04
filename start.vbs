' Vorra Silent Launcher — no console window
' Launches Electron directly without any terminal

On Error Resume Next

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

root = fso.GetParentFolderName(WScript.ScriptFullName)
electronExe = fso.BuildPath(root, "node_modules\electron\dist\electron.exe")
distFile = fso.BuildPath(root, "dist\index.html")

' Check Electron exists
If Not fso.FileExists(electronExe) Then
    MsgBox "Electron not found. Please run setup first." & vbCrLf & vbCrLf & _
           "Expected at:" & vbCrLf & electronExe, vbExclamation, "Vorra"
    WScript.Quit 1
End If

' Check if build exists — rebuild silently if needed
If Not fso.FileExists(distFile) Then
    shell.Run "cmd /c cd /d """ & root & """ && npx vite build > """ & fso.BuildPath(root, "build-log.txt") & """ 2>&1", 0, True
End If

' Launch Electron — pass project root as argument (Electron reads package.json from it)
shell.Run """" & electronExe & """ """ & root & """", 1, False

WScript.Quit 0
