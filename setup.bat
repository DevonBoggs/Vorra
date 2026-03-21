@echo off
title Vorra Setup
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
if errorlevel 1 (
    echo.
    echo Setup encountered an error. Check setup-log.txt for details.
    pause
)
