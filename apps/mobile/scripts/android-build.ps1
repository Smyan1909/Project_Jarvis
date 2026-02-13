# Android build script that excludes MSYS2 from PATH to prevent linker conflicts
# The MSYS2 lld linker is incompatible with Android NDK's expected linker flags

$originalPath = $env:PATH
$env:PATH = ($env:PATH -split ';' | Where-Object { $_ -notmatch 'msys64' }) -join ';'

try {
    & pnpm exec expo run:android @args
    $exitCode = $LASTEXITCODE
} finally {
    $env:PATH = $originalPath
}

exit $exitCode
