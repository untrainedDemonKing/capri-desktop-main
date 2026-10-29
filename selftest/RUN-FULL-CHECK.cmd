@echo off
chcp 65001 >nul
rem Full check of Capri: also tries her hands on a test window and installs speech recognition and a voice into a temporary
rem folder (about 200 MB, removed afterwards). It asks before it starts. Only ASCII in this file.
call "%~dp0lib\start.cmd" --full %*
