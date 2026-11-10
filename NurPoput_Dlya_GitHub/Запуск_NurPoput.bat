@echo off
chcp 65001 >nul
title NurPoput - Локальный запуск
cd /d "%~dp0"

echo ===================================================
echo   Запуск сервиса NurPoput KG на локальном компьютере...
echo ===================================================

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ОШИБКА] Node.js не найден на компьютере!
    echo Пожалуйста, установите Node.js с официального сайта: https://nodejs.org/
    echo Либо откройте index.html напрямую в вашем браузере.
    pause
    exit /b 1
)

echo Сервер запускается по адресу: http://localhost:3000
start "" http://localhost:3000
node server.js
pause
