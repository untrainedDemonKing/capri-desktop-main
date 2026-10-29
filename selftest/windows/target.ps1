# A window for Capri's hands to work on during the full check: two buttons, a text box, and a state file it keeps up to date
# (what was clicked, what was typed, where the pointer is, whether the window is in front), which the check reads to see what the
# hands really did. It closes by itself after two minutes. The name of the second button is made of letters by their numbers, so that
# the file needs no particular encoding.
param([string]$State)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CapriTargetDpi {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int cmd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
}
'@
[void][CapriTargetDpi]::SetProcessDPIAware()
[System.Windows.Forms.Application]::EnableVisualStyles()

$script:clicks = 0
$script:clicksRu = 0
$ru = -join ([char[]](0x041D, 0x0430, 0x0436, 0x043C, 0x0438, 0x0020, 0x043C, 0x0435, 0x043D, 0x044F))

$form = New-Object System.Windows.Forms.Form
$form.Text = 'CapriSelfTest'
$form.Width = 520
$form.Height = 360
$form.StartPosition = 'CenterScreen'

$box = New-Object System.Windows.Forms.TextBox
$box.Multiline = $true
$box.Dock = 'Top'
$box.Height = 150
$form.Controls.Add($box)

$one = New-Object System.Windows.Forms.Button
$one.Text = 'Press me'
$one.Left = 20; $one.Top = 180; $one.Width = 200; $one.Height = 50
$one.Add_Click({ $script:clicks++ })
$form.Controls.Add($one)

$two = New-Object System.Windows.Forms.Button
$two.Text = $ru
$two.Left = 260; $two.Top = 180; $two.Width = 200; $two.Height = 50
$two.Add_Click({ $script:clicksRu++ })
$form.Controls.Add($two)

# (not called Where: that is a name PowerShell already has, for Where-Object, and a name it has wins over a function)
function Rect($c) {
  $p = $c.PointToScreen([System.Drawing.Point]::Empty)
  return @{ x = $p.X; y = $p.Y; w = $c.Width; h = $c.Height }
}

function Save {
  try {
    $cursor = [System.Windows.Forms.Cursor]::Position
    $o = [ordered]@{
      ready = $true; pid = $PID
      clicks = $script:clicks; clicksRu = $script:clicksRu
      text = $box.Text; selected = $box.SelectionLength
      windowState = $form.WindowState.ToString(); inFront = [bool]$form.ContainsFocus
      visible = [bool][CapriTargetDpi]::IsWindowVisible($form.Handle); title = $form.Text
      cursor = @{ x = $cursor.X; y = $cursor.Y }
      form = @{ x = $form.Left; y = $form.Top; w = $form.Width; h = $form.Height }
      one = (Rect $one); two = (Rect $two); ruName = $ru
    }
    $json = ConvertTo-Json -Compress -Depth 4 -InputObject $o
    $tmp = "$State.tmp"
    [IO.File]::WriteAllText($tmp, $json, (New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $tmp -Destination $State -Force
  } catch { }
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 150
$timer.Add_Tick({ Save })
$timer.Start()

$stop = New-Object System.Windows.Forms.Timer
$stop.Interval = 120000
$stop.Add_Tick({ $form.Close() })
$stop.Start()

# (a program started with its window hidden, as the check starts this one, has the first showing of its first window turned into
# "hidden": the window is shown once more)
$form.Add_Shown({ [void][CapriTargetDpi]::ShowWindow($form.Handle, 5); $form.Activate(); $box.Focus(); Save })
[System.Windows.Forms.Application]::Run($form)
