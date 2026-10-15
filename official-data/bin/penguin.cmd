@echo off
rem penguin CLI shim, rewritten by the PenguinHarness server at every start.
rem Runs the CLI of the harness that serves this data root, on that server's own runtime.
setlocal
"C:\Program Files\nodejs\node.exe" "C:\downloads\deepseek-workspace\agent_harness\agent_harness\packages\cli\dist\penguin.js" %*
exit /b %errorlevel%
