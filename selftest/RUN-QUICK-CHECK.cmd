@echo off
chcp 65001 >nul
rem Quick check of Capri: touches nothing, moves no mouse, downloads nothing. Only ASCII in this file.
call "%~dp0lib\start.cmd" --quick %*
