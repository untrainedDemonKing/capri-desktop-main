# Moves another program's window for Capri, when she has taken it over (mover.js starts this and talks to it).
# It reads one command per line from its input and answers each with one line:
#
#   M <hwnd> <x> <y>   put the window so that its VISIBLE frame's top-left corner is at x, y (physical pixels)
#   E <hwnd>           she is done with that window (forget it)
#
#   OK <hwnd>          done
#   LOST <hwnd>        the window is not where she put it last: someone else (you) moved it, so she lets go
#   GONE <hwnd>       the window is closed, minimised or maximised
#   DENIED <hwnd>      the program does not allow it (a window of a program run as administrator, say), or it is hung
#
# It only ever changes a window's position: not its size, its place among the windows, or which one is active.
# It ends with its input, when Capri does.

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class CapriMover {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }

  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsHungAppWindow(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT r);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out RECT value, int size);

  const uint SWP_NOSIZE = 0x0001, SWP_NOZORDER = 0x0004, SWP_NOACTIVATE = 0x0010, SWP_NOOWNERZORDER = 0x0200;
  const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;

  // where we last put each window (its outer left/top), to tell when somebody else has moved it since
  static readonly Dictionary<long, int[]> last = new Dictionary<long, int[]>();

  public static void Init() {
    SetProcessDpiAwarenessContext(new IntPtr(-4)); // per-monitor v2, like the window watcher: real pixels
  }

  public static void Forget(long id) { last.Remove(id); }

  public static string Move(long id, int x, int y) {
    var h = new IntPtr(id);
    if (!IsWindow(h) || IsIconic(h) || IsZoomed(h)) return "GONE";
    if (IsHungAppWindow(h)) return "DENIED";
    RECT outer, frame;
    if (!GetWindowRect(h, out outer)) return "GONE";
    int[] was;
    if (last.TryGetValue(id, out was) && (Math.Abs(outer.Left - was[0]) > 3 || Math.Abs(outer.Top - was[1]) > 3)) return "LOST";
    // the visible frame sits inside the window's outer rectangle (the invisible resize borders)
    int dx = 0, dy = 0;
    if (DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, out frame, 16) == 0) { dx = outer.Left - frame.Left; dy = outer.Top - frame.Top; }
    int nx = x + dx, ny = y + dy;
    if (!SetWindowPos(h, IntPtr.Zero, nx, ny, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER)) return "DENIED";
    last[id] = new int[] { nx, ny };
    return "OK";
  }
}
"@

[CapriMover]::Init()
$in = [Console]::In
while ($true) {
  $line = $in.ReadLine()
  if ($null -eq $line) { break }
  $p = $line.Trim().Split(' ')
  $reply = ''
  try {
    $id = [long]::Parse($p[1])
    if ($p[0] -eq 'M' -and $p.Length -eq 4) {
      $reply = [CapriMover]::Move($id, [int]::Parse($p[2]), [int]::Parse($p[3]))
    } elseif ($p[0] -eq 'E') {
      [CapriMover]::Forget($id)
      $reply = 'OK'
    } else {
      continue
    }
  } catch {
    $reply = 'DENIED'
  }
  [Console]::Out.WriteLine($reply + ' ' + $p[1])
  [Console]::Out.Flush()
}
