$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut("$([Environment]::GetFolderPath('Desktop'))\Push Post.lnk")
$sc.TargetPath = "pwsh.exe"
$sc.Arguments = "-NoExit -ExecutionPolicy Bypass -File `"$PSScriptRoot\push.ps1`""
$sc.WorkingDirectory = $PSScriptRoot
$sc.IconLocation = "pwsh.exe,0"
$sc.Save()