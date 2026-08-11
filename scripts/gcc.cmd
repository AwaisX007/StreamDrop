@echo off
rem Tauri's GNU windres uses GCC only as a preprocessor for its generated,
rem include-free Windows resource file. Pass that final input file through
rem without requiring a machine-wide C/C++ compiler.
set "streamdrop_resource_input="
:streamdrop_next_argument
if "%~1"=="" goto streamdrop_output_resource
set "streamdrop_resource_input=%~1"
shift
goto streamdrop_next_argument
:streamdrop_output_resource
if not defined streamdrop_resource_input exit /b 1
type "%streamdrop_resource_input%"
